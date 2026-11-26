export const AVATAR_INPUT_MAX = 8 * 1024 * 1024;
export const AVATAR_STORED_MAX = 1024 * 1024;
const types = ['image/jpeg', 'image/png', 'image/webp'];
export const isMemberAvatarPath = (path: unknown): path is string =>
  typeof path === 'string' &&
  /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|webp)$/.test(
    path,
  );
export function memberAvatarUrl(
  path: unknown,
  base = import.meta.env?.VITE_SUPABASE_URL,
): string {
  if (!isMemberAvatarPath(path) || !base) return '';
  try {
    const url = new URL(base);
    if (
      url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    )
      return '';
    return `${url.origin}/storage/v1/object/public/member-avatars/${path}`;
  } catch {
    return '';
  }
}
export function validateAvatarInput(file: File) {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name))
    throw new Error(
      'Hãy xuất ảnh HEIC/HEIF sang JPG, PNG hoặc WebP rồi chọn lại.',
    );
  if (!types.includes(file.type))
    throw new Error('Chọn ảnh JPG, PNG hoặc WebP.');
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > AVATAR_INPUT_MAX
  )
    throw new Error('Ảnh cần có dung lượng từ 1 byte đến 8 MB.');
}
export function avatarCrop(width: number, height: number) {
  if (
    ![width, height].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 16000,
    ) ||
    width * height > 40_000_000
  )
    throw new Error(
      'Kích thước ảnh quá lớn hoặc không hợp lệ. Hãy chọn ảnh nhỏ hơn.',
    );
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}
export async function validateAvatarHeader(file: File) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = (a: number, z: number) => String.fromCharCode(...b.slice(a, z));
  if (
    !(file.type === 'image/jpeg'
      ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : file.type === 'image/png'
        ? b.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
        : file.type === 'image/webp' &&
          text(0, 4) === 'RIFF' &&
          text(8, 12) === 'WEBP')
  )
    throw new Error(
      'Nội dung tệp không đúng định dạng ảnh. Hãy chọn ảnh khác.',
    );
}
/** Re-encode pixels at 512px: no EXIF/location or original file is uploaded. */
export async function createMemberAvatar(file: File): Promise<File> {
  validateAvatarInput(file);
  await validateAvatarHeader(file);
  const url = URL.createObjectURL(file),
    image = new Image();
  const canvas = document.createElement('canvas');
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('Không đọc được ảnh. Hãy chọn ảnh khác.'));
      image.src = url;
    });
    const crop = avatarCrop(image.naturalWidth, image.naturalHeight);
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx)
      throw new Error(
        'Trình duyệt chưa hỗ trợ xử lý ảnh. Hãy cập nhật trình duyệt.',
      );
    const draw = () =>
      ctx.drawImage(
        image,
        crop.x,
        crop.y,
        crop.side,
        crop.side,
        0,
        0,
        512,
        512,
      );
    draw();
    const encode = (mime: string, quality: number) =>
      new Promise<Blob | null>((resolve, reject) => {
        try {
          canvas.toBlob(resolve, mime, quality);
        } catch (e) {
          reject(e);
        }
      });
    let blob: Blob | null = null;
    try {
      blob = await encode('image/webp', 0.86);
    } catch {
      /* JPEG fallback for older devices */
    }
    if (
      !blob ||
      blob.type !== 'image/webp' ||
      !blob.size ||
      blob.size > AVATAR_STORED_MAX
    ) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 512, 512);
      draw();
      blob = await encode('image/jpeg', 0.86);
    }
    if (
      !blob ||
      !['image/webp', 'image/jpeg'].includes(blob.type) ||
      !blob.size ||
      blob.size > AVATAR_STORED_MAX
    )
      throw new Error('Không tạo được ảnh đại diện. Hãy chọn ảnh khác.');
    return new File(
      [blob],
      `avatar.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`,
      { type: blob.type },
    );
  } finally {
    image.onload = image.onerror = null;
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
type AvatarPermit = {
  bucket: 'member-avatars';
  path: string;
  expires_at: string;
};
export interface AvatarUploadAttempt {
  file: File;
  permit?: AvatarPermit;
  uploaded?: boolean;
  complete?: boolean;
}
export interface AvatarUploadDependencies {
  prepare: (args: { p_mime: string; p_size: number }) => Promise<unknown>;
  complete: (path: string) => Promise<unknown>;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options: { contentType: string; upsert: false; cacheControl: string },
      ) => Promise<{
        data: { path: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
  now?: () => number;
}
/** Preserve the same immutable object through a failed confirmation or profile save. */
export async function uploadMemberAvatar(
  attempt: AvatarUploadAttempt,
  deps: AvatarUploadDependencies,
): Promise<string> {
  const file = attempt.file;
  if (
    !['image/jpeg', 'image/webp'].includes(file.type) ||
    file.size < 1 ||
    file.size > AVATAR_STORED_MAX
  )
    throw new Error(
      'Ảnh đại diện đã xử lý phải là JPG/WebP và không quá 1 MB.',
    );
  await validateAvatarHeader(file);
  const now = (deps.now ?? Date.now)();
  if (
    !attempt.permit ||
    (!attempt.uploaded && Date.parse(attempt.permit.expires_at) <= now)
  ) {
    const p = (await deps.prepare({
      p_mime: file.type,
      p_size: file.size,
    })) as AvatarPermit | null;
    if (
      !p ||
      p.bucket !== 'member-avatars' ||
      !isMemberAvatarPath(p.path) ||
      !p.path.endsWith(file.type === 'image/webp' ? '.webp' : '.jpg') ||
      !Number.isFinite(Date.parse(p.expires_at)) ||
      Date.parse(p.expires_at) <= now
    )
      throw new Error(
        'Quyền tải ảnh không hợp lệ hoặc đã hết hạn. Hãy thử lại.',
      );
    attempt.permit = p;
    attempt.uploaded = false;
    attempt.complete = false;
  }
  const path = attempt.permit.path;
  if (!attempt.uploaded) {
    const { data, error } = await deps.storage
      .from('member-avatars')
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
        cacheControl: '31536000',
      })
      .catch((error: unknown) => ({
        data: null,
        error: {
          message:
            error instanceof Error ? error.message : 'Mất kết nối khi tải ảnh.',
        },
      }));
    if (error) {
      // Storage may have accepted the immutable image before its reply was lost.
      // Only the backend's exact owner/metadata confirmation can recover it.
      try {
        await deps.complete(path);
        attempt.uploaded = true;
        attempt.complete = true;
        return path;
      } catch {
        throw new Error(`Chưa tải được avatar: ${error.message}`);
      }
    }
    if (data?.path !== path)
      throw new Error('Máy chủ chưa xác nhận đúng ảnh đã tải.');
    attempt.uploaded = true;
  }
  if (!attempt.complete) {
    await deps.complete(path);
    attempt.complete = true;
  }
  return path;
}

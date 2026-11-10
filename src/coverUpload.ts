export const TRIP_COVER_MAX_BYTES = 5 * 1024 * 1024;
const coverTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

type UploadOptions = {
  contentType: string;
  upsert: false;
  cacheControl: string;
};

export interface TripCoverUploadDependencies {
  prepare: (args: {
    p_activity: string | null;
    p_mime: string;
    p_size: number;
  }) => Promise<unknown>;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        file: File,
        options: UploadOptions,
      ) => Promise<{
        data: { path: string } | null;
        error: { message: string } | null;
      }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
  now?: () => number;
}

export function validateTripCoverFile(file: File): void {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
    throw new Error(
      'Ảnh HEIC/HEIF chưa được hỗ trợ. Hãy xuất ảnh sang JPG, PNG hoặc WebP rồi chọn lại.',
    );
  }
  if (!coverTypes.has(file.type))
    throw new Error('Chọn ảnh JPG, PNG hoặc WebP để làm ảnh bìa.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new Error('File ảnh trống hoặc không hợp lệ. Hãy chọn ảnh khác.');
  if (file.size > TRIP_COVER_MAX_BYTES)
    throw new Error('Ảnh vượt quá 5 MB. Hãy chọn ảnh nhỏ hơn.');
}

function detail(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : 'Không thể kết nối máy chủ. Hãy thử lại.';
}

function permit(value: unknown, now: number) {
  if (typeof value !== 'object' || value === null)
    throw new Error('Máy chủ chưa cấp quyền tải ảnh hợp lệ.');
  const p = value as Record<string, unknown>;
  if (
    p.bucket !== 'trip-covers' ||
    typeof p.path !== 'string' ||
    p.path.length > 300 ||
    !/^[a-zA-Z0-9_/-]+\.(?:jpg|jpeg|png|webp)$/.test(p.path) ||
    p.path.startsWith('/') ||
    p.path.split('/').some((part) => !part || part === '.' || part === '..') ||
    typeof p.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(p.expires_at)) ||
    Date.parse(p.expires_at) <= now
  )
    throw new Error(
      'Quyền tải ảnh không hợp lệ hoặc đã hết hạn. Hãy chọn lại ảnh.',
    );
  return { bucket: p.bucket, path: p.path };
}

/** Returns an online URL only after Supabase Storage confirms the upload. */
export async function uploadTripCover(
  file: File,
  activityId: string | null | undefined,
  dependencies: TripCoverUploadDependencies,
): Promise<string> {
  validateTripCoverFile(file);
  let issued: unknown;
  try {
    issued = await dependencies.prepare({
      p_activity: activityId ?? null,
      p_mime: file.type,
      p_size: file.size,
    });
  } catch (error) {
    throw new Error(`Không thể cấp quyền tải ảnh: ${detail(error)}`);
  }
  const destination = permit(issued, (dependencies.now ?? Date.now)());
  try {
    const bucket = dependencies.storage.from(destination.bucket);
    const { data, error } = await bucket.upload(destination.path, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: '31536000',
    });
    if (error) throw error;
    if (!data || data.path !== destination.path)
      throw new Error('Máy chủ chưa xác nhận đúng file ảnh đã tải.');
    const rawUrl = bucket.getPublicUrl(destination.path).data.publicUrl;
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !==
        `/storage/v1/object/public/${destination.bucket}/${destination.path}`
    )
      throw new Error('Máy chủ chưa trả về liên kết ảnh trực tuyến hợp lệ.');
    return rawUrl;
  } catch (error) {
    throw new Error(`Tải ảnh thất bại: ${detail(error)}`);
  }
}

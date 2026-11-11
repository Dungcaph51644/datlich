export const ALBUM_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const ALBUM_THUMBNAIL_MAX_BYTES = 1024 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AlbumThumbnail {
  blob: Blob;
  width: number;
  height: number;
}

/** Finish may return an already-saved photo on retry; preserve any newer local draft. */
export function reconcileAlbumUploadCaption(draft: string, canonical: string) {
  return {
    caption: canonical,
    unsavedCaption: draft !== canonical ? draft : undefined,
    captionWarning:
      draft !== canonical
        ? 'Ảnh đã được lưu từ lượt tải trước. Chú thích trên máy chủ khác bản vừa nhập và được giữ nguyên. Bản nháp chưa lưu ở bên dưới; hãy mở ảnh → Sửa chú thích để cập nhật.'
        : '',
  };
}

export interface AlbumUploadPermit {
  operation_id: string;
  photo_id: string;
  bucket: 'team-album';
  original_path: string;
  thumbnail_path: string;
  expires_at: string;
  original_exists: boolean;
  thumbnail_exists: boolean;
}

export interface AlbumUploadInput {
  albumId: string;
  operationId: string;
  file: File;
  thumbnail: AlbumThumbnail;
  caption: string;
}

export interface AlbumUploadDependencies<T> {
  prepare: (args: {
    p_album_id: string;
    p_operation_id: string;
    p_original_mime: string;
    p_original_size: number;
    p_thumbnail_size: number;
    p_width: number;
    p_height: number;
    p_filename: string;
  }) => Promise<unknown>;
  upload: (
    bucket: string,
    path: string,
    file: Blob,
    options: { signal?: AbortSignal; onProgress: (bytes: number) => void },
  ) => Promise<void>;
  finish: (args: { p_operation_id: string; p_caption: string }) => Promise<T>;
  onProgress?: (loaded: number, total: number) => void;
  onPhase?: (phase: 'preparing' | 'uploading' | 'saving') => void;
  signal?: AbortSignal;
  now?: () => number;
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Đã dừng tải ảnh.', 'AbortError');
}

export function validateAlbumImageFile(file: File) {
  if (/heic|heif/i.test(file.type) || /\.(?:heic|heif)$/i.test(file.name))
    throw new Error(
      'Ảnh HEIC/HEIF chưa được hỗ trợ. Hãy xuất sang JPG, PNG hoặc WebP rồi chọn lại.',
    );
  if (!imageTypes.has(file.type))
    throw new Error('Chỉ nhận ảnh JPG, PNG hoặc WebP.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new Error('File ảnh trống hoặc không hợp lệ.');
  if (file.size > ALBUM_IMAGE_MAX_BYTES)
    throw new Error('Ảnh vượt quá 15 MB. Hãy chọn ảnh nhỏ hơn.');
}

/** Decode locally once; the original file is never recolored or re-encoded. */
export async function createAlbumThumbnail(
  file: File,
  signal?: AbortSignal,
): Promise<AlbumThumbnail> {
  validateAlbumImageFile(file);
  abortIfNeeded(signal);
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        image.src = '';
        reject(new DOMException('Đã dừng tải ảnh.', 'AbortError'));
      };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      image.onload = () => {
        cleanup();
        resolve();
      };
      image.onerror = () => {
        cleanup();
        reject(
          new Error(
            'Không đọc được ảnh. Hãy chọn một ảnh JPG, PNG hoặc WebP khác.',
          ),
        );
      };
      signal?.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    abortIfNeeded(signal);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (
      !width ||
      !height ||
      width > 40_000 ||
      height > 40_000 ||
      width * height > 100_000_000
    )
      throw new Error(
        'Kích thước ảnh không hợp lệ hoặc quá lớn để xử lý trên thiết bị.',
      );
    const scale = Math.min(1, 720 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error(
        'Trình duyệt chưa hỗ trợ tạo ảnh thu nhỏ. Hãy cập nhật trình duyệt.',
      );
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error('Không tạo được ảnh thu nhỏ. Hãy thử lại.')),
        'image/webp',
        0.8,
      );
    });
    abortIfNeeded(signal);
    if (
      blob.type !== 'image/webp' ||
      blob.size > ALBUM_THUMBNAIL_MAX_BYTES ||
      blob.size <= 0
    )
      throw new Error(
        'Trình duyệt chưa tạo được ảnh WebP thu nhỏ phù hợp. Hãy cập nhật trình duyệt hoặc chọn ảnh khác.',
      );
    canvas.width = canvas.height = 0;
    return { blob, width, height };
  } finally {
    image.onload = image.onerror = null;
    URL.revokeObjectURL(url);
  }
}

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 400 &&
    /^[a-zA-Z0-9_/-]+\.(?:jpg|jpeg|png|webp)$/.test(value) &&
    value.split('/').every((part) => !!part && part !== '.' && part !== '..')
  );
}

function readPermit(
  value: unknown,
  operationId: string,
  now: number,
): AlbumUploadPermit {
  if (!value || typeof value !== 'object')
    throw new Error('Máy chủ chưa cấp quyền tải ảnh hợp lệ.');
  const p = value as Record<string, unknown>;
  if (
    p.operation_id !== operationId ||
    typeof p.photo_id !== 'string' ||
    !uuidPattern.test(p.photo_id) ||
    p.bucket !== 'team-album' ||
    !validPath(p.original_path) ||
    !validPath(p.thumbnail_path) ||
    !p.thumbnail_path.endsWith('.webp') ||
    p.original_path === p.thumbnail_path ||
    typeof p.original_exists !== 'boolean' ||
    typeof p.thumbnail_exists !== 'boolean' ||
    typeof p.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(p.expires_at)) ||
    Date.parse(p.expires_at) <= now
  )
    throw new Error('Quyền tải ảnh không hợp lệ hoặc đã hết hạn. Hãy thử lại.');
  return p as unknown as AlbumUploadPermit;
}

/** A retry reuses its operation UUID and asks the server which blobs already exist. */
export async function uploadAlbumPhoto<T>(
  input: AlbumUploadInput,
  dependencies: AlbumUploadDependencies<T>,
): Promise<T> {
  validateAlbumImageFile(input.file);
  const thumbnail = input.thumbnail;
  if (!uuidPattern.test(input.operationId) || !uuidPattern.test(input.albumId))
    throw new Error('Mã album hoặc lượt tải ảnh không hợp lệ.');
  if (
    thumbnail.blob.type !== 'image/webp' ||
    thumbnail.blob.size <= 0 ||
    thumbnail.blob.size > ALBUM_THUMBNAIL_MAX_BYTES ||
    !Number.isSafeInteger(thumbnail.width) ||
    !Number.isSafeInteger(thumbnail.height) ||
    thumbnail.width <= 0 ||
    thumbnail.height <= 0
  )
    throw new Error('Ảnh thu nhỏ hoặc kích thước ảnh không hợp lệ.');
  if (input.caption.length > 2000)
    throw new Error('Chú thích tối đa 2.000 ký tự.');
  abortIfNeeded(dependencies.signal);
  dependencies.onPhase?.('preparing');
  const issued = await dependencies.prepare({
    p_album_id: input.albumId,
    p_operation_id: input.operationId,
    p_original_mime: input.file.type,
    p_original_size: input.file.size,
    p_thumbnail_size: thumbnail.blob.size,
    p_width: thumbnail.width,
    p_height: thumbnail.height,
    p_filename: input.file.name,
  });
  abortIfNeeded(dependencies.signal);
  const permit = readPermit(
    issued,
    input.operationId,
    (dependencies.now ?? Date.now)(),
  );
  const total = input.file.size + thumbnail.blob.size;
  let originalLoaded = permit.original_exists ? input.file.size : 0;
  let thumbnailLoaded = permit.thumbnail_exists ? thumbnail.blob.size : 0;
  const report = () =>
    dependencies.onProgress?.(originalLoaded + thumbnailLoaded, total);
  report();
  dependencies.onPhase?.('uploading');
  if (!permit.original_exists) {
    await dependencies.upload(permit.bucket, permit.original_path, input.file, {
      signal: dependencies.signal,
      onProgress: (bytes) => {
        originalLoaded = Math.min(input.file.size, Math.max(0, bytes));
        report();
      },
    });
    originalLoaded = input.file.size;
    report();
  }
  abortIfNeeded(dependencies.signal);
  if (!permit.thumbnail_exists) {
    await dependencies.upload(
      permit.bucket,
      permit.thumbnail_path,
      thumbnail.blob,
      {
        signal: dependencies.signal,
        onProgress: (bytes) => {
          thumbnailLoaded = Math.min(thumbnail.blob.size, Math.max(0, bytes));
          report();
        },
      },
    );
    thumbnailLoaded = thumbnail.blob.size;
    report();
  }
  abortIfNeeded(dependencies.signal);
  dependencies.onPhase?.('saving');
  const confirmed = await dependencies.finish({
    p_operation_id: input.operationId,
    p_caption: input.caption,
  });
  if (
    !confirmed ||
    typeof confirmed !== 'object' ||
    !('id' in confirmed) ||
    confirmed.id !== permit.photo_id ||
    !('album_id' in confirmed) ||
    confirmed.album_id !== input.albumId
  )
    throw new Error(
      'Máy chủ chưa xác nhận đúng ảnh và album đã lưu. Hãy thử lại.',
    );
  return confirmed;
}

export interface AlbumStorageConnection {
  url: string;
  publicKey: string;
  accessToken?: string | null;
  xhr?: () => XMLHttpRequest;
}

/** Standard Supabase Storage POST with real byte events; new public keys are not JWTs. */
export function xhrAlbumStorageUpload(
  connection: AlbumStorageConnection,
  bucket: string,
  path: string,
  blob: Blob,
  options: { signal?: AbortSignal; onProgress: (bytes: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    abortIfNeeded(options.signal);
    const base = new URL(connection.url);
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      bucket !== 'team-album' ||
      !validPath(path)
    )
      throw new Error('Địa chỉ lưu ảnh không hợp lệ.');
    const request = connection.xhr?.() ?? new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    request.open(
      'POST',
      `${base.origin}${base.pathname.replace(/\/$/, '')}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
    );
    request.setRequestHeader('apikey', connection.publicKey);
    const token =
      connection.accessToken ||
      (connection.publicKey.startsWith('eyJ') ? connection.publicKey : null);
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', blob.type);
    request.setRequestHeader('cache-control', 'max-age=31536000');
    request.setRequestHeader('x-upsert', 'false');
    request.timeout = 120_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        options.onProgress(Math.min(blob.size, event.loaded));
    };
    request.onload = () => {
      cleanup();
      if (request.status >= 200 && request.status < 300) {
        options.onProgress(blob.size);
        resolve();
      } else {
        let detail = '';
        try {
          const body = JSON.parse(request.responseText) as {
            message?: string;
            error?: string;
          };
          detail = body.message || body.error || '';
        } catch {
          /* Keep the error concise when a proxy returns HTML. */
        }
        reject(
          new Error(
            `Tải file ảnh thất bại (${request.status}).${detail ? ` ${detail}` : ' Hãy thử lại.'}`,
          ),
        );
      }
    };
    request.onerror = () => {
      cleanup();
      reject(
        new Error('Mất kết nối khi tải ảnh. Hãy kết nối lại và thử tải lại.'),
      );
    };
    request.ontimeout = () => {
      cleanup();
      reject(new Error('Tải ảnh quá thời gian chờ. Hãy thử lại.'));
    };
    request.onabort = () => {
      cleanup();
      reject(new DOMException('Đã dừng tải ảnh.', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    request.send(blob);
  });
}

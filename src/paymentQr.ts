export const PAYMENT_QR_MAX_BYTES = 5 * 1024 * 1024;
const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const isPaymentQrPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^qr\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(value);

export function validatePaymentQrFile(file: File) {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name))
    throw new Error(
      'Hãy xuất ảnh HEIC/HEIF sang JPG, PNG hoặc WebP rồi chọn lại.',
    );
  if (!mimeTypes.has(file.type))
    throw new Error('Chọn ảnh QR JPG, PNG hoặc WebP.');
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > PAYMENT_QR_MAX_BYTES
  )
    throw new Error('Ảnh QR cần có dung lượng từ 1 byte đến 5 MB.');
}

type UploadDependencies = {
  prepare: (args: {
    p_activity: string;
    p_mime: string;
    p_size: number;
  }) => Promise<unknown>;
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
};

/** Keep original image pixels; a stored QR may contain a fixed amount. */
export async function uploadPaymentQr(
  file: File,
  activityId: string,
  dependencies: UploadDependencies,
): Promise<string> {
  validatePaymentQrFile(file);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  const validHeader =
    file.type === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : file.type === 'image/png'
        ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
        : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!validHeader)
    throw new Error(
      'Nội dung tệp không đúng định dạng ảnh. Hãy chọn lại ảnh QR.',
    );
  const result = await dependencies.prepare({
    p_activity: activityId,
    p_mime: file.type,
    p_size: file.size,
  });
  if (!result || typeof result !== 'object')
    throw new Error('Chưa được cấp quyền tải QR.');
  const permit = result as Record<string, unknown>;
  const extension =
    file.type === 'image/jpeg'
      ? 'jpg'
      : file.type === 'image/png'
        ? 'png'
        : 'webp';
  if (
    permit.bucket !== 'payment-qrs' ||
    !isPaymentQrPath(permit.path) ||
    !permit.path.endsWith('.' + extension) ||
    typeof permit.expires_at !== 'string' ||
    !(Date.parse(permit.expires_at) > (dependencies.now ?? Date.now)())
  )
    throw new Error('Quyền tải QR không hợp lệ hoặc đã hết hạn. Hãy thử lại.');
  const { data, error } = await dependencies.storage
    .from('payment-qrs')
    .upload(permit.path, file, {
      contentType: file.type,
      upsert: false,
      cacheControl: '31536000',
    });
  if (error) throw new Error(`Chưa tải được QR: ${error.message}`);
  if (data?.path !== permit.path)
    throw new Error('Máy chủ chưa xác nhận đúng ảnh QR.');
  await dependencies.complete(permit.path);
  return permit.path;
}

export async function downloadPaymentQr(url: string, filename: string) {
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Chưa tải được ảnh QR. Bạn thử lại nhé.');
  const blob = await response.blob();
  if (
    !mimeTypes.has(blob.type.split(';')[0]) ||
    blob.size <= 0 ||
    blob.size > PAYMENT_QR_MAX_BYTES
  )
    throw new Error('Ảnh QR trả về không hợp lệ. Hãy tải lại dữ liệu.');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename.replace(/[\\/\u0000-\u001f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

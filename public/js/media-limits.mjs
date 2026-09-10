// Decimal MB: keep a margin below the Storage provider's 50 MB limit.
export const MAX_MEDIA_BYTES = 45_000_000;
export const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024;

export function assertMediaSize(blob, fileName = "このファイル") {
  if (Number(blob?.size) <= MAX_MEDIA_BYTES) return;
  const size = (Number(blob?.size || 0) / 1_000_000).toFixed(1);
  throw new Error(`${fileName} は ${size}MB あります。動画・音声は1ファイル45MB以下にしてください。\n長さではなく容量で判定します。ファイルを事前に圧縮してください。動画の場合は、利用できるYouTube動画のURLをボードに貼り付ける方法もあります。\n選択したファイルは変更されません。`);
}

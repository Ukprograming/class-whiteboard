export function storageUploadEndpoint(baseUrl) {
  const url = new URL(baseUrl);
  if (/^[a-z0-9]+\.supabase\.co$/i.test(url.hostname)) {
    url.hostname = url.hostname.replace('.supabase.co', '.storage.supabase.co');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/storage/v1/upload/resumable`;
  url.search = '';
  url.hash = '';
  return url.href;
}

let tusModule;
async function loadTus() {
  try {
    return await (tusModule ||= import('https://esm.sh/tus-js-client@4.3.1'));
  } catch (error) {
    tusModule = null;
    throw new Error('ファイル送信の準備に失敗しました。接続を確認して、もう一度保存してください。', { cause: error });
  }
}

// Inject the client loader for protocol tests; production always uses the pinned
// tus client. The server validates the bearer token on every request.
export async function uploadResumable({ baseUrl, bucket, path, blob, mimeType, getToken, onProgress = () => {}, loadClient = loadTus }) {
  const { Upload } = await loadClient();
  const endpoint = storageUploadEndpoint(baseUrl);
  await new Promise((resolve, reject) => {
    const upload = new Upload(blob, {
      endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      // Asset paths are immutable, owner-scoped and unique per board asset.
      fingerprint: async () => JSON.stringify(['whiteboard-v1', endpoint, bucket, path, blob.size]),
      metadata: { bucketName: bucket, objectName: path, contentType: mimeType, cacheControl: '31536000' },
      onBeforeRequest: async request => {
        const token = await getToken();
        if (!token) throw new Error('ログインの有効期限が切れました。再ログインして保存してください。');
        request.setHeader('Authorization', `Bearer ${token}`);
        request.setHeader('x-upsert', 'false');
      },
      onProgress: (sent, total) => onProgress({ sent, total, retrying: false }),
      onShouldRetry: (error, attempt, options) => {
        const status = error?.originalResponse?.getStatus?.() || 0;
        // Reauthorize a transient expired token, but do not retry permission,
        // size or path conflicts, which need user action or caller verification.
        const retry = status === 0 || status === 401 || status === 408 || status === 423 || status === 429 || status >= 500;
        if (retry && attempt < options.retryDelays.length) onProgress({ retrying: true });
        return retry;
      },
      onError: reject,
      onSuccess: resolve,
    });
    void (async () => {
      // Storage-disabled/private browsing still supports in-request retries.
      let previous = [];
      try { previous = await upload.findPreviousUploads(); } catch { /* best effort */ }
      const resumable = previous.find(item => {
        try {
          const url = new URL(item.uploadUrl);
          return url.origin === new URL(endpoint).origin && url.pathname.startsWith(new URL(endpoint).pathname + '/');
        } catch { return false; }
      });
      if (resumable) upload.resumeFromPreviousUpload(resumable);
      upload.start();
    })().catch(reject);
  });
}

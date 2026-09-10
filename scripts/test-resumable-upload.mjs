import assert from 'node:assert/strict';
import { uploadResumable, storageUploadEndpoint } from '../public/js/resumable-upload.mjs';

assert.equal(storageUploadEndpoint('https://abc123.supabase.co'), 'https://abc123.storage.supabase.co/storage/v1/upload/resumable');
assert.equal(storageUploadEndpoint('http://localhost:54321'), 'http://localhost:54321/storage/v1/upload/resumable');
let options;
let resumed;
let token = 'first-token';
const updates = [];
class Upload {
  constructor(blob, value) { options = value; }
  async findPreviousUploads() {
    return [{ uploadUrl: 'https://foreign.example/storage/v1/upload/resumable/id' }, { uploadUrl: options.endpoint + '/valid-id' }];
  }
  resumeFromPreviousUpload(value) { resumed = value; }
  start() { options.onProgress(6, 10); options.onSuccess(); }
}
const base = { baseUrl: 'https://abc123.supabase.co', bucket: 'private', path: 'teachers/owner/board/assets/asset.mp4', blob: new Blob(['1234567890']), mimeType: 'video/mp4', getToken: async () => token, onProgress: value => updates.push(value), loadClient: async () => ({ Upload }) };
await uploadResumable(base);
assert.equal(resumed.uploadUrl, options.endpoint + '/valid-id');
assert.equal(options.chunkSize, 6 * 1024 * 1024);
assert.equal(options.removeFingerprintOnSuccess, true);
assert.equal(options.metadata.objectName, base.path);
const fingerprint = await options.fingerprint();
assert(fingerprint.includes(base.path) && !fingerprint.includes(token));
const headers = {};
await options.onBeforeRequest({ setHeader: (key, value) => { headers[key] = value; } });
assert.equal(headers.Authorization, 'Bearer first-token');
assert.equal(headers['x-upsert'], 'false');
token = 'refreshed-token';
await options.onBeforeRequest({ setHeader: (key, value) => { headers[key] = value; } });
assert.equal(headers.Authorization, 'Bearer refreshed-token');
for (const status of [0, 401, 408, 423, 429, 500, 503]) assert(options.onShouldRetry({ originalResponse: { getStatus: () => status } }, 0, options));
for (const status of [400, 403, 409, 413]) assert.equal(options.onShouldRetry({ originalResponse: { getStatus: () => status } }, 0, options), false);
assert(updates.some(value => value.retrying));
token = '';
await assert.rejects(() => options.onBeforeRequest({ setHeader() {} }), /再ログイン/);
class FailingUpload extends Upload { start() { options.onError(new Error('network')); } }
await assert.rejects(() => uploadResumable({ ...base, loadClient: async () => ({ Upload: FailingUpload }) }), /network/);
console.log('Resumable upload scope, authentication, progress and retry checks passed.');

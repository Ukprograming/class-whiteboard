// Optional integration check using the real pinned tus-js-client and a local
// Storage protocol emulator. Set TUS_MODULE to an installed tus-js-client.
const assert = require('node:assert/strict');
const http = require('node:http');
const { Upload: TusUpload } = require(process.env.TUS_MODULE || 'tus-js-client');

async function main() {
  const { uploadResumable } = await import('../public/js/resumable-upload.mjs');
  let offset = 0, interrupted = false, headRequests = 0, patchRequests = 0;
  const total = 13 * 1024 * 1024;
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-token');
    assert.equal(req.headers['x-upsert'], 'false');
    res.setHeader('Tus-Resumable', '1.0.0');
    if (req.method === 'HEAD') {
      headRequests++;
      res.writeHead(200, { 'Upload-Offset': offset, 'Upload-Length': total }); res.end(); return;
    }
    let size = 0;
    for await (const chunk of req) size += chunk.length;
    assert(size <= 6 * 1024 * 1024);
    if (req.method === 'POST') {
      assert.equal(Number(req.headers['upload-length']), total);
      offset += size;
      res.writeHead(201, { Location: '/storage/v1/upload/resumable/test', 'Upload-Offset': offset });
    } else {
      patchRequests++;
      assert.equal(Number(req.headers['upload-offset']), offset);
      offset += size;
      // Simulate the server accepting bytes but the client losing its response.
      if (!interrupted) { interrupted = true; res.writeHead(503); res.end(); return; }
      res.writeHead(204, { 'Upload-Offset': offset });
    }
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await uploadResumable({ baseUrl: `http://127.0.0.1:${server.address().port}`, bucket: 'class-whiteboard', path: 'teachers/test/asset.webm', blob: Buffer.alloc(total), mimeType: 'video/webm', getToken: async () => 'fixture-token', loadClient: async () => ({ Upload: TusUpload }) });
    assert.equal(offset, total);
    assert(interrupted && headRequests > 0 && patchRequests > 1);
    console.log(JSON.stringify({ uploadedBytes: offset, headRequests, patchRequests, resumedAfter503: interrupted }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = new URL("./run-storage-cleanup.mjs", import.meta.url);
const cleanupSecret = "test-cleanup-secret-never-print";
const privatePath = "students/private-student/revisions/private.json";

async function withMockServer(handler, test) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/functions/v1/process-storage-cleanup`;
  try {
    await test(url);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function runCli(url, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(runner), ...args], {
      env: { ...process.env, STORAGE_CLEANUP_URL: url, STORAGE_CLEANUP_SECRET: cleanupSecret },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function jsonResponse(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function assertNoSensitiveOutput(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(output.includes(cleanupSecret), false, "runner must not print its cleanup secret");
  assert.equal(output.includes(privatePath), false, "runner must not print failed Storage paths");
}

await withMockServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    assert.equal(request.headers["x-cleanup-secret"], cleanupSecret);
    assert.deepEqual(JSON.parse(body), { limit: 3 });
    jsonResponse(response, { ok: true, staleUploadsQueued: 2, claimed: 2, completed: 2, deletedObjects: 4, failed: [] });
  });
}, async (url) => {
  const result = await runCli(url, ["--limit", "3", "--max-batches", "2", "--retry-delay-ms", "0"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /claimed=2, completed=2, objects=4, failed=0/);
  assertNoSensitiveOutput(result);
});

await withMockServer((_request, response) => {
  jsonResponse(response, {
    ok: true,
    staleUploadsQueued: 0,
    claimed: 2,
    completed: 1,
    deletedObjects: 1,
    failed: [privatePath],
  });
}, async (url) => {
  const result = await runCli(url, ["--limit", "10", "--retry-delay-ms", "0"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /1 cleanup job\(s\) failed/);
  assertNoSensitiveOutput(result);
});

{
  let requests = 0;
  await withMockServer((_request, response) => {
    requests += 1;
    if (requests === 1) {
      response.socket.destroy();
      return;
    }
    jsonResponse(response, { ok: true, staleUploadsQueued: 0, claimed: 0, completed: 0, deletedObjects: 0, failed: [] });
  }, async (url) => {
    const result = await runCli(url, ["--retry-delay-ms", "0"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests, 2, "a transport failure must be retried");
    assert.match(result.stderr, /request failed; retrying/);
    assertNoSensitiveOutput(result);
  });
}

{
  let requests = 0;
  await withMockServer((request, response) => {
    requests += 1;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      assert.deepEqual(JSON.parse(body), { limit: 2 });
      jsonResponse(response, { ok: true, staleUploadsQueued: 0, claimed: 2, completed: 2, deletedObjects: 2, failed: [] });
    });
  }, async (url) => {
    const result = await runCli(url, ["--limit", "2", "--max-batches", "2", "--retry-delay-ms", "0"]);
    assert.equal(result.code, 1);
    assert.equal(requests, 2, "the runner must stop at its batch cap");
    assert.match(result.stderr, /safety cap; due jobs may remain/);
    assertNoSensitiveOutput(result);
  });
}

await withMockServer((_request, response) => {
  jsonResponse(response, { ok: true, staleUploadsQueued: 0, claimed: 0, completed: 0, deletedObjects: 0, failed: [] });
}, async (url) => {
  const result = await runCli(url, ["--limit", "501"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--limit must be an integer between 1 and 500/);
  assertNoSensitiveOutput(result);
});

{
  let requests = 0;
  await withMockServer((_request, response) => {
    requests += 1;
    jsonResponse(response, { message: cleanupSecret + privatePath }, 401);
  }, async (url) => {
    const check = await runCli(url, ["--check"]);
    assert.equal(check.code, 0, check.stderr);
    assert.equal(requests, 0, "readiness must not send a deletion request");
    const denied = await runCli(url, ["--retry-delay-ms", "0"]);
    assert.equal(denied.code, 1);
    assert.equal(requests, 1, "authentication failures must not be retried");
    assertNoSensitiveOutput(denied);
  });
}

{
  let leakedRequests = 0;
  await withMockServer((_request, response) => {
    leakedRequests += 1;
    jsonResponse(response, {});
  }, async (otherUrl) => {
    await withMockServer((_request, response) => {
      response.writeHead(307, { location: otherUrl });
      response.end();
    }, async (url) => {
      const result = await runCli(url, ["--retry-delay-ms", "0"]);
      assert.equal(result.code, 1);
      assert.equal(leakedRequests, 0, "never forward the maintenance secret to a redirect target");
      assertNoSensitiveOutput(result);
    });
  });
}

console.log("Storage cleanup runner tests passed.");

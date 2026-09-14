import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { assertMediaSize, RESUMABLE_UPLOAD_THRESHOLD } from "../public/js/media-limits.mjs";

const source = readFileSync("public/js/supabase-api.js", "utf8");
const runtimeSource = source
  .slice(source.indexOf("function boardPageDataList("), source.indexOf("export function getStudentLoginHints"))
  .replace("export const boardApi =", "globalThis.boardApi =");
const teacherId = "11000000-0000-4000-8000-000000000001";
const classId = "33000000-0000-4000-8000-000000000001";
const fileId = "55000000-0000-4000-8000-000000000001";
const oldSnapshot = `teachers/${teacherId}/${fileId}/revisions/66000000-0000-4000-8000-000000000001.json`;

function createHarness({ existing = null, failUpload = false, failCommit = false } = {}) {
  const uploads = [];
  const rpcCalls = [];
  const stored = new Map();
  const ids = ["77000000-0000-4000-8000-000000000001", "88000000-0000-4000-8000-000000000001"];
  const storage = {
    async upload(path, blob, options) {
      uploads.push({ path, blob, options });
      if (failUpload && path.includes("/revisions/")) return { error: new Error("upload failed") };
      if (stored.has(path)) return { error: new Error("already exists") };
      stored.set(path, blob);
      return { error: null };
    },
    async list(folder, options = {}) {
      return { data: [...stored.keys()]
        .filter((item) => item.startsWith(`${folder}/`))
        .map((item) => ({ name: item.slice(folder.length + 1) }))
        .filter((item) => !options.search || item.name === options.search), error: null };
    },
    async download(path) {
      return stored.has(path) ? { data: stored.get(path), error: null } : { data: null, error: new Error("missing") };
    },
  };
  const metadataQuery = {
    select() { return this; }, eq() { return this; }, limit() { return this; },
    async maybeSingle() { return { data: existing, error: null }; },
  };
  const client = {
    from() { return metadataQuery; },
    storage: { from() { return storage; } },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "commit_board_file_revision") {
        return { single: async () => failCommit
          ? { data: null, error: new Error("commit failed") }
          : { data: { id: args.p_row.id, name: args.p_row.name, distribution_id: args.p_row.distribution_id,
            assignment_submitted_at: args.p_row.assignment_submitted_at }, error: null } };
      }
      return Promise.resolve({ data: 1, error: null });
    },
  };
  const context = vm.createContext({
    supabase: client, supabaseEnabled: true, STORAGE_BUCKET: "class-whiteboard", SUPABASE_URL: "https://test.supabase.co",
    Blob, URL, fetch, console, assertMediaSize, RESUMABLE_UPLOAD_THRESHOLD,
    crypto: { randomUUID: () => ids.shift() },
    window: { dispatchEvent() {} }, CustomEvent,
    assertSupabase() {}, normalizeFolderPath: (value) => String(value || ""),
    resolveOwner: async () => ({ ownerKind: "teacher", teacherId, studentId: null, classId }),
    applyOwnerFilter: (query) => query,
    callFunction: async () => ({ ok: true }),
    uploadResumable: async () => { throw new Error("unexpected resumable upload"); },
  });
  vm.runInContext(runtimeSource, context);
  return { boardApi: context.boardApi, uploads, rpcCalls, stored };
}

const basePayload = { fileId, fileName: "保存テスト", folderPath: "", boardData: { objects: [] } };

{
  const harness = createHarness({ existing: { snapshot_path: oldSnapshot } });
  harness.stored.set(oldSnapshot, new Blob(["old"]));
  await harness.boardApi.saveBoard(structuredClone(basePayload));
  assert.equal(harness.uploads.length, 1);
  assert.notEqual(harness.uploads[0].path, oldSnapshot, "save must use a new immutable revision path");
  assert.equal(harness.uploads[0].options.upsert, false, "snapshot upload must never overwrite");
}

{
  const harness = createHarness({ existing: { snapshot_path: oldSnapshot }, failUpload: true });
  await assert.rejects(() => harness.boardApi.saveBoard(structuredClone(basePayload)), /upload failed/);
  assert.equal(harness.rpcCalls.some((call) => call.name === "commit_board_file_revision"), false,
    "a failed snapshot upload must not commit database metadata");
}

{
  const existing = {
    snapshot_path: oldSnapshot,
    distribution_id: "99000000-0000-4000-8000-000000000001",
    assignment_submitted_at: "2026-09-01T00:00:00.000Z",
    source_board_id: "aa000000-0000-4000-8000-000000000001",
    shared_board_id: null,
  };
  const harness = createHarness({ existing, failCommit: true });
  const imageUrl = URL.createObjectURL(new Blob(["image"], { type: "image/png" }));
  try {
    const payload = structuredClone(basePayload);
    payload.boardData = { objects: [{ kind: "image", assetKey: "asset-one", imageObjectUrl: imageUrl }] };
    await assert.rejects(() => harness.boardApi.saveBoard(payload), /commit failed/);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
  const commit = harness.rpcCalls.find((call) => call.name === "commit_board_file_revision");
  assert.equal(commit.args.p_row.snapshot_path === oldSnapshot, false);
  assert.equal(commit.args.p_row.distribution_id, existing.distribution_id);
  assert.equal(commit.args.p_row.source_board_id, existing.source_board_id,
    "a failed save must submit, but never rewrite, the existing source metadata");
  const cleanup = harness.rpcCalls.find((call) => call.name === "enqueue_owned_board_cleanup");
  assert(cleanup, "failed commit must enqueue uploaded objects");
  assert(cleanup.args.p_paths.includes(commit.args.p_row.snapshot_path));
  assert(commit.args.p_asset_paths.every((path) => cleanup.args.p_paths.includes(path)));
}

{
  const harness = createHarness({ existing: { snapshot_path: oldSnapshot } });
  const result = await harness.boardApi.saveBoard(structuredClone(basePayload));
  const commit = harness.rpcCalls.find((call) => call.name === "commit_board_file_revision");
  assert.equal(commit.args.p_expected_snapshot_path, oldSnapshot);
  assert.equal(commit.args.p_asset_paths.length, 0);
  assert.equal(commit.args.p_row.snapshot_path, harness.uploads[0].path);
  assert.equal(result.fileId, fileId);
}

console.log("Board immutable save reliability tests passed.");

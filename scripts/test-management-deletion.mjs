import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const source = path => readFileSync(`supabase/functions/${path}`, "utf8");
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const storageUrl = url(stripTypeScriptTypes(source("_shared/storage-cleanup.ts")));
const { processManagementDeletion } = await import(url(stripTypeScriptTypes(
  source("_shared/management-deletion.ts").replace('"./storage-cleanup.ts"', JSON.stringify(storageUrl))
)));

function fixture({ failStorage = false, failAuth = false, count = 2 } = {}) {
  const objects = new Set(Array.from({ length: count }, (_, i) => `students/s/nested/${i}.png`));
  const job = { id: "job", teacher_id: "teacher", lease_id: "lease", state: "queued",
    remaining_storage: [{ object_path: "students/s", path_kind: "prefix" },
      { object_path: "teachers/t/forms/retained.png", path_kind: "object" }],
    remaining_users: ["student", "teacher"] };
  const calls = [];
  let injectStorageFailure = failStorage;
  let injectAuthFailure = failAuth;
  const admin = {
    async rpc(name, args) {
      if (name === "claim_management_deletion") {
        if (job.state !== "queued" || (args.p_owner_id && args.p_owner_id !== job.teacher_id)) return { data: [] };
        job.state = "running";
        return { data: [structuredClone(job)] };
      }
      if (name === "prepare_management_storage_deletion") return { data: !args.p_path.includes("retained") };
      return { data: null };
    },
    from() {
      let patch;
      let owner;
      return {
        update(value) { patch = value; return this; },
        eq(key, value) { if (key === "teacher_id") owner = value; return this; },
        select() { return this; },
        async single() {
          if (owner && owner !== job.teacher_id) return { error: new Error("Not found") };
          if (patch) Object.assign(job, structuredClone(patch));
          return { data: structuredClone(job) };
        },
      };
    },
    storage: { from() { return {
      async list(folder, { offset, limit }) {
        if (folder === "students/s") return { data: objects.size ? [{ name: "nested", id: null }] : [] };
        return { data: [...objects].sort().slice(offset, offset + limit).map(path => ({ id: path, name: path.split('/').at(-1) })) };
      },
      async remove(paths) {
        assert.ok(paths.length <= 1000);
        calls.push(["storage", paths.length]);
        if (injectStorageFailure) { injectStorageFailure = false; return { error: new Error("Storage unavailable") }; }
        paths.forEach(path => objects.delete(path));
        return {};
      },
    }; } },
    auth: { admin: { async deleteUser(id) {
      calls.push(["auth", id]);
      if (injectAuthFailure) { injectAuthFailure = false; return { error: { code: "temporary_failure" } }; }
      return id === "student" ? { error: { code: "user_not_found", status: 404 } } : {};
    } } },
  };
  return { admin, job, objects, calls };
}

{
  const f = fixture({ count: 1105 });
  assert.deepEqual(await processManagementDeletion(f.admin, "job", "teacher"), { completed: true, pending: false });
  assert.equal(f.objects.size, 0);
  assert.deepEqual(f.calls, [["storage", 1000], ["storage", 105], ["auth", "student"], ["auth", "teacher"]]);
  assert.equal(f.job.state, "completed");
  await processManagementDeletion(f.admin, "job", "teacher");
  assert.equal(f.calls.length, 4, "completed retries do not delete twice");
}
for (const option of ["failStorage", "failAuth"]) {
  const f = fixture({ [option]: true });
  await assert.rejects(() => processManagementDeletion(f.admin, "job", "teacher"));
  assert.equal(f.job.state, "queued");
  assert.ok(f.job.remaining_users.length);
  if (option === "failStorage") assert.ok(f.calls.every(([kind]) => kind !== "auth"));
  assert.equal((await processManagementDeletion(f.admin, "job", "teacher")).completed, true);
}
{
  const f = fixture();
  assert.equal((await processManagementDeletion(f.admin, "job", "teacher", 0)).pending, true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.job.state, "queued");
  await assert.rejects(() => processManagementDeletion(f.admin, "job", "intruder"));
  assert.equal(f.calls.length, 0);
}

const teacherId = "11000000-0000-4000-8000-000000000001";
const classId = "33000000-0000-4000-8000-000000000001";
async function requestFixture({ authenticated = true, role = "teacher", owned = true, correctPassword = true, workerFails = false, body = {} } = {}) {
  let handler;
  let began = false;
  let verified = false;
  let processed = false;
  const admin = {
    from(table) { return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: table === "profiles" ? { role } : owned ? { class_code: "CLASS1" } : null }; } }; },
    async rpc(_name, args) { began = args; return { data: "job" }; },
  };
  const context = vm.createContext({
    Deno: { serve(fn) { handler = fn; } }, console: { error() {} },
    handleOptions: () => null, jsonResponse: (body, status = 200) => ({ body, status }),
    getAdminClient: () => admin,
    getUserClient: () => ({ auth: { async getUser() { return { data: { user: authenticated ? { id: teacherId, email: "teacher@example.invalid" } : null } }; } } }),
    getPasswordVerificationClient: () => ({ auth: {
      async signInWithPassword() { verified = true; return { data: { user: { id: correctPassword ? teacherId : "wrong" }, session: {} } }; },
      async signOut() { return {}; },
    } }),
    async processManagementDeletion() { processed = true; if (workerFails) throw new Error("Storage unavailable"); return { completed: true, pending: false }; },
  });
  const code = stripTypeScriptTypes(source("delete-management-target/index.ts").replace(/^import .*;\r?\n/gm, ""));
  vm.runInContext(code, context);
  const response = await handler({ method: "POST", async json() { return {
    kind: "class", classId, teacherPassword: "password", confirmation: "CLASS1", ...body,
  }; } });
  return { ...response, began, verified, processed };
}
for (const input of [{ authenticated: false }, { role: "student" }, { owned: false },
  { correctPassword: false }, { body: { confirmation: "wrong" } }, { body: { classId: "invalid" } }]) {
  const result = await requestFixture(input);
  assert.ok(result.status >= 400);
  assert.equal(result.began, false);
  assert.equal(result.processed, false);
}
{
  const result = await requestFixture({ body: { kind: "teacher", teacherId: "foreign", confirmation: "アカウント削除" } });
  assert.equal(result.status, 200);
  assert.equal(result.began.p_teacher_id, teacherId);
  assert.equal(result.began.p_target_id, teacherId, "account target must come from the verified JWT");
}
{
  const result = await requestFixture({ workerFails: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.pending, true);
  assert.equal(result.body.completed, false);
}
console.log("Management deletion: authorization, confirmation, Storage pagination/order, reference preservation, retry and lease checks passed (mocked APIs).");

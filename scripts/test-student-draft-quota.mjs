import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const studentSource = readFileSync("public/js/student.js", "utf8");
const utilsSource = readFileSync("public/js/student-draft-utils.mjs", "utf8")
  .replaceAll("export function", "function");
const draftStart = studentSource.indexOf("const STUDENT_DRAFT_MARKER_KEY");
const draftEnd = studentSource.indexOf("// ========= 左パネル折りたたみ", draftStart);
assert(draftStart >= 0 && draftEnd > draftStart, "student draft source range is missing");

const MARKER_KEY = "classWhiteboard.studentDraftMarker.v1";
const PAYLOAD_PREFIX = "classWhiteboard.studentDraft.v1:";
const DRAFT_KEY = "CLASS-A:student-a";

class FakeStorage {
  constructor({ quotaOnPayload = false } = {}) {
    this.values = new Map();
    this.quotaOnPayload = quotaOnPayload;
    this.setCalls = [];
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.setCalls.push(key);
    if (this.quotaOnPayload && key.startsWith(PAYLOAD_PREFIX)) {
      throw new DOMException("quota", "QuotaExceededError");
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class FakeDatabase {
  constructor(indexedDB) {
    this.indexedDB = indexedDB;
    this.objectStoreNames = { contains: () => true };
  }

  createObjectStore() {
    return {};
  }

  transaction(_storeName, mode) {
    const transaction = {
      error: null,
      objectStore: () => ({
        put: (value, key) => {
          if (mode !== "readwrite") throw new Error("write transaction required");
          if (this.indexedDB.failWrites) {
            transaction.error = new Error("IndexedDB write failed");
          } else {
            this.indexedDB.values.set(key, structuredClone(value));
          }
          queueMicrotask(() => {
            if (transaction.error) transaction.onerror?.();
            else transaction.oncomplete?.();
          });
        },
        get: (key) => {
          const request = { result: undefined, error: null };
          queueMicrotask(() => {
            request.result = this.indexedDB.values.get(key) || null;
            request.onsuccess?.();
          });
          return request;
        },
        delete: (key) => {
          if (mode !== "readwrite") throw new Error("write transaction required");
          if (this.indexedDB.failWrites) {
            transaction.error = new Error("IndexedDB delete failed");
          } else {
            this.indexedDB.values.delete(key);
          }
          queueMicrotask(() => {
            if (transaction.error) transaction.onerror?.();
            else transaction.oncomplete?.();
          });
        },
      }),
    };
    return transaction;
  }

  close() {}
}

class FakeIndexedDB {
  constructor({ failOpen = false, failWrites = false } = {}) {
    this.failOpen = failOpen;
    this.failWrites = failWrites;
    this.values = new Map();
    this.opened = false;
  }

  open() {
    const request = { result: null, error: null };
    queueMicrotask(() => {
      if (this.failOpen) {
        request.error = new Error("IndexedDB open failed");
        request.onerror?.();
        return;
      }
      request.result = new FakeDatabase(this);
      if (!this.opened) {
        this.opened = true;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    });
    return request;
  }
}

function createHarness({ storage = new FakeStorage(), indexedDB = new FakeIndexedDB() } = {}) {
  const board = {
    isBoardDirty: true,
    restored: null,
    exportBoardData: () => ({ objects: [{ id: "from-board" }] }),
    restoreBoardDraft(data) {
      this.restored = data;
    },
  };
  const context = vm.createContext({
    console: { ...console, warn() {} },
    DOMException,
    structuredClone,
    queueMicrotask,
    window: { sessionStorage: storage, indexedDB },
    statusLabel: null,
    supabaseEnabled: false,
    boardApi: {},
  });
  const harnessSource = `
    let currentClassCode = "CLASS-A";
    let nickname = "student-a";
    let whiteboard = globalThis.__board;
    let currentBoardFileId = null;
    let currentBoardFileName = "";
    let lastUsedFolderPath = "";
    ${utilsSource}
    ${studentSource.slice(draftStart, draftEnd)}
    globalThis.__draftApi = { persistStudentDraftNow, clearStudentDraft, restoreStudentDraft };
    globalThis.__setDraftState = (state) => {
      currentClassCode = state.classCode;
      nickname = state.studentId;
      whiteboard = state.board;
    };
  `;
  context.__board = board;
  vm.runInContext(harnessSource, context);
  return { api: context.__draftApi, board, storage, indexedDB, context };
}

function draft(savedAt, objects) {
  return {
    version: 1,
    draftKey: DRAFT_KEY,
    classCode: "CLASS-A",
    studentId: "student-a",
    savedAt,
    boardData: { objects },
  };
}

{
  const harness = createHarness();
  const saved = await harness.api.persistStudentDraftNow();
  assert.equal(saved, true, "normal persistence succeeds");
  assert.deepEqual(harness.storage.setCalls.slice(0, 2), [MARKER_KEY, `${PAYLOAD_PREFIX}${DRAFT_KEY}`]);
  assert.equal(harness.storage.getItem(MARKER_KEY), DRAFT_KEY);
  assert.ok(harness.storage.getItem(`${PAYLOAD_PREFIX}${DRAFT_KEY}`));
}

{
  const storage = new FakeStorage({ quotaOnPayload: true });
  const indexedDB = new FakeIndexedDB();
  const harness = createHarness({ storage, indexedDB });
  const saved = await harness.api.persistStudentDraftNow();
  assert.equal(saved, true, "IndexedDB succeeds when the session payload exceeds quota");
  assert.equal(storage.getItem(MARKER_KEY), DRAFT_KEY, "the small marker survives quota failure");
  assert.equal(storage.getItem(`${PAYLOAD_PREFIX}${DRAFT_KEY}`), null);
  const restored = await harness.api.restoreStudentDraft("CLASS-A", "student-a");
  assert.equal(restored, true, "the IndexedDB draft restores without a session payload");
  assert.deepEqual(harness.board.restored, { objects: [{ id: "from-board" }] });
}

{
  const harness = createHarness();
  await harness.api.persistStudentDraftNow();
  await harness.api.clearStudentDraft(DRAFT_KEY);
  assert.equal(harness.storage.getItem(MARKER_KEY), null);
  assert.equal(harness.storage.getItem(`${PAYLOAD_PREFIX}${DRAFT_KEY}`), null);
  assert.equal(harness.indexedDB.values.has(DRAFT_KEY), false);
  assert.equal(await harness.api.restoreStudentDraft("CLASS-A", "student-a"), false);
}

{
  const storage = new FakeStorage();
  const indexedDB = new FakeIndexedDB();
  const harness = createHarness({ storage, indexedDB });
  storage.setItem(MARKER_KEY, DRAFT_KEY);
  storage.setItem(`${PAYLOAD_PREFIX}${DRAFT_KEY}`, JSON.stringify(draft("2026-09-15T01:00:00.000Z", [{ id: "old-session" }])));
  indexedDB.values.set(DRAFT_KEY, draft("2026-09-15T01:05:00.000Z", [{ id: "new-idb" }]));
  assert.equal(await harness.api.restoreStudentDraft("CLASS-A", "student-a"), true);
  assert.deepEqual(harness.board.restored, { objects: [{ id: "new-idb" }] }, "newer IndexedDB wins over stale session data");
}

{
  const storage = new FakeStorage();
  const indexedDB = new FakeIndexedDB();
  const harness = createHarness({ storage, indexedDB });
  storage.setItem(MARKER_KEY, "CLASS-B:student-b");
  indexedDB.values.set(DRAFT_KEY, draft("2026-09-15T01:05:00.000Z", [{ id: "other-account" }]));
  assert.equal(await harness.api.restoreStudentDraft("CLASS-A", "student-a"), false, "a different tab/account marker cannot restore this draft");
  assert.equal(harness.board.restored, null);
}

{
  const indexedDB = new FakeIndexedDB({ failWrites: true });
  const harness = createHarness({ indexedDB });
  const saved = await harness.api.persistStudentDraftNow();
  assert.equal(saved, true, "sessionStorage remains a fallback when IndexedDB fails");
  assert.equal(await harness.api.restoreStudentDraft("CLASS-A", "student-a"), true);
}

console.log("Student draft quota persistence tests passed.");

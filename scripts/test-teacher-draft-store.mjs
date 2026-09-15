import assert from "node:assert/strict";
import {
  chooseNewestTeacherDraft,
  createTeacherDraftKey,
  createTeacherDraftStore,
  isUsableTeacherDraft,
} from "../public/js/teacher-draft-store.mjs";

class MemorySessionStorage {
  constructor(options = {}) {
    this.values = new Map();
    this.failPayloadWrites = options.failPayloadWrites === true;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failPayloadWrites && key.startsWith("classWhiteboard.teacherDraft.v1:")) {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function createMemoryIndexedDB(options = {}) {
  const databases = new Map();
  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        if (options.failOpen) {
          request.error = new Error("IndexedDB unavailable");
          request.onerror?.();
          return;
        }
        let record = databases.get(name);
        const isNew = !record;
        if (!record) {
          record = { stores: new Map() };
          databases.set(name, record);
        }
        const database = {
          objectStoreNames: {
            contains(storeName) {
              return record.stores.has(storeName);
            },
          },
          createObjectStore(storeName) {
            record.stores.set(storeName, new Map());
          },
          transaction(storeName, mode) {
            const transaction = {};
            const store = record.stores.get(storeName);
            transaction.objectStore = () => ({
              put(value, key) {
                assert.equal(mode, "readwrite");
                store.set(key, structuredClone(value));
                queueMicrotask(() => transaction.oncomplete?.());
              },
              get(key) {
                const getRequest = {};
                queueMicrotask(() => {
                  getRequest.result = store.has(key) ? structuredClone(store.get(key)) : undefined;
                  getRequest.onsuccess?.();
                });
                return getRequest;
              },
              delete(key) {
                assert.equal(mode, "readwrite");
                store.delete(key);
                queueMicrotask(() => transaction.oncomplete?.());
              },
            });
            return transaction;
          },
          close() {},
        };
        request.result = database;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function makeDraft(overrides = {}) {
  const identity = {
    teacherId: overrides.teacherId || "teacher-a",
    classCode: overrides.classCode || "class-a",
    ownerKind: overrides.ownerKind || "teacher",
    ownerStudentId: overrides.ownerStudentId || "",
  };
  return {
    version: 1,
    ...identity,
    draftKey: createTeacherDraftKey(identity),
    savedAt: overrides.savedAt || "2026-09-15T01:00:00.000Z",
    boardData: overrides.boardData || { objects: [{ id: "draft" }] },
    currentBoardFileId: overrides.currentBoardFileId || null,
    currentBoardFileName: overrides.currentBoardFileName || "",
    lastUsedFolderPath: overrides.lastUsedFolderPath || "",
  };
}

const teacherDraft = makeDraft();
assert.equal(chooseNewestTeacherDraft([null, undefined], {teacherId:'teacher-a', classCode:'CLASS-A'}), null);
const studentDraft = makeDraft({
  ownerKind: "student",
  ownerStudentId: "Student-1",
  savedAt: "2026-09-15T01:05:00.000Z",
});
assert.notEqual(teacherDraft.draftKey, studentDraft.draftKey, "owner scope is part of the draft key");
assert.equal(
  isUsableTeacherDraft(studentDraft, { teacherId: "teacher-a", classCode: "CLASS-A", ownerKind: "student" }),
  false,
  "an explicit student scope requires the student identifier"
);
assert.equal(
  chooseNewestTeacherDraft([teacherDraft, studentDraft], { teacherId: "teacher-a", classCode: "CLASS-A" }),
  studentDraft,
  "startup may restore the last tab-scoped owner after teacher and class verification"
);
assert.equal(
  chooseNewestTeacherDraft([teacherDraft], { teacherId: "teacher-b", classCode: "CLASS-A" }),
  null,
  "a different authenticated teacher cannot restore the draft"
);

const warnings = [];
const quotaStorage = new MemorySessionStorage({ failPayloadWrites: true });
const indexedDB = createMemoryIndexedDB();
const quotaStore = createTeacherDraftStore({
  sessionStorage: quotaStorage,
  indexedDB,
  logger: { warn: (...args) => warnings.push(args) },
});
assert.equal(await quotaStore.persist(studentDraft), true, "IndexedDB preserves a draft after payload quota failure");
assert.equal(
  quotaStorage.getItem("classWhiteboard.teacherDraftMarker.v1"),
  studentDraft.draftKey,
  "the tab marker is written before the payload that may exceed quota"
);
assert.equal(
  await quotaStore.load({ teacherId: "teacher-a", classCode: "class-a" }).then((draft) => draft?.draftKey),
  studentDraft.draftKey,
  "the marker selects the IndexedDB copy after reload"
);
assert.ok(warnings.length >= 1, "the storage fallback is observable");

const transitionStorage = new MemorySessionStorage();
const transitionStore = createTeacherDraftStore({
  sessionStorage: transitionStorage,
  indexedDB: createMemoryIndexedDB(),
  logger: { warn() {} },
});
const classADraft = makeDraft({ classCode: "A", boardData: { objects: [{ id: "a" }] } });
const classBDraft = makeDraft({ classCode: "B", boardData: { objects: [{ id: "b" }] } });
const writeA = transitionStore.persist(classADraft);
const clearA = transitionStore.clear(classADraft);
const writeB = transitionStore.persist(classBDraft);
await Promise.all([writeA, clearA, writeB]);
assert.equal(await transitionStore.load({ teacherId: "teacher-a", classCode: "A" }), null);
assert.equal(
  (await transitionStore.load({ teacherId: "teacher-a", classCode: "B" }))?.boardData.objects[0].id,
  "b",
  "serialized IndexedDB transitions do not resurrect the cleared class draft"
);

const sessionOnlyStorage = new MemorySessionStorage();
const sessionOnlyStore = createTeacherDraftStore({
  sessionStorage: sessionOnlyStorage,
  indexedDB: createMemoryIndexedDB({ failOpen: true }),
  logger: { warn() {} },
});
assert.equal(await sessionOnlyStore.persist(teacherDraft), true, "session storage remains usable when IndexedDB fails");
assert.equal(
  (await sessionOnlyStore.load({ teacherId: "teacher-a", classCode: "class-a" }))?.draftKey,
  teacherDraft.draftKey
);

const inaccessibleSessionStore = createTeacherDraftStore({
  getSessionStorage() {
    throw new DOMException("Blocked", "SecurityError");
  },
  indexedDB: createMemoryIndexedDB(),
  logger: { warn() {} },
});
assert.equal(await inaccessibleSessionStore.persist(teacherDraft), true);
assert.equal(
  await inaccessibleSessionStore.load({ teacherId: "teacher-a", classCode: "class-a" }),
  null,
  "IndexedDB data is not restored without the tab-scoped session marker"
);
assert.equal(await inaccessibleSessionStore.clear(teacherDraft), true, "cleanup continues when session storage is blocked");

const blockedDatabaseStore = createTeacherDraftStore({
  sessionStorage: new MemorySessionStorage(),
  getIndexedDB() { throw new DOMException('Blocked', 'SecurityError'); },
  logger: {warn() {}},
});
assert.equal(await blockedDatabaseStore.persist(teacherDraft), true);
assert.equal((await blockedDatabaseStore.load({teacherId:'teacher-a', classCode:'CLASS-A'}))?.draftKey, teacherDraft.draftKey);

console.log("Teacher draft store tests passed.");

const DEFAULT_MARKER_KEY = "classWhiteboard.teacherDraftMarker.v1";
const DEFAULT_PAYLOAD_PREFIX = "classWhiteboard.teacherDraft.v1:";
const DEFAULT_DATABASE_NAME = "class-whiteboard-teacher-drafts";
const DEFAULT_STORE_NAME = "drafts";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeClassCode(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeOwnerKind(value) {
  return value === "student" ? "student" : "teacher";
}

export function normalizeTeacherDraftIdentity(value = {}) {
  if (!value || typeof value !== "object") return null;
  const teacherId = normalizeText(value.teacherId).toLowerCase();
  const classCode = normalizeClassCode(value.classCode);
  const ownerKind = normalizeOwnerKind(value.ownerKind);
  const ownerStudentId = ownerKind === "student"
    ? normalizeText(value.ownerStudentId).toLowerCase()
    : "";
  if (!teacherId || !classCode || (ownerKind === "student" && !ownerStudentId)) {
    return null;
  }
  return { teacherId, classCode, ownerKind, ownerStudentId };
}

export function createTeacherDraftKey(identity) {
  const normalized = normalizeTeacherDraftIdentity(identity);
  if (!normalized) return "";
  return [
    normalized.teacherId,
    normalized.classCode,
    normalized.ownerKind,
    normalized.ownerStudentId || "_",
  ].map(encodeURIComponent).join(":");
}

function draftTimestamp(draft) {
  const timestamp = Date.parse(draft?.savedAt || "");
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
}

function matchesContext(identity, context = {}) {
  const teacherId = normalizeText(context.teacherId).toLowerCase();
  const classCode = normalizeClassCode(context.classCode);
  if (!teacherId || !classCode) return false;
  if (identity.teacherId !== teacherId || identity.classCode !== classCode) return false;
  if (context.ownerKind) {
    const expectedOwnerKind = normalizeOwnerKind(context.ownerKind);
    if (identity.ownerKind !== expectedOwnerKind) return false;
    if (expectedOwnerKind === "student" && !normalizeText(context.ownerStudentId)) return false;
  }
  if (normalizeText(context.ownerStudentId)) {
    return identity.ownerStudentId === normalizeText(context.ownerStudentId).toLowerCase();
  }
  return true;
}

export function isUsableTeacherDraft(draft, context) {
  const identity = normalizeTeacherDraftIdentity(draft);
  return Boolean(
    identity
    && draft?.draftKey === createTeacherDraftKey(identity)
    && matchesContext(identity, context)
    && draft.boardData
    && typeof draft.boardData === "object"
  );
}

export function chooseNewestTeacherDraft(candidates, context) {
  return candidates
    .filter((draft) => isUsableTeacherDraft(draft, context))
    .sort((left, right) => draftTimestamp(right) - draftTimestamp(left))[0] || null;
}

function openDatabase(indexedDB, databaseName, storeName) {
  if (!indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Draft database could not be opened."));
  });
}

async function writeDatabaseDraft(indexedDB, databaseName, storeName, draft) {
  const database = await openDatabase(indexedDB, databaseName, storeName);
  if (!database) return false;
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(draft, draft.draftKey);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Draft could not be saved."));
      transaction.onabort = () => reject(transaction.error || new Error("Draft save was aborted."));
    });
    return true;
  } finally {
    database.close();
  }
}

async function readDatabaseDraft(indexedDB, databaseName, storeName, draftKey) {
  const database = await openDatabase(indexedDB, databaseName, storeName);
  if (!database) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(draftKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Draft could not be read."));
    });
  } finally {
    database.close();
  }
}

async function deleteDatabaseDraft(indexedDB, databaseName, storeName, draftKey) {
  const database = await openDatabase(indexedDB, databaseName, storeName);
  if (!database) return;
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(draftKey);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Draft could not be cleared."));
      transaction.onabort = () => reject(transaction.error || new Error("Draft clear was aborted."));
    });
  } finally {
    database.close();
  }
}

export function createTeacherDraftStore(options = {}) {
  const getSessionStorage = options.getSessionStorage || (() => options.sessionStorage || null);
  const getIndexedDB = options.getIndexedDB || (() => options.indexedDB || null);
  const logger = options.logger || console;
  const markerKey = options.markerKey || DEFAULT_MARKER_KEY;
  const payloadPrefix = options.payloadPrefix || DEFAULT_PAYLOAD_PREFIX;
  const databaseName = options.databaseName || DEFAULT_DATABASE_NAME;
  const storeName = options.storeName || DEFAULT_STORE_NAME;
  let databaseOperations = Promise.resolve();

  function sessionStorageOrNull() {
    try {
      return getSessionStorage();
    } catch (error) {
      logger.warn("Session storage is unavailable; teacher board recovery is limited.", error);
      return null;
    }
  }

  function indexedDBOrNull() {
    try {
      return getIndexedDB();
    } catch (error) {
      logger.warn("IndexedDB is unavailable; teacher board recovery is limited.", error);
      return null;
    }
  }

  function enqueueDatabaseOperation(operation) {
    const result = databaseOperations.then(operation, operation);
    databaseOperations = result.catch(() => undefined);
    return result;
  }

  return {
    persist(draft) {
      const identity = normalizeTeacherDraftIdentity(draft);
      if (!identity || !isUsableTeacherDraft(draft, identity)) return Promise.resolve(false);

      const storage = sessionStorageOrNull();
      let sessionDraftSaved = false;
      if (storage) {
        try {
          // Write the small marker first. If the payload exceeds quota, reload
          // can still use the marker to select the IndexedDB copy safely.
          storage.setItem(markerKey, draft.draftKey);
          storage.setItem(`${payloadPrefix}${draft.draftKey}`, JSON.stringify(draft));
          sessionDraftSaved = true;
        } catch (error) {
          logger.warn("Teacher board draft exceeded session storage; using IndexedDB.", error);
        }
      }

      return enqueueDatabaseOperation(() => writeDatabaseDraft(
        indexedDBOrNull(),
        databaseName,
        storeName,
        draft
      )).then(
        (databaseDraftSaved) => databaseDraftSaved || sessionDraftSaved,
        (error) => {
          logger.warn("Failed to persist the teacher board draft in IndexedDB.", error);
          return sessionDraftSaved;
        }
      );
    },

    async load(context) {
      const storage = sessionStorageOrNull();
      let draftKey = "";
      let sessionDraft = null;
      try {
        draftKey = storage?.getItem(markerKey) || "";
        const rawDraft = draftKey ? storage?.getItem(`${payloadPrefix}${draftKey}`) : null;
        if (rawDraft) sessionDraft = JSON.parse(rawDraft);
      } catch (error) {
        logger.warn("Stored teacher board draft could not be read from session storage.", error);
      }
      if (!draftKey) return null;

      let databaseDraft = null;
      try {
        await databaseOperations;
        databaseDraft = await readDatabaseDraft(indexedDBOrNull(), databaseName, storeName, draftKey);
      } catch (error) {
        logger.warn("Stored teacher board draft could not be read from IndexedDB.", error);
      }
      return chooseNewestTeacherDraft([databaseDraft, sessionDraft], context);
    },

    clear(identity) {
      const draftKey = createTeacherDraftKey(identity);
      if (!draftKey) return Promise.resolve(false);

      const storage = sessionStorageOrNull();
      try {
        if (storage?.getItem(markerKey) === draftKey) storage.removeItem(markerKey);
        storage?.removeItem(`${payloadPrefix}${draftKey}`);
      } catch (error) {
        logger.warn("Failed to clear the teacher board draft from session storage.", error);
      }

      return enqueueDatabaseOperation(() => deleteDatabaseDraft(
        indexedDBOrNull(),
        databaseName,
        storeName,
        draftKey
      )).then(
        () => true,
        (error) => {
          logger.warn("Failed to clear the stored teacher board draft.", error);
          return false;
        }
      );
    },
  };
}

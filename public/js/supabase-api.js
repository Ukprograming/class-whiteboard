import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.CLASS_WHITEBOARD_CONFIG || {};
const SUPABASE_URL = (config.supabaseUrl || "").trim();
const SUPABASE_ANON_KEY = (config.supabaseAnonKey || "").trim();
const STORAGE_BUCKET = (config.storageBucket || "class-whiteboard").trim();
const EDGE_FUNCTION_BASE_URL = (
  config.edgeFunctionBaseUrl ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "")
).replace(/\/$/, "");

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null;

function assertSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }
}

function normalizeClassCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStudentLoginId(value) {
  return String(value || "").trim().toLowerCase();
}

function studentAuthEmail(classCode, studentLoginId) {
  const safeClassCode = normalizeClassCode(classCode)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  const safeStudentId = normalizeStudentLoginId(studentLoginId)
    .replace(/[^a-z0-9]+/g, "-");
  return `cw.${safeClassCode}.${safeStudentId}@students.class-whiteboard.local`;
}

export function createRealtimeBridge() {
  if (typeof window.io === "function") {
    return window.io();
  }

  const handlers = new Map();
  return {
    emit(eventName, payload) {
      console.info("[realtime disabled]", eventName, payload || "");
    },
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    off(eventName) {
      handlers.delete(eventName);
    },
    disconnect() {
      handlers.clear();
    },
  };
}

async function getSessionOrThrow() {
  assertSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error(error?.message || "Login is required.");
  }
  return data.session;
}

export const authApi = {
  async signInTeacher(email, password) {
    assertSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signUpTeacher({ email, password, displayName, inviteCode }) {
    const result = await callFunction("teacher-signup", {
      email,
      password,
      displayName,
      inviteCode,
    }, { requireAuth: false });
    return result;
  },

  async signInStudent({ classCode, studentLoginId, password }) {
    assertSupabase();
    const email = studentAuthEmail(classCode, studentLoginId);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    saveStudentLoginHint({
      classCode: normalizeClassCode(classCode),
      studentLoginId: normalizeStudentLoginId(studentLoginId),
    });

    return {
      ...data,
      classCode: normalizeClassCode(classCode),
      studentLoginId: normalizeStudentLoginId(studentLoginId),
    };
  },

  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  },

  async getProfile() {
    assertSupabase();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};

async function callFunction(name, body, options = {}) {
  assertSupabase();
  if (!EDGE_FUNCTION_BASE_URL) {
    throw new Error("Edge Function base URL is not configured.");
  }

  const headers = { "Content-Type": "application/json" };
  if (options.requireAuth !== false) {
    const session = await getSessionOrThrow();
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${EDGE_FUNCTION_BASE_URL}/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || `Function ${name} failed.`);
  }
  return json;
}

export const managementApi = {
  createClass(payload) {
    return callFunction("create-class", payload);
  },
  createStudent(payload) {
    return callFunction("create-student", payload);
  },
  resetStudentPassword(payload) {
    return callFunction("reset-student-password", payload);
  },
  copyBoardToClass(payload) {
    return callFunction("copy-board-to-class", payload);
  },
};

async function getClassByCode(classCode) {
  assertSupabase();
  const { data, error } = await supabase
    .from("classes")
    .select("id, class_code, name, teacher_id")
    .eq("class_code", normalizeClassCode(classCode))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Class not found.");
  return data;
}

async function getCurrentUserId() {
  assertSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error(error?.message || "Login is required.");
  return data.user.id;
}

async function resolveOwner(payload) {
  const role = payload.role === "student" ? "student" : "teacher";
  const klass = await getClassByCode(payload.classCode);

  if (role === "teacher") {
    const userId = await getCurrentUserId();
    return {
      ownerKind: "teacher",
      teacherId: userId,
      studentId: null,
      classId: klass.id,
    };
  }

  let query = supabase
    .from("students")
    .select("id, auth_user_id, student_login_id, display_name")
    .eq("class_id", klass.id)
    .eq("active", true);

  if (payload.nickname) {
    const target = String(payload.nickname).trim();
    query = query.or(`student_login_id.eq.${target},display_name.eq.${target}`);
  } else {
    const userId = await getCurrentUserId();
    query = query.eq("auth_user_id", userId);
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Student account not found.");

  return {
    ownerKind: "student",
    teacherId: null,
    studentId: data.id,
    classId: klass.id,
  };
}

function normalizeFolderPath(value) {
  return String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function uniqueFolderRows(files) {
  const paths = new Map();
  for (const file of files || []) {
    const folderPath = normalizeFolderPath(file.folder_path);
    if (!folderPath) continue;
    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      paths.set(current, { path: current, name: part });
    }
  }
  return Array.from(paths.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function applyOwnerFilter(query, owner) {
  if (owner.ownerKind === "teacher") {
    return query.eq("owner_kind", "teacher").eq("teacher_id", owner.teacherId);
  }
  return query.eq("owner_kind", "student").eq("student_id", owner.studentId);
}

export const boardApi = {
  enabled: supabaseEnabled,

  async listFolders(payload) {
    assertSupabase();
    const owner = await resolveOwner(payload);
    let query = supabase
      .from("board_files")
      .select("folder_path")
      .eq("class_id", owner.classId);

    query = applyOwnerFilter(query, owner);

    const { data, error } = await query;
    if (error) throw error;
    return { ok: true, folders: uniqueFolderRows(data) };
  },

  async listBoards(payload) {
    assertSupabase();
    const owner = await resolveOwner(payload);
    let query = supabase
      .from("board_files")
      .select("id, name, folder_path, updated_at")
      .eq("class_id", owner.classId)
      .eq("folder_path", normalizeFolderPath(payload.folderPath))
      .order("updated_at", { ascending: false });

    query = applyOwnerFilter(query, owner);

    const { data, error } = await query;
    if (error) throw error;

    return {
      ok: true,
      files: (data || []).map((file) => ({
        fileId: file.id,
        fileName: file.name,
        folderPath: file.folder_path,
        lastUpdated: file.updated_at,
      })),
    };
  },

  async saveBoard(payload) {
    assertSupabase();
    const owner = await resolveOwner(payload);
    const fileId = payload.fileId || crypto.randomUUID();
    const folderPath = normalizeFolderPath(payload.folderPath);
    const fileName = String(payload.fileName || "").trim();
    const boardJson = JSON.stringify(payload.boardData || {});
    const blob = new Blob([boardJson], { type: "application/json" });
    const snapshotPath = owner.ownerKind === "teacher"
      ? `teachers/${owner.teacherId}/${fileId}.json`
      : `students/${owner.studentId}/${fileId}.json`;

    const upload = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(snapshotPath, blob, {
        contentType: "application/json",
        upsert: true,
      });

    if (upload.error) throw upload.error;

    const row = {
      id: fileId,
      owner_kind: owner.ownerKind,
      teacher_id: owner.teacherId,
      student_id: owner.studentId,
      class_id: owner.classId,
      folder_path: folderPath,
      name: fileName,
      snapshot_path: snapshotPath,
      size_bytes: blob.size,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("board_files")
      .upsert(row)
      .select("id, name")
      .single();

    if (error) throw error;

    return {
      ok: true,
      mode: payload.fileId ? "update" : "create",
      fileId: data.id,
      fileName: data.name,
      message: payload.fileId ? "Saved changes." : "Saved board.",
    };
  },

  async loadBoard(payload) {
    assertSupabase();
    const owner = await resolveOwner(payload);
    let query = supabase
      .from("board_files")
      .select("id, name, snapshot_path")
      .eq("id", payload.fileId)
      .limit(1);

    query = applyOwnerFilter(query, owner);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data || !data.snapshot_path) throw new Error("Board file not found.");

    const download = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(data.snapshot_path);
    if (download.error) throw download.error;

    const boardData = JSON.parse(await download.data.text());
    return {
      ok: true,
      fileId: data.id,
      fileName: data.name,
      boardData,
    };
  },
};

const STUDENT_HINTS_KEY = "classWhiteboard.studentLoginHints.v1";

export function getStudentLoginHints() {
  try {
    const raw = localStorage.getItem(STUDENT_HINTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStudentLoginHint(hint) {
  const classCode = normalizeClassCode(hint.classCode);
  const studentLoginId = normalizeStudentLoginId(hint.studentLoginId);
  if (!classCode || !studentLoginId) return;

  const current = getStudentLoginHints().filter(
    (item) => !(item.classCode === classCode && item.studentLoginId === studentLoginId)
  );
  current.unshift({
    classCode,
    studentLoginId,
    label: `${classCode} / ${studentLoginId}`,
    savedAt: new Date().toISOString(),
  });
  localStorage.setItem(STUDENT_HINTS_KEY, JSON.stringify(current.slice(0, 20)));
}

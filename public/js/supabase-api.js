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
  if (supabaseEnabled) {
    return createSupabaseRealtimeBridge();
  }

  if (typeof window.io === "function") {
    return window.io();
  }

  const handlers = new Map();
  return {
    emit(eventName, payload) {
      console.info("[realtime disabled]", eventName, payload || "");
    },
    on(eventName, handler) {
      if (!handlers.has(eventName)) handlers.set(eventName, new Set());
      handlers.get(eventName).add(handler);
    },
    off(eventName, handler) {
      if (!handler) {
        handlers.delete(eventName);
        return;
      }
      handlers.get(eventName)?.delete(handler);
    },
    disconnect() {
      handlers.clear();
    },
  };
}

function createSupabaseRealtimeBridge() {
  assertSupabase();

  const handlers = new Map();
  const socketId = createSocketId();
  const privateChannels = config.realtimePrivateChannels !== false;
  const notebookStudentsSeen = new Set();

  const state = {
    role: "",
    classCode: "",
    nickname: "",
    channel: null,
    ready: null,
    mode: "whiteboard",
    online: false,
  };

  function on(eventName, handler) {
    if (!handlers.has(eventName)) handlers.set(eventName, new Set());
    handlers.get(eventName).add(handler);
  }

  function off(eventName, handler) {
    if (!handler) {
      handlers.delete(eventName);
      return;
    }
    handlers.get(eventName)?.delete(handler);
  }

  function dispatch(eventName, payload) {
    const listeners = handlers.get(eventName);
    if (!listeners) return;
    for (const handler of Array.from(listeners)) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[realtime] handler failed for ${eventName}`, err);
      }
    }
  }

  function emit(eventName, payload = {}) {
    switch (eventName) {
      case "join-class":
      case "join-student":
      case "joinAsStudent":
        void joinRealtime("student", payload);
        return;
      case "join-teacher":
      case "joinAsTeacher":
        void joinRealtime("teacher", payload);
        return;
      case "leave-class":
        void leaveRealtime();
        return;
      case "student-mode-change":
        state.mode = payload.mode || state.mode;
        void trackPresence();
        void sendRealtimeEvent(eventName, payload);
        return;
      default:
        void sendRealtimeEvent(eventName, payload);
    }
  }

  async function joinRealtime(role, payload = {}) {
    const classCode = normalizeClassCode(payload.classCode || state.classCode);
    if (!classCode) {
      dispatch("join-error", "Class code is required.");
      return;
    }

    const nickname = String(
      payload.nickname ||
      payload.studentId ||
      state.nickname ||
      (role === "teacher" ? "teacher" : "")
    ).trim();

    if (
      state.channel &&
      state.role === role &&
      state.classCode === classCode &&
      state.nickname === nickname
    ) {
      return state.ready;
    }

    await leaveRealtime();

    state.role = role;
    state.classCode = classCode;
    state.nickname = nickname;
    state.online = false;

    const channel = supabase.channel(`class:${classCode}`, {
      config: {
        private: privateChannels,
        broadcast: { self: false, ack: false },
        presence: { key: socketId },
      },
    });
    state.channel = channel;

    channel
      .on("broadcast", { event: "socket-event" }, ({ payload: eventPayload }) => {
        handleRemoteEvent(eventPayload);
      })
      .on("presence", { event: "sync" }, () => {
        if (state.role === "teacher") {
          dispatch("student-list-update", getStudentPresenceList(channel.presenceState()));
        }
      })
      .on("presence", { event: "join" }, () => {
        if (state.role === "teacher") {
          dispatch("student-list-update", getStudentPresenceList(channel.presenceState()));
        }
      })
      .on("presence", { event: "leave" }, () => {
        if (state.role === "teacher") {
          dispatch("student-list-update", getStudentPresenceList(channel.presenceState()));
        }
      });

    state.ready = new Promise((resolve, reject) => {
      channel.subscribe(async (status, err) => {
        if (status === "SUBSCRIBED") {
          state.online = true;
          await trackPresence();
          if (role === "student") {
            dispatch("join-success", { classCode, nickname });
            dispatch("join-student", { classCode, nickname, socketId });
          } else {
            dispatch("student-list-update", getStudentPresenceList(channel.presenceState()));
            dispatch("teacher-class-started", { classCode });
          }
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          const message = err?.message || `Realtime channel ${status.toLowerCase()}.`;
          dispatch("join-error", message);
          reject(new Error(message));
        } else if (status === "CLOSED") {
          state.online = false;
        }
      });
    });

    return state.ready;
  }

  async function leaveRealtime() {
    if (!state.channel) return;
    const channel = state.channel;
    state.channel = null;
    state.ready = null;
    state.online = false;
    await supabase.removeChannel(channel);
  }

  async function trackPresence() {
    if (!state.channel || !state.online) return;
    await state.channel.track({
      socketId,
      role: state.role,
      classCode: state.classCode,
      nickname: state.nickname,
      studentId: state.role === "student" ? state.nickname : "",
      mode: state.mode || "whiteboard",
      onlineAt: new Date().toISOString(),
    });
  }

  async function sendRealtimeEvent(eventName, payload = {}) {
    if (!state.channel && payload.classCode) {
      await joinRealtime(state.role || inferRoleFromEvent(eventName), payload);
    }
    if (state.ready) {
      try {
        await state.ready;
      } catch {
        return;
      }
    }
    if (!state.channel) {
      console.warn("[realtime] event ignored before class join", eventName);
      return;
    }

    const enriched = {
      ...(payload || {}),
      classCode: normalizeClassCode(payload?.classCode || state.classCode),
    };

    await state.channel.send({
      type: "broadcast",
      event: "socket-event",
      payload: {
        eventName,
        payload: enriched,
        senderSocketId: socketId,
        senderRole: state.role,
        senderNickname: state.nickname,
        timestamp: Date.now(),
      },
    });
  }

  function handleRemoteEvent(message) {
    if (!message || message.senderSocketId === socketId) return;
    if (normalizeClassCode(message.payload?.classCode || state.classCode) !== state.classCode) return;

    const eventName = message.eventName;
    const payload = message.payload || {};
    if (state.role === "teacher") {
      handleTeacherInbound(eventName, payload, message);
    } else if (state.role === "student") {
      handleStudentInbound(eventName, payload, message);
    }
  }

  function handleTeacherInbound(eventName, payload, message) {
    switch (eventName) {
      case "student-chat-to-teacher":
        dispatch("chat-message", {
          fromRole: "student",
          fromSocketId: message.senderSocketId,
          fromNickname: payload.nickname || message.senderNickname || "student",
          toRole: "teacher",
          toSocketId: socketId,
          classCode: payload.classCode,
          message: payload.message || payload.text || "",
          templateKind: payload.templateKind || "",
          timestamp: message.timestamp || Date.now(),
        });
        break;
      case "student-thumbnail":
        dispatch("student-thumbnail", {
          socketId: message.senderSocketId,
          nickname: payload.nickname || message.senderNickname || "student",
          dataUrl: payload.dataUrl,
          mode: payload.mode,
          viewport: payload.viewport,
        });
        break;
      case "student-highres":
        dispatch("student-highres", {
          socketId: message.senderSocketId,
          nickname: payload.nickname || message.senderNickname || "student",
          dataUrl: payload.dataUrl,
        });
        break;
      case "student-board-state":
        if (payload.targetTeacherSocketId && payload.targetTeacherSocketId !== socketId) return;
        dispatch("student-board-state", {
          studentSocketId: message.senderSocketId,
          boardData: payload.boardData,
        });
        break;
      case "student-whiteboard-action":
        if (payload.targetTeacherSocketId && payload.targetTeacherSocketId !== socketId) return;
        dispatch("student-whiteboard-action", {
          studentSocketId: message.senderSocketId,
          action: payload.action,
        });
        break;
      case "student-screen-update":
        if (payload.teacherSocketId && payload.teacherSocketId !== socketId) return;
        dispatch("student-screen-update", {
          studentSocketId: message.senderSocketId,
          classCode: payload.classCode,
          dataUrl: payload.dataUrl,
          viewport: payload.viewport,
          mode: payload.mode,
          boardData: payload.boardData,
          isSync: payload.isSync,
        });
        break;
      case "studentImageUpdate": {
        const studentId = payload.studentId || message.senderNickname || message.senderSocketId;
        const seenKey = `${payload.classCode}:${studentId}`;
        if (!notebookStudentsSeen.has(seenKey)) {
          notebookStudentsSeen.add(seenKey);
          dispatch("studentJoined", { studentId, classCode: payload.classCode });
        }
        dispatch("studentImageUpdated", {
          studentId,
          imageData: payload.imageData,
          classCode: payload.classCode,
        });
        break;
      }
      case "shared-board-action":
      case "shared-board-snapshot":
        dispatch(eventName, {
          ...payload,
          socketId: message.senderSocketId,
          nickname: message.senderNickname,
        });
        break;
      default:
        dispatch(eventName, payload);
    }
  }

  function handleStudentInbound(eventName, payload, message) {
    switch (eventName) {
      case "teacher-chat-to-student":
        if (payload.targetSocketId && payload.targetSocketId !== socketId) return;
        dispatch("chat-message", {
          fromRole: "teacher",
          fromSocketId: message.senderSocketId,
          fromNickname: "先生",
          toRole: "student",
          toSocketId: socketId,
          classCode: payload.classCode,
          message: payload.message || "",
          timestamp: message.timestamp || Date.now(),
        });
        break;
      case "student-view-start":
      case "student-view-stop":
        dispatch(eventName, { classCode: payload.classCode });
        break;
      case "request-highres":
        if (payload.studentSocketId && payload.studentSocketId !== socketId) return;
        dispatch("request-highres", {});
        break;
      case "start-monitoring":
        if (payload.studentSocketId && payload.studentSocketId !== socketId) return;
        dispatch("start-monitoring", {
          classCode: payload.classCode,
          teacherSocketId: message.senderSocketId,
        });
        break;
      case "stop-monitoring":
        if (payload.studentSocketId && payload.studentSocketId !== socketId) return;
        dispatch("stop-monitoring", { classCode: payload.classCode });
        break;
      case "teacher-whiteboard-action": {
        const target = payload.targetSocketId || payload.targetStudentSocketId;
        if (target && target !== socketId) return;
        dispatch("teacher-whiteboard-action", { action: payload.action });
        break;
      }
      case "teacherShareToStudent":
        if (!isForCurrentStudent(payload)) return;
        dispatch("teacherSharedImage", { imageData: payload.imageData });
        break;
      case "teacherSetHighQuality":
        if (payload.studentId && payload.studentId !== state.nickname) return;
        dispatch("setHighQualityMode", { enabled: !!payload.enabled });
        break;
      case "shared-board-action":
      case "shared-board-snapshot":
        dispatch(eventName, {
          ...payload,
          socketId: message.senderSocketId,
          nickname: message.senderNickname,
        });
        break;
      default:
        dispatch(eventName, payload);
    }
  }

  function isForCurrentStudent(payload) {
    if (payload.studentSocketId && payload.studentSocketId !== socketId) return false;
    if (payload.targetSocketId && payload.targetSocketId !== socketId) return false;
    if (payload.studentId && payload.studentId !== state.nickname) return false;
    return true;
  }

  return {
    id: socketId,
    emit,
    on,
    off,
    disconnect() {
      handlers.clear();
      void leaveRealtime();
    },
  };
}

function createSocketId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `cw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function inferRoleFromEvent(eventName) {
  return eventName.startsWith("student") || eventName === "join-class"
    ? "student"
    : "teacher";
}

function getStudentPresenceList(presenceState) {
  return Object.values(presenceState || {})
    .flat()
    .filter((item) => item?.role === "student")
    .map((item) => ({
      socketId: item.socketId,
      nickname: item.nickname || item.studentId || item.socketId,
      mode: item.mode || "whiteboard",
    }))
    .filter((item) => item.socketId);
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

  async saveSharedBoardSnapshot(payload) {
    assertSupabase();
    const owner = await resolveOwner({
      ...payload,
      role: "teacher",
    });
    if (owner.ownerKind !== "teacher") {
      throw new Error("Teacher login is required.");
    }

    const sharedBoardId = payload.sharedBoardId || crypto.randomUUID();
    const title = String(payload.title || "Shared board").trim();
    const active = payload.active !== false;
    const sourceBoardId = payload.sourceBoardId || null;
    const snapshotPath = `shared/${sharedBoardId}/snapshot.json`;

    if (!payload.sharedBoardId) {
      const deactivate = await supabase
        .from("shared_boards")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("class_id", owner.classId)
        .eq("active", true);
      if (deactivate.error) throw deactivate.error;

      const { error: insertError } = await supabase
        .from("shared_boards")
        .insert({
          id: sharedBoardId,
          class_id: owner.classId,
          teacher_id: owner.teacherId,
          source_board_id: sourceBoardId,
          title,
          current_snapshot_path: null,
          active,
        });
      if (insertError) throw insertError;
    }

    const boardJson = JSON.stringify(payload.boardData || {});
    const blob = new Blob([boardJson], { type: "application/json" });
    const upload = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(snapshotPath, blob, {
        contentType: "application/json",
        upsert: true,
      });
    if (upload.error) throw upload.error;

    const { data, error } = await supabase
      .from("shared_boards")
      .update({
        title,
        source_board_id: sourceBoardId,
        current_snapshot_path: snapshotPath,
        active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sharedBoardId)
      .select("id, title, updated_at")
      .single();
    if (error) throw error;

    return {
      ok: true,
      sharedBoardId: data.id,
      title: data.title,
      active,
      updatedAt: data.updated_at,
      sizeBytes: blob.size,
    };
  },

  async stopSharedBoard(payload) {
    assertSupabase();
    const owner = await resolveOwner({
      ...payload,
      role: "teacher",
    });
    if (!payload.sharedBoardId) {
      return { ok: true };
    }

    const { error } = await supabase
      .from("shared_boards")
      .update({
        active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", payload.sharedBoardId)
      .eq("class_id", owner.classId);
    if (error) throw error;
    return { ok: true };
  },

  async getActiveSharedBoard(payload) {
    assertSupabase();
    const klass = await getClassByCode(payload.classCode);
    const { data, error } = await supabase
      .from("shared_boards")
      .select("id, title, current_snapshot_path, updated_at")
      .eq("class_id", klass.id)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: true, sharedBoard: null };

    let boardData = null;
    if (data.current_snapshot_path) {
      const download = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(data.current_snapshot_path);
      if (download.error) throw download.error;
      boardData = JSON.parse(await download.data.text());
    }

    return {
      ok: true,
      sharedBoard: {
        sharedBoardId: data.id,
        title: data.title,
        updatedAt: data.updated_at,
        boardData,
      },
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

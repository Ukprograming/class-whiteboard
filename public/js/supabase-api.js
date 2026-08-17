import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

const config = window.CLASS_WHITEBOARD_CONFIG || {};
const SUPABASE_URL = (config.supabaseUrl || "").trim();
const SUPABASE_ANON_KEY = (config.supabaseAnonKey || "").trim();
const STORAGE_BUCKET = (config.storageBucket || "class-whiteboard").trim();
const MAX_REALTIME_PAYLOAD_BYTES = Math.max(
  64000,
  Number(config.maxRealtimePayloadBytes) || 180000
);
const EDGE_FUNCTION_BASE_URL = (
  config.edgeFunctionBaseUrl ||
  (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "")
).replace(/\/$/, "");
const TEACHER_REALTIME_EVENTS = new Set([
  "teacher-start-class",
  "student-view-start",
  "student-view-stop",
  "teacher-chat-to-student",
  "request-highres",
  "start-monitoring",
  "stop-monitoring",
  "teacher-whiteboard-action",
  "teacher-annotation-update",
  "teacherSetHighQuality",
  "teacherShareToStudent",
]);
const TEACHER_ANNOUNCEMENT_EVENTS = new Set([
  "teacher-start-class",
  "student-view-start",
  "student-view-stop",
]);
const TEACHER_STUDENT_EVENTS = new Set(
  Array.from(TEACHER_REALTIME_EVENTS).filter(
    (eventName) => !TEACHER_ANNOUNCEMENT_EVENTS.has(eventName)
  )
);
const STUDENT_REALTIME_EVENTS = new Set([
  "student-mode-change",
  "student-chat-to-teacher",
  "student-thumbnail",
  "student-highres",
  "student-board-state",
  "student-screen-update",
  "student-whiteboard-action",
  "studentImageUpdate",
  "student-screen-share-started",
  "student-screen-share-stopped",
  "student-teacher-action-ack",
]);
const TEACHER_INBOX_EVENTS = new Set(STUDENT_REALTIME_EVENTS);
const SHARED_REALTIME_EVENTS = new Set([
  "shared-board-action",
  "shared-board-snapshot",
]);
const REALTIME_INITIAL_JOIN_TIMEOUT_MS = 30000;
const RETRYABLE_REALTIME_JOIN_ERRORS = [
  "MissingPartition",
  "InitializingProjectConnection",
  "IncreaseConnectionPool",
  "DatabaseLackOfConnections",
  "UnableToConnectToProject",
  "RealtimeRestarting",
];

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function getAuthStorage() {
  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn("Session storage is unavailable; the login session will not persist.", error);
    return undefined;
  }
}

function getAuthStorageKey() {
  const pageName = String(window.location.pathname || "")
    .split("/")
    .pop()
    .toLowerCase();
  const roleScope = pageName.startsWith("student") ? "student" : "teacher";
  return `class-whiteboard-${roleScope}-auth`;
}

export const supabase = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: getAuthStorage(),
      storageKey: getAuthStorageKey(),
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

function isValidClassCode(value) {
  return /^[A-Z0-9_-]{4,32}$/.test(normalizeClassCode(value));
}

function isValidStudentLoginId(value) {
  return /^[a-z0-9_-]{1,24}$/.test(normalizeStudentLoginId(value));
}

function studentAuthEmail(classCode, studentLoginId) {
  const normalizedClassCode = normalizeClassCode(classCode);
  const normalizedStudentId = normalizeStudentLoginId(studentLoginId);
  if (!isValidClassCode(normalizedClassCode) || !isValidStudentLoginId(normalizedStudentId)) {
    throw new Error("クラスコードまたは生徒IDの形式が正しくありません。");
  }
  return `cw.${normalizedClassCode.toLowerCase()}.${normalizedStudentId}@students.class-whiteboard.local`;
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
    classId: "",
    studentRecordId: "",
    nickname: "",
    presenceChannel: null,
    announcementChannel: null,
    sharedChannel: null,
    teacherInboxChannel: null,
    studentInboxChannel: null,
    studentOutboxChannels: new Map(),
    studentIdByLoginId: new Map(),
    studentRecordIdBySocketId: new Map(),
    reconnectTimerId: null,
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

  function rememberStudentSocketRoute(socketIdValue, ...loginIdCandidates) {
    const targetSocketId = String(socketIdValue || "").trim();
    if (!targetSocketId || state.role !== "teacher") return "";

    for (const candidate of loginIdCandidates) {
      const loginId = normalizeStudentLoginId(candidate);
      if (!loginId) continue;
      const studentRecordId = state.studentIdByLoginId.get(loginId);
      if (!studentRecordId) continue;
      state.studentRecordIdBySocketId.set(targetSocketId, studentRecordId);
      return studentRecordId;
    }
    return "";
  }

  function refreshStudentSocketRoutesFromPresence(presenceState) {
    if (state.role !== "teacher") return;
    for (const item of Object.values(presenceState || {}).flat()) {
      if (item?.role !== "student") continue;
      rememberStudentSocketRoute(
        item.socketId,
        item.nickname,
        item.studentId
      );
    }
  }

  function emit(eventName, payload = {}) {
    switch (eventName) {
      case "join-class":
      case "join-student":
      case "joinAsStudent":
        return joinRealtime("student", payload);
      case "join-teacher":
      case "joinAsTeacher":
        return joinRealtime("teacher", payload);
      case "leave-class":
        return leaveRealtime();
      case "student-mode-change":
        state.mode = payload.mode || state.mode;
        void trackPresence();
        return sendRealtimeEvent(eventName, payload);
      default:
        return sendRealtimeEvent(eventName, payload);
    }
  }

  async function resolveRealtimeMembership(role, classCode, userId) {
    const { data: klass, error: classError } = await supabase
      .from("classes")
      .select("id, class_code, teacher_id")
      .eq("class_code", classCode)
      .maybeSingle();
    if (classError) throw classError;
    if (!klass) throw new Error("Class not found.");

    if (role === "teacher") {
      if (klass.teacher_id !== userId) {
        throw new Error("This teacher does not own the selected class.");
      }
      const { data: students, error: studentsError } = await supabase
        .from("students")
        .select("id, student_login_id")
        .eq("class_id", klass.id)
        .eq("active", true);
      if (studentsError) throw studentsError;
      return {
        classId: klass.id,
        studentRecordId: "",
        studentIdByLoginId: new Map(
          (students || []).map((student) => [
            normalizeStudentLoginId(student.student_login_id),
            student.id,
          ])
        ),
      };
    }

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, student_login_id")
      .eq("class_id", klass.id)
      .eq("auth_user_id", userId)
      .eq("active", true)
      .maybeSingle();
    if (studentError) throw studentError;
    if (!student) throw new Error("Active student membership was not found.");
    return {
      classId: klass.id,
      studentRecordId: student.id,
      studentIdByLoginId: new Map([
        [normalizeStudentLoginId(student.student_login_id), student.id],
      ]),
    };
  }

  function isRetryableRealtimeJoinError(status, message) {
    if (status === "TIMED_OUT") return true;
    return RETRYABLE_REALTIME_JOIN_ERRORS.some((code) =>
      String(message || "").includes(code)
    );
  }

  function subscribeChannel(channel, label) {
    let subscribedOnce = false;
    let settled = false;
    let lastRetryableError = "";
    return new Promise((resolve, reject) => {
      const initialJoinTimerId = setTimeout(() => {
        if (settled || subscribedOnce) return;
        settled = true;
        const message = lastRetryableError || `${label} did not subscribe in time.`;
        dispatch("join-error", message);
        reject(new Error(message));
      }, REALTIME_INITIAL_JOIN_TIMEOUT_MS);

      const failInitialJoin = (message) => {
        if (settled || subscribedOnce) return;
        settled = true;
        clearTimeout(initialJoinTimerId);
        dispatch("join-error", message);
        reject(new Error(message));
      };

      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          if (!subscribedOnce) {
            subscribedOnce = true;
            settled = true;
            clearTimeout(initialJoinTimerId);
            resolve();
          } else {
            scheduleReconnectRefresh();
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          const message = err?.message || `${label} ${status.toLowerCase()}.`;
          if (!subscribedOnce && isRetryableRealtimeJoinError(status, message)) {
            lastRetryableError = message;
            console.warn(`[realtime] ${label} will retry after a transient join error.`, err || message);
            dispatch("realtime-disconnected", { channel: label, transient: true });
            return;
          }
          if (!subscribedOnce) {
            failInitialJoin(message);
            return;
          }
          state.online = false;
          dispatch("realtime-disconnected", { channel: label });
        } else if (status === "CLOSED") {
          state.online = false;
          if (!subscribedOnce) {
            failInitialJoin(`${label} closed before it subscribed.`);
            return;
          }
          dispatch("realtime-disconnected", { channel: label });
        }
      });
    });
  }

  function scheduleReconnectRefresh() {
    if (state.reconnectTimerId) clearTimeout(state.reconnectTimerId);
    state.reconnectTimerId = setTimeout(async () => {
      state.reconnectTimerId = null;
      if (!state.presenceChannel || !state.ready) return;
      state.online = true;
      try {
        await trackPresence();
      } catch (error) {
        console.warn("[realtime] failed to restore presence after reconnect.", error);
      }
      dispatch("realtime-reconnected", { classCode: state.classCode });
    }, 500);
  }

  async function joinRealtime(role, payload = {}) {
    const classCode = normalizeClassCode(payload.classCode || state.classCode);
    if (!classCode) {
      dispatch("join-error", "Class code is required.");
      return;
    }

    let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      dispatch("join-error", sessionError?.message || "Login is required.");
      return false;
    }
    if (sessionData.session.user?.app_metadata?.role !== role) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error || refreshed.data.session?.user?.app_metadata?.role !== role) {
        dispatch("join-error", "The signed-in account is not authorized for this role.");
        return false;
      }
      sessionData = refreshed.data;
    }

    const nickname = String(
      payload.nickname ||
      payload.studentId ||
      state.nickname ||
      (role === "teacher" ? "teacher" : "")
    ).trim();

    if (
      state.presenceChannel &&
      state.role === role &&
      state.classCode === classCode &&
      state.nickname === nickname
    ) {
      return state.ready;
    }

    await leaveRealtime();

    let membership;
    try {
      membership = await resolveRealtimeMembership(
        role,
        classCode,
        sessionData.session.user.id
      );
    } catch (error) {
      dispatch("join-error", error?.message || "Class membership could not be verified.");
      return false;
    }

    state.role = role;
    state.classCode = classCode;
    state.classId = membership.classId;
    state.studentRecordId = membership.studentRecordId;
    state.studentIdByLoginId = membership.studentIdByLoginId;
    state.nickname = nickname;
    state.online = false;

    const presenceChannel = supabase.channel(`class:${classCode}:presence`, {
      config: {
        private: privateChannels,
        presence: { key: socketId },
      },
    });
    const announcementChannel = supabase.channel(`class:${classCode}:announcements`, {
      config: {
        private: privateChannels,
        broadcast: { self: false, ack: true },
      },
    });
    const sharedChannel = supabase.channel(`class:${classCode}:shared`, {
      config: {
        private: privateChannels,
        broadcast: { self: false, ack: true },
      },
    });
    const teacherInboxChannel = supabase.channel(`class:${classCode}:teacher-inbox`, {
      config: {
        private: privateChannels,
        broadcast: { self: false, ack: true },
      },
    });
    const studentInboxChannel = role === "student"
      ? supabase.channel(`class:${classCode}:student:${membership.studentRecordId}`, {
        config: {
          private: privateChannels,
          broadcast: { self: false, ack: true },
        },
      })
      : null;
    state.presenceChannel = presenceChannel;
    state.announcementChannel = announcementChannel;
    state.sharedChannel = sharedChannel;
    state.teacherInboxChannel = teacherInboxChannel;
    state.studentInboxChannel = studentInboxChannel;

    const handlePresenceUpdate = () => {
      if (state.role !== "teacher") return;
      const presenceState = presenceChannel.presenceState();
      refreshStudentSocketRoutesFromPresence(presenceState);
      dispatch("student-list-update", getStudentPresenceList(
        presenceState,
        state.studentIdByLoginId
      ));
    };
    presenceChannel
      .on("presence", { event: "sync" }, handlePresenceUpdate)
      .on("presence", { event: "join" }, handlePresenceUpdate)
      .on("presence", { event: "leave" }, handlePresenceUpdate);

    announcementChannel.on(
      "broadcast",
      { event: "socket-event" },
      ({ payload: eventPayload }) => handleRemoteEvent(eventPayload, "announcement")
    );
    sharedChannel.on(
      "broadcast",
      { event: "socket-event" },
      ({ payload: eventPayload }) => handleRemoteEvent(eventPayload, "shared")
    );

    if (role === "teacher") {
      teacherInboxChannel.on(
        "broadcast",
        { event: "socket-event" },
        ({ payload: eventPayload }) => {
          handleRemoteEvent(eventPayload, "teacher-inbox");
        }
      );
    } else if (studentInboxChannel) {
      studentInboxChannel.on(
        "broadcast",
        { event: "socket-event" },
        ({ payload: eventPayload }) => {
          handleRemoteEvent(eventPayload, "student-inbox");
        }
      );
    }

    // The first WebSocket channel after a paused project is restored creates
    // the rolling realtime.messages partitions. Join Presence first so the
    // remaining private-channel authorization checks do not race that setup.
    state.ready = subscribeChannel(presenceChannel, "Presence channel")
      .then(async () => {
        const subscriptions = [
          subscribeChannel(announcementChannel, "Announcement channel"),
          subscribeChannel(sharedChannel, "Shared-board channel"),
        ];
        if (role === "teacher") {
          subscriptions.push(subscribeChannel(teacherInboxChannel, "Teacher inbox"));
        } else if (studentInboxChannel) {
          subscriptions.push(subscribeChannel(studentInboxChannel, "Student inbox"));
        }
        await Promise.all(subscriptions);
      })
      .then(async () => {
        if (
          state.presenceChannel !== presenceChannel ||
          state.announcementChannel !== announcementChannel ||
          state.sharedChannel !== sharedChannel ||
          state.teacherInboxChannel !== teacherInboxChannel ||
          state.studentInboxChannel !== studentInboxChannel
        ) {
          return false;
        }
        state.online = true;
        await trackPresence();
        if (role === "student") {
          dispatch("join-success", {
            classCode,
            nickname,
            studentRecordId: membership.studentRecordId,
          });
          dispatch("join-student", {
            classCode,
            nickname,
            socketId,
            studentRecordId: membership.studentRecordId,
          });
        } else {
          dispatch("student-list-update", getStudentPresenceList(
            presenceChannel.presenceState(),
            state.studentIdByLoginId
          ));
          dispatch("teacher-class-started", { classCode });
        }
        return true;
      })
      .catch(async (error) => {
        if (
          state.presenceChannel === presenceChannel ||
          state.teacherInboxChannel === teacherInboxChannel
        ) {
          await leaveRealtime();
        }
        throw error;
      });

    return state.ready;
  }

  async function leaveRealtime() {
    const channels = [
      state.presenceChannel,
      state.announcementChannel,
      state.sharedChannel,
      state.teacherInboxChannel,
      state.studentInboxChannel,
      ...state.studentOutboxChannels.values(),
    ].filter(Boolean);
    if (!channels.length) return;
    state.presenceChannel = null;
    state.announcementChannel = null;
    state.sharedChannel = null;
    state.teacherInboxChannel = null;
    state.studentInboxChannel = null;
    state.studentOutboxChannels = new Map();
    state.studentIdByLoginId = new Map();
    state.studentRecordIdBySocketId = new Map();
    if (state.reconnectTimerId) clearTimeout(state.reconnectTimerId);
    state.reconnectTimerId = null;
    state.classId = "";
    state.studentRecordId = "";
    state.ready = null;
    state.online = false;
    await Promise.all(Array.from(new Set(channels)).map(
      (channel) => supabase.removeChannel(channel)
    ));
  }

  async function trackPresence() {
    if (!state.presenceChannel || !state.online) return;
    await state.presenceChannel.track({
      socketId,
      role: state.role,
      classCode: state.classCode,
      nickname: state.nickname,
      studentId: state.role === "student" ? state.nickname : "",
      studentRecordId: state.role === "student" ? state.studentRecordId : "",
      mode: state.mode || "whiteboard",
      onlineAt: new Date().toISOString(),
    });
  }

  async function resolveTargetStudentRecordId(payload = {}) {
    const targetSocketId = payload.targetSocketId ||
      payload.targetStudentSocketId ||
      payload.studentSocketId ||
      "";
    const routedStudentRecordId = state.studentRecordIdBySocketId.get(targetSocketId);
    if (routedStudentRecordId) return routedStudentRecordId;

    let loginId = normalizeStudentLoginId(payload.studentId || "");
    if (!loginId && targetSocketId && state.presenceChannel) {
      const presence = Object.values(state.presenceChannel.presenceState() || {})
        .flat()
        .find((item) => item?.role === "student" && item.socketId === targetSocketId);
      loginId = normalizeStudentLoginId(presence?.nickname || presence?.studentId || "");
    }
    const cached = state.studentIdByLoginId.get(loginId);
    if (cached) {
      if (targetSocketId) state.studentRecordIdBySocketId.set(targetSocketId, cached);
      return cached;
    }
    if (!loginId || !state.classId) return "";

    const { data: student, error } = await supabase
      .from("students")
      .select("id, student_login_id")
      .eq("class_id", state.classId)
      .eq("student_login_id", loginId)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    if (!student) return "";
    state.studentIdByLoginId.set(loginId, student.id);
    if (targetSocketId) state.studentRecordIdBySocketId.set(targetSocketId, student.id);
    return student.id;
  }

  function getStudentOutboxChannel(studentRecordId) {
    if (state.studentOutboxChannels.has(studentRecordId)) {
      return state.studentOutboxChannels.get(studentRecordId);
    }
    const channel = supabase.channel(
      `class:${state.classCode}:student:${studentRecordId}`,
      {
        config: {
          private: privateChannels,
          broadcast: { self: false, ack: true },
        },
      }
    );
    state.studentOutboxChannels.set(studentRecordId, channel);
    return channel;
  }

  async function sendRealtimeEvent(eventName, payload = {}) {
    if (!state.presenceChannel && payload.classCode) {
      await joinRealtime(state.role || inferRoleFromEvent(eventName), payload);
    }
    if (state.ready) {
      try {
        await state.ready;
      } catch {
        return false;
      }
    }
    const isTeacherInboxEvent = TEACHER_INBOX_EVENTS.has(eventName);
    const isSharedEvent = SHARED_REALTIME_EVENTS.has(eventName);
    const isAnnouncementEvent = TEACHER_ANNOUNCEMENT_EVENTS.has(eventName);
    const isStudentInboxEvent = TEACHER_STUDENT_EVENTS.has(eventName);
    let targetChannel = null;
    let useHttpSend = false;

    if (isTeacherInboxEvent && state.role === "student") {
      targetChannel = state.teacherInboxChannel;
      useHttpSend = true;
    } else if (isSharedEvent && (state.role === "teacher" || state.role === "student")) {
      targetChannel = state.sharedChannel;
    } else if (isAnnouncementEvent && state.role === "teacher") {
      targetChannel = state.announcementChannel;
    } else if (isStudentInboxEvent && state.role === "teacher") {
      const studentRecordId = await resolveTargetStudentRecordId(payload);
      if (!studentRecordId) {
        console.warn(`[realtime] target student could not be resolved for ${eventName}.`);
        dispatch("realtime-send-failed", { eventName, reason: "student-not-found" });
        return false;
      }
      targetChannel = getStudentOutboxChannel(studentRecordId);
      useHttpSend = true;
    }

    if (!targetChannel) {
      console.warn(`[realtime] rejected ${eventName} from role ${state.role || "unknown"}.`);
      return false;
    }

    const enriched = {
      ...(payload || {}),
      classCode: normalizeClassCode(payload?.classCode || state.classCode),
    };

    const outboundPayload = {
      eventName,
      payload: enriched,
      senderSocketId: socketId,
      senderRole: state.role,
      senderNickname: state.nickname,
      timestamp: Date.now(),
    };
    const outboundBytes = new TextEncoder().encode(JSON.stringify(outboundPayload)).byteLength;
    if (outboundBytes > MAX_REALTIME_PAYLOAD_BYTES) {
      console.warn(
        `[realtime] ${eventName} was not sent because it exceeds the staging payload limit ` +
        `(${outboundBytes} > ${MAX_REALTIME_PAYLOAD_BYTES} bytes).`
      );
      dispatch("realtime-payload-too-large", { eventName, bytes: outboundBytes });
      return false;
    }

    try {
      if (useHttpSend) {
        const result = await targetChannel.httpSend("socket-event", outboundPayload);
        if (!result?.success) {
          console.warn(`[realtime] ${eventName} HTTP send was not acknowledged.`);
          dispatch("realtime-send-failed", { eventName, result });
          return false;
        }
        return true;
      }

      const result = await targetChannel.send({
        type: "broadcast",
        event: "socket-event",
        payload: outboundPayload,
      });
      if (result && result !== "ok") {
        console.warn(`[realtime] ${eventName} send returned ${result}.`);
        dispatch("realtime-send-failed", { eventName, result });
        return false;
      }
      return true;
    } catch (error) {
      console.error(`[realtime] ${eventName} send failed.`, error);
      dispatch("realtime-send-failed", { eventName, error });
      return false;
    }
  }

  function handleRemoteEvent(message, source) {
    if (!message || message.senderSocketId === socketId) return;
    if (normalizeClassCode(message.payload?.classCode || state.classCode) !== state.classCode) return;

    const eventName = message.eventName;
    const sourceAllowed =
      (source === "teacher-inbox" &&
        state.role === "teacher" &&
        TEACHER_INBOX_EVENTS.has(eventName)) ||
      (source === "student-inbox" &&
        state.role === "student" &&
        TEACHER_STUDENT_EVENTS.has(eventName)) ||
      (source === "announcement" &&
        TEACHER_ANNOUNCEMENT_EVENTS.has(eventName)) ||
      (source === "shared" &&
        SHARED_REALTIME_EVENTS.has(eventName));
    if (!sourceAllowed) {
      console.warn(`[realtime] rejected ${eventName || "unknown"} on ${source || "unknown"} topic.`);
      return;
    }
    const payload = message.payload || {};
    if (state.role === "teacher") {
      if (source === "teacher-inbox") {
        rememberStudentSocketRoute(
          message.senderSocketId,
          message.senderNickname,
          payload.nickname,
          payload.studentId
        );
      }
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
          kind: payload.kind === "reaction" ? "reaction" : "text",
          reaction: payload.reaction || "",
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
          boardSnapshotPath: payload.boardSnapshotPath,
          teacherSyncToken: payload.teacherSyncToken,
        });
        break;
      case "student-whiteboard-action":
        if (payload.targetTeacherSocketId && payload.targetTeacherSocketId !== socketId) return;
        dispatch("student-whiteboard-action", {
          studentSocketId: message.senderSocketId,
          action: payload.action,
        });
        break;
      case "student-teacher-action-ack":
        if (payload.targetTeacherSocketId && payload.targetTeacherSocketId !== socketId) return;
        dispatch("student-teacher-action-ack", {
          studentSocketId: message.senderSocketId,
          teacherSyncToken: payload.teacherSyncToken,
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
          boardSnapshotPath: payload.boardSnapshotPath,
          teacherSyncToken: payload.teacherSyncToken,
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
          kind: payload.kind === "reaction" ? "reaction" : "text",
          reaction: payload.reaction || "",
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
        dispatch("teacher-whiteboard-action", {
          action: payload.action,
          teacherSocketId: message.senderSocketId,
        });
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

function getStudentPresenceList(presenceState, studentIdByLoginId = new Map()) {
  return Object.values(presenceState || {})
    .flat()
    .filter((item) => item?.role === "student")
    .map((item) => {
      const nickname = item.nickname || item.studentId || item.socketId;
      return {
        socketId: item.socketId,
        nickname,
        studentRecordId: studentIdByLoginId.get(normalizeStudentLoginId(nickname)) || "",
        mode: item.mode || "whiteboard",
      };
    })
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
    const normalizedClassCode = normalizeClassCode(classCode);
    const normalizedStudentLoginId = normalizeStudentLoginId(studentLoginId);
    const email = studentAuthEmail(normalizedClassCode, normalizedStudentLoginId);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error("クラスコード、生徒ID、またはパスワードが一致しません。表示名ではなく、先生が設定した生徒IDを入力してください。");
    }

    const { data: student, error: studentError } = await supabase
      .from("students")
      .select("id, class_id, student_login_id, display_name, active")
      .eq("auth_user_id", data.user.id)
      .eq("student_login_id", normalizedStudentLoginId)
      .eq("active", true)
      .maybeSingle();

    const { data: klass, error: classError } = student
      ? await supabase
        .from("classes")
        .select("id, class_code")
        .eq("id", student.class_id)
        .eq("class_code", normalizedClassCode)
        .maybeSingle()
      : { data: null, error: null };

    if (studentError || classError || !student || !klass) {
      await supabase.auth.signOut();
      throw new Error("この生徒IDは、入力したクラスに登録されていません。先生から伝えられた情報を確認してください。");
    }

    saveStudentLoginHint({
      classCode: klass.class_code,
      studentLoginId: student.student_login_id,
    });

    return {
      ...data,
      classCode: klass.class_code,
      studentLoginId: student.student_login_id,
      displayName: student.display_name,
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
  async listClasses() {
    assertSupabase();
    const { data, error } = await supabase
      .from("classes")
      .select("id, class_code, name, archived, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  createStudent(payload) {
    return callFunction("create-student", payload);
  },
  async listStudents(classId) {
    assertSupabase();
    const { data, error } = await supabase
      .from("students")
      .select("id, student_login_id, display_name, active")
      .eq("class_id", classId)
      .order("student_login_id", { ascending: true });
    if (error) throw error;
    return data || [];
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

function boardPageDataList(boardData) {
  if (Array.isArray(boardData?.pages) && boardData.pages.length) {
    return boardData.pages.map(page => page?.boardData).filter(Boolean);
  }
  return boardData ? [boardData] : [];
}

function collectBoardAssetRecords(boardData) {
  const records = [];
  for (const pageData of boardPageDataList(boardData)) {
    for (const object of pageData.objects || []) {
      if (object?.kind === "image") {
        records.push({ record: object, embeddedField: "imageDataUrl" });
      }
    }
    if (pageData.background) {
      records.push({ record: pageData.background, embeddedField: "dataUrl" });
    }
  }
  return records;
}

function normalizeAssetKey(value) {
  const normalized = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (normalized) return normalized.slice(0, 120);
  return crypto.randomUUID();
}

function assetExtension(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/svg+xml": return "svg";
    case "image/jpeg":
    case "image/jpg":
    default:
      return "jpg";
  }
}

function boardAssetPrefix(snapshotPath) {
  return String(snapshotPath || "").replace(/\.json$/i, "") + "/assets";
}

function isAllowedBoardAssetPath(path) {
  return /^(teachers|students|shared)\/[0-9a-f-]+\//i.test(String(path || ""));
}

async function recordToBlob(record, embeddedField) {
  const embedded = record?.[embeddedField];
  if (typeof embedded === "string" && embedded.startsWith("data:")) {
    const response = await fetch(embedded);
    if (!response.ok) throw new Error("Failed to decode an embedded board image.");
    return response.blob();
  }

  const objectUrl = String(record?.imageObjectUrl || record?.objectUrl || "").trim();
  if (objectUrl) {
    try {
      const response = await fetch(objectUrl);
      if (response.ok) return response.blob();
    } catch (error) {
      console.warn("Failed to reuse the in-memory board asset.", error);
    }
  }

  const sourcePath = String(record?.assetPath || "").trim();
  if (!sourcePath || !isAllowedBoardAssetPath(sourcePath)) return null;
  const download = await supabase.storage.from(STORAGE_BUCKET).download(sourcePath);
  if (download.error) throw download.error;
  return download.data;
}

async function storageObjectExists(path) {
  const normalizedPath = String(path || "").trim();
  const separator = normalizedPath.lastIndexOf("/");
  if (separator < 1 || separator === normalizedPath.length - 1) return false;
  const folder = normalizedPath.slice(0, separator);
  const name = normalizedPath.slice(separator + 1);
  const listing = await supabase.storage.from(STORAGE_BUCKET).list(folder, {
    limit: 10,
    search: name,
  });
  if (listing.error) throw listing.error;
  return (listing.data || []).some((item) => item?.name === name);
}

function isAssetAlreadyStored(error) {
  const message = String(error?.message || error || "");
  return /already exists|resource exists|duplicate/i.test(message);
}

async function uploadImmutableBoardAsset(path, blob, mimeType) {
  const upload = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, blob, {
      contentType: mimeType,
      cacheControl: "31536000",
      upsert: false,
    });
  if (upload.error && !isAssetAlreadyStored(upload.error)) throw upload.error;
}

async function externalizeBoardAssets(boardData, snapshotPath) {
  const prefix = boardAssetPrefix(snapshotPath);
  const references = [];

  for (const entry of collectBoardAssetRecords(boardData)) {
    const { record, embeddedField } = entry;
    record.assetKey = normalizeAssetKey(record.assetKey);
    const targetPrefix = `${prefix}/`;
    const currentPath = String(record.assetPath || "").trim();
    const currentObjectUrl = record.imageObjectUrl || record.objectUrl || "";

    if (
      currentPath.startsWith(targetPrefix) &&
      isAllowedBoardAssetPath(currentPath) &&
      await storageObjectExists(currentPath)
    ) {
      delete record[embeddedField];
      delete record.imageObjectUrl;
      delete record.objectUrl;
      references.push({
        assetKey: record.assetKey,
        assetPath: currentPath,
        assetMimeType: record.assetMimeType || "",
        assetSizeBytes: record.assetSizeBytes || 0,
        imageWidth: record.imageWidth || record.width || 0,
        imageHeight: record.imageHeight || record.height || 0,
        ...(embeddedField === "imageDataUrl"
          ? { imageObjectUrl: currentObjectUrl || undefined }
          : { objectUrl: currentObjectUrl || undefined }),
      });
      continue;
    }

    const blob = await recordToBlob(record, embeddedField);
    if (!blob) continue;
    const mimeType = blob.type || record.assetMimeType || "image/jpeg";
    const assetPath = `${prefix}/${record.assetKey}.${assetExtension(mimeType)}`;
    await uploadImmutableBoardAsset(assetPath, blob, mimeType);
    const objectUrl = currentObjectUrl || URL.createObjectURL(blob);

    record.assetPath = assetPath;
    record.assetMimeType = mimeType;
    record.assetSizeBytes = blob.size;
    delete record[embeddedField];
    delete record.imageObjectUrl;
    delete record.objectUrl;
    references.push({
      assetKey: record.assetKey,
      assetPath,
      assetMimeType: mimeType,
      assetSizeBytes: blob.size,
      imageWidth: record.imageWidth || record.width || 0,
      imageHeight: record.imageHeight || record.height || 0,
      ...(embeddedField === "imageDataUrl"
        ? { imageObjectUrl: objectUrl }
        : { objectUrl }),
    });
  }

  boardData.version = Math.max(3, Number(boardData.version) || 0);
  for (const pageData of boardPageDataList(boardData)) {
    pageData.version = Math.max(3, Number(pageData.version) || 0);
  }
  return references;
}

async function hydrateBoardAssets(boardData) {
  const records = collectBoardAssetRecords(boardData);
  const downloads = new Map();

  for (const { record, embeddedField } of records) {
    const path = String(record?.assetPath || "").trim();
    if (!path || !isAllowedBoardAssetPath(path) || record?.[embeddedField]) continue;
    if (!downloads.has(path)) {
      downloads.set(path, (async () => {
        const download = await supabase.storage.from(STORAGE_BUCKET).download(path);
        if (download.error) throw download.error;
        return URL.createObjectURL(download.data);
      })());
    }
  }

  await Promise.all(records.map(async ({ record, embeddedField }) => {
    const path = String(record?.assetPath || "").trim();
    if (!path || record?.[embeddedField] || !downloads.has(path)) return;
    try {
      const objectUrl = await downloads.get(path);
      if (embeddedField === "imageDataUrl") record.imageObjectUrl = objectUrl;
      else record.objectUrl = objectUrl;
      delete record.assetLoadError;
    } catch (error) {
      record.assetLoadError = true;
      console.warn(`Failed to load board asset: ${path}`, error);
    }
  }));

  return boardData;
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
    const snapshotPath = owner.ownerKind === "teacher"
      ? `teachers/${owner.teacherId}/${fileId}.json`
      : `students/${owner.studentId}/${fileId}.json`;
    const boardData = payload.boardData || {};
    const assetReferences = await externalizeBoardAssets(boardData, snapshotPath);
    const boardJson = JSON.stringify(boardData);
    const blob = new Blob([boardJson], { type: "application/json" });

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
      thumbnail_path: null,
      source_board_id: null,
      shared_board_id: null,
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
      assetReferences,
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

    const boardData = await hydrateBoardAssets(JSON.parse(await download.data.text()));
    return {
      ok: true,
      fileId: data.id,
      fileName: data.name,
      boardData,
    };
  },

  async saveRealtimeBoardSnapshot(payload) {
    assertSupabase();
    const owner = await resolveOwner({
      ...payload,
      role: "student",
    });
    if (owner.ownerKind !== "student" || !owner.studentId) {
      throw new Error("Student login is required.");
    }

    const snapshotPath = `students/${owner.studentId}/realtime/${owner.classId}.json`;
    const boardData = payload.boardData || {};
    const assetReferences = await externalizeBoardAssets(boardData, snapshotPath);
    const boardJson = JSON.stringify(boardData);
    const blob = new Blob([boardJson], { type: "application/json" });
    const upload = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(snapshotPath, blob, {
        contentType: "application/json",
        upsert: true,
      });
    if (upload.error) throw upload.error;
    return {
      ok: true,
      snapshotPath,
      sizeBytes: blob.size,
      assetReferences,
    };
  },

  async loadRealtimeBoardSnapshot(snapshotPath) {
    assertSupabase();
    const normalizedPath = String(snapshotPath || "").trim();
    if (!/^students\/[0-9a-f-]+\/realtime\/[0-9a-f-]+\.json$/i.test(normalizedPath)) {
      throw new Error("Invalid realtime board snapshot path.");
    }

    const download = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(normalizedPath);
    if (download.error) throw download.error;
    return hydrateBoardAssets(JSON.parse(await download.data.text()));
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
      // Create an inactive staging row first so Storage RLS can authorize the
      // shared/{id}/ path without interrupting the currently active board.
      const { error: insertError } = await supabase
        .from("shared_boards")
        .insert({
          id: sharedBoardId,
          class_id: owner.classId,
          teacher_id: owner.teacherId,
          source_board_id: sourceBoardId,
          title,
          current_snapshot_path: null,
          active: false,
        });
      if (insertError) throw insertError;
    }

    const boardData = payload.boardData || {};
    const assetReferences = await externalizeBoardAssets(boardData, snapshotPath);
    const boardJson = JSON.stringify(boardData);
    const blob = new Blob([boardJson], { type: "application/json" });
    const upload = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(snapshotPath, blob, {
        contentType: "application/json",
        upsert: true,
      });
    if (upload.error) throw upload.error;
    const { data, error } = await supabase
      .rpc("finalize_shared_board_snapshot", {
        p_shared_board_id: sharedBoardId,
        p_class_id: owner.classId,
        p_title: title,
        p_source_board_id: sourceBoardId,
        p_snapshot_path: snapshotPath,
        p_active: active,
      })
      .single();
    if (error) throw error;

    return {
      ok: true,
      sharedBoardId: data.shared_board_id,
      title: data.board_title,
      active,
      updatedAt: data.board_updated_at,
      sizeBytes: blob.size,
      assetReferences,
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
      boardData = await hydrateBoardAssets(JSON.parse(await download.data.text()));
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

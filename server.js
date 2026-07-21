// server.js（CommonJS版）

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");
const session = require("express-session");

const GAS_ENDPOINT =
  process.env.GAS_ENDPOINT ||
  "https://script.google.com/macros/s/AKfycbwiG9RIoKoowqfuPhzckfDeqQjIN-YqXK_i6RWwBLc6g2GJU3FT7WZgLHzfd28Ulh8H/exec";
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || "";
const LEGACY_REALTIME_ENABLED = process.env.ENABLE_LEGACY_REALTIME === "true";
const LEGACY_GAS_PROXY_ENABLED = process.env.ENABLE_LEGACY_GAS_PROXY === "true";
if (LEGACY_REALTIME_ENABLED && (!process.env.SESSION_SECRET || !TEACHER_PASSWORD)) {
  throw new Error(
    "ENABLE_LEGACY_REALTIME=true requires SESSION_SECRET and TEACHER_PASSWORD."
  );
}
const PUBLIC_DIR = path.join(__dirname, "public");
const TEACHER_PAGE = path.join(PUBLIC_DIR, "teacher.html");
const TEACHER_LOGIN_PAGE = path.join(PUBLIC_DIR, "teacher-login.html");
const TEACHER_SIGNUP_PAGE = path.join(PUBLIC_DIR, "teacher-signup.html");

const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
  },
});
app.use(sessionMiddleware);

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7, // 約10MB（socket.io経由の画像転送の上限）
});
io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  if (!LEGACY_REALTIME_ENABLED) {
    return next(new Error("Legacy realtime is disabled."));
  }
  return next();
});

/* =========================
   教員用ログイン関連ルート
   ========================= */

function isTeacherLoggedIn(req) {
  return !!(req.session && req.session.isTeacher);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

app.get("/teacher-login", (req, res) => {
  res.sendFile(TEACHER_LOGIN_PAGE);
});

app.get("/teacher-signup", (req, res) => {
  res.sendFile(TEACHER_SIGNUP_PAGE);
});

app.get(["/teacher", "/teacher.html"], (req, res) => {
  if (req.query.auth === "supabase") return res.sendFile(TEACHER_PAGE);
  if (!isTeacherLoggedIn(req)) return res.redirect("/teacher-login");
  return res.sendFile(TEACHER_PAGE);
});

app.post("/teacher/login", (req, res) => {
  if (!TEACHER_PASSWORD) {
    return res.status(503).send("Legacy teacher login is disabled. Configure TEACHER_PASSWORD to enable it.");
  }
  const { password, classCode } = req.body;
  if (password === TEACHER_PASSWORD) {
    req.session.isTeacher = true;
    const normalizedClassCode = normalizeText(classCode);
    if (normalizedClassCode) {
      req.session.classCode = normalizedClassCode;
    }
    return res.redirect("/teacher");
  }

  return res.status(401).send(`
    <h2>パスワードが違います</h2>
    <p><a href="/teacher-login">戻る</a></p>
  `);
});

app.get("/api/teacher/session", (req, res) => {
  if (isTeacherLoggedIn(req)) {
    res.json({
      ok: true,
      classCode: req.session.classCode || null,
    });
  } else {
    res.status(401).json({ ok: false, message: "Unauthorized" });
  }
});

app.post("/teacher/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/teacher-login");
  });
});

/* =========================
   静的ファイル（public）
   ========================= */
app.use(express.static(PUBLIC_DIR));

/* =========================
   GAS プロキシ API
   ========================= */

// 共通：GAS に JSON を投げて、その結果をそのまま返すヘルパー
async function proxyToGas(req, res) {
  try {
    console.log(
      `[GAS Proxy] Sending to GAS: ${JSON.stringify(req.body).slice(0, 200)}...`
    );

    const response = await fetch(GAS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const text = await response.text();
    console.log(`[GAS Proxy] Response status: ${response.status}`);

    try {
      const json = JSON.parse(text);
      res.status(response.status).json(json);
    } catch (e) {
      console.error("[GAS Proxy] JSON parse error:", e);
      res
        .status(response.status)
        .set("Content-Type", "application/json; charset=utf-8")
        .send(text);
    }
  } catch (err) {
    console.error("GAS proxy error", err);
    res.status(500).json({
      ok: false,
      message: "GAS との通信に失敗しました。",
    });
  }
}

const boardProxyPaths = [
  "/api/board/save",
  "/api/board/load",
  "/api/board/list",
  "/api/board/folders",
  "/api/board/students",
];

boardProxyPaths.forEach((routePath) => {
  app.post(routePath, (req, res, next) => {
    if (!LEGACY_GAS_PROXY_ENABLED) {
      return res.status(503).json({
        ok: false,
        message: "Legacy GAS proxy is disabled.",
      });
    }
    return next();
  }, proxyToGas);
});

/* =========================
   socket.io 関連
   ========================= */

// 教員と生徒の接続情報を保持（ホワイトボード用）
// classes = { classCode: { teacherSocketId, students: { socketId: { nickname } } } }
const classes = {};
const chatTemplateColors = {
  question: "#f97316",
  repeat: "#22c55e",
  check: "#8b5cf6",
};
const chatReactions = {
  thumbs_up: "👍",
  clap: "👏",
  ok: "👌",
  idea: "💡",
  question: "❓",
};

// ▼ ノート確認用の状態管理
// notebookClasses = { [classCode]: { [studentId]: { latestImageData } } }
const notebookClasses = {};
// notebookStudentSockets = { [classCode]: { [studentId]: socketId } }
const notebookStudentSockets = {};
// notebookSocketToStudent = { [socketId]: { classCode, studentId } }
const notebookSocketToStudent = {};

function ensureClass(classCode) {
  if (!classes[classCode]) {
    classes[classCode] = { teacherSocketId: null, students: {} };
  }
  return classes[classCode];
}

function cleanupClassIfEmpty(classCode) {
  const cls = classes[classCode];
  if (!cls) return;
  if (!cls.teacherSocketId && Object.keys(cls.students).length === 0) {
    delete classes[classCode];
  }
}

function notifyTeacherStudentList(classCode) {
  const cls = classes[classCode];
  if (cls && cls.teacherSocketId) {
    io.to(cls.teacherSocketId).emit("student-list-update", getStudentList(classCode));
  }
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ホワイトボード用 状態
  let joinedClassCode = null;
  let role = null;

  // ノート確認用 状態（このソケットが紐づくクラス/生徒ID）
  let notebookJoinedClassCode = null;
  let notebookStudentId = null;

  function isAuthenticatedTeacher() {
    return !!socket.request.session?.isTeacher;
  }

  function isTeacherForClass(classCode) {
    const code = normalizeText(classCode || joinedClassCode);
    const cls = classes[code];
    return !!(
      code &&
      isAuthenticatedTeacher() &&
      role === "teacher" &&
      joinedClassCode === code &&
      cls?.teacherSocketId === socket.id
    );
  }

  function isStudentForClass(classCode) {
    const code = normalizeText(classCode || joinedClassCode);
    const cls = classes[code];
    return !!(
      code &&
      role === "student" &&
      joinedClassCode === code &&
      cls?.students?.[socket.id]
    );
  }

  function isStudentTargetInClass(classCode, targetSocketId) {
    const code = normalizeText(classCode || joinedClassCode);
    return !!(code && targetSocketId && classes[code]?.students?.[targetSocketId]);
  }

  function leaveCurrentWhiteboardClass() {
    if (!joinedClassCode) return;

    const code = joinedClassCode;
    const cls = classes[code];
    console.log(`Socket ${socket.id} leaving class ${code} as ${role}`);

    if (cls) {
      if (role === "teacher" && cls.teacherSocketId === socket.id) {
        cls.teacherSocketId = null;
      } else if (role === "student") {
        delete cls.students[socket.id];
        notifyTeacherStudentList(code);
      }
    }

    socket.leave(code);
    joinedClassCode = null;
    role = null;
    cleanupClassIfEmpty(code);
  }

  function joinStudentToClass({ classCode, nickname, source, sendSuccess }) {
    const code = normalizeText(classCode);
    const name = normalizeText(nickname);
    if (!code || !name) return false;

    if (joinedClassCode && joinedClassCode !== code) {
      leaveCurrentWhiteboardClass();
    }

    role = "student";
    joinedClassCode = code;

    const cls = ensureClass(code);
    cls.students[socket.id] = {
      nickname: name,
      mode: "whiteboard",
    };
    socket.join(code);

    console.log(`Student ${name} joined class ${code} via ${source}`);
    if (sendSuccess) {
      socket.emit("join-success", { classCode: code, nickname: name });
    }
    notifyTeacherStudentList(code);
    return true;
  }

  /* =========================
     ホワイトボード用 イベント
     ========================= */

  // 教員が参加
  socket.on("join-teacher", ({ classCode }) => {
    const code = normalizeText(classCode);
    if (!code) return;
    if (!isAuthenticatedTeacher()) {
      socket.emit("join-error", "Teacher authentication is required.");
      return;
    }

    // すでに別のクラスに入っている場合は、そのクラスから抜ける
    if (joinedClassCode && joinedClassCode !== code) {
      const previousClassCode = joinedClassCode;
      leaveCurrentWhiteboardClass();
      console.log(`Teacher moved: ${socket.id} from ${previousClassCode} to ${code}`);
    }

    role = "teacher";
    joinedClassCode = code;

    const cls = ensureClass(code);
    cls.teacherSocketId = socket.id;

    // このクラスのroomに参加
    socket.join(code);

    console.log(`Teacher joined: ${code}, socket=${socket.id}`);

    // 既に参加している生徒一覧を送る
    socket.emit("student-list-update", getStudentList(code));
  });

  // クラスから退室（教員でも生徒でも共通で使える）
  socket.on("leave-class", () => {
    leaveCurrentWhiteboardClass();
  });


  // 生徒が参加（旧）
  socket.on("join-student", ({ classCode, nickname }) => {
    joinStudentToClass({ classCode, nickname, source: "join-student" });
  });


  // 生徒が参加 (新ログインフロー用: join-class イベントに対応)
  socket.on("join-class", ({ classCode, nickname }) => {
    const joined = joinStudentToClass({
      classCode,
      nickname,
      source: "join-class",
      sendSuccess: true,
    });
    if (!joined) {
      socket.emit("join-error", "クラスコードとニックネームを入力してください。");
    }
  });

  // === 生徒のモード変更（ホワイトボード / 画面共有 / ノート提出 など） ===
  socket.on("student-mode-change", ({ classCode, mode }) => {
    const code = classCode || joinedClassCode;
    if (!code || !mode || !isStudentForClass(code)) return;

    const cls = classes[code];
    if (!cls || !cls.students[socket.id]) return;

    // サーバー側の状態を更新
    cls.students[socket.id].mode = mode;
    console.log(
      `[mode] student-mode-change class=${code}, student=${socket.id}, mode=${mode}`
    );

    // 教員へモード変更を通知
    const teacherId = cls.teacherSocketId;
    if (teacherId) {
      io.to(teacherId).emit("student-mode-changed", {
        socketId: socket.id,
        mode,
      });

      // ついでに生徒一覧も更新しておく（タイルにモード表示する場合など）
      io.to(teacherId).emit("student-list-update", getStudentList(code));
    }
  });


  // === 生徒画面確認モード ON/OFF（通信量削減用） ===
  socket.on("student-view-start", ({ classCode }) => {
    const code = classCode || joinedClassCode;
    if (!code || !isTeacherForClass(code)) return;

    const cls = classes[code];
    if (!cls) return;

    console.log(
      `[server] student-view-start from teacher=${socket.id}, class=${code}`
    );

    // このクラスの全生徒に「キャプチャ開始」を通知
    Object.keys(cls.students).forEach((studentSocketId) => {
      io.to(studentSocketId).emit("student-view-start");
    });
  });

  socket.on("student-view-stop", ({ classCode }) => {
    const code = classCode || joinedClassCode;
    if (!code || !isTeacherForClass(code)) return;

    const cls = classes[code];
    if (!cls) return;

    console.log(
      `[server] student-view-stop from teacher=${socket.id}, class=${code}`
    );

    // このクラスの全生徒に「キャプチャ停止」を通知
    Object.keys(cls.students).forEach((studentSocketId) => {
      io.to(studentSocketId).emit("student-view-stop");
    });
  });

  // === ここからチャット関連 ===

  // 生徒 → 教員 チャット
  socket.on("student-chat-to-teacher", (payload) => {
    const { classCode } = payload || {};
    const reaction = Object.prototype.hasOwnProperty.call(chatReactions, payload?.reaction)
      ? payload.reaction
      : "";
    const kind = reaction ? "reaction" : "text";
    // text / message 両対応
    const message = reaction ? chatReactions[reaction] : (payload?.message || payload?.text);
    const templateKind = Object.prototype.hasOwnProperty.call(
      chatTemplateColors,
      payload?.templateKind
    )
      ? payload.templateKind
      : "";
    if (!classCode || !message || !isStudentForClass(classCode)) return;

    const cls = classes[classCode];
    if (!cls || !cls.teacherSocketId) return;
    const nickname = cls.students[socket.id].nickname;

    const teacherId = cls.teacherSocketId;

    console.log(
      `[chat] student->teacher class=${classCode}, from=${nickname}(${socket.id}), msg=${message}`
    );

    io.to(teacherId).emit("chat-message", {
      fromRole: "student",
      fromSocketId: socket.id,
      fromNickname: nickname || "生徒",
      toRole: "teacher",
      toSocketId: teacherId,
      classCode,
      message,
      kind,
      reaction,
      templateKind,
      templateColor: templateKind ? chatTemplateColors[templateKind] : "",
      timestamp: Date.now(),
    });
  });

  // 教員 → 生徒 チャット
  socket.on("teacher-chat-to-student", (payload = {}) => {
    const { classCode, targetSocketId } = payload;
    const reaction = Object.prototype.hasOwnProperty.call(chatReactions, payload.reaction)
      ? payload.reaction
      : "";
    const kind = reaction ? "reaction" : "text";
    const message = reaction ? chatReactions[reaction] : payload.message;
    if (
      !classCode ||
      !targetSocketId ||
      !message ||
      !isTeacherForClass(classCode) ||
      !isStudentTargetInClass(classCode, targetSocketId)
    ) return;
    const cls = classes[classCode];
    if (!cls) return;

    const studentInfo = cls.students[targetSocketId];
    if (!studentInfo) return;

    console.log(
      `[chat] teacher->student class=${classCode}, to=${studentInfo.nickname}(${targetSocketId}), msg=${message}`
    );

    io.to(targetSocketId).emit("chat-message", {
      fromRole: "teacher",
      fromSocketId: socket.id,
      fromNickname: "先生",
      toRole: "student",
      toSocketId: targetSocketId,
      classCode,
      message,
      kind,
      reaction,
      timestamp: Date.now(),
    });
  });

  // 生徒 → 教員：縮小キャプチャ
  socket.on("student-thumbnail", ({ classCode, nickname, dataUrl, mode, viewport }) => {
    if (!isStudentForClass(classCode)) return;
    const cls = classes[classCode];
    if (!cls || !cls.teacherSocketId) return;
    const verifiedNickname = cls.students[socket.id].nickname;
    console.log(
      `[thumb] student-thumbnail class=${classCode}, from=${nickname}(${socket.id}), size=${dataUrl ? dataUrl.length : 0}`
    );
    io.to(cls.teacherSocketId).emit("student-thumbnail", {
      socketId: socket.id,
      nickname: verifiedNickname,
      dataUrl,
      mode,
      viewport,
    });
  });

  // 教員 → 生徒：中画質リクエスト
  socket.on("request-highres", ({ classCode, studentSocketId }) => {
    if (
      !studentSocketId ||
      !isTeacherForClass(classCode) ||
      !isStudentTargetInClass(classCode, studentSocketId)
    ) return;
    console.log(
      `[highres] request-highres class=${classCode}, teacher=${socket.id} -> student=${studentSocketId}`
    );
    io.to(studentSocketId).emit("request-highres", {});
  });

  // 生徒 → 教員：中画質画像送信
  socket.on("student-highres", ({ classCode, nickname, dataUrl }) => {
    if (!isStudentForClass(classCode)) return;
    const cls = classes[classCode];
    if (!cls || !cls.teacherSocketId) return;
    const verifiedNickname = cls.students[socket.id].nickname;
    console.log(
      `[highres] student-highres class=${classCode}, from=${nickname}(${socket.id}), size=${dataUrl ? dataUrl.length : 0}`
    );
    io.to(cls.teacherSocketId).emit("student-highres", {
      socketId: socket.id,
      nickname: verifiedNickname,
      dataUrl,
    });
  });

  /* =========================
     リアルタイム共同編集（1対1）
     ========================= */

  // 教員 → 生徒：モニタリング開始（共同編集セッション開始）
  socket.on("start-monitoring", ({ classCode, studentSocketId }) => {
    const code = classCode || joinedClassCode;
    const targetSocketId = studentSocketId;
    if (
      !code ||
      !targetSocketId ||
      !isTeacherForClass(code) ||
      !isStudentTargetInClass(code, targetSocketId)
    ) return;

    console.log(
      `[monitor] start-monitoring class=${code}, teacher=${socket.id} -> student=${targetSocketId}`
    );

    // 生徒に「共同編集開始」を通知
    io.to(targetSocketId).emit("start-monitoring", {
      classCode: code,
      teacherSocketId: socket.id,
    });
  });

  // 教員 → 生徒：モニタリング終了
  socket.on("stop-monitoring", ({ classCode, studentSocketId }) => {
    const code = classCode || joinedClassCode;
    const targetSocketId = studentSocketId;
    if (
      !code ||
      !targetSocketId ||
      !isTeacherForClass(code) ||
      !isStudentTargetInClass(code, targetSocketId)
    ) return;

    console.log(
      `[monitor] stop-monitoring class=${code}, teacher=${socket.id} -> student=${targetSocketId}`
    );

    io.to(targetSocketId).emit("stop-monitoring", {
      classCode: code,
    });
  });

  // 生徒 → 教員：ボードの全状態（初期同期用）
  socket.on("student-board-state", ({ targetTeacherSocketId, boardData, boardSnapshotPath, teacherSyncToken }) => {
    if (
      !targetTeacherSocketId ||
      (!boardData && !boardSnapshotPath) ||
      !isStudentForClass(joinedClassCode) ||
      classes[joinedClassCode]?.teacherSocketId !== targetTeacherSocketId
    ) return;
    console.log(
      `[monitor] student-board-state from=${socket.id} -> teacher=${targetTeacherSocketId}`
    );
    io.to(targetTeacherSocketId).emit("student-board-state", {
      studentSocketId: socket.id,
      boardData,
      boardSnapshotPath,
      teacherSyncToken,
    });
  });

  // ★★ 生徒 → 教員：モニタリング中の画面更新（連続）
  socket.on(
    "student-screen-update",
    ({ classCode, teacherSocketId, dataUrl, viewport, mode, boardData, boardSnapshotPath, teacherSyncToken, isSync }) => {
      if (
        !teacherSocketId ||
        !classCode ||
        !isStudentForClass(classCode) ||
        classes[classCode]?.teacherSocketId !== teacherSocketId
      ) return;
      console.log(
        `[monitor] student-screen-update class=${classCode}, student=${socket.id} -> teacher=${teacherSocketId}, mode=${mode}, imgSize=${dataUrl ? dataUrl.length : 0}`
      );
      io.to(teacherSocketId).emit("student-screen-update", {
        studentSocketId: socket.id,
        classCode,
        dataUrl,
        viewport,
        mode,
        boardData,
        boardSnapshotPath,
        teacherSyncToken,
        isSync,
      });
    }
  );

  // 教員 → 生徒：ホワイトボード操作（リアルタイム）
  socket.on(
    "teacher-whiteboard-action",
    ({ targetSocketId, targetStudentSocketId, action }) => {
      const dest = targetSocketId || targetStudentSocketId;
      if (
        !dest ||
        !action ||
        !isTeacherForClass(joinedClassCode) ||
        !isStudentTargetInClass(joinedClassCode, dest)
      ) return;
      console.log(
        `[monitor] teacher-whiteboard-action from=${socket.id} -> student=${dest}`
      );
      io.to(dest).emit("teacher-whiteboard-action", {
        action,
      });
    }
  );

  // 生徒 → 教員：ホワイトボード操作（リアルタイム）
  socket.on("student-whiteboard-action", ({ targetTeacherSocketId, action }) => {
    if (
      !targetTeacherSocketId ||
      !action ||
      !isStudentForClass(joinedClassCode) ||
      classes[joinedClassCode]?.teacherSocketId !== targetTeacherSocketId
    ) return;
    console.log(
      `[monitor] student-whiteboard-action from=${socket.id} -> teacher=${targetTeacherSocketId}`
    );
    io.to(targetTeacherSocketId).emit("student-whiteboard-action", {
      studentSocketId: socket.id,
      action,
    });
  });

  // ★★ 教員 → 生徒：アノテーション更新（オブジェクトの同期）
  socket.on("teacher-annotation-update", ({ classCode, targetSocketId, annotationData }) => {
    if (
      !targetSocketId ||
      !annotationData ||
      !isTeacherForClass(classCode) ||
      !isStudentTargetInClass(classCode, targetSocketId)
    ) return;
    console.log(
      `[monitor] teacher-annotation-update class=${classCode}, teacher=${socket.id} -> student=${targetSocketId}, objects=${Array.isArray(annotationData) ? annotationData.length : "?"
      }`
    );
    io.to(targetSocketId).emit("teacher-annotation-update", {
      classCode,
      targetSocketId,
      annotationData,
    });
  });

  /* =========================
     ノート点検アプリ統合部分
     ========================= */

  // 生徒: ノート確認クラスに参加
  socket.on("joinAsStudent", ({ classCode, studentId }) => {
    if (!classCode || !studentId || !isStudentForClass(classCode)) return;
    const verifiedStudentId = classes[classCode].students[socket.id].nickname;

    notebookJoinedClassCode = classCode;
    notebookStudentId = verifiedStudentId;

    // このソケット ↔ 生徒ID の紐付け
    notebookSocketToStudent[socket.id] = { classCode, studentId: verifiedStudentId };

    // 生徒ソケットIDを記録
    if (!notebookStudentSockets[classCode]) {
      notebookStudentSockets[classCode] = {};
    }
    notebookStudentSockets[classCode][verifiedStudentId] = socket.id;

    // 生徒の状態を初期化（まだ画像なし）
    if (!notebookClasses[classCode]) {
      notebookClasses[classCode] = {};
    }

    const isNewStudent = !notebookClasses[classCode][verifiedStudentId];
    notebookClasses[classCode][verifiedStudentId] = {
      latestImageData: notebookClasses[classCode][verifiedStudentId]
        ? notebookClasses[classCode][verifiedStudentId].latestImageData
        : null,
    };

    // 新規参加のときだけ教員に通知
    if (isNewStudent) {
      io.to(`notebook:${classCode}:teachers`).emit("studentJoined", {
        studentId: verifiedStudentId,
        classCode,
      });
      console.log(
        `Notebook student joined: class=${classCode}, studentId=${studentId}, socket=${socket.id}`
      );
    }
  });

  // 教員: ノート確認クラスに参加
  socket.on("joinAsTeacher", ({ classCode }) => {
    if (!classCode || !isTeacherForClass(classCode)) return;

    // 教員用の部屋に参加
    socket.join(`notebook:${classCode}:teachers`);
    console.log(`Notebook teacher joined: class=${classCode}, socket=${socket.id}`);

    // すでに参加している生徒がいれば、その一覧と最新画像を送る
    const students = notebookClasses[classCode] || {};
    for (const [studentId, info] of Object.entries(students)) {
      socket.emit("studentJoined", { studentId, classCode });
      if (info.latestImageData) {
        socket.emit("studentImageUpdated", {
          studentId,
          imageData: info.latestImageData,
        });
      }
    }
  });

  // 生徒: 3秒ごとのノート画像送信
  socket.on("studentImageUpdate", ({ classCode, studentId, imageData }) => {
    if (!classCode || !studentId || !imageData || !isStudentForClass(classCode)) return;
    const verifiedStudentId = classes[classCode].students[socket.id].nickname;

    if (!notebookClasses[classCode]) {
      notebookClasses[classCode] = {};
    }
    notebookClasses[classCode][verifiedStudentId] = { latestImageData: imageData };

    console.log(
      `[notebook] studentImageUpdate class=${classCode}, studentId=${studentId}, size=${imageData.length}`
    );

    // 教員全員に「この生徒の画像が更新された」と通知
    io.to(`notebook:${classCode}:teachers`).emit("studentImageUpdated", {
      studentId: verifiedStudentId,
      imageData,
    });
  });

  // 教員→生徒: 高画質モード ON/OFF
  socket.on("teacherSetHighQuality", ({ classCode, studentId, enabled }) => {
    if (!classCode || !studentId || !isTeacherForClass(classCode)) return;
    const map = notebookStudentSockets[classCode];
    if (!map) return;
    const targetSocketId = map[studentId];
    if (!targetSocketId) return;

    console.log(
      `[notebook] teacherSetHighQuality class=${classCode}, studentId=${studentId}, enabled=${enabled}`
    );

    io.to(targetSocketId).emit("setHighQualityMode", { enabled: !!enabled });
  });


  // 教員→生徒: 添削済み画像を送り返す
  socket.on(
    "teacherShareToStudent",
    ({ classCode, studentId, studentSocketId, imageData }) => {
      if (!classCode || !imageData || !isTeacherForClass(classCode)) return;

      let targetSocketId = null;

      // ① 生徒画面モーダルなど「socketId 直接指定」の場合
      if (studentSocketId && isStudentTargetInClass(classCode, studentSocketId)) {
        targetSocketId = studentSocketId;
      }

      // ② 従来のノート用（studentId -> notebookStudentSockets）も一応残す
      if (!targetSocketId && studentId) {
        const map = notebookStudentSockets[classCode];
        if (map) {
          targetSocketId = map[studentId];
        }
      }

      if (!targetSocketId) return;

      console.log(
        `[notebook] teacherShareToStudent class=${classCode}, studentId=${studentId || "N/A"}, socketId=${targetSocketId}, size=${imageData.length}`
      );

      io.to(targetSocketId).emit("teacherSharedImage", { imageData });
    }
  );


  /* =========================
     切断処理
     ========================= */

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    // --- ホワイトボード用のクラス管理 ---
    leaveCurrentWhiteboardClass();

    // --- ノート確認用のクラス管理 ---
    const noteInfo = notebookSocketToStudent[socket.id];
    if (noteInfo) {
      const { classCode, studentId } = noteInfo;
      const classMap = notebookStudentSockets[classCode];
      if (classMap && classMap[studentId] === socket.id) {
        delete classMap[studentId];
      }
      const ncls = notebookClasses[classCode];
      if (ncls && ncls[studentId]) {
        delete ncls[studentId];
      }

      io.to(`notebook:${classCode}:teachers`).emit("studentLeft", {
        studentId,
      });

      delete notebookSocketToStudent[socket.id];
    }
  });
});

function getStudentList(classCode) {
  const cls = classes[classCode];
  if (!cls) return [];
  return Object.entries(cls.students).map(([socketId, info]) => ({
    socketId,
    nickname: info.nickname,
    // ★ mode を先生側にも渡す（なければ "whiteboard"）
    mode: info.mode || "whiteboard",
  }));
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

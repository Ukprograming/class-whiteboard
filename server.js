// server.js（CommonJS版）

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session"); // ★ 追加：セッション用

// ★ GAS Webアプリの URL（あなたのもの）
const GAS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbyGdxGU9zPa4GOviu3xDXJfno_UJRRwfL6Vkei-iwOA2juCqXS_YiIBOAdRmDJF-Mc-jg/exec";

const app = express();

// ★ JSON ボディの最大サイズを 50MB まで許可（大きめのPDFでもOK）
//   ※ 下で app.use(express.json()) をもう一回呼ばないことが大事！
app.use(express.json({ limit: "50mb" }));
// ★ フォーム（パスワード）の POST を受け取るため
app.use(express.urlencoded({ extended: true }));

// ★ セッション設定（本番では env から読むのが望ましい）
app.use(
  session({
    secret: process.env.SESSION_SECRET || "some-random-secret",
    resave: false,
    saveUninitialized: false,
  })
);

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 約10MB（socket.io経由の画像転送の上限）
});

const PORT = process.env.PORT || 3000;

// ★ 教員用パスワード（Render の環境変数に設定しておくのが理想）
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || "teacher1234";

/* =========================
   教員用ログイン関連ルート
   ========================= */

// ログインページ表示
app.get("/teacher-login", (req, res) => {
  const path = require("path");
  res.sendFile(path.join(__dirname, "public", "teacher-login.html"));
});

// 教員用トップ（/teacher にアクセスしたとき）
app.get("/teacher", (req, res) => {
  const path = require("path");
  if (req.session && req.session.isTeacher) {
    // 認証済みなら teacher.html を返す
    return res.sendFile(path.join(__dirname, "public", "teacher.html"));
  } else {
    // 未認証ならログインページへ
    return res.redirect("/teacher-login");
  }
});

// 直接 /teacher.html と打たれても同じ挙動にする
app.get("/teacher.html", (req, res) => {
  if (req.session && req.session.isTeacher) {
    const path = require("path");
    return res.sendFile(path.join(__dirname, "public", "teacher.html"));
  } else {
    return res.redirect("/teacher-login");
  }
});

// ログイン処理
app.post("/teacher/login", (req, res) => {
  const { password, classCode } = req.body;
  if (password === TEACHER_PASSWORD) {
    // 認証成功 → セッションにフラグを立てる
    req.session.isTeacher = true;
    // クラスコードもセッションに保存（あれば）
    if (classCode) {
      req.session.classCode = classCode;
    }
    return res.redirect("/teacher");
  } else {
    // 認証失敗
    return res.status(401).send(`
      <h2>パスワードが違います</h2>
      <p><a href="/teacher-login">戻る</a></p>
    `);
  }
});

// セッション情報取得（クライアント側でクラスコードを知るため）
app.get("/api/teacher/session", (req, res) => {
  if (req.session && req.session.isTeacher) {
    res.json({
      ok: true,
      classCode: req.session.classCode || null
    });
  } else {
    res.status(401).json({ ok: false, message: "Unauthorized" });
  }
});

// ログアウト（必要に応じて使用）
app.post("/teacher/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/teacher-login");
  });
});

/* =========================
   静的ファイル（public）
   ========================= */
// ★ ここは認証ルートの「後」に置くこと！
app.use(express.static("public"));

/* =========================
   GAS プロキシ API
   ========================= */

// 共通：GAS に JSON を投げて、その結果をそのまま返すヘルパー
async function proxyToGas(req, res) {
  try {
    const response = await fetch(GAS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();

    // 基本は JSON のはずなのでパースを試みる
    try {
      const json = JSON.parse(text);
      res.status(response.status).json(json);
    } catch (e) {
      // もし JSON でない場合も、そのまま返す
      res
        .status(response.status)
        .set("Content-Type", "application/json; charset=utf-8")
        .send(text);
    }
  } catch (err) {
    console.error("GAS proxy error", err);
    res.status(500).json({
      ok: false,
      message: "GAS との通信に失敗しました。"
    });
  }
}

// ★ ホワイトボード保存 → GAS に転送
//   body には { action:"saveBoard", role, classCode, filePath, ... } が入っている想定
app.post("/api/board/save", async (req, res) => {
  await proxyToGas(req, res);
});

// ★ ホワイトボード読み込み → GAS に転送
//   ここも POST にして、body で { action:"loadBoard", fileId, ... } を渡す
app.post("/api/board/load", async (req, res) => {
  await proxyToGas(req, res);
});

// ★ ファイル一覧取得 → GAS に転送
//   { action:"listBoards", role, classCode, nickname? } を受け取る
app.post("/api/board/list", async (req, res) => {
  await proxyToGas(req, res);
});

// ★ フォルダ一覧取得 → GAS に転送
//   { action:"listFolders", role, classCode, nickname? } を受け取る
app.post("/api/board/folders", async (req, res) => {
  await proxyToGas(req, res);
});

/* =========================
   socket.io 関連
   ========================= */

// 教員と生徒の接続情報を保持（ホワイトボード用）
// classes = { classCode: { teacherSocketId, students: { socketId: { nickname } } } }
const classes = {};

// ▼ ノート確認用の状態管理
// notebookClasses = { [classCode]: { [studentId]: { latestImageData } } }
const notebookClasses = {};
// notebookStudentSockets = { [classCode]: { [studentId]: socketId } }
const notebookStudentSockets = {};
// notebookSocketToStudent = { [socketId]: { classCode, studentId } }
const notebookSocketToStudent = {};

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  // ホワイトボード用 状態
  let joinedClassCode = null;
  let role = null;

  // ノート確認用 状態（このソケットが紐づくクラス/生徒ID）
  let notebookJoinedClassCode = null;
  let notebookStudentId = null;

  /* =========================
     ホワイトボード用 イベント
     ========================= */

  // 教員が参加
  socket.on("join-teacher", ({ classCode }) => {
    role = "teacher";
    joinedClassCode = classCode;
    if (!classes[classCode]) {
      classes[classCode] = { teacherSocketId: null, students: {} };
    }
    classes[classCode].teacherSocketId = socket.id;
    console.log(`Teacher joined: ${classCode}`);
  });

  // 生徒が参加
  socket.on("join-student", ({ classCode, nickname }) => {
    role = "student";
    joinedClassCode = classCode;
    if (!classes[classCode]) {
      classes[classCode] = { teacherSocketId: null, students: {} };
    }
    classes[classCode].students[socket.id] = { nickname };
    console.log(`Student ${nickname} joined class ${classCode}`);

    const teacherId = classes[classCode].teacherSocketId;
    if (teacherId) {
      io.to(teacherId).emit("student-list-update", getStudentList(classCode));
    }
  });

  // === ここからチャット関連 ===

  // 生徒 → 教員 チャット
  socket.on("student-chat-to-teacher", ({ classCode, nickname, message }) => {
    if (!classCode || !message) return;
    const cls = classes[classCode];
    if (!cls || !cls.teacherSocketId) return;

    const teacherId = cls.teacherSocketId;

    io.to(teacherId).emit("chat-message", {
      fromRole: "student",
      fromSocketId: socket.id,
      fromNickname: nickname || "生徒",
      toRole: "teacher",
      toSocketId: teacherId,
      classCode,
      message,
      timestamp: Date.now()
    });
  });

  // 教員 → 生徒 チャット
  socket.on("teacher-chat-to-student", ({ classCode, targetSocketId, message }) => {
    if (!classCode || !targetSocketId || !message) return;
    const cls = classes[classCode];
    if (!cls) return;

    const studentInfo = cls.students[targetSocketId];
    if (!studentInfo) return;

    io.to(targetSocketId).emit("chat-message", {
      fromRole: "teacher",
      fromSocketId: socket.id,
      fromNickname: "先生",
      toRole: "student",
      toSocketId: targetSocketId,
      classCode,
      message,
      timestamp: Date.now()
    });
  });

  // 生徒 → 教員：縮小キャプチャ
  socket.on("student-thumbnail", ({ classCode, nickname, dataUrl }) => {
    const cls = classes[classCode];
    if (!cls || !cls.teacherSocketId) return;
    io.to(cls.teacherSocketId).emit("student-thumbnail", {
      socketId: socket.id,
      nickname,
      dataUrl
    });
  });

  // 教員 → 生徒：中画質リクエスト
  socket.on("request-highres", ({ classCode, studentSocketId }) => {
    io.to(studentSocketId).emit("request-highres", {});
  });

  // 生徒 → 教員：中画質画像送信
  socket.on("student-highres", ({ classCode, nickname, dataUrl }) => {
    const cls = classes[classCode];
    if (!cls || !cls.teacherSocketId) return;
    io.to(cls.teacherSocketId).emit("student-highres", {
      socketId: socket.id,
      nickname,
      dataUrl
    });
  });

  /* =========================
     リアルタイム共同編集（1対1）
     ========================= */

  // 教員 → 生徒：モニタリング開始（共同編集セッション開始）
  socket.on("start-monitoring-student", ({ classCode, targetSocketId }) => {
    // 生徒に「教員が参加した」ことを通知
    io.to(targetSocketId).emit("teacher-joined-session", {
      teacherSocketId: socket.id
    });
    // 生徒に「モニタリング開始」を通知（サムネイル送信頻度変更など）
    io.to(targetSocketId).emit("start-monitoring", {
      teacherSocketId: socket.id
    });
  });

  // 教員 → 生徒：モニタリング終了
  socket.on("stop-monitoring-student", ({ classCode, targetSocketId }) => {
    io.to(targetSocketId).emit("stop-monitoring", {});
  });

  // 生徒 → 教員：ボードの全状態（初期同期用）
  socket.on("student-board-state", ({ targetTeacherSocketId, boardData }) => {
    io.to(targetTeacherSocketId).emit("student-board-state", {
      studentSocketId: socket.id,
      boardData
    });
  });

  // 教員 → 生徒：ホワイトボード操作（リアルタイム）
  socket.on("teacher-whiteboard-action", ({ targetSocketId, action }) => {
    io.to(targetSocketId).emit("teacher-whiteboard-action", {
      action
    });
  });

  // 生徒 → 教員：ホワイトボード操作（リアルタイム）
  socket.on("student-whiteboard-action", ({ targetTeacherSocketId, action }) => {
    io.to(targetTeacherSocketId).emit("student-whiteboard-action", {
      studentSocketId: socket.id,
      action
    });
  });

  /* =========================
     ノート点検アプリ統合部分
     ========================= */
  // 生徒: ノート確認クラスに参加
  socket.on("joinAsStudent", ({ classCode, studentId }) => {
    if (!classCode || !studentId) return;

    notebookJoinedClassCode = classCode;
    notebookStudentId = studentId;

    // このソケット ↔ 生徒ID の紐付け
    notebookSocketToStudent[socket.id] = { classCode, studentId };

    // 生徒ソケットIDを記録
    if (!notebookStudentSockets[classCode]) {
      notebookStudentSockets[classCode] = {};
    }
    notebookStudentSockets[classCode][studentId] = socket.id;

    // 生徒の状態を初期化（まだ画像なし）
    if (!notebookClasses[classCode]) {
      notebookClasses[classCode] = {};
    }

    const isNewStudent = !notebookClasses[classCode][studentId];
    notebookClasses[classCode][studentId] = {
      latestImageData: notebookClasses[classCode][studentId]
        ? notebookClasses[classCode][studentId].latestImageData
        : null
    };

    // 新規参加のときだけ教員に通知
    if (isNewStudent) {
      io.to(`notebook:${classCode}:teachers`).emit("studentJoined", {
        studentId,
        classCode
      });
      console.log(
        `Notebook student joined: class=${classCode}, studentId=${studentId}`
      );
    }
  });

  // 教員: ノート確認クラスに参加
  socket.on("joinAsTeacher", ({ classCode }) => {
    if (!classCode) return;

    // 教員用の部屋に参加
    socket.join(`notebook:${classCode}:teachers`);
    console.log(`Notebook teacher joined: class=${classCode}`);

    // すでに参加している生徒がいれば、その一覧と最新画像を送る
    const students = notebookClasses[classCode] || {};
    for (const [studentId, info] of Object.entries(students)) {
      socket.emit("studentJoined", { studentId, classCode });
      if (info.latestImageData) {
        socket.emit("studentImageUpdated", {
          studentId,
          imageData: info.latestImageData
        });
      }
    }
  });

  // 生徒: 3秒ごとのノート画像送信
  socket.on("studentImageUpdate", ({ classCode, studentId, imageData }) => {
    if (!classCode || !studentId || !imageData) return;

    if (!notebookClasses[classCode]) {
      notebookClasses[classCode] = {};
    }
    notebookClasses[classCode][studentId] = { latestImageData: imageData };

    // 教員全員に「この生徒の画像が更新された」と通知
    io.to(`notebook:${classCode}:teachers`).emit("studentImageUpdated", {
      studentId,
      imageData
    });
  });

  // 教員→生徒: 高画質モード ON/OFF
  socket.on("teacherSetHighQuality", ({ classCode, studentId, enabled }) => {
    if (!classCode || !studentId) return;
    const map = notebookStudentSockets[classCode];
    if (!map) return;
    const targetSocketId = map[studentId];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("setHighQualityMode", { enabled: !!enabled });
  });

  // 教員→生徒: 添削済み画像を送り返す
  socket.on("teacherShareToStudent", ({ classCode, studentId, imageData }) => {
    if (!classCode || !studentId || !imageData) return;
    const map = notebookStudentSockets[classCode];
    if (!map) return;
    const targetSocketId = map[studentId];
    if (!targetSocketId) return;

    io.to(targetSocketId).emit("teacherSharedImage", { imageData });
  });

  /* =========================
     切断処理
     ========================= */

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    // --- ホワイトボード用のクラス管理 ---
    if (joinedClassCode) {
      const cls = classes[joinedClassCode];
      if (cls) {
        if (role === "student") {
          delete cls.students[socket.id];
          if (cls.teacherSocketId) {
            io.to(cls.teacherSocketId).emit(
              "student-list-update",
              getStudentList(joinedClassCode)
            );
          }
        } else if (role === "teacher") {
          cls.teacherSocketId = null;
        }
      }
    }

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
      // 教員に「生徒が離脱した」ことを通知したければこちら
      io.to(`notebook:${classCode}:teachers`).emit("studentLeft", {
        studentId
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
    nickname: info.nickname
  }));
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// server.js（CommonJS版）

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

// ★ GAS Webアプリの URL（あなたのもの）
const GAS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbyGdxGU9zPa4GOviu3xDXJfno_UJRRwfL6Vkei-iwOA2juCqXS_YiIBOAdRmDJF-Mc-jg/exec";

const app = express();

// ★ JSON ボディの最大サイズを 50MB まで許可（大きめのPDFでもOK）
//   ※ 下で app.use(express.json()) をもう一回呼ばないことが大事！
app.use(express.json({ limit: "50mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 約10MB（socket.io経由の画像転送の上限）
});

const PORT = process.env.PORT || 3000;

// public フォルダを公開
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
   socket.io 関連（元々のまま）
   ========================= */

// 教員と生徒の接続情報を保持
// classes = { classCode: { teacherSocketId, students: { socketId: { nickname } } } }
const classes = {};

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  let joinedClassCode = null;
  let role = null;

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

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    if (!joinedClassCode) return;
    const cls = classes[joinedClassCode];
    if (!cls) return;

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

// server.js（CommonJS版）

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 約10MB
});

const PORT = process.env.PORT || 3000;

// public フォルダを公開
app.use(express.static("public"));

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

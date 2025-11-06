// public/js/student.js
import { initBoardUI } from "./board-ui.js";

// 共通ホワイトボード UI 初期化
const whiteboard = initBoardUI();

// === GAS Web アプリの URL（teacher.js と同じもの） ===
const GAS_ENDPOINT = "https://script.google.com/a/macros/hokkaido-c.ed.jp/s/AKfycbzhJ4hbzCVMbFYW6pP5ZLBK5A2OSH-yoNofg64pt9FMC57c5-z_KeD5zB6DW0ehzMB3hw/exec";

// 生徒用 保存 / 読み込みボタン（HTML で用意しておく）
const studentSaveBoardBtn = document.getElementById("studentSaveBoardBtn");
const studentLoadBoardBtn = document.getElementById("studentLoadBoardBtn");

// ========= socket.io =========
const socket = io();

// ==== DOM 要素（新 ID 優先、なければ旧 ID を使う） ====
const classCodeInput =
  document.getElementById("studentClassCodeInput") ||
  document.getElementById("classCodeInput");
const nicknameInput =
  document.getElementById("studentNicknameInput") ||
  document.getElementById("nicknameInput");
const joinBtn =
  document.getElementById("studentJoinBtn") ||
  document.getElementById("joinBtn");

const statusLabel =
  document.getElementById("studentStatus") || null;

const headerClassCode = document.getElementById("headerClassCode");
const headerNickname = document.getElementById("headerNickname");

// 共有モードボタン（新旧両対応）
const modeWhiteboardBtn =
  document.getElementById("studentModeWhiteboard") ||
  document.getElementById("shareWhiteboardBtn");
const modeScreenBtn =
  document.getElementById("studentModeScreen") ||
  document.getElementById("shareScreenBtn");

// 左パネル（旧 UI のみ）
const studentSidePanel = document.getElementById("studentSidePanel");
const studentSideToggle = document.getElementById("studentSideToggle");
const studentPanelOpen = document.getElementById("studentPanelOpen");

// PNG 保存ボタン
const savePngBtn = document.getElementById("savePngBtn");

// キャンバス（board-ui.js が使っているものと同じはず）
const studentCanvas =
  document.getElementById("studentCanvas") ||
  document.getElementById("whiteboard");

// ========= 状態 =========
let currentClassCode = null;
let nickname = null;

let captureTimerId = null;
const CAPTURE_INTERVAL_MS = 5000;

// キャプチャモード：'whiteboard' or 'screen'
let captureMode = "whiteboard";
let screenStream = null;
let screenVideo = null;

// ========= 左パネル折りたたみ（旧 UI 用） =========
function resizeCanvasToContainer() {
  if (!studentCanvas || !whiteboard) return;

  const container = studentCanvas.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  studentCanvas.style.width = rect.width + "px";
  studentCanvas.style.height = rect.height + "px";

  studentCanvas.width = rect.width * dpr;
  studentCanvas.height = rect.height * dpr;

  whiteboard.dpr = dpr;
  whiteboard.render();
}

if (studentSideToggle && studentSidePanel) {
  studentSideToggle.addEventListener("click", () => {
    studentSidePanel.classList.toggle("collapsed");
    setTimeout(() => {
      resizeCanvasToContainer();
    }, 260);
  });
}

if (studentPanelOpen && studentSidePanel) {
  studentPanelOpen.addEventListener("click", () => {
    studentSidePanel.classList.remove("collapsed");
    setTimeout(() => {
      resizeCanvasToContainer();
    }, 260);
  });
}

// ========= ホワイトボード 保存 / 読み込み（生徒） =========

async function studentSaveBoard() {
  if (!currentClassCode || !nickname) {
    alert("クラスに参加してから保存してください。");
    return;
  }
  if (!whiteboard || typeof whiteboard.exportBoardData !== "function") {
    alert("ホワイトボードの状態を取得できません。");
    return;
  }

  const boardData = whiteboard.exportBoardData();

  const payload = {
    action: "saveBoard",
    role: "student",
    classCode: currentClassCode,
    nickname,
    boardData
  };

  try {
    const res = await fetch(GAS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(() => ({}));
    alert(json.message || "ホワイトボードを保存しました。");
  } catch (err) {
    console.error(err);
    alert("ホワイトボードの保存に失敗しました。");
  }
}

async function studentLoadBoard() {
  if (!currentClassCode || !nickname) {
    alert("クラスに参加してから読み込んでください。");
    return;
  }
  if (!whiteboard || typeof whiteboard.importBoardData !== "function") {
    alert("ホワイトボードに読み込めません。");
    return;
  }

  const url = `${GAS_ENDPOINT}?action=loadBoard&role=student&classCode=${encodeURIComponent(
    currentClassCode
  )}&nickname=${encodeURIComponent(nickname)}`;

  try {
    const res = await fetch(url);
    const json = await res.json();

    if (!json || !json.boardData) {
      alert("保存されたホワイトボードが見つかりませんでした。");
      return;
    }

    whiteboard.importBoardData(json.boardData);
    alert("ホワイトボードを読み込みました。");
  } catch (err) {
    console.error(err);
    alert("ホワイトボードの読み込みに失敗しました。");
  }
}

// ボタンにイベントを紐付け
if (studentSaveBoardBtn) {
  studentSaveBoardBtn.addEventListener("click", studentSaveBoard);
}
if (studentLoadBoardBtn) {
  studentLoadBoardBtn.addEventListener("click", studentLoadBoard);
}

// ========= PNG 保存 =========
if (savePngBtn && whiteboard && typeof whiteboard.exportPngDataUrl === "function") {
  savePngBtn.addEventListener("click", () => {
    const dataUrl = whiteboard.exportPngDataUrl();
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `whiteboard-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.png`;
    a.click();
  });
}

// ========= クラス参加 =========
if (joinBtn && classCodeInput && nicknameInput) {
  joinBtn.addEventListener("click", () => {
    const code = classCodeInput.value.trim();
    const nick = nicknameInput.value.trim();
    if (!code || !nick) {
      alert("クラスコードとニックネームを入力してください。");
      return;
    }
    currentClassCode = code;
    nickname = nick;

    // 既存実装に合わせたイベント
    socket.emit("join-student", { classCode: code, nickname: nick });
    // 新しいイベント名も飛ばしておく（サーバー側で使うなら）
    socket.emit("join-student", { classCode: code, nickname: nick });

    if (headerClassCode) headerClassCode.textContent = code;
    if (headerNickname) headerNickname.textContent = nick;
    if (statusLabel) {
      statusLabel.textContent = `${code} に参加しました`;
    }

    restartCaptureLoop();
    sendWhiteboardThumbnail();
  });
}

// 新イベント名に対応するステータス更新（必要なら）
socket.on("join-student", payload => {
  if (statusLabel && payload?.classCode) {
    statusLabel.textContent = `${payload.classCode} に参加しました`;
  }
});

// ========= 共有モード切り替え（ホワイトボード / 画面共有） =========
function updateCaptureButtons() {
  if (!modeWhiteboardBtn || !modeScreenBtn) return;
  const isWhiteboard = captureMode === "whiteboard";
  modeWhiteboardBtn.classList.toggle("primary", isWhiteboard);
  modeWhiteboardBtn.classList.toggle("active", isWhiteboard);
  modeScreenBtn.classList.toggle("primary", !isWhiteboard);
  modeScreenBtn.classList.toggle("active", !isWhiteboard);
}

function stopScreenCapture() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  if (screenVideo) {
    screenVideo.srcObject = null;
  }
  // サーバーへ通知したい場合はここで emit
  socket.emit("student-screen-share-stopped", { classCode: currentClassCode });
}

async function startScreenCapture() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    alert("このブラウザは画面共有に対応していません。");
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false
    });
    screenStream = stream;

    if (!screenVideo) {
      screenVideo = document.createElement("video");
      screenVideo.style.position = "fixed";
      screenVideo.style.top = "-10000px"; // 画面外に隠す
      screenVideo.style.left = "-10000px";
      screenVideo.muted = true;
      screenVideo.playsInline = true;
      document.body.appendChild(screenVideo);
    }

    screenVideo.srcObject = stream;
    await screenVideo.play();

    const tracks = stream.getVideoTracks();
    if (tracks[0]) {
      // ブラウザ UI から「共有停止」された場合
      tracks[0].addEventListener("ended", () => {
        stopScreenCapture();
        captureMode = "whiteboard";
        updateCaptureButtons();
      });
    }

    // サーバーへ「画面共有開始」を通知したい場合
    socket.emit("student-screen-share-started", {
      classCode: currentClassCode
    });

    return true;
  } catch (err) {
    console.error("screen capture error", err);
    alert("画面共有がキャンセルされました。");
    return false;
  }
}

if (modeWhiteboardBtn) {
  modeWhiteboardBtn.addEventListener("click", () => {
    if (captureMode === "whiteboard") return;
    stopScreenCapture();
    captureMode = "whiteboard";
    updateCaptureButtons();
    sendWhiteboardThumbnail();
  });
}

if (modeScreenBtn) {
  modeScreenBtn.addEventListener("click", async () => {
    if (captureMode === "screen") return;
    if (!currentClassCode || !nickname) {
      alert("先にクラスに参加してください。");
      captureMode = "whiteboard";
      updateCaptureButtons();
      return;
    }
    const ok = await startScreenCapture();
    if (ok) {
      captureMode = "screen";
      updateCaptureButtons();
      sendWhiteboardThumbnail();
    } else {
      captureMode = "whiteboard";
      updateCaptureButtons();
    }
  });
}

updateCaptureButtons();

// ========= サムネイル送信（ホワイトボード / 画面共有） =========
function sendWhiteboardThumbnail() {
  if (!currentClassCode || !nickname) return;

  // 画面共有モード
  if (captureMode === "screen") {
    if (!screenStream || !screenVideo || screenVideo.readyState < 2) return;

    const track = screenStream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    const vw = screenVideo.videoWidth || settings.width || window.screen.width;
    const vh = screenVideo.videoHeight || settings.height || window.screen.height;
    if (!vw || !vh) return;

    const thumbWidth = 320;
    const ratio = vh / vw;
    const thumbHeight = Math.round(thumbWidth * ratio);

    const off = document.createElement("canvas");
    off.width = thumbWidth;
    off.height = thumbHeight;
    const ctx = off.getContext("2d");
    ctx.imageSmoothingEnabled = true;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, off.width, off.height);

    ctx.drawImage(
      screenVideo,
      0,
      0,
      vw,
      vh,
      0,
      0,
      thumbWidth,
      thumbHeight
    );

    const dataUrl = off.toDataURL("image/jpeg", 0.6);

    socket.emit("student-thumbnail", {
      classCode: currentClassCode,
      nickname,
      dataUrl
    });

    return;
  }

  // ホワイトボードモード
  const srcCanvas = studentCanvas;
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return;

  const thumbWidth = 320;
  const ratio = srcCanvas.height / srcCanvas.width;
  const thumbHeight = Math.round(thumbWidth * ratio);

  const off = document.createElement("canvas");
  off.width = thumbWidth;
  off.height = thumbHeight;
  const ctx = off.getContext("2d");
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, off.width, off.height);

  ctx.drawImage(
    srcCanvas,
    0,
    0,
    srcCanvas.width,
    srcCanvas.height,
    0,
    0,
    thumbWidth,
    thumbHeight
  );

  const dataUrl = off.toDataURL("image/jpeg", 0.6);

  socket.emit("student-thumbnail", {
    classCode: currentClassCode,
    nickname,
    dataUrl
  });
}

// ========= 高画質送信（ホワイトボード / 画面共有） =========
function sendHighres() {
  if (!currentClassCode || !nickname) return;

  // 画面共有モード
  if (captureMode === "screen") {
    if (!screenStream || !screenVideo || screenVideo.readyState < 2) return;

    const track = screenStream.getVideoTracks()[0];
    const settings = track ? track.getSettings() : {};
    const vw = screenVideo.videoWidth || settings.width || window.screen.width;
    const vh = screenVideo.videoHeight || settings.height || window.screen.height;
    if (!vw || !vh) return;

    const maxWidth = 1280;
    const ratio = vh / vw;
    const targetWidth = maxWidth;
    const targetHeight = Math.round(targetWidth * ratio);

    const off = document.createElement("canvas");
    off.width = targetWidth;
    off.height = targetHeight;
    const ctx = off.getContext("2d");
    ctx.imageSmoothingEnabled = true;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, off.width, off.height);

    ctx.drawImage(
      screenVideo,
      0,
      0,
      vw,
      vh,
      0,
      0,
      targetWidth,
      targetHeight
    );

    const dataUrl = off.toDataURL("image/jpeg", 0.85);

    socket.emit("student-highres", {
      classCode: currentClassCode,
      nickname,
      dataUrl
    });

    return;
  }

  // ホワイトボードモード
  const srcCanvas = studentCanvas;
  if (!srcCanvas || !srcCanvas.width || !srcCanvas.height) return;

  const maxWidth = 1280;
  const ratio = srcCanvas.height / srcCanvas.width;
  const targetWidth = maxWidth;
  const targetHeight = Math.round(targetWidth * ratio);

  const off = document.createElement("canvas");
  off.width = targetWidth;
  off.height = targetHeight;
  const ctx = off.getContext("2d");
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, off.width, off.height);

  ctx.drawImage(
    srcCanvas,
    0,
    0,
    srcCanvas.width,
    srcCanvas.height,
    0,
    0,
    targetWidth,
    targetHeight
  );

  const dataUrl = off.toDataURL("image/jpeg", 0.85);

  socket.emit("student-highres", {
    classCode: currentClassCode,
    nickname,
    dataUrl
  });
}

// 教員側からの高画質リクエスト
socket.on("request-highres", () => {
  sendHighres();
});

// ========= キャプチャループ管理 =========
function restartCaptureLoop() {
  if (captureTimerId) {
    clearInterval(captureTimerId);
    captureTimerId = null;
  }
  captureTimerId = setInterval(() => {
    sendWhiteboardThumbnail();
  }, CAPTURE_INTERVAL_MS);
}

window.addEventListener("beforeunload", () => {
  if (captureTimerId) {
    clearInterval(captureTimerId);
  }
  stopScreenCapture();
});

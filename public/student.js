// student.js
import { Whiteboard } from "./whiteboard.js";

const socket = io();

// DOM要素
const classCodeInput = document.getElementById("classCodeInput");
const nicknameInput = document.getElementById("nicknameInput");
const joinBtn = document.getElementById("joinBtn");

const headerClassCode = document.getElementById("headerClassCode");
const headerNickname = document.getElementById("headerNickname");

const pdfImageInput = document.getElementById("pdfImageInput");
const clearBoardBtn = document.getElementById("clearBoardBtn");
const penColorInput = document.getElementById("penColor");
const penWidthSelect = document.getElementById("penWidth");
const savePngBtn = document.getElementById("savePngBtn");

const studentCanvas = document.getElementById("studentCanvas");

const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");

// ツールボタン
const toolPenBtn = document.getElementById("toolPen");
const toolHighlighterBtn = document.getElementById("toolHighlighter");
const toolEraserBtn = document.getElementById("toolEraser");
const toolTextBtn = document.getElementById("toolText");
const toolStickyBtn = document.getElementById("toolSticky");
const toolRectBtn = document.getElementById("toolRect");
const toolEllipseBtn = document.getElementById("toolEllipse");
const toolSelectBtn = document.getElementById("toolSelect");

const allToolButtons = [
  toolPenBtn,
  toolHighlighterBtn,
  toolEraserBtn,
  toolTextBtn,
  toolStickyBtn,
  toolRectBtn,
  toolEllipseBtn,
  toolSelectBtn
];

// 左パネル
const studentSidePanel = document.getElementById("studentSidePanel");
const studentSideToggle = document.getElementById("studentSideToggle");
const studentPanelOpen = document.getElementById("studentPanelOpen");

// 状態
let currentClassCode = null;
let nickname = null;
let captureTimerId = null;
const CAPTURE_INTERVAL_MS = 5000;

// キャンバスリサイズ（DPR 対応）
function resizeCanvasToContainer(canvas, wb) {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // 見た目のサイズ（CSS px）
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";

  // 内部解像度（実ピクセル）
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  if (wb) {
    wb.dpr = dpr;
    wb.render();
  }
}

// ホワイトボード生成
const wb = new Whiteboard({ canvas: studentCanvas });

// 初期リサイズ
resizeCanvasToContainer(studentCanvas, wb);

// ウィンドウリサイズ対応
window.addEventListener("resize", () => {
  resizeCanvasToContainer(studentCanvas, wb);
});

// ===== テキスト設定 UI =====
const textStyleSection = document.getElementById("textStyleSection");
const textFontFamily = document.getElementById("textFontFamily");
const textFontSize = document.getElementById("textFontSize");
const textBoldToggle = document.getElementById("textBoldToggle");

wb.onSelectionChange = info => {
  if (!info || info.kind !== "text") {
    textStyleSection.classList.add("hidden");
    textBoldToggle.classList.remove("primary");
    return;
  }
  textStyleSection.classList.remove("hidden");
  textFontFamily.value = info.fontFamily || "system-ui";
  textFontSize.value = info.fontSize || 16;
  textBoldToggle.classList.toggle("primary", info.bold);
};

textFontFamily.addEventListener("change", () => {
  wb.setSelectedTextStyle({
    fontFamily: textFontFamily.value
  });
});
textFontSize.addEventListener("change", () => {
  const size = parseInt(textFontSize.value, 10) || 16;
  wb.setSelectedTextStyle({
    fontSize: size
  });
});
textBoldToggle.addEventListener("click", () => {
  const nowBold = textBoldToggle.classList.toggle("primary");
  wb.setSelectedTextStyle({
    bold: nowBold
  });
});

// ペン設定（蛍光ペンの色も同期）
if (penColorInput) {
  penColorInput.addEventListener("input", () => {
    const color = penColorInput.value;
    const width = parseInt(penWidthSelect.value, 10) || 3;
    wb.setPen(color, width);
    if (wb.setHighlighterColor) {
      wb.setHighlighterColor(color);
    }
  });
}

if (penWidthSelect) {
  penWidthSelect.addEventListener("change", () => {
    const color = penColorInput ? penColorInput.value : "#000000";
    const width = parseInt(penWidthSelect.value, 10) || 3;
    wb.setPen(color, width);
  });
}

// ツール切り替え
function setTool(tool) {
  wb.setTool(tool);
  allToolButtons.forEach(btn => {
    if (!btn) return;
    const id = btn.id;
    const match =
      (tool === "pen" && id === "toolPen") ||
      (tool === "highlighter" && id === "toolHighlighter") ||
      (tool === "eraser" && id === "toolEraser") ||
      (tool === "text" && id === "toolText") ||
      (tool === "sticky" && id === "toolSticky") ||
      (tool === "rect" && id === "toolRect") ||
      (tool === "ellipse" && id === "toolEllipse") ||
      (tool === "select" && id === "toolSelect");
    btn.classList.toggle("primary", match);
  });
}

toolPenBtn.addEventListener("click", () => setTool("pen"));
toolHighlighterBtn.addEventListener("click", () => setTool("highlighter"));
toolEraserBtn.addEventListener("click", () => setTool("eraser"));
toolTextBtn.addEventListener("click", () => setTool("text"));
toolStickyBtn.addEventListener("click", () => setTool("sticky"));
toolRectBtn.addEventListener("click", () => setTool("rect"));
toolEllipseBtn.addEventListener("click", () => setTool("ellipse"));
toolSelectBtn.addEventListener("click", () => setTool("select"));

setTool("pen");

// 左パネル折りたたみ
studentSideToggle.addEventListener("click", () => {
  studentSidePanel.classList.toggle("collapsed");
  setTimeout(() => {
    resizeCanvasToContainer(studentCanvas, wb);
  }, 260);
});

studentPanelOpen.addEventListener("click", () => {
  studentSidePanel.classList.remove("collapsed");
  setTimeout(() => {
    resizeCanvasToContainer(studentCanvas, wb);
  }, 260);
});

// 全消去
if (clearBoardBtn) {
  clearBoardBtn.addEventListener("click", () => {
    if (confirm("ホワイトボードを全て消去しますか？")) {
      wb.clearAll();
    }
  });
}

// PDF / 画像読み込み
if (pdfImageInput) {
  pdfImageInput.addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.type === "application/pdf") {
        await wb.loadPdfFile(file);
      } else if (file.type.startsWith("image/")) {
        await wb.loadImageFile(file);
      } else {
        alert("PDF または画像ファイルを選択してください。");
      }
    } catch (err) {
      console.error(err);
      alert("ファイルの読み込み中にエラーが発生しました。");
    } finally {
      pdfImageInput.value = "";
    }
  });
}

// PNG保存
if (savePngBtn) {
  savePngBtn.addEventListener("click", () => {
    const dataUrl = wb.exportPngDataUrl();
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `whiteboard-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.png`;
    a.click();
  });
}

// ズームボタン
zoomInBtn.addEventListener("click", () => wb.zoomAtCanvasCenter(1.1));
zoomOutBtn.addEventListener("click", () => wb.zoomAtCanvasCenter(1 / 1.1));

// Ctrl+Z / Ctrl+C / Ctrl+V / Delete / Backspace
window.addEventListener("keydown", e => {
  const target = e.target;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  ) {
    return; // 入力中のフォームには干渉しない
  }

  const key = e.key.toLowerCase();

  // Undo
  if ((e.ctrlKey || e.metaKey) && key === "z") {
    e.preventDefault();
    wb.undoLast();
    return;
  }

  // コピー（内部クリップボード）
  if ((e.ctrlKey || e.metaKey) && key === "c") {
    e.preventDefault();
    wb.copySelection();
    return;
  }

  // ペースト
  if ((e.ctrlKey || e.metaKey) && key === "v") {
    // 内部クリップボードがあれば、そちらを優先してペースト
    if (wb.clipboard) {
      e.preventDefault();
      wb.pasteSelection();
      return;
    }
    // 何もなければデフォルト動作 → window "paste" イベント経由でテキスト/URL 貼り付け
  }

  // Delete / Backspace で選択オブジェクト削除
  if (key === "delete" || key === "backspace") {
    if (wb.selectedObj) {
      e.preventDefault();
      wb.deleteSelection();
    }
  }
});


// クリップボードからの貼り付け（テキスト / URL）
// ※入力中のフォームには干渉しない
window.addEventListener("paste", e => {
  const target = e.target;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  ) {
    return; // 通常のフォーム貼り付けはそのまま
  }

  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!text) return;

  // ここでは e.preventDefault() してもいいし、しなくても OK
  // （もう Ctrl+V を keydown で止めるケースではここに来ない）

  const value = text.trim();

  // ごく簡単な URL 判定（http/https から始まる）
  const urlPattern = /^(https?:\/\/[^\s]+)$/i;

  if (urlPattern.test(value)) {
    // URL → リンクオブジェクト
    wb.pasteLink(value);
  } else {
    // それ以外のテキスト → テキストボックス
    wb.pastePlainText(value);
  }
});



// --- クラス参加＆送信周り ---

joinBtn.addEventListener("click", () => {
  const classCode = classCodeInput.value.trim();
  const nick = nicknameInput.value.trim();
  if (!classCode || !nick) {
    alert("クラスコードとニックネームを入力してください。");
    return;
  }
  currentClassCode = classCode;
  nickname = nick;

  socket.emit("join-student", { classCode, nickname });

  if (headerClassCode) headerClassCode.textContent = classCode;
  if (headerNickname) headerNickname.textContent = nickname;

  restartCaptureLoop();
  sendWhiteboardThumbnail();
});

// サムネイル送信
function sendWhiteboardThumbnail() {
  if (!currentClassCode || !nickname) return;

  const srcCanvas = studentCanvas;
  if (!srcCanvas.width || !srcCanvas.height) return;

  const thumbWidth = 320;
  const ratio = srcCanvas.height / srcCanvas.width;
  const thumbHeight = Math.round(thumbWidth * ratio);

  const off = document.createElement("canvas");
  off.width = thumbWidth;
  off.height = thumbHeight;
  const ctx = off.getContext("2d");
  ctx.imageSmoothingEnabled = true;

  // ★ 追加：背景を白で塗る
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

// 高画質送信
function sendHighres() {
  if (!currentClassCode || !nickname) return;

  const srcCanvas = studentCanvas;
  if (!srcCanvas.width || !srcCanvas.height) return;

  const maxWidth = 1280;
  const ratio = srcCanvas.height / srcCanvas.width;
  const targetWidth = maxWidth;
  const targetHeight = Math.round(targetWidth * ratio);

  const off = document.createElement("canvas");
  off.width = targetWidth;
  off.height = targetHeight;
  const ctx = off.getContext("2d");
  ctx.imageSmoothingEnabled = true;

  // ★ 追加：背景を白で塗る
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

socket.on("request-highres", () => {
  sendHighres();
});

// キャプチャループ管理
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
});

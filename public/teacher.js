// teacher.js
import { Whiteboard } from "./whiteboard.js";

const socket = io();
const boardView = document.getElementById("boardView");
const studentsView = document.getElementById("studentsView");
const showBoardBtn = document.getElementById("showBoardBtn");
const showStudentsBtn = document.getElementById("showStudentsBtn");

function showBoardView() {
  boardView.classList.remove("hidden");
  studentsView.classList.add("hidden");
  showBoardBtn.classList.add("primary");
  showStudentsBtn.classList.remove("primary");
}

function showStudentsView() {
  boardView.classList.add("hidden");
  studentsView.classList.remove("hidden");
  showBoardBtn.classList.remove("primary");
  showStudentsBtn.classList.add("primary");
}

showBoardBtn.addEventListener("click", showBoardView);
showStudentsBtn.addEventListener("click", showStudentsView);
showBoardView(); // デフォルトはホワイトボード

// --- クラスコード参加 ---
const classCodeInput = document.getElementById("classCodeInput");
const joinBtn = document.getElementById("joinBtn");
const studentsInfo = document.getElementById("studentsInfo");
const tileGrid = document.getElementById("tileGrid");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalImage = document.getElementById("modalImage");
const modalTitle = document.getElementById("modalTitle");
const modalCloseBtn = document.getElementById("modalCloseBtn");

let currentClassCode = null;

joinBtn.addEventListener("click", () => {
  const classCode = classCodeInput.value.trim();
  if (!classCode) {
    alert("クラスコードを入力してください。");
    return;
  }
  currentClassCode = classCode;
  socket.emit("join-teacher", { classCode });
});

// --- ホワイトボード初期化 ---
const teacherCanvas = document.getElementById("teacherCanvas");
const wb = new Whiteboard({ canvas: teacherCanvas });

// ★ 先に wb を作ってから、リサイズ関数に渡す
resizeCanvasToContainer(teacherCanvas, wb);

// リサイズ対応
window.addEventListener("resize", () => {
  resizeCanvasToContainer(teacherCanvas, wb);
});


// ===== テキスト設定 UI =====
const textStyleSection = document.getElementById("textStyleSection");
const textFontFamily = document.getElementById("textFontFamily");
const textFontSize = document.getElementById("textFontSize");
const textBoldToggle = document.getElementById("textBoldToggle");

// 選択状態が変わったときに呼ばれる
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

// 値変更 → Whiteboard に反映
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



// 左パネル折りたたみ
const teacherSidePanel = document.getElementById("teacherSidePanel");
const teacherSideToggle = document.getElementById("teacherSideToggle");
const teacherPanelOpen = document.getElementById("teacherPanelOpen");

teacherSideToggle.addEventListener("click", () => {
  teacherSidePanel.classList.toggle("collapsed");
  setTimeout(() => {
    resizeCanvasToContainer(teacherCanvas);
    wb.render();
  }, 260);
});

teacherPanelOpen.addEventListener("click", () => {
  teacherSidePanel.classList.remove("collapsed");
  setTimeout(() => {
    resizeCanvasToContainer(teacherCanvas);
    wb.render();
  }, 260);
});

// ズームボタン
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
zoomInBtn.addEventListener("click", () => wb.zoomAtCanvasCenter(1.1));
zoomOutBtn.addEventListener("click", () => wb.zoomAtCanvasCenter(1 / 1.1));

// リサイズ対応
window.addEventListener("resize", () => {
  resizeCanvasToContainer(teacherCanvas);
  wb.render();
});

function resizeCanvasToContainer(canvas, wb) {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  // CSS 上の大きさ（見た目のサイズ）
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";

  // 実際のピクセル数（内部解像度）
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  if (wb) {
    wb.dpr = dpr;
    wb.render();
  }
}

// ファイル読み込み
document
  .getElementById("pdfImageInput")
  .addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.type === "application/pdf") {
        await wb.loadPdfFile(file);
      } else if (file.type.startsWith("image/")) {
        await wb.loadImageFile(file);
      } else {
        alert("PDFまたは画像ファイルを選択してください。");
      }
    } finally {
      e.target.value = "";
    }
  });

// ペン設定（蛍光ペンの色も同期）
const penColorInput = document.getElementById("penColor");
const penWidthSelect = document.getElementById("penWidth");

penColorInput.addEventListener("input", e => {
  const color = e.target.value;
  const width = parseInt(penWidthSelect.value, 10) || 3;
  wb.setPen(color, width);
  if (wb.setHighlighterColor) {
    wb.setHighlighterColor(color);
  }
});

penWidthSelect.addEventListener("change", e => {
  const width = parseInt(e.target.value, 10) || 3;
  const color = penColorInput.value || "#000000";
  wb.setPen(color, width);
});

// 全消去
document.getElementById("clearBoardBtn").addEventListener("click", () => {
  if (confirm("ホワイトボードを全消去しますか？")) {
    wb.clearAll();
  }
});

// --- 生徒一覧・タイル関連 ---
let latestThumbnails = {}; // { socketId: { nickname, dataUrl } }

socket.on("student-list-update", list => {
  if (studentsInfo) {
    studentsInfo.textContent = `接続中の生徒: ${list.length}人`;
  }
});

socket.on("student-thumbnail", ({ socketId, nickname, dataUrl }) => {
  latestThumbnails[socketId] = { nickname, dataUrl };
  renderTiles();
});

socket.on("student-highres", ({ socketId, nickname, dataUrl }) => {
  modalTitle.textContent = `${nickname} さんの画面（中画質）`;
  modalImage.src = dataUrl;
  modalBackdrop.classList.add("show");
});

function renderTiles() {
  tileGrid.innerHTML = "";
  Object.entries(latestThumbnails).forEach(([socketId, info]) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    const img = document.createElement("img");
    img.src = info.dataUrl;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = info.nickname;

    tile.appendChild(img);
    tile.appendChild(meta);
    tile.addEventListener("click", () => {
      if (!currentClassCode) return;
      socket.emit("request-highres", {
        classCode: currentClassCode,
        studentSocketId: socketId
      });
    });

    tileGrid.appendChild(tile);
  });
}

// モーダル
modalCloseBtn.addEventListener("click", () => {
  modalBackdrop.classList.remove("show");
});
modalBackdrop.addEventListener("click", e => {
  if (e.target === modalBackdrop) {
    modalBackdrop.classList.remove("show");
  }
});

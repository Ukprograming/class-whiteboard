// public/js/teacher.js
import { initBoardUI } from "./board-ui.js";

// 共通ホワイトボード UI 初期化
const whiteboard = initBoardUI();

// 共通ホワイトボード UI 初期化
const whiteboard = initBoardUI();

// === GAS Web アプリの URL（自分の URL に差し替える） ===
const GAS_ENDPOINT = "https://script.google.com/a/macros/hokkaido-c.ed.jp/s/AKfycbzhJ4hbzCVMbFYW6pP5ZLBK5A2OSH-yoNofg64pt9FMC57c5-z_KeD5zB6DW0ehzMB3hw/exec";

// 教員用 保存 / 読み込みボタン（HTML 側に用意しておく）
const teacherSaveBoardBtn = document.getElementById("teacherSaveBoardBtn");
const teacherLoadBoardBtn = document.getElementById("teacherLoadBoardBtn");

// ========= socket.io =========
const socket = io();

// 上部 UI
const classCodeInput = document.getElementById("teacherClassCodeInput");
const startClassBtn = document.getElementById("teacherStartClassBtn");
const statusLabel = document.getElementById("teacherStatus");

// ビュー切り替え関連
const boardContainer = document.getElementById("boardContainer");
const studentViewContainer = document.getElementById("studentViewContainer");
const teacherModeWhiteboard = document.getElementById("teacherModeWhiteboard");
const teacherModeStudentView = document.getElementById("teacherModeStudentView");

// 生徒タイル & モーダル
const studentsInfo = document.getElementById("studentsInfo");
const tileGrid = document.getElementById("tileGrid");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalImage = document.getElementById("modalImage");
const modalTitle = document.getElementById("modalTitle");
const modalCloseBtn = document.getElementById("modalCloseBtn");

let currentClassCode = null;
let latestThumbnails = {}; // { socketId: { nickname, dataUrl } }

// ========= ホワイトボード 保存 / 読み込み（教員） =========

// 保存（クラスコードごとに保存する想定）
async function teacherSaveBoard() {
  if (!currentClassCode) {
    alert("先にクラスコードを入力して「クラス開始」してください。");
    return;
  }
  if (!whiteboard || typeof whiteboard.exportBoardData !== "function") {
    alert("ホワイトボードの状態を取得できません。");
    return;
  }

  const boardData = whiteboard.exportBoardData();

  const payload = {
    action: "saveBoard",
    role: "teacher",
    classCode: currentClassCode,
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

// 読み込み（そのクラスの最新ボードを読み込む想定）
async function teacherLoadBoard() {
  if (!currentClassCode) {
    alert("先にクラスコードを入力して「クラス開始」してください。");
    return;
  }
  if (!whiteboard || typeof whiteboard.importBoardData !== "function") {
    alert("ホワイトボードに読み込めません。");
    return;
  }

  const url = `${GAS_ENDPOINT}?action=loadBoard&role=teacher&classCode=${encodeURIComponent(
    currentClassCode
  )}`;

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
if (teacherSaveBoardBtn) {
  teacherSaveBoardBtn.addEventListener("click", teacherSaveBoard);
}
if (teacherLoadBoardBtn) {
  teacherLoadBoardBtn.addEventListener("click", teacherLoadBoard);
}

// ========= クラス開始（教員として参加） =========
if (startClassBtn && classCodeInput) {
  startClassBtn.addEventListener("click", () => {
    const code = classCodeInput.value.trim();
    if (!code) {
      alert("クラスコードを入力してください。");
      return;
    }

    currentClassCode = code;

    // 既存サーバー実装用（あなたの server.js で使っているイベント）
    socket.emit("join-teacher", { classCode: code });

    // 修正版 teacher.js 用のイベント（サーバー側で使うなら実装）
    socket.emit("teacher-start-class", { classCode: code });

    if (statusLabel) {
      statusLabel.textContent = `クラスコード ${code} で待機中…`;
    }
  });
}

// teacher-class-started に対応しておく（サーバー側で実装していれば反映される）
socket.on("teacher-class-started", payload => {
  if (statusLabel && payload?.classCode) {
    statusLabel.textContent = `クラス開始中: ${payload.classCode}`;
  }
});

// ========= ビュー切り替え：ホワイトボード / 生徒画面 =========

function setTeacherViewMode(mode) {
  if (!boardContainer || !studentViewContainer) return;

  if (mode === "whiteboard") {
    // ホワイトボードを表示
    boardContainer.classList.remove("hidden");
    studentViewContainer.classList.add("hidden");

    teacherModeWhiteboard?.classList.add("active");
    teacherModeStudentView?.classList.remove("active");

    // サイドバーを表示（通常モード）
    document.body.classList.remove("teacher-student-view");
  } else {
    // 生徒画面タイルを表示（ホワイトボードは使わない）
    boardContainer.classList.add("hidden");
    studentViewContainer.classList.remove("hidden");

    teacherModeWhiteboard?.classList.remove("active");
    teacherModeStudentView?.classList.add("active");

    // サイドバーを隠して、右側エリアを画面いっぱいに
    document.body.classList.add("teacher-student-view");
  }
}

if (teacherModeWhiteboard) {
  teacherModeWhiteboard.addEventListener("click", () => {
    setTeacherViewMode("whiteboard");
  });
}

if (teacherModeStudentView) {
  teacherModeStudentView.addEventListener("click", () => {
    setTeacherViewMode("student");
  });
}

// デフォルトはホワイトボード
setTeacherViewMode("whiteboard");

// ========= 生徒一覧・タイル関連 =========

// 生徒数
socket.on("student-list-update", list => {
  if (studentsInfo) {
    studentsInfo.textContent = `接続中の生徒: ${list.length}人`;
  }
});

// サムネイル受信
socket.on("student-thumbnail", ({ socketId, nickname, dataUrl }) => {
  latestThumbnails[socketId] = { nickname, dataUrl };
  renderTiles();
});

// 中画質画像受信 → モーダル表示
socket.on("student-highres", ({ socketId, nickname, dataUrl }) => {
  if (!modalBackdrop || !modalImage || !modalTitle) return;
  modalTitle.textContent = `${nickname} さんの画面`;
  modalImage.src = dataUrl;
  modalBackdrop.classList.add("show");
});

// タイル描画
function renderTiles() {
  if (!tileGrid) return;

  tileGrid.innerHTML = "";
  Object.entries(latestThumbnails).forEach(([socketId, info]) => {
    const tile = document.createElement("div");
    tile.className = "tile";

    const img = document.createElement("img");
    img.src = info.dataUrl;
    img.alt = `${info.nickname} さんの画面プレビュー`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = info.nickname;

    tile.appendChild(img);
    tile.appendChild(meta);

    // クリックで中画質リクエスト
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

// モーダルの閉じる処理
if (modalBackdrop && modalCloseBtn) {
  modalCloseBtn.addEventListener("click", () => {
    modalBackdrop.classList.remove("show");
  });

  modalBackdrop.addEventListener("click", e => {
    if (e.target === modalBackdrop) {
      modalBackdrop.classList.remove("show");
    }
  });
}

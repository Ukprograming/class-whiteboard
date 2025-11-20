// public/js/student.js
import { initBoardUI } from "./board-ui.js";

// 共通ホワイトボード UI 初期化
const whiteboard = initBoardUI();

// === API ベースパス（server.js の /api/board プロキシを叩く） ===
const BOARD_API_BASE = "/api/board";

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

const statusLabel = document.getElementById("studentStatus") || null;

const headerClassCode = document.getElementById("headerClassCode");
const headerNickname = document.getElementById("headerNickname");

// 共有モードボタン（新旧両対応）
const modeWhiteboardBtn =
  document.getElementById("studentModeWhiteboard") ||
  document.getElementById("shareWhiteboardBtn");
const modeScreenBtn =
  document.getElementById("studentModeScreen") ||
  document.getElementById("shareScreenBtn");
const modeNotebookBtn = document.getElementById("studentModeNotebook");

// レイアウト要素
const mainLayoutEl = document.querySelector(".main-layout");
const notebookLayoutEl = document.getElementById("notebookLayout");

// 左パネル（旧 UI のみ）
const studentSidePanel = document.getElementById("studentSidePanel");
const studentSideToggle = document.getElementById("studentSideToggle");
const studentPanelOpen = document.getElementById("studentPanelOpen");

// PNG 保存ボタン
const savePngBtn = document.getElementById("savePngBtn");

// ========= チャット UI 要素（生徒） =========
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatNotifyDot = document.getElementById("chatNotifyDot");
const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

// チャット状態
let chatPanelOpen = false;
let chatUnreadCount = 0;
// 生徒は教員との1対1のみ
let chatMessages = []; // [ { from:'me'|'them', nickname, text, timestamp } ]

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
// 画面表示モード：'whiteboard' | 'screen' | 'notebook'
let viewMode = "whiteboard";
let captureIntervalIdNotebook = null; // ノート提出用のキャプチャタイマー
let currentStream = null; // ノート提出用カメラの MediaStream

let screenStream = null;
let screenVideo = null;

// ========= Explorer風 モーダル用の状態（生徒用） =========
let boardDialogOverlay = null;          // オーバーレイ要素
let boardDialogMode = "save";           // "save" or "load"
let boardDialogSelectedFolder = "";     // 選択中フォルダ（自分の役割フォルダ内のサブフォルダパス）
let boardDialogSelectedFileId = null;   // 選択中ファイルID
let lastUsedFolderPath = "";            // 直近に使ったフォルダを記憶

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

/* ========================================
   生徒用 ホワイトボード保存 / 読み込み
   Explorer 風ダイアログ
   ======================================== */

// ---- API ヘルパー ----

// 自分の役割フォルダ（classCode + nickname）配下のフォルダ一覧
async function fetchFolderList() {
  if (!currentClassCode || !nickname) {
    throw new Error("クラスコードとニックネームが設定されていません。");
  }

  const res = await fetch(`${BOARD_API_BASE}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "listFolders",
      role: "student",
      classCode: currentClassCode,
      nickname
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("folders API error", res.status, text);
    throw new Error(`フォルダ一覧 API が失敗しました (status=${res.status})`);
  }

  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.message || "フォルダ一覧の取得に失敗しました。");
  }

  const folders = json.folders || [];
  return folders.map(f => {
    const path = f.path || f.folderPath || "";
    const name = f.name || path || "(未命名フォルダ)";
    return { path, name };
  });
}

// 指定フォルダ内のファイル一覧取得
async function fetchFileList(folderPath) {
  if (!currentClassCode || !nickname) {
    throw new Error("クラスコードとニックネームが設定されていません。");
  }

  const res = await fetch(`${BOARD_API_BASE}/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "listBoards",
      role: "student",
      classCode: currentClassCode,
      nickname,
      folderPath: folderPath || ""
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("listBoards API error", res.status, text);
    throw new Error(`ファイル一覧 API が失敗しました (status=${res.status})`);
  }

  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.message || "ファイル一覧の取得に失敗しました。");
  }

  return json.files || [];
}

// ---- モーダル生成 / 表示・非表示 ----

function createBoardDialogIfNeeded() {
  if (boardDialogOverlay) return;

  boardDialogOverlay = document.createElement("div");
  boardDialogOverlay.id = "boardDialogOverlay";
  boardDialogOverlay.className = "board-dialog-overlay";

  boardDialogOverlay.innerHTML = `
    <div class="board-dialog">
      <div class="board-dialog-header">
        <span id="boardDialogTitle"></span>
        <button id="boardDialogCloseBtn" class="board-dialog-close">×</button>
      </div>

      <div class="board-dialog-body">
        <div class="board-dialog-left">
          <h3>フォルダ</h3>
          <ul id="boardDialogFolderList" class="board-dialog-list"></ul>
        </div>
        <div class="board-dialog-right">
          <h3>ファイル</h3>
          <ul id="boardDialogFileList" class="board-dialog-list"></ul>
        </div>
      </div>

      <div class="board-dialog-footer">
        <div id="boardDialogSaveArea">
          <label class="board-dialog-field">
            フォルダ名（新規も可）:
            <input id="boardDialogFolderInput" type="text" placeholder="例: 宿題/一次関数" />
          </label>
          <label class="board-dialog-field">
            ファイル名:
            <input id="boardDialogFileNameInput" type="text" placeholder="例: 今日のノート" />
          </label>
          <button id="boardDialogSaveBtn" class="topbar-btn">保存</button>
        </div>

        <div id="boardDialogLoadArea">
          <span class="board-dialog-hint">読み込みたいファイルを選択してください。</span>
          <button id="boardDialogLoadBtn" class="topbar-btn">読み込み</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(boardDialogOverlay);

  // 閉じるボタン
  const closeBtn = document.getElementById("boardDialogCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeBoardDialog();
    });
  }

  // 背景クリックで閉じる
  boardDialogOverlay.addEventListener("click", e => {
    if (e.target === boardDialogOverlay) {
      closeBoardDialog();
    }
  });

  // 保存ボタン
  const saveBtn = document.getElementById("boardDialogSaveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", onClickSaveConfirm);
  }

  // 読み込みボタン
  const loadBtn = document.getElementById("boardDialogLoadBtn");
  if (loadBtn) {
    loadBtn.addEventListener("click", onClickLoadConfirm);
  }
}

function openBoardDialog(mode) {
  if (!currentClassCode || !nickname) {
    alert("クラスに参加してから保存・読み込みを行ってください。");
    return;
  }
  if (!whiteboard || typeof whiteboard.exportBoardData !== "function") {
    alert("ホワイトボードが初期化されていません。");
    return;
  }

  boardDialogMode = mode === "load" ? "load" : "save";
  createBoardDialogIfNeeded();

  const titleEl = document.getElementById("boardDialogTitle");
  const saveArea = document.getElementById("boardDialogSaveArea");
  const loadArea = document.getElementById("boardDialogLoadArea");
  const folderInput = document.getElementById("boardDialogFolderInput");
  const fileNameInput = document.getElementById("boardDialogFileNameInput");

  if (titleEl) {
    titleEl.textContent = boardDialogMode === "save"
      ? "自分のホワイトボードを保存"
      : "自分のホワイトボードを開く";
  }

  if (saveArea && loadArea) {
    if (boardDialogMode === "save") {
      saveArea.style.display = "flex";
      loadArea.style.display = "none";
    } else {
      saveArea.style.display = "none";
      loadArea.style.display = "flex";
    }
  }

  // 選択状態初期化
  boardDialogSelectedFileId = null;
  boardDialogSelectedFolder = lastUsedFolderPath || "";

  if (folderInput) {
    if (boardDialogMode === "save") {
      folderInput.value = boardDialogSelectedFolder;
    } else {
      folderInput.value = "";
    }
  }
  if (fileNameInput && boardDialogMode === "save") {
    fileNameInput.value = "";
  }

  boardDialogOverlay.classList.add("show");

  // フォルダ一覧を読み込む
  reloadFolderList();
}

function closeBoardDialog() {
  if (boardDialogOverlay) {
    boardDialogOverlay.classList.remove("show");
  }
}

// ---- フォルダ & ファイル一覧の描画 ----

async function reloadFolderList() {
  const folderListEl = document.getElementById("boardDialogFolderList");
  const fileListEl = document.getElementById("boardDialogFileList");
  if (!folderListEl || !fileListEl) return;

  folderListEl.innerHTML = `<li>読み込み中...</li>`;
  fileListEl.innerHTML = "";

  try {
    const folders = await fetchFolderList();

    folderListEl.innerHTML = "";

    // ルート（自分の役割フォルダ直下）を一つ追加
    const rootLi = document.createElement("li");
    rootLi.textContent = "(自分のフォルダ直下)";
    rootLi.dataset.folderPath = "";
    rootLi.classList.add("board-dialog-folder-item");
    if (!boardDialogSelectedFolder) {
      rootLi.classList.add("selected");
    }
    rootLi.addEventListener("click", () => {
      selectFolder("");
    });
    folderListEl.appendChild(rootLi);

    folders.forEach(f => {
      const li = document.createElement("li");
      li.textContent = f.name;
      li.dataset.folderPath = f.path;
      li.classList.add("board-dialog-folder-item");
      if (f.path === boardDialogSelectedFolder) {
        li.classList.add("selected");
      }
      li.addEventListener("click", () => {
        selectFolder(f.path);
      });
      folderListEl.appendChild(li);
    });

    // 現在の選択フォルダでファイル一覧を読み込み
    reloadFileList(boardDialogSelectedFolder);
  } catch (err) {
    console.error(err);
    alert("フォルダ一覧の取得中にエラーが発生しました。");
    folderListEl.innerHTML = `<li>フォルダ一覧の取得に失敗しました</li>`;
  }
}

async function reloadFileList(folderPath) {
  const fileListEl = document.getElementById("boardDialogFileList");
  const fileNameInput = document.getElementById("boardDialogFileNameInput");
  if (!fileListEl) return;

  fileListEl.innerHTML = `<li>読み込み中...</li>`;
  boardDialogSelectedFileId = null;

  try {
    const files = await fetchFileList(folderPath);

    fileListEl.innerHTML = "";

    if (files.length === 0) {
      const li = document.createElement("li");
      li.textContent = "このフォルダにはまだファイルがありません。";
      li.classList.add("board-dialog-file-empty");
      fileListEl.appendChild(li);
      return;
    }

    files.forEach(file => {
      const li = document.createElement("li");
      li.classList.add("board-dialog-file-item");
      li.dataset.fileId = file.fileId;

      const dateStr = file.lastUpdated
        ? new Date(file.lastUpdated).toLocaleString()
        : "";

      li.textContent = dateStr
        ? `${file.fileName}（${dateStr}）`
        : file.fileName;

      li.addEventListener("click", () => {
        Array.from(fileListEl.querySelectorAll(".board-dialog-file-item")).forEach(el =>
          el.classList.remove("selected")
        );
        li.classList.add("selected");

        boardDialogSelectedFileId = file.fileId;

        if (boardDialogMode === "save" && fileNameInput) {
          fileNameInput.value = file.fileName;
        }
      });

      fileListEl.appendChild(li);
    });
  } catch (err) {
    console.error(err);
    alert("ファイル一覧の取得中にエラーが発生しました。");
    fileListEl.innerHTML = `<li>ファイル一覧の取得に失敗しました</li>`;
  }
}

function selectFolder(folderPath) {
  boardDialogSelectedFolder = folderPath || "";
  lastUsedFolderPath = boardDialogSelectedFolder;

  const folderListEl = document.getElementById("boardDialogFolderList");
  const folderInput = document.getElementById("boardDialogFolderInput");

  if (folderListEl) {
    Array.from(folderListEl.querySelectorAll(".board-dialog-folder-item")).forEach(el =>
      el.classList.remove("selected")
    );
    const target = Array.from(folderListEl.querySelectorAll(".board-dialog-folder-item")).find(
      el => (el.dataset.folderPath || "") === boardDialogSelectedFolder
    );
    if (target) {
      target.classList.add("selected");
    }
  }

  if (folderInput && boardDialogMode === "save") {
    folderInput.value = boardDialogSelectedFolder;
  }

  reloadFileList(boardDialogSelectedFolder);
}

// ---- 保存 / 読み込みの実処理 ----

async function studentSaveBoardInternal(folderPath, fileName) {
  if (!currentClassCode || !nickname) {
    alert("クラスに参加してから保存してください。");
    return;
  }
  if (!whiteboard || typeof whiteboard.exportBoardData !== "function") {
    alert("ホワイトボードの状態を取得できません。");
    return;
  }

  const boardData = whiteboard.exportBoardData();

  let finalFileName = (fileName || "").trim();
  if (!finalFileName) {
    finalFileName = new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", "_")
      .replace(/:/g, "-"); // 例: 2025-11-07_10-30
  }

  const payload = {
    action: "saveBoard",
    role: "student",
    classCode: currentClassCode,
    nickname,
    folderPath: (folderPath || "").trim(),
    fileName: finalFileName,
    boardData
  };

  try {
    const res = await fetch(`${BOARD_API_BASE}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await res.json().catch(() => ({}));
    alert(json.message || "ホワイトボードを保存しました。");
    closeBoardDialog();
  } catch (err) {
    console.error(err);
    alert("ホワイトボードの保存に失敗しました。");
  }
}

async function studentLoadBoardInternal(folderPath, fileId) {
  if (!currentClassCode || !nickname) {
    alert("クラスに参加してから読み込んでください。");
    return;
  }
  if (!whiteboard || typeof whiteboard.importBoardData !== "function") {
    alert("ホワイトボードに読み込めません。");
    return;
  }
  if (!fileId) {
    alert("読み込むファイルを選択してください。");
    return;
  }

  try {
    const res = await fetch(`${BOARD_API_BASE}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "loadBoard",
        role: "student",
        classCode: currentClassCode,
        nickname,
        folderPath: (folderPath || "").trim(),
        fileId
      })
    });

    const json = await res.json();
    if (!json.ok) {
      alert(json.message || "ホワイトボードの読み込みに失敗しました。");
      return;
    }

    if (!json.boardData) {
      alert("ボードデータが見つかりませんでした。");
      return;
    }

    whiteboard.importBoardData(json.boardData);
    alert("ホワイトボードを読み込みました。");
    closeBoardDialog();
  } catch (err) {
    console.error(err);
    alert("ホワイトボードの読み込み中にエラーが発生しました。");
  }
}

// ---- モーダル内ボタンのハンドラ ----

function onClickSaveConfirm() {
  const folderInput = document.getElementById("boardDialogFolderInput");
  const fileNameInput = document.getElementById("boardDialogFileNameInput");

  const folderPath =
    (folderInput && folderInput.value.trim()) ||
    boardDialogSelectedFolder ||
    "";

  const fileName = fileNameInput ? fileNameInput.value.trim() : "";

  studentSaveBoardInternal(folderPath, fileName);
}

function onClickLoadConfirm() {
  if (!boardDialogSelectedFileId) {
    alert("読み込みたいファイルを選択してください。");
    return;
  }
  const folderPath = boardDialogSelectedFolder || "";
  studentLoadBoardInternal(folderPath, boardDialogSelectedFileId);
}

// ---- ボタンにイベントを紐付け ----

if (studentSaveBoardBtn) {
  studentSaveBoardBtn.addEventListener("click", () => {
    openBoardDialog("save");
  });
}
if (studentLoadBoardBtn) {
  studentLoadBoardBtn.addEventListener("click", () => {
    openBoardDialog("load");
  });
}

/* ========================================
   PNG 保存
   ======================================== */

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

/* ========================================
   クラス参加
   ======================================== */

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

    // ホワイトボード側の参加
    socket.emit("join-student", { classCode: code, nickname: nick });

    // ノート提出側の参加（生徒IDはニックネームをそのまま利用）
    joinedNotebookClassCode = currentClassCode;
    notebookStudentId = nickname;
    socket.emit("joinAsStudent", {
      classCode: joinedNotebookClassCode,
      studentId: notebookStudentId
    });

    if (headerClassCode) headerClassCode.textContent = code;
    if (headerNickname) headerNickname.textContent = nick;
    // ツールバーが2行にならないよう、statusLabel には表示しない

    restartCaptureLoop();
    sendWhiteboardThumbnail();
  });
}

// ノート提出用のクラス情報
let joinedNotebookClassCode = null;
let notebookStudentId = null;

// 新イベント名に対応するステータス更新（生徒側のステータスはツールバーに表示しない）
socket.on("join-student", payload => {
  console.log("join-student", payload);
});

/* ========================================
   共有モード / 表示モード切り替え
   ======================================== */

function updateModeUI() {
  // ボタンの見た目
  if (modeWhiteboardBtn) {
    const active = viewMode === "whiteboard";
    modeWhiteboardBtn.classList.toggle("primary", active);
    modeWhiteboardBtn.classList.toggle("active", active);
  }
  if (modeScreenBtn) {
    const active = viewMode === "screen";
    modeScreenBtn.classList.toggle("primary", active);
    modeScreenBtn.classList.toggle("active", active);
  }
  if (modeNotebookBtn) {
    const active = viewMode === "notebook";
    modeNotebookBtn.classList.toggle("primary", active);
    modeNotebookBtn.classList.toggle("active", active);
  }

  // レイアウト切り替え
  if (mainLayoutEl && notebookLayoutEl) {
    if (viewMode === "notebook") {
      mainLayoutEl.style.display = "none";
      notebookLayoutEl.style.display = "flex";
    } else {
      mainLayoutEl.style.display = "";
      notebookLayoutEl.style.display = "none";
      // ホワイトボードレイアウトに戻ったときはキャンバスサイズを調整
      resizeCanvasToContainer();
    }
  }

  // チャット入力の有効/無効（ホワイトボードモードのときのみ）
  if (chatInput && chatSendBtn) {
    const disabled = viewMode !== "whiteboard";
    chatInput.disabled = disabled;
    chatSendBtn.disabled = disabled;
    chatInput.placeholder = disabled
      ? "ホワイトボード共有中のみ送信できます"
      : "メッセージを入力";
  }

  // ノート提出モード以外ではカメラ停止（通信量を抑える）
  if (viewMode !== "notebook") {
    stopNotebookCamera();
  }
}

function stopScreenCapture() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  if (screenVideo) {
    screenVideo.srcObject = null;
  }
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
      tracks[0].addEventListener("ended", () => {
        stopScreenCapture();
        captureMode = "whiteboard";
        viewMode = "whiteboard";
        updateModeUI();
      });
    }

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
    if (viewMode === "whiteboard") return;
    // 画面共有を停止
    if (captureMode === "screen") {
      stopScreenCapture();
      captureMode = "whiteboard";
    }
    viewMode = "whiteboard";
    updateModeUI();
    sendWhiteboardThumbnail();
  });
}

if (modeScreenBtn) {
  modeScreenBtn.addEventListener("click", async () => {
    if (viewMode === "screen") return;
    if (!currentClassCode || !nickname) {
      alert("先にクラスに参加してください。");
      viewMode = "whiteboard";
      captureMode = "whiteboard";
      updateModeUI();
      return;
    }
    const ok = await startScreenCapture();
    if (ok) {
      captureMode = "screen";
      viewMode = "screen";
      updateModeUI();
      sendWhiteboardThumbnail();
    } else {
      captureMode = "whiteboard";
      viewMode = "whiteboard";
      updateModeUI();
    }
  });
}

if (modeNotebookBtn) {
  modeNotebookBtn.addEventListener("click", () => {
    if (!currentClassCode || !nickname) {
      alert("先にクラスに参加してください。");
      return;
    }
    // ノート提出モードでは画面共有はオフ・ホワイトボード送信は通常通り
    if (captureMode === "screen") {
      stopScreenCapture();
      captureMode = "whiteboard";
    }
    viewMode = "notebook";
    updateModeUI();
  });
}

updateModeUI();

/* ========================================
   チャット：共通関数（生徒）
   ======================================== */

function setChatPanelOpen(open) {
  chatPanelOpen = open;
  if (!chatPanel || !chatToggleBtn) return;

  chatPanel.classList.toggle("collapsed", !open);
  if (open) {
    chatUnreadCount = 0;
    chatToggleBtn.classList.remove("has-unread");
  }
}

function renderStudentChatMessages() {
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = "";

  if (!chatMessages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-message-row";
    empty.textContent = "メッセージはまだありません。";
    chatMessagesEl.appendChild(empty);
    return;
  }

  chatMessages.forEach(m => {
    const row = document.createElement("div");
    row.className =
      "chat-message-row " +
      (m.from === "me" ? "chat-message--me" : "chat-message--them");

    const meta = document.createElement("div");
    meta.className = "chat-message-meta";

    const time = new Date(m.timestamp || Date.now());
    const timeStr = time.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    if (m.from === "me") {
      meta.textContent = `自分 • ${timeStr}`;
    } else {
      meta.textContent = `${m.nickname || "先生"} • ${timeStr}`;
    }

    const bubble = document.createElement("div");
    bubble.className = "chat-message-bubble";
    bubble.textContent = m.text;

    row.appendChild(meta);
    row.appendChild(bubble);
    chatMessagesEl.appendChild(row);
  });

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

// チャットパネル開閉
if (chatToggleBtn && chatPanel) {
  chatToggleBtn.addEventListener("click", () => {
    setChatPanelOpen(!chatPanelOpen);
    if (chatPanelOpen) {
      renderStudentChatMessages();
      if (chatInput) chatInput.focus();
    }
  });
}

if (chatCloseBtn) {
  chatCloseBtn.addEventListener("click", () => {
    setChatPanelOpen(false);
  });
}

// 生徒 → 教員 チャット送信
function studentSendChat() {
  if (!currentClassCode || !nickname) {
    alert("クラスに参加してからチャットを送信してください。");
    return;
  }
  // 条件: ホワイトボード表示状態のときのみチャット可能
  if (viewMode !== "whiteboard") {
    alert("ホワイトボード共有モードのときのみチャットできます。");
    return;
  }
  if (!chatInput) return;

  const text = chatInput.value.trim();
  if (!text) return;

  socket.emit("student-chat-to-teacher", {
    classCode: currentClassCode,
    nickname,
    message: text
  });

  chatMessages.push({
    from: "me",
    nickname: null,
    text,
    timestamp: Date.now()
  });
  renderStudentChatMessages();

  chatInput.value = "";
}

if (chatSendBtn && chatInput) {
  chatSendBtn.addEventListener("click", studentSendChat);
  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      studentSendChat();
    }
  });
}

/* ========================================
   サムネイル送信（ホワイトボード / 画面共有）
   ======================================== */

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
  const srcCanvasThumb = studentCanvas;
  if (!srcCanvasThumb || !srcCanvasThumb.width || !srcCanvasThumb.height) return;

  const thumbWidth = 320;
  const ratio = srcCanvasThumb.height / srcCanvasThumb.width;
  const thumbHeight = Math.round(thumbWidth * ratio);

  const off = document.createElement("canvas");
  off.width = thumbWidth;
  off.height = thumbHeight;
  const ctx = off.getContext("2d");
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, off.width, off.height);

  ctx.drawImage(
    srcCanvasThumb,
    0,
    0,
    srcCanvasThumb.width,
    srcCanvasThumb.height,
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

/* ========================================
   高画質送信（ホワイトボード / 画面共有）
   ======================================== */

function sendHighres() {
  if (!currentClassCode || !nickname) return;

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

  const srcCanvasHigh = studentCanvas;
  if (!srcCanvasHigh || !srcCanvasHigh.width || !srcCanvasHigh.height) return;

  const maxWidth = 1280;
  const ratio = srcCanvasHigh.height / srcCanvasHigh.width;
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
    srcCanvasHigh,
    0,
    0,
    srcCanvasHigh.width,
    srcCanvasHigh.height,
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

// ========= チャット受信（生徒） =========
socket.on("chat-message", payload => {
  if (!payload) return;
  if (payload.toRole !== "student") return;

  const fromNickname = payload.fromNickname || "先生";
  const text = payload.message;
  const timestamp = payload.timestamp || Date.now();

  chatMessages.push({
    from: "them",
    nickname: fromNickname,
    text,
    timestamp
  });

  if (chatPanelOpen) {
    renderStudentChatMessages();
  } else if (chatToggleBtn) {
    chatUnreadCount += 1;
    chatToggleBtn.classList.add("has-unread");
  }
});

/* ========================================
   ノート提出（カメラ / 台形補正）関連
   ======================================== */

// UI 要素
const cameraSelect = document.getElementById("cameraSelect");
const startCameraBtn = document.getElementById("startCameraBtn");
const paperSizeSelect = document.getElementById("paperSizeSelect");
const videoEl = document.getElementById("video");
const previewCanvas = document.getElementById("previewCanvas");
const previewCtx = previewCanvas ? previewCanvas.getContext("2d") : null;
const feedbackImage = document.getElementById("feedbackImage");

// ★ 拡大表示中のみ高画質送信モード（教員側からの指示で切り替え）
let highQualityMode = false;

// 用紙サイズ定義（mm） → 縦横比だけ使う
const PAPER_SIZES = {
  A4: { widthMm: 210, heightMm: 297 },
  B5: { widthMm: 182, heightMm: 257 },
  B4: { widthMm: 257, heightMm: 364 }
};
let currentPaperSize = "A4";

// OpenCV 用
let opencvReady = false;
const srcCanvas = document.createElement("canvas"); // 元映像を読む隠しキャンバス
const srcCtx = srcCanvas.getContext("2d");

// 「四隅クリック」用の状態（キャンバス座標を 0〜1 に正規化して持つ）
// クリックルール：画面上で「左上 → 右上 → 右下 → 左下」の順にクリック
let selectedCorners = []; // [{nx, ny}, ...] nx,ny: 0〜1
let cornersLocked = false; // 4点揃ったら true

// OpenCVロード確認
if (previewCanvas && previewCtx) {
  const opencvCheckInterval = setInterval(() => {
    if (typeof cv !== "undefined" && cv.Mat) {
      opencvReady = true;
      clearInterval(opencvCheckInterval);
      console.log("OpenCV.js is ready");
    }
  }, 500);
}

// ★ 教員側からの「高画質ON/OFF」指示を受信
socket.on("setHighQualityMode", ({ enabled }) => {
  highQualityMode = !!enabled;
  console.log("High quality mode:", highQualityMode);

  // ★ 解像度を切り替え
  setupPreviewCanvas();
});

// 用紙サイズ変更（縦横比だけ反映）
if (paperSizeSelect) {
  paperSizeSelect.addEventListener("change", () => {
    currentPaperSize = paperSizeSelect.value;
    setupPreviewCanvas();
  });
}

// カメラ一覧取得
async function listCameras() {
  if (!cameraSelect) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === "videoinput");
    cameraSelect.innerHTML = "";
    videoDevices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `カメラ${index + 1}`;
      cameraSelect.appendChild(option);
    });
  } catch (e) {
    console.error(e);
    alert("カメラデバイスの取得に失敗しました");
  }
}

// カメラ開始 / 再開始
if (startCameraBtn) {
  startCameraBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("このブラウザはカメラに対応していません");
      return;
    }

    if (!joinedNotebookClassCode || !notebookStudentId) {
      alert("クラスに参加してからカメラを開始してください。");
      return;
    }

    // 既存ストリーム停止
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    }

    const deviceId = cameraSelect ? cameraSelect.value : undefined;

    try {
      const constraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width:  { ideal: 1920 }, 
          height: { ideal: 1080 }, 
          facingMode: "environment"
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStream = stream;
      if (videoEl) {
        videoEl.srcObject = stream;

        videoEl.onloadedmetadata = () => {
          videoEl.play();
          setupPreviewCanvas();
        };
      }

      if (captureIntervalIdNotebook) clearInterval(captureIntervalIdNotebook);
      captureIntervalIdNotebook = setInterval(captureAndSendImage, 3000);

      // ここでもツールバーの statusLabel には何も表示しない
    } catch (e) {
      console.error(e);
      alert("カメラの起動に失敗しました");
    }
  });
}

// レイアウト関連
function getCurrentPaperAspect() {
  const s = PAPER_SIZES[currentPaperSize] || PAPER_SIZES.A4;
  return s.heightMm / s.widthMm;
}

function setupPreviewCanvas() {
  if (!previewCanvas || !previewCtx) return;

  // ★ 高画質モードのときだけ、内部解像度を 2倍にする
  const baseWidth = highQualityMode ? 1280 : 640;

  const aspect = getCurrentPaperAspect();
  const targetWidth = baseWidth;
  const targetHeight = Math.round(targetWidth * aspect);

  previewCanvas.width = targetWidth;
  previewCanvas.height = targetHeight;

  // 角を変えたときは再描画
  drawCorrectedFrameToPreview();
}

// ====== 四隅クリック関連 ======

// キャンバス上のクリック位置を、object-fit: contain による余白も考慮して 0〜1 に正規化して保存
if (previewCanvas) {
  previewCanvas.addEventListener("click", (e) => {
    const rect = previewCanvas.getBoundingClientRect();

    const canvasW = previewCanvas.width;
    const canvasH = previewCanvas.height;
    if (!canvasW || !canvasH) return;

    const boxW = rect.width;
    const boxH = rect.height;

    const canvasAspect = canvasH / canvasW;
    const boxAspect = boxH / boxW;

    let drawnW, drawnH, offsetX, offsetY;

    // object-fit: contain により、縦か横どちらかが「余る」ケースを考慮
    if (canvasAspect > boxAspect) {
      // キャンバスの方が縦長 → 高さがピッタリ、左右に余白
      drawnH = boxH;
      drawnW = boxH / canvasAspect;
      offsetX = (boxW - drawnW) / 2;
      offsetY = 0;
    } else {
      // キャンバスの方が横長 or 同じ → 幅がピッタリ、上下に余白
      drawnW = boxW;
      drawnH = boxW * canvasAspect;
      offsetX = 0;
      offsetY = (boxH - drawnH) / 2;
    }

    // クリック位置（CSSピクセル）から、実際の描画領域内座標へ変換
    const cssX = e.clientX - rect.left - offsetX;
    const cssY = e.clientY - rect.top - offsetY;

    // 0〜1 の正規化座標に変換
    let nx = cssX / drawnW;
    let ny = cssY / drawnH;

    // 念のため 0〜1 の範囲にクリップ（描画領域外をクリックした場合も端に寄せる）
    nx = Math.min(1, Math.max(0, nx));
    ny = Math.min(1, Math.max(0, ny));

    if (!cornersLocked) {
      selectedCorners.push({ nx, ny });

      if (selectedCorners.length === 1) {
        console.log("1点目: 自分から見て『左上』をクリックしてください");
      } else if (selectedCorners.length === 2) {
        console.log("2点目: 『右上』をクリックしてください");
      } else if (selectedCorners.length === 3) {
        console.log("3点目: 『右下』をクリックしてください");
      } else if (selectedCorners.length === 4) {
        cornersLocked = true;
        console.log(
          "4点目: 『左下』をクリックしました。四隅が確定しました（左上→右上→右下→左下）。"
        );
      }
    }

    drawCorrectedFrameToPreview();
  });

  // ダブルクリックで四隅リセット
  previewCanvas.addEventListener("dblclick", () => {
    selectedCorners = [];
    cornersLocked = false;
    console.log("Corners reset");
    drawCorrectedFrameToPreview();
  });
}

/**
 * クリック順をそのまま TL, TR, BR, BL として扱う
 * ルール:
 *   selectedCorners[0] … 画面上で「左上」
 *   selectedCorners[1] … 「右上」
 *   selectedCorners[2] … 「右下」
 *   selectedCorners[3] … 「左下」
 */
function getOrderedCornersFromClicks() {
  if (selectedCorners.length !== 4) return null;
  const [p0, p1, p2, p3] = selectedCorners;
  return [p0, p1, p2, p3]; // TL, TR, BR, BL
}

// キャンバス上に四隅のガイドを描画（生徒向けの目安）
function drawCornerOverlay() {
  // ★ 補正完了後（cornersLocked） はガイドを非表示にする
  if (!previewCanvas || !previewCtx) return;
  if (selectedCorners.length === 0 || cornersLocked) return;

  const w = previewCanvas.width;
  const h = previewCanvas.height;

  previewCtx.save();
  previewCtx.lineWidth = 2;
  previewCtx.strokeStyle = "rgba(0, 255, 0, 0.8)";
  previewCtx.fillStyle = "rgba(0, 255, 0, 0.8)";
  previewCtx.font = "14px sans-serif";

  // 点の描画 + 番号ラベル
  selectedCorners.forEach((p, idx) => {
    const x = p.nx * w;
    const y = p.ny * h;
    previewCtx.beginPath();
    previewCtx.arc(x, y, 4, 0, Math.PI * 2);
    previewCtx.fill();
    previewCtx.fillText(String(idx + 1), x + 6, y - 6);
  });

  // 4点すべてあるときは輪郭も描く（1→2→3→4→1 の順）
  if (selectedCorners.length === 4) {
    const pts = selectedCorners.map(p => ({
      x: p.nx * w,
      y: p.ny * h
    }));

    previewCtx.beginPath();
    previewCtx.moveTo(pts[0].x, pts[0].y); // TL
    previewCtx.lineTo(pts[1].x, pts[1].y); // TR
    previewCtx.lineTo(pts[2].x, pts[2].y); // BR
    previewCtx.lineTo(pts[3].x, pts[3].y); // BL
    previewCtx.closePath();
    previewCtx.stroke();
  }

  previewCtx.restore();
}

// 台形補正メイン
function drawCorrectedFrameToPreview() {
  if (!videoEl || !previewCanvas || !previewCtx) return;

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) {
    // カメラがまだ準備できていない場合は真っ白に
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    return;
  }

  const dw = previewCanvas.width;
  const dh = previewCanvas.height;

  // OpenCV が使えない場合は単純に縮小表示
  if (!opencvReady || typeof cv === "undefined") {
    previewCtx.drawImage(videoEl, 0, 0, dw, dh);
    drawCornerOverlay();
    return;
  }

  // 元映像を隠しキャンバスに描画
  srcCanvas.width = vw;
  srcCanvas.height = vh;
  srcCtx.drawImage(videoEl, 0, 0, vw, vh);

  let src = cv.imread(srcCanvas);
  let dst = new cv.Mat();

  try {
    if (selectedCorners.length === 4) {
      // クリック順に基づき、四隅を TL,TR,BR,BL として使用
      const orderedNorm = getOrderedCornersFromClicks();

      if (orderedNorm) {
        const [tlN, trN, brN, blN] = orderedNorm;

        // 正規化座標 → 元映像のピクセル座標へ変換
        const tl = { x: tlN.nx * vw, y: tlN.ny * vh };
        const tr = { x: trN.nx * vw, y: trN.ny * vh };
        const br = { x: brN.nx * vw, y: brN.ny * vh };
        const bl = { x: blN.nx * vw, y: blN.ny * vh };

        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          tl.x, tl.y,
          tr.x, tr.y,
          br.x, br.y,
          bl.x, bl.y
        ]);
        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          dw, 0,
          dw, dh,
          0, dh
        ]);

        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        cv.warpPerspective(
          src,
          dst,
          M,
          new cv.Size(dw, dh),
          cv.INTER_LINEAR,
          cv.BORDER_CONSTANT,
          new cv.Scalar()
        );

        cv.imshow(previewCanvas, dst);

        srcTri.delete();
        dstTri.delete();
        M.delete();
      } else {
        // 念のためフォールバック
        previewCtx.drawImage(videoEl, 0, 0, dw, dh);
      }
    } else {
      // 四隅が未設定 → そのまま縮小表示（四隅クリックのための状態）
      previewCtx.drawImage(videoEl, 0, 0, dw, dh);
    }

    // 四隅ガイドを上から描く（補正完了後は drawCornerOverlay 内で抑制）
    drawCornerOverlay();
  } catch (e) {
    console.error(e);
    previewCtx.drawImage(videoEl, 0, 0, dw, dh);
    drawCornerOverlay();
  } finally {
    src.delete();
    dst.delete();
  }
}

// 画像送信
function captureAndSendImage() {
  if (
    !currentStream ||
    !joinedNotebookClassCode ||
    !notebookStudentId ||
    !previewCanvas
  ) {
    return;
  }
  const width = videoEl ? videoEl.videoWidth : 0;
  const height = videoEl ? videoEl.videoHeight : 0;
  if (!width || !height) return;

  // 台形補正 → previewCanvas に描画
  drawCorrectedFrameToPreview();

  // ★ 高画質モード中のみ PNG、それ以外は JPEG(0.5)
  let dataUrl;
  if (highQualityMode) {
    dataUrl = previewCanvas.toDataURL("image/png");
  } else {
    dataUrl = previewCanvas.toDataURL("image/jpeg", 0.5);
  }

  socket.emit("studentImageUpdate", {
    classCode: joinedNotebookClassCode,
    studentId: notebookStudentId,
    imageData: dataUrl
  });
}

// 教員からのフィードバック画像受信
socket.on("teacherSharedImage", ({ imageData }) => {
  if (feedbackImage) {
    feedbackImage.src = imageData;
  }
});

// ノート提出用カメラ停止
function stopNotebookCamera() {
  if (captureIntervalIdNotebook) {
    clearInterval(captureIntervalIdNotebook);
    captureIntervalIdNotebook = null;
  }
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

// ページ読み込み時
window.addEventListener("load", async () => {
  // カメラ列挙
  if (
    navigator.mediaDevices &&
    navigator.mediaDevices.enumerateDevices &&
    cameraSelect
  ) {
    try {
      await listCameras();
    } catch {
      // 無視
    }
  }
  setupPreviewCanvas();
});

/* ========================================
   キャプチャループ管理（ホワイトボード / 画面共有）
   ======================================== */

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
  stopNotebookCamera();
});

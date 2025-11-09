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

/* ========================================
   共有モード切り替え（ホワイトボード / 画面共有）
   ======================================== */

function updateCaptureButtons() {
  if (!modeWhiteboardBtn || !modeScreenBtn) return;
  const isWhiteboard = captureMode === "whiteboard";
  modeWhiteboardBtn.classList.toggle("primary", isWhiteboard);
  modeWhiteboardBtn.classList.toggle("active", isWhiteboard);
  modeScreenBtn.classList.toggle("primary", !isWhiteboard);
  modeScreenBtn.classList.toggle("active", !isWhiteboard);

  // ★ チャット入力の有効/無効も反映
  if (chatInput && chatSendBtn) {
    const disabled = !isWhiteboard;
    chatInput.disabled = disabled;
    chatSendBtn.disabled = disabled;
    chatInput.placeholder = disabled
      ? "ホワイトボード共有中のみ送信できます"
      : "メッセージを入力";
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
        updateCaptureButtons();
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

// ========= チャット：共通関数（生徒） =========

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
  if (captureMode !== "whiteboard") {
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
   キャプチャループ管理
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
});

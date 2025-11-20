import { initBoardUI } from "./board-ui.js";

const teacherBoard = initBoardUI();

// === サーバー側のボード API ベースパス ===
const BOARD_API_BASE = "/api/board";

// ========= socket.io =========
const socket = io();

// 上部 UI
const classCodeInput = document.getElementById("teacherClassCodeInput");
const startClassBtn = document.getElementById("teacherStartClassBtn");
const statusLabel = document.getElementById("teacherStatus");

// ビュー切り替え関連
const boardContainer = document.getElementById("boardContainer");
const studentViewContainer = document.getElementById("studentViewContainer");
const notebookViewContainer = document.getElementById("notebookViewContainer");

const teacherModeWhiteboard = document.getElementById("teacherModeWhiteboard");
const teacherModeStudentView = document.getElementById("teacherModeStudentView");
const teacherModeNotebook = document.getElementById("teacherModeNotebook");

// 生徒画面確認タイル & モーダル（従来）
const studentsInfo = document.getElementById("studentsInfo");
const tileGrid = document.getElementById("tileGrid");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalImage = document.getElementById("modalImage");
const modalTitle = document.getElementById("modalTitle");
const modalCloseBtn = document.getElementById("modalCloseBtn");

// ノート確認ビュー用
const notebookInfo = document.getElementById("notebookInfo");
const notebookStudentGrid = document.getElementById("notebookStudentGrid");

// ノート個別フィードバック用モーダル
const feedbackModalBackdrop = document.getElementById("feedbackModalBackdrop");
const modalStudentLabel = document.getElementById("modalStudentLabel");
const feedbackCanvas = document.getElementById("feedbackCanvas");
const feedbackModalCloseBtn = document.getElementById("feedbackModalCloseBtn");
const shareToggleBtn = document.getElementById("shareToggleBtn");
const penColorInput = document.getElementById("penColorInput");
const penWidthInput = document.getElementById("penWidthInput");
const eraserToggleBtn = document.getElementById("eraserToggleBtn");
const clearAnnotationBtn = document.getElementById("clearAnnotationBtn");

const fbCtx = feedbackCanvas.getContext("2d");

// チャット UI 要素（教員）
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatNotifyDot = document.getElementById("chatNotifyDot");
const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatTargetSelect = document.getElementById("chatTargetSelect");

// チャット状態
let chatPanelOpen = false;
let chatUnreadCount = 0;
const chatHistories = {}; // { [socketId]: [ { from, nickname, text, timestamp } ] }
let activeChatTargetSocketId = null;

let currentClassCode = null;

// 生徒画面確認用サムネイル
let latestThumbnails = {}; // { socketId: { nickname, dataUrl } }

// ノート確認用の生徒情報
let notebookStudents = {}; // { studentId: { latestImageData } }

// ======== ホワイトボード保存/読み込みダイアログ関連 ========
const teacherOpenSaveDialogBtn = document.getElementById("teacherOpenSaveDialogBtn");
const teacherOpenLoadDialogBtn = document.getElementById("teacherOpenLoadDialogBtn");

let boardDialogOverlay = null;
let boardDialogMode = "save";           // "save" or "load"
let boardDialogSelectedFolder = "";     // 選択中フォルダ
let boardDialogSelectedFileId = null;   // 選択中ファイルID
let lastUsedFolderPath = "";            // 直近に使ったフォルダ

// ========= ノートフィードバック用：線レイヤ（オフスクリーン） =========
const annotationCanvas = document.createElement("canvas");
const annotationCtx = annotationCanvas.getContext("2d");
let baseImage = null;                   // 生徒ノート背景画像
let currentStudentId = null;
let drawing = false;
let lastX = 0;
let lastY = 0;
let eraseMode = false;
let isSharing = false;
let shareIntervalId = null;
let currentHighQualityStudentId = null;

// ========= Explorer風 ボード保存/読み込み API ヘルパー =========

async function fetchFolderList() {
  if (!currentClassCode) {
    throw new Error("クラスコードが設定されていません。");
  }

  const res = await fetch(`${BOARD_API_BASE}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "listFolders",
      role: "teacher",
      classCode: currentClassCode
    })
  });

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

async function fetchFileList(folderPath) {
  if (!currentClassCode) {
    throw new Error("クラスコードが設定されていません。");
  }

  const res = await fetch(`${BOARD_API_BASE}/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "listBoards",
      role: "teacher",
      classCode: currentClassCode,
      folderPath: folderPath || ""
    })
  });

  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.message || "ファイル一覧の取得に失敗しました。");
  }
  return json.files || [];
}

// ========= ボード保存/読み込みモーダル生成 =========

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
            <input id="boardDialogFolderInput" type="text" placeholder="例: 単元1/一次関数" />
          </label>
          <label class="board-dialog-field">
            ファイル名:
            <input id="boardDialogFileNameInput" type="text" placeholder="例: 第1回_授業" />
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

  const closeBtn = document.getElementById("boardDialogCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeBoardDialog();
    });
  }

  boardDialogOverlay.addEventListener("click", e => {
    if (e.target === boardDialogOverlay) {
      closeBoardDialog();
    }
  });

  const saveBtn = document.getElementById("boardDialogSaveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", onClickSaveConfirm);
  }

  const loadBtn = document.getElementById("boardDialogLoadBtn");
  if (loadBtn) {
    loadBtn.addEventListener("click", onClickLoadConfirm);
  }
}

function openBoardDialog(mode) {
  if (!currentClassCode) {
    alert("先にクラスコードを入力して「開始」してください。");
    return;
  }
  if (!teacherBoard || typeof teacherBoard.exportBoardData !== "function") {
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
    titleEl.textContent =
      boardDialogMode === "save" ? "ホワイトボードを保存" : "ホワイトボードを開く";
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
  reloadFolderList();
}

function closeBoardDialog() {
  if (boardDialogOverlay) {
    boardDialogOverlay.classList.remove("show");
  }
}

async function reloadFolderList() {
  const folderListEl = document.getElementById("boardDialogFolderList");
  const fileListEl = document.getElementById("boardDialogFileList");
  if (!folderListEl || !fileListEl) return;

  folderListEl.innerHTML = `<li>読み込み中...</li>`;
  fileListEl.innerHTML = "";

  try {
    const folders = await fetchFolderList();

    folderListEl.innerHTML = "";

    const rootLi = document.createElement("li");
    rootLi.textContent = "(クラス直下)";
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

async function teacherSaveBoardInternal(folderPath, fileName) {
  if (!currentClassCode) {
    alert("先にクラスコードを入力して「開始」してください。");
    return;
  }
  if (!teacherBoard || typeof teacherBoard.exportBoardData !== "function") {
    alert("ホワイトボードの状態を取得できません。");
    return;
  }

  const boardData = teacherBoard.exportBoardData();

  let finalFileName = (fileName || "").trim();
  if (!finalFileName) {
    finalFileName = new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", "_")
      .replace(/:/g, "-");
  }

  const payload = {
    action: "saveBoard",
    role: "teacher",
    classCode: currentClassCode,
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

async function teacherLoadBoardInternal(folderPath, fileId) {
  if (!currentClassCode) {
    alert("先にクラスコードを入力して「開始」してください。");
    return;
  }
  if (!teacherBoard || typeof teacherBoard.importBoardData !== "function") {
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
        role: "teacher",
        classCode: currentClassCode,
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

    teacherBoard.importBoardData(json.boardData);
    alert("ホワイトボードを読み込みました。");
    closeBoardDialog();
  } catch (err) {
    console.error(err);
    alert("ホワイトボードの読み込み中にエラーが発生しました。");
  }
}

function onClickSaveConfirm() {
  const folderInput = document.getElementById("boardDialogFolderInput");
  const fileNameInput = document.getElementById("boardDialogFileNameInput");

  const folderPath =
    (folderInput && folderInput.value.trim()) ||
    boardDialogSelectedFolder ||
    "";

  const fileName = fileNameInput ? fileNameInput.value.trim() : "";

  teacherSaveBoardInternal(folderPath, fileName);
}

function onClickLoadConfirm() {
  if (!boardDialogSelectedFileId) {
    alert("読み込みたいファイルを選択してください。");
    return;
  }
  const folderPath = boardDialogSelectedFolder || "";
  teacherLoadBoardInternal(folderPath, boardDialogSelectedFileId);
}

if (teacherOpenSaveDialogBtn) {
  teacherOpenSaveDialogBtn.addEventListener("click", () => {
    openBoardDialog("save");
  });
}
if (teacherOpenLoadDialogBtn) {
  teacherOpenLoadDialogBtn.addEventListener("click", () => {
    openBoardDialog("load");
  });
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

    // 既存ホワイトボード用
    socket.emit("join-teacher", { classCode: code });
    socket.emit("teacher-start-class", { classCode: code });

    // ノート確認アプリ互換：クラス参加
    socket.emit("joinAsTeacher", { classCode: code });

    if (statusLabel) {
      statusLabel.textContent = `クラスコード ${code} で待機中…`;
    }
  });
}

socket.on("teacher-class-started", payload => {
  if (statusLabel && payload?.classCode) {
    statusLabel.textContent = `クラス開始中: ${payload.classCode}`;
  }
});

// ========= ビュー切り替え：ホワイトボード / 生徒画面 / ノート確認 =========
function setTeacherViewMode(mode) {
  if (!boardContainer || !studentViewContainer || !notebookViewContainer) return;

  const show = (el) => {
    if (!el) return;
    el.classList.remove("hidden");
    el.style.display = "";
  };

  const hide = (el) => {
    if (!el) return;
    el.classList.add("hidden");
    el.style.display = "none";
  };

  if (mode === "whiteboard") {
    // ホワイトボードを表示
    show(boardContainer);
    hide(studentViewContainer);
    hide(notebookViewContainer);

    teacherModeWhiteboard?.classList.add("active");
    teacherModeStudentView?.classList.remove("active");
    teacherModeNotebook?.classList.remove("active");

    // サイドバーを表示（通常モード）
    document.body.classList.remove("teacher-student-view");
  } else if (mode === "student") {
    // 生徒画面タイルを表示
    hide(boardContainer);
    show(studentViewContainer);
    hide(notebookViewContainer);

    teacherModeWhiteboard?.classList.remove("active");
    teacherModeStudentView?.classList.add("active");
    teacherModeNotebook?.classList.remove("active");

    // サイドバーを隠して右側を広く
    document.body.classList.add("teacher-student-view");
  } else if (mode === "notebook") {
    // ノート確認ビューを表示
    hide(boardContainer);
    hide(studentViewContainer);
    show(notebookViewContainer);

    teacherModeWhiteboard?.classList.remove("active");
    teacherModeStudentView?.classList.remove("active");
    teacherModeNotebook?.classList.add("active");

    // サイドバーを隠して右側を広く（必要に応じて）
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
if (teacherModeNotebook) {
  teacherModeNotebook.addEventListener("click", () => {
    setTeacherViewMode("notebook");
  });
}

// デフォルトはホワイトボード
setTeacherViewMode("whiteboard");

// ========= 生徒画面確認（従来のタイル表示） =========

socket.on("student-list-update", list => {
  if (studentsInfo) {
    studentsInfo.textContent = `接続中の生徒: ${list.length}人`;
  }

  // チャット宛先セレクト更新
  if (chatTargetSelect) {
    const current = activeChatTargetSocketId;
    chatTargetSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "生徒を選択";
    chatTargetSelect.appendChild(placeholder);

    list.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.socketId;
      opt.textContent = s.nickname || s.socketId;
      chatTargetSelect.appendChild(opt);
    });

    if (current) {
      const found = Array.from(chatTargetSelect.options).find(
        o => o.value === current
      );
      if (found) {
        found.selected = true;
        activeChatTargetSocketId = current;
      } else {
        activeChatTargetSocketId = "";
      }
    }
  }
});

socket.on("student-thumbnail", ({ socketId, nickname, dataUrl }) => {
  latestThumbnails[socketId] = { nickname, dataUrl };
  renderTiles();
});

socket.on("student-highres", ({ socketId, nickname, dataUrl }) => {
  if (!modalBackdrop || !modalImage || !modalTitle) return;
  modalTitle.textContent = `${nickname} さんの画面`;
  modalImage.src = dataUrl;
  modalBackdrop.classList.add("show");
});

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

// ========= チャット機能 =========

function setChatPanelOpen(open) {
  chatPanelOpen = open;
  if (!chatPanel || !chatToggleBtn) return;

  chatPanel.classList.toggle("collapsed", !open);
  if (open) {
    chatUnreadCount = 0;
    chatToggleBtn.classList.remove("has-unread");
  }
}

function appendChatMessageToHistory(targetSocketId, msg) {
  if (!chatHistories[targetSocketId]) {
    chatHistories[targetSocketId] = [];
  }
  chatHistories[targetSocketId].push(msg);
}

function renderChatMessagesForTarget(targetSocketId) {
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = "";

  if (!targetSocketId || !chatHistories[targetSocketId]) {
    const empty = document.createElement("div");
    empty.className = "chat-message-row";
    empty.textContent = "宛先の生徒を選択してください。";
    chatMessagesEl.appendChild(empty);
    return;
  }

  chatHistories[targetSocketId].forEach(m => {
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
      meta.textContent = `${m.nickname || "生徒"} • ${timeStr}`;
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

if (chatToggleBtn && chatPanel) {
  chatToggleBtn.addEventListener("click", () => {
    setChatPanelOpen(!chatPanelOpen);
    if (chatPanelOpen) {
      renderChatMessagesForTarget(activeChatTargetSocketId);
      if (chatInput) chatInput.focus();
    }
  });
}

if (chatCloseBtn) {
  chatCloseBtn.addEventListener("click", () => {
    setChatPanelOpen(false);
  });
}

if (chatTargetSelect) {
  chatTargetSelect.addEventListener("change", () => {
    activeChatTargetSocketId = chatTargetSelect.value || "";
    renderChatMessagesForTarget(activeChatTargetSocketId);
  });
}

function teacherSendChat() {
  if (!currentClassCode) {
    alert("クラスを開始してからチャットを送信してください。");
    return;
  }
  if (!activeChatTargetSocketId) {
    alert("宛先の生徒を選択してください。");
    return;
  }
  if (!chatInput) return;

  const text = chatInput.value.trim();
  if (!text) return;

  socket.emit("teacher-chat-to-student", {
    classCode: currentClassCode,
    targetSocketId: activeChatTargetSocketId,
    message: text
  });

  appendChatMessageToHistory(activeChatTargetSocketId, {
    from: "me",
    nickname: null,
    text,
    timestamp: Date.now()
  });
  renderChatMessagesForTarget(activeChatTargetSocketId);

  chatInput.value = "";
}

if (chatSendBtn && chatInput) {
  chatSendBtn.addEventListener("click", teacherSendChat);
  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      teacherSendChat();
    }
  });
}

socket.on("chat-message", payload => {
  if (!payload) return;
  if (payload.toRole !== "teacher") return;

  const fromId = payload.fromSocketId;
  const fromNickname = payload.fromNickname || "生徒";
  const text = payload.message;
  const timestamp = payload.timestamp || Date.now();

  appendChatMessageToHistory(fromId, {
    from: "them",
    nickname: fromNickname,
    text,
    timestamp
  });

  if (chatPanelOpen && activeChatTargetSocketId === fromId) {
    renderChatMessagesForTarget(fromId);
  } else {
    chatUnreadCount += 1;
    if (chatToggleBtn) {
      chatToggleBtn.classList.add("has-unread");
    }
  }
});

// ========= ノート確認ビュー（ノート点検アプリ統合部分） =========

// 生徒接続（ノート用）
socket.on("studentJoined", ({ studentId, classCode }) => {
  if (!currentClassCode || classCode !== currentClassCode) return;
  if (!notebookStudents[studentId]) {
    notebookStudents[studentId] = { latestImageData: null };
    renderNotebookTiles();
    updateNotebookInfo();
  }
});

// 生徒ノート画像更新（サムネイル）
socket.on("studentImageUpdated", ({ studentId, imageData, classCode }) => {
  if (!currentClassCode) return;
  if (classCode && classCode !== currentClassCode) return;

  if (!notebookStudents[studentId]) {
    notebookStudents[studentId] = { latestImageData: imageData };
  } else {
    notebookStudents[studentId].latestImageData = imageData;
  }
  renderNotebookTiles();
  updateNotebookInfo();
});

function updateNotebookInfo() {
  if (!notebookInfo) return;
  const ids = Object.keys(notebookStudents);
  notebookInfo.textContent = `ノート提出中の生徒: ${ids.length}人`;
}

function renderNotebookTiles() {
  if (!notebookStudentGrid) return;

  notebookStudentGrid.innerHTML = "";

  const studentIds = Object.keys(notebookStudents);
  if (studentIds.length === 0) {
    const info = document.createElement("div");
    info.className = "notebook-empty-info";
    info.textContent = "まだノート提出した生徒がいません。";
    notebookStudentGrid.appendChild(info);
    return;
  }

  studentIds.forEach(studentId => {
    const tile = document.createElement("div");
    tile.className = "student-tile";
    tile.dataset.studentId = studentId;

    const header = document.createElement("div");
    header.className = "student-tile-header";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = `生徒：${studentId}`;

    const statusSpan = document.createElement("span");
    const hasImage = !!notebookStudents[studentId].latestImageData;
    statusSpan.textContent = hasImage ? "画像受信中" : "画像未受信";

    header.appendChild(nameSpan);
    header.appendChild(statusSpan);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 320;
    canvas.height = 240;

    if (hasImage) {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(
          canvas.width / img.width,
          canvas.height / img.height
        );
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (canvas.width - w) / 2;
        const y = (canvas.height - h) / 2;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, x, y, w, h);
      };
      img.src = notebookStudents[studentId].latestImageData;
    } else {
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "14px sans-serif";
      ctx.fillText("画像なし", 8, 20);
    }

    tile.appendChild(header);
    tile.appendChild(canvas);

    tile.addEventListener("click", () => {
      openFeedbackModal(studentId);
    });

    notebookStudentGrid.appendChild(tile);
  });
}

// ===== ノート個別フィードバックモーダル =====

function redrawFeedbackCanvas() {
  fbCtx.clearRect(0, 0, feedbackCanvas.width, feedbackCanvas.height);

  if (baseImage) {
    fbCtx.drawImage(
      baseImage,
      0,
      0,
      feedbackCanvas.width,
      feedbackCanvas.height
    );
  }

  fbCtx.drawImage(
    annotationCanvas,
    0,
    0,
    feedbackCanvas.width,
    feedbackCanvas.height
  );
}

function resizeFeedbackCanvasToImage() {
  const data = notebookStudents[currentStudentId]?.latestImageData;
  if (!data) {
    const w = 800;
    const h = 600;
    feedbackCanvas.width = w;
    feedbackCanvas.height = h;
    feedbackCanvas.style.width = w + "px";
    feedbackCanvas.style.height = h + "px";

    annotationCanvas.width = w;
    annotationCanvas.height = h;
    annotationCtx.clearRect(0, 0, w, h);
    baseImage = null;

    fbCtx.fillStyle = "#000";
    fbCtx.fillRect(0, 0, w, h);
    fbCtx.fillStyle = "#fff";
    fbCtx.font = "20px sans-serif";
    fbCtx.fillText("まだ画像がありません", 20, 40);
    return;
  }

  const img = new Image();
  img.onload = () => {
    const maxWidth = 1100;
    const maxHeight = 700;
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const displayWidth = img.width * scale;
    const displayHeight = img.height * scale;

    feedbackCanvas.width = displayWidth;
    feedbackCanvas.height = displayHeight;
    feedbackCanvas.style.width = displayWidth + "px";
    feedbackCanvas.style.height = displayHeight + "px";

    annotationCanvas.width = displayWidth;
    annotationCanvas.height = displayHeight;
    annotationCtx.clearRect(0, 0, displayWidth, displayHeight);

    baseImage = img;
    redrawFeedbackCanvas();
  };
  img.src = data;
}

function openFeedbackModal(studentId) {
  currentStudentId = studentId;
  if (modalStudentLabel) {
    modalStudentLabel.textContent = `生徒：${studentId}`;
  }

  if (feedbackModalBackdrop) {
    feedbackModalBackdrop.style.display = "flex";
  }

  // 高画質モード切り替え
  if (currentClassCode) {
    if (currentHighQualityStudentId && currentHighQualityStudentId !== studentId) {
      socket.emit("teacherSetHighQuality", {
        classCode: currentClassCode,
        studentId: currentHighQualityStudentId,
        enabled: false
      });
    }
    socket.emit("teacherSetHighQuality", {
      classCode: currentClassCode,
      studentId,
      enabled: true
    });
    currentHighQualityStudentId = studentId;
  }

  resizeFeedbackCanvasToImage();
}

function closeFeedbackModal() {
  stopSharing();

  // 高画質OFF
  if (currentClassCode && currentHighQualityStudentId) {
    socket.emit("teacherSetHighQuality", {
      classCode: currentClassCode,
      studentId: currentHighQualityStudentId,
      enabled: false
    });
    currentHighQualityStudentId = null;
  }

  if (feedbackModalBackdrop) {
    feedbackModalBackdrop.style.display = "none";
  }
  currentStudentId = null;
}

if (feedbackModalCloseBtn) {
  feedbackModalCloseBtn.addEventListener("click", () => {
    closeFeedbackModal();
  });
}

if (feedbackModalBackdrop) {
  feedbackModalBackdrop.addEventListener("click", e => {
    if (e.target === feedbackModalBackdrop) {
      closeFeedbackModal();
    }
  });
}

// 手書きイベント
feedbackCanvas.addEventListener("mousedown", e => {
  drawing = true;
  const rect = feedbackCanvas.getBoundingClientRect();
  lastX = e.clientX - rect.left;
  lastY = e.clientY - rect.top;
});

feedbackCanvas.addEventListener("mousemove", e => {
  if (!drawing) return;
  const rect = feedbackCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  annotationCtx.lineCap = "round";
  annotationCtx.lineJoin = "round";
  annotationCtx.lineWidth = Number(penWidthInput.value) || 3;

  if (eraseMode) {
    annotationCtx.globalCompositeOperation = "destination-out";
    annotationCtx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    annotationCtx.globalCompositeOperation = "source-over";
    annotationCtx.strokeStyle = penColorInput.value || "#ff0000";
  }

  annotationCtx.beginPath();
  annotationCtx.moveTo(lastX, lastY);
  annotationCtx.lineTo(x, y);
  annotationCtx.stroke();

  lastX = x;
  lastY = y;

  redrawFeedbackCanvas();
});

window.addEventListener("mouseup", () => {
  drawing = false;
});

// 消しゴム切り替え
if (eraserToggleBtn) {
  eraserToggleBtn.addEventListener("click", () => {
    eraseMode = !eraseMode;
    eraserToggleBtn.textContent = eraseMode ? "消しゴムON" : "消しゴムOFF";
    eraserToggleBtn.className = eraseMode ? "share-on" : "share-off";
  });
}

// 手書きクリア（背景はそのまま）
if (clearAnnotationBtn) {
  clearAnnotationBtn.addEventListener("click", () => {
    if (!baseImage) {
      annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
      redrawFeedbackCanvas();
      return;
    }
    annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    redrawFeedbackCanvas();
  });
}

// 共有開始/停止
if (shareToggleBtn) {
  shareToggleBtn.addEventListener("click", () => {
    if (!currentStudentId) return;
    if (!isSharing) {
      startSharing();
    } else {
      stopSharing();
    }
  });
}

function startSharing() {
  isSharing = true;
  shareToggleBtn.textContent = "共有停止";
  shareToggleBtn.className = "share-on";

  // 3秒ごとに送信
  shareIntervalId = setInterval(() => {
    if (!currentStudentId || !currentClassCode) return;
    const data = feedbackCanvas.toDataURL("image/jpeg", 0.7);
    socket.emit("teacherShareToStudent", {
      classCode: currentClassCode,
      studentId: currentStudentId,
      imageData: data
    });
  }, 3000);
}

function stopSharing() {
  isSharing = false;
  shareToggleBtn.textContent = "共有開始";
  shareToggleBtn.className = "share-off";
  if (shareIntervalId) {
    clearInterval(shareIntervalId);
    shareIntervalId = null;
  }
}

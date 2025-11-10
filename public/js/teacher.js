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
const teacherModeWhiteboard = document.getElementById("teacherModeWhiteboard");
const teacherModeStudentView = document.getElementById("teacherModeStudentView");

// 生徒タイル & モーダル
const studentsInfo = document.getElementById("studentsInfo");
const tileGrid = document.getElementById("tileGrid");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalImage = document.getElementById("modalImage");
const modalTitle = document.getElementById("modalTitle");
const modalCloseBtn = document.getElementById("modalCloseBtn");

// 新しい保存／読み込み用ボタン
const teacherOpenSaveDialogBtn = document.getElementById("teacherOpenSaveDialogBtn");
const teacherOpenLoadDialogBtn = document.getElementById("teacherOpenLoadDialogBtn");

// ========= チャット UI 要素（教員） =========
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

// 生徒ごとのチャット履歴: { [socketId]: [ { from: 'me'|'them', nickname, text, timestamp } ] }
const chatHistories = {};
let activeChatTargetSocketId = null;

let currentClassCode = null;
let latestThumbnails = {}; // { socketId: { nickname, dataUrl } }

// ========= Explorer風 モーダル用の状態 =========
let boardDialogOverlay = null;          // オーバーレイ要素
let boardDialogMode = "save";           // "save" or "load"
let boardDialogSelectedFolder = "";     // 選択中フォルダ（クラス内サブフォルダパス）
let boardDialogSelectedFileId = null;   // 選択中ファイルID
let lastUsedFolderPath = "";            // 直近に使ったフォルダを記憶

// ========= API ヘルパー =========

// フォルダ一覧取得（クラスコード単位）
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

  // 期待フォーマット: { folders: [{ path: "単元1/一次関数", name: "単元1/一次関数" }, ...] }
  // 多少フォーマットが違っても、path or folderPath / name を見てうまく拾うようにしています。
  const folders = json.folders || [];
  return folders.map(f => {
    const path = f.path || f.folderPath || "";
    const name = f.name || path || "(未命名フォルダ)";
    return { path, name };
  });
}

// 指定フォルダ内のファイル一覧取得
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

  // 期待フォーマット: { files: [{ fileId, fileName, lastUpdated }, ...] }
  return json.files || [];
}

// ========= モーダル生成 / 表示・非表示 =========

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

  // 閉じるボタン
  const closeBtn = document.getElementById("boardDialogCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeBoardDialog();
    });
  }

  // オーバーレイ背景クリックで閉じる
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
    titleEl.textContent = boardDialogMode === "save"
      ? "ホワイトボードを保存"
      : "ホワイトボードを開く";
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
  // フォルダは直前の選択 or 空
  boardDialogSelectedFolder = lastUsedFolderPath || "";

  if (folderInput) {
    if (boardDialogMode === "save") {
      folderInput.value = boardDialogSelectedFolder;
    } else {
      folderInput.value = ""; // 読み込みモードでは入力欄非表示なので念のためクリア
    }
  }
  if (fileNameInput && boardDialogMode === "save") {
    fileNameInput.value = "";
  }

  // 表示
  boardDialogOverlay.classList.add("show");

  // フォルダ一覧を読み込む
  reloadFolderList();
}

function closeBoardDialog() {
  if (boardDialogOverlay) {
    boardDialogOverlay.classList.remove("show");
  }
}

// ========= フォルダ & ファイル一覧の描画 =========

async function reloadFolderList() {
  const folderListEl = document.getElementById("boardDialogFolderList");
  const fileListEl = document.getElementById("boardDialogFileList");
  if (!folderListEl || !fileListEl) return;

  folderListEl.innerHTML = `<li>読み込み中...</li>`;
  fileListEl.innerHTML = "";

  try {
    const folders = await fetchFolderList();

    folderListEl.innerHTML = "";

    // ルート（クラス直下）を一つ追加
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
        // 選択状態のハイライト
        Array.from(fileListEl.querySelectorAll(".board-dialog-file-item")).forEach(el =>
          el.classList.remove("selected")
        );
        li.classList.add("selected");

        boardDialogSelectedFileId = file.fileId;

        // 保存モードなら、そのファイル名で上書き保存しやすいように入力欄にも反映
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

  // フォルダ選択が変わったら、そのフォルダのファイル一覧を再取得
  reloadFileList(boardDialogSelectedFolder);
}

// ========= 保存 / 読み込みの実処理 =========

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

  // ファイル名が空ならタイムスタンプ
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
    role: "teacher",
    classCode: currentClassCode,
    folderPath: (folderPath || "").trim(), // GAS 側でクラスフォルダの下に作成するサブフォルダパス
    fileName: finalFileName,               // Drive 上のファイル名のベース
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
        fileId // GAS 側で handleLoadBoard に届く
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

// ========= モーダル内ボタンのハンドラ =========

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

// ========= ボタンにイベントを紐付け =========

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

  // チャット宛先セレクトも更新
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

    // 可能なら以前選んでいた生徒を再選択
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

// ========= チャット：共通関数（教員） =========

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

// チャットパネル開閉
if (chatToggleBtn && chatPanel) {
  chatToggleBtn.addEventListener("click", () => {
    setChatPanelOpen(!chatPanelOpen);
    if (chatPanelOpen) {
      // 開くときに現在の宛先の履歴を表示
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

// 宛先セレクト変更
if (chatTargetSelect) {
  chatTargetSelect.addEventListener("change", () => {
    activeChatTargetSocketId = chatTargetSelect.value || "";
    renderChatMessagesForTarget(activeChatTargetSocketId);
  });
}

// メッセージ送信
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

// ========= チャット受信（教員） =========
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

  // 現在の表示中会話ならそのまま描画
  if (chatPanelOpen && activeChatTargetSocketId === fromId) {
    renderChatMessagesForTarget(fromId);
  } else {
    // 未読バッジをON
    chatUnreadCount += 1;
    if (chatToggleBtn) {
      chatToggleBtn.classList.add("has-unread");
    }
  }
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

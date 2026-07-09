// public/js/teacher.js
import { initBoardUI } from "./board-ui.js?v=toolbar-chat-templates";
import { Whiteboard } from "./whiteboard.js";
import { boardApi, createRealtimeBridge } from "./supabase-api.js";

const teacherBoard = initBoardUI();
window.teacherBoard = teacherBoard; // ★ デバッグ用にグローバル公開

// ★ ここから追加：ブラウザ離脱時の確認ダイアログ
window.addEventListener("beforeunload", (event) => {
  // board がなければ何もしない
  if (!teacherBoard) return;

  // 変更がなければ何もしない
  if (!teacherBoard.isBoardDirty) return;

  // 変更アリ → 確認ダイアログを出す
  event.preventDefault();
  event.returnValue = ""; // Chrome 等で必須
});
// ★ ここまで追加

// === サーバー側のボード API ベースパス ===
const BOARD_API_BASE = "/api/board";

// ========= socket.io =========
const socket = createRealtimeBridge();

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

// 生徒画面確認タイル & モーダル
const studentsInfo = document.getElementById("studentsInfo");
const tileGrid = document.getElementById("tileGrid");

// ==============================
// 生徒画面モーダル関連（HTMLのIDに合わせる）
// ==============================
const modalBackdrop = document.getElementById("studentModalBackdrop");
const modalBoardContainer = document.getElementById("studentModalBoardContainer");
const modalShareToStudentBtn = document.getElementById("modalShareToStudentBtn");

// 下レイヤー：生徒の画面・ノート画像を描くキャンバス
let modalCanvas = document.getElementById("studentModalCanvas");
// 上レイヤー：先生の描画用（Whiteboardを紐づける）
let modalOverlayCanvas = null;

const modalTitle = document.getElementById("studentModalTitle");
const modalCloseBtn = document.getElementById("studentModalCloseBtn");

// 下レイヤー用の 2D コンテキスト（画像描画に使う）
let modalCtx = null;


// 左側ツールサイドバー
const modalWbSidebar = document.getElementById("studentModalSidebar");

// 旧UI用の要素は今回使わないので null にしておく
const modalContextMenu = null;
const modalPenSettings = null;
const modalStickySettings = null;
const modalShapeSettings = null;
const modalPenWidthSelect = null;

// ツールボタン（teacher.html の ID に合わせる）
// ※ modalToolPanBtn（「移動」）は UI 上から削除しており、ツールボタンとしては使用しない
const modalToolPanBtn = document.getElementById("modalToolPan");
const modalToolPenBtn = document.getElementById("modalToolPen");
const modalToolHighlighterBtn = document.getElementById("modalToolHighlighter");
const modalToolEraserBtn = document.getElementById("modalToolEraser");
const modalPenColorInput = document.getElementById("modalPenColor");
const modalPenColorButtons = document.querySelectorAll("[data-modal-pen-color]");
const modalChatStudentName = document.getElementById("modalChatStudentName");
const modalChatMessagesEl = document.getElementById("modalChatMessages");
const modalChatInput = document.getElementById("modalChatInput");
const modalChatSendBtn = document.getElementById("modalChatSendBtn");

// 互換用エイリアス（古い処理がこれらを参照していても落ちないように）
// 「移動」ボタンを廃止したため、選択ツール用ボタンは存在しない
const modalToolSelectBtn = null;
const modalToolStampBtn = null;

// モーダル内ホワイトボード用の状態
let modalBoard = null;
// デフォルトツールはペン
let modalCurrentTool = "pen";
let modalSelectedStamp = null;

// ★ 生徒ごとの最新ボードデータを保持（初期同期 & 再描画用）
const latestBoardDataByStudent = {};
// ★ 生徒ごとの最新モード（"whiteboard" | "screen" | "notebook"）を保持
const latestModeByStudent = {};
const latestViewportByStudent = {};
// ★ 追加: モーダル内のボードに「初期同期済み」かどうか
let modalHasInitialBoardData = false;

// ★ 追加: モーダルの書き込みを生徒ホワイトボードに同期するかどうか
//   - true  : これまで通り teacher-whiteboard-action を送る（ホワイトボード共同編集）
//   - false : ノート提出モードなど。画像への注釈専用（生徒WBは編集しない）
let modalSyncToStudent = true;

// ★ 追加: ノート提出モードでの画像共有を少しだけ間引くためのタイマーID
let notebookShareTimeoutId = null;

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

// ★ 追加: ノートフィードバック用の状態変数
const annotationCanvas = document.createElement("canvas");
const annotationCtx = annotationCanvas.getContext("2d");
let baseImage = null;                   // 生徒ノート背景画像
let currentStudentId = null;
let drawing = false;
let lastX = 0;
let lastY = 0;                          // ★ 追加
let eraseMode = false;                  // ★ 追加（消しゴムON/OFF）
let isSharing = false;                  // ★ 追加（ノート共有ON/OFF）
let shareIntervalId = null;             // ★ 追加（共有用 setInterval ID）
let currentHighQualityStudentId = null; // ★ 追加（高画質対象の生徒ID）

// チャット UI 要素（教員）
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatNotifyDot = document.getElementById("chatNotifyDot");
const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatHomeBtn = document.getElementById("chatHomeBtn");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatTargetSelect = document.getElementById("chatTargetSelect");

// チャット状態
let chatPanelOpen = false;
let chatUnreadCount = 0;
const chatHistories = {}; // { [socketId]: [ { from, nickname, text, timestamp } ] }
// ★追加：生徒ID→ニックネーム
const studentNameMap = {};
// ★追加：未読メッセージがある生徒の socketId 一覧
const unreadStudentIds = new Set();
const unreadTemplateKindsByStudentId = new Map();
const CHAT_TEMPLATE_KINDS = ["question", "repeat", "check"];
let activeChatTargetSocketId = null;

let studentListForBoardScope = []; // [{ socketId, nickname }, ...]

// ★ 生徒画面モーダルの現在モード（whiteboard / screen / notebook）
let modalCurrentStudentMode = "whiteboard";

// ★ 追加: ノート提出モード用に「socketId → 生徒ID（ここではニックネーム）」を取得するヘルパー
function getNotebookStudentIdForSocketId(socketId) {
  if (!socketId) return "";

  // まずはチャット用の名前マップを優先
  if (studentNameMap[socketId]) {
    return studentNameMap[socketId];
  }

  // student-list-update で受け取った一覧から探す
  const fromList = (studentListForBoardScope || []).find(
    (s) => s.socketId === socketId
  );
  if (fromList && fromList.nickname) {
    return fromList.nickname;
  }

  // 最後の保険として socketId をそのまま返す
  return socketId;
}

function applyStudentViewportToModalBoard(viewport) {
  if (!modalBoard || !viewport) return false;
  const targetCanvas = modalOverlayCanvas || modalCanvas;
  if (!targetCanvas) return false;

  const targetRect = targetCanvas.getBoundingClientRect();
  const targetWidth = targetRect.width || targetCanvas.width;
  const targetHeight = targetRect.height || targetCanvas.height;
  const sourceWidth = Number(viewport.width || viewport.canvasWidth || 0);
  const sourceHeight = Number(viewport.height || viewport.canvasHeight || 0);
  const sourceScale = Number(viewport.scale || 1);
  const sourceOffsetX = Number(viewport.offsetX || 0);
  const sourceOffsetY = Number(viewport.offsetY || 0);

  if (!targetWidth || !targetHeight || !sourceWidth || !sourceHeight || !sourceScale) {
    return false;
  }

  const fitRatio = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const nextScale = sourceScale * fitRatio;
  const sourceCenterWorldX = (sourceWidth / 2 - sourceOffsetX) / sourceScale;
  const sourceCenterWorldY = (sourceHeight / 2 - sourceOffsetY) / sourceScale;

  modalBoard.scale = nextScale;
  modalBoard.offsetX = targetWidth / 2 - sourceCenterWorldX * nextScale;
  modalBoard.offsetY = targetHeight / 2 - sourceCenterWorldY * nextScale;
  return true;
}

let currentClassCode = null;
// 今開いているボードの Drive ファイルID（なければ null）
let currentBoardFileId = null;
// 今開いているボードのファイル名（拡張子なし）
let currentBoardFileName = "";

const SHARED_BOARD_SNAPSHOT_INTERVAL_MS = 15000;
let sharedBoardSession = null;
let sharedBoardSnapshotTimerId = null;
let sharedBoardSaveInFlight = false;
let applyingSharedBoardRemote = false;


// ========= 共同編集対象の生徒 socketId =========
let currentMonitoringStudentSocketId = null;

// 生徒画面確認用サムネイル
let latestThumbnails = {}; // { socketId: { nickname, dataUrl } }

// ノート確認用の生徒情報
let notebookStudents = {}; // { studentId: { latestImageData } }

// ======== ホワイトボード保存/読み込みダイアログ関連 ========
const teacherOpenSaveDialogBtn = document.getElementById("teacherOpenSaveDialogBtn");
const teacherOpenLoadDialogBtn = document.getElementById("teacherOpenLoadDialogBtn");
const teacherSharedBoardToggleBtn = document.getElementById("teacherSharedBoardToggleBtn");

let boardDialogOverlay = null;
let boardDialogMode = "save";           // "save" or "load"
let boardDialogSelectedFolder = "";     // 選択中フォルダ
let boardDialogSelectedFileId = null;   // 選択中ファイルID
let lastUsedFolderPath = "";            // 直近に使ったフォルダ

// ★ 追加：どの領域を見ているか（先生 / 生徒○○）
let boardScopeMode = "teacher";         // "teacher" or "student"
let boardScopeStudentNickname = "";     // 生徒スコープ時のニックネーム


// ========= 教員セッションからクラスコードを復元して自動参加 =========
function getSharedBoardTitle() {
  return currentBoardFileName || `Shared board ${new Date().toLocaleString()}`;
}

function setSharedBoardButtonState() {
  if (!teacherSharedBoardToggleBtn) return;
  const active = !!sharedBoardSession;
  teacherSharedBoardToggleBtn.innerHTML = active
    ? '<span class="material-symbols-rounded">group_off</span> 共同編集を停止'
    : '<span class="material-symbols-rounded">groups</span> 共同編集を開始';
  teacherSharedBoardToggleBtn.classList.toggle("active", active);
}

function stopSharedBoardSnapshotTimer() {
  if (!sharedBoardSnapshotTimerId) return;
  clearInterval(sharedBoardSnapshotTimerId);
  sharedBoardSnapshotTimerId = null;
}

async function saveSharedBoardSnapshot(boardData, active = true) {
  if (!currentClassCode || !teacherBoard || !boardApi.enabled) return null;
  if (sharedBoardSaveInFlight) return null;

  sharedBoardSaveInFlight = true;
  try {
    const result = await boardApi.saveSharedBoardSnapshot({
      classCode: currentClassCode,
      sharedBoardId: sharedBoardSession?.id || null,
      sourceBoardId: currentBoardFileId,
      title: sharedBoardSession?.title || getSharedBoardTitle(),
      boardData,
      active,
    });

    sharedBoardSession = {
      id: result.sharedBoardId,
      title: result.title,
    };
    setSharedBoardButtonState();
    return result;
  } finally {
    sharedBoardSaveInFlight = false;
  }
}

async function publishSharedBoardSnapshot(reason = "manual") {
  if (!currentClassCode || !teacherBoard || !sharedBoardSession) return;
  const boardData = teacherBoard.exportBoardData();
  await saveSharedBoardSnapshot(boardData, true);
  socket.emit("shared-board-snapshot", {
    classCode: currentClassCode,
    sharedBoardId: sharedBoardSession.id,
    title: sharedBoardSession.title,
    boardData,
    active: true,
    reason,
  });
}

function scheduleSharedBoardSnapshots() {
  stopSharedBoardSnapshotTimer();
  sharedBoardSnapshotTimerId = setInterval(() => {
    if (!sharedBoardSession || !teacherBoard) return;
    const boardData = teacherBoard.exportBoardData();
    void saveSharedBoardSnapshot(boardData, true);
  }, SHARED_BOARD_SNAPSHOT_INTERVAL_MS);
}

async function startSharedBoard() {
  if (!boardApi.enabled) {
    alert("Supabase設定がないため、共同編集ボードはまだ使えません。");
    return;
  }
  if (!currentClassCode) {
    alert("クラスに参加してから共同編集を開始してください。");
    return;
  }
  if (!teacherBoard || typeof teacherBoard.exportBoardData !== "function") {
    alert("ホワイトボードを読み取れませんでした。");
    return;
  }

  const boardData = teacherBoard.exportBoardData();
  const result = await saveSharedBoardSnapshot(boardData, true);
  if (!result) return;

  socket.emit("shared-board-snapshot", {
    classCode: currentClassCode,
    sharedBoardId: result.sharedBoardId,
    title: result.title,
    boardData,
    active: true,
    reason: "start",
  });
  scheduleSharedBoardSnapshots();

  if (statusLabel) {
    statusLabel.textContent = `共同編集を公開中: ${currentClassCode}`;
  }
}

async function stopSharedBoard() {
  if (!sharedBoardSession) return;
  const previous = sharedBoardSession;
  stopSharedBoardSnapshotTimer();

  try {
    if (boardApi.enabled && currentClassCode) {
      await boardApi.stopSharedBoard({
        classCode: currentClassCode,
        sharedBoardId: previous.id,
      });
    }
  } catch (err) {
    console.error("Failed to stop shared board:", err);
  }

  socket.emit("shared-board-snapshot", {
    classCode: currentClassCode,
    sharedBoardId: previous.id,
    title: previous.title,
    active: false,
    reason: "stop",
  });

  sharedBoardSession = null;
  setSharedBoardButtonState();
  if (statusLabel && currentClassCode) {
    statusLabel.textContent = `クラスコード ${currentClassCode} で参加中`;
  }
}

if (teacherBoard) {
  teacherBoard.onAction = (action) => {
    if (!sharedBoardSession || !currentClassCode || applyingSharedBoardRemote) return;
    if (action?.type === "refresh") {
      void publishSharedBoardSnapshot("refresh");
      return;
    }
    socket.emit("shared-board-action", {
      classCode: currentClassCode,
      sharedBoardId: sharedBoardSession.id,
      action,
    });
  };
}

socket.on("shared-board-action", ({ sharedBoardId, action }) => {
  if (!sharedBoardSession || sharedBoardSession.id !== sharedBoardId) return;
  if (!teacherBoard || !action || typeof teacherBoard.applyAction !== "function") return;
  applyingSharedBoardRemote = true;
  try {
    teacherBoard.applyAction(action);
  } finally {
    applyingSharedBoardRemote = false;
  }
});

socket.on("shared-board-snapshot", ({ sharedBoardId, title, boardData, active }) => {
  if (!sharedBoardId) return;
  if (active === false) {
    if (sharedBoardSession?.id === sharedBoardId) {
      sharedBoardSession = null;
      stopSharedBoardSnapshotTimer();
      setSharedBoardButtonState();
    }
    return;
  }
  if (!teacherBoard || !boardData || typeof teacherBoard.importBoardData !== "function") return;
  sharedBoardSession = {
    id: sharedBoardId,
    title: title || "Shared board",
  };
  applyingSharedBoardRemote = true;
  try {
    teacherBoard.importBoardData(boardData);
  } finally {
    applyingSharedBoardRemote = false;
  }
  setSharedBoardButtonState();
});

async function autoJoinClassFromSession() {
  try {
    const res = await fetch("/api/teacher/session", {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      console.warn("teacher session not available:", res.status);
      return;
    }

    const data = await res.json();
    if (!data.ok || !data.classCode) {
      console.log("No teacher session classCode");
      return;
    }

    const code = (data.classCode || "").trim();
    if (!code) return;

    currentClassCode = code;

    // 旧 UI の classCodeInput があれば反映
    if (typeof classCodeInput !== "undefined" && classCodeInput) {
      classCodeInput.value = code;
    }

    // 状態を UI に表示
    if (statusLabel) {
      statusLabel.textContent = `クラスコード ${code} で待機中…`;
    }

    // 教員としてクラスに参加（ホワイトボード用）
    socket.emit("join-teacher", { classCode: code });

    // ノート確認アプリ用
    socket.emit("joinAsTeacher", { classCode: code });

    console.log("Auto joined as teacher for class:", code);
  } catch (err) {
    console.error("Failed to auto join teacher session:", err);
  }
}

// ページ読み込み時に自動実行
autoJoinClassFromSession();


// ========= Explorer風 ボード保存/読み込み API ヘルパー =========

// ★★ 追加：Drive 上に保存されている「生徒のニックネーム一覧」を取得する ★★
//   → /api/board/students で action: "listStudents" を処理する想定
async function fetchStudentNicknameList() {
  if (!currentClassCode) {
    throw new Error("クラスコードが設定されていません。");
  }

  const res = await fetch(`${BOARD_API_BASE}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "listStudents",
      classCode: currentClassCode
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("students API error", res.status, text);
    throw new Error(`生徒一覧 API が失敗しました (status=${res.status})`);
  }

  const json = await res.json();
  if (!json.ok) {
    throw new Error(json.message || "生徒一覧の取得に失敗しました。");
  }

  // 形式は [ "Aさん", "Bさん" ] でも [{ nickname: "Aさん" }, ...] でも対応
  const raw = json.students || json.studentList || [];
  const list = raw
    .map((s) =>
      typeof s === "string"
        ? { nickname: s }
        : { nickname: s.nickname || "" }
    )
    .filter((s) => s.nickname && s.nickname.trim());

  return list;
}

async function fetchFolderList() {
  if (!currentClassCode) {
    throw new Error("クラスコードが設定されていません。");
  }

  // ★ スコープに応じて role / nickname を切り替える
  const isStudentScope =
    boardScopeMode === "student" && boardScopeStudentNickname.trim() !== "";

  const payload = {
    action: "listFolders",
    role: isStudentScope ? "student" : "teacher",
    classCode: currentClassCode
  };

  if (isStudentScope) {
    payload.nickname = boardScopeStudentNickname.trim();
  }

  if (boardApi.enabled) {
    const json = await boardApi.listFolders(payload);
    const folders = json.folders || [];
    return folders.map((f) => {
      const path = f.path || f.folderPath || "";
      const name = f.name || path || "(folder)";
      return { path, name };
    });
  }

  const res = await fetch(`${BOARD_API_BASE}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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
  return folders.map((f) => {
    const path = f.path || f.folderPath || "";
    const name = f.name || path || "(未命名フォルダ)";
    return { path, name };
  });
}


async function fetchFileList(folderPath) {
  if (!currentClassCode) {
    throw new Error("クラスコードが設定されていません。");
  }

  const isStudentScope =
    boardScopeMode === "student" && boardScopeStudentNickname.trim() !== "";

  const payload = {
    action: "listBoards",
    role: isStudentScope ? "student" : "teacher",
    classCode: currentClassCode,
    folderPath: folderPath || ""
  };

  if (isStudentScope) {
    payload.nickname = boardScopeStudentNickname.trim();
  }

  if (boardApi.enabled) {
    const json = await boardApi.listBoards(payload);
    if (!json.ok) throw new Error(json.message || "Failed to load board list.");
    return json.files || [];
  }

  const res = await fetch(`${BOARD_API_BASE}/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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

      <!-- ★ 追加：どの領域を見ているかの切り替え（生徒はプルダウン） -->
      <div class="board-dialog-scope">
        <label>
          <input type="radio" name="boardScope" value="teacher" checked>
          教員用ボード
        </label>
        <label style="margin-left: 8px;">
          <input type="radio" name="boardScope" value="student">
          生徒ボード：
        </label>
        <select
          id="boardDialogStudentSelect"
          class="board-dialog-select-small"
        >
          <option value="">生徒を選択</option>
        </select>
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

  // ★ 追加：スコープ切り替え＆生徒セレクトのイベント
  const scopeTeacherRadio = document.querySelector(
    'input[name="boardScope"][value="teacher"]'
  );
  const scopeStudentRadio = document.querySelector(
    'input[name="boardScope"][value="student"]'
  );
  const studentSelect = document.getElementById("boardDialogStudentSelect");

  // スコープ変更時に状態を更新してフォルダ一覧を再読込
  function updateBoardScopeFromUI() {
    if (scopeStudentRadio && scopeStudentRadio.checked) {
      boardScopeMode = "student";
    } else {
      boardScopeMode = "teacher";
    }

    if (boardScopeMode === "student" && studentSelect) {
      boardScopeStudentNickname = studentSelect.value.trim();
    } else {
      boardScopeStudentNickname = "";
    }

    // スコープが変わったら、フォルダ/ファイルを再読み込み
    reloadFolderList();
  }

  if (scopeTeacherRadio) {
    scopeTeacherRadio.addEventListener("change", updateBoardScopeFromUI);
  }
  if (scopeStudentRadio) {
    scopeStudentRadio.addEventListener("change", updateBoardScopeFromUI);
  }
  if (studentSelect) {
    studentSelect.addEventListener("change", updateBoardScopeFromUI);
  }

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

  // ★★ ここで「Drive 上の生徒一覧」を読み込んでプルダウンを更新 ★★
  reloadStudentListForBoardScope().finally(() => {
    // 教員ボード側のフォルダ一覧も読み込んでおく
    reloadFolderList();
  });
}

function closeBoardDialog() {
  if (boardDialogOverlay) {
    boardDialogOverlay.classList.remove("show");
  }
}

// ★ 生徒一覧プルダウンを更新（Drive 上の情報ベース）
async function reloadStudentListForBoardScope() {
  const studentSelect = document.getElementById("boardDialogStudentSelect");
  if (!studentSelect) return;

  // 一旦「読み込み中」にする
  studentSelect.innerHTML = "";
  const loadingOpt = document.createElement("option");
  loadingOpt.value = "";
  loadingOpt.textContent = "生徒一覧を取得中…";
  studentSelect.appendChild(loadingOpt);

  try {
    const list = await fetchStudentNicknameList();
    // 内部配列も更新しておく（他の処理でも使うかもしれないので）
    studentListForBoardScope = list.map((s) => ({
      socketId: "", // Drive ベースなので socketId は空でOK
      nickname: s.nickname
    }));

    updateBoardDialogStudentSelect();
  } catch (err) {
    console.error("reloadStudentListForBoardScope error", err);
    studentSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "生徒一覧の取得に失敗しました";
    studentSelect.appendChild(opt);
  }
}

// ★ 生徒一覧プルダウンを、内部の studentListForBoardScope から作り直す
function updateBoardDialogStudentSelect() {
  const studentSelect = document.getElementById("boardDialogStudentSelect");
  if (!studentSelect) return;

  const currentValue = studentSelect.value;

  studentSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "生徒を選択";
  studentSelect.appendChild(placeholder);

  studentListForBoardScope.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.nickname || "";
    opt.textContent = s.nickname || s.socketId;
    studentSelect.appendChild(opt);
  });

  // 以前選んでいた生徒がいれば維持
  if (currentValue) {
    const found = Array.from(studentSelect.options).find(
      o => o.value === currentValue
    );
    if (found) {
      found.selected = true;
    }
  }

  // 内部状態も同期
  if (studentSelect.value) {
    boardScopeStudentNickname = studentSelect.value.trim();
  } else {
    boardScopeStudentNickname = "";
  }
}


// ========= フォルダ一覧の再読み込み =========
async function reloadFolderList() {
  const folderListEl = document.getElementById("boardDialogFolderList");
  const fileListEl = document.getElementById("boardDialogFileList");
  if (!folderListEl || !fileListEl) return;

  // ★ 生徒ボードモードで生徒未選択ならメッセージを出して return
  if (
    boardScopeMode === "student" &&
    (!boardScopeStudentNickname || !boardScopeStudentNickname.trim())
  ) {
    folderListEl.innerHTML =
      "<li>生徒ボードを開くには、上のプルダウンから生徒を選択してください。</li>";
    fileListEl.innerHTML = "";
    return;
  }

  folderListEl.innerHTML = `<li>読み込み中...</li>`;
  fileListEl.innerHTML = "";

  try {
    const folders = await fetchFolderList();

    folderListEl.innerHTML = "";

    const rootLi = document.createElement("li");
    rootLi.textContent =
      boardScopeMode === "student" ? "(生徒フォルダ直下)" : "(クラス直下)";
    rootLi.dataset.folderPath = "";
    rootLi.classList.add("board-dialog-folder-item");
    if (!boardDialogSelectedFolder) {
      rootLi.classList.add("selected");
    }
    rootLi.addEventListener("click", () => {
      selectFolder("");
    });
    folderListEl.appendChild(rootLi);

    folders.forEach((f) => {
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

  reloadFolderList(boardDialogSelectedFolder);

}

async function teacherSaveBoardInternal(folderPath, fileName, overwriteFileId) {
  try {
    console.log("[teacherSaveBoardInternal] start", {
      folderPath,
      fileName,
      overwriteFileId,
      currentClassCode
    });

    if (!currentClassCode) {
      alert("先にクラスコードを入力して「開始」してください。");
      return;
    }
    if (!teacherBoard || typeof teacherBoard.exportBoardData !== "function") {
      alert("ホワイトボードの状態を取得できません。");
      return;
    }

    const isStudentScope =
      boardScopeMode === "student" &&
      boardScopeStudentNickname.trim() !== "";

    if (boardScopeMode === "student" && !isStudentScope) {
      alert("生徒ボードに保存するには、ニックネームを入力してください。");
      return;
    }

    const boardData = teacherBoard.exportBoardData();
    console.log("[teacherSaveBoardInternal] boardData exported");

    let finalFileName = (fileName || "").trim();
    if (!finalFileName) {
      // ファイル名未入力時のデフォルト（ISO文字列）
      finalFileName = new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", "_")
        .replace(/:/g, "-");
    }

    const payload = {
      action: "saveBoard",
      role: isStudentScope ? "student" : "teacher",
      classCode: currentClassCode,
      folderPath: (folderPath || "").trim(),
      fileName: finalFileName,
      boardData
    };

    if (isStudentScope) {
      payload.nickname = boardScopeStudentNickname.trim();
    }

    // ★ 上書き対象の fileId があれば付けて送る
    if (overwriteFileId) {
      payload.fileId = overwriteFileId;
    }

    console.log("[teacherSaveBoardInternal] sending fetch", {
      url: `${BOARD_API_BASE}/save`,
      payload
    });

    let res = { ok: true, status: 200 };
    let json = {};
    if (boardApi.enabled) {
      json = await boardApi.saveBoard(payload);
    } else {
      res = await fetch(`${BOARD_API_BASE}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch (e) {
        console.warn("[teacherSaveBoardInternal] response is not JSON", text);
      }
    }

    console.log("[teacherSaveBoardInternal] response", res.status, json);

    if (!res.ok || json.ok === false) {
      alert(
        (json && json.message) ||
        `ホワイトボードの保存に失敗しました。（status=${res.status}）`
      );
      return;
    }

    const mode = json.mode || (overwriteFileId ? "update" : "create");

    // ★ 今保存したファイルの情報を覚えておく（上書き保存ボタン用）
    if (json.fileId) {
      currentBoardFileId = json.fileId;
    } else if (overwriteFileId) {
      currentBoardFileId = overwriteFileId;
    }

    // GAS 側から fileName が返ってくるならそれを元に拡張子なしを保存
    if (json.fileName) {
      currentBoardFileName = json.fileName.replace(/\.json$/i, "");
    } else {
      currentBoardFileName = finalFileName;
    }

    lastUsedFolderPath = (folderPath || "").trim();

    // ★ ここで「保存済み」にする（dirty フラグをリセット）
    if (typeof teacherBoard.markSaved === "function") {
      teacherBoard.markSaved();
    }

    alert(
      json.message ||
      (mode === "update"
        ? "ホワイトボードを上書き保存しました。"
        : "ホワイトボードを保存しました。")
    );
    closeBoardDialog();
  } catch (err) {
    console.error("[teacherSaveBoardInternal] error", err);
    alert("ホワイトボードの保存に失敗しました: " + err);
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

  const isStudentScope =
    boardScopeMode === "student" &&
    boardScopeStudentNickname.trim() !== "";

  if (boardScopeMode === "student" && !isStudentScope) {
    alert("生徒ボードを開くには、ニックネームを入力してください。");
    return;
  }

  try {
    const payload = {
      action: "loadBoard",
      role: isStudentScope ? "student" : "teacher",
      classCode: currentClassCode,
      folderPath: (folderPath || "").trim(),
      fileId
    };

    if (isStudentScope) {
      payload.nickname = boardScopeStudentNickname.trim();
    }

    if (boardApi.enabled) {
      const json = await boardApi.loadBoard(payload);
      if (!json.ok) {
        alert(json.message || "Failed to load board.");
        return;
      }
      if (!json.boardData) {
        alert("Board data was not found.");
        return;
      }

      teacherBoard.importBoardData(json.boardData);
      if (typeof teacherBoard.markSaved === "function") {
        teacherBoard.markSaved();
      }
      currentBoardFileId = json.fileId || fileId || null;
      currentBoardFileName = json.fileName ? json.fileName.replace(/\.json$/i, "") : "";
      lastUsedFolderPath = (folderPath || "").trim();
      alert("Loaded board.");
      closeBoardDialog();
      return;
    }

    const res = await fetch(`${BOARD_API_BASE}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("loadBoard JSON parse error:", e, text);
      alert("GAS からの応答の解析に失敗しました。");
      return;
    }

    console.log("loadBoard result:", json);

    if (!json.ok) {
      alert(json.message || "ホワイトボードの読み込みに失敗しました。");
      return;
    }

    if (!json.boardData) {
      alert("ボードデータが見つかりませんでした。");
      return;
    }

    teacherBoard.importBoardData(json.boardData);

    // ★ 読み込み直後の状態を「保存済み」とみなす
    if (typeof teacherBoard.markSaved === "function") {
      teacherBoard.markSaved();
    }

    // ★ ここで「今開いているファイル情報」を更新
    currentBoardFileId = json.fileId || fileId || null;
    if (json.fileName) {
      currentBoardFileName = json.fileName.replace(/\.json$/i, "");
    } else {
      currentBoardFileName = "";
    }
    lastUsedFolderPath = (folderPath || "").trim();

    alert("ホワイトボードを読み込みました。");
    closeBoardDialog();
  } catch (err) {
    console.error(err);
    alert("ホワイトボードの読み込み中にエラーが発生しました。");
  }
}



function onClickSaveConfirm() {
  console.log("[BoardDialog] Save button clicked");

  const folderInput = document.getElementById("boardDialogFolderInput");
  const folderPath = folderInput ? folderInput.value.trim() : "";

  const fileNameInput = document.getElementById("boardDialogFileNameInput");
  const fileName = fileNameInput ? fileNameInput.value.trim() : "";

  // 既存ファイルを選択していれば boardDialogSelectedFileId に入っている
  teacherSaveBoardInternal(folderPath, fileName, boardDialogSelectedFileId);
}



function onClickLoadConfirm() {
  console.log("[BoardDialog] Load button clicked");

  if (!boardDialogSelectedFileId) {
    alert("読み込みたいファイルを選択してください。");
    return;
  }

  teacherLoadBoardInternal(boardDialogSelectedFolder, boardDialogSelectedFileId);
}

if (teacherOpenSaveDialogBtn) {
  teacherOpenSaveDialogBtn.addEventListener("click", () => {
    openBoardDialog("save");
  });
}

if (teacherOpenLoadDialogBtn) {
  teacherOpenLoadDialogBtn.addEventListener("click", () => openBoardDialog("load"));
}

const teacherOverwriteSaveBtn = document.getElementById("teacherOverwriteSaveBtn");

if (teacherOverwriteSaveBtn) {
  teacherOverwriteSaveBtn.addEventListener("click", () => {
    console.log("[OverwriteSave] clicked", {
      currentBoardFileId,
      currentBoardFileName,
      lastUsedFolderPath
    });

    // まだ一度も保存していない or 読み込んでいない場合
    if (!currentBoardFileId || !currentBoardFileName) {
      alert("まだ保存されていないボードです。「保存」からファイル名を付けて保存してください。");
      openBoardDialog("save");
      return;
    }

    // 今開いているファイルに対して上書き保存
    teacherSaveBoardInternal(
      lastUsedFolderPath || "",
      currentBoardFileName,
      currentBoardFileId
    );
  });
}


// ========= クラス開始（教員として参加） =========
if (teacherSharedBoardToggleBtn) {
  teacherSharedBoardToggleBtn.addEventListener("click", () => {
    if (sharedBoardSession) {
      void stopSharedBoard();
    } else {
      void startSharedBoard();
    }
  });
  setSharedBoardButtonState();
}

let role = null;

// ----- 退室ボタン処理（新規追加）-----
// ========= 退室ボタン（追加） =========
const leaveClassBtn = document.getElementById("leaveClassBtn");
if (leaveClassBtn) {
  leaveClassBtn.addEventListener("click", async () => {
    if (!currentClassCode) {
      alert("現在参加しているクラスはありません。");
      return;
    }

    // サーバ側に退室を通知
    await stopSharedBoard();
    socket.emit("leave-class");

    // クライアント側の状態リセット
    currentClassCode = null;
    role = null;

    if (statusLabel) {
      statusLabel.textContent = "退室しました";
    }
    if (classCodeInput) {
      classCodeInput.value = "";
    }

    // ★ ログイン画面へ移動（URLはプロジェクトに合わせて変更）
    window.location.href = "/teacher-login.html";
  });
}



// ========= 入室ボタン（修正） =========
if (startClassBtn && classCodeInput) {
  startClassBtn.addEventListener("click", async () => {
    const code = classCodeInput.value.trim();
    if (!code) {
      alert("クラスコードを入力してください。");
      return;
    }

    // すでに別のクラスにいたらleaveしてからjoin
    if (currentClassCode && currentClassCode !== code) {
      await stopSharedBoard();
      socket.emit("leave-class");
      console.log(`Leaving previous class ${currentClassCode}`);
    }

    // 再宣言ではなく、既存変数へ代入
    currentClassCode = code;
    role = "teacher";

    socket.emit("join-teacher", { classCode: code });
    socket.emit("teacher-start-class", { classCode: code });

    // 互換システム用（あなたの仕組みにすでにある）
    socket.emit("joinAsTeacher", { classCode: code });

    if (statusLabel) {
      statusLabel.textContent = `クラスコード ${code} で参加中`;
    }
  });
}



socket.on("teacher-class-started", payload => {
  if (statusLabel && payload?.classCode) {
    statusLabel.textContent = `クラス開始中: ${payload.classCode}`;
  }
});

// ======== 生徒画面モーダル用ツール切り替え ========

function applyModalPenColor(color) {
  if (!color) return;
  if (modalPenColorInput) {
    modalPenColorInput.value = color;
  }
  modalPenColorButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.modalPenColor === color);
  });
  if (!modalBoard) return;
  if (modalCurrentTool === "highlighter") {
    modalBoard.setHighlighterColor(color);
  } else {
    modalBoard.setPen(color, 3);
  }
}

function setModalTool(tool) {
  modalCurrentTool = tool;

  const buttons = [
    modalToolSelectBtn,
    modalToolPenBtn,
    modalToolHighlighterBtn,
    modalToolEraserBtn,
    modalToolStampBtn
  ];
  buttons.forEach(btn => btn && btn.classList.remove("active"));

  if (tool === "select" && modalToolSelectBtn) modalToolSelectBtn.classList.add("active");
  if (tool === "pen" && modalToolPenBtn) modalToolPenBtn.classList.add("active");
  if (tool === "highlighter" && modalToolHighlighterBtn) modalToolHighlighterBtn.classList.add("active");
  if (tool === "eraser" && modalToolEraserBtn) modalToolEraserBtn.classList.add("active");
  if (tool === "stamp" && modalToolStampBtn) modalToolStampBtn.classList.add("active");

  // modalBoard にツール設定を反映
  if (modalBoard) {
    if (tool === "select") {
      modalBoard.setTool("select");
    } else if (tool === "pen") {
      modalBoard.setTool("pen");
      modalBoard.setPen(modalPenColorInput ? modalPenColorInput.value : "#ff0000", 3);
    } else if (tool === "highlighter") {
      modalBoard.setTool("highlighter");
      // 蛍光ペンは太め・黄色（または選択色）
      modalBoard.setHighlighterColor(modalPenColorInput ? modalPenColorInput.value : "#ffff00");
    } else if (tool === "eraser") {
      modalBoard.setTool("eraser");
    } else if (tool === "stamp") {
      modalBoard.setTool("stamp");
      // スタンプの種類設定は別途行うが、ここでは簡易的に
      if (modalBoard.setStampType) modalBoard.setStampType("circle-ok"); // デフォルト
    }
  }
}

// 「移動」（選択）ボタンは廃止しているため、リスナーは不要
if (modalToolPenBtn) {
  modalToolPenBtn.addEventListener("click", () => setModalTool("pen"));
}
if (modalToolHighlighterBtn) {
  modalToolHighlighterBtn.addEventListener("click", () => setModalTool("highlighter"));
}
if (modalToolEraserBtn) {
  modalToolEraserBtn.addEventListener("click", () => setModalTool("eraser"));
}
if (modalToolStampBtn) {
  modalToolStampBtn.addEventListener("click", () => {
    setModalTool("stamp");
    const ch = window.prompt(
      "スタンプとして描画する文字を入力（例: ◎, ○, ★, 👍 ）",
      modalSelectedStamp || "◎"
    );
    if (ch && ch.trim()) {
      modalSelectedStamp = ch.trim()[0];
    }
  });
}

// 初期ツールはペン
setModalTool("pen");

// ========= ビュー切り替え：ホワイトボード / 生徒画面 / ノート確認 =========
function setTeacherViewMode(mode) {
  if (!boardContainer || !studentViewContainer || !notebookViewContainer) return;

  const sidebar = document.getElementById("wbSidebar");
  const bottomTools = document.querySelector(".floating-bottom-right");
  const contextMenu = document.getElementById("contextMenu");

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

  const closeContextMenu = () => {
    if (!contextMenu) return;
    contextMenu.classList.add("hidden");
    contextMenu.style.display = "";
    contextMenu.querySelectorAll(".context-section").forEach(section => {
      section.classList.add("hidden");
    });
  };

  // ★★★ ここで「生徒キャプチャ開始／停止」を制御 ★★★
  // currentClassCode が入っているときだけサーバーに通知する
  if (currentClassCode) {
    if (mode === "student") {
      // 生徒画面確認モードに入った → 生徒にキャプチャ開始してもらう
      socket.emit("student-view-start", { classCode: currentClassCode });
    } else {
      // ホワイトボード or ノート確認モード → 生徒のキャプチャは不要なので停止
      socket.emit("student-view-stop", { classCode: currentClassCode });
    }
  }

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

    // ツールバーを表示
    if (sidebar) show(sidebar);
    if (bottomTools) show(bottomTools);
    closeContextMenu();
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

    // ツールバーを隠す
    if (sidebar) hide(sidebar);
    if (bottomTools) hide(bottomTools);
    closeContextMenu();
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

    // ツールバーを隠す
    if (sidebar) hide(sidebar);
    if (bottomTools) hide(bottomTools);
    closeContextMenu();
  }
}

// ビューボタン押下時のハンドラ
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

// ========= 生徒画面確認（タイル表示） =========

socket.on("student-list-update", (list) => {
  const normalizedList = list || [];

  if (studentsInfo) {
    studentsInfo.textContent = `接続中の生徒: ${normalizedList.length}人`;
  }

  // これは「現在接続中の生徒一覧」。Drive 上の保存済み一覧とは別物だが、
  // 必要であれば内部に持っておく
  studentListForBoardScope = normalizedList;

  // ★ ソケットID → ニックネームのマップもここで更新（ノート提出モードで使用）
  normalizedList.forEach((s) => {
    if (!s || !s.socketId) return;
    studentNameMap[s.socketId] = s.nickname || s.socketId;
  });
  updateModalChatTargetLabel();

  // チャット宛先セレクト更新
  if (chatTargetSelect) {
    const current = activeChatTargetSocketId;
    chatTargetSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "生徒を選択";
    chatTargetSelect.appendChild(placeholder);

    normalizedList.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.socketId;
      opt.textContent = s.nickname || s.socketId;
      chatTargetSelect.appendChild(opt);
    });

    if (current) {
      const found = Array.from(chatTargetSelect.options).find(
        (o) => o.value === current
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


socket.on("student-thumbnail", ({ socketId, nickname, dataUrl, mode, viewport }) => {
  if (!socketId || !dataUrl) return;

  // ★ mode が来ていればそれを、来ていなければ latestModeByStudent を参照
  const currentMode = mode || latestModeByStudent[socketId] || "whiteboard";
  latestModeByStudent[socketId] = currentMode;
  if (viewport) {
    latestViewportByStudent[socketId] = viewport;
  }

  // ★ ノート提出モード中は、ここで受け取ったサムネイルでは上書きしない
  //    （ノート画像サムネは student-screen-update 側で作っている）
  if (currentMode === "notebook") {
    return;
  }

  // それ以外のモード（whiteboard / screen）のときだけ通常サムネを更新
  latestThumbnails[socketId] = { nickname, dataUrl, mode: currentMode, viewport };
  renderTiles();
});


// ★ ここを「Canvasベースのモーダル表示」に修正 ★
// ★ 高解像度画像受信時：今回は「モーダルを開く＋タイトル更新」だけ行う
socket.on("student-highres", ({ socketId, nickname, dataUrl }) => {
  if (!modalBackdrop || !modalTitle) return;

  modalTitle.textContent = `${nickname || "生徒"} さんの画面`;
  modalBackdrop.style.display = "flex";
  modalBackdrop.classList.add("show");

  // 実際の描画・編集は startMonitoringStudent 内で初期化した modalBoard が担当する
});


/* ==== 共同編集用：生徒からのボード状態・操作を反映 ==== */


// 生徒の現在のホワイトボード全体状態（セッション開始直後など）
socket.on("student-board-state", ({ studentSocketId, boardData }) => {
  console.log("[teacher] student-board-state", {
    studentSocketId,
    hasBoardData: !!boardData
  });

  if (!studentSocketId || !boardData) return;

  latestBoardDataByStudent[studentSocketId] = boardData;

  // ★ その生徒の現在モード（なければ whiteboard とみなす）
  const mode = latestModeByStudent[studentSocketId] || "whiteboard";
  // 画面共有・ノートモードのときは、ボードデータは保存だけして画面には反映しない
  if (mode !== "whiteboard") {
    return;
  }

  if (
    !currentMonitoringStudentSocketId ||
    studentSocketId !== currentMonitoringStudentSocketId
  ) {
    return;
  }

  if (!modalBoard || typeof modalBoard.importBoardData !== "function") return;

  modalBoard.importBoardData(boardData);
  if (typeof modalBoard.render === "function") {
    modalBoard.render();
  }

  // ★ ここで「初期同期済み」にする
  // The first viewport-aware student-screen-update will finish initial alignment.
});



// 生徒側の増分操作（ペン・消しゴム・図形など）
socket.on("student-whiteboard-action", ({ studentSocketId, action }) => {
  console.log("[teacher] student-whiteboard-action", {
    studentSocketId,
    hasAction: !!action
  });

  // 今監視している生徒以外の操作は無視
  if (!currentMonitoringStudentSocketId ||
    studentSocketId !== currentMonitoringStudentSocketId) {
    return;
  }

  if (!modalBoard || !action || typeof modalBoard.applyAction !== "function") return;
  modalBoard.applyAction(action);
});


// ★ 生徒側からの「画面更新」（スクショ＋ボードデータ）
//   → 共同編集中の生徒のボードデータを定期的に上書きする用途
// ★ 生徒側からの「画面更新」（スクショ＋ボードデータ）
//   → 共同編集中の生徒のボードデータを定期的に上書きする用途
socket.on(
  "student-screen-update",
  ({ studentSocketId, classCode, dataUrl, viewport, mode, boardData, isSync }) => {
    const effectiveMode = mode || "whiteboard";

    console.log("[teacher] student-screen-update", {
      studentSocketId,
      mode: effectiveMode,
      hasBoardData: !!boardData,
      hasImage: !!dataUrl
    });

    if (!studentSocketId) return;

    // 生徒ごとの最新モードを記録
    latestModeByStudent[studentSocketId] = effectiveMode;
    if (viewport) {
      latestViewportByStudent[studentSocketId] = viewport;
    }
    modalCurrentStudentMode = effectiveMode;

    // ★ 追加：モードに応じてグリッド表示切り替え
    if (modalBoard && currentMonitoringStudentSocketId === studentSocketId) {
      modalBoard.setShowGrid(effectiveMode !== "notebook");
    }

    // 最新の boardData は保持しておく（whiteboardモード用）
    if (boardData) {
      latestBoardDataByStudent[studentSocketId] = boardData;
    }

    // 監視中の生徒以外ならモーダル描画は無視
    if (
      !currentMonitoringStudentSocketId ||
      studentSocketId !== currentMonitoringStudentSocketId
    ) {
      // ★ ただしノート提出モードのときは、タイル用サムネイルだけ更新したいので
      //    後の処理で使えるように dataUrl は活かしておく
      if (!dataUrl || effectiveMode !== "notebook") {
        return;
      }
    }

    // モーダルタイトルにモードを表示
    if (modalTitle) {
      const base =
        modalTitle.dataset.baseTitle ||
        modalTitle.textContent.replace(/（.*モード）$/, "");
      modalTitle.dataset.baseTitle = base;

      let modeLabel = "ホワイトボードモード";
      if (effectiveMode === "screen") modeLabel = "画面共有モード";
      else if (effectiveMode === "notebook") modeLabel = "ノート提出モード";

      modalTitle.textContent = `${base}（${modeLabel}）`;
    }

    // ===== モード別の扱い =====

    // --- 1. ホワイトボードモード ---
    if (effectiveMode === "whiteboard") {
      if (!modalBoard || typeof modalBoard.importBoardData !== "function") {
        return;
      }

      // 初期同期がまだ、または強制同期(isSync=true)の場合に取り込む
      if ((!modalHasInitialBoardData || isSync) && boardData) {
        const previousModalView = modalHasInitialBoardData
          ? {
            scale: modalBoard.scale,
            offsetX: modalBoard.offsetX,
            offsetY: modalBoard.offsetY
          }
          : null;
        modalBoard.importBoardData(boardData);
        if (!modalHasInitialBoardData) {
          applyStudentViewportToModalBoard(
            viewport || latestViewportByStudent[studentSocketId]
          );
        } else if (previousModalView) {
          modalBoard.scale = previousModalView.scale;
          modalBoard.offsetX = previousModalView.offsetX;
          modalBoard.offsetY = previousModalView.offsetY;
        }
        modalBoard.render?.();
        modalHasInitialBoardData = true;
      }

      // whiteboardモードでは overlay 上に書きながら、生徒WBと同期（onActionで emit）
      if (modalOverlayCanvas) {
        modalOverlayCanvas.style.pointerEvents = "auto";
      }

      // 下レイヤー（modalCanvas）は真っ白でもよいので、特に何もしなくてOK
      if (modalCtx && modalCanvas) {
        modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
      }

      return;
    }

    // --- 2. ノート提出モード & 3. 画面共有モード ---
    // どちらも「下レイヤーに画像を表示し、上レイヤーはローカル描画のみ」という動きに統一
    if (!dataUrl) return;

    // 上レイヤーはローカル注釈用
    if (modalOverlayCanvas) {
      modalOverlayCanvas.style.pointerEvents = "auto";
    }

    const img = new Image();
    img.onload = () => {
      // ===== モーダル用の描画 =====
      if (modalCanvas && modalCtx && currentMonitoringStudentSocketId === studentSocketId) {
        const cw = modalCanvas.width;
        const ch = modalCanvas.height;
        if (cw && ch) {
          const scale = Math.min(cw / img.width, ch / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const dx = (cw - drawW) / 2;
          const dy = (ch - drawH) / 2;

          // ★ 下レイヤーだけを描き替える。上レイヤーの先生の書き込みは残る。
          modalCtx.clearRect(0, 0, cw, ch);
          modalCtx.drawImage(img, dx, dy, drawW, drawH);
        }
      }

      // ===== ノート提出モードのときは、タイル用サムネイルも更新 =====
      if (effectiveMode === "notebook") {
        // タイル用のサムネイルは、解像度を落とした小さい画像にする
        const thumbMaxWidth = 320;   // お好みで 200〜400px くらいに調整可
        const thumbMaxHeight = 240;

        const scaleThumb = Math.min(
          thumbMaxWidth / img.width,
          thumbMaxHeight / img.height,
          1
        );
        const tw = img.width * scaleThumb;
        const th = img.height * scaleThumb;

        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = tw;
        thumbCanvas.height = th;
        const tctx = thumbCanvas.getContext("2d");
        if (tctx) {
          tctx.drawImage(img, 0, 0, tw, th);

          // JPEG で軽量化（品質0.7くらい）
          const thumbDataUrl = thumbCanvas.toDataURL("image/jpeg", 0.7);

          latestThumbnails[studentSocketId] = {
            nickname:
              getNotebookStudentIdForSocketId(studentSocketId) ||
              studentNameMap[studentSocketId] ||
              "",
            dataUrl: thumbDataUrl
          };

          // 生徒画面確認モードのタイルを再描画
          renderTiles();
        }
      }
    };

    img.src = dataUrl;
  }
);






// ======== 生徒画面モーダル用：描画処理 ========

// 以前の Canvas 手書き実装は削除し、Whiteboard クラスに任せる
// modalBoard の初期化は startMonitoringStudent で行う

// 色変更時のイベントリスナーを追加
if (modalPenColorInput) {
  modalPenColorInput.addEventListener("change", () => {
    applyModalPenColor(modalPenColorInput.value);
  });
}

modalPenColorButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    applyModalPenColor(btn.dataset.modalPenColor);
  });
});

/* ===== 共同編集開始 / 終了ヘルパー ===== */

/**
 * 特定の生徒のタイルをクリックしたときに呼び出される。
 * - 以前監視していた生徒がいれば、そのセッションを終了
 * - 新しい生徒との「start-monitoring」セッションを開始
 * - ステータスラベルを更新
 */
function startMonitoringStudent(studentSocketId, nickname) {
  if (!currentClassCode) return;

  // すでに別の生徒を監視していた場合は一旦終了
  if (
    currentMonitoringStudentSocketId &&
    currentMonitoringStudentSocketId !== studentSocketId
  ) {
    socket.emit("stop-monitoring", {
      classCode: currentClassCode,
      studentSocketId: currentMonitoringStudentSocketId
    });
  }

  // 今回選択した生徒を「現在監視中」として記録
  currentMonitoringStudentSocketId = studentSocketId;

  // ★ 初期同期フラグをリセット
  modalHasInitialBoardData = false;

  // サーバーに共同編集セッション開始を通知
  socket.emit("start-monitoring", {
    classCode: currentClassCode,
    studentSocketId
  });

  // ★ ここでモーダルを開く
  if (modalBackdrop) {
    modalBackdrop.style.display = "flex";
    modalBackdrop.classList.add("show");
  }
  if (modalTitle) {
    modalTitle.textContent = `${nickname || "生徒"} さんの画面`;
  }

  // キャンバスの準備と Whiteboard 初期化
  updateModalChatTargetLabel(studentSocketId);
  renderModalChatMessagesForTarget(studentSocketId);
  if (modalChatInput) modalChatInput.focus();

  if (modalCanvas && modalBoardContainer) {
    const rect = modalBoardContainer.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const dpr = window.devicePixelRatio || 1;

    // --- 下レイヤー（生徒画像） ---
    modalCanvas.width = w * dpr;
    modalCanvas.height = h * dpr;
    modalCanvas.style.width = w + "px";
    modalCanvas.style.height = h + "px";
    modalCanvas.style.pointerEvents = "none"; // 下レイヤーはマウス無効（上だけ受ける）

    modalCtx = modalCanvas.getContext("2d");

    // --- 上レイヤー（先生の描画） ---
    if (!modalOverlayCanvas) {
      modalOverlayCanvas = document.createElement("canvas");
      modalOverlayCanvas.id = "studentModalOverlayCanvas";
      modalOverlayCanvas.style.position = "absolute";
      modalOverlayCanvas.style.left = "0";
      modalOverlayCanvas.style.top = "0";
      modalOverlayCanvas.style.width = "100%";
      modalOverlayCanvas.style.height = "100%";
      modalOverlayCanvas.style.pointerEvents = "auto"; // 描画イベントはここで受ける

      // 親コンテナは position: absolute なので、この子は重ねて表示される
      modalBoardContainer.appendChild(modalOverlayCanvas);
    }

    modalOverlayCanvas.width = w * dpr;
    modalOverlayCanvas.height = h * dpr;

    // Whiteboard は「上レイヤー」に紐づける
    modalBoard = new Whiteboard({ canvas: modalOverlayCanvas });
    modalBoard.setTeacherMode(true);

    // ★ ノート提出モードならグリッド非表示
    if (modalCurrentStudentMode === "notebook") {
      modalBoard.setShowGrid(false);
    } else {
      modalBoard.setShowGrid(true);
    }

    const initialBoardData = latestBoardDataByStudent[studentSocketId];
    if (initialBoardData && typeof modalBoard.importBoardData === "function") {
      // ※ 初期は「whiteboardモード」でのみ使う。notebook/screenのときは
      //   生徒のboardDataは使わず、画像の上にローカル描画扱いにする。
      if (modalCurrentStudentMode === "whiteboard") {
        modalBoard.importBoardData(initialBoardData);
        applyStudentViewportToModalBoard(latestViewportByStudent[studentSocketId]);
      }
    }

    // Whiteboard のスケール反映
    modalBoard.applyScale?.();
    modalBoard.render?.();

    // リサイズ対応
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (!modalBoard || !modalCanvas || !modalOverlayCanvas) return;
        const dpr = window.devicePixelRatio || 1;

        // 下レイヤー更新
        modalCanvas.width = width * dpr;
        modalCanvas.height = height * dpr;
        modalCanvas.style.width = width + "px";
        modalCanvas.style.height = height + "px";

        // 上レイヤー更新
        modalOverlayCanvas.width = width * dpr;
        modalOverlayCanvas.height = height * dpr;
        modalOverlayCanvas.style.width = width + "px";
        modalOverlayCanvas.style.height = height + "px";

        modalBoard.resize(width, height);
        modalBoard.applyScale?.();
        modalBoard.render?.();
      }
    });
    resizeObserver.observe(modalBoardContainer);

    // ツール初期化
    setModalTool(modalCurrentTool);

    // 線を書いたときのactionフック
    modalBoard.onAction = (action) => {
      if (!currentClassCode || !currentMonitoringStudentSocketId) return;

      // ★ notebook / screen モードのときは、生徒ホワイトボードを変更しない
      if (modalCurrentStudentMode !== "whiteboard") {
        // ローカル描画のみ（overlay上だけ）にするので emit しない
        return;
      }

      socket.emit("teacher-whiteboard-action", {
        classCode: currentClassCode,
        targetStudentSocketId: currentMonitoringStudentSocketId,
        action
      });
    };
  }


  if (statusLabel) {
    statusLabel.textContent = `共同編集中: ${nickname || "生徒"
      } さん（クラスコード ${currentClassCode}）`;
  }
}




/**
 * 教員が現在監視している生徒との共同編集セッションを終了する。
 * - モーダルを閉じるタイミングなどから呼び出される想定。
 */
function stopMonitoringStudent() {
  if (!currentClassCode || !currentMonitoringStudentSocketId) return;

  socket.emit("stop-monitoring", {
    classCode: currentClassCode,
    studentSocketId: currentMonitoringStudentSocketId
  });

  currentMonitoringStudentSocketId = null;

  if (statusLabel) {
    statusLabel.textContent = `クラスコード ${currentClassCode} で待機中…`;
  }
}

/**
 * 生徒一覧タイルを描画。
 * - サムネイル画像クリックで:
 *   1) 高解像度画像のリクエスト
 *   2) 共同編集セッション開始（startMonitoringStudent）
 */
function renderTiles() {
  if (!tileGrid) return;

  tileGrid.innerHTML = "";
  Object.entries(latestThumbnails).forEach(([socketId, info]) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.studentSocketId = socketId;

    const img = document.createElement("img");
    img.src = info.dataUrl;
    img.alt = `${info.nickname} さんの画面プレビュー`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = info.nickname;

    tile.appendChild(img);

    if (unreadStudentIds.has(socketId)) {
      const chatAlertBtn = document.createElement("button");
      chatAlertBtn.type = "button";
      chatAlertBtn.className = "student-tile-chat-alert";
      const templateKind = normalizeChatTemplateKind(
        unreadTemplateKindsByStudentId.get(socketId) || ""
      );
      if (templateKind) {
        chatAlertBtn.classList.add(`chat-template-notice--${templateKind}`);
      }
      const dotClass = templateKind ? ` chat-template-notice--${templateKind}` : "";
      chatAlertBtn.title = `${info.nickname || "生徒"}のチャットを開く`;
      chatAlertBtn.setAttribute("aria-label", `${info.nickname || "生徒"}のチャットを開く`);
      chatAlertBtn.innerHTML = `<span class="material-symbols-rounded">chat</span><span class="chat-notify-dot show${dotClass}"></span>`;
      chatAlertBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openChatForStudent(socketId);
      });
      tile.appendChild(chatAlertBtn);
    }

    tile.appendChild(meta);

    tile.addEventListener("click", () => {
      if (!currentClassCode) return;

      socket.emit("request-highres", {
        classCode: currentClassCode,
        studentSocketId: socketId
      });

      startMonitoringStudent(socketId, info.nickname);
    });

    tileGrid.appendChild(tile);
  });
}

/**
 * 生徒画面拡大モーダルを閉じたときの処理。
 */
if (modalBackdrop && modalCloseBtn) {
  const hideModal = () => {
    modalBackdrop.classList.remove("show");
    modalBackdrop.style.display = "none";

    // ★★ ここが重要：監視状態とmodal関連をすべてリセット ★★
    currentMonitoringStudentSocketId = null;
    if (modalChatInput) modalChatInput.value = "";
    renderModalChatMessagesForTarget("");

    // ★ モーダル用の状態だけリセット（canvas サイズは触らない）
    // ▼ ここはコメントアウトする（生徒ノートの背景画像は消さない）
    // if (modalCanvas) {
    //   const ctx = modalCanvas.getContext("2d");
    //   if (ctx) {
    //     ctx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
    //   }
    // }
    if (modalOverlayCanvas) {
      const octx = modalOverlayCanvas.getContext("2d");
      if (octx) {
        octx.clearRect(0, 0, modalOverlayCanvas.width, modalOverlayCanvas.height);
      }
    }

    if (modalBoard) {
      modalBoard.destroy?.();
    }
    modalBoard = null;
    modalHasInitialBoardData = false;


    // ★ ノート用の送信タイマーと同期フラグもリセット
    modalSyncToStudent = true;
    if (notebookShareTimeoutId) {
      clearTimeout(notebookShareTimeoutId);
      notebookShareTimeoutId = null;
    }

    stopMonitoringStudent();

    // ★ 追加: 閉じる直前に「ノート画像 + 先生書き込み」を合成して生徒へ送る
    const merged = mergeStudentModalCanvases();
    if (merged && currentClassCode && currentMonitoringStudentSocketId) {
      socket.emit("teacherShareToStudent", {
        classCode: currentClassCode,
        studentSocketId: currentMonitoringStudentSocketId,
        mergedDataURL: merged
      });
    }

  };

  modalCloseBtn.addEventListener("click", hideModal);


  modalBackdrop.addEventListener("click", e => {
    if (e.target === modalBackdrop) {
      hideModal();
    }
  });
}



// ========= チャット機能 =========

// ★ バッジ表示/非表示を一元管理
function normalizeChatTemplateKind(kind) {
  return CHAT_TEMPLATE_KINDS.includes(kind) ? kind : "";
}

function getCurrentUnreadTemplateKind() {
  const kinds = [...unreadTemplateKindsByStudentId.values()]
    .map(normalizeChatTemplateKind)
    .filter(Boolean);
  return kinds[kinds.length - 1] || "";
}

function updateChatTemplateNoticeClass(kind) {
  if (!chatToggleBtn || !chatNotifyDot) return;
  const normalizedKind = normalizeChatTemplateKind(kind);
  CHAT_TEMPLATE_KINDS.forEach(templateKind => {
    const className = `chat-template-notice--${templateKind}`;
    chatToggleBtn.classList.remove(className);
    chatNotifyDot.classList.remove(className);
  });
  if (normalizedKind) {
    const className = `chat-template-notice--${normalizedKind}`;
    chatToggleBtn.classList.add(className);
    chatNotifyDot.classList.add(className);
  }
}

function updateChatBadge() {
  if (!chatToggleBtn || !chatNotifyDot) return;

  if (unreadStudentIds.size > 0) {
    chatToggleBtn.classList.add("has-unread");
    updateChatTemplateNoticeClass(getCurrentUnreadTemplateKind());
    chatNotifyDot.classList.remove("hidden");
    chatNotifyDot.style.display = "block";
  } else {
    chatToggleBtn.classList.remove("has-unread");
    updateChatTemplateNoticeClass("");
    chatNotifyDot.classList.add("hidden");
    chatNotifyDot.style.display = "none";
  }

  // chatUnreadCount は「未読の生徒数」として扱う
  chatUnreadCount = unreadStudentIds.size;
  renderTiles();
}

function updateChatHomeButton() {
  if (!chatHomeBtn) return;
  const show = !!activeChatTargetSocketId;
  chatHomeBtn.classList.toggle("hidden", !show);
  chatHomeBtn.setAttribute("aria-hidden", show ? "false" : "true");
}

function setChatPanelOpen(open) {
  chatPanelOpen = open;
  if (!chatPanel || !chatToggleBtn) return;

  chatPanel.classList.toggle("collapsed", !open);
  updateChatHomeButton();
  // ★ ここでは未読をリセットしない（誰を既読にしたかは render 側で管理）
}

function appendChatMessageToHistory(targetSocketId, msg) {
  if (!chatHistories[targetSocketId]) {
    chatHistories[targetSocketId] = [];
  }
  chatHistories[targetSocketId].push(msg);
}

function getStudentDisplayName(socketId) {
  if (!socketId) return "生徒";
  return (
    studentNameMap[socketId] ||
    latestThumbnails[socketId]?.nickname ||
    socketId
  );
}

function createChatMessageRow(message) {
  const row = document.createElement("div");
  row.className =
    "chat-message-row " +
    (message.from === "me" ? "chat-message--me" : "chat-message--them");

  const meta = document.createElement("div");
  meta.className = "chat-message-meta";

  const time = new Date(message.timestamp || Date.now());
  const timeStr = time.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  if (message.from === "me") {
    meta.textContent = `自分 • ${timeStr}`;
  } else {
    meta.textContent = `${message.nickname || "生徒"} • ${timeStr}`;
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-message-bubble";
  bubble.textContent = message.text;

  row.appendChild(meta);
  row.appendChild(bubble);
  return row;
}

function updateModalChatTargetLabel(targetSocketId = currentMonitoringStudentSocketId) {
  if (!modalChatStudentName) return;
  modalChatStudentName.textContent = targetSocketId
    ? getStudentDisplayName(targetSocketId)
    : "生徒を選択中";
}

function isStudentModalChatOpenFor(socketId) {
  return !!(
    socketId &&
    modalBackdrop &&
    modalBackdrop.classList.contains("show") &&
    currentMonitoringStudentSocketId === socketId
  );
}

function renderModalChatMessagesForTarget(targetSocketId = currentMonitoringStudentSocketId, options = {}) {
  if (!modalChatMessagesEl) return;
  modalChatMessagesEl.innerHTML = "";
  updateModalChatTargetLabel(targetSocketId);

  if (targetSocketId && options.markRead !== false) {
    unreadStudentIds.delete(targetSocketId);
    unreadTemplateKindsByStudentId.delete(targetSocketId);
    updateChatBadge();
  }

  if (!targetSocketId) {
    const empty = document.createElement("div");
    empty.className = "chat-message-row chat-empty-state";
    empty.textContent = "生徒を選択してください。";
    modalChatMessagesEl.appendChild(empty);
    return;
  }

  const history = chatHistories[targetSocketId] || [];
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "chat-message-row chat-empty-state";
    empty.textContent = "まだメッセージはありません。";
    modalChatMessagesEl.appendChild(empty);
    return;
  }

  history.forEach(message => {
    modalChatMessagesEl.appendChild(createChatMessageRow(message));
  });
  modalChatMessagesEl.scrollTop = modalChatMessagesEl.scrollHeight;
}

function renderChatMessagesForTarget(targetSocketId) {
  if (!chatMessagesEl) return;
  chatMessagesEl.innerHTML = "";
  updateChatHomeButton();

  // ★ 宛先が指定されているときは「その生徒を既読扱い」にする
  if (targetSocketId) {
    unreadStudentIds.delete(targetSocketId);
    unreadTemplateKindsByStudentId.delete(targetSocketId);
    updateChatBadge();
  }

  if (!targetSocketId || !chatHistories[targetSocketId]) {
    const empty = document.createElement("div");
    empty.className = "chat-message-row";
    empty.textContent = "宛先の生徒を選択してください。";
    chatMessagesEl.appendChild(empty);

    const unreadList = createUnreadChatSummary([...unreadStudentIds], "新着メッセージ");
    if (unreadList) chatMessagesEl.appendChild(unreadList);

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

  // ★現在表示している生徒「以外」に未読がある場合、その一覧を下に表示
  const otherUnreadIds = [...unreadStudentIds].filter(
    id => id !== targetSocketId
  );

  const otherUnreadList = createUnreadChatSummary(otherUnreadIds, "他の生徒からの新着");
  if (otherUnreadList) chatMessagesEl.appendChild(otherUnreadList);

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  if (isStudentModalChatOpenFor(targetSocketId)) {
    renderModalChatMessagesForTarget(targetSocketId, { markRead: false });
  }
}

function openChatForStudent(socketId) {
  if (!socketId) return;
  activeChatTargetSocketId = socketId;
  if (chatTargetSelect) {
    let option = Array.from(chatTargetSelect.options).find(
      opt => opt.value === socketId
    );
    if (!option) {
      option = document.createElement("option");
      option.value = socketId;
      option.textContent =
        studentNameMap[socketId] ||
        latestThumbnails[socketId]?.nickname ||
        socketId;
      chatTargetSelect.appendChild(option);
    }
    if (option) {
      option.selected = true;
    }
  }
  setChatPanelOpen(true);
  renderChatMessagesForTarget(socketId);
  if (chatInput) chatInput.focus();
}

function createUnreadChatSummary(studentIds, titleText) {
  const ids = (studentIds || []).filter(Boolean);
  if (!ids.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "chat-unread-summary chat-unread-summary--actions";

  const title = document.createElement("div");
  title.className = "chat-unread-summary-title";
  title.textContent = titleText;
  wrap.appendChild(title);

  ids.forEach(id => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chat-unread-item";

    const templateKind = normalizeChatTemplateKind(
      unreadTemplateKindsByStudentId.get(id) || ""
    );
    if (templateKind) {
      btn.classList.add(`chat-template-notice--${templateKind}`);
    }

    const name = document.createElement("span");
    name.className = "chat-unread-name";
    name.textContent =
      studentNameMap[id] ||
      latestThumbnails[id]?.nickname ||
      "生徒";

    const history = chatHistories[id] || [];
    const last = history[history.length - 1];
    const preview = document.createElement("span");
    preview.className = "chat-unread-preview";
    preview.textContent = last?.text || "チャットを開く";

    btn.appendChild(name);
    btn.appendChild(preview);
    btn.addEventListener("click", () => openChatForStudent(id));
    wrap.appendChild(btn);
  });

  return wrap;
}

if (chatHomeBtn) {
  chatHomeBtn.addEventListener("click", () => {
    activeChatTargetSocketId = "";
    if (chatTargetSelect) {
      chatTargetSelect.value = "";
    }
    renderChatMessagesForTarget("");
  });
  updateChatHomeButton();
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
    // ★ 既読処理＋未読表示の更新は render 側に任せる
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

function teacherSendModalChat() {
  if (!currentClassCode) {
    alert("クラスを開始してからチャットを送信してください。");
    return;
  }
  const targetSocketId = currentMonitoringStudentSocketId;
  if (!targetSocketId) {
    alert("対象の生徒を選択してください。");
    return;
  }
  if (!modalChatInput) return;

  const text = modalChatInput.value.trim();
  if (!text) return;

  socket.emit("teacher-chat-to-student", {
    classCode: currentClassCode,
    targetSocketId,
    message: text
  });

  appendChatMessageToHistory(targetSocketId, {
    from: "me",
    nickname: null,
    text,
    timestamp: Date.now()
  });

  modalChatInput.value = "";
  renderModalChatMessagesForTarget(targetSocketId, { markRead: false });

  if (chatPanelOpen && activeChatTargetSocketId === targetSocketId) {
    renderChatMessagesForTarget(targetSocketId);
  }
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

if (modalChatSendBtn && modalChatInput) {
  modalChatSendBtn.addEventListener("click", teacherSendModalChat);
  modalChatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      teacherSendModalChat();
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
  const templateKind = normalizeChatTemplateKind(payload.templateKind || "");

  // ★ニックネームを記録（未読一覧表示に使う）
  studentNameMap[fromId] = fromNickname;

  appendChatMessageToHistory(fromId, {
    from: "them",
    nickname: fromNickname,
    text,
    templateKind,
    timestamp
  });

  const isMainChatActive = chatPanelOpen && activeChatTargetSocketId === fromId;
  const isModalChatActive = isStudentModalChatOpenFor(fromId);

  if (isMainChatActive || isModalChatActive) {
    // 今見ている生徒からのメッセージなら、そのまま表示更新＆既読扱い
    unreadStudentIds.delete(fromId);
    unreadTemplateKindsByStudentId.delete(fromId);
    updateChatBadge();
    if (isMainChatActive) {
      renderChatMessagesForTarget(fromId);
    }
    if (isModalChatActive) {
      renderModalChatMessagesForTarget(fromId, { markRead: false });
    }
  } else {
    // ★別の生徒 or パネル閉じている → 未読扱い
    unreadStudentIds.add(fromId);
    if (templateKind) {
      unreadTemplateKindsByStudentId.set(fromId, templateKind);
    } else {
      unreadTemplateKindsByStudentId.delete(fromId);
    }
    updateChatBadge();

    // パネルが開いている場合は、現在表示中の画面に
    // 「誰から未読があるか」を反映
    if (chatPanelOpen) {
      renderChatMessagesForTarget(activeChatTargetSocketId);
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

/** ★ 追加: 生徒モーダル内の「下（画像）＋上（描画）」を合成して返す */
function mergeStudentModalCanvases() {
  if (!modalCanvas || !modalOverlayCanvas) return null;

  const dpr = window.devicePixelRatio || 1;
  const w = modalOverlayCanvas.width;
  const h = modalOverlayCanvas.height;
  if (!w || !h) return null;

  // 合成用オフスクリーン
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");

  // 1) 下レイヤー（ノート画像）
  ctx.drawImage(modalCanvas, 0, 0, w, h);
  // 2) 上レイヤー（先生の書き込み）
  ctx.drawImage(modalOverlayCanvas, 0, 0, w, h);

  // 3) DataURL で返す（PNGなら高画質）
  return out.toDataURL("image/png");
}

/** 生徒画面モーダル上での添削結果を、そのまま生徒に送り返す */
function sendAnnotatedImageToStudentFromModal() {
  if (!currentClassCode || !currentMonitoringStudentSocketId) {
    alert("クラスまたは対象の生徒が選択されていません。");
    return;
  }

  const merged = mergeStudentModalCanvases();
  if (!merged) {
    alert("送信する画像を作成できませんでした。");
    return;
  }

  socket.emit("teacherShareToStudent", {
    classCode: currentClassCode,
    studentSocketId: currentMonitoringStudentSocketId,
    imageData: merged
  });

  // お好みでトースト風のログ
  console.log(
    "[teacher] sendAnnotatedImageToStudentFromModal",
    currentClassCode,
    currentMonitoringStudentSocketId,
    merged.length
  );
}

if (modalShareToStudentBtn) {
  modalShareToStudentBtn.addEventListener("click", () => {
    sendAnnotatedImageToStudentFromModal();
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
  if (shareToggleBtn) {
    shareToggleBtn.textContent = "共有開始";
    shareToggleBtn.className = "share-off";
  }
  if (shareIntervalId) {
    clearInterval(shareIntervalId);
    shareIntervalId = null;
  }
}

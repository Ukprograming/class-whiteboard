// public/js/teacher.js
import { initBoardUI } from "./board-ui.js?v=tool-settings-20260818c&draw-style-20260824&highlighter-settings=20260824&png-stamps=20260824&modal-tool-scope=20260824&session-recovery=20260824&eraser-hit=20260825&timer-tool=20260826";
import { Whiteboard } from "./whiteboard.js?v=tool-settings-20260818c&draw-style-20260824&modal-highlighter-width=20260824&asset-lifecycle=20260824&eraser-hit=20260825";
import { STAMP_PRESETS, createStampElement } from "./stamps.js?v=png-reaction-stamps-20260824";
import { initBoardUI as initBoardUIWithTable } from "./board-ui.js?v=table-tool-20260828a";
import { Whiteboard as TableWhiteboard } from "./whiteboard.js?v=table-tool-20260828a";
import { authApi, boardApi, createRealtimeBridge, managementApi, supabaseEnabled } from "./supabase-api.js?v=monitor-sync-20260819&realtime-scale=20260824&realtime-duplex=20260824&session-recovery=20260824&student-delete=20260826&forms=20260830";
import {
  canAcceptTeacherBoardSnapshot,
  isMatchingMonitorRequest,
} from "./monitor-sync.js?v=monitor-sync-20260819";
import {
  getSelectedTeacherClass,
  saveTeacherClassHints,
  setSelectedTeacherClass,
} from "./teacher-class-storage.js?v=teacher-auth-split-20260712";
import { initTeacherForms } from "./teacher-forms.js?v=forms-20260830";

async function requireSupabaseTeacher() {
  if (!supabaseEnabled) return;
  try {
    const profile = await authApi.getProfile();
    if (profile?.role === "teacher") return;
  } catch (error) {
    console.error("Failed to verify teacher session", error);
  }
  await authApi.signOut();
  window.location.replace("./teacher-login.html");
  throw new Error("Teacher login is required.");
}

await requireSupabaseTeacher();

const teacherBoard = initBoardUIWithTable();
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
const realtimeRuntimeConfig = window.CLASS_WHITEBOARD_CONFIG || {};
const REALTIME_PAYLOAD_LIMIT_BYTES = Math.max(
  64000,
  Number(realtimeRuntimeConfig.maxRealtimePayloadBytes) || 180000
);
const MAX_REALTIME_FEEDBACK_IMAGE_BYTES = Math.min(
  120000,
  Math.max(48000, REALTIME_PAYLOAD_LIMIT_BYTES - 60000)
);

function estimateRealtimeStringBytes(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function encodeFeedbackCanvasForRealtime(sourceCanvas, options = {}) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return null;

  const maxWidth = Math.min(sourceCanvas.width, Number(options.maxWidth) || 1280);
  const minWidth = Math.min(maxWidth, Number(options.minWidth) || 360);
  let targetWidth = maxWidth;
  let quality = Number(options.quality) || 0.82;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const scale = targetWidth / sourceCanvas.width;
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(targetWidth));
    output.height = Math.max(1, Math.round(sourceCanvas.height * scale));

    const outputContext = output.getContext("2d");
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = "high";
    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.drawImage(sourceCanvas, 0, 0, output.width, output.height);

    const dataUrl = output.toDataURL("image/jpeg", quality);
    if (estimateRealtimeStringBytes(dataUrl) <= MAX_REALTIME_FEEDBACK_IMAGE_BYTES) {
      return dataUrl;
    }

    targetWidth = Math.max(minWidth, Math.floor(targetWidth * 0.78));
    quality = Math.max(0.42, quality - 0.08);
  }

  console.warn("Feedback image could not be compressed within the realtime payload limit.");
  return null;
}

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
const modalRestoreFeedbackBtn = document.getElementById("modalRestoreFeedbackBtn");
const modalBoardLoadingOverlay = document.getElementById("studentModalBoardLoading");
const modalBoardLoadingMessage = document.getElementById("studentModalBoardLoadingMessage");
const modalBoardRetryBtn = document.getElementById("studentModalBoardRetryBtn");

// 下レイヤー：生徒の画面・ノート画像を描くキャンバス
let modalCanvas = document.getElementById("studentModalCanvas");
// 上レイヤー：先生の描画用（Whiteboardを紐づける）
let modalOverlayCanvas = null;

const modalTitle = document.getElementById("studentModalTitle");
const modalCloseBtn = document.getElementById("studentModalCloseBtn");
const modalPreviousStudentBtn = document.getElementById("studentModalPreviousBtn");
const modalNextStudentBtn = document.getElementById("studentModalNextBtn");

// 下レイヤー用の 2D コンテキスト（画像描画に使う）
let modalCtx = null;


// 左側ツールサイドバー
const modalWbSidebar = document.getElementById("studentModalSidebar");

// ツールボタン（teacher.html の ID に合わせる）
// ※ modalToolPanBtn（「移動」）は UI 上から削除しており、ツールボタンとしては使用しない
const modalToolPanBtn = document.getElementById("modalToolPan");
const modalToolPenBtn = document.getElementById("modalToolPen");
const modalToolHighlighterBtn = document.getElementById("modalToolHighlighter");
const modalToolEraserBtn = document.getElementById("modalToolEraser");
const modalToolStampBtn = document.getElementById("modalToolStamp");
const modalToolStickyBtn = document.getElementById("modalToolSticky");
const modalToolMenu = document.getElementById("modalToolMenu");
const modalDrawSettings = document.getElementById("modalDrawSettings");
const modalDrawSettingsTitle = document.getElementById("modalDrawSettingsTitle");
const modalDrawWidthSelect = document.getElementById("modalDrawWidthSelect");
const modalDrawColorButtons = Array.from(document.querySelectorAll("[data-modal-draw-color]"));
const modalStickySettings = document.getElementById("modalStickySettings");
const modalStickyColorButtons = Array.from(document.querySelectorAll("[data-modal-sticky-color]"));
const modalStampSettings = document.getElementById("modalStampSettings");
const modalStampItems = document.getElementById("modalStampItems");
const modalChatStudentName = document.getElementById("modalChatStudentName");
const modalChatMessagesEl = document.getElementById("modalChatMessages");
const modalChatInput = document.getElementById("modalChatInput");
const modalChatSendBtn = document.getElementById("modalChatSendBtn");

// 互換用エイリアス（古い処理がこれらを参照していても落ちないように）
// 「移動」ボタンを廃止したため、選択ツール用ボタンは存在しない
const modalToolSelectBtn = null;

// モーダル内ホワイトボード用の状態
let modalBoard = null;
let modalResizeObserver = null;
// デフォルトツールはペン
let modalCurrentTool = "pen";
let modalSettingsOpenTool = null;
let modalPenColor = "#111827";
let modalPenWidth = 3;
let modalHighlighterColor = "#facc15";
let modalHighlighterWidth = 30;
let modalStickyColor = "#FEF3C7";
let modalSelectedStamp = "star-yellow";

// ★ 生徒ごとの最新ボードデータを保持（初期同期 & 再描画用）
const latestBoardDataByStudent = {};
// 画面共有・ノート提出へ送ったフィードバックは、このブラウザを開いている間だけ保持する。
const sentFeedbackByStudent = new Map();
let modalShowingSavedFeedback = false;
// ★ 生徒ごとの最新モード（"whiteboard" | "screen" | "notebook"）を保持
const latestModeByStudent = {};
const latestViewportByStudent = {};
// The latest teacher action sent to each student. Full board snapshots are
// accepted only after the student has applied that action, preventing an older
// in-flight Storage snapshot from rolling the modal back.
const latestTeacherSyncTokenByStudent = new Map();
const pendingTeacherSyncTokenByStudent = new Map();
const teacherSyncAckTimerByStudent = new Map();
const latestStudentBoardRevisionByStudent = new Map();
let modalTeacherSyncCounter = 0;
let currentModalMonitorRequestId = null;
let modalBoardLoadState = "idle";
let modalBoardLoadTimerId = null;
const MODAL_BOARD_LOAD_TIMEOUT_MS = 10000;
// ★ 追加: モーダル内のボードに「初期同期済み」かどうか
let modalHasInitialBoardData = false;

// ★ 追加: モーダルの書き込みを生徒ホワイトボードに同期するかどうか
//   - true  : これまで通り teacher-whiteboard-action を送る（ホワイトボード共同編集）
//   - false : ノート提出モードなど。画像への注釈専用（生徒WBは編集しない）
let modalSyncToStudent = true;

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
const chatReactionButtons = Array.from(document.querySelectorAll("[data-chat-reaction]"));
const modalChatReactionButtons = Array.from(document.querySelectorAll("[data-modal-chat-reaction]"));

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
const CHAT_REACTIONS = {
  thumbs_up: "👍",
  clap: "👏",
  ok: "👌",
  idea: "💡",
  question: "❓"
};
const CHAT_TEMPLATE_NOTICE = {
  question: { icon: "help", label: "質問があります" },
  repeat: { icon: "replay", label: "もう一度" },
  check: { icon: "fact_check", label: "確認お願いします" }
};
let activeChatTargetSocketId = null;

let studentListForBoardScope = []; // [{ socketId, nickname }, ...]

// ★ 生徒画面モーダルの現在モード（whiteboard / screen / notebook）
let modalCurrentStudentMode = "whiteboard";

// 画面共有・ノート画像も Whiteboard と同じビューポートで描画する。
// 画像だけをキャンバスへ固定表示すると、注釈レイヤーのズーム／パンと
// 座標系が分かれ、ペン幅も画像に対して不自然に太く見えてしまう。
let modalImageElement = null;
let modalImageViewportKey = "";

function clearModalImageViewport() {
  modalImageElement = null;
  modalImageViewportKey = "";
  if (!modalCanvas || !modalCtx) return;
  modalCtx.setTransform(1, 0, 0, 1, 0, 0);
  modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
}

function fitModalImageViewport(img) {
  if (!modalBoard || !modalCanvas || !img?.naturalWidth || !img?.naturalHeight) {
    return false;
  }

  const rect = modalCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const viewportWidth = rect.width || modalCanvas.width / dpr;
  const viewportHeight = rect.height || modalCanvas.height / dpr;
  if (!viewportWidth || !viewportHeight) return false;

  const scale = Math.min(
    viewportWidth / img.naturalWidth,
    viewportHeight / img.naturalHeight
  );
  modalBoard.scale = scale;
  modalBoard.offsetX = (viewportWidth - img.naturalWidth * scale) / 2;
  modalBoard.offsetY = (viewportHeight - img.naturalHeight * scale) / 2;
  return true;
}

function renderModalImageLayer() {
  if (!modalCanvas || !modalCtx) return;

  modalCtx.setTransform(1, 0, 0, 1, 0, 0);
  modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
  if (
    modalCurrentStudentMode === "whiteboard" ||
    !modalImageElement ||
    !modalBoard
  ) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  modalCtx.imageSmoothingEnabled = true;
  modalCtx.setTransform(
    modalBoard.scale * dpr,
    0,
    0,
    modalBoard.scale * dpr,
    modalBoard.offsetX * dpr,
    modalBoard.offsetY * dpr
  );
  modalCtx.drawImage(modalImageElement, 0, 0);
  modalCtx.setTransform(1, 0, 0, 1, 0, 0);
}

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

function setModalImageLayerMode(mode) {
  if (!modalCanvas) return;
  const showImageLayer = mode !== "whiteboard";
  modalCanvas.style.visibility = showImageLayer ? "visible" : "hidden";

  if (!showImageLayer && modalCtx) {
    modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
  }
}

function destroyModalBoard() {
  if (modalResizeObserver) {
    modalResizeObserver.disconnect();
    modalResizeObserver = null;
  }
  if (modalBoard) {
    modalBoard.destroy?.();
    modalBoard = null;
  }
}

let currentClassCode = null;
let role = null;
// 今開いているボードの Drive ファイルID（なければ null）
let currentBoardFileId = null;
// 今開いているボードのファイル名（拡張子なし）
let currentBoardFileName = "";
let currentBoardOwnerKind = "teacher";
let boardFileSaveInFlight = false;

const runtimeConfig = window.CLASS_WHITEBOARD_CONFIG || {};
const SHARED_BOARD_SNAPSHOT_INTERVAL_MS = Math.max(
  30000,
  Number(runtimeConfig.sharedBoardSnapshotIntervalMs) || 60000
);
let sharedBoardSession = null;
let sharedBoardSnapshotTimerId = null;
let sharedBoardSaveInFlight = false;
let applyingSharedBoardRemote = false;


// ========= 共同編集対象の生徒 socketId =========
let currentMonitoringStudentSocketId = null;
let currentTeacherViewMode = "whiteboard";
let connectedStudentSocketIds = new Set();

// 生徒画面確認用サムネイル
let latestThumbnails = {}; // { socketId: { nickname, dataUrl } }

// ノート確認用の生徒情報
let notebookStudents = {}; // { studentId: { latestImageData } }

// ======== ホワイトボード保存/読み込みダイアログ関連 ========
const teacherOpenSaveDialogBtn = document.getElementById("teacherOpenSaveDialogBtn");
const teacherOpenLoadDialogBtn = document.getElementById("teacherOpenLoadDialogBtn");
const teacherDistributeBoardBtn = document.getElementById("teacherDistributeBoardBtn");
const teacherSharedBoardToggleBtn = document.getElementById("teacherSharedBoardToggleBtn");
const teacherManageClassesBtn = document.getElementById("teacherManageClassesBtn");
const teacherForms = initTeacherForms({
  socket,
  getClassCode: () => currentClassCode,
  onOpen: () => setChatPanelOpen(false),
});
const classManagementBackdrop = document.getElementById("classManagementBackdrop");
const classManagementCloseBtn = document.getElementById("classManagementCloseBtn");
const classManagementStatus = document.getElementById("classManagementStatus");
const classManagementCreateClassForm = document.getElementById("classManagementCreateClassForm");
const classManagementCreateStudentForm = document.getElementById("classManagementCreateStudentForm");
const classManagementClassName = document.getElementById("classManagementClassName");
const classManagementClassCode = document.getElementById("classManagementClassCode");
const classManagementClassSelect = document.getElementById("classManagementClassSelect");
const classManagementStudentLoginId = document.getElementById("classManagementStudentLoginId");
const classManagementStudentName = document.getElementById("classManagementStudentName");
const classManagementStudentPassword = document.getElementById("classManagementStudentPassword");
const classManagementStudentList = document.getElementById("classManagementStudentList");
const classManagementRefreshBtn = document.getElementById("classManagementRefreshBtn");
const classManagementSelectedCount = document.getElementById("classManagementSelectedCount");
const classManagementDeleteStudentsBtn = document.getElementById("classManagementDeleteStudentsBtn");
const deleteStudentsBackdrop = document.getElementById("deleteStudentsBackdrop");
const deleteStudentsCloseBtn = document.getElementById("deleteStudentsCloseBtn");
const deleteStudentsForm = document.getElementById("deleteStudentsForm");
const deleteStudentsSummary = document.getElementById("deleteStudentsSummary");
const deleteStudentsTeacherPassword = document.getElementById("deleteStudentsTeacherPassword");
const deleteStudentsError = document.getElementById("deleteStudentsError");
const deleteStudentsCancelBtn = document.getElementById("deleteStudentsCancelBtn");
const deleteStudentsConfirmBtn = document.getElementById("deleteStudentsConfirmBtn");
let managedClasses = [];
let managedStudents = [];
let classManagementBusy = false;
const selectedManagedStudentIds = new Set();

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
    teacherBoard.applyAssetReferences?.(result.assetReferences);

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
    boardData: null,
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
    boardData: null,
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

socket.on("shared-board-snapshot", async ({ sharedBoardId, title, boardData: incomingBoardData, boardSnapshotPath, active }) => {
  if (!sharedBoardId) return;
  if (active === false) {
    if (sharedBoardSession?.id === sharedBoardId) {
      sharedBoardSession = null;
      stopSharedBoardSnapshotTimer();
      setSharedBoardButtonState();
    }
    return;
  }
  const boardData = await resolveRealtimeBoardData(incomingBoardData, boardSnapshotPath);
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
  if (boardSnapshotPath) {
    const saved = await saveSharedBoardSnapshot(boardData, true);
    if (saved) {
      await socket.emit("shared-board-snapshot", {
        classCode: currentClassCode,
        sharedBoardId: saved.sharedBoardId,
        title: saved.title,
        boardData: null,
        active: true,
        reason: "student-refresh",
      });
    }
  }
});

async function activateTeacherClass(classCode) {
  const code = String(classCode || "").trim().toUpperCase();
  if (!code) return false;

  if (currentClassCode && currentClassCode !== code) {
    await stopSharedBoard();
    await socket.emit("leave-class");
  }

  currentClassCode = code;
  role = "teacher";
  setSelectedTeacherClass(code);
  if (classCodeInput) classCodeInput.value = code;
  if (statusLabel) statusLabel.textContent = `クラスコード ${code} で待機中…`;

  await socket.emit("join-teacher", { classCode: code });
  await socket.emit("teacher-start-class", { classCode: code });
  await socket.emit("joinAsTeacher", { classCode: code });
  await teacherForms.refreshForClass();
  return true;
}

socket.on("realtime-disconnected", () => {
  if (statusLabel && currentClassCode) {
    statusLabel.textContent = `再接続中: ${currentClassCode}`;
  }
});

socket.on("realtime-reconnected", () => {
  if (!currentClassCode) return;
  if (sharedBoardSession) void publishSharedBoardSnapshot("reconnect");
  if (currentMonitoringStudentSocketId) {
    void socket.emit("request-highres", {
      classCode: currentClassCode,
      studentSocketId: currentMonitoringStudentSocketId,
    });
  }
  if (statusLabel) {
    statusLabel.textContent = sharedBoardSession
      ? `共同編集を再接続しました: ${currentClassCode}`
      : `クラスコード ${currentClassCode} で待機中…`;
  }
});

async function autoJoinClassFromSession() {
  if (supabaseEnabled) {
    try {
      const classes = await managementApi.listClasses();
      saveTeacherClassHints(classes);
      const selectedCode = getSelectedTeacherClass();
      const selectedClass = classes.find(
        (klass) => String(klass.class_code || "").toUpperCase() === selectedCode
      );
      if (!selectedClass) return;

      await activateTeacherClass(selectedClass.class_code);
    } catch (error) {
      console.error("Failed to load the selected teacher class", error);
    }
    return;
  }
  try {
    const res = await fetch("./api/teacher/session", {
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

  if (supabaseEnabled) {
    const classes = await managementApi.listClasses();
    const selectedClass = classes.find(
      (klass) => String(klass.class_code || "").toUpperCase() === String(currentClassCode).toUpperCase()
    );
    if (!selectedClass) return [];
    const students = await managementApi.listStudents(selectedClass.id);
    return students
      .filter((student) => student.active !== false)
      .map((student) => ({
        nickname: student.student_login_id || student.display_name || "",
      }))
      .filter((student) => student.nickname);
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
  if (boardFileSaveInFlight) {
    alert("保存処理中です。完了するまでお待ちください。");
    return;
  }
  boardFileSaveInFlight = true;
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

    const saveRevision = teacherBoard.getRevision?.();
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
      teacherBoard.applyAssetReferences?.(json.assetReferences);
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
    currentBoardOwnerKind = isStudentScope ? "student" : "teacher";

    lastUsedFolderPath = (folderPath || "").trim();

    // ★ ここで「保存済み」にする（dirty フラグをリセット）
    const savedCurrentRevision = typeof teacherBoard.markSaved === "function"
      ? teacherBoard.markSaved(saveRevision)
      : true;

    const savedMessage = json.message ||
      (mode === "update"
        ? "ホワイトボードを上書き保存しました。"
        : "ホワイトボードを保存しました。");
    alert(savedCurrentRevision === false
      ? `${savedMessage}\n保存中に加えた変更はまだ未保存です。もう一度保存してください。`
      : savedMessage);
    if (savedCurrentRevision !== false) closeBoardDialog();
  } catch (err) {
    console.error("[teacherSaveBoardInternal] error", err);
    alert("ホワイトボードの保存に失敗しました: " + err);
  } finally {
    boardFileSaveInFlight = false;
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
  if (
    teacherBoard.isBoardDirty &&
    !window.confirm(
      "現在のホワイトボードには未保存の変更があります。\n" +
      "別のファイルを開くと、この変更は失われます。\n\n" +
      "保存せずにファイルを開きますか？"
    )
  ) {
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
      currentBoardOwnerKind = isStudentScope ? "student" : "teacher";
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
    currentBoardOwnerKind = isStudentScope ? "student" : "teacher";
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

let distributionInFlight = false;

function defaultDistributionTitle() {
  if (currentBoardFileName) return currentBoardFileName;
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, "0"))
    .join("-");
  const time = [now.getHours(), now.getMinutes()]
    .map(value => String(value).padStart(2, "0"))
    .join("-");
  return `配布資料_${date}_${time}`;
}

async function distributeCurrentBoardToClass() {
  if (distributionInFlight) return;
  if (!supabaseEnabled || !boardApi.enabled) {
    alert("クラス一斉配布は Supabase 版で利用できます。");
    return;
  }
  if (!currentClassCode) {
    alert("先に配布先のクラスを開始してください。");
    return;
  }
  if (!teacherBoard || typeof teacherBoard.exportBoardData !== "function") {
    alert("現在のホワイトボードを取得できません。");
    return;
  }

  const enteredTitle = window.prompt(
    "生徒の「ファイルを開く」に表示するファイル名を入力してください。",
    defaultDistributionTitle()
  );
  if (enteredTitle === null) return;
  const title = enteredTitle.trim();
  if (!title) {
    alert("ファイル名を入力してください。");
    return;
  }
  if (title.length > 120) {
    alert("ファイル名は120文字以内にしてください。");
    return;
  }

  distributionInFlight = true;
  teacherDistributeBoardBtn.disabled = true;
  teacherDistributeBoardBtn.innerHTML = '<span class="material-symbols-rounded">hourglass_top</span> 配布中…';

  try {
    const classes = await managementApi.listClasses();
    managedClasses = classes;
    saveTeacherClassHints(classes);
    const selectedClass = classes.find(
      klass => String(klass.class_code || "").toUpperCase() === currentClassCode.toUpperCase()
    );
    if (!selectedClass) {
      throw new Error("現在のクラスを教師アカウントから確認できませんでした。");
    }

    const saveRevision = teacherBoard.getRevision?.();
    const boardData = teacherBoard.exportBoardData();
    const tracksCurrentTeacherFile = currentBoardOwnerKind === "teacher";
    const sourceFileName = tracksCurrentTeacherFile && currentBoardFileName
      ? currentBoardFileName
      : title;
    const savePayload = {
      action: "saveBoard",
      role: "teacher",
      classCode: currentClassCode,
      folderPath: tracksCurrentTeacherFile ? (lastUsedFolderPath || "") : "",
      fileName: sourceFileName,
      boardData,
    };
    if (tracksCurrentTeacherFile && currentBoardFileId) {
      savePayload.fileId = currentBoardFileId;
    }

    const savedSource = await boardApi.saveBoard(savePayload);
    teacherBoard.applyAssetReferences?.(savedSource.assetReferences);
    if (tracksCurrentTeacherFile) {
      currentBoardFileId = savedSource.fileId;
      currentBoardFileName = String(savedSource.fileName || sourceFileName).replace(/\.json$/i, "");
      currentBoardOwnerKind = "teacher";
      teacherBoard.markSaved?.(saveRevision);
    }

    const result = await managementApi.copyBoardToClass({
      sourceBoardId: savedSource.fileId,
      classId: selectedClass.id,
      title,
      targetFolderPath: "",
    });
    const copiedCount = Number(result.copiedCount) || 0;
    alert(`「${title}」を ${copiedCount} 人の生徒に配布しました。\n生徒は「ファイルを開く」から開けます。`);
  } catch (error) {
    console.error("Failed to distribute the current board", error);
    alert(`クラスへの配布に失敗しました。\n${error?.message || error}`);
  } finally {
    distributionInFlight = false;
    teacherDistributeBoardBtn.disabled = false;
    teacherDistributeBoardBtn.innerHTML = '<span class="material-symbols-rounded">send</span> クラス全員に配布';
  }
}

if (teacherDistributeBoardBtn) {
  teacherDistributeBoardBtn.addEventListener("click", () => void distributeCurrentBoardToClass());
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

function setClassManagementStatus(message, isError = false) {
  if (!classManagementStatus) return;
  classManagementStatus.textContent = message;
  classManagementStatus.classList.toggle("is-error", isError);
}

function setClassManagementBusy(isBusy) {
  classManagementBusy = isBusy;
  [classManagementCreateClassForm, classManagementCreateStudentForm]
    .filter(Boolean)
    .forEach((form) => {
      form.querySelectorAll("input, select, button").forEach((element) => {
        element.disabled = isBusy;
      });
    });
  if (classManagementRefreshBtn) classManagementRefreshBtn.disabled = isBusy;
  if (classManagementStudentList) {
    classManagementStudentList.querySelectorAll("input, button").forEach((element) => {
      element.disabled = isBusy;
    });
  }
  updateManagedStudentSelectionControls();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'\"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  }[char]));
}

function updateManagedStudentSelectionControls() {
  const count = selectedManagedStudentIds.size;
  if (classManagementSelectedCount) {
    classManagementSelectedCount.textContent = `${count}人選択中`;
  }
  if (classManagementDeleteStudentsBtn) {
    classManagementDeleteStudentsBtn.disabled = classManagementBusy || count === 0;
  }
}

function setDeleteStudentsError(message = "") {
  if (!deleteStudentsError) return;
  deleteStudentsError.textContent = message;
  deleteStudentsError.hidden = !message;
}

function setDeleteStudentsBusy(isBusy) {
  [deleteStudentsCloseBtn, deleteStudentsCancelBtn, deleteStudentsTeacherPassword]
    .filter(Boolean)
    .forEach((element) => {
      element.disabled = isBusy;
    });
  if (deleteStudentsConfirmBtn) {
    deleteStudentsConfirmBtn.disabled = isBusy;
    deleteStudentsConfirmBtn.textContent = isBusy ? "削除中…" : "完全に削除";
  }
}

function closeDeleteStudentsConfirmation() {
  if (!deleteStudentsBackdrop) return;
  const wasOpen = deleteStudentsBackdrop.getAttribute("aria-hidden") === "false";
  deleteStudentsBackdrop.classList.remove("show");
  deleteStudentsBackdrop.style.display = "none";
  deleteStudentsBackdrop.setAttribute("aria-hidden", "true");
  if (deleteStudentsTeacherPassword) deleteStudentsTeacherPassword.value = "";
  setDeleteStudentsError();
  setDeleteStudentsBusy(false);
  if (wasOpen && classManagementBackdrop?.getAttribute("aria-hidden") === "false") {
    classManagementDeleteStudentsBtn?.focus();
  }
}

function openDeleteStudentsConfirmation() {
  if (!deleteStudentsBackdrop || selectedManagedStudentIds.size === 0) return;
  const selectedStudents = managedStudents.filter((student) => selectedManagedStudentIds.has(student.id));
  if (selectedStudents.length === 0) return;
  if (deleteStudentsSummary) {
    deleteStudentsSummary.innerHTML = `
      <strong>${selectedStudents.length}人を削除します</strong>
      <ul>${selectedStudents.map((student) => `<li>${escapeHtml(student.display_name)}（${escapeHtml(student.student_login_id)}）</li>`).join("")}</ul>
    `;
  }
  if (deleteStudentsTeacherPassword) deleteStudentsTeacherPassword.value = "";
  setDeleteStudentsError();
  setDeleteStudentsBusy(false);
  deleteStudentsBackdrop.style.display = "flex";
  deleteStudentsBackdrop.classList.add("show");
  deleteStudentsBackdrop.setAttribute("aria-hidden", "false");
  window.setTimeout(() => deleteStudentsTeacherPassword?.focus(), 0);
}

async function renderManagedStudents() {
  if (!classManagementStudentList || !classManagementClassSelect?.value) return;
  classManagementStudentList.innerHTML = '<p class="class-management-empty">読み込み中…</p>';
  const students = await managementApi.listStudents(classManagementClassSelect.value);
  managedStudents = students;
  const visibleIds = new Set(students.map((student) => student.id));
  for (const studentId of selectedManagedStudentIds) {
    if (!visibleIds.has(studentId)) selectedManagedStudentIds.delete(studentId);
  }
  updateManagedStudentSelectionControls();
  if (students.length === 0) {
    selectedManagedStudentIds.clear();
    updateManagedStudentSelectionControls();
    classManagementStudentList.innerHTML = '<p class="class-management-empty">このクラスには、まだ生徒がいません。</p>';
    return;
  }
  classManagementStudentList.innerHTML = students.map((student) => `
    <div class="class-management-student-row">
      <label class="class-management-student-identity">
        <input type="checkbox" data-managed-student-id="${student.id}" ${selectedManagedStudentIds.has(student.id) ? "checked" : ""} aria-label="${escapeHtml(student.display_name)}を選択" />
        <span><strong>${escapeHtml(student.display_name)}</strong><span>${escapeHtml(student.student_login_id)}</span></span>
      </label>
      <button type="button" class="icon-btn-text" data-reset-student-id="${student.id}" data-reset-student-name="${escapeHtml(student.display_name)}">パスワード再設定</button>
    </div>
  `).join("");
  if (classManagementBusy) setClassManagementBusy(true);
}

async function refreshClassManagement() {
  if (!supabaseEnabled) {
    setClassManagementStatus("Supabase の公開設定を入力してから利用できます。", true);
    return;
  }
  setClassManagementBusy(true);
  try {
    const previouslySelectedClassId = classManagementClassSelect?.value;
    managedClasses = await managementApi.listClasses();
    saveTeacherClassHints(managedClasses);
    if (classManagementClassSelect) {
      classManagementClassSelect.innerHTML = managedClasses.length
        ? managedClasses.map((klass) => `<option value="${klass.id}">${escapeHtml(klass.class_code)} — ${escapeHtml(klass.name)}</option>`).join("")
        : '<option value="">先にクラスを作成してください</option>';
      if (previouslySelectedClassId && managedClasses.some((klass) => klass.id === previouslySelectedClassId)) {
        classManagementClassSelect.value = previouslySelectedClassId;
      }
    }
    if (managedClasses.length > 0) {
      await renderManagedStudents();
      setClassManagementStatus("クラスと生徒を管理できます。");
    } else {
      if (classManagementStudentList) classManagementStudentList.innerHTML = '<p class="class-management-empty">まずクラスを作成してください。</p>';
      setClassManagementStatus("クラスを1つ作成すると、生徒を追加できます。");
    }
  } catch (error) {
    setClassManagementStatus(error.message || "管理情報を取得できませんでした。", true);
  } finally {
    setClassManagementBusy(false);
  }
}

function openClassManagement() {
  if (!classManagementBackdrop) return;
  classManagementBackdrop.style.display = "flex";
  classManagementBackdrop.classList.add("show");
  classManagementBackdrop.setAttribute("aria-hidden", "false");
  void refreshClassManagement();
}

function closeClassManagement() {
  if (!classManagementBackdrop) return;
  closeDeleteStudentsConfirmation();
  classManagementStudentPassword.value = "";
  selectedManagedStudentIds.clear();
  updateManagedStudentSelectionControls();
  classManagementBackdrop.classList.remove("show");
  classManagementBackdrop.style.display = "none";
  classManagementBackdrop.setAttribute("aria-hidden", "true");
}

if (teacherManageClassesBtn) teacherManageClassesBtn.addEventListener("click", openClassManagement);
if (classManagementCloseBtn) classManagementCloseBtn.addEventListener("click", closeClassManagement);
if (classManagementBackdrop) {
  classManagementBackdrop.addEventListener("click", (event) => {
    if (event.target === classManagementBackdrop) closeClassManagement();
  });
}
if (classManagementRefreshBtn) classManagementRefreshBtn.addEventListener("click", () => void refreshClassManagement());
if (classManagementClassSelect) classManagementClassSelect.addEventListener("change", () => {
  selectedManagedStudentIds.clear();
  updateManagedStudentSelectionControls();
  void renderManagedStudents();
});
if (classManagementDeleteStudentsBtn) {
  classManagementDeleteStudentsBtn.addEventListener("click", openDeleteStudentsConfirmation);
}
if (deleteStudentsCloseBtn) deleteStudentsCloseBtn.addEventListener("click", closeDeleteStudentsConfirmation);
if (deleteStudentsCancelBtn) deleteStudentsCancelBtn.addEventListener("click", closeDeleteStudentsConfirmation);
if (deleteStudentsBackdrop) {
  deleteStudentsBackdrop.addEventListener("click", (event) => {
    if (event.target === deleteStudentsBackdrop) closeDeleteStudentsConfirmation();
  });
}

if (classManagementCreateClassForm) {
  classManagementCreateClassForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setClassManagementBusy(true);
    try {
      const result = await managementApi.createClass({
        name: classManagementClassName.value.trim(),
        classCode: classManagementClassCode.value.trim(),
      });
      classManagementClassName.value = "";
      classManagementClassCode.value = "";
      saveTeacherClassHints(result.class);
      await activateTeacherClass(result.class.class_code);
      setClassManagementStatus(`「${result.class.name}」を作成しました。`);
      await refreshClassManagement();
    } catch (error) {
      setClassManagementStatus(error.message || "クラスを作成できませんでした。", true);
    } finally {
      setClassManagementBusy(false);
    }
  });
}

if (classManagementCreateStudentForm) {
  classManagementCreateStudentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedClass = managedClasses.find((klass) => klass.id === classManagementClassSelect.value);
    if (!selectedClass) {
      setClassManagementStatus("先に対象クラスを選択してください。", true);
      return;
    }
    setClassManagementBusy(true);
    try {
      const loginStudentId = classManagementStudentLoginId.value.trim();
      const initialPassword = classManagementStudentPassword.value;
      const result = await managementApi.createStudent({
        classCode: selectedClass.class_code,
        studentLoginId: loginStudentId,
        displayName: classManagementStudentName.value.trim(),
        password: initialPassword,
      });
      classManagementStudentLoginId.value = "";
      classManagementStudentName.value = "";
      classManagementStudentPassword.value = "";
      setClassManagementStatus(
        `「${result.student.display_name}」を追加しました。生徒に伝える情報: クラスコード ${selectedClass.class_code} / 生徒ID ${loginStudentId.toLowerCase()} / 初期パスワード ${initialPassword}`
      );
      await renderManagedStudents();
    } catch (error) {
      setClassManagementStatus(error.message || "生徒を追加できませんでした。", true);
    } finally {
      setClassManagementBusy(false);
    }
  });
}

if (classManagementStudentList) {
  classManagementStudentList.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-managed-student-id]");
    if (!checkbox) return;
    if (checkbox.checked) {
      selectedManagedStudentIds.add(checkbox.dataset.managedStudentId);
    } else {
      selectedManagedStudentIds.delete(checkbox.dataset.managedStudentId);
    }
    updateManagedStudentSelectionControls();
  });

  classManagementStudentList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-reset-student-id]");
    if (!button) return;
    const password = window.prompt(`${button.dataset.resetStudentName} さんの新しいパスワード（8文字以上）`);
    if (!password) return;
    if (password.length < 8) {
      setClassManagementStatus("パスワードは8文字以上にしてください。", true);
      return;
    }
    setClassManagementBusy(true);
    try {
      await managementApi.resetStudentPassword({ studentId: button.dataset.resetStudentId, password });
      setClassManagementStatus("生徒のパスワードを再設定しました。");
    } catch (error) {
      setClassManagementStatus(error.message || "パスワードを再設定できませんでした。", true);
    } finally {
      setClassManagementBusy(false);
    }
  });
}

if (deleteStudentsForm) {
  deleteStudentsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const studentIds = Array.from(selectedManagedStudentIds);
    const teacherPassword = deleteStudentsTeacherPassword?.value || "";
    if (studentIds.length === 0) {
      closeDeleteStudentsConfirmation();
      return;
    }
    if (!teacherPassword) {
      setDeleteStudentsError("先生自身のパスワードを入力してください。");
      deleteStudentsTeacherPassword?.focus();
      return;
    }

    setDeleteStudentsError();
    setDeleteStudentsBusy(true);
    setClassManagementBusy(true);
    try {
      const result = await managementApi.deleteStudents({ studentIds, teacherPassword });
      const deletedCount = Number(result.deletedCount) || 0;
      const failedCount = Array.isArray(result.failed) ? result.failed.length : 0;
      selectedManagedStudentIds.clear();
      closeDeleteStudentsConfirmation();
      await renderManagedStudents();
      if (failedCount > 0) {
        setClassManagementStatus(
          `${deletedCount}人を削除しました。${failedCount}人は削除できなかったため、一覧を確認してもう一度お試しください。`,
          true
        );
      } else {
        setClassManagementStatus(`${deletedCount}人の生徒と、その生徒フォルダ内のデータを削除しました。`);
      }
    } catch (error) {
      setDeleteStudentsError(error.message || "生徒を削除できませんでした。");
    } finally {
      setDeleteStudentsBusy(false);
      setClassManagementBusy(false);
    }
  });
}


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
    window.location.href = "./teacher-login.html";
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
  void teacherForms.refreshForClass();
});

// ======== 生徒画面モーダル用ツール切り替え ========

const MODAL_PEN_WIDTH_PRESETS = Object.freeze({
  thin: 2,
  normal: 3,
  thick: 5,
  "extra-thick": 8
});
const MODAL_HIGHLIGHTER_WIDTH_PRESETS = Object.freeze({
  thin: 14,
  normal: 30,
  thick: 42,
  "extra-thick": 56
});

function getModalToolButton(tool) {
  return {
    select: modalToolSelectBtn,
    pen: modalToolPenBtn,
    highlighter: modalToolHighlighterBtn,
    eraser: modalToolEraserBtn,
    stamp: modalToolStampBtn,
    sticky: modalToolStickyBtn
  }[tool] || null;
}

function updateModalToolButtons() {
  [
    modalToolSelectBtn,
    modalToolPenBtn,
    modalToolHighlighterBtn,
    modalToolEraserBtn,
    modalToolStampBtn,
    modalToolStickyBtn
  ].forEach(btn => {
    if (!btn) return;
    const tool = btn.dataset.tool;
    const isActive = tool === modalCurrentTool;
    const hasMenu = ["pen", "highlighter", "stamp", "sticky"].includes(tool);
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
    if (hasMenu) {
      btn.setAttribute("aria-expanded", String(isActive && modalSettingsOpenTool === tool));
    }
  });
}

function positionModalToolMenu(trigger) {
  if (!modalToolMenu || !modalWbSidebar || !trigger) return;
  const sidebarRect = modalWbSidebar.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = modalToolMenu.getBoundingClientRect();
  const margin = 12;
  const maxTop = Math.max(margin, sidebarRect.height - menuRect.height - margin);
  const triggerCenter = triggerRect.top - sidebarRect.top + triggerRect.height / 2;
  const top = Math.min(Math.max(margin, triggerCenter - menuRect.height / 2), maxTop);
  const arrowTop = Math.min(
    Math.max(18, triggerCenter - top - 8),
    Math.max(18, menuRect.height - 26)
  );
  modalToolMenu.style.top = `${top}px`;
  modalToolMenu.style.setProperty("--modal-tool-arrow-top", `${arrowTop}px`);
}

function closeModalToolMenu() {
  modalSettingsOpenTool = null;
  modalToolMenu?.classList.add("hidden");
  modalToolMenu?.classList.remove("stamp-open");
  modalDrawSettings?.classList.add("hidden");
  modalStickySettings?.classList.add("hidden");
  modalStampSettings?.classList.add("hidden");
  updateModalToolButtons();
}

function widthPresetForValue(tool, width) {
  const presets = tool === "highlighter"
    ? MODAL_HIGHLIGHTER_WIDTH_PRESETS
    : MODAL_PEN_WIDTH_PRESETS;
  return Object.entries(presets).find(([, value]) => value === width)?.[0] || "normal";
}

function updateModalDrawSettings() {
  if (!modalDrawWidthSelect) return;
  const isHighlighter = modalSettingsOpenTool === "highlighter";
  const color = isHighlighter ? modalHighlighterColor : modalPenColor;
  const width = isHighlighter ? modalHighlighterWidth : modalPenWidth;
  if (modalDrawSettingsTitle) {
    modalDrawSettingsTitle.textContent = isHighlighter ? "蛍光ペン" : "ペン";
  }
  modalDrawColorButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.modalDrawColor === color);
  });
  modalDrawWidthSelect.value = widthPresetForValue(
    isHighlighter ? "highlighter" : "pen",
    width
  );
}

function showModalToolMenu(tool) {
  if (!modalToolMenu) return;
  modalSettingsOpenTool = tool;
  modalDrawSettings?.classList.toggle("hidden", !["pen", "highlighter"].includes(tool));
  modalStickySettings?.classList.toggle("hidden", tool !== "sticky");
  modalStampSettings?.classList.toggle("hidden", tool !== "stamp");
  modalToolMenu.classList.toggle("stamp-open", tool === "stamp");
  modalToolMenu.classList.remove("hidden");
  if (tool === "pen" || tool === "highlighter") updateModalDrawSettings();
  updateModalToolButtons();
  requestAnimationFrame(() => positionModalToolMenu(getModalToolButton(tool)));
}

function applyModalDrawColor(color) {
  if (!color || !["pen", "highlighter"].includes(modalSettingsOpenTool)) return;
  if (modalSettingsOpenTool === "highlighter") {
    modalHighlighterColor = color;
    modalBoard?.setHighlighterColor(color);
  } else {
    modalPenColor = color;
    modalBoard?.setPen(modalPenColor, modalPenWidth);
  }
  updateModalDrawSettings();
}

function applyModalDrawWidthPreset(preset) {
  if (!["pen", "highlighter"].includes(modalSettingsOpenTool)) return;
  if (modalSettingsOpenTool === "highlighter") {
    modalHighlighterWidth = MODAL_HIGHLIGHTER_WIDTH_PRESETS[preset] || 30;
    modalBoard?.setHighlighterWidth?.(modalHighlighterWidth);
  } else {
    modalPenWidth = MODAL_PEN_WIDTH_PRESETS[preset] || 3;
    modalBoard?.setPen(modalPenColor, modalPenWidth);
  }
}

function setModalTool(tool) {
  modalCurrentTool = tool;
  updateModalToolButtons();

  // modalBoard にツール設定を反映
  if (modalBoard) {
    if (tool === "select") {
      modalBoard.setTool("select");
    } else if (tool === "pen") {
      modalBoard.setTool("pen");
      modalBoard.setPen(modalPenColor, modalPenWidth);
    } else if (tool === "highlighter") {
      modalBoard.setTool("highlighter");
      modalBoard.setHighlighterColor(modalHighlighterColor);
      modalBoard.setHighlighterWidth?.(modalHighlighterWidth);
    } else if (tool === "eraser") {
      modalBoard.setTool("eraser");
    } else if (tool === "stamp") {
      modalBoard.setTool("stamp");
      modalBoard.setStampType?.(modalSelectedStamp);
    } else if (tool === "sticky") {
      modalBoard.setSelectedStickyColor?.(modalStickyColor);
      modalBoard.setTool("sticky");
    }
  }
}

function handleModalToolWithSettings(tool) {
  const shouldOpen = modalCurrentTool === tool && modalSettingsOpenTool !== tool;
  setModalTool(tool);
  if (shouldOpen) showModalToolMenu(tool);
  else closeModalToolMenu();
}

modalToolPenBtn?.addEventListener("click", () => handleModalToolWithSettings("pen"));
modalToolHighlighterBtn?.addEventListener("click", () => handleModalToolWithSettings("highlighter"));
modalToolStickyBtn?.addEventListener("click", () => handleModalToolWithSettings("sticky"));
modalToolEraserBtn?.addEventListener("click", () => {
  closeModalToolMenu();
  setModalTool("eraser");
});
modalToolStampBtn?.addEventListener("click", () => {
  const shouldOpen = modalCurrentTool !== "stamp" || modalSettingsOpenTool !== "stamp";
  setModalTool("stamp");
  if (shouldOpen) showModalToolMenu("stamp");
  else closeModalToolMenu();
});

modalDrawColorButtons.forEach(btn => {
  btn.addEventListener("click", () => applyModalDrawColor(btn.dataset.modalDrawColor));
});
modalDrawWidthSelect?.addEventListener("change", () => {
  applyModalDrawWidthPreset(modalDrawWidthSelect.value);
});
modalStickyColorButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const color = btn.dataset.modalStickyColor;
    if (!color) return;
    modalStickyColor = color;
    modalBoard?.setSelectedStickyColor?.(color);
    modalStickyColorButtons.forEach(item => item.classList.toggle("active", item === btn));
  });
});

if (modalStampItems) {
  const stampEntries = Object.entries(STAMP_PRESETS);
  const orderedStampEntries = [
    ...stampEntries.filter(([, preset]) => !!preset.imageSrc),
    ...stampEntries.filter(([, preset]) => !preset.imageSrc)
  ];
  orderedStampEntries.forEach(([key, preset]) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "stamp-item";
    item.dataset.stampKey = key;
    item.title = preset.label || key;
    item.setAttribute("aria-label", preset.label || key);
    item.classList.toggle("active", key === modalSelectedStamp);
    item.appendChild(createStampElement(key));
    item.addEventListener("click", () => {
      modalSelectedStamp = key;
      modalBoard?.setStampType?.(key);
      modalStampItems.querySelectorAll(".stamp-item").forEach(stampItem => {
        stampItem.classList.toggle("active", stampItem === item);
      });
      closeModalToolMenu();
    });
    modalStampItems.appendChild(item);
  });
}

document.addEventListener("pointerdown", event => {
  if (!modalSettingsOpenTool || !modalToolMenu || modalToolMenu.classList.contains("hidden")) return;
  const target = event.target;
  if (modalToolMenu.contains(target) || target.closest?.(".modal-tool-strip")) return;
  closeModalToolMenu();
});

window.addEventListener("resize", () => {
  if (!modalSettingsOpenTool) return;
  positionModalToolMenu(getModalToolButton(modalSettingsOpenTool));
});

// 初期ツールはペン
setModalTool("pen");

// ========= ビュー切り替え：ホワイトボード / 生徒画面 / ノート確認 =========
function setTeacherViewMode(mode) {
  if (!boardContainer || !studentViewContainer || !notebookViewContainer) return;
  currentTeacherViewMode = mode;

  const sidebar = document.getElementById("wbSidebar");
  const bottomTools = document.querySelector(".floating-bottom-right");
  const contextMenu = document.getElementById("contextMenu");
  const pageToolbar = document.querySelector(".page-toolbar");

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

  // タイルを表示する画面では、全モード共通の生徒サムネイルを受信する。
  // currentClassCode が入っているときだけサーバーに通知する
  if (currentClassCode) {
    if (mode === "student" || mode === "notebook") {
      socket.emit("student-view-start", { classCode: currentClassCode });
    } else {
      // 教員ホワイトボードでは生徒タイルを表示しないため停止する。
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
    if (pageToolbar) show(pageToolbar);
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
    if (pageToolbar) hide(pageToolbar);
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
    if (pageToolbar) hide(pageToolbar);
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
  const nextStudentSocketIds = new Set(
    normalizedList.map((student) => student?.socketId).filter(Boolean)
  );
  const hasNewlyConnectedStudent = Array.from(nextStudentSocketIds).some(
    (socketId) => !connectedStudentSocketIds.has(socketId)
  );

  Object.keys(latestThumbnails).forEach((socketId) => {
    if (!nextStudentSocketIds.has(socketId)) {
      delete latestThumbnails[socketId];
    }
  });
  connectedStudentSocketIds = nextStudentSocketIds;

  // タイル表示中に参加した生徒にも、共通の5秒更新を開始してもらう。
  if (
    hasNewlyConnectedStudent &&
    (currentTeacherViewMode === "student" || currentTeacherViewMode === "notebook") &&
    currentClassCode
  ) {
    socket.emit("student-view-start", { classCode: currentClassCode });
  }

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
  renderTiles();

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

  // ノート提出モードも、台形補正後の画像が通常サムネイル経路で届く。
  latestThumbnails[socketId] = { nickname, dataUrl, mode: currentMode, viewport };
  if (currentMode === "notebook") {
    const studentId = nickname || studentNameMap[socketId] || socketId;
    notebookStudents[studentId] = { latestImageData: dataUrl };
    renderNotebookTiles();
    updateNotebookInfo();
  }
  renderTiles();
});


// ★ ここを「Canvasベースのモーダル表示」に修正 ★
// ★ 高解像度画像受信時：今回は「モーダルを開く＋タイトル更新」だけ行う
socket.on("student-highres", ({ socketId, nickname, dataUrl }) => {
  if (!modalBackdrop || !modalTitle) return;
  if (!socketId || socketId !== currentMonitoringStudentSocketId) return;

  modalTitle.textContent = `${nickname || "生徒"} さんの画面`;
  modalBackdrop.style.display = "flex";
  modalBackdrop.classList.add("show");

  // 実際の描画・編集は startMonitoringStudent 内で初期化した modalBoard が担当する
});


/* ==== 共同編集用：生徒からのボード状態・操作を反映 ==== */

async function resolveRealtimeBoardData(boardData, boardSnapshotPath, snapshotVersion = "") {
  if (boardData) return boardData;
  if (!boardSnapshotPath || !boardApi.enabled) return null;
  try {
    return await boardApi.loadRealtimeBoardSnapshot(boardSnapshotPath, snapshotVersion);
  } catch (error) {
    console.error("Failed to load realtime board snapshot:", error);
    return null;
  }
}

function createMonitorRequestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `monitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clearModalBoardLoadTimer() {
  if (!modalBoardLoadTimerId) return;
  clearTimeout(modalBoardLoadTimerId);
  modalBoardLoadTimerId = null;
}

function updateModalBoardInteractionLock() {
  const isBlocked = modalBoardLoadState === "loading" || modalBoardLoadState === "error";
  const editingControls = [
    modalToolPenBtn,
    modalToolHighlighterBtn,
    modalToolEraserBtn,
    modalToolStampBtn,
    modalToolStickyBtn,
    modalDrawWidthSelect,
    ...modalDrawColorButtons,
    ...modalStickyColorButtons,
    ...(modalStampItems ? Array.from(modalStampItems.querySelectorAll(".stamp-item")) : []),
  ].filter(Boolean);

  editingControls.forEach(control => {
    control.disabled = isBlocked;
  });
  if (modalShareToStudentBtn) modalShareToStudentBtn.disabled = isBlocked;
  if (modalOverlayCanvas) {
    modalOverlayCanvas.style.pointerEvents = isBlocked ? "none" : "auto";
  }
  modalBoardContainer?.setAttribute("aria-busy", String(modalBoardLoadState === "loading"));
}

function setModalBoardLoadState(state, message = "") {
  modalBoardLoadState = state;
  const isBlocked = state === "loading" || state === "error";
  if (modalBoardLoadingOverlay) {
    modalBoardLoadingOverlay.hidden = !isBlocked;
    modalBoardLoadingOverlay.dataset.state = state;
  }
  if (modalBoardLoadingMessage) {
    modalBoardLoadingMessage.textContent = message || (
      state === "error"
        ? "生徒ボードを読み込めませんでした。"
        : "生徒ボードを読み込み中…"
    );
  }
  if (modalBoardRetryBtn) modalBoardRetryBtn.hidden = state !== "error";
  updateModalBoardInteractionLock();
}

function isCurrentMonitorResponse(studentSocketId, monitorRequestId) {
  return studentSocketId === currentMonitoringStudentSocketId &&
    isMatchingMonitorRequest(currentModalMonitorRequestId, monitorRequestId);
}

function completeStudentModalBoardLoad(studentSocketId, monitorRequestId) {
  if (!isCurrentMonitorResponse(studentSocketId, monitorRequestId)) return false;
  clearModalBoardLoadTimer();
  setModalBoardLoadState("ready");
  return true;
}

function requestStudentModalBoardState(studentSocketId) {
  if (!currentClassCode || !studentSocketId) return null;

  clearModalBoardLoadTimer();
  clearPendingTeacherSync(studentSocketId);
  latestTeacherSyncTokenByStudent.delete(studentSocketId);
  latestStudentBoardRevisionByStudent.delete(studentSocketId);

  const monitorRequestId = createMonitorRequestId();
  currentModalMonitorRequestId = monitorRequestId;
  setModalBoardLoadState("loading", "生徒の画面を読み込み中…");
  modalBoardLoadTimerId = setTimeout(() => {
    if (!isCurrentMonitorResponse(studentSocketId, monitorRequestId)) return;
    setModalBoardLoadState(
      "error",
      "生徒の画面を読み込めませんでした。再読み込みしてください。"
    );
  }, MODAL_BOARD_LOAD_TIMEOUT_MS);

  void socket.emit("start-monitoring", {
    classCode: currentClassCode,
    studentSocketId,
    monitorRequestId,
  });
  return monitorRequestId;
}

modalBoardRetryBtn?.addEventListener("click", () => {
  if (!currentMonitoringStudentSocketId) return;
  requestStudentModalBoardState(currentMonitoringStudentSocketId);
});

function isCurrentTeacherBoardSync(studentSocketId, teacherSyncToken) {
  const expectedToken = latestTeacherSyncTokenByStudent.get(studentSocketId);
  const pendingToken = pendingTeacherSyncTokenByStudent.get(studentSocketId);
  return canAcceptTeacherBoardSnapshot({
    expectedToken,
    pendingToken,
    snapshotToken: teacherSyncToken,
  });
}

function clearPendingTeacherSync(studentSocketId, teacherSyncToken = null) {
  const pendingToken = pendingTeacherSyncTokenByStudent.get(studentSocketId);
  if (teacherSyncToken && pendingToken !== teacherSyncToken) return false;
  pendingTeacherSyncTokenByStudent.delete(studentSocketId);
  const timerId = teacherSyncAckTimerByStudent.get(studentSocketId);
  if (timerId) clearTimeout(timerId);
  teacherSyncAckTimerByStudent.delete(studentSocketId);
  return true;
}

function parseBoardRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function isStaleStudentBoardRevision(studentSocketId, boardRevision, allowEqual = true) {
  const revision = parseBoardRevision(boardRevision);
  const latest = latestStudentBoardRevisionByStudent.get(studentSocketId);
  if (revision == null || latest == null) return false;
  return allowEqual ? revision <= latest : revision < latest;
}

function rememberStudentBoardRevision(studentSocketId, boardRevision) {
  const revision = parseBoardRevision(boardRevision);
  if (!studentSocketId || revision == null) return;
  const latest = latestStudentBoardRevisionByStudent.get(studentSocketId);
  if (latest == null || revision > latest) {
    latestStudentBoardRevisionByStudent.set(studentSocketId, revision);
  }
}

async function sendTeacherWhiteboardAction(
  studentSocketId,
  action,
  teacherSyncToken,
  monitorRequestId
) {
  if (!isCurrentMonitorResponse(studentSocketId, monitorRequestId)) return false;
  clearPendingTeacherSync(studentSocketId);
  pendingTeacherSyncTokenByStudent.set(studentSocketId, teacherSyncToken);

  const sent = await socket.emit("teacher-whiteboard-action", {
    classCode: currentClassCode,
    targetStudentSocketId: studentSocketId,
    monitorRequestId,
    action: {
      ...action,
      teacherSyncToken,
    },
  });
  if (sent === false) {
    if (clearPendingTeacherSync(studentSocketId, teacherSyncToken)) {
      requestStudentModalBoardState(studentSocketId);
    }
    return false;
  }

  // 順番待ち中にACK済み、または新しい操作へ進んでいれば旧タイマーは作らない。
  if (pendingTeacherSyncTokenByStudent.get(studentSocketId) === teacherSyncToken) {
    const timerId = setTimeout(() => {
      if (!clearPendingTeacherSync(studentSocketId, teacherSyncToken)) return;
      requestStudentModalBoardState(studentSocketId);
    }, 8000);
    teacherSyncAckTimerByStudent.set(studentSocketId, timerId);
  }
  return true;
}

socket.on("student-teacher-action-ack", ({
  studentSocketId,
  teacherSyncToken,
  boardRevision,
  monitorRequestId,
}) => {
  if (!studentSocketId || !teacherSyncToken) return;
  if (!isCurrentMonitorResponse(studentSocketId, monitorRequestId)) return;
  if (!clearPendingTeacherSync(studentSocketId, teacherSyncToken)) return;
  latestTeacherSyncTokenByStudent.set(studentSocketId, teacherSyncToken);
  rememberStudentBoardRevision(studentSocketId, boardRevision);
});

function importStudentBoardDataIntoModal(boardData, studentSocketId, viewport) {
  if (!boardData || !modalBoard || typeof modalBoard.importBoardData !== "function") {
    return false;
  }

  const previousModalView = modalHasInitialBoardData
    ? {
      scale: modalBoard.scale,
      offsetX: modalBoard.offsetX,
      offsetY: modalBoard.offsetY
    }
    : null;

  modalBoard.importBoardData(boardData);
  if (previousModalView) {
    // Full snapshots update the board model, not the teacher's viewport.
    // Otherwise a delayed Supabase response resets a pan/zoom in progress.
    modalBoard.scale = previousModalView.scale;
    modalBoard.offsetX = previousModalView.offsetX;
    modalBoard.offsetY = previousModalView.offsetY;
  } else {
    applyStudentViewportToModalBoard(
      viewport || latestViewportByStudent[studentSocketId]
    );
  }
  modalBoard.render?.();
  modalHasInitialBoardData = true;
  setModalImageLayerMode("whiteboard");

  // Whiteboard mode is rendered exclusively from structured data. Keeping a
  // compressed screen capture underneath creates a blurry duplicate as soon as
  // the editable canvas is panned or zoomed.
  if (modalCtx && modalCanvas) {
    modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
  }
  return true;
}

// 生徒の現在のホワイトボード全体状態（セッション開始直後など）
socket.on("student-board-state", async ({
  studentSocketId,
  boardData: incomingBoardData,
  boardSnapshotPath,
  teacherSyncToken,
  snapshotVersion,
  boardRevision,
  monitorRequestId,
}) => {
  if (
    !isCurrentMonitorResponse(studentSocketId, monitorRequestId) ||
    !isCurrentTeacherBoardSync(studentSocketId, teacherSyncToken)
  ) {
    return;
  }
  if (isStaleStudentBoardRevision(studentSocketId, boardRevision, false)) return;
  const boardData = await resolveRealtimeBoardData(
    incomingBoardData,
    boardSnapshotPath,
    snapshotVersion
  );
  if (
    !isCurrentMonitorResponse(studentSocketId, monitorRequestId) ||
    !isCurrentTeacherBoardSync(studentSocketId, teacherSyncToken)
  ) {
    return;
  }
  if (isStaleStudentBoardRevision(studentSocketId, boardRevision, false)) return;
  console.log("[teacher] student-board-state", {
    studentSocketId,
    hasBoardData: !!boardData
  });

  if (!studentSocketId || !boardData) return;

  rememberStudentBoardRevision(studentSocketId, boardRevision);
  if (teacherSyncToken) {
    latestTeacherSyncTokenByStudent.set(studentSocketId, teacherSyncToken);
  }
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

  const imported = importStudentBoardDataIntoModal(
    boardData,
    studentSocketId,
    latestViewportByStudent[studentSocketId]
  );
  if (imported) completeStudentModalBoardLoad(studentSocketId, monitorRequestId);
});



// 生徒側の増分操作（ペン・消しゴム・図形など）
socket.on("student-whiteboard-action", ({
  studentSocketId,
  action,
  boardRevision,
  monitorRequestId,
}) => {
  console.log("[teacher] student-whiteboard-action", {
    studentSocketId,
    hasAction: !!action
  });

  // 今監視している生徒以外の操作は無視
  if (!isCurrentMonitorResponse(studentSocketId, monitorRequestId)) {
    return;
  }

  if (!modalBoard || !action || typeof modalBoard.applyAction !== "function") return;
  if (isStaleStudentBoardRevision(studentSocketId, boardRevision)) return;
  modalBoard.applyAction(action);
  rememberStudentBoardRevision(studentSocketId, boardRevision);
});


// ★ 生徒側からの「画面更新」（スクショ＋ボードデータ）
//   → 共同編集中の生徒のボードデータを定期的に上書きする用途
// ★ 生徒側からの「画面更新」（スクショ＋ボードデータ）
//   → 共同編集中の生徒のボードデータを定期的に上書きする用途
socket.on(
  "student-screen-update",
  async ({
    studentSocketId,
    nickname,
    classCode,
    dataUrl,
    viewport,
    mode,
    boardData: incomingBoardData,
    boardSnapshotPath,
    teacherSyncToken,
    snapshotVersion,
    isSync,
    boardRevision,
    monitorRequestId,
  }) => {
    if (!isCurrentMonitorResponse(studentSocketId, monitorRequestId)) return;
    const effectiveMode = mode || "whiteboard";
    let boardData = null;
    if (
      isCurrentTeacherBoardSync(studentSocketId, teacherSyncToken) &&
      !isStaleStudentBoardRevision(studentSocketId, boardRevision, false)
    ) {
      const resolvedBoardData = await resolveRealtimeBoardData(
        incomingBoardData,
        boardSnapshotPath,
        snapshotVersion
      );
      if (
        isCurrentMonitorResponse(studentSocketId, monitorRequestId) &&
        isCurrentTeacherBoardSync(studentSocketId, teacherSyncToken) &&
        !isStaleStudentBoardRevision(studentSocketId, boardRevision, false)
      ) {
        boardData = resolvedBoardData;
      }
    }

    console.log("[teacher] student-screen-update", {
      studentSocketId,
      mode: effectiveMode,
      hasBoardData: !!boardData,
      hasImage: !!dataUrl
    });

    if (!studentSocketId) return;

    // 画像更新だけが先に届いても、UUID の socketId ではなく認証済みの生徒IDを表示する。
    if (nickname) {
      studentNameMap[studentSocketId] = nickname;
    }

    // 生徒ごとの最新モードを記録
    latestModeByStudent[studentSocketId] = effectiveMode;
    if (viewport) {
      latestViewportByStudent[studentSocketId] = viewport;
    }
    if (currentMonitoringStudentSocketId === studentSocketId) {
      modalCurrentStudentMode = effectiveMode;
      setModalImageLayerMode(effectiveMode);
      updateModalRestoreFeedbackButton();
    }

    // ★ 追加：モードに応じてグリッド表示切り替え
    if (modalBoard && currentMonitoringStudentSocketId === studentSocketId) {
      modalBoard.setShowGrid(effectiveMode !== "notebook");
    }

    // 最新の boardData は保持しておく（whiteboardモード用）
    if (boardData) {
      rememberStudentBoardRevision(studentSocketId, boardRevision);
      if (teacherSyncToken) {
        latestTeacherSyncTokenByStudent.set(studentSocketId, teacherSyncToken);
      }
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

    // 保存済みフィードバックを表示中は、ライブ画面で下レイヤーを上書きしない。
    if (modalShowingSavedFeedback && currentMonitoringStudentSocketId === studentSocketId) {
      return;
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
        const imported = importStudentBoardDataIntoModal(boardData, studentSocketId, viewport);
        if (imported) completeStudentModalBoardLoad(studentSocketId, monitorRequestId);
      }

      // whiteboardモードでは overlay 上に書きながら、生徒WBと同期（onActionで emit）
      updateModalBoardInteractionLock();

      // Never mix the low-resolution screen capture into whiteboard mode.
      // Initial state and later updates arrive as structured board data/actions.
      if (modalCtx && modalCanvas) {
        modalCtx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
      }

      return;
    }

    // --- 2. ノート提出モード & 3. 画面共有モード ---
    // どちらも「下レイヤーに画像を表示し、上レイヤーはローカル描画のみ」という動きに統一
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      // ===== モーダル用の描画 =====
      if (modalCanvas && modalCtx && isCurrentMonitorResponse(studentSocketId, monitorRequestId)) {
        const cw = modalCanvas.width;
        const ch = modalCanvas.height;
        if (cw && ch) {
          const viewportKey = `${studentSocketId}:${effectiveMode}:${img.naturalWidth}x${img.naturalHeight}`;
          const shouldFitViewport = modalImageViewportKey !== viewportKey;
          modalImageElement = img;
          modalImageViewportKey = viewportKey;

          // 最初の画像だけ全体が収まる倍率へ合わせる。以後の定期更新では
          // 教員がズーム／パンした位置を維持する。
          if (shouldFitViewport) fitModalImageViewport(img);
          modalBoard?.render?.();
        }
      }
      completeStudentModalBoardLoad(studentSocketId, monitorRequestId);

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
              nickname ||
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

/* ===== 共同編集開始 / 終了ヘルパー ===== */

function getStudentModalNavigationEntries() {
  return Object.entries(latestThumbnails);
}

function updateStudentModalNavigation() {
  if (!modalPreviousStudentBtn || !modalNextStudentBtn) return;

  const entries = getStudentModalNavigationEntries();
  const currentIndex = entries.findIndex(
    ([socketId]) => socketId === currentMonitoringStudentSocketId
  );
  const previousEntry = currentIndex > 0 ? entries[currentIndex - 1] : null;
  const nextEntry =
    currentIndex >= 0 && currentIndex < entries.length - 1
      ? entries[currentIndex + 1]
      : null;

  modalPreviousStudentBtn.disabled = !previousEntry;
  modalNextStudentBtn.disabled = !nextEntry;
  modalPreviousStudentBtn.title = previousEntry
    ? `前の生徒：${previousEntry[1].nickname || "生徒"}`
    : "前の生徒はいません";
  modalNextStudentBtn.title = nextEntry
    ? `次の生徒：${nextEntry[1].nickname || "生徒"}`
    : "次の生徒はいません";
  modalPreviousStudentBtn.setAttribute("aria-label", modalPreviousStudentBtn.title);
  modalNextStudentBtn.setAttribute("aria-label", modalNextStudentBtn.title);
}

function navigateStudentModal(direction) {
  const entries = getStudentModalNavigationEntries();
  const currentIndex = entries.findIndex(
    ([socketId]) => socketId === currentMonitoringStudentSocketId
  );
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= entries.length) return;

  const [studentSocketId, info] = entries[targetIndex];
  if ((info.mode || latestModeByStudent[studentSocketId]) !== "whiteboard") {
    socket.emit("request-highres", {
      classCode: currentClassCode,
      studentSocketId
    });
  }
  startMonitoringStudent(studentSocketId, info.nickname);
}

modalPreviousStudentBtn?.addEventListener("click", () => {
  navigateStudentModal(-1);
});

modalNextStudentBtn?.addEventListener("click", () => {
  navigateStudentModal(1);
});

/**
 * 特定の生徒のタイルをクリックしたときに呼び出される。
 * - 以前監視していた生徒がいれば、そのセッションを終了
 * - 新しい生徒との「start-monitoring」セッションを開始
 * - ステータスラベルを更新
 */
function startMonitoringStudent(studentSocketId, nickname) {
  if (!currentClassCode) return;

  const previousStudentSocketId = currentMonitoringStudentSocketId;
  // The overlay canvas is reused between modal sessions. Remove the previous
  // Whiteboard listeners before attaching a new instance; otherwise an old pen
  // tool and the current highlighter tool both react to the same pointer input.
  closeModalToolMenu();
  destroyModalBoard();
  if (previousStudentSocketId) {
    delete latestBoardDataByStudent[previousStudentSocketId];
  }
  // Always request a fresh structured snapshot. A cached board can contain
  // blob: URLs owned by the destroyed Whiteboard instance and therefore no
  // longer valid in a new modal session.
  delete latestBoardDataByStudent[studentSocketId];

  // すでに別の生徒を監視していた場合は一旦終了
  if (
    currentMonitoringStudentSocketId &&
    currentMonitoringStudentSocketId !== studentSocketId
  ) {
    const previousStudentSocketId = currentMonitoringStudentSocketId;
    const previousMonitorRequestId = currentModalMonitorRequestId;
    socket.emit("stop-monitoring", {
      classCode: currentClassCode,
      studentSocketId: previousStudentSocketId,
      monitorRequestId: previousMonitorRequestId,
    });
    clearPendingTeacherSync(previousStudentSocketId);
  }

  // 今回選択した生徒を「現在監視中」として記録
  currentMonitoringStudentSocketId = studentSocketId;
  clearModalImageViewport();
  modalCurrentStudentMode = latestModeByStudent[studentSocketId] || "whiteboard";
  modalShowingSavedFeedback = false;
  updateModalRestoreFeedbackButton();
  updateStudentModalNavigation();

  // ★ 初期同期フラグをリセット
  modalHasInitialBoardData = false;

  // 最新状態の取得が完了するまで、モーダル内の編集をロックする。
  requestStudentModalBoardState(studentSocketId);

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
    setModalImageLayerMode(modalCurrentStudentMode);

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
    modalBoard = new TableWhiteboard({ canvas: modalOverlayCanvas });
    modalBoard.setTeacherMode(true);

    // Whiteboard がズーム／パン／ピンチ操作で再描画されるたびに、下の
    // ノート画像も同じ scale / offset で描き直す。
    const renderModalOverlay = modalBoard.render.bind(modalBoard);
    modalBoard.render = () => {
      renderModalImageLayer();
      if (modalShowingSavedFeedback) {
        const overlayCtx = modalOverlayCanvas?.getContext("2d");
        overlayCtx?.setTransform(1, 0, 0, 1, 0, 0);
        overlayCtx?.clearRect(0, 0, modalOverlayCanvas.width, modalOverlayCanvas.height);
        return;
      }
      renderModalOverlay();
    };
    updateModalBoardInteractionLock();

    // ★ ノート提出モードならグリッド非表示
    if (modalCurrentStudentMode === "notebook") {
      modalBoard.setShowGrid(false);
    } else {
      modalBoard.setShowGrid(true);
    }

    // Whiteboard のスケール反映
    modalBoard.applyScale?.();
    modalBoard.render?.();

    // リサイズ対応
    modalResizeObserver = new ResizeObserver(entries => {
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
    modalResizeObserver.observe(modalBoardContainer);

    // ツール初期化
    setModalTool(modalCurrentTool);

    // 線を書いたときのactionフック
    modalBoard.onAction = (action) => {
      if (!currentClassCode || !currentMonitoringStudentSocketId) return;
      if (modalBoardLoadState !== "ready" || !currentModalMonitorRequestId) return;

      // ★ notebook / screen モードのときは、生徒ホワイトボードを変更しない
      if (modalCurrentStudentMode !== "whiteboard") {
        // ローカル描画のみ（overlay上だけ）にするので emit しない
        return;
      }

      modalTeacherSyncCounter += 1;
      const teacherSyncToken = `${Date.now().toString(36)}-${modalTeacherSyncCounter.toString(36)}`;
      void sendTeacherWhiteboardAction(
        currentMonitoringStudentSocketId,
        action,
        teacherSyncToken,
        currentModalMonitorRequestId
      );
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

  const stoppedStudentSocketId = currentMonitoringStudentSocketId;

  socket.emit("stop-monitoring", {
    classCode: currentClassCode,
    studentSocketId: stoppedStudentSocketId,
    monitorRequestId: currentModalMonitorRequestId,
  });

  clearPendingTeacherSync(stoppedStudentSocketId);
  delete latestBoardDataByStudent[stoppedStudentSocketId];
  clearModalBoardLoadTimer();
  currentModalMonitorRequestId = null;
  currentMonitoringStudentSocketId = null;
  setModalBoardLoadState("idle");

  if (statusLabel) {
    statusLabel.textContent = `クラスコード ${currentClassCode} で待機中…`;
  }
}

function updateModalRestoreFeedbackButton() {
  if (!modalRestoreFeedbackBtn) return;

  const canRestore =
    !!currentMonitoringStudentSocketId &&
    modalCurrentStudentMode !== "whiteboard" &&
    sentFeedbackByStudent.has(currentMonitoringStudentSocketId);

  modalRestoreFeedbackBtn.hidden = !canRestore;
  modalRestoreFeedbackBtn.textContent = modalShowingSavedFeedback
    ? "ライブ画面に戻る"
    : "送ったフィードバックを表示";
}

function drawSavedFeedbackInModal(imageData) {
  if (!modalCanvas || !modalCtx || !imageData) return;

  const img = new Image();
  img.onload = () => {
    modalImageElement = img;
    modalImageViewportKey = `saved:${currentMonitoringStudentSocketId}:${img.naturalWidth}x${img.naturalHeight}`;
    fitModalImageViewport(img);
    renderModalImageLayer();
    if (modalOverlayCanvas) {
      modalOverlayCanvas.getContext("2d")?.clearRect(
        0,
        0,
        modalOverlayCanvas.width,
        modalOverlayCanvas.height
      );
    }
  };
  img.src = imageData;
}

if (modalRestoreFeedbackBtn) {
  modalRestoreFeedbackBtn.addEventListener("click", () => {
    const studentSocketId = currentMonitoringStudentSocketId;
    if (!studentSocketId) return;

    if (modalShowingSavedFeedback) {
      modalShowingSavedFeedback = false;
      updateModalRestoreFeedbackButton();
      socket.emit("request-highres", {
        classCode: currentClassCode,
        studentSocketId
      });
      return;
    }

    const feedback = sentFeedbackByStudent.get(studentSocketId);
    if (!feedback) return;
    modalShowingSavedFeedback = true;
    drawSavedFeedbackInModal(feedback.imageData);
    updateModalRestoreFeedbackButton();
  });
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
      const notice = CHAT_TEMPLATE_NOTICE[templateKind] || null;
      chatAlertBtn.title = `${info.nickname || "生徒"}のチャットを開く`;
      chatAlertBtn.setAttribute("aria-label", `${info.nickname || "生徒"}のチャットを開く`);
      chatAlertBtn.innerHTML = `<span class="material-symbols-rounded">${notice?.icon || "chat"}</span>${notice ? `<span class="chat-notice-label">${notice.label}</span>` : ""}<span class="chat-notify-dot show${dotClass}"></span>`;
      chatAlertBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openChatForStudent(socketId);
      });
      tile.appendChild(chatAlertBtn);
    }

    tile.appendChild(meta);

    tile.addEventListener("click", () => {
      if (!currentClassCode) return;

      // Whiteboard monitoring uses structured snapshots/actions only. The
      // high-resolution request is an image path and is unnecessary here.
      if ((info.mode || latestModeByStudent[socketId]) !== "whiteboard") {
        socket.emit("request-highres", {
          classCode: currentClassCode,
          studentSocketId: socketId
        });
      }

      startMonitoringStudent(socketId, info.nickname);
    });

    tileGrid.appendChild(tile);
  });
  updateStudentModalNavigation();
}

/**
 * 生徒画面拡大モーダルを閉じたときの処理。
 */
if (modalBackdrop && modalCloseBtn) {
  const hideModal = () => {
    modalBackdrop.classList.remove("show");
    modalBackdrop.style.display = "none";
    closeModalToolMenu();

    // 監視を終了してから対象の生徒IDをリセットする。
    stopMonitoringStudent();
    updateStudentModalNavigation();
    modalShowingSavedFeedback = false;
    updateModalRestoreFeedbackButton();
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

    destroyModalBoard();
    modalHasInitialBoardData = false;


    // モーダルの同期方式を通常状態へ戻す。
    modalSyncToStudent = true;

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

  if (open) teacherForms.closePanel();

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
  bubble.className = "chat-message-bubble" + (message.kind === "reaction" ? " chat-message-bubble--reaction" : "");
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
    bubble.className = "chat-message-bubble" + (m.kind === "reaction" ? " chat-message-bubble--reaction" : "");
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

    const notice = CHAT_TEMPLATE_NOTICE[templateKind] || null;
    if (notice) {
      const icon = document.createElement("span");
      icon.className = "material-symbols-rounded chat-template-notice-icon";
      icon.textContent = notice.icon;
      name.prepend(icon);
      preview.textContent = notice.label;
    }

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

function teacherSendReaction(reaction, targetSocketId = activeChatTargetSocketId, fromModal = false) {
  if (!currentClassCode || !targetSocketId) return;
  if (!Object.prototype.hasOwnProperty.call(CHAT_REACTIONS, reaction)) return;

  const text = CHAT_REACTIONS[reaction];
  socket.emit("teacher-chat-to-student", {
    classCode: currentClassCode,
    targetSocketId,
    message: text,
    kind: "reaction",
    reaction
  });

  appendChatMessageToHistory(targetSocketId, {
    from: "me",
    nickname: null,
    text,
    kind: "reaction",
    reaction,
    timestamp: Date.now()
  });

  if (fromModal) {
    renderModalChatMessagesForTarget(targetSocketId, { markRead: false });
    if (chatPanelOpen && activeChatTargetSocketId === targetSocketId) {
      renderChatMessagesForTarget(targetSocketId);
    }
  } else {
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

chatReactionButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    teacherSendReaction(btn.dataset.chatReaction || "");
  });
});

modalChatReactionButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    teacherSendReaction(btn.dataset.modalChatReaction || "", currentMonitoringStudentSocketId, true);
  });
});

socket.on("chat-message", payload => {
  if (!payload) return;
  if (payload.toRole !== "teacher") return;

  const fromId = payload.fromSocketId;
  const fromNickname = payload.fromNickname || "生徒";
  const text = payload.message;
  const timestamp = payload.timestamp || Date.now();
  const templateKind = normalizeChatTemplateKind(payload.templateKind || "");
  const kind = payload.kind === "reaction" ? "reaction" : "text";

  // ★ニックネームを記録（未読一覧表示に使う）
  studentNameMap[fromId] = fromNickname;

  appendChatMessageToHistory(fromId, {
    from: "them",
    nickname: fromNickname,
    text,
    kind,
    reaction: payload.reaction || "",
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

  // 3) Realtime の payload 上限を超えない JPEG に変換して返す。
  // 画面共有画像は PNG のままだと数百 KB～数 MB になり、Supabase 側で送信拒否される。
  return encodeFeedbackCanvasForRealtime(out, {
    maxWidth: 1280,
    minWidth: 360,
    quality: 0.84,
  });
}

/** 生徒画面モーダル上での添削結果を、そのまま生徒に送り返す */
async function sendAnnotatedImageToStudentFromModal() {
  if (!currentClassCode || !currentMonitoringStudentSocketId) {
    alert("クラスまたは対象の生徒が選択されていません。");
    return;
  }

  const merged = mergeStudentModalCanvases();
  if (!merged) {
    alert("送信する画像を作成できませんでした。");
    return;
  }

  let sent = false;
  if (modalShareToStudentBtn) modalShareToStudentBtn.disabled = true;
  try {
    sent = await socket.emit("teacherShareToStudent", {
      classCode: currentClassCode,
      studentSocketId: currentMonitoringStudentSocketId,
      imageData: merged
    });
  } catch (error) {
    console.error("[teacher] failed to send modal feedback", error);
  } finally {
    if (modalShareToStudentBtn) modalShareToStudentBtn.disabled = false;
  }

  if (sent === false) {
    alert("フィードバックを生徒へ送信できませんでした。通信状態を確認して、もう一度送信してください。");
    return;
  }

  if (modalCurrentStudentMode !== "whiteboard") {
    sentFeedbackByStudent.set(currentMonitoringStudentSocketId, {
      imageData: merged,
      mode: modalCurrentStudentMode,
      sentAt: Date.now()
    });
    modalShowingSavedFeedback = false;
    updateModalRestoreFeedbackButton();
  }

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
    void sendAnnotatedImageToStudentFromModal();
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

// 添削画像は、教員が送信ボタンを押したときだけ1回送る。
if (shareToggleBtn) {
  shareToggleBtn.addEventListener("click", sendFeedbackImageOnce);
}

async function sendFeedbackImageOnce() {
  if (!currentStudentId || !currentClassCode) return;
  const targetStudentId = currentStudentId;
  const data = encodeFeedbackCanvasForRealtime(feedbackCanvas, {
    maxWidth: 960,
    minWidth: 320,
    quality: 0.72,
  });
  if (!data) {
    alert("添削画像を送信用のサイズに変換できませんでした。");
    return;
  }

  shareToggleBtn.disabled = true;
  shareToggleBtn.textContent = "送信中…";
  try {
    const sent = await socket.emit("teacherShareToStudent", {
      classCode: currentClassCode,
      studentId: targetStudentId,
      imageData: data,
    });
    if (sent === false) {
      alert("添削画像を送信できませんでした。通信状態を確認して、もう一度送信してください。");
    }
  } catch (error) {
    console.error("[teacher] failed to send notebook feedback", error);
    alert("添削画像を送信できませんでした。通信状態を確認して、もう一度送信してください。");
  } finally {
    shareToggleBtn.disabled = false;
    shareToggleBtn.textContent = "送信";
    shareToggleBtn.className = "share-off";
  }
}

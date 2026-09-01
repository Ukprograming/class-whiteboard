// public/js/student.js
import { initBoardUI } from "./board-ui.js?v=tool-settings-20260818c&draw-style=20260824&highlighter-settings=20260824&png-stamps=20260824&session-recovery=20260824&eraser-hit=20260825&timer-tool=20260826&table-tool=20260901b&forms=20260830b&youtube=20260831b";
import {
  assignmentApi,
  authApi,
  boardApi,
  createRealtimeBridge,
  getStudentLoginHints,
  supabaseEnabled,
} from "./supabase-api.js?v=monitor-sync-20260819&realtime-scale=20260824&realtime-duplex=20260824&session-recovery=20260824&student-delete=20260826&forms=20260830&assignments=20260831";
import { jitteredInterval } from "./realtime-load-control.js?v=realtime-scale-20260824";
import { initStudentForms } from "./student-forms.js?v=forms-20260830&form-history=20260831&form-images=20260901";
import { replaceMaterialIcons } from "./ui-icons.js?v=forms-20260830b&assignments=20260831";

// 共通ホワイトボード UI 初期化
const whiteboard = initBoardUI();

// ★ ここから追加：ブラウザ離脱時の確認ダイアログ
window.addEventListener("beforeunload", (event) => {
  if (!whiteboard) return;

  // 変更がなければ何もしない
  if (!whiteboard.isBoardDirty) return;

  // 変更アリ → 確認ダイアログを出す
  event.preventDefault();
  event.returnValue = ""; // Chrome 等で必須
});
// ★ ここまで追加

// === API ベースパス（server.js の /api/board プロキシを叩く） ===
const BOARD_API_BASE = "/api/board";

// 生徒用 保存 / 読み込みボタン（HTML で用意しておく）
const studentSaveBoardBtn = document.getElementById("studentSaveBoardBtn");
const studentLoadBoardBtn = document.getElementById("studentLoadBoardBtn");
const studentOverwriteSaveBtn = document.getElementById("studentOverwriteSaveBtn");

// ========= socket.io =========
const socket = createRealtimeBridge();

// ==== DOM 要素（新 ID 優先、なければ旧 ID を使う） ====
// ==== DOM 要素（新 ID 優先、なければ旧 ID を使う） ====
// const classCodeInput = ... // 削除
// const nicknameInput = ... // 削除
// const joinBtn = ... // 削除

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

// PNG 保存ボタン (board-ui.js で exportPngBtn として処理されるため、ここは削除またはコメントアウト)
// const savePngBtn = document.getElementById("savePngBtn");

// ========= チャット UI 要素（生徒） =========
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatNotifyDot = document.getElementById("chatNotifyDot");
const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatMessagesEl = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const chatTemplateButtons = Array.from(
  document.querySelectorAll("[data-chat-template]")
);
const CHAT_TEMPLATE_KINDS = ["question", "repeat", "check"];
const CHAT_REACTIONS = {
  thumbs_up: "👍",
  clap: "👏",
  ok: "👌",
  idea: "💡",
  question: "❓"
};
const chatReactionButtons = Array.from(
  document.querySelectorAll("[data-chat-reaction]")
);
const studentAssignmentChip = document.getElementById("studentAssignmentChip");
const studentAssignmentCount = document.getElementById("studentAssignmentCount");
const studentAssignmentPanel = document.getElementById("studentAssignmentPanel");
const studentAssignmentCloseBtn = document.getElementById("studentAssignmentCloseBtn");
const studentAssignmentList = document.getElementById("studentAssignmentList");
const studentAssignmentStatus = document.getElementById("studentAssignmentStatus");

function getChatTemplateKind(btn) {
  if (!btn) return "";
  const explicitKind = btn.dataset.chatTemplateKind || "";
  if (CHAT_TEMPLATE_KINDS.includes(explicitKind)) return explicitKind;
  return CHAT_TEMPLATE_KINDS.find(kind =>
    btn.classList.contains(`chat-template-btn--${kind}`)
  ) || "";
}

// ★ 教員からの書き込み受け入れバー
const annotationAcceptBar = document.getElementById("annotationAcceptBar");
const acceptAnnotationBtn = document.getElementById("acceptAnnotationBtn");
const discardAnnotationBtn = document.getElementById("discardAnnotationBtn");

let monitorIntervalId = null;
let monitorLoopGeneration = 0;
let pendingAnnotationData = null;
const runtimeConfig = window.CLASS_WHITEBOARD_CONFIG || {};
const FREE_TIER_MODE = runtimeConfig.freeTierMode !== false;
const REALTIME_PAYLOAD_LIMIT_BYTES = Math.max(
  64000,
  Number(runtimeConfig.maxRealtimePayloadBytes) || 180000
);
const MAX_REALTIME_IMAGE_BYTES = Math.min(
  120000,
  Math.max(48000, REALTIME_PAYLOAD_LIMIT_BYTES - 60000)
);
const MONITORING_INTERVAL_MS = Math.max(
  3000,
  Number(runtimeConfig.monitoringIntervalMs) || 3000
);

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
let sharedBoardSession = null;
let applyingSharedBoardRemote = false;
let pendingStudentAssignments = [];
let studentAssignmentPanelOpen = false;
let unsubscribeStudentAssignments = null;
let assignmentRefreshInFlight = false;
const studentForms = initStudentForms({
  socket,
  getClassCode: () => currentClassCode,
  onOpen: () => {
    setChatPanelOpen(false);
    setStudentAssignmentPanelOpen(false);
  },
});

function setStudentAssignmentPanelOpen(open) {
  studentAssignmentPanelOpen = open && pendingStudentAssignments.length > 0;
  studentAssignmentPanel?.classList.toggle("collapsed", !studentAssignmentPanelOpen);
  studentAssignmentPanel?.setAttribute("aria-hidden", studentAssignmentPanelOpen ? "false" : "true");
  studentAssignmentChip?.setAttribute("aria-expanded", studentAssignmentPanelOpen ? "true" : "false");
  if (studentAssignmentPanelOpen) setChatPanelOpen(false);
}

function showStudentBoardChangeDecision(message) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "workflow-dialog-backdrop";
    const dialog = document.createElement("section");
    dialog.className = "workflow-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const header = document.createElement("header");
    header.className = "workflow-dialog-header";
    const heading = document.createElement("div");
    const kicker = document.createElement("p");
    kicker.className = "workflow-dialog-kicker";
    kicker.textContent = "未保存の変更があります";
    const title = document.createElement("h2");
    title.textContent = "保存を確認";
    heading.append(kicker, title);
    header.appendChild(heading);
    const description = document.createElement("p");
    description.className = "workflow-dialog-description";
    description.textContent = message;
    const actions = document.createElement("footer");
    actions.className = "workflow-dialog-actions";
    const cancelButton = document.createElement("button");
    cancelButton.className = "form-secondary-btn";
    cancelButton.type = "button";
    cancelButton.textContent = "キャンセル";
    const discardButton = document.createElement("button");
    discardButton.className = "form-secondary-btn";
    discardButton.type = "button";
    discardButton.textContent = "保存せずに開く";
    const saveButton = document.createElement("button");
    saveButton.className = "form-primary-btn";
    saveButton.type = "button";
    saveButton.textContent = "保存する";
    actions.append(cancelButton, discardButton, saveButton);
    dialog.append(header, description, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const finish = (choice) => {
      backdrop.remove();
      resolve(choice);
    };
    cancelButton.addEventListener("click", () => finish("cancel"));
    discardButton.addEventListener("click", () => finish("discard"));
    saveButton.addEventListener("click", () => finish("save"));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish("cancel");
    });
    saveButton.focus();
  });
}

async function confirmStudentBoardChange() {
  if (!whiteboard?.isBoardDirty) return true;
  const choice = await showStudentBoardChangeDecision(
    "課題を開く前に、現在のホワイトボードを保存しますか？"
  );
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  if (!currentBoardFileId || !currentBoardFileName) {
    alert("このボードはまだ保存されていません。先にファイルメニューの「保存...」で保存してください。");
    openBoardDialog("save");
    return false;
  }
  return studentSaveBoardInternal(
    lastUsedFolderPath || "",
    currentBoardFileName,
    currentBoardFileId,
    { silent: true }
  );
}

function renderPendingStudentAssignments() {
  if (!studentAssignmentList) return;
  studentAssignmentList.innerHTML = "";
  if (!pendingStudentAssignments.length) {
    const empty = document.createElement("p");
    empty.className = "workflow-dialog-description";
    empty.textContent = "未提出の課題はありません。";
    studentAssignmentList.appendChild(empty);
    return;
  }

  for (const assignment of pendingStudentAssignments) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "student-assignment-item";
    const details = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = assignment.title;
    const date = document.createElement("small");
    date.textContent = `配布: ${new Date(assignment.distributedAt).toLocaleString()}`;
    details.append(title, date);
    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = "arrow_forward";
    button.append(details, icon);
    button.addEventListener("click", () => void openPendingStudentAssignment(assignment));
    studentAssignmentList.appendChild(button);
  }
  replaceMaterialIcons(studentAssignmentList);
}

async function refreshPendingStudentAssignments() {
  if (!supabaseEnabled || !currentClassCode || !nickname || assignmentRefreshInFlight) return;
  assignmentRefreshInFlight = true;
  try {
    const result = await assignmentApi.listPendingStudentAssignments({
      classCode: currentClassCode,
      nickname,
    });
    pendingStudentAssignments = result.assignments || [];
    const count = pendingStudentAssignments.length;
    if (studentAssignmentCount) studentAssignmentCount.textContent = count > 99 ? "99+" : String(count);
    studentAssignmentChip?.classList.toggle("hidden", count === 0);
    if (count === 0) setStudentAssignmentPanelOpen(false);
    renderPendingStudentAssignments();
    if (studentAssignmentStatus) {
      studentAssignmentStatus.textContent = "";
      studentAssignmentStatus.classList.remove("error");
    }

    if (!unsubscribeStudentAssignments && result.studentId) {
      unsubscribeStudentAssignments = assignmentApi.subscribeStudentAssignments(
        result.studentId,
        () => void refreshPendingStudentAssignments()
      );
    }
  } catch (error) {
    console.error("Failed to refresh pending assignments", error);
    if (studentAssignmentStatus) {
      studentAssignmentStatus.textContent = "課題一覧を更新できませんでした。";
      studentAssignmentStatus.classList.add("error");
    }
  } finally {
    assignmentRefreshInFlight = false;
  }
}

async function openPendingStudentAssignment(assignment) {
  const canContinue = await confirmStudentBoardChange();
  if (!canContinue) return;
  if (studentAssignmentStatus) studentAssignmentStatus.textContent = "課題を開いています…";
  try {
    const result = await boardApi.loadBoard({
      action: "loadBoard",
      role: "student",
      classCode: currentClassCode,
      nickname,
      folderPath: assignment.folderPath || "",
      fileId: assignment.boardFileId,
    });
    sharedBoardSession = null;
    applyingSharedBoardRemote = true;
    try {
      whiteboard.importBoardData(result.boardData);
    } finally {
      applyingSharedBoardRemote = false;
    }
    whiteboard.markSaved?.();
    currentBoardFileId = result.fileId || assignment.boardFileId;
    currentBoardFileName = String(result.fileName || assignment.title).replace(/\.json$/i, "");
    lastUsedFolderPath = assignment.folderPath || "";
    hasRestoredStudentDraft = false;
    await clearStudentDraft();
    viewMode = "whiteboard";
    updateModeUI();
    if (statusLabel) statusLabel.textContent = `課題: ${assignment.title} / ${nickname}`;
    setStudentAssignmentPanelOpen(false);
  } catch (error) {
    console.error("Failed to open assignment", error);
    if (studentAssignmentStatus) {
      studentAssignmentStatus.textContent = `課題を開けませんでした: ${error?.message || error}`;
      studentAssignmentStatus.classList.add("error");
    }
  }
}

studentAssignmentChip?.addEventListener("click", () => {
  setStudentAssignmentPanelOpen(!studentAssignmentPanelOpen);
});
studentAssignmentCloseBtn?.addEventListener("click", () => setStudentAssignmentPanelOpen(false));

let captureTimerId = null;
let initialThumbnailTimerId = null;
let captureLoopActive = false;
let captureLoopGeneration = 0;
const CAPTURE_INTERVAL_MS = Math.max(
  5000,
  Number(runtimeConfig.thumbnailIntervalMs) || 5000
);

// キャプチャモード：'whiteboard' or 'screen'
let captureMode = "whiteboard";
// 画面表示モード：'whiteboard' | 'screen' | 'notebook'
let viewMode = "whiteboard";
let currentStream = null; // ノート提出用カメラの MediaStream

let screenStream = null;
let screenVideo = null;

function estimateRealtimeStringBytes(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function encodeCanvasForRealtime(sourceCanvas, options = {}) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) return null;
  const maxWidth = Math.min(sourceCanvas.width, Number(options.maxWidth) || 720);
  const minWidth = Math.min(maxWidth, Number(options.minWidth) || 240);
  let targetWidth = maxWidth;
  let quality = Number(options.quality) || 0.62;

  for (let attempt = 0; attempt < 6; attempt += 1) {
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
    if (estimateRealtimeStringBytes(dataUrl) <= MAX_REALTIME_IMAGE_BYTES) return dataUrl;
    targetWidth = Math.max(minWidth, Math.floor(targetWidth * 0.78));
    quality = Math.max(0.42, quality - 0.08);
  }

  console.warn("Realtime image was skipped because it could not be compressed safely.");
  return null;
}

async function loadActiveSharedBoard(classCode) {
  if (!boardApi.enabled || !whiteboard || !classCode) return;
  // 再接続や再読み込みの直後に、復元した未保存ボードを共有スナップショットで
  // 上書きしない。未保存状態がないときだけサーバー側の共有ボードを読む。
  if (whiteboard.isBoardDirty) return;
  try {
    const result = await boardApi.getActiveSharedBoard({ classCode });
    const sharedBoard = result.sharedBoard;
    if (!sharedBoard || !sharedBoard.boardData) return;

    sharedBoardSession = {
      id: sharedBoard.sharedBoardId,
      title: sharedBoard.title || "Shared board",
    };
    applyingSharedBoardRemote = true;
    try {
      whiteboard.importBoardData(sharedBoard.boardData);
    } finally {
      applyingSharedBoardRemote = false;
    }
    if (statusLabel) {
      statusLabel.textContent = `共同編集に参加中: ${classCode} / ${nickname || ""}`;
    }
  } catch (err) {
    console.error("Failed to load active shared board:", err);
  }
}

async function publishSharedBoardSnapshotFromStudent(reason = "refresh") {
  if (!sharedBoardSession || !whiteboard || !currentClassCode) return;
  const syncPayload = await createBoardSyncPayload();
  if (!syncPayload) return;
  await socket.emit("shared-board-snapshot", {
    classCode: currentClassCode,
    sharedBoardId: sharedBoardSession.id,
    title: sharedBoardSession.title,
    ...syncPayload,
    active: true,
    reason,
  });
}

// ★チャットを許可する画面モード
const CHAT_ENABLED_MODES = ["whiteboard", "screen", "notebook"];

// ========= Explorer風 モーダル用の状態（生徒用） =========
let boardDialogOverlay = null;          // オーバーレイ要素
let boardDialogMode = "save";           // "save" or "load"
let boardDialogSelectedFolder = "";     // 選択中フォルダ（自分の役割フォルダ内のサブフォルダパス）
let boardDialogSelectedFileId = null;   // 選択中ファイルID
let lastUsedFolderPath = "";            // 直近に使ったフォルダを記憶
// 今開いているボードの Drive ファイルID（なければ null）
let currentBoardFileId = null;
// 今開いているボードのファイル名（拡張子なし）
let currentBoardFileName = "";
let boardFileSaveInFlight = false;
const STUDENT_DRAFT_MARKER_KEY = "classWhiteboard.studentDraftMarker.v1";
const STUDENT_DRAFT_PAYLOAD_PREFIX = "classWhiteboard.studentDraft.v1:";
const STUDENT_DRAFT_DB_NAME = "class-whiteboard-student-drafts";
const STUDENT_DRAFT_STORE_NAME = "drafts";
const STUDENT_DRAFT_SAVE_DELAY_MS = 150;
let studentDraftSaveTimerId = null;
let studentSessionRestoreInProgress = false;
let hasRestoredStudentDraft = false;

function getStudentDraftKey(classCode = currentClassCode, studentId = nickname) {
  const normalizedClassCode = String(classCode || "").trim().toUpperCase();
  const normalizedStudentId = String(studentId || "").trim().toLowerCase();
  return normalizedClassCode && normalizedStudentId
    ? `${normalizedClassCode}:${normalizedStudentId}`
    : "";
}

function getStudentDraftSessionStorage() {
  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn("Session storage is unavailable; board refresh recovery is limited.", error);
    return null;
  }
}

function openStudentDraftDatabase() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(STUDENT_DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STUDENT_DRAFT_STORE_NAME)) {
        request.result.createObjectStore(STUDENT_DRAFT_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Draft database could not be opened."));
  });
}

async function writeStudentDraftToDatabase(draftKey, draft) {
  const database = await openStudentDraftDatabase();
  if (!database) return;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STUDENT_DRAFT_STORE_NAME, "readwrite");
    transaction.objectStore(STUDENT_DRAFT_STORE_NAME).put(draft, draftKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Draft could not be saved."));
    transaction.onabort = () => reject(transaction.error || new Error("Draft save was aborted."));
  });
  database.close();
}

async function readStudentDraftFromDatabase(draftKey) {
  const database = await openStudentDraftDatabase();
  if (!database) return null;
  const draft = await new Promise((resolve, reject) => {
    const transaction = database.transaction(STUDENT_DRAFT_STORE_NAME, "readonly");
    const request = transaction.objectStore(STUDENT_DRAFT_STORE_NAME).get(draftKey);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Draft could not be read."));
  });
  database.close();
  return draft;
}

async function deleteStudentDraftFromDatabase(draftKey) {
  if (!draftKey) return;
  const database = await openStudentDraftDatabase();
  if (!database) return;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STUDENT_DRAFT_STORE_NAME, "readwrite");
    transaction.objectStore(STUDENT_DRAFT_STORE_NAME).delete(draftKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Draft could not be cleared."));
  });
  database.close();
}

function createStudentDraft() {
  const draftKey = getStudentDraftKey();
  if (!draftKey || !whiteboard || !whiteboard.isBoardDirty) return null;
  return {
    version: 1,
    draftKey,
    classCode: currentClassCode,
    studentId: nickname,
    savedAt: new Date().toISOString(),
    boardData: whiteboard.exportBoardData(),
    currentBoardFileId,
    currentBoardFileName,
    lastUsedFolderPath,
  };
}

function persistStudentDraftNow() {
  if (studentDraftSaveTimerId) {
    clearTimeout(studentDraftSaveTimerId);
    studentDraftSaveTimerId = null;
  }
  const draft = createStudentDraft();
  if (!draft) return Promise.resolve(false);

  const storage = getStudentDraftSessionStorage();
  if (storage) {
    try {
      storage.setItem(STUDENT_DRAFT_MARKER_KEY, draft.draftKey);
      storage.setItem(`${STUDENT_DRAFT_PAYLOAD_PREFIX}${draft.draftKey}`, JSON.stringify(draft));
    } catch (error) {
      // 大きな画像を含むボードは sessionStorage の上限を超えるため、
      // IndexedDB 側の保存を継続する。
      console.warn("Board draft exceeded session storage; using IndexedDB.", error);
    }
  }

  return writeStudentDraftToDatabase(draft.draftKey, draft)
    .then(() => true)
    .catch((error) => {
      console.warn("Failed to persist the board draft in IndexedDB.", error);
      return Boolean(storage);
    });
}

function scheduleStudentDraftSave() {
  if (!currentClassCode || !nickname || !whiteboard) return;
  if (studentDraftSaveTimerId) clearTimeout(studentDraftSaveTimerId);
  studentDraftSaveTimerId = setTimeout(() => {
    void persistStudentDraftNow();
  }, STUDENT_DRAFT_SAVE_DELAY_MS);
}

async function clearStudentDraft(draftKey = getStudentDraftKey()) {
  if (!draftKey) return;
  if (studentDraftSaveTimerId) {
    clearTimeout(studentDraftSaveTimerId);
    studentDraftSaveTimerId = null;
  }
  const storage = getStudentDraftSessionStorage();
  if (storage?.getItem(STUDENT_DRAFT_MARKER_KEY) === draftKey) {
    storage.removeItem(STUDENT_DRAFT_MARKER_KEY);
  }
  storage?.removeItem(`${STUDENT_DRAFT_PAYLOAD_PREFIX}${draftKey}`);
  try {
    await deleteStudentDraftFromDatabase(draftKey);
  } catch (error) {
    console.warn("Failed to clear the stored board draft.", error);
  }
}

async function restoreStudentDraft(classCode, studentId) {
  const draftKey = getStudentDraftKey(classCode, studentId);
  const storage = getStudentDraftSessionStorage();
  if (!draftKey || storage?.getItem(STUDENT_DRAFT_MARKER_KEY) !== draftKey) return false;

  let draft = null;
  const rawDraft = storage.getItem(`${STUDENT_DRAFT_PAYLOAD_PREFIX}${draftKey}`);
  if (rawDraft) {
    try {
      draft = JSON.parse(rawDraft);
    } catch (error) {
      console.warn("Stored board draft could not be parsed.", error);
    }
  }
  if (!draft) {
    try {
      draft = await readStudentDraftFromDatabase(draftKey);
    } catch (error) {
      console.warn("Stored board draft could not be read from IndexedDB.", error);
    }
  }
  if (!draft?.boardData || draft.draftKey !== draftKey) return false;

  if (typeof whiteboard.restoreBoardDraft === "function") {
    whiteboard.restoreBoardDraft(draft.boardData);
  } else {
    whiteboard.importBoardData(draft.boardData);
  }
  currentBoardFileId = draft.currentBoardFileId || null;
  currentBoardFileName = draft.currentBoardFileName || "";
  lastUsedFolderPath = draft.lastUsedFolderPath || "";
  hasRestoredStudentDraft = true;
  if (statusLabel) {
    const savedAt = draft.savedAt ? new Date(draft.savedAt).toLocaleTimeString() : "直前";
    statusLabel.textContent = `編集中のボードを復元しました（${savedAt}）: ${classCode} / ${studentId}`;
  }
  return true;
}


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



/* ========================================
   クラス参加
   ======================================== */

// ========= クラス参加フォーム =========
const studentLoginForm = document.getElementById("studentLoginForm");
const studentLoginOverlay = document.getElementById("studentLoginOverlay");
const loginClassCodeInput = document.getElementById("loginClassCode");
const loginStudentIdInput = document.getElementById("loginNickname");
let loginStudentPasswordInput = document.getElementById("loginStudentPassword");
let loginSavedAccountSelect = document.getElementById("loginSavedAccount");
const loginSavedAccountLabel = document.getElementById("loginSavedAccountLabel");
const studentLoginMessage = document.getElementById("studentLoginMessage");
const studentLoginSubmitButton = studentLoginForm?.querySelector("button[type='submit']");
let studentLoginInProgress = false;

function setStudentLoginMessage(message, isError = false) {
  if (!studentLoginMessage) return;
  studentLoginMessage.textContent = message || "";
  studentLoginMessage.classList.toggle("is-error", isError);
}

function setStudentLoginPending(isPending) {
  studentLoginInProgress = isPending;
  if (studentLoginSubmitButton) {
    studentLoginSubmitButton.disabled = isPending;
    studentLoginSubmitButton.textContent = isPending ? "ログイン中…" : "ログインして参加";
    studentLoginSubmitButton.setAttribute("aria-busy", String(isPending));
  }
  if (isPending) {
    studentLoginForm?.setAttribute("aria-busy", "true");
  } else {
    studentLoginForm?.removeAttribute("aria-busy");
  }
}

function ensureStudentPasswordLoginControls() {
  if (!studentLoginForm) return;

  if (!loginSavedAccountSelect) {
    const label = document.createElement("label");
    label.textContent = "Saved login";
    loginSavedAccountSelect = document.createElement("select");
    loginSavedAccountSelect.id = "loginSavedAccount";
    label.appendChild(loginSavedAccountSelect);
    studentLoginForm.insertBefore(label, studentLoginForm.firstElementChild);
  }

  if (!loginStudentPasswordInput) {
    const label = document.createElement("label");
    label.textContent = "Password";
    loginStudentPasswordInput = document.createElement("input");
    loginStudentPasswordInput.id = "loginStudentPassword";
    loginStudentPasswordInput.type = "password";
    loginStudentPasswordInput.autocomplete = "current-password";
    loginStudentPasswordInput.required = true;
    label.appendChild(loginStudentPasswordInput);
    const submitButton = studentLoginForm.querySelector("button[type='submit']");
    studentLoginForm.insertBefore(label, submitButton || null);
  }
}

if (studentLoginForm) {
  ensureStudentPasswordLoginControls();

  if (loginSavedAccountSelect) {
    const hints = getStudentLoginHints();
    loginSavedAccountSelect.innerHTML = `<option value="">新しく入力する</option>`;
    if (loginSavedAccountLabel) loginSavedAccountLabel.hidden = hints.length === 0;
    hints.forEach((hint, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = hint.label || `${hint.classCode} / ${hint.studentLoginId}`;
      loginSavedAccountSelect.appendChild(option);
    });
    loginSavedAccountSelect.addEventListener("change", () => {
      const hint = hints[Number(loginSavedAccountSelect.value)];
      if (!hint) return;
      if (loginClassCodeInput) loginClassCodeInput.value = hint.classCode || "";
      if (loginStudentIdInput) loginStudentIdInput.value = hint.studentLoginId || "";
      if (loginStudentPasswordInput) loginStudentPasswordInput.value = "";
      if (loginStudentPasswordInput) loginStudentPasswordInput.focus();
    });
  }

  studentLoginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (studentLoginInProgress) return;

    const code = loginClassCodeInput.value.trim();
    const studentLoginId = loginStudentIdInput.value.trim();
    const password = loginStudentPasswordInput ? loginStudentPasswordInput.value : "";

    if (!code || !studentLoginId) {
      setStudentLoginMessage("クラスコードと生徒IDを入力してください。", true);
      return;
    }

    if (supabaseEnabled && !password) {
      setStudentLoginMessage("パスワードを入力してください。", true);
      return;
    }

    setStudentLoginPending(true);
    setStudentLoginMessage("ログイン中…");

    try {
      let signedInStudent = null;
      if (supabaseEnabled) {
        try {
          signedInStudent = await authApi.signInStudent({
            classCode: code,
            studentLoginId,
            password,
          });
        } catch (err) {
          console.error("Supabase student login failed:", err);
          setStudentLoginMessage(err.message || "ログインできませんでした。", true);
          return;
        }
      }

      const canonicalClassCode = signedInStudent?.classCode || code;
      const canonicalStudentId = signedInStudent?.studentLoginId || studentLoginId;
      currentClassCode = canonicalClassCode;
      nickname = canonicalStudentId;

      // サーバーへ参加リクエスト。完了前に mode-change を送ると、同じ
      // Supabase Presence channel への参加が二重に走るため必ず待つ。
      try {
        const joined = await socket.emit("join-class", {
          classCode: canonicalClassCode,
          nickname: canonicalStudentId,
        });
        if (supabaseEnabled && !joined) {
          setStudentLoginMessage("クラスに参加できませんでした。", true);
          return;
        }
      } catch (err) {
        console.error("Supabase realtime join failed:", err);
        setStudentLoginMessage(err.message || "クラスに参加できませんでした。", true);
        return;
      }
      if (supabaseEnabled) {
        if (studentLoginOverlay) studentLoginOverlay.classList.add("hidden");
        const displayLabel = signedInStudent?.displayName
          ? `${signedInStudent.displayName}（ID: ${canonicalStudentId}）`
          : canonicalStudentId;
        if (statusLabel) statusLabel.textContent = `クラス: ${canonicalClassCode} / ${displayLabel}`;
        updateModeUI();
        void refreshPendingStudentAssignments();
      }
    } finally {
      setStudentLoginPending(false);
    }
  });
}

async function restoreStudentSessionOnLoad() {
  if (!supabaseEnabled || studentLoginInProgress || !studentLoginOverlay) return;
  studentSessionRestoreInProgress = true;
  setStudentLoginPending(true);
  setStudentLoginMessage("前回のログイン状態と編集中のボードを確認中…");
  try {
    const restoredSession = await authApi.getStudentSession();
    if (!restoredSession) {
      setStudentLoginMessage("");
      return;
    }

    currentClassCode = restoredSession.classCode;
    nickname = restoredSession.studentLoginId;
    const joined = await socket.emit("join-class", {
      classCode: currentClassCode,
      nickname,
    });
    if (!joined) {
      setStudentLoginMessage("前回のクラスへの再参加に失敗しました。もう一度ログインしてください。", true);
      return;
    }

    studentLoginOverlay.classList.add("hidden");
    const displayLabel = restoredSession.displayName
      ? `${restoredSession.displayName}（ID: ${nickname}）`
      : nickname;
    if (statusLabel) statusLabel.textContent = `クラス: ${currentClassCode} / ${displayLabel}`;
    updateModeUI();

    const draftRestored = await restoreStudentDraft(currentClassCode, nickname);
    if (!draftRestored) {
      await loadActiveSharedBoard(currentClassCode);
    }
    void refreshPendingStudentAssignments();
  } catch (error) {
    console.error("Failed to restore the student session:", error);
    setStudentLoginMessage(
      "前回のログイン状態を復元できませんでした。通信を確認して、必要ならもう一度ログインしてください。",
      true
    );
  } finally {
    studentSessionRestoreInProgress = false;
    setStudentLoginPending(false);
  }
}

// 参加成功
socket.on("join-success", (payload) => {
  if (studentLoginOverlay) {
    studentLoginOverlay.classList.add("hidden");
  }
  if (statusLabel) {
    statusLabel.textContent = `クラス: ${payload.classCode} / ${payload.nickname}`;
  }

  // Realtime 側で正規化された値を、生徒画面全体の参加状態にも反映する。
  currentClassCode = payload.classCode || currentClassCode;
  nickname = payload.nickname || nickname;

  // ★ クラス参加後に現在モード（初期値: whiteboard）をサーバーに通知
  updateModeUI();
  if (!studentSessionRestoreInProgress && !hasRestoredStudentDraft) {
    void loadActiveSharedBoard(payload.classCode);
  }

  // 既存ボードデータの読み込みなどがあればここで行う
  // socket.emit("request-board-state", ...);
});



// 参加エラー
socket.on("join-error", (msg) => {
  alert("参加エラー: " + msg);
  currentClassCode = null;
  nickname = null;
});

/* ========================================
   生徒用 ホワイトボード保存 / 読み込み
   Explorer 風ダイアログ
   ======================================== */

// ---- API ヘルパー ----

// 自分の役割フォルダ（classCode + nickname）配下のフォルダ一覧
async function fetchFolderList() {
  if (!currentClassCode || !nickname) {
    throw new Error("クラスコードと生徒IDが設定されていません。");
  }

  const payload = {
    action: "listFolders",
    role: "student",
    classCode: currentClassCode,
    nickname
  };

  if (boardApi.enabled) {
    const json = await boardApi.listFolders(payload);
    const folders = json.folders || [];
    return folders.map(f => {
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
  return folders.map(f => {
    const path = f.path || f.folderPath || "";
    const name = f.name || path || "(未命名フォルダ)";
    return { path, name };
  });
}

// 指定フォルダ内のファイル一覧取得
async function fetchFileList(folderPath) {
  if (!currentClassCode || !nickname) {
    throw new Error("クラスコードと生徒IDが設定されていません。");
  }

  const payload = {
    action: "listBoards",
    role: "student",
    classCode: currentClassCode,
    nickname,
    folderPath: folderPath || ""
  };

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

      // クリックしたときの選択処理
      li.addEventListener("click", () => {
        Array.from(
          fileListEl.querySelectorAll(".board-dialog-file-item")
        ).forEach(el => el.classList.remove("selected"));

        li.classList.add("selected");
        boardDialogSelectedFileId = file.fileId;

        if (boardDialogMode === "save" && fileNameInput) {
          fileNameInput.value = file.fileName;
        }
      });

      // ★ 追加：保存モードのとき、「現在開いているファイル」を自動で選択
      if (
        boardDialogMode === "save" &&
        currentBoardFileId &&
        file.fileId === currentBoardFileId
      ) {
        li.classList.add("selected");
        boardDialogSelectedFileId = file.fileId;
        if (fileNameInput) {
          fileNameInput.value = file.fileName;
        }
      }

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

async function studentSaveBoardInternal(folderPath, fileName, overwriteFileId, options = {}) {
  const silent = options.silent === true;
  if (boardFileSaveInFlight) {
    if (!silent) alert("保存処理中です。完了するまでお待ちください。");
    return false;
  }
  if (!currentClassCode || !nickname) {
    if (!silent) alert("クラスに参加してから保存してください。");
    return false;
  }
  if (!whiteboard || typeof whiteboard.exportBoardData !== "function") {
    if (!silent) alert("ホワイトボードの状態を取得できません。");
    return false;
  }

  boardFileSaveInFlight = true;
  try {
    const saveRevision = whiteboard.getRevision?.();
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

    // ★ 上書き対象ファイルIDがある場合は付与
    if (overwriteFileId) {
      payload.fileId = overwriteFileId;
    }

    let res = { ok: true, status: 200 };
    let json = {};
    if (boardApi.enabled) {
      json = await boardApi.saveBoard(payload);
      whiteboard.applyAssetReferences?.(json.assetReferences);
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
        console.warn("[studentSaveBoardInternal] response is not JSON", text);
      }
    }

    if (!res.ok || json.ok === false) {
      if (!silent) alert(
        (json && json.message) ||
        `ホワイトボードの保存に失敗しました。（status=${res.status}）`
      );
      return false;
    }

    const mode = json.mode || (overwriteFileId ? "update" : "create");

    // ★ 今保存したファイル情報を覚えておく（上書き保存ボタン用）
    if (json.fileId) {
      currentBoardFileId = json.fileId;
    } else if (overwriteFileId) {
      currentBoardFileId = overwriteFileId;
    }

    if (json.fileName) {
      currentBoardFileName = json.fileName.replace(/\.json$/i, "");
    } else {
      currentBoardFileName = finalFileName;
    }

    lastUsedFolderPath = (folderPath || "").trim();


    // ★ 保存が成功したので「保存済み」としてフラグをリセット
    const savedCurrentRevision = typeof whiteboard.markSaved === "function"
      ? whiteboard.markSaved(saveRevision)
      : true;
    if (savedCurrentRevision !== false) {
      hasRestoredStudentDraft = false;
      await clearStudentDraft();
    }

    const savedMessage = json.message ||
      (mode === "update"
        ? "ホワイトボードを上書き保存しました。"
        : "ホワイトボードを保存しました。");
    if (!silent) {
      alert(savedCurrentRevision === false
        ? `${savedMessage}\n保存中に加えた変更はまだ未保存です。もう一度保存してください。`
        : savedMessage);
    }
    if (savedCurrentRevision !== false) closeBoardDialog();
    if (savedCurrentRevision !== false) void refreshPendingStudentAssignments();
    return savedCurrentRevision !== false;
  } catch (err) {
    console.error(err);
    if (!silent) alert("ホワイトボードの保存に失敗しました。");
    return false;
  } finally {
    boardFileSaveInFlight = false;
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
  if (
    whiteboard.isBoardDirty &&
    !window.confirm(
      "現在のホワイトボードには未保存の変更があります。\n" +
      "別のファイルを開くと、この変更は失われます。\n\n" +
      "保存せずにファイルを開きますか？"
    )
  ) {
    return;
  }

  try {
    const payload = {
      action: "loadBoard",
      role: "student",
      classCode: currentClassCode,
      nickname,
      folderPath: (folderPath || "").trim(),
      fileId
    };

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

      whiteboard.importBoardData(json.boardData);
      if (typeof whiteboard.markSaved === "function") {
        whiteboard.markSaved();
      }
      currentBoardFileId = json.fileId || fileId || null;
      currentBoardFileName = json.fileName ? json.fileName.replace(/\.json$/i, "") : "";
      lastUsedFolderPath = (folderPath || "").trim();
      hasRestoredStudentDraft = false;
      await clearStudentDraft();
      alert("Loaded board.");
      closeBoardDialog();
      return;
    }

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

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("student loadBoard JSON parse error:", e, text);
      alert("GAS からの応答の解析に失敗しました。");
      return;
    }

    if (!json.ok) {
      alert(json.message || "ホワイトボードの読み込みに失敗しました。");
      return;
    }

    if (!json.boardData) {
      alert("ボードデータが見つかりませんでした。");
      return;
    }

    whiteboard.importBoardData(json.boardData);

    // ★ 読み込み直後の状態を「保存済み」とみなす
    if (typeof whiteboard.markSaved === "function") {
      whiteboard.markSaved();
    }

    // ★ 今開いているファイル情報を更新
    currentBoardFileId = json.fileId || fileId || null;
    if (json.fileName) {
      currentBoardFileName = json.fileName.replace(/\.json$/i, "");
    } else {
      currentBoardFileName = "";
    }
    lastUsedFolderPath = (folderPath || "").trim();
    hasRestoredStudentDraft = false;
    await clearStudentDraft();

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

  // ★ 既存ファイルを選んでいれば boardDialogSelectedFileId が入っているので、それを渡す
  studentSaveBoardInternal(folderPath, fileName, boardDialogSelectedFileId);
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
if (studentOverwriteSaveBtn) {
  studentOverwriteSaveBtn.addEventListener("click", () => {
    console.log("[Student OverwriteSave] clicked", {
      currentBoardFileId,
      currentBoardFileName,
      lastUsedFolderPath
    });

    // まだ一度も保存していない / 読み込んでいない場合
    if (!currentBoardFileId || !currentBoardFileName) {
      alert(
        "まだ保存されていないボードです。「保存」からファイル名を付けて保存してください。"
      );
      openBoardDialog("save");
      return;
    }

    // 今開いているファイルに対して上書き保存
    studentSaveBoardInternal(
      lastUsedFolderPath || "",
      currentBoardFileName,
      currentBoardFileId
    );
  });
}

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
  const boardContainer = document.getElementById("boardContainer");
  const sidebar = document.getElementById("wbSidebar");
  const bottomTools = document.querySelector(".floating-bottom-right");
  const contextMenu = document.getElementById("contextMenu");
  const pageToolbar = document.querySelector(".page-toolbar");

  if (viewMode === "notebook") {
    if (boardContainer) boardContainer.classList.add("hidden");
    if (sidebar) sidebar.classList.add("hidden");
    if (bottomTools) bottomTools.classList.add("hidden");
    if (pageToolbar) pageToolbar.classList.add("hidden");
    if (contextMenu) contextMenu.classList.add("hidden");

    if (notebookLayoutEl) {
      notebookLayoutEl.classList.remove("hidden");
      notebookLayoutEl.style.display = "flex";
    }
  } else {
    if (boardContainer) boardContainer.classList.remove("hidden");
    if (sidebar) sidebar.classList.remove("hidden");
    if (bottomTools) bottomTools.classList.remove("hidden");
    if (pageToolbar) pageToolbar.classList.toggle("hidden", viewMode !== "whiteboard");
    // contextMenuはツール選択状態によるのでここでは操作しない

    if (notebookLayoutEl) {
      notebookLayoutEl.classList.add("hidden");
      notebookLayoutEl.style.display = "none";
    }
    // ホワイトボードレイアウトに戻ったときはキャンバスサイズを調整
    resizeCanvasToContainer();
  }

  updateNotebookCaptureLayout();

  // チャット入力の有効/無効（特定のモードでのみ有効）
  if (chatInput && chatSendBtn) {
    const canChat = CHAT_ENABLED_MODES.includes(viewMode);

    chatInput.disabled = !canChat;
    chatSendBtn.disabled = !canChat;
    chatTemplateButtons.forEach(btn => {
      btn.disabled = !canChat;
    });
    chatReactionButtons.forEach(btn => {
      btn.disabled = !canChat;
    });
    chatInput.placeholder = canChat
      ? "メッセージを入力"
      : "この画面ではチャットは使えません";
  }



  // ノート提出モード以外ではカメラ停止（通信量を抑える）
  if (viewMode !== "notebook") {
    stopNotebookCamera();
  }

  // ★ 現在の表示モードをサーバーに通知
  //   viewMode: "whiteboard" | "screen" | "notebook"
  if (currentClassCode && nickname) {
    socket.emit("student-mode-change", {
      classCode: currentClassCode,
      mode: viewMode
    });
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

// 🔴 通知ドット制御関数を追加
function showStudentChatNotifyDot() {
  if (!chatNotifyDot) return;
  // Tailwind の hidden を使っている場合に対応
  chatNotifyDot.classList.remove("hidden");
  chatNotifyDot.style.display = "block";
}

function hideStudentChatNotifyDot() {
  if (!chatNotifyDot) return;
  chatNotifyDot.classList.add("hidden");
  chatNotifyDot.style.display = "none";
}

function setChatPanelOpen(open) {
  chatPanelOpen = open;
  if (!chatPanel || !chatToggleBtn) return;

  if (open) setStudentAssignmentPanelOpen(false);

  chatPanel.classList.toggle("collapsed", !open);
  if (open) {
    // 開いたら未読リセット ＆ 通知ドット消す
    chatUnreadCount = 0;
    chatToggleBtn.classList.remove("has-unread");
    hideStudentChatNotifyDot();
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
    bubble.className = "chat-message-bubble" + (m.kind === "reaction" ? " chat-message-bubble--reaction" : "");
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
      chatPanel.scrollLeft = 0;
      if (chatInput) chatInput.focus({ preventScroll: true });
    }
  });
}

if (chatCloseBtn) {
  chatCloseBtn.addEventListener("click", () => {
    setChatPanelOpen(false);
  });
}

// 生徒 → 教員 チャット送信
function studentSendChat(templateText = "", templateKind = "", reaction = "") {
  const presetText = typeof templateText === "string" ? templateText : "";
  const normalizedTemplateKind = CHAT_TEMPLATE_KINDS.includes(templateKind)
    ? templateKind
    : "";
  const normalizedReaction = Object.prototype.hasOwnProperty.call(CHAT_REACTIONS, reaction)
    ? reaction
    : "";

  if (!currentClassCode || !nickname) {
    alert("クラスに参加してからチャットを送信してください。");
    return;
  }

  // ★条件: 特定の表示モードのときのみチャット可能
  if (!CHAT_ENABLED_MODES.includes(viewMode)) {
    alert("この画面ではチャットを送信できません。");
    return;
  }

  if (!chatInput && !presetText && !normalizedReaction) return;

  const text = normalizedReaction
    ? CHAT_REACTIONS[normalizedReaction]
    : (presetText || chatInput.value).trim();
  if (!text) return;

  socket.emit("student-chat-to-teacher", {
    classCode: currentClassCode,
    nickname,
    message: text,
    templateKind: normalizedTemplateKind,
    kind: normalizedReaction ? "reaction" : "text",
    reaction: normalizedReaction
  });

  chatMessages.push({
    from: "me",
    nickname: null,
    text,
    templateKind: normalizedTemplateKind,
    kind: normalizedReaction ? "reaction" : "text",
    reaction: normalizedReaction,
    timestamp: Date.now()
  });
  renderStudentChatMessages();

  if (!presetText && chatInput) {
    chatInput.value = "";
  }
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

chatTemplateButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    studentSendChat(
      btn.dataset.chatTemplate || btn.textContent || "",
      getChatTemplateKind(btn)
    );
  });
});

socket.on("realtime-disconnected", () => {
  if (statusLabel && currentClassCode) {
    statusLabel.textContent = `再接続中: ${currentClassCode} / ${nickname || ""}`;
  }
});

socket.on("realtime-reconnected", ({ classCode }) => {
  const restoredClassCode = classCode || currentClassCode;
  if (!restoredClassCode) return;
  if (!whiteboard?.isBoardDirty) {
    void loadActiveSharedBoard(restoredClassCode);
  }
  if (currentTeacherSocketId) {
    void sendBoardStateToTeacher(currentTeacherSocketId);
  }
  if (statusLabel) {
    statusLabel.textContent = sharedBoardSession
      ? `共同編集に再接続しました: ${restoredClassCode} / ${nickname || ""}`
      : `クラス: ${restoredClassCode} / ${nickname || ""}`;
  }
});

chatReactionButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    studentSendChat("", "", btn.dataset.chatReaction || "");
  });
});


/* ========================================
   サムネイル送信（ホワイトボード / 画面共有）
   ======================================== */

function sendWhiteboardThumbnail() {
  if (!currentClassCode || !nickname) return;

  // ノート提出モードでは、ホワイトボードではなく台形補正後の画像を送る。
  // 教師側のタイル表示はこの通常サムネイル経路を使うため、個別監視の開始を待たない。
  if (viewMode === "notebook") {
    if (!currentStream || !previewCanvas || !videoEl?.videoWidth || !videoEl?.videoHeight) {
      return;
    }
    drawCorrectedFrameToPreview();
    const dataUrl = encodeCanvasForRealtime(previewCanvas, {
      maxWidth: highQualityMode ? 960 : 720,
      quality: highQualityMode ? 0.72 : 0.52,
    });
    if (!dataUrl) return;
    return socket.emit("student-thumbnail", {
      classCode: currentClassCode,
      nickname,
      dataUrl,
      mode: "notebook",
      viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    });
  }

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

    const dataUrl = encodeCanvasForRealtime(off, { maxWidth: 320, quality: 0.55 });
    if (!dataUrl) return;

    return socket.emit("student-thumbnail", {
      classCode: currentClassCode,
      nickname,
      dataUrl,
      mode: viewMode,
      viewport: { scale: 1, offsetX: 0, offsetY: 0, width: vw, height: vh }
    });
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

  const dataUrl = encodeCanvasForRealtime(off, { maxWidth: 320, quality: 0.55 });
  if (!dataUrl) return;

  return socket.emit("student-thumbnail", {
    classCode: currentClassCode,
    nickname,
    dataUrl,
    mode: viewMode,
    viewport: {
      scale: whiteboard?.scale || 1,
      offsetX: whiteboard?.offsetX || 0,
      offsetY: whiteboard?.offsetY || 0,
      width: srcCanvasThumb.getBoundingClientRect().width || srcCanvasThumb.width,
      height: srcCanvasThumb.getBoundingClientRect().height || srcCanvasThumb.height
    }
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

    const dataUrl = encodeCanvasForRealtime(off, { maxWidth: 960, quality: 0.72 });
    if (!dataUrl) return;

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

  const dataUrl = encodeCanvasForRealtime(off, { maxWidth: 960, quality: 0.72 });
  if (!dataUrl) return;

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
      kind: payload.kind === "reaction" ? "reaction" : "text",
      reaction: payload.reaction || "",
      timestamp
  });

  if (chatPanelOpen) {
    renderStudentChatMessages();
  } else if (chatToggleBtn) {
    chatUnreadCount += 1;
    chatToggleBtn.classList.add("has-unread");
    // ★ ここを追加：通知ドット点灯
    showStudentChatNotifyDot();
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
const videoSection = document.querySelector(".video-section");
const notebookCameraStage = document.querySelector(".notebook-camera-stage");
const notebookCameraSurface = document.getElementById("notebookCameraSurface");
const cornerSelectionCanvas = document.getElementById("cornerSelectionCanvas");
const cornerSelectionCtx = cornerSelectionCanvas
  ? cornerSelectionCanvas.getContext("2d")
  : null;
const cornerInstruction = document.getElementById("cornerInstruction");
const resetPerspectiveBtn = document.getElementById("resetPerspectiveBtn");
const cameraExpandBtn = document.getElementById("cameraExpandBtn");
const cameraZoomOutBtn = document.getElementById("cameraZoomOutBtn");
const cameraZoomInBtn = document.getElementById("cameraZoomInBtn");
const cameraResetViewBtn = document.getElementById("cameraResetViewBtn");
const cameraZoomLabel = document.getElementById("cameraZoomLabel");
const previewCanvas = document.getElementById("previewCanvas");
const previewCtx = previewCanvas ? previewCanvas.getContext("2d") : null;
const feedbackSection = document.querySelector(".feedback-section");
const feedbackImage = document.getElementById("feedbackImage");
const feedbackViewport = document.getElementById("feedbackViewport");
const feedbackResetBtn = document.getElementById("feedbackResetBtn");
const feedbackExpandBtn = document.getElementById("feedbackExpandBtn");
const feedbackZoomOutBtn = document.getElementById("feedbackZoomOutBtn");
const feedbackZoomInBtn = document.getElementById("feedbackZoomInBtn");
const feedbackZoomLabel = document.getElementById("feedbackZoomLabel");

// ズーム・パン状態
let fbScale = 1;
let fbOffsetX = 0;
let fbOffsetY = 0;
let fbPointerId = null;
let fbLastX = 0;
let fbLastY = 0;

// 画像の元サイズを保持
let fbImgWidth = 0;
let fbImgHeight = 0;

function updateFeedbackTransform() {
  if (!feedbackImage) return;
  feedbackImage.style.transform =
    `translate(${fbOffsetX}px, ${fbOffsetY}px) scale(${fbScale})`;

  if (feedbackZoomLabel) {
    feedbackZoomLabel.textContent = `${Math.round(fbScale * 100)}%`;
  }
}

function setFeedbackZoom(nextScale, clientX, clientY) {
  if (!feedbackViewport || !feedbackImage?.src) return;
  const rect = feedbackViewport.getBoundingClientRect();
  const anchorX = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
  const anchorY = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
  const imageX = (anchorX - fbOffsetX) / fbScale;
  const imageY = (anchorY - fbOffsetY) / fbScale;
  const boundedScale = Math.max(0.05, Math.min(nextScale, 8));

  fbOffsetX = anchorX - imageX * boundedScale;
  fbOffsetY = anchorY - imageY * boundedScale;
  fbScale = boundedScale;
  updateFeedbackTransform();
}

// 画像をビューポート中央に、できるだけ大きくフィットさせる
function centerFeedbackImage() {
  if (!feedbackViewport || !fbImgWidth || !fbImgHeight) return;

  const vw = feedbackViewport.clientWidth;
  const vh = feedbackViewport.clientHeight;

  if (!vw || !vh) return;

  // ビューポートに収まる最大倍率
  const fitScale = Math.min(vw / fbImgWidth, vh / fbImgHeight);

  // ちょっとだけ大きめにしたいなら *1.1 など（ここでは等倍で）
  fbScale = Math.max(0.05, Math.min(fitScale, 8));

  // 中央に来るようにオフセットを計算
  fbOffsetX = (vw - fbImgWidth * fbScale) / 2;
  fbOffsetY = (vh - fbImgHeight * fbScale) / 2;

  updateFeedbackTransform();
}


// ★ 拡大表示中のみ高画質送信モード（教員側からの指示で切り替え）
let highQualityMode = false;

// 用紙サイズ定義（mm）。同じ用紙でも縦向き・横向きを別の選択肢として扱う。
const PAPER_SIZES = {
  "A4-portrait": { widthMm: 210, heightMm: 297 },
  "A4-landscape": { widthMm: 297, heightMm: 210 },
  "B5-portrait": { widthMm: 182, heightMm: 257 },
  "B5-landscape": { widthMm: 257, heightMm: 182 },
  "B4-portrait": { widthMm: 257, heightMm: 364 },
  "B4-landscape": { widthMm: 364, heightMm: 257 }
};
let currentPaperSize = paperSizeSelect?.value || "A4-portrait";

const srcCanvas = document.createElement("canvas"); // 元映像を読む隠しキャンバス
const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });

// 「四隅クリック」用の状態（キャンバス座標を 0〜1 に正規化して持つ）
// クリックルール：画面上で「左上 → 右上 → 右下 → 左下」の順にクリック
let selectedCorners = []; // [{nx, ny}, ...] nx,ny: 0〜1
let cornersLocked = false; // 4点揃ったら true
const CORNER_LABELS = ["左上", "右上", "右下", "左下"];

// 拡大した撮影映像のズーム・パン状態
let cameraScale = 1;
let cameraOffsetX = 0;
let cameraOffsetY = 0;
let cameraPointerId = null;
let cameraPointerStartX = 0;
let cameraPointerStartY = 0;
let cameraLastX = 0;
let cameraLastY = 0;
let cameraPointerMoved = false;

function clampCameraPan() {
  if (!notebookCameraStage || cameraScale <= 1) {
    cameraOffsetX = 0;
    cameraOffsetY = 0;
    return;
  }
  const minX = notebookCameraStage.clientWidth * (1 - cameraScale);
  const minY = notebookCameraStage.clientHeight * (1 - cameraScale);
  cameraOffsetX = Math.max(minX, Math.min(0, cameraOffsetX));
  cameraOffsetY = Math.max(minY, Math.min(0, cameraOffsetY));
}

function updateCameraTransform() {
  if (!notebookCameraSurface) return;
  clampCameraPan();
  notebookCameraSurface.style.transform =
    `translate(${cameraOffsetX}px, ${cameraOffsetY}px) scale(${cameraScale})`;
  if (cameraZoomLabel) {
    cameraZoomLabel.textContent = `${Math.round(cameraScale * 100)}%`;
  }
}

function setCameraZoom(nextScale, clientX, clientY) {
  if (!notebookCameraStage) return;
  const rect = notebookCameraStage.getBoundingClientRect();
  const anchorX = Number.isFinite(clientX) ? clientX - rect.left : rect.width / 2;
  const anchorY = Number.isFinite(clientY) ? clientY - rect.top : rect.height / 2;
  const surfaceX = (anchorX - cameraOffsetX) / cameraScale;
  const surfaceY = (anchorY - cameraOffsetY) / cameraScale;
  const boundedScale = Math.max(1, Math.min(nextScale, 6));

  cameraOffsetX = anchorX - surfaceX * boundedScale;
  cameraOffsetY = anchorY - surfaceY * boundedScale;
  cameraScale = boundedScale;
  updateCameraTransform();
}

function resetCameraView() {
  cameraScale = 1;
  cameraOffsetX = 0;
  cameraOffsetY = 0;
  updateCameraTransform();
}

function updateExpandedButton(button, expanded) {
  if (!button) return;
  button.setAttribute("aria-pressed", String(expanded));
  const label = button.querySelector(".notebook-expand-label");
  if (label) label.textContent = expanded ? "縮小する" : "拡大表示";
  const targetName = button === feedbackExpandBtn ? "フィードバック" : "撮影映像";
  const actionLabel = expanded ? `${targetName}を元の大きさに戻す` : `${targetName}を拡大表示`;
  button.setAttribute("aria-label", actionLabel);
  button.title = actionLabel;
}

function closeExpandedNotebookPanel() {
  const cameraWasExpanded = videoSection?.classList.contains("is-expanded");
  const feedbackWasExpanded = feedbackSection?.classList.contains("is-expanded");
  videoSection?.classList.remove("is-expanded");
  feedbackSection?.classList.remove("is-expanded");
  updateExpandedButton(cameraExpandBtn, false);
  updateExpandedButton(feedbackExpandBtn, false);
  document.body.classList.remove("notebook-panel-expanded");

  if (cameraWasExpanded) resetCameraView();
  requestAnimationFrame(() => {
    if (cameraWasExpanded) drawCornerSelectionOverlay();
    if (feedbackWasExpanded) centerFeedbackImage();
  });
}

function openExpandedNotebookPanel(section, button) {
  const alreadyExpanded = section?.classList.contains("is-expanded");
  closeExpandedNotebookPanel();
  if (!section || alreadyExpanded) return;

  section.classList.add("is-expanded");
  updateExpandedButton(button, true);
  document.body.classList.add("notebook-panel-expanded");
  requestAnimationFrame(() => {
    if (section === videoSection) {
      resetCameraView();
      drawCornerSelectionOverlay();
    } else if (section === feedbackSection) {
      centerFeedbackImage();
    }
  });
}

function getContainedVideoRect() {
  if (!notebookCameraStage || !videoEl?.videoWidth || !videoEl?.videoHeight) return null;
  const elementRect = notebookCameraStage.getBoundingClientRect();
  const stageWidth = notebookCameraStage.clientWidth;
  const stageHeight = notebookCameraStage.clientHeight;
  if (!stageWidth || !stageHeight) return null;
  const scale = Math.min(stageWidth / videoEl.videoWidth, stageHeight / videoEl.videoHeight);
  const width = videoEl.videoWidth * scale;
  const height = videoEl.videoHeight * scale;
  return {
    elementRect,
    x: (stageWidth - width) / 2,
    y: (stageHeight - height) / 2,
    width,
    height,
  };
}

function updateCornerSelectionUI() {
  if (cornerInstruction) {
    cornerInstruction.classList.toggle("is-complete", cornersLocked);
    cornerInstruction.textContent = cornersLocked
      ? "台形補正済み"
      : `${selectedCorners.length + 1}/4 ${CORNER_LABELS[selectedCorners.length]}をクリック`;
  }
  resetPerspectiveBtn?.classList.toggle("hidden", !cornersLocked);
  drawCornerSelectionOverlay();
}

function drawCornerSelectionOverlay() {
  if (!cornerSelectionCanvas || !cornerSelectionCtx || !notebookCameraStage) return;
  const width = notebookCameraStage.clientWidth;
  const height = notebookCameraStage.clientHeight;
  if (!width || !height) return;
  const dpr = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.round(width * dpr));
  const nextHeight = Math.max(1, Math.round(height * dpr));
  if (cornerSelectionCanvas.width !== nextWidth || cornerSelectionCanvas.height !== nextHeight) {
    cornerSelectionCanvas.width = nextWidth;
    cornerSelectionCanvas.height = nextHeight;
  }
  cornerSelectionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cornerSelectionCtx.clearRect(0, 0, width, height);

  const videoRect = getContainedVideoRect();
  if (!videoRect || selectedCorners.length === 0) return;
  const points = selectedCorners.map((point) => ({
    x: videoRect.x + point.nx * videoRect.width,
    y: videoRect.y + point.ny * videoRect.height,
  }));

  cornerSelectionCtx.save();
  cornerSelectionCtx.lineWidth = 3;
  cornerSelectionCtx.strokeStyle = cornersLocked ? "#22c55e" : "#f59e0b";
  cornerSelectionCtx.font = "800 14px sans-serif";
  cornerSelectionCtx.beginPath();
  cornerSelectionCtx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => cornerSelectionCtx.lineTo(point.x, point.y));
  if (cornersLocked) cornerSelectionCtx.closePath();
  cornerSelectionCtx.stroke();

  points.forEach((point, index) => {
    cornerSelectionCtx.beginPath();
    cornerSelectionCtx.fillStyle = cornersLocked ? "#22c55e" : "#f59e0b";
    cornerSelectionCtx.arc(point.x, point.y, 11, 0, Math.PI * 2);
    cornerSelectionCtx.fill();
    cornerSelectionCtx.fillStyle = "#ffffff";
    cornerSelectionCtx.textAlign = "center";
    cornerSelectionCtx.textBaseline = "middle";
    cornerSelectionCtx.fillText(String(index + 1), point.x, point.y + 0.5);
  });
  cornerSelectionCtx.restore();
}

function resetPerspectiveCorrection() {
  selectedCorners = [];
  cornersLocked = false;
  updateCornerSelectionUI();
  drawCorrectedFrameToPreview();
}

// ★ 教員側からの「高画質ON/OFF」指示を受信
socket.on("setHighQualityMode", ({ enabled }) => {
  highQualityMode = !!enabled;
  console.log("High quality mode:", highQualityMode);
  // 解像度を切り替え
  setupPreviewCanvas();
  // 教員の操作に応じた更新なので、次の5秒周期を待たずに送る。
  if (viewMode === "notebook" && currentStream) sendWhiteboardThumbnail();
});

// 用紙サイズ・向きの変更を送信プレビューの縦横比へ反映する。
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
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
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

    // 他の生徒機能と同じ参加状態を使う。ノート提出専用の複製状態は持たない。
    if (!currentClassCode || !nickname) {
      alert("クラスに参加してからノート提出モードを開始してください。");
      return;
    }

    // 既存ストリーム停止
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }

    const deviceId = cameraSelect ? cameraSelect.value : undefined;

    try {
      const constraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "environment"
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStream = stream;
      updateNotebookCaptureLayout();

      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.onloadedmetadata = () => {
          videoEl.play();
          console.log("Notebook camera started:", {
            width: videoEl.videoWidth,
            height: videoEl.videoHeight
          });
          setupPreviewCanvas();
          updateCornerSelectionUI();
          // カメラ起動直後は、タイル更新周期を待たずに1回送る。
          sendWhiteboardThumbnail();
        };
      }
    } catch (e) {
      console.error(e);
      alert("カメラの起動に失敗しました");
    }
  });
}

// レイアウト関連
function getCurrentPaperAspect() {
  const s = PAPER_SIZES[currentPaperSize] || PAPER_SIZES["A4-portrait"];
  return s.heightMm / s.widthMm;
}

function setupPreviewCanvas() {
  if (!previewCanvas || !previewCtx) return;

  // 高画質モードのときだけ、内部解像度を 2倍にする
  const baseWidth = highQualityMode ? 1280 : 640;

  const aspect = getCurrentPaperAspect();
  const targetWidth = baseWidth;
  const targetHeight = Math.round(targetWidth * aspect);

  previewCanvas.width = targetWidth;
  previewCanvas.height = targetHeight;

  // 角を変えたときは再描画
  try {
    drawCorrectedFrameToPreview();
  } catch (e) {
    console.error("drawCorrectedFrameToPreview error in setupPreviewCanvas", e);
  }
}

// ====== 四隅クリック関連 ======

// 撮影中の映像上で、左上 → 右上 → 右下 → 左下の順に四隅を指定する。
if (cornerSelectionCanvas) {
  cornerSelectionCanvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    cameraPointerId = event.pointerId;
    cameraPointerStartX = event.clientX;
    cameraPointerStartY = event.clientY;
    cameraLastX = event.clientX;
    cameraLastY = event.clientY;
    cameraPointerMoved = false;
    cornerSelectionCanvas.setPointerCapture?.(event.pointerId);
  });

  cornerSelectionCanvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== cameraPointerId) return;
    const totalDx = event.clientX - cameraPointerStartX;
    const totalDy = event.clientY - cameraPointerStartY;
    if (Math.hypot(totalDx, totalDy) > 6) cameraPointerMoved = true;

    if (cameraPointerMoved && cameraScale > 1) {
      cameraOffsetX += event.clientX - cameraLastX;
      cameraOffsetY += event.clientY - cameraLastY;
      updateCameraTransform();
      cornerSelectionCanvas.classList.add("is-panning");
    }
    cameraLastX = event.clientX;
    cameraLastY = event.clientY;
  });

  const finishCameraPointer = (event, cancelled = false) => {
    if (event.pointerId !== cameraPointerId) return;
    cornerSelectionCanvas.releasePointerCapture?.(event.pointerId);
    cornerSelectionCanvas.classList.remove("is-panning");
    cameraPointerId = null;
    if (cancelled || cameraPointerMoved || cornersLocked) return;

    const videoRect = getContainedVideoRect();
    if (!videoRect) return;
    const surfaceX =
      (event.clientX - videoRect.elementRect.left - cameraOffsetX) / cameraScale;
    const surfaceY =
      (event.clientY - videoRect.elementRect.top - cameraOffsetY) / cameraScale;
    const x = surfaceX - videoRect.x;
    const y = surfaceY - videoRect.y;
    if (x < 0 || y < 0 || x > videoRect.width || y > videoRect.height) return;

    selectedCorners.push({
      nx: x / videoRect.width,
      ny: y / videoRect.height,
    });
    if (selectedCorners.length === 4) cornersLocked = true;
    updateCornerSelectionUI();
    drawCorrectedFrameToPreview();
    if (cornersLocked) {
      // 台形補正が確定した画像を、次の5秒周期を待たずに送る。
      sendWhiteboardThumbnail();
    }
  };

  cornerSelectionCanvas.addEventListener("pointerup", (event) => {
    finishCameraPointer(event);
  });
  cornerSelectionCanvas.addEventListener("pointercancel", (event) => {
    finishCameraPointer(event, true);
  });
  cornerSelectionCanvas.addEventListener("wheel", (event) => {
    if (!videoSection?.classList.contains("is-expanded")) return;
    event.preventDefault();
    setCameraZoom(cameraScale * (event.deltaY < 0 ? 1.15 : 0.87), event.clientX, event.clientY);
  }, { passive: false });
}

resetPerspectiveBtn?.addEventListener("click", resetPerspectiveCorrection);
cameraZoomOutBtn?.addEventListener("click", () => setCameraZoom(cameraScale / 1.25));
cameraZoomInBtn?.addEventListener("click", () => setCameraZoom(cameraScale * 1.25));
cameraResetViewBtn?.addEventListener("click", resetCameraView);
cameraExpandBtn?.addEventListener("click", () => {
  openExpandedNotebookPanel(videoSection, cameraExpandBtn);
});
feedbackExpandBtn?.addEventListener("click", () => {
  openExpandedNotebookPanel(feedbackSection, feedbackExpandBtn);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("notebook-panel-expanded")) {
    closeExpandedNotebookPanel();
  }
});

if (notebookCameraStage && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    updateCameraTransform();
    drawCornerSelectionOverlay();
  }).observe(notebookCameraStage);
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

function getSquareToQuadrilateralTransform(points) {
  const [p0, p1, p2, p3] = points;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;

  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-7 || Math.abs(sy) > 1e-7) {
    if (Math.abs(denominator) < 1e-7) return null;
    g = (sx * dy2 - dx2 * sy) / denominator;
    h = (dx1 * sy - sx * dy1) / denominator;
  }

  return {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  };
}

function renderPerspectiveCorrection(sourceCanvas, targetCanvas, sourcePoints) {
  const transform = getSquareToQuadrilateralTransform(sourcePoints);
  const targetCtx = targetCanvas.getContext("2d");
  const sourceContext = sourceCanvas.getContext("2d");
  if (!transform || !targetCtx || !sourceContext) return false;

  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const targetWidth = targetCanvas.width;
  const targetHeight = targetCanvas.height;
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) return false;

  const sourceImage = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);
  const targetImage = targetCtx.createImageData(targetWidth, targetHeight);
  const sourceData = sourceImage.data;
  const targetData = targetImage.data;
  const { a, b, c, d, e, f, g, h } = transform;

  for (let y = 0; y < targetHeight; y += 1) {
    const v = targetHeight > 1 ? y / (targetHeight - 1) : 0;
    for (let x = 0; x < targetWidth; x += 1) {
      const u = targetWidth > 1 ? x / (targetWidth - 1) : 0;
      const divisor = g * u + h * v + 1;
      if (Math.abs(divisor) < 1e-7) continue;
      const sourceX = Math.min(sourceWidth - 1, Math.max(0, (a * u + b * v + c) / divisor));
      const sourceY = Math.min(sourceHeight - 1, Math.max(0, (d * u + e * v + f) / divisor));

      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      const tx = sourceX - x0;
      const ty = sourceY - y0;
      const topLeft = (y0 * sourceWidth + x0) * 4;
      const topRight = (y0 * sourceWidth + x1) * 4;
      const bottomLeft = (y1 * sourceWidth + x0) * 4;
      const bottomRight = (y1 * sourceWidth + x1) * 4;
      const targetIndex = (y * targetWidth + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const top = sourceData[topLeft + channel] * (1 - tx) +
          sourceData[topRight + channel] * tx;
        const bottom = sourceData[bottomLeft + channel] * (1 - tx) +
          sourceData[bottomRight + channel] * tx;
        targetData[targetIndex + channel] = top * (1 - ty) + bottom * ty;
      }
    }
  }

  targetCtx.putImageData(targetImage, 0, 0);
  return true;
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

  // 元映像を隠しキャンバスに描画
  srcCanvas.width = vw;
  srcCanvas.height = vh;
  srcCtx.drawImage(videoEl, 0, 0, vw, vh);

  try {
    if (selectedCorners.length === 4) {
      const orderedNorm = getOrderedCornersFromClicks();
      if (orderedNorm) {
        const sourcePoints = orderedNorm.map((point) => ({
          x: point.nx * (vw - 1),
          y: point.ny * (vh - 1),
        }));
        if (!renderPerspectiveCorrection(srcCanvas, previewCanvas, sourcePoints)) {
          previewCtx.drawImage(videoEl, 0, 0, dw, dh);
        }
      } else {
        previewCtx.drawImage(videoEl, 0, 0, dw, dh);
      }
    } else {
      previewCtx.drawImage(videoEl, 0, 0, dw, dh);
    }
  } catch (e) {
    console.error("Perspective correction failed", e);
    previewCtx.drawImage(videoEl, 0, 0, dw, dh);
  }
}

// 教員からのフィードバック画像受信（パン＆ズーム付きビューアに表示）
// 先生 → 生徒へ「添削済み画像」を受信（中央・自動フィット拡大）
// 教員からのフィードバック画像受信（中央フィット＋パン＆ズーム）
socket.on("teacherSharedImage", ({ imageData }) => {
  if (!feedbackImage || !imageData) return;

  const img = new Image();
  img.onload = () => {
    fbImgWidth = img.width;
    fbImgHeight = img.height;

    // 元サイズを明示しておく（transform はこれを基準にスケール）
    feedbackImage.style.width = `${fbImgWidth}px`;
    feedbackImage.style.height = `${fbImgHeight}px`;

    feedbackImage.src = imageData;
    feedbackViewport?.classList.add("has-feedback");

    // 中央フィット
    centerFeedbackImage();
  };
  img.src = imageData;
});



// ===== フィードバックビューアの操作 =====
if (feedbackViewport) {
  // ホイールでズーム
  feedbackViewport.addEventListener("wheel", (e) => {
    if (!feedbackImage || !feedbackImage.src) return;

    e.preventDefault();
    setFeedbackZoom(fbScale * (e.deltaY < 0 ? 1.15 : 0.87), e.clientX, e.clientY);
  }, { passive: false });

  // ドラッグでパン
  feedbackViewport.addEventListener("pointerdown", (e) => {
    if (!feedbackImage || !feedbackImage.src) return;
    if (e.button !== undefined && e.button !== 0) return;

    fbPointerId = e.pointerId;
    fbLastX = e.clientX;
    fbLastY = e.clientY;
    feedbackViewport.setPointerCapture?.(e.pointerId);
    feedbackViewport.classList.add("is-panning");
  });

  feedbackViewport.addEventListener("pointermove", (e) => {
    if (e.pointerId !== fbPointerId) return;

    const dx = e.clientX - fbLastX;
    const dy = e.clientY - fbLastY;
    fbLastX = e.clientX;
    fbLastY = e.clientY;

    fbOffsetX += dx;
    fbOffsetY += dy;
    updateFeedbackTransform();
  });

  const finishFeedbackPointer = (e) => {
    if (e.pointerId !== fbPointerId) return;
    feedbackViewport.releasePointerCapture?.(e.pointerId);
    feedbackViewport.classList.remove("is-panning");
    fbPointerId = null;
  };
  feedbackViewport.addEventListener("pointerup", finishFeedbackPointer);
  feedbackViewport.addEventListener("pointercancel", finishFeedbackPointer);
}

feedbackZoomOutBtn?.addEventListener("click", () => setFeedbackZoom(fbScale / 1.25));
feedbackZoomInBtn?.addEventListener("click", () => setFeedbackZoom(fbScale * 1.25));
feedbackResetBtn?.addEventListener("click", centerFeedbackImage);



// ノート提出用カメラ停止
function stopNotebookCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
  updateNotebookCaptureLayout();
}

function updateNotebookCaptureLayout() {
  if (!notebookLayoutEl) return;
  const cameraActive = !!currentStream;
  notebookLayoutEl.classList.toggle("camera-active", cameraActive);
  // updateModeUI はノート提出用の定数初期化より先に呼ばれるため、ここではDOMから取得する。
  const captureButton = document.getElementById("startCameraBtn");
  if (captureButton) {
    const label = captureButton.querySelector("span");
    if (label) label.textContent = cameraActive ? "カメラを再起動" : "撮影を開始";
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
    } catch (e) {
      console.warn("listCameras failed:", e);
    }
  }
  setupPreviewCanvas();
  updateCornerSelectionUI();
});

// beforeunload はファイル末尾付近で
// stopNotebookCamera() が呼ばれているので、そちらに任せる


/* ========================================
   タイル用キャプチャループ管理（ホワイトボード / 画面共有 / ノート提出）
   ======================================== */

function restartCaptureLoop() {
  captureLoopActive = true;
  const generation = ++captureLoopGeneration;
  if (captureTimerId) {
    clearTimeout(captureTimerId);
    captureTimerId = null;
  }
  const runCapture = async () => {
    captureTimerId = null;
    if (!captureLoopActive || generation !== captureLoopGeneration) return;
    try {
      await Promise.resolve(sendWhiteboardThumbnail());
    } catch (error) {
      console.warn("Thumbnail send failed; the next scheduled capture will retry.", error);
    }
    if (!captureLoopActive || generation !== captureLoopGeneration) return;
    captureTimerId = setTimeout(
      runCapture,
      jitteredInterval(CAPTURE_INTERVAL_MS, 750)
    );
  };
  captureTimerId = setTimeout(
    runCapture,
    jitteredInterval(CAPTURE_INTERVAL_MS, 750)
  );
}

function scheduleInitialThumbnail() {
  if (initialThumbnailTimerId) {
    clearTimeout(initialThumbnailTimerId);
  }
  const delayMs = FREE_TIER_MODE
    ? 1000 + Math.floor(Math.random() * 3000)
    : 0;
  initialThumbnailTimerId = setTimeout(() => {
    initialThumbnailTimerId = null;
    sendWhiteboardThumbnail();
  }, delayMs);
}

// 教員が「生徒画面確認モード」に入った
socket.on("student-view-start", () => {
  if (!currentClassCode || !nickname) return;
  restartCaptureLoop();
  scheduleInitialThumbnail();
});

// 教員が生徒画面から離れた
socket.on("student-view-stop", () => {
  captureLoopActive = false;
  captureLoopGeneration += 1;
  if (captureTimerId) {
    clearTimeout(captureTimerId);
    captureTimerId = null;
  }
  if (initialThumbnailTimerId) {
    clearTimeout(initialThumbnailTimerId);
    initialThumbnailTimerId = null;
  }
});


window.addEventListener("beforeunload", () => {
  void persistStudentDraftNow();
  captureLoopActive = false;
  captureLoopGeneration += 1;
  if (captureTimerId) {
    clearTimeout(captureTimerId);
  }
  if (initialThumbnailTimerId) {
    clearTimeout(initialThumbnailTimerId);
  }
  stopScreenCapture();
  stopNotebookCamera();
});

window.addEventListener("pagehide", () => {
  // 確認で離脱を取り消した場合には発火せず、実際に更新・閉じるときだけ
  // Presence から明示的に抜ける。通信断はこの経路に入らず再接続を待てる。
  void persistStudentDraftNow();
  void socket.emit("leave-class");
});
// ========= 生徒画面モニタリング（高機能版）関連 =========

let currentTeacherSocketId = null;
let hasSentInitialBoardData = false;
let forceNextBoardSync = false;
let boardSnapshotSaveInFlight = null;
let lastAppliedTeacherSyncToken = null;
let boardSyncRevision = 0;
let currentMonitorRequestId = null;

async function createBoardSyncPayload() {
  if (!whiteboard || !currentClassCode || !nickname) return null;
  const boardData = whiteboard.exportBoardData();
  const teacherSyncToken = lastAppliedTeacherSyncToken;
  const syncRevision = boardSyncRevision;
  const snapshotVersion = crypto.randomUUID();
  if (!boardApi.enabled) {
    return {
      boardData,
      boardSnapshotPath: null,
      teacherSyncToken,
      syncRevision,
      snapshotVersion,
    };
  }

  if (boardSnapshotSaveInFlight) return boardSnapshotSaveInFlight;

  boardSnapshotSaveInFlight = (async () => {
    try {
      const result = await boardApi.saveRealtimeBoardSnapshot({
        classCode: currentClassCode,
        nickname,
        boardData,
      });
      whiteboard.applyAssetReferences?.(result.assetReferences);
      return {
        boardData: null,
        boardSnapshotPath: result.snapshotPath,
        teacherSyncToken,
        syncRevision,
        snapshotVersion,
      };
    } catch (error) {
      console.error("Failed to store realtime board snapshot:", error);
      return null;
    } finally {
      boardSnapshotSaveInFlight = null;
    }
  })();
  return boardSnapshotSaveInFlight;
}

async function sendBoardStateToTeacher(teacherSocketId, monitorRequestId = currentMonitorRequestId) {
  const syncPayload = await createBoardSyncPayload();
  if (!syncPayload || !teacherSocketId) return false;
  if (monitorRequestId !== currentMonitorRequestId) return false;
  const sent = await socket.emit("student-board-state", {
    targetTeacherSocketId: teacherSocketId,
    monitorRequestId,
    ...syncPayload,
    boardRevision: syncPayload.syncRevision,
  });
  return sent !== false;
}


// ★ 教員が共同編集セッションに参加
socket.on("teacher-joined-session", ({ teacherSocketId }) => {
  if (!whiteboard) return;
  void sendBoardStateToTeacher(teacherSocketId);
});

// ★ 教員からのホワイトボード操作受信
socket.on("teacher-whiteboard-action", ({ action, teacherSocketId, monitorRequestId }) => {
  if (!whiteboard) return;
  if (monitorRequestId && monitorRequestId !== currentMonitorRequestId) return;
  whiteboard.applyAction(action);
  scheduleStudentDraftSave();
  boardSyncRevision += 1;
  if (action?.teacherSyncToken) {
    lastAppliedTeacherSyncToken = action.teacherSyncToken;
    void socket.emit("student-teacher-action-ack", {
      targetTeacherSocketId: teacherSocketId || currentTeacherSocketId,
      teacherSyncToken: action.teacherSyncToken,
      boardRevision: boardSyncRevision,
      monitorRequestId: currentMonitorRequestId,
    });
  }
  // 教員の操作は受信直後に適用・ACKする。定期的な全体再送は行わない。
});

// ★ ホワイトボード操作の送信フック設定
if (whiteboard) {
  whiteboard.onDirtyChange = (isDirty) => {
    if (isDirty) scheduleStudentDraftSave();
  };
  whiteboard.onAction = (action) => {
    scheduleStudentDraftSave();
    boardSyncRevision += 1;

    if (sharedBoardSession && !applyingSharedBoardRemote) {
      if (action?.type === "refresh") {
        void publishSharedBoardSnapshotFromStudent("refresh");
      } else {
        socket.emit("shared-board-action", {
          classCode: currentClassCode,
          sharedBoardId: sharedBoardSession.id,
          action
        });
      }
    }

    // 教員が監視中の場合のみ送信
    if (currentTeacherSocketId) {
      // ★ refresh アクション（PDF読込や全消去など）の場合は、
      //    差分ではなく次回の sendScreenUpdate で全データを送るようにフラグを立てる
      if (action.type === "refresh") {
        forceNextBoardSync = true;
        return;
      }

      socket.emit("student-whiteboard-action", {
        targetTeacherSocketId: currentTeacherSocketId,
        action,
        boardRevision: boardSyncRevision,
        monitorRequestId: currentMonitorRequestId,
      });
    }
  };
}

// ★ モニタリング開始通知（既存の処理に teacherSocketId 保存を追加）
socket.on("shared-board-snapshot", ({ sharedBoardId, title, boardData, active }) => {
  if (!sharedBoardId) return;
  if (active === false) {
    if (sharedBoardSession?.id === sharedBoardId) {
      sharedBoardSession = null;
      if (statusLabel && currentClassCode && nickname) {
        statusLabel.textContent = `Class: ${currentClassCode} / ${nickname}`;
      }
    }
    return;
  }

  sharedBoardSession = {
    id: sharedBoardId,
    title: title || "Shared board",
  };
  if (!boardData && currentClassCode) {
    void loadActiveSharedBoard(currentClassCode);
  }
  if (whiteboard && boardData && typeof whiteboard.importBoardData === "function") {
    applyingSharedBoardRemote = true;
    try {
      whiteboard.importBoardData(boardData);
    } finally {
      applyingSharedBoardRemote = false;
    }
  }
  if (statusLabel && currentClassCode) {
    statusLabel.textContent = `共同編集に参加中: ${currentClassCode} / ${nickname || ""}`;
  }
});

socket.on("shared-board-action", ({ sharedBoardId, action }) => {
  if (!sharedBoardSession || sharedBoardSession.id !== sharedBoardId) return;
  if (!whiteboard || !action || typeof whiteboard.applyAction !== "function") return;
  applyingSharedBoardRemote = true;
  try {
    whiteboard.applyAction(action);
    scheduleStudentDraftSave();
  } finally {
    applyingSharedBoardRemote = false;
  }
});

socket.on("start-monitoring", ({ teacherSocketId, monitorRequestId }) => {
  console.log("Monitoring started by", teacherSocketId);
  currentTeacherSocketId = teacherSocketId;
  currentMonitorRequestId = monitorRequestId || null;
  hasSentInitialBoardData = false; // モニタリング開始時にリセット
  forceNextBoardSync = false;

  // ★ 共同編集開始時に、現在のボード状態を教員に送る

  if (monitorIntervalId) clearTimeout(monitorIntervalId);
  const generation = ++monitorLoopGeneration;
  const expectedMonitorRequestId = monitorRequestId || null;
  const runMonitorUpdate = async () => {
    monitorIntervalId = null;
    if (
      generation !== monitorLoopGeneration ||
      teacherSocketId !== currentTeacherSocketId ||
      currentMonitorRequestId !== expectedMonitorRequestId
    ) {
      return;
    }
    try {
      await sendScreenUpdate(teacherSocketId, currentMonitorRequestId);
    } catch (error) {
      console.warn("Monitor update failed; the next scheduled update will retry.", error);
    }
    if (generation !== monitorLoopGeneration) return;
    monitorIntervalId = setTimeout(
      runMonitorUpdate,
      jitteredInterval(MONITORING_INTERVAL_MS, 500)
    );
  };
  void runMonitorUpdate();
});

// ★ モニタリング終了通知
socket.on("stop-monitoring", ({ monitorRequestId } = {}) => {
  if (monitorRequestId && monitorRequestId !== currentMonitorRequestId) return;
  console.log("Monitoring stopped");
  monitorLoopGeneration += 1;
  currentTeacherSocketId = null;
  currentMonitorRequestId = null;
  if (monitorIntervalId) {
    clearTimeout(monitorIntervalId);
    monitorIntervalId = null;
  }
});

async function sendScreenUpdate(teacherSocketId, monitorRequestId = currentMonitorRequestId) {
  if (!currentClassCode) return;

  const monitoringMode = viewMode;
  let dataUrl;
  let viewport;
  let boardData = null; // ★ ホワイトボードの実データ（必要に応じて）
  let boardSnapshotPath = null;
  let teacherSyncToken = null;
  let syncRevision = null;
  let snapshotVersion = null;
  let shouldCommitBoardSync = false;

  // ★ モードは viewMode で分岐する
  if (monitoringMode === "screen") {
    // === 画面共有モード：video 要素からキャプチャ ===
    if (!screenStream || !screenVideo || screenVideo.readyState < 2) return;

    const vw = screenVideo.videoWidth;
    const vh = screenVideo.videoHeight;
    if (!vw || !vh) return;

    const off = document.createElement("canvas");
    // パフォーマンスのためサイズ制限
    const maxWidth = 1280;
    const scale = Math.min(1, maxWidth / vw);
    off.width = vw * scale;
    off.height = vh * scale;

    const ctx = off.getContext("2d");
    ctx.drawImage(screenVideo, 0, 0, off.width, off.height);
    dataUrl = encodeCanvasForRealtime(off, { maxWidth: 720, quality: 0.58 });

    // 画面共有時はビューポートリセット（全体表示）
    viewport = { scale: 1, offsetX: 0, offsetY: 0 };

  } else if (monitoringMode === "notebook") {
    // === ノート提出モード：台形補正後のノート画像を送る ===
    if (!previewCanvas || !previewCanvas.width || !previewCanvas.height) return;

    // 最新フレームを previewCanvas に描画（カメラが止まっている場合は何もしない）
    try {
      drawCorrectedFrameToPreview();
    } catch (e) {
      console.error("drawCorrectedFrameToPreview error in sendScreenUpdate", e);
    }

    // 個別モーダル用の中画質JPEGとして送信する。
    dataUrl = encodeCanvasForRealtime(previewCanvas, { maxWidth: 720, quality: 0.6 });

    // ノート画像なのでビューポートは固定
    viewport = { scale: 1, offsetX: 0, offsetY: 0 };

  } else {
    // === ホワイトボードモード（viewMode === "whiteboard" 他） ===
    if (!whiteboard) return;
    // The teacher modal renders this mode from structured snapshots and
    // realtime actions. A compressed capture would be a blurry second copy.
    dataUrl = null;

    viewport = {
      scale: whiteboard.scale,
      offsetX: whiteboard.offsetX,
      offsetY: whiteboard.offsetY,
      width: studentCanvas.getBoundingClientRect().width || studentCanvas.width,
      height: studentCanvas.getBoundingClientRect().height || studentCanvas.height
    };

    // ★ ホワイトボードの実データ（ストローク＋オブジェクト）を取得
    // 教師の書き込みも同じボードの内容として同期する。
    // ★ 変更：初回送信済み かつ 強制同期フラグが立っていない場合は、boardData を送らない（nullにする）
    const shouldSendBoardData = !hasSentInitialBoardData || forceNextBoardSync;

    if (shouldSendBoardData) {
      const syncPayload = await createBoardSyncPayload();
      if (syncPayload) {
        boardData = syncPayload.boardData;
        boardSnapshotPath = syncPayload.boardSnapshotPath;
        teacherSyncToken = syncPayload.teacherSyncToken;
        syncRevision = syncPayload.syncRevision;
        snapshotVersion = syncPayload.snapshotVersion;
        shouldCommitBoardSync = true;
      }
    }
  }

  if (!dataUrl && monitoringMode !== "whiteboard") return;
  if (
    currentTeacherSocketId !== teacherSocketId ||
    monitorRequestId !== currentMonitorRequestId
  ) return;

  const sent = await socket.emit("student-screen-update", {
    classCode: currentClassCode,
    teacherSocketId,
    dataUrl,
    viewport,
    // ★ 教員側には viewMode をモードとして渡す
    //   "whiteboard" | "screen" | "notebook"
    mode: monitoringMode,
    boardData, // ★ ホワイトボードモードのときのみ有効（差分更新時は null）
    boardSnapshotPath,
    teacherSyncToken,
    snapshotVersion,
    boardRevision: syncRevision,
    monitorRequestId,
    isSync: !!(boardData || boardSnapshotPath)
  });
  if (sent !== false && shouldCommitBoardSync) {
    hasSentInitialBoardData = true;
    if (syncRevision === boardSyncRevision) {
      forceNextBoardSync = false;
    }
  }
}

// すべての Realtime ハンドラと下書き保存フックを登録してから、保存済みの
// Supabase セッションを使った自動再参加・下書き復元を開始する。
void restoreStudentSessionOnLoad();

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const commonJsFiles = [
  "server.js",
  "public/js/app-config.js",
  "public/js/legacy-socket-loader.js",
  "public/js/local-config-loader.js",
];
const moduleFiles = [
  "public/js/board-ui.js",
  "public/js/monitor-sync.js",
  "public/js/realtime-join-coordinator.js",
  "public/js/realtime-send-queue.js",
  "public/js/stamps.js",
  "public/js/student.js",
  "public/js/supabase-api.js",
  "public/js/teacher.js",
  "public/js/teacher-class-storage.js",
  "public/js/teacher-login.js",
  "public/js/teacher-signup.js",
  "public/js/ui-icons.js",
  "public/js/whiteboard.js",
];

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    stdio: "inherit",
  });
  return result.status === 0;
}

let ok = true;

for (const filePath of commonJsFiles) {
  ok = runNodeCheck(filePath) && ok;
}

const tempDir = mkdtempSync(join(tmpdir(), "class-whiteboard-check-"));
try {
  let realtimeJoinCoordinatorTempPath = "";
  let realtimeQueueTempPath = "";
  let monitorSyncTempPath = "";
  for (const filePath of moduleFiles) {
    const tempPath = join(tempDir, `${basename(filePath)}.mjs`);
    copyFileSync(filePath, tempPath);
    ok = runNodeCheck(tempPath) && ok;
    if (filePath.endsWith("realtime-join-coordinator.js")) realtimeJoinCoordinatorTempPath = tempPath;
    if (filePath.endsWith("realtime-send-queue.js")) realtimeQueueTempPath = tempPath;
    if (filePath.endsWith("monitor-sync.js")) monitorSyncTempPath = tempPath;
  }

  if (!realtimeJoinCoordinatorTempPath) {
    console.error("Realtime join coordinator module was not checked.");
    ok = false;
  } else {
    const { createRealtimeJoinCoordinator } = await import(
      pathToFileURL(realtimeJoinCoordinatorTempPath).href
    );
    const starts = [];
    const releases = [];
    const startWaiters = new Map();
    let activeJoins = 0;
    let maxActiveJoins = 0;
    const coordinateJoin = createRealtimeJoinCoordinator(async (label) => {
      starts.push(label);
      startWaiters.get(label)?.();
      activeJoins += 1;
      maxActiveJoins = Math.max(maxActiveJoins, activeJoins);
      await new Promise((resolve) => releases.push(resolve));
      activeJoins -= 1;
      return label;
    });

    const firstStarted = new Promise((resolve) => startWaiters.set("first", resolve));
    const firstJoin = coordinateJoin("student:AAAA:s001", "first");
    const duplicateJoin = coordinateJoin("student:AAAA:s001", "duplicate");
    await firstStarted;
    if (starts.length !== 1 || starts[0] !== "first") {
      console.error(`Duplicate Realtime joins were not coalesced: ${JSON.stringify(starts)}`);
      ok = false;
    }
    releases.shift()?.();
    const duplicateResults = await Promise.all([firstJoin, duplicateJoin]);
    if (duplicateResults.some((result) => result !== "first")) {
      console.error(`Duplicate Realtime join result mismatch: ${JSON.stringify(duplicateResults)}`);
      ok = false;
    }

    const nextClassStarted = new Promise((resolve) => startWaiters.set("next-class", resolve));
    const followingClassStarted = new Promise((resolve) => startWaiters.set("following-class", resolve));
    const nextClassJoin = coordinateJoin("student:BBBB:s001", "next-class");
    const followingClassJoin = coordinateJoin("student:CCCC:s001", "following-class");
    await nextClassStarted;
    if (starts.at(-1) !== "next-class") {
      console.error(`First serialized Realtime join did not start: ${JSON.stringify(starts)}`);
      ok = false;
    }
    releases.shift()?.();
    await followingClassStarted;
    if (starts.at(-1) !== "following-class" || maxActiveJoins !== 1) {
      console.error(
        `Realtime joins overlapped instead of serializing: starts=${JSON.stringify(starts)}, max=${maxActiveJoins}`
      );
      ok = false;
    }
    releases.shift()?.();
    await Promise.all([nextClassJoin, followingClassJoin]);
  }

  if (!realtimeQueueTempPath) {
    console.error("Realtime send queue module was not checked.");
    ok = false;
  } else {
    const { createOrderedRetryQueue } = await import(pathToFileURL(realtimeQueueTempPath).href);
    const sendOrder = [];
    let failedFirstAttempt = false;
    const queue = createOrderedRetryQueue(async (eventName, payload) => {
      sendOrder.push(`${eventName}:${payload.action.stroke.points[0].x}`);
      if (!failedFirstAttempt) {
        failedFirstAttempt = true;
        return false;
      }
      return true;
    }, { maxAttempts: 3, retryDelayMs: 0 });
    const firstPayload = {
      action: { type: "stroke", stroke: { id: "stroke-1", points: [{ x: 1, y: 1 }] } },
    };
    const firstSend = queue.enqueue("student-whiteboard-action", firstPayload);
    firstPayload.action.stroke.points[0].x = 999;
    const secondSend = queue.enqueue("student-whiteboard-action", {
      action: { type: "stroke", stroke: { id: "stroke-2", points: [{ x: 2, y: 2 }] } },
    });
    const results = await Promise.all([firstSend, secondSend]);
    const expectedOrder = [
      "student-whiteboard-action:1",
      "student-whiteboard-action:1",
      "student-whiteboard-action:2",
    ];
    if (!results.every(Boolean) || JSON.stringify(sendOrder) !== JSON.stringify(expectedOrder)) {
      console.error(`Realtime send queue order/retry contract failed: ${JSON.stringify(sendOrder)}`);
      ok = false;
    }
  }

  if (!monitorSyncTempPath) {
    console.error("Monitor sync module was not checked.");
    ok = false;
  } else {
    const {
      canAcceptTeacherBoardSnapshot,
      isMatchingMonitorRequest,
    } = await import(pathToFileURL(monitorSyncTempPath).href);
    const delayedInitialSnapshotRejected = !canAcceptTeacherBoardSnapshot({
      expectedToken: "teacher-action-1",
      pendingToken: "teacher-action-2",
      snapshotToken: "teacher-action-1",
    });
    const pendingSnapshotAccepted = canAcceptTeacherBoardSnapshot({
      expectedToken: "teacher-action-1",
      pendingToken: "teacher-action-2",
      snapshotToken: "teacher-action-2",
    });
    const staleMonitorResponseRejected = !isMatchingMonitorRequest(
      "monitor-current",
      "monitor-previous"
    );
    if (
      !delayedInitialSnapshotRejected ||
      !pendingSnapshotAccepted ||
      !staleMonitorResponseRejected
    ) {
      console.error("Monitor snapshot ordering contract failed.");
      ok = false;
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const realtimeApiSource = readFileSync("public/js/supabase-api.js", "utf8");
const emittedEvents = ["public/js/teacher.js", "public/js/student.js"].flatMap((filePath) => {
  const source = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return Array.from(source.matchAll(/socket\.emit\("([^"]+)"/g), (match) => match[1]);
});
const localOnlyEvents = new Set([
  "join-class",
  "join-student",
  "joinAsStudent",
  "join-teacher",
  "joinAsTeacher",
  "leave-class",
]);
const roleEventBlocks = Array.from(
  realtimeApiSource.matchAll(/(?:TEACHER|STUDENT|SHARED)_REALTIME_EVENTS = new Set\(\[([\s\S]*?)\]\)/g)
);
const roleMappedEvents = new Set(roleEventBlocks.flatMap((block) =>
  Array.from(block[1].matchAll(/"([^"]+)"/g), (match) => match[1])
));
const missingRoleMappings = Array.from(new Set(emittedEvents.filter((eventName) =>
  !localOnlyEvents.has(eventName) && !roleMappedEvents.has(eventName)
)));
if (missingRoleMappings.length > 0) {
  console.error(`Realtime events missing role authorization: ${missingRoleMappings.join(", ")}`);
  ok = false;
}

const teacherInboxContracts = [
  "const TEACHER_INBOX_EVENTS = new Set(STUDENT_REALTIME_EVENTS);",
  "supabase.channel(`class:${classCode}:teacher-inbox`",
  "subscriptions.push(subscribeChannel(teacherInboxChannel, \"Teacher inbox\"))",
  "targetChannel.httpSend(\"socket-event\", outboundPayload)",
  "targetChannel = state.teacherInboxChannel",
];
const missingTeacherInboxContracts = teacherInboxContracts.filter(
  (contract) => !realtimeApiSource.includes(contract)
);
if (missingTeacherInboxContracts.length > 0) {
  console.error("Student-to-teacher events are not fully routed through the teacher inbox.");
  ok = false;
}

const secureRealtimeContracts = [
  "supabase.channel(`class:${classCode}:presence`",
  "supabase.channel(`class:${classCode}:announcements`",
  "supabase.channel(`class:${classCode}:shared`",
  "`class:${classCode}:student:${membership.studentRecordId}`",
  "TEACHER_STUDENT_EVENTS.has(eventName)",
  "resolveTargetStudentRecordId(payload)",
  "studentRecordIdBySocketId: new Map()",
  "rememberStudentSocketRoute(",
  "refreshStudentSocketRoutesFromPresence(presenceState)",
  '"MissingPartition"',
  'subscribeChannel(presenceChannel, "Presence channel")',
  "isRetryableRealtimeJoinError(status, message)",
];
const missingSecureRealtimeContracts = secureRealtimeContracts.filter(
  (contract) => !realtimeApiSource.includes(contract)
);
if (missingSecureRealtimeContracts.length > 0) {
  console.error(`Secure Realtime topic contracts missing: ${missingSecureRealtimeContracts.join(", ")}`);
  ok = false;
}

const whiteboardSource = readFileSync("public/js/whiteboard.js", "utf8");
const teacherSource = readFileSync("public/js/teacher.js", "utf8");
const studentSource = readFileSync("public/js/student.js", "utf8");
const appConfigSource = readFileSync("public/js/app-config.js", "utf8");
const boardUiSource = readFileSync("public/js/board-ui.js", "utf8");
const teacherHtmlSource = readFileSync("public/teacher.html", "utf8");
const studentHtmlSource = readFileSync("public/student.html", "utf8");
const serverSource = readFileSync("server.js", "utf8");
const monitorSyncContracts = [
  [teacherSource, "requestStudentModalBoardState(studentSocketId)"],
  [teacherSource, 'setModalBoardLoadState("loading", "生徒の画面を読み込み中…")'],
  [teacherSource, 'if (modalBoardLoadState !== "ready" || !currentModalMonitorRequestId) return;'],
  [studentSource, "monitorRequestId: currentMonitorRequestId"],
  [realtimeApiSource, "monitorRequestId: payload.monitorRequestId"],
  [serverSource, "monitorRequestId,"],
  [teacherHtmlSource, 'id="studentModalBoardLoading"'],
  [teacherHtmlSource, 'id="studentModalBoardRetryBtn"'],
];
const missingMonitorSyncContracts = monitorSyncContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingMonitorSyncContracts.length > 0) {
  console.error(`Monitor loading/sync contracts missing: ${missingMonitorSyncContracts.join(", ")}`);
  ok = false;
}

const teacherActionHandlerStart = studentSource.indexOf(
  'socket.on("teacher-whiteboard-action"'
);
const teacherActionHandlerEnd = studentSource.indexOf(
  "// ★ ホワイトボード操作の送信フック設定",
  teacherActionHandlerStart
);
const teacherActionHandlerSource = studentSource.slice(
  teacherActionHandlerStart,
  teacherActionHandlerEnd
);
if (
  teacherActionHandlerStart < 0 ||
  teacherActionHandlerEnd <= teacherActionHandlerStart ||
  teacherActionHandlerSource.indexOf("boardSyncRevision += 1") < 0 ||
  teacherActionHandlerSource.indexOf("boardSyncRevision += 1") >
    teacherActionHandlerSource.indexOf('socket.emit("student-teacher-action-ack"')
) {
  console.error("Student board revision must advance before acknowledging a teacher action.");
  ok = false;
}
const selectionChangeStart = whiteboardSource.indexOf("  _fireSelectionChange() {");
const selectionChangeEnd = whiteboardSource.indexOf(
  "  // ★ 選択中オブジェクトを最前面へ",
  selectionChangeStart
);
if (selectionChangeStart < 0 || selectionChangeEnd <= selectionChangeStart) {
  console.error("Whiteboard selection-change method could not be found.");
  ok = false;
} else {
  const selectionChangeSource = whiteboardSource.slice(selectionChangeStart, selectionChangeEnd);
  if (/\btargets\b/.test(selectionChangeSource) || selectionChangeSource.includes("_notifyObjectStyleChanges")) {
    console.error("Selection changes must not emit unrelated object-style modifications.");
    ok = false;
  }
}
const notebookCaptureStart = studentSource.indexOf("// カメラ開始 / 再開始");
const notebookCaptureEnd = studentSource.indexOf("// 教員からのフィードバック画像受信");
const notebookCaptureSource = studentSource.slice(notebookCaptureStart, notebookCaptureEnd);
if (notebookCaptureStart < 0 || notebookCaptureEnd <= notebookCaptureStart) {
  console.error("Notebook capture source block could not be found.");
  ok = false;
} else {
  const notebookSessionContracts = [
    "if (!currentClassCode || !nickname)",
    "sendWhiteboardThumbnail();",
  ];
  const missingNotebookSessionContracts = notebookSessionContracts.filter(
    (contract) => !notebookCaptureSource.includes(contract)
  );
  if (missingNotebookSessionContracts.length > 0) {
    console.error(
      `Notebook capture must use the shared student session: ${missingNotebookSessionContracts.join(", ")}`
    );
    ok = false;
  }
}
if (studentSource.includes("joinedNotebookClassCode") || studentSource.includes("notebookStudentId")) {
  console.error("Notebook capture must not keep a duplicate class participation state.");
  ok = false;
}
const notebookTileContracts = [
  [studentSource, 'if (viewMode === "notebook")'],
  [studentSource, 'mode: "notebook"'],
  [studentSource, 'const cornerSelectionCanvas = document.getElementById("cornerSelectionCanvas")'],
  [studentSource, 'resetPerspectiveBtn?.addEventListener("click", resetPerspectiveCorrection)'],
  [studentSource, "renderPerspectiveCorrection(srcCanvas, previewCanvas, sourcePoints)"],
  [teacherSource, "latestThumbnails[socketId] = { nickname, dataUrl, mode: currentMode, viewport }"],
  [teacherSource, "studentNameMap[studentSocketId] = nickname"],
  [teacherSource, 'if (mode === "student" || mode === "notebook")'],
  [teacherSource, "notebookStudents[studentId] = { latestImageData: dataUrl }"],
  [realtimeApiSource, "nickname: message.senderNickname"],
  [realtimeApiSource, "const studentsBySocketId = new Map()"],
];
const missingNotebookTileContracts = notebookTileContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingNotebookTileContracts.length > 0) {
  console.error(`Notebook tile contracts missing: ${missingNotebookTileContracts.join(", ")}`);
  ok = false;
}

const communicationIntervalContracts = [
  [appConfigSource, "thumbnailIntervalMs: 5000"],
  [appConfigSource, "monitoringIntervalMs: 3000"],
  [studentSource, "Number(runtimeConfig.thumbnailIntervalMs) || 5000"],
  [studentSource, "Number(runtimeConfig.monitoringIntervalMs) || 3000"],
  [studentSource, "if (cornersLocked) {"],
  [teacherSource, 'modalShareToStudentBtn.addEventListener("click"'],
  [teacherSource, 'shareToggleBtn.addEventListener("click", sendFeedbackImageOnce)'],
];
const missingCommunicationIntervalContracts = communicationIntervalContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingCommunicationIntervalContracts.length > 0) {
  console.error(
    `Communication interval contracts missing: ${missingCommunicationIntervalContracts.join(", ")}`
  );
  ok = false;
}

const reliableStrokeContracts = [
  [realtimeApiSource, '"student-whiteboard-action",'],
  [realtimeApiSource, '"teacher-whiteboard-action",'],
  [realtimeApiSource, "whiteboardActionQueue.enqueue(eventName, payload)"],
  [studentSource, "boardRevision: boardSyncRevision"],
  [studentSource, "boardRevision: syncRevision"],
  [teacherSource, "latestStudentBoardRevisionByStudent"],
  [teacherSource, "isStaleStudentBoardRevision(studentSocketId, boardRevision"],
  [studentHtmlSource, "student.js?v=monitor-sync-20260819"],
  [teacherHtmlSource, "teacher.js?v=monitor-sync-20260819"],
];
const missingReliableStrokeContracts = reliableStrokeContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingReliableStrokeContracts.length > 0) {
  console.error(`Reliable stroke contracts missing: ${missingReliableStrokeContracts.join(", ")}`);
  ok = false;
}

const realtimeJoinContracts = [
  [realtimeApiSource, "createRealtimeJoinCoordinator(performJoinRealtime)"],
  [realtimeApiSource, "coordinateRealtimeJoin(requestedJoinKey, role, payload)"],
  [studentSource, 'const joined = await socket.emit("join-class"'],
];
const missingRealtimeJoinContracts = realtimeJoinContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingRealtimeJoinContracts.length > 0) {
  console.error(`Realtime join serialization contracts missing: ${missingRealtimeJoinContracts.join(", ")}`);
  ok = false;
}

for (const [filePath, htmlSource] of [
  ["public/teacher.html", teacherHtmlSource],
  ["public/student.html", studentHtmlSource],
]) {
  for (const match of htmlSource.matchAll(/\bpattern="([^"]+)"/g)) {
    try {
      new RegExp(match[1], "v");
    } catch (error) {
      console.error(`${filePath} contains an invalid HTML pattern ${match[1]}: ${error.message}`);
      ok = false;
    }
  }
}
if (!/videoEl\.onloadedmetadata\s*=\s*\(\)\s*=>\s*\{[\s\S]*?sendWhiteboardThumbnail\(\);[\s\S]*?\};/.test(notebookCaptureSource)) {
  console.error("Notebook camera start must send an immediate thumbnail.");
  ok = false;
}
if (!/if \(cornersLocked\) \{[\s\S]*?sendWhiteboardThumbnail\(\);[\s\S]*?\}/.test(notebookCaptureSource)) {
  console.error("Completed perspective correction must send an immediate thumbnail.");
  ok = false;
}

const obsoletePeriodicContracts = [
  "notebookIntervalMs",
  "captureIntervalIdNotebook",
  "captureAndSendImage",
  'socket.emit("studentImageUpdate"',
];
const remainingObsoletePeriodicContracts = obsoletePeriodicContracts.filter((contract) =>
  studentSource.includes(contract)
);
if (remainingObsoletePeriodicContracts.length > 0) {
  console.error(
    `Obsolete notebook periodic sends remain: ${remainingObsoletePeriodicContracts.join(", ")}`
  );
  ok = false;
}

const obsoleteFeedbackSharingContracts = [
  "shareIntervalId",
  "notebookShareTimeoutId",
  "TEACHER_FEEDBACK_INTERVAL_MS",
  "startSharing()",
  "stopSharing()",
];
const remainingObsoleteFeedbackSharingContracts = obsoleteFeedbackSharingContracts.filter((contract) =>
  teacherSource.includes(contract)
);
if (remainingObsoleteFeedbackSharingContracts.length > 0) {
  console.error(
    `Obsolete periodic feedback sharing remains: ${remainingObsoleteFeedbackSharingContracts.join(", ")}`
  );
  ok = false;
}

const teacherActionStart = studentSource.indexOf('socket.on("teacher-whiteboard-action"');
const teacherActionEnd = studentSource.indexOf(
  "// ★ ホワイトボード操作の送信フック設定",
  teacherActionStart
);
if (teacherActionStart < 0 || teacherActionEnd <= teacherActionStart) {
  console.error("Teacher whiteboard action handler could not be found.");
  ok = false;
} else if (
  studentSource.slice(teacherActionStart, teacherActionEnd).includes("forceNextBoardSync = true")
) {
  console.error("Teacher whiteboard actions must not trigger a later periodic full-board resend.");
  ok = false;
}
const securityMigrationSource = readFileSync(
  "supabase/migrations/20260817041821_harden_realtime_topics_and_shared_board_integrity.sql",
  "utf8"
);
const copyBoardFunctionSource = readFileSync(
  "supabase/functions/copy-board-to-class/index.ts",
  "utf8"
);
const distributionMigrationSource = readFileSync(
  "supabase/migrations/20260818031132_create_immutable_class_distributions.sql",
  "utf8"
);
if (!whiteboardSource.includes('this._newEntityId("stroke")') ||
    !whiteboardSource.includes('this._newEntityId("object")')) {
  console.error("Whiteboard entities must use collision-resistant IDs.");
  ok = false;
}

const interactionContracts = [
  [whiteboardSource, 'canvas.style.cursor = isHandleHovered ? "pointer" : ""'],
  [whiteboardSource, "this._activateToolForObject(hit)"],
  [boardUiSource, "wb.onToolChange = tool =>"],
  [teacherHtmlSource, 'id="studentModalPreviousBtn"'],
  [teacherHtmlSource, 'id="studentModalNextBtn"'],
  [teacherSource, "function navigateStudentModal(direction)"],
  [teacherSource, "updateStudentModalNavigation()"],
];
const missingInteractionContracts = interactionContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingInteractionContracts.length > 0) {
  console.error(`Whiteboard interaction contracts missing: ${missingInteractionContracts.join(", ")}`);
  ok = false;
}

const databaseSecurityContracts = [
  '"class teachers can write realtime announcements"',
  '"class students can read realtime student inbox"',
  '"class teachers can write realtime student inbox"',
  "shared_boards_one_active_per_class_idx",
  "finalize_shared_board_snapshot",
  "grant update (display_name) on public.profiles to authenticated",
  "students_login_id_safe_format",
  "copy_board_to_class_atomic",
];
const missingDatabaseSecurityContracts = databaseSecurityContracts.filter(
  (contract) => !securityMigrationSource.includes(contract)
);
if (missingDatabaseSecurityContracts.length > 0) {
  console.error(`Database security contracts missing: ${missingDatabaseSecurityContracts.join(", ")}`);
  ok = false;
}

if (!copyBoardFunctionSource.includes('.rpc("copy_board_to_class_atomic"')) {
  console.error("Board distribution must use the atomic database function.");
  ok = false;
}
const distributionContracts = [
  [teacherHtmlSource, 'id="teacherDistributeBoardBtn"'],
  [teacherSource, "managementApi.copyBoardToClass({"],
  [studentHtmlSource, "ファイルを開く..."],
  [copyBoardFunctionSource, ".copy(sourcePath, targetPath)"],
  [copyBoardFunctionSource, "p_distribution_id: distributionId"],
  [distributionMigrationSource, "p_snapshot_path is distinct from"],
  [distributionMigrationSource, "storage_board_teacher_board_reference_read"],
];
const missingDistributionContracts = distributionContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingDistributionContracts.length > 0) {
  console.error(`Immutable class distribution contracts missing: ${missingDistributionContracts.join(", ")}`);
  ok = false;
}
const assetStorageContracts = [
  [realtimeApiSource, "externalizeBoardAssets(boardData, snapshotPath)"],
  [realtimeApiSource, "hydrateBoardAssets(JSON.parse(await download.data.text()))"],
  [realtimeApiSource, "await storageObjectExists(currentPath)"],
  [realtimeApiSource, "cacheControl: \"0\""],
  [realtimeApiSource, "cacheNonce: normalizedCacheNonce"],
  [realtimeApiSource, "{ cache: \"no-store\" }"],
  [realtimeApiSource, "upsert: false"],
  [whiteboardSource, "applyAssetReferences(references)"],
  [whiteboardSource, "o.imageObjectUrl || o.imageDataUrl"],
  [teacherSource, "teacherBoard.applyAssetReferences?.(json.assetReferences)"],
  [studentSource, "whiteboard.applyAssetReferences?.(result.assetReferences)"],
  [studentSource, "const snapshotVersion = crypto.randomUUID()"],
  [teacherSource, "boardSnapshotPath, snapshotVersion"],
];
const missingAssetStorageContracts = assetStorageContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingAssetStorageContracts.length > 0) {
  console.error(`Board asset Storage contracts missing: ${missingAssetStorageContracts.join(", ")}`);
  ok = false;
}

if (!ok) {
  process.exit(1);
}

console.log("JavaScript syntax check passed.");

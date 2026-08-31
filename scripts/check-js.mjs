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
  "public/js/password-visibility.js",
];
const moduleFiles = [
  "public/js/board-ui.js",
  "public/js/form-api.js",
  "public/js/form-excel.js",
  "public/js/monitor-sync.js",
  "public/js/realtime-join-coordinator.js",
  "public/js/realtime-load-control.js",
  "public/js/realtime-send-queue.js",
  "public/js/stamps.js",
  "public/js/student.js",
  "public/js/student-bulk-import.js",
  "public/js/student-forms.js",
  "public/js/supabase-api.js",
  "public/js/timer-utils.mjs",
  "public/js/teacher.js",
  "public/js/teacher-forms.js",
  "public/js/teacher-class-storage.js",
  "public/js/teacher-login.js",
  "public/js/teacher-signup.js",
  "public/js/ui-icons.js",
  "public/js/whiteboard.js",
  "public/js/youtube-utils.mjs",
  "public/js/xlsx-utils.js",
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
  let realtimeLoadControlTempPath = "";
  let realtimeQueueTempPath = "";
  let monitorSyncTempPath = "";
  for (const filePath of moduleFiles) {
    const tempPath = join(tempDir, `${basename(filePath)}.mjs`);
    copyFileSync(filePath, tempPath);
    ok = runNodeCheck(tempPath) && ok;
    if (filePath.endsWith("realtime-join-coordinator.js")) realtimeJoinCoordinatorTempPath = tempPath;
    if (filePath.endsWith("realtime-load-control.js")) realtimeLoadControlTempPath = tempPath;
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

    const retryDelays = [];
    let backoffAttempts = 0;
    const backoffQueue = createOrderedRetryQueue(async () => {
      backoffAttempts += 1;
      return backoffAttempts >= 3;
    }, {
      maxAttempts: 3,
      retryDelayMs: 800,
      retryBackoffFactor: 2,
      retryJitterMs: 0,
      wait: async (delayMs) => retryDelays.push(delayMs),
    });
    const backoffResult = await backoffQueue.enqueue("start-monitoring", {});
    if (!backoffResult || JSON.stringify(retryDelays) !== JSON.stringify([800, 1600])) {
      console.error(`Realtime retry backoff contract failed: ${JSON.stringify(retryDelays)}`);
      ok = false;
    }
  }

  if (!realtimeLoadControlTempPath) {
    console.error("Realtime load control module was not checked.");
    ok = false;
  } else {
    const { deterministicSpreadDelay, jitteredInterval } = await import(
      pathToFileURL(realtimeLoadControlTempPath).href
    );
    const studentDelays = Array.from(
      { length: 20 },
      (_, index) => deterministicSpreadDelay(`class:test-student-${index + 1}`, 3000)
    );
    const presenceEvents = [0, ...studentDelays];
    const presenceEventsPerSecond = new Map();
    for (const delayMs of presenceEvents) {
      const bucket = Math.floor(delayMs / 1000);
      presenceEventsPerSecond.set(bucket, (presenceEventsPerSecond.get(bucket) || 0) + 1);
    }
    const peakPresenceEvents = Math.max(...presenceEventsPerSecond.values());
    const initialChannelJoins = Array.from({ length: 24 }, (_, index) => index * 80);
    for (const delayMs of studentDelays) {
      for (const channelOffsetMs of [0, 80, 160, 240]) {
        initialChannelJoins.push(delayMs + channelOffsetMs);
      }
    }
    const channelJoinsPerSecond = new Map();
    for (const delayMs of initialChannelJoins) {
      const bucket = Math.floor(delayMs / 1000);
      channelJoinsPerSecond.set(bucket, (channelJoinsPerSecond.get(bucket) || 0) + 1);
    }
    const peakChannelJoins = Math.max(...channelJoinsPerSecond.values());
    const thumbnailEventsPerSecond = new Map();
    for (let index = 0; index < 20; index += 1) {
      const phaseMs = deterministicSpreadDelay(`thumbnail:test-student-${index + 1}`, 4999);
      const bucket = Math.floor(phaseMs / 1000);
      thumbnailEventsPerSecond.set(bucket, (thumbnailEventsPerSecond.get(bucket) || 0) + 1);
    }
    const peakThumbnailEvents = Math.max(...thumbnailEventsPerSecond.values());
    if (
      new Set(studentDelays).size < 15 ||
      Math.max(...studentDelays) - Math.min(...studentDelays) < 1500 ||
      peakPresenceEvents > 20 ||
      peakChannelJoins > 100 ||
      peakThumbnailEvents > 20 ||
      jitteredInterval(5000, 750, () => 0) !== 4250 ||
      jitteredInterval(5000, 750, () => 1) !== 5750
    ) {
      console.error(
        `20-client load spreading contract failed: delays=${JSON.stringify(studentDelays)}, ` +
        `peakPresenceEvents=${peakPresenceEvents}, peakChannelJoins=${peakChannelJoins}, ` +
        `peakThumbnailEvents=${peakThumbnailEvents}`
      );
      ok = false;
    } else {
      console.log(
        `20-client load model passed: presence=${peakPresenceEvents}/s, ` +
        `channelJoins=${peakChannelJoins}/s, thumbnails=${peakThumbnailEvents}/s.`
      );
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
const duplexRealtimeMigrationSource = readFileSync(
  "supabase/migrations/20260824065229_make_student_realtime_channels_duplex.sql",
  "utf8"
);
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

const studentDuplexContracts = [
  "const TEACHER_INBOX_EVENTS = new Set(STUDENT_REALTIME_EVENTS);",
  'const teacherInboxChannel = role === "teacher"',
  "await subscribeChannel(teacherInboxChannel, \"Teacher inbox\")",
  "for (const studentRecordId of new Set(membership.studentIdByLoginId.values()))",
  "handleRemoteEvent(eventPayload, \"teacher-inbox\")",
  "targetChannel = await getStudentOutboxChannel(studentRecordId)",
  "channelStatuses.get(targetChannel) !== \"SUBSCRIBED\"",
  "targetChannel = state.studentInboxChannel",
];
const missingStudentDuplexContracts = studentDuplexContracts.filter(
  (contract) => !realtimeApiSource.includes(contract)
);
if (missingStudentDuplexContracts.length > 0) {
  console.error("Student duplex Realtime routing contracts are incomplete.");
  ok = false;
}
const studentDuplexPolicyContracts = [
  'create policy "class teachers can read realtime student inbox"',
  'create policy "class students can write realtime student inbox"',
  "where c.teacher_id = (select auth.uid())",
  "where s.auth_user_id = (select auth.uid())",
  "('class:' || c.class_code || ':student:' || s.id::text)",
];
const missingStudentDuplexPolicyContracts = studentDuplexPolicyContracts.filter(
  (contract) => !duplexRealtimeMigrationSource.includes(contract)
);
if (missingStudentDuplexPolicyContracts.length > 0) {
  console.error("Student duplex Realtime RLS contracts are incomplete.");
  ok = false;
}
if (realtimeApiSource.includes(".httpSend(")) {
  console.error("Realtime Broadcast must not fall back to per-message HTTP authorization.");
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
const studentBulkImportSource = readFileSync("public/js/student-bulk-import.js", "utf8");
const teacherLoginHtmlSource = readFileSync("public/teacher-login.html", "utf8");
const studentHtmlSource = readFileSync("public/student.html", "utf8");
const passwordVisibilitySource = readFileSync("public/js/password-visibility.js", "utf8");
const youtubeUtilsSource = readFileSync("public/js/youtube-utils.mjs", "utf8");
const styleSource = readFileSync("public/style.css", "utf8");
const serverSource = readFileSync("server.js", "utf8");
const youtubeEmbedContracts = [
  [youtubeUtilsSource, 'const YOUTUBE_HOSTS = new Set(['],
  [youtubeUtilsSource, 'https://www.youtube-nocookie.com/embed/'],
  [youtubeUtilsSource, 'autoplay: "0"'],
  [whiteboardSource, 'kind: "youtube"'],
  [whiteboardSource, 'this.onAction({ type: "object", object: obj })'],
  [whiteboardSource, 'this._syncYouTubePlayerOverlay();'],
  [teacherSource, 'allowYouTubePlayback: false'],
  [styleSource, '.youtube-player-layer'],
  [studentHtmlSource, 'youtube=20260831b'],
  [teacherHtmlSource, 'youtube=20260831b'],
];
const missingYouTubeEmbedContracts = youtubeEmbedContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingYouTubeEmbedContracts.length > 0) {
  console.error(`YouTube embed contracts missing: ${missingYouTubeEmbedContracts.join(", ")}`);
  ok = false;
}
const passwordVisibilityContracts = [
  [teacherLoginHtmlSource, 'data-password-visibility aria-controls="teacherPassword"'],
  [studentHtmlSource, 'data-password-visibility aria-controls="loginStudentPassword"'],
  [teacherLoginHtmlSource, "password-visibility.js?v=20260825"],
  [studentHtmlSource, "password-visibility.js?v=20260825"],
  [passwordVisibilitySource, 'button.addEventListener("mouseenter"'],
  [passwordVisibilitySource, 'button.addEventListener("mouseleave"'],
  [passwordVisibilitySource, 'input.type = visible ? "text" : "password"'],
];
const missingPasswordVisibilityContracts = passwordVisibilityContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingPasswordVisibilityContracts.length > 0) {
  console.error(
    `Password visibility controls are incomplete: ${missingPasswordVisibilityContracts.join(", ")}`
  );
  ok = false;
}
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
  [studentSource, "jitteredInterval(CAPTURE_INTERVAL_MS, 750)"],
  [studentSource, "jitteredInterval(MONITORING_INTERVAL_MS, 500)"],
  [studentSource, "await Promise.resolve(sendWhiteboardThumbnail())"],
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

const brokenImageContracts = [
  [whiteboardSource, "const incomingObjectUrls = this._collectAssetObjectUrls(data)"],
  [whiteboardSource, "img.onerror = () => {"],
  [whiteboardSource, "obj.image?.complete"],
  [whiteboardSource, "obj.image.naturalWidth > 0"],
  [teacherSource, "delete latestBoardDataByStudent[studentSocketId]"],
  [teacherSource, "requestStudentModalBoardState(studentSocketId)"],
];
const missingBrokenImageContracts = brokenImageContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingBrokenImageContracts.length > 0) {
  console.error(`Broken image recovery contracts missing: ${missingBrokenImageContracts.join(", ")}`);
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

const studentSessionRecoveryContracts = [
  [studentSource, "authApi.getStudentSession()"],
  [studentSource, "restoreStudentDraft(currentClassCode, nickname)"],
  [studentSource, "STUDENT_DRAFT_MARKER_KEY"],
  [studentSource, 'window.addEventListener("pagehide"'],
  [studentSource, 'socket.emit("leave-class")'],
  [studentSource, "if (!whiteboard?.isBoardDirty)"],
  [studentSource, "保存せずにファイルを開きますか？"],
  [teacherSource, "保存せずにファイルを開きますか？"],
  [realtimeApiSource, "async getStudentSession()"],
  [realtimeApiSource, "worker: true"],
  [whiteboardSource, "restoreBoardDraft(data)"],
  [whiteboardSource, "this._markDirty();"],
  [studentHtmlSource, "session-recovery=20260824"],
  [teacherHtmlSource, "session-recovery=20260824"],
];
const missingStudentSessionRecoveryContracts = studentSessionRecoveryContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingStudentSessionRecoveryContracts.length > 0) {
  console.error(
    `Student refresh/session recovery contracts missing: ${missingStudentSessionRecoveryContracts.join(", ")}`
  );
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
const deleteStudentsFunctionSource = readFileSync(
  "supabase/functions/delete-students/index.ts",
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

const highlighterSettingContracts = [
  "let currentHighlighterColor = \"#facc15\"",
  "let currentHighlighterWidth = 30",
  "wb.setHighlighterColor?.(currentHighlighterColor)",
  "wb.setHighlighterWidth?.(currentHighlighterWidth)",
  "currentHighlighterWidth = highlighterWidthPresets[width] || 30",
];
const missingHighlighterSettingContracts = highlighterSettingContracts.filter(
  (contract) => !boardUiSource.includes(contract)
);
if (missingHighlighterSettingContracts.length > 0) {
  console.error(
    `Highlighter setting persistence contracts missing: ${missingHighlighterSettingContracts.join(", ")}`
  );
  ok = false;
}
if (/setHighlighterColor\(["']#facc15["']\)/.test(boardUiSource)) {
  console.error("Highlighter color must not reset when its tool menu is toggled.");
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
const studentDeletionContracts = [
  [teacherHtmlSource, 'id="classManagementDeleteStudentsBtn"'],
  [teacherHtmlSource, 'id="deleteStudentsTeacherPassword" type="password"'],
  [teacherSource, "selectedManagedStudentIds"],
  [teacherSource, "managementApi.deleteStudents({ studentIds, teacherPassword })"],
  [realtimeApiSource, 'callFunction("delete-students", payload)'],
  [deleteStudentsFunctionSource, ".auth.signInWithPassword({ email, password })"],
  [deleteStudentsFunctionSource, 'classes!inner(teacher_id)'],
  [deleteStudentsFunctionSource, "classTeacherId(student) !== teacher.id"],
  [deleteStudentsFunctionSource, 'const root = `students/${studentId}`'],
  [deleteStudentsFunctionSource, ".storage.from(STORAGE_BUCKET).remove(paths)"],
  [deleteStudentsFunctionSource, ".auth.admin.deleteUser("],
];
const missingStudentDeletionContracts = studentDeletionContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingStudentDeletionContracts.length > 0) {
  console.error(
    `Secure student deletion contracts missing: ${missingStudentDeletionContracts.join(", ")}`
  );
  ok = false;
}
const studentBulkImportContracts = [
  [teacherHtmlSource, 'id="classManagementStudentTemplateDownload"'],
  [teacherHtmlSource, 'href="./templates/student-bulk-registration-template.xlsx"'],
  [teacherHtmlSource, 'id="classManagementStudentImportFile"'],
  [teacherHtmlSource, 'id="classManagementStudentImportBtn"'],
  [teacherSource, "parseStudentWorkbook(file)"],
  [teacherSource, "validateStudentImport(parsedWorkbook, managedStudents)"],
  [teacherSource, "await managementApi.createStudent({"],
  [studentBulkImportSource, 'STUDENT_IMPORT_SHEET_NAME = "生徒一括登録"'],
  [studentBulkImportSource, "MAX_STUDENT_IMPORT_ROWS = 200"],
  [studentBulkImportSource, 'new DecompressionStream("deflate-raw")'],
];
const missingStudentBulkImportContracts = studentBulkImportContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingStudentBulkImportContracts.length > 0) {
  console.error(`Student bulk import contracts missing: ${missingStudentBulkImportContracts.join(", ")}`);
  ok = false;
}
const studentImportTemplateHeader = readFileSync("public/templates/student-bulk-registration-template.xlsx").subarray(0, 2).toString("utf8");
if (studentImportTemplateHeader !== "PK") {
  console.error("Student bulk import template is not a valid XLSX ZIP file.");
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

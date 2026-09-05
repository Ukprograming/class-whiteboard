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
  "public/js/camera-utils.mjs",
  "public/js/assignment-utils.mjs",
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
    const {
      deterministicSpreadDelay,
      isRateLimitError,
      jitteredInterval,
      runWithRateLimitRetry,
    } = await import(
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
    // Teacher joins only the four class-wide channels up front. Each active
    // student's private channel is joined lazily after that student's Presence
    // entry appears, instead of subscribing the entire roster before ready.
    const initialChannelJoins = Array.from({ length: 4 }, (_, index) => index * 80);
    for (const delayMs of studentDelays) {
      for (const channelOffsetMs of [0, 80, 160, 240]) {
        initialChannelJoins.push(delayMs + channelOffsetMs);
      }
      initialChannelJoins.push(delayMs + 320);
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

    const countEventsPerSecond = (delays) => {
      const buckets = new Map();
      for (const delayMs of delays) {
        const bucket = Math.floor(delayMs / 1000);
        buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
      }
      return Math.max(...buckets.values());
    };
    const modePresenceDelays = Array.from(
      { length: 30 },
      (_, index) => deterministicSpreadDelay(`mode:TEST:student-${index + 1}`, 5000)
    );
    const authLoginDelays = Array.from(
      { length: 30 },
      (_, index) => deterministicSpreadDelay(`auth:TEST:student-${index + 1}`, 3000)
    );
    const peakModePresenceEvents = countEventsPerSecond(modePresenceDelays);
    const peakAuthLoginAttempts = countEventsPerSecond(authLoginDelays);
    if (
      peakModePresenceEvents > 20 ||
      peakAuthLoginAttempts > 20 ||
      Math.max(...modePresenceDelays) - Math.min(...modePresenceDelays) < 2500 ||
      Math.max(...authLoginDelays) - Math.min(...authLoginDelays) < 1500
    ) {
      console.error(
        `30-client burst spreading contract failed: ` +
        `modePresence=${peakModePresenceEvents}/s, auth=${peakAuthLoginAttempts}/s.`
      );
      ok = false;
    } else {
      console.log(
        `30-client burst model passed: modePresence=${peakModePresenceEvents}/s, ` +
        `auth=${peakAuthLoginAttempts}/s.`
      );
    }

    const retryWaits = [];
    const retryNotices = [];
    let rateLimitedAttempts = 0;
    const recoveredAuthResult = await runWithRateLimitRetry(async () => {
      rateLimitedAttempts += 1;
      return rateLimitedAttempts < 3
        ? { data: null, error: { status: 429, code: "over_request_rate_limit" } }
        : { data: { session: "ok" }, error: null };
    }, {
      maxAttempts: 4,
      getDelayMs: (attempt) => attempt * 2500,
      wait: async (delayMs) => retryWaits.push(delayMs),
      onRetry: (notice) => retryNotices.push(notice),
    });
    let invalidCredentialAttempts = 0;
    const invalidCredentialResult = await runWithRateLimitRetry(async () => {
      invalidCredentialAttempts += 1;
      return { data: null, error: { status: 400, code: "invalid_credentials" } };
    }, { maxAttempts: 4, wait: async () => {} });
    if (
      recoveredAuthResult?.data?.session !== "ok" ||
      rateLimitedAttempts !== 3 ||
      JSON.stringify(retryWaits) !== JSON.stringify([2500, 5000]) ||
      retryNotices.length !== 2 ||
      invalidCredentialAttempts !== 1 ||
      invalidCredentialResult?.error?.code !== "invalid_credentials" ||
      !isRateLimitError({ status: 429 }) ||
      !isRateLimitError({ code: "over_request_rate_limit" }) ||
      isRateLimitError({ status: 400, code: "invalid_credentials" })
    ) {
      console.error("Auth rate-limit-only retry contract failed.");
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
if (realtimeApiSource.includes("for (const studentRecordId of new Set(membership.studentIdByLoginId.values()))")) {
  console.error("Teacher Realtime readiness must not wait for every active roster channel.");
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
const assignmentUtilsSource = readFileSync("public/js/assignment-utils.mjs", "utf8");
const studentSource = readFileSync("public/js/student.js", "utf8");
const appConfigSource = readFileSync("public/js/app-config.js", "utf8");
const boardUiSource = readFileSync("public/js/board-ui.js", "utf8");
const formApiSource = readFileSync("public/js/form-api.js", "utf8");
const teacherHtmlSource = readFileSync("public/teacher.html", "utf8");
const studentBulkImportSource = readFileSync("public/js/student-bulk-import.js", "utf8");
const teacherLoginHtmlSource = readFileSync("public/teacher-login.html", "utf8");
const studentHtmlSource = readFileSync("public/student.html", "utf8");

const realtimeScaleFixContracts = [
  [realtimeApiSource, '"student-view-start-targeted"'],
  [realtimeApiSource, "const modeChanged = nextMode !== state.mode"],
  [realtimeApiSource, "if (modeChanged) scheduleModePresenceSync()"],
  [realtimeApiSource, "STUDENT_MODE_PRESENCE_SPREAD_WINDOW_MS = 5000"],
  [realtimeApiSource, "modePresenceGeneration"],
  [realtimeApiSource, "AUTH_RATE_LIMIT_MAX_ATTEMPTS = 4"],
  [realtimeApiSource, "STUDENT_AUTH_SPREAD_WINDOW_MS = 3000"],
  [realtimeApiSource, "signInWithPasswordWithRateLimitRetry"],
  [studentSource, "onInitialDelay: ({ delayMs })"],
  [studentSource, "onRateLimitRetry: ({ delayMs })"],
  [teacherSource, 'socket.emit("student-view-start-targeted"'],
  [teacherSource, 'if (supabaseEnabled)'],
  [teacherSource, 'socket.emit("student-view-start", { classCode: currentClassCode })'],
  [teacherSource, "updateStudentTilePreview(socketId)"],
  [teacherSource, "updateNotebookTile(studentId)"],
  [studentSource, 'socket.on("student-view-start-targeted", handleStudentViewStart)'],
  [studentSource, "mode: viewMode"],
  [studentSource, "updateModeUI({ notifyRealtime: false })"],
  [studentSource, "function updateModeUI({ notifyRealtime = true } = {})"],
  [studentSource, "if (!supabaseEnabled) updateModeUI()"],
  [teacherHtmlSource, "realtime-scale=20260902"],
  [studentHtmlSource, "realtime-scale=20260902"],
];
const missingRealtimeScaleFixContracts = realtimeScaleFixContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingRealtimeScaleFixContracts.length > 0) {
  console.error(`20-client Realtime scale fixes missing: ${missingRealtimeScaleFixContracts.join(", ")}`);
  ok = false;
}
const teacherAnnouncementEventsSource = realtimeApiSource.match(
  /const TEACHER_ANNOUNCEMENT_EVENTS = new Set\(\[([\s\S]*?)\]\);/
)?.[1] || "";
if (teacherAnnouncementEventsSource.includes('"student-view-start-targeted"')) {
  console.error("Targeted student-view start must not be broadcast to the whole class.");
  ok = false;
}
const passwordVisibilitySource = readFileSync("public/js/password-visibility.js", "utf8");
const cameraUtilsSource = readFileSync("public/js/camera-utils.mjs", "utf8");
const youtubeUtilsSource = readFileSync("public/js/youtube-utils.mjs", "utf8");
const styleSource = readFileSync("public/style.css", "utf8");
const serverSource = readFileSync("server.js", "utf8");
const cameraToolContracts = [
  [teacherHtmlSource, 'id="cameraCaptureBtn"'],
  [studentHtmlSource, 'id="cameraCaptureBtn"'],
  [teacherHtmlSource, 'id="cameraCaptureVideo" autoplay muted playsinline'],
  [teacherHtmlSource, 'id="cameraCaptureDeviceSelect"'],
  [studentHtmlSource, 'id="cameraCaptureDeviceSelect"'],
  [studentHtmlSource, 'id="cameraCaptureInsertBtn"'],
  [boardUiSource, "navigator.mediaDevices.getUserMedia({"],
  [boardUiSource, 'facingMode: { ideal: "environment" }'],
  [boardUiSource, 'deviceId: { exact: deviceId }'],
  [boardUiSource, "navigator.mediaDevices.enumerateDevices()"],
  [boardUiSource, "calculateCameraStageSize("],
  [cameraUtilsSource, "export function calculateCameraStageSize("],
  [boardUiSource, "maxEdge / Math.max(sourceWidth, sourceHeight)"],
  [boardUiSource, "cameraCaptureStage.style.aspectRatio = `${sourceWidth} / ${sourceHeight}`"],
  [boardUiSource, "captureCanvas.toBlob(resolve, \"image/jpeg\", 0.9)"],
  [boardUiSource, "await wb.pasteImageBlob(cameraCapturedBlob)"],
  [boardUiSource, "stream?.getTracks?.().forEach(track => track.stop())"],
  [boardUiSource, "/iPad|iPhone|iPod/i.test(userAgent)"],
  [boardUiSource, "画像をコピーし、ホワイトボード上に貼り付けてください"],
  [styleSource, ".camera-capture-backdrop"],
  [styleSource, ".camera-capture-stage video"],
  [styleSource, "object-fit: contain"],
  [teacherHtmlSource, "camera-tool=20260902b"],
  [studentHtmlSource, "camera-tool=20260902b"],
];
const missingCameraToolContracts = cameraToolContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingCameraToolContracts.length > 0) {
  console.error(`Whiteboard camera tool contracts missing: ${missingCameraToolContracts.join(", ")}`);
  ok = false;
}
const mediaFileContracts = [
  [teacherHtmlSource, 'id="mediaFileBtn"'],
  [studentHtmlSource, 'id="mediaFileBtn"'],
  [teacherHtmlSource, 'id="mediaInput" type="file"'],
  [studentHtmlSource, 'accept="image/*,video/mp4,video/webm,video/ogg,video/quicktime"'],
  [boardUiSource, 'mediaFileBtn?.addEventListener("click", () => mediaInput.click())'],
  [boardUiSource, 'await wb.pasteImageBlob(file)'],
  [boardUiSource, 'await wb.pasteVideoBlob(file, { fileName: file.name })'],
  [whiteboardSource, 'kind: "video"'],
  [whiteboardSource, 'video.controls = true'],
  [whiteboardSource, 'video.playsInline = true'],
  [whiteboardSource, 'this.onAction({ type: "refresh" })'],
  [realtimeApiSource, 'object?.kind === "video"'],
  [realtimeApiSource, 'case "video/mp4": return "mp4"'],
  [styleSource, '.video-player-layer'],
  [styleSource, 'object-fit: contain'],
  [teacherHtmlSource, 'media-file=20260904'],
  [studentHtmlSource, 'media-file=20260904'],
];
const missingMediaFileContracts = mediaFileContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingMediaFileContracts.length > 0) {
  console.error(`Whiteboard media file contracts missing: ${missingMediaFileContracts.join(", ")}`);
  ok = false;
}
const insertAutoSelectCallCount = (boardUiSource.match(/activateSelectionToolAfterInsert\(\);/g) || []).length;
const insertAutoSelectContracts = [
  [boardUiSource, "function activateSelectionToolAfterInsert()"],
  [boardUiSource, 'wb.setTool("select")'],
  [teacherSource, "insert-auto-select=20260905"],
  [studentSource, "insert-auto-select=20260905"],
  [teacherHtmlSource, "insert-auto-select=20260905"],
  [studentHtmlSource, "insert-auto-select=20260905"],
];
const missingInsertAutoSelectContracts = insertAutoSelectContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingInsertAutoSelectContracts.length > 0 || insertAutoSelectCallCount !== 3) {
  console.error(
    `Post-insert selection contracts missing: ${missingInsertAutoSelectContracts.join(", ")}; ` +
    `calls=${insertAutoSelectCallCount}`
  );
  ok = false;
}
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
const multiSelectionContracts = [
  "_getSelectedItemCount()",
  "_addObjectToSelection(obj)",
  "this._retainObjectMultiSelection(hitObj)",
  "this._retainStrokeMultiSelection(hitStroke)",
  "_getMultiSelectionBounds()",
  "_startMultiSelectionResize(handle)",
  "_updateMultiSelectionResize(wx, wy, keepAspect = false)",
  "_drawMultiSelectionResizeHandles(ctx, bounds)",
  'mode: "multi-selection-resize"',
  "obj.width !== entry.width",
  "width: entry.width != null ? entry.width : obj.width",
  "ox1 <= ex && ox2 >= sx && oy1 <= ey && oy2 >= sy",
  "minX <= ex && maxX >= sx && minY <= ey && maxY >= sy",
];
const missingMultiSelectionContracts = multiSelectionContracts.filter(
  contract => !whiteboardSource.includes(contract)
);
if (missingMultiSelectionContracts.length > 0) {
  console.error(
    `Whiteboard multi-selection contracts are missing: ${missingMultiSelectionContracts.join(", ")}`
  );
  ok = false;
}
if (
  !boardUiSource.includes("multi-select=20260901b") ||
  (teacherSource.match(/multi-select=20260901b/g) || []).length < 1
) {
  console.error("Whiteboard multi-selection changes must be cache-busted on every direct import path.");
  ok = false;
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
  [whiteboardSource, "_isImageSourceReady(source)"],
  [whiteboardSource, 'typeof source.complete === "boolean"'],
  [whiteboardSource, "Number(source.width) > 0 && Number(source.height) > 0"],
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
const imageReadyUsageCount = (whiteboardSource.match(/this\._isImageSourceReady\(/g) || []).length;
if (imageReadyUsageCount < 2) {
  console.error("Image readiness must cover both asset waits and object rendering.");
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
const assignmentMigrationSource = readFileSync(
  "supabase/migrations/20260831090000_add_assignment_distribution_workflow.sql",
  "utf8"
);
const historyDeletionMigrationSource = readFileSync(
  "supabase/migrations/20260903233050_add_teacher_history_deletion.sql",
  "utf8"
);
const historyDeletionFunctionSource = readFileSync(
  "supabase/functions/delete-teacher-history/index.ts",
  "utf8"
);
const historyDeletionGrantMigrationSource = readFileSync(
  "supabase/migrations/20260903233338_grant_history_deletion_service_role_tables.sql",
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
  [whiteboardSource, "const wasEditingObject = !!this.editingObj"],
  [whiteboardSource, 'if (wasEditingObject) {\n        this.setTool("select");'],
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
const editSelectionCacheKey = "edit-selection=20260902";
const editSelectionVersionedSources = [
  [boardUiSource, 1],
  [studentSource, 1],
  [teacherSource, 2],
  [studentHtmlSource, 1],
  [teacherHtmlSource, 1],
];
if (editSelectionVersionedSources.some(([source, minimum]) =>
  (source.match(/edit-selection=20260902/g) || []).length < minimum
)) {
  console.error("Whiteboard edit-selection changes must be cache-busted on every direct import path.");
  ok = false;
}

const sharedSupabaseImport = "./supabase-api.js?v=monitor-sync-20260819&realtime-scale=20260902&realtime-duplex=20260824&session-recovery=20260824&student-delete=20260826&forms=20260830&assignments=20260831&history-delete=20260904&auth-singleton=20260904&mode-presence=20260905&auth-load=20260905";
if (![teacherSource, studentSource, formApiSource].every(source => source.includes(sharedSupabaseImport))) {
  console.error("Authenticated pages must share one versioned Supabase client module URL.");
  ok = false;
}
if (
  (teacherSource.match(/from "\.\/board-ui\.js/g) || []).length !== 1 ||
  (teacherSource.match(/from "\.\/whiteboard\.js/g) || []).length !== 1
) {
  console.error("Teacher page must load one board UI module and one direct Whiteboard module.");
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
  [copyBoardFunctionSource, '["image", "video"].includes'],
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
const assignmentContracts = [
  [teacherHtmlSource, 'id="teacherAssignmentCheckBtn"'],
  [teacherHtmlSource, 'id="assignmentReviewSwitcher"'],
  [teacherHtmlSource, 'id="assignmentReviewSubmissionStatus"'],
  [teacherSource, "assignmentApi.listTeacherAssignments("],
  [assignmentUtilsSource, "board_file_id: board.id"],
  [teacherSource, "fileId: student.board_file_id"],
  [teacherSource, 'assignmentReviewSubmissionStatus.textContent = student?.assignment_submitted_at ? "提出済み" : "未提出"'],
  [teacherSource, "showBoardChangeSaveDecision("],
  [studentHtmlSource, 'id="studentAssignmentChip"'],
  [studentSource, "assignmentApi.listPendingStudentAssignments("],
  [studentSource, "showStudentBoardChangeDecision("],
  [realtimeApiSource, "subscribeStudentAssignments(studentId, onChange)"],
  [realtimeApiSource, "existingDistributionId = existingFile?.distribution_id || null"],
  [copyBoardFunctionSource, "p_distribution_kind: normalizedKind"],
  [assignmentMigrationSource, "distribution_kind in ('material', 'assignment')"],
  [assignmentMigrationSource, "board_files_mark_assignment_submitted"],
  [assignmentMigrationSource, "alter publication supabase_realtime add table public.board_files"],
  [teacherSource, "managementApi.deleteTeacherHistory("],
  [studentSource, 'socket.on("teacher-history-deleted"'],
  [realtimeApiSource, 'deleteTeacherHistory(payload)'],
  [historyDeletionFunctionSource, "collectAssignmentStoragePaths"],
  [historyDeletionFunctionSource, '.storage.from(STORAGE_BUCKET).remove'],
  [historyDeletionFunctionSource, 'admin.rpc(\n      "delete_teacher_history_records"'],
  [historyDeletionMigrationSource, "delete from public.board_files bf"],
  [historyDeletionMigrationSource, "delete from public.board_distributions"],
  [historyDeletionMigrationSource, "delete from public.form_runs"],
  [historyDeletionMigrationSource, "to service_role"],
  [historyDeletionGrantMigrationSource, "grant select on table"],
  [historyDeletionGrantMigrationSource, "grant delete on table public.form_runs to service_role"],
];
const missingAssignmentContracts = assignmentContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingAssignmentContracts.length > 0) {
  console.error(`Assignment workflow contracts missing: ${missingAssignmentContracts.join(", ")}`);
  ok = false;
}
const compactStatusContracts = [
  [teacherHtmlSource, 'class="class-status-pill" role="status" tabindex="0"'],
  [studentHtmlSource, 'class="class-status-pill" role="status" tabindex="0"'],
  [styleSource, ".class-status-pill:hover > span:last-child"],
  [teacherHtmlSource, "status-hover=20260901"],
  [studentHtmlSource, "status-hover=20260901"],
];
const missingCompactStatusContracts = compactStatusContracts
  .filter(([source, contract]) => !source.includes(contract))
  .map(([, contract]) => contract);
if (missingCompactStatusContracts.length > 0) {
  console.error(`Compact class status contracts missing: ${missingCompactStatusContracts.join(", ")}`);
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

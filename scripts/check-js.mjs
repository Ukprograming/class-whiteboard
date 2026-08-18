import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const commonJsFiles = [
  "server.js",
  "public/js/app-config.js",
  "public/js/legacy-socket-loader.js",
  "public/js/local-config-loader.js",
];
const moduleFiles = [
  "public/js/board-ui.js",
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
  for (const filePath of moduleFiles) {
    const tempPath = join(tempDir, `${basename(filePath)}.mjs`);
    copyFileSync(filePath, tempPath);
    ok = runNodeCheck(tempPath) && ok;
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
const boardUiSource = readFileSync("public/js/board-ui.js", "utf8");
const teacherHtmlSource = readFileSync("public/teacher.html", "utf8");
const studentHtmlSource = readFileSync("public/student.html", "utf8");
const notebookCaptureStart = studentSource.indexOf("// カメラ開始 / 再開始");
const notebookCaptureEnd = studentSource.indexOf("// 教員からのフィードバック画像受信");
const notebookCaptureSource = studentSource.slice(notebookCaptureStart, notebookCaptureEnd);
if (notebookCaptureStart < 0 || notebookCaptureEnd <= notebookCaptureStart) {
  console.error("Notebook capture source block could not be found.");
  ok = false;
} else {
  const notebookSessionContracts = [
    "if (!currentClassCode || !nickname)",
    "classCode: currentClassCode",
    "studentId: nickname",
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

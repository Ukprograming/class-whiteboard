import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { recordDiagnostic, readDiagnostics } from "../public/js/diagnostics.mjs";
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const { createMonitorReceiver } = await import("data:text/javascript;base64," + Buffer.from(read("public/js/monitor-sync.js")).toString("base64"));
const teacherSource = read("public/js/teacher.js");
const studentSource = read("public/js/student.js");
function slice(source, start, end) {
  const a = source.indexOf(start); const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}

// Deterministic reorder/duplicate/drop and resnapshot cases against the real
// receiver. The model records non-commutative edits, not just a message count.
let value = "";
const receiver = createMonitorReceiver({ apply: action => { value += action.text; }, maxHistory: 8 });
receiver.receive(12, { text: "C" });
receiver.receive(11, { text: "B" });
assert.equal(value, "");
assert(receiver.accept(10, () => { value = "A"; return true; }));
assert.equal(value, "ABC");
assert.equal(receiver.receive(11, { text: "duplicate" }), "duplicate");
receiver.receive(14, { text: "E" });
assert(receiver.hasGap());
receiver.receive(13, { text: "D" });
assert.equal(value, "ABCDE");
assert(!receiver.hasGap());
assert(receiver.accept(12, () => { value = "ABC"; return true; }));
assert.equal(value, "ABCDE", "edits that overtook a refresh download are replayed");
assert(!receiver.accept(11, () => { throw new Error("old baseline must not import"); }));
receiver.reset();
for (let i = 1; i <= 10; i++) receiver.receive(i, { text: String(i) });
assert(!receiver.accept(0, () => true), "an overflow cannot silently lose dropped edits");
assert(receiver.accept(10, () => true));
receiver.receive(11, null); // An already-applied teacher edit occupies a revision.
receiver.receive(12, { text: "F" });
assert.equal(receiver.revision, 12);

function teacherHarness() {
  let release;
  let contents = [];
  let imported = 0;
  const sent = [];
  const handlers = {};
  const resync = [];
  const c = vm.createContext({
    console, performance, clearTimeout() {},
    currentModalMonitorRequestId: "request", currentMonitoringStudentSocketId: "student",
    currentClassCode: "class", modalGapTimer: null, modalAcceptedSnapshot: null,
    modalSnapshotLoads: new Map(), modalShowingSavedFeedback: false,
    latestModeByStudent: {}, latestViewportByStudent: {}, latestBoardDataByStudent: {},
    latestTeacherSyncTokenByStudent: new Map(),
    recordDiagnostic() {}, rememberStudentBoardRevision() {},
    modalBoard: { applyAction: action => contents.push(action.id) },
    isCurrentTeacherBoardSync: () => true,
    isCurrentMonitorResponse: (student, request) => student === c.currentMonitoringStudentSocketId && request === c.currentModalMonitorRequestId,
    resolveRealtimeBoardData: () => new Promise(resolve => { release = resolve; }),
    importStudentBoardDataIntoModal: data => { imported++; contents = [...data.ids]; return true; },
    completeStudentModalBoardLoad: () => { c.ready = true; },
    scheduleModalResync: reason => resync.push(reason),
    socket: { on: (event, handler) => { handlers[event] = handler; }, emit: async (event, payload) => { sent.push({event, ...payload}); return true; } },
  });
  c.modalReceiver = createMonitorReceiver({ apply: action => c.modalBoard.applyAction(action) });
  vm.runInContext(slice(teacherSource, "function acknowledgeModalSnapshot()", "modalBoardRetryBtn?.addEventListener"), c);
  vm.runInContext(slice(teacherSource, 'socket.on("student-board-state",', '// ★ 生徒側からの「画面更新」'), c);
  return { c, handlers, sent, resync, resolve: data => release(data), contents: () => contents, imported: () => imported };
}
for (const timing of ["before", "during"]) {
  const h = teacherHarness();
  const action = () => h.handlers["student-whiteboard-action"]({ studentSocketId: "student", monitorRequestId: "request", boardRevision: 11, action: { id: "new" } });
  if (timing === "before") action();
  const pending = h.handlers["student-board-state"]({ studentSocketId: "student", monitorRequestId: "request", snapshotVersion: "v", boardRevision: 10 });
  if (timing === "during") action();
  h.resolve({ ids: ["old"], monitorSnapshot: { version: "v", revision: 10 } });
  await pending;
  assert.deepEqual(h.contents(), ["old", "new"]);
  assert.equal(h.c.ready, true);
  assert.equal(h.sent.at(-1).event, "teacher-board-state-ack");
}
{
  const h = teacherHarness();
  const pending = h.handlers["student-board-state"]({ studentSocketId: "student", monitorRequestId: "request", snapshotVersion: "v", boardRevision: 10 });
  h.handlers["student-whiteboard-action"]({ studentSocketId: "student", monitorRequestId: "request", boardRevision: 12, action: { id: "second" } });
  h.resolve({ ids: ["old"] }); await pending;
  assert.equal(h.sent.length, 0, "no ACK for an incomplete revision chain");
  h.handlers["student-whiteboard-action"]({ studentSocketId: "student", monitorRequestId: "request", boardRevision: 11, action: { id: "first" } });
  assert.deepEqual(h.contents(), ["old", "first", "second"]);
  assert.equal(h.sent.length, 1, "late missing delta finishes initial synchronization");
}
for (const kind of ["changed-request", "wrong-version"]) {
  const h = teacherHarness();
  const pending = h.handlers["student-board-state"]({ studentSocketId: "student", monitorRequestId: "request", snapshotVersion: "v", boardRevision: 10 });
  if (kind === "changed-request") h.c.currentModalMonitorRequestId = "new-request";
  h.resolve({ ids: ["old"], monitorSnapshot: { version: "overwritten", revision: 12 } });
  await pending;
  assert.equal(h.imported(), 0);
  assert.equal(h.sent.length, 0);
}

// Actual student save/screen-update and ACK handlers. A transport ACK alone
// must not suppress initial retries; only a matching application ACK may do so.
let now = 100;
let saves = 0;
const handlers = {};
const sent = [];
const student = vm.createContext({
  crypto, console, Date: { now: () => now },
  currentClassCode: "class", nickname: "student", viewMode: "whiteboard",
  recordDiagnostic() {},
  whiteboard: { exportBoardData: () => ({ objects: [] }), scale: 1, offsetX: 0, offsetY: 0 },
  studentCanvas: { getBoundingClientRect: () => ({ width: 500, height: 300 }) },
  boardApi: { enabled: true, saveRealtimeBoardSnapshot: async () => { saves++; return { snapshotPath: "snapshot" }; } },
  socket: { on: (event, handler) => { handlers[event] = handler; }, emit: async (event, payload) => { sent.push({event, ...payload}); return true; } },
});
vm.runInContext(slice(studentSource, "let currentTeacherSocketId = null;", '// ★ 教員からのホワイトボード操作受信'), student);
vm.runInContext(slice(studentSource, "async function sendScreenUpdate(", "// すべての Realtime ハンドラ"), student);
vm.runInContext('currentTeacherSocketId="teacher"; currentMonitorRequestId="request"; boardSyncRevision=10;', student);
await student.sendScreenUpdate("teacher", "request");
assert.equal(saves, 1);
assert.equal(vm.runInContext("hasSentInitialBoardData", student), false);
await student.sendScreenUpdate("teacher", "request"); assert.equal(saves, 1);
const first = sent[0];
handlers["teacher-board-state-ack"]({ teacherSocketId: "other", monitorRequestId: "request", snapshotVersion: first.snapshotVersion, boardRevision: 10 });
assert.equal(vm.runInContext("hasSentInitialBoardData", student), false);
vm.runInContext("boardSyncRevision=11; monitorRefreshRevision=11; forceNextBoardSync=true;", student);
handlers["teacher-board-state-ack"]({ teacherSocketId: "teacher", monitorRequestId: "request", snapshotVersion: first.snapshotVersion, boardRevision: 10 });
assert.equal(vm.runInContext("hasSentInitialBoardData", student), true);
assert.equal(vm.runInContext("forceNextBoardSync", student), true, "an older ACK cannot clear a newer media refresh");
await student.sendScreenUpdate("teacher", "request"); assert.equal(saves, 2);
now += 8001; await student.sendScreenUpdate("teacher", "request");
now += 8001; await student.sendScreenUpdate("teacher", "request");
now += 8001; await student.sendScreenUpdate("teacher", "request");
assert.equal(saves, 4, "the refresh stops after three unacknowledged attempts");

for (let i = 0; i < 410; i++) recordDiagnostic("fixture", { revision: i, password: "secret", boardData: "private", url: "private" });
assert.equal(readDiagnostics().length, 400);
assert(!JSON.stringify(readDiagnostics()).includes("private"));
assert(!JSON.stringify(readDiagnostics()).includes("secret"));
console.log("Monitor recovery passed: initial/refresh ordering, duplicates, gaps, overflow, stale sessions, overwritten snapshots, application ACKs, bounded retries and diagnostic privacy (local transport).");

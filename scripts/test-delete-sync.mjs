import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { strokeIntersectsPath } from "../public/js/stroke-hit-test.mjs";

// Exercise the actual model, student sender and teacher modal receiver locally.
// The transport is in-memory; this does not test authenticated Supabase delivery.
const source = readFileSync("public/js/whiteboard.js", "utf8")
  .replace(/^import\s+[\s\S]*?from\s+"[^"\n]+";\r?\n/gm, "")
  .replace("export class Whiteboard", "class Whiteboard");
const context = vm.createContext({ console: { ...console, log() {} }, crypto, strokeIntersectsPath });
vm.runInContext(`${source}\nglobalThis.Whiteboard = Whiteboard;`, context);
function board() {
  return Object.assign(Object.create(context.Whiteboard.prototype), {
    objects: [], strokes: [], history: [], activePageId: "page-1",
    multiSelectedObjects: [], multiSelectedStrokes: [],
    isTeacherMode: false, scale: 1, eraserWidth: 12,
    render() {}, _markDirty() {}, _setSelected(obj) { this.selectedObj = obj; },
  });
}
const student = board();
const teacher = board();
const messages = [];
let revision = -1;
let receive;
Object.assign(context, {
  whiteboard: student, modalBoard: teacher,
  currentTeacherSocketId: "teacher", currentMonitorRequestId: "monitor",
  boardSyncRevision: 0, forceNextBoardSync: false,
  sharedBoardSession: null, applyingSharedBoardRemote: false,
  scheduleStudentDraftSave() {},
  isCurrentMonitorResponse: (id, request) => id === "student" && request === "monitor",
  isStaleStudentBoardRevision: (_, value) => value <= revision,
  rememberStudentBoardRevision: (_, value) => { revision = value; },
  socket: {
    on(_, handler) { receive = handler; },
    emit(event, payload) {
      assert.equal(event, "student-whiteboard-action");
      assert.equal(payload.targetTeacherSocketId, "teacher");
      const message = structuredClone({ studentSocketId: "student", ...payload });
      messages.push(message);
      receive(message);
    },
  },
});
const teacherSource = readFileSync("public/js/teacher.js", "utf8");
const receiverStart = teacherSource.indexOf('socket.on("student-whiteboard-action",');
const receiverEnd = teacherSource.indexOf('\n});', receiverStart) + 4;
vm.runInContext(teacherSource.slice(receiverStart, receiverEnd), context);
const studentSource = readFileSync("public/js/student.js", "utf8");
// Normalize line endings before locating the complete sender block.
const normalized = studentSource.replace(/\r\n/g, "\n");
const start = normalized.indexOf('if (whiteboard) {\n', normalized.indexOf('// ★ ホワイトボード操作の送信フック設定'));
const end = normalized.indexOf('\n}\n', start) + 2;
assert(start > 0 && end > start);
vm.runInContext(normalized.slice(start, end), context);

const stroke = (id, extra = {}) => ({ id, type: "pen", width: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], ...extra });
function seed(objects, strokes) {
  student.objects = structuredClone(objects); student.strokes = structuredClone(strokes);
  teacher.objects = structuredClone(objects); teacher.strokes = structuredClone(strokes);
  student.history = []; student.multiSelectedObjects = []; student.multiSelectedStrokes = [];
  context.forceNextBoardSync = false;
}
function equalBoards() {
  assert.deepEqual(structuredClone(teacher.objects), structuredClone(student.objects));
  assert.deepEqual(structuredClone(teacher.strokes), structuredClone(student.strokes));
}
function snapshot() {
  // A refresh is handled by the student's next scheduled full snapshot.
  assert.equal(context.forceNextBoardSync, true);
  teacher.objects = structuredClone(student.objects); teacher.strokes = structuredClone(student.strokes);
  context.forceNextBoardSync = false;
}
for (const kind of ["text", "sticky", "rect", "image", "stamp", "table", "timer", "youtube", "video", "audio"]) {
  seed([{ id: kind, kind }], []);
  student.multiSelectedObjects = [...student.objects];
  student.deleteSelection();
  equalBoards(); assert.equal(teacher.objects.length, 0, `${kind} disappears without a snapshot`);
  student.undoLast(); snapshot(); equalBoards(); assert.equal(teacher.objects.length, 1);
}
seed([{ id: 0, kind: "rect" }, { id: "locked", locked: true }], [stroke(0), stroke("locked", { locked: true })]);
student.multiSelectedObjects = [...student.objects]; student.multiSelectedStrokes = [...student.strokes];
student.deleteSelection(); equalBoards();
assert.equal(teacher.objects.length, 1); assert.equal(teacher.strokes.length, 1);
assert.equal(teacher.strokes[0].id, "locked", "locked content stays on both boards");
const count = messages.length;
student.deleteSelection(); assert.equal(messages.length, count, "empty selection sends nothing");
student.undoLast(); snapshot(); equalBoards(); assert.equal(teacher.strokes.length, 2);

for (const teacherMode of [false, true]) {
  seed([], [stroke("ink", { isTeacherAnnotation: teacherMode }), stroke("far", { points: [{ x: 0, y: 90 }, { x: 100, y: 90 }] })]);
  student.isTeacherMode = teacherMode;
  assert(student._eraseStrokesAlongPath({ x: 50, y: -20 }, { x: 50, y: 20 }, teacherMode));
  equalBoards(); assert.equal(teacher.strokes.length, 1);
  student.undoLast(); snapshot(); equalBoards(); assert.equal(teacher.strokes.length, 2);
}
student.isTeacherMode = false;
seed([{ id: "object", kind: "rect" }], [stroke("ink")]);
student.history.push({ kind: "stroke", stroke: student.strokes[0] });
student.undoLast(); equalBoards(); assert.equal(teacher.strokes.length, 0);
student.history.push({ kind: "object", id: "object" });
student.undoLast(); equalBoards(); assert.equal(teacher.objects.length, 0);

seed([{ id: "retained", kind: "rect" }], []);
const invalid = { studentSocketId: "other", monitorRequestId: "monitor", boardRevision: revision + 1, action: { type: "delete", objectId: "retained" } };
receive(invalid);
receive({ ...invalid, studentSocketId: "student", monitorRequestId: "old" });
receive({ ...invalid, studentSocketId: "student", boardRevision: revision });
assert.equal(teacher.objects.length, 1, "other sessions and stale revisions remain rejected");
console.log("Selection deletion, eraser, Undo, and modal receiver synchronization tests passed.");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Real editor/action methods with a minimal DOM and deterministic clock.
// The receiver uses applyAction, as the teacher modal does; no live Supabase.
let nextTimer = 0;
const timers = new Map();
const makeElement = () => ({
  style: {}, value: "", appendChild() {}, focus() {}, select() {},
  getContext() { return { measureText: text => ({ width: text.length * 8 }) }; },
});
const context = vm.createContext({
  console, crypto, document: { createElement: makeElement },
  setTimeout(fn, delay) { assert.equal(delay, 300); timers.set(++nextTimer, fn); return nextTimer; },
  clearTimeout(id) { timers.delete(id); },
});
const source = readFileSync("public/js/whiteboard.js", "utf8")
  .replace(/^import\s+[\s\S]*?from\s+"[^"\n]+";\r?\n/gm, "")
  .replace("export class Whiteboard", "class Whiteboard");
vm.runInContext(`${source}\nglobalThis.Whiteboard = Whiteboard;`, context);
const { Whiteboard } = context;
function tick() {
  const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
}
function board() {
  const wb = Object.create(Whiteboard.prototype);
  Object.assign(wb, {
    objects: [], strokes: [], history: [], activePageId: "page-1", scale: 1,
    offsetX: 0, offsetY: 0, stickyColor: "#fff59d", penColor: "#111827",
    canvas: { style: {}, parentElement: makeElement() },
    ctx: { measureText: text => ({ width: text.length * 8 }) },
    render() {}, _markDirty() {}, _setSelected(obj) { this.selectedObj = obj; },
    _updateTextCountLabel() {}, _listen(el, event, fn) { (el.listeners ||= {})[event] = fn; },
  });
  wb.textEditor = wb._createTextEditor();
  return wb;
}
function input(wb, value) {
  wb.textEditor.value = value;
  wb.textEditor.listeners.input();
}
function key(wb, name, extra = {}) {
  const e = { key: name, preventDefault() { this.prevented = true; }, ...extra };
  wb.textEditor.listeners.keydown(e);
  return e;
}
for (const kind of ["text", "sticky"]) {
  const student = board(); const teacher = board(); const actions = [];
  student.onAction = action => {
    const copy = structuredClone({ ...action, pageId: action.pageId || student.activePageId });
    actions.push(copy); teacher.applyAction(copy);
  };
  student.tool = kind;
  student._createTextObject(20, 30, kind);
  const obj = student.objects[0];
  assert.equal(teacher.objects[0].id, obj.id, "creation reaches an empty modal before modify");
  input(student, "Hello"); input(student, "Hello world");
  assert.equal(timers.size, 1, "typing is coalesced");
  assert.equal(actions.length, 1);
  tick(); assert.equal(teacher.objects[0].text, "Hello world");
  assert.equal(student.history.length, 1, "live edits do not add Undo entries");
  assert(!key(student, "Enter", { shiftKey: true }).prevented);
  input(student, "Hello\nworld"); tick();
  assert.equal(teacher.objects[0].text, "Hello\nworld");
  input(student, "Hello\nwor"); tick();
  assert.equal(teacher.objects[0].text, "Hello\nwor", "partial deletion is visible");
  input(student, ""); tick(); assert.equal(teacher.objects[0].text, "", "empty text clears receiver");
  input(student, "日本語");
  key(student, "Enter", { isComposing: true });
  key(student, "Enter", { keyCode: 229 });
  assert.equal(student.editingObj, obj, "IME confirmation keeps the editor open");
  key(student, "Enter");
  assert.equal(student.tool, "select");
  assert.equal(student.editingObj, null);
  assert.equal(teacher.objects[0].text, "日本語", "commit flushes final input immediately");
  assert.equal(timers.size, 0, "no delayed edit after commit");
  assert.equal(student.history.length, 2);
  assert.equal(student.history[1].before.text, "");
  student.undoLast(); assert.equal(obj.text, ""); assert.equal(teacher.objects[0].text, "");

  // Editing an existing object temporarily activates its creation tool.
  obj.text = "original";
  student._openTextEditorForObject(obj); student.tool = kind;
  input(student, "changed"); tick();
  input(student, "pending"); key(student, "Escape");
  assert.equal(obj.text, "original");
  assert.equal(teacher.objects[0].text, "original");
  assert.equal(timers.size, 0); tick();
  student._openTextEditorForObject(obj);
  input(student, "preview"); tick();
  input(student, "original"); key(student, "Escape");
  assert.equal(teacher.objects[0].text, "original", "cancel flushes even if local text already matches original");
  student._openTextEditorForObject(obj); student.tool = kind;
  input(student, "final"); key(student, "Enter");
  assert.equal(student.tool, "select", "Enter on an existing object leaves creation mode");
  assert.equal(teacher.objects[0].text, "final");

  student._openTextEditorForObject(obj); student.tool = kind;
  input(student, "blur"); student.textEditor.listeners.blur();
  assert.equal(teacher.objects[0].text, "blur"); assert.equal(timers.size, 0);
  student._openTextEditorForObject(obj); student.tool = kind;
  input(student, "pen selected"); student.setTool("pen");
  assert.equal(student.tool, "pen", "an explicit tool choice is preserved");

  student._openTextEditorForObject(obj);
  input(student, "stale"); student.objects = []; const count = actions.length;
  tick(); key(student, "Enter");
  assert.equal(actions.length, count, "page replacement/deletion cannot emit a detached edit");
}
const imports = ["public/js/board-ui.js", "public/js/student.js", "public/js/teacher.js", "public/student.html", "public/teacher.html"];
for (const path of imports) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/import .*from "\.\/(whiteboard|board-ui)\.js\?|<script type="module" src="\.\/js\/(student|teacher)\.js\?/.test(line)) {
      assert(line.includes("text-live=20260911"), `cache key missing in ${path}`);
    }
  }
}
console.log("Text/sticky editor and receiver synchronization tests passed.");

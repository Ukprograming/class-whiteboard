import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/js/whiteboard.js", "utf8")
  .replace(/^import\s+[\s\S]*?from\s+"[^"\n]+";\r?\n/gm, "")
  .replace("export class Whiteboard", "class Whiteboard");
const context = vm.createContext({ console, crypto });
vm.runInContext(`${source}\nglobalThis.Whiteboard = Whiteboard;`, context);
function board() {
  const wb = Object.assign(Object.create(context.Whiteboard.prototype), {
    objects: [], strokes: [], history: [], redoHistory: [],
    changeRevision: 0, savedRevision: 0,
    multiSelectedObjects: [], multiSelectedStrokes: [],
    bgCanvas: { width: 0, height: 0 }, render() {},
    _setSelected(object) { this.selectedObj = object; this.multiSelectedObjects = object ? [object] : []; this.multiSelectedStrokes = []; },
    _fireSelectionChange() {},
  });
  wb.events = [];
  wb.onAction = action => wb.events.push(action);
  return wb;
}
const snapshot = wb => JSON.stringify({ objects: wb.objects, strokes: wb.strokes });
function roundtrip(wb, before, after) {
  for (let i = 0; i < 3; i++) {
    wb.undoLast(); assert.equal(snapshot(wb), before, "undo restores prior content and order");
    wb.redoLast(); assert.equal(snapshot(wb), after, "redo restores content and order");
  }
  assert.equal(wb.isBoardDirty, true);
}
for (const kind of ["rect", "text", "sticky", "table", "image", "video", "audio", "timer", "youtube"]) {
  const wb = board();
  const before = snapshot(wb);
  const object = { id: kind, kind, assetKey: "retained-media-key" };
  wb._addObject(object);
  roundtrip(wb, before, snapshot(wb));
  assert.equal(wb.objects[0], object, "media/history references survive redo");
  assert(wb.events.some(event => event.type === "delete" && event.objectId === kind));
  assert(wb.events.some(event => event.type === "refresh"));
}
{
  const wb = board();
  const before = snapshot(wb);
  wb._addStroke({ id: "ink", points: [{ x: 3, y: 4 }], width: 2 });
  roundtrip(wb, before, snapshot(wb));
  assert(wb.events.some(event => event.type === "delete-stroke"));
}
{
  const wb = board();
  wb.objects = [{ id: "a" }, { id: "keep", locked: true }, { id: "c" }];
  wb.strokes = [{ id: "ink" }, { id: "keep-ink", locked: true }];
  const before = snapshot(wb);
  wb.multiSelectedObjects = [...wb.objects]; wb.multiSelectedStrokes = [...wb.strokes];
  wb.deleteSelection();
  roundtrip(wb, before, snapshot(wb));
  assert.equal(wb.objects.length, 1); assert.equal(wb.strokes.length, 1);
}
{
  const wb = board();
  wb.strokes = [{ id: "first" }, { id: "middle" }, { id: "last" }];
  const before = snapshot(wb);
  wb._deleteStroke(wb.strokes[1]);
  roundtrip(wb, before, snapshot(wb));
}
for (const kind of ["edit-text", "text-appearance", "transform", "edit-table", "edit-table-cell"]) {
  const wb = board();
  const object = { id: "object", kind: "text", text: "before", x: 0, y: 1, width: 80, height: 40, borderVisible: false,
    rows: 1, cols: 1, colWidths: [80], rowHeights: [40], cells: [{ text: "before" }] };
  wb.objects = [object];
  wb.strokes = [{ id: "ink", width: 2, points: [{ x: 1, y: 2 }] }];
  wb._normalizeTableObject = () => {};
  wb._getTableCell = (obj, row, col) => obj.cells[row * obj.cols + col];
  const before = snapshot(wb);
  let entry;
  if (kind === "edit-text") {
    entry = { kind, object, before: { text: object.text, width: object.width, height: object.height } };
    object.text = "after"; object.height = 90;
  } else if (kind === "text-appearance") {
    entry = { kind, object, before: { borderVisible: false } }; object.borderVisible = true;
  } else if (kind === "transform") {
    entry = { kind, objects: [{ obj: object, before: { x: 0, y: 1, width: 80, height: 40 } }],
      strokes: [{ stroke: wb.strokes[0], before: { width: 2, points: [{ x: 1, y: 2 }] } }] };
    object.x = 50; object.width = 120; wb.strokes[0].width = 6; wb.strokes[0].points = [{ x: 70, y: 80 }];
  } else if (kind === "edit-table") {
    entry = { kind, object, before: wb._snapshotTable(object) }; object.cells[0].text = "after"; object.colWidths[0] = 100;
  } else {
    entry = { kind, object, row: 0, col: 0, before: "before" }; object.cells[0].text = "after";
  }
  wb.history.push(entry);
  roundtrip(wb, before, snapshot(wb));
  assert(wb.events.some(event => ["modify", "refresh"].includes(event.type)), `${kind} notifies receivers`);
}
{
  const wb = board(); let status;
  wb.onHistoryChange = value => { status = value; };
  wb._addObject({ id: "a" }); wb._addObject({ id: "b" });
  wb.undoLast(); wb.undoLast();
  assert.equal(status.canUndo, false); assert.equal(status.canRedo, true);
  wb.redoLast(); wb.redoLast();
  assert.deepEqual(wb.objects.map(obj => obj.id), ["a", "b"]);
  assert.equal(status.canRedo, false);
  wb.undoLast(); wb._addObject({ id: "c" }); wb.redoLast();
  assert.deepEqual(wb.objects.map(obj => obj.id), ["a", "c"], "new edits invalidate redo");
  wb.undoLast(); wb.clearAll(); wb.redoLast(); assert.equal(wb.objects.length, 0);
}
{
  const wb = board();
  wb._addObject({ id: "a", kind: "text", text: "before" });
  const object = wb.objects[0];
  wb.history.push({ kind: "edit-text", object, before: { text: "before" } }); object.text = "after";
  wb.undoLast(); wb.undoLast(); wb.redoLast(); wb.redoLast();
  assert.equal(wb.objects[0].text, "after", "creation followed by edit retains references through multiple undos");
}
// Exercise the actual shared keyboard handler without invoking browser text editing.
const ui = readFileSync("public/js/board-ui.js", "utf8");
const start = ui.indexOf('  window.addEventListener("keydown", e => {');
const end = ui.indexOf('\n  });', start) + 6;
let handler; let undo = 0; let redo = 0;
vm.runInNewContext(ui.slice(start, end), {
  window: { addEventListener(_, fn) { handler = fn; } },
  wb: { undoLast() { undo++; }, redoLast() { redo++; } },
});
const press = extra => { let prevented = false; handler({ target: { tagName: "BODY" }, key: "z", ctrlKey: true,
  preventDefault() { prevented = true; }, ...extra }); return prevented; };
assert(press({})); assert.equal(undo, 1);
assert(press({ shiftKey: true })); assert(press({ key: "y" }));
assert(press({ ctrlKey: false, metaKey: true, shiftKey: true })); assert.equal(redo, 3);
for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(press({ target: { tagName }, shiftKey: true }), false);
assert.equal(press({ target: { isContentEditable: true }, shiftKey: true }), false);
assert.equal(press({ isComposing: true }), false); assert.equal(press({ altKey: true }), false);
console.log("Undo/redo content, order, references, invalidation, synchronization signals and keyboard tests passed.");

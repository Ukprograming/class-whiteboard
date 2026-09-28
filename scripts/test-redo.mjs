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
// Clipboard snapshots retain the entire selection and undo as one operation.
{
  const wb = board();
  const image = { pixels: "loaded-image" };
  const kinds = ["rect", "text", "sticky", "table", "stamp", "image", "video", "audio", "youtube", "triangle"];
  const originals = kinds.map((kind, i) => ({
    id: `original-${i}`, kind, x: i * 10, y: i * 20, width: 80, height: 40,
    groupId: "original-group", text: "copied text",
    ...(kind === "image" ? { image, assetKey: "image-asset" } : {}),
    ...(["video", "audio"].includes(kind) ? { assetKey: `${kind}-asset`, videoObjectUrl: `blob:${kind}` } : {}),
    ...(kind === "table" ? { cells: [{ text: "cell" }] } : {}),
    ...(kind === "triangle" ? { points: [{ x: 90, y: 180 }], shapeVertices: [{ x: 0, y: 1 }] } : {})
  }));
  wb.objects = [...originals, { id: "unselected", kind: "rect" }];
  wb.strokes = [{ id: "ink", points: [{ x: 10, y: 20 }], groupId: "original-group" }];
  wb.multiSelectedObjects = [...originals].reverse();
  wb.multiSelectedStrokes = [...wb.strokes];
  wb.selectedObj = originals.at(-1);
  wb.copySelection();
  originals[1].text = "changed after copy";
  const before = snapshot(wb);
  wb.pasteSelection();
  const pasted = wb.multiSelectedObjects;
  assert.equal(pasted.length, kinds.length);
  assert.equal(wb.multiSelectedStrokes.length, 1);
  assert.equal(JSON.stringify(pasted.map(obj => obj.kind)), JSON.stringify(kinds), "stacking order survives reversed selection order");
  assert.equal(pasted[1].text, "copied text", "clipboard is a snapshot");
  assert.equal(pasted[5].image, image, "image remains drawable");
  assert.equal(pasted[5].assetKey, "image-asset");
  assert.equal(pasted[6].videoObjectUrl, "blob:video");
  assert.notEqual(pasted[3].cells, originals[3].cells);
  assert.equal(pasted[9].points[0].x, 130);
  assert.equal(pasted[9].shapeVertices[0].x, 0, "normalized vertices are not translated");
  assert.equal(wb.multiSelectedStrokes[0].points[0].y, 60);
  const groupId = pasted[0].groupId;
  assert.notEqual(groupId, "original-group");
  assert(pasted.every(obj => obj.groupId === groupId));
  assert.equal(wb.multiSelectedStrokes[0].groupId, groupId);
  for (let i = 0; i < pasted.length; i++) {
    assert.notEqual(pasted[i].id, originals[i].id);
    assert.equal(pasted[i].x, originals[i].x + 40);
    assert.equal(pasted[i].y, originals[i].y + 40);
  }
  assert.equal(wb.history.length, 1);
  assert.equal(wb.events.at(-1).type, "refresh", "paste notifies synchronization");
  roundtrip(wb, before, snapshot(wb));
  wb.pasteSelection();
  assert.notEqual(wb.multiSelectedObjects[0].groupId, groupId);
  const ids = [...wb.objects, ...wb.strokes].map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, "repeated pastes allocate unique IDs");
}
for (const strokeOnly of [false, true]) {
  const wb = board();
  if (strokeOnly) {
    wb.strokes = [{ id: "ink", points: [{ x: 1, y: 2 }] }];
    wb.multiSelectedStrokes = [...wb.strokes];
  } else {
    wb.objects = [{ id: "single", kind: "text", x: 10, y: 20 }];
    wb.selectedObj = wb.objects[0];
  }
  const before = snapshot(wb);
  wb.copySelection(); wb.pasteSelection();
  assert.equal(strokeOnly ? wb.strokes.length : wb.objects.length, 2);
  roundtrip(wb, before, snapshot(wb));
}
// Drive the real mouse/touch handlers through a blank area of the group frame.
Object.assign(context, { window: {}, document: {} });
function dragBoard(scale = 1) {
  const wb = board();
  const handlers = {};
  Object.assign(wb, {
    tool: "select", scale, offsetX: 25, offsetY: 35, handleRects: [],
    canvas: { style: {}, getBoundingClientRect: () => ({ left: 10, top: 20, width: 1000, height: 800 }) },
    laserTrail: { active: false, end() {} },
    _findTimerControlAt() { return null; },
    _listen(target, type, handler) { if (target === this.canvas) handlers[type] = handler; }
  });
  wb.objects = [
    { id: "left", kind: "rect", x: 0, y: 0, width: 30, height: 30 },
    { id: "right", kind: "rect", x: 200, y: 100, width: 30, height: 30 }
  ];
  wb.multiSelectedObjects = [...wb.objects];
  wb.selectedObj = wb.objects[0];
  wb._attachEvents();
  wb.pointer = (type, x, y, extra = {}) => {
    const point = { clientX: 10 + wb.offsetX + x * scale, clientY: 20 + wb.offsetY + y * scale };
    handlers[type]({ type, ...point, preventDefault() {},
      ...(type.startsWith("touch") ? { touches: type === "touchend" ? [] : [point], changedTouches: [point] } : {}), ...extra });
  };
  return wb;
}
for (const touch of [false, true]) {
  for (const scale of [0.5, 2]) {
    const wb = dragBoard(scale);
    wb.strokes = [{ id: "ink", width: 2, points: [{ x: 5, y: 5 }, { x: 10, y: 10 }] }];
    wb.multiSelectedStrokes = [...wb.strokes];
    const locked = { id: "locked", kind: "rect", x: 50, y: 50, width: 10, height: 10, locked: true };
    wb.objects.push(locked); wb.multiSelectedObjects.push(locked);
    const before = snapshot(wb);
    if (!touch) {
      wb.pointer("mousemove", 100, 60);
      assert.equal(wb.canvas.style.cursor, "move");
    }
    wb.pointer(touch ? "touchstart" : "mousedown", 100, 60);
    assert.equal(wb.isDraggingObj, true, "blank frame interior starts group movement");
    wb.pointer(touch ? "touchmove" : "mousemove", 125, 75);
    wb.pointer(touch ? "touchend" : "mouseup", 125, 75);
    assert.equal(wb.objects[0].x, 25); assert.equal(wb.objects[1].x, 225);
    assert.equal(wb.objects[0].y, 15); assert.equal(wb.objects[1].y, 115);
    assert.equal(wb.strokes[0].points[0].x, 30);
    assert.equal(locked.x, 50, "locked items stay put");
    assert.equal(wb.multiSelectedObjects.length, 3);
    assert.equal(wb.history.length, 1);
    assert.equal(wb.events.filter(event => event.type === "modify").length, 2);
    assert(wb.events.some(event => event.type === "refresh"));
    roundtrip(wb, before, snapshot(wb));
  }
}
{
  const wb = dragBoard();
  wb.handleRects = [{ name: "nw", x: 20, y: 30, size: 10 }];
  wb.pointer("mousedown", 0, 0);
  assert.equal(wb.dragStart.mode, "multi-selection-resize", "corner handles retain resize priority");
}
{
  const wb = dragBoard();
  const third = { id: "third", kind: "rect", x: 90, y: 50, width: 20, height: 20 };
  wb.objects.push(third);
  wb.pointer("mousedown", 100, 60, { shiftKey: true });
  assert(wb.multiSelectedObjects.includes(third), "Shift-click can add an item inside the frame");
}
{
  const wb = dragBoard();
  wb.pointer("mousedown", 300, 200);
  assert.equal(wb.isBoxSelecting, true, "outside the frame starts a new selection");
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

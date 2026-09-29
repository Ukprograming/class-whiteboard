import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createStudentTileRegistry } from "../public/js/student-tile-registry.mjs";

const student = (socketId, studentRecordId = "account-1", nickname = "s014") =>
  ({ socketId, studentRecordId, nickname, mode: "whiteboard" });
const image = (value = "preview", mode = "whiteboard") => ({ nickname: "s014", dataUrl: value, mode });
let time = 0;
const registry = createStudentTileRegistry({ now: () => time, maxPending: 2 });
registry.setScope("A");
assert.equal(registry.receiveThumbnail("old", image()), false);
assert.equal(registry.updatePresence([student("old")]).length, 1);
assert.equal(registry.getThumbnails().old.dataUrl, "preview", "first thumbnail can precede Presence");
registry.updatePresence([student("old"), student("new")]);
assert.equal(registry.selectedSocketId("old"), "new");
assert.equal(registry.receiveThumbnail("new", image("new-board")), true);
assert.equal(registry.receiveThumbnail("old", image("old-board")), false);
for (let i = 0; i < 5; i++) {
  registry.updatePresence([student("new"), { ...student("old"), onlineAt: "2099-01-01" }]);
  assert.deepEqual(Object.keys(registry.getThumbnails()), ["new"], "reordered Presence/mode updates do not switch tabs");
}
registry.updatePresence([student("new")]);
assert.equal(registry.receiveThumbnail("old", image()), false, "a retired connection cannot resurrect its tile");
registry.updatePresence([]);
assert.equal(registry.receiveThumbnail("new", image()), false);
registry.updatePresence([student("new")]);
assert.equal(registry.receiveThumbnail("new", image()), true, "same socket may legitimately reconnect");
registry.updatePresence([student("new"), student("other-account", "account-2", "s014")]);
assert.equal(registry.receiveThumbnail("other-account", image()), true);
assert.equal(Object.keys(registry.getThumbnails()).length, 2, "distinct account IDs are not merged by display name");
registry.setScope("B");
assert.equal(Object.keys(registry.getThumbnails()).length, 0);
registry.receiveThumbnail("stale", image());
time = 15001;
registry.updatePresence([student("stale")]);
assert.equal(Object.keys(registry.getThumbnails()).length, 0, "unconfirmed previews expire");
registry.setScope("C");
for (const id of ["one", "two", "three"]) registry.receiveThumbnail(id, image());
registry.updatePresence([student("one", "1"), student("two", "2"), student("three", "3")]);
assert.deepEqual(Object.keys(registry.getThumbnails()), ["two", "three"], "unconfirmed images are bounded");
registry.setScope("legacy");
assert.equal(registry.updatePresence([student("a", "", " S014 "), student("b", "", "s014")]).length, 1);
registry.updatePresence([student("a", "", "s014")]);
assert.equal(registry.selectedSocketId("b"), "a", "remaining tab takes over when the chosen tab exits");

// Run the actual teacher listeners and tile click/update functions. DOM and
// transport are local doubles; this verifies UI routing, not authenticated E2E.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.classList = { add() {} }; }
  set innerHTML(value) { this.children = []; }
  get options() { return this.children; }
  appendChild(child) { this.children.push(child); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute() {}
  querySelector(selector) { return this.children.find(c => selector === "img" ? c.tag === "img" : c.className === selector.slice(1)); }
}
const source = readFileSync("public/js/teacher.js", "utf8").replace(/\r\n/g, "\n");
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const handlers = {}, sent = [], monitored = [];
const c = vm.createContext({
  console, studentTileRegistry: createStudentTileRegistry(),
  socket: { on: (name, fn) => { handlers[name] = fn; }, emit: (name, payload) => { sent.push({ name, ...payload }); } },
  document: { createElement: tag => new Element(tag) },
  tileGrid: new Element("div"), chatTargetSelect: new Element("select"),
  connectedStudentSocketIds: new Set(), latestThumbnails: {}, latestModeByStudent: {}, latestViewportByStudent: {},
  currentClassCode: "A", currentTeacherViewMode: "student", supabaseEnabled: true,
  studentListForBoardScope: [], studentNameMap: {}, studentsInfo: {},
  chatHistories: {}, unreadStudentIds: new Set(), unreadTemplateKindsByStudentId: new Map(), activeChatTargetSocketId: "",
  currentMonitoringStudentSocketId: null, notebookStudents: {},
  normalizeChatTemplateKind: value => value, CHAT_TEMPLATE_NOTICE: {}, openChatForStudent() {},
  updateModalChatTargetLabel() {}, updateStudentModalNavigation() {}, updateNotebookTile() {}, updateNotebookInfo() {},
  startMonitoringStudent: (socketId, nickname) => { c.currentMonitoringStudentSocketId = socketId; monitored.push({ socketId, nickname }); },
});
vm.runInContext(slice('socket.on("student-list-update",', 'socket.on("student-highres",'), c);
vm.runInContext(slice('function renderTiles() {', '/**\n * 生徒画面拡大モーダル'), c);
const sendImage = (id, data = "board") => handlers["student-thumbnail"]({ socketId: id, ...image(data) });
sendImage("old");
assert.equal(c.tileGrid.children.length, 0);
handlers["student-list-update"]([student("old")]);
assert.equal(c.tileGrid.children.length, 1);
c.tileGrid.children[0].listeners.click();
assert.equal(monitored.at(-1).socketId, "old");
c.activeChatTargetSocketId = "old";
c.chatHistories.old = [{ text: "keep this", timestamp: 1 }];
c.unreadStudentIds.add("old");
c.unreadTemplateKindsByStudentId.set("old", "question");
handlers["student-list-update"]([student("old"), student("new")]);
sendImage("new", "current-board");
sendImage("old", "obsolete-board");
assert.equal(c.tileGrid.children.length, 1);
assert.equal(c.tileGrid.children[0].dataset.studentSocketId, "new");
assert.equal(c.tileGrid.children[0].querySelector("img").src, "current-board");
assert.equal(c.studentsInfo.textContent, "接続中の生徒: 1人");
assert.equal(c.studentListForBoardScope.length, 1);
assert.equal(c.chatTargetSelect.options.length, 2, "one placeholder and one student");
assert.equal(c.chatTargetSelect.options[1].value, "new");
assert.equal(c.activeChatTargetSocketId, "new");
assert.equal(c.chatHistories.new[0].text, "keep this");
assert(c.unreadStudentIds.has("new"));
assert.equal(c.unreadTemplateKindsByStudentId.get("new"), "question");
Object.assign(c, {
  chatPanelOpen: false, isStudentModalChatOpenFor: () => false, updateChatBadge() {},
  appendChatMessageToHistory(id, message) { (c.chatHistories[id] ||= []).push(message); },
});
vm.runInContext(slice('socket.on("chat-message",', '// ========= ノート確認ビュー'), c);
handlers["chat-message"]({ toRole: "teacher", fromSocketId: "old", fromNickname: "s014", message: "from another tab", timestamp: 2 });
assert.equal(c.chatHistories.new.at(-1).text, "from another tab");
assert.equal(c.chatHistories.old, undefined, "another live tab does not create a second chat target");
assert.equal(monitored.at(-1).socketId, "new", "open monitoring follows the replacement connection");
assert(sent.some(x => x.name === "student-view-start-targeted" && x.targetStudentSocketId === "new"));
c.tileGrid.children[0].listeners.click();
assert.equal(monitored.at(-1).socketId, "new");
handlers["student-list-update"]([student("new")]);
sendImage("old");
assert.equal(c.tileGrid.children.length, 1);
handlers["student-list-update"]([]);
sendImage("new");
assert.equal(c.tileGrid.children.length, 0);
c.unreadStudentIds.delete("new");
handlers["student-list-update"]([student("reload")]);
assert.equal(c.chatHistories.reload[0].text, "keep this", "history survives a Presence gap during reload");
assert.equal(monitored.at(-1).socketId, "reload");
sendImage("reload");
assert.equal(c.tileGrid.children.length, 1);

// An image decode started before a connection switch must not update either
// the modal or the tiles when its onload callback eventually runs.
let decodedImage;
Object.assign(c, {
  Image: class { constructor() { decodedImage = this; this.width = 640; this.height = 480; } },
  isCurrentMonitorResponse: (id, request) => id === c.currentMonitoringStudentSocketId && request === "request",
  modalCurrentStudentMode: "whiteboard", modalShowingSavedFeedback: false,
  modalCanvas: null, modalCtx: null, modalTitle: null, modalBoard: null,
  setModalImageLayerMode() {}, updateModalRestoreFeedbackButton() {},
  completeStudentModalBoardLoad() { throw new Error("stale image completed a new modal"); },
});
vm.runInContext(slice('socket.on(\n  "student-screen-update",', 'function getStudentModalNavigationEntries()'), c);
await handlers["student-screen-update"]({ studentSocketId: "reload", nickname: "s014", monitorRequestId: "request", mode: "notebook", dataUrl: "delayed" });
assert(decodedImage);
handlers["student-list-update"]([student("replacement")]);
decodedImage.onload();
assert.equal(c.tileGrid.children.length, 0);
assert.match(readFileSync("public/teacher.html", "utf8"), /student-tiles=20260930/);
console.log("Student tiles passed: account deduplication, stable connection choice, stale images, Presence ordering, bounded pending images, class isolation, tile clicks, monitoring and chat handoff (local transport).");

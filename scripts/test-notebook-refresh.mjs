import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createThumbnailSender } from "../public/js/thumbnail-sender.mjs";
import { openNotebookCamera } from "../public/js/notebook-image.mjs";

const source = readFileSync("public/js/student.js", "utf8").replace(/\r\n/g, "\n");
function slice(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}

let time = 0, nextId = 0;
const timers = new Map();
const clock = {
  now: () => time,
  setTimer(fn, delay) { timers.set(++nextId, { fn, at: time + delay }); return nextId; },
  clearTimer(id) { timers.delete(id); },
};
async function advance(ms) {
  const end = time + ms;
  for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    time = next[1].at;
    timers.delete(next[0]);
    next[1].fn();
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }
  time = end;
}

function canvas() {
  const element = { width: 640, height: 905, frame: null };
  element.getContext = () => ({
    fillRect() {}, clearRect() {},
    drawImage(input) { element.frame = input.frame; },
    // Fine handwriting disappears in the 96x72 camera sample. Deliberately
    // return the same sample for every frame to reproduce the freeze.
    getImageData: () => ({ data: new Uint8ClampedArray(96 * 72 * 4).fill(100) }),
  });
  return element;
}
const preview = canvas(), original = canvas();
const handlers = {}, clicks = {}, sent = [], streams = [];
let failSend = false;
const warnings = [];
const c = vm.createContext({
  openNotebookCamera,
  console: { ...console, warn: (...args) => warnings.push(args), log() {} },
  setTimeout: clock.setTimer, clearTimeout: clock.clearTimer,
  createThumbnailSender: options => createThumbnailSender({ ...options, ...clock, random: () => 0.5 }),
  document: { createElement: canvas },
  currentClassCode: "CLASS", nickname: "student", viewMode: "notebook", captureMode: "whiteboard",
  CAPTURE_INTERVAL_MS: 5000, currentStream: null, notebookPreviewTimerId: null,
  highQualityMode: false, selectedCorners: [{ nx: .1, ny: .1 }, { nx: .9, ny: .1 }, { nx: .9, ny: .9 }, { nx: .1, ny: .9 }],
  previewCanvas: preview, previewCtx: preview.getContext(), srcCanvas: original, srcCtx: original.getContext(),
  videoEl: { videoWidth: 1920, videoHeight: 1080, frame: "first", play() {} },
  startCameraBtn: { addEventListener: (event, fn) => { clicks[event] = fn; } }, cameraSelect: { value: "camera" },
  navigator: { mediaDevices: { getUserMedia: async () => {
    const track = { readyState: "live", stop() { this.readyState = "ended"; } };
    const stream = { getTracks: () => [track] };
    streams.push(stream);
    return stream;
  } } },
  alert: message => { throw new Error(message); },
  updateNotebookCaptureLayout() {}, updateCornerSelectionUI() {},
  encodeCanvasForRealtime: input => input.frame,
  getOrderedCornersFromClicks: () => c.selectedCorners,
  renderPerspectiveCorrection(input, output, points) {
    assert.equal(points.length, 4);
    output.frame = `corrected:${input.frame}`;
    return true;
  },
  socket: {
    on: (event, fn) => { handlers[event] = fn; },
    emit: async (event, payload) => {
      sent.push({ event, ...payload, at: time, preview: preview.frame });
      return !failSend;
    },
  },
});
vm.runInContext(slice("function sendWhiteboardThumbnail()", "/* ========================================"), c);
vm.runInContext(slice("function drawCorrectedFrameToPreview()", "// 教員からのフィードバック画像受信"), c);
// Use the actual metadata/camera-start handler as well as the real local loop,
// sampling, rate limiter and transmission path. Canvas/transport are fixtures.
vm.runInContext("function setupPreviewCanvas() { drawCorrectedFrameToPreview(); }", c);
vm.runInContext(slice("// カメラ開始 / 再開始", "// レイアウト関連"), c);
vm.runInContext(slice("function startNotebookPreviewLoop()", "function updateNotebookCaptureLayout()"), c);
vm.runInContext(slice('const thumbnailSampleCanvas =', 'window.addEventListener("beforeunload", () => {\n  void persistStudentDraftNow();'), c);

await clicks.click(); c.videoEl.onloadedmetadata();
assert.equal(preview.frame, "corrected:first");
c.videoEl.frame = "fine writing";
await advance(5000);
assert.equal(preview.frame, "corrected:fine writing", "student preview updates while teacher list is closed");
assert.equal(sent.length, 0, "local preview does not send without a teacher list request");

handlers["student-view-start"]();
await advance(2500);
assert.equal(sent.length, 1);
const firstSample = c.sampleThumbnail();
c.videoEl.frame = "more fine writing";
assert.deepEqual(c.sampleThumbnail().pixels, firstSample.pixels);
await advance(10000);
assert(sent.some(item => item.dataUrl === "corrected:more fine writing"), "fine edits reach the teacher despite an unchanged tiny sample");
for (const item of sent) {
  assert.equal(item.dataUrl, item.preview, "teacher receives the image displayed in the student preview");
  assert.equal(item.mode, "notebook");
}
const steadyCount = sent.length;
await advance(15000);
assert(sent.length > steadyCount, "notebook images are refreshed periodically even when unchanged");
for (let i = 1; i < sent.length; i++) assert(sent[i].at - sent[i - 1].at >= 5000, "single shared send budget");

handlers["student-view-stop"]();
const stoppedCount = sent.length;
c.videoEl.frame = "teacher away";
await advance(10000);
assert.equal(sent.length, stoppedCount);
assert.equal(preview.frame, "corrected:teacher away");
handlers["student-view-start-targeted"]();
await advance(2500);
assert.equal(sent.at(-1).dataUrl, "corrected:teacher away");

failSend = true;
await advance(15000);
const failedCount = sent.length;
failSend = false;
c.videoEl.frame = "recovered";
await advance(10000);
assert(sent.length > failedCount);
assert.equal(sent.at(-1).dataUrl, "corrected:recovered");

const staleMetadata = c.videoEl.onloadedmetadata;
await clicks.click(); c.videoEl.onloadedmetadata();
staleMetadata();
assert.equal(streams[0].getTracks()[0].readyState, "ended");
handlers["student-view-stop"]();
assert.equal(timers.size, 1, "camera restart leaves only one local preview timer");
const drawImage = c.srcCtx.drawImage;
c.srcCtx.drawImage = (...args) => {
  c.srcCtx.drawImage = drawImage;
  throw new Error("transient camera read failure");
};
c.videoEl.frame = "after transient failure";
await advance(5000);
assert.equal(warnings.length, 1);
await advance(5000);
assert.equal(preview.frame, "corrected:after transient failure", "capture failure does not stop future updates");
c.viewMode = "whiteboard";
c.stopNotebookCamera();
assert.equal(timers.size, 0, "mode exit/pagehide cleanup cancels preview updates");
assert(streams.every(stream => stream.getTracks()[0].readyState === "ended"));
const finalPreview = preview.frame;
c.videoEl.frame = "after stop";
await advance(10000);
assert.equal(preview.frame, finalPreview);
assert.equal(c.currentStream, null);

console.log("Notebook refresh passed: fine edits, periodic local preview and teacher images, list stop/resume, retry, shared send budget and camera cleanup (local fixtures).");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { notebookImageSize, encodeNotebookImage, isNotebookImagePath, openNotebookCamera } from "../public/js/notebook-image.mjs";
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const studentSource = read("public/js/student.js"), teacherSource = read("public/js/teacher.js");
function slice(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const imagePath = "students/abcd-1234/realtime/abcd-5678-notebook.jpg";
for (const aspect of [297/210, 210/297, 257/182, 182/257]) {
  for (const [w, h] of [[1920,1080], [1080,1920], [2560,1440], [3840,2160]]) {
    const size = notebookImageSize(w,h,aspect);
    assert(Math.max(size.width,size.height) <= 3840);
    assert(Math.abs(size.height/size.width - aspect) < .002);
    assert(size.width > 640);
  }
}
assert.equal(notebookImageSize(0,0,1), null);
assert.equal(notebookImageSize(Infinity,1080,1), null);
// A central sheet uses its own pixels, rather than the empty camera margins.
// The same physical framing has twice the usable detail on the 4K source.
const corners=[{nx:.3,ny:.1},{nx:.7,ny:.1},{nx:.7,ny:.9},{nx:.3,ny:.9}];
const normal=notebookImageSize(1920,1080,297/210,corners);
const middle=notebookImageSize(2560,1440,297/210,corners);
const fourK=notebookImageSize(3840,2160,297/210,corners);
assert(normal.height>=1085 && normal.height<=1087);
assert(middle.height>normal.height && fourK.height>middle.height);
assert(Math.abs(fourK.height/normal.height-2)<.01);
assert.equal(notebookImageSize(3840,2160,297/210).height,3840,"4K output is no longer capped at 2560");
assert.equal(notebookImageSize(7680,4320,297/210).height,3840,"bound memory for larger sources");

// Negotiate against a camera fixture that chooses among native modes. It must
// keep the chosen device, accept lower resolutions and avoid a fake upscale.
for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]]) {
  const requests=[];
  const stream=await openNotebookCamera({
    getSupportedConstraints:()=>({resizeMode:true}),
    async getUserMedia(request) {
      requests.push(request);
      assert.equal(request.video.deviceId.exact,"selected-camera");
      assert.equal(request.audio,false);
      assert.equal(request.video.width.min,undefined);
      assert.equal(request.video.width.exact,undefined);
      assert.equal(request.video.width.ideal,3840);
      assert.equal(request.video.height.ideal,2160);
      assert.equal(request.video.resizeMode.exact,"none");
      return {getVideoTracks:()=>[{getSettings:()=>({width,height})}]};
    },
  },"selected-camera");
  assert.equal(stream.getVideoTracks()[0].getSettings().width,width);
  assert.equal(requests.length,1,"1080p/middle resolutions need no failed start");
}
for(const name of ["OverconstrainedError","NotReadableError"]) {
  const requests=[];
  const stream=await openNotebookCamera({async getUserMedia(request) {
    requests.push(request);if(requests.length===1) throw Object.assign(new Error("start"),{name});
    return {ok:true};
  }},"camera");
  assert(stream.ok);assert.equal(requests.length,2);assert.equal(requests[1].video.width.ideal,1920);
  assert.equal(requests[1].video.deviceId.exact,"camera");
}
let deniedCalls=0;
await assert.rejects(openNotebookCamera({async getUserMedia(){deniedCalls++;throw Object.assign(new Error("permission"),{name:"NotAllowedError"});}}));
assert.equal(deniedCalls,1,"permission errors are not retried");
assert(isNotebookImagePath(imagePath));
for (const path of ["https://example.com/a.jpg", "students/../secret.jpg", "shared/abcd/a.jpg", imagePath+"?foo"]) assert(!isNotebookImagePath(path));
const blob = new Blob(["high detail"], {type:"image/jpeg"});
assert.equal(await encodeNotebookImage({toBlob(fn, type, quality) {assert.equal(type,"image/jpeg"); assert.equal(quality,.92); fn(blob);}}),blob);
await assert.rejects(encodeNotebookImage({toBlob(fn) {fn(null);}}));

// Real Storage API methods: authenticated owner path, bounded replacement,
// fresh authenticated downloads, invalid inputs and upload failures.
const uploads = [], downloads = [];
let storageError = null;
const api = vm.createContext({Blob, crypto, isNotebookImagePath, assertSupabase() {},
  resolveOwner: async payload => {assert.equal(payload.nickname, undefined); return {studentId:"abcd-1234",classId:"abcd-5678"};},
  STORAGE_BUCKET:"private",
  supabase: {storage:{from(bucket) {assert.equal(bucket,"private"); return {
    async upload(...args) {uploads.push(args); return {error:storageError};},
    async download(...args) {downloads.push(args); return {data:blob};},
  };}}},
});
vm.runInContext("globalThis.api = ({"+slice(read("public/js/supabase-api.js"),"  async saveNotebookMonitorImage(","  async saveRealtimeBoardSnapshot(")+"});", api);
const a = await api.api.saveNotebookMonitorImage({classCode:"class",blob});
const b = await api.api.saveNotebookMonitorImage({classCode:"class",blob});
assert.equal(a.imagePath,imagePath); assert.equal(b.imagePath,a.imagePath); assert.notEqual(a.version,b.version);
assert.equal(uploads[0][1],blob); assert.equal(uploads[0][2].upsert,true); assert.equal(uploads[0][2].cacheControl,"0");
assert.equal(await api.api.loadNotebookMonitorImage(imagePath,a.version),blob);
assert.equal(downloads[0][1].cacheNonce,a.version); assert.equal(downloads[0][2].cache,"no-store");
await assert.rejects(api.api.loadNotebookMonitorImage("shared/secret", "v"));
storageError = new Error("upload failed");
await assert.rejects(api.api.saveNotebookMonitorImage({classCode:"class",blob}),/upload failed/);

// Actual monitoring sender: thumbnails are independent; no high-resolution
// upload without selection, after close/switch, or while the camera is stopped.
const sent = [], frames = [], saved = [];
let finishEncoding = null, finishUpload = null;
const s = vm.createContext({crypto, console, notebookImageSize,
  currentClassCode:"class",nickname:"student",viewMode:"notebook",currentStream:{},
  currentTeacherSocketId:null,currentMonitorRequestId:null,
  videoEl:{videoWidth:1920,videoHeight:1080}, getCurrentPaperAspect:()=>297/210,
  getOrderedCornersFromClicks:()=>null,
  document:{createElement:()=>({})},
  drawCorrectedFrameToCanvas:frame=>frames.push(frame),
  encodeNotebookImage:async()=>finishEncoding ? new Promise(resolve=>{finishEncoding=()=>resolve(blob);}) : blob,
  boardApi:{enabled:true,async saveNotebookMonitorImage(payload) {
    saved.push(payload); if(finishUpload) await new Promise(resolve=>{finishUpload=resolve;});
    return {imagePath,version:"version"};
  }},
  socket:{emit:async(event,payload)=>{sent.push({event,...payload});return true;}},
});
vm.runInContext(slice(studentSource,"async function sendScreenUpdate(","// すべての Realtime ハンドラ"),s);
await s.sendScreenUpdate("teacher","one"); assert.equal(saved.length,0);
s.currentTeacherSocketId="teacher";s.currentMonitorRequestId="one";
await s.sendScreenUpdate("teacher","one");
assert.equal(frames[0].height,1920);assert(frames[0].width>1300);
assert.equal(saved.length,1); assert.equal(sent[0].notebookImagePath,imagePath); assert.equal(sent[0].dataUrl,undefined);
finishEncoding=true;
const encoding=s.sendScreenUpdate("teacher","one");
s.currentMonitorRequestId="two";finishEncoding();await encoding;
assert.equal(saved.length,1,"closed/switched while encoding: do not upload");assert.equal(sent.length,1);
finishEncoding=null;finishUpload=true;
const uploading=s.sendScreenUpdate("teacher","two");
while(typeof finishUpload !== "function") await Promise.resolve();
s.currentTeacherSocketId=null;finishUpload();await uploading;
assert.equal(sent.length,1,"closed while uploading: do not notify the old modal");
finishUpload=null;s.currentTeacherSocketId="teacher";s.currentStream=null;
await s.sendScreenUpdate("teacher","two");assert.equal(saved.length,2,"stopped camera is not uploaded");

// Actual teacher receiver: downloads and image decodes can finish in either
// order or after switching/closing. Only the current frame may unlock/draw.
const handlers={}, images=[], pending=[], revoked=[], ready=[];
const t=vm.createContext({console,modalImageLoadSequence:0,
  currentMonitoringStudentSocketId:"student",currentModalMonitorRequestId:"one",
  modalCurrentStudentMode:"notebook",modalShowingSavedFeedback:false,
  latestModeByStudent:{},latestViewportByStudent:{},studentNameMap:{},
  modalTitle:null,modalBoard:{setShowGrid(){},render(){}},modalCanvas:{width:800,height:600},modalCtx:{},
  modalImageViewportKey:"",modalImageElement:null,
  setModalImageLayerMode(){},updateModalRestoreFeedbackButton(){},fitModalImageViewport(){},
  isCurrentMonitorResponse:(id,request)=>id===t.currentMonitoringStudentSocketId && request===t.currentModalMonitorRequestId,
  studentTileRegistry:{selectedSocketId:()=>t.currentMonitoringStudentSocketId,receiveThumbnail:()=>false},
  document:{createElement:()=>({getContext:()=>null})},
  boardApi:{loadNotebookMonitorImage:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},
  URL:{createObjectURL:()=>`blob:${images.length}`,revokeObjectURL:url=>revoked.push(url)},
  Image:class {constructor(){this.naturalWidth=this.width=1358;this.naturalHeight=this.height=1920;images.push(this);}},
  completeStudentModalBoardLoad:()=>ready.push(true),
  socket:{on:(event,fn)=>{handlers[event]=fn;}},
});
vm.runInContext(slice(teacherSource,'socket.on(\n  "student-screen-update",','function getStudentModalNavigationEntries()'),t);
const payload={studentSocketId:"student",nickname:"student",mode:"notebook",monitorRequestId:"one",notebookImagePath:imagePath,notebookImageVersion:"version"};
const first=handlers["student-screen-update"](payload);
const second=handlers["student-screen-update"](payload);
pending[1].resolve(blob);await second;images[0].onload();
assert.equal(ready.length,1);assert.equal(t.modalImageElement,images[0]);
pending[0].resolve(blob);await first;assert.equal(images.length,1,"older download is discarded");
const lateDecode=handlers["student-screen-update"](payload);
pending.at(-1).resolve(blob);await lateDecode;
t.currentModalMonitorRequestId="two";images.at(-1).onload();
assert.equal(ready.length,1);assert.equal(t.modalImageElement,images[0]);assert.equal(revoked.length,2);
const closed=handlers["student-screen-update"]({...payload,monitorRequestId:"two"});
t.currentMonitoringStudentSocketId=null;pending.at(-1).resolve(blob);await closed;
assert.equal(images.length,2,"closed modal never decodes the downloaded image");
t.currentMonitoringStudentSocketId="student";
const failure=handlers["student-screen-update"]({...payload,monitorRequestId:"two"});
pending.at(-1).reject(new Error("download failure"));await failure;
const retry=handlers["student-screen-update"]({...payload,monitorRequestId:"two"});
pending.at(-1).resolve(blob);await retry;images.at(-1).onload();assert.equal(ready.length,2);

// Both tile entry points must open the monitored modal for an online student.
let openedStudent;
const notebookTile=vm.createContext({studentListForBoardScope:[{socketId:"student",nickname:"login"}],
  studentTileRegistry:{selectedSocketId:id=>id},startMonitoringStudent:id=>{openedStudent=id;}});
vm.runInContext(slice(teacherSource,"function openFeedbackModal(","function closeFeedbackModal("),notebookTile);
notebookTile.openFeedbackModal("login");assert.equal(openedStudent,"student");

console.log("Notebook modal passed: independent detail, Storage/nonce, selection, close/switch during encode/upload/download/decode, ordering, recovery (local fixtures).");

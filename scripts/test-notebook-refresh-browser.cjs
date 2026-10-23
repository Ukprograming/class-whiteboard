// Full student UI + actual teacher notebook receiver/tile code, synthetic video
// and local transport. This does not test authenticated Supabase or real cameras.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const teacherSource = read('public/js/teacher.js');
function slice(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const backend = `
export const supabaseEnabled=false, supabase=null;
export const authApi={}, assignmentApi={}, boardApi={
  enabled:true,
  getActiveSharedBoard:async()=>({sharedBoard:null}),
  async saveNotebookMonitorImage({blob}) {
    const dataUrl=await new Promise(resolve=>{const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.readAsDataURL(blob)});
    return window.saveNotebookFrame(dataUrl);
  },
}, managementApi={};
export const getStudentLoginHints=()=>[];
export function createRealtimeBridge(){
  const handlers={};
  return window.fixtureBridge={
    on(event,fn){(handlers[event]||=[]).push(fn)},
    receive(event,payload){for(const fn of handlers[event]||[])fn(payload)},
    async emit(event,payload){
      if(event==='student-thumbnail'){
        window.fixtureSent.push({at:performance.now(),...payload});
        await window.deliverThumbnail(payload);
      }
      if(event==='student-screen-update'){
        window.fixtureMonitorSent.push(payload);
        await window.deliverMonitor(payload);
      }
      return true;
    }
  };
}`;
const teacherHtml = `<!doctype html><meta charset="utf-8"><div id="notebookInfo"></div><div id="notebookStudentGrid"></div>
<div id="fixtureModal" style="position:relative;width:800px;height:600px"><canvas id="modalCanvas" width="800" height="600" style="width:800px;height:600px"></canvas><canvas id="overlay" width="800" height="600" style="position:absolute;inset:0;pointer-events:none"></canvas></div><script type="module">
import {createStudentTileRegistry} from '/js/student-tile-registry.mjs';
const studentTileRegistry=createStudentTileRegistry();
const currentClassCode='TEST';
studentTileRegistry.setScope(currentClassCode);
studentTileRegistry.updatePresence([{socketId:'student-socket',nickname:'student'}]);
let latestThumbnails={},latestModeByStudent={},latestViewportByStudent={},studentNameMap={},notebookStudents={};
const notebookInfo=document.querySelector('#notebookInfo'), notebookStudentGrid=document.querySelector('#notebookStudentGrid');
const socket={on(event,handler){if(event==='student-thumbnail')window.receiveThumbnail=handler; if(event==='student-screen-update')window.receiveMonitor=handler}};
const modalCanvas=document.querySelector('#modalCanvas'), modalCtx=modalCanvas.getContext('2d');
let modalCurrentStudentMode='notebook', currentMonitoringStudentSocketId=null, currentModalMonitorRequestId=null;
let modalShowingSavedFeedback=false;
const modalTitle=null;
const modalBoard={scale:1,offsetX:0,offsetY:0,setShowGrid(){},render(){renderModalImageLayer()}};
function isCurrentMonitorResponse(id,request){return id===currentMonitoringStudentSocketId && request===currentModalMonitorRequestId}
function setModalImageLayerMode(){} function updateModalRestoreFeedbackButton(){} function renderTiles(){}
let readyCount=0;
function completeStudentModalBoardLoad(){readyCount++}
const boardApi={async loadNotebookMonitorImage(path,version){const dataUrl=await window.loadNotebookFrame(path,version);return (await fetch(dataUrl)).blob()}};
${slice(teacherSource, 'let modalImageElement = null;', '// ★ 追加: ノート提出モード用に')}
${slice(teacherSource, 'socket.on(\n  "student-screen-update",', 'function getStudentModalNavigationEntries()')}
window.openNotebook=request=>{currentMonitoringStudentSocketId='student-socket';currentModalMonitorRequestId=request;clearModalImageViewport()};
window.closeNotebook=()=>{currentMonitoringStudentSocketId=null;currentModalMonitorRequestId=null};
window.modalState=()=>({width:modalImageElement?.naturalWidth,height:modalImageElement?.naturalHeight,readyCount,scale:modalBoard.scale,offsetX:modalBoard.offsetX});
window.zoomNotebook=()=>{modalBoard.scale*=1.5;modalBoard.offsetX-=40;modalBoard.render()};
function updateStudentTilePreview(){} function openFeedbackModal(){}
${slice(teacherSource, 'function updateNotebookInfo()', '/** ★ 追加: 生徒モーダル内')}
${slice(teacherSource, 'socket.on("student-thumbnail",', '// ★ ここを「Canvasベースのモーダル表示」に修正')}
window.teacherImage=()=>notebookStudents.student?.latestImageData;
</script>`;

async function main(cameraWidth=1920,cameraHeight=1080) {
  fs.mkdirSync('output/playwright/notebook-refresh', { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    await context.addInitScript(({cameraWidth,cameraHeight}) => {
      window.pdfjsLib = { GlobalWorkerOptions: {} };
      window.fixtureSent = [];
      window.fixtureMonitorSent = [];
      window.fixtureCameraRequests = [];
      const source = document.createElement('canvas');
      source.width = cameraWidth; source.height = cameraHeight;
      window.paintNotebook = revision => {
        window.fixtureRevision = revision;
        const ctx = source.getContext('2d');
        ctx.setTransform(cameraWidth/1920,0,0,cameraHeight/1080,0,0);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = '#1e293b'; ctx.font = '40px sans-serif';
        ctx.fillText('Notebook', 600, 300);
        ctx.font='12px sans-serif';
        for(let y=330;y<850;y+=15) for(let x=500;x<1450;x+=55) ctx.fillText('細字12ab',x,y);
        // A short, fine line is visible in the corrected image but below the
        // camera noise threshold in the 96x72 thumbnail sample.
        if (revision > 0) ctx.fillRect(800, 500, 100, 3);
        if (revision > 1) ctx.fillRect(800, 515, 100, 3);
      };
      window.paintNotebook(0);
      window.fixtureStreams = [];
      navigator.mediaDevices.getUserMedia = async request => {
        window.fixtureCameraRequests.push(request);
        const stream = source.captureStream(0);
        const track = stream.getVideoTracks()[0];
        setInterval(() => {
          if (track.readyState === 'live') {
            window.paintNotebook(window.fixtureRevision);
            track.requestFrame();
          }
        }, 100);
        window.fixtureStreams.push(stream);
        return stream;
      };
      navigator.mediaDevices.enumerateDevices = async () => [{kind:'videoinput',deviceId:'fixture',label:'Synthetic notebook'}];
    },{cameraWidth,cameraHeight});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'localhost') return route.abort();
      if (url.pathname === '/teacher-fixture') return route.fulfill({ contentType: 'text/html', body: teacherHtml });
      if (url.pathname === '/js/supabase-api.js') return route.fulfill({ contentType: 'text/javascript', body: backend });
      if (['/js/app-config.js','/js/local-config-loader.js','/js/legacy-socket-loader.js'].includes(url.pathname))
        return route.fulfill({ contentType: 'text/javascript', body: '' });
      const file = path.resolve('public', '.' + url.pathname);
      if (!file.startsWith(path.resolve('public') + path.sep) || !fs.existsSync(file)) return route.fulfill({ status:404, body:'' });
      let body = fs.readFileSync(file);
      if (url.pathname === '/js/student.js') body = body.toString() + `
window.notebookFixture={sample:sampleThumbnail,corners:()=>selectedCorners.length};`;
      const types = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml' };
      return route.fulfill({ contentType:types[path.extname(file)] || 'application/octet-stream', body });
    });
    const teacher = await context.newPage(), student = await context.newPage();
    const notebookFrames=new Map();
    let notebookUploads=0,notebookDownloads=0;
    await student.exposeFunction('saveNotebookFrame', dataUrl=>{
      const imagePath='students/abcd-1234/realtime/abcd-5678-notebook.jpg';
      notebookFrames.set(imagePath,dataUrl);notebookUploads++;
      return {imagePath,version:String(notebookUploads)};
    });
    await teacher.exposeFunction('loadNotebookFrame', imagePath=>{notebookDownloads++;return notebookFrames.get(imagePath)});
    for (const page of [teacher, student]) {
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      page.on('dialog', async dialog => { errors.push(dialog.message()); console.error(dialog.message()); await dialog.dismiss(); });
    }
    await teacher.goto('http://localhost:3000/teacher-fixture');
    await teacher.waitForFunction(() => !!window.receiveThumbnail);
    await student.exposeFunction('deliverThumbnail', payload => teacher.evaluate(payload =>
      window.receiveThumbnail({socketId:'student-socket',...payload}), payload));
    await student.exposeFunction('deliverMonitor', payload => teacher.evaluate(payload =>
      window.receiveMonitor({studentSocketId:'student-socket',nickname:'student',...payload}), payload));
    await student.goto('http://localhost:3000/student.html');
    await student.waitForFunction(() => !!window.notebookFixture);
    await student.evaluate(() => fixtureBridge.receive('join-success', {classCode:'TEST',nickname:'student'}));
    await student.locator('#studentModeNotebook').click();
    await student.locator('#startCameraBtn').click();
    await student.waitForFunction(() => document.querySelector('#video').videoWidth > 0, null, {timeout:10000}).catch(async error => {
      console.log(await student.evaluate(() => {
        const v=document.querySelector('#video');
        return {streams:fixtureStreams.length,src:!!v.srcObject,readyState:v.readyState,paused:v.paused,tracks:v.srcObject?.getTracks().map(t=>({state:t.readyState,settings:t.getSettings()})),errors:window.notebookFixture.corners()};
      }));
      throw error;
    });
    const layouts = [];
    const auditLayout = async (phase, width, height) => {
      await student.setViewportSize({width, height});
      await student.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await student.evaluate(() => {
        const root = document.querySelector('#notebookLayout');
        const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
        const panels = [...root.querySelectorAll('.video-section,.preview-section,.feedback-section')].filter(visible).map(element => {
          const r = element.getBoundingClientRect();
          return {name:element.className, x:r.x, y:r.y, width:r.width, height:r.height};
        });
        const overflow = [...root.querySelectorAll('button,select,.video-section,.preview-section,.feedback-section')].filter(visible).filter(element => {
          const r = element.getBoundingClientRect();
          return r.left < -1 || r.right > innerWidth+1;
        }).map(element => element.id || element.className);
        return {panels, overflow, rootOverflow:root.scrollWidth-root.clientWidth};
      });
      if (layout.rootOverflow > 1 || layout.overflow.length) {
        console.log(JSON.stringify({phase,width,height,...layout}));
        await student.screenshot({path:'output/playwright/notebook-refresh/layout-failure.png'});
      }
      assert.deepEqual(layout.overflow, [], `${phase} controls fit at ${width}x${height}`);
      assert(layout.rootOverflow <= 1, `${phase} no horizontal scroll at ${width}x${height}`);
      assert.equal(layout.panels.length, phase === 'camera' ? 1 : 2);
      assert(layout.panels.every(panel => panel.width > 250 && panel.height > 200));
      if (phase === 'camera') assert(layout.panels[0].name.includes('video-section'));
      else if (width > 760) {
        assert(Math.abs(layout.panels[0].y-layout.panels[1].y) < 1, 'side by side on tablets and desktops');
        assert(layout.panels[1].x > layout.panels[0].x);
      } else {
        assert(layout.panels[1].y > layout.panels[0].y, 'stacked on narrow screens');
      }
      layouts.push({phase,width,height,...layout});
      if ([1366,768,375].includes(width)) await student.screenshot({path:`output/playwright/notebook-refresh/${phase}-${width}.png`});
    };
    const selectCorners = async () => {
      await student.locator('.notebook-camera-stage').scrollIntoViewIfNeeded();
      const rect = await student.evaluate(() => {
        const stage=document.querySelector('.notebook-camera-stage'), r=stage.getBoundingClientRect();
        const v=document.querySelector('#video'), scale=Math.min(stage.clientWidth/v.videoWidth,stage.clientHeight/v.videoHeight);
        return {x:r.x+(stage.clientWidth-v.videoWidth*scale)/2,y:r.y+(stage.clientHeight-v.videoHeight*scale)/2,width:v.videoWidth*scale,height:v.videoHeight*scale};
      });
      for (const [x,y] of [[.2,.15],[.8,.2],[.85,.85],[.15,.8]]) await student.mouse.click(rect.x+rect.width*x,rect.y+rect.height*y);
    };
    await auditLayout('camera',1366,900);
    assert(await student.locator('#undoCornerBtn').isDisabled());
    const box = await student.locator('#cornerSelectionCanvas').boundingBox();
    // Video is contained in the stage. Use its actual contained rectangle.
    const rect = await student.evaluate(() => {
      const stage = document.querySelector('.notebook-camera-stage'), r = stage.getBoundingClientRect();
      const video=document.querySelector('#video');
      const scale = Math.min(stage.clientWidth/video.videoWidth, stage.clientHeight/video.videoHeight);
      return { x:r.x+(stage.clientWidth-video.videoWidth*scale)/2, y:r.y+(stage.clientHeight-video.videoHeight*scale)/2, width:video.videoWidth*scale, height:video.videoHeight*scale };
    });
    assert(box && rect.width > 0);
    for (const [x,y] of [[.2,.15],[.8,.2],[.85,.85],[.15,.8]]) await student.mouse.click(rect.x+rect.width*x,rect.y+rect.height*y);
    assert.equal(await student.evaluate(() => notebookFixture.corners()), 4);
    const initial = await student.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
    const sample = await student.evaluate(() => [...notebookFixture.sample().pixels]);
    await student.evaluate(() => paintNotebook(1));
    await student.waitForFunction(before => document.querySelector('#previewCanvas').toDataURL() !== before, initial, {timeout:12000});
    assert.equal(await student.evaluate(() => fixtureSent.length), 0, 'local preview works without teacher list');
    assert.equal(notebookUploads,0,'unselected students do not upload high-resolution images');
    const nextSample = await student.evaluate(() => [...notebookFixture.sample().pixels]);
    const { thumbnailChanged } = await import('../public/js/thumbnail-sender.mjs');
    assert(!thumbnailChanged({key:'camera',pixels:sample,noisy:true},{key:'camera',pixels:nextSample,noisy:true}), 'fine edit reproduces old change-detection blind spot');
    await student.evaluate(() => fixtureBridge.receive('student-view-start', {}));
    await teacher.waitForFunction(() => !!teacherImage());
    await teacher.waitForFunction(() => document.querySelector('#notebookStudentGrid canvas')?.getContext('2d').getImageData(160,120,1,1).data[3] === 255);
    const first = await teacher.evaluate(() => teacherImage());
    const firstTile = await teacher.locator('#notebookStudentGrid canvas').evaluate(canvas => canvas.toDataURL());
    await student.evaluate(() => paintNotebook(2));
    await teacher.waitForFunction(before => teacherImage() !== before, first, {timeout:15000});
    await teacher.waitForFunction(before => document.querySelector('#notebookStudentGrid canvas').toDataURL() !== before, firstTile);
    // Real sender, perspective correction, JPEG encoding, receiver, image
    // decoding and canvas rendering; Storage/Realtime are local fixtures.
    await teacher.evaluate(()=>openNotebook('modal-one'));
    await student.evaluate(()=>fixtureBridge.receive('start-monitoring',{teacherSocketId:'teacher',monitorRequestId:'modal-one'}));
    await teacher.waitForFunction(()=>modalState().height>0);
    const high=await teacher.evaluate(()=>modalState());
    assert(high.width>=cameraWidth*.69 && high.height>=cameraWidth*.98);
    assert(high.height<=cameraWidth && high.height<=3840);
    const actualCamera=await student.locator('#video').evaluate(video=>({width:video.videoWidth,height:video.videoHeight}));
    assert.deepEqual(actualCamera,{width:cameraWidth,height:cameraHeight});
    assert.equal(await student.evaluate(()=>fixtureCameraRequests[0].video.width.ideal),3840);
    assert.equal(await student.locator('#previewCanvas').evaluate(canvas=>canvas.width),640,'list preview stays lightweight while modal is open');
    assert([...notebookFrames.values()][0].length>120000,'detail exceeds the old Realtime image budget');
    assert(await student.evaluate(()=>fixtureMonitorSent.every(payload=>!payload.dataUrl && payload.notebookImagePath)));
    await teacher.evaluate(()=>{
      const ctx=document.querySelector('#overlay').getContext('2d');ctx.fillStyle='#e34a55';ctx.fillRect(300,250,80,5);
      zoomNotebook();
    });
    const zoomed=await teacher.evaluate(()=>modalState());
    const annotation=await teacher.locator('#overlay').evaluate(canvas=>canvas.toDataURL());
    await student.evaluate(()=>paintNotebook(1));
    await teacher.waitForFunction(before=>modalState().readyCount>before,zoomed.readyCount);
    const updated=await teacher.evaluate(()=>modalState());
    assert.equal(updated.scale,zoomed.scale);assert.equal(updated.offsetX,zoomed.offsetX);
    assert.equal(await teacher.locator('#overlay').evaluate(canvas=>canvas.toDataURL()),annotation,'refresh retains annotations');
    assert(await teacher.locator('#modalCanvas').evaluate(canvas=>canvas.getContext('2d').getImageData(400,300,1,1).data[3]===255));
    await teacher.screenshot({path:'output/playwright/notebook-refresh/high-resolution-modal.png'});
    await teacher.screenshot({path:`output/playwright/notebook-refresh/high-resolution-modal-${cameraWidth}.png`});
    await teacher.evaluate(()=>closeNotebook());
    await student.evaluate(()=>fixtureBridge.receive('stop-monitoring',{monitorRequestId:'modal-one'}));
    const uploadsAfterClose=notebookUploads;
    // Reopen immediately, then ensure an obsolete stop cannot cancel the new session.
    await teacher.evaluate(()=>openNotebook('modal-two'));
    await student.evaluate(()=>{
      fixtureBridge.receive('start-monitoring',{teacherSocketId:'teacher',monitorRequestId:'modal-two'});
      fixtureBridge.receive('stop-monitoring',{monitorRequestId:'modal-one'});
    });
    await teacher.waitForFunction(height=>modalState().height===height,high.height);
    assert(notebookUploads>uploadsAfterClose);
    await teacher.evaluate(()=>closeNotebook());
    await student.evaluate(()=>fixtureBridge.receive('stop-monitoring',{monitorRequestId:'modal-two'}));
    const finalUploadCount=notebookUploads;
    await student.screenshot({path:'output/playwright/notebook-refresh/student.png'});
    await teacher.screenshot({path:'output/playwright/notebook-refresh/teacher.png'});
    await student.evaluate(() => fixtureBridge.receive('student-view-stop', {}));
    const sentCount = await student.evaluate(() => fixtureSent.length);
    const last = await student.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
    await student.evaluate(() => paintNotebook(0));
    await student.waitForFunction(before => document.querySelector('#previewCanvas').toDataURL() !== before, last, {timeout:12000});
    assert.equal(await student.evaluate(() => fixtureSent.length), sentCount);
    assert.equal(notebookUploads,finalUploadCount,'closing modal stops high-resolution uploads while camera continues');
    const cameraResult={source:actualCamera,modal:{width:high.width,height:high.height},previewWidth:640,notebookUploads,notebookDownloads,annotationsAndZoomPreserved:true,closeStopsUploads:true,reopen:true,errors,boundary:'Synthetic camera and local transport; real hardware and authenticated Supabase unverified'};
    if(cameraWidth!==1920) {
      await student.locator('#resetPerspectiveBtn').click();
      await student.locator('#startCameraBtn').click();
      await student.waitForFunction(()=>fixtureStreams.length===2 && document.querySelector('#video').srcObject===fixtureStreams[1]);
      await student.locator('#studentModeWhiteboard').click();
      assert(await student.evaluate(()=>fixtureStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));
      assert.deepEqual(errors,[]);
      fs.writeFileSync(`output/playwright/notebook-refresh/camera-${cameraWidth}.json`,JSON.stringify(cameraResult,null,2));
      console.log(JSON.stringify(cameraResult,null,2));
      return cameraResult;
    }
    const viewports = [[1366,900],[1024,768],[768,1024],[683,384],[375,667],[320,568]];
    assert(!await student.locator('#feedbackExpandBtn').isVisible(), 'empty feedback has no inactive controls');
    await student.evaluate(() => {
      const canvas=document.createElement('canvas');
      canvas.width=640; canvas.height=905;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(document.querySelector('#previewCanvas'),0,0,640,905);
      ctx.strokeStyle='#e34a55'; ctx.lineWidth=5;
      ctx.beginPath(); ctx.arc(230,440,80,0,Math.PI*2); ctx.stroke();
      window.layoutFeedback=canvas.toDataURL();
      fixtureBridge.receive('teacherSharedImage',{imageData:window.layoutFeedback});
    });
    await student.waitForFunction(() => document.querySelector('.feedback-section').classList.contains('has-feedback'));
    for (const [width,height] of viewports) await auditLayout('corrected',width,height);
    for (const width of [375,320]) {
      await student.setViewportSize({width,height:667});
      await student.locator('.feedback-section').scrollIntoViewIfNeeded();
      if (width===375) await student.screenshot({path:'output/playwright/notebook-refresh/corrected-feedback-375.png'});
      await student.locator('#feedbackExpandBtn').click();
      await student.locator('#feedbackZoomInBtn').click();
      const fits = await student.locator('.feedback-section').evaluate(section => [...section.querySelectorAll('button')].filter(e=>e.getClientRects().length).every(e=>{
        const r=e.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;
      }));
      assert(fits,`expanded feedback controls fit at ${width}px`);
      await student.locator('#feedbackExpandBtn').click();
    }
    await student.setViewportSize({width:1366,height:900});
    await student.locator('#feedbackExpandBtn').click();
    await student.locator('#feedbackZoomInBtn').click();
    await student.keyboard.press('Escape');
    assert(!await student.locator('#feedbackZoomInBtn').isVisible());
    await student.locator('#resetPerspectiveBtn').click();
    assert.equal(await student.evaluate(() => notebookFixture.corners()),0);
    // Receiving feedback while its panel is hidden must fit correctly on return.
    await student.evaluate(() => fixtureBridge.receive('teacherSharedImage',{imageData:window.layoutFeedback}));
    for (const [width,height] of viewports) await auditLayout('camera',width,height);
    await student.setViewportSize({width:1366,height:900});
    const firstCorner = await student.locator('.notebook-camera-stage').boundingBox();
    await student.mouse.click(firstCorner.x+firstCorner.width*.3,firstCorner.y+firstCorner.height*.3);
    assert.equal(await student.evaluate(() => notebookFixture.corners()),1);
    await student.locator('#undoCornerBtn').click();
    assert.equal(await student.evaluate(() => notebookFixture.corners()),0);
    await student.locator('#cameraExpandBtn').click();
    await selectCorners();
    assert.equal(await student.evaluate(() => notebookFixture.corners()),4);
    assert(!await student.evaluate(() => document.body.classList.contains('notebook-panel-expanded')),'completing expanded camera closes expansion');
    await student.waitForFunction(() => {
      const image=document.querySelector('#feedbackImage'), viewport=document.querySelector('#feedbackViewport');
      const r=image.getBoundingClientRect(), v=viewport.getBoundingClientRect();
      return r.width>0 && r.height>0 && r.left>=v.left-1 && r.right<=v.right+1 && r.top>=v.top-1 && r.bottom<=v.bottom+1;
    });
    await student.locator('#resetPerspectiveBtn').click();
    await student.locator('#startCameraBtn').click();
    await student.waitForFunction(() => fixtureStreams.length === 2 && document.querySelector('#video').srcObject === fixtureStreams[1]);
    assert(await student.evaluate(() => fixtureStreams[0].getTracks().every(track => track.readyState === 'ended')));
    await student.locator('#studentModeWhiteboard').click();
    assert(await student.evaluate(() => fixtureStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))));
    const times = await student.evaluate(() => fixtureSent.map(item => item.at));
    for (let i=1;i<times.length;i++) assert(times[i]-times[i-1]>=5000);
    assert.deepEqual(errors, []);
    const result = {highResolutionModal:{width:high.width,height:high.height,notebookUploads,notebookDownloads,annotationsAndZoomPreserved:true,closeStopsUploads:true,reopen:true},fourCornerCorrection:true,fineEditBelowNoiseThreshold:true,localPreviewWithoutTeacher:true,teacherNotebookTileUpdated:true,listStopKeepsPreview:true,cameraRestartAndExit:true,undoCorner:true,expandedCorrectionTransition:true,hiddenFeedbackFitsOnReturn:true,layouts,sendIntervalsMs:times.slice(1).map((t,i)=>t-times[i]),errors,boundary:'Synthetic camera and local transport; real devices and authenticated Supabase unverified'};
    fs.writeFileSync('output/playwright/notebook-refresh/results.json',JSON.stringify(result,null,2));
    fs.writeFileSync(`output/playwright/notebook-refresh/camera-${cameraWidth}.json`,JSON.stringify(cameraResult,null,2));
    console.log(JSON.stringify(result,null,2));
    return cameraResult;
  } finally { await browser.close(); }
}
async function runCameras() {
  const results=[];
  for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]]) results.push(await main(width,height));
  assert(results[0].modal.width<results[1].modal.width && results[1].modal.width<results[2].modal.width);
  assert(results[2].modal.height>2560,'4K detail passes the previous output limit');
  fs.writeFileSync('output/playwright/notebook-refresh/camera-resolutions.json',JSON.stringify(results,null,2));
}
runCameras().catch(error => { console.error(error); process.exitCode=1; });

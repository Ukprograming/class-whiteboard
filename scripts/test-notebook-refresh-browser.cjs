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
export const authApi={}, assignmentApi={}, boardApi={enabled:false}, managementApi={};
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
      return true;
    }
  };
}`;
const teacherHtml = `<!doctype html><meta charset="utf-8"><div id="notebookInfo"></div><div id="notebookStudentGrid"></div><script type="module">
import {createStudentTileRegistry} from '/js/student-tile-registry.mjs';
const studentTileRegistry=createStudentTileRegistry();
const currentClassCode='TEST';
studentTileRegistry.setScope(currentClassCode);
studentTileRegistry.updatePresence([{socketId:'student-socket',nickname:'student'}]);
let latestThumbnails={},latestModeByStudent={},latestViewportByStudent={},studentNameMap={},notebookStudents={};
const notebookInfo=document.querySelector('#notebookInfo'), notebookStudentGrid=document.querySelector('#notebookStudentGrid');
const socket={on(event,handler){if(event==='student-thumbnail')window.receiveThumbnail=handler}};
function updateStudentTilePreview(){} function openFeedbackModal(){}
${slice(teacherSource, 'function updateNotebookInfo()', '/** ★ 追加: 生徒モーダル内')}
${slice(teacherSource, 'socket.on("student-thumbnail",', '// ★ ここを「Canvasベースのモーダル表示」に修正')}
window.teacherImage=()=>notebookStudents.student?.latestImageData;
</script>`;

async function main() {
  fs.mkdirSync('output/playwright/notebook-refresh', { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    await context.addInitScript(() => {
      window.pdfjsLib = { GlobalWorkerOptions: {} };
      window.fixtureSent = [];
      const source = document.createElement('canvas');
      source.width = 1920; source.height = 1080;
      window.paintNotebook = revision => {
        window.fixtureRevision = revision;
        const ctx = source.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, source.width, source.height);
        ctx.fillStyle = '#1e293b'; ctx.font = '40px sans-serif';
        ctx.fillText('Notebook', 600, 300);
        // A short, fine line is visible in the corrected image but below the
        // camera noise threshold in the 96x72 thumbnail sample.
        if (revision > 0) ctx.fillRect(800, 500, 100, 3);
        if (revision > 1) ctx.fillRect(800, 515, 100, 3);
      };
      window.paintNotebook(0);
      window.fixtureStreams = [];
      navigator.mediaDevices.getUserMedia = async () => {
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
    });
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
    for (const page of [teacher, student]) {
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      page.on('dialog', async dialog => { errors.push(dialog.message()); console.error(dialog.message()); await dialog.dismiss(); });
    }
    await teacher.goto('http://localhost:3000/teacher-fixture');
    await teacher.waitForFunction(() => !!window.receiveThumbnail);
    await student.exposeFunction('deliverThumbnail', payload => teacher.evaluate(payload =>
      window.receiveThumbnail({socketId:'student-socket',...payload}), payload));
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
      const scale = Math.min(stage.clientWidth/1920, stage.clientHeight/1080);
      return { x:r.x+(stage.clientWidth-1920*scale)/2, y:r.y+(stage.clientHeight-1080*scale)/2, width:1920*scale, height:1080*scale };
    });
    assert(box && rect.width > 0);
    for (const [x,y] of [[.2,.15],[.8,.2],[.85,.85],[.15,.8]]) await student.mouse.click(rect.x+rect.width*x,rect.y+rect.height*y);
    assert.equal(await student.evaluate(() => notebookFixture.corners()), 4);
    const initial = await student.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
    const sample = await student.evaluate(() => [...notebookFixture.sample().pixels]);
    await student.evaluate(() => paintNotebook(1));
    await student.waitForFunction(before => document.querySelector('#previewCanvas').toDataURL() !== before, initial, {timeout:12000});
    assert.equal(await student.evaluate(() => fixtureSent.length), 0, 'local preview works without teacher list');
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
    await student.screenshot({path:'output/playwright/notebook-refresh/student.png'});
    await teacher.screenshot({path:'output/playwright/notebook-refresh/teacher.png'});
    await student.evaluate(() => fixtureBridge.receive('student-view-stop', {}));
    const sentCount = await student.evaluate(() => fixtureSent.length);
    const last = await student.locator('#previewCanvas').evaluate(canvas => canvas.toDataURL());
    await student.evaluate(() => paintNotebook(0));
    await student.waitForFunction(before => document.querySelector('#previewCanvas').toDataURL() !== before, last, {timeout:12000});
    assert.equal(await student.evaluate(() => fixtureSent.length), sentCount);
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
    const result = {fourCornerCorrection:true,fineEditBelowNoiseThreshold:true,localPreviewWithoutTeacher:true,teacherNotebookTileUpdated:true,listStopKeepsPreview:true,cameraRestartAndExit:true,undoCorner:true,expandedCorrectionTransition:true,hiddenFeedbackFitsOnReturn:true,layouts,sendIntervalsMs:times.slice(1).map((t,i)=>t-times[i]),errors,boundary:'Synthetic camera and local transport; real devices and authenticated Supabase unverified'};
    fs.writeFileSync('output/playwright/notebook-refresh/results.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode=1; });

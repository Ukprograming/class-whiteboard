// Actual student page/canvas with a fixture transport; not authenticated production E2E.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const fixtureApi = `
export const supabaseEnabled = true;
export const authApi = { getStudentSession: async () => ({classCode:'TEST',studentLoginId:'one'}), signOut:async()=>{} };
export const getStudentLoginHints = () => [];
export const assignmentApi = {listPendingStudentAssignments:async()=>({assignments:[]})};
export const boardApi = {enabled:true,getActiveSharedBoard:async()=>null,saveRealtimeBoardSnapshot:async()=>({snapshotPath:'fixture',assetReferences:[]})};
export function createRealtimeBridge(){
  const handlers = new Map();
  window.fixtureReceive = (name,payload={}) => (handlers.get(name)||[]).forEach(fn=>fn(payload));
  window.fixtureMessages=[];
  return {on(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn)},
    emit:async(name,payload)=>{window.fixtureMessages.push({name,payload,at:performance.now()});return !window.fixtureFail},connected:true};
}
`;

async function main() {
  const root = path.resolve('public');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    const page = await browser.newPage({viewport:{width:1100,height:800}});
    const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const fulfill = body => route.fulfill({contentType:'text/javascript',body});
      if(url.pathname.endsWith('/js/supabase-api.js')) return fulfill(fixtureApi);
      if(url.pathname.endsWith('/js/student-forms.js')) return fulfill('export function initStudentForms(){return {}}');
      if(url.pathname.endsWith('/js/app-config.local.js')) return fulfill('');
      if(url.pathname.endsWith('/js/board-ui.js')) return fulfill(fs.readFileSync('public/js/board-ui.js','utf8').replace('  return wb;', '  window.fixtureBoard=wb; return wb;'));
      if(url.hostname!=='127.0.0.1') return fulfill('window.pdfjsLib={GlobalWorkerOptions:{}};');
      return route.continue();
    });
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}/student.html`);
    await page.waitForFunction(()=>window.fixtureBoard && document.getElementById('studentLoginOverlay')?.classList.contains('hidden'));
    const count=()=>page.evaluate(()=>fixtureMessages.filter(m=>m.name==='student-thumbnail').length);
    await page.evaluate(()=>fixtureReceive('student-view-start'));
    await page.clock.runFor(3000);
    assert.equal(await count(),1,'initial blank canvas');
    await page.clock.runFor(15000);
    assert.equal(await count(),1,'static actual canvas');
    await page.evaluate(()=>fixtureBoard.applyAction({type:'object',object:{id:101,kind:'text',text:'更新テスト',x:50,y:50,width:200,height:70,fontSize:28,color:'#000000'}}));
    await page.clock.runFor(3000);
    assert.equal(await count(),2,'changed canvas resumes');
    await page.evaluate(()=>{fixtureReceive('realtime-reconnected',{classCode:'TEST'});fixtureReceive('student-view-start-targeted');});
    await page.clock.runFor(1000);
    assert.equal(await count(),2,'reconnect and start share cooldown');
    await page.clock.runFor(7000);
    assert.equal(await count(),3,'forced refresh after cooldown');
    await page.evaluate(()=>fixtureReceive('student-view-stop'));
    await page.evaluate(()=>fixtureBoard.applyAction({type:'delete',objectId:101}));
    await page.clock.runFor(15000);
    assert.equal(await count(),3,'teacher not viewing');
    await page.evaluate(()=>fixtureReceive('student-view-start'));
    await page.clock.runFor(3000);
    assert.equal(await count(),4,'teacher returns to unchanged blank board');
    await page.evaluate(()=>{fixtureFail=true;fixtureReceive('realtime-reconnected',{classCode:'TEST'});});
    await page.clock.runFor(12000);
    const failed = await count();
    assert(failed>=5);
    await page.evaluate(()=>{fixtureFail=false;});
    await page.clock.runFor(8000);
    const recovered=await count();
    assert(recovered>failed);
    await page.clock.runFor(10000);
    assert.equal(await count(),recovered);
    const times=await page.evaluate(()=>fixtureMessages.filter(m=>m.name==='student-thumbnail').map(m=>m.at));
    for(let i=1;i<times.length;i++)assert(times[i]-times[i-1]>=5000, 'all browser send paths keep cooldown');
    // Actual drawing hook still emits monitored actions without waiting for a thumbnail.
    await page.evaluate(()=>fixtureReceive('start-monitoring',{teacherSocketId:'teacher',monitorRequestId:'monitor'}));
    const actionsBefore=await page.evaluate(()=>fixtureMessages.filter(m=>m.name==='student-whiteboard-action').length);
    await page.evaluate(()=>fixtureBoard.onAction({type:'delete',objectId:999}));
    assert.equal(await page.evaluate(()=>fixtureMessages.filter(m=>m.name==='student-whiteboard-action').length),actionsBefore+1);
    assert.deepEqual(errors,[]);
    console.log('Edge student-page thumbnail checks passed: static/changed canvas, initial/reconnect/stop/retry, minimum spacing and immediate monitored actions. Transport mocked.');
  } finally {
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

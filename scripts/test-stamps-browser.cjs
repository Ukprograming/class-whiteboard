// Real local browser/board rendering. Teacher authentication and transport use fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('public');
const fixtureApi = fs.readFileSync('scripts/verify-teacher-draft-browser.cjs', 'utf8').match(/const fixtureApi = `([\s\S]*?)`;/)[1];
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture') {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.end(fs.readFileSync(path.join(root,'student.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
  }
  const file = path.resolve(root,'.'+url.pathname);
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.png')?'image/png':'application/octet-stream');
  if (url.pathname === '/js/teacher.js') {
    return res.end(fs.readFileSync(file,'utf8')+'\nwindow.stampTest={open(){startMonitoringStudent("fixture-student","Test");clearModalBoardLoadTimer();setModalBoardLoadState("ready");},get board(){return modalBoard;}};');
  }
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1100,height:850}});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.setDefaultTimeout(7000);
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.pathname.endsWith('/js/supabase-api.js'))return route.fulfill({contentType:'text/javascript',body:fixtureApi});
      if(u.pathname.endsWith('/js/teacher-forms.js'))return route.fulfill({contentType:'text/javascript',body:'export function initTeacherForms(){return {refreshForClass:async()=>{},closePanel(){}}}'});
      if(u.hostname!=='127.0.0.1')return route.fulfill({contentType:'text/javascript',body:'window.pdfjsLib={GlobalWorkerOptions:{}};'});
      return route.continue();
    });
    const base=`http://127.0.0.1:${server.address().port}`;
    async function init(){
      await page.goto(base+'/fixture');
      await page.evaluate(async()=>{
        document.getElementById('studentLoginOverlay').remove();
        window.wb=(await import('/js/board-ui.js')).initBoardUI();
        wb.resize(innerWidth,innerHeight);
      });
    }
    const palette=page.locator('#stampPalette');
    async function open(){
      for(let i=0;i<2 && !await palette.isVisible();i++)await page.locator('#wbSidebar [data-tool="stamp"]').click();
      await palette.waitFor({state:'visible'});
    }
    const recents=()=>palette.locator('[data-stamp-group="recent"]').evaluateAll(els=>els.map(e=>e.dataset.stampKey));
    await init();
    await open();
    assert.equal(await palette.locator('[data-stamp-group="svg"]').count(),18);
    assert.equal(await palette.locator('[data-stamp-group="image"]').count(),12);
    assert.deepEqual(await recents(),[]);
    assert.equal(await palette.locator('.stamp-item').first().getAttribute('data-stamp-key'),'star-yellow');
    await palette.locator('[data-stamp-key="lightbulb"]').click();
    await open();
    assert.deepEqual(await recents(),[], 'choosing without placement is not usage');
    for(const key of ['star-yellow','circle-ok','cross-ng','maru-hanamaru','lightbulb','reaction-good','maru-hanamaru']){
      await open();
      await palette.locator(`[data-stamp-key="${key}"]`).last().click();
      await page.mouse.click(570,330);
      assert.equal(await page.evaluate(()=>wb.objects.at(-1).stampKey),key);
    }
    await open();
    assert.deepEqual(await recents(),['maru-hanamaru','reaction-good','lightbulb','cross-ng','circle-ok']);
    assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('#stampPalette svg [id]')].map(e=>e.id);return new Set(ids).size===ids.length;}),true);
    await init();await open();
    assert.deepEqual(await recents(),['maru-hanamaru','reaction-good','lightbulb','cross-ng','circle-ok']);
    // All 30 stamps must decode and paint pixels on a canvas (including PNGs).
    assert.equal(await page.evaluate(async()=>{
      const mod=await import('/js/stamps.js');
      for(const key of Object.keys(mod.STAMP_PRESETS)){
        const el=mod.createStampElement(key);
        const image=new Image();image.src=el.tagName==='IMG'?el.src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(mod.stampSvgMarkup(key,128));
        await image.decode();const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,128,128);
        if(!ctx.getImageData(0,0,128,128).data.some((v,i)=>i%4===3&&v>0))return false;
      }return true;
    }),true);
    fs.mkdirSync('output/playwright',{recursive:true});
    await page.screenshot({path:'output/playwright/stamps-desktop.png'});
    await page.setViewportSize({width:390,height:844});await open();
    await palette.locator('[data-stamp-group="recent"]').first().click();
    await page.mouse.click(270,320);await open();
    const bounds=await palette.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=391);
    await page.screenshot({path:'output/playwright/stamps-mobile.png'});
    // Same saved history must appear in the real teacher modal palette.
    await page.setViewportSize({width:1100,height:850});
    await page.evaluate(()=>sessionStorage.setItem('classWhiteboard.teacherSelectedClass.v1','TEST'));
    await page.goto(base+'/teacher.html');
    await page.waitForFunction(()=>window.stampTest&&window.teacherBoard&&document.getElementById('teacherStatus')?.textContent.includes('TEST'));
    await page.evaluate(()=>stampTest.open());
    await page.locator('#modalToolStamp').click();
    const modal=page.locator('#modalStampItems');
    assert.deepEqual(await modal.locator('[data-stamp-group="recent"]').evaluateAll(els=>els.map(e=>e.dataset.stampKey)),['maru-hanamaru','reaction-good','lightbulb','cross-ng','circle-ok']);
    await modal.locator('[data-stamp-key="excellent"]').click();
    await page.locator('#studentModalOverlayCanvas').click({position:{x:160,y:180}});
    assert.equal(await page.evaluate(()=>stampTest.board.objects.at(-1).stampKey),'excellent');
    await page.locator('#modalToolStamp').click();
    assert.equal(await modal.locator('[data-stamp-group="recent"]').first().getAttribute('data-stamp-key'),'excellent');
    assert.equal(await modal.evaluate(el=>el.scrollTop),0);
    await page.screenshot({path:'output/playwright/stamps-teacher-modal.png'});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#modalToolStamp').click();
    await page.locator('#modalToolStamp').click();
    await modal.locator('[data-stamp-group="recent"]').first().click();
    assert.deepEqual(errors,[]);
    console.log('Stamps: 30 rendered, SVG-first order, placement/recents, reload, 390px click targets and real teacher modal passed (mock backend).');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});

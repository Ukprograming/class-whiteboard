// Local synthetic-camera diagnostic. No login, no Supabase requests.
const { chromium } = require('C:/Users/sotso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const browser = await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const results=[];
  try {
    for (const viewport of [{width:1366,height:768},{width:1280,height:600},{width:1024,height:576},{width:683,height:384}]) {
      const context=await browser.newContext({viewport,permissions:['camera']});
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{window.pdfjsLib={GlobalWorkerOptions:{}};});
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.hostname!=='localhost') return route.abort();
        if(url.pathname==='/js/student.js') return route.fulfill({contentType:'text/javascript',body:'import {initBoardUI} from "/js/board-ui.js"; window.wb=initBoardUI(); window.sentActions=[]; wb.onAction=a=>sentActions.push(JSON.parse(JSON.stringify(a))); document.querySelector("#studentLoginOverlay")?.remove(); document.querySelectorAll(".floating-sidebar,.floating-bottom-right").forEach(e=>e.classList.remove("hidden"));'});
        const file=path.resolve('public','.'+url.pathname);
        if(!file.startsWith(path.resolve('public')+path.sep)||!fs.existsSync(file)) return route.fulfill({status:404,body:''});
        const ext=path.extname(file);
        const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
        return route.fulfill({contentType:types[ext]||'application/octet-stream',body:fs.readFileSync(file)});
      });
      await page.goto('http://localhost:3000/student.html');
      await page.waitForFunction(()=>!!window.wb);
      const measure=()=>page.evaluate(()=>({scroll:[scrollX,scrollY,document.body.scrollTop],visual:window.visualViewport?{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale,offsetTop:visualViewport.offsetTop}:null,body:document.body.className,rects:Object.fromEntries(['.floating-topbar','.floating-sidebar','.floating-bottom-right','#whiteboard'].map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return[s,{x:r.x,y:r.y,width:r.width,height:r.height,display:getComputedStyle(e).display}];}))}));
      const before=await measure();
      await page.locator('#cameraCaptureBtn').click();
      await page.waitForFunction(()=>document.querySelector('#cameraCaptureVideo').videoWidth>0);
      await page.locator('#cameraCaptureShutterBtn').click();
      await page.locator('#cameraCaptureInsertBtn').click();
      await page.waitForFunction(()=>document.querySelector('#cameraCaptureBackdrop').classList.contains('hidden'));
      const after=await measure();
      const action=await page.evaluate(()=>{const a=sentActions.find(a=>a.object?.kind==='image'); const source=wb.objects.find(o=>o.kind==='image'); wb.applyAction(a); const receiver=wb.objects.find(o=>o.kind==='image');return{action:a,senderImageReady:source.image?.naturalWidth>0,receiverImageReady:wb._isImageSourceReady(receiver.image)};});
      await page.screenshot({path:`output/incident-20260929/camera-${viewport.width}x${viewport.height}.png`});
      results.push({viewport,before,after,action,errors});
      await context.close();
    }
  } finally {await browser.close();}
  fs.writeFileSync('output/incident-20260929/camera-layout-result.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});

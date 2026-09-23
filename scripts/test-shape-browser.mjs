import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "file:///C:/Users/sotso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const publicRoot = path.resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  const relative = pathname === "/" ? "shape-browser-fixture.html" : pathname.slice(1);
  const filePath = path.resolve(publicRoot, relative);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    res.writeHead(403).end();
    return;
  }
  if (relative === "shape-browser-fixture.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><canvas id="board" width="800" height="600" style="width:800px;height:600px"></canvas>');
    return;
  }
  try {
    await stat(filePath);
    res.writeHead(200, { "content-type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });


const errors = [];
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', error => errors.push(String(error)));
await page.goto(origin);
await page.evaluate(async () => {
  const { Whiteboard } = await import('/js/whiteboard.js');
  window.wb = new Whiteboard({canvas:document.getElementById('board')});
  wb.resize(800,600);
  window.actions=[]; wb.onAction = action => actions.push(JSON.parse(JSON.stringify(action)));
});
const poly = vertices => vertices.flatMap((p,i) => i === vertices.length-1 ? [p] : Array.from({length:20},(_,k) => ({x:p.x+(vertices[i+1].x-p.x)*k/20,y:p.y+(vertices[i+1].y-p.y)*k/20})));
const samples = {
  line: [{x:100,y:100},{x:180,y:142},{x:350,y:230}],
  ellipse: Array.from({length:81},(_,i)=>({x:250+100*Math.cos(i*Math.PI/40),y:240+80*Math.sin(i*Math.PI/40)})),
  rect:poly([{x:100,y:100},{x:350,y:100},{x:350,y:300},{x:100,y:300},{x:100,y:100}]),
  triangle:poly([{x:220,y:100},{x:100,y:300},{x:350,y:300},{x:220,y:100}]),
  parallelogram:poly([{x:180,y:100},{x:400,y:100},{x:320,y:300},{x:100,y:300},{x:180,y:100}]),
  parabola:Array.from({length:81},(_,i)=>({x:100+i*4,y:140+160*(2*i/80-1)**2})),
  sine:Array.from({length:81},(_,i)=>({x:100+i*4,y:230+65*Math.sin(i/80*Math.PI*4)}))
};
async function draw(kind) {
  await page.evaluate(()=>{wb.objects=[];wb.strokes=[];wb.history=[];wb.redoHistory=[];wb._setSelected(null);wb.setShapeType('auto');wb.setTool('shape');});
  const points=await page.evaluate(points=>{const r=wb.canvas.getBoundingClientRect(); return points.map(p=>{const s=wb._worldToScreen(p.x,p.y);return {x:r.left+s.x,y:r.top+s.y};});},samples[kind]);
  await page.mouse.move(points[0].x,points[0].y); await page.mouse.down();
  for(const p of points.slice(1)) await page.mouse.move(p.x,p.y);
  await page.mouse.up();
  const result=await page.evaluate(()=>({kind:wb.objects[0]?.kind,tool:wb.tool,selected:wb.selectedObj?.id===wb.objects[0]?.id,handles:wb.handleRects.map(h=>h.name)}));
  assert.equal(result.kind,kind); assert.equal(result.tool,'select'); assert(result.selected);
  assert(result.handles.length>0);
}
async function dragHandle(name,dx,dy,shift=false) {
  const p=await page.evaluate(name=>{wb.render();const h=wb.handleRects.find(h=>h.name===name);if(!h) throw Error('Missing '+name);const r=wb.canvas.getBoundingClientRect();return {x:h.x+h.size/2+r.left,y:h.y+h.size/2+r.top};},name);
  if(shift) await page.keyboard.down('Shift');
  await page.mouse.move(p.x,p.y); await page.mouse.down();await page.mouse.move(p.x+dx,p.y+dy,{steps:8});await page.mouse.up();
  if(shift) await page.keyboard.up('Shift');
}
async function verifyEdit(name,dx,dy,shift=false) {
  const before=await page.evaluate(()=>JSON.stringify(wb._shapeEditSnapshot(wb.objects[0])));
  await dragHandle(name,dx,dy,shift);
  const after=await page.evaluate(()=>JSON.stringify(wb._shapeEditSnapshot(wb.objects[0])));
  assert.notEqual(before,after,name+' changed geometry');
  await page.evaluate(()=>wb.undoLast());
  assert.equal(await page.evaluate(()=>JSON.stringify(wb._shapeEditSnapshot(wb.objects[0]))),before,name+' undo');
  await page.evaluate(()=>wb.redoLast());
  assert.equal(await page.evaluate(()=>JSON.stringify(wb._shapeEditSnapshot(wb.objects[0]))),after,name+' redo');
}
try {
  for(const kind of Object.keys(samples)) {
    await draw(kind);
    if(kind==='line') await verifyEdit('p1',20,20);
    if(kind==='rect' || kind==='parallelogram') await verifyEdit('se',20,20);
    if(kind==='ellipse') { await verifyEdit('shape-arc-end',-100,90); await verifyEdit('shape-arc-start',-20,-40); }
    if(kind==='parabola' || kind==='sine') { await verifyEdit('shape-end',45,0);await verifyEdit('shape-start',25,0); }
    if(kind==='sine') {await verifyEdit('shape-period',50,0);await verifyEdit('shape-end',35,0,true);}
    if(kind==='triangle') await verifyEdit('shape-vertex-0',-20,-20);
    const saved=await page.evaluate(()=>wb.exportBoardData());
    const before=await page.evaluate(()=>JSON.stringify(wb._shapeEditSnapshot(wb.objects[0])));
    await page.evaluate(data=>wb.importBoardData(data),saved);
    assert.equal(await page.evaluate(()=>JSON.stringify(wb._shapeEditSnapshot(wb.objects[0]))),before,kind+' save/load');
    console.log(kind+' draw, selection, edit and persistence passed');
  }
  await draw('parabola');
  await page.evaluate(()=>{wb.objects[0].rotation=.4;wb.render();});
  const startBefore=await page.evaluate(()=>wb._shapeEditControls(wb.objects[0]).find(p=>p.name==='shape-start'));
  await verifyEdit('shape-end',35,15);
  const startAfter=await page.evaluate(()=>wb._shapeEditControls(wb.objects[0]).find(p=>p.name==='shape-start'));
  assert(Math.hypot(startBefore.x-startAfter.x,startBefore.y-startAfter.y)<.01,'rotated range edit keeps opposite endpoint fixed');
  await draw('sine');
  // Existing action receivers must retain custom geometry without a server dependency.
  await page.evaluate(()=>{const object={...wb.objects[0],id:'remote'};wb.applyAction({type:'object',object});wb.applyAction({type:'modify',object:{...object,curve:{...object.curve,frequency:9}}});});
  assert.equal(await page.evaluate(()=>wb.objects.find(o=>o.id==='remote').curve.frequency),9);
  // Touch input at a non-default zoom exercises the same gestures used on tablets.
  await page.evaluate(()=>{wb.objects=[];wb.strokes=[];wb._setSelected(null);wb.scale=1.4;wb.offsetX=20;wb.offsetY=30;wb.setShapeType('auto');wb.setTool('shape');});
  const touch = await page.context().newCDPSession(page);
  const points = await page.evaluate(points=>{const r=wb.canvas.getBoundingClientRect();return points.map(p=>{const s=wb._worldToScreen(p.x,p.y);return {x:s.x+r.left,y:s.y+r.top};});},samples.ellipse);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
  for(const p of points.slice(1)) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await page.evaluate(()=>wb.objects[0]?.kind),'ellipse');
  const handle = await page.evaluate(()=>{const h=wb.handleRects.find(h=>h.name==='shape-arc-end');const r=wb.canvas.getBoundingClientRect();return {x:h.x+h.size/2+r.left,y:h.y+h.size/2+r.top};});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[handle]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:handle.x-100,y:handle.y+100}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert(await page.evaluate(()=>wb.objects[0].arcSweep>0 && wb.objects[0].arcSweep<Math.PI*2));
  console.log('Zoomed touch drawing and arc editing passed.');
  assert.deepEqual(errors,[]);
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/shape-tools-browser.png'});
  console.log('Shape browser tests passed; local browser only.');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }

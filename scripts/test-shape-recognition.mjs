import assert from 'node:assert/strict';
import { recognizeShape, curvePoint, setCurveRange } from '../public/js/shape-recognition.mjs';

const poly = vertices => vertices.flatMap((p,i) => i === vertices.length-1 ? [p] :
  Array.from({length:30},(_,k) => ({x:p.x+(vertices[i+1].x-p.x)*k/30,y:p.y+(vertices[i+1].y-p.y)*k/30})));
const closed = {
  rect: poly([{x:0,y:0},{x:200,y:0},{x:200,y:130},{x:0,y:130},{x:0,y:0}]),
  triangle: poly([{x:80,y:0},{x:0,y:130},{x:200,y:130},{x:80,y:0}]),
  parallelogram: poly([{x:60,y:0},{x:260,y:0},{x:200,y:130},{x:0,y:130},{x:60,y:0}]),
  ellipse: Array.from({length:121},(_,i)=>({x:100*Math.cos(i*Math.PI/60),y:80*Math.sin(i*Math.PI/60)}))
};
let cases = 0;
function assertDefaultGeometry(obj) {
  if (obj.kind === 'ellipse') assert.equal(obj.width,obj.height,'recognized circle has equal diameters');
  if (obj.kind === 'rect' || obj.kind === 'parallelogram') {
    const v=obj.shapeVertices.map(p=>({x:obj.x+p.x*obj.width,y:obj.y+p.y*obj.height}));
    const horizontal=v.map((p,i)=>Math.abs(p.y-v[(i+1)%4].y)<1e-8);
    assert(horizontal[0] && horizontal[2] || horizontal[1] && horizontal[3],'opposite base edges are horizontal');
    if(obj.kind==='rect') v.forEach((p,i)=>assert(horizontal[i] || Math.abs(p.x-v[(i+1)%4].x)<1e-8,'rectangle sides are vertical'));
  }
}
for (const [kind, points] of Object.entries(closed)) {
  for (const offset of [0,10,20,40]) for(const reverse of [false,true]) {
    const ring = points.slice(0,-1);
    let p = [...ring.slice(offset),...ring.slice(0,offset),ring[offset]];
    if(reverse) p.reverse();
    p=p.map((p,i)=>({x:p.x+2*Math.sin(i*1.3),y:p.y+2*Math.cos(i*2.1)}));
    const obj=recognizeShape(p);
    assert.equal(obj?.kind,kind,`${kind} start=${offset} reverse=${reverse}`);
    assertDefaultGeometry(obj);
    cases++;
  }
}
for(const kind of ['rect','parallelogram']) for(const angle of [0,.4,-.4,1.3,2.8]) {
  const points=closed[kind].map(p=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)}));
  const obj=recognizeShape(points);
  assert.equal(obj?.kind,kind);
  assertDefaultGeometry(obj); cases++;
}
for(const kind of ['parabola','sine']) for(const swap of [false,true]) for(const reverse of [false,true]) {
  let points=Array.from({length:121},(_,i)=>({x:50+i*3,y:kind==='parabola'?30+130*(2*i/120-1)**2:150+60*Math.sin(i/120*Math.PI*4)}));
  if(swap) points=points.map(p=>({x:p.y,y:p.x}));
  if(reverse) points.reverse();
  const obj=recognizeShape(points);
  assert.equal(obj?.kind,kind); cases++;
  const original=curvePoint(obj,.5);
  setCurveRange(obj,-.2,1.2);
  const extended=curvePoint(obj,.5);
  assert(Math.hypot(original.x-extended.x,original.y-extended.y)<1e-6,'range edit preserves function');
  assert(Object.values(obj.curve).every(Number.isFinite));
}
assert.equal(recognizeShape([{x:1,y:1}]),null);
assert.equal(recognizeShape([{x:1,y:1},{x:1,y:1}]),null);
assert.equal(recognizeShape([{x:0,y:0},{x:100,y:1},{x:200,y:0}])?.kind,'line');
assert.equal(recognizeShape(poly([{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:100,y:0},{x:0,y:0},{x:100,y:50}])) ,null);
console.log(`Shape recognition passed: ${cases} noisy/start-position/direction/orientation cases plus range invariance and degenerate input.`);

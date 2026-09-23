// Geometry only: independent of screen scale, pointer speed and board state.
const TAU = Math.PI * 2;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function simplify(p, tolerance) {
  if (p.length < 3) return p;
  const a = p[0], b = p.at(-1), dx = b.x - a.x, dy = b.y - a.y;
  let best = tolerance, index = -1;
  for (let i = 1; i < p.length - 1; i++) {
    const t = Math.max(0, Math.min(1, ((p[i].x-a.x)*dx+(p[i].y-a.y)*dy)/(dx*dx+dy*dy || 1)));
    const d = distance(p[i], { x:a.x+t*dx, y:a.y+t*dy });
    if (d > best) { best = d; index = i; }
  }
  return index < 0 ? [a,b] : [...simplify(p.slice(0,index+1),tolerance).slice(0,-1), ...simplify(p.slice(index),tolerance)];
}
function resample(points, count = 96) {
  const lengths = [0];
  for (let i=1;i<points.length;i++) lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
  if (!lengths.at(-1)) return [];
  let j=1;
  return Array.from({length:count}, (_,i) => {
    const d=lengths.at(-1)*i/(count-1);
    while(j<points.length-1 && lengths[j]<d) j++;
    const t=(d-lengths[j-1])/(lengths[j]-lengths[j-1] || 1), a=points[j-1], b=points[j];
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  });
}
function fit(points, basis) {
  const m=Array.from({length:3},()=>[0,0,0,0]);
  for(const p of points) {
    const v=basis(p.x);
    for(let i=0;i<3;i++) { for(let j=0;j<3;j++) m[i][j]+=v[i]*v[j]; m[i][3]+=v[i]*p.y; }
  }
  for(let i=0;i<3;i++) {
    let pivot=i;
    for(let j=i+1;j<3;j++) if(Math.abs(m[j][i])>Math.abs(m[pivot][i])) pivot=j;
    [m[i],m[pivot]]=[m[pivot],m[i]];
    const d=m[i][i]; if(Math.abs(d)<1e-9) return null;
    for(let k=i;k<4;k++) m[i][k]/=d;
    for(let j=0;j<3;j++) if(j!==i) { const f=m[j][i]; for(let k=i;k<4;k++) m[j][k]-=f*m[i][k]; }
  }
  const c=m.map(row=>row[3]);
  const error=Math.sqrt(points.reduce((s,p)=>s+(p.y-basis(p.x).reduce((v,b,i)=>v+b*c[i],0))**2,0)/points.length);
  return {c,error};
}
export function curveValue(obj, t) {
  const c=obj.curve;
  return obj.kind === 'parabola' ? c.a*t*t+c.b*t+c.c : c.offset+c.amplitude*Math.sin(c.frequency*t+c.phase);
}
export function curvePoint(obj, t) {
  const v=curveValue(obj,t);
  return obj.curveAxis === 'y' ? {x:obj.x+obj.width*v,y:obj.y+obj.height*t} : {x:obj.x+obj.width*t,y:obj.y+obj.height*v};
}
// Reframe an extended/cropped curve so ordinary move/resize/rotation still work.
export function setCurveRange(obj, start, end) {
  const span=end-start;
  if(span<0.03 || span>20) return;
  const values=Array.from({length:257},(_,i)=>curveValue(obj,start+span*i/256));
  const low=Math.min(...values), height=Math.max(0.01,Math.max(...values)-low), c=obj.curve;
  if(obj.curveAxis==='y') { obj.x+=obj.width*low; obj.width*=height; obj.y+=obj.height*start; obj.height*=span; }
  else { obj.y+=obj.height*low; obj.height*=height; obj.x+=obj.width*start; obj.width*=span; }
  obj.curve=obj.kind==='parabola'
    ? {a:c.a*span*span/height,b:(2*c.a*start+c.b)*span/height,c:(c.a*start*start+c.b*start+c.c-low)/height}
    : {...c,amplitude:c.amplitude/height,offset:(c.offset-low)/height,frequency:c.frequency*span,phase:c.phase+c.frequency*start};
}
export function recognizeShape(raw) {
  const p=resample(raw); if(p.length<2) return null;
  const x=Math.min(...p.map(p=>p.x)), y=Math.min(...p.map(p=>p.y));
  const width=Math.max(...p.map(p=>p.x))-x, height=Math.max(...p.map(p=>p.y))-y;
  const size=Math.hypot(width,height); if(size<1e-6) return null;
  const bounds={x,y,width,height}, first=p[0], last=p.at(-1);
  const simple=simplify(p,size*0.045);
  if(simple.length===2) return {kind:'line',x:first.x,y:first.y,width:last.x-first.x,height:last.y-first.y};
  if(distance(first,last)<size*0.23 && width>size*0.15 && height>size*0.15) {
    // Split the closed contour at its farthest point to avoid a degenerate baseline.
    let far=1; for(let i=2;i<p.length;i++) if(distance(first,p[i])>distance(first,p[far])) far=i;
    const vertices=[...simplify(p.slice(0,far+1),size*.065).slice(0,-1),...simplify([...p.slice(far),first],size*.065).slice(0,-1)];
    // The pen can start halfway along an edge. Remove that artificial corner.
    let changed = true;
    while (changed && vertices.length > 3) {
      changed = false;
      for (let i=0;i<vertices.length;i++) {
        const a=vertices[(i+vertices.length-1)%vertices.length], b=vertices[(i+1)%vertices.length], v=vertices[i];
        const dx=b.x-a.x, dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((v.x-a.x)*dx+(v.y-a.y)*dy)/(dx*dx+dy*dy || 1)));
        if(distance(v,{x:a.x+t*dx,y:a.y+t*dy}) < size*.065) { vertices.splice(i,1); changed=true; break; }
      }
    }
    if(vertices.length===3 || vertices.length===4) {
      let kind='triangle';
      let v=vertices;
      if(v.length===4) {
        // Average opposing edges, then level the pair closest to horizontal.
        const center={x:v.reduce((s,p)=>s+p.x,0)/4,y:v.reduce((s,p)=>s+p.y,0)/4};
        let u={x:(v[1].x-v[0].x+v[2].x-v[3].x)/4,y:(v[1].y-v[0].y+v[2].y-v[3].y)/4};
        let w={x:(v[3].x-v[0].x+v[2].x-v[1].x)/4,y:(v[3].y-v[0].y+v[2].y-v[1].y)/4};
        const dot=(u.x*w.x+u.y*w.y)/(Math.hypot(u.x,u.y)*Math.hypot(w.x,w.y)||1);
        kind=Math.abs(dot)<.25?'rect':'parallelogram';
        if(kind==='rect') { const k=(u.x*w.y-u.y*w.x)/(u.x*u.x+u.y*u.y||1); w={x:-u.y*k,y:u.x*k}; }
        const base = Math.abs(u.y)/Math.hypot(u.x,u.y) <= Math.abs(w.y)/Math.hypot(w.x,w.y) ? u : w;
        let angle = Math.atan2(base.y, base.x);
        if (angle > Math.PI/2) angle -= Math.PI;
        if (angle < -Math.PI/2) angle += Math.PI;
        const level = edge => ({x:edge.x*Math.cos(angle)+edge.y*Math.sin(angle), y:-edge.x*Math.sin(angle)+edge.y*Math.cos(angle)});
        u = level(u); w = level(w);
        v=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:center.x+a*u.x+b*w.x,y:center.y+a*u.y+b*w.y}));
      }
      const bx=Math.min(...v.map(p=>p.x)),by=Math.min(...v.map(p=>p.y));
      const bw=Math.max(...v.map(p=>p.x))-bx,bh=Math.max(...v.map(p=>p.y))-by;
      return {kind,x:bx,y:by,width:bw,height:bh,shapeVertices:v.map(p=>({x:(p.x-bx)/bw,y:(p.y-by)/bh}))};
    }
    const radial=p.reduce((s,p)=>s+Math.abs(Math.hypot((p.x-x-width/2)/(width/2),(p.y-y-height/2)/(height/2))-1),0)/p.length;
    if(radial<.18) {
      // Keep the drawn center and average diameter, but always create a true circle.
      const diameter = (width + height) / 2;
      return {kind:'ellipse',x:x+width/2-diameter/2,y:y+height/2-diameter/2,width:diameter,height:diameter};
    }
    return null;
  }
  let best=null;
  for(const axis of ['x','y']) {
    const span=axis==='x'?width:height; if(span<size*.2) continue;
    const q=p.map(p=>axis==='x'?{x:(p.x-x)/width,y:(p.y-y)/(height||1)}:{x:(p.y-y)/height,y:(p.x-x)/(width||1)});
    const travel=q.slice(1).reduce((s,p,i)=>s+Math.abs(p.x-q[i].x),0);
    if(travel>1.25) continue;
    const quad=fit(q,t=>[t*t,t,1]);
    if(quad && Math.abs(quad.c[0])>.4 && quad.error<.075) {
      const [a,b,c]=quad.c, vertex=-b/(2*a);
      if(vertex>-.15 && vertex<1.15) best={kind:'parabola',...bounds,curveAxis:axis,curve:{a,b,c},error:quad.error};
    }
    for(let f=TAU*.7;f<=TAU*5;f+=.06) {
      const result=fit(q,t=>[Math.sin(f*t),Math.cos(f*t),1]);
      if(result && result.error<.065 && (!best || result.error+.012<best.error)) {
        const [s,c,offset]=result.c;
        best={kind:'sine',...bounds,curveAxis:axis,curve:{amplitude:Math.hypot(s,c),frequency:f,phase:Math.atan2(c,s),offset},error:result.error};
      }
    }
  }
  if(best) { delete best.error; setCurveRange(best,0,1); }
  return best;
}

// Local UI review only. Mock API modules never enter public/ or production.
// Run: node scripts/preview-clear-blue.cjs   (http://127.0.0.1:4317)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../public');
const api = `
export const supabaseEnabled = true;
const profile = {id:'11111111-1111-4111-8111-111111111111',role:'teacher'};
const student = {classCode:'DEMO',studentLoginId:'01',displayName:'生徒01'};
export const authApi = {
 getProfile:async()=>profile,signOut:async()=>{},
 getStudentSession:async()=>location.search.includes('login')?null:student,
 signInStudent:async()=>student,signInTeacher:async()=>profile,
 signUpTeacher:async()=>{throw new Error('プレビューではアカウントを作成しません。');}
};
export const getStudentLoginHints=()=>[];
export const boardApi={enabled:true,hydrateDraftAssets:async boardData=>({boardData,failedAssetPaths:[]}),
 listFolders:async()=>({ok:true,folders:[{id:'demo-folder',name:'理科の授業'}]}),
 listBoards:async()=>({ok:true,files:[]}),getActiveSharedBoard:async()=>null,
 saveBoard:async payload=>({ok:true,fileId:'demo-board',fileName:payload.fileName,assetReferences:[]})};
export const managementApi={listClasses:async()=>[{id:'33333333-3333-4333-8333-333333333333',class_code:'DEMO',name:'2年1組'}],
 listStudents:async()=>[]};
export const assignmentApi={listTeacherAssignments:async()=>[],listPendingStudentAssignments:async()=>({assignments:[]})};
export function createRealtimeBridge(){const handlers=new Map();return {connected:true,
 on(name,fn){handlers.set(name,fn);},
 async emit(name,payload){
  if(name==='teacher-start-class')setTimeout(()=>handlers.get('teacher-class-started')?.(payload),0);
  if(name==='start-monitoring')setTimeout(()=>{
   const canvas=document.getElementById('whiteboard');
   const index=Number(payload.studentSocketId.split('-').pop());
   handlers.get('student-screen-update')?.({...payload,nickname:'プレビュー生徒',
    mode:['whiteboard','notebook','screen'][index%3],dataUrl:canvas.toDataURL(),
    boardData:canvas.whiteboardInstance.exportBoardData(),boardRevision:1});
  },80);
  if(name==='joinAsTeacher')setTimeout(()=>{
   const students=Array.from({length:6},(_,i)=>({socketId:'demo-'+i,nickname:'生徒'+String(i+1).padStart(2,'0'),mode:['whiteboard','notebook','screen'][i%3]}));
   handlers.get('student-list-update')?.(students);
   const dataUrl=document.getElementById('whiteboard').toDataURL();
   students.forEach(s=>handlers.get('student-thumbnail')?.({...s,dataUrl,viewport:{scale:1,offsetX:0,offsetY:0}}));
  },800);
  return true;
 }}};
`;
const formApi = `export const formApi={enabled:true,listTemplates:async()=>[],listRunHistory:async()=>[],getActiveRun:async()=>null,
 getRoster:async()=>[],getResponses:async()=>[],listMyRunHistory:async()=>[],getMyResponses:async()=>[],
 subscribeToResponses:()=>()=>{}};`;
const demo = `
sessionStorage.setItem('classWhiteboard.teacherSelectedClass.v1','DEMO');
// Paint actual editable board objects, not a screenshot background.
window.addEventListener('load',()=>{
 const interval=setInterval(()=>{
 const wb=document.getElementById('whiteboard')?.whiteboardInstance;
 if(!wb)return;clearInterval(interval);
 if(!location.search.includes('lesson'))return;
 const draft=wb.exportBoardData();
 draft.pages=draft.pages.slice(0,1);draft.pages[0].name='導入';
 draft.pages[0].boardData.objects=[
 {id:'lesson-title',kind:'text',text:'運動と力',x:265,y:140,width:460,height:90,fontSize:52,color:'#192e52',fontFamily:'sans-serif',bold:true},
 {id:'lesson-subtitle',kind:'text',text:'速さの変化をグラフで考えよう',x:265,y:235,width:650,height:55,fontSize:26,color:'#192e52',fontFamily:'sans-serif'},
 {id:'note-one',kind:'sticky',text:'気づいたこと\\n\\n同じ時間で、\\n同じだけ速くなる',x:770,y:345,width:225,height:215,fontSize:22,color:'#192e52',fill:'#FEF3C7'},
 {id:'note-two',kind:'sticky',text:'考えてみよう\\n\\nグラフの傾きは\\n何を表す？',x:1030,y:345,width:225,height:215,fontSize:22,color:'#192e52',fill:'#E0F2FE'},
 {id:'axis-y-label',kind:'text',text:'速さ',x:290,y:335,width:80,height:40,fontSize:22,color:'#192e52'},
 {id:'axis-x-label',kind:'text',text:'時間',x:640,y:620,width:80,height:40,fontSize:22,color:'#192e52'}
 ];
 draft.pages[0].boardData.strokes=[
 {id:'graph-y',points:[{x:355,y:350},{x:355,y:610}],color:'#192e52',width:3},
 {id:'graph-x',points:[{x:355,y:610},{x:700,y:610}],color:'#192e52',width:3},
 {id:'graph-line',points:[{x:355,y:610},{x:675,y:405}],color:'#192e52',width:3}
 ];
 wb.restoreBoardDraft(draft);wb.addPage('考察');wb.addPage('まとめ');wb.selectPage(wb.getPages()[0].id);wb.markSaved();
 },80);
});
`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if (url.pathname === '/js/supabase-api.js' || url.pathname === '/js/form-api.js') {
    res.setHeader('Content-Type','text/javascript; charset=utf-8');
    return res.end(url.pathname.endsWith('supabase-api.js') ? api : formApi);
  }
  // Do not load a local production configuration or make calls to remote data.
  if (['/js/app-config.js','/js/local-config-loader.js','/js/legacy-socket-loader.js'].includes(url.pathname)) {
    res.setHeader('Content-Type','text/javascript'); return res.end('');
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/teacher.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream');
  if (file.endsWith('.html')) {
    let html = fs.readFileSync(file,'utf8');
    html = html.replace('</head>', '<script>'+demo+'</script></head>');
    return res.end(html);
  }
  fs.createReadStream(file).pipe(res);
});
server.listen(4317,'127.0.0.1',()=>console.log('Mock-data UI preview: http://127.0.0.1:4317/teacher.html?lesson=1'));

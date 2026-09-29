// Read-only diagnostic: execute current source handlers in a deterministic VM.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const teacher = fs.readFileSync('public/js/teacher.js', 'utf8');
const student = fs.readFileSync('public/js/student.js', 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a);
  return source.slice(a, b);
}
async function scenario(actionTiming) {
  const handlers = {};
  let release;
  let imports = 0;
  let ready = false;
  const pending = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({
    console: { log() {} },
    socket: { on(name, fn) { handlers[name] = fn; } },
    latestStudentBoardRevisionByStudent: new Map(),
    latestTeacherSyncTokenByStudent: new Map(),
    latestBoardDataByStudent: {}, latestModeByStudent: {}, latestViewportByStudent: {},
    currentMonitoringStudentSocketId: 'student',
    isCurrentMonitorResponse: () => true,
    isCurrentTeacherBoardSync: () => true,
    resolveRealtimeBoardData: () => pending,
    modalBoard: { applyAction() {} },
    importStudentBoardDataIntoModal: () => { imports++; return true; },
    completeStudentModalBoardLoad: () => { ready = true; },
  });
  vm.runInContext(between(teacher, 'function parseBoardRevision(', 'async function sendTeacherWhiteboardAction('), context);
  vm.runInContext(between(teacher, 'socket.on("student-board-state",', '// ★ 生徒側からの「画面更新」'), context);
  const action = () => handlers['student-whiteboard-action']({studentSocketId:'student',action:{type:'modify'},boardRevision:11,monitorRequestId:'m'});
  if (actionTiming === 'before') action();
  const receive = handlers['student-board-state']({studentSocketId:'student',boardSnapshotPath:'snapshot',boardRevision:10,monitorRequestId:'m'});
  if (actionTiming === 'during') action();
  release({objects:[{id:'existing-object'}]});
  await receive;
  const result = {actionTiming, imports, ready, latestRevision:context.latestStudentBoardRevisionByStudent.get('student')};
  assert.equal(imports, actionTiming === 'none' ? 1 : 0);
  assert.equal(ready, actionTiming === 'none');
  return result;
}
async function senderScenario() {
  let release;
  const context = vm.createContext({
    console, currentClassCode:'class', currentTeacherSocketId:'teacher', currentMonitorRequestId:'m',
    viewMode:'whiteboard', hasSentInitialBoardData:false, forceNextBoardSync:false, boardSyncRevision:10,
    whiteboard:{scale:1,offsetX:0,offsetY:0}, studentCanvas:{getBoundingClientRect:()=>({width:100,height:100})},
    createBoardSyncPayload:()=>new Promise(resolve=>{release=resolve;}),
    socket:{emit:async()=>true},
  });
  vm.runInContext(between(student,'async function sendScreenUpdate(', '// すべての Realtime ハンドラ'),context);
  const send = context.sendScreenUpdate('teacher','m');
  context.boardSyncRevision=11;
  release({boardData:null,boardSnapshotPath:'snapshot',teacherSyncToken:null,syncRevision:10,snapshotVersion:'v'});
  await send;
  const result={hasSentInitialBoardData:context.hasSentInitialBoardData,forceNextBoardSync:context.forceNextBoardSync,boardSyncRevision:context.boardSyncRevision};
  assert.equal(result.hasSentInitialBoardData,true);
  assert.equal(result.forceNextBoardSync,false);
  return result;
}
(async()=>{
  const results={teacher:await Promise.all(['none','before','during'].map(scenario)),student:await senderScenario(),boundary:'Local actual-source VM; not authenticated production reproduction.'};
  fs.writeFileSync('output/incident-20260929/monitor-race-result.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

// Real teacher page and browser storage. Authentication/Storage are fixtures;
// this is not authenticated production E2E.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const fixtureApi = `
export const supabaseEnabled = true;
export const authApi = {
  getProfile: async () => ({ id: sessionStorage.fixtureTeacherId || '11111111-1111-4111-8111-111111111111', role: 'teacher' }),
  signOut: async () => {},
};
export const boardApi = {
  enabled: true,
  hydrateDraftAssets: async boardData => ({ boardData, failedAssetPaths: [] }),
  listFolders: async () => ({ ok: true, folders: [] }),
  listBoards: async () => ({ ok: true, files: [] }),
  getActiveSharedBoard: async () => null,
  saveBoard: async payload => {
    window.fixtureLastSave = structuredClone(payload);
    return { ok: true, fileId: payload.fileId || '22222222-2222-4222-8222-222222222222', fileName: payload.fileName, assetReferences: [] };
  },
};
export const managementApi = {
  createClass: async payload => ({class:{id:'44444444-4444-4444-8444-444444444444',class_code:payload.classCode,name:payload.name}}),
  listClasses: async () => [{id:'33333333-3333-4333-8333-333333333333',class_code:'TEST',name:'Test class'},{id:'44444444-4444-4444-8444-444444444444',class_code:'NEXT',name:'Next class'}],
  listStudents: async () => [],
};
export const assignmentApi = {listTeacherAssignments: async () => []};
export function createRealtimeBridge() { return { on(){}, emit: async () => true, connected:true }; }
`;

async function main() {
  const root = path.resolve('public');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/__draft-fixture') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<!doctype html><canvas id="board" width="800" height="600"></canvas><span id="status"></span>');
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/js/supabase-api.js')) return route.fulfill({ contentType:'text/javascript', body:fixtureApi });
      if (url.pathname.endsWith('/js/teacher-forms.js')) return route.fulfill({ contentType:'text/javascript', body:'export function initTeacherForms(){return {refreshForClass:async()=>{},closePanel(){}}}' });
      if (url.hostname !== '127.0.0.1') return route.fulfill({ contentType:'text/javascript', body:'window.pdfjsLib={GlobalWorkerOptions:{}};' });
      return route.continue();
    });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('classWhiteboard.teacherSelectedClass.v1')) sessionStorage.setItem('classWhiteboard.teacherSelectedClass.v1', 'TEST');
    });
    const url = `http://127.0.0.1:${server.address().port}/teacher.html`;
    await page.goto(url);
    await page.waitForFunction(() => window.teacherBoard && document.getElementById('teacherStatus')?.textContent.includes('TEST'));
    await page.evaluate(() => {
      const draft = teacherBoard.exportBoardData();
      draft.pages[0].boardData.objects.push({id:'draft-text',kind:'text',text:'再読み込み後も残る教材',x:40,y:80,width:400,height:50,fontSize:24});
      teacherBoard.restoreBoardDraft(draft);
    });
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForFunction(() => window.teacherBoard?.objects.some(o=>o.text==='再読み込み後も残る教材'));
    assert.equal(await page.evaluate(() => teacherBoard.isBoardDirty), true);
    assert.deepEqual(errors, [], 'teacher page must initialize without uncaught errors');
    const output = path.resolve('output/playwright');
    fs.mkdirSync(output, {recursive:true});
    await page.screenshot({path:path.join(output,'teacher-draft-restored.png')});
    // A different authenticated teacher must never recover the previous teacher's draft.
    await page.evaluate(() => {sessionStorage.fixtureTeacherId='55555555-5555-4555-8555-555555555555';});
    await page.reload();
    await page.waitForFunction(() => window.teacherBoard && document.getElementById('teacherStatus')?.textContent.includes('TEST'));
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => teacherBoard.objects.some(o=>o.text==='再読み込み後も残る教材')), false);
    assert.deepEqual(errors, []);
    console.log('Teacher full-page reload, dirty recovery and teacher identity isolation passed (mock backend).');

    await page.evaluate(() => {delete sessionStorage.fixtureTeacherId;});
    await page.reload();
    await page.waitForFunction(() => window.teacherBoard?.objects.some(o=>o.text==='再読み込み後も残る教材'));
    await page.locator('#fileMenuBtn').click();
    await page.locator('#teacherManageClassesBtn').click();
    async function requestNextClass() {
      await page.locator('#classManagementClassName').fill('Next class');
      await page.locator('#classManagementClassCode').fill('NEXT');
      await page.locator('#classManagementCreateClassForm button[type="submit"]').click();
      await page.locator('.workflow-dialog').filter({hasText:'未保存の変更があります'}).waitFor();
    }
    await requestNextClass();
    await page.locator('.workflow-dialog').filter({hasText:'未保存の変更があります'}).getByRole('button', {name:'キャンセル', exact:true}).click();
    await page.locator('.workflow-dialog').filter({hasText:'未保存の変更があります'}).waitFor({state:'detached'});
    assert.equal(await page.evaluate(() => sessionStorage.getItem('classWhiteboard.teacherSelectedClass.v1')), 'TEST');
    assert.equal(await page.evaluate(() => teacherBoard.objects.some(o=>o.text==='再読み込み後も残る教材')), true);
    await requestNextClass();
    await page.locator('.workflow-dialog').filter({hasText:'未保存の変更があります'}).getByRole('button', {name:'保存せずに切り替える', exact:true}).click();
    await page.waitForFunction(() => sessionStorage.getItem('classWhiteboard.teacherSelectedClass.v1')==='NEXT');
    assert.equal(await page.evaluate(() => teacherBoard.objects.some(o=>o.text==='再読み込み後も残る教材')), false);
    assert.equal(await page.evaluate(() => teacherBoard.isBoardDirty), false);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('classWhiteboard.teacherDraftMarker.v1')), null);
    await page.reload();
    await page.waitForFunction(() => window.teacherBoard && document.getElementById('teacherStatus')?.textContent.includes('NEXT'));
    assert.equal(await page.evaluate(() => teacherBoard.objects.some(o=>o.text==='再読み込み後も残る教材')), false);
    assert.deepEqual(errors, []);
    console.log('Teacher class switch cancel preserves edits; discard clears the board and recovery marker across reload.');

    // Exercise the real student persistence functions with actual browser quota
    // and IndexedDB, without any login/Storage requests.
    await page.goto(`http://127.0.0.1:${server.address().port}/__draft-fixture`);
    const studentSource = fs.readFileSync('public/js/student.js', 'utf8');
    const draftStart = studentSource.indexOf('const STUDENT_DRAFT_MARKER_KEY');
    const draftEnd = studentSource.indexOf('// ========= 左パネル折りたたみ', draftStart);
    assert(draftStart >= 0 && draftEnd > draftStart);
    const draftFunctions = studentSource.slice(draftStart, draftEnd);
    async function initStudentFixture() {
      await page.evaluate(async source => {
        const {Whiteboard} = await import('/js/whiteboard.js');
        const {chooseNewestStudentDraft} = await import('/js/student-draft-utils.mjs');
        const wb = new Whiteboard({canvas:document.getElementById('board')});
        Object.assign(window, {
          currentClassCode:'QUOTA', nickname:'student-a', currentBoardFileId:null,
          currentBoardFileName:'', lastUsedFolderPath:'', supabaseEnabled:false,
          chooseNewestStudentDraft, statusLabel:document.getElementById('status'),
          whiteboard:wb,
        });
        (0, eval)(source);
      }, draftFunctions);
    }
    await initStudentFixture();
    await page.evaluate(async () => {
      const originalExport = whiteboard.exportBoardData.bind(whiteboard);
      whiteboard.exportBoardData = () => ({...originalExport(), padding:'x'.repeat(7*1024*1024)});
      whiteboard.isBoardDirty = true;
      const saved = await persistStudentDraftNow();
      if (!saved || !sessionStorage.getItem('classWhiteboard.studentDraftMarker.v1')) throw new Error('Quota fallback failed');
      if (sessionStorage.getItem('classWhiteboard.studentDraft.v1:QUOTA:student-a')) throw new Error('Fixture did not exceed session quota');
    });
    await page.reload();
    await initStudentFixture();
    assert.equal(await page.evaluate(() => restoreStudentDraft('QUOTA','student-a')), true);
    assert.equal(await page.evaluate(() => whiteboard.isBoardDirty), true);
    await page.evaluate(() => clearStudentDraft());
    assert.equal(await page.evaluate(() => restoreStudentDraft('QUOTA','student-a')), false);
    console.log('Student real sessionStorage quota -> IndexedDB -> reload recovery and clear passed.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

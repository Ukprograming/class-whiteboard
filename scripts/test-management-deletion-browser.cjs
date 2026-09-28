// Real page/dialog/layout with mocked authentication and deletion APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve('public');
const fixtureApi = fs.readFileSync('scripts/verify-teacher-draft-browser.cjs', 'utf8').match(/const fixtureApi = `([\s\S]*?)`;/)[1]
  .replace('export const managementApi = {', `export const managementApi = {
    deleteManagementTarget: async payload => {
      window.deletionCalls = [...(window.deletionCalls || []), payload];
      if (payload.teacherPassword !== 'correct-password') throw new Error('先生のパスワードが正しくありません。');
      await new Promise(resolve => window.finishDeletion = resolve);
      return {ok:true,completed:false,pending:true,jobId:'fixture-job'};
    },`);
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/js/supabase-api.js')) return route.fulfill({ contentType: 'text/javascript', body: fixtureApi });
      if (url.pathname.endsWith('/js/teacher-forms.js')) return route.fulfill({ contentType: 'text/javascript', body: 'export function initTeacherForms(){return {refreshForClass:async()=>{},closePanel(){}}}' });
      if (url.hostname !== '127.0.0.1') return route.fulfill({ contentType: 'text/javascript', body: 'window.pdfjsLib={GlobalWorkerOptions:{}};' });
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/teacher.html`);
    await page.waitForFunction(() => window.teacherBoard);
    // Open the existing menu through the DOM because it is hidden behind its toolbar toggle.
    await page.locator('#teacherManageClassesBtn').evaluate(button => button.click());
    await page.waitForFunction(() => !document.getElementById('deleteClassBtn').disabled);
    await page.locator('#deleteClassBtn').click();
    await page.locator('#managementDeletionDialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#managementDeletionSummary').innerText(), /TEST/);
    await page.locator('#managementDeletionConfirmation').fill('WRONG');
    await page.locator('#managementDeletionPassword').fill('correct-password');
    await page.locator('#managementDeletionSubmit').click();
    assert.match(await page.locator('#managementDeletionError').innerText(), /一致/);
    assert.equal(await page.evaluate(() => (window.deletionCalls || []).length), 0);
    await page.locator('#managementDeletionConfirmation').fill('TEST');
    await page.locator('#managementDeletionPassword').fill('wrong-password');
    await page.locator('#managementDeletionSubmit').click();
    await page.waitForFunction(() => document.getElementById('managementDeletionError').textContent.includes('正しくありません'));
    assert.equal(await page.locator('#managementDeletionPassword').inputValue(), '');
    fs.mkdirSync('output/playwright', { recursive: true });
    for (const [width, height] of [[1100,850], [768,1024], [320,640]]) {
      await page.setViewportSize({ width, height });
      const layout = await page.locator('#managementDeletionDialog').evaluate(dialog => ({
        overflowing: dialog.scrollWidth > dialog.clientWidth,
        left: dialog.getBoundingClientRect().left, right: dialog.getBoundingClientRect().right,
      }));
      assert.equal(layout.overflowing, false);
      assert.ok(layout.left >= 0 && layout.right <= width);
      assert.equal(await page.locator('#managementDeletionForm button').evaluateAll(buttons =>
        buttons.every(button => button.scrollWidth <= button.clientWidth)), true, 'button labels must fit');
      await page.screenshot({ path: `output/playwright/management-delete-${width}.png` });
    }
    await page.locator('#managementDeletionPassword').fill('correct-password');
    await page.locator('#managementDeletionSubmit').click();
    await page.waitForFunction(() => typeof window.finishDeletion === 'function');
    assert.equal(await page.locator('#managementDeletionCancel').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#managementDeletionDialog').isVisible(), true);
    await page.evaluate(() => window.finishDeletion());
    await page.waitForFunction(() => document.getElementById('managementDeletionStatus').textContent.includes('fixture-job'));
    await page.locator('#deleteTeacherAccountBtn').click();
    assert.match(await page.locator('#managementDeletionWarning').innerText(), /全クラス/);
    assert.match(await page.locator('#managementDeletionSummary').innerText(), /NEXT/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#managementDeletionDialog').isVisible(), false);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(async () => {
      const { createTeacherDraftStore, createTeacherDraftKey } = await import('/js/teacher-draft-store.mjs');
      const store = createTeacherDraftStore({ getIndexedDB: () => indexedDB, getSessionStorage: () => sessionStorage });
      const identities = [
        { teacherId:'delete-me', classCode:'TEST' },
        { teacherId:'delete-me', classCode:'TEST', ownerKind:'student', ownerStudentId:'s1' },
        { teacherId:'delete-me', classCode:'NEXT' },
        { teacherId:'keep-me', classCode:'TEST' },
      ];
      for (const identity of identities) await store.persist({ ...identity,
        draftKey:createTeacherDraftKey(identity), savedAt:new Date().toISOString(), boardData:{objects:[]} });
      async function load(identity) {
        sessionStorage.setItem('classWhiteboard.teacherDraftMarker.v1', createTeacherDraftKey(identity));
        return store.load(identity);
      }
      await store.clearContext({teacherId:'delete-me',classCode:'TEST'});
      if (await load(identities[0]) || await load(identities[1]) || !await load(identities[2])) return false;
      await store.clearContext({teacherId:'delete-me'});
      return !await load(identities[2]) && !!await load(identities[3]);
    }), true, 'deleted class/account drafts must clear every owner scope without touching other teachers');
    console.log('Management deletion browser checks passed: real teacher page, 1100/768/320px, confirmation/password failure, pending state, Escape and account scope. APIs mocked.');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

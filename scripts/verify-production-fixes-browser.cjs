// Real Edge reload/rendering with mocked Storage, not authenticated production E2E.
// Uses installed Playwright/pdf-lib through NODE_PATH or PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PDFDocument, rgb } = require('pdf-lib');

async function main() {
  const root = path.resolve('public');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (process.env.PDFJS_FIXTURE_DIR && ['/pdf.min.js', '/pdf.worker.min.js'].includes(pathname)) {
      res.setHeader('Content-Type', 'text/javascript');
      return fs.createReadStream(path.join(process.env.PDFJS_FIXTURE_DIR, pathname.slice(1))).pipe(res);
    }
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><canvas id="board" width="800" height="600"></canvas>');
    }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://esm.sh/@supabase/supabase-js@*', route => route.fulfill({
      contentType: 'text/javascript', body: 'export function createClient(){return window.mockClient;}',
    }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function initialize() {
      await page.evaluate(async () => {
        window.CLASS_WHITEBOARD_CONFIG = { supabaseUrl: 'https://fixture.supabase.co', supabaseAnonKey: 'fixture' };
        window.downloadCalls = [];
        window.mockClient = { storage: { from: () => ({ download: async assetPath => {
          window.downloadCalls.push(assetPath);
          if (window.offline) return { error: new Error('fixture offline') };
          return { data: await (await fetch(sessionStorage.fixturePng)).blob() };
        } }) } };
        const { Whiteboard } = await import('/js/whiteboard.js');
        window.boardApi = (await import('/js/supabase-api.js')).boardApi;
        window.wb = new Whiteboard({ canvas: document.getElementById('board') });
        wb.resize(800, 600);
      });
    }
    await page.goto(origin);
    await initialize();
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      canvas.getContext('2d').fillRect(0, 0, 16, 16);
      sessionStorage.fixturePng = canvas.toDataURL('image/png');
      const url = URL.createObjectURL(await (await fetch(sessionStorage.fixturePng)).blob());
      sessionStorage.oldImageUrl = url;
      sessionStorage.draft = JSON.stringify({ version: 3, objects: [
        { id: 1, kind: 'image', x: 20, y: 20, width: 100, height: 100,
          assetKey: 'image', assetPath: 'students/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/assets/image.png',
          imageObjectUrl: url, imageWidth: 16, imageHeight: 16 },
        { id: 2, kind: 'text', x: 30, y: 180, width: 200, height: 80, text: '未保存の変更' },
      ], strokes: [], background: {
        assetKey: 'background', assetPath: 'students/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/assets/image.png',
        objectUrl: url, width: 16, height: 16,
      } });
    });
    await page.reload();
    await initialize();
    const result = await page.evaluate(async () => {
      let oldUrlInvalid = false;
      try { await fetch(sessionStorage.oldImageUrl); } catch { oldUrlInvalid = true; }
      const restored = await boardApi.hydrateDraftAssets(JSON.parse(sessionStorage.draft));
      wb.restoreBoardDraft(restored.boardData);
      await wb.waitForAssets();
      return { oldUrlInvalid, failed: restored.failedAssetPaths, calls: downloadCalls.length,
        width: wb.objects.find(o => o.id === 1).image?.naturalWidth,
        text: wb.objects.find(o => o.id === 2).text, dirty: wb.isBoardDirty };
    });
    assert.equal(result.oldUrlInvalid, true);
    assert.deepEqual(result.failed, []);
    assert.equal(result.calls, 1);
    assert.equal(result.width, 16);
    assert.equal(result.text, '未保存の変更');
    assert.equal(result.dirty, true);
    const offline = await page.evaluate(async () => {
      window.offline = true;
      const recovered = await boardApi.hydrateDraftAssets(JSON.parse(sessionStorage.draft));
      wb.restoreBoardDraft(recovered.boardData);
      await wb.waitForAssets();
      const exportedBackground = wb.exportBoardData().pages[0].boardData.background;
      return { failures: recovered.failedAssetPaths.length, path: wb.objects[0].assetPath,
        text: wb.objects[1].text, originalStillPresent: !!sessionStorage.draft,
        backgroundPath: exportedBackground?.assetPath, backgroundWidth: exportedBackground?.width };
    });
    assert.equal(offline.failures, 1);
    assert(offline.path.endsWith('/image.png'));
    assert.equal(offline.text, '未保存の変更');
    assert.equal(offline.originalStillPresent, true);
    assert.equal(offline.backgroundPath, offline.path);
    assert.equal(offline.backgroundWidth, 16);
    console.log('Edge reload and offline draft checks passed (mocked Storage).');

    // Exercise the deployed PDF.js version with the mitigation and a benign PDF.
    const pdfBase = process.env.PDFJS_FIXTURE_DIR ? origin : 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
    await page.addScriptTag({ url: `${pdfBase}/pdf.min.js` });
    await page.evaluate(workerUrl => { pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl; }, `${pdfBase}/pdf.worker.min.js`);
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]).drawRectangle({ x: 20, y: 20, width: 80, height: 80, color: rgb(1, 0, 0) });
    const bytes = Array.from(await pdf.save());
    const pdfResult = await page.evaluate(async bytes => {
      wb.importBoardData({ objects: [], strokes: [] });
      await wb.loadPdfFile(new File([new Uint8Array(bytes)], 'fixture.pdf', { type: 'application/pdf' }));
      const object = wb.objects.find(o => o.sourceType === 'pdf-page');
      return { count: wb.objects.length, width: object.image.width, height: object.image.height };
    }, bytes);
    assert.equal(pdfResult.count, 1);
    assert(pdfResult.width > 0 && pdfResult.height > 0);
    console.log('Edge verification passed: reload restores stored image and unsaved edits; offline preserves references; PDF renders with mitigation. Storage mocked.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

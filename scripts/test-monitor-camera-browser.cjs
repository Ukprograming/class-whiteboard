// Actual shared camera/Whiteboard UI with two local pages and fake camera.
// No authenticated backend calls. Set PLAYWRIGHT_MODULE to an installed module.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
  fs.mkdirSync('output/playwright/monitor-recovery', { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const results = [];
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 600 }, { width: 1024, height: 576 }, { width: 683, height: 384 }, { width: 375, height: 667 }]) {
      const context = await browser.newContext({ viewport, permissions: ['camera'] });
      context.setDefaultTimeout(15000);
      const errors = [];
      await context.addInitScript(() => {
        window.pdfjsLib = { GlobalWorkerOptions: {} };
        window.fixtureStreams = [];
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => {
          const stream = await getUserMedia(constraints); fixtureStreams.push(stream); return stream;
        };
      });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname !== 'localhost') return route.abort();
        if (url.pathname === '/js/student.js') return route.fulfill({ contentType: 'text/javascript', body:
          'import {initBoardUI} from "/js/board-ui.js"; window.wb=initBoardUI(); window.sentActions=[]; wb.onAction=a=>sentActions.push(JSON.parse(JSON.stringify(a))); document.querySelector("#studentLoginOverlay")?.remove(); document.querySelectorAll(".floating-sidebar,.floating-bottom-right").forEach(e=>e.classList.remove("hidden"));' });
        const file = path.resolve('public', '.' + url.pathname);
        if (!file.startsWith(path.resolve('public') + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
        return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      });
      const page = await context.newPage(); const peer = await context.newPage();
      for (const p of [page, peer]) {
        p.on('pageerror', e => errors.push(e.message));
        await p.goto('http://localhost:3000/student.html');
        await p.waitForFunction(() => !!window.wb);
      }
      const measure = () => page.evaluate(() => ({
        scroll: [scrollX, scrollY, document.body.scrollTop], body: document.body.className,
        rects: Object.fromEntries(['.floating-topbar', '.floating-sidebar', '.floating-bottom-right'].map(selector => {
          const element = document.querySelector(selector), r = element.getBoundingClientRect();
          return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, display: getComputedStyle(element).display }];
        })),
      }));
      const before = await measure();
      await page.bringToFront();
      console.log(`Camera ${viewport.width}x${viewport.height}: capture`);
      await page.locator('#cameraCaptureBtn').click();
      await page.waitForFunction(() => document.querySelector('#cameraCaptureVideo').videoWidth > 0);
      await page.locator('#cameraCaptureShutterBtn').click();
      await page.locator('#cameraCaptureInsertBtn').click();
      await page.waitForFunction(() => document.querySelector('#cameraCaptureBackdrop').classList.contains('hidden'));
      await page.waitForFunction(() => classWhiteboardDiagnostics.read().some(x => x.stage === 'closed'));
      assert.deepEqual(await measure(), before, 'capture does not move the controls');
      const snapshot = await page.evaluate(() => {
        const action = sentActions.at(-1);
        if (action.type !== 'refresh') throw new Error('new image must request an asset-backed snapshot');
        return wb.exportBoardData();
      });
      console.log(`Camera ${viewport.width}x${viewport.height}: peer import`);
      await peer.evaluate(async data => { wb.importBoardData(data); await wb.waitForAssets(); }, snapshot);
      assert(await peer.evaluate(() => wb.objects.some(o => o.kind === 'image' && wb._isImageSourceReady(o.image))));
      const modify = await page.evaluate(() => {
        const image = wb.objects.find(o => o.kind === 'image'); image.x += 35; image.width *= 0.8;
        wb.onAction({ type: 'modify', object: image }); return sentActions.at(-1);
      });
      assert.equal(modify.object.image, undefined);
      assert.equal(modify.object.imageObjectUrl, undefined);
      await peer.evaluate(action => wb.applyAction(action), modify);
      assert(await peer.evaluate(x => {
        const image = wb.objects.find(o => o.kind === 'image');
        return image.x === x && wb._isImageSourceReady(image.image);
      }, modify.object.x));
      const undo = await page.evaluate(() => { wb.undoLast(); return sentActions.at(-1); });
      await peer.evaluate(action => wb.applyAction(action), undo);
      assert.equal(await peer.evaluate(() => wb.objects.filter(o => o.kind === 'image').length), 0);
      await page.locator('#cameraCaptureBtn').click();
      await page.waitForFunction(() => document.querySelector('#cameraCaptureVideo').videoWidth > 0);
      await page.locator('#cameraCaptureShutterBtn').click();
      await page.locator('#cameraCaptureRetakeBtn').click();
      await page.locator('#cameraCaptureCloseBtn').click();
      assert.deepEqual(await measure(), before, 'retake/cancel restores controls');
      assert(await page.evaluate(() => fixtureStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
      // Genuine click after closing: selection and Undo controls must remain usable.
      await page.locator('#wbSidebar [data-tool="select"]').click();
      assert.equal(await page.evaluate(() => wb.tool), 'select');
      for (const r of Object.values(before.rects)) {
        assert(r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1);
      }
      await page.screenshot({ path: `output/playwright/monitor-recovery/camera-${viewport.width}x${viewport.height}.png` });
      assert.deepEqual(errors, []);
      results.push({ viewport, photoSnapshot: true, imageMove: true, undo: true, retakeCancel: true, controlsClickable: true, errors });
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync('output/playwright/monitor-recovery/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

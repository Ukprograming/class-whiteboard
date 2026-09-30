// Shared camera UI with local fixtures and a synthetic camera; no backend login.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

async function main() {
  const output = 'output/playwright/camera-layout';
  fs.mkdirSync(output, { recursive: true });
  const baseline = !!process.env.CAMERA_LAYOUT_BASELINE;
  const oldSources = baseline ? Object.fromEntries(['style.css', 'js/board-ui.js'].map(file =>
    [file, execFileSync('git', ['show', `HEAD:public/${file}`])])) : {};
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const results = [];
  try {
    for (const role of ['teacher', 'student']) {
      const cases = [
        [1920, 1080], [1366, 768], [1280, 600], [1024, 576], [683, 384],
        [375, 667], [320, 568], [568, 320], [320, 320],
        [1024, 576, 1280, 720], [375, 667, 360, 640],
      ];
      const selectedCases = baseline ? cases.filter(c => [1366, 683, 375].includes(c[0]) && !c[2]) : cases;
      for (const [initialWidth, initialHeight, sourceWidth = 640, sourceHeight = 480] of selectedCases) {
        let width = initialWidth, height = initialHeight;
        const context = await browser.newContext({ viewport: { width, height }, permissions: ['camera'] });
        context.setDefaultTimeout(10000);
        await context.addInitScript(({ sourceWidth, sourceHeight }) => {
          window.pdfjsLib = { GlobalWorkerOptions: {} };
          const canvas = document.createElement('canvas');
          canvas.width = sourceWidth; canvas.height = sourceHeight;
          const draw = () => {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#193d55'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = '#68e4cd'; ctx.lineWidth = 10;
            ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
            ctx.fillStyle = '#fff'; ctx.font = '32px sans-serif';
            ctx.fillText('Camera preview', 30, 60);
          };
          draw();
          setInterval(draw, 50);
          navigator.mediaDevices.getUserMedia = async constraints => {
            if (!constraints.video) throw new DOMException('Synthetic camera has no microphone', 'NotAllowedError');
            return canvas.captureStream(20);
          };
        }, { sourceWidth, sourceHeight });
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.hostname !== 'localhost') return route.abort();
          if (url.pathname === `/js/${role}.js`) return route.fulfill({ contentType: 'text/javascript', body:
            'import {initBoardUI} from "/js/board-ui.js"; window.wb=initBoardUI(); document.querySelectorAll("#studentLoginOverlay,.teacher-login-overlay,.login-overlay").forEach(e=>e.remove());' });
          const file = path.resolve('public', '.' + url.pathname);
          if (!file.startsWith(path.resolve('public') + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
          const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
          return route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream',
            body: oldSources[url.pathname.slice(1)] || fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://localhost:3000/${role}.html`);
        await page.waitForFunction(() => !!window.wb);
        // Trigger the real camera handler even if classroom chrome is behind a login fixture.
        await page.evaluate(() => document.querySelector('#cameraCaptureBtn').click());
        await page.waitForFunction(() => document.querySelector('#cameraCaptureVideo').videoWidth > 0);
        const measure = async state => {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const layout = await page.evaluate(() => {
            const dialog = document.querySelector('.camera-capture-dialog');
            const stage = document.querySelector('.camera-capture-stage');
            const dr = dialog.getBoundingClientRect(), sr = stage.getBoundingClientRect();
            const bounds = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
            const controls = [...dialog.querySelectorAll('button,select,.camera-capture-message')]
              .filter(e => e.getClientRects().length).map(e => ({ id: e.id || e.dataset.cameraMode, ...bounds(e) }));
            const style = getComputedStyle(stage);
            return { dialog: bounds(dialog), stage: bounds(stage),
              scroll: [dialog.scrollWidth - dialog.clientWidth, dialog.scrollHeight - dialog.clientHeight],
              controls, bodyScroll: [scrollX, scrollY],
              stageRatio: (sr.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)) /
                (sr.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth)),
              contained: controls.every(e => e.x >= dr.x && e.right <= dr.right + 1 && e.y >= dr.y && e.bottom <= dr.bottom + 1),
            };
          });
          results.push({ role, viewport: { width, height }, source: [sourceWidth, sourceHeight], state, ...layout });
          if (!baseline) {
            assert.deepEqual(layout.scroll, [0, 0], `${role} ${width}x${height} ${state}: no dialog scroll`);
            assert(layout.contained, `${role} ${width}x${height} ${state}: all controls inside dialog`);
            assert(layout.dialog.y >= 0 && layout.dialog.bottom <= height + 1);
            assert(layout.dialog.x >= 0 && layout.dialog.right <= width + 1);
            assert(layout.stage.height > 24, 'preview remains visible');
            assert(Math.abs(layout.stageRatio - sourceWidth / sourceHeight) < .04, 'preserve camera aspect ratio');
          }
        };
        await measure('photo-live');
        await page.locator('#cameraCaptureShutterBtn').click();
        await measure('photo-preview');
        if (!baseline && role === 'student' && [1366, 683, 375].includes(width))
          await page.screenshot({ path: `${output}/${role}-${width}x${height}-${sourceWidth}x${sourceHeight}.png` });
        if (!baseline && initialWidth === 1920) {
          width = 640; height = 360;
          await page.setViewportSize({ width, height });
          await measure('resized-photo-preview');
          width = initialWidth; height = initialHeight;
          await page.setViewportSize({ width, height });
          await measure('restored-photo-preview');
        }
        await page.locator('#cameraCaptureRetakeBtn').click();
        await measure('photo-retake');
        await page.locator('[data-camera-mode="video"]').click();
        await measure('video-live');
        await page.locator('#cameraCaptureShutterBtn').click();
        await page.waitForFunction(() => document.querySelector('#cameraCaptureShutterBtn').textContent.includes('停止'));
        await measure('video-recording');
        // Allow the encoder to produce a chunk before stopping the recording.
        await page.waitForTimeout(1100);
        await page.locator('#cameraCaptureShutterBtn').click();
        await page.waitForFunction(() => !document.querySelector('#cameraCaptureRecordingPreview').classList.contains('hidden'));
        await measure('video-preview');
        if (!baseline) assert.deepEqual(errors, []);
        await page.locator('#cameraCaptureCloseBtn').click();
        await context.close();
        console.log(`${role} ${width}x${height} ${sourceWidth}:${sourceHeight}: checked`);
      }
    }
  } finally {
    fs.writeFileSync(`${output}/${baseline ? 'baseline' : 'result'}.json`, JSON.stringify(results, null, 2));
    await browser.close();
  }
  console.log(`${results.length} camera layouts checked (${baseline ? 'baseline' : 'passed'}).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

// Local UI verification with synthetic camera/microphone; no authenticated backend.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  fs.mkdirSync('output/playwright', { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['camera', 'microphone'] });
    const page = await context.newPage();
    const errors = [];
    let expectSizeMessage = false;
    let sizeMessage = '';
    await page.addInitScript(() => {
      window.pdfjsLib = { GlobalWorkerOptions: {} };
      window.testMediaStreams = [];
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async options => {
        const stream = await getUserMedia(options);
        testMediaStreams.push(stream);
        return stream;
      };
    });
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE:', error.message); });
    page.on('dialog', dialog => {
      if (expectSizeMessage && dialog.message().includes('45MB以下')) sizeMessage = dialog.message();
      else errors.push(dialog.message());
      void dialog.dismiss();
    });
    await page.route(/^https:\/\//, route => route.abort());
    await page.route(/\/(teacher|student)\.html$/, route => route.fulfill({
      contentType: 'text/html', body: fs.readFileSync(`public/${new URL(route.request().url()).pathname.split('/').pop()}`, 'utf8'),
    }));
    // Load the actual HTML, CSS and common UI without starting login/Realtime.
    await page.route(/\/js\/(teacher|student)\.js\?/, route => route.fulfill({
      contentType: 'text/javascript', body: 'import { initBoardUI } from "/js/board-ui.js?verify=media-background"; window.wb = initBoardUI();',
    }));
    await page.goto('http://localhost:3000/teacher.html');
    await page.waitForFunction(() => !!window.wb);
    await page.evaluate(() => document.querySelectorAll('.floating-bottom-right,.floating-sidebar').forEach(el => el.classList.remove('hidden')));
    await page.locator('[data-background-style="ruled"]').click();
    assert.equal(await page.evaluate(() => wb.exportBoardData().pages[0].boardData.backgroundStyle), 'ruled');
    assert.equal(await page.locator('[data-background-style="ruled"]').getAttribute('aria-pressed'), 'true');
    const lines = await page.evaluate(() => {
      const result = {};
      for (const style of ['grid', 'ruled', 'blank']) {
        wb.setBackgroundStyle(style);
        let vertical = 0, horizontal = 0, from;
        const originalMove = wb.ctx.moveTo.bind(wb.ctx), originalLine = wb.ctx.lineTo.bind(wb.ctx);
        wb.ctx.moveTo = (x, y) => { from = [x, y]; originalMove(x, y); };
        wb.ctx.lineTo = (x, y) => { if (from?.[0] === x) vertical++; if (from?.[1] === y) horizontal++; originalLine(x, y); };
        wb.render();
        wb.ctx.moveTo = originalMove; wb.ctx.lineTo = originalLine;
        result[style] = { vertical, horizontal };
      }
      wb.setBackgroundStyle('ruled');
      const saved = wb.exportBoardData();
      wb.importBoardData(saved);
      return { ...result, restored: wb.backgroundStyle };
    });
    assert(lines.grid.vertical > 0 && lines.grid.horizontal > 0);
    assert(lines.ruled.vertical === 0 && lines.ruled.horizontal > 0);
    assert.deepEqual(lines.blank, { vertical: 0, horizontal: 0 });
    assert.equal(lines.restored, 'ruled');
    await page.evaluate(() => wb.setTool('pen'));
    expectSizeMessage = true;
    await page.locator('#mediaInput').setInputFiles({ name: '大きな動画.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(45_000_001) });
    await page.waitForFunction(() => !document.querySelector('#mediaFileBtn').disabled);
    assert(sizeMessage.includes('YouTube'));
    assert.equal(await page.evaluate(() => wb.objects.length), 0);
    assert.equal(await page.evaluate(() => wb.tool), 'pen');
    assert.equal(await page.locator('#mediaInput').inputValue(), '');
    expectSizeMessage = false;

    // A short PCM WAV with valid metadata, independent of network fixtures.
    const samples = 24000, wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 8000) * 3000), 44 + i * 2);
    await page.locator('#mediaInput').setInputFiles({ name: '確認音声.wav', mimeType: 'audio/wav', buffer: wav });
    await page.waitForFunction(() => wb.objects.some(o => o.kind === 'audio'));
    assert.equal(await page.evaluate(() => wb.tool), 'select');
    await page.evaluate(() => wb.activateVideoPlayer(wb.objects.find(o => o.kind === 'audio')));
    assert.equal(await page.locator('.audio-player-shell audio').count(), 1);
    await page.locator('.audio-player-shell audio').evaluate(audio => audio.play());
    await page.waitForFunction(() => document.querySelector('.audio-player-shell audio').currentTime > 0.1);
    await page.screenshot({ path: 'output/playwright/audio-player-desktop.png' });
    await page.locator('.video-player-close').click();
    const originalAudio = await page.evaluate(() => ({ ...wb.objects.find(o => o.kind === 'audio') }));
    await page.mouse.move(originalAudio.x + 25, originalAudio.y + 25);
    await page.mouse.down();
    await page.mouse.move(originalAudio.x + 73, originalAudio.y + 49, { steps: 5 });
    await page.mouse.up();
    const movedAudio = await page.evaluate(() => ({ ...wb.objects.find(o => o.kind === 'audio') }));
    assert.equal(movedAudio.x, originalAudio.x + 48);
    assert.equal(movedAudio.y, originalAudio.y + 24);
    await page.mouse.move(movedAudio.x + movedAudio.width, movedAudio.y + movedAudio.height);
    await page.mouse.down();
    await page.mouse.move(movedAudio.x + movedAudio.width + 60, movedAudio.y + movedAudio.height + 27, { steps: 5 });
    await page.mouse.up();
    assert(await page.evaluate(width => wb.objects.find(o => o.kind === 'audio').width > width, movedAudio.width));
    const restoration = await page.evaluate(() => {
      const before = wb.objects.find(o => o.kind === 'audio');
      const key = before.assetKey;
      const saved = wb.exportBoardData();
      wb.importBoardData(saved);
      const restored = wb.objects.find(o => o.kind === 'audio');
      wb._setSelected(restored); wb.deleteSelection(); wb.undoLast();
      return { keyPreserved: wb.objects.find(o => o.kind === 'audio')?.assetKey === key, source: restored.videoObjectUrl, mime: restored.assetMimeType };
    });
    assert(restoration.keyPreserved && restoration.source.startsWith('blob:'));
    assert.equal(restoration.mime, 'audio/wav');

    await page.locator('#cameraCaptureBtn').click();
    await page.waitForFunction(() => document.querySelector('#cameraCaptureVideo').videoWidth > 0);
    await page.locator('#cameraCaptureShutterBtn').click();
    await page.waitForFunction(() => !document.querySelector('#cameraCaptureInsertBtn').disabled);
    await page.locator('#cameraCaptureInsertBtn').click();
    await page.waitForFunction(() => wb.objects.some(o => o.kind === 'image'));
    assert(await page.evaluate(() => {
      const key = wb.objects.find(o => o.kind === 'image').assetKey;
      wb.importBoardData(wb.exportBoardData());
      return wb.objects.find(o => o.kind === 'image').assetKey === key;
    }));
    await page.locator('#cameraCaptureBtn').click();
    await page.waitForFunction(() => document.querySelector('#cameraCaptureVideo').videoWidth > 0);
    await page.locator('[data-camera-mode="video"]').click();
    await page.locator('#cameraCaptureShutterBtn').click();
    await page.waitForFunction(() => document.querySelector('#cameraCaptureMessage').textContent.startsWith('録画中'));
    assert(await page.locator('[data-camera-mode="photo"]').isDisabled());
    await page.waitForTimeout(1300);
    await page.locator('#cameraCaptureShutterBtn').click();
    await page.waitForFunction(() => !document.querySelector('#cameraCaptureInsertBtn').disabled);
    await page.locator('#cameraCaptureRecordingPreview').evaluate(video => video.play());
    await page.waitForFunction(() => document.querySelector('#cameraCaptureRecordingPreview').currentTime > 0);
    await page.locator('#cameraCaptureInsertBtn').click();
    await page.waitForFunction(() => wb.objects.some(o => o.kind === 'video'));
    assert.equal(await page.evaluate(() => wb.tool), 'select');
    assert.equal(await page.locator('#cameraCaptureVideo').evaluate(v => v.srcObject), null);
    const video = await page.evaluate(() => {
      const v = wb.objects.find(o => o.kind === 'video');
      wb.activateVideoPlayer(v);
      return { width: v.videoWidth, height: v.videoHeight, bytes: v.assetSizeBytes, mime: v.assetMimeType };
    });
    assert(video.width > 0 && video.height > 0 && video.bytes > 0);
    await page.locator('.video-player-shell video').evaluate(v => v.play());
    await page.waitForFunction(() => document.querySelector('.video-player-shell video').currentTime > 0);
    await page.locator('.video-player-close').click();
    await page.screenshot({ path: 'output/playwright/media-background-desktop.png' });

    // Closing while recording discards it and stops every device track.
    const count = await page.evaluate(() => wb.objects.length);
    await page.locator('#cameraCaptureBtn').click();
    await page.locator('[data-camera-mode="video"]').click();
    await page.locator('#cameraCaptureShutterBtn').click();
    await page.waitForFunction(() => document.querySelector('#cameraCaptureMessage').textContent.startsWith('録画中'));
    await page.evaluate(() => { window.testTracks = document.querySelector('#cameraCaptureVideo').srcObject.getTracks(); });
    await page.locator('#cameraCaptureCloseBtn').click();
    assert(await page.evaluate(() => testTracks.every(t => t.readyState === 'ended')));
    assert(await page.evaluate(() => testMediaStreams.every(stream => stream.getTracks().every(t => t.readyState === 'ended'))));
    assert.equal(await page.evaluate(() => wb.objects.length), count);

    for (const screen of ['teacher', 'student']) {
      if (screen === 'student') {
        await page.goto('http://localhost:3000/student.html');
        await page.waitForFunction(() => !!window.wb);
        await page.evaluate(() => document.querySelector('#studentLoginOverlay')?.classList.add('hidden'));
      }
      await page.setViewportSize({ width: 375, height: 667 });
      await page.evaluate(() => document.querySelectorAll('.floating-bottom-right,.floating-sidebar').forEach(el => el.classList.remove('hidden')));
      const layout = await page.locator('#backgroundStyleControl').evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, doc: document.documentElement.scrollWidth }));
      assert(layout.left >= 0 && layout.right <= 375 && layout.doc <= 375, `${screen} overflow: ${JSON.stringify(layout)}`);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('board-asset-upload', { detail: { id: 'fixture', fileName: '10分動画.mp4', state: 'uploading', sent: 20_000_000, total: 40_000_000 } })));
      assert((await page.locator('.board-upload-status').innerText()).includes('50%'));
      const panelRect = await page.locator('.board-upload-status').boundingBox();
      assert(panelRect.x >= 0 && panelRect.x + panelRect.width <= 375);
      await page.screenshot({ path: `output/playwright/upload-${screen}-375.png` });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('board-asset-upload', { detail: { id: 'fixture', state: 'uploading', retrying: true } })));
      assert((await page.locator('.board-upload-status').innerText()).includes('再試行'));
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('board-asset-upload', { detail: { id: 'fixture', state: 'error' } })));
      await page.locator('.board-upload-status button').click();
      assert(await page.locator('.board-upload-status').isHidden());
      await page.screenshot({ path: `output/playwright/background-${screen}-375.png` });
      await page.locator('#cameraCaptureBtn').click();
      await page.waitForFunction(() => document.querySelector('#cameraCaptureVideo').videoWidth > 0);
      await page.locator('[data-camera-mode="video"]').click();
      await page.screenshot({ path: `output/playwright/camera-${screen}-375.png` });
      await page.locator('#cameraCaptureCloseBtn').click();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ lines, restoration, video, screens: ['teacher', 'student'], errors }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

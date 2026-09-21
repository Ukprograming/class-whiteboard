// Local Edge UI, serialization, and action-receiver checks; no authenticated server.
import assert from "node:assert/strict";
import { readFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "file:///C:/Users/sotso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = path.resolve("public");
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(readFileSync(path.join(root, process.env.LASER_TEST_PAGE || "student.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
  }
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) || !existsSync(file)) return res.writeHead(404).end();
  res.setHeader("Content-Type", /\.m?js$/.test(file) ? "text/javascript" : /\.css$/.test(file) ? "text/css" : "application/octet-stream");
  createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true });
mkdirSync("output/playwright", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    document.getElementById("studentLoginOverlay")?.remove();
    window.wb = (await import("/js/board-ui.js")).initBoardUI();
    wb.resize(innerWidth, innerHeight);
    const receiverCanvas = document.createElement("canvas");
    const holder = document.createElement("div");
    holder.style.display = "none"; holder.append(receiverCanvas); document.body.append(holder);
    window.receiver = new wb.constructor({ canvas: receiverCanvas });
    window.actions = [];
    wb.onAction = action => { actions.push(structuredClone(action)); receiver.applyAction(structuredClone(action)); };
  });
  async function tool(name) {
    await page.locator(`#wbSidebar [data-tool="${name}"]`).click();
  }
  async function drag(x1, y1, x2, y2) {
    await page.mouse.move(x1, y1); await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 5 }); await page.mouse.up();
  }
  await tool("laser");
  await tool("laser");
  await page.locator('[data-pen-color="#0ea5e9"]').click();
  assert.equal(await page.evaluate(() => wb.laserColor), "#0ea5e9");
  const penColor = await page.evaluate(() => wb.penColor);
  await tool("laser");
  await page.mouse.move(450, 250); await page.mouse.down();
  await page.mouse.move(650, 350, { steps: 20 });
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => !!wb.laserTrail.active && wb.laserTrail.paths.length === 1), true);
  assert.equal(await page.evaluate(() => wb.laserTrail.layer.getContext("2d").globalAlpha), 1);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.mouse.move(450, 380); await page.mouse.down();
  await page.mouse.move(650, 450, { steps: 20 });
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => wb.laserTrail.paths.length), 2);
  await page.screenshot({ path: "output/playwright/laser-trail.png" });
  assert.deepEqual(await page.evaluate(() => [wb.strokes.length, wb.history.length, actions.length, wb.isDirty()]), [0, 0, 0, false]);
  await page.mouse.up();
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => wb.laserTrail.layer.getContext("2d").globalAlpha), 1);
  await page.waitForTimeout(600);
  const alpha = await page.evaluate(() => wb.laserTrail.layer.getContext("2d").globalAlpha);
  assert.ok(alpha > 0 && alpha < 1, String(alpha));
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.laser-trail-layer').count(), 0);
  await tool("pen");
  assert.equal(await page.evaluate(() => wb.penColor), penColor);
  await drag(450, 500, 650, 520);
  assert.equal(await page.evaluate(() => wb.strokes.length), 1);
  await tool("laser"); await tool("laser");
  assert.equal(await page.locator('[data-pen-color="#0ea5e9"]').getAttribute('class').then(s => s.includes('active')), true);
  await tool("laser");
  // A tap must render a dot, and leaving the canvas must release held ink.
  await page.mouse.move(500, 300); await page.mouse.down();
  const pixels = await page.evaluate(() => {
    const c = wb.laserTrail.layer; return [...c.getContext('2d').getImageData(500, 300, 1, 1).data];
  });
  assert.ok(pixels[3] > 0);
  await page.mouse.move(-10, 300); await page.mouse.up();
  assert.equal(await page.evaluate(() => wb.laserTrail.active), null);
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.laser-trail-layer').count(), 0);
  // Touch input and cancellation use the same lifecycle.
  await page.evaluate(() => {
    const canvas = wb.canvas;
    const touch = new Touch({ identifier: 1, target: canvas, clientX: 500, clientY: 300 });
    canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], cancelable: true }));
    canvas.dispatchEvent(new TouchEvent('touchcancel', { touches: [], changedTouches: [touch] }));
  });
  assert.equal(await page.evaluate(() => wb.laserTrail.active), null);
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.laser-trail-layer').count(), 0);
  await page.evaluate(() => { wb.laserTrail.begin(500, 300); wb.addPage(); });
  assert.equal(await page.locator('.laser-trail-layer').count(), 0);
  await page.setViewportSize({ width: 375, height: 740 });
  await tool("laser");
  await page.waitForTimeout(100);
  const menu = await page.locator('#contextMenu').boundingBox();
  assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= 375, JSON.stringify(menu));
  await page.screenshot({ path: "output/playwright/laser-menu-mobile.png" });
  await page.evaluate(() => { wb.laserTrail.begin(500, 300); wb.laserTrail.end(); wb.destroy(); });
  assert.equal(await page.locator('.laser-trail-layer').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Laser browser checks passed: hold, multi-stroke writing, delay/fade, color isolation, tap, exit, touch cancel, history, page change, teardown.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}


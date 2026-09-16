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
    return res.end(readFileSync(path.join(root, "student.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
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
    document.getElementById("studentLoginOverlay").remove();
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
  const editor = page.locator("#boardContainer > textarea");
  await tool("text");
  // The second tool tap opens its settings menu.
  await tool("text");
  await page.locator("label:has(#verticalWritingToggle)").click();
  await page.locator("label:has(#textBorderToggle)").click();
  await page.locator("[data-text-border-width]").selectOption("4");
  await page.locator("[data-text-border-style]").selectOption("dashed");
  await page.locator("[data-text-border-color]").fill("#dc2626");
  await drag(450, 180, 720, 480);
  assert.deepEqual(await page.evaluate(() => {
    const o = wb.objects.at(-1); return [o.x, o.y, o.width, o.height, o.writingMode, o.borderVisible, o.borderStyle, o.borderWidth, o.borderColor];
  }), [450, 180, 270, 300, "vertical-rl", true, "dashed", 4, "#dc2626"]);
  assert.equal(await editor.evaluate(el => getComputedStyle(el).writingMode), "vertical-rl");
  await editor.fill("縦書きのテキスト。\n「授業ノート」\nカレーとコーヒー\nABC１２３、。😀");
  await editor.press("Enter");
  assert.equal(await page.evaluate(() => wb.tool), "select");
  assert.equal(await page.evaluate(() => receiver.objects.at(-1).text), "縦書きのテキスト。\n「授業ノート」\nカレーとコーヒー\nABC１２３、。😀");
  await page.evaluate(() => {
    const saved = wb.exportBoardData(); receiver.importBoardData(saved);
    window.savedText = saved.pages[0].boardData.objects[0];
  });
  assert.deepEqual(await page.evaluate(() => [receiver.objects[0].writingMode, receiver.objects[0].borderStyle, receiver.objects[0].borderColor]), ["vertical-rl", "dashed", "#dc2626"]);
  // Existing object changes propagate and can be undone.
  await page.evaluate(() => { wb.setSelectedTextStyle({ writingMode: "horizontal-tb", borderStyle: "dotted" }); wb.undoLast(); });
  assert.deepEqual(await page.evaluate(() => [wb.objects[0].writingMode, receiver.objects[0].borderStyle]), ["vertical-rl", "dashed"]);
  const growth = await page.evaluate(() => {
    const legacy = receiver._hydrateBoardData({ objects: [{ id: "old", kind: "sticky", x: 0, y: 0, width: 240, height: 60, text: "昔の付箋" }] }).objects[0];
    const sample = { ...wb.objects[0], text: "あ".repeat(60), width: 80, height: 80, writingMode: "horizontal-tb" };
    wb.objects.push(sample); wb._setSelected(sample);
    wb.setSelectedTextStyle({ writingMode: "vertical-rl" });
    const expanded = sample.width;
    const columns = wb._verticalTextColumns(sample).length;
    wb.undoLast();
    const restored = [sample.width, sample.height, sample.writingMode];
    wb.objects.pop(); wb._setSelected(wb.objects[0]);
    return { expanded, columns, restored, legacy: [legacy.height, legacy.writingMode] };
  });
  assert(growth.expanded > 80);
  assert.equal(growth.columns, 15);
  assert.deepEqual(growth.restored, [80, 80, "horizontal-tb"]);
  assert.deepEqual(growth.legacy, [60, "horizontal-tb"]);
  await tool("sticky");
  await page.mouse.click(780, 190);
  assert.deepEqual(await page.evaluate(() => [wb.objects.at(-1).width, wb.objects.at(-1).height]), [240, 240]);
  await editor.fill("正方形の付箋\n縦書きにも対応"); await editor.press("Enter");
  // Click still creates the original size, even after a drag creation.
  await page.evaluate(() => { wb.setTextDefaults({ writingMode: "horizontal-tb", borderStyle: "dotted" }); wb.setTool("text"); });
  await page.mouse.click(430, 570);
  assert.deepEqual(await page.evaluate(() => [wb.objects.at(-1).width, wb.objects.at(-1).height]), [240, 60]);
  await editor.fill("クリックで従来サイズ"); await editor.press("Enter");
  await page.evaluate(() => { wb.setTextDefaults({ borderStyle: "solid", borderWidth: 2 }); wb.setTool("text"); });
  await drag(980, 730, 760, 570);
  assert.deepEqual(await page.evaluate(() => { const o = wb.objects.at(-1); return [o.x, o.y, o.width, o.height]; }), [760, 570, 220, 160]);
  await editor.fill("逆方向へのドラッグ\n横書き・実線"); await editor.press("Enter");
  await page.evaluate(() => { wb.setWordCountVisible(true); wb._setSelected(null); });
  await page.screenshot({ path: "output/playwright/text-layout-desktop.png" });
  // A zoomed drag uses world dimensions, and touchcancel/pinch leave no object.
  await page.evaluate(() => { wb.scale = 2; wb.offsetX = 20; wb.offsetY = 30; wb.setTool("text"); });
  await drag(500, 200, 700, 400);
  assert.deepEqual(await page.evaluate(() => { const o = wb.objects.at(-1); return [o.x, o.y, o.width, o.height]; }), [240, 85, 100, 100]);
  await editor.fill("ズーム"); await editor.press("Enter");
  const touchResult = await page.evaluate(() => {
    const canvas = wb.canvas;
    const touch = (id, x, y) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
    const emit = (type, touches, changedTouches = touches) => canvas.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches }));
    const before = wb.objects.length;
    wb.setTool("text"); emit("touchstart", [touch(1, 500, 200)]); emit("touchmove", [touch(1, 600, 400)]); emit("touchcancel", []);
    const afterCancel = wb.objects.length;
    emit("touchstart", [touch(1, 500, 200)]); emit("touchstart", [touch(1, 500, 200), touch(2, 700, 400)]); emit("touchend", [], [touch(1, 500, 200)]);
    const afterPinch = wb.objects.length;
    emit("touchstart", [touch(1, 500, 200)]); emit("touchmove", [touch(1, 600, 400)]); emit("touchend", [], [touch(1, 600, 400)]);
    return [afterCancel - before, afterPinch - before, wb.objects.length - before, wb.objects.at(-1).width, wb.objects.at(-1).height];
  });
  assert.deepEqual(touchResult, [0, 0, 1, 50, 100]);
  await editor.fill("タッチ"); await editor.press("Enter");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "output/playwright/text-layout-mobile-before.png" });
  await tool("text");
  if (!await page.locator("#verticalWritingToggle").isVisible()) await tool("text");
  await page.locator("[data-text-border-style]").scrollIntoViewIfNeeded();
  const layout = await page.locator("#contextMenu").evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, right: el.getBoundingClientRect().right, bottom: el.getBoundingClientRect().bottom }));
  assert(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
  assert(layout.right <= 375 && layout.bottom <= 812, JSON.stringify(layout));
  await page.screenshot({ path: "output/playwright/text-layout-mobile.png" });
  await tool("sticky"); await tool("sticky");
  assert.equal(await page.locator("[data-text-border-settings]").isVisible(), false);
  assert.equal(await page.locator("label:has(#verticalWritingToggle)").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log("Text layout browser checks passed: vertical editing, 3 borders, click/drag/reverse/zoom/touch, cancel/pinch, square sticky, save/reload, receiver, Undo, 375px menus.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

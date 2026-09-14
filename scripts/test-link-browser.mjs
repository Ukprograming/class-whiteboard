import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "file:///C:/Users/sotso/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const publicRoot = path.resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  const relative = pathname === "/" ? "link-browser-fixture.html" : pathname.slice(1);
  const filePath = path.resolve(publicRoot, relative);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    res.writeHead(403).end();
    return;
  }
  if (relative === "link-browser-fixture.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><canvas id="board" width="800" height="600" style="width:800px;height:600px"></canvas>');
    return;
  }
  try {
    await stat(filePath);
    res.writeHead(200, { "content-type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });

async function newBoardPage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.addInitScript(() => {
    window.__openCalls = [];
    window.open = (...args) => {
      window.__openCalls.push(args);
      return { opener: window };
    };
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    const { Whiteboard } = await import("/js/whiteboard.js");
    const canvas = document.getElementById("board");
    window.wb = new Whiteboard({ canvas });
    window.wb.resize(800, 600);
    window.wb.setTool("select");
  });
  return page;
}

try {
  {
    const page = await newBoardPage();
    const importedUrl = await page.evaluate(() => {
      window.wb.importBoardData({
        version: 3,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        objects: [{ id: 1, kind: "link", x: 100, y: 100, width: 240, height: 80,
          text: "javascript:alert(1)", url: "javascript:alert(1)" }],
        strokes: [],
      });
      return window.wb.objects[0].url;
    });
    assert.equal(importedUrl, "", "import must strip a javascript URL");
    await page.mouse.dblclick(220, 140);
    assert.deepEqual(await page.evaluate(() => window.__openCalls), []);
    await page.close();
  }

  {
    const page = await newBoardPage();
    await page.evaluate(() => {
      const object = window.wb.pasteLink("https://example.com/safe");
      object.x = 100;
      object.y = 100;
      object.url = "javascript:alert(2)";
      window.wb.render();
    });
    await page.mouse.dblclick(220, 140);
    assert.deepEqual(await page.evaluate(() => window.__openCalls), [],
      "a malicious URL assigned after import must not open");
    await page.close();
  }

  {
    const page = await newBoardPage();
    await page.evaluate(() => {
      const object = window.wb.pasteLink("https://example.com/lesson?q=1");
      object.x = 100;
      object.y = 100;
      window.wb.render();
    });
    await page.mouse.dblclick(220, 140);
    assert.deepEqual(await page.evaluate(() => window.__openCalls), [
      ["https://example.com/lesson?q=1", "_blank", "noopener,noreferrer"],
    ]);
    await page.close();
  }

  console.log("Whiteboard link browser tests passed (Edge headless, 3 isolated pages).");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

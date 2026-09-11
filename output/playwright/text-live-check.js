async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/text-live-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<meta charset="utf-8"><style>body{font:16px system-ui;background:#f8fafc}main{display:flex;gap:20px}.board{position:relative;width:560px;height:450px;border:1px solid #aaa;background:white}canvas{width:560px;height:450px}button{margin:8px}</style><button id="text">Text</button><button id="sticky">Sticky</button><span id="tool"></span><main><section><h2>生徒側</h2><div class="board"><canvas id="student"></canvas></div></section><section><h2>教員モーダルと同じ描画処理</h2><div class="board"><canvas id="teacher"></canvas></div></section></main>'
  }));
  await page.goto('http://127.0.0.1:3011/text-live-fixture');
  await page.evaluate(async () => {
    const { Whiteboard } = await import('/js/whiteboard.js?text-live=20260911');
    window.student = new Whiteboard({canvas: document.querySelector('#student')});
    window.teacher = new Whiteboard({canvas: document.querySelector('#teacher')});
    student.resize(560,450); teacher.resize(560,450); teacher.setTeacherMode(true);
    window.actions = [];
    student.onAction = action => { const copy = structuredClone(action); actions.push(copy); teacher.applyAction(copy); };
    student.onToolChange = tool => document.querySelector('#tool').textContent = tool;
    for (const kind of ['text','sticky']) document.getElementById(kind).onclick = () => student.setTool(kind);
  });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const results = [];
  for (const [index, kind] of ['text','sticky'].entries()) {
    await page.locator(`#${kind}`).click();
    await page.locator('#student').click({position:{x:30,y:35 + index*180}});
    await page.keyboard.insertText('こんにちは');
    await page.waitForFunction(() => teacher.objects.at(-1)?.text === 'こんにちは');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.insertText('second line');
    await page.waitForFunction(() => teacher.objects.at(-1)?.text === 'こんにちは\nsecond line');
    await page.keyboard.press('Backspace');
    await page.waitForFunction(() => teacher.objects.at(-1)?.text === 'こんにちは\nsecond lin');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
    await page.waitForFunction(() => teacher.objects.at(-1)?.text === '');
    await page.keyboard.insertText('日本語の変換');
    await page.evaluate(() => student.textEditor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true})));
    assert(await page.evaluate(() => !!student.editingObj), 'IME Enter prematurely closed editor');
    await page.keyboard.press('Enter');
    assert(await page.evaluate(() => student.tool === 'select' && !student.editingObj), 'Enter did not select');
    // Reopen through a real double click: this is the reported creation-tool case.
    await page.locator('#student').dblclick({position:{x:70,y:48 + index*180}});
    assert(await page.evaluate(() => !!student.editingObj), 'double click did not open text editor');
    await page.keyboard.insertText(kind === 'text' ? 'テキストを編集中\n改行も共有' : '付箋を編集中\n削除も共有');
    await page.keyboard.press('Enter');
    assert(await page.evaluate(() => student.tool === 'select' && document.querySelector('#tool').textContent === 'select'), 'toolbar not restored');
    await page.locator('#student').click({position:{x:470,y:390}});
    assert(await page.evaluate(count => student.objects.length === count && teacher.objects.length === count, index+1), 'blank click created an unwanted object');
    const beforeUndo = await page.evaluate(() => student.objects.at(-1).text);
    await page.evaluate(() => student.undoLast());
    assert(await page.evaluate(() => student.objects.at(-1).text === '日本語の変換' && teacher.objects.at(-1).text === '日本語の変換'), 'Undo did not restore both views');
    await page.evaluate(text => {
      student._openTextEditorForObject(student.objects.at(-1));
      student.textEditor.value = text;
      student.textEditor.dispatchEvent(new Event('input'));
      student._commitTextEditor();
    }, beforeUndo);
    results.push({kind, passed:true});
  }
  // A newly opened monitor loads the latest text via the normal snapshot path.
  const snapshot = await page.evaluate(() => student.exportBoardData());
  await page.evaluate(data => teacher.importBoardData(data), snapshot);
  assert(await page.evaluate(() => teacher.objects.map(o=>o.text).join('|') === student.objects.map(o=>o.text).join('|')), 'snapshot reload lost text');
  await page.screenshot({path:'output/playwright/text-live-sync.png', fullPage:true});
  assert(errors.length === 0, errors.join('\n'));
  return {results, snapshotReload:true, errors, screenshot:'output/playwright/text-live-sync.png'};
}

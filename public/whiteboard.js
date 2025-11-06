// whiteboard.js
// 無限ホワイトボード + ベクター手書き + テキスト / 付箋 / 図形
// 選択ツールでオブジェクト移動・リサイズ + キャンバス上でテキスト編集 + テキスト書式変更

export class Whiteboard {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // ★ 追加：デバイスピクセル比
    this.dpr = window.devicePixelRatio || 1;

    // 背景（PDF / 画像）
    this.bgCanvas = document.createElement("canvas");
    this.bgCtx = this.bgCanvas.getContext("2d");

    // 手書きストローク（※今回は移動・リサイズはまだ未対応）
    this.strokes = []; // { type, color, width, points: [{x,y},...] }

    // ベクターオブジェクト（テキスト / 付箋 / 図形）
    // kind: 'text' | 'sticky' | 'rect' | 'ellipse' | 'image'
    this.objects = [];
    this.nextObjectId = 1;

    // 操作履歴（Undo 用）
    this.history = []; // { kind:'stroke', stroke } | { kind:'object', id } | { kind:'delete-object', object, index }

    // 表示（ズーム＆パン）
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // ペン・ツール
    this.tool = "pen";
    this.penColor = "#000000";
    this.penWidth = 3;
    this.highlighterColor = "rgba(255,255,0,0.35)";
    this.highlighterWidth = 18;
    this.eraserWidth = 24;

    // 状態フラグ
    this.isDrawingStroke = false;
    this.currentStroke = null;

    this.isDrawingShape = false;
    this.shapeStartX = 0;
    this.shapeStartY = 0;
    this.shapeDraft = null;

    this.isPanning = false;
    this.lastPanScreenX = 0;
    this.lastPanScreenY = 0;

    // 選択状態（オブジェクトのみ）
    this.selectedObj = null; // { ...object }
    this.isDraggingObj = false;
    this.isResizingObj = false;
    this.resizeHandle = null; // 'nw','ne','se','sw'
    this.dragStart = null;    // { wx, wy, x, y, width, height, anchorX, anchorY, aspect }
    this.handleRects = [];    // 画面上のハンドルの当たり判定用

    // テキスト編集用オーバーレイ
    this.textEditor = this._createTextEditor();
    this.editingObj = null; // 編集中の text オブジェクト

    // 外側から UI を更新するためのコールバック
    // teacher.js / student.js から wb.onSelectionChange = fn; という形で登録
    this.onSelectionChange = null;

    this._attachEvents();
    this.render();
  }

  // ====== 公開 API ======

  setTool(tool) {
    this.tool = tool;
    // テキスト編集中でツール変更されたら確定して閉じる
    if (this.editingObj) {
      this._commitTextEditor();
    }
  }

  setPen(color, width) {
    this.penColor = color;
    this.penWidth = width;
  }

  setHighlighterColor(color) {
    if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
      const hex =
        color.length === 4
          ? "#" +
            color[1] +
            color[1] +
            color[2] +
            color[2] +
            color[3] +
            color[3]
          : color;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      this.highlighterColor = `rgba(${r}, ${g}, ${b}, 0.35)`;
    } else {
      this.highlighterColor = color;
    }
  }

  async loadImageFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        this.bgCanvas.width = img.width;
        this.bgCanvas.height = img.height;
        this.bgCtx.clearRect(0, 0, img.width, img.height);
        this.bgCtx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

        this.scale = 1;
        this.offsetX = (this.canvas.width - img.width) / 2;
        this.offsetY = (this.canvas.height - img.height) / 2;
        this.render();
        resolve();
      };
      img.onerror = err => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  async loadPdfFile(file) {
    const url = URL.createObjectURL(file);

    try {
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;

      // PDF のときは背景キャンバスは使わない（描画しないように 0x0 にしておく）
      this.bgCanvas.width = 0;
      this.bgCanvas.height = 0;

      const pageMargin = 40; // ページ間のすき間（ワールド座標）
      let currentY = 0;

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        // 各ページをオフスクリーンキャンバスにレンダリング
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = viewport.width;
        pageCanvas.height = viewport.height;
        const pageCtx = pageCanvas.getContext("2d");

        await page.render({
          canvasContext: pageCtx,
          viewport
        }).promise;

        // image オブジェクトとして追加
        const id = this.nextObjectId++;
        const obj = {
          id,
          kind: "image",
          x: 0,
          y: currentY,
          width: viewport.width,
          height: viewport.height,
          image: pageCanvas
        };
        this._addObject(obj);

        currentY += viewport.height + pageMargin;
      }

      // 初期表示位置を少し左上に寄せておく
      this.scale = 1;
      this.offsetX = 40;
      this.offsetY = 40;

      this.render();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  clearAll() {
    this.strokes = [];
    this.objects = [];
    this.history = [];
    this._setSelected(null);
    this.render();
  }

  undoLast() {
    const last = this.history.pop();
    if (!last) return;

    if (last.kind === "stroke") {
      // ストロークの追加を取り消す → 配列から削除
      const idx = this.strokes.indexOf(last.stroke);
      if (idx >= 0) this.strokes.splice(idx, 1);

    } else if (last.kind === "object") {
      // オブジェクトの追加を取り消す → 配列から削除
      const idx = this.objects.findIndex(o => o.id === last.id);
      if (idx >= 0) this.objects.splice(idx, 1);
      if (this.selectedObj && this.selectedObj.id === last.id) {
        this._setSelected(null);
      }

    } else if (last.kind === "delete-object") {
      // 削除を取り消す → 元の位置にオブジェクトを戻す
      const index =
        typeof last.index === "number" ? last.index : this.objects.length;
      this.objects.splice(index, 0, last.object);
      this._setSelected(last.object);
    }

    this.render();
  }

  // 選択中テキストのコピー
  copySelection() {
    if (!this.selectedObj) return;
    const kind = this.selectedObj.kind;
    if (!["text", "sticky", "rect", "ellipse", "link"].includes(kind)) return; // ← link 追加
    this.clipboard = JSON.parse(JSON.stringify(this.selectedObj));
  }


  // ペースト
  pasteSelection() {
    if (!this.clipboard) return;
    const base = this.clipboard;
    const obj = {
      ...JSON.parse(JSON.stringify(base)),
      id: this.nextObjectId++,
      x: base.x + 40,
      y: base.y + 40
    };
    this.objects.push(obj);
    this.history.push({ kind: "object", id: obj.id });
    this._setSelected(obj);
    this.render();
  }

  // 選択中オブジェクトの削除（Undo 可能）
  deleteSelection() {
    if (!this.selectedObj) return;

    const id = this.selectedObj.id;
    const idx = this.objects.findIndex(o => o.id === id);
    if (idx === -1) return;

    // 削除されたオブジェクトを退避
    const [removed] = this.objects.splice(idx, 1);

    // Undo 用に履歴へ保存（元の位置も覚えておく）
    this.history.push({
      kind: "delete-object",
      object: removed,
      index: idx
    });

    this._setSelected(null);
    this.render();
  }

  // クリップボードのプレーンテキストをテキストボックスとして貼り付け
  pastePlainText(text) {
    if (!text) return;

    // ★ CSS ピクセルベースでキャンバス中央を取得
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;

    // 画面座標 → ワールド座標
    const { x: wx, y: wy } = this._screenToWorld(sx, sy);

    const id = this.nextObjectId++;
    const width = 260;
    const height = 80;

    const obj = {
      id,
      kind: "text",
      x: wx - width / 2,
      y: wy - height / 2,
      width,
      height,
      text,
      fontSize: 16,
      fontFamily: "system-ui",
      bold: false,
      fill: "transparent",
      stroke: "transparent"
    };

    this._addObject(obj);
    this.render();
    this._openTextEditorForObject(obj);
  }


  // URL をリンクオブジェクトとして貼り付け
  pasteLink(url) {
    if (!url) return;

    // ★ CSS ピクセルベースでキャンバス中央を取得
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;

    const { x: wx, y: wy } = this._screenToWorld(sx, sy);

    const id = this.nextObjectId++;
    const width = 260;
    const height = 40;

    const obj = {
      id,
      kind: "link",
      x: wx - width / 2,
      y: wy - height / 2,
      width,
      height,
      text: url,
      url,
      fontSize: 16,
      fontFamily: "system-ui",
      bold: false
    };

    this._addObject(obj);
    this.render();
  }



  exportPngDataUrl() {
    return this.canvas.toDataURL("image/png");
  }

  drawToTargetCanvas(targetCanvas) {
    const tctx = targetCanvas.getContext("2d");
    tctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    tctx.drawImage(this.canvas, 0, 0, targetCanvas.width, targetCanvas.height);
  }

  zoomAtCanvasCenter(factor) {
    const sx = this.canvas.width / 2;
    const sy = this.canvas.height / 2;
    this._zoomAtScreenPoint(sx, sy, factor);
  }

  // テキストスタイル変更（左メニューから呼ぶ）
  setSelectedTextStyle({ fontSize, fontFamily, bold }) {
    if (!this.selectedObj || this.selectedObj.kind !== "text") return;
    if (fontSize != null) this.selectedObj.fontSize = fontSize;
    if (fontFamily) this.selectedObj.fontFamily = fontFamily;
    if (typeof bold === "boolean") this.selectedObj.bold = bold;
    this.render();
    this._fireSelectionChange();
  }

  // ====== 内部ユーティリティ ======

  _screenToWorld(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale
    };
  }

  _worldToScreen(wx, wy) {
    return {
      x: wx * this.scale + this.offsetX,
      y: wy * this.scale + this.offsetY
    };
  }

  _zoomAtScreenPoint(sx, sy, factor) {
    const newScale = Math.min(5, Math.max(0.2, this.scale * factor));
    const wx = (sx - this.offsetX) / this.scale;
    const wy = (sy - this.offsetY) / this.scale;
    this.scale = newScale;
    this.offsetX = sx - wx * this.scale;
    this.offsetY = sy - wy * this.scale;
    this.render();
  }

  _addStroke(stroke) {
    this.strokes.push(stroke);
    this.history.push({ kind: "stroke", stroke });
  }

  _addObject(obj) {
    this.objects.push(obj);
    this.history.push({ kind: "object", id: obj.id });
    this._setSelected(obj);
  }

  _setSelected(obj) {
    this.selectedObj = obj;
    this._fireSelectionChange();
  }

  _fireSelectionChange() {
    if (!this.onSelectionChange) return;
    if (!this.selectedObj) {
      this.onSelectionChange(null);
      return;
    }
    const o = this.selectedObj;
    if (o.kind === "text" || o.kind === "link") {   // ← link を追加
      this.onSelectionChange({
        kind: "text",
        fontSize: o.fontSize || 16,
        fontFamily: o.fontFamily || "system-ui",
        bold: !!o.bold
      });
    } else {
      this.onSelectionChange({ kind: o.kind });
    }
  }


  _createTextEditor() {
    const container = this.canvas.parentElement;
    const ta = document.createElement("textarea");
    ta.style.position = "absolute";
    ta.style.display = "none";
    ta.style.resize = "none";
    ta.style.border = "1px solid #93c5fd";
    ta.style.borderRadius = "4px";
    ta.style.padding = "4px 6px";
    ta.style.background = "rgba(255,255,255,0.95)";
    ta.style.boxShadow = "0 2px 6px rgba(15,23,42,0.25)";
    ta.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont";
    ta.style.fontSize = "14px";
    ta.style.lineHeight = "1.4";
    ta.style.outline = "none";
    ta.style.zIndex = "20";
    ta.style.whiteSpace = "pre-wrap";
    ta.style.overflow = "hidden";

    container.style.position = container.style.position || "relative";
    container.appendChild(ta);

    ta.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        e.preventDefault();
        this._cancelTextEditor();
      }
      // Ctrl+Enter で確定
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this._commitTextEditor();
      }
    });

    ta.addEventListener("blur", () => {
      // フォーカスを失ったときも確定
      if (this.editingObj) {
        this._commitTextEditor();
      }
    });

    return ta;
  }

  _openTextEditorForObject(obj) {
    this.editingObj = obj;
    const fontSize = obj.fontSize || 16;
    const fontFamily = obj.fontFamily || "system-ui";
    const bold = obj.bold ? "bold" : "normal";

    const padding = 6;
    const { x, y, width, height } = this._normalizeRect(obj);

    // 画面座標に変換
    const p1 = this._worldToScreen(x, y);
    const p2 = this._worldToScreen(x + width, y + height);
    const sx = p1.x;
    const sy = p1.y;
    const sw = p2.x - p1.x;
    const sh = p2.y - p1.y;

    this.textEditor.style.left = `${sx}px`;
    this.textEditor.style.top = `${sy}px`;
    this.textEditor.style.width = `${Math.max(sw, 150)}px`;
    this.textEditor.style.height = `${Math.max(sh, 40)}px`;
    this.textEditor.value = obj.text || "";
    this.textEditor.style.fontSize = `${fontSize}px`;
    this.textEditor.style.fontFamily = fontFamily;
    this.textEditor.style.fontWeight = bold;
    this.textEditor.style.display = "block";
    this.textEditor.focus();
    this.textEditor.select();
  }

  _commitTextEditor() {
    if (!this.editingObj) return;
    this.editingObj.text = this.textEditor.value;
    this.editingObj = null;
    this.textEditor.style.display = "none";
    this.render();
  }

  _cancelTextEditor() {
    this.editingObj = null;
    this.textEditor.style.display = "none";
    this.render();
  }

  _normalizeRect(obj) {
    let { x, y, width, height } = obj;
    if (width < 0) {
      x = x + width;
      width = -width;
    }
    if (height < 0) {
      y = y + height;
      height = -height;
    }
    return { x, y, width, height };
  }

  _createTextObject(wx, wy, kind) {
    const id = this.nextObjectId++;
    const width = 240;
    const height = 60;
    const obj = {
      id,
      kind, // 'text' or 'sticky'
      x: wx,
      y: wy,
      width,
      height,
      text: "",
      // テキストスタイル
      fontSize: 16,
      fontFamily: "system-ui",
      bold: false,
      // sticky 用
      fill: kind === "sticky" ? "#FEF3C7" : "transparent",
      stroke: kind === "sticky" ? "#FBBF24" : "transparent"
    };
    this._addObject(obj);
    this.render();
    // キャンバス上で直接入力
    this._openTextEditorForObject(obj);
  }

  _startShape(wx, wy, kind) {
    const id = this.nextObjectId++;
    const obj = {
      id,
      kind, // 'rect' | 'ellipse'
      x: wx,
      y: wy,
      width: 0,
      height: 0,
      stroke: this.penColor,
      fill: "transparent"
    };
    this.shapeStartX = wx;
    this.shapeStartY = wy;
    this.shapeDraft = obj;
    this.isDrawingShape = true;
    this._addObject(obj);
  }

  _updateShape(wx, wy) {
    if (!this.shapeDraft) return;
    this.shapeDraft.width = wx - this.shapeStartX;
    this.shapeDraft.height = wy - this.shapeStartY;
    this.render();
  }

  _finishShape() {
    if (!this.shapeDraft) return;
    const { width, height } = this.shapeDraft;
    if (Math.abs(width) < 2 && Math.abs(height) < 2) {
      this.objects = this.objects.filter(o => o.id !== this.shapeDraft.id);
      this.history = this.history.filter(
        h => !(h.kind === "object" && h.id === this.shapeDraft.id)
      );
      this._setSelected(null);
    }
    this.isDrawingShape = false;
    this.shapeDraft = null;
    this.render();
  }

  _hitTestObject(wx, wy) {
    // 上にあるもの優先
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      const { x, y, width, height } = this._normalizeRect(o);
      if (wx >= x && wx <= x + width && wy >= y && wy <= y + height) {
        return o;
      }
    }
    return null;
  }

  _hitTestResizeHandle(sx, sy) {
    // this.handleRects: { name, x, y, size }
    for (const h of this.handleRects) {
      if (
        sx >= h.x &&
        sx <= h.x + h.size &&
        sy >= h.y &&
        sy <= h.y + h.size
      ) {
        return h.name; // 'nw','ne','se','sw'
      }
    }
    return null;
  }

  _attachEvents() {
    const canvas = this.canvas;

    const getPos = e => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const world = this._screenToWorld(sx, sy);
      return { sx, sy, wx: world.x, wy: world.y };
    };

    const down = e => {
      e.preventDefault();
      if (this.editingObj) {
        this._commitTextEditor();
      }

      const { sx, sy, wx, wy } = getPos(e);

      const button = e.button != null ? e.button : 0;

      // 中ボタン / 右クリック / Alt でパン（Shift は縦横比固定に使うので除外）
      if (button === 1 || button === 2 || e.altKey) {
        this.isPanning = true;
        this.lastPanScreenX = sx;
        this.lastPanScreenY = sy;
        return;
      }

      if (this.tool === "pen" || this.tool === "highlighter" || this.tool === "eraser") {
        this.isDrawingStroke = true;
        let color = this.penColor;
        let width = this.penWidth;
        let type = this.tool;
        if (type === "highlighter") {
          color = this.highlighterColor;
          width = this.highlighterWidth;
        } else if (type === "eraser") {
          color = "#000000";
          width = this.eraserWidth;
        }
        this.currentStroke = {
          type,
          color,
          width,
          points: [{ x: wx, y: wy }]
        };
        this._addStroke(this.currentStroke);
        this.render();
        return;
      }

      if (this.tool === "text" || this.tool === "sticky") {
        this._createTextObject(wx, wy, this.tool === "sticky" ? "sticky" : "text");
        return;
      }

      if (this.tool === "rect" || this.tool === "ellipse") {
        this._startShape(wx, wy, this.tool === "rect" ? "rect" : "ellipse");
        return;
      }

      if (this.tool === "select") {
        // まずリサイズハンドル
        if (this.selectedObj) {
          const handle = this._hitTestResizeHandle(sx, sy);
          if (handle) {
            this.isResizingObj = true;
            this.resizeHandle = handle;

            // 正規化された矩形（左上 & 正の幅・高さ）
            const { x, y, width, height } = this._normalizeRect(this.selectedObj);

            // 固定されるアスペクト比（縦横比）
            const aspect =
              width !== 0 ? Math.abs(height / width) : null;

            // リサイズ中に動かない「アンカー側の角」を計算
            let anchorX = x;
            let anchorY = y;
            if (handle === "se") {
              // 右下を動かす → アンカーは左上
              anchorX = x;
              anchorY = y;
            } else if (handle === "ne") {
              // 右上を動かす → アンカーは左下
              anchorX = x;
              anchorY = y + height;
            } else if (handle === "sw") {
              // 左下を動かす → アンカーは右上
              anchorX = x + width;
              anchorY = y;
            } else if (handle === "nw") {
              // 左上を動かす → アンカーは右下
              anchorX = x + width;
              anchorY = y + height;
            }

            this.dragStart = {
              wx,
              wy,
              x,
              y,
              width,
              height,
              anchorX,
              anchorY,
              aspect
            };
            return;
          }
        }

        // 次にオブジェクト本体
        const hit = this._hitTestObject(wx, wy);
        if (hit) {
          this._setSelected(hit);
          this.isDraggingObj = true;
          this.dragStart = {
            wx,
            wy,
            x: hit.x,
            y: hit.y,
            width: hit.width,
            height: hit.height
          };
          this.render();
        } else {
          this._setSelected(null);
          this.render();
        }
        return;
      }
    };

    const move = e => {
      if (this.isPanning) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const sx = clientX - rect.left;
        const sy = clientY - rect.top;
        const dx = sx - this.lastPanScreenX;
        const dy = sy - this.lastPanScreenY;
        this.offsetX += dx;
        this.offsetY += dy;
        this.lastPanScreenX = sx;
        this.lastPanScreenY = sy;
        this.render();
        return;
      }

      if (this.isDrawingStroke && this.currentStroke) {
        e.preventDefault();
        const { wx, wy } = getPos(e);
        this.currentStroke.points.push({ x: wx, y: wy });
        this.render();
        return;
      }

      if (this.isDrawingShape) {
        e.preventDefault();
        const { wx, wy } = getPos(e);
        this._updateShape(wx, wy);
        return;
      }

      if (this.tool === "select" && (this.isDraggingObj || this.isResizingObj)) {
        e.preventDefault();
        const { wx, wy } = getPos(e);
        const obj = this.selectedObj;
        if (!obj || !this.dragStart) return;

        if (this.isDraggingObj) {
          const dx = wx - this.dragStart.wx;
          const dy = wy - this.dragStart.wy;
          obj.x = this.dragStart.x + dx;
          obj.y = this.dragStart.y + dy;
          this.render();
          return;
        }

        if (this.isResizingObj) {
          const {
            x,
            y,
            width,
            height,
            anchorX,
            anchorY,
            aspect
          } = this.dragStart;

          // ─────────────────
          // Shift キーで縦横比固定
          // ─────────────────
          if (e.shiftKey && aspect) {
            // アンカーから見たマウス位置の差
            let dx = wx - anchorX;
            let dy = wy - anchorY;

            if (dx === 0 && dy === 0) return;

            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            // どちらの変化量が大きいかで、主導する軸を決める
            let useWidth = true;
            if (absDx === 0 && absDy !== 0) {
              useWidth = false;
            } else if (absDy === 0 && absDx !== 0) {
              useWidth = true;
            } else if (width && height) {
              const scaleW = absDx / width;
              const scaleH = absDy / height;
              useWidth = scaleW >= scaleH;
            }

            let newAbsW, newAbsH;
            if (useWidth) {
              newAbsW = absDx || 1;
              newAbsH = newAbsW * aspect;
            } else {
              newAbsH = absDy || 1;
              newAbsW = newAbsH / aspect;
            }

            const signX = dx >= 0 ? 1 : -1;
            const signY = dy >= 0 ? 1 : -1;
            const newDx = newAbsW * signX;
            const newDy = newAbsH * signY;

            // アンカーを固定したまま、反対側の角を newDx / newDy だけ動かす
            let nx, ny, nw, nh;

            if (newDx >= 0) {
              nx = anchorX;
              nw = newDx;
            } else {
              nx = anchorX + newDx;
              nw = -newDx;
            }

            if (newDy >= 0) {
              ny = anchorY;
              nh = newDy;
            } else {
              ny = anchorY + newDy;
              nh = -newDy;
            }

            obj.x = nx;
            obj.y = ny;
            obj.width = nw;
            obj.height = nh;
            this.render();
            return;
          }

          // ─────────────────
          // 通常（Shift なし）のリサイズ：元の処理
          // ─────────────────
          let nx = x;
          let ny = y;
          let nw = width;
          let nh = height;

          if (this.resizeHandle.includes("n")) {
            ny = wy;
            nh = height + (y - wy);
          }
          if (this.resizeHandle.includes("w")) {
            nx = wx;
            nw = width + (x - wx);
          }
          if (this.resizeHandle.includes("s")) {
            nh = wy - y;
          }
          if (this.resizeHandle.includes("e")) {
            nw = wx - x;
          }

          obj.x = nx;
          obj.y = ny;
          obj.width = nw;
          obj.height = nh;
          this.render();
          return;
        }
      }
    };

    const up = e => {
      this.isPanning = false;
      this.isDrawingStroke = false;
      this.currentStroke = null;
      if (this.isDrawingShape) {
        this._finishShape();
      }
      if (this.isDraggingObj || this.isResizingObj) {
        this.isDraggingObj = false;
        this.isResizingObj = false;
        this.resizeHandle = null;
        this.dragStart = null;
        this.render();
      }
    };

    // ダブルクリックでテキスト編集 or リンクを開く
    const dbl = e => {
      if (this.tool !== "select") return;
      const { wx, wy } = getPos(e);
      const hit = this._hitTestObject(wx, wy);
      if (!hit) return;

      if (hit.kind === "link" && hit.url) {
        // リンクオブジェクト → URL を新しいタブで開く
        window.open(hit.url, "_blank");
        return;
      }

      if (hit.kind === "text") {
        this._setSelected(hit);
        this._openTextEditorForObject(hit);
      }
    };


    // マウス
    canvas.addEventListener("mousedown", down);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", up);
    canvas.addEventListener("mouseleave", up);
    canvas.addEventListener("dblclick", dbl);

    // タッチ
    canvas.addEventListener("touchstart", down, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", up);

    // ホイール：パン／Ctrl+ホイール：ズーム
    canvas.addEventListener(
      "wheel",
      e => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (e.ctrlKey) {
          const factor = e.deltaY < 0 ? 1.1 : 0.9;
          this._zoomAtScreenPoint(sx, sy, factor);
        } else {
          this.offsetX -= e.deltaX;
          this.offsetY -= e.deltaY;
          this.render();
        }
      },
      { passive: false }
    );
  }

  // テキスト折り返し用：幅に収まるように行分割（簡易・1文字単位）
  _wrapTextLines(text, maxWidth, fontSize, fontFamily, bold) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${bold ? "bold" : "normal"} ${fontSize}px ${fontFamily}`;
    const lines = [];
    let current = "";
    for (const ch of text) {
      const test = current + ch;
      const width = ctx.measureText(test).width;
      if (width > maxWidth && current !== "") {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    ctx.restore();
    return lines;
  }

  // ====== 描画 ======

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const dpr = this.dpr || 1;

    // 一度リセットして全クリア
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // お好みでアンチエイリアス ON
    ctx.imageSmoothingEnabled = true;

    // scale / offset に対して「DPR を掛けて」実ピクセルに変換
    ctx.setTransform(
      this.scale * dpr,
      0,
      0,
      this.scale * dpr,
      this.offsetX * dpr,
      this.offsetY * dpr
    );

    // グリッド（画面範囲）
    const gridStep = 200;
    const invScale = 1 / this.scale;
    const left = -this.offsetX * invScale;
    const top = -this.offsetY * invScale;
    const right = (w - this.offsetX) * invScale;
    const bottom = (h - this.offsetY) * invScale;
    const startX = Math.floor(left / gridStep) * gridStep;
    const endX = Math.ceil(right / gridStep) * gridStep;
    const startY = Math.floor(top / gridStep) * gridStep;
    const endY = Math.ceil(bottom / gridStep) * gridStep;

    ctx.strokeStyle = "#eeeeee";
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridStep) {
      ctx.moveTo(x + 0.5, startY);
      ctx.lineTo(x + 0.5, endY);
    }
    for (let y = startY; y <= endY; y += gridStep) {
      ctx.moveTo(startX, y + 0.5);
      ctx.lineTo(endX, y + 0.5);
    }
    ctx.stroke();

    // 背景
    if (this.bgCanvas.width > 0 && this.bgCanvas.height > 0) {
      ctx.drawImage(this.bgCanvas, 0, 0);
    }

    // オブジェクト（テキスト / 付箋 / 図形 / 画像）
    this.handleRects = [];
    for (const obj of this.objects) {
      const { x, y, width, height } = this._normalizeRect(obj);
      const isSelected = this.selectedObj && this.selectedObj.id === obj.id;
      const strokeColor = obj.stroke || "#111827";
      const fillColor = obj.fill || "transparent";

      // 画像オブジェクト（PDFページなど）
      if (obj.kind === "image" && obj.image) {
        ctx.drawImage(obj.image, x, y, width, height);
      }

      if (obj.kind === "rect" || obj.kind === "sticky") {
        if (fillColor !== "transparent") {
          ctx.fillStyle = fillColor;
          ctx.fillRect(x, y, width, height);
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2 / this.scale;
        ctx.strokeRect(x + 0.5 / this.scale, y + 0.5 / this.scale, width, height);
      } else if (obj.kind === "ellipse") {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const rx = width / 2;
        const ry = height / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
        if (fillColor !== "transparent") {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2 / this.scale;
        ctx.stroke();
      }

      if (obj.kind === "text" || obj.kind === "sticky" || obj.kind === "link") {
        const fontSize = obj.fontSize || 16;
        const fontFamily = obj.fontFamily || "system-ui";
        const bold = obj.bold ? "bold" : "normal";
        const padding = 6 / this.scale;
        const availableWidth = width - padding * 2;

        const text = obj.text || "";
        const lines = this._wrapTextLines(text, availableWidth, fontSize, fontFamily, bold);

        // 通常テキスト：濃いグレー / リンク：青
        ctx.fillStyle = obj.kind === "link" ? "#2563eb" : "#111827";
        ctx.font = `${bold} ${fontSize / this.scale}px ${fontFamily}`;
        ctx.textBaseline = "top";

        let ty = y + padding;
        const lineHeight = (fontSize * 1.4) / this.scale;
        for (const line of lines) {
          const tx = x + padding;
          ctx.fillText(line, tx, ty);

          // リンクの場合は下線を引く
          if (obj.kind === "link") {
            const textWidth = ctx.measureText(line).width;
            ctx.beginPath();
            ctx.moveTo(tx, ty + lineHeight - (4 / this.scale));
            ctx.lineTo(tx + textWidth, ty + lineHeight - (4 / this.scale));
            ctx.lineWidth = 1.5 / this.scale;
            ctx.strokeStyle = "#2563eb";
            ctx.stroke();
          }

          ty += lineHeight;
        }
      }


      // 選択枠とハンドル
      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1.5 / this.scale;
        ctx.setLineDash([6 / this.scale, 3 / this.scale]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);

        // ハンドル（4隅）
        const handleSize = 10 / this.scale;
        const corners = [
          { name: "nw", cx: x, cy: y },
          { name: "ne", cx: x + width, cy: y },
          { name: "se", cx: x + width, cy: y + height },
          { name: "sw", cx: x, cy: y + height }
        ];
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 1 / this.scale;
        for (const c of corners) {
          const hx = c.cx - handleSize / 2;
          const hy = c.cy - handleSize / 2;
          ctx.fillRect(hx, hy, handleSize, handleSize);
          ctx.strokeRect(hx, hy, handleSize, handleSize);

          // 画面座標に保存（ヒットテスト用）
          const s1 = this._worldToScreen(hx, hy);
          const s2 = this._worldToScreen(hx + handleSize, hy + handleSize);
          this.handleRects.push({
            name: c.name,
            x: s1.x,
            y: s1.y,
            size: s2.x - s1.x
          });
        }
        ctx.restore();
      }
    }

    // 手書きストローク（※選択・変形はまだ未対応）
    for (const stroke of this.strokes) {
      const pts = stroke.points;
      if (!pts || pts.length === 0) continue;

      if (stroke.type === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = stroke.width;
        ctx.globalAlpha = 1;
      } else if (stroke.type === "highlighter") {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.globalAlpha = 0.35;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.globalAlpha = 1;
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

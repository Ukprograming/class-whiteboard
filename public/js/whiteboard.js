// whiteboard.js
// 無限ホワイトボード + ベクター手書き + テキスト / 付箋 / 図形
// 選択ツールでオブジェクト移動・リサイズ + キャンバス上でテキスト編集 + テキスト書式変更
// 手書きは strokeCanvas レイヤーで管理（消しゴムは手書きのみ影響）

// 画像保存時の軽量化パラメータ
const MAX_IMAGE_EXPORT_SIZE = 2048  ;   // 画像の長辺は最大 1400px に縮小
const IMAGE_EXPORT_QUALITY  = 0.95;    // JPEG 品質（0〜1）

export class Whiteboard {
  constructor({ canvas }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // 手書き専用レイヤー
    this.strokeCanvas = document.createElement("canvas");
    this.strokeCtx = this.strokeCanvas.getContext("2d");

    // デバイスピクセル比
    this.dpr = window.devicePixelRatio || 1;

    // 背景（PDF / 画像）
    this.bgCanvas = document.createElement("canvas");
    this.bgCtx = this.bgCanvas.getContext("2d");

    // ★ 初期は背景なしにする（サイズ 0 にしておく）
    this.bgCanvas.width = 0;
    this.bgCanvas.height = 0;

    // 手書きストローク
    // stroke: { type:'pen'|'highlighter'|'eraser', color, width, points:[{x,y}], groupId?, locked? }
    this.strokes = [];

    // ベクターオブジェクト（テキスト / 付箋 / 図形 / 画像 / リンク）
    // object: { id, kind:'text'|'sticky'|'rect'|'ellipse'|'image'|'link', x,y,width,height,..., groupId?, locked? }
    this.objects = [];
    this.nextObjectId = 1;

    // 操作履歴（Undo 用）
    this.history = []; // { kind:'stroke'|'object'|'delete-object'|'delete-multi', ... }

    // 表示（ズーム＆パン）
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // ペン・ツール
    this.tool = "pen";
    this.penColor = "#000000";
    this.penWidth = 3;
    this.highlighterColor = "rgba(255,255,0,0.35)";
    this.highlighterWidth = 30;
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

    // 選択状態（オブジェクト＋ストローク、複数選択対応）
    this.selectedObj = null;          // テキスト設定用の代表オブジェクト
    this.multiSelectedObjects = [];   // 図形・テキストなど
    this.selectedStroke = null;       // 代表ストローク
    this.multiSelectedStrokes = [];   // 複数ストローク選択

    this.isDraggingObj = false;
    this.isResizingObj = false;
    this.resizeHandle = null; // 'nw','ne','se','sw'
    this.dragStart = null;    // ドラッグ／リサイズ開始時の状態
    this.handleRects = [];    // 画面上のハンドルの当たり判定用

    // ボックス選択（ドラッグで四角を描いて複数選択）
    this.isBoxSelecting = false;
    this.selectionBoxStart = null; // { x, y } ワールド座標
    this.selectionBoxEnd = null;

    // ピンチズーム / 2本指パン用
    this.isPinchZoom = false;
    this.pinchStartDistance = 0;
    this.pinchStartScale = 1;
    this.pinchStartCenter = { sx: 0, sy: 0 }; // 画面座標
    this.pinchWorld = { x: 0, y: 0 };         // ピンチ中心のワールド座標

    // テキスト編集用オーバーレイ
    this.textEditor = this._createTextEditor();
    this.editingObj = null; // 編集中の text オブジェクト

    // 外側から UI を更新するためのコールバック
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

  hasSelection() {
    return (
      (this.multiSelectedObjects && this.multiSelectedObjects.length > 0) ||
      (this.multiSelectedStrokes && this.multiSelectedStrokes.length > 0)
    );
  }

  clearAll() {
    this.strokes = [];
    this.objects = [];
    this.history = [];
    this._setSelected(null);

    // ★ 背景も完全リセット
    this.bgCanvas.width = 0;
    this.bgCanvas.height = 0;

    this.render();
  }

  undoLast() {
    const last = this.history.pop();
    if (!last) return;

    if (last.kind === "stroke") {
      const idx = this.strokes.indexOf(last.stroke);
      if (idx >= 0) this.strokes.splice(idx, 1);

    } else if (last.kind === "object") {
      const idx = this.objects.findIndex(o => o.id === last.id);
      if (idx >= 0) this.objects.splice(idx, 1);
      if (this.selectedObj && this.selectedObj.id === last.id) {
        this._setSelected(null);
      }

    } else if (last.kind === "delete-object") {
      const index =
        typeof last.index === "number" ? last.index : this.objects.length;
      this.objects.splice(index, 0, last.object);
      this._setSelected(last.object);

    } else if (last.kind === "delete-multi") {
      if (last.objects) {
        last.objects.forEach(entry => {
          const idx =
            typeof entry.index === "number" ? entry.index : this.objects.length;
          this.objects.splice(idx, 0, entry.object);
        });
      }
      if (last.strokes) {
        last.strokes.forEach(entry => {
          const idx =
            typeof entry.index === "number" ? entry.index : this.strokes.length;
          this.strokes.splice(idx, 0, entry.stroke);
        });
      }

      this.multiSelectedObjects = last.objects
        ? last.objects.map(e => e.object)
        : [];
      this.multiSelectedStrokes = last.strokes
        ? last.strokes.map(e => e.stroke)
        : [];
      this.selectedObj =
        this.multiSelectedObjects.find(
          o => o.kind === "text" || o.kind === "link"
        ) || this.multiSelectedObjects[0] || null;
      this.selectedStroke = this.multiSelectedStrokes[0] || null;
      this._fireSelectionChange();
    }

    this.render();
  }

  // 選択中テキストのコピー
  copySelection() {
    if (!this.selectedObj) return;
    const kind = this.selectedObj.kind;
    if (!["text", "sticky", "rect", "ellipse", "link"].includes(kind)) return;
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

  // 選択中のオブジェクト／ストロークをまとめて削除（ロックされているものは対象外）
  deleteSelection() {
    const objs = (this.multiSelectedObjects || []).filter(o => !o.locked);
    const strokes = (this.multiSelectedStrokes || []).filter(s => !s.locked);

    if (!objs.length && !strokes.length) return;

    const deletedObjects = [];
    const deletedStrokes = [];

    // オブジェクト削除
    objs.forEach(o => {
      const idx = this.objects.indexOf(o);
      if (idx !== -1) {
        this.objects.splice(idx, 1);
        deletedObjects.push({ object: o, index: idx });
      }
    });

    // ストローク削除
    strokes.forEach(s => {
      const idx = this.strokes.indexOf(s);
      if (idx !== -1) {
        this.strokes.splice(idx, 1);
        deletedStrokes.push({ stroke: s, index: idx });
      }
    });

    this.history.push({
      kind: "delete-multi",
      objects: deletedObjects,
      strokes: deletedStrokes
    });

    this.selectedObj = null;
    this.selectedStroke = null;
    this.multiSelectedObjects = [];
    this.multiSelectedStrokes = [];
    this._fireSelectionChange();
    this.render();
  }

  // 現在の選択を1つのグループにまとめる
  groupSelection() {
    const objs = this.multiSelectedObjects || [];
    const strokes = this.multiSelectedStrokes || [];
    if (objs.length + strokes.length <= 1) return;

    const groupId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);

    objs.forEach(o => { o.groupId = groupId; });
    strokes.forEach(s => { s.groupId = groupId; });

    this.selectedObj =
      objs.find(o => o.kind === "text" || o.kind === "link") ||
      objs[0] ||
      null;
    this.selectedStroke = strokes[0] || null;
    this._fireSelectionChange();
    this.render();
  }

  // 現在の選択をロック／アンロック
  toggleLockSelection() {
    const objs = this.multiSelectedObjects || [];
    const strokes = this.multiSelectedStrokes || [];
    if (!objs.length && !strokes.length) return;

    const anyUnlocked =
      objs.some(o => !o.locked) || strokes.some(s => !s.locked);
    const newLocked = anyUnlocked ? true : false;

    objs.forEach(o => { o.locked = newLocked; });
    strokes.forEach(s => { s.locked = newLocked; });

    this.render();
  }

  // クリップボードのプレーンテキストをテキストボックスとして貼り付け
  pastePlainText(text) {
    if (!text) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;

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

  // クリップボードからの画像貼り付け（ファイル/Blob）
  async pasteImageBlob(blob) {
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });

      const rect = this.canvas.getBoundingClientRect();
      const sx = rect.width / 2;
      const sy = rect.height / 2;
      const { x: wx, y: wy } = this._screenToWorld(sx, sy);

      const maxWidth = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        const scale = maxWidth / w;
        w = w * scale;
        h = h * scale;
      }

      const id = this.nextObjectId++;
      const obj = {
        id,
        kind: "image",
        x: wx - w / 2,
        y: wy - h / 2,
        width: w,
        height: h,
        image: img
      };

      this._addObject(obj);
      this.render();
    } finally {
      URL.revokeObjectURL(url);
    }
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

  // 付箋の色変更（UI から呼ぶ）
  setSelectedStickyColor(color) {
    if (!this.selectedObj || this.selectedObj.kind !== "sticky") return;
    this.selectedObj.fill = color;
    this.selectedObj.stroke = color;
    this.render();
  }

  // ====== ★ 追加：画像圧縮用ユーティリティ ======

  _encodeImageForExport(source, logicalWidth, logicalHeight, maxSize = MAX_IMAGE_EXPORT_SIZE) {
    if (!source || !logicalWidth || !logicalHeight) return null;

    const absW = Math.max(1, Math.abs(logicalWidth));
    const absH = Math.max(1, Math.abs(logicalHeight));
    const longest = Math.max(absW, absH);
    const scale = longest > maxSize ? maxSize / longest : 1;

    const outW = Math.max(1, Math.round(absW * scale));
    const outH = Math.max(1, Math.round(absH * scale));

    const c = document.createElement("canvas");
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext("2d");

    try {
      ctx.drawImage(source, 0, 0, outW, outH);
    } catch (e) {
      // Cross-origin などで描けない場合は諦めて null を返す
      return null;
    }

    const dataUrl = c.toDataURL("image/jpeg", IMAGE_EXPORT_QUALITY);
    return { dataUrl, width: outW, height: outH };
  }

  // ====== ★ 追加：ボード状態のエクスポート／インポート ======

  /**
   * 現在のホワイトボード状態を「JSONにできる形のオブジェクト」として返す
   * 画像・PDF（imageオブジェクト）・背景も JPEG + DataURL で軽量保存する
   */
  exportBoardData() {
    const strokes = this.strokes.map(st => ({
      type: st.type || "pen",
      color: st.color || this.penColor,
      width: st.width || this.penWidth,
      points: (st.points || []).map(p => ({ x: p.x, y: p.y })),
      groupId: st.groupId || null,
      locked: !!st.locked
    }));

    const objects = this.objects.map(o => {
      const base = {
        id: o.id,
        kind: o.kind,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        groupId: o.groupId || null,
        locked: !!o.locked
      };

      if (o.kind === "text" || o.kind === "sticky" || o.kind === "link") {
        base.text = o.text || "";
        base.fontSize = o.fontSize || 16;
        base.fontFamily = o.fontFamily || "system-ui";
        base.bold = !!o.bold;
      }

      if (o.kind === "sticky" || o.kind === "rect" || o.kind === "ellipse") {
        base.fill = o.fill || "transparent";
        base.stroke = o.stroke || "transparent";
      }

      if (o.kind === "link") {
        base.url = o.url || o.text || "";
      }

      if (o.kind === "image" && o.image) {
        const encoded = this._encodeImageForExport(
          o.image,
          o.width,
          o.height,
          MAX_IMAGE_EXPORT_SIZE
        );
        if (encoded) {
          base.imageDataUrl = encoded.dataUrl;
          base.imageWidth = encoded.width;
          base.imageHeight = encoded.height;
        }
      }

      return base;
    });

    // 背景（背景画像がある場合だけ）
    let background = null;
    if (this.bgCanvas.width > 0 && this.bgCanvas.height > 0) {
      const encodedBg = this._encodeImageForExport(
        this.bgCanvas,
        this.bgCanvas.width,
        this.bgCanvas.height,
        MAX_IMAGE_EXPORT_SIZE
      );
      if (encodedBg) {
        background = {
          dataUrl: encodedBg.dataUrl,
          width: encodedBg.width,
          height: encodedBg.height
        };
      }
    }

    return {
      version: 1,
      scale: this.scale,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      nextObjectId: this.nextObjectId,
      strokes,
      objects,
      background
    };
  }

  /**
   * exportBoardData() で得たデータオブジェクトからホワイトボード状態を再構築する
   * 画像・背景も DataURL から <img> や canvas に復元する
   */
  importBoardData(data) {
    if (!data) return;

    this.scale = data.scale != null ? data.scale : 1;
    this.offsetX = data.offsetX != null ? data.offsetX : 0;
    this.offsetY = data.offsetY != null ? data.offsetY : 0;
    this.nextObjectId = data.nextObjectId != null ? data.nextObjectId : 1;

    this.strokes = (data.strokes || []).map(st => ({
      type: st.type || "pen",
      color: st.color || this.penColor,
      width: st.width || this.penWidth,
      points: (st.points || []).map(p => ({ x: p.x, y: p.y })),
      groupId: st.groupId || null,
      locked: !!st.locked
    }));

    this.objects = (data.objects || []).map(o => {
      const obj = {
        id: o.id,
        kind: o.kind,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        groupId: o.groupId || null,
        locked: !!o.locked
      };

      if (o.kind === "text" || o.kind === "sticky" || o.kind === "link") {
        obj.text = o.text || "";
        obj.fontSize = o.fontSize || 16;
        obj.fontFamily = o.fontFamily || "system-ui";
        obj.bold = !!o.bold;
      }

      if (o.kind === "sticky" || o.kind === "rect" || o.kind === "ellipse") {
        obj.fill = o.fill || "transparent";
        obj.stroke = o.stroke || "transparent";
      }

      if (o.kind === "link") {
        obj.url = o.url || o.text || "";
      }

      if (o.kind === "image") {
        if (o.imageDataUrl) {
          const img = new Image();
          img.src = o.imageDataUrl;
          obj.image = img;
        } else {
          obj.image = null;
        }
      }

      return obj;
    });

    // 背景復元
    if (data.background && data.background.dataUrl) {
      const bgImg = new Image();
      bgImg.onload = () => {
        this.bgCanvas.width = data.background.width || bgImg.width;
        this.bgCanvas.height = data.background.height || bgImg.height;
        this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
        this.bgCtx.drawImage(bgImg, 0, 0, this.bgCanvas.width, this.bgCanvas.height);
        this.render();
      };
      bgImg.src = data.background.dataUrl;
    } else {
      // 背景なし
      this.bgCanvas.width = 0;
      this.bgCanvas.height = 0;
    }

    this.history = [];
    this._setSelected(null);
    this.render();
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
    this.selectedObj = obj || null;
    this.multiSelectedObjects = obj ? [obj] : [];
    this.selectedStroke = null;
    this.multiSelectedStrokes = [];
    this._fireSelectionChange();
  }

  _setSelectedStroke(stroke, additive = false) {
    if (additive) {
      if (!stroke) return;
      if (!this.multiSelectedStrokes.includes(stroke)) {
        this.multiSelectedStrokes.push(stroke);
      }
      this.selectedStroke = this.multiSelectedStrokes[0] || null;
    } else {
      this.selectedObj = null;
      this.multiSelectedObjects = [];
      this.multiSelectedStrokes = stroke ? [stroke] : [];
      this.selectedStroke = stroke || null;
    }
    this._fireSelectionChange();
  }

  _fireSelectionChange() {
    if (!this.onSelectionChange) return;
    if (!this.selectedObj) {
      this.onSelectionChange(null);
      return;
    }
    const o = this.selectedObj;
    if (o.kind === "text" || o.kind === "link") {
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
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this._commitTextEditor();
      }
    });

    ta.addEventListener("blur", () => {
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

    const { x, y, width, height } = this._normalizeRect(obj);

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
      kind,
      x: wx,
      y: wy,
      width,
      height,
      text: "",
      fontSize: 16,
      fontFamily: "system-ui",
      bold: false,
      fill: kind === "sticky" ? "#FEF3C7" : "transparent",
      stroke: kind === "sticky" ? "#FBBF24" : "transparent"
    };
    this._addObject(obj);
    this.render();
    this._openTextEditorForObject(obj);
  }

  _startShape(wx, wy, kind) {
    const id = this.nextObjectId++;
    const obj = {
      id,
      kind,
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
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      const { x, y, width, height } = this._normalizeRect(o);
      if (wx >= x && wx <= x + width && wy >= y && wy <= y + height) {
        return o;
      }
    }
    return null;
  }

  _hitTestStroke(wx, wy) {
    const threshold = 6 / this.scale;
    const th2 = threshold * threshold;

    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      const pts = stroke.points;
      if (!pts || pts.length === 0) continue;

      for (let j = 0; j < pts.length; j++) {
        const dx = pts[j].x - wx;
        const dy = pts[j].y - wy;
        if (dx * dx + dy * dy <= th2) {
          return stroke;
        }
      }
    }
    return null;
  }

  _hitTestResizeHandle(sx, sy) {
    for (const h of this.handleRects) {
      if (
        sx >= h.x &&
        sx <= h.x + h.size &&
        sy >= h.y &&
        sy <= h.y + h.size
      ) {
        return h.name;
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

      // 2本指タッチ → ピンチズーム開始
      if (e.touches && e.touches.length >= 2) {
        const rect = canvas.getBoundingClientRect();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const sx1 = t1.clientX - rect.left;
        const sy1 = t1.clientY - rect.top;
        const sx2 = t2.clientX - rect.left;
        const sy2 = t2.clientY - rect.top;

        const dx = sx2 - sx1;
        const dy = sy2 - sy1;
        const dist = Math.hypot(dx, dy);

        const centerSx = (sx1 + sx2) / 2;
        const centerSy = (sy1 + sy2) / 2;
        const world = this._screenToWorld(centerSx, centerSy);

        this.isPinchZoom = true;
        this.pinchStartDistance = dist;
        this.pinchStartScale = this.scale;
        this.pinchStartCenter = { sx: centerSx, sy: centerSy };
        this.pinchWorld = { x: world.x, y: world.y };

        this.isPanning = false;
        this.isDrawingStroke = false;
        this.isDrawingShape = false;
        this.isDraggingObj = false;
        this.isResizingObj = false;
        this.isBoxSelecting = false;

        return;
      }

      const { sx, sy, wx, wy } = getPos(e);
      const button = e.button != null ? e.button : 0;

      // 中ボタン / 右クリック / Alt でパン
      if (button === 1 || button === 2 || e.altKey) {
        this.isPanning = true;
        this.lastPanScreenX = sx;
        this.lastPanScreenY = sy;
        return;
      }

      // 手書きツール
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

      // テキスト／付箋
      if (this.tool === "text" || this.tool === "sticky") {
        this._createTextObject(wx, wy, this.tool === "sticky" ? "sticky" : "text");
        return;
      }

      // 図形
      if (this.tool === "rect" || this.tool === "ellipse") {
        this._startShape(wx, wy, this.tool === "rect" ? "rect" : "ellipse");
        return;
      }

      // 選択ツール
      if (this.tool === "select") {
        // まず、単一選択オブジェクトのリサイズハンドル判定
        if (this.multiSelectedObjects.length === 1 && this.selectedObj) {
          const handle = this._hitTestResizeHandle(sx, sy);
          if (handle) {
            this.isResizingObj = true;
            this.resizeHandle = handle;

            const { x, y, width, height } = this._normalizeRect(this.selectedObj);
            const aspect = width !== 0 ? Math.abs(height / width) : null;

            let anchorX = x;
            let anchorY = y;
            if (handle === "se") {
              anchorX = x;
              anchorY = y;
            } else if (handle === "ne") {
              anchorX = x;
              anchorY = y + height;
            } else if (handle === "sw") {
              anchorX = x + width;
              anchorY = y;
            } else if (handle === "nw") {
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

        // オブジェクトのヒットテスト
        const hitObj = this._hitTestObject(wx, wy);
        if (hitObj) {
          if (e.shiftKey) {
            if (!this.multiSelectedObjects.includes(hitObj)) {
              this.multiSelectedObjects.push(hitObj);
            }
            if (hitObj.kind === "text" || hitObj.kind === "link") {
              this.selectedObj = hitObj;
            }
          } else {
            if (hitObj.groupId) {
              const gid = hitObj.groupId;
              this.multiSelectedObjects = this.objects.filter(o => o.groupId === gid);
              this.multiSelectedStrokes = this.strokes.filter(s => s.groupId === gid);
              const textObj =
                this.multiSelectedObjects.find(
                  o => o.kind === "text" || o.kind === "link"
                ) || null;
              this.selectedObj = textObj || this.multiSelectedObjects[0] || null;
              this.selectedStroke = this.multiSelectedStrokes[0] || null;
              this._fireSelectionChange();
            } else {
              this._setSelected(hitObj);
            }
          }

          this.isDraggingObj = true;
          this.dragStart = {
            wx,
            wy,
            objects: this.multiSelectedObjects
              .filter(o => !o.locked)
              .map(o => ({
                obj: o,
                x: o.x,
                y: o.y
              })),
            strokes: this.multiSelectedStrokes
              .filter(st => !st.locked)
              .map(st => ({
                stroke: st,
                points: st.points.map(p => ({ x: p.x, y: p.y }))
              }))
          };
          this.render();
          return;
        }

        // ストロークのヒットテスト
        const hitStroke = this._hitTestStroke(wx, wy);
        if (hitStroke) {
          if (e.shiftKey) {
            this._setSelectedStroke(hitStroke, true);
          } else {
            if (hitStroke.groupId) {
              const gid = hitStroke.groupId;
              this.multiSelectedObjects = this.objects.filter(o => o.groupId === gid);
              this.multiSelectedStrokes = this.strokes.filter(s => s.groupId === gid);
              const textObj =
                this.multiSelectedObjects.find(
                  o => o.kind === "text" || o.kind === "link"
                ) || null;
              this.selectedObj = textObj || this.multiSelectedObjects[0] || null;
              this.selectedStroke = this.multiSelectedStrokes[0] || null;
              this._fireSelectionChange();
            } else {
              this._setSelectedStroke(hitStroke, false);
            }
          }

          this.isDraggingObj = true;
          this.dragStart = {
            wx,
            wy,
            objects: this.multiSelectedObjects
              .filter(o => !o.locked)
              .map(o => ({
                obj: o,
                x: o.x,
                y: o.y
              })),
            strokes: this.multiSelectedStrokes
              .filter(st => !st.locked)
              .map(st => ({
                stroke: st,
                points: st.points.map(p => ({ x: p.x, y: p.y }))
              }))
          };
          this.render();
          return;
        }

        // 何もヒットしない → ボックス選択開始
        this.isBoxSelecting = true;
        this.selectionBoxStart = { x: wx, y: wy };
        this.selectionBoxEnd = { x: wx, y: wy };
        this.selectedObj = null;
        this.multiSelectedObjects = [];
        this.selectedStroke = null;
        this.multiSelectedStrokes = [];
        this._fireSelectionChange();
        this.render();
        return;
      }
    };

    const move = e => {
      // 2本指ピンチ中
      if (this.isPinchZoom && e.touches && e.touches.length >= 2) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const sx1 = t1.clientX - rect.left;
        const sy1 = t1.clientY - rect.top;
        const sx2 = t2.clientX - rect.left;
        const sy2 = t2.clientY - rect.top;

        const dx = sx2 - sx1;
        const dy = sy2 - sy1;
        const dist = Math.hypot(dx, dy);
        if (!dist) return;

        const centerSx = (sx1 + sx2) / 2;
        const centerSy = (sy1 + sy2) / 2;

        const scaleFactor = dist / this.pinchStartDistance;
        const newScale = Math.min(5, Math.max(0.2, this.pinchStartScale * scaleFactor));
        this.scale = newScale;

        this.offsetX = centerSx - this.pinchWorld.x * this.scale;
        this.offsetY = centerSy - this.pinchWorld.y * this.scale;

        this.render();
        return;
      }

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

      if (this.tool === "select") {
        if (this.isBoxSelecting && this.selectionBoxStart) {
          e.preventDefault();
          const { wx, wy } = getPos(e);
          this.selectionBoxEnd = { x: wx, y: wy };
          this.render();
          return;
        }

        if (this.isDraggingObj && this.dragStart) {
          e.preventDefault();
          const { wx, wy } = getPos(e);
          const dx = wx - this.dragStart.wx;
          const dy = wy - this.dragStart.wy;

          if (this.dragStart.objects) {
            this.dragStart.objects.forEach(entry => {
              entry.obj.x = entry.x + dx;
              entry.obj.y = entry.y + dy;
            });
          }

          if (this.dragStart.strokes) {
            this.dragStart.strokes.forEach(entry => {
              const stroke = entry.stroke;
              stroke.points.forEach((p, i) => {
                const base = entry.points[i];
                p.x = base.x + dx;
                p.y = base.y + dy;
              });
            });
          }

          this.render();
          return;
        }

        if (this.isResizingObj && this.selectedObj && this.dragStart) {
          e.preventDefault();
          const { wx, wy } = getPos(e);
          const obj = this.selectedObj;
          const {
            x,
            y,
            width,
            height,
            anchorX,
            anchorY,
            aspect
          } = this.dragStart;

          if (e.shiftKey && aspect) {
            let dx = wx - anchorX;
            let dy = wy - anchorY;

            if (dx === 0 && dy === 0) return;

            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

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
      if (this.isPinchZoom && (!e.touches || e.touches.length < 2)) {
        this.isPinchZoom = false;
      }

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
      }

      if (this.isBoxSelecting && this.selectionBoxStart && this.selectionBoxEnd) {
        const sx = Math.min(this.selectionBoxStart.x, this.selectionBoxEnd.x);
        const sy = Math.min(this.selectionBoxStart.y, this.selectionBoxEnd.y);
        const ex = Math.max(this.selectionBoxStart.x, this.selectionBoxEnd.x);
        const ey = Math.max(this.selectionBoxStart.y, this.selectionBoxEnd.y);

        const selectedObjects = [];
        for (const o of this.objects) {
          const { x, y, width, height } = this._normalizeRect(o);
          const ox1 = x;
          const oy1 = y;
          const ox2 = x + width;
          const oy2 = y + height;

          const intersect =
            ox1 < ex && ox2 > sx && oy1 < ey && oy2 > sy;

          if (intersect) {
            selectedObjects.push(o);
          }
        }

        const selectedStrokes = [];
        for (const st of this.strokes) {
          if (!st.points || st.points.length === 0) continue;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of st.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          const intersect =
            minX < ex && maxX > sx && minY < ey && maxY > sy;
          if (intersect) {
            selectedStrokes.push(st);
          }
        }

        this.multiSelectedObjects = selectedObjects;
        this.multiSelectedStrokes = selectedStrokes;
        this.selectedStroke = selectedStrokes[0] || null;

        const textObj =
          selectedObjects.find(o => o.kind === "text" || o.kind === "link") || null;
        this.selectedObj = textObj || (selectedObjects[0] || null);

        this._fireSelectionChange();

        this.isBoxSelecting = false;
        this.selectionBoxStart = null;
        this.selectionBoxEnd = null;
        this.render();
      }
    };

    const dbl = e => {
      if (this.tool !== "select") return;
      const { wx, wy } = getPos(e);
      const hit = this._hitTestObject(wx, wy);
      if (!hit) return;

      if (hit.kind === "link" && hit.url) {
        window.open(hit.url, "_blank");
        return;
      }

      if (hit.kind === "text") {
        this._setSelected(hit);
        this._openTextEditorForObject(hit);
      }
    };

    canvas.addEventListener("mousedown", down);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", up);
    canvas.addEventListener("mouseleave", up);
    canvas.addEventListener("dblclick", dbl);

    canvas.addEventListener("touchstart", down, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", up);

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
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dpr = this.dpr || 1;

    if (this.strokeCanvas.width !== w || this.strokeCanvas.height !== h) {
      this.strokeCanvas.width = w;
      this.strokeCanvas.height = h;
    }

    const sctx = this.strokeCtx;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, w, h);
    sctx.imageSmoothingEnabled = true;

    sctx.setTransform(
      this.scale * dpr,
      0,
      0,
      this.scale * dpr,
      this.offsetX * dpr,
      this.offsetY * dpr
    );

    for (const stroke of this.strokes) {
      const pts = stroke.points;
      if (!pts || pts.length === 0) continue;

      if (stroke.type === "eraser") {
        sctx.globalCompositeOperation = "destination-out";
        sctx.strokeStyle = "#000000";
        sctx.lineWidth = stroke.width;
        sctx.globalAlpha = 1;
      } else if (stroke.type === "highlighter") {
        sctx.globalCompositeOperation = "source-over";
        sctx.strokeStyle = stroke.color;
        sctx.lineWidth = stroke.width;
        sctx.globalAlpha = 0.35;
      } else {
        sctx.globalCompositeOperation = "source-over";
        sctx.strokeStyle = stroke.color;
        sctx.lineWidth = stroke.width;
        sctx.globalAlpha = 1;
      }

      sctx.lineCap = "round";
      sctx.lineJoin = "round";
      sctx.beginPath();
      sctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        sctx.lineTo(pts[i].x, pts[i].y);
      }
      sctx.stroke();
    }

    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = "source-over";

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;

    ctx.setTransform(
      this.scale * dpr,
      0,
      0,
      this.scale * dpr,
      this.offsetX * dpr,
      this.offsetY * dpr
    );

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

    if (this.bgCanvas.width > 0 && this.bgCanvas.height > 0) {
      ctx.drawImage(this.bgCanvas, 0, 0);
    }

    this.handleRects = [];
    for (const obj of this.objects) {
      const { x, y, width, height } = this._normalizeRect(obj);
      const isSelected =
        this.multiSelectedObjects &&
        this.multiSelectedObjects.includes(obj);
      const strokeColor = obj.stroke || "#111827";
      const fillColor = obj.fill || "transparent";

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
        ctx.strokeRect(
          x + 0.5 / this.scale,
          y + 0.5 / this.scale,
          width,
          height
        );
      } else if (obj.kind === "ellipse") {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const rx = width / 2;
        const ry = height / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
        if (fillColor !== "透明" && fillColor !== "transparent") {
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
        const lines = this._wrapTextLines(
          text,
          availableWidth,
          fontSize,
          fontFamily,
          bold
        );

        ctx.fillStyle = obj.kind === "link" ? "#2563eb" : "#111827";
        ctx.font = `${bold} ${fontSize / this.scale}px ${fontFamily}`;
        ctx.textBaseline = "top";

        let ty = y + padding;
        const lineHeight = (fontSize * 1.4) / this.scale;
        for (const line of lines) {
          const tx = x + padding;
          ctx.fillText(line, tx, ty);

          if (obj.kind === "link") {
            const textWidth = ctx.measureText(line).width;
            ctx.beginPath();
            ctx.moveTo(tx, ty + lineHeight - 4 / this.scale);
            ctx.lineTo(tx + textWidth, ty + lineHeight - 4 / this.scale);
            ctx.lineWidth = 1.5 / this.scale;
            ctx.strokeStyle = "#2563eb";
            ctx.stroke();
          }

          ty += lineHeight;
        }
      }

      if (obj.locked) {
        ctx.save();
        ctx.strokeStyle = "rgba(148,163,184,0.9)";
        ctx.lineWidth = 1 / this.scale;
        ctx.setLineDash([4 / this.scale, 3 / this.scale]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y + height);
        ctx.stroke();
        ctx.restore();
      }

      const isSingleSelected =
        isSelected && this.multiSelectedObjects.length === 1;

      if (isSingleSelected) {
        ctx.save();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1.5 / this.scale;
        ctx.setLineDash([6 / this.scale, 3 / this.scale]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);

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
      } else if (isSelected) {
        ctx.save();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1.2 / this.scale;
        ctx.setLineDash([4 / this.scale, 2 / this.scale]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    if (this.isBoxSelecting && this.selectionBoxStart && this.selectionBoxEnd) {
      const sx = Math.min(this.selectionBoxStart.x, this.selectionBoxEnd.x);
      const sy = Math.min(this.selectionBoxStart.y, this.selectionBoxEnd.y);
      const ex = Math.max(this.selectionBoxStart.x, this.selectionBoxEnd.x);
      const ey = Math.max(this.selectionBoxStart.y, this.selectionBoxEnd.y);
      const rw = ex - sx;
      const rh = ey - sy;

      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1 / this.scale;
      ctx.setLineDash([4 / this.scale, 2 / this.scale]);
      ctx.strokeRect(sx, sy, rw, rh);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(59,130,246,0.08)";
      ctx.fillRect(sx, sy, rw, rh);
      ctx.restore();
    }

    if (this.multiSelectedStrokes && this.multiSelectedStrokes.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 1.2 / this.scale;
      ctx.setLineDash([4 / this.scale, 2 / this.scale]);

      for (const st of this.multiSelectedStrokes) {
        if (!st.points || st.points.length === 0) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of st.points) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        if (minX !== Infinity) {
          ctx.strokeRect(
            minX,
            minY,
            maxX - minX,
            maxY - minY
          );
        }
      }

      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(this.strokeCanvas, 0, 0);
  }
}

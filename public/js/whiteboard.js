// whiteboard.js
// 無限ホワイトボード + ベクター手書き + テキスト / 付箋 / 図形
// 選択ツールでオブジェクト移動・リサイズ + キャンバス上でテキスト編集 + テキスト書式変更
// 手書きは strokeCanvas レイヤーで管理（消しゴムは手書きのみ影響）

// 画像保存時の軽量化パラメータ
const MAX_IMAGE_EXPORT_SIZE = 2048;   // 画像の長辺は最大 2048px に縮小
const IMAGE_EXPORT_QUALITY = 0.95;   // JPEG 品質（0〜1）

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
    // ★ 追加：ストローク用のIDカウンタ（削除同期のため）
    this.nextStrokeId = 1;
    // ベクターオブジェクト（テキスト / 付箋 / 図形 / 画像 / リンク / スタンプ）
    // object: { id, kind:'text'|'sticky'|'rect'|'ellipse'|'image'|'link'|'stamp'|'line'|'arrow'|'double-arrow'|'triangle'|'tri-prism'|'rect-prism'|'cylinder',
    //           x,y,width,height,stroke,strokeWidth,fill,points?,depth?, groupId?, locked? }
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
    this.highlighterColor = "rgba(250, 204, 21, 0.8)";
    this.highlighterWidth = 30;
    this.eraserWidth = 24;

    // ★ 図形ツール用：現在選択中の図形タイプ
    // line, arrow, double-arrow, triangle, rect, ellipse, tri-prism, rect-prism, cylinder
    this.currentShapeType = "rect";

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

    this.isErasingTeacher = false;  // 既にどこかで使っているならここで初期化
    this.isErasingStroke = false;   // 一般用（手書きストローク用）消しゴム

    // 選択状態（オブジェクト＋ストローク、複数選択対応）
    this.selectedObj = null;          // テキスト設定用の代表オブジェクト
    this.multiSelectedObjects = [];   // 図形・テキストなど
    this.selectedStroke = null;       // 代表ストローク
    this.multiSelectedStrokes = [];   // 複数ストローク選択

    this.isDraggingObj = false;
    this.isResizingObj = false;
    this.resizeHandle = null; // 'nw','ne','se','sw', 'p0','p1','p2' (三角形頂点)
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

    // ★ 追加：テキストのデフォルトスタイル
    this.textDefaults = {
      fontSize: 16,
      fontFamily: 'Meiryo, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      bold: false,
      color: "#111827", // 文字色
      align: "left"     // "left" | "center" | "right"
    };

    // ★ 外部連携用コールバック
    this.onSelectionChange = null;
    this.onToolChange = null; // (tool) => {}

    // ★ スタンプ関連
    this.currentStampType = null; // 例: "star-yellow"
    this.stampPresets = {
      "star-yellow": { emoji: "⭐", baseSize: 80 },
      "circle-ok": { emoji: "⭕", baseSize: 80 },
      "cross-ng": { emoji: "❌", baseSize: 80 },
      "maru-hanamaru": { emoji: "💮", baseSize: 80 },
      "check": { emoji: "✅", baseSize: 80 },
      "question": { emoji: "❓", baseSize: 80 },
      "exclamation": { emoji: "❗", baseSize: 80 },
      "lightbulb": { emoji: "💡", baseSize: 80 },
      "pin": { emoji: "📌", baseSize: 80 },
      "clap": { emoji: "👏", baseSize: 80 },
      "good": { emoji: "👍", baseSize: 80 },
      "fire": { emoji: "🔥", baseSize: 80 },
      "megaphone": { emoji: "📣", baseSize: 80 },
      "excellent": { emoji: "🏆", baseSize: 80 },
      "pencil": { emoji: "✏️", baseSize: 80 },
      "note": { emoji: "📝", baseSize: 80 },
      "100": { emoji: "💯", baseSize: 80 },
      "sparkle": { emoji: "✨", baseSize: 80 }
    };

    // ★ グリッド表示フラグ
    this.showGrid = true;

    // ★ 追加：未保存フラグ & コールバック
    this.isBoardDirty = false;      // 未保存の変更があるか？
    this.onDirtyChange = null;      // (isDirty:boolean) => void

    this._attachEvents();

    // ★ 保留中のオブジェクト（教員からの書き込みプレビュー用）
    this.pendingData = null; // { strokes: [], objects: [] }

    // ★ 外部連携用コールバック
    this.onAction = null; // (action) => {}

    this.render();
  }

  // ★ グリッド表示切り替え
  setShowGrid(visible) {
    this.showGrid = !!visible;
    this.render();
  }

  // ★ 追加：未保存状態を「変更あり」にする内部メソッド
  _markDirty() {
    if (!this.isBoardDirty) {
      this.isBoardDirty = true;
      if (this.onDirtyChange) {
        this.onDirtyChange(true);
      }
    }
  }

  // ★ 追加：外部から「保存済み」にリセットするためのメソッド
  markSaved() {
    if (this.isBoardDirty) {
      this.isBoardDirty = false;
      if (this.onDirtyChange) {
        this.onDirtyChange(false);
      }
    }
  }

  // （必要ならゲッターも）
  isDirty() {
    return this.isBoardDirty;
  }

  // ★ 修正：resize は CSS ピクセルを受け取り、内部で dpr を掛ける
  resize(width, height) {
    const dpr = this.dpr || window.devicePixelRatio || 1;

    // 内部解像度（デバイスピクセル）
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;

    // 見た目サイズ（CSS ピクセル）
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";

    // ストローク用キャンバスも同じ解像度に
    if (this.strokeCanvas) {
      this.strokeCanvas.width = width * dpr;
      this.strokeCanvas.height = height * dpr;
    }

    this.render();
  }

  // ====== 公開 API ======

  setTeacherMode(enabled) {
    this.isTeacherMode = !!enabled;
  }

  // ★ 外部からのアクション適用（共同編集用）
  applyAction(action) {
    if (!action) return;

    if (action.type === "stroke") {
      // ストローク追加
      if (action.stroke) {
        const stroke = { ...action.stroke };

        // 受信したストロークにもIDをちゃんと振る
        if (stroke.id == null) {
          stroke.id = this.nextStrokeId++;
        } else if (stroke.id >= this.nextStrokeId) {
          this.nextStrokeId = stroke.id + 1;
        }

        this.strokes.push(stroke);
        this.render();
      }

    } else if (action.type === "object") {
      // オブジェクト追加
      if (action.object) {
        const obj = { ...action.object };
        const existingIndex = this.objects.findIndex(o => o.id === obj.id);
        if (existingIndex >= 0) {
          this.objects[existingIndex] = obj;
        } else {
          this.objects.push(obj);
        }
        this.render();
      }

    } else if (action.type === "modify") {
      // オブジェクト変更
      if (action.object) {
        const obj = { ...action.object };
        const idx = this.objects.findIndex(o => o.id === obj.id);
        if (idx >= 0) {
          this.objects[idx] = obj;
          this.render();
        }
      }

    } else if (action.type === "delete") {
      // オブジェクト削除
      if (action.objectId != null) {
        this.objects = this.objects.filter(o => o.id !== action.objectId);
        this.render();
      }

      // ★ 追加：教員モードの消しゴムで消したストロークを同期
    } else if (action.type === "delete-stroke") {
      if (action.strokeId != null) {
        this.strokes = this.strokes.filter(st => st.id !== action.strokeId);
        this.render();
      }
    }
  }

  getSnapshot() {
    return this.exportBoardData();
  }

  // ★ 画像としてエクスポート (png/jpeg)
  async exportAsImage(format = "png") {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    const ctx = tempCanvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    ctx.drawImage(this.canvas, 0, 0);

    return tempCanvas.toDataURL(`image/${format}`, IMAGE_EXPORT_QUALITY);
  }

  setPendingObjects(data) {
    if (!data) {
      this.pendingData = null;
    } else {
      this.pendingData = this._hydrateBoardData(data);
    }
    this.render();
  }

  mergePendingObjects() {
    if (!this.pendingData) return;

    const { strokes, objects } = this.pendingData;

    strokes.forEach(st => {
      const newStroke = {
        ...st,
        points: st.points.map(p => ({ ...p })),
        isTeacherAnnotation: true
      };
      this.strokes.push(newStroke);
    });

    const idMap = {};
    objects.forEach(o => {
      const newId = this.nextObjectId++;
      idMap[o.id] = newId;

      const newObj = {
        ...o,
        id: newId,
        isTeacherAnnotation: true
      };

      this.objects.push(newObj);
    });

    this.pendingData = null;
    this.render();
  }

  setTool(tool) {
    if (this.tool === tool) return;
    this.tool = tool;
    if (this.editingObj) {
      this._commitTextEditor();
    }
    if (tool === "highlighter" && !this.highlighterColor) {
      this.setHighlighterColor("#facc15");
    }
    if (this.onToolChange) {
      this.onToolChange(tool);
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

  // ★ board-ui.js から呼ばれる（スタンプ）
  setStampType(stampKey) {
    this.currentStampType = stampKey;
  }

  // ★ 図形ツールから呼ばれる
  setShapeType(shapeType) {
    this.currentShapeType = shapeType || "rect";
  }

  // ★ 選択中図形の線色変更
  setSelectedStrokeColor(color) {
    if (!color) return;
    const targets = this.multiSelectedObjects && this.multiSelectedObjects.length
      ? this.multiSelectedObjects
      : (this.selectedObj ? [this.selectedObj] : []);

    targets.forEach(o => {
      if (!o) return;
      if (["line", "arrow", "double-arrow", "triangle", "rect", "ellipse", "tri-prism", "rect-prism", "cylinder", "sticky"].includes(o.kind)) {
        o.stroke = color;
      }
    });
    this.render();
  }

  // ★ 選択中図形の線の太さ変更
  setSelectedStrokeWidth(width) {
    if (!width || width <= 0) return;
    const targets = this.multiSelectedObjects && this.multiSelectedObjects.length
      ? this.multiSelectedObjects
      : (this.selectedObj ? [this.selectedObj] : []);

    targets.forEach(o => {
      if (!o) return;
      if (["line", "arrow", "double-arrow", "triangle", "rect", "ellipse", "tri-prism", "rect-prism", "cylinder", "sticky"].includes(o.kind)) {
        o.strokeWidth = width;
      }
    });
    this.render();
  }

  // ★ 選択状態を設定（内部用）
  _setSelected(obj) {
    this.selectedObj = obj;
    this.multiSelectedObjects = obj ? [obj] : [];
    this.multiSelectedStrokes = [];
    this.selectedStroke = null;
    this._fireSelectionChange();
  }

  // ★ ストロークの選択状態を設定（内部用）
  _setSelectedStroke(stroke, additive = false) {
    if (!stroke) {
      this.selectedStroke = null;
      this.multiSelectedStrokes = [];
      // 単体選択リセットの場合はオブジェクト選択もクリア
      if (!additive) {
        this.selectedObj = null;
        this.multiSelectedObjects = [];
      }
      this._fireSelectionChange();
      return;
    }

    if (additive) {
      // 追加選択（Shift+クリック）の場合
      if (!this.multiSelectedStrokes.includes(stroke)) {
        this.multiSelectedStrokes.push(stroke);
      }
      this.selectedStroke = stroke;
    } else {
      // 単体選択の場合
      this.multiSelectedStrokes = [stroke];
      this.selectedStroke = stroke;

      // ストロークだけ選択するので、オブジェクト選択はクリア
      this.selectedObj = null;
      this.multiSelectedObjects = [];
    }

    this._fireSelectionChange();
  }


  // ★ 選択変更イベントを発火
  _fireSelectionChange() {
    if (this.onSelectionChange && typeof this.onSelectionChange === "function") {
      this.onSelectionChange();
    }
    this.render();
  }

  // ★ 選択中オブジェクトを最前面へ
  bringSelectionToFront() {
    const objs = this.multiSelectedObjects || [];
    const strokes = this.multiSelectedStrokes || [];
    if (!objs.length && !strokes.length) return;

    objs.forEach(o => {
      const idx = this.objects.indexOf(o);
      if (idx >= 0) {
        this.objects.splice(idx, 1);
        this.objects.push(o);
      }
    });

    strokes.forEach(s => {
      const idx = this.strokes.indexOf(s);
      if (idx >= 0) {
        this.strokes.splice(idx, 1);
        this.strokes.push(s);
      }
    });

    this.render();
  }

  // ★ 選択中オブジェクトを最背面へ
  sendSelectionToBack() {
    const objs = this.multiSelectedObjects || [];
    const strokes = this.multiSelectedStrokes || [];
    if (!objs.length && !strokes.length) return;

    objs.forEach(o => {
      const idx = this.objects.indexOf(o);
      if (idx >= 0) {
        this.objects.splice(idx, 1);
        this.objects.unshift(o);
      }
    });

    strokes.forEach(s => {
      const idx = this.strokes.indexOf(s);
      if (idx >= 0) {
        this.strokes.splice(idx, 1);
        this.strokes.unshift(s);
      }
    });

    this.render();
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
        if (this.onAction) this.onAction({ type: "refresh" });
        resolve();
      };
      img.onerror = err => {
        URL.revokeObjectURL(url);
        reject(err);
      };
      img.src = url;
    });
  }

  // ★ 背景画像を更新（パン・ズーム状態を維持するか選択可）
  async setBackgroundImage(dataUrl, maintainTransform = true) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.bgCanvas.width = img.width;
        this.bgCanvas.height = img.height;
        this.bgCtx.clearRect(0, 0, img.width, img.height);
        this.bgCtx.drawImage(img, 0, 0);

        if (!maintainTransform) {
          this.scale = 1;
          this.offsetX = (this.canvas.width - img.width) / 2;
          this.offsetY = (this.canvas.height - img.height) / 2;
        }
        this.render();
        if (this.onAction) this.onAction({ type: "refresh" });
        resolve();
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async loadPdfFile(file) {
    const url = URL.createObjectURL(file);

    try {
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;

      this.bgCanvas.width = 0;
      this.bgCanvas.height = 0;

      const pageMargin = 40;
      let currentY = 0;

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = viewport.width;
        pageCanvas.height = viewport.height;
        const pageCtx = pageCanvas.getContext("2d");

        await page.render({
          canvasContext: pageCtx,
          viewport
        }).promise;

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

      this.scale = 1;
      this.offsetX = 40;
      this.offsetY = 40;

      this.render();
      if (this.onAction) this.onAction({ type: "refresh" });
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

    this.bgCanvas.width = 0;
    this.bgCanvas.height = 0;

    // ★ 追加：変更フラグを立てる
    this._markDirty();

    this.render();
    if (this.onAction) this.onAction({ type: "refresh" });
  }

  undoLast() {
    const last = this.history.pop();
    if (!last) return;

    // ストロークの追加を取り消し
    if (last.kind === "stroke") {
      const idx = this.strokes.indexOf(last.stroke);
      if (idx >= 0) this.strokes.splice(idx, 1);
    }

    // オブジェクトの追加を取り消し（_addObject で push されるもの）
    else if (last.kind === "object") {
      const idx = this.objects.findIndex(o => o.id === last.id);
      if (idx >= 0) this.objects.splice(idx, 1);
      if (this.selectedObj && this.selectedObj.id === last.id) {
        this._setSelected(null);
      }
    }

    // 単一オブジェクト削除の UNDO（_deleteObject 用）
    else if (last.kind === "delete-object") {
      const index =
        typeof last.index === "number" ? last.index : this.objects.length;
      this.objects.splice(index, 0, last.object);
      this._setSelected(last.object);
    }

    // 複数オブジェクト／ストローク削除の UNDO（deleteSelection 用）
    else if (last.kind === "delete-multi") {
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

    // ★ 教員モードの消しゴムによるストローク削除の UNDO
    else if (last.kind === "delete-stroke") {
      const index =
        typeof last.index === "number" ? last.index : this.strokes.length;
      this.strokes.splice(index, 0, last.stroke);
    }

    // ★ 移動／リサイズ（オブジェクト＋ストローク）の UNDO
    else if (last.kind === "transform") {
      if (last.objects) {
        last.objects.forEach(entry => {
          const obj = entry.obj;
          const before = entry.before;
          if (!obj || !before) return;
          obj.x = before.x;
          obj.y = before.y;
          if (before.width != null) obj.width = before.width;
          if (before.height != null) obj.height = before.height;
          if (before.points && obj.points) {
            obj.points = before.points.map(p => ({ x: p.x, y: p.y }));
          }
        });
      }
      if (last.strokes) {
        last.strokes.forEach(entry => {
          const stroke = entry.stroke;
          const before = entry.before;
          if (!stroke || !before || !before.points) return;
          stroke.points = before.points.map(p => ({ x: p.x, y: p.y }));
        });
      }
    }

    // ★ テキスト編集の UNDO
    else if (last.kind === "edit-text") {
      const obj = last.object;
      const before = last.before;
      if (obj && before) {
        obj.text = before.text;
        if (before.width != null) obj.width = before.width;
        if (before.height != null) obj.height = before.height;
      }
    }

    // ★ 追加：UNDO も状態変化なので未保存フラグを立てる
    this._markDirty();

    this.render();
  }


  copySelection() {
    if (!this.selectedObj) return;
    const kind = this.selectedObj.kind;
    if (["image"].includes(kind)) return;
    this.clipboard = JSON.parse(JSON.stringify(this.selectedObj));
  }

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

    // ★ 追加
    this._markDirty();

    this.render();
  }

  deleteSelection() {
    const objs = (this.multiSelectedObjects || []).filter(o => !o.locked);
    const strokes = (this.multiSelectedStrokes || []).filter(s => !s.locked);

    if (!objs.length && !strokes.length) return;

    const deletedObjects = [];
    const deletedStrokes = [];

    objs.forEach(o => {
      const idx = this.objects.indexOf(o);
      if (idx !== -1) {
        this.objects.splice(idx, 1);
        deletedObjects.push({ object: o, index: idx });
      }
    });

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

    // ★ 追加：変更フラグを立てる
    this._markDirty();

    this.render();
  }

  canUngroupSelection() {
    const objs = this.multiSelectedObjects || [];
    const strokes = this.multiSelectedStrokes || [];
    const all = [...objs, ...strokes];

    if (all.length === 0) return false;

    const firstGroupId = all[0].groupId;
    if (!firstGroupId) return false;

    return all.every(item => item.groupId === firstGroupId);
  }

  groupSelection() {
    const objs = this.multiSelectedObjects || [];
    const strokes = this.multiSelectedStrokes || [];
    const all = [...objs, ...strokes];

    if (all.length <= 1) return;

    if (this.canUngroupSelection()) {
      all.forEach(item => {
        item.groupId = null;
      });

      this.selectedObj =
        objs.find(o => o.kind === "text" || o.kind === "link") ||
        objs[0] ||
        null;
      this.selectedStroke = strokes[0] || null;

      this._fireSelectionChange();
      this.render();
      return;
    }

    const groupId =
      Date.now().toString(36) + Math.random().toString(36).slice(2);

    objs.forEach(o => {
      o.groupId = groupId;
    });
    strokes.forEach(s => {
      s.groupId = groupId;
    });

    this.selectedObj =
      objs.find(o => o.kind === "text" || o.kind === "link") ||
      objs[0] ||
      null;
    this.selectedStroke = strokes[0] || null;

    this._fireSelectionChange();
    this.render();
  }

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

  pastePlainText(text) {
    if (!text) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width / 2;
    const sy = rect.height / 2;

    const { x: wx, y: wy } = this._screenToWorld(sx, sy);

    const id = this.nextObjectId++;
    const width = 260;
    const height = 80;

    const d = this.textDefaults || {};
    const fontSize = d.fontSize || 16;
    const fontFamily = d.fontFamily || "system-ui";
    const bold = !!d.bold;
    const textColor = d.color || "#111827";
    const textAlign = d.align || "left";

    const obj = {
      id,
      kind: "text",
      x: wx - width / 2,
      y: wy - height / 2,
      width,
      height,
      text,
      fontSize,
      fontFamily,
      bold,
      textColor,
      textAlign,
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 2
    };


    this._addObject(obj);
    this.render();
    this._openTextEditorForObject(obj);
  }

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
      if (this.onAction) {
        this.onAction({ type: "object", object: obj });
      }
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

  // ★ 修正：色と配置も変更できるように拡張
  setSelectedTextStyle({ fontSize, fontFamily, bold, color, align } = {}) {
    if (!this.selectedObj) return;
    if (!["text", "sticky", "link"].includes(this.selectedObj.kind)) return;

    if (fontSize != null) this.selectedObj.fontSize = fontSize;
    if (fontFamily) this.selectedObj.fontFamily = fontFamily;
    if (typeof bold === "boolean") this.selectedObj.bold = bold;
    if (color) this.selectedObj.textColor = color;
    if (align) this.selectedObj.textAlign = align;

    this.render();
    this._fireSelectionChange();
  }


  // ★ 追加：テキストツールのデフォルトスタイルを更新
  setTextDefaults({ fontSize, fontFamily, bold, color, align } = {}) {
    if (!this.textDefaults) {
      this.textDefaults = {};
    }
    if (fontSize != null) this.textDefaults.fontSize = fontSize;
    if (fontFamily) this.textDefaults.fontFamily = fontFamily;
    if (typeof bold === "boolean") this.textDefaults.bold = bold;
    if (color) this.textDefaults.color = color;
    if (align) this.textDefaults.align = align;
  }

  setSelectedStickyColor(color) {
    if (!color) return;
    const targets = this.multiSelectedObjects && this.multiSelectedObjects.length
      ? this.multiSelectedObjects
      : (this.selectedObj ? [this.selectedObj] : []);

    targets.forEach(o => {
      if (!o) return;
      if (["sticky", "rect", "ellipse", "triangle", "tri-prism", "rect-prism", "cylinder"].includes(o.kind)) {
        o.fill = color;
        if (o.kind === "sticky") {
          o.stroke = color;
        }
      }
    });
    this.render();
  }

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
      return null;
    }

    const dataUrl = c.toDataURL("image/jpeg", IMAGE_EXPORT_QUALITY);
    return { dataUrl, width: outW, height: outH };
  }

  exportBoardData() {
    const strokes = this.strokes.map(st => ({
      // ★ 追加：ストロークIDもエクスポート
      id: st.id != null ? st.id : null,
      type: st.type || "pen",
      color: st.color || this.penColor,
      width: st.width || this.penWidth,
      points: (st.points || []).map(p => ({ x: p.x, y: p.y })),
      groupId: st.groupId || null,
      locked: !!st.locked,
      isTeacherAnnotation: !!st.isTeacherAnnotation
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
        locked: !!o.locked,
        isTeacherAnnotation: !!o.isTeacherAnnotation
      };

      // 回転角（ラジアン）
      if (o.rotation != null) {
        base.rotation = o.rotation;
      }

      if (o.kind === "text" || o.kind === "sticky" || o.kind === "link") {
        base.text = o.text || "";
        base.fontSize = o.fontSize || 16;
        base.fontFamily = o.fontFamily || "system-ui";
        base.bold = !!o.bold;
        base.textAlign = o.textAlign || "left";
        if (o.textColor) {
          base.textColor = o.textColor;
        }
      }


      if (o.fill !== undefined) base.fill = o.fill;
      if (o.stroke !== undefined) base.stroke = o.stroke;
      if (o.strokeWidth != null) base.strokeWidth = o.strokeWidth;

      if (o.kind === "link") {
        base.url = o.url || o.text || "";
      }

      if (o.kind === "stamp") {
        base.stampKey = o.stampKey || this.currentStampType || "star-yellow";
      }

      if (o.kind === "triangle" && o.points) {
        base.points = (o.points || []).map(p => ({ x: p.x, y: p.y }));
      }

      if (o.kind === "tri-prism" || o.kind === "rect-prism" || o.kind === "cylinder") {
        if (o.depth != null) base.depth = o.depth;
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


  importBoardData(data) {
    if (!data) return;

    this.scale = data.scale != null ? data.scale : 1;
    this.offsetX = data.offsetX != null ? data.offsetX : 0;
    this.offsetY = data.offsetY != null ? data.offsetY : 0;
    this.nextObjectId = data.nextObjectId != null ? data.nextObjectId : 1;

    const hydrated = this._hydrateBoardData(data);
    this.strokes = hydrated.strokes;
    this.objects = hydrated.objects;

    // ★ 追加：既存ストロークの最大IDを見て nextStrokeId を進める
    let maxStrokeId = 0;
    for (const st of this.strokes) {
      if (st.id != null && st.id > maxStrokeId) {
        maxStrokeId = st.id;
      }
    }
    this.nextStrokeId = Math.max(this.nextStrokeId || 1, maxStrokeId + 1);

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
      this.bgCanvas.width = 0;
      this.bgCanvas.height = 0;
    }

    this.history = [];
    this._setSelected(null);
    // ★ 追加：読み込んだ直後は「保存済み」とみなす
    this.isBoardDirty = false;
    if (this.onDirtyChange) this.onDirtyChange(false);
    this.render();
  }


  _hydrateBoardData(data) {
    const strokes = (data.strokes || []).map(st => {
      const stroke = {
        // ★ 追加：保存されていたIDを復元
        id: st.id != null ? st.id : null,
        type: st.type || "pen",
        color: st.color || this.penColor,
        width: st.width || this.penWidth,
        points: (st.points || []).map(p => ({ x: p.x, y: p.y })),
        groupId: st.groupId || null,
        locked: !!st.locked,
        isTeacherAnnotation: !!st.isTeacherAnnotation
      };
      return stroke;
    });

    const objects = (data.objects || []).map(o => {
      const obj = {
        id: o.id,
        kind: o.kind,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        groupId: o.groupId || null,
        locked: !!o.locked,
        isTeacherAnnotation: !!o.isTeacherAnnotation
      };

      // ★ 追加：回転角（なければ 0）
      obj.rotation = o.rotation != null ? o.rotation : 0;


      if (o.kind === "text" || o.kind === "sticky" || o.kind === "link") {
        obj.text = o.text || "";
        obj.fontSize = o.fontSize || 16;
        obj.fontFamily = o.fontFamily || "system-ui";
        obj.bold = !!o.bold;
        obj.textAlign = o.textAlign || "left";
        obj.textColor = o.textColor || null;
      }


      if (o.fill !== undefined) {
        obj.fill = o.fill;
      } else if (o.kind === "sticky") {
        obj.fill = "#FEF3C7";
      } else {
        obj.fill = "transparent";
      }

      if (o.stroke !== undefined) {
        obj.stroke = o.stroke;
      } else if (o.kind === "sticky") {
        obj.stroke = "#FBBF24";
      } else {
        obj.stroke = "transparent";
      }

      obj.strokeWidth = o.strokeWidth != null ? o.strokeWidth : 2;

      if (o.kind === "link") {
        obj.url = o.url || o.text || "";
      }

      if (o.kind === "stamp") {
        obj.stampKey = o.stampKey || "star-yellow";
      }

      if (o.kind === "triangle" && o.points) {
        obj.points = (o.points || []).map(p => ({ x: p.x, y: p.y }));
      }

      if (o.kind === "tri-prism" || o.kind === "rect-prism" || o.kind === "cylinder") {
        obj.depth = o.depth != null ? o.depth : 40;
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

    return { strokes, objects };
  }


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

    // ✅ ズーム変更を UI に通知
    if (this.onZoomChange) this.onZoomChange();
  }


  _addStroke(stroke) {
    // ★ 追加：IDがなければ採番
    if (stroke.id == null) {
      stroke.id = this.nextStrokeId++;
    }

    if (this.isTeacherMode) {
      stroke.isTeacherAnnotation = true;
    }

    this.strokes.push(stroke);
    this.history.push({ kind: "stroke", stroke });

    // ★ 追加：変更フラグを立てる
    this._markDirty();
  }

  _addObject(obj) {
    if (this.isTeacherMode) {
      obj.isTeacherAnnotation = true;
    }
    this.objects.push(obj);
    this.history.push({ kind: "object", id: obj.id });
    this._setSelected(obj);

    // ★ 追加：変更フラグを立てる
    this._markDirty();
  }

  // ★ 修正：スタンプの混入コードを削除し、純粋にストローク削除だけにする
  // ★ 教員モードの消しゴムでストロークを削除 → 他クライアントにも同期
  _deleteStroke(stroke) {
    const idx = this.strokes.indexOf(stroke);
    if (idx !== -1) {
      const removed = this.strokes.splice(idx, 1)[0];
      this.history.push({ kind: "delete-stroke", stroke: removed, index: idx });

      // ★ 追加：変更フラグを立てる
      this._markDirty();

      // ★ 追加：教員モードのときだけ、削除アクションを外へ通知
      if (this.isTeacherMode && this.onAction && removed && removed.id != null) {
        this.onAction({ type: "delete-stroke", strokeId: removed.id });
      }
    }
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
      if (e.key === "Enter" && !e.shiftKey) {
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
    this.textEditor.style.fontSize = `${fontSize}px`;
    this.textEditor.style.fontFamily = fontFamily;
    // ★ 追加：テキストの配置を反映
    this.textEditor.style.textAlign = obj.textAlign || "left";
    this.textEditor.style.display = "block";

    this.textEditor.focus();
    this.textEditor.select();
  }

  // ★ テキストボックスの高さを自動調整
  _autoResizeTextObject(obj) {
    if (!obj) return;

    const fontSize = obj.fontSize || 16;
    const fontFamily = obj.fontFamily || "system-ui";
    const bold = obj.bold ? "bold " : "";
    const padding = 8;

    // 幅（左右のパディングを除いたテキスト描画可能幅）
    const baseWidth = Math.max(20, Math.abs(obj.width) - padding * 2);

    // 計測用のオフスクリーンキャンバス
    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");
    mctx.font = `${bold}${fontSize}px ${fontFamily}`;

    const rawLines = (obj.text || "").split("\n");
    const lines = [];

    for (const raw of rawLines) {
      if (raw === "") {
        lines.push("");
        continue;
      }
      let current = "";
      for (const ch of raw) {
        const test = current + ch;
        const w = mctx.measureText(test).width;
        if (w > baseWidth && current !== "") {
          lines.push(current);
          current = ch;
        } else {
          current = test;
        }
      }
      if (current !== "" || raw === "") {
        lines.push(current);
      }
    }

    const lineHeightPx = fontSize * 1.4;
    const contentHeight = lines.length * lineHeightPx;
    const totalHeight = contentHeight + padding * 2;

    // もともと負の高さ（上向き描画）の場合もあるので符号を維持
    if (Math.abs(obj.height) < totalHeight) {
      const sign = obj.height >= 0 ? 1 : -1;
      obj.height = sign * totalHeight;
    }
  }


  _commitTextEditor() {
    if (!this.editingObj) return;
    const obj = this.editingObj;

    // ★ 変更前の状態を保存
    const before = {
      text: obj.text || "",
      width: obj.width,
      height: obj.height
    };

    // テキストを反映
    obj.text = this.textEditor.value;

    // ★ 内容に応じて高さを自動調整
    this._autoResizeTextObject(obj);

    // ★ 変更後の状態
    const after = {
      text: obj.text || "",
      width: obj.width,
      height: obj.height
    };

    // ★ テキストやサイズに変更があれば履歴に積む
    if (
      before.text !== after.text ||
      before.width !== after.width ||
      before.height !== after.height
    ) {
      if (!this.history) this.history = [];
      this.history.push({
        kind: "edit-text",
        object: obj,
        before,
        after
      });

      // ★ 追加：変更フラグを立てる
      this._markDirty();
    }

    if (this.onAction) {
      this.onAction({ type: "modify", object: obj });
    }
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

    // ★ デフォルトスタイルを使用
    const d = this.textDefaults || {};
    const fontSize = d.fontSize || 16;
    const fontFamily = d.fontFamily || "system-ui";
    const bold = !!d.bold;
    const textColor = d.color || "#111827";
    const textAlign = d.align || "left";

    const obj = {
      id,
      kind, // "text" または "sticky"
      // クリック位置を左上にするならそのまま、中央にしたければ wx - width/2 などにしてOK
      x: wx,
      y: wy,
      width,
      height,
      text: "",
      fontSize,
      fontFamily,
      bold,
      textColor,
      textAlign,
      fill: kind === "sticky" ? "#FEF3C7" : "transparent",
      stroke: kind === "sticky" ? "#FBBF24" : this.penColor,
      strokeWidth: 2
    };

    // ★ 実際に追加して選択＆編集開始
    this._addObject(obj);
    this.render();
    this._openTextEditorForObject(obj);

    //   テキスト／付箋を配置して編集状態になったら
    //   ツールを自動で「選択」に戻す
    this.tool = "select";
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
      strokeWidth: this.penWidth || 2,
      fill: ["rect", "ellipse", "triangle", "tri-prism", "rect-prism", "cylinder"].includes(kind)
        ? "transparent"
        : "transparent"
    };

    if (kind === "triangle") {
      obj.points = [
        { x: wx, y: wy },
        { x: wx, y: wy },
        { x: wx, y: wy }
      ];
    }

    if (kind === "tri-prism" || kind === "rect-prism" || kind === "cylinder") {
      obj.depth = 40;
    }

    this.shapeStartX = wx;
    this.shapeStartY = wy;
    this.shapeDraft = obj;
    this.isDrawingShape = true;
    this._addObject(obj);
  }

  _updateShape(wx, wy, isShiftKey = false) {
    if (!this.shapeDraft) return;
    const kind = this.shapeDraft.kind;

    let w = wx - this.shapeStartX;
    let h = wy - this.shapeStartY;

    if (isShiftKey && (kind === "triangle" || kind === "rect" || kind === "ellipse")) {
      const size = Math.max(Math.abs(w), Math.abs(h)) || 1;
      w = w < 0 ? -size : size;
      h = h < 0 ? -size : size;
    }

    this.shapeDraft.width = w;
    this.shapeDraft.height = h;

    if (kind === "triangle" && this.shapeDraft.points) {
      const { x, y, width, height } = this._normalizeRect(this.shapeDraft);
      const v0 = { x: x + width / 2, y };
      const v1 = { x, y: y + height };
      const v2 = { x: x + width, y: y + height };
      this.shapeDraft.points[0] = v0;
      this.shapeDraft.points[1] = v1;
      this.shapeDraft.points[2] = v2;
    }

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
    } else {
      if (this.onAction) {
        this.onAction({ type: "object", object: this.shapeDraft });
      }
      // ★ 追加：図形が確定したので未保存フラグを立てる
      this._markDirty();
    }
    this.isDrawingShape = false;
    this.shapeDraft = null;

    // ★ 図形を置いたら自動的に選択ツールへ戻す
    this.tool = "select";
    this.render();
  }

  _placeStampAt(wx, wy) {
    const key = this.currentStampType || "star-yellow";
    const preset = this.stampPresets[key] || this.stampPresets["star-yellow"];
    const size = preset.baseSize || 80;
    const half = size / 2;

    const id = this.nextObjectId++;
    const obj = {
      id,
      kind: "stamp",
      stampKey: key,
      x: wx - half,
      y: wy - half,
      width: size,
      height: size,
      locked: false
    };

    this._addObject(obj);
    if (this.onAction) {
      this.onAction({ type: "object", object: obj });
    }
    this.render();
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

      if (button === 1 || button === 2 || e.altKey) {
        this.isPanning = true;
        this.lastPanScreenX = sx;
        this.lastPanScreenY = sy;
        return;
      }

      if (this.tool === "pen" || this.tool === "highlighter" || this.tool === "eraser") {
        // ★ 教員モードの消しゴム：既存通り「教員注釈だけ削除」
        if (this.tool === "eraser" && this.isTeacherMode) {
          this.isErasingTeacher = true;
          return;
        }

        // ★ 一般用の消しゴム：ストロークを「まるごと削除」するモードにする
        if (this.tool === "eraser") {
          this.isErasingStroke = true;
          return;
        }

        // ★ ここから先はペン／蛍光ペンだけ
        this.isDrawingStroke = true;
        let color = this.penColor;
        let width = this.penWidth;
        let type = this.tool;
        if (type === "highlighter") {
          color = this.highlighterColor;
          width = this.highlighterWidth;
        }
        this.currentStroke = {
          type,
          color,
          width,
          points: [{ x: wx, y: wy }],
          isTeacherAnnotation: !!this.isTeacherMode
        };
        this._addStroke(this.currentStroke);
        this.render();
        return;
      }


      if (this.tool === "text" || this.tool === "sticky") {
        this._createTextObject(wx, wy, this.tool === "sticky" ? "sticky" : "text");
        return;
      }

      if (this.tool === "shape") {
        const kind = this.currentShapeType || "rect";
        this._startShape(wx, wy, kind);
        return;
      }

      if (this.tool === "stamp") {
        this._placeStampAt(wx, wy);
        return;
      }

      if (this.tool === "select") {
        if (this.multiSelectedObjects.length === 1 && this.selectedObj) {
          const handle = this._hitTestResizeHandle(sx, sy);
          if (handle) {
            this.isResizingObj = true;
            this.resizeHandle = handle;

            const obj = this.selectedObj;

            // ★ ① 回転ハンドルを掴んだとき
            if (handle === "rotate") {
              const { x, y, width, height } = this._normalizeRect(obj);
              const cx = x + width / 2;
              const cy = y + height / 2;

              this.dragStart = {
                mode: "rotate",
                cx,
                cy,
                startAngle: obj.rotation || 0,
                startPointerAngle: Math.atan2(wy - cy, wx - cx)
              };
              return;
            }

            // ★ ② 直線 / 矢印 / 相互矢印のリサイズ開始
            if (obj.kind === "line" || obj.kind === "arrow" || obj.kind === "double-arrow") {
              this.dragStart = {
                wx,
                wy,
                handle,
                objects: [
                  {
                    obj,
                    x: obj.x,
                    y: obj.y,
                    width: obj.width,
                    height: obj.height,
                    // リサイズ前の端点（ワールド座標）
                    x1: obj.x,
                    y1: obj.y,
                    x2: obj.x + obj.width,
                    y2: obj.y + obj.height
                  }
                ],
                strokes: []
              };
              return;
            }

            // ★ ③ 3D 図形の depth ハンドル
            // ★ 3D 図形の depth ハンドル
            if (
              (obj.kind === "tri-prism" || obj.kind === "rect-prism" || obj.kind === "cylinder") &&
              handle === "depth"
            ) {
              const { x, y, width, height } = this._normalizeRect(obj);

              if (obj.kind === "cylinder") {
                // 円柱：depth は「つぶれ具合の割合」として扱う
                const cx = x + width / 2;
                const cy = y + height / 2;
                const baseRy = Math.abs(width) / 2; // 横半径を基準にする

                const ratio0 =
                  typeof obj.depth === "number" && obj.depth > 0
                    ? obj.depth
                    : 0.25; // 初期値

                this.dragStart = {
                  mode: "depth",
                  kind: "cylinder",
                  cx,
                  cy,
                  baseRy,
                  ratio0
                };
              } else {
                // tri-prism / rect-prism：従来通り「奥行き距離」として扱う
                const depth = obj.depth != null ? obj.depth : 40;
                const frontTopRight = { x: x + width, y: y };

                this.dragStart = {
                  mode: "depth",
                  kind: "prism",
                  wx,
                  wy,
                  frontX: frontTopRight.x,
                  frontY: frontTopRight.y,
                  depth0: depth
                };
              }
              return;
            }


            // ★ ④ それ以外（矩形・円・付箋など）：従来通りのリサイズ
            const { x, y, width, height } = this._normalizeRect(obj);
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
                y: o.y,
                points: o.points
                  ? o.points.map(p => ({ x: p.x, y: p.y }))
                  : null
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
                y: o.y,
                points: o.points
                  ? o.points.map(p => ({ x: p.x, y: p.y }))
                  : null
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
      // ---- ピンチズーム ----
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

        // ✅ ピンチズームでもUIへ通知
        if (this.onZoomChange) this.onZoomChange();

        return;
      }

      // ---- 中ボタン or Alt でのパン ----
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

      // ---- 消しゴムでの削除 ----
      if (this.isErasingTeacher || this.isErasingStroke) {
        e.preventDefault();
        const { wx, wy } = getPos(e);

        const hitStroke = this._hitTestStroke(wx, wy);

        // ★ 教員モードの消しゴム：教員注釈だけ削除
        if (this.isErasingTeacher) {
          if (hitStroke && hitStroke.isTeacherAnnotation) {
            this._deleteStroke(hitStroke);
            this.render();
          }

          const hitObj = this._hitTestObject(wx, wy);
          if (hitObj && hitObj.isTeacherAnnotation) {
            this._deleteObject(hitObj);
            this.render();
          }

          return;
        }

        // ★ 一般用：手書きストロークなら誰のでも削除
        if (this.isErasingStroke) {
          if (hitStroke) {
            this._deleteStroke(hitStroke);
            this.render();
          }
          return;
        }
      }


      // ---- ペン／蛍光ペンで描画中 ----
      if (this.isDrawingStroke && this.currentStroke) {
        e.preventDefault();
        const { wx, wy } = getPos(e);

        const points = this.currentStroke.points;
        if (points.length > 0) {
          const lastPt = points[points.length - 1];
          const dist = Math.hypot(wx - lastPt.x, wy - lastPt.y);
          if (dist < 2) return;
        }

        this.currentStroke.points.push({ x: wx, y: wy });
        this.render();
        return;
      }

      // ---- 図形描画中 ----
      if (this.isDrawingShape) {
        e.preventDefault();
        const { wx, wy } = getPos(e);
        this._updateShape(wx, wy, e.shiftKey);
        return;
      }

      // ======================================
      // ここから ドラッグ移動・ボックス選択・リサイズ
      // ======================================

      // ★ オブジェクト／ストロークのドラッグ移動（ツールに関係なく共通）
      if (this.isDraggingObj && this.dragStart) {
        e.preventDefault();
        const { wx, wy } = getPos(e);
        const dx = wx - this.dragStart.wx;
        const dy = wy - this.dragStart.wy;

        // 図形・テキストなど
        if (this.dragStart.objects) {
          this.dragStart.objects.forEach(entry => {
            entry.obj.x = entry.x + dx;
            entry.obj.y = entry.y + dy;
            if (entry.points && entry.obj.points) {
              entry.obj.points.forEach((p, i) => {
                const base = entry.points[i];
                p.x = base.x + dx;
                p.y = base.y + dy;
              });
            }
          });
        }

        // ★ ペンで描いたストローク
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

      // ---- 以下は「選択ツール」のときだけ有効 ----
      if (this.tool === "select") {
        // ボックス選択中
        if (this.isBoxSelecting && this.selectionBoxStart) {
          e.preventDefault();
          const { wx, wy } = getPos(e);
          this.selectionBoxEnd = { x: wx, y: wy };
          this.render();
          return;
        }

        // オブジェクトのリサイズ
        if (this.isResizingObj && this.selectedObj && this.dragStart) {
          e.preventDefault();
          const { wx, wy } = getPos(e);
          const obj = this.selectedObj;

          // ★ ① 回転ハンドルをドラッグ中
          if (
            this.resizeHandle === "rotate" &&
            this.dragStart.mode === "rotate"
          ) {
            const { cx, cy, startAngle, startPointerAngle } = this.dragStart;
            const currentPointerAngle = Math.atan2(wy - cy, wx - cx);
            const delta = currentPointerAngle - startPointerAngle;
            obj.rotation = startAngle + delta;
            this.render();
            return;
          }

          // ★ ② 3D 図形の depth ハンドルをドラッグ中
          // ★ ② 3D 図形の depth ハンドルをドラッグ中
          if (
            this.resizeHandle === "depth" &&
            this.dragStart.mode === "depth"
          ) {
            // 円柱：depth は「つぶれ具合の割合」として扱う
            if (obj.kind === "cylinder" && this.dragStart.kind === "cylinder") {
              const { cy, baseRy, ratio0 } = this.dragStart;

              // ハンドルの上下ドラッグ量を「円のつぶれ具合」に反映
              const dy = wy - cy; // 中心からの縦方向の差
              // ちょっと感度を落とす（4 は適当なスケール）
              const deltaRatio = -dy / (baseRy * 4);

              let ratio = ratio0 + deltaRatio;
              // あまりつぶれすぎ / 立ちすぎないようにクランプ
              const minRatio = 0.12;
              const maxRatio = 0.6;
              ratio = Math.max(minRatio, Math.min(maxRatio, ratio));

              obj.depth = ratio; // ← 円柱では depth を「割合」として使う

              this.render();
              return;
            }

            // tri-prism / rect-prism：これまで通り「奥行き距離」として扱う
            const { frontX, frontY } = this.dragStart;
            const vx = wx - frontX;
            const vy = wy - frontY;

            // 理想的な方向ベクトルは (1, -1)（右上方向）
            // そこへの射影長 t ≒ depth とみなす
            const t = (vx - vy) / 2;
            obj.depth = Math.max(0, t);

            this.render();
            return;
          }


          // ★ 直線 / 矢印 / 相互矢印：両端ハンドルをドラッグしたとき
          if (
            (obj.kind === "line" || obj.kind === "arrow" || obj.kind === "double-arrow") &&
            (this.resizeHandle === "p0" || this.resizeHandle === "p1") &&
            this.dragStart.objects &&
            this.dragStart.objects.length > 0
          ) {
            const entry = this.dragStart.objects[0];
            let { x1, y1, x2, y2 } = entry;

            if (this.resizeHandle === "p0") {
              // 開始点をマウス位置に
              x1 = wx;
              y1 = wy;
            } else {
              // 終了点をマウス位置に
              x2 = wx;
              y2 = wy;
            }

            // モデルは「開始点 + ベクトル」として保持
            obj.x = x1;
            obj.y = y1;
            obj.width = x2 - x1;
            obj.height = y2 - y1;

            this.render();
            return;
          }



          // 頂点ドラッグで三角形の形状変更
          if (
            obj.kind === "triangle" &&
            this.resizeHandle &&
            this.resizeHandle.startsWith("p") &&
            obj.points &&
            obj.points.length === 3
          ) {
            const index = parseInt(this.resizeHandle.slice(1), 10);
            if (!Number.isNaN(index) && obj.points[index]) {
              obj.points[index] = { x: wx, y: wy };

              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              obj.points.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
              });
              obj.x = minX;
              obj.y = minY;
              obj.width = maxX - minX;
              obj.height = maxY - minY;

              this.render();
            }
            return;
          }

          const {
            x,
            y,
            width,
            height,
            anchorX,
            anchorY,
            aspect
          } = this.dragStart;

          // Shift + ドラッグで縦横比固定
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

          // 通常のリサイズ
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
      if (this.currentStroke && this.onAction) {
        this.onAction({ type: "stroke", stroke: this.currentStroke });
      }
      this.currentStroke = null;

      if (this.isDrawingShape) {
        this._finishShape();
      }

      if (this.isDraggingObj || this.isResizingObj) {

        // ★ ここから：移動／リサイズの履歴を記録する ------------------
        if (this.dragStart) {
          // ① 複数オブジェクト／ストロークのドラッグ移動
          if (this.dragStart.objects || this.dragStart.strokes) {
            const changedObjects = [];
            const changedStrokes = [];

            if (this.dragStart.objects) {
              this.dragStart.objects.forEach(entry => {
                const obj = entry.obj;
                if (!obj) return;

                const moved =
                  obj.x !== entry.x ||
                  obj.y !== entry.y ||
                  (entry.points && obj.points && obj.points.some((p, i) => {
                    const bp = entry.points[i];
                    return !bp || p.x !== bp.x || p.y !== bp.y;
                  }));

                if (moved) {
                  changedObjects.push({
                    obj,
                    before: {
                      x: entry.x,
                      y: entry.y,
                      // width/height は移動では変わらないので不要だが、
                      // 将来の拡張を考えて一応含めておく
                      width: obj.width,
                      height: obj.height,
                      points: entry.points
                        ? entry.points.map(p => ({ x: p.x, y: p.y }))
                        : null
                    },
                    after: {
                      x: obj.x,
                      y: obj.y,
                      width: obj.width,
                      height: obj.height,
                      points: obj.points
                        ? obj.points.map(p => ({ x: p.x, y: p.y }))
                        : null
                    }
                  });
                }
              });
            }

            if (this.dragStart.strokes) {
              this.dragStart.strokes.forEach(entry => {
                const stroke = entry.stroke;
                if (!stroke) return;
                const beforePts = entry.points || [];
                const afterPts = stroke.points || [];

                let moved = false;
                if (beforePts.length !== afterPts.length) {
                  moved = true;
                } else {
                  for (let i = 0; i < beforePts.length; i++) {
                    const bp = beforePts[i];
                    const ap = afterPts[i];
                    if (!ap || bp.x !== ap.x || bp.y !== ap.y) {
                      moved = true;
                      break;
                    }
                  }
                }

                if (moved) {
                  changedStrokes.push({
                    stroke,
                    before: {
                      points: beforePts.map(p => ({ x: p.x, y: p.y }))
                    },
                    after: {
                      points: afterPts.map(p => ({ x: p.x, y: p.y }))
                    }
                  });
                }
              });
            }

            if (changedObjects.length || changedStrokes.length) {
              this.history.push({
                kind: "transform",
                objects: changedObjects,
                strokes: changedStrokes
              });
              // ★ 追加：移動・変形があったので未保存フラグを立てる
              this._markDirty();
            }
          }
          // ② リサイズ（単一オブジェクト・ドラッグ開始時に x,y,width,height を持っている場合）
          else if (this.isResizingObj && this.selectedObj &&
            typeof this.dragStart.x === "number" &&
            typeof this.dragStart.y === "number" &&
            typeof this.dragStart.width === "number" &&
            typeof this.dragStart.height === "number") {

            const obj = this.selectedObj;
            const before = {
              x: this.dragStart.x,
              y: this.dragStart.y,
              width: this.dragStart.width,
              height: this.dragStart.height
            };
            const after = {
              x: obj.x,
              y: obj.y,
              width: obj.width,
              height: obj.height
            };

            const changed =
              before.x !== after.x ||
              before.y !== after.y ||
              before.width !== after.width ||
              before.height !== after.height;

            if (changed) {
              this.history.push({
                kind: "transform",
                objects: [{ obj, before, after }],
                strokes: []
              });

              // ★ 追加：リサイズでも未保存フラグを立てる
              this._markDirty();
            }
          }
        }
        // ★ ここまで：履歴記録 ------------------

        // オブジェクトが動いたときは modify を送る
        if (this.onAction && this.selectedObj) {
          this.onAction({ type: "modify", object: this.selectedObj });
        }
        // ★ 追加：ストロークだけ動かした場合などは、全体再描画のきっかけを送る
        else if (this.onAction && this.multiSelectedStrokes && this.multiSelectedStrokes.length > 0) {
          this.onAction({ type: "refresh" });
        }

        this.isDraggingObj = false;
        this.isResizingObj = false;
        this.resizeHandle = null;
        this.dragStart = null;
      }


      if (this.isErasingTeacher) {
        this.isErasingTeacher = false;
      }
      // ★ 一般用消しゴムフラグも解除
      if (this.isErasingStroke) {
        this.isErasingStroke = false;
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
      if (this.isDraggingObj && this.multiSelectedStrokes.length && this.onAction) {
        this.onAction({ type: "refresh" });
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

      if (hit.kind === "text" || hit.kind === "sticky") {
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
    // ※ この関数は現在未使用のようなので、必要になったら ctx を引数で受け取る形に直してください
    const lines = [];
    let current = "";
    for (const ch of text) {
      const test = current + ch;
      // ctx.measureText を使うには ctx を引数で渡す必要があります
      // ここでは仮に maxWidth だけで折り返さない簡易実装にしておきます
      current = test;
    }
    if (current) lines.push(current);
    return lines;
  }

  _drawStamp(obj, x, y, width, height) {
    const preset = this.stampPresets[obj.stampKey] || this.stampPresets["star-yellow"];
    const emoji = preset.emoji;
    const ctx = this.ctx;

    const size = Math.min(width, height) * 0.9;
    const fontPx = (size / this.scale);

    const cx = x + width / 2;
    const cy = y + height / 2;

    ctx.save();
    ctx.font = `${fontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(emoji, cx, cy);
    ctx.restore();
  }

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

    this._renderStrokes(sctx, this.strokes);

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

    if (this.showGrid) {
      const gridStep = 200;
      const invScale = 1 / this.scale;
      const left = -this.offsetX * invScale;
      const top = -this.offsetY * invScale;
      const right = (w / dpr - this.offsetX) * invScale;
      const bottom = (h / dpr - this.offsetY) * invScale;
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
    }

    if (this.bgCanvas.width > 0 && this.bgCanvas.height > 0) {
      ctx.drawImage(this.bgCanvas, 0, 0);
    }

    this.handleRects = [];

    this._renderObjects(ctx, this.objects);

    if (this.pendingData) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      this._renderStrokes(ctx, this.pendingData.strokes);
      this._renderObjects(ctx, this.pendingData.objects);
      ctx.restore();
    }

    this._renderOverlays(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (this.strokeCanvas.width > 0 && this.strokeCanvas.height > 0) {
      ctx.drawImage(this.strokeCanvas, 0, 0);
    }
  }

  _renderStrokes(ctx, strokes) {
    if (!strokes) return;
    for (const stroke of strokes) {
      const pts = stroke.points;
      if (!pts || pts.length === 0) continue;

      if (stroke.type === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "#000000";
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

      if (pts.length < 3) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
      } else {
        ctx.moveTo(pts[0].x, pts[0].y);
        let i;
        for (i = 1; i < pts.length - 2; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
        }
        ctx.quadraticCurveTo(
          pts[i].x,
          pts[i].y,
          pts[i + 1].x,
          pts[i + 1].y
        );
      }
      ctx.stroke();
    }
  }

  _renderObjects(ctx, objects) {
    if (!objects) return;
    for (const obj of objects) {
      const kind = obj.kind;

      // ★ デフォルトは「そのまま」の座標
      let x = obj.x;
      let y = obj.y;
      let width = obj.width;
      let height = obj.height;

      // ★ 直線・矢印・相互矢印のときだけは
      //    「ドラッグ開始 → 終了」の向きをそのまま使いたいので、
      //    _normalizeRect を適用しない
      if (kind !== "line" && kind !== "arrow" && kind !== "double-arrow") {
        ({ x, y, width, height } = this._normalizeRect(obj));
      }

      const isSelected =
        this.multiSelectedObjects &&
        this.multiSelectedObjects.includes(obj);
      const strokeColor = obj.stroke || "#111827";
      const fillColor = obj.fill || "transparent";
      const strokeWidth = obj.strokeWidth || 2;

      if (kind === "image" && obj.image) {
        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cx = x + width / 2;
          const cy = y + height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.translate(-cx, -cy);
        }

        ctx.drawImage(obj.image, x, y, width, height);
        ctx.restore();
      }


      if (kind === "line" || kind === "arrow" || kind === "double-arrow") {
        const x1 = x;
        const y1 = y;
        const x2 = x + width;
        const y2 = y + height;

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;
        ctx.lineCap = "round";
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (kind === "arrow" || kind === "double-arrow") {
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = 10 / this.scale;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(
            x2 - headLen * Math.cos(angle - Math.PI / 6),
            y2 - headLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            x2 - headLen * Math.cos(angle + Math.PI / 6),
            y2 - headLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.lineTo(x2, y2);
          ctx.fillStyle = strokeColor;
          ctx.fill();
        }
        if (kind === "double-arrow") {
          const angle = Math.atan2(y1 - y2, x1 - x2);
          const headLen = 10 / this.scale;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(
            x1 - headLen * Math.cos(angle - Math.PI / 6),
            y1 - headLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            x1 - headLen * Math.cos(angle + Math.PI / 6),
            y1 - headLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.lineTo(x1, y1);
          ctx.fillStyle = strokeColor;
          ctx.fill();
        }
        ctx.restore();
      }

      else if (kind === "rect") {
        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cx = x + width / 2;
          const cy = y + height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.translate(-cx, -cy);
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
      }


      // ★ ellipse（円・楕円）
      else if (kind === "ellipse") {
        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cx = x + width / 2;
          const cy = y + height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.translate(-cx, -cy);
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;
        ctx.beginPath();
        ctx.ellipse(
          x + width / 2,
          y + height / 2,
          Math.abs(width) / 2,
          Math.abs(height) / 2,
          0,
          0,
          2 * Math.PI
        );
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }


      else if (kind === "triangle") {
        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cx = x + width / 2;
          const cy = y + height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.translate(-cx, -cy);
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;
        ctx.beginPath();
        ctx.moveTo(x + width / 2, y);
        ctx.lineTo(x, y + height);
        ctx.lineTo(x + width, y + height);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }


      else if (kind === "tri-prism") {
        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cx = x + width / 2;
          const cy = y + height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.translate(-cx, -cy);
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;

        // 前面の三角形（triangle と同じ）
        const front = [
          { x: x + width / 2, y: y },
          { x: x, y: y + height },
          { x: x + width, y: y + height }
        ];

        // 奥側へのオフセット（depth 利用。なければ幅の 0.3 倍）
        const depth = obj.depth != null ? obj.depth : Math.min(width, height) * 0.3;
        const dx = depth;
        const dy = -depth;

        const back = front.map(p => ({
          x: p.x + dx,
          y: p.y + dy
        }));

        // 前面
        ctx.beginPath();
        ctx.moveTo(front[0].x, front[0].y);
        ctx.lineTo(front[1].x, front[1].y);
        ctx.lineTo(front[2].x, front[2].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 奥側（三角形アウトライン）
        ctx.beginPath();
        ctx.moveTo(back[0].x, back[0].y);
        ctx.lineTo(back[1].x, back[1].y);
        ctx.lineTo(back[2].x, back[2].y);
        ctx.closePath();
        ctx.stroke();

        // 対応する頂点を結ぶ辺
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(front[i].x, front[i].y);
          ctx.lineTo(back[i].x, back[i].y);
          ctx.stroke();
        }

        ctx.restore();
      }

      // ★ 直方体（rect-prism）
      else if (kind === "rect-prism") {
        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cx = x + width / 2;
          const cy = y + height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.translate(-cx, -cy);
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;

        const depth = obj.depth != null ? obj.depth : Math.min(width, height) * 0.3;
        const dx = depth;
        const dy = -depth;

        // 前面の四角形
        const front = {
          x1: x,
          y1: y,
          x2: x + width,
          y2: y + height
        };

        // 奥側の四角形
        const back = {
          x1: x + dx,
          y1: y + dy,
          x2: x + width + dx,
          y2: y + height + dy
        };

        // 前面 塗りつぶし
        ctx.beginPath();
        ctx.rect(front.x1, front.y1, width, height);
        ctx.fill();
        ctx.stroke();

        // 奥側
        ctx.beginPath();
        ctx.rect(back.x1, back.y1, width, height);
        ctx.stroke();

        // 対応する 4 頂点を結ぶ
        const cornersFront = [
          { x: front.x1, y: front.y1 },
          { x: front.x2, y: front.y1 },
          { x: front.x2, y: front.y2 },
          { x: front.x1, y: front.y2 }
        ];
        const cornersBack = [
          { x: back.x1, y: back.y1 },
          { x: back.x2, y: back.y1 },
          { x: back.x2, y: back.y2 },
          { x: back.x1, y: back.y2 }
        ];

        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(cornersFront[i].x, cornersFront[i].y);
          ctx.lineTo(cornersBack[i].x, cornersBack[i].y);
          ctx.stroke();
        }

        ctx.restore();
      }

      // ★ 円柱（cylinder）
      else if (kind === "cylinder") {
        ctx.save();

        // ✅ ここで回転を反映：中心で回してから描画
        const angle = obj.rotation || 0;
        if (angle) {
          const cxCenter = x + width / 2;
          const cyCenter = y + height / 2;
          ctx.translate(cxCenter, cyCenter);
          ctx.rotate(angle);
          ctx.translate(-cxCenter, -cyCenter);
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;

        const cx = x + width / 2;
        const rx = Math.abs(width) / 2;
        const h = Math.abs(height);

        // ★ depth を「つぶれ具合（0〜1）」として扱う
        let ry;
        const defaultRy = Math.min(rx, h / 6);

        if (typeof obj.depth === "number" && obj.depth > 0 && obj.depth < 1.0) {
          const minRatio = 0.12;
          const maxRatio = 0.6;
          const ratio = Math.max(minRatio, Math.min(maxRatio, obj.depth));
          ry = rx * ratio;
        } else {
          // depth が無い／おかしい場合は従来ロジック
          ry = defaultRy;
        }

        // 念のため高さが極端に小さいときのガード
        if (h <= 2 * ry) {
          ry = h / 4;
        }

        const topY = y + ry;
        const bottomY = y + height - ry;
        const sideHeight = bottomY - topY;

        // --- 側面：塗りつぶし ---
        if (sideHeight > 0) {
          ctx.beginPath();
          ctx.fillRect(x, topY, width, sideHeight);
        }

        // 側面の縦線
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.lineTo(x, bottomY);
        ctx.moveTo(x + width, topY);
        ctx.lineTo(x + width, bottomY);
        ctx.stroke();

        // 上面の楕円
        ctx.beginPath();
        ctx.ellipse(cx, topY, rx, ry, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // 下面の楕円
        ctx.beginPath();
        ctx.ellipse(cx, bottomY, rx, ry, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      }






      else if (kind === "star") {
        ctx.save();
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth / this.scale;
        const cx = x + width / 2;
        const cy = y + height / 2;
        const outerRadius = Math.min(Math.abs(width), Math.abs(height)) / 2;
        const innerRadius = outerRadius / 2.5;
        const spikes = 5;
        let rot = (Math.PI / 2) * 3;
        let step = Math.PI / spikes;

        ctx.beginPath();
        ctx.moveTo(cx, cy - outerRadius);
        for (let i = 0; i < spikes; i++) {
          let tx = cx + Math.cos(rot) * outerRadius;
          let ty = cy + Math.sin(rot) * outerRadius;
          ctx.lineTo(tx, ty);
          rot += step;

          tx = cx + Math.cos(rot) * innerRadius;
          ty = cy + Math.sin(rot) * innerRadius;
          ctx.lineTo(tx, ty);
          rot += step;
        }
        ctx.lineTo(cx, cy - outerRadius);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      else if (kind === "stamp") {
        const key = obj.stampKey || "star-yellow";
        const preset = this.stampPresets[key] || this.stampPresets["star-yellow"];
        const emoji = preset ? (preset.emoji || "★") : "★";

        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cx = x + width / 2;
          const cy = y + height / 2;
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.translate(-cx, -cy);
        }

        ctx.font = `${width}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(emoji, x + width / 2, y + height / 2);
        ctx.restore();
      }


      else if (kind === "text" || kind === "sticky" || kind === "link") {
        ctx.save();

        const angle = obj.rotation || 0;
        if (angle) {
          const cxCenter = x + width / 2;
          const cyCenter = y + height / 2;
          ctx.translate(cxCenter, cyCenter);
          ctx.rotate(angle);
          ctx.translate(-cxCenter, -cyCenter);
        }

        if (kind === "sticky") {
          ctx.fillStyle = fillColor;
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 1 / this.scale;
          ctx.shadowColor = "rgba(0,0,0,0.15)";
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 3;
          ctx.fillRect(x, y, width, height);
          ctx.shadowColor = "transparent";
          ctx.strokeRect(x, y, width, height);
        }

        const fontSize = obj.fontSize || 16;
        const fontFamily = obj.fontFamily || "system-ui";
        const bold = obj.bold ? "bold " : "";
        ctx.font = `${bold}${fontSize / this.scale}px ${fontFamily}`;
        ctx.textBaseline = "top";

        // ★ 追加：文字色（textColor）優先
        let textColor = obj.textColor;
        if (!textColor) {
          if (kind === "link") {
            textColor = "#2563eb";
          } else if (kind === "sticky") {
            textColor = "#111827";
          } else {
            textColor = (obj.stroke && obj.stroke !== "transparent") ? obj.stroke : "#111827";
          }
        }
        ctx.fillStyle = textColor;

        const padding = 8 / this.scale;
        const lineHeight = 1.4;

        // ★ 自動改行：ボックス幅に合わせてテキストを折り返す
        const maxTextWidth = Math.max(10 / this.scale, width - padding * 2);
        const rawLines = (obj.text || "").split("\n");
        const lines = [];

        for (const raw of rawLines) {
          // 空行はそのまま保持
          if (raw === "") {
            lines.push("");
            continue;
          }

          let current = "";
          for (const ch of raw) {
            const test = current + ch;
            const w = ctx.measureText(test).width;
            if (w > maxTextWidth && current !== "") {
              lines.push(current);
              current = ch;
            } else {
              current = test;
            }
          }
          if (current !== "" || raw === "") {
            lines.push(current);
          }
        }

        let ty = y + padding;


        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();

        // ★ 追加：テキスト配置
        const align = obj.textAlign || "left";

        for (const line of lines) {
          let tx;
          if (align === "center") {
            ctx.textAlign = "center";
            tx = x + width / 2;
          } else if (align === "right") {
            ctx.textAlign = "right";
            tx = x + width - padding;
          } else {
            ctx.textAlign = "left";
            tx = x + padding;
          }

          ctx.fillText(line, tx, ty);
          ty += (fontSize / this.scale) * lineHeight;
        }

        // リンクの下線（配置に合わせる）
        if (kind === "link") {
          const text = obj.text || "";
          const tw = ctx.measureText(text).width;
          let ux1, ux2;
          const uy = ty - (fontSize / this.scale) * 0.2;

          if (align === "center") {
            const cx = x + width / 2;
            ux1 = cx - tw / 2;
            ux2 = cx + tw / 2;
          } else if (align === "right") {
            ux2 = x + width - padding;
            ux1 = ux2 - tw;
          } else {
            ux1 = x + padding;
            ux2 = ux1 + tw;
          }

          ctx.beginPath();
          ctx.strokeStyle = "#2563eb";
          ctx.lineWidth = 1 / this.scale;
          ctx.moveTo(ux1, uy);
          ctx.lineTo(ux2, uy);
          ctx.stroke();
        }

        ctx.restore();
      }
    }
  }

  _renderOverlays(ctx) {
    // ---- ボックス選択の描画 ----
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

    // ---- ストローク選択枠の描画 ----
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

    // ---- リサイズハンドルの描画 ----
    // 選択ツールで、単一オブジェクトが選択されているときだけ表示
    if (
      this.tool === "select" &&
      this.multiSelectedObjects &&
      this.multiSelectedObjects.length === 1 &&
      this.selectedObj
    ) {
      this._drawResizeHandles(ctx, this.selectedObj);
    }
  }


  // ★ 選択中オブジェクトのリサイズ＆回転ハンドル描画
  _drawResizeHandles(ctx, obj) {
    if (!obj) return;
    if (obj.locked) return;

    const kind = obj.kind;

    // ハンドルの見た目サイズ（画面上の px）
    const handleSizePx = 10;
    const dpr = this.dpr || window.devicePixelRatio || 1;
    const sizeWorld = handleSizePx / (this.scale * dpr); // ワールド座標でのサイズ
    const halfWorld = sizeWorld / 2;

    // ==== 1) 線・矢印・相互矢印 → 両端だけ（現状維持） ====
    if (kind === "line" || kind === "arrow" || kind === "double-arrow") {
      const x1 = obj.x;
      const y1 = obj.y;
      const x2 = obj.x + obj.width;
      const y2 = obj.y + obj.height;

      const endpoints = [
        { name: "p0", wx: x1, wy: y1 }, // 開始点
        { name: "p1", wx: x2, wy: y2 }  // 終了点
      ];

      for (const p of endpoints) {
        const screen = this._worldToScreen(p.wx, p.wy);
        this.handleRects.push({
          name: p.name,
          x: screen.x - handleSizePx / 2,
          y: screen.y - handleSizePx / 2,
          size: handleSizePx
        });

        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1 / this.scale;
        ctx.beginPath();
        ctx.rect(
          p.wx - halfWorld,
          p.wy - halfWorld,
          sizeWorld,
          sizeWorld
        );
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      return; // ← 線系はここで終わり
    }

    // ==== 2) それ以外の図形 → 四隅のリサイズハンドル ====
    const { x, y, width, height } = this._normalizeRect(obj);

    const corners = [
      { name: "nw", wx: x, wy: y },
      { name: "ne", wx: x + width, wy: y },
      { name: "se", wx: x + width, wy: y + height },
      { name: "sw", wx: x, wy: y + height }
    ];

    for (const c of corners) {
      const screen = this._worldToScreen(c.wx, c.wy);
      this.handleRects.push({
        name: c.name,
        x: screen.x - handleSizePx / 2,
        y: screen.y - handleSizePx / 2,
        size: handleSizePx
      });

      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1 / this.scale;
      ctx.beginPath();
      ctx.rect(
        c.wx - halfWorld,
        c.wy - halfWorld,
        sizeWorld,
        sizeWorld
      );
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // ==== 3) 回転ハンドル（全図形共通・線以外） ====
    //   ※ ここでは「バウンディングボックスの上側」に固定で出します
    //     （回転していても、常に“見た目の上”にある必要はない、という割り切り版）
    const cx = x + width / 2;
    const topY = y;

    const offsetWorld = 40 / this.scale;        // オブジェクトからの距離（ワールド）
    const rotateWx = cx;
    const rotateWy = topY - offsetWorld;        // 上方向に少し離す

    // 当たり判定用
    const rotateScreen = this._worldToScreen(rotateWx, rotateWy);
    this.handleRects.push({
      name: "rotate",
      x: rotateScreen.x - handleSizePx / 2,
      y: rotateScreen.y - handleSizePx / 2,
      size: handleSizePx
    });

    // 描画（回転ハンドルはオレンジの丸）
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#f97316"; // オレンジ
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    ctx.arc(rotateWx, rotateWy, sizeWorld * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // ==== 4) 3D 図形には depth 用ハンドルを追加（現状のまま＋α） ====
    // ★ 3) 3D 図形には depth 用ハンドルを追加
    if (kind === "tri-prism" || kind === "rect-prism") {
      // tri-prism / rect-prism はこれまで通り「奥行き距離」として扱う
      const depth = obj.depth != null ? obj.depth : 40;
      const dx = depth;
      const dy = -depth;

      // 前面右上（正面の右上頂点）
      const frontTopRight = { wx: x + width, wy: y };
      // 奥側右上（そこに depth 分ずれる）
      const backTopRight = {
        wx: frontTopRight.wx + dx,
        wy: frontTopRight.wy + dy
      };

      const screen = this._worldToScreen(backTopRight.wx, backTopRight.wy);
      this.handleRects.push({
        name: "depth",
        x: screen.x - handleSizePx / 2,
        y: screen.y - handleSizePx / 2,
        size: handleSizePx
      });

      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#10b981"; // depth 用
      ctx.lineWidth = 1 / this.scale;
      ctx.beginPath();
      ctx.rect(
        backTopRight.wx - halfWorld,
        backTopRight.wy - halfWorld,
        sizeWorld,
        sizeWorld
      );
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (kind === "cylinder") {
      // ★ 円柱だけは「視点角度（楕円のつぶれ具合）」用ハンドル
      //    → 図形の右側中央から少し右に出す
      const offsetWorld = 30 / this.scale;
      const wx = x + width + offsetWorld;
      const wy = y + height / 2;

      const screen = this._worldToScreen(wx, wy);
      this.handleRects.push({
        name: "depth",
        x: screen.x - handleSizePx / 2,
        y: screen.y - handleSizePx / 2,
        size: handleSizePx
      });

      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#10b981"; // depth 用（緑）
      ctx.lineWidth = 1 / this.scale;
      ctx.beginPath();
      ctx.rect(
        wx - halfWorld,
        wy - halfWorld,
        sizeWorld,
        sizeWorld
      );
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

// public/js/board-ui.js
// ホワイトボードの共通 UI 初期化（ツールボタン・PDF読み込み・ズーム・サイドバー折りたたみなど）

import { Whiteboard } from "./whiteboard.js";

export function initBoardUI() {
  const canvas = document.getElementById("whiteboard");
  if (!canvas) {
    console.error("whiteboard canvas (#whiteboard) が見つかりません。");
    return null;
  }

  const wb = new Whiteboard({ canvas });

  // ========= ツールボタン =========
  const toolButtons = document.querySelectorAll("[data-tool]");
  const pdfInput = document.getElementById("pdfInput");
  const undoBtn = document.getElementById("undoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const groupBtn = document.getElementById("groupBtn");
  const lockBtn = document.getElementById("lockBtn");
  const deleteBtn = document.getElementById("deleteBtn");

  let currentTool = "pen";

  // ★ 前面 / 背面ボタン
  const bringToFrontBtn = document.getElementById("bringToFrontBtn");
  const sendToBackBtn = document.getElementById("sendToBackBtn");

  // ★ スタンプパレット関連
  const stampPalette = document.getElementById("stampPalette");
  const stampPaletteCloseBtn = document.getElementById("stampPaletteCloseBtn");
  const stampPaletteInner = stampPalette
    ? stampPalette.querySelector(".stamp-palette-inner")
    : null;

  // ★ 図形パレット関連
  const shapePalette = document.getElementById("shapePalette");
  const shapePaletteCloseBtn = document.getElementById("shapePaletteCloseBtn");
  const shapePaletteInner = shapePalette
    ? shapePalette.querySelector(".shape-palette-inner")
    : null;

  // ★ 図形スタイル（線色 / 塗り色 / 線幅）
  const shapeStrokeColorButtons = document.querySelectorAll(
    "[data-shape-stroke-color]"
  );
  const shapeFillColorButtons = document.querySelectorAll(
    "[data-shape-fill-color]"
  );
  const shapeStrokeWidthSelect = document.getElementById(
    "shapeStrokeWidthSelect"
  );

  // PDF出力ボタン（先生・生徒共通）
  const exportPdfBtn = document.getElementById("exportPdfBtn");

  // ペン色・太さ / 付箋カラー
  const penColorButtons = document.querySelectorAll("[data-pen-color]");
  const penWidthSelect = document.getElementById("penWidthSelect");
  const stickyColorButtons = document.querySelectorAll("[data-sticky-color]");

  // 現在のペン設定
  let currentPenColor = "#111827";
  let currentPenWidth = 3;

  let currentStampKey = null;

  // ========= パレットの表示 / 非表示 =========
  function showStampPalette() {
    if (!stampPalette) return;
    stampPalette.classList.remove("stamp-palette-hidden");
  }
  function hideStampPalette() {
    if (!stampPalette) return;
    stampPalette.classList.add("stamp-palette-hidden");
  }

  // ★ ここを修正：図形パレット用の専用クラス shape-palette-hidden を使う
  // ★ 図形パレット表示/非表示（stamp-palette-hidden も一緒に管理する）
  function showShapePalette() {
    if (!shapePalette) return;
    shapePalette.classList.remove("shape-palette-hidden");
    shapePalette.classList.remove("stamp-palette-hidden"); // ← これを追加
  }

  function hideShapePalette() {
    if (!shapePalette) return;
    shapePalette.classList.add("shape-palette-hidden");
    shapePalette.classList.add("stamp-palette-hidden"); // ← これを追加
  }


  // 起動直後はどちらも確実に隠しておく（クリックを奪わないように）
  hideStampPalette();
  hideShapePalette();

  // ========= 選択状態に応じたボタン UI 更新 =========
  function updateSelectionButtonsUI() {
    // --- グループボタン：選択が2つ以上あるときだけ有効 ---
    if (groupBtn) {
      const objCount = Array.isArray(wb.multiSelectedObjects)
        ? wb.multiSelectedObjects.length
        : 0;
      const strokeCount = Array.isArray(wb.multiSelectedStrokes)
        ? wb.multiSelectedStrokes.length
        : 0;
      const selCount = objCount + strokeCount;

      const canGroup = selCount >= 2;
      groupBtn.disabled = !canGroup;
      groupBtn.classList.toggle("disabled", !canGroup);
      groupBtn.classList.toggle("primary", canGroup);
      groupBtn.classList.toggle("active", canGroup);
    }

    // --- 削除ボタン（選択がないときは無効化） ---
    if (deleteBtn) {
      const hasSel =
        wb && typeof wb.hasSelection === "function"
          ? wb.hasSelection()
          : false;

      deleteBtn.disabled = !hasSel;
      deleteBtn.classList.toggle("disabled", !hasSel);
    }
  }

  // ========= 図形スタイル UI 更新 =========
  function updateShapeStyleUI(info) {
    // 図形が選択されていない or テキストなどのときはリセット
    if (!info || !info.kind || info.kind === "text") {
      shapeStrokeColorButtons.forEach(b => b.classList.remove("active"));
      shapeFillColorButtons.forEach(b => b.classList.remove("active"));
      if (shapeStrokeWidthSelect) shapeStrokeWidthSelect.value = "3";
      return;
    }

    // 線の色
    if (info.stroke) {
      shapeStrokeColorButtons.forEach(b => {
        const c = b.dataset.shapeStrokeColor;
        b.classList.toggle("active", c === info.stroke);
      });
    }

    // 塗りつぶし色
    if (info.fill !== undefined) {
      shapeFillColorButtons.forEach(b => {
        const c = b.dataset.shapeFillColor;
        b.classList.toggle("active", c === info.fill);
      });
    }

    // 線の太さ
    if (shapeStrokeWidthSelect && info.strokeWidth != null) {
      const val = String(info.strokeWidth);
      const hasOption = Array.from(shapeStrokeWidthSelect.options).some(
        opt => opt.value === val
      );
      shapeStrokeWidthSelect.value = hasOption ? val : "3";
    }
  }

  // ========= ツールボタンの UI 更新 =========
  function updateToolButtons(activeTool) {
    currentTool = activeTool;

    toolButtons.forEach(btn => {
      const t = btn.dataset.tool;
      btn.classList.toggle("active", t === activeTool);
      btn.classList.toggle("primary", t === activeTool);
    });

    // スタンプ・図形ツール以外ではパレットを閉じる
    if (activeTool !== "stamp" && stampPalette) {
      hideStampPalette();
    }
    if (activeTool !== "shape" && shapePalette) {
      hideShapePalette();
    }
  }

  // ========= Whiteboard 側からの選択変更通知 =========
  wb.onSelectionChange = info => {
    updateSelectionButtonsUI();
    updateShapeStyleUI(info);
  };

  // 初期状態も反映
  updateSelectionButtonsUI();

  // ========= ツールボタン共通処理 =========
  toolButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      if (!tool) return;

      // shape / stamp 以外は普通のツール
      if (tool !== "shape" && tool !== "stamp") {
        wb.setTool(tool);
        updateToolButtons(tool);
        return;
      }

      // スタンプツール
      if (tool === "stamp") {
        wb.setTool("stamp");
        updateToolButtons("stamp");
        showStampPalette();
        return;
      }

      // 図形ツール
      if (tool === "shape") {
        wb.setTool("shape");
        updateToolButtons("shape");
        showShapePalette();
      }
    });
  });

  // ========= スタンプパレットの生成＆選択 =========
  if (stampPalette && wb.stampPresets) {
    const host = stampPaletteInner || stampPalette;

    let itemsContainer = host.querySelector(".stamp-items");
    if (!itemsContainer) {
      itemsContainer = document.createElement("div");
      itemsContainer.className = "stamp-items";
      host.appendChild(itemsContainer);
    }

    // 古い .stamp-item を削除しておく
    stampPalette.querySelectorAll(".stamp-item").forEach(el => el.remove());
    itemsContainer.innerHTML = "";

    Object.entries(wb.stampPresets).forEach(([key, preset]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "stamp-item";
      item.dataset.stampKey = key;
      item.title = key;
      item.textContent = preset.emoji || "★";

      item.addEventListener("click", () => {
        if (typeof wb.setStampType === "function") wb.setStampType(key);
        wb.setTool("stamp");
        updateToolButtons("stamp");
        hideStampPalette();
      });

      itemsContainer.appendChild(item);
    });

    if (stampPaletteCloseBtn) {
      stampPaletteCloseBtn.addEventListener("click", hideStampPalette);
    }
  }

  // ========= 図形パレットの生成＆選択 =========
  if (shapePalette) {
    const host = shapePaletteInner || shapePalette;
    let itemsContainer = host.querySelector(".shape-items");
    if (!itemsContainer) {
      itemsContainer = document.createElement("div");
      itemsContainer.className = "shape-items";
      host.appendChild(itemsContainer);
    }

    // 一旦クリア
    itemsContainer.innerHTML = "";

    // Whiteboard 側に shapePresets があればそれを使う。なければデフォルト。
    const defaultShapes = [
      { key: "line", label: "直線", icon: "／" },
      { key: "arrow", label: "矢印", icon: "→" },
      { key: "double-arrow", label: "相互矢印", icon: "↔" },
      { key: "triangle", label: "三角形", icon: "△" },
      { key: "rect", label: "四角形", icon: "▭" },
      { key: "circle", label: "円", icon: "◯" },
      { key: "tri-prism", label: "三角柱", icon: "△▭" },
      { key: "rect-prism", label: "直方体", icon: "▭▭" },
      { key: "cylinder", label: "円柱", icon: "◯┃" }
    ];

    const shapePresets = wb.shapePresets || defaultShapes;

    shapePresets.forEach(shape => {
      const key = shape.key || shape.id;
      if (!key) return;

      const item = document.createElement("button");
      item.type = "button";
      item.className = "shape-item";
      item.dataset.shapeKey = key;
      item.title = shape.label || key;

      item.innerHTML = `
        <span class="shape-icon">${shape.icon || "⬚"}</span>
        <span class="shape-label">${shape.label || key}</span>
      `;

      item.addEventListener("click", () => {
        if (typeof wb.setShapeType === "function") {
          // ★ Whiteboard 側が "ellipse" を期待しているので、circle だけ変換する
          const shapeKeyForWB = key === "circle" ? "ellipse" : key;
          wb.setShapeType(shapeKeyForWB);
          wb.setTool("shape");
          updateToolButtons("shape");
        } else {
          // まだ実装していない場合のフォールバック
          if (key === "rect") {
            wb.setTool("rect");
            updateToolButtons("rect");
          } else if (key === "circle") {
            wb.setTool("ellipse");
            updateToolButtons("ellipse");
          } else {
            alert("この図形はまだ実装されていません。");
          }
        }
        hideShapePalette();
      });


      itemsContainer.appendChild(item);
    });

    if (shapePaletteCloseBtn) {
      shapePaletteCloseBtn.addEventListener("click", hideShapePalette);
    }
  }

  // ========= 初期ツール / ペン設定 =========
  updateToolButtons("pen");
  wb.setTool("pen");

  wb.setPen(currentPenColor, currentPenWidth);
  if (wb.setHighlighterColor) {
    wb.setHighlighterColor(currentPenColor);
  }

  // ========= ペン色パレット =========
  if (penColorButtons.length > 0) {
    penColorButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.penColor;
        if (!color) return;
        currentPenColor = color;
        wb.setPen(currentPenColor, currentPenWidth);
        if (wb.setHighlighterColor) {
          wb.setHighlighterColor(currentPenColor);
        }

        penColorButtons.forEach(b =>
          b.classList.toggle("active", b === btn)
        );
      });
    });
  }

  // ========= ペン太さ =========
  if (penWidthSelect) {
    penWidthSelect.addEventListener("change", () => {
      const width = parseInt(penWidthSelect.value, 10) || 3;
      currentPenWidth = width;
      wb.setPen(currentPenColor, currentPenWidth);
    });
  }

  // ========= 付箋カラー =========
  if (stickyColorButtons.length > 0) {
    stickyColorButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.stickyColor;
        if (!color) return;
        if (wb.setSelectedStickyColor) {
          wb.setSelectedStickyColor(color);
        }
        stickyColorButtons.forEach(b =>
          b.classList.toggle("active", b === btn)
        );
      });
    });
  }

  // ========= 図形：線の色 =========
  if (
    shapeStrokeColorButtons.length > 0 &&
    typeof wb.setSelectedStrokeColor === "function"
  ) {
    shapeStrokeColorButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.shapeStrokeColor;
        if (!color) return;

        wb.setSelectedStrokeColor(color);

        // UI 側ハイライト
        shapeStrokeColorButtons.forEach(b =>
          b.classList.toggle("active", b === btn)
        );
      });
    });
  }

  // ========= 図形：塗りつぶし色 =========
  if (
    shapeFillColorButtons.length > 0 &&
    typeof wb.setSelectedStickyColor === "function"
  ) {
    shapeFillColorButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.shapeFillColor;
        if (color == null) return;

        // "transparent" もそのまま渡す（塗りなし）
        wb.setSelectedStickyColor(color);

        shapeFillColorButtons.forEach(b =>
          b.classList.toggle("active", b === btn)
        );
      });
    });
  }

  // ========= 図形：線の太さ =========
  if (
    shapeStrokeWidthSelect &&
    typeof wb.setSelectedStrokeWidth === "function"
  ) {
    shapeStrokeWidthSelect.addEventListener("change", () => {
      const width = parseInt(shapeStrokeWidthSelect.value, 10) || 3;
      wb.setSelectedStrokeWidth(width);
    });
  }

  // ========= PDF 読み込み =========
  if (pdfInput) {
    pdfInput.addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await wb.loadPdfFile(file);
      } catch (err) {
        console.error("PDF load error", err);
        alert("PDF の読み込みに失敗しました。");
      } finally {
        pdfInput.value = "";
      }
    });
  }

  // ========= Undo / Clear =========
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      wb.undoLast();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (confirm("ホワイトボードをすべて消去しますか？")) {
        wb.clearAll();
      }
    });
  }

  // ========= ズーム =========
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => wb.zoomAtCanvasCenter(1.1));
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => wb.zoomAtCanvasCenter(0.9));
  }

  // ========= グループ化 =========
  if (groupBtn) {
    groupBtn.addEventListener("click", () => {
      if (wb.groupSelection) {
        wb.groupSelection();
        updateSelectionButtonsUI();
      }
    });
  }

  // ========= ロック =========
  if (lockBtn) {
    lockBtn.addEventListener("click", () => {
      if (wb.toggleLockSelection) wb.toggleLockSelection();
    });
  }

  // ========= 削除ボタン =========
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (wb.hasSelection && wb.hasSelection()) {
        wb.deleteSelection();
        updateSelectionButtonsUI();
      }
    });
  }

  // ========= 前面 / 背面ボタン（whiteboard.js にあれば） =========
  if (bringToFrontBtn && typeof wb.bringSelectionToFront === "function") {
    bringToFrontBtn.addEventListener("click", () => {
      wb.bringSelectionToFront();
    });
  }
  if (sendToBackBtn && typeof wb.sendSelectionToBack === "function") {
    sendToBackBtn.addEventListener("click", () => {
      wb.sendSelectionToBack();
    });
  }

  // ========= キーボードショートカット (Undo / Copy / Paste / Delete) =========
  window.addEventListener("keydown", e => {
    const target = e.target;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return; // 入力中は何もしない
    }

    const key = e.key.toLowerCase();

    // Undo
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      wb.undoLast();
      return;
    }

    // Copy
    if ((e.ctrlKey || e.metaKey) && key === "c") {
      if (wb.copySelection) {
        e.preventDefault();
        wb.copySelection();
      }
      return;
    }

    // Paste（内部クリップボード優先）
    if ((e.ctrlKey || e.metaKey) && key === "v") {
      if (wb.clipboard && wb.pasteSelection) {
        e.preventDefault();
        wb.pasteSelection();
      }
      // 外部クリップボードは window "paste" イベントで処理
      return;
    }

    // Delete / Backspace で削除
    if (key === "delete" || key === "backspace") {
      if (wb.hasSelection && wb.hasSelection()) {
        e.preventDefault();
        wb.deleteSelection();
        updateSelectionButtonsUI();
      }
    }
  });

  // ========= 外部テキスト/URL/画像 の貼り付け =========
  window.addEventListener("paste", async e => {
    const target = e.target;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return; // フォーム入力は通常どおり
    }

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    // 1) 画像があればそちらを優先
    const items = clipboardData.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob && wb.pasteImageBlob) {
          e.preventDefault();
          await wb.pasteImageBlob(blob);
          return;
        }
      }
    }

    // 2) 画像がない場合はテキスト/URL を処理
    const text = clipboardData.getData("text");
    if (!text) return;

    const value = text.trim();
    const urlPattern = /^(https?:\/\/[^\s]+)$/i;

    if (urlPattern.test(value)) {
      // URL → リンクオブジェクト
      if (wb.pasteLink) wb.pasteLink(value);
    } else {
      // その他テキスト → テキストボックス
      if (wb.pastePlainText) wb.pastePlainText(value);
    }
  });

  // ========= キャンバスリサイズ（高 DPI 対応） =========
  function resizeCanvasToContainer() {
    const container = canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    wb.dpr = dpr;
    wb.render();
  }

  resizeCanvasToContainer();
  window.addEventListener("resize", resizeCanvasToContainer);

  // ========= 左サイドバー折りたたみ（teacher / student 共通） =========
  const sidebar = document.getElementById("wbSidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");

  if (sidebar && sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      const collapsed = sidebar.classList.toggle("collapsed");
      sidebarToggle.classList.toggle("collapsed", collapsed);

      // 折りたたみアニメーション後にキャンバスサイズを再計算
      setTimeout(() => {
        resizeCanvasToContainer();
      }, 260);
    });
  }

  // ========= PDF 出力（編集範囲のみ） =========
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", () => {
      exportBoardToPdf(canvas);
    });
  }

  function detectContentBoundsFromCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h).data;
    } catch (err) {
      console.error("getImageData に失敗したため、キャンバス全体を出力します:", err);
      return { x: 0, y: 0, width: w, height: h };
    }

    let top = h;
    let left = w;
    let right = 0;
    let bottom = 0;
    let hasContent = false;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w * 4;
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x * 4;
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        const a = imageData[i + 3];

        const isTransparent = a === 0;
        const isAlmostWhite = r > 250 && g > 250 && b > 250;

        if (isTransparent || isAlmostWhite) continue;

        hasContent = true;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }

    if (!hasContent) {
      return null;
    }

    const padding = 16; // 少し余白を足す
    left = Math.max(0, left - padding);
    top = Math.max(0, top - padding);
    right = Math.min(w - 1, right + padding);
    bottom = Math.min(h - 1, bottom + padding);

    return {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1
    };
  }

  function saveCanvasAsPdf(croppedCanvas) {
    const jspdf = window.jspdf;
    if (!jspdf || !jspdf.jsPDF) {
      alert("PDF出力ライブラリ(jsPDF)が読み込まれていません。");
      return;
    }
    const { jsPDF } = jspdf;

    const imgData = croppedCanvas.toDataURL("image/png");
    const isLandscape = croppedCanvas.width >= croppedCanvas.height;

    const pdf = new jsPDF({
      orientation: isLandscape ? "l" : "p",
      unit: "mm",
      format: "a4"
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgAspect = croppedCanvas.width / croppedCanvas.height;
    const pageAspect = pageWidth / pageHeight;

    let renderWidth, renderHeight;
    const margin = 10; // mm

    if (pageAspect > imgAspect) {
      renderHeight = pageHeight - margin * 2;
      renderWidth = renderHeight * imgAspect;
    } else {
      renderWidth = pageWidth - margin * 2;
      renderHeight = renderWidth / imgAspect;
    }

    const x = (pageWidth - renderWidth) / 2;
    const y = (pageHeight - renderHeight) / 2;

    pdf.addImage(imgData, "PNG", x, y, renderWidth, renderHeight);

    const filename =
      "whiteboard-" +
      new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", "_")
        .replace(/:/g, "-") +
      ".pdf";

    pdf.save(filename);
  }

  function exportBoardToPdf(canvas) {
    const bounds = detectContentBoundsFromCanvas(canvas);
    if (!bounds) {
      alert("出力する内容がありません。");
      return;
    }

    const off = document.createElement("canvas");
    off.width = bounds.width;
    off.height = bounds.height;

    const ctx = off.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, off.width, off.height);

    ctx.drawImage(
      canvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height
    );

    saveCanvasAsPdf(off);
  }

  return wb;
}

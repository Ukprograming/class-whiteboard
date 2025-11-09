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

  // PDF出力ボタン（先生・生徒共通）
  const exportPdfBtn = document.getElementById("exportPdfBtn");

  // ペン色・太さ / 付箋カラー
  const penColorButtons = document.querySelectorAll("[data-pen-color]");
  const penWidthSelect = document.getElementById("penWidthSelect");
  const stickyColorButtons = document.querySelectorAll("[data-sticky-color]");

  // 現在のペン設定
  let currentPenColor = "#111827";
  let currentPenWidth = 3;

  function updateToolButtons(activeTool) {
    toolButtons.forEach(btn => {
      const t = btn.dataset.tool;
      btn.classList.toggle("active", t === activeTool);
      btn.classList.toggle("primary", t === activeTool);
    });
  }

  toolButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      wb.setTool(tool);
      updateToolButtons(tool);
    });
  });

  // 初期ツールはペン
  updateToolButtons("pen");
  wb.setTool("pen");

  // 初期ペン設定
  wb.setPen(currentPenColor, currentPenWidth);
  wb.setHighlighterColor(currentPenColor);

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

  // ========= グループ化 / ロック =========
  if (groupBtn) {
    groupBtn.addEventListener("click", () => {
      if (wb.groupSelection) wb.groupSelection();
    });
  }

  if (lockBtn) {
    lockBtn.addEventListener("click", () => {
      if (wb.toggleLockSelection) wb.toggleLockSelection();
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

  /**
   * キャンバス上で「背景ではないピクセル」が存在する矩形範囲を検出する
   * - 完全透明 or ほぼ白(#ffffffに近い)は「背景」とみなす
   * - 何も描かれていなければ null
   */
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

  /**
   * 与えられたキャンバスを 1ページPDFとして保存
   */
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
      // ページの方が横に広い → 高さ基準でフィット
      renderHeight = pageHeight - margin * 2;
      renderWidth = renderHeight * imgAspect;
    } else {
      // ページの方が縦に長い → 幅基準でフィット
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

  /**
   * ホワイトボード全体から「編集範囲」を自動検出して PDF として保存
   */
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

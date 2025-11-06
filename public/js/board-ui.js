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

  return wb;
}

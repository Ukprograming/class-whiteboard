// public/js/board-ui.js
// ホワイトボードの共通 UI 初期化（ツールボタン・PDF読み込み・ズーム・サイドバー折りたたみなど）

import { Whiteboard } from "./whiteboard.js?v=tool-settings-20260818c&draw-style=20260824&modal-highlighter-width=20260824&asset-lifecycle=20260824&session-recovery=20260824&eraser-hit=20260825&timer-tool=20260826&table-tool=20260901a&youtube=20260831b";
import { createStampElement } from "./stamps.js?v=png-reaction-stamps-20260824";
import { replaceMaterialIcons } from "./ui-icons.js?v=timer-tool-20260826&forms=20260830b";

export function initBoardUI() {
  replaceMaterialIcons();

  const canvas = document.getElementById("whiteboard");
  if (!canvas) {
    console.error("whiteboard canvas (#whiteboard) が見つかりません。");
    return null;
  }

  const wb = new Whiteboard({ canvas });

  const zoomLevelEl = document.getElementById("zoomLevel");

  canvas.whiteboardInstance = wb;

  const pageTabsEl = document.getElementById("pageTabs");
  const pageAddBtn = document.getElementById("pageAddBtn");
  const pageRenameBtn = document.getElementById("pageRenameBtn");
  const pageDeleteBtn = document.getElementById("pageDeleteBtn");

  function renderPageTabs({ pages = wb.getPages(), activePageId = wb.activePageId } = {}) {
    if (!pageTabsEl) return;
    pageTabsEl.innerHTML = "";
    pages.forEach(page => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "page-tab";
      button.textContent = page.name;
      button.title = page.name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", page.id === activePageId ? "true" : "false");
      button.classList.toggle("active", page.id === activePageId);
      button.addEventListener("click", () => wb.selectPage(page.id));
      pageTabsEl.appendChild(button);
    });
    if (pageDeleteBtn) pageDeleteBtn.disabled = pages.length <= 1;
  }

  wb.onPagesChange = renderPageTabs;
  renderPageTabs();

  if (pageAddBtn) {
    pageAddBtn.addEventListener("click", () => wb.addPage());
  }
  if (pageRenameBtn) {
    pageRenameBtn.addEventListener("click", () => {
      const active = wb.getPages().find(page => page.id === wb.activePageId);
      if (!active) return;
      const name = window.prompt("ページ名を入力してください", active.name);
      if (name === null) return;
      wb.renamePage(active.id, name);
    });
  }
  if (pageDeleteBtn) {
    pageDeleteBtn.addEventListener("click", () => {
      const active = wb.getPages().find(page => page.id === wb.activePageId);
      if (!active || wb.getPages().length <= 1) return;
      if (window.confirm(`「${active.name}」を削除しますか？`)) {
        wb.deletePage(active.id);
      }
    });
  }


  // ========= ツールボタン =========
  // 生徒画面モーダルにも独立した data-tool ボタンがあるため、
  // 通常ホワイトボードのサイドバーだけを共通 UI の対象にする。
  const toolButtons = document.querySelectorAll("#wbSidebar [data-tool]");
  const pdfInput = document.getElementById("pdfInput");
  const undoBtn = document.getElementById("undoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const gridToggleBtn = document.getElementById("gridToggleBtn");
  const groupBtn = document.getElementById("groupBtn");
  const lockBtn = document.getElementById("lockBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const zoomLevelLabel = document.getElementById("zoomLevel");

  // ✅ Whiteboardの実スケールからズーム表示を更新
  function updateZoomLabelFromWB() {
    if (!zoomLevelEl || !wb) return;

    const scale = wb.scale ?? 1;
    const percent = Math.round(scale * 100);
    zoomLevelEl.textContent = percent + "%";
  }

  wb.onZoomChange = () => {
    updateZoomLabelFromWB();
  };

  function updateGridToggle() {
    if (!gridToggleBtn) return;
    const isVisible = !!wb.showGrid;
    gridToggleBtn.classList.toggle("is-on", isVisible);
    gridToggleBtn.setAttribute("aria-checked", String(isVisible));
    gridToggleBtn.title = isVisible ? "グリッドを非表示" : "グリッドを表示";
  }

  if (gridToggleBtn) {
    gridToggleBtn.addEventListener("click", () => {
      wb.setShowGrid(!wb.showGrid);
      updateGridToggle();
    });
    updateGridToggle();
  }

  // 初期表示を反映
  updateZoomLabelFromWB();



  let currentTool = "pen";
  let settingsOpenTool = null;

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
  const shapeDepthRange = document.getElementById("shapeDepthRange");
  const shapeSettingsPanel = document.getElementById("shapeSettings");
  let currentShapeKey = "rect";
  const editableShapeKinds = new Set([
    "line", "arrow", "double-arrow", "triangle", "rect", "rounded-rect",
    "ellipse", "diamond", "parallelogram", "trapezoid", "pentagon",
    "hexagon", "star", "tri-prism", "rect-prism", "cylinder"
  ]);

  // PDF出力ボタン（先生・生徒共通）
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  const exportPngBtn = document.getElementById("exportPngBtn");

  // ペン色・太さ / 付箋カラー
  const penColorButtons = document.querySelectorAll("[data-pen-color]");
  const penWidthSelect = document.getElementById("penWidthSelect");
  const stickyColorButtons = document.querySelectorAll("[data-sticky-color]");

  // ★ テキストスタイルパネル関連
  let textStylePanel = null;
  let textFontSizeSelect = null;
  let textColorInput = null;
  let textBoldToggle = null;
  let textFontFamilySelect = null;
  let textAlignLeftBtn = null;
  let textAlignCenterBtn = null;
  let textAlignRightBtn = null;
  let panelStickyColorRow = null;

  // 表ツール設定パネル
  let tableStylePanel = null;
  let tableCellLabel = null;
  let tableFillPalette = null;
  let tableFillOpacityRange = null;
  let tableFillOpacityValue = null;
  let tableFontSizeSelect = null;
  let tableTextColorPalette = null;
  let tableBoldToggle = null;
  let tableFontFamilySelect = null;
  let tableBorderSideSelect = null;
  let tableBorderColorPalette = null;
  let tableBorderOpacityRange = null;
  let tableBorderOpacityValue = null;
  let tableBorderWidthSelect = null;
  let tableBorderStyleSelect = null;
  let currentTableFillHex = "#ffffff";
  let currentTableFillOpacity = 100;
  let currentTableTextHex = "#111827";
  let currentTableBorderHex = "#111827";
  let currentTableBorderOpacity = 100;

  const TABLE_FILL_COLORS = Object.freeze([
    "#ffffff", "#f1f5f9", "#fee2e2", "#ffedd5", "#fef3c7",
    "#dcfce7", "#cffafe", "#dbeafe", "#ede9fe", "#fce7f3"
  ]);
  const TABLE_INK_COLORS = Object.freeze([
    "#111827", "#64748b", "#dc2626", "#ea580c", "#ca8a04",
    "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777"
  ]);

  function tableColorParts(value, fallback = "#ffffff") {
    const raw = String(value || fallback).trim().toLowerCase();
    if (raw === "transparent") return { hex: fallback, opacity: 0 };
    const rgba = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (rgba) {
      const hex = `#${[rgba[1], rgba[2], rgba[3]]
        .map(value => Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0"))
        .join("")}`;
      const opacity = rgba[4] == null ? 100 : Math.round(Math.max(0, Math.min(1, Number(rgba[4]))) * 100);
      return { hex, opacity };
    }
    if (/^#[0-9a-f]{3}$/.test(raw)) {
      return { hex: `#${raw.slice(1).split("").map(ch => ch + ch).join("")}`, opacity: 100 };
    }
    if (/^#[0-9a-f]{6}$/.test(raw)) return { hex: raw, opacity: 100 };
    return { hex: fallback, opacity: 100 };
  }

  function tableColorWithOpacity(hex, opacity) {
    const parts = tableColorParts(hex, "#ffffff");
    const alpha = Math.max(0, Math.min(100, Number(opacity))) / 100;
    if (alpha >= 1) return parts.hex;
    const r = parseInt(parts.hex.slice(1, 3), 16);
    const g = parseInt(parts.hex.slice(3, 5), 16);
    const b = parseInt(parts.hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }

  function tablePaletteMarkup(attribute, colors) {
    return colors.map(color => `
      <button type="button" class="color-dot table-color-dot" ${attribute}="${color}"
        style="--c:${color}" aria-label="${color}" title="${color}"></button>`).join("");
  }

  function updateTablePaletteSelection(container, attribute, color) {
    if (!container) return;
    container.querySelectorAll(`[${attribute}]`).forEach(button => {
      button.classList.toggle("active", button.getAttribute(attribute) === color);
    });
  }

  // 現在のペン設定
  let currentPenColor = "#111827";
  let currentPenWidth = 3;
  let currentHighlighterColor = "#facc15";
  let currentHighlighterWidth = 30;

  // ペンと同じ4段階の表示を使いながら、蛍光ペンに適した太さへ変換する。
  const highlighterWidthPresets = Object.freeze({
    2: 14,
    3: 30,
    5: 42,
    8: 56
  });

  function updateDrawSettingsUI(tool) {
    const isHighlighter = tool === "highlighter";
    const color = isHighlighter ? currentHighlighterColor : currentPenColor;
    const widthValue = isHighlighter
      ? Object.entries(highlighterWidthPresets).find(
        ([, width]) => width === currentHighlighterWidth
      )?.[0] || "3"
      : String(currentPenWidth);

    penColorButtons.forEach(btn => {
      btn.classList.toggle("active", btn.dataset.penColor === color);
    });
    if (penWidthSelect) penWidthSelect.value = widthValue;
  }


  // 初期表示を 100% にしておく
  updateZoomLabelFromWB();

  let currentStampKey = null;


  // ========= パレットの表示 / 非表示 =========
  function showStampPalette() {
    if (!stampPalette) return;
    stampPalette.classList.remove("hidden");
  }
  function hideStampPalette() {
    if (!stampPalette) return;
    stampPalette.classList.add("hidden");
  }

  // ★ ここを修正：図形パレット用の専用クラス shape-palette-hidden を使う
  // ★ 図形パレット表示/非表示（stamp-palette-hidden も一緒に管理する）
  // ★ 図形パレット表示/非表示
  function showShapePalette() {
    if (!shapePalette) return;
    shapePalette.classList.remove("hidden");
  }

  function hideShapePalette() {
    if (!shapePalette) return;
    shapePalette.classList.add("hidden");
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
    const style = info?.kind && editableShapeKinds.has(info.kind)
      ? info
      : (wb.shapeDefaults || {});

    // 線の色
    if (style.stroke) {
      shapeStrokeColorButtons.forEach(b => {
        const c = b.dataset.shapeStrokeColor;
        b.classList.toggle("active", c === style.stroke);
      });
    }

    // 塗りつぶし色
    if (style.fill !== undefined) {
      shapeFillColorButtons.forEach(b => {
        const c = b.dataset.shapeFillColor;
        b.classList.toggle("active", c === style.fill);
      });
    }

    // 線の太さ
    if (shapeStrokeWidthSelect && style.strokeWidth != null) {
      const val = String(style.strokeWidth);
      const hasOption = Array.from(shapeStrokeWidthSelect.options).some(
        opt => opt.value === val
      );
      shapeStrokeWidthSelect.value = hasOption ? val : "3";
    }

    if (shapeDepthRange) {
      let ratio = wb.shapeDefaults?.depthRatio || 0.24;
      if (info?.kind === "cylinder" && typeof info.depth === "number") ratio = info.depth;
      if (["tri-prism", "rect-prism"].includes(info?.kind) && info.width && info.height) {
        ratio = info.depth / Math.min(Math.abs(info.width), Math.abs(info.height));
      }
      shapeDepthRange.value = String(Math.round(Math.max(0.12, Math.min(0.48, ratio)) * 100));
    }
  }

  // ★ テキストスタイルパネルの表示切り替え
  function updateTextStylePanelVisibility(activeTool) {
    if (!textStylePanel) return;

    const showPanel =
      (activeTool === "text" || activeTool === "sticky") &&
      settingsOpenTool === activeTool;
    textStylePanel.classList.toggle("hidden", !showPanel);

    // 付箋カラー行は sticky のときだけ表示
    if (panelStickyColorRow) {
      panelStickyColorRow.classList.toggle("hidden", activeTool !== "sticky");
    }
  }

  // ★ 選択されたテキストオブジェクトからパネルの状態を更新
  function updateTextStylePanelFromSelection() {
    if (!textStylePanel) return;
    const obj = wb.selectedObj;
    if (!obj || !["text", "sticky", "link"].includes(obj.kind)) return;

    // フォントサイズ
    if (textFontSizeSelect && obj.fontSize) {
      textFontSizeSelect.value = String(obj.fontSize);
    }

    // 文字色
    if (textColorInput) {
      if (obj.textColor) {
        textColorInput.value = obj.textColor;
      } else if (obj.stroke && obj.stroke !== "transparent") {
        // フォールバックとして stroke 色
        textColorInput.value = obj.stroke;
      }
    }

    // 太字
    if (textBoldToggle) {
      const isBold = !!obj.bold;
      textBoldToggle.dataset.active = isBold ? "1" : "0";
      textBoldToggle.classList.toggle("active", isBold);
    }

    // フォントファミリー（ざっくり判定）
    if (textFontFamilySelect) {
      const ff = (obj.fontFamily || "").toLowerCase();
      let v = "system";
      if (ff.includes("meiryo") || ff.includes("メイリオ")) {
        v = "meiryo";
      } else if (ff.includes("gothic") || ff.includes("yu gothic") || ff.includes("游ゴシック")) {
        v = "gothic";
      } else if (ff.includes("mincho") || ff.includes("明朝")) {
        v = "mincho";
      }
      textFontFamilySelect.value = v;
    }

    // 揃え
    const align = obj.textAlign || "left";
    if (textAlignLeftBtn && textAlignCenterBtn && textAlignRightBtn) {
      [textAlignLeftBtn, textAlignCenterBtn, textAlignRightBtn].forEach(b => {
        b.classList.remove("active");
      });
      if (align === "left") textAlignLeftBtn.classList.add("active");
      if (align === "center") textAlignCenterBtn.classList.add("active");
      if (align === "right") textAlignRightBtn.classList.add("active");
    }
  }

  function updateTableStylePanelFromSelection() {
    if (!tableStylePanel || typeof wb.getSelectedTableCellStyle !== "function") return;
    const obj = wb.selectedObj;
    const cell = wb.getSelectedTableCellStyle();
    const selection = wb.selectedTableCell || { row: 0, col: 0 };
    const range = wb.getSelectedTableCellRange?.();
    if (tableCellLabel) {
      if (obj?.kind !== "table") {
        tableCellLabel.textContent = "新しい表の設定";
      } else if (range?.count > 1) {
        const rowLabel = range.minRow === range.maxRow
          ? `${range.minRow + 1}行`
          : `${range.minRow + 1}〜${range.maxRow + 1}行`;
        const colLabel = range.minCol === range.maxCol
          ? `${range.minCol + 1}列`
          : `${range.minCol + 1}〜${range.maxCol + 1}列`;
        tableCellLabel.textContent = `${rowLabel}・${colLabel}（${range.count}セル）`;
      } else {
        tableCellLabel.textContent = `${selection.row + 1}行 ${selection.col + 1}列`;
      }
    }
    const fillParts = tableColorParts(cell.fill, "#ffffff");
    currentTableFillHex = fillParts.hex;
    currentTableFillOpacity = fillParts.opacity;
    updateTablePaletteSelection(tableFillPalette, "data-table-fill-color", currentTableFillHex);
    if (tableFillOpacityRange) tableFillOpacityRange.value = String(currentTableFillOpacity);
    if (tableFillOpacityValue) tableFillOpacityValue.textContent = `${currentTableFillOpacity}%`;
    if (tableFontSizeSelect) tableFontSizeSelect.value = String(cell.fontSize || 16);
    currentTableTextHex = tableColorParts(cell.textColor, "#111827").hex;
    updateTablePaletteSelection(tableTextColorPalette, "data-table-text-color", currentTableTextHex);
    if (tableBoldToggle) {
      tableBoldToggle.dataset.active = cell.bold ? "1" : "0";
      tableBoldToggle.classList.toggle("active", !!cell.bold);
    }
    if (tableFontFamilySelect) {
      const family = (cell.fontFamily || "").toLowerCase();
      tableFontFamilySelect.value = family.includes("mincho") || family.includes("明朝")
        ? "mincho"
        : family.includes("meiryo") || family.includes("メイリオ")
          ? "meiryo"
          : family.includes("gothic") || family.includes("游ゴシック")
            ? "gothic"
            : "system";
    }
    const borderSide = tableBorderSideSelect?.value || "all";
    const firstSide = borderSide === "all" ? "top" : borderSide;
    const border = cell.borders?.[firstSide] || {};
    const borderParts = tableColorParts(border.color, "#111827");
    currentTableBorderHex = borderParts.hex;
    currentTableBorderOpacity = borderParts.opacity;
    updateTablePaletteSelection(tableBorderColorPalette, "data-table-border-color", currentTableBorderHex);
    if (tableBorderOpacityRange) tableBorderOpacityRange.value = String(currentTableBorderOpacity);
    if (tableBorderOpacityValue) tableBorderOpacityValue.textContent = `${currentTableBorderOpacity}%`;
    if (tableBorderWidthSelect) tableBorderWidthSelect.value = String(border.width ?? 2);
    if (tableBorderStyleSelect) tableBorderStyleSelect.value = border.style || "solid";
    tableStylePanel.querySelectorAll("[data-table-align]").forEach(button => {
      button.classList.toggle("active", button.dataset.tableAlign === (cell.textAlign || "left"));
    });
  }


  // ========= ツールボタンの UI 更新 =========
  function updateToolButtons(activeTool, options = {}) {
    currentTool = activeTool;
    settingsOpenTool = options.showSettings === true ? activeTool : null;

    toolButtons.forEach(btn => {
      const t = btn.dataset.tool;
      if (!btn.dataset.baseTitle) btn.dataset.baseTitle = btn.title || "ツール";
      btn.classList.toggle("active", t === activeTool);
      btn.classList.toggle("primary", t === activeTool);
      const hasSettings = ["pen", "highlighter", "sticky", "text", "shape", "table"].includes(t);
      const isActive = t === activeTool;
      btn.title = hasSettings && isActive
        ? `${btn.dataset.baseTitle}（もう一度押すと設定）`
        : btn.dataset.baseTitle;
      if (hasSettings) {
        btn.setAttribute("aria-expanded", String(isActive && settingsOpenTool === t));
      }
    });

    function positionContextMenuForTool() {
      const contextMenu = document.getElementById("contextMenu");
      if (!contextMenu || contextMenu.classList.contains("hidden")) return;

      const trigger = Array.from(toolButtons).find(btn =>
        btn.dataset.tool === activeTool && btn.closest("#wbSidebar")
      );
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = contextMenu.getBoundingClientRect();
      const gap = 28;
      const margin = 12;
      const triggerCenterY = triggerRect.top + triggerRect.height / 2;

      let left = triggerRect.right + gap;
      if (left + menuRect.width > window.innerWidth - margin) {
        left = Math.max(margin, triggerRect.left - menuRect.width - gap);
      }

      const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
      const top = Math.min(
        Math.max(margin, triggerCenterY - menuRect.height / 2),
        maxTop
      );
      const arrowTop = Math.min(
        Math.max(18, triggerCenterY - top - 8),
        Math.max(18, menuRect.height - 26)
      );
      const offsetParentRect = contextMenu.offsetParent?.getBoundingClientRect() || {
        left: 0,
        top: 0
      };

      // contextMenu is absolutely positioned inside the sidebar, while the
      // calculations above use viewport coordinates.
      contextMenu.style.left = `${left - offsetParentRect.left}px`;
      contextMenu.style.top = `${top - offsetParentRect.top}px`;
      contextMenu.style.bottom = "auto";
      contextMenu.style.transform = "none";
      contextMenu.style.setProperty("--context-arrow-top", `${arrowTop}px`);
    }

    // スタンプ・図形ツール以外ではパレットを閉じる
    if (activeTool !== "stamp" && stampPalette) {
      hideStampPalette();
    }
    if (activeTool !== "shape" && shapePalette) {
      hideShapePalette();
    }

    // ★ 色選択パレット（Context Menu）の表示切り替え
    const contextMenu = document.getElementById("contextMenu");
    let showMenu = false;

    // ペン設定
    const penSettings = document.getElementById("penSettings");
    if (penSettings) {
      if (activeTool === "pen" || activeTool === "highlighter") {
        if (settingsOpenTool === activeTool) {
          updateDrawSettingsUI(activeTool);
          penSettings.classList.remove("hidden");
          showMenu = true;
        } else {
          penSettings.classList.add("hidden");
        }
      } else {
        penSettings.classList.add("hidden");
      }
    }

    // 付箋設定はテキスト設定と一体化したパネルを使う。
    const stickySettings = document.getElementById("stickySettings");
    if (stickySettings) {
      stickySettings.classList.add("hidden");
    }



    // 図形設定
    const shapeSettings = document.getElementById("shapeSettings");
    if (shapeSettings) {
      if (activeTool === "shape" && settingsOpenTool === "shape") {
        shapeSettings.classList.remove("hidden");
        showMenu = true;
      } else {
        shapeSettings.classList.add("hidden");
      }
    }

    if (tableStylePanel) {
      const showTableSettings = activeTool === "table" && settingsOpenTool === "table";
      tableStylePanel.classList.toggle("hidden", !showTableSettings);
      if (showTableSettings) {
        updateTableStylePanelFromSelection();
        showMenu = true;
      }
    }

    if (contextMenu) {
      if (showMenu) {
        contextMenu.classList.remove("hidden");
        positionContextMenuForTool();
        requestAnimationFrame(positionContextMenuForTool);
      } else {
        contextMenu.classList.add("hidden");
      }
    }
    // ★ テキスト／付箋の設定パネルも同じコンテキストメニュー内に表示
    updateTextStylePanelVisibility(activeTool);
    if (textStylePanel && !textStylePanel.classList.contains("hidden")) {
      showMenu = true;
      if (contextMenu) {
        contextMenu.classList.remove("hidden");
        positionContextMenuForTool();
        requestAnimationFrame(positionContextMenuForTool);
      }
    }
  }

  // Canvas-side tool changes (for example, double-clicking an existing object)
  // must stay in sync with the toolbar and its settings panels.
  wb.onToolChange = tool => {
    updateToolButtons(tool);
  };

  wb.onRequestToolSettings = tool => {
    if (tool !== "table") return;
    wb.setTool("select");
    updateToolButtons("table", { showSettings: true });
  };

  // ★ テキストスタイルパネルのセットアップ
  function setupTextStylePanel() {
    // whiteboard 側のAPIがなければ何もしない
    if (typeof wb.setTextDefaults !== "function" ||
      typeof wb.setSelectedTextStyle !== "function") {
      return;
    }

    const container = document.getElementById("contextMenu");
    if (!container) return;

    textStylePanel = document.createElement("div");
    textStylePanel.id = "textStylePanel";
    textStylePanel.className = "context-section text-style-panel hidden";

    textStylePanel.innerHTML = `
      <div class="text-style-panel-inner">
        <select data-text-font-size style="padding:2px 4px; font-size:12px;">
          <option value="12">12pt</option>
          <option value="14">14pt</option>
          <option value="16" selected>16pt</option>
          <option value="20">20pt</option>
          <option value="24">24pt</option>
          <option value="32">32pt</option>
        </select>

        <input type="color" data-text-color
          style="width:28px;height:28px;border:none;background:transparent;padding:0;" />

        <button type="button" data-text-bold
          style="min-width:28px;height:28px;border-radius:4px;border:1px solid #d1d5db;background:#ffffff;font-weight:bold;">
          B
        </button>

        <select data-text-font-family style="padding:2px 4px; font-size:12px;">
          <option value="system">標準</option>
          <option value="meiryo">メイリオ</option>
          <option value="gothic">ゴシック</option>
          <option value="mincho">明朝</option>
        </select>

        <div data-text-align-group>
          <button type="button" data-text-align="left"
            style="min-width:24px;height:24px;border-radius:4px;border:1px solid #d1d5db;background:#ffffff;">左</button>
          <button type="button" data-text-align="center"
            style="min-width:24px;height:24px;border-radius:4px;border:1px solid #d1d5db;background:#ffffff;">中</button>
          <button type="button" data-text-align="right"
            style="min-width:24px;height:24px;border-radius:4px;border:1px solid #d1d5db;background:#ffffff;">右</button>
        </div>

        <!-- ★ 付箋カラー（テキストバー内） -->
        <div data-text-sticky-colors>
          <button type="button" data-text-sticky-color="#FEF3C7"
            style="width:18px;height:18px;border-radius:9999px;border:2px solid #3b82f6;background:#FEF3C7;"></button>
          <button type="button" data-text-sticky-color="#E0F2FE"
            style="width:18px;height:18px;border-radius:9999px;border:2px solid #e5e7eb;background:#E0F2FE;"></button>
          <button type="button" data-text-sticky-color="#DCFCE7"
            style="width:18px;height:18px;border-radius:9999px;border:2px solid #e5e7eb;background:#DCFCE7;"></button>
          <button type="button" data-text-sticky-color="#FCE7F3"
            style="width:18px;height:18px;border-radius:9999px;border:2px solid #e5e7eb;background:#FCE7F3;"></button>
          <button type="button" data-text-sticky-color="#FDE68A"
            style="width:18px;height:18px;border-radius:9999px;border:2px solid #e5e7eb;background:#FDE68A;"></button>
        </div>
      </div>
    `;




    container.appendChild(textStylePanel);

    const generatedTextColorInput = textStylePanel.querySelector("[data-text-color]");
    if (generatedTextColorInput) {
      generatedTextColorInput.removeAttribute("style");
      generatedTextColorInput.classList.add("text-color-input");
      generatedTextColorInput.title = "文字色";
    }

    const generatedBoldButton = textStylePanel.querySelector("[data-text-bold]");
    if (generatedBoldButton) {
      generatedBoldButton.removeAttribute("style");
      generatedBoldButton.classList.add("ts-icon-button");
      generatedBoldButton.title = "太字";
      generatedBoldButton.innerHTML = '<span class="material-symbols-rounded">format_bold</span>';
    }

    textStylePanel.querySelectorAll("[data-text-align]").forEach(btn => {
      const align = btn.dataset.textAlign || "left";
      const iconName =
        align === "center"
          ? "format_align_center"
          : align === "right"
            ? "format_align_right"
            : "format_align_left";
      btn.removeAttribute("style");
      btn.classList.add("ts-icon-button");
      btn.title =
        align === "center" ? "中央揃え" : align === "right" ? "右揃え" : "左揃え";
      btn.innerHTML = `<span class="material-symbols-rounded">${iconName}</span>`;
    });

    textStylePanel.querySelectorAll("[data-text-sticky-color]").forEach(btn => {
      const color = btn.dataset.textStickyColor;
      btn.removeAttribute("style");
      btn.classList.add("color-dot");
      if (color) btn.style.setProperty("--c", color);
    });

    replaceMaterialIcons(textStylePanel);

    // 要素の参照を取る
    textFontSizeSelect = textStylePanel.querySelector("[data-text-font-size]");
    textColorInput = textStylePanel.querySelector("[data-text-color]");
    textBoldToggle = textStylePanel.querySelector("[data-text-bold]");
    textFontFamilySelect = textStylePanel.querySelector("[data-text-font-family]");
    const alignButtons = textStylePanel.querySelectorAll("[data-text-align]");
    textAlignLeftBtn = textStylePanel.querySelector('[data-text-align="left"]');
    textAlignCenterBtn = textStylePanel.querySelector('[data-text-align="center"]');
    textAlignRightBtn = textStylePanel.querySelector('[data-text-align="right"]');

    // ★ パネル内の付箋カラー行
    panelStickyColorRow = textStylePanel.querySelector("[data-text-sticky-colors]");
    const panelStickyColorDots =
      textStylePanel.querySelectorAll("[data-text-sticky-color]");

    // デフォルト値を whiteboard 側から反映
    const d = wb.textDefaults || {};
    if (textFontSizeSelect && d.fontSize) {
      textFontSizeSelect.value = String(d.fontSize);
    }
    if (textColorInput && d.color) {
      textColorInput.value = d.color;
    }

    // ===== イベントハンドラ =====

    // フォントサイズ
    if (textFontSizeSelect) {
      textFontSizeSelect.addEventListener("change", () => {
        const size = parseInt(textFontSizeSelect.value, 10) || 16;
        wb.setTextDefaults({ fontSize: size });
        wb.setSelectedTextStyle({ fontSize: size });
      });
    }

    // 文字色
    if (textColorInput) {
      textColorInput.addEventListener("input", () => {
        const color = textColorInput.value;
        wb.setTextDefaults({ color });
        wb.setSelectedTextStyle({ color });
      });
    }

    // 太字
    if (textBoldToggle) {
      textBoldToggle.addEventListener("click", () => {
        const isActive = textBoldToggle.dataset.active === "1";
        const next = !isActive;
        textBoldToggle.dataset.active = next ? "1" : "0";
        textBoldToggle.classList.toggle("active", next);
        wb.setTextDefaults({ bold: next });
        wb.setSelectedTextStyle({ bold: next });
      });
    }

    // フォントファミリー
    if (textFontFamilySelect) {
      textFontFamilySelect.addEventListener("change", () => {
        const v = textFontFamilySelect.value;
        let ff = "";
        if (v === "meiryo") {
          ff = 'Meiryo, "メイリオ", sans-serif';
        } else if (v === "gothic") {
          ff = '"Yu Gothic Medium", "游ゴシック体", sans-serif';
        } else if (v === "mincho") {
          ff = '"MS Mincho", "ＭＳ 明朝", serif';
        } else {
          ff = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        }
        wb.setTextDefaults({ fontFamily: ff });
        wb.setSelectedTextStyle({ fontFamily: ff });
      });
    }

    // 揃え
    if (alignButtons && alignButtons.length > 0) {
      alignButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          const align = btn.dataset.textAlign || "left";

          alignButtons.forEach(b => b.classList.remove("active"));
          btn.classList.add("active");

          wb.setTextDefaults({ align });
          wb.setSelectedTextStyle({ align });
        });
      });
    }

    // 付箋カラー（パネル内）
    if (panelStickyColorDots.length > 0 &&
      typeof wb.setSelectedStickyColor === "function") {
      panelStickyColorDots.forEach(btn => {
        btn.addEventListener("click", () => {
          const color = btn.dataset.textStickyColor;
          if (!color) return;

          wb.setSelectedStickyColor(color);

          panelStickyColorDots.forEach(b =>
            b.classList.toggle("active", b === btn)
          );
        });
      });
    }
  }

  function setupTableStylePanel() {
    if (typeof wb.setSelectedTableCellStyle !== "function") return;
    const container = document.getElementById("contextMenu");
    if (!container) return;
    tableStylePanel = document.createElement("div");
    tableStylePanel.id = "tableStylePanel";
    tableStylePanel.className = "context-section table-style-panel hidden";
    tableStylePanel.innerHTML = `
      <div class="tool-settings-heading table-settings-heading">
        <span class="table-settings-icon"><span class="material-symbols-rounded">table_chart</span></span>
        <span class="table-settings-title"><strong>表のスタイル</strong><span data-table-cell-label>新しい表の設定</span></span>
      </div>
      <div class="table-settings-grid">
        <section class="table-settings-card">
          <div class="table-section-heading"><span>セル</span><small>背景と文字</small></div>
          <div class="table-setting-block">
            <span class="table-setting-label">背景色</span>
            <div class="color-palette table-color-palette" data-table-fill-palette>
              ${tablePaletteMarkup("data-table-fill-color", TABLE_FILL_COLORS)}
            </div>
          </div>
          <label class="table-opacity-row">
            <span>透明度</span><input type="range" min="0" max="100" value="100" data-table-fill-opacity />
            <output data-table-fill-opacity-value>100%</output>
          </label>
          <div class="table-two-column">
            <label><span>文字サイズ</span><select data-table-font-size>
              <option value="12">12pt</option><option value="14">14pt</option>
              <option value="16" selected>16pt</option><option value="20">20pt</option>
              <option value="24">24pt</option><option value="32">32pt</option>
            </select></label>
            <label><span>書体</span><select data-table-font-family>
              <option value="system">標準</option><option value="meiryo">メイリオ</option>
              <option value="gothic">ゴシック</option><option value="mincho">明朝</option>
            </select></label>
          </div>
          <div class="table-setting-block">
            <span class="table-setting-label">文字色</span>
            <div class="color-palette table-color-palette" data-table-text-palette>
              ${tablePaletteMarkup("data-table-text-color", TABLE_INK_COLORS)}
            </div>
          </div>
          <div class="table-inline-controls" aria-label="文字の装飾と配置">
            <button type="button" class="table-icon-btn" data-table-bold title="太字"><span class="material-symbols-rounded">format_bold</span></button>
            <button type="button" class="table-icon-btn active" data-table-align="left" title="左揃え"><span class="material-symbols-rounded">format_align_left</span></button>
            <button type="button" class="table-icon-btn" data-table-align="center" title="中央揃え"><span class="material-symbols-rounded">format_align_center</span></button>
            <button type="button" class="table-icon-btn" data-table-align="right" title="右揃え"><span class="material-symbols-rounded">format_align_right</span></button>
          </div>
        </section>
        <section class="table-settings-card">
          <div class="table-section-heading"><span>罫線</span><small>色と線種</small></div>
          <label class="table-full-row"><span>変更する罫線</span><select data-table-border-side>
            <option value="all">4辺すべて</option><option value="top">上</option>
            <option value="right">右</option><option value="bottom">下</option><option value="left">左</option>
          </select></label>
          <div class="table-setting-block">
            <span class="table-setting-label">罫線の色</span>
            <div class="color-palette table-color-palette" data-table-border-palette>
              ${tablePaletteMarkup("data-table-border-color", TABLE_INK_COLORS)}
            </div>
          </div>
          <label class="table-opacity-row">
            <span>透明度</span><input type="range" min="0" max="100" value="100" data-table-border-opacity />
            <output data-table-border-opacity-value>100%</output>
          </label>
          <div class="table-two-column">
            <label><span>太さ</span><select data-table-border-width>
              <option value="0">なし</option><option value="1">細</option>
              <option value="2" selected>標準</option><option value="3">太</option><option value="5">極太</option>
            </select></label>
            <label><span>線種</span><select data-table-border-style>
              <option value="solid">実線</option><option value="dashed">破線</option>
              <option value="dotted">点線</option><option value="double">二重線</option><option value="none">なし</option>
            </select></label>
          </div>
        </section>
      </div>`;
    container.appendChild(tableStylePanel);
    replaceMaterialIcons(tableStylePanel);

    tableCellLabel = tableStylePanel.querySelector("[data-table-cell-label]");
    tableFillPalette = tableStylePanel.querySelector("[data-table-fill-palette]");
    tableFillOpacityRange = tableStylePanel.querySelector("[data-table-fill-opacity]");
    tableFillOpacityValue = tableStylePanel.querySelector("[data-table-fill-opacity-value]");
    tableFontSizeSelect = tableStylePanel.querySelector("[data-table-font-size]");
    tableTextColorPalette = tableStylePanel.querySelector("[data-table-text-palette]");
    tableBoldToggle = tableStylePanel.querySelector("[data-table-bold]");
    tableFontFamilySelect = tableStylePanel.querySelector("[data-table-font-family]");
    tableBorderSideSelect = tableStylePanel.querySelector("[data-table-border-side]");
    tableBorderColorPalette = tableStylePanel.querySelector("[data-table-border-palette]");
    tableBorderOpacityRange = tableStylePanel.querySelector("[data-table-border-opacity]");
    tableBorderOpacityValue = tableStylePanel.querySelector("[data-table-border-opacity-value]");
    tableBorderWidthSelect = tableStylePanel.querySelector("[data-table-border-width]");
    tableBorderStyleSelect = tableStylePanel.querySelector("[data-table-border-style]");

    const fontFamilyValue = value => {
      if (value === "meiryo") return 'Meiryo, "メイリオ", sans-serif';
      if (value === "gothic") return '"Yu Gothic Medium", "游ゴシック体", sans-serif';
      if (value === "mincho") return '"MS Mincho", "ＭＳ 明朝", serif';
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    };
    const applyBorder = patch => wb.setSelectedTableCellStyle({
      borderSide: tableBorderSideSelect?.value || "all",
      ...patch
    });
    tableFillPalette?.querySelectorAll("[data-table-fill-color]").forEach(button => {
      button.addEventListener("click", () => {
        currentTableFillHex = button.dataset.tableFillColor || "#ffffff";
        wb.setSelectedTableCellStyle({
          fill: tableColorWithOpacity(currentTableFillHex, currentTableFillOpacity)
        });
      });
    });
    tableFillOpacityRange?.addEventListener("input", () => {
      currentTableFillOpacity = Number(tableFillOpacityRange.value);
      if (tableFillOpacityValue) tableFillOpacityValue.textContent = `${currentTableFillOpacity}%`;
      wb.setSelectedTableCellStyle({
        fill: tableColorWithOpacity(currentTableFillHex, currentTableFillOpacity)
      });
    });
    tableFontSizeSelect?.addEventListener("change", () => wb.setSelectedTableCellStyle({ fontSize: Number(tableFontSizeSelect.value) || 16 }));
    tableTextColorPalette?.querySelectorAll("[data-table-text-color]").forEach(button => {
      button.addEventListener("click", () => {
        currentTableTextHex = button.dataset.tableTextColor || "#111827";
        wb.setSelectedTableCellStyle({ color: currentTableTextHex });
      });
    });
    tableFontFamilySelect?.addEventListener("change", () => wb.setSelectedTableCellStyle({ fontFamily: fontFamilyValue(tableFontFamilySelect.value) }));
    tableBoldToggle?.addEventListener("click", () => {
      const next = tableBoldToggle.dataset.active !== "1";
      wb.setSelectedTableCellStyle({ bold: next });
    });
    tableStylePanel.querySelectorAll("[data-table-align]").forEach(button => {
      button.addEventListener("click", () => wb.setSelectedTableCellStyle({ align: button.dataset.tableAlign || "left" }));
    });
    tableBorderSideSelect?.addEventListener("change", updateTableStylePanelFromSelection);
    tableBorderColorPalette?.querySelectorAll("[data-table-border-color]").forEach(button => {
      button.addEventListener("click", () => {
        currentTableBorderHex = button.dataset.tableBorderColor || "#111827";
        applyBorder({
          borderColor: tableColorWithOpacity(currentTableBorderHex, currentTableBorderOpacity)
        });
      });
    });
    tableBorderOpacityRange?.addEventListener("input", () => {
      currentTableBorderOpacity = Number(tableBorderOpacityRange.value);
      if (tableBorderOpacityValue) tableBorderOpacityValue.textContent = `${currentTableBorderOpacity}%`;
      applyBorder({
        borderColor: tableColorWithOpacity(currentTableBorderHex, currentTableBorderOpacity)
      });
    });
    tableBorderWidthSelect?.addEventListener("change", () => applyBorder({ borderWidth: Number(tableBorderWidthSelect.value) || 0 }));
    tableBorderStyleSelect?.addEventListener("change", () => applyBorder({ borderStyle: tableBorderStyleSelect.value }));
    updateTableStylePanelFromSelection();
  }


  // ========= Whiteboard 側からの選択変更通知 =========
  wb.onSelectionChange = info => {
    updateSelectionButtonsUI();
    updateShapeStyleUI(info);
    // ★ テキスト選択に応じてパネル状態を更新
    updateTextStylePanelFromSelection();
    updateTableStylePanelFromSelection();
  };


  // 初期状態も反映
  updateSelectionButtonsUI();

  // ★ 追加: クリック透過を確実にする（パネル生成後のイベントブロック対策）
  function whiteboardEnableCanvasClicks() {
    const panel = document.getElementById("textSettings");
    if (panel) panel.style.pointerEvents = "none";
  }


  // ========= ツールボタン共通処理 =========
  toolButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      if (!tool) return;

      // 表のセル選択中は、1回で一括書式メニューを開く。
      if (tool === "table" && wb.selectedObj?.kind === "table" && currentTool !== "table") {
        wb.setTool("select");
        updateToolButtons("table", { showSettings: true });
        return;
      }

      // 設定を持つツールは、1回目で選択、同じボタンの2回目で設定を開く。
      if (tool !== "stamp") {
        const hasSettings = ["pen", "highlighter", "sticky", "text", "shape", "table"].includes(tool);
        const showSettings =
          hasSettings && currentTool === tool && settingsOpenTool !== tool;

        // 表設定中は、キャンバス操作を選択ツールとして扱う。
        wb.setTool(tool === "table" && showSettings ? "select" : tool);
        if (tool === "pen") {
          wb.setPen(currentPenColor, currentPenWidth);
        } else if (tool === "highlighter") {
          wb.setHighlighterColor?.(currentHighlighterColor);
          wb.setHighlighterWidth?.(currentHighlighterWidth);
        }
        updateToolButtons(tool, { showSettings });
        return;
      }

      // スタンプツール
      if (tool === "stamp") {
        wb.setTool("stamp");
        updateToolButtons("stamp");
        showStampPalette();
        return;
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

    const stampEntries = Object.entries(wb.stampPresets);
    const orderedStampEntries = [
      ...stampEntries.filter(([, preset]) => !!preset.imageSrc),
      ...stampEntries.filter(([, preset]) => !preset.imageSrc),
    ];

    orderedStampEntries.forEach(([key, preset]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "stamp-item";
      item.dataset.stampKey = key;
      item.title = preset.label || key;
      item.setAttribute("aria-label", preset.label || key);
      item.appendChild(createStampElement(key));

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

  function createShapePreview(key) {
    const paths = {
      line: '<path d="M4 20 20 4"/>',
      arrow: '<path d="M4 12h15M14 7l5 5-5 5"/>',
      "double-arrow": '<path d="M5 12h14M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
      triangle: '<path d="M12 4 21 20H3Z"/>',
      rect: '<rect x="3" y="5" width="18" height="14"/>',
      "rounded-rect": '<rect x="3" y="5" width="18" height="14" rx="4"/>',
      ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
      diamond: '<path d="m12 3 9 9-9 9-9-9Z"/>',
      parallelogram: '<path d="M7 5h14l-4 14H3Z"/>',
      trapezoid: '<path d="M7 5h10l4 14H3Z"/>',
      pentagon: '<path d="m12 3 9 7-3.5 11h-11L3 10Z"/>',
      hexagon: '<path d="m7 3 10 0 5 9-5 9H7l-5-9Z"/>',
      star: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
      "tri-prism": '<path d="m7 7 7-3 6 9-7 4-6-10Zm0 0-3 8 9 2m7-4-3 7-4-3"/>',
      "rect-prism": '<path d="m7 7 10-3 4 4-10 4Zm0 0v10l4 3V12m10-4v10l-10 2"/>',
      cylinder: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 18c0-1.7 3.6-3 8-3s8 1.3 8 3"/>'
    };
    return `<svg class="shape-preview" viewBox="0 0 24 24" aria-hidden="true">${paths[key] || paths.rect}</svg>`;
  }

  // ========= 図形パレットの生成＆選択 =========
  if (shapeSettingsPanel) {
    const host = shapeSettingsPanel;
    let itemsContainer = host.querySelector(".shape-items");
    if (!itemsContainer) {
      itemsContainer = document.createElement("div");
      itemsContainer.className = "shape-items";
      host.prepend(itemsContainer);
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
      { key: "rounded-rect", label: "角丸四角" },
      { key: "circle", label: "円" },
      { key: "diamond", label: "ひし形" },
      { key: "parallelogram", label: "平行四辺形" },
      { key: "trapezoid", label: "台形" },
      { key: "pentagon", label: "五角形" },
      { key: "hexagon", label: "六角形" },
      { key: "star", label: "星" },
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

      const shapeKeyForWB = key === "circle" ? "ellipse" : key;
      item.classList.toggle("active", shapeKeyForWB === currentShapeKey);
      item.innerHTML = `${createShapePreview(shapeKeyForWB)}<span class="shape-label">${shape.label || key}</span>`;

      item.addEventListener("click", () => {
        if (typeof wb.setShapeType === "function") {
          // ★ Whiteboard 側が "ellipse" を期待しているので、circle だけ変換する
          currentShapeKey = shapeKeyForWB;
          wb.setShapeType(shapeKeyForWB);
          wb.setTool("shape");
          itemsContainer.querySelectorAll(".shape-item").forEach(button => {
            const selectedKey = button.dataset.shapeKey === "circle" ? "ellipse" : button.dataset.shapeKey;
            button.classList.toggle("active", selectedKey === currentShapeKey);
          });
          updateToolButtons("shape", { showSettings: true });
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
      });


      itemsContainer.appendChild(item);
    });

  }

  // ========= 初期ツール / ペン設定 =========
  updateToolButtons("pen");
  wb.setTool("pen");

  wb.setPen(currentPenColor, currentPenWidth);
  // ★ テキストスタイルパネルを初期化
  setupTextStylePanel();
  setupTableStylePanel();

  wb.setHighlighterColor?.(currentHighlighterColor);
  wb.setHighlighterWidth?.(currentHighlighterWidth);

  // ========= ペン色パレット =========
  if (penColorButtons.length > 0) {
    penColorButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.penColor;
        if (!color) return;
        if (settingsOpenTool === "highlighter") {
          currentHighlighterColor = color;
          wb.setHighlighterColor?.(currentHighlighterColor);
        } else {
          currentPenColor = color;
          wb.setPen(currentPenColor, currentPenWidth);
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
      if (settingsOpenTool === "highlighter") {
        currentHighlighterWidth = highlighterWidthPresets[width] || 30;
        wb.setHighlighterWidth?.(currentHighlighterWidth);
      } else {
        currentPenWidth = width;
        wb.setPen(currentPenColor, currentPenWidth);
      }
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

  // ========= 図形：塗りつぶし色 =========
  if (
    shapeStrokeColorButtons.length > 0 &&
    typeof wb.setSelectedStrokeColor === "function"
  ) {
    shapeStrokeColorButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.shapeStrokeColor;
        if (!color) return;
        wb.setSelectedStrokeColor(color);
        shapeStrokeColorButtons.forEach(b =>
          b.classList.toggle("active", b === btn)
        );
      });
    });
  }

  // ========= 図形：塗りつぶし色 =========
  if (
    shapeFillColorButtons.length > 0 &&
    typeof wb.setSelectedShapeFill === "function"
  ) {
    shapeFillColorButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.shapeFillColor;
        if (color == null) return;

        // "transparent" もそのまま渡す（塗りなし）
        wb.setSelectedShapeFill(color);

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

  function choosePdfImportMode(pageCount) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "pdf-import-dialog-overlay";
      overlay.setAttribute("role", "presentation");

      const dialog = document.createElement("section");
      dialog.className = "pdf-import-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "pdfImportDialogTitle");

      const title = document.createElement("h2");
      title.id = "pdfImportDialogTitle";
      title.textContent = "PDFの読み込み方法";
      const description = document.createElement("p");
      description.textContent = `${pageCount}ページのPDFです。貼り付け方を選んでください。`;
      const choices = document.createElement("div");
      choices.className = "pdf-import-dialog-choices";

      const stackButton = document.createElement("button");
      stackButton.type = "button";
      stackButton.className = "pdf-import-choice";
      stackButton.innerHTML = "<strong>1枚のホワイトボードに並べる</strong><span>すべてのPDFページを縦に並べて貼り付けます。</span>";
      const separateButton = document.createElement("button");
      separateButton.type = "button";
      separateButton.className = "pdf-import-choice";
      separateButton.innerHTML = "<strong>ホワイトボードのページに分ける</strong><span>PDF 1ページごとに、ホワイトボードのページを1枚ずつ作成します。</span>";
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "pdf-import-cancel";
      cancelButton.textContent = "キャンセル";

      choices.append(stackButton, separateButton);
      dialog.append(title, description, choices, cancelButton);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const close = result => {
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
        resolve(result);
      };
      const onKeydown = event => {
        if (event.key === "Escape") close(null);
      };

      stackButton.addEventListener("click", () => close("stack"));
      separateButton.addEventListener("click", () => close("separate"));
      cancelButton.addEventListener("click", () => close(null));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) close(null);
      });
      document.addEventListener("keydown", onKeydown);
      stackButton.focus();
    });
  }

  // ========= 図形：奥行き =========
  if (shapeDepthRange && typeof wb.setSelectedShapeDepth === "function") {
    shapeDepthRange.addEventListener("input", () => {
      wb.setSelectedShapeDepth((parseInt(shapeDepthRange.value, 10) || 24) / 100);
    });
  }

  // ========= PDF 読み込み =========
  if (pdfInput) {
    pdfInput.addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await wb.loadPdfFile(file, { onMultiplePages: choosePdfImportMode });
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

  // ========= ズーム（10%刻み + Whiteboard 実倍率同期） =========
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
      const current =
        wb.scale ??
        wb.viewScale ??
        wb.zoomScale ??
        1;

      // 現在の倍率を 10% 単位に丸めて +10%
      const next = Math.min(
        Math.round(current * 10) / 10 + 0.1,
        4 // 最大 400%
      );

      const ratio = next / current;
      wb.zoomAtCanvasCenter(ratio);

      // 表示更新
      updateZoomLabelFromWB();
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      const current =
        wb.scale ??
        wb.viewScale ??
        wb.zoomScale ??
        1;

      // 現在の倍率を 10% 単位に丸めて -10%
      const next = Math.max(
        Math.round(current * 10) / 10 - 0.1,
        0.2 // 最小 20%
      );

      const ratio = next / current;
      wb.zoomAtCanvasCenter(ratio);

      // 表示更新
      updateZoomLabelFromWB();
    });
  }


  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
      wb.zoomAtCanvasCenter(0.9);

      // UI側のズーム倍率も更新
      currentZoomScale *= 0.9;
      if (currentZoomScale < 0.25) currentZoomScale = 0.25; // 下限はお好みで
      updateZoomLabelFromWB();
    });
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

    if (e.shiftKey && typeof wb.extendSelectedTableCellSelection === "function") {
      const direction = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right"
      }[e.key];
      if (direction && wb.extendSelectedTableCellSelection(direction)) {
        e.preventDefault();
        return;
      }
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

  // ========= PDF 出力（編集範囲のみ） =========
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", () => {
      void exportBoardToPdf();
    });
  }

  if (exportPngBtn) {
    exportPngBtn.addEventListener("click", async () => {
      const allPages = window.confirm("全ページをPNG出力しますか？\nキャンセルを選ぶと現在のページだけを出力します。");
      const pages = await wb.capturePageCanvases(allPages);
      const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
      pages.forEach((page, index) => {
        const link = document.createElement("a");
        link.href = page.canvas.toDataURL("image/png");
        link.download = `whiteboard-${stamp}-${String(index + 1).padStart(2, "0")}-${page.name}.png`;
        link.click();
      });
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

  function cropCanvasForExport(source) {
    const bounds = detectContentBoundsFromCanvas(source);
    if (!bounds) return null;
    const off = document.createElement("canvas");
    off.width = bounds.width;
    off.height = bounds.height;
    const ctx = off.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, off.width, off.height);
    return off;
  }

  function saveCanvasesAsPdf(canvases) {
    const jspdf = window.jspdf;
    if (!jspdf || !jspdf.jsPDF) {
      alert("PDF出力ライブラリ(jsPDF)が読み込まれていません。");
      return;
    }
    const { jsPDF } = jspdf;
    const firstLandscape = canvases[0].width >= canvases[0].height;
    const pdf = new jsPDF({ orientation: firstLandscape ? "l" : "p", unit: "mm", format: "a4" });
    canvases.forEach((page, index) => {
      const landscape = page.width >= page.height;
      if (index > 0) pdf.addPage("a4", landscape ? "l" : "p");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const scale = Math.min((pageWidth - margin * 2) / page.width, (pageHeight - margin * 2) / page.height);
      const width = page.width * scale;
      const height = page.height * scale;
      pdf.addImage(page.toDataURL("image/png"), "PNG", (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
    });
    pdf.save(`whiteboard-${new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-")}.pdf`);
  }

  async function exportBoardToPdf() {
    const allPages = window.confirm("全ページをPDF出力しますか？\nキャンセルを選ぶと現在のページだけを出力します。");
    const pages = await wb.capturePageCanvases(allPages);
    const cropped = pages.map(page => cropCanvasForExport(page.canvas)).filter(Boolean);
    if (!cropped.length) {
      alert("出力する内容がありません。");
      return;
    }
    if (cropped.length === 1) {
      saveCanvasAsPdf(cropped[0]);
      return;
    }
    saveCanvasesAsPdf(cropped);
  }

  // ========= サイドバー折りたたみ =========
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("wbSidebar");
  const contextMenu = document.getElementById("contextMenu");

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
      document.body.classList.toggle("sidebar-collapsed");

      // サイドバーが閉じたときにコンテキストメニューも隠す
      if (sidebar.classList.contains("collapsed") && contextMenu) {
        penSettingsOpenTool = null;
        contextMenu.classList.add("hidden");
      }
    });
  }

  // ========= ファイルメニュー =========
  const fileMenuBtn = document.getElementById("fileMenuBtn");
  const fileMenuDropdown = document.getElementById("fileMenuDropdown");

  if (fileMenuBtn && fileMenuDropdown) {
    // ★ 追加：起動時に必ず閉じた状態にしておく
    fileMenuDropdown.classList.add("hidden");

    fileMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      fileMenuDropdown.classList.toggle("hidden");
    });

    // メニュー外をクリックしたら閉じる
    document.addEventListener("click", (e) => {
      if (
        !fileMenuBtn.contains(e.target) &&
        !fileMenuDropdown.contains(e.target)
      ) {
        fileMenuDropdown.classList.add("hidden");
      }
    });
  }


  // ========= キャンバスリサイズの初期化 =========
  resizeCanvasToContainer();
  window.addEventListener("resize", resizeCanvasToContainer);

  return wb;
}

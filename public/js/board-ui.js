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

  // ==== ここから追加 ====
  const zoomLevelEl = document.getElementById("zoomLevel");

  function updateZoomLabelFromWB() {
    if (!zoomLevelEl || !wb) return;
    const current = wb.scale || 1;
    const pct = Math.round(current * 100);
    zoomLevelEl.textContent = pct + "%";
  }

  // Whiteboard 側からも呼べるように
  wb.onZoomChange = () => {
    updateZoomLabelFromWB();
  };

  // 初期表示
  updateZoomLabelFromWB();
  // ==== ここまで追加 ====

  canvas.whiteboardInstance = wb;


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
  const zoomLevelLabel = document.getElementById("zoomLevel");

  // ✅ Whiteboardの実スケールからズーム表示を更新
  function updateZoomLabelFromWB() {
    if (!zoomLevelEl || !wb) return;

    const scale = wb.scale ?? 1;
    const percent = Math.round(scale * 100);
    zoomLevelEl.textContent = percent + "%";
  }


  // 初期表示を反映
  updateZoomLabelFromWB();



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

  // 現在のペン設定
  let currentPenColor = "#111827";
  let currentPenWidth = 3;


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

  // ★ テキストスタイルパネルの表示切り替え
  function updateTextStylePanelVisibility(activeTool) {
    if (!textStylePanel) return;

    // text / sticky ツールのときだけバーを表示
    const showPanel = activeTool === "text" || activeTool === "sticky";
    textStylePanel.style.display = showPanel ? "flex" : "none";

    // 付箋カラー行は sticky のときだけ表示
    if (panelStickyColorRow) {
      panelStickyColorRow.style.display =
        activeTool === "sticky" ? "inline-flex" : "none";
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

    // ★ 色選択パレット（Context Menu）の表示切り替え
    const contextMenu = document.getElementById("contextMenu");
    let showMenu = false;

    // ペン設定
    const penSettings = document.getElementById("penSettings");
    if (penSettings) {
      if (activeTool === "pen" || activeTool === "highlighter") {
        penSettings.classList.remove("hidden");
        showMenu = true;
      } else {
        penSettings.classList.add("hidden");
      }
    }

    // 付箋設定（サイドのパレットは使わないので常に隠す）
    const stickySettings = document.getElementById("stickySettings");
    if (stickySettings) {
      stickySettings.classList.add("hidden");
    }



    // 図形設定
    const shapeSettings = document.getElementById("shapeSettings");
    if (shapeSettings) {
      if (activeTool === "shape" || activeTool === "rect" || activeTool === "circle" || activeTool === "triangle" || activeTool === "line" || activeTool === "arrow") {
        shapeSettings.classList.remove("hidden");
        showMenu = true;
      } else {
        shapeSettings.classList.add("hidden");
      }
    }

    if (contextMenu) {
      if (showMenu) {
        contextMenu.classList.remove("hidden");
      } else {
        contextMenu.classList.add("hidden");
      }
    }
    // ★ テキストスタイルパネルの表示切り替え
    updateTextStylePanelVisibility(activeTool);
  }

  // ★ テキストスタイルパネルのセットアップ
  function setupTextStylePanel() {
    // whiteboard 側のAPIがなければ何もしない
    if (typeof wb.setTextDefaults !== "function" ||
      typeof wb.setSelectedTextStyle !== "function") {
      return;
    }

    const container = canvas.parentElement || document.body;
    container.style.position = container.style.position || "relative";

    textStylePanel = document.createElement("div");
    textStylePanel.id = "textStylePanel";

    Object.assign(textStylePanel.style, {
      position: "absolute",
      left: "50%",
      bottom: "12px",
      transform: "translateX(-50%)",
      padding: "6px 10px",
      borderRadius: "9999px",
      background: "rgba(255,255,255,0.96)",
      boxShadow: "0 6px 16px rgba(15,23,42,0.25)",
      border: "1px solid #e5e7eb",
      display: "none", // 初期は非表示
      zIndex: 40,
      fontSize: "12px",
      displayFlex: "flex"
    });

    textStylePanel.innerHTML = `
      <div style="display:inline-flex;align-items:center;gap:6px;">
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

        <div data-text-align-group style="display:inline-flex;gap:2px;margin-left:4px;">
          <button type="button" data-text-align="left"
            style="min-width:24px;height:24px;border-radius:4px;border:1px solid #d1d5db;background:#ffffff;">左</button>
          <button type="button" data-text-align="center"
            style="min-width:24px;height:24px;border-radius:4px;border:1px solid #d1d5db;background:#ffffff;">中</button>
          <button type="button" data-text-align="right"
            style="min-width:24px;height:24px;border-radius:4px;border:1px solid #d1d5db;background:#ffffff;">右</button>
        </div>

        <!-- ★ 付箋カラー（テキストバー内） -->
        <div data-text-sticky-colors
             style="display:inline-flex;gap:6px;margin-left:8px;">
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


  // ========= Whiteboard 側からの選択変更通知 =========
  wb.onSelectionChange = info => {
    updateSelectionButtonsUI();
    updateShapeStyleUI(info);
    // ★ テキスト選択に応じてパネル状態を更新
    updateTextStylePanelFromSelection();
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

      // shape / stamp 以外はそのままツールにセット
      if (tool !== "shape" && tool !== "stamp") {
        wb.setTool(tool);
        updateToolButtons(tool);

        // ★ 蛍光ペンは毎回黄色を初期色にしておく
        if (tool === "highlighter" && typeof wb.setHighlighterColor === "function") {
          wb.setHighlighterColor("#facc15");
        }
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
  // ★ テキストスタイルパネルを初期化
  setupTextStylePanel();

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

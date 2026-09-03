import { formApi } from "./form-api.js?v=forms-20260830&form-history=20260831&form-images=20260901&history-delete=20260904";
import { replaceMaterialIcons } from "./ui-icons.js?v=forms-20260830b";
import {
  buildResponseTableModel,
  exportFormQuestionsXlsx,
  exportFormResponsesXlsx,
  parseFormQuestionsWorkbook,
} from "./form-excel.js?v=form-excel-20260831";

const QUESTION_LABELS = {
  text: "自由記述",
  single_choice: "単一選択",
  multiple_choice: "複数選択",
};

const MAX_FORM_IMAGE_BYTES = 8 * 1024 * 1024;
const FORM_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function localId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function escapeText(value) {
  return String(value ?? "");
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function newQuestion(questionType = "text") {
  const isChoice = questionType !== "text";
  return {
    localId: localId("question"),
    questionType,
    prompt: "",
    required: true,
    imagePath: "",
    imageMimeType: "",
    imageWidth: 0,
    imageHeight: 0,
    imageFile: null,
    imagePreviewUrl: "",
    imagePreviewOwned: false,
    options: isChoice
      ? [
          { id: localId("option"), label: "選択肢1" },
          { id: localId("option"), label: "選択肢2" },
        ]
      : [],
  };
}

function normalizeEditorQuestion(question) {
  const questionType = question.questionType || question.question_type || "text";
  return {
    localId: localId("question"),
    questionType,
    prompt: question.prompt || "",
    required: question.required !== false,
    imagePath: question.imagePath || question.image_path || "",
    imageMimeType: question.imageMimeType || question.image_mime_type || "",
    imageWidth: Number(question.imageWidth || question.image_width) || 0,
    imageHeight: Number(question.imageHeight || question.image_height) || 0,
    imageFile: null,
    imagePreviewUrl: "",
    imagePreviewOwned: false,
    options: questionType === "text"
      ? []
      : (question.options || []).map((option) => ({
          id: String(option.id || localId("option")),
          label: String(option.label || ""),
        })),
  };
}

function releaseOwnedQuestionPreview(question) {
  if (question?.imagePreviewOwned && question.imagePreviewUrl) {
    URL.revokeObjectURL(question.imagePreviewUrl);
  }
  if (question) {
    question.imagePreviewUrl = "";
    question.imagePreviewOwned = false;
  }
}

function inspectQuestionImage(file) {
  return new Promise((resolve, reject) => {
    const mimeType = String(file?.type || "").toLowerCase();
    if (!file || !FORM_IMAGE_TYPES.has(mimeType)) {
      reject(new Error("画像はJPEG・PNG・WebP・GIF形式を選択してください。"));
      return;
    }
    if (!file.size || file.size > MAX_FORM_IMAGE_BYTES) {
      reject(new Error("画像は8MB以下にしてください。"));
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const width = Number(image.naturalWidth) || 0;
      const height = Number(image.naturalHeight) || 0;
      if (width < 1 || height < 1 || width > 12000 || height > 12000) {
        URL.revokeObjectURL(previewUrl);
        reject(new Error("画像の縦横は1〜12000pxの範囲にしてください。"));
        return;
      }
      resolve({ file, previewUrl, mimeType, width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error("画像を読み込めませんでした。別の画像を選択してください。"));
    };
    image.src = previewUrl;
  });
}

function createEmptyMessage(message) {
  const empty = document.createElement("div");
  empty.className = "form-empty-state";
  const icon = document.createElement("span");
  icon.className = "material-symbols-rounded";
  icon.textContent = "inbox";
  const text = document.createElement("p");
  text.textContent = message;
  empty.append(icon, text);
  return empty;
}

export function initTeacherForms({ socket, getClassCode, onOpen } = {}) {
  const toggleBtn = document.getElementById("formToggleBtn");
  const liveDot = document.getElementById("formLiveDot");
  const panel = document.getElementById("formPanel");
  const closeBtn = document.getElementById("formCloseBtn");
  const statusEl = document.getElementById("formPanelStatus");
  const tabButtons = Array.from(document.querySelectorAll("[data-form-tab]"));
  const views = Array.from(document.querySelectorAll("[data-form-view]"));
  const liveOpenTemplatesBtn = document.getElementById("formLiveOpenTemplatesBtn");
  const liveEmpty = document.getElementById("formLiveEmpty");
  const liveContent = document.getElementById("formLiveContent");
  const liveTitle = document.getElementById("formLiveTitle");
  const responseCount = document.getElementById("formResponseCount");
  const rosterCount = document.getElementById("formRosterCount");
  const liveStudentNamesToggle = document.getElementById("formLiveStudentNamesToggle");
  const liveAggregateViewBtn = document.getElementById("formLiveAggregateViewBtn");
  const liveTableViewBtn = document.getElementById("formLiveTableViewBtn");
  const liveExportBtn = document.getElementById("formLiveExportBtn");
  const liveResults = document.getElementById("formLiveResults");
  const closeRunBtn = document.getElementById("formCloseRunBtn");
  const presentResultsBtn = document.getElementById("formPresentResultsBtn");
  const templateList = document.getElementById("formTemplateList");
  const createBtn = document.getElementById("formCreateBtn");
  const questionImportFile = document.getElementById("formQuestionImportFile");
  const historyList = document.getElementById("formHistoryList");
  const historyDetail = document.getElementById("formHistoryDetail");
  const editorBackdrop = document.getElementById("formEditorBackdrop");
  const editorHeading = document.getElementById("formEditorHeading");
  const editorCloseBtn = document.getElementById("formEditorCloseBtn");
  const editorCancelBtn = document.getElementById("formEditorCancelBtn");
  const editorSaveBtn = document.getElementById("formEditorSaveBtn");
  const editorExportBtn = document.getElementById("formEditorExportBtn");
  const editorTitle = document.getElementById("formEditorTitle");
  const editorStatus = document.getElementById("formEditorStatus");
  const questionEditorList = document.getElementById("formQuestionEditorList");
  const addQuestionButtons = Array.from(document.querySelectorAll("[data-add-form-question]"));
  const resultsBackdrop = document.getElementById("formResultsBackdrop");
  const resultsHeading = document.getElementById("formResultsHeading");
  const resultsCloseBtn = document.getElementById("formResultsCloseBtn");
  const presentedStudentNamesToggle = document.getElementById("formPresentedStudentNamesToggle");
  const presentedAggregateViewBtn = document.getElementById("formPresentedAggregateViewBtn");
  const presentedTableViewBtn = document.getElementById("formPresentedTableViewBtn");
  const presentedExportBtn = document.getElementById("formPresentedExportBtn");
  const presentedResults = document.getElementById("formPresentedResults");

  if (!toggleBtn || !panel || !formApi.enabled) {
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.title = "フォーム機能にはSupabase接続が必要です";
    }
    return { refreshForClass: async () => {} };
  }

  let currentTab = "live";
  let templates = [];
  let history = [];
  let activeRun = null;
  let activeResponses = [];
  let activeRoster = [];
  let unsubscribeResponses = null;
  let responseRefreshTimer = null;
  let activeRunRefreshToken = 0;
  let liveStudentNamesVisible = false;
  let presentedStudentNamesVisible = false;
  let liveResultView = "aggregate";
  let presentedResultView = "aggregate";
  let liveTableColumnWidths = {};
  let presentedTableColumnWidths = {};
  let historyResultState = null;
  let editorTemplateId = null;
  let editorQuestions = [];

  function setStatus(message = "", isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("is-error", !!isError);
  }

  function setEditorStatus(message = "", isError = false) {
    if (!editorStatus) return;
    editorStatus.textContent = message;
    editorStatus.classList.toggle("is-error", !!isError);
  }

  function setPanelOpen(open) {
    panel.classList.toggle("collapsed", !open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      onOpen?.();
      void refreshVisibleTab();
    }
  }

  function selectTab(tabName) {
    currentTab = tabName;
    tabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.formTab === tabName);
    });
    views.forEach((view) => {
      view.classList.toggle("hidden", view.dataset.formView !== tabName);
    });
    void refreshVisibleTab();
  }

  async function refreshTemplates() {
    templates = await formApi.listTemplates();
    renderTemplates();
  }

  async function refreshHistory() {
    const classCode = getClassCode?.();
    if (!classCode) {
      history = [];
      renderHistory("クラスに参加すると実施履歴を表示します。");
      return;
    }
    history = await formApi.listRunHistory(classCode);
    renderHistory();
  }

  async function refreshVisibleTab() {
    try {
      setStatus("");
      if (currentTab === "templates") await refreshTemplates();
      if (currentTab === "history") await refreshHistory();
      if (currentTab === "live") await refreshActiveRun();
    } catch (error) {
      console.error("Failed to refresh form panel", error);
      setStatus(error?.message || "フォーム情報を読み込めませんでした。", true);
    }
  }

  function renderTemplates() {
    if (!templateList) return;
    templateList.innerHTML = "";
    if (!templates.length) {
      templateList.appendChild(createEmptyMessage("保存済みのフォームはありません。"));
      replaceMaterialIcons(templateList);
      return;
    }

    templates.forEach((template) => {
      const card = document.createElement("article");
      card.className = "form-list-card";
      const title = document.createElement("h4");
      title.textContent = template.title;
      const meta = document.createElement("p");
      meta.textContent = `${template.questions.length}問 ・ 更新 ${formatDate(template.updated_at)}`;
      const actions = document.createElement("div");
      actions.className = "form-card-actions";

      const start = document.createElement("button");
      start.type = "button";
      start.dataset.action = "start";
      start.textContent = "このフォームを配信";
      start.addEventListener("click", () => void startTemplateRun(template, start));

      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "編集";
      edit.addEventListener("click", () => openEditor(template));

      const exportExcel = document.createElement("button");
      exportExcel.type = "button";
      exportExcel.textContent = "Excel出力";
      exportExcel.addEventListener("click", () => {
        exportFormQuestionsXlsx({ title: template.title, questions: template.questions });
        if (template.questions.some((question) => question.image_path || question.imagePath)) {
          setStatus("設問画像はExcelには含まれません。問題文と選択肢を出力しました。");
        }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.action = "delete";
      remove.textContent = "削除";
      remove.addEventListener("click", () => void deleteTemplate(template));

      actions.append(start, edit, exportExcel, remove);
      card.append(title, meta, actions);
      templateList.appendChild(card);
    });
    replaceMaterialIcons(templateList);
  }

  function renderHistory(message = "") {
    if (!historyList) return;
    historyList.innerHTML = "";
    historyResultState = null;
    if (historyDetail) {
      historyDetail.innerHTML = "";
      historyDetail.classList.add("hidden");
    }
    if (message || !history.length) {
      historyList.appendChild(createEmptyMessage(message || "このクラスの実施履歴はありません。"));
      replaceMaterialIcons(historyList);
      return;
    }
    history.forEach((run) => {
      const card = document.createElement("article");
      card.className = "form-list-card";
      const title = document.createElement("h4");
      title.textContent = run.title;
      const meta = document.createElement("p");
      meta.textContent = `${run.status === "open" ? "回答受付中" : "終了"} ・ ${formatDate(run.started_at)}`;
      const actions = document.createElement("div");
      actions.className = "form-card-actions";
      const view = document.createElement("button");
      view.type = "button";
      view.textContent = "結果を見る";
      view.addEventListener("click", () => void showHistoryRun(run.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.action = "delete";
      remove.textContent = "履歴を削除";
      remove.setAttribute("aria-label", `${run.title}のフォーム履歴を削除`);
      remove.addEventListener("click", () => void deleteRunHistory(run, remove));
      actions.append(view, remove);
      card.append(title, meta, actions);
      historyList.appendChild(card);
    });
    replaceMaterialIcons(historyList);
  }

  function getRespondentCount(responses) {
    return new Set((responses || []).map((response) => response.student_id)).size;
  }

  function syncStudentNamesToggle(button, visible) {
    if (!button) return;
    button.setAttribute("aria-checked", visible ? "true" : "false");
    button.title = visible ? "生徒名を非表示にする" : "生徒名を表示する";
    const state = button.querySelector(".form-name-toggle-state");
    if (state) state.textContent = visible ? "表示中" : "非表示";
  }

  function createStudentNamesToggle(visible, onChange) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "form-name-toggle";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-label", "生徒名を表示");

    const label = document.createElement("span");
    label.className = "form-name-toggle-label";
    label.textContent = "生徒名";
    const track = document.createElement("span");
    track.className = "form-name-toggle-track";
    track.setAttribute("aria-hidden", "true");
    track.appendChild(document.createElement("span"));
    const state = document.createElement("span");
    state.className = "form-name-toggle-state";
    button.append(label, track, state);
    button.addEventListener("click", onChange);
    syncStudentNamesToggle(button, visible);
    return button;
  }

  function syncResultViewButtons(aggregateButton, tableButton, viewMode) {
    aggregateButton?.classList.toggle("active", viewMode === "aggregate");
    aggregateButton?.setAttribute("aria-pressed", viewMode === "aggregate" ? "true" : "false");
    tableButton?.classList.toggle("active", viewMode === "table");
    tableButton?.setAttribute("aria-pressed", viewMode === "table" ? "true" : "false");
  }

  function createResultViewSwitch(viewMode, onChange) {
    const group = document.createElement("div");
    group.className = "form-result-view-switch";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "回答の表示形式");
    const aggregate = document.createElement("button");
    aggregate.type = "button";
    aggregate.textContent = "集計";
    aggregate.addEventListener("click", () => onChange("aggregate"));
    const table = document.createElement("button");
    table.type = "button";
    table.textContent = "一覧";
    table.addEventListener("click", () => onChange("table"));
    group.append(aggregate, table);
    syncResultViewButtons(aggregate, table, viewMode);
    return group;
  }

  function buildResponseTable(run, responses, roster, {
    showStudentNames = false,
    columnWidths = {},
    onColumnWidthChange,
  } = {}) {
    const model = buildResponseTableModel(run, responses, roster, { showStudentNames });
    const shell = document.createElement("div");
    shell.className = "form-response-table-shell";
    const hint = document.createElement("p");
    hint.className = "form-table-resize-hint";
    hint.textContent = "見出しの右端をドラッグすると列幅を変更できます。";
    const scroller = document.createElement("div");
    scroller.className = "form-response-table-scroll";
    const table = document.createElement("table");
    table.className = "form-response-table";
    const colgroup = document.createElement("colgroup");
    const widthForColumn = (column) => Math.max(64, Number(columnWidths[column.key]) || column.width);
    const cols = model.columns.map((column) => {
      const col = document.createElement("col");
      col.style.width = `${widthForColumn(column)}px`;
      colgroup.appendChild(col);
      return col;
    });
    table.style.width = `${model.columns.reduce((sum, column) => sum + widthForColumn(column), 0)}px`;

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    model.columns.forEach((column, columnIndex) => {
      const th = document.createElement("th");
      th.scope = "col";
      const label = document.createElement("span");
      label.textContent = column.label;
      const resizer = document.createElement("span");
      resizer.className = "form-column-resizer";
      resizer.tabIndex = 0;
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", "vertical");
      resizer.setAttribute("aria-label", `${column.label}列の幅を変更`);

      const applyWidth = (width) => {
        const nextWidth = Math.max(64, Math.min(600, Math.round(width)));
        columnWidths[column.key] = nextWidth;
        cols[columnIndex].style.width = `${nextWidth}px`;
        table.style.width = `${model.columns.reduce(
          (sum, item) => sum + Math.max(64, Number(columnWidths[item.key]) || item.width),
          0
        )}px`;
        onColumnWidthChange?.(column.key, nextWidth);
      };
      resizer.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        resizer.focus({ preventScroll: true });
        const startX = event.clientX;
        const startWidth = widthForColumn(column);
        const pointerId = event.pointerId;
        resizer.classList.add("is-dragging");
        try {
          resizer.setPointerCapture?.(pointerId);
        } catch {
          // Window listeners below keep drag resizing available when capture is unsupported.
        }
        const move = (moveEvent) => {
          if (moveEvent.pointerId !== pointerId) return;
          applyWidth(startWidth + moveEvent.clientX - startX);
        };
        const end = (endEvent) => {
          if (endEvent?.pointerId !== undefined && endEvent.pointerId !== pointerId) return;
          resizer.classList.remove("is-dragging");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          try {
            if (resizer.hasPointerCapture?.(pointerId)) resizer.releasePointerCapture(pointerId);
          } catch {
            // The pointer may already have been released by the browser.
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      });
      resizer.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        applyWidth(widthForColumn(column) + (event.key === "ArrowRight" ? 16 : -16));
      });
      th.append(label, resizer);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    const tbody = document.createElement("tbody");
    if (!model.rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = Math.max(1, model.columns.length);
      cell.className = "form-response-table-empty";
      cell.textContent = "このクラスに登録されている生徒はいません。";
      row.appendChild(cell);
      tbody.appendChild(row);
    } else {
      model.rows.forEach((item) => {
        const row = document.createElement("tr");
        row.dataset.studentId = item.studentId;
        item.values.forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = String(value ?? "");
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });
    }
    table.append(colgroup, thead, tbody);
    scroller.appendChild(table);
    shell.append(hint, scroller);
    return shell;
  }

  function renderResultContent(container, run, responses, roster, {
    viewMode = "aggregate",
    showStudentNames = false,
    columnWidths = {},
    onColumnWidthChange,
  } = {}) {
    container.innerHTML = "";
    if (viewMode === "table") {
      container.appendChild(buildResponseTable(run, responses, roster, {
        showStudentNames,
        columnWidths,
        onColumnWidthChange,
      }));
    } else {
      container.appendChild(buildResults(run, responses, { showStudentNames }));
    }
  }

  function buildResults(run, responses, { showStudentNames = false } = {}) {
    const fragment = document.createDocumentFragment();
    (run?.questions || []).forEach((question, index) => {
      const questionResponses = responses.filter(
        (response) => response.run_question_id === question.id
      );
      const card = document.createElement("article");
      card.className = "form-result-card";
      const heading = document.createElement("h5");
      heading.textContent = `${index + 1}. ${escapeText(question.prompt)}`;
      const meta = document.createElement("p");
      meta.className = "form-result-meta";
      meta.textContent = `${QUESTION_LABELS[question.question_type] || "回答"} ・ ${questionResponses.length}件`;
      card.append(heading, meta);

      if (question.question_type === "text") {
        const list = document.createElement("div");
        list.className = "form-text-response-list";
        if (!questionResponses.length) {
          const empty = document.createElement("p");
          empty.className = "form-result-meta";
          empty.textContent = "まだ回答はありません。";
          list.appendChild(empty);
        } else {
          questionResponses.forEach((response) => {
            const row = document.createElement("div");
            row.className = "form-text-response";
            if (showStudentNames) {
              const name = document.createElement("small");
              name.textContent = response.student?.display_name || response.student?.student_login_id || "生徒";
              row.appendChild(name);
            }
            const text = document.createElement("span");
            text.textContent = response.answer_text || "";
            row.appendChild(text);
            list.appendChild(row);
          });
        }
        card.appendChild(list);
      } else {
        const list = document.createElement("div");
        list.className = "form-bar-list";
        const denominator = Math.max(1, questionResponses.length);
        (question.options || []).forEach((option) => {
          const count = questionResponses.filter((response) =>
            (response.selected_option_ids || []).includes(option.id)
          ).length;
          const percent = questionResponses.length ? Math.round((count / denominator) * 100) : 0;
          const row = document.createElement("div");
          row.className = "form-bar-row";
          const label = document.createElement("div");
          label.className = "form-bar-label";
          label.textContent = option.label;
          const track = document.createElement("div");
          track.className = "form-bar-track";
          track.setAttribute("role", "progressbar");
          track.setAttribute("aria-valuemin", "0");
          track.setAttribute("aria-valuemax", "100");
          track.setAttribute("aria-valuenow", String(percent));
          track.setAttribute("aria-label", `${option.label} ${count}人 ${percent}%`);
          const fill = document.createElement("div");
          fill.className = "form-bar-fill";
          fill.style.width = `${percent}%`;
          track.appendChild(fill);
          const value = document.createElement("div");
          value.className = "form-bar-value";
          value.textContent = `${count}人 ${percent}%`;
          row.append(label, track, value);
          list.appendChild(row);
        });
        card.appendChild(list);
      }
      fragment.appendChild(card);
    });
    return fragment;
  }

  function renderLiveResults() {
    const hasRun = !!activeRun;
    liveEmpty?.classList.toggle("hidden", hasRun);
    liveContent?.classList.toggle("hidden", !hasRun);
    liveDot?.classList.toggle("hidden", !hasRun);
    if (!hasRun) return;

    liveTitle.textContent = activeRun.title;
    responseCount.textContent = String(getRespondentCount(activeResponses));
    rosterCount.textContent = `/ ${activeRoster.length}人`;
    syncStudentNamesToggle(liveStudentNamesToggle, liveStudentNamesVisible);
    syncResultViewButtons(liveAggregateViewBtn, liveTableViewBtn, liveResultView);
    renderResultContent(liveResults, activeRun, activeResponses, activeRoster, {
      viewMode: liveResultView,
      showStudentNames: liveStudentNamesVisible,
      columnWidths: liveTableColumnWidths,
      onColumnWidthChange: (key, width) => { liveTableColumnWidths[key] = width; },
    });

    if (presentedResults && !resultsBackdrop.classList.contains("hidden")) {
      renderPresentedResults();
    }
  }

  function renderPresentedResults() {
    if (!presentedResults || !activeRun) return;
    syncStudentNamesToggle(presentedStudentNamesToggle, presentedStudentNamesVisible);
    syncResultViewButtons(presentedAggregateViewBtn, presentedTableViewBtn, presentedResultView);
    renderResultContent(presentedResults, activeRun, activeResponses, activeRoster, {
      viewMode: presentedResultView,
      showStudentNames: presentedStudentNamesVisible,
      columnWidths: presentedTableColumnWidths,
      onColumnWidthChange: (key, width) => { presentedTableColumnWidths[key] = width; },
    });
  }

  function stopResponseSubscription() {
    if (responseRefreshTimer) {
      clearTimeout(responseRefreshTimer);
      responseRefreshTimer = null;
    }
    if (unsubscribeResponses) {
      void unsubscribeResponses();
      unsubscribeResponses = null;
    }
  }

  function subscribeToActiveResponses() {
    stopResponseSubscription();
    if (!activeRun) return;
    unsubscribeResponses = formApi.subscribeToResponses(
      activeRun.id,
      () => {
        clearTimeout(responseRefreshTimer);
        responseRefreshTimer = setTimeout(() => void refreshResponses(), 120);
      },
      (status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Form response subscription failed", error || status);
          setStatus("集計のリアルタイム接続を再確認しています。", true);
        }
      }
    );
  }

  async function refreshResponses() {
    if (!activeRun) return;
    const runId = activeRun.id;
    try {
      const responses = await formApi.getResponses(runId);
      if (activeRun?.id !== runId) return;
      activeResponses = responses;
      renderLiveResults();
      setStatus("");
    } catch (error) {
      console.error("Failed to refresh form responses", error);
      setStatus("回答集計を更新できませんでした。", true);
    }
  }

  async function refreshActiveRun() {
    const classCode = getClassCode?.();
    const token = ++activeRunRefreshToken;
    if (!classCode) {
      stopResponseSubscription();
      activeRun = null;
      activeResponses = [];
      activeRoster = [];
      liveStudentNamesVisible = false;
      presentedStudentNamesVisible = false;
      liveResultView = "aggregate";
      presentedResultView = "aggregate";
      liveTableColumnWidths = {};
      presentedTableColumnWidths = {};
      renderLiveResults();
      setStatus("クラスに参加するとフォームを配信できます。", false);
      return;
    }

    const nextRun = await formApi.getActiveRun(classCode);
    if (token !== activeRunRefreshToken) return;
    const changedRun = nextRun?.id !== activeRun?.id;
    if (changedRun) {
      liveStudentNamesVisible = false;
      presentedStudentNamesVisible = false;
      liveResultView = "aggregate";
      presentedResultView = "aggregate";
      liveTableColumnWidths = {};
      presentedTableColumnWidths = {};
    }
    activeRun = nextRun;
    if (!activeRun) {
      stopResponseSubscription();
      activeResponses = [];
      activeRoster = await formApi.getRoster(classCode);
      liveStudentNamesVisible = false;
      presentedStudentNamesVisible = false;
      renderLiveResults();
      return;
    }

    const [responses, roster] = await Promise.all([
      formApi.getResponses(activeRun.id),
      formApi.getRoster(classCode),
    ]);
    if (token !== activeRunRefreshToken) return;
    activeResponses = responses;
    activeRoster = roster;
    renderLiveResults();
    if (changedRun || !unsubscribeResponses) subscribeToActiveResponses();
  }

  async function refreshForClass() {
    try {
      await refreshActiveRun();
      if (currentTab === "history") await refreshHistory();
    } catch (error) {
      console.error("Failed to refresh forms for class", error);
      setStatus(error?.message || "フォーム情報を読み込めませんでした。", true);
    }
  }

  function releaseEditorQuestionPreviews() {
    editorQuestions.forEach(releaseOwnedQuestionPreview);
  }

  function fillQuestionImagePreview(preview, question, url) {
    preview.innerHTML = "";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${question.prompt || "設問"}の画像`;
    preview.appendChild(image);
  }

  function buildQuestionImageEditor(question, index) {
    const editor = document.createElement("div");
    editor.className = "form-question-image-editor";
    const preview = document.createElement("div");
    preview.className = "form-question-image-preview";
    const hasImage = !!(question.imageFile || question.imagePath || question.imagePreviewUrl);
    preview.classList.toggle("hidden", !hasImage);
    if (question.imagePreviewUrl) {
      fillQuestionImagePreview(preview, question, question.imagePreviewUrl);
    } else if (question.imagePath) {
      const loading = document.createElement("span");
      loading.textContent = "画像を読み込んでいます…";
      preview.appendChild(loading);
      const expectedPath = question.imagePath;
      void formApi.getQuestionImageUrl(expectedPath).then((url) => {
        if (!editorQuestions.includes(question) || question.imagePath !== expectedPath) return;
        question.imagePreviewUrl = url;
        question.imagePreviewOwned = false;
        fillQuestionImagePreview(preview, question, url);
      }).catch((error) => {
        console.error("Failed to load form question image", error);
        if (editorQuestions.includes(question) && question.imagePath === expectedPath) {
          preview.textContent = "画像を読み込めませんでした。";
        }
      });
    }

    const controls = document.createElement("div");
    controls.className = "form-question-image-controls";
    const picker = document.createElement("label");
    picker.className = "form-secondary-btn form-question-image-picker";
    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = "image";
    const pickerText = document.createTextNode(hasImage ? "画像を変更" : "画像を追加");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.dataset.questionField = "image";
    input.setAttribute("aria-label", `${index + 1}問目の画像を選択`);
    picker.append(icon, pickerText, input);
    controls.appendChild(picker);
    if (hasImage) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "form-secondary-btn";
      remove.dataset.imageAction = "remove";
      remove.textContent = "画像を削除";
      controls.appendChild(remove);
    }
    const help = document.createElement("small");
    help.textContent = "JPEG・PNG・WebP・GIF（8MBまで）";
    controls.appendChild(help);
    editor.append(preview, controls);
    return editor;
  }

  async function setEditorQuestionImage(question, file) {
    try {
      setEditorStatus("画像を確認しています…");
      const inspected = await inspectQuestionImage(file);
      if (!editorQuestions.includes(question)) {
        URL.revokeObjectURL(inspected.previewUrl);
        return;
      }
      releaseOwnedQuestionPreview(question);
      question.imagePath = "";
      question.imageMimeType = inspected.mimeType;
      question.imageWidth = inspected.width;
      question.imageHeight = inspected.height;
      question.imageFile = inspected.file;
      question.imagePreviewUrl = inspected.previewUrl;
      question.imagePreviewOwned = true;
      setEditorStatus("画像を追加しました。保存するとアップロードされます。");
      renderQuestionEditor();
    } catch (error) {
      setEditorStatus(error?.message || "画像を追加できませんでした。", true);
    }
  }

  function openEditor(template = null, { imported = false } = {}) {
    releaseEditorQuestionPreviews();
    editorTemplateId = template?.id || null;
    editorHeading.textContent = template?.id
      ? "フォームを編集"
      : imported ? "Excelからフォームを作成" : "フォームを作成";
    editorTitle.value = template?.title || "";
    editorQuestions = template?.questions?.length
      ? template.questions.map(normalizeEditorQuestion)
      : [newQuestion("text")];
    setEditorStatus("");
    renderQuestionEditor();
    editorBackdrop.classList.remove("hidden");
    requestAnimationFrame(() => editorTitle.focus());
  }

  async function importQuestionsFromExcel(file) {
    try {
      setStatus("Excelファイルを読み込んでいます…");
      const imported = await parseFormQuestionsWorkbook(file);
      openEditor(imported, { imported: true });
      setEditorStatus(`${imported.questions.length}問を読み込みました。内容を確認して保存してください。`);
      setStatus("");
    } catch (error) {
      console.error("Failed to import form questions", error);
      setStatus(error?.message || "フォーム設問を読み込めませんでした。", true);
    } finally {
      if (questionImportFile) questionImportFile.value = "";
    }
  }

  function exportEditorToExcel() {
    try {
      const title = validateEditor();
      exportFormQuestionsXlsx({ title, questions: editorQuestions });
      setEditorStatus(editorQuestions.some((question) => question.imagePath || question.imageFile)
        ? "問題文と選択肢を出力しました。設問画像はExcelには含まれません。"
        : "現在の設問をExcelファイルに出力しました。");
    } catch (error) {
      setEditorStatus(error?.message || "Excelファイルを出力できませんでした。", true);
    }
  }

  function closeEditor() {
    editorBackdrop.classList.add("hidden");
    releaseEditorQuestionPreviews();
    editorTemplateId = null;
    editorQuestions = [];
  }

  function renderQuestionEditor() {
    questionEditorList.innerHTML = "";
    editorQuestions.forEach((question, index) => {
      const card = document.createElement("article");
      card.className = "form-question-editor-card";
      card.dataset.questionId = question.localId;

      const head = document.createElement("div");
      head.className = "form-question-editor-head";
      const number = document.createElement("strong");
      number.textContent = `問題 ${index + 1}`;
      const actions = document.createElement("div");
      actions.className = "form-question-editor-actions";
      [["arrow_upward", "up", "上へ"], ["arrow_downward", "down", "下へ"], ["delete", "remove", "削除"]]
        .forEach(([iconName, actionName, label]) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.questionAction = actionName;
          button.title = label;
          button.setAttribute("aria-label", `${index + 1}問目を${label}`);
          button.disabled = (actionName === "up" && index === 0)
            || (actionName === "down" && index === editorQuestions.length - 1)
            || (actionName === "remove" && editorQuestions.length === 1);
          const icon = document.createElement("span");
          icon.className = "material-symbols-rounded";
          icon.textContent = iconName;
          button.appendChild(icon);
          actions.appendChild(button);
        });
      head.append(number, actions);

      const fields = document.createElement("div");
      fields.className = "form-question-fields";
      const promptLabel = document.createElement("label");
      promptLabel.className = "form-field";
      const promptTitle = document.createElement("span");
      promptTitle.textContent = "問題文";
      const prompt = document.createElement("textarea");
      prompt.maxLength = 1000;
      prompt.value = question.prompt;
      prompt.placeholder = "生徒に尋ねる内容を入力";
      prompt.dataset.questionField = "prompt";
      promptLabel.append(promptTitle, prompt);

      const typeLabel = document.createElement("label");
      typeLabel.className = "form-field";
      const typeTitle = document.createElement("span");
      typeTitle.textContent = "回答形式";
      const type = document.createElement("select");
      type.dataset.questionField = "questionType";
      Object.entries(QUESTION_LABELS).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = question.questionType === value;
        type.appendChild(option);
      });
      typeLabel.append(typeTitle, type);
      fields.append(promptLabel, typeLabel);

      const requiredLabel = document.createElement("label");
      requiredLabel.className = "form-required-check";
      const required = document.createElement("input");
      required.type = "checkbox";
      required.checked = question.required;
      required.dataset.questionField = "required";
      requiredLabel.append(required, document.createTextNode("必須回答"));

      card.append(head, fields, requiredLabel);
      card.appendChild(buildQuestionImageEditor(question, index));
      if (question.questionType !== "text") {
        card.appendChild(buildOptionsEditor(question));
      }
      questionEditorList.appendChild(card);
    });
    replaceMaterialIcons(questionEditorList);
  }

  function buildOptionsEditor(question) {
    const editor = document.createElement("div");
    editor.className = "form-options-editor";
    question.options.forEach((option, index) => {
      const row = document.createElement("div");
      row.className = "form-option-row";
      row.dataset.optionId = option.id;
      const marker = document.createElement("span");
      marker.className = "form-option-marker material-symbols-rounded";
      marker.textContent = question.questionType === "single_choice"
        ? "radio_button_unchecked"
        : "check_box_outline_blank";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 300;
      input.value = option.label;
      input.placeholder = `選択肢${index + 1}`;
      input.dataset.optionField = "label";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "form-option-remove";
      remove.dataset.optionAction = "remove";
      remove.disabled = question.options.length <= 2;
      remove.title = "選択肢を削除";
      remove.setAttribute("aria-label", `${index + 1}番目の選択肢を削除`);
      const icon = document.createElement("span");
      icon.className = "material-symbols-rounded";
      icon.textContent = "close";
      remove.appendChild(icon);
      row.append(marker, input, remove);
      editor.appendChild(row);
    });
    if (question.options.length < 10) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "form-secondary-btn form-add-option";
      add.dataset.optionAction = "add";
      add.textContent = "選択肢を追加";
      editor.appendChild(add);
    }
    return editor;
  }

  function findEditorQuestion(element) {
    const card = element.closest("[data-question-id]");
    if (!card) return null;
    return editorQuestions.find((question) => question.localId === card.dataset.questionId) || null;
  }

  function validateEditor() {
    const title = editorTitle.value.trim();
    if (!title) throw new Error("フォーム名を入力してください。");
    if (!editorQuestions.length) throw new Error("問題を1問以上追加してください。");
    editorQuestions.forEach((question, index) => {
      if (!question.prompt.trim()) throw new Error(`${index + 1}問目の問題文を入力してください。`);
      if (question.questionType !== "text") {
        if (question.options.length < 2) throw new Error(`${index + 1}問目には選択肢が2つ以上必要です。`);
        if (question.options.some((option) => !option.label.trim())) {
          throw new Error(`${index + 1}問目の空の選択肢を入力してください。`);
        }
      }
    });
    return title;
  }

  async function saveEditor() {
    const uploadedPaths = [];
    try {
      const title = validateEditor();
      editorSaveBtn.disabled = true;
      const imagesToUpload = editorQuestions.filter((question) => question.imageFile);
      for (let index = 0; index < imagesToUpload.length; index += 1) {
        const question = imagesToUpload[index];
        setEditorStatus(`画像をアップロードしています…（${index + 1}/${imagesToUpload.length}）`);
        const uploaded = await formApi.uploadQuestionImage(question.imageFile, {
          width: question.imageWidth,
          height: question.imageHeight,
        });
        uploadedPaths.push(uploaded.imagePath);
        question.imagePath = uploaded.imagePath;
        question.imageMimeType = uploaded.imageMimeType;
        question.imageWidth = uploaded.imageWidth;
        question.imageHeight = uploaded.imageHeight;
      }
      setEditorStatus("保存中…");
      await formApi.saveTemplate({ id: editorTemplateId, title, questions: editorQuestions });
      await refreshTemplates();
      closeEditor();
      selectTab("templates");
      setStatus("フォームを保存しました。");
    } catch (error) {
      console.error("Failed to save form template", error);
      if (uploadedPaths.length) {
        try {
          await formApi.removeQuestionImages(uploadedPaths);
        } catch (cleanupError) {
          console.warn("Failed to clean up unsaved form images", cleanupError);
        }
        editorQuestions.forEach((question) => {
          if (uploadedPaths.includes(question.imagePath)) question.imagePath = "";
        });
      }
      setEditorStatus(error?.message || "フォームを保存できませんでした。", true);
    } finally {
      editorSaveBtn.disabled = false;
    }
  }

  async function startTemplateRun(template, button) {
    const classCode = getClassCode?.();
    if (!classCode) {
      setStatus("先にクラスへ参加してください。", true);
      return;
    }
    try {
      button.disabled = true;
      setStatus("フォームを配信しています…");
      const runId = await formApi.startRun(template.id, classCode);
      activeRunRefreshToken += 1;
      activeRun = await formApi.getRun(runId);
      activeResponses = [];
      liveStudentNamesVisible = false;
      presentedStudentNamesVisible = false;
      liveResultView = "aggregate";
      presentedResultView = "aggregate";
      liveTableColumnWidths = {};
      presentedTableColumnWidths = {};
      activeRoster = await formApi.getRoster(classCode);
      subscribeToActiveResponses();
      renderLiveResults();
      await socket?.emit("teacher-form-opened", {
        classCode,
        runId,
        title: activeRun?.title || template.title,
      });
      selectTab("live");
      setStatus("生徒にフォームを配信しました。");
    } catch (error) {
      console.error("Failed to start form run", error);
      const message = /duplicate|form_runs_one_open/i.test(String(error?.message || ""))
        ? "このクラスでは別のフォームが回答受付中です。先に受付を終了してください。"
        : error?.message || "フォームを配信できませんでした。";
      setStatus(message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function closeActiveRun() {
    if (!activeRun) return;
    if (!window.confirm(`「${activeRun.title}」の回答受付を終了しますか？`)) return;
    try {
      closeRunBtn.disabled = true;
      const classCode = getClassCode?.();
      const runId = activeRun.id;
      activeRunRefreshToken += 1;
      await formApi.closeRun(runId);
      await socket?.emit("teacher-form-closed", { classCode, runId });
      stopResponseSubscription();
      activeRun = null;
      activeResponses = [];
      activeRoster = [];
      liveStudentNamesVisible = false;
      presentedStudentNamesVisible = false;
      liveResultView = "aggregate";
      presentedResultView = "aggregate";
      liveTableColumnWidths = {};
      presentedTableColumnWidths = {};
      renderLiveResults();
      await refreshHistory();
      setStatus("回答受付を終了し、結果を履歴に保存しました。");
    } catch (error) {
      console.error("Failed to close form run", error);
      setStatus(error?.message || "回答受付を終了できませんでした。", true);
    } finally {
      closeRunBtn.disabled = false;
    }
  }

  async function deleteTemplate(template) {
    if (!window.confirm(`保存済みフォーム「${template.title}」を削除しますか？\n過去の実施結果は削除されません。`)) return;
    try {
      await formApi.deleteTemplate(template.id);
      await refreshTemplates();
      setStatus("保存済みフォームを削除しました。");
    } catch (error) {
      console.error("Failed to delete form template", error);
      setStatus(error?.message || "フォームを削除できませんでした。", true);
    }
  }

  async function deleteRunHistory(run, button) {
    const activeWarning = run.status === "open"
      ? "\n現在の回答受付も終了し、生徒は回答できなくなります。"
      : "";
    if (!window.confirm(
      `フォーム履歴「${run.title}」を完全に削除しますか？${activeWarning}\n生徒の回答履歴・設問データと、ほかで使われていない画像も削除されます。この操作は元に戻せません。`
    )) return;

    try {
      button.disabled = true;
      setStatus("フォーム履歴と関連データを削除しています…");
      await formApi.deleteRunHistory(run.id);
      const classCode = getClassCode?.();
      if (activeRun?.id === run.id) {
        activeRunRefreshToken += 1;
        stopResponseSubscription();
        activeRun = null;
        activeResponses = [];
        activeRoster = [];
        liveStudentNamesVisible = false;
        presentedStudentNamesVisible = false;
        liveResultView = "aggregate";
        presentedResultView = "aggregate";
        liveTableColumnWidths = {};
        presentedTableColumnWidths = {};
        resultsBackdrop?.classList.add("hidden");
        renderLiveResults();
      }
      history = history.filter((item) => item.id !== run.id);
      renderHistory();
      setStatus("フォーム履歴を削除しました。生徒側の履歴にも反映されます。");
      try {
        await socket?.emit("teacher-history-deleted", {
          classCode,
          historyKind: "form",
          historyId: run.id,
        });
      } catch (notificationError) {
        console.warn("Form deletion notification could not be broadcast", notificationError);
      }
    } catch (error) {
      console.error("Failed to delete form history", error);
      setStatus(error?.message || "フォーム履歴を削除できませんでした。", true);
      button.disabled = false;
    }
  }

  async function showHistoryRun(runId) {
    try {
      setStatus("結果を読み込んでいます…");
      const classCode = getClassCode?.();
      const [run, responses, roster] = await Promise.all([
        formApi.getRun(runId),
        formApi.getResponses(runId),
        formApi.getRoster(classCode),
      ]);
      historyResultState = {
        run,
        responses,
        roster,
        studentNamesVisible: false,
        viewMode: "aggregate",
        columnWidths: {},
      };
      renderHistoryResult();
      historyDetail.classList.remove("hidden");
      historyDetail.scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus("");
    } catch (error) {
      console.error("Failed to show form history", error);
      setStatus(error?.message || "実施結果を読み込めませんでした。", true);
    }
  }

  function renderHistoryResult() {
    if (!historyResultState || !historyDetail) return;
    const { run, responses, roster, studentNamesVisible, viewMode, columnWidths } = historyResultState;
    historyDetail.innerHTML = "";
    const summary = document.createElement("div");
    summary.className = "form-live-summary";
    const text = document.createElement("div");
    const kicker = document.createElement("p");
    kicker.className = "form-panel-kicker";
    kicker.textContent = `${getRespondentCount(responses)}人が回答`;
    const title = document.createElement("h4");
    title.textContent = run.title;
    text.append(kicker, title);
    const toolbar = document.createElement("div");
    toolbar.className = "form-result-toolbar";
    toolbar.appendChild(createResultViewSwitch(viewMode, (nextView) => {
      historyResultState.viewMode = nextView;
      renderHistoryResult();
    }));
    const exportExcel = document.createElement("button");
    exportExcel.type = "button";
    exportExcel.className = "form-compact-action";
    exportExcel.textContent = "Excel出力";
    exportExcel.addEventListener("click", () => {
      exportFormResponsesXlsx({ run, responses, roster, showStudentNames: studentNamesVisible });
    });
    const toggle = createStudentNamesToggle(studentNamesVisible, () => {
      historyResultState.studentNamesVisible = !historyResultState.studentNamesVisible;
      renderHistoryResult();
    });
    toolbar.append(exportExcel, toggle);
    summary.append(text, toolbar);
    const content = document.createElement("div");
    content.className = "form-live-results";
    renderResultContent(content, run, responses, roster, {
      viewMode,
      showStudentNames: studentNamesVisible,
      columnWidths,
      onColumnWidthChange: (key, width) => { historyResultState.columnWidths[key] = width; },
    });
    historyDetail.append(summary, content);
  }

  toggleBtn.addEventListener("click", () => setPanelOpen(panel.classList.contains("collapsed")));
  closeBtn?.addEventListener("click", () => setPanelOpen(false));
  tabButtons.forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.formTab)));
  liveOpenTemplatesBtn?.addEventListener("click", () => selectTab("templates"));
  createBtn?.addEventListener("click", () => openEditor());
  questionImportFile?.addEventListener("change", () => {
    const file = questionImportFile.files?.[0];
    if (file) void importQuestionsFromExcel(file);
  });
  closeRunBtn?.addEventListener("click", () => void closeActiveRun());
  editorCloseBtn?.addEventListener("click", closeEditor);
  editorCancelBtn?.addEventListener("click", closeEditor);
  editorExportBtn?.addEventListener("click", exportEditorToExcel);
  editorSaveBtn?.addEventListener("click", () => void saveEditor());
  resultsCloseBtn?.addEventListener("click", () => resultsBackdrop.classList.add("hidden"));
  liveStudentNamesToggle?.addEventListener("click", () => {
    liveStudentNamesVisible = !liveStudentNamesVisible;
    renderLiveResults();
  });
  liveAggregateViewBtn?.addEventListener("click", () => {
    liveResultView = "aggregate";
    renderLiveResults();
  });
  liveTableViewBtn?.addEventListener("click", () => {
    liveResultView = "table";
    renderLiveResults();
  });
  liveExportBtn?.addEventListener("click", () => {
    if (!activeRun) return;
    exportFormResponsesXlsx({
      run: activeRun,
      responses: activeResponses,
      roster: activeRoster,
      showStudentNames: liveStudentNamesVisible,
    });
  });
  presentedStudentNamesToggle?.addEventListener("click", () => {
    presentedStudentNamesVisible = !presentedStudentNamesVisible;
    renderPresentedResults();
  });
  presentedAggregateViewBtn?.addEventListener("click", () => {
    presentedResultView = "aggregate";
    renderPresentedResults();
  });
  presentedTableViewBtn?.addEventListener("click", () => {
    presentedResultView = "table";
    renderPresentedResults();
  });
  presentedExportBtn?.addEventListener("click", () => {
    if (!activeRun) return;
    exportFormResponsesXlsx({
      run: activeRun,
      responses: activeResponses,
      roster: activeRoster,
      showStudentNames: presentedStudentNamesVisible,
    });
  });
  presentResultsBtn?.addEventListener("click", () => {
    if (!activeRun) return;
    resultsHeading.textContent = activeRun.title;
    presentedStudentNamesVisible = false;
    presentedResultView = "aggregate";
    presentedTableColumnWidths = {};
    renderPresentedResults();
    resultsBackdrop.classList.remove("hidden");
  });

  editorBackdrop?.addEventListener("click", (event) => {
    if (event.target === editorBackdrop) closeEditor();
  });
  resultsBackdrop?.addEventListener("click", (event) => {
    if (event.target === resultsBackdrop) resultsBackdrop.classList.add("hidden");
  });

  addQuestionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (editorQuestions.length >= 30) {
        setEditorStatus("1つのフォームに追加できる問題は30問までです。", true);
        return;
      }
      editorQuestions.push(newQuestion(button.dataset.addFormQuestion));
      renderQuestionEditor();
      questionEditorList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  questionEditorList?.addEventListener("input", (event) => {
    const question = findEditorQuestion(event.target);
    if (!question) return;
    if (event.target.dataset.questionField === "prompt") question.prompt = event.target.value;
    if (event.target.dataset.optionField === "label") {
      const row = event.target.closest("[data-option-id]");
      const option = question.options.find((item) => item.id === row?.dataset.optionId);
      if (option) option.label = event.target.value;
    }
  });

  questionEditorList?.addEventListener("change", (event) => {
    const question = findEditorQuestion(event.target);
    if (!question) return;
    if (event.target.dataset.questionField === "image") {
      const file = event.target.files?.[0];
      if (file) void setEditorQuestionImage(question, file);
      return;
    }
    if (event.target.dataset.questionField === "required") question.required = event.target.checked;
    if (event.target.dataset.questionField === "questionType") {
      question.questionType = event.target.value;
      if (question.questionType === "text") {
        question.options = [];
      } else if (question.options.length < 2) {
        question.options = [
          { id: localId("option"), label: "選択肢1" },
          { id: localId("option"), label: "選択肢2" },
        ];
      }
      renderQuestionEditor();
    }
  });

  questionEditorList?.addEventListener("click", (event) => {
    const question = findEditorQuestion(event.target);
    if (!question) return;
    const imageAction = event.target.closest("[data-image-action]")?.dataset.imageAction;
    if (imageAction === "remove") {
      releaseOwnedQuestionPreview(question);
      question.imagePath = "";
      question.imageMimeType = "";
      question.imageWidth = 0;
      question.imageHeight = 0;
      question.imageFile = null;
      setEditorStatus("設問画像を削除しました。保存すると反映されます。");
      renderQuestionEditor();
      return;
    }
    const questionAction = event.target.closest("[data-question-action]")?.dataset.questionAction;
    const index = editorQuestions.indexOf(question);
    if (questionAction === "up" && index > 0) {
      [editorQuestions[index - 1], editorQuestions[index]] = [editorQuestions[index], editorQuestions[index - 1]];
      renderQuestionEditor();
    }
    if (questionAction === "down" && index < editorQuestions.length - 1) {
      [editorQuestions[index + 1], editorQuestions[index]] = [editorQuestions[index], editorQuestions[index + 1]];
      renderQuestionEditor();
    }
    if (questionAction === "remove" && editorQuestions.length > 1) {
      releaseOwnedQuestionPreview(question);
      editorQuestions.splice(index, 1);
      renderQuestionEditor();
    }

    const optionAction = event.target.closest("[data-option-action]")?.dataset.optionAction;
    if (optionAction === "add" && question.options.length < 10) {
      question.options.push({ id: localId("option"), label: `選択肢${question.options.length + 1}` });
      renderQuestionEditor();
    }
    if (optionAction === "remove" && question.options.length > 2) {
      const row = event.target.closest("[data-option-id]");
      const optionIndex = question.options.findIndex((item) => item.id === row?.dataset.optionId);
      if (optionIndex >= 0) question.options.splice(optionIndex, 1);
      renderQuestionEditor();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!resultsBackdrop?.classList.contains("hidden")) resultsBackdrop.classList.add("hidden");
    else if (!editorBackdrop?.classList.contains("hidden")) closeEditor();
    else if (!panel.classList.contains("collapsed")) setPanelOpen(false);
  });

  void refreshTemplates().catch((error) => {
    console.error("Failed to initialize forms", error);
    setStatus(error?.message || "フォーム機能を初期化できませんでした。", true);
  });

  return {
    refreshForClass,
    closePanel: () => setPanelOpen(false),
  };
}

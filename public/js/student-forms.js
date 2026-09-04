import { formApi } from "./form-api.js?v=forms-20260830&form-history=20260831&form-images=20260901&history-delete=20260904&auth-singleton=20260904";

const QUESTION_LABELS = { text: "自由記述", single_choice: "1つ選択", multiple_choice: "複数選択可" };

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function createEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "student-form-history-empty";
  empty.textContent = message;
  return empty;
}

export function initStudentForms({ socket, getClassCode, onOpen } = {}) {
  const chip = document.getElementById("studentFormChip");
  const liveDot = document.getElementById("studentFormLiveDot");
  const backdrop = document.getElementById("studentFormBackdrop");
  const kicker = document.getElementById("studentFormKicker");
  const title = document.getElementById("studentFormTitle");
  const minimizeBtn = document.getElementById("studentFormMinimizeBtn");
  const activeTab = document.getElementById("studentFormActiveTab");
  const historyTab = document.getElementById("studentFormHistoryTab");
  const activeView = document.getElementById("studentFormActiveView");
  const historyView = document.getElementById("studentFormHistoryView");
  const progress = document.getElementById("studentFormProgress");
  const questionsEl = document.getElementById("studentFormQuestions");
  const statusEl = document.getElementById("studentFormStatus");
  const doneBtn = document.getElementById("studentFormDoneBtn");
  const historyList = document.getElementById("studentFormHistoryList");
  const historyDetail = document.getElementById("studentFormHistoryDetail");
  const imageBackdrop = document.getElementById("studentFormImageBackdrop");
  const imageDialogTitle = document.getElementById("studentFormImageTitle");
  const imageFull = document.getElementById("studentFormImageFull");
  const imageCloseBtn = document.getElementById("studentFormImageCloseBtn");

  if (!chip || !backdrop || !formApi.enabled) return { refreshActiveRun: async () => {} };

  let activeRun = null;
  let historyRuns = [];
  let responsesByQuestion = new Map();
  let minimized = false;
  let currentView = "active";
  let selectedHistoryRunId = "";
  let refreshToken = 0;

  function setStatus(message = "", isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("is-error", !!isError);
  }

  function updateChip() {
    const hasForms = !!activeRun || historyRuns.length > 0;
    chip.classList.toggle("hidden", !hasForms);
    liveDot?.classList.toggle("hidden", !activeRun);
    chip.title = activeRun ? "回答中のフォームがあります" : "これまでのフォーム";
    chip.setAttribute("aria-label", activeRun ? "回答中のフォームを開く" : "これまでのフォームを開く");
  }

  function selectView(viewName) {
    currentView = viewName === "history" ? "history" : "active";
    activeTab?.classList.toggle("active", currentView === "active");
    activeTab?.setAttribute("aria-selected", currentView === "active" ? "true" : "false");
    historyTab?.classList.toggle("active", currentView === "history");
    historyTab?.setAttribute("aria-selected", currentView === "history" ? "true" : "false");
    activeView?.classList.toggle("hidden", currentView !== "active");
    historyView?.classList.toggle("hidden", currentView !== "history");
    if (currentView === "active") {
      kicker.textContent = activeRun ? "先生からフォームが届きました" : "回答中";
      title.textContent = activeRun?.title || "回答中のフォーム";
    } else {
      kicker.textContent = "自分の回答をあとから確認";
      title.textContent = "これまでのフォーム";
      renderHistoryList();
    }
  }

  function setVisible(visible) {
    backdrop.classList.toggle("hidden", !visible);
    minimized = !visible;
    if (!visible) closeQuestionImageViewer();
    if (visible) {
      onOpen?.();
      if (!activeRun && currentView === "active") selectView("history");
      else selectView(currentView);
    }
  }

  function closeQuestionImageViewer() {
    imageBackdrop?.classList.add("hidden");
    if (imageFull) imageFull.removeAttribute("src");
  }

  function openQuestionImageViewer(question, imageUrl) {
    if (!imageBackdrop || !imageFull || !imageUrl) return;
    imageDialogTitle.textContent = question.prompt || "設問画像";
    imageFull.src = imageUrl;
    imageFull.alt = `${question.prompt || "設問"}の拡大画像`;
    imageBackdrop.classList.remove("hidden");
    requestAnimationFrame(() => imageCloseBtn?.focus());
  }

  function appendQuestionImage(card, question) {
    const imagePath = String(question.image_path || question.imagePath || "").trim();
    if (!imagePath) return;
    const figure = document.createElement("figure");
    figure.className = "student-form-question-image";
    const loading = document.createElement("div");
    loading.className = "student-form-question-image-status";
    loading.textContent = "画像を読み込んでいます…";
    const image = document.createElement("img");
    image.alt = `${question.prompt || "設問"}の画像`;
    image.hidden = true;
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "form-secondary-btn student-form-image-expand";
    expand.textContent = "画像を拡大表示";
    expand.disabled = true;
    figure.append(loading, image, expand);
    card.appendChild(figure);
    void formApi.getQuestionImageUrl(imagePath).then((url) => {
      if (!figure.isConnected || String(question.image_path || question.imagePath || "").trim() !== imagePath) return;
      image.src = url;
      image.hidden = false;
      loading.remove();
      expand.disabled = false;
      expand.addEventListener("click", () => openQuestionImageViewer(question, url));
      image.addEventListener("dblclick", () => openQuestionImageViewer(question, url));
    }).catch((error) => {
      console.error("Failed to load student form image", error);
      loading.textContent = "設問画像を読み込めませんでした。";
      loading.classList.add("is-error");
    });
  }

  function clearActiveRun({ switchToHistory = false } = {}) {
    activeRun = null;
    responsesByQuestion = new Map();
    questionsEl.innerHTML = "";
    progress.textContent = "現在、回答受付中のフォームはありません。";
    setStatus("");
    if (switchToHistory) selectView("history");
    updateChip();
  }

  function updateProgress() {
    const total = activeRun?.questions?.length || 0;
    const answered = [...responsesByQuestion.values()].filter(Boolean).length;
    const required = (activeRun?.questions || []).filter((question) => question.required);
    const requiredAnswered = required.filter((question) => responsesByQuestion.has(question.id)).length;
    progress.textContent = `${answered} / ${total}問を送信済み${required.length ? `（必須 ${requiredAnswered} / ${required.length}問）` : ""}`;
    doneBtn.textContent = requiredAnswered === required.length ? "回答完了" : "あとで続ける";
  }

  function renderQuestions() {
    if (!activeRun) {
      clearActiveRun();
      return;
    }
    questionsEl.innerHTML = "";
    activeRun.questions.forEach((question, index) => {
      const saved = responsesByQuestion.get(question.id);
      const card = document.createElement("article");
      card.className = "student-form-question";
      card.dataset.runQuestionId = question.id;
      card.classList.toggle("is-answered", !!saved);
      const heading = document.createElement("h3");
      heading.textContent = `${index + 1}. ${question.prompt}`;
      const meta = document.createElement("p");
      meta.className = "student-form-question-meta";
      meta.textContent = `${QUESTION_LABELS[question.question_type] || "回答"}${question.required ? " ・ 必須" : ""}`;
      card.append(heading, meta);
      appendQuestionImage(card, question);

      if (question.question_type === "text") {
        const textarea = document.createElement("textarea");
        textarea.maxLength = 5000;
        textarea.placeholder = "回答を入力してください";
        textarea.value = saved?.answer_text || "";
        textarea.dataset.formAnswer = "text";
        card.appendChild(textarea);
      } else {
        const options = document.createElement("div");
        options.className = "student-form-options";
        const selected = new Set(saved?.selected_option_ids || []);
        question.options.forEach((option) => {
          const label = document.createElement("label");
          label.className = "student-form-option";
          const input = document.createElement("input");
          input.type = question.question_type === "single_choice" ? "radio" : "checkbox";
          input.name = `form-question-${question.id}`;
          input.value = option.id;
          input.checked = selected.has(option.id);
          input.dataset.formAnswer = "choice";
          const text = document.createElement("span");
          text.textContent = option.label;
          label.append(input, text);
          options.appendChild(label);
        });
        card.appendChild(options);
      }

      const actions = document.createElement("div");
      actions.className = "student-form-question-actions";
      const savedLabel = document.createElement("span");
      savedLabel.className = "student-form-saved-label";
      savedLabel.textContent = saved ? "送信済み" : "";
      const submit = document.createElement("button");
      submit.type = "button";
      submit.className = "form-primary-btn";
      submit.textContent = saved ? "回答を更新" : "回答を送信";
      submit.addEventListener("click", () => void submitQuestion(question, card, submit, savedLabel));
      actions.append(savedLabel, submit);
      card.appendChild(actions);
      questionsEl.appendChild(card);
    });
    updateProgress();
  }

  async function submitQuestion(question, card, button, savedLabel) {
    let answerText = null;
    let selectedOptionIds = [];
    if (question.question_type === "text") {
      answerText = card.querySelector("[data-form-answer='text']")?.value?.trim() || "";
      if (!answerText) return setStatus("回答を入力してから送信してください。", true);
    } else {
      selectedOptionIds = Array.from(card.querySelectorAll("[data-form-answer='choice']:checked")).map((input) => input.value);
      if (!selectedOptionIds.length) return setStatus("選択肢を選んでから送信してください。", true);
    }
    try {
      button.disabled = true;
      savedLabel.textContent = "送信中…";
      setStatus("");
      const response = await formApi.submitResponse({ runId: activeRun.id, questionId: question.id, answerText, selectedOptionIds });
      responsesByQuestion.set(question.id, response);
      card.classList.add("is-answered");
      savedLabel.textContent = "送信済み";
      button.textContent = "回答を更新";
      updateProgress();
    } catch (error) {
      console.error("Failed to submit form response", error);
      savedLabel.textContent = responsesByQuestion.has(question.id) ? "送信済み" : "";
      const message = /row-level security|closed|0 rows/i.test(String(error?.message || ""))
        ? "回答受付が終了した可能性があります。先生に確認してください。"
        : error?.message || "回答を送信できませんでした。";
      setStatus(message, true);
      void refreshActiveRun({ openIfNew: false });
    } finally {
      button.disabled = false;
    }
  }

  function answerTextForHistory(question, response) {
    if (!response) return "未回答";
    if (question.question_type === "text") return response.answer_text || "未回答";
    const labelsById = new Map((question.options || []).map((option) => [String(option.id), option.label]));
    const labels = (response.selected_option_ids || []).map((id) => labelsById.get(String(id)) || String(id));
    return labels.length ? labels.join("、") : "未回答";
  }

  function renderHistoryList() {
    if (!historyList || currentView !== "history") return;
    historyList.innerHTML = "";
    historyDetail?.classList.add("hidden");
    if (!historyRuns.length) {
      historyList.appendChild(createEmptyState("これまでに配信されたフォームはありません。"));
      return;
    }
    historyRuns.forEach((run) => {
      const card = document.createElement("article");
      card.className = "student-form-history-card";
      const text = document.createElement("div");
      const heading = document.createElement("h3");
      heading.textContent = run.title;
      const meta = document.createElement("p");
      meta.textContent = `${run.status === "open" ? "回答受付中" : "受付終了"} ・ ${formatDate(run.started_at)}`;
      text.append(heading, meta);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "form-secondary-btn";
      button.textContent = run.status === "open" ? "回答する" : "自分の回答を見る";
      button.addEventListener("click", () => void openHistoryRun(run));
      card.append(text, button);
      historyList.appendChild(card);
    });
  }

  async function openHistoryRun(runSummary) {
    if (runSummary.status === "open" && activeRun?.id === runSummary.id) {
      selectView("active");
      return;
    }
    try {
      selectedHistoryRunId = runSummary.id;
      historyList.innerHTML = "";
      historyList.appendChild(createEmptyState("回答を読み込んでいます…"));
      const [run, responses] = await Promise.all([formApi.getRun(runSummary.id), formApi.getMyResponses(runSummary.id)]);
      if (selectedHistoryRunId !== runSummary.id) return;
      const responseMap = new Map(responses.map((response) => [response.run_question_id, response]));
      historyList.innerHTML = "";
      historyDetail.innerHTML = "";
      const header = document.createElement("div");
      header.className = "student-form-history-detail-header";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "form-secondary-btn";
      back.textContent = "一覧へ戻る";
      back.addEventListener("click", () => {
        selectedHistoryRunId = "";
        historyDetail.classList.add("hidden");
        renderHistoryList();
      });
      const heading = document.createElement("div");
      const runTitle = document.createElement("h3");
      runTitle.textContent = run.title;
      const meta = document.createElement("p");
      meta.textContent = `${run.status === "open" ? "回答受付中" : "受付終了"} ・ ${formatDate(run.started_at)}`;
      heading.append(runTitle, meta);
      header.append(heading, back);
      historyDetail.appendChild(header);
      (run.questions || []).forEach((question, index) => {
        const card = document.createElement("article");
        card.className = "student-form-history-answer";
        const questionText = document.createElement("h4");
        questionText.textContent = `${index + 1}. ${question.prompt}`;
        const label = document.createElement("p");
        label.className = "student-form-question-meta";
        label.textContent = QUESTION_LABELS[question.question_type] || "回答";
        card.append(questionText, label);
        appendQuestionImage(card, question);
        const answer = document.createElement("div");
        answer.className = "student-form-history-answer-value";
        const response = responseMap.get(question.id);
        answer.textContent = answerTextForHistory(question, response);
        answer.classList.toggle("is-unanswered", !response);
        card.appendChild(answer);
        historyDetail.appendChild(card);
      });
      historyDetail.classList.remove("hidden");
    } catch (error) {
      console.error("Failed to load student form history", error);
      historyList.innerHTML = "";
      historyList.appendChild(createEmptyState(error?.message || "自分の回答を読み込めませんでした。"));
    }
  }

  async function refreshHistory() {
    try {
      historyRuns = await formApi.listMyRunHistory();
      updateChip();
      if (currentView === "history" && !selectedHistoryRunId) renderHistoryList();
      return historyRuns;
    } catch (error) {
      console.error("Failed to load student form history list", error);
      historyRuns = [];
      updateChip();
      if (currentView === "history") {
        historyList.innerHTML = "";
        historyList.appendChild(createEmptyState(error?.message || "フォーム履歴を読み込めませんでした。"));
      }
      return [];
    }
  }

  async function refreshActiveRun({ openIfNew = true, expectedRunId = "" } = {}) {
    const classCode = getClassCode?.();
    if (!classCode) return null;
    const token = ++refreshToken;
    try {
      const run = await formApi.getActiveRun(classCode);
      if (token !== refreshToken) return null;
      if (!run || (expectedRunId && run.id !== expectedRunId)) {
        if (!run) clearActiveRun({ switchToHistory: !backdrop.classList.contains("hidden") });
        await refreshHistory();
        return run;
      }
      const isNew = run.id !== activeRun?.id;
      activeRun = run;
      const responses = await formApi.getMyResponses(run.id);
      if (token !== refreshToken) return null;
      responsesByQuestion = new Map(responses.map((response) => [response.run_question_id, response]));
      renderQuestions();
      updateChip();
      void refreshHistory();
      if (isNew && openIfNew) {
        currentView = "active";
        minimized = false;
        setVisible(true);
      } else if (!minimized && !backdrop.classList.contains("hidden")) {
        selectView(currentView);
      }
      return run;
    } catch (error) {
      console.error("Failed to load active form", error);
      setStatus(error?.message || "フォームを読み込めませんでした。", true);
      await refreshHistory();
      return null;
    }
  }

  chip.addEventListener("click", () => {
    currentView = activeRun ? "active" : "history";
    setVisible(true);
  });
  minimizeBtn?.addEventListener("click", () => setVisible(false));
  doneBtn?.addEventListener("click", () => setVisible(false));
  activeTab?.addEventListener("click", () => selectView("active"));
  historyTab?.addEventListener("click", () => selectView("history"));
  imageCloseBtn?.addEventListener("click", closeQuestionImageViewer);
  imageBackdrop?.addEventListener("click", (event) => {
    if (event.target === imageBackdrop) closeQuestionImageViewer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && imageBackdrop && !imageBackdrop.classList.contains("hidden")) {
      closeQuestionImageViewer();
    }
  });

  socket?.on("teacher-form-opened", (payload = {}) => {
    const classCode = String(getClassCode?.() || "").trim().toUpperCase();
    const payloadClassCode = String(payload.classCode || "").trim().toUpperCase();
    if (!classCode || payloadClassCode !== classCode) return;
    void refreshActiveRun({ openIfNew: true, expectedRunId: payload.runId }).then((run) => {
      if (!run && payload.runId) setTimeout(() => void refreshActiveRun({ openIfNew: true, expectedRunId: payload.runId }), 500);
    });
  });
  socket?.on("teacher-form-closed", (payload = {}) => {
    if (!activeRun || payload.runId !== activeRun.id) return;
    clearActiveRun({ switchToHistory: true });
    void refreshHistory();
  });
  socket?.on("teacher-history-deleted", (payload = {}) => {
    const classCode = String(getClassCode?.() || "").trim().toUpperCase();
    const payloadClassCode = String(payload.classCode || "").trim().toUpperCase();
    if (payload.historyKind !== "form" || !classCode || payloadClassCode !== classCode) return;
    closeQuestionImageViewer();
    if (activeRun?.id === payload.historyId) clearActiveRun({ switchToHistory: true });
    if (selectedHistoryRunId === payload.historyId) {
      selectedHistoryRunId = "";
      historyDetail.classList.add("hidden");
    }
    void refreshHistory();
  });
  socket?.on("join-success", () => void refreshActiveRun({ openIfNew: true }));
  socket?.on("realtime-reconnected", () => void refreshActiveRun({ openIfNew: true }));

  return { refreshActiveRun };
}

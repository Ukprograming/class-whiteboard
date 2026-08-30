import { formApi } from "./form-api.js?v=forms-20260830";

const QUESTION_LABELS = {
  text: "自由記述",
  single_choice: "1つ選択",
  multiple_choice: "複数選択可",
};

export function initStudentForms({ socket, getClassCode, onOpen } = {}) {
  const chip = document.getElementById("studentFormChip");
  const backdrop = document.getElementById("studentFormBackdrop");
  const title = document.getElementById("studentFormTitle");
  const minimizeBtn = document.getElementById("studentFormMinimizeBtn");
  const progress = document.getElementById("studentFormProgress");
  const questionsEl = document.getElementById("studentFormQuestions");
  const statusEl = document.getElementById("studentFormStatus");
  const doneBtn = document.getElementById("studentFormDoneBtn");

  if (!chip || !backdrop || !formApi.enabled) {
    return { refreshActiveRun: async () => {} };
  }

  let activeRun = null;
  let responsesByQuestion = new Map();
  let minimized = false;
  let refreshToken = 0;

  function setStatus(message = "", isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("is-error", !!isError);
  }

  function setVisible(visible) {
    backdrop.classList.toggle("hidden", !visible);
    minimized = !visible && !!activeRun;
    if (visible) onOpen?.();
  }

  function clearActiveRun() {
    activeRun = null;
    responsesByQuestion = new Map();
    minimized = false;
    backdrop.classList.add("hidden");
    chip.classList.add("hidden");
    questionsEl.innerHTML = "";
    setStatus("");
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
    if (!activeRun) return;
    title.textContent = activeRun.title;
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
      if (!answerText) {
        setStatus("回答を入力してから送信してください。", true);
        return;
      }
    } else {
      selectedOptionIds = Array.from(card.querySelectorAll("[data-form-answer='choice']:checked"))
        .map((input) => input.value);
      if (!selectedOptionIds.length) {
        setStatus("選択肢を選んでから送信してください。", true);
        return;
      }
    }

    try {
      button.disabled = true;
      savedLabel.textContent = "送信中…";
      setStatus("");
      const response = await formApi.submitResponse({
        runId: activeRun.id,
        questionId: question.id,
        answerText,
        selectedOptionIds,
      });
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

  async function refreshActiveRun({ openIfNew = true, expectedRunId = "" } = {}) {
    const classCode = getClassCode?.();
    if (!classCode) return null;
    const token = ++refreshToken;
    try {
      const run = await formApi.getActiveRun(classCode);
      if (token !== refreshToken) return null;
      if (!run || (expectedRunId && run.id !== expectedRunId)) {
        if (!run) clearActiveRun();
        return run;
      }
      const isNew = run.id !== activeRun?.id;
      activeRun = run;
      const responses = await formApi.getMyResponses(run.id);
      if (token !== refreshToken) return null;
      responsesByQuestion = new Map(responses.map((response) => [response.run_question_id, response]));
      chip.classList.remove("hidden");
      renderQuestions();
      if (isNew && openIfNew) {
        minimized = false;
        setVisible(true);
      } else if (!minimized && !backdrop.classList.contains("hidden")) {
        setVisible(true);
      }
      return run;
    } catch (error) {
      console.error("Failed to load active form", error);
      setStatus(error?.message || "フォームを読み込めませんでした。", true);
      return null;
    }
  }

  chip.addEventListener("click", () => {
    if (!activeRun) {
      void refreshActiveRun();
      return;
    }
    setVisible(true);
  });
  minimizeBtn?.addEventListener("click", () => setVisible(false));
  doneBtn?.addEventListener("click", () => setVisible(false));

  socket?.on("teacher-form-opened", (payload = {}) => {
    const classCode = String(getClassCode?.() || "").trim().toUpperCase();
    const payloadClassCode = String(payload.classCode || "").trim().toUpperCase();
    if (!classCode || payloadClassCode !== classCode) return;
    void refreshActiveRun({ openIfNew: true, expectedRunId: payload.runId }).then((run) => {
      if (!run && payload.runId) {
        setTimeout(() => void refreshActiveRun({ openIfNew: true, expectedRunId: payload.runId }), 500);
      }
    });
  });

  socket?.on("teacher-form-closed", (payload = {}) => {
    if (!activeRun || payload.runId !== activeRun.id) return;
    clearActiveRun();
  });

  socket?.on("join-success", () => void refreshActiveRun({ openIfNew: true }));
  socket?.on("realtime-reconnected", () => void refreshActiveRun({ openIfNew: true }));

  return { refreshActiveRun };
}

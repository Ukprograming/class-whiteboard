import {
  createXlsxBlob,
  downloadBlob,
  parseXlsxSheet,
  safeExcelFilename,
} from "./xlsx-utils.js?v=form-excel-20260831";

export const FORM_QUESTION_SHEET_NAME = "フォーム設問";
export const FORM_QUESTION_HEADERS = Object.freeze([
  "フォーム名",
  "設問番号",
  "問題形式",
  "問題文",
  "必須回答",
  ...Array.from({ length: 10 }, (_, index) => `選択肢${index + 1}`),
]);

const QUESTION_TYPE_LABELS = Object.freeze({
  text: "自由記述",
  single_choice: "単一選択",
  multiple_choice: "複数選択",
});

const QUESTION_TYPE_ALIASES = new Map([
  ["自由記述", "text"],
  ["テキスト", "text"],
  ["text", "text"],
  ["単一選択", "single_choice"],
  ["1つ選択", "single_choice"],
  ["single_choice", "single_choice"],
  ["複数選択", "multiple_choice"],
  ["複数選択可", "multiple_choice"],
  ["multiple_choice", "multiple_choice"],
]);

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP");
}

function normalizeRequired(value, rowNumber) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["", "はい", "必須", "true", "1", "yes"].includes(normalized)) return true;
  if (["いいえ", "任意", "false", "0", "no"].includes(normalized)) return false;
  throw new Error(`${rowNumber}行目の「必須回答」は「はい」または「いいえ」で入力してください。`);
}

function normalizeQuestionType(value, rowNumber) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const questionType = QUESTION_TYPE_ALIASES.get(normalized);
  if (!questionType) {
    throw new Error(`${rowNumber}行目の問題形式は「自由記述」「単一選択」「複数選択」のいずれかを入力してください。`);
  }
  return questionType;
}

function optionId(rowNumber, index) {
  return `excel-r${rowNumber}-o${index + 1}`;
}

export async function parseFormQuestionsWorkbook(file) {
  const rows = await parseXlsxSheet(file, FORM_QUESTION_SHEET_NAME, { maxColumns: 20, maxRows: 80 });
  const headerRow = rows.find((row) => row.rowNumber === 1) || { values: [] };
  const headersMatch = FORM_QUESTION_HEADERS.every(
    (header, index) => String(headerRow.values[index] ?? "").trim() === header
  );
  if (!headersMatch) {
    throw new Error("1行目の見出しがひな型と異なります。最新のひな型をダウンロードしてお使いください。");
  }

  const dataRows = rows.filter((row) => row.rowNumber >= 2 && row.values.some((value) => String(value ?? "").trim()));
  if (!dataRows.length) throw new Error("フォーム設問が入力されていません。2行目以降に入力してください。");
  if (dataRows.length > 30) throw new Error("1つのフォームに入力できる設問は30問までです。");

  const titles = new Set(dataRows.map((row) => String(row.values[0] ?? "").trim()).filter(Boolean));
  if (!titles.size) throw new Error("フォーム名を入力してください。");
  if (titles.size > 1) throw new Error("フォーム名はすべての行で同じ内容を入力してください。");
  const title = [...titles][0];
  if (title.length > 120) throw new Error("フォーム名は120文字以内で入力してください。");

  const seenPositions = new Set();
  const questions = dataRows.map((row, sourceIndex) => {
    const rawPosition = String(row.values[1] ?? "").trim();
    const position = rawPosition ? Number(rawPosition) : sourceIndex + 1;
    if (!Number.isInteger(position) || position < 1 || position > 30) {
      throw new Error(`${row.rowNumber}行目の設問番号は1から30の整数で入力してください。`);
    }
    if (seenPositions.has(position)) throw new Error(`${row.rowNumber}行目の設問番号「${position}」が重複しています。`);
    seenPositions.add(position);

    const questionType = normalizeQuestionType(row.values[2], row.rowNumber);
    const prompt = String(row.values[3] ?? "").trim();
    if (!prompt) throw new Error(`${row.rowNumber}行目の問題文を入力してください。`);
    if (prompt.length > 1000) throw new Error(`${row.rowNumber}行目の問題文は1000文字以内で入力してください。`);
    const required = normalizeRequired(row.values[4], row.rowNumber);
    const rawOptions = Array.from({ length: 10 }, (_, index) => String(row.values[index + 5] ?? "").trim());
    const firstBlank = rawOptions.findIndex((value) => !value);
    if (firstBlank >= 0 && rawOptions.slice(firstBlank + 1).some(Boolean)) {
      throw new Error(`${row.rowNumber}行目の選択肢は「選択肢1」から空欄を挟まずに入力してください。`);
    }
    const optionLabels = rawOptions.filter(Boolean);
    if (questionType === "text" && optionLabels.length) {
      throw new Error(`${row.rowNumber}行目は自由記述のため、選択肢は空欄にしてください。`);
    }
    if (questionType !== "text" && optionLabels.length < 2) {
      throw new Error(`${row.rowNumber}行目の選択問題には選択肢を2つ以上入力してください。`);
    }
    if (optionLabels.some((label) => label.length > 300)) {
      throw new Error(`${row.rowNumber}行目の選択肢は1つ300文字以内で入力してください。`);
    }

    return {
      position,
      questionType,
      prompt,
      required,
      options: optionLabels.map((label, index) => ({ id: optionId(row.rowNumber, index), label })),
    };
  }).sort((a, b) => a.position - b.position);

  return { title, questions };
}

export function buildFormQuestionRows({ title, questions = [] }) {
  return [
    [...FORM_QUESTION_HEADERS],
    ...questions.map((question, index) => {
      const questionType = question.questionType || question.question_type || "text";
      const options = questionType === "text"
        ? []
        : (question.options || []).map((option) => String(option.label || ""));
      return [
        title,
        index + 1,
        QUESTION_TYPE_LABELS[questionType] || questionType,
        question.prompt || "",
        question.required === false ? "いいえ" : "はい",
        ...Array.from({ length: 10 }, (_, optionIndex) => options[optionIndex] || ""),
      ];
    }),
  ];
}

export function exportFormQuestionsXlsx({ title, questions }) {
  const rows = buildFormQuestionRows({ title, questions });
  const blob = createXlsxBlob({
    sheets: [{
      name: FORM_QUESTION_SHEET_NAME,
      rows,
      rowStyles: { 1: "header" },
      rowHeights: { 1: 30 },
      columnWidths: [24, 10, 14, 44, 12, ...Array(10).fill(22)],
      freezeRows: 1,
      autoFilterRow: 1,
    }],
  });
  downloadBlob(blob, `${safeExcelFilename(title, "フォーム設問")}_設問.xlsx`);
}

function responseAnswer(question, response) {
  if (!response) return "";
  if (question.question_type === "text") return String(response.answer_text || "");
  const labelsById = new Map((question.options || []).map((option) => [String(option.id), String(option.label || "")]));
  return (response.selected_option_ids || []).map((id) => labelsById.get(String(id)) || String(id)).join("、");
}

export function buildResponseTableModel(run, responses = [], roster = [], { showStudentNames = false } = {}) {
  const questions = [...(run?.questions || [])].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const orderedRoster = [...roster].sort((a, b) => {
    const createdComparison = String(a.created_at || "").localeCompare(String(b.created_at || ""));
    return createdComparison || String(a.id || "").localeCompare(String(b.id || ""));
  });
  const responsesByStudentQuestion = new Map(
    responses.map((response) => [`${response.student_id}:${response.run_question_id}`, response])
  );
  const columns = [
    { key: "registration-order", label: "No.", width: 68 },
    ...(showStudentNames ? [
      { key: "student-login-id", label: "生徒ID", width: 130 },
      { key: "student-display-name", label: "表示名", width: 150 },
    ] : []),
    ...questions.map((question, index) => ({
      key: `question-${question.id}`,
      label: `Q${index + 1}. ${question.prompt}`,
      width: Math.max(180, Math.min(360, 110 + String(question.prompt || "").length * 8)),
    })),
  ];
  const rows = orderedRoster.map((student, index) => {
    const values = [
      index + 1,
      ...(showStudentNames ? [student.student_login_id || "", student.display_name || ""] : []),
      ...questions.map((question) => responseAnswer(
        question,
        responsesByStudentQuestion.get(`${student.id}:${question.id}`)
      )),
    ];
    return { studentId: student.id, values };
  });
  return { columns, rows };
}

export function exportFormResponsesXlsx({ run, responses, roster, showStudentNames = false }) {
  const model = buildResponseTableModel(run, responses, roster, { showStudentNames });
  const answerRows = [
    model.columns.map((column) => column.label),
    ...model.rows.map((row) => row.values),
  ];
  const respondentCount = new Set((responses || []).map((response) => response.student_id)).size;
  const infoRows = [
    ["フォーム回答一覧"],
    ["フォーム名", run?.title || ""],
    ["受付開始", formatDateTime(run?.started_at)],
    ["受付終了", formatDateTime(run?.closed_at)],
    ["登録生徒数", roster?.length || 0],
    ["回答者数", respondentCount],
    ["生徒名・ID", showStudentNames ? "出力あり" : "匿名で出力"],
  ];
  const blob = createXlsxBlob({
    sheets: [
      {
        name: "回答一覧",
        rows: answerRows,
        rowStyles: { 1: "header" },
        rowHeights: { 1: 34 },
        columnWidths: model.columns.map((column) => Math.max(9, Math.min(50, Math.round(column.width / 8)))),
        freezeRows: 1,
        autoFilterRow: 1,
      },
      {
        name: "実施情報",
        rows: infoRows,
        rowStyles: { 1: "title" },
        cellStyles: Object.fromEntries(infoRows.slice(1).map((_, index) => [`A${index + 2}`, "metaLabel"])),
        merges: ["A1:B1"],
        rowHeights: { 1: 32 },
        columnWidths: [18, 44],
      },
    ],
  });
  const privacySuffix = showStudentNames ? "記名" : "匿名";
  downloadBlob(blob, `${safeExcelFilename(run?.title, "フォーム回答")}_回答一覧_${privacySuffix}.xlsx`);
}

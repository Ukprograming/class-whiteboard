import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function arrayBufferFromBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

const tempDir = mkdtempSync(join(tmpdir(), "form-excel-test-"));
try {
  const xlsxModulePath = join(tempDir, "xlsx-utils.mjs");
  const formModulePath = join(tempDir, "form-excel.mjs");
  writeFileSync(xlsxModulePath, readFileSync("public/js/xlsx-utils.js", "utf8"));
  writeFileSync(
    formModulePath,
    readFileSync("public/js/form-excel.js", "utf8")
      .replace('./xlsx-utils.js?v=form-excel-20260831', "./xlsx-utils.mjs"),
  );

  const xlsx = await import(pathToFileURL(xlsxModulePath).href);
  const forms = await import(pathToFileURL(formModulePath).href);
  const templateBytes = readFileSync("public/templates/form-question-template.xlsx");
  const parsedTemplate = await forms.parseFormQuestionsWorkbook({
    name: "form-question-template.xlsx",
    arrayBuffer: async () => arrayBufferFromBuffer(templateBytes),
  });
  assert(parsedTemplate.title === "授業の振り返り（例）", "Template title did not round-trip.");
  assert(parsedTemplate.questions.length === 3, `Expected three example questions, got ${parsedTemplate.questions.length}.`);
  assert(
    JSON.stringify(parsedTemplate.questions.map((question) => question.questionType))
      === JSON.stringify(["text", "single_choice", "multiple_choice"]),
    "Template does not demonstrate all supported question types.",
  );

  const sourceQuestions = [
    { questionType: "text", prompt: "自由記述ですか？", required: true, options: [] },
    {
      questionType: "multiple_choice",
      prompt: "複数選んでください。",
      required: false,
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    },
  ];
  const questionRows = forms.buildFormQuestionRows({ title: "往復テスト", questions: sourceQuestions });
  const roundTripBlob = xlsx.createXlsxBlob({
    sheets: [{ name: forms.FORM_QUESTION_SHEET_NAME, rows: questionRows, rowStyles: { 1: "header" } }],
  });
  const roundTrip = await forms.parseFormQuestionsWorkbook({
    name: "round-trip.xlsx",
    arrayBuffer: async () => roundTripBlob.arrayBuffer(),
  });
  assert(roundTrip.title === "往復テスト", "Generated workbook title did not round-trip.");
  assert(roundTrip.questions[1].options.length === 2, "Choice options did not round-trip.");
  assert(roundTrip.questions[1].required === false, "Optional question flag did not round-trip.");

  const run = {
    title: "回答一覧",
    questions: [
      { id: "q1", position: 1, question_type: "text", prompt: "感想", options: [] },
      {
        id: "q2",
        position: 2,
        question_type: "single_choice",
        prompt: "理解度",
        options: [{ id: "yes", label: "理解できた" }, { id: "no", label: "難しい" }],
      },
    ],
  };
  const roster = [
    { id: "student-late", created_at: "2026-08-02T00:00:00Z", student_login_id: "s002", display_name: "後の生徒" },
    { id: "student-first", created_at: "2026-08-01T00:00:00Z", student_login_id: "s001", display_name: "先の生徒" },
  ];
  const responses = [
    { student_id: "student-first", run_question_id: "q1", answer_text: "回答1", selected_option_ids: [] },
    { student_id: "student-first", run_question_id: "q2", answer_text: null, selected_option_ids: ["yes"] },
  ];
  const anonymous = forms.buildResponseTableModel(run, responses, roster);
  assert(anonymous.columns.length === 3, "Anonymous table unexpectedly contains name columns.");
  assert(anonymous.rows[0].studentId === "student-first", "Roster is not ordered by registration time.");
  assert(anonymous.rows[0].values[1] === "回答1", "Text response was not placed in its question column.");
  assert(anonymous.rows[1].values[1] === "", "Unanswered student cell must remain blank.");
  const named = forms.buildResponseTableModel(run, responses, roster, { showStudentNames: true });
  assert(named.columns[1].label === "生徒ID" && named.columns[2].label === "表示名", "Named table columns are missing.");
  assert(named.rows[0].values[1] === "s001", "Student ID did not follow registration order.");

  const migration = readFileSync("supabase/migrations/20260831045725_allow_students_to_review_form_history.sql", "utf8");
  assert(migration.includes("form_runs_student_select_class"), "Closed form runs are not exposed to own-class students.");
  assert(migration.includes("form_run_questions_student_select_class"), "Closed run questions are not exposed to own-class students.");
  assert(!migration.includes("form_responses_student_select_class"), "Migration must not expose other students' responses.");

  console.log("Form Excel and history tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

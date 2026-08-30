import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const [
  migration,
  teacherHtml,
  studentHtml,
  teacherForms,
  studentForms,
  formApi,
  realtimeApi,
] = await Promise.all([
  read("supabase/migrations/20260830062951_add_class_forms.sql"),
  read("public/teacher.html"),
  read("public/student.html"),
  read("public/js/teacher-forms.js"),
  read("public/js/student-forms.js"),
  read("public/js/form-api.js"),
  read("public/js/supabase-api.js"),
]);

const tables = [
  "form_templates",
  "form_template_questions",
  "form_runs",
  "form_run_questions",
  "form_responses",
];

for (const table of tables) {
  assert.match(migration, new RegExp(`create table public\\.${table}\\b`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
}

assert.match(migration, /create unique index form_runs_one_open_per_class_idx[\s\S]*where status = 'open'/);
assert.match(migration, /constraint form_responses_question_student_key unique \(run_question_id, student_id\)/);
assert.match(migration, /create trigger form_responses_validate/);
assert.match(migration, /app_private\.current_student_id\(\)/);
assert.match(migration, /app_private\.is_student_in_class\(fr\.class_id\)/);
assert.doesNotMatch(migration, /public\.(?:is_teacher|is_class_teacher|current_student_id|is_student_in_class)\(/);
assert.match(migration, /alter publication supabase_realtime add table public\.form_responses/);

for (const id of [
  "formToggleBtn",
  "formPanel",
  "formTemplateList",
  "formLiveResults",
  "formEditorBackdrop",
  "formResultsBackdrop",
]) {
  assert.match(teacherHtml, new RegExp(`id="${id}"`));
}

for (const id of [
  "studentFormChip",
  "studentFormBackdrop",
  "studentFormQuestions",
  "studentFormProgress",
]) {
  assert.match(studentHtml, new RegExp(`id="${id}"`));
}

assert.match(teacherForms, /formApi\.startRun/);
assert.match(teacherForms, /formApi\.subscribeToResponses/);
assert.match(teacherForms, /className = "form-bar-fill"/);
assert.match(teacherForms, /anonymous: true/);
assert.match(studentForms, /socket\?\.on\("teacher-form-opened"/);
assert.match(studentForms, /formApi\.submitResponse/);
assert.match(formApi, /onConflict: "run_question_id,student_id"/);

for (const eventName of ["teacher-form-opened", "teacher-form-closed"]) {
  assert.ok(realtimeApi.split(`"${eventName}"`).length >= 4, `${eventName} is not wired through all realtime sets`);
}

console.log("Form feature contract tests passed.");

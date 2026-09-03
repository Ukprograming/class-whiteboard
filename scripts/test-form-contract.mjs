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
  uiIcons,
  styles,
  historyMigration,
  formExcel,
  imageMigration,
  historyDeletionMigration,
  historyDeletionGrantMigration,
  historyDeletionFunction,
] = await Promise.all([
  read("supabase/migrations/20260830062951_add_class_forms.sql"),
  read("public/teacher.html"),
  read("public/student.html"),
  read("public/js/teacher-forms.js"),
  read("public/js/student-forms.js"),
  read("public/js/form-api.js"),
  read("public/js/supabase-api.js"),
  read("public/js/ui-icons.js"),
  read("public/style.css"),
  read("supabase/migrations/20260831045725_allow_students_to_review_form_history.sql"),
  read("public/js/form-excel.js"),
  read("supabase/migrations/20260901043918_add_form_question_images.sql"),
  read("supabase/migrations/20260903233050_add_teacher_history_deletion.sql"),
  read("supabase/migrations/20260903233338_grant_history_deletion_service_role_tables.sql"),
  read("supabase/functions/delete-teacher-history/index.ts"),
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
  "formLiveStudentNamesToggle",
  "formLiveAggregateViewBtn",
  "formLiveTableViewBtn",
  "formLiveExportBtn",
  "formQuestionImportFile",
  "formEditorBackdrop",
  "formEditorExportBtn",
  "formResultsBackdrop",
  "formPresentedStudentNamesToggle",
  "formPresentedAggregateViewBtn",
  "formPresentedTableViewBtn",
  "formPresentedExportBtn",
]) {
  assert.match(teacherHtml, new RegExp(`id="${id}"`));
}

for (const id of [
  "studentFormChip",
  "studentFormBackdrop",
  "studentFormQuestions",
  "studentFormProgress",
  "studentFormActiveTab",
  "studentFormHistoryTab",
  "studentFormHistoryList",
  "studentFormHistoryDetail",
  "studentFormImageBackdrop",
  "studentFormImageFull",
  "studentFormImageCloseBtn",
]) {
  assert.match(studentHtml, new RegExp(`id="${id}"`));
}

assert.match(teacherForms, /formApi\.startRun/);
assert.match(teacherForms, /formApi\.subscribeToResponses/);
assert.match(teacherForms, /className = "form-bar-fill"/);
assert.match(teacherForms, /\{ showStudentNames = false \} = \{\}/);
assert.match(teacherForms, /if \(showStudentNames\)/);
assert.match(teacherForms, /let liveStudentNamesVisible = false/);
assert.match(teacherForms, /let presentedStudentNamesVisible = false/);
assert.doesNotMatch(teacherForms, /anonymous: true/);
assert.match(teacherForms, /replaceMaterialIcons\(questionEditorList\)/);
assert.match(teacherForms, /buildResponseTableModel/);
assert.match(teacherForms, /className = "form-column-resizer"/);
assert.match(teacherForms, /window\.addEventListener\("pointermove", move\)/);
assert.match(teacherForms, /resizer\.focus\(\{ preventScroll: true \}\)/);
assert.match(teacherForms, /parseFormQuestionsWorkbook/);
assert.match(teacherForms, /exportFormResponsesXlsx/);
assert.match(teacherForms, /formApi\.uploadQuestionImage/);
assert.match(teacherForms, /input\.dataset\.questionField = "image"/);
assert.match(teacherForms, /画像を追加/);
assert.match(teacherForms, /formApi\.getQuestionImageUrl/);
assert.match(teacherForms, /formApi\.deleteRunHistory/);
assert.match(teacherForms, /生徒の回答履歴・設問データ/);
assert.match(studentForms, /socket\?\.on\("teacher-form-opened"/);
assert.match(studentForms, /formApi\.submitResponse/);
assert.match(studentForms, /formApi\.listMyRunHistory/);
assert.match(studentForms, /自分の回答を見る/);
assert.match(studentForms, /appendQuestionImage/);
assert.match(studentForms, /formApi\.getQuestionImageUrl/);
assert.match(studentForms, /画像を拡大表示/);
assert.match(studentForms, /socket\?\.on\("teacher-history-deleted"/);
assert.match(formApi, /onConflict: "run_question_id,student_id"/);
assert.match(formApi, /async getRoster\(classCode\)/);
assert.match(formApi, /\.order\("created_at", \{ ascending: true \}\)/);
assert.match(formApi, /async listMyRunHistory\(limit = 100\)/);
assert.match(formApi, /async uploadQuestionImage/);
assert.match(formApi, /\.upload\(imagePath, file, \{/);
assert.match(formApi, /upsert: false/);
assert.match(formApi, /\.download\(imagePath\)/);
assert.match(formApi, /deleteTeacherHistory/);
assert.match(historyMigration, /form_runs_student_select_class/);
assert.match(historyMigration, /form_run_questions_student_select_class/);
assert.doesNotMatch(historyMigration, /form_responses_student_select_class/);
assert.match(formExcel, /FORM_QUESTION_SHEET_NAME = "フォーム設問"/);

for (const table of ["form_template_questions", "form_run_questions"]) {
  assert.match(imageMigration, new RegExp(`alter table public\\.${table}[\\s\\S]*add column image_path text`));
}
assert.match(imageMigration, /image_mime_type in \('image\/jpeg', 'image\/png', 'image\/webp', 'image\/gif'\)/);
assert.match(imageMigration, /image_width is not null/);
assert.match(imageMigration, /image_height is not null/);
assert.match(imageMigration, /create policy storage_form_student_read on storage\.objects/);
assert.match(imageMigration, /frq\.image_path = storage\.objects\.name/);
assert.match(imageMigration, /app_private\.is_student_in_class\(fr\.class_id\)/);
assert.match(imageMigration, /v_teacher_prefix := 'teachers\/' \|\| \(select auth\.uid\(\)\)::text \|\| '\/forms\/'/);
assert.match(imageMigration, /insert into public\.form_run_questions[\s\S]*ftq\.image_path[\s\S]*ftq\.image_height/);

for (const iconName of [
  "arrow_downward",
  "arrow_upward",
  "check_box_outline_blank",
  "fact_check",
  "radio_button_unchecked",
  "short_text",
]) {
  assert.match(uiIcons, new RegExp(`\\b${iconName}:`), `${iconName} is missing from the shared icon map`);
}

assert.match(styles, /\.form-editor-dialog,[\s\S]*width: min\(760px, 100%\)/);
assert.match(styles, /\.form-question-editor-actions \.app-icon/);
assert.match(styles, /\.form-name-toggle\[aria-checked="true"\]/);
assert.match(styles, /\.form-response-table/);
assert.match(styles, /\.form-column-resizer/);
assert.match(styles, /\.student-form-history-card/);
assert.match(styles, /\.form-question-image-editor/);
assert.match(styles, /\.student-form-question-image img/);
assert.match(styles, /\.student-form-image-backdrop/);
assert.match(teacherHtml, /form-images=20260901/);
assert.match(studentHtml, /form-images=20260901/);
assert.match(teacherHtml, /history-delete=20260904/);
assert.match(studentHtml, /history-delete=20260904/);

assert.match(historyDeletionMigration, /create or replace function public\.delete_teacher_history_records/);
assert.match(historyDeletionMigration, /delete from public\.board_files bf[\s\S]*bf\.distribution_id = bd\.id/);
assert.match(historyDeletionMigration, /delete from public\.form_runs/);
assert.match(historyDeletionMigration, /grant execute[\s\S]*to service_role/);
assert.doesNotMatch(historyDeletionMigration, /security definer/i);
assert.match(historyDeletionGrantMigration, /grant select on table[\s\S]*public\.form_runs[\s\S]*to service_role/);
assert.match(historyDeletionGrantMigration, /grant delete on table public\.form_runs to service_role/);
assert.match(historyDeletionFunction, /collectAssignmentStoragePaths/);
assert.match(historyDeletionFunction, /collectUnreferencedFormImagePaths/);
assert.match(historyDeletionFunction, /\.storage\.from\(STORAGE_BUCKET\)\.remove/);
assert.match(historyDeletionFunction, /delete_teacher_history_records/);

for (const eventName of ["teacher-form-opened", "teacher-form-closed", "teacher-history-deleted"]) {
  assert.ok(realtimeApi.split(`"${eventName}"`).length >= 4, `${eventName} is not wired through all realtime sets`);
}

console.log("Form feature contract tests passed.");

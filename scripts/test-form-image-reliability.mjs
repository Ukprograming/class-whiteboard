import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [teacherForms, formApi, cleanupFunction] = await Promise.all([
  readFile(new URL("public/js/teacher-forms.js", root), "utf8"),
  readFile(new URL("public/js/form-api.js", root), "utf8"),
  readFile(new URL("supabase/functions/cleanup-form-images/index.ts", root), "utf8"),
]);

const saveStart = teacherForms.indexOf("async function saveEditor()");
const saveEnd = teacherForms.indexOf("async function startTemplateRun", saveStart);
const saveEditor = teacherForms.slice(saveStart, saveEnd);

assert.ok(saveStart >= 0 && saveEnd > saveStart, "saveEditor source must be found");
assert.match(saveEditor, /saveAttempted = true;\s+await formApi\.saveTemplate/);
assert.match(saveEditor, /if \(saveAttempted\) \{\s+await formApi\.requestQuestionImageCleanup/);
assert.match(saveEditor, /else \{\s+await formApi\.removeQuestionImages/);
const refreshCatch = saveEditor.slice(
  saveEditor.indexOf("} catch (refreshError)"),
  saveEditor.indexOf("} catch (error)", saveEditor.indexOf("} catch (refreshError)")),
);
assert.doesNotMatch(refreshCatch, /removeQuestionImages/,
  "a refresh failure after commit must not directly remove uploaded images");
assert.match(saveEditor, /フォームは保存されましたが、一覧を更新できませんでした/);
assert.match(saveEditor, /保存結果を確認できませんでした。画像は保持しています/);
assert.match(saveEditor, /editorOriginalImagePaths\.filter/);
assert.match(saveEditor, /requestQuestionImageCleanup\(supersededPaths, "form_template_update"\)/);

assert.match(formApi, /functions\.invoke\("cleanup-form-images"/);
assert.match(formApi, /deleteTemplate\(templateId, imagePaths = \[\]\)/);
assert.match(formApi, /\.delete\(\)[\s\S]*\.select\("id"\)[\s\S]*if \(!deletedTemplate\)/);
assert.match(formApi, /requestQuestionImageCleanup\(imagePaths, "form_template_delete"\)/);

assert.match(cleanupFunction, /CLEANUP_GRACE_MS = 24 \* 60 \* 60 \* 1000/);
assert.match(cleanupFunction, /storage_cleanup_jobs/);
assert.match(cleanupFunction, /ignoreDuplicates: true/);
assert.match(cleanupFunction, /form_template_questions and form_run_questions/);
assert.doesNotMatch(cleanupFunction, /storage\.from\([\s\S]*\.remove\(/);
assert.match(cleanupFunction, /FORM_IMAGE_PATTERN\.exec\(path\)\?\.\[1\]/);

console.log("Form image reliability tests passed.");

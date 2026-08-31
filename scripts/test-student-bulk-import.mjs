import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tempDir = mkdtempSync(join(tmpdir(), "student-bulk-import-test-"));
try {
  const sourcePath = "public/js/student-bulk-import.js";
  const modulePath = join(tempDir, `${basename(sourcePath)}.mjs`);
  copyFileSync(sourcePath, modulePath);
  const {
    STUDENT_IMPORT_HEADERS,
    extractVisibleSpreadsheetText,
    parseStudentWorkbook,
    validateStudentImport,
  } = await import(pathToFileURL(modulePath).href);

  const phoneticSharedString = `
    <si>
      <t>氏名1</t>
      <rPh sb="0" eb="2"><t>シメイ</t></rPh>
      <phoneticPr fontId="1" type="fullwidthKatakana" />
    </si>
  `;
  assert(
    extractVisibleSpreadsheetText(phoneticSharedString) === "氏名1",
    "Excel phonetic text was appended to the visible display name.",
  );
  const richTextWithPhonetics = `
    <x:si>
      <x:r><x:t>氏名</x:t></x:r><x:r><x:t>1</x:t></x:r>
      <x:rPh sb="0" eb="2"><x:t>シメイ</x:t></x:rPh>
    </x:si>
  `;
  assert(
    extractVisibleSpreadsheetText(richTextWithPhonetics) === "氏名1",
    "Visible rich text was not preserved while removing namespaced phonetics.",
  );

  const templateBytes = readFileSync("public/templates/student-bulk-registration-template.xlsx");
  const templateBuffer = templateBytes.buffer.slice(
    templateBytes.byteOffset,
    templateBytes.byteOffset + templateBytes.byteLength,
  );
  const parsedTemplate = await parseStudentWorkbook({
    name: "student-bulk-registration-template.xlsx",
    arrayBuffer: async () => templateBuffer,
  });
  assert(
    JSON.stringify(parsedTemplate.headers) === JSON.stringify(STUDENT_IMPORT_HEADERS),
    `Template headers did not round-trip: ${JSON.stringify(parsedTemplate.headers)}`,
  );

  const valid = validateStudentImport({
    headers: STUDENT_IMPORT_HEADERS,
    rows: [
      { rowNumber: 2, values: ["S001", "佐藤 太郎", "password-001"] },
      { rowNumber: 3, values: ["s002", "鈴木 花子", "password-002"] },
      { rowNumber: 4, values: ["", "", ""] },
    ],
  });
  assert(valid.errors.length === 0, `Valid rows were rejected: ${JSON.stringify(valid.errors)}`);
  assert(valid.validRows.length === 2, `Expected 2 valid rows, got ${valid.validRows.length}`);
  assert(valid.validRows[0].studentLoginId === "s001", "Student ID was not normalized to lowercase.");

  const invalid = validateStudentImport({
    headers: STUDENT_IMPORT_HEADERS,
    rows: [
      { rowNumber: 2, values: ["s001", "佐藤 太郎", "short"] },
      { rowNumber: 3, values: ["S001", "鈴木 花子", "password-003"] },
      { rowNumber: 4, values: ["bad id", "", "password-004"] },
    ],
  }, [{ student_login_id: "existing" }]);
  assert(invalid.validRows.length === 0, "Invalid rows unexpectedly passed validation.");
  assert(invalid.errors.length === 3, `Expected 3 row errors, got ${invalid.errors.length}`);
  assert(invalid.errors[1].message.includes("2行目と生徒IDが重複"), "Duplicate row error was not reported.");

  const existing = validateStudentImport({
    headers: STUDENT_IMPORT_HEADERS,
    rows: [{ rowNumber: 2, values: ["EXISTING", "既存 生徒", "password-005"] }],
  }, [{ student_login_id: "existing" }]);
  assert(existing.errors[0]?.message.includes("登録済み"), "Existing class student was not rejected.");

  const wrongHeader = validateStudentImport({
    headers: ["ID", "表示名", "パスワード"],
    rows: [],
  });
  assert(wrongHeader.errors[0]?.rowNumber === 1, "Header mismatch was not reported at row 1.");

  console.log("Student bulk import tests passed.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

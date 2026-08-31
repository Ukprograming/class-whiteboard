import assert from "node:assert/strict";
import { mergeAssignmentBoardRows } from "../public/js/assignment-utils.mjs";

const boardFileId = "board-file-id";
const studentId = "student-id";
const [merged] = mergeAssignmentBoardRows(
  [{
    id: boardFileId,
    student_id: studentId,
    name: "課題1",
    folder_path: "",
  }],
  [{
    id: studentId,
    student_login_id: "student01",
    display_name: "生徒1",
    active: true,
  }]
);

assert.equal(merged.id, boardFileId, "The board row ID must not be overwritten by the roster ID.");
assert.equal(merged.board_file_id, boardFileId, "The board file ID must be stored explicitly.");
assert.equal(merged.student_id, studentId, "The student ID must remain available separately.");
assert.equal(merged.display_name, "生徒1", "Roster display data must still be merged.");

console.log("Assignment board/roster ID merge checks passed.");

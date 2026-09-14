import assert from "node:assert/strict";
import { chooseNewestStudentDraft } from "../public/js/student-draft-utils.mjs";

const draftKey = "class-a:student-a";
const oldSessionDraft = {
  draftKey,
  savedAt: "2026-09-12T01:00:00.000Z",
  boardData: { objects: [{ id: "old" }] },
};
const latestDatabaseDraft = {
  draftKey,
  savedAt: "2026-09-12T01:05:00.000Z",
  boardData: { objects: [{ id: "latest" }] },
};

assert.equal(
  chooseNewestStudentDraft([oldSessionDraft, latestDatabaseDraft], draftKey),
  latestDatabaseDraft,
  "a quota-stale session payload must not override the latest IndexedDB draft"
);
assert.equal(
  chooseNewestStudentDraft([{ draftKey, savedAt: "invalid", boardData: null }], draftKey),
  null
);
assert.equal(
  chooseNewestStudentDraft([{ ...latestDatabaseDraft, draftKey: "other" }], draftKey),
  null
);

console.log("Student draft selection utilities passed.");

function savedAtMillis(draft) {
  const timestamp = Date.parse(draft?.savedAt || "");
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
}

export function isUsableStudentDraft(draft, draftKey) {
  return Boolean(
    draft
    && draft.draftKey === draftKey
    && draft.boardData
    && typeof draft.boardData === "object"
  );
}

export function chooseNewestStudentDraft(candidates, draftKey) {
  return candidates
    .filter((draft) => isUsableStudentDraft(draft, draftKey))
    .sort((left, right) => savedAtMillis(right) - savedAtMillis(left))[0] || null;
}

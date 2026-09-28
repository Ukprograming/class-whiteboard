export function initManagementDeletion({ api, getClasses, getSelectedClassId, setBusy, onDeleted }) {
  const dialog = document.getElementById("managementDeletionDialog");
  const form = document.getElementById("managementDeletionForm");
  const error = document.getElementById("managementDeletionError");
  const confirmation = document.getElementById("managementDeletionConfirmation");
  const password = document.getElementById("managementDeletionPassword");
  const submit = document.getElementById("managementDeletionSubmit");
  let target = null;
  let busy = false;
  function close() {
    if (busy) return;
    dialog.close();
    form.reset();
    target = null;
  }
  function open(kind) {
    const classes = getClasses();
    const klass = classes.find(item => item.id === getSelectedClassId());
    if (kind === "class" && !klass) return;
    form.reset();
    error.textContent = "";
    target = { kind, classId: klass?.id, classes: kind === "class" ? [klass] : [...classes] };
    target.confirmation = kind === "class" ? klass.class_code : "アカウント削除";
    document.getElementById("managementDeletionTitle").textContent = kind === "class" ? "クラスを削除" : "自分の教員アカウントを削除";
    document.getElementById("managementDeletionWarning").textContent = kind === "class"
      ? "この操作は取り消せません。対象クラス、生徒アカウント、保存済みボード、課題、フォームの回答、画像・動画を削除します。他クラスで使用中の教材とフォームのひな型は残ります。"
      : "この操作は取り消せません。自分の教員アカウント、所有する全クラスと生徒アカウント、ボード、課題、フォーム、画像・動画を削除します。";
    document.getElementById("managementDeletionSummary").textContent = target.classes.length
      ? target.classes.map(item => `${item.name} (${item.class_code})`).join("\n")
      : "所有するクラスはありません。教員アカウントと保存データを削除します。";
    document.getElementById("managementDeletionConfirmationLabel").textContent = `確認のため「${target.confirmation}」と入力`;
    dialog.showModal();
    confirmation.focus();
  }
  document.getElementById("deleteClassBtn").addEventListener("click", () => open("class"));
  document.getElementById("deleteTeacherAccountBtn").addEventListener("click", () => open("teacher"));
  document.getElementById("managementDeletionCancel").addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !target) return;
    if (confirmation.value !== target.confirmation) {
      error.textContent = "確認文字が一致しません。";
      confirmation.focus();
      return;
    }
    busy = true;
    setBusy(true);
    error.textContent = "";
    for (const element of form.elements) element.disabled = true;
    submit.textContent = "削除中…";
    let result;
    const deletedTarget = target;
    try {
      result = await api.deleteManagementTarget({
        kind: target.kind, classId: target.classId,
        confirmation: confirmation.value, teacherPassword: password.value,
      });
    } catch (failure) {
      error.textContent = failure.message || "結果を確認できませんでした。管理画面を更新してください。";
    } finally {
      password.value = "";
      busy = false;
      for (const element of form.elements) element.disabled = false;
      submit.textContent = "完全に削除";
      setBusy(false);
    }
    if (result) {
      close();
      await onDeleted(deletedTarget, result);
    }
  });
}

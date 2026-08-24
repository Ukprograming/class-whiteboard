import { authApi, supabaseEnabled } from "./supabase-api.js?v=monitor-sync-20260819&realtime-scale=20260824";
import {
  getSelectedTeacherClass,
  getTeacherClassHints,
  setSelectedTeacherClass,
} from "./teacher-class-storage.js?v=teacher-auth-split-20260712";

const form = document.querySelector("[data-teacher-login-form]");
const emailInput = document.getElementById("teacherEmail");
const passwordInput = document.getElementById("teacherPassword");
const classSelect = document.getElementById("teacherClassSelect");
const classHelp = document.getElementById("teacherClassHelp");
const messageEl = document.getElementById("teacherLoginMessage");
const submitButton = form?.querySelector("button[type='submit']");
let loginInProgress = false;

function setMessage(message, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = message || "";
  messageEl.classList.toggle("is-error", isError);
}

function setLoginPending(isPending) {
  loginInProgress = isPending;
  if (submitButton) {
    submitButton.disabled = isPending;
    submitButton.textContent = isPending ? "ログイン中…" : "ログイン";
    submitButton.setAttribute("aria-busy", String(isPending));
  }
  if (isPending) {
    form?.setAttribute("aria-busy", "true");
  } else {
    form?.removeAttribute("aria-busy");
  }
}

function renderSavedClasses() {
  if (!classSelect) return;
  const classes = getTeacherClassHints();
  const selectedClass = getSelectedTeacherClass();
  classSelect.innerHTML = '<option value="">ログイン後にクラスを作成・選択</option>';
  for (const item of classes) {
    const option = document.createElement("option");
    option.value = item.classCode;
    option.textContent = item.label || item.classCode;
    classSelect.append(option);
  }
  if (classes.some((item) => item.classCode === selectedClass)) {
    classSelect.value = selectedClass;
  }
  if (classHelp) {
    classHelp.textContent = classes.length > 0
      ? `${classes.length}件のクラスをこの端末に保存しています。`
      : "保存済みクラスはありません。ログイン後にクラスを作成できます。";
  }
}

renderSavedClasses();

if (new URLSearchParams(window.location.search).get("registered") === "1") {
  setMessage("教員アカウントを作成しました。通常ログインしてください。");
}

if (form && supabaseEnabled) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginInProgress) return;

    setLoginPending(true);
    setMessage("ログイン中…");

    const email = emailInput?.value.trim();
    const password = passwordInput?.value || "";

    try {
      await authApi.signInTeacher(email, password);
      setSelectedTeacherClass(classSelect?.value);
      // The local Express server keeps the legacy session gate. This marker
      // lets the Supabase path load the page; teacher.js verifies the session.
      window.location.href = "./teacher.html?auth=supabase";
    } catch (error) {
      console.error(error);
      setMessage(error.message || "ログインに失敗しました。", true);
      setLoginPending(false);
    }
  });
} else if (form && !supabaseEnabled) {
  form.action = "/teacher/login";
  if (emailInput) emailInput.required = false;
  setMessage("Supabase未設定のため、既存サーバーのログインを使います。");
  form.addEventListener("submit", (event) => {
    if (loginInProgress) {
      event.preventDefault();
      return;
    }
    setLoginPending(true);
    setMessage("ログイン中…");
  });
}

import { authApi, supabaseEnabled } from "./supabase-api.js?v=multi-tab-presence-20260711";

const form = document.querySelector("[data-teacher-login-form]");
const emailInput = document.getElementById("teacherEmail");
const passwordInput = document.getElementById("teacherPassword");
const inviteInput = document.getElementById("teacherInviteCode");
const displayNameInput = document.getElementById("teacherDisplayName");
const authModeInput = document.getElementById("teacherAuthMode");
const authModeToggle = document.getElementById("teacherAuthModeToggle");
const messageEl = document.getElementById("teacherLoginMessage");

function setMessage(message) {
  if (messageEl) messageEl.textContent = message || "";
}

function setMode(mode) {
  if (!authModeInput) return;
  const nextMode = mode === "signup" ? "signup" : "signin";
  authModeInput.value = nextMode;
  document.body.dataset.teacherAuthMode = nextMode;
  if (inviteInput) inviteInput.required = nextMode === "signup";
  if (displayNameInput) displayNameInput.required = nextMode === "signup";
  if (authModeToggle) {
    authModeToggle.textContent = nextMode === "signup"
      ? "ログインに戻る"
      : "教員アカウントを作成";
  }
}

if (authModeToggle) {
  authModeToggle.addEventListener("click", () => {
    setMode(authModeInput?.value === "signup" ? "signin" : "signup");
  });
}

setMode("signin");

if (form && supabaseEnabled) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("処理中...");

    const email = emailInput?.value.trim();
    const password = passwordInput?.value || "";
    const mode = authModeInput?.value === "signup" ? "signup" : "signin";

    try {
      if (mode === "signup") {
        await authApi.signUpTeacher({
          email,
          password,
          displayName: displayNameInput?.value.trim() || email,
          inviteCode: inviteInput?.value.trim(),
        });
      }

      await authApi.signInTeacher(email, password);
      // The local Express server keeps the legacy session gate. This marker
      // lets the Supabase path load the page; teacher.js verifies the session.
      window.location.href = "./teacher.html?auth=supabase";
    } catch (error) {
      console.error(error);
      setMessage(error.message || "ログインに失敗しました。");
    }
  });
} else if (form && !supabaseEnabled) {
  if (emailInput) emailInput.required = false;
  if (inviteInput) inviteInput.required = false;
  if (displayNameInput) displayNameInput.required = false;
  setMessage("Supabase未設定のため、既存サーバーのログインを使います。");
}

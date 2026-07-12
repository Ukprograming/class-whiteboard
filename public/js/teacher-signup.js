import { authApi, supabaseEnabled } from "./supabase-api.js?v=pages-staging-20260712";

const form = document.querySelector("[data-teacher-signup-form]");
const emailInput = document.getElementById("teacherEmail");
const passwordInput = document.getElementById("teacherPassword");
const inviteInput = document.getElementById("teacherInviteCode");
const displayNameInput = document.getElementById("teacherDisplayName");
const messageEl = document.getElementById("teacherSignupMessage");
const teacherSignupEnabled = window.CLASS_WHITEBOARD_CONFIG?.teacherSignupEnabled === true;

function setMessage(message, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = message || "";
  messageEl.classList.toggle("is-error", isError);
}

if (!supabaseEnabled) {
  form?.querySelectorAll("input, button").forEach((element) => {
    element.disabled = true;
  });
  setMessage("Supabase未設定のため、教員アカウントを作成できません。", true);
} else if (!teacherSignupEnabled) {
  form?.querySelectorAll("input, button").forEach((element) => {
    element.disabled = true;
  });
  setMessage("現在、この環境では教員アカウントの新規作成を停止しています。", true);
} else if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("アカウントを作成しています...");

    try {
      await authApi.signUpTeacher({
        email: emailInput?.value.trim(),
        password: passwordInput?.value || "",
        displayName: displayNameInput?.value.trim(),
        inviteCode: inviteInput?.value.trim(),
      });
      window.location.href = "./teacher-login.html?registered=1";
    } catch (error) {
      console.error(error);
      setMessage(error.message || "アカウントを作成できませんでした。", true);
    }
  });
}

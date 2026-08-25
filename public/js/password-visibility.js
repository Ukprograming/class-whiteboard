(function initializePasswordVisibility() {
  const buttons = document.querySelectorAll("[data-password-visibility]");

  for (const button of buttons) {
    const inputId = button.getAttribute("aria-controls");
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) continue;

    const activeReasons = new Set();

    const render = () => {
      const visible = activeReasons.size > 0;
      input.type = visible ? "text" : "password";
      button.dataset.visible = String(visible);
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", visible ? "パスワードを隠す" : "パスワードを表示");
    };

    const showFor = (reason) => {
      activeReasons.add(reason);
      render();
    };

    const hideFor = (reason) => {
      activeReasons.delete(reason);
      render();
    };

    button.addEventListener("mouseenter", () => showFor("hover"));
    button.addEventListener("mouseleave", () => {
      hideFor("hover");
      hideFor("pointer");
    });
    button.addEventListener("pointerdown", () => showFor("pointer"));
    button.addEventListener("pointerup", () => hideFor("pointer"));
    button.addEventListener("pointercancel", () => hideFor("pointer"));
    button.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") showFor("keyboard");
      if (event.key === "Escape") activeReasons.clear();
      render();
    });
    button.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") hideFor("keyboard");
    });
    button.addEventListener("blur", () => {
      hideFor("keyboard");
      hideFor("pointer");
    });
    window.addEventListener("blur", () => {
      activeReasons.clear();
      render();
    });

    render();
  }
})();

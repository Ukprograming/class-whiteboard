const ICONS = {
  add: `<path d="M12 5v14M5 12h14"/>`,
  add_reaction: `<path d="M7.5 10.5a6.5 6.5 0 1 0 8 6.3"/><path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2"/><path d="M8.5 9h.01M13.5 9h.01"/><path d="M18 4v6M15 7h6"/>`,
  arrow_selector_tool: `<path d="M6 4l10 15 1.7-6.1 5.3-2.9L6 4Z"/><path d="M14.5 13.5l4.5 4.5"/>`,
  assignment: `<path d="M8 4h8l2 2v14H6V6l2-2Z"/><path d="M9 10h6M9 14h6M9 18h4"/>`,
  chat: `<path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8.5 10h7M8.5 13h4"/>`,
  chevron_left: `<path d="M15 6l-6 6 6 6"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  delete: `<path d="M5 7h14M9 7V5h6v2M8 10l.7 9h6.6l.7-9"/><path d="M10.5 11.5v5M13.5 11.5v5"/>`,
  edit: `<path d="M5 18.5l1-4.5L16.5 3.5l4 4L10 18l-5 1Z"/><path d="M14.5 5.5l4 4"/>`,
  edit_note: `<path d="M5 6h10M5 10h8M5 14h6"/><path d="M14 20l1-4 4.5-4.5 3 3L18 19l-4 1Z"/>`,
  flip_to_back: `<path d="M5 9h10v10H5V9Z"/><path d="M9 5h10v10"/><path d="M12 5h7v7"/>`,
  flip_to_front: `<path d="M9 5h10v10H9V5Z"/><path d="M5 9v10h10"/><path d="M5 12v7h7"/>`,
  folder_open: `<path d="M3.5 8h6l1.7 2H21l-2 8H5L3.5 8Z"/><path d="M4.5 8V6h5l1.5 2"/>`,
  format_align_center: `<path d="M6 6h12M8 10h8M6 14h12M8 18h8"/>`,
  format_align_left: `<path d="M5 6h14M5 10h10M5 14h14M5 18h10"/>`,
  format_align_right: `<path d="M5 6h14M9 10h10M5 14h14M9 18h10"/>`,
  format_bold: `<path d="M8 5h5.5a3.3 3.3 0 0 1 0 6.6H8V5Z"/><path d="M8 11.6h6.2a3.7 3.7 0 0 1 0 7.4H8v-7.4Z"/>`,
  grid_view: `<path d="M5 5h6v6H5V5ZM13 5h6v6h-6V5ZM5 13h6v6H5v-6ZM13 13h6v6h-6v-6Z"/>`,
  group_work: `<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="12" cy="16" r="3"/><path d="M10.6 9.8l1.4 3M13.4 9.8l-1.4 3"/>`,
  image: `<path d="M5 5h14v14H5V5Z"/><path d="M7.5 16l3.5-4 2.5 2.7 2-2.2 2 3.5"/><circle cx="9" cy="9" r="1.2"/>`,
  ink_eraser: `<path d="M6 16l8.5-8.5a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L12 18H8l-2-2Z"/><path d="M11 11l4 4M4 20h16"/>`,
  ink_highlighter: `<path d="M5 18l2.5-6.5L15.5 3.5l5 5-8 8L6 19l-1-1Z"/><path d="M13.5 5.5l5 5M4 21h16"/>`,
  lock: `<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M9 10V7.5a3 3 0 0 1 6 0V10"/>`,
  menu: `<path d="M5 7h14M5 12h14M5 17h14"/>`,
  picture_as_pdf: `<path d="M7 4h8l3 3v13H7V4Z"/><path d="M15 4v4h4"/><path d="M9 16v-4h1.5a1.2 1.2 0 1 1 0 2H9M12.5 16v-4h1.2a2 2 0 0 1 0 4h-1.2M16 16v-4h2"/>`,
  remove: `<path d="M5 12h14"/>`,
  save: `<path d="M5 5h12l2 2v12H5V5Z"/><path d="M8 5v5h8V5M8 19v-6h8v6"/>`,
  screen_share: `<path d="M4 5h16v11H4V5Z"/><path d="M9 20h6M12 16v4"/><path d="M10 12l4-4M14 8v4M14 8h-4"/>`,
  send: `<path d="M4 11l16-7-6 16-3-7-7-2Z"/><path d="M11 13l4-4"/>`,
  shapes: `<rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/><circle cx="16.5" cy="8" r="3.5"/><path d="M12 14l4 6H8l4-6Z"/>`,
  sticky_note_2: `<path d="M6 5h12v9l-5 5H6V5Z"/><path d="M13 19v-5h5"/><path d="M9 9h6M9 12h4"/>`,
  title: `<path d="M5 6h14M12 6v12M8 18h8"/>`,
  undo: `<path d="M9 7l-5 5 5 5"/><path d="M5 12h8a5 5 0 0 1 0 10h-1"/>`,
};

function makeIconSvg(name) {
  const paths = ICONS[name] || ICONS.menu;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("app-icon");
  svg.innerHTML = paths;
  return svg;
}

export function replaceMaterialIcons(root = document) {
  root
    .querySelectorAll(".material-symbols-rounded, .material-symbols-outlined")
    .forEach((el) => {
      if (el.dataset.iconReady === "true") return;
      const iconName = (el.textContent || "").trim();
      el.textContent = "";
      el.appendChild(makeIconSvg(iconName));
      el.dataset.iconReady = "true";
      el.dataset.iconName = iconName;
    });
}

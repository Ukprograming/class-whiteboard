const ICON_ALIASES = {
  add: "plus",
  add_reaction: "smile-plus",
  arrow_selector_tool: "mouse-pointer-2",
  assignment: "clipboard-list",
  chat: "message-circle",
  chevron_left: "chevron-left",
  close: "x",
  delete: "trash-2",
  edit: "pencil",
  edit_note: "square-pen",
  flip_to_back: "send-to-back",
  flip_to_front: "bring-to-front",
  folder_open: "folder-open",
  format_align_center: "align-center",
  format_align_left: "align-left",
  format_align_right: "align-right",
  format_bold: "bold",
  grid_4x4: "grid-3x3",
  grid_view: "layout-grid",
  group_work: "users-round",
  image: "image",
  ink_eraser: "eraser",
  ink_highlighter: "highlighter",
  lock: "lock",
  menu: "menu",
  picture_as_pdf: "file-text",
  remove: "minus",
  save: "save",
  screen_share: "screen-share",
  send: "send",
  shapes: "shapes",
  sticky_note_2: "sticky-note",
  title: "type",
  undo: "undo-2",
};

const LUCIDE_ICONS = {
  "align-center": `<path d="M17 12H7"/><path d="M19 18H5"/><path d="M21 6H3"/>`,
  "align-left": `<path d="M15 12H3"/><path d="M17 18H3"/><path d="M21 6H3"/>`,
  "align-right": `<path d="M21 12H9"/><path d="M21 18H7"/><path d="M21 6H3"/>`,
  bold: `<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>`,
  "bring-to-front": `<rect x="8" y="8" width="8" height="8" rx="2"/><path d="M4 10V7a3 3 0 0 1 3-3h3"/><path d="M14 4h3a3 3 0 0 1 3 3v3"/><path d="M20 14v3a3 3 0 0 1-3 3h-3"/><path d="M10 20H7a3 3 0 0 1-3-3v-3"/>`,
  "chevron-left": `<path d="m15 18-6-6 6-6"/>`,
  "clipboard-list": `<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>`,
  eraser: `<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4L13.4 2.6c1-1 2.5-1 3.4 0l4.6 4.6c1 1 1 2.5 0 3.4L11 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>`,
  "file-text": `<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
  "grid-3x3": `<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>`,
  "folder-open": `<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6A2 2 0 0 1 18.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>`,
  highlighter: `<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/><path d="m14 4 7 7"/><path d="M7.5 16.5 13 22"/>`,
  image: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>`,
  "layout-grid": `<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>`,
  lock: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  menu: `<path d="M4 12h16"/><path d="M4 18h16"/><path d="M4 6h16"/>`,
  "message-circle": `<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>`,
  minus: `<path d="M5 12h14"/>`,
  "mouse-pointer-2": `<path d="M4 4 13 21l1.8-7.2L22 12Z"/>`,
  pencil: `<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L4 16v4h4Z"/><path d="m14.5 5.5 4 4"/>`,
  plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
  save: `<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8A2 2 0 0 1 21 8.8V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>`,
  "screen-share": `<path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m17 8 5-5"/><path d="M17 3h5v5"/>`,
  send: `<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>`,
  "send-to-back": `<rect x="8" y="8" width="8" height="8" rx="2"/><path d="M4 4h.01"/><path d="M8 4h.01"/><path d="M12 4h.01"/><path d="M16 4h.01"/><path d="M20 4h.01"/><path d="M4 8h.01"/><path d="M4 12h.01"/><path d="M4 16h.01"/><path d="M4 20h.01"/><path d="M8 20h.01"/><path d="M12 20h.01"/><path d="M16 20h.01"/><path d="M20 20h.01"/><path d="M20 8h.01"/><path d="M20 12h.01"/><path d="M20 16h.01"/>`,
  shapes: `<path d="M8.3 10a.7.7 0 0 1-.6-1.1l2.2-3.5a.7.7 0 0 1 1.2 0l2.2 3.5a.7.7 0 0 1-.6 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>`,
  "smile-plus": `<path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/><path d="M16 5h6"/><path d="M19 2v6"/>`,
  "square-pen": `<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z"/>`,
  "sticky-note": `<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>`,
  "trash-2": `<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>`,
  type: `<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>`,
  "undo-2": `<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`,
  "users-round": `<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.4-2-6.5-4-8a5 5 0 0 0-.5-8.3"/>`,
  x: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
};

function makeIconSvg(name) {
  const lucideName = ICON_ALIASES[name] || name;
  const paths = LUCIDE_ICONS[lucideName] || LUCIDE_ICONS.menu;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.lucide = lucideName;
  svg.classList.add("app-icon", "lucide-icon");
  svg.innerHTML = paths;
  return svg;
}

export function replaceMaterialIcons(root = document) {
  root
    .querySelectorAll(".material-symbols-rounded, .material-symbols-outlined")
    .forEach((el) => {
      if (el.dataset.iconReady === "true") return;
      const iconName = (el.textContent || "").trim();
      const lucideName = ICON_ALIASES[iconName] || iconName;
      el.textContent = "";
      el.appendChild(makeIconSvg(iconName));
      el.dataset.iconReady = "true";
      el.dataset.iconName = iconName;
      el.dataset.lucide = lucideName;
    });
}

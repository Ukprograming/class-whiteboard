export const STAMP_PRESETS = Object.freeze({
  "star-yellow": { label: "スター", baseSize: 80, accent: "#f59e0b" },
  "circle-ok": { label: "丸", baseSize: 80, accent: "#ef4444" },
  "cross-ng": { label: "バツ", baseSize: 80, accent: "#ef4444" },
  "maru-hanamaru": { label: "花丸", baseSize: 80, accent: "#e11d48" },
  check: { label: "チェック", baseSize: 80, accent: "#16a34a" },
  question: { label: "質問", baseSize: 80, accent: "#2563eb" },
  exclamation: { label: "注目", baseSize: 80, accent: "#f97316" },
  lightbulb: { label: "ひらめき", baseSize: 80, accent: "#eab308" },
  pin: { label: "ピン", baseSize: 80, accent: "#dc2626" },
  clap: { label: "拍手", baseSize: 80, accent: "#f59e0b" },
  good: { label: "いいね", baseSize: 80, accent: "#2563eb" },
  fire: { label: "熱い", baseSize: 80, accent: "#f97316" },
  megaphone: { label: "注目", baseSize: 80, accent: "#0f766e" },
  excellent: { label: "優秀", baseSize: 80, accent: "#ca8a04" },
  pencil: { label: "書く", baseSize: 80, accent: "#64748b" },
  note: { label: "メモ", baseSize: 80, accent: "#0284c7" },
  "100": { label: "100", baseSize: 80, accent: "#ef4444" },
  sparkle: { label: "きらめき", baseSize: 80, accent: "#a855f7" },
});

const stampImageCache = new Map();

const line = "stroke-linecap='round' stroke-linejoin='round'";
const softShadow = "filter='url(#stampShadow)'";

function shell(content, bg = "#fff7ed", ring = "#f8fafc") {
  return `
    <defs>
      <filter id="stampShadow" x="-20%" y="-20%" width="140%" height="145%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.18"/>
      </filter>
      <linearGradient id="shine" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.92"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0.12"/>
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="29" fill="${ring}" opacity="0.92"/>
    <circle cx="32" cy="32" r="26" fill="${bg}" ${softShadow}/>
    <path d="M15 21c7-9 25-12 35-1" fill="none" stroke="url(#shine)" stroke-width="5" ${line} opacity="0.7"/>
    ${content}
  `;
}

const STAMP_SVG = {
  "star-yellow": shell(`
    <path d="M32 12l5.7 11.5 12.7 1.8-9.2 9 2.2 12.6L32 41l-11.4 6 2.2-12.6-9.2-9 12.7-1.8L32 12Z"
      fill="#fbbf24" stroke="#92400e" stroke-width="3" ${line}/>
    <path d="M28 24l4-8 4 8" fill="none" stroke="#fde68a" stroke-width="2.6" ${line}/>
  `, "#fffbeb", "#fef3c7"),

  "circle-ok": shell(`
    <circle cx="32" cy="32" r="18" fill="none" stroke="#ef4444" stroke-width="7"/>
    <circle cx="32" cy="32" r="10" fill="none" stroke="#fecaca" stroke-width="2.4"/>
  `, "#fff1f2", "#ffe4e6"),

  "cross-ng": shell(`
    <path d="M21 21l22 22M43 21L21 43" stroke="#ef4444" stroke-width="8" ${line}/>
    <path d="M21 21l22 22M43 21L21 43" stroke="#fee2e2" stroke-width="2.4" ${line}/>
  `, "#fff1f2", "#fee2e2"),

  "maru-hanamaru": shell(`
    <g fill="#fb7185" stroke="#be123c" stroke-width="2" ${line}>
      <circle cx="32" cy="13" r="7"/>
      <circle cx="45" cy="19" r="7"/>
      <circle cx="50" cy="33" r="7"/>
      <circle cx="41" cy="46" r="7"/>
      <circle cx="24" cy="47" r="7"/>
      <circle cx="14" cy="34" r="7"/>
      <circle cx="18" cy="19" r="7"/>
    </g>
    <circle cx="32" cy="32" r="13" fill="#fff7ed" stroke="#be123c" stroke-width="3"/>
    <path d="M24 33l5 5 11-13" fill="none" stroke="#be123c" stroke-width="4" ${line}/>
  `, "#fff1f2", "#ffe4e6"),

  check: shell(`
    <circle cx="32" cy="32" r="18" fill="#bbf7d0" stroke="#16a34a" stroke-width="3"/>
    <path d="M21 33l7 7 16-18" fill="none" stroke="#15803d" stroke-width="6" ${line}/>
  `, "#ecfdf5", "#dcfce7"),

  question: shell(`
    <path d="M24 25a8.5 8.5 0 1 1 13 7.2c-3.2 2-4.3 3.5-4.3 7.3" fill="none" stroke="#1d4ed8" stroke-width="5" ${line}/>
    <circle cx="32.5" cy="48" r="3.5" fill="#2563eb"/>
  `, "#eff6ff", "#dbeafe"),

  exclamation: shell(`
    <path d="M32 17v24" stroke="#c2410c" stroke-width="7" ${line}/>
    <circle cx="32" cy="49" r="3.7" fill="#f97316"/>
  `, "#fff7ed", "#ffedd5"),

  lightbulb: shell(`
    <path d="M22 29a10 10 0 1 1 20 0c0 5.8-4.8 7.3-5.2 12.4H27.2C26.8 36.3 22 34.8 22 29Z"
      fill="#fde68a" stroke="#a16207" stroke-width="3" ${line}/>
    <path d="M27 46h10M29 51h6M31 15v-4M20 20l-3-3M44 20l3-3" stroke="#a16207" stroke-width="3" ${line}/>
    <path d="M31 24l-3 6h5l-3 8 8-11h-6l3-6" fill="none" stroke="#ca8a04" stroke-width="2.5" ${line}/>
  `, "#fffbeb", "#fef3c7"),

  pin: shell(`
    <path d="M25 12h17l-3 18 8 8-12 2-8 14-2-16-11-6 9-7 2-13Z"
      fill="#f87171" stroke="#991b1b" stroke-width="3" ${line}/>
    <path d="M34 39l-8 15" stroke="#991b1b" stroke-width="3" ${line}/>
  `, "#fff1f2", "#fee2e2"),

  clap: shell(`
    <path d="M19 31l9 18c1.9 3.7 7.4 3.1 8.6-.7L40 34" fill="#fed7aa" stroke="#9a3412" stroke-width="3" ${line}/>
    <path d="M28 36l-7-20a4 4 0 0 1 7.5-2.8L36 32M37 34l5-15a4 4 0 0 1 7.6 2.6l-7 21"
      fill="#fdba74" stroke="#9a3412" stroke-width="3" ${line}/>
    <path d="M15 16l-5-5M19 10l-1-7M47 13l4-6" stroke="#f59e0b" stroke-width="3" ${line}/>
  `, "#fff7ed", "#ffedd5"),

  good: shell(`
    <path d="M24 30l8-17a5 5 0 0 1 6 6l-3 7h11a6 6 0 0 1 5.8 7.5l-4 14A7 7 0 0 1 41 53H24V30Z"
      fill="#bfdbfe" stroke="#1d4ed8" stroke-width="3" ${line}/>
    <path d="M12 30h11v23H12V30Z" fill="#60a5fa" stroke="#1d4ed8" stroke-width="3" ${line}/>
  `, "#eff6ff", "#dbeafe"),

  fire: shell(`
    <path d="M34 55c11-4 16-13 12-24-3 4-7 5-10 4 5-11-1-20-10-26 1 10-8 15-10 24-2 10 5 19 18 22Z"
      fill="#fb923c" stroke="#9a3412" stroke-width="3" ${line}/>
    <path d="M33 50c6-3 8-8 5-14-2 3-5 4-7 3 2-6-1-10-5-13 1 7-6 10-6 17 0 5 5 8 13 7Z" fill="#fde68a"/>
  `, "#fff7ed", "#ffedd5"),

  megaphone: shell(`
    <path d="M15 34h10l23 11V19L25 30H15v4Z" fill="#99f6e4" stroke="#0f766e" stroke-width="3" ${line}/>
    <path d="M18 35l4 13h8l-5-13M51 25l5-4M52 32h6M51 40l5 4" fill="none" stroke="#0f766e" stroke-width="3" ${line}/>
  `, "#ecfdf5", "#ccfbf1"),

  excellent: shell(`
    <path d="M22 15h20v9a10 10 0 0 1-20 0V15Z" fill="#fde68a" stroke="#854d0e" stroke-width="3" ${line}/>
    <path d="M23 20H13c0 8 4.5 12 10 12M41 20h10c0 8-4.5 12-10 12M32 35v10M24 51h16"
      fill="none" stroke="#854d0e" stroke-width="3" ${line}/>
    <path d="M32 19l3 5.8 6.4.8-4.6 4.4 1.2 6.3-6-3.1-6 3.1 1.2-6.3-4.6-4.4 6.4-.8L32 19Z" fill="#f59e0b"/>
  `, "#fffbeb", "#fef3c7"),

  pencil: shell(`
    <path d="M14 45l5 5 30-30-5-5-30 30Z" fill="#e2e8f0" stroke="#334155" stroke-width="3" ${line}/>
    <path d="M40 19l5-5 5 5-5 5" fill="#fb7185" stroke="#334155" stroke-width="3" ${line}/>
    <path d="M14 45l-3 9 8-4" fill="#fbbf24" stroke="#334155" stroke-width="3" ${line}/>
  `, "#f8fafc", "#e2e8f0"),

  note: shell(`
    <path d="M17 10h28l6 6v39H17V10Z" fill="#e0f2fe" stroke="#0369a1" stroke-width="3" ${line}/>
    <path d="M45 10v9h8M24 25h18M24 33h18M24 41h11" stroke="#0369a1" stroke-width="3" ${line}/>
  `, "#f0f9ff", "#e0f2fe"),

  "100": shell(`
    <rect x="10" y="15" width="44" height="34" rx="9" fill="#fee2e2" stroke="#dc2626" stroke-width="3"/>
    <text x="32" y="38" text-anchor="middle" font-size="19" font-weight="900" font-family="Arial, sans-serif" fill="#b91c1c">100</text>
    <path d="M18 49h28" stroke="#dc2626" stroke-width="3" ${line}/>
  `, "#fff1f2", "#fee2e2"),

  sparkle: shell(`
    <path d="M32 9l5 16 16 5-16 5-5 16-5-16-16-5 16-5 5-16Z" fill="#e9d5ff" stroke="#7e22ce" stroke-width="3" ${line}/>
    <path d="M49 10l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6ZM15 42l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z"
      fill="#f5d0fe" stroke="#7e22ce" stroke-width="2" ${line}/>
  `, "#faf5ff", "#f3e8ff"),
};

export function stampSvgMarkup(key, size = 64) {
  const safeKey = STAMP_SVG[key] ? key : "star-yellow";
  const label = STAMP_PRESETS[safeKey].label;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${label}">${STAMP_SVG[safeKey]}</svg>`;
}

export function createStampElement(key) {
  const template = document.createElement("template");
  template.innerHTML = stampSvgMarkup(key).trim();
  return template.content.firstElementChild;
}

function getStampImage(key, onReady) {
  const safeKey = STAMP_SVG[key] ? key : "star-yellow";
  let image = stampImageCache.get(safeKey);
  if (image) return image;

  image = new Image();
  image.decoding = "async";
  image.onload = () => {
    if (typeof onReady === "function") onReady();
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stampSvgMarkup(safeKey, 128))}`;
  stampImageCache.set(safeKey, image);
  return image;
}

export function drawStamp(ctx, key, x, y, width, height, onReady) {
  const image = getStampImage(key, onReady);
  if (image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, x, y, width, height);
    return;
  }

  const preset = STAMP_PRESETS[key] || STAMP_PRESETS["star-yellow"];
  ctx.save();
  ctx.fillStyle = "#fff7ed";
  ctx.strokeStyle = preset.accent || "#64748b";
  ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.06);
  ctx.beginPath();
  const rx = x + width * 0.1;
  const ry = y + height * 0.1;
  const rw = width * 0.8;
  const rh = height * 0.8;
  const radius = width * 0.16;
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(rx, ry, rw, rh, radius);
  } else {
    ctx.rect(rx, ry, rw, rh);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = preset.accent || "#334155";
  ctx.font = `700 ${Math.max(12, width * 0.18)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(preset.label.slice(0, 3), x + width / 2, y + height / 2);
  ctx.restore();
}

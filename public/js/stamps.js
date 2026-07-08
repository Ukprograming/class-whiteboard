export const STAMP_PRESETS = Object.freeze({
  "star-yellow": { label: "スター", baseSize: 80, accent: "#f5b81b" },
  "circle-ok": { label: "丸", baseSize: 80, accent: "#ef4444" },
  "cross-ng": { label: "バツ", baseSize: 80, accent: "#ef4444" },
  "maru-hanamaru": { label: "花丸", baseSize: 80, accent: "#e11d48" },
  check: { label: "チェック", baseSize: 80, accent: "#16a34a" },
  question: { label: "質問", baseSize: 80, accent: "#2563eb" },
  exclamation: { label: "注意", baseSize: 80, accent: "#f97316" },
  lightbulb: { label: "ひらめき", baseSize: 80, accent: "#facc15" },
  pin: { label: "ピン", baseSize: 80, accent: "#dc2626" },
  clap: { label: "拍手", baseSize: 80, accent: "#f59e0b" },
  good: { label: "いいね", baseSize: 80, accent: "#2563eb" },
  fire: { label: "熱い", baseSize: 80, accent: "#f97316" },
  megaphone: { label: "注目", baseSize: 80, accent: "#0f766e" },
  excellent: { label: "優秀", baseSize: 80, accent: "#ca8a04" },
  pencil: { label: "書く", baseSize: 80, accent: "#64748b" },
  note: { label: "メモ", baseSize: 80, accent: "#38bdf8" },
  100: { label: "100", baseSize: 80, accent: "#ef4444" },
  sparkle: { label: "きらめき", baseSize: 80, accent: "#a855f7" },
});

const stampImageCache = new Map();

const common = {
  bg: "#fffaf0",
  ink: "#1f2937",
  soft: "#f8fafc",
  line: "stroke-linecap='round' stroke-linejoin='round'",
};

const STAMP_SVG = {
  "star-yellow": `<path d="M32 7l6.7 15 16.3 1.6-12.2 10.9 3.6 16-14.4-8.3-14.4 8.3 3.6-16L9 23.6 25.3 22 32 7Z" fill="#fbbf24" stroke="#92400e" stroke-width="3" ${common.line}/><path d="M25 28l7-14 7 14" fill="none" stroke="#fde68a" stroke-width="2" ${common.line}/>` ,
  "circle-ok": `<circle cx="32" cy="32" r="22" fill="none" stroke="#ef4444" stroke-width="8"/><circle cx="32" cy="32" r="14" fill="none" stroke="#fecaca" stroke-width="2"/>`,
  "cross-ng": `<path d="M17 17l30 30M47 17L17 47" stroke="#ef4444" stroke-width="10" ${common.line}/><path d="M17 17l30 30M47 17L17 47" stroke="#fee2e2" stroke-width="3" ${common.line}/>` ,
  "maru-hanamaru": `<g fill="#fb7185" stroke="#be123c" stroke-width="2" ${common.line}><circle cx="32" cy="13" r="8"/><circle cx="46" cy="19" r="8"/><circle cx="51" cy="34" r="8"/><circle cx="41" cy="47" r="8"/><circle cx="24" cy="47" r="8"/><circle cx="13" cy="34" r="8"/><circle cx="18" cy="19" r="8"/></g><circle cx="32" cy="32" r="14" fill="#fff7ed" stroke="#be123c" stroke-width="3"/><path d="M24 33l5 5 11-13" fill="none" stroke="#be123c" stroke-width="4" ${common.line}/>` ,
  check: `<circle cx="32" cy="32" r="25" fill="#dcfce7" stroke="#16a34a" stroke-width="3"/><path d="M18 33l9 9 19-22" fill="none" stroke="#15803d" stroke-width="7" ${common.line}/>` ,
  question: `<circle cx="32" cy="32" r="25" fill="#dbeafe" stroke="#2563eb" stroke-width="3"/><path d="M24 24a8 8 0 1 1 12 7c-3 1.7-4 3.4-4 7" fill="none" stroke="#1d4ed8" stroke-width="5" ${common.line}/><circle cx="32" cy="47" r="3.5" fill="#1d4ed8"/>`,
  exclamation: `<circle cx="32" cy="32" r="25" fill="#ffedd5" stroke="#f97316" stroke-width="3"/><path d="M32 17v23" stroke="#c2410c" stroke-width="7" ${common.line}/><circle cx="32" cy="48" r="3.5" fill="#c2410c"/>`,
  lightbulb: `<path d="M21 29a11 11 0 1 1 22 0c0 6-5 8-5 13H26c0-5-5-7-5-13Z" fill="#fde68a" stroke="#a16207" stroke-width="3" ${common.line}/><path d="M26 47h12M28 53h8M30 23l-4 6h6l-3 8 8-11h-7l4-7" fill="none" stroke="#a16207" stroke-width="3" ${common.line}/>` ,
  pin: `<path d="M25 10h18l-4 22 8 8-13 2-8 14-2-17-12-7 10-7 3-15Z" fill="#f87171" stroke="#991b1b" stroke-width="3" ${common.line}/><path d="M34 40l-8 14" stroke="#991b1b" stroke-width="3" ${common.line}/>` ,
  clap: `<path d="M18 31l9 18c1.8 3.6 7.4 3.2 8.6-.6L40 34" fill="#fed7aa" stroke="#9a3412" stroke-width="3" ${common.line}/><path d="M28 36l-7-20a4 4 0 0 1 7.5-2.8L36 32M37 34l5-15a4 4 0 0 1 7.6 2.6l-7 21" fill="#fdba74" stroke="#9a3412" stroke-width="3" ${common.line}/><path d="M15 16l-5-5M18 10l-1-7M46 12l4-6" stroke="#f59e0b" stroke-width="3" ${common.line}/>` ,
  good: `<path d="M25 29l8-17a5 5 0 0 1 6 6l-3 8h12a6 6 0 0 1 5.8 7.6l-4 14A7 7 0 0 1 43 53H25V29Z" fill="#bfdbfe" stroke="#1d4ed8" stroke-width="3" ${common.line}/><path d="M11 29h12v24H11V29Z" fill="#60a5fa" stroke="#1d4ed8" stroke-width="3" ${common.line}/>` ,
  fire: `<path d="M34 55c12-4 17-13 13-24-3 4-7 5-10 4 5-11-1-20-10-26 1 10-8 15-10 24-2 10 5 19 17 22Z" fill="#fb923c" stroke="#9a3412" stroke-width="3" ${common.line}/><path d="M33 50c6-3 8-8 5-14-2 3-5 4-7 3 2-6-1-10-5-13 1 7-6 10-6 17 0 5 5 8 13 7Z" fill="#fde68a"/>` ,
  megaphone: `<path d="M14 35h10l24 11V18L24 29H14v6Z" fill="#ccfbf1" stroke="#0f766e" stroke-width="3" ${common.line}/><path d="M18 35l4 14h8l-5-14M50 25l6-4M51 33h7M50 41l6 4" fill="none" stroke="#0f766e" stroke-width="3" ${common.line}/>` ,
  excellent: `<path d="M21 14h22v10a11 11 0 0 1-22 0V14Z" fill="#fde68a" stroke="#854d0e" stroke-width="3" ${common.line}/><path d="M23 20H13c0 9 5 12 10 12M41 20h10c0 9-5 12-10 12M32 35v10M24 51h16" fill="none" stroke="#854d0e" stroke-width="3" ${common.line}/><path d="M32 19l3 6 6 .7-4.5 4.2 1.3 6.1-5.8-3.2-5.8 3.2 1.3-6.1-4.5-4.2 6-.7 3-6Z" fill="#f59e0b"/>`,
  pencil: `<path d="M13 45l5 5 31-31-5-5-31 31Z" fill="#e2e8f0" stroke="#334155" stroke-width="3" ${common.line}/><path d="M40 18l5-5 5 5-5 5" fill="#fb7185" stroke="#334155" stroke-width="3" ${common.line}/><path d="M13 45l-3 9 8-4" fill="#fbbf24" stroke="#334155" stroke-width="3" ${common.line}/>` ,
  note: `<path d="M16 9h29l5 5v41H16V9Z" fill="#e0f2fe" stroke="#0369a1" stroke-width="3" ${common.line}/><path d="M45 9v9h8M23 24h20M23 32h20M23 40h13" stroke="#0369a1" stroke-width="3" ${common.line}/>` ,
  100: `<rect x="8" y="13" width="48" height="38" rx="9" fill="#fee2e2" stroke="#dc2626" stroke-width="3"/><text x="32" y="40" text-anchor="middle" font-size="20" font-weight="800" font-family="Arial, sans-serif" fill="#b91c1c">100</text><path d="M17 49h30" stroke="#dc2626" stroke-width="3" ${common.line}/>` ,
  sparkle: `<path d="M32 7l5 17 17 5-17 5-5 17-5-17-17-5 17-5 5-17Z" fill="#e9d5ff" stroke="#7e22ce" stroke-width="3" ${common.line}/><path d="M49 9l2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7ZM15 41l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" fill="#f5d0fe" stroke="#7e22ce" stroke-width="2" ${common.line}/>` ,
};

export function stampSvgMarkup(key, size = 64) {
  const safeKey = STAMP_SVG[key] ? key : "star-yellow";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${STAMP_PRESETS[safeKey].label}">${STAMP_SVG[safeKey]}</svg>`;
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
  ctx.font = `700 ${Math.max(12, width * 0.2)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(preset.label.slice(0, 2), x + width / 2, y + height / 2);
  ctx.restore();
}

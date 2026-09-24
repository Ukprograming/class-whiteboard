import { STAMP_ARTWORK, STAMP_ORDER } from "./stamp-artwork.mjs?v=20260924";
import { getRecentStamps, rememberStamp } from "./stamp-history.mjs?v=20260924";

const stampAssetUrl = filename => new URL(`../assets/stamps/${filename}`, import.meta.url).href;

export const STAMP_PRESETS = Object.freeze({
  "reaction-good": { label: "GOOD!", baseSize: 80, imageSrc: stampAssetUrl("reaction-good.png") },
  "reaction-ok": { label: "OK!", baseSize: 80, imageSrc: stampAssetUrl("reaction-ok.png") },
  "reaction-nice": { label: "NICE!", baseSize: 80, imageSrc: stampAssetUrl("reaction-nice.png") },
  "reaction-impressive": { label: "さすが!", baseSize: 80, imageSrc: stampAssetUrl("reaction-impressive.png") },
  "reaction-thinking": { label: "考え中", baseSize: 80, imageSrc: stampAssetUrl("reaction-thinking.png") },
  "reaction-pause": { label: "保留", baseSize: 80, imageSrc: stampAssetUrl("reaction-pause.png") },
  "reaction-understood": { label: "なるほど", baseSize: 80, imageSrc: stampAssetUrl("reaction-understood.png") },
  "reaction-acknowledged": { label: "了解!", baseSize: 80, imageSrc: stampAssetUrl("reaction-acknowledged.png") },
  "reaction-different": { label: "ちがう!", baseSize: 80, imageSrc: stampAssetUrl("reaction-different.png") },
  "reaction-sigh": { label: "はぁ…", baseSize: 80, imageSrc: stampAssetUrl("reaction-sigh.png") },
  "reaction-working": { label: "作業中…", baseSize: 80, imageSrc: stampAssetUrl("reaction-working.png") },
  "reaction-thanks": { label: "ありがとう", baseSize: 80, imageSrc: stampAssetUrl("reaction-thanks.png") },
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

let stampInstance = 0;

export function stampSvgMarkup(key, size = 64) {
  const safeKey = Object.hasOwn(STAMP_ARTWORK, key) ? key : "star-yellow";
  // Every inline preview needs independent gradient/filter IDs, including recents.
  const prefix = 'stamp-' + (++stampInstance) + '-';
  const pixels = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 64;
  return STAMP_ARTWORK[safeKey]
    .replace('width="160" height="160"', 'width="' + pixels + '" height="' + pixels + '"')
    .replace(/id="(g|sticker)"/g, (_, id) => 'id="' + prefix + id + '"')
    .replace(/url\(#(g|sticker)\)/g, (_, id) => 'url(#' + prefix + id + ')');
}

export function recordStampUse(key) {
  rememberStamp(key, STAMP_PRESETS);
}

export function renderStampPalette(container, onSelect, selectedKey) {
  container.replaceChildren();
  const groups = [
    ["recent", "最近使ったスタンプ", getRecentStamps(STAMP_PRESETS)],
    ["svg", "SVGスタンプ", STAMP_ORDER],
    ["image", "画像スタンプ", Object.keys(STAMP_PRESETS).filter(key => STAMP_PRESETS[key].imageSrc)],
  ];
  for (const [group, title, keys] of groups) {
    if (!keys.length) continue;
    const heading = document.createElement("div");
    heading.className = "stamp-section-title";
    heading.textContent = title;
    container.appendChild(heading);
    for (const key of keys) {
      const preset = STAMP_PRESETS[key];
      const item = document.createElement("button");
      item.type = "button";
      item.className = "stamp-item";
      item.dataset.stampKey = key;
      item.dataset.stampGroup = group;
      item.title = preset.label;
      item.setAttribute("aria-label", preset.label);
      item.setAttribute("aria-pressed", String(key === selectedKey));
      item.classList.toggle("active", key === selectedKey);
      item.appendChild(createStampElement(key));
      item.addEventListener("click", () => onSelect(key));
      container.appendChild(item);
    }
  }
  container.scrollTop = 0;
}

export function createStampElement(key) {
  const preset = STAMP_PRESETS[key];
  if (preset?.imageSrc) {
    const image = document.createElement("img");
    image.src = preset.imageSrc;
    image.alt = "";
    image.decoding = "async";
    image.loading = "lazy";
    return image;
  }

  const template = document.createElement("template");
  template.innerHTML = stampSvgMarkup(key).trim();
  return template.content.firstElementChild;
}

function getStampImage(key, onReady) {
  const safeKey = STAMP_PRESETS[key] ? key : "star-yellow";
  let image = stampImageCache.get(safeKey);
  if (image) return image;

  const preset = STAMP_PRESETS[safeKey];
  image = new Image();
  image.decoding = "async";
  image.onload = () => {
    if (typeof onReady === "function") onReady();
  };
  image.src = preset.imageSrc ||
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stampSvgMarkup(safeKey, 128))}`;
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

export const STAMP_HISTORY_KEY = "class-whiteboard:recent-stamps:v1";
const LIMIT = 5;
let fallback = [];
let unsaved = false;

function clean(keys, presets) {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.filter(key => typeof key === "string" &&
    Object.hasOwn(presets, key)))].slice(0, LIMIT);
}

export function getRecentStamps(presets) {
  if (unsaved) return clean(fallback, presets);
  try {
    const saved = globalThis.localStorage.getItem(STAMP_HISTORY_KEY);
    fallback = clean(saved ? JSON.parse(saved) : [], presets);
  } catch {
    // Drawing still works when storage is unavailable or its value is damaged.
  }
  return clean(fallback, presets);
}

export function rememberStamp(key, presets) {
  if (!Object.hasOwn(presets, key)) return;
  fallback = clean([key, ...getRecentStamps(presets)], presets);
  try {
    globalThis.localStorage.setItem(STAMP_HISTORY_KEY, JSON.stringify(fallback));
    unsaved = false;
  } catch {
    unsaved = true;
    // Keep this session's history if browser storage is full or blocked.
  }
}

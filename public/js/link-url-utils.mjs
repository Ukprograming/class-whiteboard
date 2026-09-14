export function normalizeHttpUrl(value) {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  if (!candidate) return "";

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

export function openHttpUrl(value, openWindow = globalThis.window?.open?.bind(globalThis.window)) {
  const url = normalizeHttpUrl(value);
  if (!url || typeof openWindow !== "function") return false;
  const opened = openWindow(url, "_blank", "noopener,noreferrer");
  if ((typeof opened === "object" && opened !== null) || typeof opened === "function") {
    opened.opener = null;
  }
  return true;
}

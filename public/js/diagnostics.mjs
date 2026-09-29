// Local, bounded metadata only. Never store board contents, URLs or credentials.
export const DIAGNOSTIC_BUILD = "monitor-recovery-20260929";
const fields = new Set([
  "requestId", "version", "revision", "stage", "reason", "state", "event",
  "durationMs", "attempt", "count", "bytes", "width", "height", "scale",
  "offsetTop", "offsetLeft", "scrollX", "scrollY", "headerTop", "headerBottom",
  "sidebarTop", "sidebarBottom", "toolbarTop", "toolbarBottom", "fullscreen",
  "cameraOpen", "chromeHidden", "errorName", "ready",
]);
const entries = [];
export function recordDiagnostic(event, detail = {}) {
  const entry = { time: new Date().toISOString(), build: DIAGNOSTIC_BUILD, event };
  for (const [key, value] of Object.entries(detail)) {
    if (!fields.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) entry[key] = value;
    else if (typeof value === "boolean") entry[key] = value;
    else if (typeof value === "string") entry[key] = value.slice(0, 100);
  }
  entries.push(entry);
  if (entries.length > 400) entries.shift();
}
export function readDiagnostics() { return entries.map(entry => ({ ...entry })); }
if (typeof window !== "undefined") {
  window.classWhiteboardDiagnostics = Object.freeze({
    read: readDiagnostics,
    export: () => JSON.stringify({ build: DIAGNOSTIC_BUILD, entries: readDiagnostics() }, null, 2),
  });
}

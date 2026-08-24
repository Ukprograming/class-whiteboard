function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deterministicSpreadDelay(key, windowMs) {
  const safeWindowMs = Math.max(0, Math.floor(Number(windowMs) || 0));
  if (safeWindowMs === 0) return 0;
  return hashString(key) % (safeWindowMs + 1);
}

export function jitteredInterval(baseMs, jitterMs, random = Math.random) {
  const safeBaseMs = Math.max(0, Number(baseMs) || 0);
  const safeJitterMs = Math.max(0, Number(jitterMs) || 0);
  if (safeJitterMs === 0) return Math.round(safeBaseMs);
  const offset = (Math.max(0, Math.min(1, random())) * 2 - 1) * safeJitterMs;
  return Math.max(0, Math.round(safeBaseMs + offset));
}

export function waitForRealtimeSpread(ms) {
  const delayMs = Math.max(0, Number(ms) || 0);
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

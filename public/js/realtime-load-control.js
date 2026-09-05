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

export function isRateLimitError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return status === 429 ||
    code === "over_request_rate_limit" ||
    message.includes("too many requests") ||
    message.includes("rate limit");
}

export async function runWithRateLimitRetry(operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("A rate-limited operation function is required.");
  }

  const maxAttempts = Math.max(1, Math.floor(Number(options.maxAttempts) || 1));
  const wait = typeof options.wait === "function" ? options.wait : waitForRealtimeSpread;
  const getDelayMs = typeof options.getDelayMs === "function"
    ? options.getDelayMs
    : () => Math.max(0, Number(options.delayMs) || 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let result;
    try {
      result = await operation(attempt);
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= maxAttempts) throw error;
      const delayMs = Math.max(0, Number(getDelayMs(attempt, error)) || 0);
      options.onRetry?.({ attempt, nextAttempt: attempt + 1, maxAttempts, delayMs, error });
      await wait(delayMs);
      continue;
    }

    if (!isRateLimitError(result?.error) || attempt >= maxAttempts) return result;
    const delayMs = Math.max(0, Number(getDelayMs(attempt, result.error)) || 0);
    options.onRetry?.({
      attempt,
      nextAttempt: attempt + 1,
      maxAttempts,
      delayMs,
      error: result.error,
    });
    await wait(delayMs);
  }

  throw new Error("Rate-limit retry ended unexpectedly.");
}

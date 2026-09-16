// Only preview images are coalesced. Board actions and persistence use other paths.
export function thumbnailChanged(previous, current) {
  if (!previous || previous.key !== current.key) return true;
  const a = previous.pixels;
  const b = current.pixels;
  if (a.length !== b.length) return true;
  const threshold = current.noisy ? 18 : 0;
  const required = current.noisy ? Math.max(3, Math.ceil(b.length / 4 * 0.0025)) : 1;
  let changed = 0;
  for (let i = 0; i < b.length; i += 4) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2])) > threshold && ++changed >= required) return true;
  }
  return false;
}

export function createThumbnailSender({
  sample, send, minIntervalMs = 5000, pollIntervalMs = 500,
  activitySpreadMs = 2000, retryJitterMs = 750,
  now = () => performance.now(), random = Math.random,
  setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {},
}) {
  const interval = Math.max(5000, minIntervalMs);
  let active = false;
  let timer = null;
  let inFlight = false;
  let generation = 0;
  let forceVersion = 0;
  let confirmedForceVersion = -1;
  let confirmed = null;
  let due = null;
  let nextAllowed = -Infinity;

  function schedule(delay = pollIntervalMs) {
    if (active && timer === null) timer = setTimer(tick, delay);
  }

  async function tick() {
    timer = null;
    if (!active) return;
    if (inFlight) { schedule(); return; }
    try {
      const current = sample();
      if (!current) { due = null; return; }
      const forced = forceVersion !== confirmedForceVersion;
      if (!forced && !thumbnailChanged(confirmed, current)) { due = null; return; }
      // Keep the first deadline while activity continues; never debounce forever.
      if (due === null) due = Math.max(nextAllowed, now() + random() * activitySpreadMs);
      if (now() < due || now() < nextAllowed) return;
      const sentGeneration = generation;
      const sentForceVersion = forceVersion;
      due = null;
      inFlight = true;
      // Failed sends, initial frames and reconnect requests all spend this budget.
      nextAllowed = now() + interval + random() * retryJitterMs;
      try {
        const result = await send(current);
        if (result !== false && active && generation === sentGeneration) {
          confirmed = current;
          confirmedForceVersion = sentForceVersion;
        }
      } finally {
        inFlight = false;
      }
    } catch (error) {
      onError(error);
    } finally {
      schedule();
    }
  }

  return {
    start() {
      if (active) { this.request(); return; }
      active = true;
      generation += 1;
      forceVersion += 1;
      due = null;
      schedule(0);
    },
    request() {
      if (!active) return;
      forceVersion += 1;
      // Preserve any pending deadline and the last send's cooldown.
      schedule(0);
    },
    stop() {
      active = false;
      generation += 1;
      if (timer !== null) clearTimer(timer);
      timer = null;
      due = null;
      confirmed = null;
    },
  };
}

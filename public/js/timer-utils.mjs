export const MAX_TIMER_SECONDS = 99 * 60 + 59;

export function clampTimerSeconds(value) {
  const seconds = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
  return Math.max(0, Math.min(MAX_TIMER_SECONDS, seconds));
}

export function formatTimerSeconds(value) {
  const total = clampTimerSeconds(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getTimerRemainingSeconds(timer, now = Date.now()) {
  if (timer?.timerState === "running" && Number.isFinite(Number(timer.timerEndAt))) {
    return clampTimerSeconds(Math.ceil((Number(timer.timerEndAt) - now) / 1000));
  }
  return clampTimerSeconds(timer?.timerRemainingSeconds);
}

export function normalizeTimerFields(timer) {
  const duration = clampTimerSeconds(timer?.timerDurationSeconds ?? 300);
  const remaining = clampTimerSeconds(timer?.timerRemainingSeconds ?? duration);
  const requestedState = timer?.timerState;
  const state = ["idle", "running", "paused", "finished"].includes(requestedState)
    ? requestedState
    : "idle";
  return {
    timerDurationSeconds: duration,
    timerRemainingSeconds: state === "finished" ? 0 : remaining,
    timerState: state,
    timerEndAt: state === "running" && Number.isFinite(Number(timer?.timerEndAt))
      ? Number(timer.timerEndAt)
      : null
  };
}

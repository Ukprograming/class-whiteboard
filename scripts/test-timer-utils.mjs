import assert from "node:assert/strict";
import {
  MAX_TIMER_SECONDS,
  clampTimerSeconds,
  formatTimerSeconds,
  getTimerRemainingSeconds,
  normalizeTimerFields
} from "../public/js/timer-utils.mjs";

assert.equal(formatTimerSeconds(0), "00:00");
assert.equal(formatTimerSeconds(301), "05:01");
assert.equal(formatTimerSeconds(MAX_TIMER_SECONDS), "99:59");
assert.equal(clampTimerSeconds(-1), 0);
assert.equal(clampTimerSeconds(MAX_TIMER_SECONDS + 60), MAX_TIMER_SECONDS);

const running = normalizeTimerFields({
  timerDurationSeconds: 300,
  timerRemainingSeconds: 300,
  timerState: "running",
  timerEndAt: 12_000
});
assert.equal(getTimerRemainingSeconds(running, 9_001), 3);
assert.equal(getTimerRemainingSeconds(running, 12_000), 0);

const invalid = normalizeTimerFields({
  timerDurationSeconds: -50,
  timerRemainingSeconds: 999_999,
  timerState: "unknown",
  timerEndAt: "invalid"
});
assert.equal(invalid.timerDurationSeconds, 0);
assert.equal(invalid.timerRemainingSeconds, MAX_TIMER_SECONDS);
assert.equal(invalid.timerState, "idle");
assert.equal(invalid.timerEndAt, null);
assert.equal(invalid.timerAlarmActive, false);

const alarming = normalizeTimerFields({
  timerDurationSeconds: 10,
  timerRemainingSeconds: 0,
  timerState: "finished",
  timerAlarmActive: true
});
assert.equal(alarming.timerAlarmActive, true);

console.log("Timer utility checks passed.");

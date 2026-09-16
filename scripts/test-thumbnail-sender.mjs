import assert from 'node:assert/strict';
import { createThumbnailSender, thumbnailChanged } from '../public/js/thumbnail-sender.mjs';

function clock() {
  let time = 0, id = 0;
  const tasks = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) { tasks.set(++id, { fn, at: time + delay }); return id; },
    clearTimer(id) { tasks.delete(id); },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at;
        tasks.delete(next[0]);
        next[1].fn();
        for (let i = 0; i < 8; i++) await Promise.resolve();
      }
      time = end;
    },
  };
}
const frame = (key, level = 100, noisy = false) => ({ key, noisy, pixels: new Uint8ClampedArray(96 * 72 * 4).fill(level) });
const c = clock();
let current = frame('blank'), fail = false, hold = null;
const sent = [];
const sender = createThumbnailSender({ ...c, random: () => 0.5,
  sample: () => current,
  send: async sample => { sent.push({ at: c.now(), key: sample.key }); if (hold) await hold; return !fail; },
});
sender.start();
await c.advance(3000);
assert.equal(sent.length, 1, 'initial blank frame must be delivered');
await c.advance(60000);
assert.equal(sent.length, 1, 'static frames must not use the network');
current = frame('writing');
await c.advance(2500);
assert.equal(sent.length, 2, 'activity resumes within polling + spread');
for (let i = 0; i < 30; i++) { current = frame(`edit-${i}`); await c.advance(100); }
assert.equal(sent.length, 2, 'continuous activity respects cooldown');
await c.advance(5000);
assert.equal(sent.length, 3);
assert.equal(sent.at(-1).key, 'edit-29', 'coalesce to latest, never replay old previews');
await c.advance(15000);
assert.equal(sent.length, 3, 'final edit delivered then silence');
sender.request(); sender.request(); sender.start();
await c.advance(2500);
assert.equal(sent.length, 4, 'duplicate start/force requests coalesce');
sender.stop();
current = frame('away');
await c.advance(10000);
assert.equal(sent.length, 4);
sender.start();
await c.advance(2500);
assert.equal(sent.length, 5, 'teacher returning receives a fresh frame');
fail = true;
current = frame('retry');
await c.advance(14000);
const failures = sent.length;
assert(failures >= 7, 'failed unchanged frame is retried');
fail = false;
await c.advance(7000);
assert.equal(sent.at(-1).key, 'retry');
const recovered = sent.length;
await c.advance(10000);
assert.equal(sent.length, recovered, 'success stops retries');
for (let i = 1; i < sent.length; i++) assert(sent[i].at - sent[i - 1].at >= 5000);

// Stop/restart during a slow send cannot overlap sends or confirm a new session.
let release;
hold = new Promise(resolve => { release = resolve; });
current = frame('slow');
await c.advance(2500);
const duringFlight = sent.length;
sender.stop(); sender.start();
await c.advance(10000);
assert.equal(sent.length, duringFlight);
hold = null; release();
for (let i = 0; i < 8; i++) await Promise.resolve();
await c.advance(3000);
assert.equal(sent.length, duringFlight + 1);
sender.stop();

assert(!thumbnailChanged(frame('camera', 100, true), frame('camera', 110, true)), 'camera noise ignored');
assert(thumbnailChanged(frame('camera', 100, true), frame('camera', 130, true)), 'camera movement detected');
assert(thumbnailChanged(frame('board'), frame('viewport')), 'metadata change triggers update');
const fine = frame('board'); fine.pixels[0]++;
assert(thumbnailChanged(frame('board'), fine), 'screen/board sampling has no camera threshold');

// Thirty clients across three classes: simultaneous starts, sustained edits,
// forced reconnects and failures still share each client's single send budget.
const loadClock = clock(), events = [], clients = [];
let revision = 0;
for (let i = 0; i < 30; i++) {
  let seed = (i + 1) * 7919;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const client = createThumbnailSender({ ...loadClock, random,
    sample: () => frame(`class-${i % 3}:revision-${revision}`),
    send: () => { events.push({ client: i, at: loadClock.now() }); return loadClock.now() > 10000; },
  });
  clients.push(client); client.start();
}
for (let i = 0; i < 120; i++) {
  revision++;
  if (i === 30) clients.forEach(client => client.request());
  await loadClock.advance(500);
}
for (let i = 0; i < 30; i++) {
  const times = events.filter(e => e.client === i).map(e => e.at);
  for (let j = 1; j < times.length; j++) assert(times[j] - times[j - 1] >= 5000);
}
const peak = Math.max(...events.map(e => events.filter(other => other.at >= e.at && other.at < e.at + 1000).length));
await loadClock.advance(10000);
const settledCount = events.length;
await loadClock.advance(60000);
assert.equal(events.length, settledCount, 'all clients become silent after final updates');
clients.forEach(client => client.stop());
console.log(`Thumbnail sender tests passed; seeded 30-client simulation peak=${peak} images/s (${peak * 2} send+receive messages/s). Not a production load test.`);

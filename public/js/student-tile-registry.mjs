// Presence identifies connections; the teacher UI identifies students. Keep
// one chosen connection per account without letting image arrival order pick it.
export function createStudentTileRegistry({ now = Date.now, pendingTtlMs = 15000, maxPending = 200 } = {}) {
  let scope = null;
  let sequence = 0;
  const known = new Map();
  const pending = new Map();
  let connections = new Map();
  let selected = new Map();
  let previews = {};

  function setScope(value) {
    if (scope === value) return;
    scope = value;
    sequence = 0;
    known.clear();
    pending.clear();
    connections.clear();
    selected.clear();
    previews = {};
  }

  function identity(student) {
    const recordId = String(student.studentRecordId || "").trim();
    if (recordId) return `record:${recordId}`;
    const loginId = String(student.nickname || "").trim().toLowerCase();
    return loginId ? `login:${loginId}` : `socket:${student.socketId}`;
  }

  function updatePresence(list) {
    const unique = new Map((list || []).filter(s => s?.socketId).map(s => [s.socketId, s]));
    // onlineAt is only a tie-breaker for connections first observed together.
    // Repeated track()/mode updates must never make an old tab take over.
    const newcomers = [...unique.values()].filter(s => !known.has(s.socketId));
    newcomers.sort((a, b) => (Date.parse(a.onlineAt) || 0) - (Date.parse(b.onlineAt) || 0)
      || String(a.socketId).localeCompare(String(b.socketId)));
    for (const student of newcomers) known.set(student.socketId, { key: identity(student), order: ++sequence });
    connections = unique;
    selected = new Map();
    for (const student of unique.values()) {
      const entry = known.get(student.socketId);
      entry.key = identity(student);
      const previous = selected.get(entry.key);
      if (!previous || known.get(previous.socketId).order < entry.order) selected.set(entry.key, student);
    }
    const nextPreviews = {};
    for (const student of selected.values()) {
      const id = student.socketId;
      const waiting = pending.get(id);
      const info = previews[id] || (waiting && now() - waiting.at <= pendingTtlMs ? waiting.info : null);
      if (info) nextPreviews[id] = { ...info, nickname: student.nickname || info.nickname, mode: info.mode || student.mode || "whiteboard" };
    }
    previews = nextPreviews;
    for (const [id, waiting] of pending) {
      if (known.has(id) || now() - waiting.at > pendingTtlMs) pending.delete(id);
    }
    return [...selected.values()];
  }

  function selectedSocketId(socketId) {
    const entry = known.get(socketId);
    return entry ? selected.get(entry.key)?.socketId || "" : "";
  }

  function receiveThumbnail(socketId, info) {
    if (!socketId || !info?.dataUrl) return false;
    if (!connections.has(socketId)) {
      // Retired connections cannot resurrect a tile. Only previously unseen
      // connections may wait for their first Presence synchronization.
      if (!known.has(socketId)) {
        pending.delete(socketId);
        pending.set(socketId, { info, at: now() });
        while (pending.size > maxPending) pending.delete(pending.keys().next().value);
      }
      return false;
    }
    if (selectedSocketId(socketId) !== socketId) return false;
    previews[socketId] = { ...info, nickname: connections.get(socketId).nickname || info.nickname };
    return true;
  }

  return { setScope, updatePresence, selectedSocketId, receiveThumbnail, getThumbnails: () => previews };
}

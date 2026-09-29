export function isMatchingMonitorRequest(expectedRequestId, receivedRequestId) {
  return Boolean(expectedRequestId) && receivedRequestId === expectedRequestId;
}

export function canAcceptTeacherBoardSnapshot({
  expectedToken,
  pendingToken,
  snapshotToken,
}) {
  if (pendingToken) return snapshotToken === pendingToken;
  if (expectedToken) return snapshotToken === expectedToken;
  return true;
}

// Keep deltas until a baseline exists, and retain enough history to replay
// changes that overtook a Storage download. Each revision is applied once.
export function createMonitorReceiver({ apply, maxHistory = 512 } = {}) {
  let revision = null;
  let baseline = null;
  let droppedThrough = -1;
  const history = new Map();
  const valid = value => Number.isSafeInteger(value) && value >= 0;
  function drain() {
    if (revision == null) return;
    while (history.has(revision + 1)) {
      const action = history.get(revision + 1);
      if (action) apply(action);
      revision += 1;
    }
  }
  return {
    reset() { revision = baseline = null; droppedThrough = -1; history.clear(); },
    receive(value, action) {
      if (!valid(value)) return "invalid";
      if (revision != null && value <= revision) return "duplicate";
      if (!history.has(value)) history.set(value, action);
      if (history.size > maxHistory) {
        const oldest = Math.min(...history.keys());
        history.delete(oldest);
        droppedThrough = Math.max(droppedThrough, oldest);
      }
      drain();
      return droppedThrough > (revision ?? -1) ? "overflow" : this.hasGap() ? "gap" : "ok";
    },
    accept(value, importSnapshot) {
      if (!valid(value)) return false;
      if (value < droppedThrough || (baseline != null && value < baseline)) return false;
      if (!importSnapshot()) return false;
      baseline = value;
      revision = value;
      for (const key of history.keys()) if (key <= value) history.delete(key);
      drain();
      return true;
    },
    hasGap() { return revision != null && [...history.keys()].some(key => key > revision); },
    get revision() { return revision; },
    get baseline() { return baseline; },
    get ready() { return revision != null; },
  };
}

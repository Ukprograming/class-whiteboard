export function createRealtimeJoinCoordinator(runJoin) {
  if (typeof runJoin !== "function") {
    throw new TypeError("runJoin must be a function");
  }

  let inFlight = null;
  let inFlightKey = "";

  async function coordinate(joinKey, ...args) {
    if (inFlight) {
      if (inFlightKey === joinKey) return inFlight;
      try {
        await inFlight;
      } catch {
        // A different request still needs its own membership/channel attempt.
      }
      return coordinate(joinKey, ...args);
    }

    // Defer runJoin to a microtask so inFlight is assigned before it can begin
    // creating or subscribing to a Supabase channel.
    const operation = Promise.resolve().then(() => runJoin(...args));
    inFlightKey = joinKey;
    inFlight = operation;
    try {
      return await operation;
    } finally {
      if (inFlight === operation) {
        inFlight = null;
        inFlightKey = "";
      }
    }
  }

  return coordinate;
}

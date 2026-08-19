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

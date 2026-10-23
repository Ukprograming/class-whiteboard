// Prefer the camera's native detail up to 4K without making 4K mandatory.
// Permission/device errors must still reach the caller immediately.
export async function openNotebookCamera(mediaDevices, deviceId) {
  const baseVideo = {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    facingMode: "environment",
  };
  if (mediaDevices.getSupportedConstraints?.().resizeMode) {
    // A browser-generated enlargement is not additional camera detail.
    baseVideo.resizeMode = { exact: "none" };
  }
  try {
    return await mediaDevices.getUserMedia({
      audio: false,
      video: { ...baseVideo, width: { ideal: 3840, max: 3840 }, height: { ideal: 2160, max: 3840 } },
    });
  } catch (error) {
    if (!["OverconstrainedError", "ConstraintNotSatisfiedError", "NotReadableError", "TrackStartError"].includes(error?.name)) throw error;
    // Some camera/driver combinations reject a high-resolution start rather
    // than negotiating down. Retry the existing 1080p preference once.
    return mediaDevices.getUserMedia({
      audio: false,
      video: { ...baseVideo, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  }
}

// Keep modal detail independent of the inexpensive 640px classroom previews.
// Match the selected paper's source-pixel coverage, preserving the more
// detailed edge when perspective makes opposite edges different lengths.
export function notebookImageSize(sourceWidth, sourceHeight, aspect, corners = null) {
  if (![sourceWidth, sourceHeight, aspect].every(value => Number.isFinite(value) && value > 0)) return null;
  let sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  if (corners?.length === 4 && corners.every(point =>
    Number.isFinite(point?.nx) && point.nx >= 0 && point.nx <= 1 &&
    Number.isFinite(point?.ny) && point.ny >= 0 && point.ny <= 1
  )) {
    const distance = (a, b) => Math.hypot((a.nx - b.nx) * (sourceWidth - 1), (a.ny - b.ny) * (sourceHeight - 1));
    const width = Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2]));
    const height = Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]));
    if (width > 0 && height > 0) {
      const paperWidth = Math.max(width, height / aspect);
      sourceLongEdge = Math.max(paperWidth, paperWidth * aspect);
    }
  }
  const longEdge = Math.min(3840, Math.max(sourceWidth, sourceHeight), sourceLongEdge);
  return aspect >= 1
    ? { width: Math.max(1, Math.round(longEdge / aspect)), height: Math.max(1, Math.round(longEdge)) }
    : { width: Math.max(1, Math.round(longEdge)), height: Math.max(1, Math.round(longEdge * aspect)) };
}

export function encodeNotebookImage(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("ノート画像を作成できませんでした。")), "image/jpeg", 0.92);
  });
}

export function isNotebookImagePath(path) {
  return /^students\/[0-9a-f-]+\/realtime\/[0-9a-f-]+-notebook\.jpg$/i.test(String(path || ""));
}

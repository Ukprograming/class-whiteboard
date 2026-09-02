export function calculateCameraStageSize(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const sw = Number(sourceWidth);
  const sh = Number(sourceHeight);
  const mw = Number(maxWidth);
  const mh = Number(maxHeight);
  if (![sw, sh, mw, mh].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError("Camera stage dimensions must be positive finite numbers.");
  }

  const scale = Math.min(mw / sw, mh / sh);
  return {
    width: sw * scale,
    height: sh * scale,
    aspectRatio: sw / sh,
  };
}

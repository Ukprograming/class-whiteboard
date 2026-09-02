export function calculateCoverCrop(sourceWidth, sourceHeight, viewportWidth, viewportHeight) {
  const sw = Number(sourceWidth);
  const sh = Number(sourceHeight);
  const vw = Number(viewportWidth);
  const vh = Number(viewportHeight);
  if (![sw, sh, vw, vh].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError("Camera crop dimensions must be positive finite numbers.");
  }

  const sourceAspect = sw / sh;
  const viewportAspect = vw / vh;
  if (Math.abs(sourceAspect - viewportAspect) < 1e-9) {
    return { x: 0, y: 0, width: sw, height: sh };
  }
  if (sourceAspect > viewportAspect) {
    const width = sh * viewportAspect;
    return { x: (sw - width) / 2, y: 0, width, height: sh };
  }

  const height = sw / viewportAspect;
  return { x: 0, y: (sh - height) / 2, width: sw, height };
}

const EPSILON = 1e-9;

function pointDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function pointToSegmentDistanceSquared(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return pointDistanceSquared(point, start);

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  return pointDistanceSquared(point, {
    x: start.x + projection * dx,
    y: start.y + projection * dy,
  });
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point, start, end) {
  return (
    Math.abs(orientation(start, end, point)) <= EPSILON &&
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  );
}

function segmentsIntersect(aStart, aEnd, bStart, bEnd) {
  const o1 = orientation(aStart, aEnd, bStart);
  const o2 = orientation(aStart, aEnd, bEnd);
  const o3 = orientation(bStart, bEnd, aStart);
  const o4 = orientation(bStart, bEnd, aEnd);

  if (
    ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))
  ) {
    return true;
  }

  return (
    (Math.abs(o1) <= EPSILON && pointOnSegment(bStart, aStart, aEnd)) ||
    (Math.abs(o2) <= EPSILON && pointOnSegment(bEnd, aStart, aEnd)) ||
    (Math.abs(o3) <= EPSILON && pointOnSegment(aStart, bStart, bEnd)) ||
    (Math.abs(o4) <= EPSILON && pointOnSegment(aEnd, bStart, bEnd))
  );
}

export function segmentDistanceSquared(aStart, aEnd, bStart, bEnd) {
  if (segmentsIntersect(aStart, aEnd, bStart, bEnd)) return 0;
  return Math.min(
    pointToSegmentDistanceSquared(aStart, bStart, bEnd),
    pointToSegmentDistanceSquared(aEnd, bStart, bEnd),
    pointToSegmentDistanceSquared(bStart, aStart, aEnd),
    pointToSegmentDistanceSquared(bEnd, aStart, aEnd)
  );
}

function quadraticPoint(start, control, end, t) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

function appendQuadraticSamples(target, start, control, end) {
  const approximateLength =
    Math.hypot(control.x - start.x, control.y - start.y) +
    Math.hypot(end.x - control.x, end.y - control.y);
  const subdivisions = Math.max(4, Math.min(32, Math.ceil(approximateLength / 8)));
  for (let step = 1; step <= subdivisions; step += 1) {
    target.push(quadraticPoint(start, control, end, step / subdivisions));
  }
}

// Mirrors Whiteboard._renderStrokes so hit testing follows the ink users see.
export function flattenRenderedStroke(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length < 3) return points.map(point => ({ x: point.x, y: point.y }));

  const flattened = [{ x: points[0].x, y: points[0].y }];
  let pathStart = points[0];
  let index = 1;
  for (; index < points.length - 2; index += 1) {
    const end = {
      x: (points[index].x + points[index + 1].x) / 2,
      y: (points[index].y + points[index + 1].y) / 2,
    };
    appendQuadraticSamples(flattened, pathStart, points[index], end);
    pathStart = end;
  }
  appendQuadraticSamples(flattened, pathStart, points[index], points[index + 1]);
  return flattened;
}

export function strokeIntersectsPath(stroke, pathStart, pathEnd, radius = 0) {
  const renderedPoints = flattenRenderedStroke(stroke?.points);
  if (renderedPoints.length === 0) return false;

  const strokeRadius = Math.max(0, Number(stroke?.width) || 0) / 2;
  const combinedRadius = Math.max(0, Number(radius) || 0) + strokeRadius;
  const thresholdSquared = combinedRadius * combinedRadius;

  if (renderedPoints.length === 1) {
    return pointToSegmentDistanceSquared(renderedPoints[0], pathStart, pathEnd) <= thresholdSquared;
  }

  for (let index = 1; index < renderedPoints.length; index += 1) {
    if (
      segmentDistanceSquared(
        renderedPoints[index - 1],
        renderedPoints[index],
        pathStart,
        pathEnd
      ) <= thresholdSquared
    ) {
      return true;
    }
  }
  return false;
}

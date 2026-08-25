import assert from "node:assert/strict";
import { flattenRenderedStroke, strokeIntersectsPath } from "../public/js/stroke-hit-test.mjs";

const lineStroke = {
  width: 2,
  points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
};
assert.equal(
  strokeIntersectsPath(lineStroke, { x: 50, y: 4 }, { x: 50, y: 4 }, 6),
  true,
  "a point between recorded samples must hit the rendered line"
);

const verticalStroke = {
  width: 3,
  points: [{ x: 50, y: -20 }, { x: 50, y: 20 }],
};
assert.equal(
  strokeIntersectsPath(verticalStroke, { x: 0, y: 0 }, { x: 100, y: 0 }, 12),
  true,
  "a fast eraser movement must not skip a crossed stroke"
);
assert.equal(
  strokeIntersectsPath(verticalStroke, { x: 0, y: 40 }, { x: 100, y: 40 }, 12),
  false,
  "a distant eraser movement must not delete a stroke"
);

const curvedStroke = {
  width: 2,
  points: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }],
};
assert.ok(
  flattenRenderedStroke(curvedStroke.points).length > curvedStroke.points.length,
  "quadratic ink must be flattened"
);
assert.equal(
  strokeIntersectsPath(curvedStroke, { x: 50, y: 50 }, { x: 50, y: 50 }, 2),
  true,
  "hit testing must follow the rendered quadratic curve"
);
assert.equal(
  strokeIntersectsPath({ ...lineStroke, width: 20 }, { x: 50, y: 14 }, { x: 50, y: 14 }, 5),
  true,
  "visible stroke width must contribute to the hit radius"
);

console.log("Eraser hit-test checks passed.");

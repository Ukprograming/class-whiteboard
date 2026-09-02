import assert from "node:assert/strict";
import { calculateCoverCrop } from "../public/js/camera-utils.mjs";

assert.deepEqual(
  calculateCoverCrop(1920, 1080, 640, 480),
  { x: 240, y: 0, width: 1440, height: 1080 },
  "16:9 camera frames should crop equally on the left and right in a 4:3 preview"
);

assert.deepEqual(
  calculateCoverCrop(1080, 1920, 640, 480),
  { x: 0, y: 555, width: 1080, height: 810 },
  "portrait camera frames should crop equally on the top and bottom in a 4:3 preview"
);

assert.deepEqual(
  calculateCoverCrop(1280, 720, 1280, 720),
  { x: 0, y: 0, width: 1280, height: 720 },
  "matching aspect ratios should use the complete frame"
);

assert.throws(
  () => calculateCoverCrop(1920, 1080, 0, 480),
  RangeError,
  "invalid preview dimensions should fail clearly"
);

console.log("Camera preview crop utilities passed.");

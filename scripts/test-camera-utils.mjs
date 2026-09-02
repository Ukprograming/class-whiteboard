import assert from "node:assert/strict";
import { calculateCameraStageSize } from "../public/js/camera-utils.mjs";

assert.deepEqual(
  calculateCameraStageSize(1920, 1080, 716, 443),
  { width: 716, height: 402.75, aspectRatio: 16 / 9 },
  "a 16:9 camera frame should keep its complete aspect ratio within the modal"
);

assert.deepEqual(
  calculateCameraStageSize(1080, 1920, 716, 443),
  { width: 249.1875, height: 443, aspectRatio: 9 / 16 },
  "a portrait camera frame should become narrower instead of being cropped"
);

assert.deepEqual(
  calculateCameraStageSize(1280, 960, 640, 480),
  { width: 640, height: 480, aspectRatio: 4 / 3 },
  "matching aspect ratios should fill the available stage"
);

assert.throws(
  () => calculateCameraStageSize(1920, 1080, 0, 480),
  RangeError,
  "invalid stage dimensions should fail clearly"
);

console.log("Camera stage sizing utilities passed.");

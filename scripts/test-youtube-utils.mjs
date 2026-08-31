import assert from "node:assert/strict";
import { buildYouTubeEmbedUrl, parseYouTubeUrl } from "../public/js/youtube-utils.mjs";

const VIDEO_ID = "dQw4w9WgXcQ";

for (const url of [
  `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  `https://youtu.be/${VIDEO_ID}`,
  `https://www.youtube.com/embed/${VIDEO_ID}`,
  `https://www.youtube.com/shorts/${VIDEO_ID}`,
  `https://www.youtube.com/live/${VIDEO_ID}`,
  `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
]) {
  assert.equal(parseYouTubeUrl(url)?.videoId, VIDEO_ID, `Could not parse ${url}`);
}

assert.deepEqual(
  parseYouTubeUrl(`https://youtu.be/${VIDEO_ID}?t=1h2m3s`),
  {
    videoId: VIDEO_ID,
    startSeconds: 3723,
    canonicalUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=3723s`,
  }
);
assert.equal(parseYouTubeUrl(`https://www.youtube.com/watch?v=${VIDEO_ID}&start=90`)?.startSeconds, 90);
assert.equal(parseYouTubeUrl(`https://example.com/watch?v=${VIDEO_ID}`), null);
assert.equal(parseYouTubeUrl(`https://youtube.com.evil.example/watch?v=${VIDEO_ID}`), null);
assert.equal(parseYouTubeUrl("javascript:alert(1)"), null);
assert.equal(parseYouTubeUrl("https://www.youtube.com/watch?v=too-short"), null);

const embedUrl = buildYouTubeEmbedUrl(VIDEO_ID, 75);
assert.match(embedUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
assert.match(embedUrl, /autoplay=0/);
assert.match(embedUrl, /playsinline=1/);
assert.match(embedUrl, /start=75/);
assert.equal(buildYouTubeEmbedUrl("invalid"), "");

console.log("YouTube URL utilities passed.");


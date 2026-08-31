const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

function parseTimeValue(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) || 0);

  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  return Math.max(
    0,
    (Number(match[1]) || 0) * 3600 +
      (Number(match[2]) || 0) * 60 +
      (Number(match[3]) || 0)
  );
}

export function parseYouTubeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(hostname)) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  let videoId = "";
  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    videoId = segments[0] || "";
  } else if (parsed.pathname === "/watch") {
    videoId = parsed.searchParams.get("v") || "";
  } else if (["embed", "shorts", "live"].includes(segments[0])) {
    videoId = segments[1] || "";
  }

  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) return null;

  const startSeconds = parseTimeValue(
    parsed.searchParams.get("start") || parsed.searchParams.get("t")
  );
  return {
    videoId,
    startSeconds,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}${
      startSeconds ? `&t=${startSeconds}s` : ""
    }`,
  };
}

export function buildYouTubeEmbedUrl(videoId, startSeconds = 0) {
  const normalizedId = String(videoId || "").trim();
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(normalizedId)) return "";

  const params = new URLSearchParams({
    autoplay: "0",
    playsinline: "1",
    rel: "0",
  });
  const start = Math.max(0, Math.floor(Number(startSeconds) || 0));
  if (start) params.set("start", String(start));
  return `https://www.youtube-nocookie.com/embed/${normalizedId}?${params.toString()}`;
}


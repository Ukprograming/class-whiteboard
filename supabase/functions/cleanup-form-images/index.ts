import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, getUserClient } from "../_shared/supabase.ts";

const STORAGE_BUCKET = "class-whiteboard";
const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 100;
const FORM_IMAGE_PATTERN = /^teachers\/([0-9a-f-]{36})\/forms\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i;
const ALLOWED_REASONS = new Set([
  "form_template_update",
  "form_template_delete",
  "form_template_save_uncertain",
]);

function normalizeCandidates(value: unknown, teacherId: string) {
  if (!Array.isArray(value) || value.length > MAX_CANDIDATES) {
    throw new Error(`paths must contain at most ${MAX_CANDIDATES} items`);
  }
  const paths = value.map((item) => String(item || "").trim()).filter(Boolean);
  const unique = Array.from(new Set(paths));
  if (unique.some((path) => FORM_IMAGE_PATTERN.exec(path)?.[1]?.toLowerCase() !== teacherId.toLowerCase())) {
    throw new Error("A form image path is invalid or belongs to another teacher");
  }
  return unique;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResponse({ ok: false, message: "Method not allowed" }, 405);

  try {
    const userClient = getUserClient(req);
    const admin = getAdminClient();
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const teacher = userData.user;
    if (userError || !teacher?.id) return jsonResponse({ ok: false, message: "Unauthorized" }, 401);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", teacher.id)
      .maybeSingle();
    if (profileError || profile?.role !== "teacher") {
      return jsonResponse({ ok: false, message: "Teacher account is required" }, 403);
    }

    const body = await req.json();
    const reason = ALLOWED_REASONS.has(String(body.reason || ""))
      ? String(body.reason)
      : "form_template_update";
    const paths = normalizeCandidates(body.paths, teacher.id);
    if (!paths.length) return jsonResponse({ ok: true, queued: 0 });

    // Deletion is deliberately deferred. The cleanup worker must recheck both
    // form_template_questions and form_run_questions immediately before remove().
    const notBefore = new Date(Date.now() + CLEANUP_GRACE_MS).toISOString();
    const jobs = paths.map((objectPath) => ({
      bucket_id: STORAGE_BUCKET,
      object_path: objectPath,
      owner_id: teacher.id,
      reason,
      not_before: notBefore,
    }));
    const { error: queueError } = await admin
      .from("storage_cleanup_jobs")
      // Existing rows may be active claims or permanent tombstones. Never
      // rewrite them from a client cleanup hint.
      .upsert(jobs, { onConflict: "bucket_id,object_path", ignoreDuplicates: true });
    if (queueError) throw queueError;

    return jsonResponse({ ok: true, queued: jobs.length });
  } catch (error) {
    console.error("cleanup-form-images failed", error);
    return jsonResponse({
      ok: false,
      message: "設問画像の整理を予約できませんでした。時間をおいて再度お試しください。",
    }, 500);
  }
});

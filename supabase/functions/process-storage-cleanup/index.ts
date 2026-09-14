import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, getUserClient } from "../_shared/supabase.ts";
import { CleanupJob, removeCleanupJob } from "../_shared/storage-cleanup.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResponse({ ok: false, message: "Method not allowed" }, 405);

  const admin = getAdminClient();
  const expectedSecret = Deno.env.get("STORAGE_CLEANUP_SECRET") || "";
  const maintenanceRequest = !!expectedSecret && req.headers.get("x-cleanup-secret") === expectedSecret;
  let ownerId: string | null = null;
  if (!maintenanceRequest) {
    const userClient = getUserClient(req);
    const { data: userData } = await userClient.auth.getUser();
    ownerId = userData.user?.id || null;
    if (!ownerId) return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", ownerId).maybeSingle();
    if (profile?.role !== "teacher") return jsonResponse({ ok: false, message: "Teacher account is required" }, 403);
  }
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
  let staleUploadsQueued = 0;
  if (maintenanceRequest) {
    const { data: queued, error: sweepError } = await admin.rpc("enqueue_stale_storage_uploads", {
      p_older_than: "48 hours", p_limit: limit * 4,
    });
    if (sweepError) return jsonResponse({ ok: false, message: sweepError.message }, 500);
    staleUploadsQueued = Number(queued) || 0;
  }
  const { data, error } = await admin.rpc("claim_storage_cleanup_jobs", { p_limit: limit, p_owner_id: ownerId });
  if (error) return jsonResponse({ ok: false, message: error.message }, 500);

  let deletedObjects = 0;
  let completed = 0;
  const failed: string[] = [];
  for (const job of (data || []) as CleanupJob[]) {
    try {
      deletedObjects += await removeCleanupJob(admin, job);
      const { error: completeError } = await admin.rpc("complete_storage_cleanup_job", {
        p_bucket_id: job.bucket_id, p_object_path: job.object_path, p_error: null,
      });
      if (completeError) throw completeError;
      completed += 1;
    } catch (jobError) {
      const message = String(jobError instanceof Error ? jobError.message : jobError);
      failed.push(job.object_path);
      await admin.rpc("complete_storage_cleanup_job", {
        p_bucket_id: job.bucket_id, p_object_path: job.object_path, p_error: message,
      });
    }
  }
  return jsonResponse({ ok: true, staleUploadsQueued, claimed: (data || []).length, completed, deletedObjects, failed });
});

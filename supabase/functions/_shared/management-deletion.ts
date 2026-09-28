import { listObjectPaths, removeCleanupJob } from "./storage-cleanup.ts";

// Each completed step is durable. Replaying a step after a timeout is idempotent.
export async function processManagementDeletion(admin: any, jobId: string, ownerId: string | null, budgetMs = 20000) {
  const { data, error } = await admin.rpc("claim_management_deletion", {
    p_job_id: jobId, p_owner_id: ownerId,
  });
  if (error) throw error;
  const job = data?.[0];
  if (!job) {
    let query = admin.from("management_deletion_jobs").select("state").eq("id", jobId);
    if (ownerId) query = query.eq("teacher_id", ownerId);
    const { data: existing, error: readError } = await query.single();
    if (readError) throw readError;
    return { completed: existing.state === "completed", pending: existing.state !== "completed" };
  }
  const deadline = Date.now() + budgetMs;
  async function save(state = "running") {
    const { data: saved, error: saveError } = await admin.from("management_deletion_jobs").update({
      remaining_storage: job.remaining_storage, remaining_users: job.remaining_users,
      state, updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("lease_id", job.lease_id).select("id").single();
    if (saveError || !saved) throw saveError || new Error("Deletion lease expired");
  }
  try {
    while (job.remaining_storage.length && Date.now() < deadline) {
      const target = job.remaining_storage[0];
      const { data: removable, error: prepareError } = await admin.rpc("prepare_management_storage_deletion", {
        p_path: target.object_path, p_kind: target.path_kind,
      });
      if (prepareError) throw prepareError;
      if (removable) {
        await removeCleanupJob(admin, { ...target, bucket_id: "class-whiteboard", attempts: 1 });
        if (target.path_kind === "prefix" && (await listObjectPaths(admin, "class-whiteboard", target.object_path)).length) {
          throw new Error("Storage deletion is not yet complete");
        }
        const { error: finishError } = await admin.rpc("complete_storage_cleanup_job", {
          p_bucket_id: "class-whiteboard", p_object_path: target.object_path, p_error: null,
        });
        if (finishError) throw finishError;
      }
      job.remaining_storage.shift();
      await save();
    }
    // Storage must be removed before Auth; Supabase rejects deletion of Storage owners.
    while (!job.remaining_storage.length && job.remaining_users.length && Date.now() < deadline) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(job.remaining_users[0], false);
      if (deleteError && deleteError.code !== "user_not_found" && deleteError.status !== 404) throw deleteError;
      job.remaining_users.shift();
      await save();
    }
    const completed = !job.remaining_storage.length && !job.remaining_users.length;
    await save(completed ? "completed" : "queued");
    return { completed, pending: !completed };
  } catch (error) {
    await save("queued");
    throw error;
  }
}

export async function processPendingManagementDeletions(admin: any, ownerId: string | null) {
  let query = admin.from("management_deletion_jobs").select("id").neq("state", "completed")
    .order("updated_at").limit(2);
  if (ownerId) query = query.eq("teacher_id", ownerId);
  const { data, error } = await query;
  if (error) throw error;
  const results = [];
  for (const job of data || []) {
    try {
      results.push({ id: job.id, ...await processManagementDeletion(admin, job.id, ownerId, 10000) });
    } catch (error) {
      console.error("Management deletion retry failed", job.id, error);
      results.push({ id: job.id, completed: false, pending: true });
    }
  }
  return results;
}

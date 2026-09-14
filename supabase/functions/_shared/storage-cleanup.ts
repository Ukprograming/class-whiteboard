const PAGE_SIZE = 1000;

export type CleanupJob = {
  bucket_id: string;
  object_path: string;
  path_kind: "object" | "prefix";
  attempts: number;
};

function safePath(value: unknown) {
  const path = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path || path.includes("..") || path.includes("\\") || path.length > 1024) {
    throw new Error("Unsafe Storage cleanup path");
  }
  return path;
}

export async function listObjectPaths(admin: any, bucket: string, root: string) {
  const result: string[] = [];
  const pending = [safePath(root)];
  while (pending.length) {
    const folder = pending.shift()!;
    for (let offset = 0;; offset += PAGE_SIZE) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      for (const entry of data || []) {
        const name = safePath(entry.name);
        const path = `${folder}/${name}`;
        if (entry.id === null) pending.push(path);
        else result.push(path);
      }
      if ((data || []).length < PAGE_SIZE) break;
    }
  }
  return result;
}

export async function removeCleanupJob(admin: any, job: CleanupJob) {
  const path = safePath(job.object_path);
  const paths = job.path_kind === "prefix"
    ? await listObjectPaths(admin, job.bucket_id, path)
    : [path];
  for (let offset = 0; offset < paths.length; offset += PAGE_SIZE) {
    const { error } = await admin.storage.from(job.bucket_id).remove(paths.slice(offset, offset + PAGE_SIZE));
    if (error) throw error;
  }
  return paths.length;
}

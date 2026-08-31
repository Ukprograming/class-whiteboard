import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, getUserClient } from "../_shared/supabase.ts";

const STORAGE_BUCKET = "class-whiteboard";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AssetRecord = {
  assetKey?: string;
  assetPath?: string;
};

function boardPageDataList(boardData: Record<string, unknown>) {
  const pages = Array.isArray(boardData.pages) ? boardData.pages : [];
  if (pages.length > 0) {
    return pages
      .map((page) => (page && typeof page === "object"
        ? (page as Record<string, unknown>).boardData
        : null))
      .filter((page): page is Record<string, unknown> => !!page && typeof page === "object");
  }
  return [boardData];
}

function collectAssetRecords(boardData: Record<string, unknown>) {
  const records: AssetRecord[] = [];
  for (const pageData of boardPageDataList(boardData)) {
    const objects = Array.isArray(pageData.objects) ? pageData.objects : [];
    for (const object of objects) {
      if (object && typeof object === "object" &&
          (object as Record<string, unknown>).kind === "image") {
        records.push(object as AssetRecord);
      }
    }
    if (pageData.background && typeof pageData.background === "object") {
      records.push(pageData.background as AssetRecord);
    }
  }
  return records;
}

function boardAssetPrefix(snapshotPath: string) {
  return String(snapshotPath).replace(/\.json$/i, "") + "/assets/";
}

function safeAssetFileName(record: AssetRecord, sourcePath: string, index: number) {
  const key = String(record.assetKey || `asset-${index + 1}`)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120) || `asset-${index + 1}`;
  const sourceName = sourcePath.split("/").pop() || "";
  const extensionMatch = sourceName.match(/\.([a-zA-Z0-9]{1,8})$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "bin";
  return `${key}-${index + 1}.${extension}`;
}

async function removeUploadedObjects(admin: ReturnType<typeof getAdminClient>, paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) console.error("Failed to clean up incomplete distribution snapshot", error);
}

async function createImmutableDistributionSnapshot(
  admin: ReturnType<typeof getAdminClient>,
  sourceSnapshotPath: string,
  distributionId: string,
) {
  const targetSnapshotPath = `shared/${distributionId}/snapshot.json`;
  const targetAssetPrefix = `shared/${distributionId}/snapshot/assets`;
  const uploadedPaths: string[] = [];

  const { data: sourceBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(sourceSnapshotPath);
  if (downloadError || !sourceBlob) {
    throw downloadError || new Error("Source board snapshot could not be downloaded");
  }

  let boardData: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await sourceBlob.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Source board snapshot must contain a JSON object");
    }
    boardData = parsed;
  } catch {
    throw new Error("Source board snapshot is not valid JSON");
  }

  const allowedSourceAssetPrefix = boardAssetPrefix(sourceSnapshotPath);
  const copiedAssets = new Map<string, string>();
  const copyJobs: Promise<void>[] = [];
  for (const [index, record] of collectAssetRecords(boardData).entries()) {
    const sourcePath = String(record.assetPath || "").trim();
    if (!sourcePath) continue;
    if (!sourcePath.startsWith(allowedSourceAssetPrefix)) {
      throw new Error("Source board contains an asset outside its authorized Storage path");
    }

    const existingTarget = copiedAssets.get(sourcePath);
    if (existingTarget) {
      record.assetPath = existingTarget;
      continue;
    }

    const targetPath = `${targetAssetPrefix}/${safeAssetFileName(record, sourcePath, index)}`;
    copiedAssets.set(sourcePath, targetPath);
    record.assetPath = targetPath;
    uploadedPaths.push(targetPath);
    copyJobs.push((async () => {
      const { error } = await admin.storage
        .from(STORAGE_BUCKET)
        .copy(sourcePath, targetPath);
      if (error) throw error;
    })());
  }

  try {
    const copyResults = await Promise.allSettled(copyJobs);
    const failedCopy = copyResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failedCopy) throw failedCopy.reason;
    const snapshotBlob = new Blob([JSON.stringify(boardData)], { type: "application/json" });
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(targetSnapshotPath, snapshotBlob, {
        contentType: "application/json",
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) throw uploadError;
    uploadedPaths.push(targetSnapshotPath);
    return { targetSnapshotPath, uploadedPaths };
  } catch (error) {
    await removeUploadedObjects(admin, uploadedPaths);
    throw error;
  }
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  try {
    const userClient = getUserClient(req);
    const admin = getAdminClient();
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
    }

    const {
      sourceBoardId,
      classId,
      title,
      targetFolderPath = "",
      distributionKind = "material",
    } = await req.json();
    const normalizedTitle = String(title || "").trim();
    const normalizedFolder = String(targetFolderPath || "").trim();
    const normalizedKind = String(distributionKind || "material").trim().toLowerCase();
    if (!UUID_PATTERN.test(String(sourceBoardId || "")) ||
        !UUID_PATTERN.test(String(classId || "")) ||
        !normalizedTitle || normalizedTitle.length > 120 ||
        !["material", "assignment"].includes(normalizedKind)) {
      return jsonResponse({
        ok: false,
        message: "sourceBoardId, classId, a 1-120 character title, and a valid distribution kind are required",
      }, 400);
    }

    const { data: sourceBoard, error: sourceError } = await admin
      .from("board_files")
      .select("id, snapshot_path")
      .eq("id", sourceBoardId)
      .eq("owner_kind", "teacher")
      .eq("teacher_id", userData.user.id)
      .maybeSingle();
    if (sourceError || !sourceBoard?.snapshot_path) {
      return jsonResponse({ ok: false, message: "Source board not found" }, 404);
    }
    if (!sourceBoard.snapshot_path.startsWith(`teachers/${userData.user.id}/`)) {
      return jsonResponse({ ok: false, message: "Invalid source board Storage path" }, 400);
    }

    const distributionId = crypto.randomUUID();
    const snapshot = await createImmutableDistributionSnapshot(
      admin,
      sourceBoard.snapshot_path,
      distributionId,
    );

    const { data: copyResult, error: copyError } = await admin
      .rpc("copy_board_to_class_atomic", {
        p_teacher_id: userData.user.id,
        p_source_board_id: sourceBoardId,
        p_class_id: classId,
        p_distribution_id: distributionId,
        p_snapshot_path: snapshot.targetSnapshotPath,
        p_title: normalizedTitle,
        p_target_folder_path: normalizedFolder,
        p_distribution_kind: normalizedKind,
      })
      .single();

    if (copyError || !copyResult) {
      await removeUploadedObjects(admin, snapshot.uploadedPaths);
      return jsonResponse({
        ok: false,
        message: copyError?.message || "Failed to copy board",
      }, 400);
    }

    return jsonResponse({
      ok: true,
      distributionId: copyResult.distribution_id,
      copiedCount: copyResult.copied_count,
    }, 200);
  } catch (error) {
    console.error("copy-board-to-class failed", error);
    return jsonResponse({ ok: false, message: String(error) }, 500);
  }
});

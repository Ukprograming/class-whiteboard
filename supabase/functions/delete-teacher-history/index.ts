import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, getUserClient } from "../_shared/supabase.ts";

const STORAGE_BUCKET = "class-whiteboard";
const STORAGE_PAGE_SIZE = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdminClient = ReturnType<typeof getAdminClient>;
type HistoryKind = "assignment" | "form";
type AssignmentBoard = {
  id: string;
  student_id: string | null;
  snapshot_path: string | null;
  thumbnail_path: string | null;
};

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeStoragePath(value: unknown) {
  const path = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path || path.includes("..") || path.includes("\\") || path.length > 1024) return "";
  return path;
}

function boardAssetRoot(snapshotPath: string) {
  return snapshotPath.replace(/\.json$/i, "") + "/assets";
}

async function listStorageObjectsRecursively(admin: AdminClient, root: string) {
  const objectPaths: string[] = [];
  const pendingFolders = [root];
  const visitedFolders = new Set<string>();

  while (pendingFolders.length > 0) {
    const folder = pendingFolders.shift()!;
    if (visitedFolders.has(folder)) continue;
    visitedFolders.add(folder);

    for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
      const { data, error } = await admin.storage.from(STORAGE_BUCKET).list(folder, {
        limit: STORAGE_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;

      const entries = data || [];
      for (const entry of entries) {
        const entryName = String(entry.name || "");
        if (!entryName || entryName === "." || entryName === ".." || entryName.includes("/")) {
          throw new Error("Invalid Storage entry returned while deleting history");
        }
        const path = `${folder}/${entryName}`;
        if (entry.id === null) pendingFolders.push(path);
        else objectPaths.push(path);
      }
      if (entries.length < STORAGE_PAGE_SIZE) break;
    }
  }

  return objectPaths;
}

async function removeStorageObjects(admin: AdminClient, paths: Iterable<string>) {
  const uniquePaths = Array.from(new Set(Array.from(paths).map(normalizeStoragePath).filter(Boolean)));
  for (const pathChunk of chunk(uniquePaths, STORAGE_PAGE_SIZE)) {
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove(pathChunk);
    if (error) throw error;
  }
  return uniquePaths.length;
}

async function collectAssignmentStoragePaths(
  admin: AdminClient,
  distributionId: string,
  boards: AssignmentBoard[],
) {
  const paths = new Set<string>();
  const sharedRoot = `shared/${distributionId}`;
  (await listStorageObjectsRecursively(admin, sharedRoot)).forEach((path) => paths.add(path));

  for (const board of boards) {
    const studentRoot = board.student_id ? `students/${board.student_id}/` : "";
    const snapshotPath = normalizeStoragePath(board.snapshot_path);
    if (snapshotPath && studentRoot && snapshotPath.startsWith(studentRoot)) {
      paths.add(snapshotPath);
      const assetRoot = boardAssetRoot(snapshotPath);
      (await listStorageObjectsRecursively(admin, assetRoot)).forEach((path) => paths.add(path));
    }
    const thumbnailPath = normalizeStoragePath(board.thumbnail_path);
    if (thumbnailPath && studentRoot && thumbnailPath.startsWith(studentRoot)) {
      paths.add(thumbnailPath);
    }
  }
  return paths;
}

async function collectUnreferencedFormImagePaths(
  admin: AdminClient,
  teacherId: string,
  runId: string,
) {
  const { data: runQuestions, error: questionError } = await admin
    .from("form_run_questions")
    .select("image_path")
    .eq("run_id", runId)
    .not("image_path", "is", null);
  if (questionError) throw questionError;

  const teacherPrefix = `teachers/${teacherId}/forms/`;
  const candidates = Array.from(new Set(
    (runQuestions || [])
      .map((question) => normalizeStoragePath(question.image_path))
      .filter((path) => path.startsWith(teacherPrefix)),
  ));
  if (candidates.length === 0) return new Set<string>();

  const [{ data: templateRefs, error: templateError }, { data: otherRunRefs, error: runError }] = await Promise.all([
    admin.from("form_template_questions").select("image_path").in("image_path", candidates),
    admin.from("form_run_questions").select("image_path").in("image_path", candidates).neq("run_id", runId),
  ]);
  if (templateError) throw templateError;
  if (runError) throw runError;

  const stillReferenced = new Set([
    ...(templateRefs || []).map((question) => normalizeStoragePath(question.image_path)),
    ...(otherRunRefs || []).map((question) => normalizeStoragePath(question.image_path)),
  ]);
  return new Set(candidates.filter((path) => !stillReferenced.has(path)));
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
    const teacher = userData.user;
    if (userError || !teacher?.id) {
      return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", teacher.id)
      .maybeSingle();
    if (profileError || profile?.role !== "teacher") {
      return jsonResponse({ ok: false, message: "Teacher account is required" }, 403);
    }

    const body = await req.json();
    const historyKind = String(body.historyKind || "") as HistoryKind;
    const historyId = String(body.historyId || "");
    if (!["assignment", "form"].includes(historyKind) || !UUID_PATTERN.test(historyId)) {
      return jsonResponse({ ok: false, message: "A valid history kind and ID are required" }, 400);
    }

    let classId = "";
    let title = "";
    let storagePaths = new Set<string>();
    let boardFileCount = 0;

    if (historyKind === "assignment") {
      const { data: distribution, error: distributionError } = await admin
        .from("board_distributions")
        .select("id, class_id, title")
        .eq("id", historyId)
        .eq("teacher_id", teacher.id)
        .eq("distribution_kind", "assignment")
        .maybeSingle();
      if (distributionError) throw distributionError;
      if (!distribution) return jsonResponse({ ok: false, message: "課題履歴が見つかりません。" }, 404);

      const { data: boardData, error: boardError } = await admin
        .from("board_files")
        .select("id, student_id, snapshot_path, thumbnail_path")
        .eq("distribution_id", historyId)
        .eq("owner_kind", "student");
      if (boardError) throw boardError;
      const boards = (boardData || []) as AssignmentBoard[];
      classId = distribution.class_id;
      title = distribution.title;
      boardFileCount = boards.length;
      storagePaths = await collectAssignmentStoragePaths(admin, historyId, boards);
    } else {
      const { data: run, error: runError } = await admin
        .from("form_runs")
        .select("id, class_id, title")
        .eq("id", historyId)
        .eq("teacher_id", teacher.id)
        .maybeSingle();
      if (runError) throw runError;
      if (!run) return jsonResponse({ ok: false, message: "フォーム履歴が見つかりません。" }, 404);
      classId = run.class_id;
      title = run.title;
      storagePaths = await collectUnreferencedFormImagePaths(admin, teacher.id, historyId);
    }

    const deletedStorageObjectCount = await removeStorageObjects(admin, storagePaths);
    const { data: deleteResult, error: deleteError } = await admin.rpc(
      "delete_teacher_history_records",
      {
        p_teacher_id: teacher.id,
        p_history_kind: historyKind,
        p_history_id: historyId,
      },
    );
    if (deleteError) throw deleteError;
    if (!deleteResult?.deleted) {
      throw new Error("History record was not deleted");
    }

    return jsonResponse({
      ok: true,
      historyKind,
      historyId,
      classId,
      title,
      deletedBoardFileCount: deleteResult.deletedBoardFileCount || boardFileCount,
      deletedStorageObjectCount,
    });
  } catch (error) {
    console.error("delete-teacher-history failed", error);
    return jsonResponse({
      ok: false,
      message: "履歴と関連データの削除を完了できませんでした。時間をおいて再度お試しください。",
    }, 500);
  }
});

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, getUserClient } from "../_shared/supabase.ts";

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

    const { sourceBoardId, classId, title, targetFolderPath = "" } = await req.json();
    if (!sourceBoardId || !classId || !title) {
      return jsonResponse({ ok: false, message: "sourceBoardId, classId, and title are required" }, 400);
    }

    const { data: copyResult, error: copyError } = await admin
      .rpc("copy_board_to_class_atomic", {
        p_teacher_id: userData.user.id,
        p_source_board_id: sourceBoardId,
        p_class_id: classId,
        p_title: String(title).trim(),
        p_target_folder_path: String(targetFolderPath || "").trim(),
      })
      .single();

    if (copyError || !copyResult) {
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
    return jsonResponse({ ok: false, message: String(error) }, 500);
  }
});

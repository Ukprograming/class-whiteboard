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

    const { data: klass } = await admin
      .from("classes")
      .select("id, teacher_id")
      .eq("id", classId)
      .maybeSingle();

    if (!klass || klass.teacher_id !== userData.user.id) {
      return jsonResponse({ ok: false, message: "Class not found for this teacher" }, 404);
    }

    const { data: source } = await admin
      .from("board_files")
      .select("*")
      .eq("id", sourceBoardId)
      .eq("teacher_id", userData.user.id)
      .maybeSingle();

    if (!source) {
      return jsonResponse({ ok: false, message: "Source board not found" }, 404);
    }

    const { data: distribution, error: distributionError } = await admin
      .from("board_distributions")
      .insert({
        class_id: classId,
        teacher_id: userData.user.id,
        source_board_id: sourceBoardId,
        title,
      })
      .select("id")
      .single();

    if (distributionError) {
      return jsonResponse({ ok: false, message: distributionError.message }, 400);
    }

    const { data: students, error: studentsError } = await admin
      .from("students")
      .select("id")
      .eq("class_id", classId)
      .eq("active", true);

    if (studentsError) {
      return jsonResponse({ ok: false, message: studentsError.message }, 400);
    }

    const rows = (students || []).map((student) => ({
      owner_kind: "student",
      student_id: student.id,
      class_id: classId,
      folder_path: String(targetFolderPath || "").trim(),
      name: title,
      snapshot_path: source.snapshot_path,
      thumbnail_path: source.thumbnail_path,
      source_board_id: sourceBoardId,
      size_bytes: source.size_bytes || 0,
    }));

    if (rows.length > 0) {
      const { error: insertError } = await admin.from("board_files").insert(rows);
      if (insertError) {
        return jsonResponse({ ok: false, message: insertError.message }, 400);
      }
    }

    return jsonResponse({
      ok: true,
      distributionId: distribution.id,
      copiedCount: rows.length,
    }, 200);
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) }, 500);
  }
});

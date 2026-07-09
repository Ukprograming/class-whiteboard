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

    const { studentId, password } = await req.json();
    if (!studentId || String(password || "").length < 6) {
      return jsonResponse({ ok: false, message: "studentId and password(6+ chars) are required" }, 400);
    }

    const { data: student, error: studentError } = await admin
      .from("students")
      .select("auth_user_id, class_id, classes!inner(teacher_id)")
      .eq("id", studentId)
      .maybeSingle();

    if (studentError || !student || student.classes.teacher_id !== userData.user.id) {
      return jsonResponse({ ok: false, message: "Student not found for this teacher" }, 404);
    }

    const { error } = await admin.auth.admin.updateUserById(student.auth_user_id, {
      password,
    });

    if (error) {
      return jsonResponse({ ok: false, message: error.message }, 400);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) }, 500);
  }
});

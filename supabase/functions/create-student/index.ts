import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  getAdminClient,
  getUserClient,
  normalizeCode,
  normalizeLoginId,
  studentAuthEmail,
} from "../_shared/supabase.ts";

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

    const body = await req.json();
    const classCode = normalizeCode(body.classCode);
    const studentLoginId = normalizeLoginId(body.studentLoginId);
    const displayName = String(body.displayName || studentLoginId).trim();
    const password = String(body.password || "");

    if (!classCode || !studentLoginId || !displayName || password.length < 6) {
      return jsonResponse({
        ok: false,
        message: "classCode, studentLoginId, displayName, and password(6+ chars) are required",
      }, 400);
    }

    const { data: klass, error: classError } = await admin
      .from("classes")
      .select("id, teacher_id")
      .eq("class_code", classCode)
      .maybeSingle();

    if (classError || !klass || klass.teacher_id !== userData.user.id) {
      return jsonResponse({ ok: false, message: "Class not found for this teacher" }, 404);
    }

    const email = studentAuthEmail(classCode, studentLoginId);
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        role: "student",
      },
      user_metadata: {
        class_code: classCode,
        student_login_id: studentLoginId,
        display_name: displayName,
      },
    });

    if (authError || !authData.user) {
      return jsonResponse({ ok: false, message: authError?.message || "Failed to create student user" }, 400);
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: authData.user.id,
      role: "student",
      display_name: displayName,
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(authData.user.id);
      return jsonResponse({ ok: false, message: profileError.message }, 400);
    }

    const { data: student, error: studentError } = await admin
      .from("students")
      .insert({
        auth_user_id: authData.user.id,
        class_id: klass.id,
        student_login_id: studentLoginId,
        display_name: displayName,
        auth_email: email,
        created_by: userData.user.id,
      })
      .select("id, student_login_id, display_name")
      .single();

    if (studentError) {
      await admin.auth.admin.deleteUser(authData.user.id);
      return jsonResponse({ ok: false, message: studentError.message }, 400);
    }

    return jsonResponse({ ok: true, student }, 200);
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) }, 500);
  }
});

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, getPasswordVerificationClient, getUserClient } from "../_shared/supabase.ts";
import { processManagementDeletion } from "../_shared/management-deletion.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  try {
    const admin = getAdminClient();
    const { data, error } = await getUserClient(req).auth.getUser();
    const teacher = data.user;
    if (error || !teacher?.id || !teacher.email) return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
    const body = await req.json().catch(() => null);
    const kind = body?.kind;
    const targetId = kind === "teacher" ? teacher.id : String(body?.classId || "");
    const password = String(body?.teacherPassword || "");
    if (!["class", "teacher"].includes(kind) || !UUID.test(targetId) || !password || password.length > 4096) {
      return jsonResponse({ ok: false, message: "削除対象と先生のパスワードを確認してください。" }, 400);
    }
    const { data: profile } = await admin.from("profiles").select("role").eq("id", teacher.id).maybeSingle();
    if (profile?.role !== "teacher") return jsonResponse({ ok: false, message: "Teacher account is required" }, 403);
    let confirmation = "アカウント削除";
    if (kind === "class") {
      const { data: klass, error: classError } = await admin.from("classes").select("class_code")
        .eq("id", targetId).eq("teacher_id", teacher.id).maybeSingle();
      if (classError) throw classError;
      if (!klass) return jsonResponse({ ok: false, message: "対象クラスを確認できません。管理画面を更新してください。" }, 403);
      confirmation = klass.class_code;
    }
    if (body.confirmation !== confirmation) return jsonResponse({ ok: false, message: "確認文字が一致しません。" }, 400);
    const verifier = getPasswordVerificationClient();
    const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword({ email: teacher.email, password });
    if (verified.session) await verifier.auth.signOut({ scope: "local" });
    if (passwordError || verified.user?.id !== teacher.id) {
      return jsonResponse({ ok: false, message: "先生のパスワードが正しくありません。" }, 403);
    }
    const { data: jobId, error: beginError } = await admin.rpc("begin_management_deletion", {
      p_teacher_id: teacher.id, p_kind: kind, p_target_id: targetId,
    });
    if (beginError) throw beginError;
    try {
      const result = await processManagementDeletion(admin, jobId, teacher.id);
      return jsonResponse({ ok: true, jobId, ...result });
    } catch (cleanupError) {
      console.error("Management deletion queued for retry", jobId, cleanupError);
      // DB deletion has already committed; never report it as an untouched failure.
      return jsonResponse({ ok: true, jobId, completed: false, pending: true });
    }
  } catch (error) {
    console.error("delete-management-target failed", error);
    return jsonResponse({ ok: false, message: "削除の結果を確認できませんでした。管理画面を更新して確認してください。" }, 500);
  }
});

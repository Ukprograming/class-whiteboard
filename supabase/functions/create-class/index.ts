import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, getUserClient, normalizeCode } from "../_shared/supabase.ts";

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

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profile?.role !== "teacher") {
      return jsonResponse({ ok: false, message: "Teacher account required" }, 403);
    }

    const body = await req.json();
    const name = String(body.name || "").trim();
    const classCode = normalizeCode(body.classCode || crypto.randomUUID().slice(0, 8));

    if (!name || !classCode) {
      return jsonResponse({ ok: false, message: "Class name and code are required" }, 400);
    }

    const { data, error } = await admin
      .from("classes")
      .insert({
        teacher_id: userData.user.id,
        class_code: classCode,
        name,
      })
      .select("id, class_code, name")
      .single();

    if (error) {
      return jsonResponse({ ok: false, message: error.message }, 400);
    }

    return jsonResponse({ ok: true, class: data }, 200);
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) }, 500);
  }
});

import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  try {
    const inviteCode = Deno.env.get("TEACHER_INVITE_CODE");
    const { email, password, displayName, inviteCode: providedCode } = await req.json();

    if (!inviteCode || providedCode !== inviteCode) {
      return jsonResponse({ ok: false, message: "Invalid invite code" }, 403);
    }
    if (!email || !password) {
      return jsonResponse({ ok: false, message: "Email and password are required" }, 400);
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        role: "teacher",
        display_name: displayName || email,
      },
    });

    if (error || !data.user) {
      return jsonResponse({ ok: false, message: error?.message || "Failed to create teacher" }, 400);
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: data.user.id,
      role: "teacher",
      display_name: displayName || email,
    });

    if (profileError) {
      return jsonResponse({ ok: false, message: profileError.message }, 400);
    }

    return jsonResponse({ ok: true, userId: data.user.id }, 200);
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, message: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }
});

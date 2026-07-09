import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function getUserClient(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization") || "",
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function normalizeCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeLoginId(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function studentAuthEmail(classCode: string, studentLoginId: string) {
  const safeClassCode = classCode.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const safeStudentId = studentLoginId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `cw.${safeClassCode}.${safeStudentId}@students.class-whiteboard.local`;
}

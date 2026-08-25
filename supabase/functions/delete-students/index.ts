import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  getAdminClient,
  getPasswordVerificationClient,
  getUserClient,
} from "../_shared/supabase.ts";

const STORAGE_BUCKET = "class-whiteboard";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SELECTED_STUDENTS = 100;
const STORAGE_PAGE_SIZE = 1000;

type AdminClient = ReturnType<typeof getAdminClient>;
type StudentRecord = {
  id: string;
  auth_user_id: string;
  display_name: string;
  classes: { teacher_id: string } | Array<{ teacher_id: string }>;
};

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function classTeacherId(student: StudentRecord) {
  const relation = Array.isArray(student.classes) ? student.classes[0] : student.classes;
  return relation?.teacher_id || "";
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
          throw new Error("Invalid Storage entry returned while deleting a student folder");
        }
        const path = `${folder}/${entryName}`;
        if (entry.id === null) {
          pendingFolders.push(path);
        } else {
          objectPaths.push(path);
        }
      }

      if (entries.length < STORAGE_PAGE_SIZE) break;
    }
  }

  return objectPaths;
}

async function removeStudentStorage(admin: AdminClient, studentId: string) {
  const root = `students/${studentId}`;
  const objectPaths = await listStorageObjectsRecursively(admin, root);
  for (const paths of chunk(objectPaths, STORAGE_PAGE_SIZE)) {
    const { error } = await admin.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) throw error;
  }

  const remainingObjects = await listStorageObjectsRecursively(admin, root);
  if (remainingObjects.length > 0) {
    throw new Error("The student Storage folder could not be emptied completely");
  }
  return objectPaths.length;
}

async function verifyTeacherPassword(email: string, password: string, expectedUserId: string) {
  const verificationClient = getPasswordVerificationClient();
  const { data, error } = await verificationClient.auth.signInWithPassword({ email, password });
  const passwordVerified = !error && data.user?.id === expectedUserId;
  if (data.session) {
    const { error: signOutError } = await verificationClient.auth.signOut({ scope: "local" });
    if (signOutError) {
      console.warn("Failed to close the temporary teacher password verification session", signOutError);
    }
  }
  return passwordVerified;
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
    if (userError || !teacher?.id || !teacher.email) {
      return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const studentIds = Array.from(new Set(
      Array.isArray(body.studentIds) ? body.studentIds.map((value: unknown) => String(value || "")) : [],
    ));
    const teacherPassword = String(body.teacherPassword || "");
    if (
      studentIds.length === 0 ||
      studentIds.length > MAX_SELECTED_STUDENTS ||
      studentIds.some((studentId) => !UUID_PATTERN.test(studentId)) ||
      !teacherPassword ||
      teacherPassword.length > 4096
    ) {
      return jsonResponse({
        ok: false,
        message: `1〜${MAX_SELECTED_STUDENTS}人の生徒と先生自身のパスワードを指定してください。`,
      }, 400);
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", teacher.id)
      .maybeSingle();
    if (profileError || profile?.role !== "teacher") {
      return jsonResponse({ ok: false, message: "Teacher account is required" }, 403);
    }

    const { data: studentsData, error: studentsError } = await admin
      .from("students")
      .select("id, auth_user_id, display_name, classes!inner(teacher_id)")
      .in("id", studentIds);
    if (studentsError) throw studentsError;

    const students = (studentsData || []) as StudentRecord[];
    if (
      students.length !== studentIds.length ||
      students.some((student) => classTeacherId(student) !== teacher.id)
    ) {
      return jsonResponse({
        ok: false,
        message: "選択した生徒の中に、この先生のクラスに所属していない生徒が含まれています。",
      }, 403);
    }

    const passwordVerified = await verifyTeacherPassword(
      teacher.email,
      teacherPassword,
      teacher.id,
    );
    if (!passwordVerified) {
      return jsonResponse({ ok: false, message: "先生のパスワードが正しくありません。" }, 403);
    }

    const deleted: Array<{ studentId: string; displayName: string; storageObjectCount: number }> = [];
    const failed: Array<{ studentId: string; displayName: string }> = [];

    for (const student of students) {
      try {
        const storageObjectCount = await removeStudentStorage(admin, student.id);
        const { error: deleteUserError } = await admin.auth.admin.deleteUser(
          student.auth_user_id,
          false,
        );
        if (deleteUserError) throw deleteUserError;

        const { data: remainingStudent, error: verifyDeleteError } = await admin
          .from("students")
          .select("id")
          .eq("id", student.id)
          .maybeSingle();
        if (verifyDeleteError || remainingStudent) {
          throw verifyDeleteError || new Error("Student database records were not deleted");
        }

        deleted.push({
          studentId: student.id,
          displayName: student.display_name,
          storageObjectCount,
        });
      } catch (error) {
        console.error(`Failed to delete student ${student.id}`, error);
        failed.push({ studentId: student.id, displayName: student.display_name });
      }
    }

    return jsonResponse({
      ok: true,
      deletedCount: deleted.length,
      deleted,
      failed,
    }, 200);
  } catch (error) {
    console.error("delete-students failed", error);
    return jsonResponse({ ok: false, message: "生徒の削除処理を完了できませんでした。" }, 500);
  }
});

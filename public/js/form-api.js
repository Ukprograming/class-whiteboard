import { managementApi, supabase, supabaseEnabled } from "./supabase-api.js?v=monitor-sync-20260819&realtime-scale=20260902&realtime-duplex=20260824&session-recovery=20260824&student-delete=20260826&forms=20260830&assignments=20260831&history-delete=20260904&auth-singleton=20260904&mode-presence=20260905&auth-load=20260905";

const STORAGE_BUCKET = String(window.CLASS_WHITEBOARD_CONFIG?.storageBucket || "class-whiteboard").trim();
const MAX_FORM_IMAGE_BYTES = 8 * 1024 * 1024;
const FORM_IMAGE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);
const questionImageUrlCache = new Map();

function assertFormsEnabled() {
  if (!supabaseEnabled || !supabase) {
    throw new Error("フォーム機能にはSupabase接続が必要です。");
  }
}

function normalizeClassCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeQuestions(questions = []) {
  return [...questions]
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((question) => ({
      ...question,
      options: Array.isArray(question.options) ? question.options : [],
    }));
}

function normalizeQuestionImagePath(value) {
  const path = String(value || "").trim();
  return /^teachers\/[0-9a-f-]{36}\/forms\/[0-9a-f-]{36}\.(?:jpg|png|webp|gif)$/i.test(path)
    ? path
    : "";
}

function revokeQuestionImageUrls() {
  questionImageUrlCache.forEach((promise) => {
    void promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  });
  questionImageUrlCache.clear();
}

window.addEventListener("pagehide", revokeQuestionImageUrls, { once: true });

function normalizeTemplate(template) {
  if (!template) return null;
  return {
    ...template,
    questions: normalizeQuestions(template.form_template_questions || template.questions || []),
  };
}

function normalizeRun(run) {
  if (!run) return null;
  return {
    ...run,
    questions: normalizeQuestions(run.form_run_questions || run.questions || []),
  };
}

async function getClassByCode(classCode) {
  assertFormsEnabled();
  const { data, error } = await supabase
    .from("classes")
    .select("id, class_code, name, teacher_id")
    .eq("class_code", normalizeClassCode(classCode))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("クラスが見つかりません。");
  return data;
}

async function getCurrentStudent() {
  assertFormsEnabled();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error(userError?.message || "生徒ログインが必要です。");
  }
  const { data, error } = await supabase
    .from("students")
    .select("id, class_id, student_login_id, display_name, active")
    .eq("auth_user_id", userData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("有効な生徒登録が見つかりません。");
  return data;
}

export const formApi = {
  enabled: supabaseEnabled,

  async listTemplates() {
    assertFormsEnabled();
    const { data, error } = await supabase
      .from("form_templates")
      .select(`
        id,
        title,
        archived,
        created_at,
        updated_at,
        form_template_questions (
          id,
          position,
          question_type,
          prompt,
          required,
          options,
          image_path,
          image_mime_type,
          image_width,
          image_height
        )
      `)
      .eq("archived", false)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeTemplate);
  },

  async saveTemplate({ id = null, title, questions }) {
    assertFormsEnabled();
    const payload = (questions || []).map((question) => ({
      questionType: question.questionType || question.question_type || "text",
      prompt: String(question.prompt || "").trim(),
      required: question.required !== false,
      options: (question.options || []).map((option) => ({
        id: String(option.id || "").trim(),
        label: String(option.label || "").trim(),
      })),
      imagePath: normalizeQuestionImagePath(question.imagePath || question.image_path) || null,
      imageMimeType: String(question.imageMimeType || question.image_mime_type || "").trim() || null,
      imageWidth: Number(question.imageWidth || question.image_width) || null,
      imageHeight: Number(question.imageHeight || question.image_height) || null,
    }));
    const { data, error } = await supabase.rpc("save_form_template", {
      p_template_id: id || null,
      p_title: String(title || "").trim(),
      p_questions: payload,
    });
    if (error) throw error;
    return data;
  },

  async uploadQuestionImage(file, { width, height } = {}) {
    assertFormsEnabled();
    const mimeType = String(file?.type || "").toLowerCase();
    const extension = FORM_IMAGE_EXTENSIONS.get(mimeType);
    if (!file || !extension) throw new Error("画像はJPEG・PNG・WebP・GIF形式を選択してください。");
    if (!file.size || file.size > MAX_FORM_IMAGE_BYTES) throw new Error("画像は8MB以下にしてください。");
    const imageWidth = Number(width);
    const imageHeight = Number(height);
    if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight)
      || imageWidth < 1 || imageHeight < 1 || imageWidth > 12000 || imageHeight > 12000) {
      throw new Error("画像の縦横サイズを確認できませんでした。別の画像を選択してください。");
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error(userError?.message || "教員ログインが必要です。");
    const imagePath = `teachers/${userData.user.id}/forms/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(imagePath, file, {
      contentType: mimeType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw error;
    return { imagePath, imageMimeType: mimeType, imageWidth, imageHeight };
  },

  async removeQuestionImages(paths = []) {
    assertFormsEnabled();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error(userError?.message || "教員ログインが必要です。");
    const prefix = `teachers/${userData.user.id}/forms/`;
    const safePaths = Array.from(new Set(paths.map(normalizeQuestionImagePath)))
      .filter((path) => path.startsWith(prefix));
    if (!safePaths.length) return;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(safePaths);
    if (error) throw error;
  },

  async getQuestionImageUrl(path) {
    assertFormsEnabled();
    const imagePath = normalizeQuestionImagePath(path);
    if (!imagePath) throw new Error("設問画像の保存先が不正です。");
    if (!questionImageUrlCache.has(imagePath)) {
      questionImageUrlCache.set(imagePath, (async () => {
        const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(imagePath);
        if (error) throw error;
        return URL.createObjectURL(data);
      })());
    }
    try {
      return await questionImageUrlCache.get(imagePath);
    } catch (error) {
      questionImageUrlCache.delete(imagePath);
      throw error;
    }
  },

  async deleteTemplate(templateId) {
    assertFormsEnabled();
    const { error } = await supabase
      .from("form_templates")
      .delete()
      .eq("id", templateId);
    if (error) throw error;
  },

  async startRun(templateId, classCode) {
    assertFormsEnabled();
    const { data, error } = await supabase.rpc("start_form_run", {
      p_template_id: templateId,
      p_class_code: normalizeClassCode(classCode),
    });
    if (error) throw error;
    return data;
  },

  async closeRun(runId) {
    assertFormsEnabled();
    const { data, error } = await supabase
      .from("form_runs")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "open")
      .select("id, class_id, title, status, started_at, closed_at")
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async deleteRunHistory(runId) {
    assertFormsEnabled();
    return managementApi.deleteTeacherHistory({
      historyKind: "form",
      historyId: runId,
    });
  },

  async getActiveRun(classCode) {
    assertFormsEnabled();
    const klass = await getClassByCode(classCode);
    const { data, error } = await supabase
      .from("form_runs")
      .select(`
        id,
        template_id,
        class_id,
        teacher_id,
        title,
        status,
        started_at,
        closed_at,
        form_run_questions (
          id,
          run_id,
          position,
          question_type,
          prompt,
          required,
          options,
          image_path,
          image_mime_type,
          image_width,
          image_height
        )
      `)
      .eq("class_id", klass.id)
      .eq("status", "open")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return normalizeRun(data);
  },

  async getRun(runId) {
    assertFormsEnabled();
    const { data, error } = await supabase
      .from("form_runs")
      .select(`
        id,
        template_id,
        class_id,
        teacher_id,
        title,
        status,
        started_at,
        closed_at,
        form_run_questions (
          id,
          run_id,
          position,
          question_type,
          prompt,
          required,
          options,
          image_path,
          image_mime_type,
          image_width,
          image_height
        )
      `)
      .eq("id", runId)
      .maybeSingle();
    if (error) throw error;
    return normalizeRun(data);
  },

  async listRunHistory(classCode, limit = 30) {
    assertFormsEnabled();
    const klass = await getClassByCode(classCode);
    const { data, error } = await supabase
      .from("form_runs")
      .select("id, template_id, class_id, title, status, started_at, closed_at")
      .eq("class_id", klass.id)
      .order("started_at", { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 30, 100)));
    if (error) throw error;
    return data || [];
  },

  async getResponses(runId) {
    assertFormsEnabled();
    const { data, error } = await supabase
      .from("form_responses")
      .select(`
        id,
        run_id,
        run_question_id,
        student_id,
        answer_text,
        selected_option_ids,
        submitted_at,
        updated_at,
        student:students (display_name, student_login_id)
      `)
      .eq("run_id", runId)
      .order("submitted_at", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getRosterCount(classCode) {
    assertFormsEnabled();
    const klass = await getClassByCode(classCode);
    const { count, error } = await supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("class_id", klass.id)
      .eq("active", true);
    if (error) throw error;
    return Number(count) || 0;
  },

  async getRoster(classCode) {
    assertFormsEnabled();
    const klass = await getClassByCode(classCode);
    const { data, error } = await supabase
      .from("students")
      .select("id, student_login_id, display_name, active, created_at")
      .eq("class_id", klass.id)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async listMyRunHistory(limit = 100) {
    assertFormsEnabled();
    const student = await getCurrentStudent();
    const { data, error } = await supabase
      .from("form_runs")
      .select("id, template_id, class_id, title, status, started_at, closed_at")
      .eq("class_id", student.class_id)
      .order("started_at", { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 100, 100)));
    if (error) throw error;
    return data || [];
  },

  async getMyResponses(runId) {
    assertFormsEnabled();
    const student = await getCurrentStudent();
    const { data, error } = await supabase
      .from("form_responses")
      .select("id, run_id, run_question_id, answer_text, selected_option_ids, submitted_at, updated_at")
      .eq("run_id", runId)
      .eq("student_id", student.id);
    if (error) throw error;
    return data || [];
  },

  async submitResponse({ runId, questionId, answerText = null, selectedOptionIds = [] }) {
    assertFormsEnabled();
    const student = await getCurrentStudent();
    const selected = Array.from(new Set(
      (selectedOptionIds || []).map((value) => String(value || "").trim()).filter(Boolean)
    ));
    const text = String(answerText || "").trim() || null;
    const { data, error } = await supabase
      .from("form_responses")
      .upsert({
        run_id: runId,
        run_question_id: questionId,
        student_id: student.id,
        answer_text: text,
        selected_option_ids: selected,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "run_question_id,student_id" })
      .select("id, run_id, run_question_id, answer_text, selected_option_ids, submitted_at, updated_at")
      .single();
    if (error) throw error;
    return data;
  },

  subscribeToResponses(runId, onChange, onStatus) {
    assertFormsEnabled();
    const channelName = `form-responses:${runId}:${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "form_responses",
          filter: `run_id=eq.${runId}`,
        },
        (payload) => onChange?.(payload)
      )
      .subscribe((status, error) => onStatus?.(status, error));

    return () => supabase.removeChannel(channel);
  },
};

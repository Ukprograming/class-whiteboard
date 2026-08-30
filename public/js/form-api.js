import { supabase, supabaseEnabled } from "./supabase-api.js?v=monitor-sync-20260819&realtime-scale=20260824&realtime-duplex=20260824&session-recovery=20260824&student-delete=20260826&forms=20260830";

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
          options
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
    }));
    const { data, error } = await supabase.rpc("save_form_template", {
      p_template_id: id || null,
      p_title: String(title || "").trim(),
      p_questions: payload,
    });
    if (error) throw error;
    return data;
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
          options
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
          options
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

const TEACHER_CLASS_HINTS_KEY = "classWhiteboard.teacherClassHints.v1";
const TEACHER_SELECTED_CLASS_KEY = "classWhiteboard.teacherSelectedClass.v1";
const TEACHER_LAST_CLASS_KEY = "classWhiteboard.teacherLastClass.v1";

function normalizeClassCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeClassHint(value) {
  const classCode = normalizeClassCode(value?.classCode || value?.class_code);
  if (!classCode) return null;
  const name = String(value?.name || "").trim();
  return {
    classCode,
    name,
    label: name ? `${classCode} — ${name}` : classCode,
    savedAt: new Date().toISOString(),
  };
}

export function getTeacherClassHints() {
  try {
    const raw = localStorage.getItem(TEACHER_CLASS_HINTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeClassHint).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function saveTeacherClassHints(classes) {
  const incoming = (Array.isArray(classes) ? classes : [classes])
    .map(normalizeClassHint)
    .filter(Boolean);
  if (incoming.length === 0) return getTeacherClassHints();

  const merged = [...incoming, ...getTeacherClassHints()];
  const unique = [];
  const seen = new Set();
  for (const item of merged) {
    if (seen.has(item.classCode)) continue;
    seen.add(item.classCode);
    unique.push(item);
  }

  try {
    localStorage.setItem(TEACHER_CLASS_HINTS_KEY, JSON.stringify(unique.slice(0, 50)));
  } catch (error) {
    console.warn("Could not save teacher classes locally.", error);
  }
  return unique;
}

export function setSelectedTeacherClass(classCode) {
  const normalized = normalizeClassCode(classCode);
  try {
    if (normalized) {
      sessionStorage.setItem(TEACHER_SELECTED_CLASS_KEY, normalized);
      localStorage.setItem(TEACHER_LAST_CLASS_KEY, normalized);
    } else {
      sessionStorage.removeItem(TEACHER_SELECTED_CLASS_KEY);
      localStorage.removeItem(TEACHER_LAST_CLASS_KEY);
    }
  } catch (error) {
    console.warn("Could not save the selected teacher class.", error);
  }
}

export function getSelectedTeacherClass() {
  try {
    return normalizeClassCode(
      sessionStorage.getItem(TEACHER_SELECTED_CLASS_KEY) ||
      localStorage.getItem(TEACHER_LAST_CLASS_KEY)
    );
  } catch {
    return "";
  }
}

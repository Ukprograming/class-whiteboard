import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const commonJsFiles = [
  "server.js",
  "public/js/app-config.js",
  "public/js/legacy-socket-loader.js",
  "public/js/local-config-loader.js",
];
const moduleFiles = [
  "public/js/board-ui.js",
  "public/js/stamps.js",
  "public/js/student.js",
  "public/js/supabase-api.js",
  "public/js/teacher.js",
  "public/js/teacher-class-storage.js",
  "public/js/teacher-login.js",
  "public/js/teacher-signup.js",
  "public/js/ui-icons.js",
  "public/js/whiteboard.js",
];

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    stdio: "inherit",
  });
  return result.status === 0;
}

let ok = true;

for (const filePath of commonJsFiles) {
  ok = runNodeCheck(filePath) && ok;
}

const tempDir = mkdtempSync(join(tmpdir(), "class-whiteboard-check-"));
try {
  for (const filePath of moduleFiles) {
    const tempPath = join(tempDir, `${basename(filePath)}.mjs`);
    copyFileSync(filePath, tempPath);
    ok = runNodeCheck(tempPath) && ok;
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const realtimeApiSource = readFileSync("public/js/supabase-api.js", "utf8");
const emittedEvents = ["public/js/teacher.js", "public/js/student.js"].flatMap((filePath) => {
  const source = readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
  return Array.from(source.matchAll(/socket\.emit\("([^"]+)"/g), (match) => match[1]);
});
const localOnlyEvents = new Set([
  "join-class",
  "join-student",
  "joinAsStudent",
  "join-teacher",
  "joinAsTeacher",
  "leave-class",
]);
const roleEventBlocks = Array.from(
  realtimeApiSource.matchAll(/(?:TEACHER|STUDENT|SHARED)_REALTIME_EVENTS = new Set\(\[([\s\S]*?)\]\)/g)
);
const roleMappedEvents = new Set(roleEventBlocks.flatMap((block) =>
  Array.from(block[1].matchAll(/"([^"]+)"/g), (match) => match[1])
));
const missingRoleMappings = Array.from(new Set(emittedEvents.filter((eventName) =>
  !localOnlyEvents.has(eventName) && !roleMappedEvents.has(eventName)
)));
if (missingRoleMappings.length > 0) {
  console.error(`Realtime events missing role authorization: ${missingRoleMappings.join(", ")}`);
  ok = false;
}

if (!ok) {
  process.exit(1);
}

console.log("JavaScript syntax check passed.");

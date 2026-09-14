import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputIndex = process.argv.indexOf("--output");
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : "dist-pages/release-manifest.json";
if (!output) throw new Error("--output requires a file path");

async function listFiles(directory, accept = () => true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", ".temp", ".git", "dist", "coverage"].includes(entry.name)) {
      files.push(...await listFiles(child, accept));
    } else if (entry.isFile() && entry.name !== ".env" && !entry.name.startsWith(".env.") && accept(child)) {
      files.push(child.replaceAll("\\", "/"));
    }
  }
  return files;
}

const tracked = [
  ...await listFiles("public"),
  ...await listFiles("supabase/migrations", (file) => file.endsWith(".sql")),
  ...await listFiles("supabase/functions"),
];
try {
  await readFile("supabase/config.toml");
  tracked.push("supabase/config.toml");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
tracked.sort();
const files = {};
for (const file of tracked) {
  const bytes = await readFile(file);
  const content = /^supabase\/(?:migrations|functions)\//.test(file)
    ? bytes.toString("utf8").replace(/\r\n/g, "\n")
    : bytes;
  files[file] = createHash("sha256").update(content).digest("hex");
}

const manifest = {
  schemaVersion: 1,
  gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  generatedAt: new Date().toISOString(),
  hashing: "sha256; Supabase source line endings normalized to LF; public files hashed as bytes",
  files,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Release manifest written to ${output}.`);

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STAMP_PATH = "supabase/backend-release.json";
const IGNORED_DIRECTORIES = new Set(["node_modules", ".temp", ".git", "dist", "coverage"]);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) files.push(...await listFiles(child));
    else if (entry.isFile() && entry.name !== ".env" && !entry.name.startsWith(".env.")) files.push(child);
  }
  return files;
}

export async function calculateBackendSourceHash() {
  const migrationFiles = (await listFiles("supabase/migrations")).filter((file) => file.endsWith(".sql"));
  const files = [...migrationFiles, ...await listFiles("supabase/functions")];
  try {
    await readFile("supabase/config.toml");
    files.push("supabase/config.toml");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  files.sort();
  const digest = createHash("sha256");
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    const normalizedText = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
    digest.update(normalized).update("\0").update(normalizedText).update("\0");
  }
  return { hash: digest.digest("hex"), files };
}

const mode = process.argv[2] || "--check";
const { hash, files } = await calculateBackendSourceHash();

if (mode === "--print") {
  console.log(hash);
} else if (mode === "--write-stamp") {
  const stamp = {
    schemaVersion: 1,
    backendSourceSha256: hash,
    verifiedAt: new Date().toISOString(),
    sourceFileCount: files.length,
  };
  await writeFile(STAMP_PATH, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
  console.log(`Wrote ${STAMP_PATH} for verified backend ${hash}.`);
} else if (mode === "--check") {
  let stamp;
  try {
    stamp = JSON.parse(await readFile(STAMP_PATH, "utf8"));
  } catch {
    console.error(`${STAMP_PATH} is missing or invalid.`);
    console.error("After applying and verifying this exact backend source, run: node scripts/release-preflight.mjs --write-stamp");
    process.exit(1);
  }
  if (stamp.backendSourceSha256 !== hash || stamp.sourceFileCount !== files.length) {
    console.error("Frontend deployment stopped: Supabase source differs from the verified backend stamp.");
    console.error(`source=${hash}`);
    console.error(`stamp=${stamp.backendSourceSha256 || "missing"}`);
    process.exit(1);
  }
  console.log(`Backend release stamp passed: ${hash} (${files.length} files).`);
} else {
  console.error("Usage: node scripts/release-preflight.mjs --check|--print|--write-stamp");
  process.exit(2);
}

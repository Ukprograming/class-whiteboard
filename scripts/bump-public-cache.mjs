import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const key = process.argv[2];
if (!key || !/^[a-z0-9-]+=[a-z0-9-]+$/i.test(key)) {
  console.error("Usage: node scripts/bump-public-cache.mjs name=value");
  process.exit(2);
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(child));
    else if (/\.(?:html|js|mjs)$/.test(entry.name)) files.push(child);
  }
  return files;
}

let changedCount = 0;
for (const file of await filesBelow("public")) {
  const original = await readFile(file, "utf8");
  const separator = file.endsWith(".html") ? "&amp;" : "&";
  const append = (whole, prefix, quote) => prefix.includes(key) ? whole : `${prefix}${separator}${key}${quote}`;
  let updated = original.replace(/((?:from\s+|import\s*)["']\.\/[^"']+\?v=[^"']+)(["'])/g, append);
  updated = updated.replace(/((?:href|src)="\.\/[^"\s>]+\?v=[^"]+)(")/g, append);
  if (updated !== original) {
    await writeFile(file, updated, "utf8");
    changedCount += 1;
  }
}
console.log(`Updated cache key in ${changedCount} public files.`);

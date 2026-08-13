import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["custom_components/ha_yaml_source_editor/frontend", "scripts", "test"];
const extensions = new Set([".js", ".mjs"]);

for (const file of await filesToCheck()) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
}

async function filesToCheck() {
  const files = [];
  for (const root of roots) {
    files.push(...await walk(root));
  }
  return files.sort();
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }

    if (extensions.has(extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

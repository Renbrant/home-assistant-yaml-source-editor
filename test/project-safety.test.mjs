import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const integrationDir = join(root, "custom_components", "ha_yaml_source_editor");
const appExtensions = new Set([".py", ".js", ".mjs"]);

test("application code keeps one controlled Lovelace save primitive", async () => {
  const files = await appFiles();
  const hits = await grep(files, /lovelace\/config\/save/g);

  assert.deepEqual(hits.map((hit) => hit.relativePath), [
    "frontend/ha-yaml-source-editor-panel.js",
  ]);
  assert.equal(hits.length, 1);
});

test("application code has no forbidden Lovelace writes or direct storage access", async () => {
  const files = await appFiles();
  const hits = await grep(
    files,
    /lovelace\/config\/delete|lovelace\/dashboards\/(?:create|update|delete)|(?:^|["'\\/])\.storage(?:["'\\/]|$)|eval\s*\(|new Function/g,
  );

  assert.deepEqual(hits, []);
});

test("HA import module is the only application YAML dump caller", async () => {
  const files = await appFiles();
  const hits = await grep(files, /\bdump\s*\(|import\s+\{\s*dump\b/g);

  assert.deepEqual(
    Array.from(new Set(hits.map((hit) => hit.relativePath))),
    ["frontend/ha-import.mjs"],
  );
});

async function appFiles(dir = integrationDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(integrationDir, fullPath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      if (relativePath === "frontend/vendor") {
        continue;
      }
      files.push(...await appFiles(fullPath));
      continue;
    }

    if (appExtensions.has(extname(entry.name))) {
      files.push({ fullPath, relativePath });
    }
  }

  return files;
}

async function grep(files, pattern) {
  const hits = [];
  for (const file of files) {
    const text = await readFile(file.fullPath, "utf8");
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        hits.push({ ...file, match });
      }
    }
  }
  return hits;
}

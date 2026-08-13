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

test("source edit sync refresh updates UI without remounting the panel", async () => {
  const panel = await readFile(
    join(integrationDir, "frontend", "ha-yaml-source-editor-panel.js"),
    "utf8",
  );
  const syncRefreshBody = methodBody(panel, "async _refreshSyncStatus");

  assert.match(syncRefreshBody, /this\._refreshSyncUi\(\)/);
  assert.doesNotMatch(syncRefreshBody, /this\._render\(\)/);
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

function methodBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing method: ${signature}`);

  const methodOpen = source.indexOf(") {", start);
  assert.notEqual(methodOpen, -1, `Missing method body: ${signature}`);
  const bodyStart = methodOpen + 2;
  assert.notEqual(bodyStart, -1, `Missing method body: ${signature}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(bodyStart + 1, index);
      }
    }
  }

  throw new Error(`Unterminated method body: ${signature}`);
}

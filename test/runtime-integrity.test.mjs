import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const integrationDir = resolve(root, "custom_components", "ha_yaml_source_editor");
const entrypoint = join(integrationDir, "frontend", "ha-yaml-source-editor-panel.js");

test("frontend module imports resolve inside shipped integration directory", async () => {
  const seen = new Set();
  const pending = [entrypoint];

  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const source = await readFile(current, "utf8");
    for (const specifier of relativeImportSpecifiers(source)) {
      const resolved = normalize(resolve(dirname(current), specifier));
      const relativePath = relative(integrationDir, resolved);

      assert.equal(
        relativePath.startsWith(".."),
        false,
        `${current} imports outside the shipped integration directory: ${specifier}`,
      );
      assert.equal(existsSync(resolved), true, `Missing frontend import: ${specifier}`);
      pending.push(resolved);
    }
  }
});

function relativeImportSpecifiers(source) {
  const specifiers = [];
  const importPattern = /import\s+(?:[^'"]+\s+from\s+)?["'](\.[^"']+)["']/g;
  let match;

  while ((match = importPattern.exec(source)) !== null) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

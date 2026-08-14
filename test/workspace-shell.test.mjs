import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const panelPath = join(
  root,
  "custom_components",
  "ha_yaml_source_editor",
  "frontend",
  "ha-yaml-source-editor-panel.js",
);

test("panel renders a workspace shell with explorer editor and inspector regions", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /class="workspace-shell"/);
  assert.match(panel, /class="workspace-region explorer-region"/);
  assert.match(panel, /aria-label="Explorer"/);
  assert.match(panel, /class="workspace-region editor-region"/);
  assert.match(panel, /aria-label="Editor"/);
  assert.match(panel, /class="workspace-region inspector-region"/);
  assert.match(panel, /aria-label="Inspector"/);
});

test("workspace shell keeps the existing Source editor host in the editor region", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /class="source-code-editor-shell"[\s\S]+id="source-code-editor-host"/);
  assert.match(panel, /id="source-code-editor-host"/);
  assert.match(panel, /_attachSourceEditor\(\);/);
});

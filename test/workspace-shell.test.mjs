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

  assert.match(panel, /class="app-header"/);
  assert.match(panel, /HA YAML Source Editor/);
  assert.match(panel, /class="app-version"/);
  assert.match(panel, /class="workspace-shell"/);
  assert.match(panel, /class="workspace-region explorer-region"/);
  assert.match(panel, /aria-label="Explorer"/);
  assert.match(panel, /class="workspace-region editor-region"/);
  assert.match(panel, /aria-label="Editor"/);
  assert.match(panel, /class="workspace-region inspector-region"/);
  assert.match(panel, /aria-label="Inspector"/);
});

test("panel exposes primary Source workflow commands inside the editor region", async () => {
  const panel = await readFile(panelPath, "utf8");
  const commandBar = panel.match(
    /<nav class="command-bar"[\s\S]+?<\/nav>/
  )?.[0] ?? "";
  const panelChrome = panel.match(
    /<section class="panel[\s\S]+?<div class="workspace-shell">/
  )?.[0] ?? "";

  assert.match(panel, /class="command-bar"[\s\S]+aria-label="Source workflow commands"/);
  assert.match(panel, /id="create-source-document"[\s\S]+Create Source/);
  assert.match(panel, /id="save-source-document"[\s\S]+Save Source/);
  assert.match(panel, /id="validate-source-document"[\s\S]+Validate/);
  assert.match(panel, /id="compare-source-ha"[\s\S]+Compare/);
  assert.match(panel, /id="deploy-saved-source"[\s\S]+Deploy/);
  assert.equal([...panel.matchAll(/id="create-source-document"/g)].length, 1);
  assert.equal([...panel.matchAll(/id="save-source-document"/g)].length, 1);
  assert.equal([...panel.matchAll(/id="validate-source-document"/g)].length, 1);
  assert.equal([...panel.matchAll(/id="compare-source-ha"/g)].length, 1);
  assert.equal([...panel.matchAll(/id="deploy-saved-source"/g)].length, 1);
  assert.match(
    panel,
    /<main class="workspace-region editor-region"[\s\S]+\$\{this\._renderCommandBar\(\)\}[\s\S]+\$\{this\._renderSourceDocumentSection\(\)\}/
  );
  assert.doesNotMatch(panelChrome, /_renderCommandBar/);
  assert.doesNotMatch(commandBar, /toggle-inspector/);
});

test("Create Source command reuses existing creation wiring and state", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /_canCreateSourceDocument\(\)[\s\S]+this\._selectedDashboard/);
  assert.match(panel, /_canCreateSourceDocument\(\)[\s\S]+!this\._sourceDocument/);
  assert.match(panel, /_canCreateSourceDocument\(\)[\s\S]+this\._sourceStatus === "No document"/);
  assert.match(panel, /const createDisabled = this\._canCreateSourceDocument\(\) \? "" : "disabled"/);
  assert.match(panel, /id="create-source-document" \${createDisabled}/);
  assert.match(panel, /\.getElementById\("create-source-document"\)[\s\S]+this\._createSourceDocument\(\)/);
  assert.doesNotMatch(panel, /Create Source Document[\s\S]+<\/button>/);
  assert.match(panel, /No source document exists for this dashboard\./);
});

test("Explorer omits normal Integration API status card and keeps navigation", async () => {
  const panel = await readFile(panelPath, "utf8");
  const explorer = panel.match(
    /<aside class="workspace-region explorer-region"[\s\S]+?<\/aside>/
  )?.[0] ?? "";

  assert.match(explorer, /Dashboards/);
  assert.match(explorer, /refresh-dashboards/);
  assert.match(explorer, /Storage Mode/);
  assert.doesNotMatch(explorer, /Integration version/);
  assert.doesNotMatch(explorer, /Backend API/);
  assert.doesNotMatch(explorer, /Home Assistant/);
  assert.match(panel, /Unable to reach the HA YAML Source Editor backend API/);
});

test("Editor header owns dashboard context and labeled source statuses", async () => {
  const panel = await readFile(panelPath, "utf8");
  const appHeader = panel.match(
    /<header class="app-header"[\s\S]+?<\/header>/
  )?.[0] ?? "";

  assert.match(panel, /class="editor-context"/);
  assert.match(panel, /class="editor-target"/);
  assert.match(panel, /class="editor-target-path"/);
  assert.match(panel, /id="editor-source-status-value"/);
  assert.match(panel, /Source: \$\{this\._sourceStateLabel\(\)\}/);
  assert.match(panel, /id="editor-sync-status-value"/);
  assert.match(panel, /Source vs HA: \$\{this\._sourceVsHa\}/);
  assert.doesNotMatch(appHeader, /app-state-summary/);
  assert.doesNotMatch(appHeader, /editor-source-status-value/);
  assert.doesNotMatch(appHeader, /editor-sync-status-value/);
});

test("panel exposes vertical Inspector edge tab with accessible state", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /id="toggle-inspector"/);
  assert.match(panel, /class="inspector-edge-tab"/);
  assert.match(panel, /Close Inspector/);
  assert.match(panel, /Open Inspector/);
  assert.match(panel, /class="inspector-edge-arrow"/);
  assert.match(panel, /this\._inspectorOpen \? ">" : "<"/);
  assert.match(panel, /aria-controls="workspace-inspector"/);
  assert.match(panel, /aria-expanded="\$\{inspectorPressed\}"/);
  assert.match(panel, /writing-mode: vertical-rl/);
  assert.match(panel, /\.panel\.inspector-open \.inspector-edge-tab/);
  assert.match(panel, /right: var\(--inspector-width\)/);
  assert.match(panel, /right: var\(--inspector-overlay-width\)/);
});

test("panel uses actual panel width for responsive Inspector defaults", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /const INSPECTOR_WIDE_LAYOUT_MIN_WIDTH = 1100/);
  assert.match(panel, /@container \(max-width: 1100px\)/);
  assert.match(panel, /new ResizeObserver/);
  assert.match(panel, /querySelector\("\.panel"\)/);
  assert.match(panel, /getBoundingClientRect\(\)\.width/);
  assert.match(panel, /width > INSPECTOR_WIDE_LAYOUT_MIN_WIDTH/);
  assert.doesNotMatch(panel, /addEventListener\("resize"/);
});

test("manual Inspector toggle overrides responsive defaults", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /this\._inspectorUserToggled = false/);
  assert.match(panel, /this\._inspectorUserToggled = true/);
  assert.match(panel, /this\._inspectorUserToggled \|\|/);
});

test("panel keeps simplified Inspector navigation", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /role="tablist"[\s\S]+Inspector sections/);
  assert.match(panel, /data-inspector-tab="status"/);
  assert.match(panel, /data-inspector-tab="details"/);
  assert.match(panel, /data-inspector-tab="actions"/);
});

test("workspace shell keeps the existing Source editor host in the editor region", async () => {
  const panel = await readFile(panelPath, "utf8");

  assert.match(panel, /class="source-code-editor-shell"[\s\S]+id="source-code-editor-host"/);
  assert.match(panel, /id="source-code-editor-host"/);
  assert.match(panel, /_attachSourceEditor\(\);/);
});

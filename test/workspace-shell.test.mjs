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
  assert.match(panel, /id="initialize-source-from-ha"[\s\S]+Initialize from HA/);
  assert.match(panel, /id="save-source-document"[\s\S]+Save Source/);
  assert.match(panel, /id="validate-source-document"[\s\S]+Validate/);
  assert.match(panel, /id="compare-source-ha"[\s\S]+Compare/);
  assert.match(panel, /id="deploy-saved-source"[\s\S]+Deploy/);
  assert.equal([...panel.matchAll(/id="create-source-document"/g)].length, 1);
  assert.equal([...panel.matchAll(/id="initialize-source-from-ha"/g)].length, 1);
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
  assert.match(panel, /this\._sourceStatus === "No document"/);
  assert.doesNotMatch(panel, /Create Source Document[\s\S]+<\/button>/);
  assert.match(panel, /No source document exists for this dashboard\./);
});

test("Initialize from HA command is an editor-scoped empty Source bootstrap action", async () => {
  const panel = await readFile(panelPath, "utf8");
  const commandBar = panel.match(
    /<nav class="command-bar"[\s\S]+?<\/nav>/
  )?.[0] ?? "";
  const canInitialize = methodBody(panel, "_canInitializeSourceFromHa()");

  assert.match(commandBar, /id="create-source-document"[\s\S]+id="initialize-source-from-ha"[\s\S]+id="save-source-document"/);
  assert.match(panel, /const initializeDisabled = this\._canInitializeSourceFromHa\(\)[\s\S]+\?[\s\S]+""[\s\S]+:[\s\S]+"disabled"/);
  assert.match(panel, /const initializeSource = this\.shadowRoot\.getElementById\([\s\S]+"initialize-source-from-ha"[\s\S]+\)/);
  assert.match(panel, /initializeSource\.onclick = \(\) => this\._initializeSourceFromHa\(\)/);
  assert.match(canInitialize, /this\._selectedDashboard/);
  assert.match(canInitialize, /this\._sourceDocument/);
  assert.match(canInitialize, /this\._sourceStatus !== "Checking"/);
  assert.match(canInitialize, /this\._sourceStatus !== "Loading"/);
  assert.match(canInitialize, /this\._sourceStatus !== "Creating"/);
  assert.match(canInitialize, /this\._sourceStatus !== "Saving"/);
  assert.match(canInitialize, /this\._isSavedSourceBlank\(\)/);
  assert.match(canInitialize, /!this\._hasUnsavedSourceChanges\(\)/);
  assert.match(canInitialize, /!this\._isDeploymentInProgress\(\)/);
  assert.match(canInitialize, /!this\._isResolutionInProgress\(\)/);
  assert.match(canInitialize, /this\._validationStatus !== "Validating"/);
  assert.match(canInitialize, /this\._compareStatus !== "Loading"/);
  assert.match(canInitialize, /this\._syncStatus !== "Calculating"/);
});

test("Initialize from HA reuses HA import conversion and persistence without Lovelace save", async () => {
  const panel = await readFile(panelPath, "utf8");
  const prepareImport = methodBody(panel, "async _prepareHaImportSource(haConfig)");
  const initialize = methodBody(panel, "async _initializeSourceFromHa()");
  const conflictImport = methodBody(panel, "async _importHaVersion()");
  const canResolve = methodBody(panel, "_canResolveFromCompare()");

  assert.match(prepareImport, /haConfigToSourceYaml\(haConfig\)/);
  assert.match(prepareImport, /analyzeSourceText\(sourceText\)/);
  assert.match(prepareImport, /canonicalJson\(sourceAnalysis\.parsedConfig\)/);
  assert.match(initialize, /this\._readDashboardConfig\([\s\S]+force: true/);
  assert.match(initialize, /this\._prepareHaImportSource\(currentHaConfig\)/);
  assert.match(initialize, /type: "ha_yaml_source_editor\/documents\/import_ha_version"/);
  assert.match(initialize, /document_id: freshDocument\.document_id/);
  assert.match(initialize, /expected_source_updated_at: freshDocument\.updated_at/);
  assert.match(initialize, /this\._replaceSourceEditorText\([\s\S]+resetHistory: true/);
  assert.match(initialize, /this\._clearValidation\(\)/);
  assert.match(initialize, /this\._clearComparison\(\)/);
  assert.match(initialize, /this\._refreshSyncStatus\(\{ reloadHa: true \}\)/);
  assert.doesNotMatch(initialize, /lovelace\/config\/save|_asyncSaveLovelaceConfig/);
  assert.match(conflictImport, /if \(!this\._canResolveFromCompare\(\)\)/);
  assert.match(conflictImport, /this\._prepareHaImportSource\(currentHaConfig\)/);
  assert.match(conflictImport, /this\._prepareHaImportSource\(finalHaConfig\)/);
  assert.match(canResolve, /this\._compareStatus !== "Ready"/);
  assert.match(canResolve, /!this\._compareSnapshot/);
  assert.match(canResolve, /this\._sourceVsHa !== "DIFFERENT"/);
});

test("Initialize from HA success is presented as Source context, not conflict resolution", async () => {
  const panel = await readFile(panelPath, "utf8");
  const initialize = methodBody(panel, "async _initializeSourceFromHa()");
  const conflictImport = methodBody(panel, "async _importHaVersion()");
  const sourceSection = methodBody(panel, "_renderSourceDocumentSection()");

  assert.match(initialize, /this\._sourceMessage = "Source initialized from Home Assistant\."/);
  assert.match(initialize, /this\._resolutionStatus = RESOLUTION_OPERATION\.IDLE/);
  assert.match(initialize, /this\._resolutionMessage = null/);
  assert.doesNotMatch(initialize, /this\._resolutionStatus = RESOLUTION_OPERATION\.SUCCESS/);
  assert.match(sourceSection, /this\._renderSourceMessage\(\)/);
  assert.match(conflictImport, /this\._resolutionStatus = RESOLUTION_OPERATION\.SUCCESS/);
  assert.match(conflictImport, /this\._resolutionMessage = "Home Assistant version imported as Source\."/);
});

test("Compare uses baseline terminology and Deployment keeps true deployment labels", async () => {
  const panel = await readFile(panelPath, "utf8");
  const compareSection = methodBody(panel, "_renderCompareSection()");
  const compareBody = methodBody(panel, "_renderCompareBody()");
  const deploymentSection = methodBody(panel, "_renderDeploymentSection()");
  const deploymentBaseline = methodBody(panel, "_renderDeploymentBaseline()");
  const deploymentImportNote = methodBody(panel, "_renderDeploymentImportNote()");

  assert.match(compareSection, /<dt>Baseline snapshot<\/dt>/);
  assert.match(compareSection, /<dt>Baseline origin<\/dt>/);
  assert.doesNotMatch(compareSection, /Last deployed snapshot/);
  assert.match(compareBody, /Changes in Saved Source since baseline/);
  assert.match(compareBody, /Changes in Home Assistant since baseline/);
  assert.match(compareBody, /Baseline -> Saved Source/);
  assert.match(compareBody, /Baseline -> Current Home Assistant/);
  assert.match(compareBody, /Baseline configuration snapshot is unavailable/);
  assert.doesNotMatch(compareBody, /last deployment|Last deployed/);
  assert.match(deploymentSection, /this\._renderDeploymentBaseline\(\)/);
  assert.match(deploymentBaseline, /baselineOrigin === "deployment"[\s\S]+<dt>Last deployed<\/dt>/);
  assert.match(deploymentImportNote, /baselineOrigin === "ha_import"[\s\S]+This Source was imported from Home Assistant/);
  assert.match(panel, /if \(origin === "ha_import"\)[\s\S]+return "Imported from Home Assistant"/);
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
  assert.match(explorer, /Home Assistant/);
  assert.match(explorer, /YAML Templates/);
  assert.match(explorer, /id="template-tree-body"/);
  assert.match(explorer, /class="explorer-group"/);
  assert.match(panel, /Unable to reach the HA YAML Source Editor backend API/);
});

test("Explorer loads Template index through partial refresh without remounting the editor", async () => {
  const panel = await readFile(panelPath, "utf8");

  const loadTemplates =
    panel.match(
      /async _loadTemplateIndex\(\{ force = false \} = \{\}\) \{[\s\S]+?\n  \}/
    )?.[0] ?? "";

  assert.notEqual(loadTemplates, "", "Missing _loadTemplateIndex method");
  assert.match(
    loadTemplates,
    /type: "ha_yaml_source_editor\/templates\/index"/
  );
  assert.match(loadTemplates, /this\._refreshTemplateTreeUi\(\)/);
  assert.doesNotMatch(loadTemplates, /this\._render\(\)/);
  assert.doesNotMatch(
    loadTemplates,
    /_attachSourceEditor|_destroySourceEditor|createSourceCodeEditor/
  );

  assert.match(panel, /this\._loadTemplateIndex\(\)/);
  assert.match(panel, /_renderTemplateTree\(\)/);
  assert.match(panel, /id="template-tree-body"/);
  assert.match(panel, /YAML Templates/);
});
test("Explorer refresh reloads both dashboards and Template index", async () => {
  const panel = await readFile(panelPath, "utf8");
  const refreshDashboards = methodBody(panel, "_refreshDashboards()");

  assert.match(
    refreshDashboards,
    /this\._loadDashboards\(\{\s*force:\s*true\s*\}\)/
  );
  assert.match(
    refreshDashboards,
    /this\._loadTemplateIndex\(\{\s*force:\s*true\s*\}\)/
  );
});
test("Template Explorer reads blocks using backend-authoritative snapshot identity", async () => {
  const panel = await readFile(panelPath, "utf8");
  const selectTemplate = methodBody(
    panel,
    "async _selectTemplateBlock(blockId, entityId = null)"
  );

  assert.match(
    selectTemplate,
    /type: "ha_yaml_source_editor\/templates\/block\/get"/
  );
  assert.match(
    selectTemplate,
    /block_id: blockId/
  );
  assert.match(
    selectTemplate,
    /expected_source_sha256: sourceSha256/
  );

  assert.doesNotMatch(
    selectTemplate,
    /source_path:|relative_path:|start_line:|end_line:/
  );

  assert.match(
    selectTemplate,
    /this\._clearSelectedDashboard\(\)/
  );
  assert.match(
    selectTemplate,
    /this\._revealSelectedTemplateEntity\(\)/
  );
});

test("Template target uses a distinct editable CodeMirror document mode", async () => {
  const panel = await readFile(panelPath, "utf8");
  const attachEditor = methodBody(panel, "_attachSourceEditor()");
  const activeDocument = methodBody(
    panel,
    "_activeEditorDocument()"
  );
  const templateSection = methodBody(
    panel,
    "_renderTemplateBlockSection()"
  );

  assert.match(
    activeDocument,
    /templateBlockDocumentId/
  );
  assert.match(
    activeDocument,
    /text: this\._templateBlockText/
  );
  assert.match(
    activeDocument,
    /readOnly: false/
  );

  assert.match(
    attachEditor,
    /_handleEditorChange/
  );

  assert.match(
    templateSection,
    /id="save-template-block"/
  );
  assert.match(
    templateSection,
    /Save Template/
  );
  assert.match(
    templateSection,
    /Home Assistant Template semantic validation/
  );
  assert.doesNotMatch(
    templateSection,
    /preview is read-only/
  );
  assert.doesNotMatch(
    templateSection,
    /Save Source|Compare|Deploy|Initialize from HA/
  );
});

test("Template child navigation preserves Explorer expansion and remains non-fatal", async () => {
  const panel = await readFile(panelPath, "utf8");
  const selectTemplate = methodBody(
    panel,
    "async _selectTemplateBlock(blockId, entityId = null)"
  );
  const revealEntity = methodBody(
    panel,
    "_revealSelectedTemplateEntity()"
  );
  const wireTree = methodBody(
    panel,
    "_wireTemplateTreeHandlers()"
  );

  assert.match(
    panel,
    /this\._openTemplateBlockIds = new Set\(\)/
  );

  assert.match(
    selectTemplate,
    /this\._openTemplateBlockIds\.add\(blockId\)/
  );

  assert.match(
    panel,
    /this\._openTemplateBlockIds\.has\(block\.block_id\)[\s\S]+open/
  );

  assert.match(
    wireTree,
    /details\.ontoggle/
  );

  assert.match(
    wireTree,
    /this\._openTemplateBlockIds\.add\(blockId\)/
  );

  assert.match(
    wireTree,
    /this\._openTemplateBlockIds\.delete\(blockId\)/
  );

  assert.match(
    wireTree,
    /this\._templateSearchQuery\.trim\(\)[\s\S]+return/
  );

  assert.match(
    revealEntity,
    /typeof this\._sourceEditor\.revealLine === "function"/
  );
});
test("Template search filters the existing index without remounting its input", async () => {
  const panel = await readFile(panelPath, "utf8");
  const renderTree = methodBody(
    panel,
    "_renderTemplateTree()"
  );
  const refreshTree = methodBody(
    panel,
    "_refreshTemplateTreeUi()"
  );


  assert.match(
    panel,
    /id="template-search-input"/
  );

  assert.match(
    renderTree,
    /filterTemplateBlocks/
  );

  assert.match(
    renderTree,
    /this\._templateSearchQuery/
  );

  assert.match(
    renderTree,
    /Boolean\(searchQuery\)/
  );

  assert.match(
    panel,
    /templateSearch\.oninput/
  );

  assert.match(
    panel,
    /this\._templateSearchQuery = templateSearch\.value/
  );

  assert.match(
    panel,
    /this\._refreshTemplateTreeUi\(\)/
  );

  assert.doesNotMatch(
    refreshTree,
    /template-search-input|_render\(\)/
  );
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

test("routine hass updates refresh existing DOM instead of full-rendering the panel", async () => {
  const panel = await readFile(panelPath, "utf8");
  const hassSetter = methodBody(panel, "set hass(hass)");
  const routineRefresh = methodBody(panel, "_refreshRoutineUi()");

  assert.match(hassSetter, /this\._hass = hass/);
  assert.match(hassSetter, /this\._refreshRoutineUi\(\)/);
  assert.doesNotMatch(hassSetter, /this\._render\(\)/);
  assert.match(routineRefresh, /if \(!this\._hasRendered\)/);
  assert.match(routineRefresh, /this\._refreshExplorerUi\(\)/);
  assert.match(routineRefresh, /this\._refreshSourceEditorUi\(\)/);
  assert.match(routineRefresh, /this\._refreshSyncUi\(\)/);
  assert.match(routineRefresh, /this\._wireEventHandlers\(/);
});

test("routine refresh paths do not detach or recreate the active Source editor", async () => {
  const panel = await readFile(panelPath, "utf8");
  const routineRefresh = methodBody(panel, "_refreshRoutineUi()");
  const loadStatus = methodBody(panel, "async _loadStatus()");
  const loadDashboards =
    panel.match(/async _loadDashboards\(\{ force = false \} = \{\}\) \{[\s\S]+?\n  \}/)?.[0] ?? "";

  assert.doesNotMatch(routineRefresh, /innerHTML = `[\s\S]+source-code-editor-host/);
  assert.doesNotMatch(routineRefresh, /_attachSourceEditor|_destroySourceEditor|createSourceCodeEditor/);
  assert.doesNotMatch(loadStatus, /this\._render\(\)/);
  assert.match(loadStatus, /this\._refreshRoutineUi\(\)/);
  assert.match(loadDashboards, /this\._refreshRoutineUi\(\)/);
  assert.notEqual(loadDashboards, "", "Missing _loadDashboards method");
  assert.doesNotMatch(loadDashboards, /this\._render\(\)/);
});

test("partial refresh helpers do not replace the Source editor host", async () => {
  const panel = await readFile(panelPath, "utf8");
  const refreshHelpers = [
    "_refreshApplicationHeader()",
    "_refreshExplorerUi()",
    "_refreshEditorContextUi()",
    "_refreshSourceEditorUi()",
    "_refreshSyncUi()",
    "_refreshDeploymentUi()",
    "_refreshInspectorUi()",
  ];

  for (const helper of refreshHelpers) {
    assert.doesNotMatch(methodBody(panel, helper), /source-code-editor-host|_attachSourceEditor|_destroySourceEditor|createSourceCodeEditor/);
  }
});

test("disconnect invalidates rendered DOM after destroying the Source editor", async () => {
  const panel = await readFile(panelPath, "utf8");
  const disconnected = methodBody(panel, "disconnectedCallback()");

  assert.match(disconnected, /this\._destroySourceEditor\(\)/);
  assert.match(disconnected, /this\._disconnectInspectorResizeObserver\(\)/);
  assert.match(disconnected, /this\._hasRendered = false/);
});

test("reconnect recreates the editor instead of reusing a destroyed EditorView", async () => {
  const panel = await readFile(panelPath, "utf8");
  const connected = methodBody(panel, "connectedCallback()");
  const routineRefresh = methodBody(panel, "_refreshRoutineUi()");
  const render = methodBody(panel, "_render()");

  assert.match(connected, /if \(!this\._hasRendered\)[\s\S]+this\._render\(\)/);
  assert.match(routineRefresh, /if \(!this\._hasRendered\)[\s\S]+if \(this\.isConnected\)[\s\S]+this\._render\(\)/);
  assert.match(render, /this\._hasRendered = true/);
  assert.match(render, /this\._attachSourceEditor\(\)/);
});

test("full renders preserve same-document editor viewport and focus defensively", async () => {
  const panel = await readFile(panelPath, "utf8");
  const render = methodBody(panel, "_render()");

  assert.match(render, /documentId: this\._sourceEditorDocumentId/);
  assert.match(render, /hadFocus: this\._sourceEditor\.hasFocus\(\)/);
  assert.match(render, /effect: this\._sourceEditor\.captureViewportSnapshot\(\)/);
  assert.match(render, /shouldRestoreEditorViewportSnapshot\(editorViewportSnapshot/);
  assert.match(render, /this\._sourceEditor\.restoreViewportSnapshot/);
  assert.match(render, /shouldRestoreEditorFocusSnapshot\(editorViewportSnapshot/);
  assert.match(render, /this\._sourceEditor\.focus\(\)/);
});

test("document switches still reset document-specific editor state", async () => {
  const panel = await readFile(panelPath, "utf8");
  const selectDashboard = methodBody(panel, "_selectDashboard(dashboard)");
  const attachSourceEditor = methodBody(panel, "_attachSourceEditor()");

  assert.match(selectDashboard, /this\._destroySourceEditor\(\)/);
  assert.match(attachSourceEditor, /if \(this\._sourceEditorDocumentId !== documentId\)/);
  assert.match(attachSourceEditor, /this\._replaceSourceEditorText\([\s\S]+text,[\s\S]+documentId,[\s\S]+resetHistory: true/);
});

function methodBody(source, signature) {
  let start = source.indexOf(`\n  ${signature}`);
  if (start === -1) {
    start = source.indexOf(signature);
  }
  assert.notEqual(start, -1, `Missing method: ${signature}`);

  const bodyStart = source.indexOf("{", start);
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

test("Template edits use a dedicated buffer and unsaved-change guard", async () => {
  const panel = await readFile(panelPath, "utf8");

  const changeHandler = methodBody(
    panel,
    "_handleTemplateEditorChange(text)"
  );

  const discardGuard = methodBody(
    panel,
    "_confirmDiscardUnsavedChanges()"
  );

  assert.match(
    panel,
    /this\._templateBlockText = ""/
  );

  assert.match(
    panel,
    /this\._lastSavedTemplateBlockText = ""/
  );

  assert.match(
    panel,
    /_hasUnsavedTemplateChanges\(\)/
  );

  assert.match(
    changeHandler,
    /this\._templateBlockText = text/
  );

  assert.match(
    discardGuard,
    /this\._hasUnsavedEditorChanges\(\)/
  );

  assert.match(
    discardGuard,
    /This Template block has unsaved changes/
  );
});

test("same Template block child navigation preserves the active edit buffer", async () => {
  const panel = await readFile(panelPath, "utf8");

  const selectTemplate = methodBody(
    panel,
    "async _selectTemplateBlock(blockId, entityId = null)"
  );

  assert.match(
    selectTemplate,
    /const sameLoadedBlock =/
  );

  assert.match(
    selectTemplate,
    /blockId === this\._selectedTemplateBlockId/
  );

  assert.match(
    selectTemplate,
    /!\["Stale", "Uncertain"\]\.includes/
  );

  assert.match(
    selectTemplate,
    /this\._selectedTemplateEntityId = entityId/
  );

  assert.match(
    selectTemplate,
    /this\._revealSelectedTemplateEntity\(\)/
  );

  const sameBlockStart = selectTemplate.indexOf(
    "if (sameLoadedBlock)"
  );

  const discardStart = selectTemplate.indexOf(
    "if (!this._confirmDiscardUnsavedChanges())"
  );

  assert.ok(
    sameBlockStart !== -1 &&
      discardStart !== -1 &&
      sameBlockStart < discardStart,
    "Same-block navigation must preserve edits before any discard prompt",
  );
});

test("Template Save submits only backend snapshot identity and raw block text", async () => {
  const panel = await readFile(panelPath, "utf8");

  const saveTemplate = methodBody(
    panel,
    "async _saveTemplateBlock()"
  );

  assert.match(
    saveTemplate,
    /ha_yaml_source_editor\/templates\/block\/save/
  );

  assert.match(
    saveTemplate,
    /block_id: blockId/
  );

  assert.match(
    saveTemplate,
    /expected_source_sha256: expectedSourceSha256/
  );

  assert.match(
    saveTemplate,
    /replacement_text: submittedText/
  );

  assert.doesNotMatch(
    saveTemplate,
    /source_path|relative_path|start_line|end_line/
  );

  assert.match(
    saveTemplate,
    /templateBlockDocumentId\(result\)/
  );

  assert.match(
    saveTemplate,
    /this\._templateBlockText === submittedText/
  );

  assert.match(
    saveTemplate,
    /newer editor changes remain unsaved/
  );
});

test("Template Save refreshes authoritative Explorer state after stale or uncertain results", async () => {
  const panel = await readFile(panelPath, "utf8");

  const saveTemplate = methodBody(
    panel,
    "async _saveTemplateBlock()"
  );

  assert.match(
    saveTemplate,
    /template_source_changed/
  );

  assert.match(
    saveTemplate,
    /template_commit_uncertain/
  );

  assert.match(
    saveTemplate,
    /this\._templateSaveStatus = "Stale"/
  );

  assert.match(
    saveTemplate,
    /this\._templateSaveStatus = "Uncertain"/
  );

  const refreshMatches =
    saveTemplate.match(
      /this\._loadTemplateIndex\(\{\s*force: true,\s*\}\)/g
    ) ?? [];

  assert.ok(
    refreshMatches.length >= 3,
    "Save success, stale failure, and uncertain failure must refresh the Template index",
  );

  assert.match(
    saveTemplate,
    /Reopen the block/
  );
});

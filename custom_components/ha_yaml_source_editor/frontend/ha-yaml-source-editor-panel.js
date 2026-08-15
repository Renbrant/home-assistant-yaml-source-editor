import { analyzeSourceText, validateSourceText } from "./source-validation.mjs";
import {
  canonicalJson,
  classifySyncState,
  compareSourceToHa,
  shortHash,
} from "./sync-state.mjs";
import {
  DEPLOYMENT_OPERATION,
  assessDeploymentPreflight,
  verifyFinalHaRead,
  verifyPostSave,
} from "./deployment-logic.mjs";
import {
  analyzeThreeWay,
  diffSemantic,
  formatDiffKindForLabels,
  serializeDiffValue,
} from "./semantic-diff.mjs";
import {
  MAX_IMPORTED_SOURCE_BYTES,
  haConfigToSourceYaml,
  utf8Length,
} from "./ha-import.mjs";
import {
  createSourceCodeEditor,
  shouldRestoreEditorFocusSnapshot,
  shouldRestoreEditorViewportSnapshot,
} from "./source-code-editor.mjs";
import {
  assessFinalOverwriteRead,
  assessOverwritePreflight,
} from "./conflict-resolution-logic.mjs";
import { isBlankSourceText } from "./source-bootstrap.mjs";
import {
  filterTemplateBlocks,
  findTemplateBlock,
  findTemplateEntity,
  templateBlockDocumentId,
  templateEntityLocalLine,
  templateSourceDocumentId,
} from "./template-source-logic.mjs";

const MAX_DEPLOYMENT_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const INSPECTOR_WIDE_LAYOUT_MIN_WIDTH = 1100;

const RESOLUTION_OPERATION = {
  IDLE: "Idle",
  PREPARING_IMPORT: "Preparing import",
  PREPARING_OVERWRITE: "Preparing overwrite",
  AWAITING_CONFIRMATION: "Awaiting confirmation",
  IMPORTING: "Importing",
  DEPLOYING: "Deploying",
  VERIFYING: "Verifying",
  RECORDING_BASELINE: "Recording baseline",
  SUCCESS: "Success",
  ERROR: "Error",
};

class HaYamlSourceEditorPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._status = null;
    this._error = false;
    this._statusRequested = false;
    this._dashboardStatus = "Connecting";
    this._dashboardRequested = false;
    this._dashboardLoading = false;
    this._dashboards = [];
    this._dashboardError = null;
    this._templateStatus = "Connecting";
    this._templateRequested = false;
    this._templateLoading = false;
    this._templateIndex = null;
    this._templateError = null;
    this._templateFullSourceStatus = "Idle";
    this._templateFullSourceResult = null;
    this._templateFullSourceError = null;
    this._templateFullSourceRequestId = 0;
    this._selectedTemplateBlockId = null;
    this._selectedTemplateEntityId = null;
    this._templateBlockStatus = "Idle";
    this._templateBlockResult = null;
    this._templateBlockText = "";
    this._lastSavedTemplateBlockText = "";
    this._templateBlockError = null;
    this._templateBlockRequestId = 0;
    this._templateSaveStatus = "Idle";
    this._templateSaveMessage = null;
    this._templateSaveRequestId = 0;
    this._openTemplateBlockIds = new Set();
    this._templateSearchQuery = "";
    this._selectedDashboardKey = null;
    this._selectedDashboard = null;
    this._configStatus = "No dashboard selected";
    this._config = null;
    this._configError = null;
    this._configRequestId = 0;
    this._sourceDocument = null;
    this._sourceStatus = "No dashboard selected";
    this._sourceText = "";
    this._lastSavedSourceText = "";
    this._sourceError = null;
    this._sourceMessage = null;
    this._sourceRequestId = 0;
    this._sourceEditor = null;
    this._sourceEditorDocumentId = null;
    this._sourceEditorReadOnly = null;
    this._sourceEditorStatus = { line: 1, column: 1, lineCount: 1 };
    this._validationStatus = "Not validated";
    this._validationResult = null;
    this._validationError = null;
    this._validationRequestId = 0;
    this._syncStatus = "No dashboard selected";
    this._sourceVsHa = "UNAVAILABLE";
    this._syncNote = null;
    this._syncError = null;
    this._sourceTextHash = null;
    this._sourceSemanticHash = null;
    this._haSemanticHash = null;
    this._syncRequestId = 0;
    this._syncDebounce = null;
    this._deploymentStatus = DEPLOYMENT_OPERATION.IDLE;
    this._deploymentMessage = null;
    this._deploymentRequestId = 0;
    this._compareStatus = "Idle";
    this._compareResult = null;
    this._compareSnapshot = null;
    this._compareError = null;
    this._compareMessage = null;
    this._compareRequestId = 0;
    this._resolutionStatus = RESOLUTION_OPERATION.IDLE;
    this._resolutionMessage = null;
    this._resolutionRequestId = 0;
    this._inspectorTab = "status";
    this._inspectorOpen = false;
    this._inspectorUserToggled = false;
    this._inspectorResizeObserver = null;
    this._inspectorResizeTarget = null;
    this._hasRendered = false;
  }

  set hass(hass) {
    this._hass = hass;
    this._refreshRoutineUi();
    this._loadStatus();
    this._loadDashboards();
    this._loadTemplateIndex();
  }

  connectedCallback() {
    if (!this._hasRendered) {
      this._render();
    }
    this._loadStatus();
    this._loadDashboards();
    this._loadTemplateIndex();
  }

  disconnectedCallback() {
    this._destroySourceEditor();
    this._disconnectInspectorResizeObserver();
    this._hasRendered = false;
  }

  _disconnectInspectorResizeObserver() {
    if (!this._inspectorResizeObserver) {
      return;
    }

    this._inspectorResizeObserver.disconnect();
    this._inspectorResizeObserver = null;
    this._inspectorResizeTarget = null;
  }

  _syncInspectorResizeObserver() {
    const panel = this.shadowRoot?.querySelector(".panel");
    if (!panel) {
      return;
    }

    if (typeof ResizeObserver === "undefined") {
      this._applyResponsiveInspectorDefault(panel.getBoundingClientRect().width);
      return;
    }

    if (!this._inspectorResizeObserver) {
      this._inspectorResizeObserver = new ResizeObserver((entries) => {
        const latestEntry = entries[entries.length - 1];
        const width =
          latestEntry?.contentRect?.width ??
          this._inspectorResizeTarget?.getBoundingClientRect().width ??
          0;
        this._applyResponsiveInspectorDefault(width);
      });
    }

    if (this._inspectorResizeTarget !== panel) {
      if (this._inspectorResizeTarget) {
        this._inspectorResizeObserver.unobserve(this._inspectorResizeTarget);
      }
      this._inspectorResizeTarget = panel;
      this._inspectorResizeObserver.observe(panel);
    }

    this._applyResponsiveInspectorDefault(panel.getBoundingClientRect().width);
  }

  _applyResponsiveInspectorDefault(width) {
    if (
      this._inspectorUserToggled ||
      !Number.isFinite(width) ||
      width <= 0
    ) {
      return;
    }

    const shouldOpen = width > INSPECTOR_WIDE_LAYOUT_MIN_WIDTH;
    if (this._inspectorOpen === shouldOpen) {
      return;
    }

    this._inspectorOpen = shouldOpen;
    this._render();
  }

  _canUseConnection() {
    return Boolean(this._hass?.connection?.sendMessagePromise);
  }

  async _loadStatus() {
    if (this._statusRequested || !this._canUseConnection()) {
      return;
    }

    this._statusRequested = true;

    try {
      this._status = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/status",
      });
      this._error = false;
    } catch (_err) {
      this._status = null;
      this._error = true;
    }

    this._refreshRoutineUi();
  }

  async _loadDashboards({ force = false } = {}) {
    if (!this._canUseConnection() || this._dashboardLoading) {
      return;
    }

    if (this._dashboardRequested && !force) {
      return;
    }

    this._dashboardRequested = true;
    this._dashboardLoading = true;
    this._dashboardStatus = "Connecting";
    this._dashboardError = null;
    this._refreshRoutineUi();

    try {
      const dashboards = await this._hass.connection.sendMessagePromise({
        type: "lovelace/dashboards/list",
      });

      this._dashboards = Array.isArray(dashboards) ? dashboards : [];
      this._dashboardStatus = "Connected";
    } catch (_err) {
      this._dashboards = [];
      this._dashboardStatus = "Error";
      this._dashboardError = "Unable to complete dashboard discovery.";
    } finally {
      this._dashboardLoading = false;
      this._refreshRoutineUi();
    }
  }

  async _loadTemplateIndex({ force = false } = {}) {
    if (!this._canUseConnection() || this._templateLoading) {
      return;
    }

    if (this._templateRequested && !force) {
      return;
    }

    this._templateRequested = true;
    this._templateLoading = true;
    this._templateStatus = "Connecting";
    this._templateError = null;
    this._refreshTemplateTreeUi();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/templates/index",
      });

      this._templateIndex = result ?? null;

      if (result?.available) {
        this._templateStatus = "Connected";
        this._templateError = null;
      } else {
        this._templateStatus = "Unavailable";
        this._templateError =
          result?.message || "No supported YAML Template Source was discovered.";
      }
    } catch (err) {
      this._templateIndex = null;
      this._templateStatus = "Error";
      this._templateError =
        err?.message || "Unable to discover YAML Template Sources.";
    } finally {
      this._templateLoading = false;
      this._refreshTemplateTreeUi();
    }
  }
  _refreshDashboards() {
    if (this._isDeploymentInProgress()) {
      this._deploymentMessage = "Deployment is in progress.";
      this._render();
      return;
    }

    if (this._isResolutionInProgress()) {
      this._resolutionMessage = "Conflict resolution is in progress.";
      this._render();
      return;
    }

    if (!this._confirmDiscardUnsavedChanges()) {
      return;
    }

    this._clearTemplateSelection();
    this._clearSelectedDashboard();
    this._render();
    this._loadDashboards({ force: true });
    this._loadTemplateIndex({ force: true });
  }

  _clearSelectedDashboard() {
    this._selectedDashboardKey = null;
    this._selectedDashboard = null;
    this._configStatus = "No dashboard selected";
    this._config = null;
    this._configError = null;
    this._configRequestId += 1;
    this._sourceDocument = null;
    this._sourceStatus = "No dashboard selected";
    this._sourceText = "";
    this._destroySourceEditor();
    this._lastSavedSourceText = "";
    this._sourceError = null;
    this._sourceMessage = null;
    this._sourceRequestId += 1;
    this._clearValidation();
    this._clearSyncState();
    this._clearComparison();
    this._deploymentStatus = DEPLOYMENT_OPERATION.IDLE;
    this._deploymentMessage = null;
    this._deploymentRequestId += 1;
    this._resolutionStatus = RESOLUTION_OPERATION.IDLE;
    this._resolutionMessage = null;
    this._resolutionRequestId += 1;
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  _formatMode(mode) {
    return String(mode ?? "unknown").toUpperCase();
  }

  _sourceStateLabel() {
    if (this._sourceStatus === "Error" || this._sourceStatus === "Saving") {
      return this._sourceStatus;
    }
    return this._hasUnsavedSourceChanges()
      ? "Unsaved changes"
      : this._sourceStatus;
  }

  _canCreateSourceDocument() {
    return Boolean(
      this._selectedDashboard &&
      !this._sourceDocument &&
      this._sourceStatus === "No document"
    );
  }

  _isSavedSourceBlank(sourceText = this._lastSavedSourceText) {
    return isBlankSourceText(sourceText);
  }

  _canInitializeSourceFromHa() {
    return Boolean(
      this._selectedDashboard &&
      this._sourceDocument &&
      this._sourceStatus !== "Checking" &&
      this._sourceStatus !== "Loading" &&
      this._sourceStatus !== "Creating" &&
      this._sourceStatus !== "Saving" &&
      this._sourceStatus !== "Error" &&
      this._isSavedSourceBlank() &&
      !this._hasUnsavedSourceChanges() &&
      !this._isDeploymentInProgress() &&
      !this._isResolutionInProgress() &&
      this._validationStatus !== "Validating" &&
      this._compareStatus !== "Loading" &&
      this._syncStatus !== "Calculating"
    );
  }

  _dashboardTitle(dashboard) {
    return dashboard.title || dashboard.url_path || dashboard.id || "Untitled";
  }

  _dashboardPath(dashboard) {
    const urlPath = dashboard.url_path ?? "";
    return urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
  }

  _dashboardKey(dashboard) {
    return `dashboard:${
      dashboard.url_path ??
      dashboard.id ??
      dashboard.title ??
      "unknown"
    }`;
  }

  _dashboardTargetUrlPath(dashboard) {
    return dashboard.url_path;
  }

  _targetForDashboard(dashboard) {
    return {
      type: "lovelace_storage_dashboard",
      url_path: this._dashboardTargetUrlPath(dashboard),
    };
  }

  _documentMatchesDashboard(document, dashboard) {
    const target = document?.target;
    const dashboardTarget = this._targetForDashboard(dashboard);

    return (
      target?.type === dashboardTarget.type &&
      target?.url_path === dashboardTarget.url_path
    );
  }

  _hasUnsavedSourceChanges() {
    return (
      this._sourceDocument !== null &&
      this._sourceText !== this._lastSavedSourceText
    );
  }

  _hasUnsavedTemplateChanges() {
    return Boolean(
      this._selectedTemplateBlockId &&
      this._templateBlockResult &&
      this._templateBlockText !== this._lastSavedTemplateBlockText
    );
  }

  _hasUnsavedEditorChanges() {
    return (
      this._hasUnsavedSourceChanges() ||
      this._hasUnsavedTemplateChanges()
    );
  }

  _templateEditorStateLabel() {
    if (this._templateBlockStatus !== "Loaded") {
      return this._templateBlockStatus;
    }

    if (this._templateSaveStatus === "Saving") {
      return "Saving";
    }

    if (this._templateSaveStatus === "Uncertain") {
      return "Commit uncertain";
    }

    if (this._templateSaveStatus === "Stale") {
      return "Source changed";
    }

    if (this._hasUnsavedTemplateChanges()) {
      return "Unsaved changes";
    }

    if (this._templateSaveStatus === "Error") {
      return "Save error";
    }

    return "Saved";
  }

  _canSaveTemplateBlock() {
    return Boolean(
      this._selectedTemplateBlockId &&
      this._templateBlockStatus === "Loaded" &&
      this._templateBlockResult &&
      this._hasUnsavedTemplateChanges() &&
      !["Saving", "Stale", "Uncertain"].includes(
        this._templateSaveStatus
      ) &&
      !this._isDeploymentInProgress() &&
      !this._isResolutionInProgress()
    );
  }

  _confirmDiscardUnsavedChanges() {
    if (!this._hasUnsavedEditorChanges()) {
      return true;
    }

    if (this._hasUnsavedTemplateChanges()) {
      return window.confirm(
        "This Template block has unsaved changes. Discard them and continue?"
      );
    }

    return window.confirm(
      "This Source YAML has unsaved changes. Discard them and continue?"
    );
  }

  _clearValidation() {
    this._validationStatus = "Not validated";
    this._validationResult = null;
    this._validationError = null;
    this._validationRequestId += 1;
  }

  _clearSyncState() {
    this._syncStatus = this._selectedDashboard ? "Unavailable" : "No dashboard selected";
    this._sourceVsHa = "UNAVAILABLE";
    this._syncNote = null;
    this._syncError = null;
    this._sourceTextHash = null;
    this._sourceSemanticHash = null;
    this._haSemanticHash = null;
    this._syncRequestId += 1;
    if (this._syncDebounce) {
      window.clearTimeout(this._syncDebounce);
      this._syncDebounce = null;
    }
  }

  _clearComparison(message = null) {
    this._compareStatus = "Idle";
    this._compareResult = null;
    this._compareSnapshot = null;
    this._compareError = null;
    this._compareMessage = message;
    this._compareRequestId += 1;
  }

  _activeEditorDocument() {
    if (
      this._templateFullSourceStatus === "Loaded" &&
      this._templateFullSourceResult
    ) {
      const documentId = templateSourceDocumentId(
        this._templateFullSourceResult
      );

      if (!documentId) {
        return null;
      }

      return {
        documentId,
        text: this._templateFullSourceResult.source_text ?? "",
        readOnly: true,
      };
    }

    if (
      this._selectedTemplateBlockId &&
      this._templateBlockStatus === "Loaded" &&
      this._templateBlockResult
    ) {
      const documentId = templateBlockDocumentId(
        this._templateBlockResult
      );

      if (!documentId) {
        return null;
      }

      return {
        documentId,
        text: this._templateBlockText,
        readOnly: false,
      };
    }

    if (!this._sourceDocument) {
      return null;
    }

    return {
      documentId: this._sourceDocument.document_id,
      text: this._sourceText,
      readOnly: false,
    };
  }

  _destroySourceEditor() {
    if (!this._sourceEditor) {
      return;
    }

    this._sourceEditor.destroy();
    this._sourceEditor = null;
    this._sourceEditorDocumentId = null;
    this._sourceEditorReadOnly = null;
    this._sourceEditorStatus = { line: 1, column: 1, lineCount: 1 };
  }

  _replaceSourceEditorText(
    sourceText,
    documentId = this._sourceDocument?.document_id ?? null,
    { resetHistory = false } = {}
  ) {
    this._sourceEditorDocumentId = documentId;
    if (this._sourceEditor) {
      this._sourceEditor.replaceText(sourceText, { resetHistory });
    }
    this._sourceEditorStatus = this._sourceEditor?.status?.() ?? this._sourceEditorStatus;
  }

  _attachSourceEditor() {
    const host = this.shadowRoot.getElementById("source-code-editor-host");
    const editorDocument = this._activeEditorDocument();

    if (!host || !editorDocument) {
      this._destroySourceEditor();
      return;
    }

    const {
      documentId,
      text,
      readOnly,
    } = editorDocument;

    if (
      this._sourceEditor &&
      this._sourceEditorReadOnly !== readOnly
    ) {
      this._destroySourceEditor();
    }

    if (!this._sourceEditor) {
      this._sourceEditor = createSourceCodeEditor({
        parent: host,
        doc: text,
        readOnly,
        onChange: readOnly
          ? undefined
          : (nextText) => this._handleEditorChange(nextText),
        onStatusChange: (status) =>
          this._handleSourceEditorStatus(status),
      });
      this._sourceEditorDocumentId = documentId;
      this._sourceEditorReadOnly = readOnly;
      return;
    }

    this._sourceEditor.attach(host);

    if (this._sourceEditorDocumentId !== documentId) {
      this._replaceSourceEditorText(
        text,
        documentId,
        {
          resetHistory: true,
        }
      );
    }
  }

  _handleEditorChange(text) {
    if (this._selectedTemplateBlockId) {
      this._handleTemplateEditorChange(text);
      return;
    }

    this._handleSourceEditorChange(text);
  }

  _handleTemplateEditorChange(text) {
    if (
      !this._selectedTemplateBlockId ||
      this._templateBlockStatus !== "Loaded" ||
      !this._templateBlockResult
    ) {
      return;
    }

    this._templateBlockText = text;

    if (
      !["Saving", "Stale", "Uncertain"].includes(
        this._templateSaveStatus
      )
    ) {
      this._templateSaveStatus = "Idle";
    }

    this._templateSaveMessage = null;

    this._refreshEditorContextUi();
    this._refreshSourceEditorUi();
  }

  _handleSourceEditorChange(text) {
    this._sourceText = text;
    this._clearValidation();
    this._clearComparison(
      this._hasUnsavedSourceChanges()
        ? "Comparison uses saved Source; current editor has unsaved changes."
        : null
    );
    this._scheduleSyncRefresh();
    this._refreshSourceEditorUi();
  }

  _handleSourceEditorStatus(status) {
    this._sourceEditorStatus = status;
    this._refreshSourceEditorStatusBar();
  }

  _refreshSourceEditorUi() {
    const editorSourceStatus = this.shadowRoot.getElementById(
      "editor-source-status-value"
    );
    const statusValue = this.shadowRoot.getElementById("source-status-value");
    const validationStatus = this.shadowRoot.getElementById(
      "validation-status-value"
    );
    const validationBody = this.shadowRoot.getElementById("validation-body");
    const compareStatus = this.shadowRoot.getElementById("compare-status-value");
    const compareBody = this.shadowRoot.getElementById("compare-body");
    const createButton = this.shadowRoot.getElementById("create-source-document");
    const initializeButton = this.shadowRoot.getElementById(
      "initialize-source-from-ha"
    );
    const saveButton = this.shadowRoot.getElementById("save-source-document");
    const templateSaveButton = this.shadowRoot.getElementById(
      "save-template-block"
    );
    const templateSaveMessage = this.shadowRoot.getElementById(
      "template-save-message"
    );
    const validateButton = this.shadowRoot.getElementById("validate-source-document");
    const deployButton = this.shadowRoot.getElementById("deploy-saved-source");
    const compareButton = this.shadowRoot.getElementById("compare-source-ha");
    const importButton = this.shadowRoot.getElementById("import-ha-version");
    const overwriteButton = this.shadowRoot.getElementById("overwrite-ha-source");

    if (statusValue) {
      statusValue.textContent = this._hasUnsavedSourceChanges()
        ? "Unsaved changes"
        : this._sourceStatus;
    }

    if (editorSourceStatus) {
      editorSourceStatus.textContent = `Source: ${this._sourceStateLabel()}`;
    }

    if (createButton) {
      createButton.disabled = !this._canCreateSourceDocument();
    }

    if (initializeButton) {
      initializeButton.disabled = !this._canInitializeSourceFromHa();
    }

    if (validationStatus) {
      validationStatus.textContent = this._validationStatus;
      validationStatus.className = "";
    }

    if (validationBody) {
      validationBody.innerHTML = this._renderValidationBody();
    }

    if (compareStatus) {
      compareStatus.textContent = this._compareStatus;
      compareStatus.className = "";
    }

    if (compareBody) {
      compareBody.innerHTML = this._renderCompareBody();
    }

    if (saveButton) {
      saveButton.disabled = !this._hasUnsavedSourceChanges();
    }

    if (templateSaveButton) {
      templateSaveButton.disabled = !this._canSaveTemplateBlock();
    }

    if (templateSaveMessage) {
      const message = this._templateSaveMessage ?? "";
      templateSaveMessage.textContent = message;
      templateSaveMessage.hidden = message.length === 0;
      templateSaveMessage.className =
        ["Error", "Stale", "Uncertain"].includes(
          this._templateSaveStatus
        )
          ? "state error"
          : "state";
    }

    if (validateButton) {
      validateButton.disabled = this._validationStatus === "Validating";
    }

    if (deployButton) {
      deployButton.disabled =
        this._hasUnsavedSourceChanges() ||
        this._sourceText.length === 0 ||
        this._isDeploymentInProgress() ||
        this._isResolutionInProgress();
    }

    if (compareButton) {
      compareButton.disabled =
        this._hasUnsavedSourceChanges() ||
        this._compareStatus === "Loading" ||
        this._isDeploymentInProgress() ||
        this._isResolutionInProgress();
    }

    if (importButton) {
      importButton.disabled = !this._canResolveFromCompare();
    }

    if (overwriteButton) {
      overwriteButton.disabled =
        !this._canResolveFromCompare() ||
        !["HA MODIFIED", "BOTH MODIFIED"].includes(this._syncStatus);
    }

    this._refreshSourceEditorStatusBar();
  }

  _refreshSourceEditorStatusBar() {
    const statusBar = this.shadowRoot.getElementById("source-editor-status");
    if (!statusBar) {
      return;
    }

    const editorState =
      this._templateFullSourceStatus !== "Idle"
        ? this._templateFullSourceStatus === "Loaded"
          ? "Read-only"
          : this._templateFullSourceStatus
        : this._selectedTemplateBlockId
        ? this._templateSaveStatus === "Saving"
          ? "Saving"
          : this._templateSaveStatus === "Uncertain"
            ? "Uncertain"
            : this._templateSaveStatus === "Stale"
              ? "Stale"
              : this._hasUnsavedTemplateChanges()
                ? "Modified"
                : "Saved"
        : this._hasUnsavedSourceChanges()
          ? "Modified"
          : "Saved";

    statusBar.textContent = `Ln ${this._sourceEditorStatus.line}, Col ${this._sourceEditorStatus.column}    ${this._sourceEditorStatus.lineCount} ${this._sourceEditorStatus.lineCount === 1 ? "line" : "lines"}    YAML    LF    ${editorState}`;
  }

  _refreshSyncUi() {
    const editorSyncStatus = this.shadowRoot.getElementById(
      "editor-sync-status-value"
    );
    const statusValue = this.shadowRoot.getElementById("sync-status-value");
    const sourceVsHaValue = this.shadowRoot.getElementById("source-vs-ha-value");
    const sourceTextHash = this.shadowRoot.getElementById("source-text-hash");
    const sourceSemanticHash = this.shadowRoot.getElementById(
      "source-semantic-hash"
    );
    const haSemanticHash = this.shadowRoot.getElementById("ha-semantic-hash");
    const syncMessage = this.shadowRoot.getElementById("sync-message");
    const refreshButton = this.shadowRoot.getElementById("refresh-sync-status");

    if (statusValue) {
      statusValue.textContent = this._syncStatus;
      statusValue.className = this._syncStatus === "SYNC ERROR" ? "error" : "";
    }

    if (sourceVsHaValue) {
      sourceVsHaValue.textContent = this._sourceVsHa;
    }

    if (editorSyncStatus) {
      editorSyncStatus.textContent = `Source vs HA: ${this._sourceVsHa}`;
    }

    if (sourceTextHash) {
      sourceTextHash.title = this._sourceTextHash ?? "";
      sourceTextHash.textContent = shortHash(this._sourceTextHash);
    }

    if (sourceSemanticHash) {
      sourceSemanticHash.title = this._sourceSemanticHash ?? "";
      sourceSemanticHash.textContent = shortHash(this._sourceSemanticHash);
    }

    if (haSemanticHash) {
      haSemanticHash.title = this._haSemanticHash ?? "";
      haSemanticHash.textContent = shortHash(this._haSemanticHash);
    }

    if (syncMessage) {
      syncMessage.innerHTML = this._renderSyncMessage();
    }

    if (refreshButton) {
      refreshButton.disabled =
        !this._sourceDocument ||
        !this._selectedDashboard ||
        this._syncStatus === "Calculating" ||
        this._isResolutionInProgress();
    }
  }

  _refreshDashboardConfigJson() {
    const configBlock = this.shadowRoot.getElementById("dashboard-config-json");
    if (configBlock && this._configStatus === "Loaded") {
      configBlock.textContent = JSON.stringify(this._config, null, 2);
    }
  }

  _refreshRoutineUi() {
    if (!this._hasRendered) {
      if (this.isConnected) {
        this._render();
      }
      return;
    }

    this._refreshApplicationHeader();
    this._refreshExplorerUi();
    this._refreshEditorContextUi();
    this._refreshSourceEditorUi();
    this._refreshSyncUi();
    this._refreshDeploymentUi();
    this._refreshInspectorUi();
    this._wireEventHandlers(
      this._dashboards.filter((dashboard) => dashboard.mode === "storage")
    );
  }

  _refreshApplicationHeader() {
    const version = this.shadowRoot.querySelector(".app-version");
    if (version) {
      version.textContent = `v${this._status?.integration_version ?? "Unknown"}`;
    }
  }

  _refreshExplorerUi() {
    const alerts = this.shadowRoot.getElementById("explorer-alerts");
    if (alerts) {
      alerts.innerHTML = this._renderExplorerAlerts();
    }

    const storageDashboards = this._dashboards.filter(
      (dashboard) => dashboard.mode === "storage"
    );
    const unsupportedDashboards = this._dashboards.filter(
      (dashboard) => dashboard.mode !== "storage"
    );
    const dashboardList = this.shadowRoot.getElementById("dashboard-list-body");
    if (dashboardList) {
      dashboardList.innerHTML = this._renderDashboardList(storageDashboards);
    }

    const unsupportedList = this.shadowRoot.getElementById(
      "unsupported-dashboard-list"
    );
    if (unsupportedList) {
      unsupportedList.innerHTML = this._renderUnsupportedList(
        unsupportedDashboards
      );
    }

    const refreshButton = this.shadowRoot.getElementById("refresh-dashboards");
    if (refreshButton) {
      refreshButton.disabled =
        this._dashboardLoading ||
        !this._canUseConnection() ||
        this._isDeploymentInProgress() ||
        this._isResolutionInProgress();
    }

    this._wireDashboardCardHandlers(storageDashboards);
  }

  _refreshTemplateTreeUi() {
    const templateTree = this.shadowRoot.getElementById(
      "template-tree-body"
    );

    if (templateTree) {
      templateTree.innerHTML = this._renderTemplateTree();
      this._wireTemplateTreeHandlers();
    }
  }

  _refreshEditorContextUi() {
    const target = this.shadowRoot.querySelector(".editor-target");
    const summary = this.shadowRoot.querySelector(
      ".editor-state-summary"
    );

    if (target) {
      target.innerHTML = this._renderEditorTargetContents();
    }

    if (summary) {
      summary.innerHTML = this._renderEditorStateSummary();
    }
  }

  _refreshDeploymentUi() {
    const deploymentStatus = this.shadowRoot.getElementById(
      "deployment-status-value"
    );
    const deploymentBody = this.shadowRoot.getElementById("deployment-body");

    if (deploymentStatus) {
      deploymentStatus.textContent = this._deploymentStatus;
      deploymentStatus.className =
        this._deploymentStatus === DEPLOYMENT_OPERATION.ERROR ||
        this._deploymentStatus === DEPLOYMENT_OPERATION.CONFLICT
          ? "error"
          : "";
    }

    const deploymentList = deploymentStatus?.closest("dl");
    if (deploymentList) {
      deploymentList.innerHTML = `
        <dt>Status</dt>
        <dd id="deployment-status-value" class="${
          this._deploymentStatus === DEPLOYMENT_OPERATION.ERROR ||
          this._deploymentStatus === DEPLOYMENT_OPERATION.CONFLICT
            ? "error"
            : ""
        }">${this._escapeHtml(this._deploymentStatus)}</dd>
        ${this._renderDeploymentBaseline()}
      `;
    }

    if (deploymentBody) {
      deploymentBody.innerHTML = `
        ${this._renderDeploymentMessage()}
        ${this._renderDeploymentImportNote()}
      `;
    }
  }

  _refreshInspectorUi() {
    const inspectorPanel = this.shadowRoot.querySelector(".inspector-panel");
    if (!inspectorPanel) {
      return;
    }

    inspectorPanel.innerHTML = this._renderInspectorPanel();
    this._refreshDashboardConfigJson();
  }

  _clearTemplateSelection() {
    const hadTemplateSelection =
      this._templateFullSourceStatus !== "Idle" ||
      this._templateFullSourceResult !== null ||
      this._selectedTemplateBlockId !== null ||
      this._templateBlockResult !== null;

    this._templateFullSourceStatus = "Idle";
    this._templateFullSourceResult = null;
    this._templateFullSourceError = null;
    this._templateFullSourceRequestId += 1;

    this._selectedTemplateBlockId = null;
    this._selectedTemplateEntityId = null;
    this._templateBlockStatus = "Idle";
    this._templateBlockResult = null;
    this._templateBlockText = "";
    this._lastSavedTemplateBlockText = "";
    this._templateBlockError = null;
    this._templateBlockRequestId += 1;
    this._templateSaveStatus = "Idle";
    this._templateSaveMessage = null;
    this._templateSaveRequestId += 1;

    if (hadTemplateSelection) {
      this._destroySourceEditor();
    }
  }


  async _openTemplateFullSource() {
    if (this._isDeploymentInProgress()) {
      this._deploymentMessage = "Deployment is in progress.";
      this._render();
      return;
    }

    if (this._isResolutionInProgress()) {
      this._resolutionMessage = "Conflict resolution is in progress.";
      this._render();
      return;
    }

    if (!this._confirmDiscardUnsavedChanges()) {
      return;
    }

    const sourceSha256 =
      this._templateIndex?.source?.sha256;

    this._clearTemplateSelection();
    this._clearSelectedDashboard();

    const requestId =
      this._templateFullSourceRequestId + 1;

    this._templateFullSourceRequestId = requestId;
    this._templateFullSourceResult = null;
    this._templateFullSourceError = null;

    if (!sourceSha256) {
      this._templateFullSourceStatus = "Error";
      this._templateFullSourceError =
        "Template Source snapshot is unavailable. Refresh Explorer and try again.";
      this._render();
      return;
    }

    this._templateFullSourceStatus = "Loading";
    this._render();

    try {
      const result =
        await this._hass.connection.sendMessagePromise({
          type: "ha_yaml_source_editor/templates/source/get",
          expected_source_sha256: sourceSha256,
        });

      if (
        requestId !==
        this._templateFullSourceRequestId
      ) {
        return;
      }

      this._templateFullSourceResult = result;
      this._templateFullSourceStatus = "Loaded";
      this._templateFullSourceError = null;

      this._render();
    } catch (err) {
      if (
        requestId !==
        this._templateFullSourceRequestId
      ) {
        return;
      }

      if (err?.code === "template_source_changed") {
        this._templateFullSourceStatus = "Stale";
        this._templateFullSourceError =
          "Template Source changed after Explorer indexing. Explorer was refreshed; open the full Source again.";

        await this._loadTemplateIndex({
          force: true,
        });

        if (
          requestId !==
          this._templateFullSourceRequestId
        ) {
          return;
        }
      } else {
        this._templateFullSourceStatus = "Error";
        this._templateFullSourceError =
          err?.message ||
          "Unable to read the full Template Source.";
      }

      this._templateFullSourceResult = null;
      this._render();
    }
  }

  async _selectTemplateBlock(blockId, entityId = null) {
    if (this._isDeploymentInProgress()) {
      this._deploymentMessage = "Deployment is in progress.";
      this._render();
      return;
    }

    if (this._isResolutionInProgress()) {
      this._resolutionMessage = "Conflict resolution is in progress.";
      this._render();
      return;
    }

    const index = this._templateIndex;
    const sourceSha256 = index?.source?.sha256;
    const indexedBlock = findTemplateBlock(index, blockId);

    const sameLoadedBlock =
      blockId === this._selectedTemplateBlockId &&
      this._templateBlockStatus === "Loaded" &&
      this._templateBlockResult &&
      !["Stale", "Uncertain"].includes(
        this._templateSaveStatus
      );

    if (sameLoadedBlock) {
      if (
        entityId &&
        !findTemplateEntity(
          this._templateBlockResult.block,
          entityId
        )
      ) {
        entityId = null;
      }

      this._selectedTemplateEntityId = entityId;
      this._openTemplateBlockIds.add(blockId);

      this._refreshTemplateTreeUi();
      this._refreshEditorContextUi();
      this._refreshInspectorUi();
      this._revealSelectedTemplateEntity();
      return;
    }

    if (!this._confirmDiscardUnsavedChanges()) {
      return;
    }

    if (!sourceSha256 || !indexedBlock) {
      this._templateBlockError =
        "Template block is not available in the current Explorer index.";
      this._templateBlockStatus = "Error";
      this._render();
      return;
    }

    if (
      entityId &&
      !findTemplateEntity(indexedBlock, entityId)
    ) {
      entityId = null;
    }

    this._clearTemplateSelection();
    this._clearSelectedDashboard();

    // Keep the selected logical block expanded while the editor target changes.
    this._openTemplateBlockIds.add(blockId);

    const requestId = this._templateBlockRequestId + 1;
    this._templateBlockRequestId = requestId;
    this._selectedTemplateBlockId = blockId;
    this._selectedTemplateEntityId = entityId;
    this._templateBlockStatus = "Loading";
    this._templateBlockResult = null;
    this._templateBlockError = null;

    this._render();

    try {
      const result =
        await this._hass.connection.sendMessagePromise({
          type: "ha_yaml_source_editor/templates/block/get",
          block_id: blockId,
          expected_source_sha256: sourceSha256,
        });

      if (requestId !== this._templateBlockRequestId) {
        return;
      }

      this._templateBlockResult = result;
      this._templateBlockText = result.block_text ?? "";
      this._lastSavedTemplateBlockText = result.block_text ?? "";
      this._templateBlockStatus = "Loaded";
      this._templateBlockError = null;
      this._templateSaveStatus = "Idle";
      this._templateSaveMessage = null;
      this._templateSaveRequestId += 1;

      this._render();
      this._revealSelectedTemplateEntity();
    } catch (err) {
      if (requestId !== this._templateBlockRequestId) {
        return;
      }

      this._templateBlockResult = null;
      this._templateBlockStatus = "Error";
      this._templateBlockError =
        err?.message ||
        "Unable to read the selected Template block.";

      this._render();
    }
  }


  async _saveTemplateBlock() {
    if (!this._canSaveTemplateBlock()) {
      return;
    }

    const blockId = this._selectedTemplateBlockId;
    const expectedSourceSha256 =
      this._templateBlockResult?.source?.sha256;
    const submittedText = this._templateBlockText;

    if (!blockId || !expectedSourceSha256) {
      this._templateSaveStatus = "Error";
      this._templateSaveMessage =
        "Template Source snapshot is unavailable. Reopen the block before saving.";
      this._refreshEditorContextUi();
      this._refreshSourceEditorUi();
      this._refreshInspectorUi();
      return;
    }

    const requestId = this._templateSaveRequestId + 1;
    this._templateSaveRequestId = requestId;
    this._templateSaveStatus = "Saving";
    this._templateSaveMessage =
      "Validating and saving the targeted Template block.";

    this._refreshEditorContextUi();
    this._refreshSourceEditorUi();
    this._refreshInspectorUi();

    try {
      const result =
        await this._hass.connection.sendMessagePromise({
          type: "ha_yaml_source_editor/templates/block/save",
          block_id: blockId,
          expected_source_sha256: expectedSourceSha256,
          replacement_text: submittedText,
        });

      if (
        requestId !== this._templateSaveRequestId ||
        blockId !== this._selectedTemplateBlockId
      ) {
        return;
      }

      const savedText =
        result?.block_text ?? submittedText;

      this._templateBlockResult = result;
      this._lastSavedTemplateBlockText = savedText;

      const newDocumentId =
        templateBlockDocumentId(result);

      if (newDocumentId) {
        // The editor already contains the submitted text. Update only its
        // logical snapshot identity so a later structural render does not
        // recreate the CodeMirror document after a successful save.
        this._sourceEditorDocumentId = newDocumentId;
      }

      if (this._templateBlockText === submittedText) {
        this._templateBlockText = savedText;
        this._templateSaveStatus = "Saved";
        this._templateSaveMessage = result?.changed
          ? "Template block saved and verified."
          : "Template block already matched the physical Source.";
      } else {
        // Editing remained available while the save request was in flight.
        // Keep those newer keystrokes untouched and treat them as a new
        // unsaved edit based on the successfully saved snapshot.
        this._templateSaveStatus = "Idle";
        this._templateSaveMessage =
          "Submitted snapshot saved; newer editor changes remain unsaved.";
      }

      await this._loadTemplateIndex({
        force: true,
      });

      if (
        requestId !== this._templateSaveRequestId ||
        blockId !== this._selectedTemplateBlockId
      ) {
        return;
      }

      this._refreshEditorContextUi();
      this._refreshSourceEditorUi();
      this._refreshInspectorUi();
    } catch (err) {
      if (
        requestId !== this._templateSaveRequestId ||
        blockId !== this._selectedTemplateBlockId
      ) {
        return;
      }

      const code = err?.code ?? "";

      if (code === "template_source_changed") {
        this._templateSaveStatus = "Stale";
        this._templateSaveMessage =
          "Template Source changed outside this editor. Explorer was refreshed. Reopen the block to reconcile before saving again.";

        await this._loadTemplateIndex({
          force: true,
        });
      } else if (
        code === "template_commit_uncertain"
      ) {
        this._templateSaveStatus = "Uncertain";
        this._templateSaveMessage =
          "The save may already have changed the physical Template Source, but verification did not complete. Explorer was refreshed. Reopen the block and reconcile before saving again.";

        await this._loadTemplateIndex({
          force: true,
        });
      } else {
        this._templateSaveStatus = "Error";
        this._templateSaveMessage =
          err?.message ||
          "Unable to save the Template block.";
      }

      if (
        requestId !== this._templateSaveRequestId ||
        blockId !== this._selectedTemplateBlockId
      ) {
        return;
      }

      this._refreshEditorContextUi();
      this._refreshSourceEditorUi();
      this._refreshInspectorUi();
    }
  }

  _revealSelectedTemplateEntity() {
    if (
      !this._sourceEditor ||
      !this._selectedTemplateEntityId ||
      !this._templateBlockResult?.block
    ) {
      return;
    }

    const localLine = templateEntityLocalLine(
      this._templateBlockResult.block,
      this._selectedTemplateEntityId
    );

    if (
      localLine != null &&
      typeof this._sourceEditor.revealLine === "function"
    ) {
      this._sourceEditor.revealLine(localLine);
    }
  }

  _selectDashboard(dashboard) {
    if (this._isDeploymentInProgress()) {
      this._deploymentMessage = "Deployment is in progress.";
      this._render();
      return;
    }

    if (this._isResolutionInProgress()) {
      this._resolutionMessage = "Conflict resolution is in progress.";
      this._render();
      return;
    }

    if (!this._confirmDiscardUnsavedChanges()) {
      return;
    }

    this._clearTemplateSelection();

    const requestId = this._configRequestId + 1;
    this._configRequestId = requestId;
    this._sourceRequestId += 1;
    this._selectedDashboardKey = this._dashboardKey(dashboard);
    this._selectedDashboard = dashboard;
    this._configStatus = "Loading";
    this._config = null;
    this._configError = null;
    this._sourceDocument = null;
    this._sourceStatus = "Checking";
    this._sourceText = "";
    this._destroySourceEditor();
    this._lastSavedSourceText = "";
    this._sourceError = null;
    this._clearValidation();
    this._clearSyncState();
    this._clearComparison();
    this._deploymentStatus = DEPLOYMENT_OPERATION.IDLE;
    this._deploymentMessage = null;
    this._deploymentRequestId += 1;
    this._resolutionStatus = RESOLUTION_OPERATION.IDLE;
    this._resolutionMessage = null;
    this._resolutionRequestId += 1;
    this._render();

    this._loadDashboardConfig(dashboard, requestId);
    this._loadSourceDocument(dashboard, this._sourceRequestId);
  }

  async _loadDashboardConfig(dashboard, requestId) {
    const message = {
      type: "lovelace/config",
    };
    const targetUrlPath = this._dashboardTargetUrlPath(dashboard);

    if (targetUrlPath != null) {
      message.url_path = targetUrlPath;
    }

    try {
      const config = await this._hass.connection.sendMessagePromise(message);

      if (requestId !== this._configRequestId) {
        return;
      }

      this._config = config;
      this._configStatus = "Loaded";
      this._scheduleSyncRefresh();
    } catch (err) {
      if (requestId !== this._configRequestId) {
        return;
      }

      this._config = null;
      this._configStatus = "Error";
      this._configError = err?.message || "Unable to read dashboard configuration.";
    }

    this._render();
  }

  async _loadSourceDocument(dashboard, requestId) {
    try {
      const listResult = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/documents/list",
      });
      const metadata = listResult.documents?.find((document) =>
        this._documentMatchesDashboard(document, dashboard)
      );

      if (requestId !== this._sourceRequestId) {
        return;
      }

      if (!metadata) {
        this._sourceStatus = "No document";
        this._render();
        return;
      }

      this._sourceStatus = "Loading";
      this._render();

      const getResult = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/documents/get",
        document_id: metadata.document_id,
      });

      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceDocument = getResult.document;
      this._sourceText = getResult.document.source_text;
      this._lastSavedSourceText = getResult.document.source_text;
      this._replaceSourceEditorText(
        this._sourceText,
        this._sourceDocument.document_id,
        { resetHistory: true }
      );
      this._sourceStatus = "Loaded";
      this._sourceError = null;
      this._sourceMessage = null;
      this._clearValidation();
      this._clearComparison();
      this._scheduleSyncRefresh();
    } catch (err) {
      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceDocument = null;
      this._sourceStatus = "Error";
      this._sourceError = err?.message || "Unable to load Source Document.";
      this._sourceMessage = null;
    }

    this._render();
  }

  async _createSourceDocument() {
    if (!this._selectedDashboard || this._sourceStatus === "Creating") {
      return;
    }

    const requestId = this._sourceRequestId + 1;
    this._sourceRequestId = requestId;
    this._sourceStatus = "Creating";
    this._sourceError = null;
    this._sourceMessage = null;
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/documents/create",
        name: this._dashboardTitle(this._selectedDashboard),
        target: this._targetForDashboard(this._selectedDashboard),
      });

      if (requestId !== this._sourceRequestId) {
        return;
      }

      const document = result.document;
      this._sourceDocument = document;
      this._sourceText = document.source_text ?? "";
      this._lastSavedSourceText = document.source_text ?? "";
      this._replaceSourceEditorText(this._sourceText, document.document_id, {
        resetHistory: true,
      });
      this._sourceStatus = result.already_exists ? "Loaded" : "Not saved";
      this._sourceError = null;
      this._sourceMessage = null;
      this._clearValidation();
      this._clearComparison();
      this._scheduleSyncRefresh();
    } catch (err) {
      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceStatus = "Error";
      this._sourceError = err?.message || "Unable to create Source Document.";
      this._sourceMessage = null;
    }

    this._render();
  }

  async _saveSourceDocument() {
    if (!this._sourceDocument || this._sourceStatus === "Saving") {
      return;
    }

    const requestId = this._sourceRequestId + 1;
    this._sourceRequestId = requestId;
    this._sourceStatus = "Saving";
    this._sourceError = null;
    this._sourceMessage = null;
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/documents/save_source",
        document_id: this._sourceDocument.document_id,
        source_text: this._sourceText,
      });

      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceDocument = result.document;
      this._sourceText = result.document.source_text;
      this._lastSavedSourceText = result.document.source_text;
      this._replaceSourceEditorText(
        this._sourceText,
        this._sourceDocument.document_id
      );
      this._sourceStatus = "Saved";
      this._sourceError = null;
      this._sourceMessage = null;
      this._clearComparison();
      this._scheduleSyncRefresh();
    } catch (err) {
      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceStatus = "Error";
      this._sourceError = err?.message || "Unable to save Source Document.";
      this._sourceMessage = null;
    }

    this._render();
  }

  async _initializeSourceFromHa() {
    if (!this._canInitializeSourceFromHa()) {
      return;
    }

    this._sourceMessage = "Initialization confirmation required.";
    this._render();

    if (!this._confirmInitializeFromHa()) {
      this._sourceMessage = "Initialization cancelled.";
      this._render();
      return;
    }

    const requestId = this._resolutionRequestId + 1;
    this._resolutionRequestId = requestId;
    this._resolutionStatus = RESOLUTION_OPERATION.PREPARING_IMPORT;
    this._resolutionMessage = null;
    this._sourceMessage = "Preparing Source initialization from Home Assistant.";
    this._render();

    try {
      const documentId = this._sourceDocument.document_id;
      const freshDocument = await this._fetchSourceDocument(documentId);
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      if (freshDocument.document_id !== documentId) {
        throw new ResolutionBlockedError("Source Document changed. Try again.");
      }

      if (!this._isSavedSourceBlank(freshDocument.source_text)) {
        throw new ResolutionBlockedError(
          "Source Document is no longer empty. Initialization is only available for blank Source Documents."
        );
      }

      if (this._hasUnsavedSourceChanges()) {
        throw new ResolutionBlockedError(
          "Save or discard editor changes before initializing from Home Assistant."
        );
      }

      await this._requireSelectedStorageTarget();
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      const currentHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      const preparedImport = await this._prepareHaImportSource(currentHaConfig);
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      if (this._hasUnsavedSourceChanges()) {
        throw new ResolutionBlockedError(
          "Save or discard editor changes before initializing from Home Assistant."
        );
      }

      this._resolutionStatus = RESOLUTION_OPERATION.IMPORTING;
      this._resolutionMessage = null;
      this._sourceMessage = "Initializing Source from Home Assistant.";
      this._render();

      const result = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/documents/import_ha_version",
        document_id: freshDocument.document_id,
        expected_source_updated_at: freshDocument.updated_at,
        source_text: preparedImport.sourceText,
        source_semantic_hash: preparedImport.sourceSemanticHash,
        ha_semantic_hash: preparedImport.haSemanticHash,
        ha_canonical_json: preparedImport.haCanonicalJson,
        home_assistant_version: this._homeAssistantVersion(),
      });
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      this._sourceDocument = result.document;
      this._sourceText = result.document.source_text;
      this._lastSavedSourceText = result.document.source_text;
      this._replaceSourceEditorText(
        this._sourceText,
        this._sourceDocument.document_id,
        { resetHistory: true }
      );
      this._sourceStatus = "Saved";
      this._config = currentHaConfig;
      this._configStatus = "Loaded";
      this._clearValidation();
      this._clearComparison();
      this._resolutionStatus = RESOLUTION_OPERATION.IDLE;
      this._resolutionMessage = null;
      this._sourceMessage = "Source initialized from Home Assistant.";
      await this._refreshSyncStatus({ reloadHa: true });
    } catch (err) {
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      this._resolutionStatus = RESOLUTION_OPERATION.IDLE;
      this._resolutionMessage = null;
      this._sourceMessage =
        err?.message || "Unable to initialize Source from Home Assistant.";
      this._render();
    }
  }

  async _deploySavedSource() {
    if (
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._isDeploymentInProgress() ||
      this._isResolutionInProgress()
    ) {
      return;
    }

    const requestId = this._deploymentRequestId + 1;
    this._deploymentRequestId = requestId;
    this._deploymentStatus = DEPLOYMENT_OPERATION.PREFLIGHT;
    this._deploymentMessage = null;
    this._render();

    try {
      if (this._hasUnsavedSourceChanges()) {
        throw new DeploymentBlockedError(
          "Save Source before deploying.",
          DEPLOYMENT_OPERATION.ERROR
        );
      }

      const freshDocument = await this._fetchSourceDocument(
        this._sourceDocument.document_id
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const sourceAnalysis = analyzeSourceText(freshDocument.source_text);
      const targetResult = await this._validateSelectedTarget();
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      if (!targetResult.valid || !sourceAnalysis.validation.valid) {
        const preflight = assessDeploymentPreflight({
          sourceValid: sourceAnalysis.validation.valid,
          hasUnsavedChanges: this._hasUnsavedSourceChanges(),
          savedSourceText: this._sourceText,
          backendSourceText: freshDocument.source_text,
          deploymentBaseline: freshDocument.deployment_baseline ?? null,
          preflightHaSemanticHash: null,
        });
        throw new DeploymentBlockedError(
          targetResult.valid
            ? preflight.message
            : targetResult.message,
          DEPLOYMENT_OPERATION.ERROR
        );
      }

      const deploymentCanonicalJson = canonicalJson(sourceAnalysis.parsedConfig);
      if (utf8Length(deploymentCanonicalJson) > MAX_DEPLOYMENT_SNAPSHOT_BYTES) {
        throw new DeploymentBlockedError(
          "Deployment snapshot exceeds the 8 MiB limit. Nothing was deployed.",
          DEPLOYMENT_OPERATION.ERROR
        );
      }

      const deploymentSourceSemanticHash = await this._hashText(
        deploymentCanonicalJson
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const preflightHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const initialPreflightHaHash = await this._hashText(
        canonicalJson(preflightHaConfig)
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const deploymentBaseline = freshDocument.deployment_baseline ?? null;
      const preflight = assessDeploymentPreflight({
        sourceValid: sourceAnalysis.validation.valid,
        hasUnsavedChanges: this._hasUnsavedSourceChanges(),
        savedSourceText: this._sourceText,
        backendSourceText: freshDocument.source_text,
        deploymentBaseline,
        preflightHaSemanticHash: initialPreflightHaHash,
      });

      if (!preflight.allowed) {
        throw new DeploymentBlockedError(
          preflight.message,
          preflight.reason === "ha_conflict"
            ? DEPLOYMENT_OPERATION.CONFLICT
            : DEPLOYMENT_OPERATION.ERROR
        );
      }

      this._deploymentStatus = DEPLOYMENT_OPERATION.AWAITING_CONFIRMATION;
      this._deploymentMessage = preflight.firstDeployment
        ? "First deployment requires confirmation."
        : "Deployment preflight passed.";
      this._render();

      if (!this._confirmDeployment(preflight.firstDeployment)) {
        this._deploymentStatus = DEPLOYMENT_OPERATION.IDLE;
        this._deploymentMessage = "Deployment cancelled.";
        this._render();
        return;
      }

      const latestHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const latestHaHash = await this._hashText(canonicalJson(latestHaConfig));
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      // Lovelace save has no compare-and-swap option; this re-read narrows the race window.
      const finalCheck = verifyFinalHaRead({
        deploymentBaseline,
        initialPreflightHaHash,
        latestHaHash,
      });
      if (!finalCheck.allowed) {
        throw new DeploymentBlockedError(
          finalCheck.message,
          DEPLOYMENT_OPERATION.CONFLICT
        );
      }

      this._deploymentStatus = DEPLOYMENT_OPERATION.DEPLOYING;
      this._deploymentMessage = "Writing saved Source to Home Assistant.";
      this._render();

      await this._asyncSaveLovelaceConfig(
        this._selectedDashboard,
        sourceAnalysis.parsedConfig
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      this._deploymentStatus = DEPLOYMENT_OPERATION.VERIFYING;
      this._deploymentMessage = "Verifying saved dashboard configuration.";
      this._render();

      const verifiedHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const verifiedHaHash = await this._hashText(canonicalJson(verifiedHaConfig));
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const postSave = verifyPostSave({
        verifiedHaSemanticHash: verifiedHaHash,
        deploymentSourceSemanticHash,
      });
      if (!postSave.verified) {
        throw new DeploymentBlockedError(
          postSave.message,
          DEPLOYMENT_OPERATION.ERROR
        );
      }

      this._deploymentStatus = DEPLOYMENT_OPERATION.RECORDING_BASELINE;
      this._deploymentMessage = "Recording deployment baseline.";
      this._render();

      let recordResult;
      try {
        recordResult = await this._hass.connection.sendMessagePromise({
          type: "ha_yaml_source_editor/documents/record_deployment",
          document_id: freshDocument.document_id,
          expected_source_updated_at: freshDocument.updated_at,
          source_semantic_hash: deploymentSourceSemanticHash,
          ha_semantic_hash: verifiedHaHash,
          home_assistant_version:
            this._status?.home_assistant_version ?? "unknown",
          deployed_canonical_json: canonicalJson(verifiedHaConfig),
        });
      } catch (_err) {
        throw new DeploymentBlockedError(
          "Dashboard deployment was verified, but the deployment baseline could not be recorded. Home Assistant has been changed, but synchronization tracking is incomplete. Refresh before attempting another deployment.",
          DEPLOYMENT_OPERATION.ERROR
        );
      }
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      const refreshedDocument = await this._fetchSourceDocument(
        recordResult.document.document_id
      );
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      this._sourceDocument = refreshedDocument;
      this._sourceText = refreshedDocument.source_text;
      this._lastSavedSourceText = refreshedDocument.source_text;
      this._replaceSourceEditorText(
        this._sourceText,
        this._sourceDocument.document_id
      );
      this._config = verifiedHaConfig;
      this._configStatus = "Loaded";
      this._deploymentStatus = DEPLOYMENT_OPERATION.SUCCESS;
      this._deploymentMessage = "Deployment verified and baseline recorded.";
      this._clearComparison();
      await this._refreshSyncStatus({ reloadHa: true });
    } catch (err) {
      if (requestId !== this._deploymentRequestId) {
        return;
      }

      this._deploymentStatus = err.status ?? DEPLOYMENT_OPERATION.ERROR;
      this._deploymentMessage = err?.message || "Deployment failed.";
      this._render();
    }
  }

  async _validateSourceDocument() {
    if (
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._validationStatus === "Validating"
    ) {
      return;
    }

    const requestId = this._validationRequestId + 1;
    this._validationRequestId = requestId;
    this._validationStatus = "Validating";
    this._validationResult = null;
    this._validationError = null;
    this._render();

    try {
      const targetResult = await this._validateSelectedTarget();
      if (requestId !== this._validationRequestId) {
        return;
      }

      if (!targetResult.valid) {
        this._validationStatus = "Invalid";
        this._validationResult = targetResult;
        this._render();
        return;
      }
    } catch (err) {
      if (requestId !== this._validationRequestId) {
        return;
      }

      this._validationStatus = "Error";
      this._validationError =
        err?.message || "Unable to verify the selected target dashboard.";
      this._render();
      return;
    }

    const result = validateSourceText(this._sourceText);

    if (requestId !== this._validationRequestId) {
      return;
    }

    this._validationStatus = result.valid ? "Valid" : "Invalid";
    this._validationResult = {
      ...result,
      details: [
        ...(result.details ?? []),
        { stage: "target", message: "OK" },
      ],
    };
    this._validationError = null;
    this._render();
  }

  async _compareSourceToHa() {
    if (!this._sourceDocument || !this._selectedDashboard) {
      return;
    }

    if (this._hasUnsavedSourceChanges()) {
      this._compareStatus = "Error";
      this._compareError =
        "Save Source before comparing. Compare uses the saved Source Document.";
      this._compareResult = null;
      this._compareMessage = null;
      this._render();
      return;
    }

    const requestId = this._compareRequestId + 1;
    this._compareRequestId = requestId;
    this._compareStatus = "Loading";
    this._compareResult = null;
    this._compareError = null;
    this._compareMessage = null;
    this._render();

    try {
      const freshDocument = await this._fetchSourceDocument(
        this._sourceDocument.document_id
      );
      if (requestId !== this._compareRequestId) {
        return;
      }

      if (freshDocument.source_text !== this._sourceText) {
        throw new CompareBlockedError(
          "The backend Source Document changed. Reload or reselect the Source Document."
        );
      }

      const targetResult = await this._validateSelectedTarget();
      if (requestId !== this._compareRequestId) {
        return;
      }

      if (!targetResult.valid) {
        throw new CompareBlockedError(targetResult.message);
      }

      const sourceAnalysis = analyzeSourceText(freshDocument.source_text);
      if (!sourceAnalysis.validation.valid) {
        throw new CompareBlockedError(
          "Saved Source is invalid. Use Validate for details before comparing."
        );
      }

      const currentHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._compareRequestId) {
        return;
      }

      const sourceCanonicalJson = canonicalJson(sourceAnalysis.parsedConfig);
      const haCanonicalJson = canonicalJson(currentHaConfig);
      const sourceTextHash = await this._hashText(freshDocument.source_text);
      if (requestId !== this._compareRequestId) {
        return;
      }
      const sourceSemanticHash = await this._hashText(sourceCanonicalJson);
      if (requestId !== this._compareRequestId) {
        return;
      }
      const haSemanticHash = await this._hashText(haCanonicalJson);
      if (requestId !== this._compareRequestId) {
        return;
      }

      const baseline = freshDocument.deployment_baseline ?? null;
      const currentDifference = diffSemantic(
        sourceAnalysis.parsedConfig,
        currentHaConfig
      );
      let compareResult;

      if (baseline?.deployed_canonical_json) {
        const baselineValue = JSON.parse(baseline.deployed_canonical_json);
        const threeWay = analyzeThreeWay({
          baselineValue,
          sourceValue: sourceAnalysis.parsedConfig,
          haValue: currentHaConfig,
        });
        compareResult = {
          mode: "three_way",
          baselineAvailable: true,
          sourceChanges: threeWay.sourceChanges,
          haChanges: threeWay.haChanges,
          currentDifference,
        };
      } else {
        compareResult = {
          mode: "two_way",
          baselineAvailable: false,
          currentDifference,
        };
      }

      this._sourceDocument = freshDocument;
      this._lastSavedSourceText = freshDocument.source_text;
      this._config = currentHaConfig;
      this._configStatus = "Loaded";
      this._compareResult = compareResult;
      this._compareSnapshot = {
        documentId: freshDocument.document_id,
        documentUpdatedAt: freshDocument.updated_at,
        sourceTextHash,
        sourceSemanticHash,
        haSemanticHash,
        haCanonicalJson,
        targetUrlPath: this._dashboardTargetUrlPath(this._selectedDashboard),
      };
      this._compareStatus =
        currentDifference.totalDifferences === 0 ? "No differences" : "Ready";
      this._compareError = null;
      this._compareMessage = this._hasUnsavedSourceChanges()
        ? "Comparison uses saved Source; current editor has unsaved changes."
        : null;
    } catch (err) {
      if (requestId !== this._compareRequestId) {
        return;
      }

      this._compareStatus = "Error";
      this._compareResult = null;
      this._compareError = err?.message || "Unable to compare Source and HA.";
      this._compareMessage = null;
    }

    this._render();
  }

  async _importHaVersion() {
    if (!this._canResolveFromCompare()) {
      return;
    }

    const requestId = this._resolutionRequestId + 1;
    this._resolutionRequestId = requestId;
    this._resolutionStatus = RESOLUTION_OPERATION.PREPARING_IMPORT;
    this._resolutionMessage = null;
    this._render();

    try {
      const snapshot = this._compareSnapshot;
      const freshDocument = await this._fetchSourceDocument(snapshot.documentId);
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      this._requireComparedDocument(freshDocument, snapshot);

      await this._requireSelectedStorageTarget();
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      const currentHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      const preparedImport = await this._prepareHaImportSource(currentHaConfig);
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      if (preparedImport.haSemanticHash !== snapshot.haSemanticHash) {
        throw new StaleComparisonError(
          "Home Assistant changed since comparison. Compare again."
        );
      }

      this._resolutionStatus = RESOLUTION_OPERATION.AWAITING_CONFIRMATION;
      this._resolutionMessage = "Import confirmation required.";
      this._render();

      if (!this._confirmHaImport()) {
        this._resolutionStatus = RESOLUTION_OPERATION.IDLE;
        this._resolutionMessage = "Import cancelled.";
        this._render();
        return;
      }

      const finalDocument = await this._fetchSourceDocument(snapshot.documentId);
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      this._requireComparedDocument(finalDocument, snapshot);

      const finalHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      const finalImport = await this._prepareHaImportSource(finalHaConfig);
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      if (finalImport.haSemanticHash !== snapshot.haSemanticHash) {
        throw new StaleComparisonError(
          "Home Assistant changed since comparison. Compare again."
        );
      }

      this._resolutionStatus = RESOLUTION_OPERATION.IMPORTING;
      this._resolutionMessage = "Importing Home Assistant version as Source.";
      this._render();

      const result = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/documents/import_ha_version",
        document_id: snapshot.documentId,
        expected_source_updated_at: snapshot.documentUpdatedAt,
        source_text: finalImport.sourceText,
        source_semantic_hash: finalImport.sourceSemanticHash,
        ha_semantic_hash: finalImport.haSemanticHash,
        ha_canonical_json: finalImport.haCanonicalJson,
        home_assistant_version: this._homeAssistantVersion(),
      });
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      this._sourceDocument = result.document;
      this._sourceText = result.document.source_text;
      this._lastSavedSourceText = result.document.source_text;
      this._replaceSourceEditorText(
        this._sourceText,
        this._sourceDocument.document_id,
        { resetHistory: true }
      );
      this._sourceStatus = "Saved";
      this._config = finalHaConfig;
      this._configStatus = "Loaded";
      this._clearValidation();
      this._clearComparison();
      this._resolutionStatus = RESOLUTION_OPERATION.SUCCESS;
      this._resolutionMessage = "Home Assistant version imported as Source.";
      await this._refreshSyncStatus({ reloadHa: true });
    } catch (err) {
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      if (err instanceof StaleComparisonError) {
        this._clearComparison(err.message);
      }
      this._resolutionStatus = RESOLUTION_OPERATION.ERROR;
      this._resolutionMessage = err?.message || "Unable to import HA version.";
      this._render();
    }
  }

  async _overwriteHaWithSavedSource() {
    if (!this._canResolveFromCompare()) {
      return;
    }

    const requestId = this._resolutionRequestId + 1;
    this._resolutionRequestId = requestId;
    this._resolutionStatus = RESOLUTION_OPERATION.PREPARING_OVERWRITE;
    this._resolutionMessage = null;
    this._render();

    try {
      const snapshot = this._compareSnapshot;
      const freshDocument = await this._fetchSourceDocument(snapshot.documentId);
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      const sourceAnalysis = analyzeSourceText(freshDocument.source_text);
      if (!sourceAnalysis.validation.valid) {
        throw new ResolutionBlockedError(
          "Saved Source is invalid. Use Validate for details before resolving."
        );
      }

      const sourceTextHash = await this._hashText(freshDocument.source_text);
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      const sourceSemanticHash = await this._hashText(
        canonicalJson(sourceAnalysis.parsedConfig)
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      await this._requireSelectedStorageTarget();
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      const currentHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      const currentHaHash = await this._hashText(canonicalJson(currentHaConfig));
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      const preflight = assessOverwritePreflight({
        compareSnapshot: snapshot,
        hasUnsavedChanges: this._hasUnsavedSourceChanges(),
        freshDocumentUpdatedAt: freshDocument.updated_at,
        currentSourceTextHash: sourceTextHash,
        currentSourceSemanticHash: sourceSemanticHash,
        currentHaSemanticHash: currentHaHash,
        syncStatus: this._syncStatus,
      });
      if (!preflight.allowed) {
        throw new StaleComparisonError(preflight.message);
      }

      this._resolutionStatus = RESOLUTION_OPERATION.AWAITING_CONFIRMATION;
      this._resolutionMessage = "Overwrite confirmation required.";
      this._render();

      if (!this._confirmOverwrite()) {
        this._resolutionStatus = RESOLUTION_OPERATION.IDLE;
        this._resolutionMessage = "Overwrite cancelled.";
        this._render();
        return;
      }

      const finalDocument = await this._fetchSourceDocument(snapshot.documentId);
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      this._requireComparedDocument(finalDocument, snapshot);

      const latestHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      const latestHaHash = await this._hashText(canonicalJson(latestHaConfig));
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      const finalCheck = assessFinalOverwriteRead({
        latestHaSemanticHash: latestHaHash,
        preconfirmationHaSemanticHash: currentHaHash,
        compareSnapshot: snapshot,
      });
      if (!finalCheck.allowed) {
        throw new StaleComparisonError(finalCheck.message);
      }

      this._resolutionStatus = RESOLUTION_OPERATION.DEPLOYING;
      this._resolutionMessage = "Overwriting Home Assistant with saved Source.";
      this._render();
      await this._asyncSaveLovelaceConfig(
        this._selectedDashboard,
        sourceAnalysis.parsedConfig
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      this._resolutionStatus = RESOLUTION_OPERATION.VERIFYING;
      this._resolutionMessage = "Verifying overwritten Home Assistant dashboard.";
      this._render();
      const verifiedHaConfig = await this._readDashboardConfig(
        this._selectedDashboard,
        { force: true }
      );
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      const verifiedCanonicalJson = canonicalJson(verifiedHaConfig);
      const verifiedHaHash = await this._hashText(verifiedCanonicalJson);
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      const postSave = verifyPostSave({
        verifiedHaSemanticHash: verifiedHaHash,
        deploymentSourceSemanticHash: sourceSemanticHash,
      });
      if (!postSave.verified) {
        throw new ResolutionBlockedError(postSave.message);
      }

      this._resolutionStatus = RESOLUTION_OPERATION.RECORDING_BASELINE;
      this._resolutionMessage = "Recording deployment baseline.";
      this._render();
      const recordResult = await this._hass.connection.sendMessagePromise({
        type: "ha_yaml_source_editor/documents/record_deployment",
        document_id: snapshot.documentId,
        expected_source_updated_at: snapshot.documentUpdatedAt,
        source_semantic_hash: sourceSemanticHash,
        ha_semantic_hash: verifiedHaHash,
        home_assistant_version: this._homeAssistantVersion(),
        deployed_canonical_json: verifiedCanonicalJson,
      });
      if (requestId !== this._resolutionRequestId) {
        return;
      }

      this._sourceDocument = recordResult.document;
      this._sourceText = recordResult.document.source_text;
      this._lastSavedSourceText = recordResult.document.source_text;
      this._replaceSourceEditorText(
        this._sourceText,
        this._sourceDocument.document_id
      );
      this._sourceStatus = "Saved";
      this._config = verifiedHaConfig;
      this._configStatus = "Loaded";
      this._clearComparison();
      this._resolutionStatus = RESOLUTION_OPERATION.SUCCESS;
      this._resolutionMessage = "Home Assistant overwritten and verified.";
      await this._refreshSyncStatus({ reloadHa: true });
    } catch (err) {
      if (requestId !== this._resolutionRequestId) {
        return;
      }
      if (err instanceof StaleComparisonError) {
        this._clearComparison(err.message);
      }
      this._resolutionStatus = RESOLUTION_OPERATION.ERROR;
      this._resolutionMessage = err?.message || "Unable to overwrite Home Assistant.";
      this._render();
    }
  }

  async _validateSelectedTarget() {
    const dashboards = await this._hass.connection.sendMessagePromise({
      type: "lovelace/dashboards/list",
    });
    const targetUrlPath = this._dashboardTargetUrlPath(this._selectedDashboard);
    const dashboard = Array.isArray(dashboards)
      ? dashboards.find((item) => item.url_path === targetUrlPath)
      : null;

    if (!dashboard || dashboard.mode !== "storage") {
      return {
        valid: false,
        stage: "target",
        message: `The target dashboard ${this._dashboardPath(
          this._selectedDashboard
        )} no longer exists as a Storage Mode dashboard.`,
      };
    }

    return { valid: true };
  }

  async _fetchSourceDocument(documentId) {
    const result = await this._hass.connection.sendMessagePromise({
      type: "ha_yaml_source_editor/documents/get",
      document_id: documentId,
    });
    return result.document;
  }

  async _prepareHaImportSource(haConfig) {
    const haCanonicalJson = canonicalJson(haConfig);
    const haSemanticHash = await this._hashText(haCanonicalJson);
    const sourceText = haConfigToSourceYaml(haConfig);

    if (utf8Length(sourceText) > MAX_IMPORTED_SOURCE_BYTES) {
      throw new ResolutionBlockedError(
        "Imported Source YAML exceeds the 2 MiB Source Document limit."
      );
    }

    const sourceAnalysis = analyzeSourceText(sourceText);
    if (!sourceAnalysis.validation.valid) {
      throw new ResolutionBlockedError(
        "Home Assistant configuration could not be converted to Source YAML without changing its semantics."
      );
    }

    const sourceSemanticHash = await this._hashText(
      canonicalJson(sourceAnalysis.parsedConfig)
    );
    if (sourceSemanticHash !== haSemanticHash) {
      throw new ResolutionBlockedError(
        "Home Assistant configuration could not be converted to Source YAML without changing its semantics."
      );
    }

    return {
      sourceText,
      sourceSemanticHash,
      haSemanticHash,
      haCanonicalJson,
    };
  }

  _isDeploymentInProgress() {
    return [
      DEPLOYMENT_OPERATION.PREFLIGHT,
      DEPLOYMENT_OPERATION.AWAITING_CONFIRMATION,
      DEPLOYMENT_OPERATION.DEPLOYING,
      DEPLOYMENT_OPERATION.VERIFYING,
      DEPLOYMENT_OPERATION.RECORDING_BASELINE,
    ].includes(this._deploymentStatus);
  }

  _isResolutionInProgress() {
    return [
      RESOLUTION_OPERATION.PREPARING_IMPORT,
      RESOLUTION_OPERATION.PREPARING_OVERWRITE,
      RESOLUTION_OPERATION.AWAITING_CONFIRMATION,
      RESOLUTION_OPERATION.IMPORTING,
      RESOLUTION_OPERATION.DEPLOYING,
      RESOLUTION_OPERATION.VERIFYING,
      RESOLUTION_OPERATION.RECORDING_BASELINE,
    ].includes(this._resolutionStatus);
  }

  _confirmDeployment(firstDeployment) {
    const dashboardPath = this._dashboardPath(this._selectedDashboard);
    const message = firstDeployment
      ? `Deploy saved Source YAML to ${dashboardPath}? This is the first deployment baseline for this Source Document.`
      : `Deploy saved Source YAML to ${dashboardPath}?`;

    return window.confirm(message);
  }

  _canResolveFromCompare() {
    if (
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._hasUnsavedSourceChanges() ||
      this._isDeploymentInProgress() ||
      this._isResolutionInProgress() ||
      this._compareStatus !== "Ready" ||
      !this._compareSnapshot ||
      this._sourceVsHa !== "DIFFERENT"
    ) {
      return false;
    }

    return (
      this._compareSnapshot.documentId === this._sourceDocument.document_id &&
      this._compareSnapshot.targetUrlPath ===
        this._dashboardTargetUrlPath(this._selectedDashboard)
    );
  }

  async _requireSelectedStorageTarget() {
    const targetResult = await this._validateSelectedTarget();
    if (!targetResult.valid) {
      throw new StaleComparisonError(targetResult.message);
    }
  }

  _requireComparedDocument(document, snapshot) {
    if (
      document.document_id !== snapshot.documentId ||
      document.updated_at !== snapshot.documentUpdatedAt
    ) {
      throw new StaleComparisonError(
        "Source changed since comparison. Compare again."
      );
    }
  }

  _homeAssistantVersion() {
    return this._status?.home_assistant_version ?? "unknown";
  }

  _confirmHaImport() {
    return window.confirm(
      "Import the current Home Assistant version as Source YAML?\n\n" +
        "This will REPLACE the saved Source Document.\n\n" +
        "Comments, blank lines, quoting, formatting, and manual YAML organization from the previous Source may be permanently lost.\n\n" +
        "The Home Assistant dashboard itself will NOT be modified.\n\n" +
        "Continue?"
    );
  }

  _confirmInitializeFromHa() {
    return window.confirm(
      "Initialize Source from Home Assistant?\n\n" +
        "This will populate the empty Source Document using Home Assistant's current normalized dashboard configuration.\n\n" +
        "Comments, blank lines, quoting, and formatting previously removed by Home Assistant cannot be recovered.\n\n" +
        "This does not deploy anything to Home Assistant.\n\n" +
        "Continue?"
    );
  }

  _confirmOverwrite() {
    return window.confirm(
      `Overwrite Home Assistant ${this._dashboardPath(
        this._selectedDashboard
      )} with the saved Source YAML?\n\n` +
        "You reviewed the current differences with Compare.\n\n" +
        "This will replace the current Home Assistant dashboard configuration with the saved Source.\n\n" +
        "The current HA-only changes shown in Compare will be lost.\n\n" +
        "Continue?"
    );
  }

  _scheduleSyncRefresh() {
    if (!this._sourceDocument || !this._selectedDashboard) {
      return;
    }

    if (this._syncDebounce) {
      window.clearTimeout(this._syncDebounce);
    }

    this._syncDebounce = window.setTimeout(() => {
      this._syncDebounce = null;
      this._refreshSyncStatus();
    }, 400);
  }

  async _refreshSyncStatus({ reloadHa = false } = {}) {
    if (!this._sourceDocument || !this._selectedDashboard) {
      this._clearSyncState();
      this._refreshSyncUi();
      this._refreshSourceEditorUi();
      return;
    }

    const requestId = this._syncRequestId + 1;
    this._syncRequestId = requestId;
    this._syncStatus = "Calculating";
    this._syncError = null;
    this._refreshSyncUi();
    this._refreshSourceEditorUi();

    try {
      let currentHaConfig = this._configStatus === "Loaded" ? this._config : null;
      if (reloadHa || currentHaConfig == null) {
        currentHaConfig = await this._readDashboardConfig(this._selectedDashboard);
        if (requestId !== this._syncRequestId) {
          return;
        }
        this._config = currentHaConfig;
        this._configStatus = "Loaded";
        this._refreshDashboardConfigJson();
      }

      const sourceAnalysis = analyzeSourceText(this._sourceText);
      const sourceTextHash = await this._hashText(this._sourceText);
      if (requestId !== this._syncRequestId) {
        return;
      }

      let sourceSemanticHash = null;
      if (sourceAnalysis.validation.valid) {
        sourceSemanticHash = await this._hashText(
          canonicalJson(sourceAnalysis.parsedConfig)
        );
        if (requestId !== this._syncRequestId) {
          return;
        }
      }

      const haSemanticHash = await this._hashText(canonicalJson(currentHaConfig));
      if (requestId !== this._syncRequestId) {
        return;
      }
      const previousHaSemanticHash = this._haSemanticHash;
      const haHashChanged =
        previousHaSemanticHash !== null &&
        previousHaSemanticHash !== haSemanticHash;

      const deploymentBaseline =
        this._sourceDocument.deployment_baseline ?? null;
      const syncState = classifySyncState({
        deploymentBaseline,
        currentSourceTextHash: sourceTextHash,
        currentSourceSemanticHash: sourceSemanticHash,
        currentHaSemanticHash: haSemanticHash,
        sourceValid: sourceAnalysis.validation.valid,
      });

      this._sourceTextHash = sourceTextHash;
      this._sourceSemanticHash = sourceSemanticHash;
      this._haSemanticHash = haSemanticHash;
      this._sourceVsHa = compareSourceToHa(sourceSemanticHash, haSemanticHash);
      this._syncStatus = syncState.status;
      this._syncNote = syncState.note;
      this._syncError = null;
      if (reloadHa && haHashChanged) {
        this._clearComparison("Comparison cleared because Home Assistant changed.");
      }
    } catch (err) {
      if (requestId !== this._syncRequestId) {
        return;
      }

      this._syncStatus = "SYNC ERROR";
      this._sourceVsHa = "UNAVAILABLE";
      this._syncError = err?.message || "Unable to calculate synchronization status.";
    }

    this._refreshSyncUi();
    this._refreshSourceEditorUi();
  }

  async _hashText(text) {
    const result = await this._hass.connection.sendMessagePromise({
      type: "ha_yaml_source_editor/hash/sha256",
      text,
    });
    return result.sha256;
  }

  async _readDashboardConfig(dashboard, { force = false } = {}) {
    const message = {
      type: "lovelace/config",
    };
    const targetUrlPath = this._dashboardTargetUrlPath(dashboard);

    if (targetUrlPath != null) {
      message.url_path = targetUrlPath;
    }

    if (force) {
      message.force = true;
    }

    return this._hass.connection.sendMessagePromise(message);
  }

  async _asyncSaveLovelaceConfig(dashboard, config) {
    return this._hass.callWS({
      type: "lovelace/config/save",
      url_path: this._dashboardTargetUrlPath(dashboard),
      config,
    });
  }

  _renderDashboardList(dashboards) {
    if (this._dashboardLoading || this._dashboardStatus === "Connecting") {
      return `<p class="state">Loading dashboards...</p>`;
    }

    if (this._dashboardStatus === "Error") {
      return `<p class="state error">${this._escapeHtml(this._dashboardError)}</p>`;
    }

    if (dashboards.length === 0) {
      return `<p class="state">No storage mode dashboards found.</p>`;
    }

    return `
      <ul class="dashboard-list explorer-tree">
        ${dashboards
          .map((dashboard) => {
            const dashboardKey = this._dashboardKey(dashboard);
            const selectedClass =
              dashboardKey === this._selectedDashboardKey ? " selected" : "";

            return `
              <li class="explorer-tree-item">
                <button
                  type="button"
                  class="dashboard-card explorer-tree-row${selectedClass}"
                  data-dashboard-key="${this._escapeHtml(dashboardKey)}"
                >
                  <span class="explorer-tree-icon" aria-hidden="true">◇</span>
                  <span class="explorer-tree-content">
                    <span class="dashboard-title">${this._escapeHtml(
                      this._dashboardTitle(dashboard)
                    )}</span>
                    <span class="dashboard-meta">
                      ${this._escapeHtml(this._dashboardPath(dashboard))}
                    </span>
                  </span>
                </button>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  _renderTemplateTree() {
    if (this._templateLoading || this._templateStatus === "Connecting") {
      return `<p class="state">Loading YAML Templates...</p>`;
    }

    if (this._templateStatus === "Error") {
      return `<p class="state error">${this._escapeHtml(
        this._templateError || "Unable to discover YAML Template Sources."
      )}</p>`;
    }

    const index = this._templateIndex;

    if (!index?.available) {
      return `<p class="state">${this._escapeHtml(
        this._templateError ||
          index?.message ||
          "No supported YAML Template Source was discovered."
      )}</p>`;
    }

    const source = index.source ?? {};
    const blocks = Array.isArray(index.blocks) ? index.blocks : [];
    const searchQuery = this._templateSearchQuery.trim();
    const filteredBlocks = filterTemplateBlocks(
      index,
      searchQuery
    );

    const sourceMeta = [
      Number.isFinite(source.entity_count)
        ? `${source.entity_count} template${source.entity_count === 1 ? "" : "s"}`
        : null,
      Number.isFinite(source.line_count)
        ? `${source.line_count} lines`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const fullSourceSelectedClass =
      this._templateFullSourceStatus !== "Idle"
        ? " selected"
        : "";

    return `
      <ul class="template-tree explorer-tree">
        <li class="template-file-node">
          <details class="explorer-tree-details" open>
            <summary class="explorer-tree-row explorer-tree-summary template-source-summary${fullSourceSelectedClass}">
              <span class="explorer-tree-icon file-icon" aria-hidden="true">Y</span>
              <span class="explorer-tree-content">
                <span class="explorer-tree-label">${this._escapeHtml(
                  source.path || index.include_path || "Template Source"
                )}</span>
                ${
                  sourceMeta
                    ? `<span class="explorer-tree-meta">${this._escapeHtml(
                        sourceMeta
                      )}</span>`
                    : ""
                }
              </span>
              <span class="explorer-tree-badge">FULL</span>
            </summary>

            <ul class="explorer-tree explorer-tree-children">
              ${
                filteredBlocks.length === 0
                  ? `
                    <li>
                      <div class="explorer-tree-row explorer-tree-leaf">
                        <span class="explorer-tree-icon" aria-hidden="true">•</span>
                        <span class="explorer-tree-content">
                          <span class="explorer-tree-label">${
                            searchQuery
                              ? "No Templates match your search"
                              : "No indexed Template blocks"
                          }</span>
                        </span>
                      </div>
                    </li>
                  `
                  : filteredBlocks
                      .map((block) => {
                        const entities = Array.isArray(block.entities)
                          ? block.entities
                          : [];

                        const blockLabel =
                          block.label ||
                          block.section ||
                          `Template block ${block.block_number ?? ""}`;

                        const blockRange =
                          Number.isFinite(block.start_line) &&
                          Number.isFinite(block.end_line)
                            ? `L${block.start_line}-L${block.end_line}`
                            : "";

                        const badge = block.shared
                          ? "SHARED"
                          : String(block.block_type || "BLOCK").toUpperCase();

                        const blockSelectedClass =
                          this._selectedTemplateBlockId === block.block_id &&
                          !this._selectedTemplateEntityId
                            ? " selected"
                            : "";

                        const blockOpen =
                          Boolean(searchQuery) ||
                          this._openTemplateBlockIds.has(block.block_id);

                        if (entities.length === 0) {
                          return `
                            <li class="template-block-node">
                              <div
                                class="explorer-tree-row explorer-tree-leaf template-block-open${blockSelectedClass}"
                                data-template-block-id="${this._escapeHtml(
                                  block.block_id || ""
                                )}"
                              >
                                <span class="explorer-tree-icon" aria-hidden="true">◆</span>
                                <span class="explorer-tree-content">
                                  <span class="explorer-tree-label">${this._escapeHtml(
                                    blockLabel
                                  )}</span>
                                  <span class="explorer-tree-meta">${this._escapeHtml(
                                    blockRange
                                  )}</span>
                                </span>
                                <span class="explorer-tree-badge">${this._escapeHtml(
                                  badge
                                )}</span>
                              </div>
                            </li>
                          `;
                        }

                        return `
                          <li class="template-block-node">
                            <details
                              class="explorer-tree-details"
                              data-template-block-id="${this._escapeHtml(
                                block.block_id || ""
                              )}"${blockOpen ? " open" : ""}
                            >
                              <summary
                                class="explorer-tree-row explorer-tree-summary template-block-summary${blockSelectedClass}"
                                data-template-block-id="${this._escapeHtml(
                                  block.block_id || ""
                                )}"
                              >
                                <span class="explorer-tree-icon" aria-hidden="true">◆</span>
                                <span class="explorer-tree-content">
                                  <span class="explorer-tree-label">${this._escapeHtml(
                                    blockLabel
                                  )}</span>
                                  <span class="explorer-tree-meta">${this._escapeHtml(
                                    blockRange
                                  )}</span>
                                </span>
                                <span class="explorer-tree-badge">${this._escapeHtml(
                                  badge
                                )}</span>
                              </summary>

                              <ul class="explorer-tree explorer-tree-children">
                                ${entities
                                  .map((entity) => {
                                    const entityRange =
                                      Number.isFinite(entity.start_line) &&
                                      Number.isFinite(entity.end_line)
                                        ? `L${entity.start_line}-L${entity.end_line}`
                                        : "";

                                    const entityMeta = [
                                      entity.unique_id || null,
                                      entityRange || null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ");

                                    const entitySelectedClass =
                                      this._selectedTemplateBlockId ===
                                        block.block_id &&
                                      this._selectedTemplateEntityId ===
                                        entity.entity_id
                                        ? " selected"
                                        : "";

                                    return `
                                      <li class="template-entity-node">
                                        <div
                                          class="explorer-tree-row explorer-tree-leaf template-entity-row${entitySelectedClass}"
                                          data-template-block-id="${this._escapeHtml(
                                            block.block_id || ""
                                          )}"
                                          data-template-entity-id="${this._escapeHtml(
                                            entity.entity_id || ""
                                          )}"
                                        >
                                          <span class="explorer-tree-icon" aria-hidden="true">•</span>
                                          <span class="explorer-tree-content">
                                            <span class="explorer-tree-label">${this._escapeHtml(
                                              entity.name || "Unnamed Template"
                                            )}</span>
                                            ${
                                              entityMeta
                                                ? `<span class="explorer-tree-meta">${this._escapeHtml(
                                                    entityMeta
                                                  )}</span>`
                                                : ""
                                            }
                                          </span>
                                        </div>
                                      </li>
                                    `;
                                  })
                                  .join("")}
                              </ul>
                            </details>
                          </li>
                        `;
                      })
                      .join("")
              }
            </ul>
          </details>
        </li>
      </ul>
    `;
  }

  _renderConfigurationSection() {
    const dashboard = this._selectedDashboard;
    const statusClass = this._configStatus === "Error" ? " error" : "";

    return `
      <section class="section">
        <h2>Dashboard configuration</h2>
        <dl class="config-status">
          <dt>Selected dashboard</dt>
          <dd>${
            dashboard
              ? this._escapeHtml(this._dashboardTitle(dashboard))
              : "None"
          }</dd>
          <dt>Display path</dt>
          <dd>${
            dashboard ? this._escapeHtml(this._dashboardPath(dashboard)) : "-"
          }</dd>
          <dt>Read status</dt>
          <dd class="${statusClass.trim()}">${this._escapeHtml(
            this._configStatus
          )}</dd>
        </dl>
        ${this._renderConfigurationBody()}
      </section>
    `;
  }

  _renderConfigurationBody() {
    if (this._configStatus === "No dashboard selected") {
      return `<p class="state">No dashboard selected.</p>`;
    }

    if (this._configStatus === "Loading") {
      return `<p class="state">Loading dashboard configuration...</p>`;
    }

    if (this._configStatus === "Error") {
      return `<p class="state error">${this._escapeHtml(
        this._configError || "Unable to read dashboard configuration."
      )}</p>`;
    }

    return `
      <div class="config-viewer">
        <p class="state">
          Current Home Assistant configuration (read-only). This is Home
          Assistant's normalized representation. It is not the lossless source
          document.
        </p>
        <pre id="dashboard-config-json"></pre>
      </div>
    `;
  }

  _renderSourceDocumentSection() {
    const dashboard = this._selectedDashboard;
    const sourceStatus =
      this._sourceStatus === "Error" ||
      this._sourceStatus === "Saving"
        ? this._sourceStatus
        : this._hasUnsavedSourceChanges()
          ? "Unsaved changes"
          : this._sourceStatus;
    const statusClass = this._sourceStatus === "Error" ? " error" : "";

    return `
      <section class="section">
        <h2>Source document</h2>
        <dl class="source-status">
          <dt>Target</dt>
          <dd>${
            dashboard
              ? `Lovelace Storage Dashboard ${this._escapeHtml(
                  this._dashboardPath(dashboard)
                )}`
              : "-"
          }</dd>
          <dt>Source status</dt>
          <dd id="source-status-value" class="${statusClass.trim()}">${this._escapeHtml(sourceStatus)}</dd>
        </dl>
        ${this._renderSourceMessage()}
        ${this._renderSourceDocumentBody()}
      </section>
    `;
  }

  _renderSourceMessage() {
    return this._sourceMessage
      ? `<p class="state">${this._escapeHtml(this._sourceMessage)}</p>`
      : "";
  }

  _renderSourceDocumentBody() {
    if (!this._selectedDashboard) {
      return `<p class="state">Select a Storage Mode dashboard to manage its Source Document.</p>`;
    }

    if (this._sourceStatus === "Checking" || this._sourceStatus === "Loading") {
      return `<p class="state">Loading Source Document...</p>`;
    }

    if (this._sourceStatus === "Creating") {
      return `<p class="state">Creating Source Document...</p>`;
    }

    if (this._sourceStatus === "Error") {
      return `<p class="state error">${this._escapeHtml(
        this._sourceError || "Unable to load Source Document."
      )}</p>`;
    }

    if (this._sourceStatus === "No document") {
      return `<p class="state">No source document exists for this dashboard.</p>`;
    }

    return `
      <div class="source-editor">
        <label for="source-code-editor-host">Source YAML</label>
        <p class="state">
          This Source YAML is stored as the editor text, using LF newlines in
          v0.1. Saving it does not modify Home Assistant's Lovelace
          configuration. Validate checks the current editor text and does not
          save or deploy it.
        </p>
        ${
          this._isSavedSourceBlank()
            ? `<p class="state">This Source Document is empty. Enter YAML manually or use Initialize from HA to start from Home Assistant's current dashboard configuration.</p>`
            : ""
        }
        <div class="source-code-editor-shell">
          <div id="source-code-editor-host"></div>
          <div id="source-editor-status" class="source-editor-status"></div>
        </div>
      </div>
    `;
  }


  _renderTemplateFullSourceSection() {
    if (this._templateFullSourceStatus === "Idle") {
      return "";
    }

    if (this._templateFullSourceStatus === "Loading") {
      return `
        <section class="section">
          <h2>Full Template Source</h2>
          <p class="state">
            Loading the complete physical Template Source snapshot...
          </p>
        </section>
      `;
    }

    if (
      this._templateFullSourceStatus === "Error" ||
      this._templateFullSourceStatus === "Stale"
    ) {
      return `
        <section class="section">
          <h2>Full Template Source</h2>
          <p class="state error">${this._escapeHtml(
            this._templateFullSourceError ||
              "Unable to load the full Template Source."
          )}</p>
          <p class="state">
            Refresh Explorer and open the physical Source again before
            continuing.
          </p>
        </section>
      `;
    }

    if (
      this._templateFullSourceStatus !== "Loaded" ||
      !this._templateFullSourceResult
    ) {
      return "";
    }

    const source =
      this._templateFullSourceResult.source ?? {};

    return `
      <section class="section">
        <h2>Full Template Source</h2>

        <dl class="source-status template-source-status">
          <dt>Source</dt>
          <dd>${this._escapeHtml(
            source.path ?? "-"
          )}</dd>

          <dt>Mode</dt>
          <dd>Read-only physical Source snapshot</dd>

          <dt>Snapshot</dt>
          <dd title="${this._escapeHtml(
            source.sha256 ?? ""
          )}">${this._escapeHtml(
            shortHash(source.sha256)
          )}</dd>

          <dt>Physical size</dt>
          <dd>${this._escapeHtml(
            Number.isFinite(source.size_bytes)
              ? `${source.size_bytes} bytes`
              : "-"
          )}</dd>

          <dt>Lines</dt>
          <dd>${this._escapeHtml(
            Number.isFinite(source.line_count)
              ? source.line_count
              : "-"
          )}</dd>

          <dt>Indexed blocks</dt>
          <dd>${this._escapeHtml(
            Number.isFinite(source.block_count)
              ? source.block_count
              : "-"
          )}</dd>

          <dt>Indexed Templates</dt>
          <dd>${this._escapeHtml(
            Number.isFinite(source.entity_count)
              ? source.entity_count
              : "-"
          )}</dd>
        </dl>

        <div class="source-editor">
          <label for="source-code-editor-host">
            Complete Template YAML
          </label>

          <p class="state">
            Read-only view of the complete configured physical Template
            Source. This view cannot be saved. To edit YAML, select an
            indexed top-level Template block in Explorer. Only complete
            top-level blocks are writable.
          </p>

          <div class="source-code-editor-shell">
            <div id="source-code-editor-host"></div>
            <div
              id="source-editor-status"
              class="source-editor-status"
            ></div>
          </div>
        </div>
      </section>
    `;
  }

  _renderTemplateBlockSection() {
    if (!this._selectedTemplateBlockId) {
      return "";
    }

    if (this._templateBlockStatus === "Loading") {
      return `
        <section class="section">
          <h2>Template block</h2>
          <p class="state">Loading exact raw Template YAML...</p>
        </section>
      `;
    }

    if (this._templateBlockStatus === "Error") {
      return `
        <section class="section">
          <h2>Template block</h2>
          <p class="state error">${this._escapeHtml(
            this._templateBlockError ||
              "Unable to load Template block."
          )}</p>
          <p class="state">
            Refresh Explorer before retrying if the Template Source changed.
          </p>
        </section>
      `;
    }

    if (
      this._templateBlockStatus !== "Loaded" ||
      !this._templateBlockResult
    ) {
      return "";
    }

    const { block, source } = this._templateBlockResult;
    const saveDisabled =
      this._canSaveTemplateBlock()
        ? ""
        : "disabled";
    const saveMessage =
      this._templateSaveMessage ?? "";
    const saveMessageClass =
      ["Error", "Stale", "Uncertain"].includes(
        this._templateSaveStatus
      )
        ? "state error"
        : "state";
    const range =
      Number.isFinite(block?.start_line) &&
      Number.isFinite(block?.end_line)
        ? `L${block.start_line}-L${block.end_line}`
        : "-";

    return `
      <section class="section">
        <h2>Template block</h2>

        <dl class="source-status template-source-status">
          <dt>Source</dt>
          <dd>${this._escapeHtml(source?.path ?? "-")}</dd>

          <dt>Logical block</dt>
          <dd>${this._escapeHtml(
            block?.label ??
              block?.section ??
              block?.block_id ??
              "-"
          )}</dd>

          <dt>Physical range</dt>
          <dd>${this._escapeHtml(range)}</dd>

          <dt>Edit unit</dt>
          <dd>Complete top-level Template block</dd>
        </dl>

        <nav
          class="command-bar"
          aria-label="Template workflow commands"
        >
          <div
            class="workflow-actions"
            aria-label="Template workflow"
          >
            <button
              type="button"
              id="save-template-block"
              ${saveDisabled}
            >
              Save Template
            </button>
          </div>
        </nav>

        <p
          id="template-save-message"
          class="${saveMessageClass}"
          ${saveMessage ? "" : "hidden"}
        >${this._escapeHtml(saveMessage)}</p>

        <div class="source-editor">
          <label for="source-code-editor-host">Template YAML</label>
          <p class="state">
            Exact raw YAML from the selected top-level Template block.
            The complete top-level block is the writable unit; child
            entities are navigation targets only. Save performs structural
            checks, Home Assistant Template semantic validation, stale
            snapshot checks, atomic replacement, and read-back verification.
            It does not automatically reload or restart Home Assistant.
          </p>

          <div class="source-code-editor-shell">
            <div id="source-code-editor-host"></div>
            <div
              id="source-editor-status"
              class="source-editor-status"
            ></div>
          </div>
        </div>
      </section>
    `;
  }

  _renderValidationSection() {
    const statusClass =
      this._validationStatus === "Invalid" || this._validationStatus === "Error"
        ? " error"
        : "";

    return `
      <section class="section">
        <h2>Validation</h2>
        <dl class="validation-status">
          <dt>Status</dt>
          <dd id="validation-status-value" class="${statusClass.trim()}">${this._escapeHtml(
            this._validationStatus
          )}</dd>
        </dl>
        <div id="validation-body">${this._renderValidationBody()}</div>
      </section>
    `;
  }

  _renderValidationBody() {
    if (this._validationStatus === "Not validated") {
      return `<p class="state">Validate checks the current editor text and does not save or deploy it.</p>`;
    }

    if (this._validationStatus === "Validating") {
      return `<p class="state">Validating Source YAML...</p>`;
    }

    if (this._validationStatus === "Error") {
      return `<p class="state error">${this._escapeHtml(
        this._validationError || "Validation failed because of a communication error."
      )}</p>`;
    }

    if (this._validationStatus === "Valid") {
      const summary = this._validationResult?.summary;
      const views =
        typeof summary?.views === "number"
          ? `<dt>Views</dt><dd>${summary.views}</dd>`
          : "";
      const strategy = summary?.strategy
        ? `<dt>Strategy</dt><dd>Configured</dd>`
        : "";

      return `
        <dl class="validation-status">
          <dt>YAML syntax</dt><dd>OK</dd>
          <dt>JSON/WebSocket compatible</dt><dd>OK</dd>
          <dt>Lovelace structure</dt><dd>OK</dd>
          <dt>Target</dt><dd>OK</dd>
          ${views}
          ${strategy}
        </dl>
      `;
    }

    const result = this._validationResult;
    const location =
      result?.line != null
        ? `<dt>Location</dt><dd>Line ${this._escapeHtml(result.line)}, column ${this._escapeHtml(
            result.column ?? "?"
          )}</dd>`
        : "";
    const path = result?.path
      ? `<dt>Path</dt><dd>${this._escapeHtml(result.path)}</dd>`
      : "";

    return `
      <dl class="validation-status">
        <dt>Stage</dt><dd>${this._escapeHtml(result?.stage ?? "validation")}</dd>
        <dt>Message</dt><dd>${this._escapeHtml(
          result?.message ?? "Source YAML is invalid."
        )}</dd>
        ${location}
        ${path}
      </dl>
    `;
  }

  _renderSyncSection() {
    const statusClass = this._syncStatus === "SYNC ERROR" ? " error" : "";
    const refreshDisabled =
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._syncStatus === "Calculating" ||
      this._isResolutionInProgress()
        ? "disabled"
        : "";

    return `
      <section class="section">
        <div class="section-header">
          <h2>Synchronization</h2>
          <button type="button" id="refresh-sync-status" ${refreshDisabled}>
            Refresh Status
          </button>
        </div>
        <p class="state">
          Source vs HA compares current semantic configuration. It does not mean
          the dashboard was deployed by HA YAML Source Editor.
        </p>
        <dl class="sync-status">
          <dt>Sync status</dt>
          <dd id="sync-status-value" class="${statusClass.trim()}">${this._escapeHtml(this._syncStatus)}</dd>
          <dt>Source vs HA</dt>
          <dd id="source-vs-ha-value">${this._escapeHtml(this._sourceVsHa)}</dd>
          <dt>Source text</dt>
          <dd id="source-text-hash" title="${this._escapeHtml(this._sourceTextHash ?? "")}">${this._escapeHtml(
            shortHash(this._sourceTextHash)
          )}</dd>
          <dt>Source semantics</dt>
          <dd id="source-semantic-hash" title="${this._escapeHtml(this._sourceSemanticHash ?? "")}">${this._escapeHtml(
            shortHash(this._sourceSemanticHash)
          )}</dd>
          <dt>Current HA</dt>
          <dd id="ha-semantic-hash" title="${this._escapeHtml(this._haSemanticHash ?? "")}">${this._escapeHtml(
            shortHash(this._haSemanticHash)
          )}</dd>
        </dl>
        <div id="sync-message">${this._renderSyncMessage()}</div>
      </section>
    `;
  }

  _renderDeploymentSection() {
    const statusClass =
      this._deploymentStatus === DEPLOYMENT_OPERATION.ERROR ||
      this._deploymentStatus === DEPLOYMENT_OPERATION.CONFLICT
        ? " error"
        : "";

    return `
      <section class="section">
        <h2>Deployment</h2>
        <dl class="deployment-status">
          <dt>Status</dt>
          <dd id="deployment-status-value" class="${statusClass.trim()}">${this._escapeHtml(
            this._deploymentStatus
          )}</dd>
          ${this._renderDeploymentBaseline()}
        </dl>
        <div id="deployment-body">
          ${this._renderDeploymentMessage()}
          ${this._renderDeploymentImportNote()}
        </div>
      </section>
    `;
  }

  _renderDeploymentBaseline() {
    const baseline = this._sourceDocument?.deployment_baseline ?? null;
    const baselineOrigin = baseline?.origin ?? null;
    const lastDeployed =
      baselineOrigin === "deployment"
        ? `<dt>Last deployed</dt><dd>${this._escapeHtml(
            baseline?.deployed_at ?? "-"
          )}</dd>`
        : "";

    return `
      <dt>Baseline origin</dt>
      <dd>${this._escapeHtml(this._formatBaselineOrigin(baselineOrigin))}</dd>
      <dt>Baseline established</dt>
      <dd>${this._escapeHtml(baseline?.established_at ?? "-")}</dd>
      ${lastDeployed}
      <dt>HA baseline</dt>
      <dd title="${this._escapeHtml(
        baseline?.ha_semantic_hash ?? ""
      )}">${this._escapeHtml(shortHash(baseline?.ha_semantic_hash))}</dd>
      <dt>HA version</dt>
      <dd>${this._escapeHtml(
        baseline?.home_assistant_version ?? "-"
      )}</dd>
    `;
  }

  _renderDeploymentImportNote() {
    const baselineOrigin =
      this._sourceDocument?.deployment_baseline?.origin ?? null;

    return baselineOrigin === "ha_import"
      ? `<p class="state">This Source was imported from Home Assistant's normalized configuration. Original comments/formatting removed by Home Assistant cannot be recovered.</p>`
      : "";
  }

  _formatBaselineOrigin(origin) {
    if (origin === "deployment") {
      return "Deployment";
    }
    if (origin === "ha_import") {
      return "Imported from Home Assistant";
    }
    return "-";
  }

  _renderDeploymentMessage() {
    if (!this._deploymentMessage) {
      return "";
    }

    const messageClass =
      this._deploymentStatus === DEPLOYMENT_OPERATION.ERROR ||
      this._deploymentStatus === DEPLOYMENT_OPERATION.CONFLICT
        ? "state error"
        : "state";

    return `<p class="${messageClass}">${this._escapeHtml(
      this._deploymentMessage
    )}</p>`;
  }

  _renderSyncMessage() {
    if (this._syncStatus === "Calculating") {
      return `<p class="state">Calculating hashes...</p>`;
    }

    if (this._syncError) {
      return `<p class="state error">${this._escapeHtml(this._syncError)}</p>`;
    }

    if (this._syncNote) {
      return `<p class="state">${this._escapeHtml(this._syncNote)}</p>`;
    }

    return "";
  }

  _renderCompareSection() {
    const statusClass = this._compareStatus === "Error" ? " error" : "";
    const baseline = this._sourceDocument?.deployment_baseline ?? null;
    const baselineOrigin = baseline?.origin ?? null;

    return `
      <section class="section">
        <h2>Comparison</h2>
        <dl class="compare-status">
          <dt>Status</dt>
          <dd id="compare-status-value" class="${statusClass.trim()}">${this._escapeHtml(
            this._compareStatus
          )}</dd>
          <dt>Baseline snapshot</dt>
          <dd>${this._escapeHtml(
            baseline?.deployed_canonical_json
              ? "Available"
              : "Unavailable"
          )}</dd>
          <dt>Baseline origin</dt>
          <dd>${this._escapeHtml(this._formatBaselineOrigin(baselineOrigin))}</dd>
        </dl>
        <div id="compare-body">${this._renderCompareBody()}</div>
      </section>
    `;
  }

  _renderCompareBody() {
    if (this._hasUnsavedSourceChanges()) {
      return `<p class="state">Save Source before comparing. Compare uses the saved Source Document.</p>`;
    }

    if (this._compareStatus === "Idle") {
      return this._compareMessage
        ? `<p class="state">${this._escapeHtml(this._compareMessage)}</p>`
        : `<p class="state">Compare uses the saved Source Document and current Home Assistant configuration.</p>`;
    }

    if (this._compareStatus === "Loading") {
      return `<p class="state">Loading comparison snapshot...</p>`;
    }

    if (this._compareStatus === "Error") {
      return `<p class="state error">${this._escapeHtml(
        this._compareError || "Unable to compare Source and HA."
      )}</p>`;
    }

    if (!this._compareResult) {
      return "";
    }

    if (this._compareStatus === "No differences") {
      return `
        <p class="state">
          NO SEMANTIC DIFFERENCES. Comments, whitespace, quoting, and formatting
          are not part of this semantic comparison.
        </p>
      `;
    }

    if (this._compareResult.mode === "three_way") {
      return `
        <p class="state">
          Array reordering may appear as multiple indexed changes.
        </p>
        ${this._renderDiffGroup(
          "Changes in Saved Source since baseline",
          "Baseline -> Saved Source",
          this._compareResult.sourceChanges,
          "Baseline",
          "Saved Source"
        )}
        ${this._renderDiffGroup(
          "Changes in Home Assistant since baseline",
          "Baseline -> Current Home Assistant",
          this._compareResult.haChanges,
          "Baseline",
          "Current HA"
        )}
        ${this._renderDiffGroup(
          "Current difference",
          "Saved Source -> Current Home Assistant",
          this._compareResult.currentDifference,
          "Saved Source",
          "Current HA"
        )}
      `;
    }

    return `
      <p class="state">
        Baseline configuration snapshot is unavailable.
        Showing current Source vs Home Assistant only.
      </p>
      <p class="state">
        Array reordering may appear as multiple indexed changes.
      </p>
      ${this._renderDiffGroup(
        "Saved Source vs Current Home Assistant",
        "Saved Source -> Current Home Assistant",
        this._compareResult.currentDifference,
        "Saved Source",
        "Current HA"
      )}
    `;
  }

  _renderResolutionSection() {
    const statusClass = this._resolutionStatus === RESOLUTION_OPERATION.ERROR
      ? " error"
      : "";
    const canResolve = this._canResolveFromCompare();
    const importDisabled = canResolve ? "" : "disabled";
    const overwriteAllowed =
      canResolve && ["HA MODIFIED", "BOTH MODIFIED"].includes(this._syncStatus);
    const overwriteDisabled = overwriteAllowed ? "" : "disabled";

    return `
      <section class="section">
        <h2>Conflict resolution</h2>
        <dl class="resolution-status">
          <dt>Status</dt>
          <dd class="${statusClass.trim()}">${this._escapeHtml(
            this._resolutionStatus
          )}</dd>
        </dl>
        <div class="resolution-actions">
          <button type="button" id="import-ha-version" ${importDisabled}>
            Import HA Version
          </button>
          <button type="button" id="overwrite-ha-source" ${overwriteDisabled}>
            Overwrite HA with Saved Source
          </button>
        </div>
        ${this._renderResolutionMessage()}
      </section>
    `;
  }

  _renderResolutionMessage() {
    if (this._resolutionMessage) {
      const messageClass =
        this._resolutionStatus === RESOLUTION_OPERATION.ERROR
          ? "state error"
          : "state";
      return `<p class="${messageClass}">${this._escapeHtml(
        this._resolutionMessage
      )}</p>`;
    }

    if (this._compareStatus !== "Ready") {
      return `<p class="state">Run Compare Source vs HA before choosing an explicit conflict resolution.</p>`;
    }

    return `<p class="state">Resolution actions use the exact Home Assistant state reviewed by Compare.</p>`;
  }

  _renderDiffGroup(title, subtitle, diffResult, sourceLabel, haLabel) {
    const count = diffResult.totalDifferences;
    const summary =
      count === 0
        ? "NO SEMANTIC DIFFERENCES"
        : `${count} ${count === 1 ? "difference" : "differences"}`;
    const truncated = diffResult.truncated
      ? `<p class="state">Showing first ${diffResult.entries.length} differences. ${diffResult.omittedDifferences} more not shown.</p>`
      : "";

    return `
      <section class="diff-group">
        <h3>${this._escapeHtml(title)}</h3>
        <p class="diff-subtitle">${this._escapeHtml(subtitle)}: ${this._escapeHtml(summary)}</p>
        ${truncated}
        ${
          diffResult.entries.length === 0
            ? ""
            : `<ul class="diff-list">${diffResult.entries
                .map((entry) => this._renderDiffEntry(entry, sourceLabel, haLabel))
                .join("")}</ul>`
        }
      </section>
    `;
  }

  _renderDiffEntry(entry, sourceLabel, haLabel) {
    const sourceValue =
      entry.kind === "ha_only"
        ? ""
        : this._renderDiffValue(sourceLabel, entry.sourceValue);
    const haValue =
      entry.kind === "source_only"
        ? ""
        : this._renderDiffValue(haLabel, entry.haValue);

    return `
      <li class="diff-entry">
        <div class="diff-kind">${this._escapeHtml(
          this._formatDiffKind(entry.kind, sourceLabel, haLabel)
        )}</div>
        <div class="diff-path">${this._escapeHtml(entry.path)}</div>
        ${sourceValue}
        ${haValue}
      </li>
    `;
  }

  _renderDiffValue(label, value) {
    const serialized = serializeDiffValue(value);
    const truncated = serialized.truncated ? " (truncated)" : "";
    return `
      <div class="diff-value">
        <div class="diff-value-label">${this._escapeHtml(label)}${truncated}</div>
        <pre>${this._escapeHtml(serialized.text)}</pre>
      </div>
    `;
  }

  _formatDiffKind(kind, sourceLabel, haLabel) {
    return formatDiffKindForLabels(kind, { sourceLabel, haLabel });
  }

  _setInspectorTab(tab) {
    if (!["status", "details", "actions"].includes(tab)) {
      return;
    }

    this._inspectorTab = tab;
    this._inspectorOpen = true;
    this._render();
  }

  _toggleInspector() {
    this._inspectorUserToggled = true;
    this._inspectorOpen = !this._inspectorOpen;
    this._render();
  }

  _renderApplicationHeader() {
    const integrationVersion = this._status?.integration_version ?? "Unknown";

    return `
      <header class="app-header">
        <div class="app-title-block">
          <h1>HA YAML Source Editor</h1>
          <span class="app-version">v${this._escapeHtml(integrationVersion)}</span>
        </div>
      </header>
    `;
  }

  _renderEditorTargetContents() {
    if (this._templateFullSourceStatus !== "Idle") {
      const source =
        this._templateFullSourceResult?.source ??
        this._templateIndex?.source ??
        {};

      const label =
        source.relative_path ||
        source.path ||
        "Template Source";

      return `
        <span>${this._escapeHtml(label)}</span>
        ${
          source.path
            ? `<span class="editor-target-path">${this._escapeHtml(
                source.path
              )}</span>`
            : ""
        }
      `;
    }

    if (this._selectedTemplateBlockId) {
      const block =
        this._templateBlockResult?.block ??
        findTemplateBlock(
          this._templateIndex,
          this._selectedTemplateBlockId
        );

      const entity = findTemplateEntity(
        block,
        this._selectedTemplateEntityId
      );

      const label =
        entity?.name ??
        block?.label ??
        block?.section ??
        "Template block";

      const sourcePath =
        this._templateBlockResult?.source?.path ??
        this._templateIndex?.source?.path ??
        "";

      const range =
        Number.isFinite(block?.start_line) &&
        Number.isFinite(block?.end_line)
          ? `L${block.start_line}-L${block.end_line}`
          : "";

      return `
        <span>${this._escapeHtml(label)}</span>
        ${
          sourcePath
            ? `<span class="editor-target-path">${this._escapeHtml(
                sourcePath
              )}</span>`
            : ""
        }
        ${
          range
            ? `<span class="editor-target-path">${this._escapeHtml(
                range
              )}</span>`
            : ""
        }
      `;
    }

    const dashboard = this._selectedDashboard;
    const dashboardTitle = dashboard
      ? this._dashboardTitle(dashboard)
      : "No dashboard selected";
    const dashboardPath = dashboard
      ? this._dashboardPath(dashboard)
      : "";

    return `
      <span>${this._escapeHtml(dashboardTitle)}</span>
      ${
        dashboardPath
          ? `<span class="editor-target-path">${this._escapeHtml(
              dashboardPath
            )}</span>`
          : ""
      }
    `;
  }

  _renderEditorStateSummary() {
    if (this._templateFullSourceStatus !== "Idle") {
      const sha256 =
        this._templateFullSourceResult?.source?.sha256 ??
        this._templateIndex?.source?.sha256 ??
        "";

      const shortSnapshot =
        sha256.length >= 12
          ? sha256.slice(0, 12)
          : sha256 || "Unavailable";

      return `
        <span>Template: ${this._escapeHtml(
          this._templateFullSourceStatus
        )}</span>
        <span>Mode: Read-only full source</span>
        <span>Snapshot: ${this._escapeHtml(
          shortSnapshot
        )}</span>
      `;
    }

    if (this._selectedTemplateBlockId) {
      const sha256 =
        this._templateBlockResult?.source?.sha256 ??
        this._templateIndex?.source?.sha256 ??
        "";

      const shortSnapshot =
        sha256.length >= 12
          ? sha256.slice(0, 12)
          : sha256 || "Unavailable";

      return `
        <span>Template: ${this._escapeHtml(
          this._templateEditorStateLabel()
        )}</span>
        <span>Mode: Editable block</span>
        <span>Snapshot: ${this._escapeHtml(
          shortSnapshot
        )}</span>
      `;
    }

    return `
      <span id="editor-source-status-value">${this._escapeHtml(
        `Source: ${this._sourceStateLabel()}`
      )}</span>
      <span id="editor-sync-status-value">${this._escapeHtml(
        `Source vs HA: ${this._sourceVsHa}`
      )}</span>
    `;
  }

  _renderEditorContext() {
    return `
      <div class="editor-context">
        <div class="editor-target">
          ${this._renderEditorTargetContents()}
        </div>
        <div
          class="editor-state-summary"
          aria-label="Current editor target state"
        >
          ${this._renderEditorStateSummary()}
        </div>
      </div>
    `;
  }

  _renderCommandBar() {
    const saveDisabled =
      !this._sourceDocument ||
      this._sourceStatus === "Saving" ||
      !this._hasUnsavedSourceChanges()
        ? "disabled"
        : "";
    const validateDisabled =
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._validationStatus === "Validating"
        ? "disabled"
        : "";
    const compareDisabled =
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._compareStatus === "Loading" ||
      this._hasUnsavedSourceChanges() ||
      this._isDeploymentInProgress() ||
      this._isResolutionInProgress()
        ? "disabled"
        : "";
    const deployDisabled =
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._hasUnsavedSourceChanges() ||
      this._isDeploymentInProgress() ||
      this._isResolutionInProgress() ||
      this._sourceText.length === 0
        ? "disabled"
        : "";
    const createDisabled = this._canCreateSourceDocument() ? "" : "disabled";
    const initializeDisabled = this._canInitializeSourceFromHa()
      ? ""
      : "disabled";

    return `
      <nav class="command-bar" aria-label="Source workflow commands">
        <div class="workflow-actions" aria-label="Source workflow">
          <button type="button" id="create-source-document" ${createDisabled}>
            Create Source
          </button>
          <button type="button" id="initialize-source-from-ha" ${initializeDisabled}>
            Initialize from HA
          </button>
          <button type="button" id="save-source-document" ${saveDisabled}>
            Save Source
          </button>
          <button type="button" id="validate-source-document" ${validateDisabled}>
            Validate
          </button>
          <button type="button" id="compare-source-ha" ${compareDisabled}>
            Compare
          </button>
          <button type="button" id="deploy-saved-source" ${deployDisabled}>
            Deploy
          </button>
        </div>
      </nav>
    `;
  }

  _renderInspectorEdgeTab() {
    const inspectorPressed = this._inspectorOpen ? "true" : "false";

    return `
      <button
        type="button"
        id="toggle-inspector"
        class="inspector-edge-tab"
        aria-label="${this._inspectorOpen ? "Close Inspector" : "Open Inspector"}"
        aria-controls="workspace-inspector"
        aria-expanded="${inspectorPressed}"
        aria-pressed="${inspectorPressed}"
      >
        <span class="inspector-edge-arrow" aria-hidden="true">
          ${this._inspectorOpen ? ">" : "<"}
        </span>
        <span class="inspector-edge-label">Inspector</span>
      </button>
    `;
  }

  _renderInspectorTabs() {
    const statusSelected = this._inspectorTab === "status";
    const detailsSelected = this._inspectorTab === "details";
    const actionsSelected = this._inspectorTab === "actions";

    return `
      <div class="inspector-tabs" role="tablist" aria-label="Inspector sections">
        <button
          type="button"
          class="inspector-tab${statusSelected ? " selected" : ""}"
          data-inspector-tab="status"
          role="tab"
          aria-selected="${statusSelected ? "true" : "false"}"
        >
          Status
        </button>
        <button
          type="button"
          class="inspector-tab${detailsSelected ? " selected" : ""}"
          data-inspector-tab="details"
          role="tab"
          aria-selected="${detailsSelected ? "true" : "false"}"
        >
          Details
        </button>
        <button
          type="button"
          class="inspector-tab${actionsSelected ? " selected" : ""}"
          data-inspector-tab="actions"
          role="tab"
          aria-selected="${actionsSelected ? "true" : "false"}"
        >
          Actions
        </button>
      </div>
    `;
  }

  _renderInspectorStatusPanel() {
    const sourceClass = this._sourceStatus === "Error" ? " error" : "";
    const validationClass =
      this._validationStatus === "Invalid" || this._validationStatus === "Error"
        ? " error"
        : "";
    const syncClass = this._syncStatus === "SYNC ERROR" ? " error" : "";
    const deploymentClass =
      this._deploymentStatus === DEPLOYMENT_OPERATION.ERROR ||
      this._deploymentStatus === DEPLOYMENT_OPERATION.CONFLICT
        ? " error"
        : "";

    return `
      <section class="section first-section">
        <h2>Status</h2>
        <dl class="inspector-summary">
          <dt>Source</dt>
          <dd class="${sourceClass.trim()}">${this._escapeHtml(
            this._sourceStateLabel()
          )}</dd>
          <dt>Validation</dt>
          <dd class="${validationClass.trim()}">${this._escapeHtml(
            this._validationStatus
          )}</dd>
          <dt>Sync</dt>
          <dd class="${syncClass.trim()}">${this._escapeHtml(this._syncStatus)}</dd>
          <dt>Source vs HA</dt>
          <dd>${this._escapeHtml(this._sourceVsHa)}</dd>
          <dt>Deployment</dt>
          <dd class="${deploymentClass.trim()}">${this._escapeHtml(
            this._deploymentStatus
          )}</dd>
        </dl>
        ${this._renderSyncMessage()}
        ${this._renderDeploymentMessage()}
        ${this._renderValidationBody()}
      </section>
    `;
  }


  _renderTemplateFullSourceInspectorPanel() {
    const source =
      this._templateFullSourceResult?.source ??
      this._templateIndex?.source ??
      {};

    return `
      <section class="section first-section">
        <h2>Template Source</h2>

        <dl class="inspector-summary">
          <dt>Status</dt>
          <dd>${this._escapeHtml(
            this._templateFullSourceStatus
          )}</dd>

          <dt>Mode</dt>
          <dd>Read-only full physical Source</dd>

          <dt>Source</dt>
          <dd>${this._escapeHtml(
            source.path ?? "-"
          )}</dd>

          <dt>Snapshot</dt>
          <dd title="${this._escapeHtml(
            source.sha256 ?? ""
          )}">${this._escapeHtml(
            shortHash(source.sha256)
          )}</dd>

          <dt>Lines</dt>
          <dd>${this._escapeHtml(
            Number.isFinite(source.line_count)
              ? source.line_count
              : "-"
          )}</dd>

          <dt>Blocks</dt>
          <dd>${this._escapeHtml(
            Number.isFinite(source.block_count)
              ? source.block_count
              : "-"
          )}</dd>

          <dt>Templates</dt>
          <dd>${this._escapeHtml(
            Number.isFinite(source.entity_count)
              ? source.entity_count
              : "-"
          )}</dd>
        </dl>

        ${
          this._templateFullSourceError
            ? `<p class="state error">${this._escapeHtml(
                this._templateFullSourceError
              )}</p>`
            : ""
        }
      </section>
    `;
  }

  _renderTemplateInspectorPanel() {
    const block =
      this._templateBlockResult?.block ??
      findTemplateBlock(
        this._templateIndex,
        this._selectedTemplateBlockId
      );

    const entity = findTemplateEntity(
      block,
      this._selectedTemplateEntityId
    );

    const sourcePath =
      this._templateBlockResult?.source?.path ??
      this._templateIndex?.source?.path ??
      "-";

    const range =
      Number.isFinite(block?.start_line) &&
      Number.isFinite(block?.end_line)
        ? `L${block.start_line}-L${block.end_line}`
        : "-";

    return `
      <section class="section first-section">
        <h2>Template Source</h2>

        <dl class="inspector-summary">
          <dt>Status</dt>
          <dd>${this._escapeHtml(
            this._templateBlockStatus
          )}</dd>

          <dt>Mode</dt>
          <dd>Editable top-level block</dd>

          <dt>Save state</dt>
          <dd>${this._escapeHtml(
            this._templateEditorStateLabel()
          )}</dd>

          <dt>Source</dt>
          <dd>${this._escapeHtml(sourcePath)}</dd>

          <dt>Block</dt>
          <dd>${this._escapeHtml(
            block?.label ??
              block?.section ??
              block?.block_id ??
              "-"
          )}</dd>

          <dt>Range</dt>
          <dd>${this._escapeHtml(range)}</dd>

          <dt>Selected entity</dt>
          <dd>${this._escapeHtml(
            entity?.name ?? "-"
          )}</dd>
        </dl>

        ${
          this._templateBlockError
            ? `<p class="state error">${this._escapeHtml(
                this._templateBlockError
              )}</p>`
            : ""
        }
      </section>
    `;
  }

  _renderInspectorPanel() {
    if (this._templateFullSourceStatus !== "Idle") {
      return this._renderTemplateFullSourceInspectorPanel();
    }

    if (this._selectedTemplateBlockId) {
      return this._renderTemplateInspectorPanel();
    }

    if (this._inspectorTab === "details") {
      return `
        ${this._renderConfigurationSection()}
        ${this._renderSyncSection()}
        ${this._renderDeploymentSection()}
      `;
    }

    if (this._inspectorTab === "actions") {
      return `
        ${this._renderCompareSection()}
        ${this._renderResolutionSection()}
      `;
    }

    return this._renderInspectorStatusPanel();
  }

  _renderUnsupportedList(dashboards) {
    if (
      this._dashboardLoading ||
      this._dashboardStatus === "Error" ||
      dashboards.length === 0
    ) {
      return "";
    }

    return `
      <section class="section">
        <h2>Not supported by the v0.1 target</h2>
        <ul class="dashboard-list unsupported">
          ${dashboards
            .map(
              (dashboard) => `
                <li>
                  <div class="unsupported-card">
                    <div class="dashboard-title">${this._escapeHtml(
                      this._dashboardTitle(dashboard)
                    )}</div>
                    <div class="dashboard-meta">
                      <span class="mode">${this._escapeHtml(
                        this._formatMode(dashboard.mode)
                      )}</span>
                    </div>
                  </div>
                </li>
              `
            )
            .join("")}
        </ul>
      </section>
    `;
  }

  _renderExplorerAlerts() {
    if (!this._error) {
      return "";
    }

    return `<p class="state error">Unable to reach the HA YAML Source Editor backend API.</p>`;
  }

  _renderExplorerRegion({
    storageDashboards,
    unsupportedDashboards,
    refreshDisabled,
  }) {
    return `
      <aside class="workspace-region explorer-region" aria-label="Explorer">
        <div class="region-header">
          <div>
            <div class="region-kicker">Explorer</div>
            <h2>Home Assistant</h2>
          </div>
          <button type="button" id="refresh-dashboards" ${refreshDisabled}>
            Refresh
          </button>
        </div>

        <div id="explorer-alerts">${this._renderExplorerAlerts()}</div>

        <div class="explorer-source-tree">
          <details class="explorer-group" open>
            <summary class="explorer-group-summary">
              <span>Dashboards</span>
            </summary>

            <div class="explorer-group-body">
              <div class="explorer-subheading">Storage Mode</div>

              <div id="dashboard-list-body">
                ${this._renderDashboardList(storageDashboards)}
              </div>

              <div id="unsupported-dashboard-list">
                ${this._renderUnsupportedList(unsupportedDashboards)}
              </div>
            </div>
          </details>

          <details class="explorer-group" open>
            <summary class="explorer-group-summary">
              <span>YAML Templates</span>
            </summary>

            <div class="explorer-group-body">
              <div class="template-search">
                <input
                  id="template-search-input"
                  type="search"
                  value="${this._escapeHtml(this._templateSearchQuery)}"
                  placeholder="Search templates..."
                  aria-label="Search YAML Templates by name, unique ID, or section"
                  autocomplete="off"
                  spellcheck="false"
                />
                <span class="template-search-hint">
                  name · unique_id · section
                </span>
              </div>

              <div id="template-tree-body">
                ${this._renderTemplateTree()}
              </div>
            </div>
          </details>
        </div>
      </aside>
    `;
  }

  _renderEditorRegion() {
    const fullTemplateSourceMode =
      this._templateFullSourceStatus !== "Idle";

    const templateMode =
      fullTemplateSourceMode ||
      this._selectedTemplateBlockId !== null;

    return `
      <main class="workspace-region editor-region" aria-label="Editor">
        <div class="region-header">
          <div>
            <div class="region-kicker">Editor</div>
            <h2>${
              fullTemplateSourceMode
                ? "Full Template Source"
                : templateMode
                  ? "Template YAML"
                  : "Source YAML"
            }</h2>
          </div>
        </div>

        ${this._renderEditorContext()}

        ${
          fullTemplateSourceMode
            ? this._renderTemplateFullSourceSection()
            : templateMode
              ? this._renderTemplateBlockSection()
              : `
                  ${this._renderCommandBar()}
                  ${this._renderSourceDocumentSection()}
                `
        }
      </main>
    `;
  }

  _renderInspectorRegion() {
    return `
      <aside
        id="workspace-inspector"
        class="workspace-region inspector-region"
        aria-label="Inspector"
      >
        <div class="region-header">
          <div>
            <div class="region-kicker">Inspector</div>
            <h2>Context</h2>
          </div>
        </div>
        ${this._renderInspectorTabs()}
        <div class="inspector-panel" role="tabpanel">
          ${this._renderInspectorPanel()}
        </div>
      </aside>
    `;
  }

  _render() {
    if (!this.shadowRoot) {
      return;
    }

    const editorViewportSnapshot =
      this._sourceEditor && this._sourceEditorDocumentId
        ? {
            editor: this._sourceEditor,
            documentId: this._sourceEditorDocumentId,
            hadFocus: this._sourceEditor.hasFocus(),
            effect: this._sourceEditor.captureViewportSnapshot(),
          }
        : null;

    const storageDashboards = this._dashboards.filter(
      (dashboard) => dashboard.mode === "storage"
    );
    const unsupportedDashboards = this._dashboards.filter(
      (dashboard) => dashboard.mode !== "storage"
    );
    const refreshDisabled =
      this._dashboardLoading ||
      !this._canUseConnection() ||
      this._isDeploymentInProgress() ||
      this._isResolutionInProgress()
        ? "disabled"
        : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100%;
          box-sizing: border-box;
          padding: 16px;
          color: var(--primary-text-color);
          background: var(--primary-background-color);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        }

        .panel {
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 8px;
          position: relative;
          width: 100%;
          min-height: calc(100vh - 32px);
          box-sizing: border-box;
          container-type: inline-size;
        }

        h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 400;
          line-height: 1.2;
        }

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 400;
          line-height: 1.3;
        }

        h3 {
          margin: 0 0 12px;
          font-size: 15px;
          font-weight: 500;
          line-height: 1.3;
        }

        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          min-width: 0;
          padding: 0 4px;
        }

        .app-title-block {
          display: flex;
          align-items: baseline;
          gap: 16px;
          min-width: 0;
        }

        .app-version {
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 500;
        }

        .editor-context {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
          margin-bottom: 12px;
        }

        .editor-target {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .editor-target-path {
          color: var(--secondary-text-color);
          font-family: var(--code-font-family, monospace);
          font-size: 12px;
        }

        .editor-state-summary {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 500;
        }

        .editor-state-summary span {
          padding: 4px 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
        }

        .command-bar {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 12px;
          min-width: 0;
          padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
        }

        .workflow-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          min-width: 0;
        }

        .command-bar button {
          background: var(--primary-background-color);
        }

        .editor-region .command-bar {
          margin-bottom: 12px;
        }

        .workspace-shell {
          --inspector-width: clamp(260px, 24cqi, 340px);
          --inspector-overlay-width: min(360px, calc(100% - 24px));
          display: grid;
          grid-template-columns: minmax(220px, 260px) minmax(460px, 1fr);
          gap: 12px;
          position: relative;
          min-height: 0;
        }

        .panel.inspector-open .workspace-shell {
          grid-template-columns: minmax(220px, 260px) minmax(460px, 1fr) var(--inspector-width);
        }

        .workspace-region {
          min-width: 0;
          min-height: 0;
          padding: 16px;
          box-sizing: border-box;
          border: 1px solid var(--divider-color);
          border-radius: 8px;
          background: var(--card-background-color);
          overflow: auto;
        }

        .editor-region {
          display: flex;
          flex-direction: column;
          background: var(--primary-background-color);
          border-color: var(--divider-color);
        }

        .inspector-region {
          display: none;
        }

        .panel.inspector-open .inspector-region {
          display: block;
        }

        .inspector-edge-tab {
          position: absolute;
          top: 50%;
          right: 0;
          z-index: 3;
          width: 32px;
          min-width: 32px;
          min-height: 128px;
          padding: 12px 4px;
          border: 1px solid var(--divider-color);
          border-right: 0;
          border-radius: 6px 0 0 6px;
          color: var(--primary-text-color);
          background: var(--card-background-color);
          box-shadow: var(--ha-card-box-shadow, none);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0;
          transform: translateY(-50%);
          transition: right 160ms ease;
        }

        .panel.inspector-open .inspector-edge-tab {
          right: var(--inspector-width);
        }

        .inspector-edge-label {
          writing-mode: vertical-rl;
        }

        .inspector-edge-arrow {
          margin-bottom: 8px;
          font-size: 14px;
          line-height: 1;
        }

        .inspector-edge-tab:hover {
          background: var(--secondary-background-color);
        }

        .inspector-edge-tab:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }

        .region-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
        }

        .region-kicker {
          margin-bottom: 4px;
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0;
        }

        .section {
          margin-top: 20px;
        }

        .section > h2,
        .section > h3 {
          margin-bottom: 12px;
        }

        .first-section,
        .editor-region > .section,
        .inspector-region > .section:first-of-type {
          margin-top: 0;
        }

        .editor-region > .section {
          display: flex;
          flex: 1;
          flex-direction: column;
          min-height: 0;
        }

        dl {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          gap: 10px 16px;
          margin: 0;
          padding: 14px;
          border-radius: 8px;
          background: var(--primary-background-color);
          border: 1px solid var(--divider-color);
        }

        dt {
          color: var(--secondary-text-color);
        }

        dd {
          margin: 0;
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 12px;
        }

        .section-header h2,
        .section-header h3 {
          margin: 0;
        }

        button {
          min-height: 36px;
          padding: 0 16px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          color: var(--primary-text-color);
          background: var(--card-background-color);
          font: inherit;
          cursor: pointer;
        }

        button:hover:not(:disabled) {
          background: var(--secondary-background-color);
        }

        button:disabled {
          color: var(--disabled-text-color);
          cursor: default;
        }

        .explorer-source-tree {
          display: grid;
          gap: 2px;
          margin-top: 8px;
        }

        .explorer-group {
          margin: 0;
          border-bottom: 1px solid var(--divider-color);
        }

        .explorer-group-summary {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 30px;
          padding: 4px 6px;
          list-style: none;
          cursor: pointer;
          user-select: none;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .explorer-group-summary::-webkit-details-marker,
        .explorer-tree-summary::-webkit-details-marker {
          display: none;
        }

        .explorer-group-summary::before,
        .explorer-tree-summary::before {
          content: "▸";
          display: inline-block;
          flex: 0 0 12px;
          width: 12px;
          font-size: 11px;
          text-align: center;
        }

        .explorer-group[open] > .explorer-group-summary::before,
        .explorer-tree-details[open] > .explorer-tree-summary::before {
          content: "▾";
        }

        .explorer-group-body {
          padding: 2px 0 8px;
        }

        .explorer-subheading {
          padding: 4px 8px 4px 24px;
          color: var(--secondary-text-color);
          font-size: 11px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .template-search {
          display: grid;
          gap: 4px;
          padding: 4px 8px 8px 24px;
        }

        .template-search input {
          width: 100%;
          min-width: 0;
          height: 30px;
          box-sizing: border-box;
          padding: 4px 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          color: var(--primary-text-color);
          background: var(--primary-background-color);
          font: inherit;
          font-size: 12px;
        }

        .template-search input:focus {
          border-color: var(--primary-color);
          outline: none;
        }

        .template-search-hint {
          overflow: hidden;
          color: var(--secondary-text-color);
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .explorer-tree {
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .explorer-tree-children {
          padding-left: 16px;
        }

        .explorer-tree-item,
        .template-file-node,
        .template-block-node,
        .template-entity-node {
          min-width: 0;
        }

        .explorer-tree-details {
          min-width: 0;
        }

        .explorer-tree-row {
          display: flex;
          align-items: center;
          gap: 5px;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          min-height: 28px;
          padding: 3px 6px;
          border-radius: 4px;
          color: var(--primary-text-color);
        }

        .explorer-tree-summary {
          list-style: none;
          cursor: pointer;
          user-select: none;
        }

        .explorer-tree-summary::before {
          margin-right: -3px;
        }

        .explorer-tree-leaf {
          padding-left: 21px;
        }

        .explorer-tree-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 16px;
          width: 16px;
          font-size: 11px;
          line-height: 1;
        }

        .file-icon {
          font-weight: 700;
        }

        .explorer-tree-content {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          flex-direction: column;
          gap: 1px;
        }

        .explorer-tree-label {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
        }

        .explorer-tree-meta {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--secondary-text-color);
          font-size: 11px;
        }

        .explorer-tree-badge {
          flex: 0 0 auto;
          padding: 1px 4px;
          border: 1px solid var(--divider-color);
          border-radius: 3px;
          color: var(--secondary-text-color);
          font-size: 9px;
          line-height: 1.4;
        }

        .explorer-tree-row:hover {
          background: var(--secondary-background-color);
        }

        .template-source-summary .explorer-tree-content,
        .template-block-open,
        .template-block-summary .explorer-tree-content,
        .template-entity-row {
          cursor: pointer;
        }

        .explorer-tree-row.selected {
          background: var(--secondary-background-color);
          box-shadow: inset 3px 0 0 var(--primary-color);
        }
        .dashboard-list {
          display: grid;
          gap: 8px;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .dashboard-list li {
          padding: 0;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          overflow: hidden;
        }

        .dashboard-card {
          display: block;
          width: 100%;
          min-height: 0;
          padding: 12px;
          border: 0;
          border-radius: 0;
          color: var(--primary-text-color);
          background: transparent;
          text-align: left;
        }

        .dashboard-card:hover {
          background: var(--secondary-background-color);
        }

        .dashboard-card.selected {
          box-shadow: inset 4px 0 0 var(--primary-color);
          background: var(--secondary-background-color);
        }

        .unsupported-card {
          padding: 12px;
        }

        .dashboard-title {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 16px;
          font-weight: 500;
          overflow-wrap: anywhere;
        }

        .dashboard-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 12px;
          color: var(--secondary-text-color);
          font-size: 14px;
          overflow-wrap: anywhere;
        }

        .mode {
          letter-spacing: 0;
        }

        .dashboard-list {
          gap: 1px;
        }

        .dashboard-list li {
          border: 0;
          border-radius: 4px;
          background: transparent;
        }

        .dashboard-card {
          display: flex;
          align-items: center;
          gap: 5px;
          min-height: 28px;
          padding: 3px 6px 3px 21px;
          border-radius: 4px;
        }

        .dashboard-card.selected {
          box-shadow: inset 3px 0 0 var(--primary-color);
        }

        .dashboard-title {
          margin-bottom: 0;
          font-size: 13px;
          font-weight: 500;
        }

        .dashboard-meta {
          display: block;
          font-size: 11px;
        }
        .state {
          margin: 0;
          padding: 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          color: var(--secondary-text-color);
          background: var(--primary-background-color);
        }

        .error {
          color: var(--error-color);
        }

        .config-status {
          margin-bottom: 16px;
        }

        .source-status {
          margin-bottom: 16px;
        }

        .validation-status {
          margin-bottom: 16px;
        }

        .deployment-status {
          margin-bottom: 16px;
        }

        .compare-status {
          margin-bottom: 16px;
        }

        .resolution-status {
          margin-bottom: 16px;
        }

        .sync-status {
          margin: 16px 0;
        }

        .inspector-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 4px;
          margin-bottom: 16px;
          padding: 4px;
          border-radius: 6px;
          background: var(--primary-background-color);
          border: 1px solid var(--divider-color);
        }

        .inspector-tab {
          min-width: 0;
          min-height: 32px;
          padding: 0 8px;
          border: 0;
          background: transparent;
          font-size: 13px;
        }

        .inspector-tab.selected {
          background: var(--card-background-color);
          box-shadow: inset 0 -2px 0 var(--primary-color);
        }

        .inspector-panel {
          display: grid;
          gap: 16px;
        }

        .inspector-summary {
          margin-bottom: 12px;
        }

        .config-viewer {
          display: grid;
          gap: 12px;
        }

        .editor-region .source-editor {
          flex: 1;
          min-height: 0;
        }

        .editor-region .source-editor,
        .editor-region .source-code-editor-shell {
          display: flex;
          flex-direction: column;
        }

        .editor-region .source-code-editor-shell {
          flex: 1;
          min-height: 460px;
        }

        .editor-region #source-code-editor-host {
          flex: 1;
          min-height: 0;
        }

        .editor-region .cm-editor {
          height: 100%;
          min-height: 460px;
        }

        .editor-region .cm-scroller {
          height: 100%;
          max-height: none;
          min-height: 0;
          resize: none;
        }

        .source-editor,
        .source-actions,
        .resolution-actions {
          display: grid;
          gap: 12px;
        }

        .source-actions,
        .resolution-actions {
          grid-template-columns: repeat(auto-fit, minmax(140px, max-content));
        }

        .diff-group {
          display: grid;
          gap: 12px;
          margin-top: 16px;
        }

        .diff-group h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
        }

        .diff-subtitle {
          margin: 0;
          color: var(--secondary-text-color);
        }

        .diff-list {
          display: grid;
          gap: 12px;
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .diff-entry {
          display: grid;
          gap: 10px;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
        }

        .diff-kind {
          width: max-content;
          padding: 4px 8px;
          border-radius: 4px;
          color: var(--text-primary-color);
          background: var(--primary-color);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0;
        }

        .diff-path {
          font-family: var(--code-font-family, monospace);
          overflow-wrap: anywhere;
        }

        .diff-value {
          display: grid;
          gap: 6px;
        }

        .diff-value-label {
          color: var(--secondary-text-color);
          font-size: 13px;
        }

        label {
          color: var(--primary-text-color);
          font-size: 16px;
          font-weight: 500;
        }

        .source-code-editor-shell {
          width: 100%;
          box-sizing: border-box;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          overflow: hidden;
          background: var(--code-editor-background-color, var(--card-background-color));
        }

        #source-code-editor-host {
          min-height: 360px;
        }

        .source-editor-status {
          padding: 8px 12px;
          border-top: 1px solid var(--divider-color);
          color: var(--secondary-text-color);
          background: var(--secondary-background-color);
          font-family: var(--code-font-family, monospace);
          font-size: 12px;
          white-space: pre-wrap;
        }

        pre {
          margin: 0;
          padding: 12px;
          max-height: 360px;
          overflow: auto;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          color: var(--primary-text-color);
          background: var(--primary-background-color);
          font-family: var(--code-font-family, monospace);
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        @container (max-width: 1100px) {
          .workspace-shell {
            grid-template-columns: minmax(220px, 280px) minmax(420px, 1fr);
          }

          .panel.inspector-open .workspace-shell {
            grid-template-columns: minmax(220px, 280px) minmax(420px, 1fr);
          }

          .inspector-region {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            z-index: 2;
            width: var(--inspector-overlay-width);
            box-shadow: var(--ha-card-box-shadow, none);
          }

          .panel.inspector-open .inspector-region {
            display: block;
          }

          .panel.inspector-open .inspector-edge-tab {
            right: var(--inspector-overlay-width);
          }
        }

        @container (max-width: 760px) {
          .panel {
            min-height: auto;
          }

          .workspace-shell {
            display: grid;
            grid-template-columns: 1fr;
          }

          .panel.inspector-open .workspace-shell {
            grid-template-columns: 1fr;
          }

          .editor-region {
            order: 1;
          }

          .explorer-region {
            order: 2;
          }

          .inspector-region {
            order: 3;
          }

          .workspace-region {
            overflow: visible;
          }

          .editor-region .source-code-editor-shell,
          .editor-region .cm-editor {
            min-height: 360px;
          }

          .editor-region .cm-scroller {
            max-height: 70vh;
            resize: vertical;
          }

          dl {
            grid-template-columns: 1fr;
            gap: 4px;
          }

          dd {
            margin-bottom: 12px;
          }

          dd:last-child {
            margin-bottom: 0;
          }

          .section-header {
            align-items: flex-start;
            flex-direction: column;
          }
        }

        @media (max-width: 1100px) {
          .workspace-shell {
            grid-template-columns: minmax(220px, 280px) minmax(420px, 1fr);
          }

          .panel.inspector-open .workspace-shell {
            grid-template-columns: minmax(220px, 280px) minmax(420px, 1fr);
          }

          .inspector-region {
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            z-index: 2;
            width: var(--inspector-overlay-width);
            box-shadow: var(--ha-card-box-shadow, none);
          }

          .panel.inspector-open .inspector-region {
            display: block;
          }

          .panel.inspector-open .inspector-edge-tab {
            right: var(--inspector-overlay-width);
          }
        }

        @media (max-width: 760px) {
          :host {
            padding: 16px;
          }

          .panel {
            min-height: auto;
          }

          .workspace-shell {
            display: grid;
            grid-template-columns: 1fr;
          }

          .panel.inspector-open .workspace-shell {
            grid-template-columns: 1fr;
          }

          .app-header,
          .app-title-block,
          .editor-context,
          .command-bar {
            align-items: flex-start;
            flex-direction: column;
          }

          .editor-state-summary,
          .workflow-actions {
            justify-content: flex-start;
            margin-left: 0;
          }

          .editor-region {
            order: 1;
          }

          .explorer-region {
            order: 2;
          }

          .inspector-region {
            order: 3;
          }

          .workspace-region {
            overflow: visible;
          }

          .editor-region .source-code-editor-shell,
          .editor-region .cm-editor {
            min-height: 360px;
          }

          .editor-region .cm-scroller {
            max-height: 70vh;
            resize: vertical;
          }

          dl {
            grid-template-columns: 1fr;
            gap: 4px;
          }

          dd {
            margin-bottom: 12px;
          }

          dd:last-child {
            margin-bottom: 0;
          }

          .section-header {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      </style>
      <section class="panel${this._inspectorOpen ? " inspector-open" : ""}">
        ${this._renderApplicationHeader()}
        <div class="workspace-shell">
          ${this._renderExplorerRegion({
            storageDashboards,
            unsupportedDashboards,
            refreshDisabled,
          })}
          ${this._renderEditorRegion()}
          ${this._renderInspectorRegion()}
          ${this._renderInspectorEdgeTab()}
        </div>
      </section>
    `;
    this._hasRendered = true;

    this._wireEventHandlers(storageDashboards);

    this._attachSourceEditor();
    if (
      shouldRestoreEditorViewportSnapshot(editorViewportSnapshot, {
        editor: this._sourceEditor,
        documentId: this._sourceEditorDocumentId,
      })
    ) {
      this._sourceEditor.restoreViewportSnapshot(
        editorViewportSnapshot.effect
      );
    }
    if (
      shouldRestoreEditorFocusSnapshot(editorViewportSnapshot, {
        editor: this._sourceEditor,
        documentId: this._sourceEditorDocumentId,
      })
    ) {
      this._sourceEditor.focus();
    }
    this._refreshSourceEditorStatusBar();

    const configBlock = this.shadowRoot.getElementById("dashboard-config-json");
    if (configBlock && this._configStatus === "Loaded") {
      configBlock.textContent = JSON.stringify(this._config, null, 2);
    }

    this._syncInspectorResizeObserver();
  }

  _wireEventHandlers(storageDashboards) {
    const refreshButton = this.shadowRoot.getElementById("refresh-dashboards");
    if (refreshButton) {
      refreshButton.onclick = () => this._refreshDashboards();
    }

    const toggleInspector = this.shadowRoot.getElementById("toggle-inspector");
    if (toggleInspector) {
      toggleInspector.onclick = () => this._toggleInspector();
    }

    for (const tab of this.shadowRoot.querySelectorAll(".inspector-tab")) {
      tab.onclick = () => {
        this._setInspectorTab(tab.dataset.inspectorTab);
      };
    }

    this._wireDashboardCardHandlers(storageDashboards);
    this._wireTemplateTreeHandlers();

    const templateSearch = this.shadowRoot.getElementById(
      "template-search-input"
    );

    if (templateSearch) {
      templateSearch.oninput = () => {
        this._templateSearchQuery = templateSearch.value;
        this._refreshTemplateTreeUi();
      };
    }

    const createSource = this.shadowRoot.getElementById("create-source-document");
    if (createSource) {
      createSource.onclick = () => this._createSourceDocument();
    }

    const initializeSource = this.shadowRoot.getElementById(
      "initialize-source-from-ha"
    );
    if (initializeSource) {
      initializeSource.onclick = () => this._initializeSourceFromHa();
    }

    const saveSource = this.shadowRoot.getElementById("save-source-document");
    if (saveSource) {
      saveSource.onclick = () => this._saveSourceDocument();
    }

    const saveTemplate = this.shadowRoot.getElementById(
      "save-template-block"
    );
    if (saveTemplate) {
      saveTemplate.onclick = () => this._saveTemplateBlock();
    }

    const validateSource = this.shadowRoot.getElementById(
      "validate-source-document"
    );
    if (validateSource) {
      validateSource.onclick = () => this._validateSourceDocument();
    }

    const deploySource = this.shadowRoot.getElementById("deploy-saved-source");
    if (deploySource) {
      deploySource.onclick = () => this._deploySavedSource();
    }

    const refreshSync = this.shadowRoot.getElementById("refresh-sync-status");
    if (refreshSync) {
      refreshSync.onclick = () => this._refreshSyncStatus({ reloadHa: true });
    }

    const compareSource = this.shadowRoot.getElementById("compare-source-ha");
    if (compareSource) {
      compareSource.onclick = () => this._compareSourceToHa();
    }

    const importHa = this.shadowRoot.getElementById("import-ha-version");
    if (importHa) {
      importHa.onclick = () => this._importHaVersion();
    }

    const overwriteHa = this.shadowRoot.getElementById("overwrite-ha-source");
    if (overwriteHa) {
      overwriteHa.onclick = () => this._overwriteHaWithSavedSource();
    }
  }

  _wireTemplateTreeHandlers() {
    for (
      const summary of this.shadowRoot.querySelectorAll(
        ".template-source-summary"
      )
    ) {
      summary.onclick = (event) => {
        if (!event.target.closest(".explorer-tree-content")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        this._openTemplateFullSource();
      };
    }

    for (
      const details of this.shadowRoot.querySelectorAll(
        ".explorer-tree-details[data-template-block-id]"
      )
    ) {
      details.ontoggle = () => {
        const blockId = details.dataset.templateBlockId;

        if (!blockId) {
          return;
        }

        // Search results are expanded temporarily for visibility.
        // Do not let those synthetic open states overwrite the user's
        // normal Explorer expansion preferences.
        if (this._templateSearchQuery.trim()) {
          return;
        }

        if (details.open) {
          this._openTemplateBlockIds.add(blockId);
        } else {
          this._openTemplateBlockIds.delete(blockId);
        }
      };
    }

    for (
      const row of this.shadowRoot.querySelectorAll(
        ".template-block-open"
      )
    ) {
      row.onclick = () => {
        const blockId = row.dataset.templateBlockId;

        if (blockId) {
          this._selectTemplateBlock(blockId);
        }
      };
    }

    for (
      const summary of this.shadowRoot.querySelectorAll(
        ".template-block-summary"
      )
    ) {
      summary.onclick = (event) => {
        if (!event.target.closest(".explorer-tree-content")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const blockId = summary.dataset.templateBlockId;

        if (blockId) {
          this._selectTemplateBlock(blockId);
        }
      };
    }

    for (
      const row of this.shadowRoot.querySelectorAll(
        ".template-entity-row"
      )
    ) {
      row.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const blockId = row.dataset.templateBlockId;
        const entityId = row.dataset.templateEntityId;

        if (blockId) {
          this._selectTemplateBlock(
            blockId,
            entityId || null
          );
        }
      };
    }
  }

  _wireDashboardCardHandlers(storageDashboards) {
    for (const button of this.shadowRoot.querySelectorAll(".dashboard-card")) {
      button.onclick = () => {
        const dashboard = storageDashboards.find(
          (item) => this._dashboardKey(item) === button.dataset.dashboardKey
        );

        if (dashboard) {
          this._selectDashboard(dashboard);
        }
      };
    }
  }
}

class DeploymentBlockedError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class CompareBlockedError extends Error {}

class ResolutionBlockedError extends Error {}

class StaleComparisonError extends ResolutionBlockedError {}

export function panelWebComponentNameFromModuleUrl(moduleUrl) {
  const assetIdentity = new URL(moduleUrl).searchParams.get("v");
  if (!assetIdentity) {
    throw new Error("Missing HA YAML Source Editor frontend asset identity.");
  }

  const suffix = assetIdentity.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `ha-yaml-source-editor-panel-${suffix}`;
}

customElements.define(
  panelWebComponentNameFromModuleUrl(import.meta.url),
  HaYamlSourceEditorPanel
);

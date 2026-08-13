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
    this._sourceRequestId = 0;
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
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._loadStatus();
    this._loadDashboards();
  }

  connectedCallback() {
    this._render();
    this._loadStatus();
    this._loadDashboards();
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

    this._render();
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
    this._render();

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
      this._render();
    }
  }

  _refreshDashboards() {
    if (this._isDeploymentInProgress()) {
      this._deploymentMessage = "Deployment is in progress.";
      this._render();
      return;
    }

    if (!this._confirmDiscardUnsavedChanges()) {
      return;
    }

    this._clearSelectedDashboard();
    this._loadDashboards({ force: true });
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
    this._lastSavedSourceText = "";
    this._sourceError = null;
    this._sourceRequestId += 1;
    this._clearValidation();
    this._clearSyncState();
    this._deploymentStatus = DEPLOYMENT_OPERATION.IDLE;
    this._deploymentMessage = null;
    this._deploymentRequestId += 1;
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

  _confirmDiscardUnsavedChanges() {
    if (!this._hasUnsavedSourceChanges()) {
      return true;
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

  _selectDashboard(dashboard) {
    if (this._isDeploymentInProgress()) {
      this._deploymentMessage = "Deployment is in progress.";
      this._render();
      return;
    }

    if (!this._confirmDiscardUnsavedChanges()) {
      return;
    }

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
    this._lastSavedSourceText = "";
    this._sourceError = null;
    this._clearValidation();
    this._clearSyncState();
    this._deploymentStatus = DEPLOYMENT_OPERATION.IDLE;
    this._deploymentMessage = null;
    this._deploymentRequestId += 1;
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
      this._sourceStatus = "Loaded";
      this._sourceError = null;
      this._clearValidation();
      this._scheduleSyncRefresh();
    } catch (err) {
      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceDocument = null;
      this._sourceStatus = "Error";
      this._sourceError = err?.message || "Unable to load Source Document.";
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
      this._sourceStatus = result.already_exists ? "Loaded" : "Not saved";
      this._sourceError = null;
      this._clearValidation();
      this._scheduleSyncRefresh();
    } catch (err) {
      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceStatus = "Error";
      this._sourceError = err?.message || "Unable to create Source Document.";
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
      this._sourceStatus = "Saved";
      this._sourceError = null;
      this._scheduleSyncRefresh();
    } catch (err) {
      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceStatus = "Error";
      this._sourceError = err?.message || "Unable to save Source Document.";
    }

    this._render();
  }

  async _deploySavedSource() {
    if (
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._isDeploymentInProgress()
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

      const deploymentSourceSemanticHash = await this._hashText(
        canonicalJson(sourceAnalysis.parsedConfig)
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

      await this._hass.callWS({
        type: "lovelace/config/save",
        url_path: this._dashboardTargetUrlPath(this._selectedDashboard),
        config: sourceAnalysis.parsedConfig,
      });
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
      this._config = verifiedHaConfig;
      this._configStatus = "Loaded";
      this._deploymentStatus = DEPLOYMENT_OPERATION.SUCCESS;
      this._deploymentMessage = "Deployment verified and baseline recorded.";
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

  _isDeploymentInProgress() {
    return [
      DEPLOYMENT_OPERATION.PREFLIGHT,
      DEPLOYMENT_OPERATION.AWAITING_CONFIRMATION,
      DEPLOYMENT_OPERATION.DEPLOYING,
      DEPLOYMENT_OPERATION.VERIFYING,
      DEPLOYMENT_OPERATION.RECORDING_BASELINE,
    ].includes(this._deploymentStatus);
  }

  _confirmDeployment(firstDeployment) {
    const dashboardPath = this._dashboardPath(this._selectedDashboard);
    const message = firstDeployment
      ? `Deploy saved Source YAML to ${dashboardPath}? This is the first deployment baseline for this Source Document.`
      : `Deploy saved Source YAML to ${dashboardPath}?`;

    return window.confirm(message);
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
      this._render();
      return;
    }

    const requestId = this._syncRequestId + 1;
    this._syncRequestId = requestId;
    this._syncStatus = "Calculating";
    this._syncError = null;
    this._render();

    try {
      let currentHaConfig = this._configStatus === "Loaded" ? this._config : null;
      if (reloadHa || currentHaConfig == null) {
        currentHaConfig = await this._readDashboardConfig(this._selectedDashboard);
        if (requestId !== this._syncRequestId) {
          return;
        }
        this._config = currentHaConfig;
        this._configStatus = "Loaded";
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
    } catch (err) {
      if (requestId !== this._syncRequestId) {
        return;
      }

      this._syncStatus = "SYNC ERROR";
      this._sourceVsHa = "UNAVAILABLE";
      this._syncError = err?.message || "Unable to calculate synchronization status.";
    }

    this._render();
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
      <ul class="dashboard-list">
        ${dashboards
          .map((dashboard) => {
            const dashboardKey = this._dashboardKey(dashboard);
            const selectedClass =
              dashboardKey === this._selectedDashboardKey ? " selected" : "";

            return `
              <li>
                <button
                  type="button"
                  class="dashboard-card${selectedClass}"
                  data-dashboard-key="${this._escapeHtml(dashboardKey)}"
                >
                  <div class="dashboard-title">${this._escapeHtml(
                    this._dashboardTitle(dashboard)
                  )}</div>
                  <div class="dashboard-meta">
                    <span>${this._escapeHtml(this._dashboardPath(dashboard))}</span>
                    <span class="mode">${this._escapeHtml(
                      this._formatMode(dashboard.mode)
                    )}</span>
                  </div>
                </button>
              </li>
            `;
          })
          .join("")}
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
        ${this._renderSourceDocumentBody()}
      </section>
    `;
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
      return `
        <div class="source-actions">
          <p class="state">No source document exists for this dashboard.</p>
          <button type="button" id="create-source-document">
            Create Source Document
          </button>
        </div>
      `;
    }

    const saveDisabled =
      this._sourceStatus === "Saving" || !this._hasUnsavedSourceChanges()
        ? "disabled"
        : "";
    const validateDisabled =
      this._validationStatus === "Validating" ? "disabled" : "";
    const deployDisabled =
      !this._sourceDocument ||
      !this._selectedDashboard ||
      this._hasUnsavedSourceChanges() ||
      this._isDeploymentInProgress() ||
      this._sourceText.length === 0
        ? "disabled"
        : "";

    return `
      <div class="source-editor">
        <label for="source-yaml">Source YAML</label>
        <p class="state">
          This Source YAML is stored as the editor text, using LF newlines in
          v0.1. Saving it does not modify Home Assistant's Lovelace
          configuration. Validate checks the current editor text and does not
          save or deploy it.
        </p>
        <textarea id="source-yaml" spellcheck="false"></textarea>
        <div class="source-actions">
          <button type="button" id="save-source-document" ${saveDisabled}>
            Save Source
          </button>
          <button type="button" id="validate-source-document" ${validateDisabled}>
            Validate
          </button>
          <button type="button" id="deploy-saved-source" ${deployDisabled}>
            Deploy Saved Source
          </button>
        </div>
      </div>
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
      this._syncStatus === "Calculating"
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
          <dt>Deployment status</dt>
          <dd class="${statusClass.trim()}">${this._escapeHtml(this._syncStatus)}</dd>
          <dt>Source vs HA</dt>
          <dd>${this._escapeHtml(this._sourceVsHa)}</dd>
          <dt>Source text</dt>
          <dd title="${this._escapeHtml(this._sourceTextHash ?? "")}">${this._escapeHtml(
            shortHash(this._sourceTextHash)
          )}</dd>
          <dt>Source semantics</dt>
          <dd title="${this._escapeHtml(this._sourceSemanticHash ?? "")}">${this._escapeHtml(
            shortHash(this._sourceSemanticHash)
          )}</dd>
          <dt>Current HA</dt>
          <dd title="${this._escapeHtml(this._haSemanticHash ?? "")}">${this._escapeHtml(
            shortHash(this._haSemanticHash)
          )}</dd>
        </dl>
        ${this._renderSyncMessage()}
      </section>
    `;
  }

  _renderDeploymentSection() {
    const statusClass =
      this._deploymentStatus === DEPLOYMENT_OPERATION.ERROR ||
      this._deploymentStatus === DEPLOYMENT_OPERATION.CONFLICT
        ? " error"
        : "";
    const baseline = this._sourceDocument?.deployment_baseline ?? null;

    return `
      <section class="section">
        <h2>Deployment</h2>
        <dl class="deployment-status">
          <dt>Status</dt>
          <dd class="${statusClass.trim()}">${this._escapeHtml(
            this._deploymentStatus
          )}</dd>
          <dt>Last deployed</dt>
          <dd>${this._escapeHtml(baseline?.deployed_at ?? "-")}</dd>
          <dt>HA baseline</dt>
          <dd title="${this._escapeHtml(
            baseline?.ha_semantic_hash ?? ""
          )}">${this._escapeHtml(shortHash(baseline?.ha_semantic_hash))}</dd>
          <dt>HA version</dt>
          <dd>${this._escapeHtml(
            baseline?.home_assistant_version ?? "-"
          )}</dd>
        </dl>
        ${this._renderDeploymentMessage()}
      </section>
    `;
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

  _render() {
    if (!this.shadowRoot) {
      return;
    }

    const integrationVersion = this._status?.integration_version ?? "Unknown";
    const homeAssistantVersion =
      this._status?.home_assistant_version ?? "Unknown";
    const backendState = this._error ? "Error" : this._status ? "Connected" : "Connecting";
    const storageDashboards = this._dashboards.filter(
      (dashboard) => dashboard.mode === "storage"
    );
    const unsupportedDashboards = this._dashboards.filter(
      (dashboard) => dashboard.mode !== "storage"
    );
    const refreshDisabled =
      this._dashboardLoading ||
      !this._canUseConnection() ||
      this._isDeploymentInProgress()
        ? "disabled"
        : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100%;
          box-sizing: border-box;
          padding: 24px;
          color: var(--primary-text-color);
          background: var(--primary-background-color);
          font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        }

        .panel {
          max-width: 720px;
          margin: 0 auto;
        }

        h1 {
          margin: 0 0 24px;
          font-size: 28px;
          font-weight: 400;
          line-height: 1.2;
        }

        h2 {
          margin: 0 0 16px;
          font-size: 20px;
          font-weight: 400;
          line-height: 1.3;
        }

        .section {
          margin-top: 24px;
        }

        dl {
          display: grid;
          grid-template-columns: max-content minmax(0, 1fr);
          gap: 12px 20px;
          margin: 0;
          padding: 20px;
          border-radius: 8px;
          background: var(--card-background-color);
          box-shadow: var(--ha-card-box-shadow, none);
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
          margin-bottom: 16px;
        }

        .section-header h2 {
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

        .dashboard-list {
          display: grid;
          gap: 12px;
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
          padding: 16px;
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
          padding: 16px;
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

        .state {
          margin: 0;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          color: var(--secondary-text-color);
          background: var(--card-background-color);
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

        .sync-status {
          margin: 16px 0;
        }

        .config-viewer {
          display: grid;
          gap: 12px;
        }

        .source-editor,
        .source-actions {
          display: grid;
          gap: 12px;
        }

        .source-actions {
          grid-template-columns: repeat(auto-fit, minmax(140px, max-content));
        }

        label {
          color: var(--primary-text-color);
          font-size: 16px;
          font-weight: 500;
        }

        textarea {
          width: 100%;
          min-height: 320px;
          box-sizing: border-box;
          resize: vertical;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          color: var(--primary-text-color);
          background: var(--card-background-color);
          font-family: var(--code-font-family, monospace);
          font-size: 13px;
          line-height: 1.5;
        }

        textarea:focus {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }

        pre {
          margin: 0;
          padding: 16px;
          max-height: 520px;
          overflow: auto;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          color: var(--primary-text-color);
          background: var(--card-background-color);
          font-family: var(--code-font-family, monospace);
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        @media (max-width: 600px) {
          :host {
            padding: 16px;
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
      <section class="panel">
        <h1>HA YAML Source Editor</h1>
        <dl>
          <dt>Integration</dt>
          <dd>Loaded</dd>
          <dt>Backend API</dt>
          <dd>${backendState}</dd>
          <dt>Dashboard API</dt>
          <dd>${this._dashboardStatus}</dd>
          <dt>Home Assistant</dt>
          <dd>${homeAssistantVersion}</dd>
          <dt>Integration version</dt>
          <dd>${integrationVersion}</dd>
        </dl>
        <section class="section">
          <div class="section-header">
            <h2>Storage Mode dashboards</h2>
            <button type="button" id="refresh-dashboards" ${refreshDisabled}>
              Refresh
            </button>
          </div>
          ${this._renderDashboardList(storageDashboards)}
        </section>
        ${this._renderUnsupportedList(unsupportedDashboards)}
        ${this._renderConfigurationSection()}
        ${this._renderSourceDocumentSection()}
        ${this._renderValidationSection()}
        ${this._renderDeploymentSection()}
        ${this._renderSyncSection()}
      </section>
    `;

    this.shadowRoot
      .getElementById("refresh-dashboards")
      ?.addEventListener("click", () => this._refreshDashboards());

    for (const button of this.shadowRoot.querySelectorAll(".dashboard-card")) {
      button.addEventListener("click", () => {
        const dashboard = storageDashboards.find(
          (item) => this._dashboardKey(item) === button.dataset.dashboardKey
        );

        if (dashboard) {
          this._selectDashboard(dashboard);
        }
      });
    }

    this.shadowRoot
      .getElementById("create-source-document")
      ?.addEventListener("click", () => this._createSourceDocument());

    this.shadowRoot
      .getElementById("save-source-document")
      ?.addEventListener("click", () => this._saveSourceDocument());

    this.shadowRoot
      .getElementById("validate-source-document")
      ?.addEventListener("click", () => this._validateSourceDocument());

    this.shadowRoot
      .getElementById("deploy-saved-source")
      ?.addEventListener("click", () => this._deploySavedSource());

    this.shadowRoot
      .getElementById("refresh-sync-status")
      ?.addEventListener("click", () => this._refreshSyncStatus({ reloadHa: true }));

    const sourceTextarea = this.shadowRoot.getElementById("source-yaml");
    if (sourceTextarea) {
      sourceTextarea.value = this._sourceText;
      sourceTextarea.addEventListener("input", (event) => {
        this._sourceText = event.target.value;
        this._clearValidation();
        this._scheduleSyncRefresh();
        const statusValue = this.shadowRoot.getElementById("source-status-value");
        const validationStatus = this.shadowRoot.getElementById(
          "validation-status-value"
        );
        const validationBody = this.shadowRoot.getElementById("validation-body");
        const saveButton = this.shadowRoot.getElementById("save-source-document");
        const deployButton = this.shadowRoot.getElementById("deploy-saved-source");

        if (statusValue) {
          statusValue.textContent = this._hasUnsavedSourceChanges()
            ? "Unsaved changes"
            : this._sourceStatus;
        }

        if (validationStatus) {
          validationStatus.textContent = this._validationStatus;
          validationStatus.className = "";
        }

        if (validationBody) {
          validationBody.innerHTML = this._renderValidationBody();
        }

        if (saveButton) {
          saveButton.disabled = !this._hasUnsavedSourceChanges();
        }

        if (deployButton) {
          deployButton.disabled =
            this._hasUnsavedSourceChanges() ||
            this._sourceText.length === 0 ||
            this._isDeploymentInProgress();
        }
      });
    }

    const configBlock = this.shadowRoot.getElementById("dashboard-config-json");
    if (configBlock && this._configStatus === "Loaded") {
      configBlock.textContent = JSON.stringify(this._config, null, 2);
    }
  }
}

class DeploymentBlockedError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

customElements.define("ha-yaml-source-editor-panel", HaYamlSourceEditorPanel);

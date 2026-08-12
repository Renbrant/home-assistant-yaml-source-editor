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

  _selectDashboard(dashboard) {
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
    } catch (err) {
      if (requestId !== this._sourceRequestId) {
        return;
      }

      this._sourceStatus = "Error";
      this._sourceError = err?.message || "Unable to save Source Document.";
    }

    this._render();
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
      this._sourceStatus === "Saving" ||
      this._sourceStatus === "Saved"
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

    return `
      <div class="source-editor">
        <label for="source-yaml">Source YAML</label>
        <p class="state">
          This Source YAML is stored as the editor text, using LF newlines in
          v0.1. Saving it does not modify Home Assistant's Lovelace
          configuration.
        </p>
        <textarea id="source-yaml" spellcheck="false"></textarea>
        <div class="source-actions">
          <button type="button" id="save-source-document" ${saveDisabled}>
            Save Source
          </button>
        </div>
      </div>
    `;
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
      this._dashboardLoading || !this._canUseConnection() ? "disabled" : "";

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

        .config-viewer {
          display: grid;
          gap: 12px;
        }

        .source-editor,
        .source-actions {
          display: grid;
          gap: 12px;
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

    const sourceTextarea = this.shadowRoot.getElementById("source-yaml");
    if (sourceTextarea) {
      sourceTextarea.value = this._sourceText;
      sourceTextarea.addEventListener("input", (event) => {
        this._sourceText = event.target.value;
        const statusValue = this.shadowRoot.getElementById("source-status-value");
        const saveButton = this.shadowRoot.getElementById("save-source-document");

        if (statusValue) {
          statusValue.textContent = this._hasUnsavedSourceChanges()
            ? "Unsaved changes"
            : this._sourceStatus;
        }

        if (saveButton) {
          saveButton.disabled = !this._hasUnsavedSourceChanges();
        }
      });
    }

    const configBlock = this.shadowRoot.getElementById("dashboard-config-json");
    if (configBlock && this._configStatus === "Loaded") {
      configBlock.textContent = JSON.stringify(this._config, null, 2);
    }
  }
}

customElements.define("ha-yaml-source-editor-panel", HaYamlSourceEditorPanel);

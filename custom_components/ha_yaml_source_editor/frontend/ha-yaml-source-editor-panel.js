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

      const panels = await this._hass.connection.sendMessagePromise({
        type: "get_panels",
      });

      this._dashboards = this._withDefaultDashboard(
        Array.isArray(dashboards) ? dashboards : [],
        panels
      );
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
    this._loadDashboards({ force: true });
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

  _canonicalPath(path) {
    return String(path ?? "").replace(/^\/+|\/+$/g, "");
  }

  _isDefaultLovelaceDashboard(dashboard) {
    const dashboardPath = this._canonicalPath(
      dashboard.display_url_path ?? dashboard.url_path
    );

    return (
      dashboard.is_default === true ||
      dashboard.id === "lovelace" ||
      dashboardPath === "lovelace"
    );
  }

  _withDefaultDashboard(dashboards, panels) {
    const panel = panels?.lovelace;
    const panelMode = panel?.config?.mode;
    const isBuiltInDefaultPanel =
      panel?.component_name === "lovelace" &&
      this._canonicalPath(panel?.url_path) === "lovelace" &&
      panelMode == null;
    const isStorageDefaultPanel =
      panelMode === "storage" || isBuiltInDefaultPanel;

    if (
      !isStorageDefaultPanel ||
      dashboards.some((dashboard) => this._isDefaultLovelaceDashboard(dashboard))
    ) {
      return dashboards;
    }

    return [
      {
        title: panel.title || "Overview",
        display_url_path: "lovelace",
        target_url_path: null,
        mode: "storage",
        is_default: true,
      },
      ...dashboards,
    ];
  }

  _dashboardTitle(dashboard) {
    return dashboard.title || dashboard.url_path || dashboard.id || "Untitled";
  }

  _dashboardPath(dashboard) {
    const urlPath = dashboard.display_url_path ?? dashboard.url_path ?? "";
    return urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
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
          .map(
            (dashboard) => `
              <li>
                <div class="dashboard-title">${this._escapeHtml(
                  this._dashboardTitle(dashboard)
                )}${
                  dashboard.is_default
                    ? '<span class="badge">Default</span>'
                    : ""
                }</div>
                <div class="dashboard-meta">
                  <span>${this._escapeHtml(this._dashboardPath(dashboard))}</span>
                  <span class="mode">${this._escapeHtml(
                    this._formatMode(dashboard.mode)
                  )}</span>
                </div>
              </li>
            `
          )
          .join("")}
      </ul>
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
                  <div class="dashboard-title">${this._escapeHtml(
                    this._dashboardTitle(dashboard)
                  )}</div>
                  <div class="dashboard-meta">
                    <span class="mode">${this._escapeHtml(
                      this._formatMode(dashboard.mode)
                    )}</span>
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
          padding: 16px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
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

        .badge {
          display: inline-flex;
          align-items: center;
          min-height: 20px;
          padding: 0 8px;
          border-radius: 999px;
          color: var(--primary-color);
          background: var(--secondary-background-color);
          font-size: 12px;
          font-weight: 500;
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
      </section>
    `;

    this.shadowRoot
      .getElementById("refresh-dashboards")
      ?.addEventListener("click", () => this._refreshDashboards());
  }
}

customElements.define("ha-yaml-source-editor-panel", HaYamlSourceEditorPanel);

class HaYamlSourceEditorPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._status = null;
    this._error = false;
    this._statusRequested = false;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._loadStatus();
  }

  connectedCallback() {
    this._render();
    this._loadStatus();
  }

  async _loadStatus() {
    if (
      this._statusRequested ||
      !this._hass?.connection?.sendMessagePromise
    ) {
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

  _render() {
    if (!this.shadowRoot) {
      return;
    }

    const integrationVersion = this._status?.integration_version ?? "Unknown";
    const homeAssistantVersion =
      this._status?.home_assistant_version ?? "Unknown";
    const backendState = this._error ? "Error" : this._status ? "Connected" : "Connecting";

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
        }
      </style>
      <section class="panel">
        <h1>HA YAML Source Editor</h1>
        <dl>
          <dt>Integration</dt>
          <dd>Loaded</dd>
          <dt>Backend API</dt>
          <dd>${backendState}</dd>
          <dt>Home Assistant</dt>
          <dd>${homeAssistantVersion}</dd>
          <dt>Integration version</dt>
          <dd>${integrationVersion}</dd>
        </dl>
      </section>
    `;
  }
}

customElements.define("ha-yaml-source-editor-panel", HaYamlSourceEditorPanel);

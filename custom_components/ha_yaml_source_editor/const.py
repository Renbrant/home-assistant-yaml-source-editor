"""Constants for HA YAML Source Editor."""

DOMAIN = "ha_yaml_source_editor"
NAME = "HA YAML Source Editor"
VERSION = "0.0.1"

PANEL_URL_PATH = "ha-yaml-source-editor"
PANEL_WEB_COMPONENT = "ha-yaml-source-editor-panel"
PANEL_STATIC_PATH = f"/{DOMAIN}/frontend"
PANEL_MODULE_URL = f"{PANEL_STATIC_PATH}/ha-yaml-source-editor-panel.js"
PANEL_ICON = "mdi:file-code-outline"

WS_TYPE_STATUS = f"{DOMAIN}/status"

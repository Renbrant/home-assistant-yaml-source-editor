"""Constants for HA YAML Source Editor."""

DOMAIN = "ha_yaml_source_editor"
NAME = "HA YAML Source Editor"
VERSION = "0.1.0"

PANEL_URL_PATH = "ha-yaml-source-editor"
PANEL_WEB_COMPONENT = "ha-yaml-source-editor-panel"
PANEL_STATIC_PATH = f"/{DOMAIN}/frontend"
PANEL_MODULE_URL = f"{PANEL_STATIC_PATH}/ha-yaml-source-editor-panel.js"
PANEL_ICON = "mdi:file-code-outline"

WS_TYPE_STATUS = f"{DOMAIN}/status"
WS_TYPE_DOCUMENTS_LIST = f"{DOMAIN}/documents/list"
WS_TYPE_DOCUMENTS_GET = f"{DOMAIN}/documents/get"
WS_TYPE_DOCUMENTS_CREATE = f"{DOMAIN}/documents/create"
WS_TYPE_DOCUMENTS_SAVE_SOURCE = f"{DOMAIN}/documents/save_source"
WS_TYPE_DOCUMENTS_RECORD_DEPLOYMENT = f"{DOMAIN}/documents/record_deployment"
WS_TYPE_DOCUMENTS_IMPORT_HA_VERSION = f"{DOMAIN}/documents/import_ha_version"
WS_TYPE_HASH_SHA256 = f"{DOMAIN}/hash/sha256"

DOCUMENT_STORAGE_KEY = f"{DOMAIN}.documents"
DOCUMENT_STORAGE_VERSION = 1
DOCUMENT_TARGET_TYPE_LOVELACE_STORAGE_DASHBOARD = "lovelace_storage_dashboard"
MAX_SOURCE_TEXT_BYTES = 2 * 1024 * 1024
MAX_HASH_TEXT_BYTES = 8 * 1024 * 1024
MAX_DEPLOYMENT_SNAPSHOT_BYTES = 8 * 1024 * 1024

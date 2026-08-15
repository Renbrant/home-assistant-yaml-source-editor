"""WebSocket commands for HA YAML Source Editor."""

from __future__ import annotations


from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant, callback

from .const import (
    DOCUMENT_TARGET_TYPE_LOVELACE_STORAGE_DASHBOARD,
    DOMAIN,
    MAX_HASH_TEXT_BYTES,
    NAME,
    VERSION,
    WS_TYPE_DOCUMENTS_CREATE,
    WS_TYPE_DOCUMENTS_GET,
    WS_TYPE_DOCUMENTS_IMPORT_HA_VERSION,
    WS_TYPE_DOCUMENTS_LIST,
    WS_TYPE_DOCUMENTS_RECORD_DEPLOYMENT,
    WS_TYPE_DOCUMENTS_SAVE_SOURCE,
    WS_TYPE_HASH_SHA256,
    WS_TYPE_STATUS,
    WS_TYPE_TEMPLATES_INDEX,
    WS_TYPE_TEMPLATES_BLOCK_GET,
)
from .document_store import (
    DocumentAlreadyExistsError,
    DocumentChangedError,
    DocumentNotFoundError,
    DocumentStoreError,
    InvalidDeploymentBaselineError,
    InvalidTargetError,
    SourceDocumentStore,
    SourceTextTooLargeError,
)
from .hashing import sha256_text
from .template_navigator import (
    TemplateBlockNotFoundError,
    TemplateSourceChangedError,
    TemplateSourceError,
    build_template_index,
    get_template_block,
)


def async_register_commands(hass: HomeAssistant) -> None:
    """Register HA YAML Source Editor WebSocket commands."""
    websocket_api.async_register_command(hass, websocket_status)
    websocket_api.async_register_command(hass, websocket_documents_list)
    websocket_api.async_register_command(hass, websocket_documents_get)
    websocket_api.async_register_command(hass, websocket_documents_create)
    websocket_api.async_register_command(hass, websocket_documents_save_source)
    websocket_api.async_register_command(hass, websocket_documents_record_deployment)
    websocket_api.async_register_command(hass, websocket_documents_import_ha_version)
    websocket_api.async_register_command(hass, websocket_hash_sha256)
    websocket_api.async_register_command(hass, websocket_templates_index)
    websocket_api.async_register_command(hass, websocket_templates_block_get)



def _document_store(hass: HomeAssistant) -> SourceDocumentStore:
    """Return the integration Source Document store."""
    return hass.data[DOMAIN]["document_store"]


@callback
@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): WS_TYPE_STATUS})
def websocket_status(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return minimal integration status."""
    connection.send_result(
        msg["id"],
        {
            "loaded": True,
            "integration_name": NAME,
            "integration_version": VERSION,
            "home_assistant_version": HA_VERSION,
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): WS_TYPE_DOCUMENTS_LIST})
@websocket_api.async_response
async def websocket_documents_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return Source Document metadata."""
    documents = await _document_store(hass).async_list_documents()
    connection.send_result(msg["id"], {"documents": documents})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DOCUMENTS_GET,
        vol.Required("document_id"): str,
    }
)
@websocket_api.async_response
async def websocket_documents_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return a full Source Document."""
    try:
        document = await _document_store(hass).async_get_document(msg["document_id"])
    except DocumentNotFoundError:
        connection.send_error(msg["id"], "not_found", "Source Document not found.")
        return

    connection.send_result(msg["id"], {"document": document})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_HASH_SHA256,
        vol.Required("text"): str,
    }
)
@websocket_api.async_response
async def websocket_hash_sha256(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return a SHA-256 digest for supplied text without storing it."""
    text = msg["text"]
    if len(text.encode("utf-8")) > MAX_HASH_TEXT_BYTES:
        connection.send_error(msg["id"], "text_too_large", "Hash text exceeds the 8 MiB limit.")
        return

    connection.send_result(
        msg["id"],
        {"sha256": sha256_text(text)},
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DOCUMENTS_CREATE,
        vol.Required("name"): str,
        vol.Required("target"): {
            vol.Required("type"): vol.Any(
                DOCUMENT_TARGET_TYPE_LOVELACE_STORAGE_DASHBOARD
            ),
            vol.Required("url_path"): str,
        },
    }
)
@websocket_api.async_response
async def websocket_documents_create(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Create a Source Document for a dashboard target."""
    target = msg["target"]
    try:
        document = await _document_store(hass).async_create_document(
            msg["name"], target["type"], target["url_path"]
        )
    except DocumentAlreadyExistsError as err:
        connection.send_result(
            msg["id"],
            {"already_exists": True, "document": err.document},
        )
        return
    except InvalidTargetError as err:
        connection.send_error(msg["id"], "invalid_target", str(err))
        return

    connection.send_result(
        msg["id"],
        {"already_exists": False, "document": document},
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DOCUMENTS_SAVE_SOURCE,
        vol.Required("document_id"): str,
        vol.Required("source_text"): str,
    }
)
@websocket_api.async_response
async def websocket_documents_save_source(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Save Source YAML text exactly as received from the editor."""
    try:
        document = await _document_store(hass).async_save_source(
            msg["document_id"], msg["source_text"]
        )
    except DocumentNotFoundError:
        connection.send_error(msg["id"], "not_found", "Source Document not found.")
        return
    except SourceTextTooLargeError as err:
        connection.send_error(msg["id"], "source_too_large", str(err))
        return
    except DocumentStoreError:
        connection.send_error(msg["id"], "store_error", "Unable to save Source Document.")
        return

    connection.send_result(msg["id"], {"document": document})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DOCUMENTS_RECORD_DEPLOYMENT,
        vol.Required("document_id"): str,
        vol.Required("expected_source_updated_at"): str,
        vol.Required("source_semantic_hash"): str,
        vol.Required("ha_semantic_hash"): str,
        vol.Required("home_assistant_version"): str,
        vol.Optional("deployed_canonical_json", default=None): vol.Any(str, None),
    }
)
@websocket_api.async_response
async def websocket_documents_record_deployment(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Record a deployment baseline after verified Lovelace deployment."""
    try:
        document = await _document_store(hass).async_record_deployment(
            msg["document_id"],
            msg["expected_source_updated_at"],
            msg["source_semantic_hash"],
            msg["ha_semantic_hash"],
            msg["home_assistant_version"],
            msg["deployed_canonical_json"],
        )
    except DocumentNotFoundError:
        connection.send_error(msg["id"], "not_found", "Source Document not found.")
        return
    except DocumentChangedError:
        connection.send_error(
            msg["id"],
            "document_changed",
            "Source Document changed during deployment.",
        )
        return
    except InvalidDeploymentBaselineError as err:
        connection.send_error(msg["id"], "invalid_baseline", str(err))
        return
    except DocumentStoreError:
        connection.send_error(
            msg["id"],
            "store_error",
            "Unable to record deployment baseline.",
        )
        return

    connection.send_result(msg["id"], {"document": document})


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_DOCUMENTS_IMPORT_HA_VERSION,
        vol.Required("document_id"): str,
        vol.Required("expected_source_updated_at"): str,
        vol.Required("source_text"): str,
        vol.Required("source_semantic_hash"): str,
        vol.Required("ha_semantic_hash"): str,
        vol.Required("ha_canonical_json"): str,
        vol.Required("home_assistant_version"): str,
    }
)
@websocket_api.async_response
async def websocket_documents_import_ha_version(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Atomically import current HA configuration as Source YAML."""
    try:
        document = await _document_store(hass).async_import_ha_version(
            msg["document_id"],
            msg["expected_source_updated_at"],
            msg["source_text"],
            msg["source_semantic_hash"],
            msg["ha_semantic_hash"],
            msg["ha_canonical_json"],
            msg["home_assistant_version"],
        )
    except DocumentNotFoundError:
        connection.send_error(msg["id"], "not_found", "Source Document not found.")
        return
    except DocumentChangedError:
        connection.send_error(
            msg["id"],
            "document_changed",
            "Source Document changed during import.",
        )
        return
    except SourceTextTooLargeError as err:
        connection.send_error(msg["id"], "source_too_large", str(err))
        return
    except InvalidDeploymentBaselineError as err:
        connection.send_error(msg["id"], "invalid_baseline", str(err))
        return
    except DocumentStoreError:
        connection.send_error(
            msg["id"],
            "store_error",
            "Unable to import Home Assistant version.",
        )
        return

    connection.send_result(msg["id"], {"document": document})

@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_TYPE_TEMPLATES_BLOCK_GET,
        vol.Required("block_id"): vol.All(
            str,
            vol.Length(min=1, max=128),
        ),
        vol.Required("expected_source_sha256"): vol.Match(
            r"^[0-9a-f]{64}$"
        ),
    }
)
@websocket_api.async_response
async def websocket_templates_block_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return one exact raw Template block from the indexed Source snapshot."""
    try:
        result = await hass.async_add_executor_job(
            get_template_block,
            Path(hass.config.config_dir),
            msg["block_id"],
            msg["expected_source_sha256"],
        )
    except TemplateSourceChangedError as err:
        connection.send_error(
            msg["id"],
            "template_source_changed",
            str(err),
        )
        return
    except TemplateBlockNotFoundError as err:
        connection.send_error(
            msg["id"],
            "template_block_not_found",
            str(err),
        )
        return
    except TemplateSourceError as err:
        connection.send_error(
            msg["id"],
            "template_source_error",
            str(err),
        )
        return

    connection.send_result(msg["id"], result)

@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): WS_TYPE_TEMPLATES_INDEX})
@websocket_api.async_response
async def websocket_templates_index(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return a read-only index of the configured YAML Template Source."""
    try:
        result = await hass.async_add_executor_job(
            build_template_index,
            Path(hass.config.config_dir),
        )
    except TemplateSourceError as err:
        connection.send_error(
            msg["id"],
            "template_source_error",
            str(err),
        )
        return

    connection.send_result(msg["id"], result)

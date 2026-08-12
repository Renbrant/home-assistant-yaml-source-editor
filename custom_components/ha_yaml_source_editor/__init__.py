"""The HA YAML Source Editor integration."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    NAME,
    PANEL_ICON,
    PANEL_MODULE_URL,
    PANEL_STATIC_PATH,
    PANEL_URL_PATH,
    PANEL_WEB_COMPONENT,
)
from .document_store import SourceDocumentStore
from .websocket import async_register_commands

type HaYamlSourceEditorConfigEntry = ConfigEntry[dict[str, Any]]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up process-level HA YAML Source Editor resources."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["document_store"] = SourceDocumentStore(hass)
    async_register_commands(hass)

    frontend_path = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_STATIC_PATH, str(frontend_path), False)]
    )

    return True


async def async_setup_entry(
    hass: HomeAssistant, entry: HaYamlSourceEditorConfigEntry
) -> bool:
    """Set up HA YAML Source Editor from a config entry."""
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_WEB_COMPONENT,
        sidebar_title=NAME,
        sidebar_icon=PANEL_ICON,
        module_url=PANEL_MODULE_URL,
        embed_iframe=False,
        require_admin=True,
        config_panel_domain=DOMAIN,
    )

    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: HaYamlSourceEditorConfigEntry
) -> bool:
    """Unload a HA YAML Source Editor config entry."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    return True

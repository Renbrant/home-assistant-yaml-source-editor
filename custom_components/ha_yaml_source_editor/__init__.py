"""The HA YAML Source Editor integration."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    NAME,
    PANEL_ICON,
    PANEL_MODULE_URL,
    PANEL_STATIC_PATH,
    PANEL_URL_PATH,
    PANEL_WEB_COMPONENT,
    VERSION,
    WS_TYPE_STATUS,
)

type HaYamlSourceEditorConfigEntry = ConfigEntry[dict[str, Any]]


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


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up process-level HA YAML Source Editor resources."""
    websocket_api.async_register_command(hass, websocket_status)

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

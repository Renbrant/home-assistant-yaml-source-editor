"""Config flow for HA YAML Source Editor."""

from __future__ import annotations

from homeassistant import config_entries

from .const import DOMAIN, NAME


class HaYamlSourceEditorConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for HA YAML Source Editor."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, object] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Create the single integration config entry."""
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        return self.async_create_entry(title=NAME, data={})

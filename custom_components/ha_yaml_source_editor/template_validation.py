"""Home Assistant semantic validation for prepared Template saves."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components.template.config import (
    async_validate_config_section,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util.yaml import Secrets, parse_yaml

from .template_navigator import PreparedTemplateBlockSave


class TemplateSemanticValidationError(Exception):
    """Raised when Home Assistant rejects a prepared Template candidate."""


async def async_validate_prepared_template_save(
    hass: HomeAssistant,
    prepared: PreparedTemplateBlockSave,
) -> None:
    """Validate the complete prepared Template Source using Home Assistant.

    The prepared raw Source is parsed only for validation. The parsed
    representation is ephemeral and is never serialized back to disk.
    """
    try:
        sections = await hass.async_add_executor_job(
            _parse_template_source,
            prepared.config_root,
            prepared.proposed_text,
        )
    except TemplateSemanticValidationError:
        raise
    except HomeAssistantError as err:
        raise TemplateSemanticValidationError(
            f"Home Assistant YAML loader rejected the Template Source: {err}"
        ) from err

    if not isinstance(sections, list):
        raise TemplateSemanticValidationError(
            "Home Assistant expected the Template Source to contain "
            "a top-level list."
        )

    for section_number, section in enumerate(
        sections,
        start=1,
    ):
        if not isinstance(section, dict):
            raise TemplateSemanticValidationError(
                "Home Assistant expected Template section "
                f"{section_number} to be a mapping."
            )

        try:
            await async_validate_config_section(
                hass,
                section,
            )
        except vol.Invalid as err:
            raise TemplateSemanticValidationError(
                "Home Assistant rejected Template section "
                f"{section_number}: {err}"
            ) from err
        except HomeAssistantError as err:
            raise TemplateSemanticValidationError(
                "Home Assistant could not validate Template section "
                f"{section_number}: {err}"
            ) from err


def _parse_template_source(
    config_root: Path,
    source_text: str,
) -> Any:
    """Parse candidate YAML with Home Assistant's loader and secret support."""
    secrets = Secrets(
        Path(config_root)
    )

    try:
        return parse_yaml(
            source_text,
            secrets,
        )
    except HomeAssistantError:
        raise
    except Exception as err:
        raise TemplateSemanticValidationError(
            "Home Assistant could not parse the proposed Template Source."
        ) from err

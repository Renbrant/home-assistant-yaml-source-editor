"""Deployment baseline validation helpers."""

from __future__ import annotations

import json

from .const import MAX_DEPLOYMENT_SNAPSHOT_BYTES
from .hashing import sha256_text


class DeploymentBaselineValidationError(ValueError):
    """Raised when deployment baseline data is invalid."""


def validate_deployed_canonical_json(
    deployed_canonical_json: str | None,
    source_semantic_hash: str,
    ha_semantic_hash: str,
) -> str | None:
    """Validate an optional deployed semantic snapshot."""
    if deployed_canonical_json is None:
        return None

    if not isinstance(deployed_canonical_json, str):
        raise DeploymentBaselineValidationError(
            "Deployment canonical JSON snapshot must be a string."
        )

    if (
        len(deployed_canonical_json.encode("utf-8"))
        > MAX_DEPLOYMENT_SNAPSHOT_BYTES
    ):
        raise DeploymentBaselineValidationError(
            "Deployment canonical JSON snapshot exceeds the 8 MiB limit."
        )

    try:
        parsed = json.loads(deployed_canonical_json)
    except json.JSONDecodeError as err:
        raise DeploymentBaselineValidationError(
            "Deployment canonical JSON snapshot must be valid JSON."
        ) from err

    if not isinstance(parsed, dict):
        raise DeploymentBaselineValidationError(
            "Deployment canonical JSON snapshot must have an object root."
        )

    snapshot_hash = sha256_text(deployed_canonical_json)
    if snapshot_hash != source_semantic_hash or snapshot_hash != ha_semantic_hash:
        raise DeploymentBaselineValidationError(
            "Deployment canonical JSON snapshot hash must match source and HA semantics."
        )

    return deployed_canonical_json

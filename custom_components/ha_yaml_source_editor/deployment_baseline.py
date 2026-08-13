"""Deployment baseline validation helpers."""

from __future__ import annotations

import json
from typing import Any

from .const import MAX_DEPLOYMENT_SNAPSHOT_BYTES, MAX_SOURCE_TEXT_BYTES
from .hashing import sha256_text


class DeploymentBaselineValidationError(ValueError):
    """Raised when deployment baseline data is invalid."""


class SourceDocumentChangedError(ValueError):
    """Raised when a document changed before an atomic baseline operation."""


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


def normalize_deployment_baseline(
    deployment_baseline: dict | None,
) -> dict | None:
    """Return a display-compatible baseline without mutating stored data."""
    if deployment_baseline is None:
        return None

    result = dict(deployment_baseline)
    result.setdefault("origin", "deployment")
    result.setdefault("established_at", result.get("deployed_at"))
    return result


def build_deployment_baseline(
    *,
    timestamp: str,
    source_text: str,
    source_semantic_hash: str,
    ha_semantic_hash: str,
    home_assistant_version: str,
    deployed_canonical_json: str | None,
) -> dict:
    """Build a verified deployment-origin baseline."""
    validated_deployed_canonical_json = validate_deployed_canonical_json(
        deployed_canonical_json,
        source_semantic_hash,
        ha_semantic_hash,
    )
    baseline = {
        "origin": "deployment",
        "established_at": timestamp,
        "deployed_at": timestamp,
        "source_text_hash": sha256_text(source_text),
        "source_semantic_hash": source_semantic_hash,
        "ha_semantic_hash": ha_semantic_hash,
        "home_assistant_version": home_assistant_version,
    }
    if validated_deployed_canonical_json is not None:
        baseline["deployed_canonical_json"] = validated_deployed_canonical_json
    return baseline


def build_ha_import_baseline(
    *,
    timestamp: str,
    source_text: str,
    source_semantic_hash: str,
    ha_semantic_hash: str,
    home_assistant_version: str,
    ha_canonical_json: str,
) -> dict:
    """Build a verified HA-import-origin synchronization baseline."""
    if source_semantic_hash != ha_semantic_hash:
        raise DeploymentBaselineValidationError(
            "Source and HA semantic hashes must match."
        )
    validated_ha_canonical_json = validate_deployed_canonical_json(
        ha_canonical_json,
        source_semantic_hash,
        ha_semantic_hash,
    )
    return {
        "origin": "ha_import",
        "established_at": timestamp,
        "deployed_at": None,
        "source_text_hash": sha256_text(source_text),
        "source_semantic_hash": source_semantic_hash,
        "ha_semantic_hash": ha_semantic_hash,
        "home_assistant_version": home_assistant_version,
        "deployed_canonical_json": validated_ha_canonical_json,
    }


def apply_ha_import_to_document(
    document: dict[str, Any],
    *,
    expected_source_updated_at: str,
    source_text: str,
    source_semantic_hash: str,
    ha_semantic_hash: str,
    ha_canonical_json: str,
    home_assistant_version: str,
    timestamp: str,
) -> dict[str, Any]:
    """Apply an HA import to a loaded document atomically in memory."""
    if document["updated_at"] != expected_source_updated_at:
        raise SourceDocumentChangedError("Source Document changed during import.")

    if len(source_text.encode("utf-8")) > MAX_SOURCE_TEXT_BYTES:
        raise DeploymentBaselineValidationError(
            "Source Document exceeds the 2 MiB limit."
        )

    document["source_text"] = source_text
    document["deployment_baseline"] = build_ha_import_baseline(
        timestamp=timestamp,
        source_text=source_text,
        source_semantic_hash=source_semantic_hash,
        ha_semantic_hash=ha_semantic_hash,
        home_assistant_version=home_assistant_version,
        ha_canonical_json=ha_canonical_json,
    )
    document["updated_at"] = timestamp
    return document

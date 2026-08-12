"""Hash helpers for HA YAML Source Editor."""

from __future__ import annotations

import hashlib


def sha256_text(text: str) -> str:
    """Return the SHA-256 hex digest of UTF-8 text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

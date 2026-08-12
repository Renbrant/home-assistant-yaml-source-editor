"""Lossless Source Document storage for HA YAML Source Editor."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    DOCUMENT_STORAGE_KEY,
    DOCUMENT_STORAGE_VERSION,
    DOCUMENT_TARGET_TYPE_LOVELACE_STORAGE_DASHBOARD,
    MAX_SOURCE_TEXT_BYTES,
)


class DocumentStoreError(Exception):
    """Base exception for Source Document storage errors."""


class DocumentAlreadyExistsError(DocumentStoreError):
    """Raised when a document already exists for a target."""

    def __init__(self, document: dict[str, Any]) -> None:
        """Initialize the error."""
        super().__init__("A Source Document already exists for this dashboard.")
        self.document = document


class DocumentNotFoundError(DocumentStoreError):
    """Raised when a document cannot be found."""


class SourceTextTooLargeError(DocumentStoreError):
    """Raised when source text exceeds the M3 size limit."""


class InvalidTargetError(DocumentStoreError):
    """Raised when a Source Document target is invalid."""


class SourceDocumentStore:
    """Persist Source Documents using Home Assistant Store.

    The frontend editor uses the native textarea LF newline representation for
    v0.1. Store source_text exactly as received from that editor.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the Source Document store."""
        self._store = Store[dict[str, Any]](
            hass,
            DOCUMENT_STORAGE_VERSION,
            DOCUMENT_STORAGE_KEY,
            private=True,
            atomic_writes=True,
        )
        self._lock = asyncio.Lock()
        self._data: dict[str, Any] | None = None

    async def async_list_documents(self) -> list[dict[str, Any]]:
        """Return Source Document metadata without source text."""
        data = await self._async_get_data()
        return [
            self._metadata(document)
            for document in data["documents"].values()
        ]

    async def async_get_document(self, document_id: str) -> dict[str, Any]:
        """Return a full Source Document, including stored source text."""
        data = await self._async_get_data()
        if document := data["documents"].get(document_id):
            return self._document_with_defaults(document)
        raise DocumentNotFoundError("Source Document not found.")

    async def async_create_document(
        self, name: str, target_type: str, url_path: str
    ) -> dict[str, Any]:
        """Create one Source Document for a supported dashboard target."""
        self._validate_target(target_type, url_path)

        async with self._lock:
            data = await self._async_get_data_unlocked()
            existing = self._find_document_for_target(data, target_type, url_path)
            if existing is not None:
                raise DocumentAlreadyExistsError(self._document_with_defaults(existing))

            now = self._now()
            document_id = str(uuid4())
            document = {
                "document_id": document_id,
                "name": name or url_path,
                "target": {
                    "type": target_type,
                    "url_path": url_path,
                },
                "source_text": "",
                "deployment_baseline": None,
                "created_at": now,
                "updated_at": now,
            }
            data["documents"][document_id] = document
            await self._store.async_save(data)
            return self._document_with_defaults(document)

    async def async_save_source(
        self, document_id: str, source_text: str
    ) -> dict[str, Any]:
        """Persist source text exactly as received."""
        self._validate_source_text(source_text)

        async with self._lock:
            data = await self._async_get_data_unlocked()
            document = data["documents"].get(document_id)
            if document is None:
                raise DocumentNotFoundError("Source Document not found.")

            document["source_text"] = source_text
            document["updated_at"] = self._now()
            await self._store.async_save(data)
            return self._document_with_defaults(document)

    async def _async_get_data(self) -> dict[str, Any]:
        """Return loaded store data."""
        async with self._lock:
            return await self._async_get_data_unlocked()

    async def _async_get_data_unlocked(self) -> dict[str, Any]:
        """Return loaded store data. Caller must hold the lock."""
        if self._data is None:
            self._data = await self._store.async_load() or {"documents": {}}
            self._data.setdefault("documents", {})
        return self._data

    def _metadata(self, document: dict[str, Any]) -> dict[str, Any]:
        """Return Source Document metadata without source text."""
        return {
            "document_id": document["document_id"],
            "name": document["name"],
            "target": deepcopy(document["target"]),
            "has_deployment_baseline": document.get("deployment_baseline") is not None,
            "created_at": document["created_at"],
            "updated_at": document["updated_at"],
        }

    def _document_with_defaults(self, document: dict[str, Any]) -> dict[str, Any]:
        """Return a document with additive fields defaulted without storing them."""
        result = deepcopy(document)
        result.setdefault("deployment_baseline", None)
        return result

    def _find_document_for_target(
        self, data: dict[str, Any], target_type: str, url_path: str
    ) -> dict[str, Any] | None:
        """Find an existing document for a target."""
        for document in data["documents"].values():
            target = document.get("target", {})
            if target.get("type") == target_type and target.get("url_path") == url_path:
                return document
        return None

    def _validate_target(self, target_type: str, url_path: str) -> None:
        """Validate the M3 Source Document target."""
        if target_type != DOCUMENT_TARGET_TYPE_LOVELACE_STORAGE_DASHBOARD:
            raise InvalidTargetError("Unsupported Source Document target type.")
        if not isinstance(url_path, str) or not url_path:
            raise InvalidTargetError("Dashboard URL path is required.")

    def _validate_source_text(self, source_text: str) -> None:
        """Validate source text without transforming it."""
        if len(source_text.encode("utf-8")) > MAX_SOURCE_TEXT_BYTES:
            raise SourceTextTooLargeError("Source Document exceeds the 2 MiB limit.")

    def _now(self) -> str:
        """Return an ISO timestamp."""
        return datetime.now(UTC).isoformat()

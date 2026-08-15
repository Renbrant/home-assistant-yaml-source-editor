"""Lossless discovery, indexing, and targeted writes for YAML Template sources."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import shlex
import stat
import tempfile
import threading
from typing import Any

import yaml
from yaml.nodes import SequenceNode

CONFIGURATION_FILENAME = "configuration.yaml"
MAX_TEMPLATE_SOURCE_BYTES = 8 * 1024 * 1024

_SIMPLE_TEMPLATE_INCLUDE_RE = re.compile(
    r"^template\s*:\s*!include\s+(?P<value>.+?)\s*$"
)

_TOP_LEVEL_BLOCK_RE = re.compile(
    r"^-\s+(?P<key>[A-Za-z_][A-Za-z0-9_-]*)\s*:"
)

_ENTITY_NAME_RE = re.compile(
    r"^(?P<indent>[ \t]+)-\s+name\s*:\s*(?P<value>.+?)\s*$"
)

_UNIQUE_ID_RE = re.compile(
    r"^[ \t]+unique_id\s*:\s*(?P<value>.+?)\s*$"
)

_SHARED_CHILD_KEY_RE = re.compile(
    r"^[ \t]{2}(?P<key>"
    r"trigger|triggers|condition|conditions|action|actions"
    r")\s*:"
)

_SHARED_KEYS = {
    "trigger",
    "triggers",
    "condition",
    "conditions",
    "action",
    "actions",
}

_TEMPLATE_WRITE_LOCK = threading.Lock()


class TemplateSourceError(Exception):
    """Base error for Template Source discovery/indexing."""


class TemplateSourcePathError(TemplateSourceError):
    """Raised when an included path escapes the Home Assistant config directory."""


class TemplateSourceTooLargeError(TemplateSourceError):
    """Raised when a Template Source exceeds the supported size limit."""

class TemplateBlockNotFoundError(TemplateSourceError):
    """Raised when a requested Template block is not in the current index."""


class TemplateSourceChangedError(TemplateSourceError):
    """Raised when the Template Source changed after Explorer indexing."""


class TemplateSourceValidationError(TemplateSourceError):
    """Raised when a proposed targeted edit is not safe valid Template YAML."""


class TemplateSourceWriteError(TemplateSourceError):
    """Raised when a targeted Template Source write cannot be completed safely."""


class TemplateSourceCommitUncertainError(TemplateSourceError):
    """Raised when replacement occurred but verification could not finish."""


@dataclass(frozen=True, slots=True)
class PreparedTemplateBlockSave:
    """Immutable candidate produced before semantic validation."""

    config_root: Path
    source_path: Path
    source_relative_path: str
    block_id: str
    expected_source_sha256: str
    proposed_text: str
    proposed_bytes: bytes
    source_mode: int | None
    changed: bool


def build_template_index(config_dir: str | Path) -> dict[str, Any]:
    """Discover and index the primary YAML Template Source.

    Initial #28 scope intentionally supports only:

        template: !include some-file.yaml

    More advanced include graphs belong to the 26B follow-up.
    """
    root = Path(config_dir).resolve()
    configuration_path = root / CONFIGURATION_FILENAME

    if not configuration_path.is_file():
        return {
            "available": False,
            "reason": "configuration_not_found",
            "message": "configuration.yaml was not found.",
            "configuration_path": _display_path(root, configuration_path),
        }

    configuration_text, _ = _read_utf8_file(configuration_path)

    include_value = find_simple_template_include(configuration_text)
    if include_value is None:
        return {
            "available": False,
            "reason": "simple_template_include_not_found",
            "message": (
                "No supported 'template: !include ...' declaration was found. "
                "Advanced Template Source discovery is not part of 26A."
            ),
            "configuration_path": _display_path(root, configuration_path),
        }

    source_path = resolve_config_path(root, include_value)

    if not source_path.is_file():
        return {
            "available": False,
            "reason": "template_source_not_found",
            "message": f"Template Source file was not found: {include_value}",
            "configuration_path": _display_path(root, configuration_path),
            "include_path": include_value,
            "source_path": _display_path(root, source_path),
        }

    source_text, source_bytes = _read_utf8_file(source_path)

    blocks = index_template_text(source_text)

    return {
        "available": True,
        "configuration_path": _display_path(root, configuration_path),
        "include_path": include_value,
        "source": {
            "path": _display_path(root, source_path),
            "relative_path": source_path.relative_to(root).as_posix(),
            "size_bytes": len(source_bytes),
            "sha256": hashlib.sha256(source_bytes).hexdigest(),
            "line_count": len(source_text.splitlines()),
            "block_count": len(blocks),
            "entity_count": sum(
                len(block.get("entities", []))
                for block in blocks
            ),
        },
        "blocks": blocks,
    }


def get_template_block(
    config_dir: str | Path,
    block_id: str,
    expected_source_sha256: str,
) -> dict[str, Any]:
    """Return one exact raw top-level Template block from the current source.

    The caller identifies a block only within the exact Source snapshot
    represented by expected_source_sha256. The backend rediscovers and
    reindexes the configured Template Source before returning any raw text.
    """
    root = Path(config_dir).resolve()
    result = build_template_index(root)

    if not result.get("available"):
        raise TemplateSourceError(
            result.get("message")
            or "No supported YAML Template Source is currently available."
        )

    source = result["source"]
    current_sha256 = source["sha256"]

    if current_sha256 != expected_source_sha256:
        raise TemplateSourceChangedError(
            "Template Source changed after Explorer indexing. Refresh and try again."
        )

    block = next(
        (
            candidate
            for candidate in result.get("blocks", [])
            if candidate.get("block_id") == block_id
        ),
        None,
    )

    if block is None:
        raise TemplateBlockNotFoundError(
            "Template block was not found in the current Source index."
        )

    # Never trust a caller-supplied path or line range. Resolve the Source
    # again from backend discovery metadata and verify its bytes still match
    # the same snapshot before slicing.
    source_path = resolve_config_path(
        root,
        source["relative_path"],
    )
    source_text, source_bytes = _read_utf8_file(source_path)
    verified_sha256 = hashlib.sha256(source_bytes).hexdigest()

    if (
        verified_sha256 != current_sha256
        or verified_sha256 != expected_source_sha256
    ):
        raise TemplateSourceChangedError(
            "Template Source changed while the block was being read. Refresh and try again."
        )

    lines = source_text.splitlines(keepends=True)
    start_index = block["start_line"] - 1
    end_index = block["end_line"]

    if (
        start_index < 0
        or end_index <= start_index
        or end_index > len(lines)
    ):
        raise TemplateSourceError(
            "Template block range is invalid for the current Source."
        )

    block_text = "".join(lines[start_index:end_index])

    # Keep a physical UTF-8 BOM under backend control instead of exposing
    # it as part of the editable block.
    if start_index == 0 and block_text.startswith("\ufeff"):
        block_text = block_text.removeprefix("\ufeff")

    return {
        "source": {
            "path": source["path"],
            "relative_path": source["relative_path"],
            "size_bytes": source["size_bytes"],
            "sha256": verified_sha256,
            "line_count": source["line_count"],
        },
        "block": block,
        "block_text": block_text,
    }



def save_template_block(
    config_dir: str | Path,
    block_id: str,
    expected_source_sha256: str,
    replacement_text: str,
) -> dict[str, Any]:
    """Prepare and atomically commit one targeted Template block save.

    This convenience wrapper preserves the existing synchronous API.
    Runtime callers that require asynchronous semantic validation should
    call prepare_template_block_save(), validate the prepared proposed_text,
    and then call commit_prepared_template_block_save().
    """
    prepared = prepare_template_block_save(
        config_dir,
        block_id,
        expected_source_sha256,
        replacement_text,
    )

    return commit_prepared_template_block_save(
        prepared
    )


def prepare_template_block_save(
    config_dir: str | Path,
    block_id: str,
    expected_source_sha256: str,
    replacement_text: str,
) -> PreparedTemplateBlockSave:
    """Build and structurally validate an exact raw save candidate.

    No filesystem mutation occurs in this phase. The resulting immutable
    candidate can safely pass through additional asynchronous validation
    before commit. The later commit phase rechecks the physical Source
    snapshot before any replacement occurs.
    """
    with _TEMPLATE_WRITE_LOCK:
        return _prepare_template_block_save_locked(
            config_dir,
            block_id,
            expected_source_sha256,
            replacement_text,
        )


def _prepare_template_block_save_locked(
    config_dir: str | Path,
    block_id: str,
    expected_source_sha256: str,
    replacement_text: str,
) -> PreparedTemplateBlockSave:
    """Prepare one candidate while serializing integration-local access."""
    root = Path(config_dir).resolve()
    current_index = build_template_index(root)

    if not current_index.get("available"):
        raise TemplateSourceError(
            current_index.get("message")
            or "No supported YAML Template Source is currently available."
        )

    source = current_index["source"]
    current_sha256 = source["sha256"]

    if current_sha256 != expected_source_sha256:
        raise TemplateSourceChangedError(
            "Template Source changed after Explorer indexing. Refresh and try again."
        )

    block = next(
        (
            candidate
            for candidate in current_index.get("blocks", [])
            if candidate.get("block_id") == block_id
        ),
        None,
    )

    if block is None:
        raise TemplateBlockNotFoundError(
            "Template block was not found in the current Source index."
        )

    source_path = resolve_config_path(
        root,
        source["relative_path"],
    )

    source_text, source_bytes = _read_utf8_file(
        source_path
    )

    verified_sha256 = hashlib.sha256(
        source_bytes
    ).hexdigest()

    if (
        verified_sha256 != current_sha256
        or verified_sha256 != expected_source_sha256
    ):
        raise TemplateSourceChangedError(
            "Template Source changed while preparing the save. Refresh and try again."
        )

    # Reject obviously oversized edits before composing another complete
    # Source string in memory.
    if len(replacement_text) > MAX_TEMPLATE_SOURCE_BYTES:
        raise TemplateSourceTooLargeError(
            "Edited Template block exceeds the 8 MiB safety limit."
        )

    try:
        replacement_size = len(
            replacement_text.encode("utf-8")
        )
    except UnicodeEncodeError as err:
        raise TemplateSourceValidationError(
            "Edited Template block cannot be encoded as UTF-8."
        ) from err

    if replacement_size > MAX_TEMPLATE_SOURCE_BYTES:
        raise TemplateSourceTooLargeError(
            "Edited Template block exceeds the 8 MiB safety limit."
        )

    lines = source_text.splitlines(
        keepends=True
    )

    start_index = block["start_line"] - 1
    end_index = block["end_line"]

    if (
        start_index < 0
        or end_index <= start_index
        or end_index > len(lines)
    ):
        raise TemplateSourceError(
            "Template block range is invalid for the current Source."
        )

    original_block_text = "".join(
        lines[start_index:end_index]
    )

    source_bom = ""

    if (
        start_index == 0
        and original_block_text.startswith("\ufeff")
    ):
        source_bom = "\ufeff"
        original_block_text = (
            original_block_text.removeprefix("\ufeff")
        )

    if replacement_text.startswith("\ufeff"):
        raise TemplateSourceValidationError(
            "UTF-8 BOM is managed by the physical Template Source "
            "and must not be supplied inside an edited block."
        )

    if (
        _ends_with_line_break(original_block_text)
        and not _ends_with_line_break(replacement_text)
    ):
        raise TemplateSourceValidationError(
            "The edited Template block must keep its terminating line break."
        )

    _validate_replacement_block(
        replacement_text
    )

    prefix = (
        "".join(lines[:start_index])
        + source_bom
    )
    suffix = "".join(
        lines[end_index:]
    )

    proposed_text = (
        prefix
        + replacement_text
        + suffix
    )

    try:
        proposed_bytes = proposed_text.encode(
            "utf-8"
        )
    except UnicodeEncodeError as err:
        raise TemplateSourceValidationError(
            "Edited Template block cannot be encoded as UTF-8."
        ) from err

    if len(proposed_bytes) > MAX_TEMPLATE_SOURCE_BYTES:
        raise TemplateSourceTooLargeError(
            "Template Source exceeds the 8 MiB safety limit."
        )

    _validate_complete_template_yaml(
        proposed_text
    )

    proposed_blocks = index_template_text(
        proposed_text
    )

    if len(proposed_blocks) != len(
        current_index.get("blocks", [])
    ):
        raise TemplateSourceValidationError(
            "The edited block must remain exactly one top-level Template block."
        )

    proposed_block = next(
        (
            candidate
            for candidate in proposed_blocks
            if candidate.get("block_id") == block_id
        ),
        None,
    )

    if proposed_block is None:
        raise TemplateSourceValidationError(
            "The edited block no longer maps to its original Template block."
        )

    replacement_line_count = len(
        replacement_text.splitlines(
            keepends=True
        )
    )

    expected_end_line = (
        block["start_line"]
        + replacement_line_count
        - 1
    )

    if (
        proposed_block["start_line"]
        != block["start_line"]
        or proposed_block["end_line"]
        != expected_end_line
    ):
        raise TemplateSourceValidationError(
            "The edited text must remain entirely inside the selected "
            "top-level Template block."
        )

    changed = proposed_bytes != source_bytes
    source_mode = None

    if changed:
        try:
            source_mode = stat.S_IMODE(
                source_path.stat().st_mode
            )
        except OSError as err:
            raise TemplateSourceWriteError(
                "Unable to inspect Template Source file permissions."
            ) from err

    return PreparedTemplateBlockSave(
        config_root=root,
        source_path=source_path,
        source_relative_path=source[
            "relative_path"
        ],
        block_id=block_id,
        expected_source_sha256=(
            expected_source_sha256
        ),
        proposed_text=proposed_text,
        proposed_bytes=proposed_bytes,
        source_mode=source_mode,
        changed=changed,
    )


def commit_prepared_template_block_save(
    prepared: PreparedTemplateBlockSave,
) -> dict[str, Any]:
    """Commit an already validated candidate after fresh stale checks."""
    with _TEMPLATE_WRITE_LOCK:
        return _commit_prepared_template_block_save_locked(
            prepared
        )


def _commit_prepared_template_block_save_locked(
    prepared: PreparedTemplateBlockSave,
) -> dict[str, Any]:
    """Commit a candidate only if its original Source snapshot still exists."""
    root = prepared.config_root

    current_index = build_template_index(
        root
    )

    if not current_index.get("available"):
        raise TemplateSourceChangedError(
            "Template Source is no longer available. Refresh and try again."
        )

    current_source = current_index["source"]

    if (
        current_source["sha256"]
        != prepared.expected_source_sha256
    ):
        raise TemplateSourceChangedError(
            "Template Source changed while the edit was being validated. "
            "Refresh and try again."
        )

    if (
        current_source["relative_path"]
        != prepared.source_relative_path
    ):
        raise TemplateSourceChangedError(
            "Configured Template Source changed while the edit was being validated. "
            "Refresh and try again."
        )

    current_source_path = resolve_config_path(
        root,
        current_source["relative_path"],
    )

    if (
        current_source_path.resolve()
        != prepared.source_path.resolve()
    ):
        raise TemplateSourceChangedError(
            "Configured Template Source path changed while the edit was "
            "being validated. Refresh and try again."
        )

    if not prepared.changed:
        result = get_template_block(
            root,
            prepared.block_id,
            prepared.expected_source_sha256,
        )

        result["changed"] = False
        result["previous_source_sha256"] = (
            prepared.expected_source_sha256
        )

        return result

    if prepared.source_mode is None:
        raise TemplateSourceWriteError(
            "Prepared Template save is missing required file metadata."
        )

    _atomic_replace_bytes(
        current_source_path,
        prepared.proposed_bytes,
        prepared.expected_source_sha256,
        prepared.source_mode,
    )

    # os.replace() has completed at this point. Any failure from here onward
    # must not be reported as a normal pre-commit write failure because the
    # physical Source may already contain the proposed bytes.
    try:
        readback_text, readback_bytes = _read_utf8_file(
            current_source_path
        )
    except (OSError, TemplateSourceError) as err:
        raise TemplateSourceCommitUncertainError(
            "Template Source was replaced, but read-back verification "
            "could not be completed. Refresh the Template Source and "
            "reconcile its current state before saving again."
        ) from err

    if readback_bytes != prepared.proposed_bytes:
        raise TemplateSourceCommitUncertainError(
            "Template Source was replaced, but the subsequent read-back "
            "does not match the committed candidate. Refresh the Template "
            "Source and reconcile its current state before saving again."
        )

    new_sha256 = hashlib.sha256(
        readback_bytes
    ).hexdigest()

    try:
        # Validate once more from the exact bytes read back from disk.
        _validate_complete_template_yaml(
            readback_text
        )

        result = get_template_block(
            root,
            prepared.block_id,
            new_sha256,
        )
    except TemplateSourceError as err:
        raise TemplateSourceCommitUncertainError(
            "Template Source was replaced, but post-commit verification "
            "could not be completed. Refresh the Template Source and "
            "reconcile its current state before saving again."
        ) from err

    result["changed"] = True
    result["previous_source_sha256"] = (
        prepared.expected_source_sha256
    )

    return result


def _validate_replacement_block(replacement_text: str) -> None:
    """Require replacement text to describe exactly one writable block."""
    if not replacement_text:
        raise TemplateSourceValidationError(
            "Edited Template block cannot be empty."
        )

    blocks = index_template_text(replacement_text)

    if len(blocks) != 1:
        raise TemplateSourceValidationError(
            "Edited text must contain exactly one top-level Template block."
        )

    block = blocks[0]

    if block["start_line"] != 1:
        raise TemplateSourceValidationError(
            "Edited Template block must begin on its first line."
        )

    replacement_lines = replacement_text.splitlines(
        keepends=True
    )
    indexed_text = "".join(
        replacement_lines[:block["end_line"]]
    )

    if indexed_text != replacement_text:
        raise TemplateSourceValidationError(
            "Edited Template block cannot contain raw text outside "
            "its writable block range."
        )


def _validate_complete_template_yaml(source_text: str) -> None:
    """Parse the complete proposed file without constructing or emitting YAML."""
    try:
        documents = list(
            yaml.compose_all(
                source_text,
                Loader=yaml.BaseLoader,
            )
        )
    except yaml.YAMLError as err:
        mark = getattr(err, "problem_mark", None)
        problem = getattr(err, "problem", None)

        location = ""
        if mark is not None:
            location = (
                f" at line {mark.line + 1}, "
                f"column {mark.column + 1}"
            )

        detail = (
            f": {problem}"
            if isinstance(problem, str) and problem
            else ""
        )

        raise TemplateSourceValidationError(
            f"Template YAML is invalid{location}{detail}."
        ) from err

    if (
        len(documents) != 1
        or not isinstance(documents[0], SequenceNode)
    ):
        raise TemplateSourceValidationError(
            "Template Source must contain exactly one YAML document "
            "with a top-level list."
        )


def _atomic_replace_bytes(
    source_path: Path,
    proposed_bytes: bytes,
    expected_source_sha256: str,
    source_mode: int,
) -> None:
    """Write bytes to a sibling temp file and atomically replace the Source."""
    try:
        fd, temp_name = tempfile.mkstemp(
            prefix=f".{source_path.name}.",
            suffix=".tmp",
            dir=source_path.parent,
        )
    except OSError as err:
        raise TemplateSourceWriteError(
            "Unable to create a temporary Template Source file."
        ) from err

    temp_path = Path(temp_name)

    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(proposed_bytes)
            handle.flush()
            os.fsync(handle.fileno())

        os.chmod(temp_path, source_mode)

        # Content is not the only observable file state that replacement can
        # overwrite. Detect portable permission-mode changes as another stale
        # condition before committing the prepared temp file.
        try:
            latest_mode = stat.S_IMODE(
                source_path.stat().st_mode
            )
        except OSError as err:
            raise TemplateSourceChangedError(
                "Template Source metadata became unavailable before "
                "the targeted save."
            ) from err

        if latest_mode != source_mode:
            raise TemplateSourceChangedError(
                "Template Source permissions changed before the targeted "
                "save could be committed."
            )

        # Verify the real Source only after the complete temp file is ready.
        # This makes the stale-check window before os.replace() as small as
        # practical while also serializing writes initiated by this integration.
        try:
            latest_bytes = source_path.read_bytes()
        except OSError as err:
            raise TemplateSourceChangedError(
                "Template Source became unavailable before the targeted save."
            ) from err

        latest_sha256 = hashlib.sha256(
            latest_bytes
        ).hexdigest()

        if latest_sha256 != expected_source_sha256:
            raise TemplateSourceChangedError(
                "Template Source changed before the targeted save could be committed."
            )

        os.replace(temp_path, source_path)

        # The file contents were fsynced before the rename. On POSIX, also
        # sync the parent directory so the directory-entry replacement is
        # made durable before reporting a verified save.
        _fsync_parent_directory(source_path.parent)

    except TemplateSourceError:
        raise
    except OSError as err:
        raise TemplateSourceWriteError(
            "Unable to atomically replace the Template Source."
        ) from err
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def _fsync_parent_directory(directory: Path) -> None:
    """Sync a replaced directory entry where POSIX directory fsync is available."""
    if os.name != "posix":
        return

    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)

    try:
        directory_fd = os.open(directory, flags)
    except OSError as err:
        raise TemplateSourceCommitUncertainError(
            "Template Source was replaced, but its parent directory "
            "could not be opened for durability verification. Refresh "
            "the Template Source and reconcile its current state."
        ) from err

    try:
        os.fsync(directory_fd)
    except OSError as err:
        raise TemplateSourceCommitUncertainError(
            "Template Source was replaced, but its parent directory "
            "could not be synchronized. Refresh the Template Source "
            "and reconcile its current state."
        ) from err
    finally:
        try:
            os.close(directory_fd)
        except OSError:
            pass


def _ends_with_line_break(text: str) -> bool:
    """Return whether raw text ends with a line separator."""
    return text.endswith(("\n", "\r"))


def find_simple_template_include(configuration_text: str) -> str | None:
    """Return the path from a simple top-level template !include declaration."""
    text = configuration_text.removeprefix("\ufeff")

    for raw_line in text.splitlines():
        if not raw_line:
            continue

        # #28 MVP intentionally handles only a top-level "template:" key.
        if raw_line[0].isspace():
            continue

        match = _SIMPLE_TEMPLATE_INCLUDE_RE.match(raw_line)
        if match is None:
            continue

        value = match.group("value")

        try:
            parts = shlex.split(value, comments=True, posix=True)
        except ValueError as err:
            raise TemplateSourceError(
                "Unable to parse the Template !include path."
            ) from err

        if len(parts) != 1:
            raise TemplateSourceError(
                "Template !include must contain exactly one file path."
            )

        return parts[0]

    return None


def resolve_config_path(config_dir: str | Path, include_path: str) -> Path:
    """Resolve an include while preventing access outside the HA config directory."""
    root = Path(config_dir).resolve()

    candidate = Path(include_path)
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (root / candidate).resolve()

    try:
        resolved.relative_to(root)
    except ValueError as err:
        raise TemplateSourcePathError(
            "Template Source path must remain inside the Home Assistant "
            "configuration directory."
        ) from err

    return resolved


def index_template_text(source_text: str) -> list[dict[str, Any]]:
    """Build a non-mutating logical index over raw Template YAML text."""
    lines = source_text.splitlines(keepends=True)

    starts: list[tuple[int, str]] = []

    for index, line in enumerate(lines):
        logical_line = _without_line_ending(line)

        # UTF-8 BOM belongs to the physical Source file, not to the
        # editable logical Template block.
        if index == 0:
            logical_line = logical_line.removeprefix("\ufeff")

        match = _TOP_LEVEL_BLOCK_RE.match(logical_line)
        if match is None:
            continue

        starts.append((index, match.group("key")))

    blocks: list[dict[str, Any]] = []

    for block_number, (start_index, block_key) in enumerate(starts, start=1):
        if block_number < len(starts):
            next_start_index = starts[block_number][0]
            end_index = _content_end_before_next_block(
                lines,
                start_index,
                next_start_index,
            )
        else:
            end_index = _content_end_at_eof(
                lines,
                start_index,
            )

        section = _section_before_block(lines, start_index)

        shared = _block_is_shared(
            lines,
            start_index,
            end_index,
            block_key,
        )

        entities = _index_entities(
            lines,
            start_index,
            end_index,
            shared,
        )

        label = (
            section
            or (entities[0]["name"] if entities else None)
            or f"Template block {block_number}"
        )

        blocks.append(
            {
                "block_id": f"block:{block_number}",
                "block_number": block_number,
                "block_type": block_key,
                "label": label,
                "section": section,
                "shared": shared,
                "start_line": start_index + 1,
                "end_line": end_index + 1,
                "entity_count": len(entities),
                "entities": entities,
            }
        )

    return blocks


def _content_end_before_next_block(
    lines: list[str],
    block_start: int,
    next_block_start: int,
) -> int:
    """Return the last line belonging structurally to the current block.

    Blank lines and column-zero comments immediately preceding the next
    top-level list item are preserved as external raw text. They are not
    part of either writable block range.
    """
    end_index = next_block_start - 1

    while end_index > block_start:
        line = _without_line_ending(lines[end_index])

        if not line.strip():
            end_index -= 1
            continue

        if line.startswith("#"):
            end_index -= 1
            continue

        break

    return max(block_start, end_index)


def _content_end_at_eof(
    lines: list[str],
    block_start: int,
) -> int:
    """Exclude trailing external raw text from the last writable block."""
    end_index = len(lines) - 1

    while end_index > block_start:
        line = _without_line_ending(lines[end_index])

        if not line.strip():
            end_index -= 1
            continue

        if line.startswith("#"):
            end_index -= 1
            continue

        break

    return max(block_start, end_index)

def _index_entities(
    lines: list[str],
    block_start: int,
    block_end: int,
    shared: bool,
) -> list[dict[str, Any]]:
    """Index named Template entities inside one top-level block."""
    matches: list[tuple[int, int, str]] = []

    for index in range(block_start, block_end + 1):
        line = _without_line_ending(lines[index])
        match = _ENTITY_NAME_RE.match(line)
        if match is None:
            continue

        matches.append(
            (
                index,
                len(match.group("indent")),
                _clean_scalar(match.group("value")),
            )
        )

    # A Template entity list is the shallowest "- name:" sequence
    # inside the top-level block. Deeper "- name:" entries can occur
    # inside attributes or other nested YAML and are navigation noise,
    # not independent Template entities.
    if matches:
        entity_indent = min(indent for _index, indent, _name in matches)
        matches = [
            item
            for item in matches
            if item[1] == entity_indent
        ]

    entities: list[dict[str, Any]] = []

    for entity_number, (start_index, indent, name) in enumerate(matches, start=1):
        next_index = block_end + 1

        for candidate_index, candidate_indent, _candidate_name in matches[
            entity_number:
        ]:
            if candidate_indent == indent:
                next_index = candidate_index
                break

        entity_end = next_index - 1

        unique_id = _find_unique_id(
            lines,
            start_index + 1,
            entity_end,
            indent + 2,
        )

        # 26A safety rule:
        # child entities are navigation/search targets only.
        # The smallest writable unit is the complete top-level
        # Template list item so shared context and neighboring
        # structure cannot be accidentally detached.
        edit_start = block_start
        edit_end = block_end

        stable_part = unique_id or f"{start_index + 1}:{name}"

        entities.append(
            {
                "entity_id": f"entity:{stable_part}",
                "name": name,
                "unique_id": unique_id,
                "start_line": start_index + 1,
                "end_line": entity_end + 1,
                "edit_start_line": edit_start + 1,
                "edit_end_line": edit_end + 1,
                "shared_block": shared,
            }
        )

    return entities


def _find_unique_id(
    lines: list[str],
    start_index: int,
    end_index: int,
    expected_indent: int,
) -> str | None:
    """Return the entity-level unique_id when present."""
    for index in range(start_index, end_index + 1):
        line = _without_line_ending(lines[index])
        match = _UNIQUE_ID_RE.match(line)

        if match is None:
            continue

        indentation = len(line) - len(line.lstrip())

        if indentation != expected_indent:
            continue

        return _clean_scalar(match.group("value"))

    return None


def _block_is_shared(
    lines: list[str],
    start_index: int,
    end_index: int,
    block_key: str,
) -> bool:
    """Return whether a top-level Template block has shared execution context."""
    if block_key in _SHARED_KEYS:
        return True

    for index in range(start_index + 1, end_index + 1):
        line = _without_line_ending(lines[index])

        if _SHARED_CHILD_KEY_RE.match(line):
            return True

    return False


def _extend_entity_start_to_comments(
    lines: list[str],
    block_start: int,
    entity_start: int,
    entity_indent: int,
) -> int:
    """Include immediately preceding entity comments/blank lines when safe."""
    index = entity_start - 1
    earliest = entity_start

    while index > block_start:
        line = _without_line_ending(lines[index])

        if not line.strip():
            earliest = index
            index -= 1
            continue

        stripped = line.lstrip()
        indentation = len(line) - len(stripped)

        if stripped.startswith("#") and indentation >= entity_indent:
            earliest = index
            index -= 1
            continue

        break

    return earliest


def _section_before_block(
    lines: list[str],
    block_start: int,
) -> str | None:
    """Return a nearby top-level comment heading for Explorer grouping."""
    index = block_start - 1
    comments: list[str] = []

    while index >= 0:
        line = _without_line_ending(lines[index])

        if not line.strip():
            index -= 1
            continue

        # Only column-zero comments are considered section metadata.
        if line.startswith("#"):
            comments.append(line)
            index -= 1
            continue

        break

    if not comments:
        return None

    for line in reversed(comments):
        title = _clean_comment_title(line)
        if title:
            return title

    return None


def _clean_comment_title(line: str) -> str | None:
    """Convert a section-style YAML comment into a compact label."""
    body = line[1:].strip()

    if not body:
        return None

    title = body.strip(" #=_-*")

    if not title:
        return None

    if not any(char.isalpha() for char in title):
        return None

    return title.strip()


def _clean_scalar(value: str) -> str:
    """Return a human-readable scalar label without normalizing YAML."""
    value = value.strip()

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]

    # For the MVP, trim a plain-scalar trailing comment.
    if " #" in value:
        value = value.split(" #", 1)[0].rstrip()

    return value


def _read_utf8_file(path: Path) -> tuple[str, bytes]:
    """Read UTF-8 bytes without newline translation."""
    raw = path.read_bytes()

    if len(raw) > MAX_TEMPLATE_SOURCE_BYTES:
        raise TemplateSourceTooLargeError(
            "Template Source exceeds the 8 MiB safety limit."
        )

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as err:
        raise TemplateSourceError(
            f"Template Source is not valid UTF-8: {path.name}"
        ) from err

    return text, raw


def _display_path(root: Path, path: Path) -> str:
    """Return a stable Home Assistant-style /config display path."""
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError:
        return str(path)

    if str(relative) == ".":
        return "/config"

    return f"/config/{relative.as_posix()}"


def _without_line_ending(line: str) -> str:
    """Remove only line-ending characters for structural inspection."""
    return line.rstrip("\r\n")

"""Tests for read-only YAML Template Source discovery and indexing."""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_PATH = ROOT / "custom_components" / "ha_yaml_source_editor"

sys.path.insert(0, str(PACKAGE_PATH))

from template_navigator import (  # noqa: E402
    TemplateBlockNotFoundError,
    _atomic_replace_bytes,
    TemplateSourceChangedError,
    TemplateSourcePathError,
    TemplateSourceValidationError,
    TemplateSourceWriteError,
    build_template_index,
    find_simple_template_include,
    get_template_block,
    index_template_text,
    resolve_config_path,
    save_template_block,
)


class TemplateNavigatorTest(unittest.TestCase):
    """Validate #28 Template Navigator discovery/index behavior."""

    def test_finds_simple_template_include(self) -> None:
        configuration = (
            "default_config:\n"
            "\n"
            "template: !include templates.yaml\n"
        )

        self.assertEqual(
            find_simple_template_include(configuration),
            "templates.yaml",
        )

    def test_finds_quoted_template_include(self) -> None:
        configuration = 'template: !include "yaml/my templates.yaml"\n'

        self.assertEqual(
            find_simple_template_include(configuration),
            "yaml/my templates.yaml",
        )

    def test_does_not_treat_indented_template_key_as_top_level(self) -> None:
        configuration = (
            "homeassistant:\n"
            "  template: !include nested.yaml\n"
        )

        self.assertIsNone(
            find_simple_template_include(configuration)
        )

    def test_rejects_path_outside_config_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            with self.assertRaises(TemplateSourcePathError):
                resolve_config_path(root, "../outside.yaml")

    def test_indexes_simple_and_shared_blocks(self) -> None:
        source = (
            "# ===== HOUSE =====\n"
            "- sensor:\n"
            "    # Main house power\n"
            "    - name: \"House Power Total\"\n"
            "      unique_id: house_power_total\n"
            "      state: \"{{ 1 }}\"\n"
            "\n"
            "    - name: House Current Total\n"
            "      unique_id: house_current_total\n"
            "      state: \"{{ 2 }}\"\n"
            "\n"
            "# ==============================================================\n"
            "# HVAC ADAPTIVE BOOSTER CONTROL - PI-LITE\n"
            "# ==============================================================\n"
            "- triggers:\n"
            "    - trigger: time_pattern\n"
            "      minutes: \"/5\"\n"
            "  sensor:\n"
            "    - name: \"Bed 1 Booster Adaptive Boost\"\n"
            "      unique_id: bed_1_booster_adaptive_boost\n"
            "      state: \"{{ 1 }}\"\n"
            "    - name: \"Bed 2 Booster Adaptive Boost\"\n"
            "      unique_id: bed_2_booster_adaptive_boost\n"
            "      state: \"{{ 2 }}\"\n"
        )

        blocks = index_template_text(source)

        self.assertEqual(len(blocks), 2)

        house = blocks[0]
        self.assertEqual(house["section"], "HOUSE")
        self.assertFalse(house["shared"])
        self.assertEqual(house["entity_count"], 2)
        self.assertEqual(
            house["entities"][0]["name"],
            "House Power Total",
        )
        self.assertEqual(
            house["entities"][0]["unique_id"],
            "house_power_total",
        )

        first = house["entities"][0]
        second = house["entities"][1]

        for entity in (first, second):
            self.assertEqual(
                entity["edit_start_line"],
                house["start_line"],
            )
            self.assertEqual(
                entity["edit_end_line"],
                house["end_line"],
            )

        adaptive = blocks[1]
        self.assertEqual(
            adaptive["section"],
            "HVAC ADAPTIVE BOOSTER CONTROL - PI-LITE",
        )
        self.assertTrue(adaptive["shared"])
        self.assertEqual(adaptive["entity_count"], 2)

        for entity in adaptive["entities"]:
            self.assertTrue(entity["shared_block"])
            self.assertEqual(
                entity["edit_start_line"],
                adaptive["start_line"],
            )
            self.assertEqual(
                entity["edit_end_line"],
                adaptive["end_line"],
            )

    def test_next_section_comments_are_not_part_of_previous_block(self) -> None:
        source = (
            "# ============================================================\n"
            "# HOUSE\n"
            "# ============================================================\n"
            "\n"
            "- sensor:\n"
            "    - name: House Power\n"
            "      unique_id: house_power\n"
            "      state: \"{{ 1 }}\"\n"
            "\n"
            "\n"
            "# ============================================================\n"
            "# COMFORT\n"
            "# ============================================================\n"
            "\n"
            "- sensor:\n"
            "    - name: Comfort Temperature\n"
            "      unique_id: comfort_temperature\n"
            "      state: \"{{ 72 }}\"\n"
        )

        blocks = index_template_text(source)

        self.assertEqual(len(blocks), 2)

        house = blocks[0]
        comfort = blocks[1]

        self.assertEqual(house["section"], "HOUSE")
        self.assertEqual(house["start_line"], 5)
        self.assertEqual(house["end_line"], 8)

        self.assertEqual(comfort["section"], "COMFORT")
        self.assertEqual(comfort["start_line"], 15)

        self.assertEqual(
            house["entities"][-1]["end_line"],
            8,
        )

        self.assertEqual(
            house["entities"][-1]["edit_end_line"],
            8,
        )

    def test_nested_name_and_unique_id_are_not_indexed_as_template_entity(self) -> None:
        source = (
            "# TEST\n"
            "- sensor:\n"
            "    - name: Real Template Entity\n"
            "      unique_id: real_template_entity\n"
            "      state: \"{{ 1 }}\"\n"
            "      attributes:\n"
            "        nested_items:\n"
            "          - name: Nested Display Name\n"
            "            unique_id: nested_wrong_unique_id\n"
        )

        blocks = index_template_text(source)

        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["entity_count"], 1)
        self.assertEqual(
            blocks[0]["entities"][0]["name"],
            "Real Template Entity",
        )
        self.assertEqual(
            blocks[0]["entities"][0]["unique_id"],
            "real_template_entity",
        )

    def test_all_child_entities_use_top_level_block_as_edit_unit(self) -> None:
        source = (
            "# GROUP\n"
            "- sensor:\n"
            "    - name: First\n"
            "      unique_id: first\n"
            "      state: \"{{ 1 }}\"\n"
            "\n"
            "    - name: Second\n"
            "      unique_id: second\n"
            "      state: \"{{ 2 }}\"\n"
        )

        block = index_template_text(source)[0]

        self.assertFalse(block["shared"])

        for entity in block["entities"]:
            self.assertEqual(
                entity["edit_start_line"],
                block["start_line"],
            )
            self.assertEqual(
                entity["edit_end_line"],
                block["end_line"],
            )
    def test_get_template_block_returns_exact_raw_block(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            configuration = (
                "default_config:\r\n"
                "template: !include templates.yaml\r\n"
            )

            templates = (
                "# ============================================================\r\n"
                "# HOUSE\r\n"
                "# ============================================================\r\n"
                "\r\n"
                "- sensor:\r\n"
                "    - name: \"House Power\"\r\n"
                "      unique_id: house_power\r\n"
                "      state: >\r\n"
                "        {{ 1234 }}\r\n"
                "\r\n"
                "# ============================================================\r\n"
                "# COMFORT\r\n"
                "# ============================================================\r\n"
                "\r\n"
                "- sensor:\r\n"
                "    - name: \"Comfort Temp\"\r\n"
                "      unique_id: comfort_temp\r\n"
                "      state: \"{{ 72 }}\"\r\n"
            )

            (root / "configuration.yaml").write_bytes(
                configuration.encode("utf-8")
            )
            (root / "templates.yaml").write_bytes(
                templates.encode("utf-8")
            )

            index = build_template_index(root)
            source_sha256 = index["source"]["sha256"]
            house = index["blocks"][0]

            result = get_template_block(
                root,
                house["block_id"],
                source_sha256,
            )

            self.assertEqual(
                result["source"]["sha256"],
                source_sha256,
            )
            self.assertEqual(
                result["block"]["block_id"],
                house["block_id"],
            )
            self.assertEqual(
                result["block_text"],
                (
                    "- sensor:\r\n"
                    "    - name: \"House Power\"\r\n"
                    "      unique_id: house_power\r\n"
                    "      state: >\r\n"
                    "        {{ 1234 }}\r\n"
                ),
            )

            self.assertNotIn(
                "# COMFORT",
                result["block_text"],
            )

    def test_get_template_block_rejects_stale_source_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )
            (root / "templates.yaml").write_text(
                (
                    "# TEST\n"
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            index = build_template_index(root)
            block_id = index["blocks"][0]["block_id"]

            with self.assertRaises(TemplateSourceChangedError):
                get_template_block(
                    root,
                    block_id,
                    "0" * 64,
                )

    def test_get_template_block_rejects_unknown_block_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )
            (root / "templates.yaml").write_text(
                (
                    "# TEST\n"
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            index = build_template_index(root)

            with self.assertRaises(TemplateBlockNotFoundError):
                get_template_block(
                    root,
                    "block:not-real",
                    index["source"]["sha256"],
                )
    def test_save_template_block_changes_only_target_raw_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_bytes(
                b"template: !include templates.yaml\r\n"
            )

            original = (
                "# ============================================================\r\n"
                "# HOUSE\r\n"
                "# ============================================================\r\n"
                "\r\n"
                "- sensor:\r\n"
                "    - name: \"House Power\"\r\n"
                "      unique_id: house_power\r\n"
                "      state: >\r\n"
                "        {{ 1234 }}\r\n"
                "\r\n"
                "# ============================================================\r\n"
                "# COMFORT\r\n"
                "# ============================================================\r\n"
                "\r\n"
                "- sensor:\r\n"
                "    - name: \"Comfort Temp\"\r\n"
                "      unique_id: comfort_temp\r\n"
                "      state: \"{{ 72 }}\"\r\n"
            ).encode("utf-8")

            source_path = root / "templates.yaml"
            source_path.write_bytes(original)

            index = build_template_index(root)
            house = index["blocks"][0]

            current = get_template_block(
                root,
                house["block_id"],
                index["source"]["sha256"],
            )

            replacement = current["block_text"].replace(
                "{{ 1234 }}",
                "{{ 4321 }}",
            )

            result = save_template_block(
                root,
                house["block_id"],
                index["source"]["sha256"],
                replacement,
            )

            expected = original.replace(
                b"{{ 1234 }}",
                b"{{ 4321 }}",
                1,
            )

            self.assertTrue(result["changed"])
            self.assertEqual(
                result["previous_source_sha256"],
                index["source"]["sha256"],
            )
            self.assertEqual(
                source_path.read_bytes(),
                expected,
            )
            self.assertEqual(
                result["source"]["sha256"],
                hashlib.sha256(expected).hexdigest(),
            )

            self.assertIn(
                "{{ 4321 }}",
                result["block_text"],
            )

    def test_save_template_block_rejects_stale_snapshot_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )

            source_path = root / "templates.yaml"
            source_path.write_text(
                (
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            original = source_path.read_bytes()
            index = build_template_index(root)

            with self.assertRaises(
                TemplateSourceChangedError
            ):
                save_template_block(
                    root,
                    index["blocks"][0]["block_id"],
                    "0" * 64,
                    (
                        "- sensor:\n"
                        "    - name: First\n"
                        "      unique_id: first\n"
                        "      state: \"{{ 2 }}\"\n"
                    ),
                )

            self.assertEqual(
                source_path.read_bytes(),
                original,
            )

    def test_save_template_block_rejects_invalid_yaml_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )

            source_path = root / "templates.yaml"
            source_path.write_text(
                (
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            original = source_path.read_bytes()
            index = build_template_index(root)

            invalid = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: [broken\n"
            )

            with self.assertRaises(
                TemplateSourceValidationError
            ):
                save_template_block(
                    root,
                    index["blocks"][0]["block_id"],
                    index["source"]["sha256"],
                    invalid,
                )

            self.assertEqual(
                source_path.read_bytes(),
                original,
            )

    def test_save_template_block_rejects_multiple_top_level_blocks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )

            source_path = root / "templates.yaml"
            source_path.write_text(
                (
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            original = source_path.read_bytes()
            index = build_template_index(root)

            replacement = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: \"{{ 2 }}\"\n"
                "- sensor:\n"
                "    - name: Injected\n"
                "      unique_id: injected\n"
                "      state: \"{{ 3 }}\"\n"
            )

            with self.assertRaises(
                TemplateSourceValidationError
            ):
                save_template_block(
                    root,
                    index["blocks"][0]["block_id"],
                    index["source"]["sha256"],
                    replacement,
                )

            self.assertEqual(
                source_path.read_bytes(),
                original,
            )

    def test_save_template_block_validation_accepts_custom_yaml_tags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )

            source_path = root / "templates.yaml"
            source_path.write_text(
                (
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            index = build_template_index(root)

            replacement = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: !secret template_test_value\n"
            )

            result = save_template_block(
                root,
                index["blocks"][0]["block_id"],
                index["source"]["sha256"],
                replacement,
            )

            self.assertTrue(result["changed"])
            self.assertIn(
                "!secret template_test_value",
                source_path.read_text(encoding="utf-8"),
            )

    def test_atomic_replace_failure_leaves_original_and_cleans_temp_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )

            source_path = root / "templates.yaml"
            source_path.write_text(
                (
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            original = source_path.read_bytes()
            index = build_template_index(root)

            replacement = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: \"{{ 2 }}\"\n"
            )

            with mock.patch(
                "template_navigator.os.replace",
                side_effect=OSError("simulated replace failure"),
            ):
                with self.assertRaises(
                    TemplateSourceWriteError
                ):
                    save_template_block(
                        root,
                        index["blocks"][0]["block_id"],
                        index["source"]["sha256"],
                        replacement,
                    )

            self.assertEqual(
                source_path.read_bytes(),
                original,
            )

            self.assertEqual(
                list(root.glob(".templates.yaml.*.tmp")),
                [],
            )

    def test_save_template_block_noop_does_not_replace_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )

            source_path = root / "templates.yaml"
            source_path.write_text(
                (
                    "- sensor:\n"
                    "    - name: First\n"
                    "      unique_id: first\n"
                    "      state: \"{{ 1 }}\"\n"
                ),
                encoding="utf-8",
            )

            original = source_path.read_bytes()
            index = build_template_index(root)

            current = get_template_block(
                root,
                index["blocks"][0]["block_id"],
                index["source"]["sha256"],
            )

            with mock.patch(
                "template_navigator.os.replace"
            ) as replace:
                result = save_template_block(
                    root,
                    index["blocks"][0]["block_id"],
                    index["source"]["sha256"],
                    current["block_text"],
                )

            replace.assert_not_called()
            self.assertFalse(result["changed"])
            self.assertEqual(
                source_path.read_bytes(),
                original,
            )

    def test_atomic_replace_rechecks_stale_source_after_temp_is_ready(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_path = root / "templates.yaml"

            original = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: \"{{ 1 }}\"\n"
            ).encode("utf-8")

            external_change = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: \"{{ 99 }}\"\n"
            ).encode("utf-8")

            proposed = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: \"{{ 2 }}\"\n"
            ).encode("utf-8")

            source_path.write_bytes(external_change)

            with self.assertRaises(
                TemplateSourceChangedError
            ):
                _atomic_replace_bytes(
                    source_path,
                    proposed,
                    hashlib.sha256(original).hexdigest(),
                    0o600,
                )

            self.assertEqual(
                source_path.read_bytes(),
                external_change,
            )

            self.assertEqual(
                list(root.glob(".templates.yaml.*.tmp")),
                [],
            )

    def test_last_block_save_preserves_trailing_external_comments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include templates.yaml\n",
                encoding="utf-8",
            )

            source_path = root / "templates.yaml"

            original = (
                "- sensor:\n"
                "    - name: First\n"
                "      unique_id: first\n"
                "      state: \"{{ 1 }}\"\n"
                "# External footer comment\n"
                "# Must remain outside the writable block\n"
                "\n"
            ).encode("utf-8")

            source_path.write_bytes(original)

            index = build_template_index(root)
            block = index["blocks"][0]

            self.assertEqual(
                block["end_line"],
                4,
            )

            current = get_template_block(
                root,
                block["block_id"],
                index["source"]["sha256"],
            )

            self.assertNotIn(
                "External footer comment",
                current["block_text"],
            )

            replacement = current["block_text"].replace(
                "{{ 1 }}",
                "{{ 2 }}",
            )

            save_template_block(
                root,
                block["block_id"],
                index["source"]["sha256"],
                replacement,
            )

            expected = original.replace(
                b"{{ 1 }}",
                b"{{ 2 }}",
                1,
            )

            self.assertEqual(
                source_path.read_bytes(),
                expected,
            )

    def test_builds_index_without_rewriting_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            configuration = (
                "default_config:\r\n"
                "template: !include templates.yaml\r\n"
            )

            templates = (
                "# Kitchen\r\n"
                "- sensor:\r\n"
                "    - name: \"Kitchen AC Current Temp\"\r\n"
                "      unique_id: kitchen_ac_current_temp\r\n"
                "      state: >\r\n"
                "        {{ state_attr('climate.kitchen', 'current_temperature') }}\r\n"
            )

            (root / "configuration.yaml").write_bytes(
                configuration.encode("utf-8")
            )
            (root / "templates.yaml").write_bytes(
                templates.encode("utf-8")
            )

            before = (root / "templates.yaml").read_bytes()
            result = build_template_index(root)
            after = (root / "templates.yaml").read_bytes()

            self.assertTrue(result["available"])
            self.assertEqual(
                result["source"]["path"],
                "/config/templates.yaml",
            )
            self.assertEqual(
                result["source"]["relative_path"],
                "templates.yaml",
            )
            self.assertEqual(
                result["source"]["sha256"],
                hashlib.sha256(before).hexdigest(),
            )
            self.assertEqual(before, after)

            self.assertEqual(len(result["blocks"]), 1)
            self.assertEqual(
                result["blocks"][0]["section"],
                "Kitchen",
            )
            self.assertEqual(
                result["blocks"][0]["entities"][0]["unique_id"],
                "kitchen_ac_current_temp",
            )

    def test_returns_unavailable_for_advanced_or_missing_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            (root / "configuration.yaml").write_text(
                "template: !include_dir_merge_list templates\n",
                encoding="utf-8",
            )

            result = build_template_index(root)

            self.assertFalse(result["available"])
            self.assertEqual(
                result["reason"],
                "simple_template_include_not_found",
            )


if __name__ == "__main__":
    unittest.main()

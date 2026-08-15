"""Tests for read-only YAML Template Source discovery and indexing."""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_PATH = ROOT / "custom_components" / "ha_yaml_source_editor"

sys.path.insert(0, str(PACKAGE_PATH))

from template_navigator import (  # noqa: E402
    TemplateSourcePathError,
    build_template_index,
    find_simple_template_include,
    index_template_text,
    resolve_config_path,
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
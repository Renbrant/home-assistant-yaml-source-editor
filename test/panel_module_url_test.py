"""Tests for frontend panel module URL cache busting."""

from __future__ import annotations

import sys
import unittest
from importlib import util
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "custom_components.ha_yaml_source_editor"
PACKAGE_PATH = ROOT / "custom_components" / "ha_yaml_source_editor"


def load_module(name: str, path: Path) -> ModuleType:
    """Load an integration module without importing Home Assistant."""
    spec = util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sys.modules.setdefault("custom_components", ModuleType("custom_components"))
package_module = ModuleType(PACKAGE)
package_module.__path__ = [str(PACKAGE_PATH)]
sys.modules[PACKAGE] = package_module

const_module = load_module(f"{PACKAGE}.const", PACKAGE_PATH / "const.py")


class PanelModuleUrlTest(unittest.TestCase):
    """Validate deterministic panel module cache busting."""

    def test_panel_module_url_uses_frontend_asset_identity_query(self) -> None:
        self.assertEqual(const_module.VERSION, "0.3.0")
        self.assertEqual(const_module.PANEL_FRONTEND_REVISION, 5)
        self.assertEqual(const_module.PANEL_ASSET_IDENTITY, "0.3.0-r5")
        self.assertEqual(
            const_module.PANEL_MODULE_URL,
            "/ha_yaml_source_editor/frontend/0.3.0-r5/ha-yaml-source-editor-panel.js?v=0.3.0-r5",
        )

    def test_frontend_static_path_uses_asset_identity(self) -> None:
        self.assertEqual(
            const_module.PANEL_STATIC_PATH,
            "/ha_yaml_source_editor/frontend/0.3.0-r5",
        )
    def test_panel_web_component_uses_frontend_asset_identity(self) -> None:
        self.assertEqual(
            const_module.PANEL_WEB_COMPONENT,
            "ha-yaml-source-editor-panel-0-3-0-r5",
        )


if __name__ == "__main__":
    unittest.main()

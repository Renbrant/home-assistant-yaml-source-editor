"""Tests for deployment baseline snapshot validation."""

from __future__ import annotations

import unittest
from importlib import util
from pathlib import Path
from types import ModuleType
import sys

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
hashing_module = load_module(f"{PACKAGE}.hashing", PACKAGE_PATH / "hashing.py")
baseline_module = load_module(
    f"{PACKAGE}.deployment_baseline",
    PACKAGE_PATH / "deployment_baseline.py",
)

MAX_DEPLOYMENT_SNAPSHOT_BYTES = const_module.MAX_DEPLOYMENT_SNAPSHOT_BYTES
sha256_text = hashing_module.sha256_text
DeploymentBaselineValidationError = (
    baseline_module.DeploymentBaselineValidationError
)
SourceDocumentChangedError = baseline_module.SourceDocumentChangedError
apply_ha_import_to_document = baseline_module.apply_ha_import_to_document
build_ha_import_baseline = baseline_module.build_ha_import_baseline
normalize_deployment_baseline = baseline_module.normalize_deployment_baseline
validate_deployed_canonical_json = baseline_module.validate_deployed_canonical_json


class DeploymentBaselineValidationTest(unittest.TestCase):
    """Validate optional canonical deployment snapshots."""

    def test_valid_canonical_json_is_accepted(self) -> None:
        snapshot = '{"views":[]}'
        digest = sha256_text(snapshot)

        self.assertEqual(
            validate_deployed_canonical_json(snapshot, digest, digest),
            snapshot,
        )

    def test_invalid_json_is_rejected(self) -> None:
        digest = sha256_text("{")

        with self.assertRaises(DeploymentBaselineValidationError):
            validate_deployed_canonical_json("{", digest, digest)

    def test_non_object_root_is_rejected(self) -> None:
        snapshot = "[]"
        digest = sha256_text(snapshot)

        with self.assertRaises(DeploymentBaselineValidationError):
            validate_deployed_canonical_json(snapshot, digest, digest)

    def test_oversized_snapshot_is_rejected(self) -> None:
        snapshot = "{" + '"x":"' + ("a" * MAX_DEPLOYMENT_SNAPSHOT_BYTES) + '"}'
        digest = sha256_text(snapshot)

        with self.assertRaises(DeploymentBaselineValidationError):
            validate_deployed_canonical_json(snapshot, digest, digest)

    def test_snapshot_hash_mismatch_is_rejected(self) -> None:
        snapshot = '{"views":[]}'
        digest = sha256_text(snapshot)

        with self.assertRaises(DeploymentBaselineValidationError):
            validate_deployed_canonical_json(snapshot, digest, "0" * 64)

    def test_snapshot_matching_source_and_ha_hashes_is_accepted(self) -> None:
        snapshot = '{"title":"M7"}'
        digest = sha256_text(snapshot)

        self.assertEqual(
            validate_deployed_canonical_json(snapshot, digest, digest),
            snapshot,
        )

    def test_legacy_baseline_defaults_without_mutating_input(self) -> None:
        baseline = {"deployed_at": "then"}

        normalized = normalize_deployment_baseline(baseline)

        self.assertEqual(normalized["origin"], "deployment")
        self.assertEqual(normalized["established_at"], "then")
        self.assertNotIn("origin", baseline)

    def test_import_stale_expected_updated_at_rejected(self) -> None:
        document = self._document()

        with self.assertRaises(SourceDocumentChangedError):
            apply_ha_import_to_document(
                document,
                expected_source_updated_at="stale",
                source_text="views: []\n",
                source_semantic_hash="0" * 64,
                ha_semantic_hash="0" * 64,
                ha_canonical_json='{"views":[]}',
                home_assistant_version="2026.8.1",
                timestamp="now",
            )

    def test_import_oversized_source_rejected(self) -> None:
        document = self._document()
        source_text = "a" * (2 * 1024 * 1024 + 1)

        with self.assertRaises(DeploymentBaselineValidationError):
            apply_ha_import_to_document(
                document,
                expected_source_updated_at="before",
                source_text=source_text,
                source_semantic_hash="0" * 64,
                ha_semantic_hash="0" * 64,
                ha_canonical_json='{"views":[]}',
                home_assistant_version="2026.8.1",
                timestamp="now",
            )

    def test_import_hash_mismatch_rejected(self) -> None:
        document = self._document()
        snapshot = '{"views":[]}'
        digest = sha256_text(snapshot)

        with self.assertRaises(DeploymentBaselineValidationError):
            apply_ha_import_to_document(
                document,
                expected_source_updated_at="before",
                source_text="views: []\n",
                source_semantic_hash=digest,
                ha_semantic_hash="0" * 64,
                ha_canonical_json=snapshot,
                home_assistant_version="2026.8.1",
                timestamp="now",
            )

    def test_successful_import_replaces_source_and_sets_ha_import_baseline(self) -> None:
        document = self._document()
        source_text = "views: []\n"
        snapshot = '{"views":[]}'
        digest = sha256_text(snapshot)

        result = apply_ha_import_to_document(
            document,
            expected_source_updated_at="before",
            source_text=source_text,
            source_semantic_hash=digest,
            ha_semantic_hash=digest,
            ha_canonical_json=snapshot,
            home_assistant_version="2026.8.1",
            timestamp="now",
        )

        baseline = result["deployment_baseline"]
        self.assertEqual(result["source_text"], source_text)
        self.assertEqual(result["updated_at"], "now")
        self.assertEqual(baseline["origin"], "ha_import")
        self.assertEqual(baseline["deployed_at"], None)
        self.assertEqual(baseline["established_at"], "now")
        self.assertEqual(baseline["source_text_hash"], sha256_text(source_text))
        self.assertEqual(baseline["deployed_canonical_json"], snapshot)

    def _document(self) -> dict:
        return {
            "document_id": "doc",
            "source_text": "old",
            "deployment_baseline": None,
            "updated_at": "before",
        }


if __name__ == "__main__":
    unittest.main()

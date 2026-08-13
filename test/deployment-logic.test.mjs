import assert from "node:assert/strict";
import test from "node:test";

import {
  assessDeploymentPreflight,
  verifyFinalHaRead,
  verifyPostSave,
} from "../custom_components/ha_yaml_source_editor/frontend/deployment-logic.mjs";

test("no baseline allows first deployment after confirmation", () => {
  const result = assessDeploymentPreflight({
    sourceValid: true,
    hasUnsavedChanges: false,
    savedSourceText: "views: []\n",
    backendSourceText: "views: []\n",
    deploymentBaseline: null,
    preflightHaSemanticHash: "ha-old",
  });

  assert.equal(result.allowed, true);
  assert.equal(result.firstDeployment, true);
});

test("existing baseline allows deploy when HA equals baseline", () => {
  const result = assessDeploymentPreflight({
    sourceValid: true,
    hasUnsavedChanges: false,
    savedSourceText: "views: []\n",
    backendSourceText: "views: []\n",
    deploymentBaseline: { ha_semantic_hash: "ha-a" },
    preflightHaSemanticHash: "ha-a",
  });

  assert.equal(result.allowed, true);
});

test("existing baseline blocks when HA differs from baseline", () => {
  const result = assessDeploymentPreflight({
    sourceValid: true,
    hasUnsavedChanges: false,
    savedSourceText: "views: []\n",
    backendSourceText: "views: []\n",
    deploymentBaseline: { ha_semantic_hash: "ha-a" },
    preflightHaSemanticHash: "ha-b",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ha_conflict");
});

test("invalid source blocks deployment", () => {
  const result = assessDeploymentPreflight({
    sourceValid: false,
    hasUnsavedChanges: false,
    savedSourceText: "bad",
    backendSourceText: "bad",
    deploymentBaseline: null,
    preflightHaSemanticHash: "ha-a",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "invalid_source");
});

test("unsaved editor/source mismatch blocks deployment", () => {
  const result = assessDeploymentPreflight({
    sourceValid: true,
    hasUnsavedChanges: true,
    savedSourceText: "views: []\n",
    backendSourceText: "views: []\n",
    deploymentBaseline: null,
    preflightHaSemanticHash: "ha-a",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "unsaved_source");
});

test("HA changes between preflight and final read blocks deployment", () => {
  const result = verifyFinalHaRead({
    deploymentBaseline: null,
    initialPreflightHaHash: "ha-a",
    latestHaHash: "ha-b",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ha_changed_during_preflight");
});

test("post-save matching hash verifies deployment", () => {
  const result = verifyPostSave({
    verifiedHaSemanticHash: "source-a",
    deploymentSourceSemanticHash: "source-a",
  });

  assert.equal(result.verified, true);
});

test("post-save hash mismatch fails verification", () => {
  const result = verifyPostSave({
    verifiedHaSemanticHash: "ha-b",
    deploymentSourceSemanticHash: "source-a",
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "verification_mismatch");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  assessFinalOverwriteRead,
  assessOverwritePreflight,
} from "../custom_components/ha_yaml_source_editor/frontend/conflict-resolution-logic.mjs";

const SNAPSHOT = {
  documentUpdatedAt: "before",
  sourceTextHash: "source-text",
  sourceSemanticHash: "source-semantic",
  haSemanticHash: "ha-semantic",
};

function assess(overrides = {}) {
  return assessOverwritePreflight({
    compareSnapshot: SNAPSHOT,
    hasUnsavedChanges: false,
    freshDocumentUpdatedAt: "before",
    currentSourceTextHash: "source-text",
    currentSourceSemanticHash: "source-semantic",
    currentHaSemanticHash: "ha-semantic",
    syncStatus: "HA MODIFIED",
    ...overrides,
  });
}

test("no Compare snapshot blocks overwrite", () => {
  assert.equal(assess({ compareSnapshot: null }).allowed, false);
});

test("unsaved Source blocks overwrite", () => {
  assert.equal(assess({ hasUnsavedChanges: true }).reason, "unsaved_source");
});

test("changed Source updated_at blocks overwrite", () => {
  assert.equal(assess({ freshDocumentUpdatedAt: "after" }).reason, "source_changed");
});

test("changed Source semantic hash blocks overwrite", () => {
  assert.equal(
    assess({ currentSourceSemanticHash: "other" }).reason,
    "source_changed",
  );
});

test("changed HA hash blocks overwrite", () => {
  assert.equal(assess({ currentHaSemanticHash: "other" }).reason, "ha_changed");
});

test("HA MODIFIED with matching Compare snapshot allows overwrite", () => {
  assert.equal(assess({ syncStatus: "HA MODIFIED" }).allowed, true);
});

test("BOTH MODIFIED with matching Compare snapshot allows overwrite", () => {
  assert.equal(assess({ syncStatus: "BOTH MODIFIED" }).allowed, true);
});

test("SOURCE MODIFIED is not applicable for conflict overwrite", () => {
  assert.equal(assess({ syncStatus: "SOURCE MODIFIED" }).reason, "not_applicable");
});

test("NOT DEPLOYED is not applicable for conflict overwrite", () => {
  assert.equal(assess({ syncStatus: "NOT DEPLOYED" }).reason, "not_applicable");
});

test("final HA hash change after confirmation blocks overwrite", () => {
  const result = assessFinalOverwriteRead({
    latestHaSemanticHash: "changed",
    preconfirmationHaSemanticHash: "ha-semantic",
    compareSnapshot: SNAPSHOT,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "ha_changed_during_confirmation");
});

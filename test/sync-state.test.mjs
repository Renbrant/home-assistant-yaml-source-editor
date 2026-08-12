import assert from "node:assert/strict";
import test from "node:test";

import { analyzeSourceText } from "../custom_components/ha_yaml_source_editor/frontend/source-validation.mjs";
import {
  DEPLOYMENT_STATUS,
  canonicalJson,
  classifySyncState,
} from "../custom_components/ha_yaml_source_editor/frontend/sync-state.mjs";

test("object key order canonicalizes identically", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test("nested object key order canonicalizes recursively", () => {
  assert.equal(
    canonicalJson({ z: { b: 2, a: 1 }, a: true }),
    canonicalJson({ a: true, z: { a: 1, b: 2 } }),
  );
});

test("arrays preserve order", () => {
  assert.notEqual(canonicalJson(["A", "B"]), canonicalJson(["B", "A"]));
});

test("formatting-only source changes keep semantic canonical JSON", () => {
  const sourceA = "# A\nviews: []\n";
  const sourceB = "# B\n\nviews: [ ]\n";

  assert.notEqual(sourceA, sourceB);
  assert.equal(
    canonicalJson(analyzeSourceText(sourceA).parsedConfig),
    canonicalJson(analyzeSourceText(sourceB).parsedConfig),
  );
});

test("semantic source changes alter canonical JSON", () => {
  assert.notEqual(
    canonicalJson(analyzeSourceText("views: []\n").parsedConfig),
    canonicalJson(analyzeSourceText("views:\n  - title: Main\n").parsedConfig),
  );
});

test("canonicalizer does not mutate input", () => {
  const input = { b: { d: 4, c: 3 }, a: 1 };
  const before = JSON.stringify(input);

  canonicalJson(input);

  assert.equal(JSON.stringify(input), before);
});

test("canonicalizer fails clearly for circular data", () => {
  const input = {};
  input.self = input;

  assert.throws(() => canonicalJson(input), /circular/i);
});

test("canonicalizer rejects non-finite numbers", () => {
  assert.throws(() => canonicalJson({ value: Infinity }), /non-finite/i);
});

test("no baseline always means not deployed", () => {
  assert.equal(
    classifySyncState({
      deploymentBaseline: null,
      currentSourceTextHash: "same",
      currentSourceSemanticHash: "same",
      currentHaSemanticHash: "same",
      sourceValid: true,
    }).status,
    DEPLOYMENT_STATUS.NOT_DEPLOYED,
  );

  assert.equal(
    classifySyncState({
      deploymentBaseline: null,
      currentSourceTextHash: "a",
      currentSourceSemanticHash: "b",
      currentHaSemanticHash: "c",
      sourceValid: true,
    }).status,
    DEPLOYMENT_STATUS.NOT_DEPLOYED,
  );
});

test("baseline state classifications", () => {
  const baseline = {
    source_text_hash: "text-a",
    source_semantic_hash: "sem-a",
    ha_semantic_hash: "ha-a",
  };

  assert.equal(
    classifySyncState({
      deploymentBaseline: baseline,
      currentSourceTextHash: "text-a",
      currentSourceSemanticHash: "sem-a",
      currentHaSemanticHash: "ha-a",
      sourceValid: true,
    }).status,
    DEPLOYMENT_STATUS.IN_SYNC,
  );

  assert.equal(
    classifySyncState({
      deploymentBaseline: baseline,
      currentSourceTextHash: "text-b",
      currentSourceSemanticHash: "sem-b",
      currentHaSemanticHash: "ha-a",
      sourceValid: true,
    }).status,
    DEPLOYMENT_STATUS.SOURCE_MODIFIED,
  );

  assert.equal(
    classifySyncState({
      deploymentBaseline: baseline,
      currentSourceTextHash: "text-a",
      currentSourceSemanticHash: "sem-a",
      currentHaSemanticHash: "ha-b",
      sourceValid: true,
    }).status,
    DEPLOYMENT_STATUS.HA_MODIFIED,
  );

  assert.equal(
    classifySyncState({
      deploymentBaseline: baseline,
      currentSourceTextHash: "text-b",
      currentSourceSemanticHash: "sem-b",
      currentHaSemanticHash: "ha-b",
      sourceValid: true,
    }).status,
    DEPLOYMENT_STATUS.BOTH_MODIFIED,
  );
});

test("formatting-only source change exposes semantic note", () => {
  const result = classifySyncState({
    deploymentBaseline: {
      source_text_hash: "text-a",
      source_semantic_hash: "sem-a",
      ha_semantic_hash: "ha-a",
    },
    currentSourceTextHash: "text-b",
    currentSourceSemanticHash: "sem-a",
    currentHaSemanticHash: "ha-a",
    sourceValid: true,
  });

  assert.equal(result.status, DEPLOYMENT_STATUS.SOURCE_MODIFIED);
  assert.match(result.note, /semantics are unchanged/);
});

test("missing required hash creates sync error when baseline exists", () => {
  assert.equal(
    classifySyncState({
      deploymentBaseline: {
        source_text_hash: "text-a",
        source_semantic_hash: "sem-a",
        ha_semantic_hash: "ha-a",
      },
      currentSourceTextHash: null,
      currentSourceSemanticHash: null,
      currentHaSemanticHash: "ha-a",
      sourceValid: false,
    }).status,
    DEPLOYMENT_STATUS.SYNC_ERROR,
  );
});

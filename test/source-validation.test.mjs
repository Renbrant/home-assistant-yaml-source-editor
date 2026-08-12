import assert from "node:assert/strict";
import test from "node:test";

import {
  validateLovelaceStructure,
  validateSourceText,
  validateWireCompatible,
} from "../custom_components/ha_yaml_source_editor/frontend/source-validation.mjs";

test("valid dashboard with comments and quoted strings", () => {
  const source = `# comment

views:
  - title: 'Main'
    cards:
      - type: custom:any-card
`;

  const result = validateSourceText(source);

  assert.equal(result.valid, true);
  assert.equal(result.summary.views, 1);
});

test("syntax error reports yaml failure with location when available", () => {
  const result = validateSourceText("views:\n  - title: Main\n    cards:\n      - type: entities\n       bad: true\n");

  assert.equal(result.valid, false);
  assert.equal(result.stage, "yaml");
  assert.equal(typeof result.message, "string");
  assert.equal(typeof result.line, "number");
});

test("root array is rejected as invalid Lovelace structure", () => {
  const result = validateSourceText("- one\n- two\n");

  assert.equal(result.valid, false);
  assert.equal(result.stage, "lovelace");
});

test("invalid views type is rejected", () => {
  const result = validateSourceText("views: hello\n");

  assert.equal(result.valid, false);
  assert.equal(result.stage, "lovelace");
  assert.match(result.message, /views/);
});

test("strategy config is valid", () => {
  const result = validateSourceText("strategy:\n  type: map\n");

  assert.equal(result.valid, true);
  assert.equal(result.summary.strategy, true);
});

test("custom cards remain opaque and valid", () => {
  const result = validateSourceText(`views:
  - cards:
      - type: custom:some-future-card
        completely_unknown_option: true
`);

  assert.equal(result.valid, true);
});

test("yaml timestamp is rejected as not JSON/WebSocket compatible", () => {
  const result = validateSourceText("views: []\ncreated: 2026-08-12\n");

  assert.equal(result.valid, false);
  assert.equal(result.stage, "wire");
  assert.match(result.message, /Date/);
  assert.equal(result.path, "$.created");
});

test("non-finite numbers are rejected", () => {
  const result = validateSourceText("views: []\nvalue: .inf\n");

  assert.equal(result.valid, false);
  assert.equal(result.stage, "wire");
});

test("source string is unchanged after validation", () => {
  const source = `# This comment must survive

title: "Test dashboard"

views:
  - title: 'Main'
    # Another comment
    cards:

      - type: entities
        title: "Quoted title"
`;
  const before = source.slice();

  validateSourceText(source);

  assert.equal(source, before);
});

test("repeated aliases are accepted but circular references are rejected", () => {
  const shared = { type: "entities" };

  assert.equal(validateWireCompatible({ cards: [shared, shared] }).valid, true);

  const circular = {};
  circular.self = circular;
  const result = validateWireCompatible(circular);

  assert.equal(result.valid, false);
  assert.equal(result.stage, "wire");
});

test("structure validator rejects empty strategy type", () => {
  const result = validateLovelaceStructure({ strategy: { type: "" } });

  assert.equal(result.valid, false);
  assert.equal(result.path, "$.strategy.type");
});

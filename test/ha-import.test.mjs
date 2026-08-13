import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJson,
} from "../custom_components/ha_yaml_source_editor/frontend/sync-state.mjs";
import {
  analyzeSourceText,
} from "../custom_components/ha_yaml_source_editor/frontend/source-validation.mjs";
import {
  haConfigToSourceYaml,
} from "../custom_components/ha_yaml_source_editor/frontend/ha-import.mjs";

function assertRoundTrip(value) {
  const before = JSON.stringify(value);
  const yaml = haConfigToSourceYaml(value);
  const analysis = analyzeSourceText(yaml);

  assert.equal(analysis.validation.valid, true);
  assert.equal(canonicalJson(analysis.parsedConfig), canonicalJson(value));
  assert.equal(JSON.stringify(value), before);
  return yaml;
}

test("simple Lovelace object round-trips semantically", () => {
  assertRoundTrip({
    views: [
      {
        title: "M8",
        cards: [{ type: "markdown", content: "Imported" }],
      },
    ],
  });
});

test("date-looking string remains a string", () => {
  const yaml = assertRoundTrip({
    views: [{ title: "2026-08-12", cards: [] }],
  });

  const parsed = analyzeSourceText(yaml).parsedConfig;
  assert.equal(typeof parsed.views[0].title, "string");
});

test("YAML-looking scalar strings preserve string semantics", () => {
  const values = ["yes", "no", "on", "off", "null", "true", "123"];

  const parsed = analyzeSourceText(assertRoundTrip({
    views: [{ title: "scalars", cards: [{ type: "markdown", content: values }] }],
  })).parsedConfig;

  assert.deepEqual(parsed.views[0].cards[0].content, values);
});

test("empty arrays and objects round-trip", () => {
  assertRoundTrip({
    views: [],
    badges: [],
    metadata: {},
  });
});

test("nested custom card config round-trips", () => {
  assertRoundTrip({
    views: [
      {
        title: "custom",
        cards: [
          {
            type: "custom:thing-card",
            options: {
              nested: { enabled: true, values: [1, "two", null] },
            },
          },
        ],
      },
    ],
  });
});

test("generated YAML is valid under existing Source analysis", () => {
  const yaml = haConfigToSourceYaml({ views: [{ title: "Valid", cards: [] }] });
  const analysis = analyzeSourceText(yaml);

  assert.equal(analysis.validation.valid, true);
});

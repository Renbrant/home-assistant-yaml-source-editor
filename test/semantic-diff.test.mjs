import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeThreeWay,
  diffSemantic,
  formatDiffKindForLabels,
} from "../custom_components/ha_yaml_source_editor/frontend/semantic-diff.mjs";

test("equal objects with different key order produce no differences", () => {
  const result = diffSemantic({ a: 1, b: 2 }, { b: 2, a: 1 });

  assert.equal(result.entries.length, 0);
  assert.equal(result.truncated, false);
});

test("changed scalar reports the root path", () => {
  const result = diffSemantic("source", "ha");

  assert.deepEqual(result.entries, [
    {
      path: "$",
      kind: "changed",
      sourceValue: "source",
      haValue: "ha",
    },
  ]);
});

test("source-only property is reported", () => {
  const result = diffSemantic({ a: 1 }, {});

  assert.equal(result.entries[0].kind, "source_only");
  assert.equal(result.entries[0].path, "$.a");
  assert.equal(result.entries[0].sourceValue, 1);
});

test("HA-only property is reported", () => {
  const result = diffSemantic({}, { a: 1 });

  assert.equal(result.entries[0].kind, "ha_only");
  assert.equal(result.entries[0].path, "$.a");
  assert.equal(result.entries[0].haValue, 1);
});

test("nested change uses the nested path", () => {
  const result = diffSemantic(
    { views: [{ cards: [{ content: "A" }] }] },
    { views: [{ cards: [{ content: "B" }] }] },
  );

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].kind, "changed");
  assert.equal(result.entries[0].path, "$.views[0].cards[0].content");
});

test("array order changes are indexed differences", () => {
  const result = diffSemantic(["a", "b"], ["b", "a"]);

  assert.deepEqual(
    result.entries.map((entry) => [entry.path, entry.kind]),
    [
      ["$[0]", "changed"],
      ["$[1]", "changed"],
    ],
  );
});

test("array length changes report indexed source-only and HA-only entries", () => {
  const sourceOnly = diffSemantic(["a", "b"], ["a"]);
  const haOnly = diffSemantic(["a"], ["a", "b"]);

  assert.equal(sourceOnly.entries[0].path, "$[1]");
  assert.equal(sourceOnly.entries[0].kind, "source_only");
  assert.equal(haOnly.entries[0].path, "$[1]");
  assert.equal(haOnly.entries[0].kind, "ha_only");
});

test("input objects are not mutated", () => {
  const source = { b: { z: 1 }, a: [2] };
  const ha = { a: [3], b: { z: 1 } };
  const sourceBefore = JSON.stringify(source);
  const haBefore = JSON.stringify(ha);

  diffSemantic(source, ha);

  assert.equal(JSON.stringify(source), sourceBefore);
  assert.equal(JSON.stringify(ha), haBefore);
});

test("circular data fails safely", () => {
  const source = {};
  source.self = source;

  assert.throws(
    () => diffSemantic(source, {}),
    /circular data/,
  );
});

test("diff limit truncates and reports omitted differences", () => {
  const source = {};
  const ha = {};
  for (let index = 0; index < 4; index += 1) {
    source[`k${index}`] = index;
    ha[`k${index}`] = index + 10;
  }

  const result = diffSemantic(source, ha, { limit: 2 });

  assert.equal(result.entries.length, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.totalDifferences, 4);
  assert.equal(result.omittedDifferences, 2);
});

test("three-way analysis reports only HA change", () => {
  const result = analyzeThreeWay({
    baselineValue: { content: "A" },
    sourceValue: { content: "A" },
    haValue: { content: "B" },
  });

  assert.equal(result.sourceChanges.entries.length, 0);
  assert.equal(result.haChanges.entries.length, 1);
  assert.equal(result.currentDifference.entries.length, 1);
});

test("three-way analysis reports only Source change", () => {
  const result = analyzeThreeWay({
    baselineValue: { content: "A" },
    sourceValue: { content: "B" },
    haValue: { content: "A" },
  });

  assert.equal(result.sourceChanges.entries.length, 1);
  assert.equal(result.haChanges.entries.length, 0);
  assert.equal(result.currentDifference.entries.length, 1);
});

test("three-way analysis reports both sides changed", () => {
  const result = analyzeThreeWay({
    baselineValue: { content: "A" },
    sourceValue: { content: "B" },
    haValue: { content: "C" },
  });

  assert.equal(result.sourceChanges.entries.length, 1);
  assert.equal(result.haChanges.entries.length, 1);
  assert.equal(result.currentDifference.entries.length, 1);
});

test("field added to Saved Source after deployment is presented as added", () => {
  const result = analyzeThreeWay({
    baselineValue: {},
    sourceValue: { title: "Saved" },
    haValue: {},
  });
  const entry = result.sourceChanges.entries[0];

  assert.equal(entry.kind, "ha_only");
  assert.equal(
    formatDiffKindForLabels(entry.kind, {
      sourceLabel: "Last deployed",
      haLabel: "Saved Source",
    }),
    "ADDED",
  );
});

test("field removed from Saved Source after deployment is presented as removed", () => {
  const result = analyzeThreeWay({
    baselineValue: { title: "Old" },
    sourceValue: {},
    haValue: { title: "Old" },
  });
  const entry = result.sourceChanges.entries[0];

  assert.equal(entry.kind, "source_only");
  assert.equal(
    formatDiffKindForLabels(entry.kind, {
      sourceLabel: "Last deployed",
      haLabel: "Saved Source",
    }),
    "REMOVED",
  );
});

test("field added directly in HA is presented as added", () => {
  const result = analyzeThreeWay({
    baselineValue: {},
    sourceValue: {},
    haValue: { title: "HA" },
  });
  const entry = result.haChanges.entries[0];

  assert.equal(entry.kind, "ha_only");
  assert.equal(
    formatDiffKindForLabels(entry.kind, {
      sourceLabel: "Last deployed",
      haLabel: "Current HA",
    }),
    "ADDED",
  );
});

test("field removed directly in HA is presented as removed", () => {
  const result = analyzeThreeWay({
    baselineValue: { title: "Old" },
    sourceValue: { title: "Old" },
    haValue: {},
  });
  const entry = result.haChanges.entries[0];

  assert.equal(entry.kind, "source_only");
  assert.equal(
    formatDiffKindForLabels(entry.kind, {
      sourceLabel: "Last deployed",
      haLabel: "Current HA",
    }),
    "REMOVED",
  );
});

test("changed value is presented as changed", () => {
  const result = diffSemantic({ title: "Source" }, { title: "HA" });
  const entry = result.entries[0];

  assert.equal(entry.kind, "changed");
  assert.equal(
    formatDiffKindForLabels(entry.kind, {
      sourceLabel: "Saved Source",
      haLabel: "Current HA",
    }),
    "CHANGED",
  );
});

test("direct Source vs HA source-only field keeps source-only label", () => {
  const result = diffSemantic({ title: "Source" }, {});
  const entry = result.entries[0];

  assert.equal(entry.kind, "source_only");
  assert.equal(
    formatDiffKindForLabels(entry.kind, {
      sourceLabel: "Saved Source",
      haLabel: "Current HA",
    }),
    "SOURCE ONLY",
  );
});

test("direct Source vs HA HA-only field keeps HA-only label", () => {
  const result = diffSemantic({}, { title: "HA" });
  const entry = result.entries[0];

  assert.equal(entry.kind, "ha_only");
  assert.equal(
    formatDiffKindForLabels(entry.kind, {
      sourceLabel: "Saved Source",
      haLabel: "Current HA",
    }),
    "HA ONLY",
  );
});

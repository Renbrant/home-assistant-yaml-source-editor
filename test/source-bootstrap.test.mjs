import assert from "node:assert/strict";
import test from "node:test";

import {
  isBlankSourceText,
} from "../custom_components/ha_yaml_source_editor/frontend/source-bootstrap.mjs";

test("blank Source bootstrap detection allows only empty or whitespace-only text", () => {
  assert.equal(isBlankSourceText(""), true);
  assert.equal(isBlankSourceText(" \n\t\r"), true);
  assert.equal(isBlankSourceText(null), true);
  assert.equal(isBlankSourceText(undefined), true);

  assert.equal(isBlankSourceText("# My preserved notes\n"), false);
  assert.equal(isBlankSourceText("views: []\n"), false);
  assert.equal(isBlankSourceText("---\n"), false);
});

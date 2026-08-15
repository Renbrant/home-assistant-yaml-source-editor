import assert from "node:assert/strict";
import test from "node:test";

import {
  findTemplateBlock,
  findTemplateEntity,
  templateBlockDocumentId,
  templateEntityLocalLine,
} from "../custom_components/ha_yaml_source_editor/frontend/template-source-logic.mjs";

const index = {
  source: {
    sha256: "a".repeat(64),
  },
  blocks: [
    {
      block_id: "block:4",
      start_line: 83,
      end_line: 115,
      label: "HVAC BEDROOM BALANCING",
      entities: [
        {
          entity_id: "entity:bed_1",
          name: "Bed 1",
          start_line: 88,
        },
        {
          entity_id: "entity:bed_2",
          name: "Bed 2",
          start_line: 93,
        },
      ],
    },
  ],
};

test("findTemplateBlock resolves only the requested indexed block", () => {
  assert.equal(
    findTemplateBlock(index, "block:4")?.label,
    "HVAC BEDROOM BALANCING"
  );
  assert.equal(findTemplateBlock(index, "block:not-real"), null);
});

test("findTemplateEntity resolves a child navigation target", () => {
  const block = findTemplateBlock(index, "block:4");

  assert.equal(
    findTemplateEntity(block, "entity:bed_2")?.name,
    "Bed 2"
  );
  assert.equal(findTemplateEntity(block, "entity:not-real"), null);
});

test("template document identity binds block to source snapshot", () => {
  assert.equal(
    templateBlockDocumentId({
      source: index.source,
      block: index.blocks[0],
    }),
    `template:${"a".repeat(64)}:block:4`
  );

  assert.equal(templateBlockDocumentId({}), null);
});

test("entity physical line is translated to local block editor line", () => {
  const block = index.blocks[0];

  assert.equal(
    templateEntityLocalLine(block, "entity:bed_1"),
    6
  );
  assert.equal(
    templateEntityLocalLine(block, "entity:bed_2"),
    11
  );
  assert.equal(
    templateEntityLocalLine(block, "entity:not-real"),
    null
  );
});

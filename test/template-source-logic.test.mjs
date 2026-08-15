import assert from "node:assert/strict";
import test from "node:test";

import {
  filterTemplateBlocks,
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

const searchIndex = {
  blocks: [
    {
      block_id: "block:comfort",
      label: "COMFORT",
      section: "COMFORT",
      entities: [
        {
          entity_id: "entity:comfort_ok",
          name: "Dev Comfort OK",
          unique_id: "dev_comfort_ok",
        },
        {
          entity_id: "entity:living_temp",
          name: "Dev Living Room Temperature",
          unique_id: "dev_living_room_temperature",
        },
      ],
    },
    {
      block_id: "block:hvac",
      label: "HVAC BEDROOM BALANCING",
      section: "HVAC BEDROOM BALANCING",
      entities: [
        {
          entity_id: "entity:bed_1",
          name: "Dev Bed 1 Temperature Delta",
          unique_id: "dev_bed_1_temperature_delta",
        },
        {
          entity_id: "entity:bed_2",
          name: "Dev Bed 2 Temperature Delta",
          unique_id: "dev_bed_2_temperature_delta",
        },
        {
          entity_id: "entity:target_speed",
          name: "Dev Bed 2 Booster Target Speed",
          unique_id: "dev_bed_2_booster_target_speed",
        },
      ],
    },
  ],
};

test("blank Template search keeps every indexed block", () => {
  assert.deepEqual(
    filterTemplateBlocks(searchIndex, "   "),
    searchIndex.blocks
  );
});

test("Template search matches entity name and unique_id", () => {
  const byName = filterTemplateBlocks(
    searchIndex,
    "bed 2 temperature"
  );

  assert.equal(byName.length, 1);
  assert.equal(byName[0].block_id, "block:hvac");
  assert.deepEqual(
    byName[0].entities.map((entity) => entity.entity_id),
    ["entity:bed_2"]
  );

  const byUniqueId = filterTemplateBlocks(
    searchIndex,
    "dev_bed_2_booster_target_speed"
  );

  assert.equal(byUniqueId.length, 1);
  assert.deepEqual(
    byUniqueId[0].entities.map((entity) => entity.entity_id),
    ["entity:target_speed"]
  );
});

test("Template section match preserves all children", () => {
  const result = filterTemplateBlocks(
    searchIndex,
    "comfort"
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].block_id, "block:comfort");
  assert.equal(result[0].entities.length, 2);
});

test("Template search combines parent context with child terms", () => {
  const result = filterTemplateBlocks(
    searchIndex,
    "hvac target speed"
  );

  assert.equal(result.length, 1);
  assert.deepEqual(
    result[0].entities.map((entity) => entity.entity_id),
    ["entity:target_speed"]
  );

  assert.deepEqual(
    filterTemplateBlocks(searchIndex, "does-not-exist"),
    []
  );
});

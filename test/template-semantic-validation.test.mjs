import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const integration = join(
  root,
  "custom_components",
  "ha_yaml_source_editor",
);

const semanticPath = join(
  integration,
  "template_validation.py",
);

const websocketPath = join(
  integration,
  "websocket.py",
);

const constPath = join(
  integration,
  "const.py",
);

test("Template semantic validation uses Home Assistant loader and Template validator", async () => {
  const source = await readFile(semanticPath, "utf8");

  assert.match(
    source,
    /from homeassistant\.util\.yaml import Secrets, parse_yaml/,
  );

  assert.match(
    source,
    /from homeassistant\.components\.template\.config import[\s\S]*async_validate_config_section/,
  );

  assert.match(
    source,
    /Secrets\([\s\S]*config_root/,
  );

  assert.match(
    source,
    /parse_yaml\([\s\S]*source_text[\s\S]*secrets/,
  );

  assert.match(
    source,
    /await async_validate_config_section\(/,
  );
});

test("Template semantic validation never serializes or writes YAML", async () => {
  const source = await readFile(semanticPath, "utf8");

  assert.doesNotMatch(
    source,
    /\bdump\s*\(|write_text|write_bytes|os\.replace|open\s*\(/,
  );
});

test("Template validate WebSocket is admin-only and cannot commit", async () => {
  const source = await readFile(websocketPath, "utf8");

  const functionStart = source.indexOf(
    "async def websocket_templates_block_validate("
  );

  assert.notEqual(
    functionStart,
    -1,
    "Missing Template validation WebSocket",
  );

  const decoratorStart = source.lastIndexOf(
    "@websocket_api.require_admin",
    functionStart,
  );

  assert.notEqual(
    decoratorStart,
    -1,
    "Template validation WebSocket must require admin",
  );

  const nextCommand = source.indexOf(
    "@websocket_api.require_admin",
    functionStart + 1,
  );

  const endpoint = source.slice(
    decoratorStart,
    nextCommand === -1 ? source.length : nextCommand,
  );

  assert.match(
    endpoint,
    /prepare_template_block_save/,
  );

  assert.match(
    endpoint,
    /async_validate_prepared_template_save/,
  );

  assert.doesNotMatch(
    endpoint,
    /commit_prepared_template_block_save|save_template_block\(/,
  );

  assert.match(
    endpoint,
    /template_semantic_invalid/,
  );
});

test("Template validate WebSocket constant and registration are present", async () => {
  const constants = await readFile(constPath, "utf8");
  const websocket = await readFile(websocketPath, "utf8");

  assert.match(
    constants,
    /WS_TYPE_TEMPLATES_BLOCK_VALIDATE = f"\{DOMAIN\}\/templates\/block\/validate"/,
  );

  assert.match(
    websocket,
    /async_register_command\(hass, websocket_templates_block_validate\)/,
  );
});

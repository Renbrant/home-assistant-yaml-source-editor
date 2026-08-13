import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const integrationDir = join(root, "custom_components", "ha_yaml_source_editor");

test("manifest and const version match v0.1.1", async () => {
  const manifest = JSON.parse(
    await readFile(join(integrationDir, "manifest.json"), "utf8"),
  );
  const constants = await readFile(join(integrationDir, "const.py"), "utf8");
  const versionMatch = constants.match(/^VERSION = "([^"]+)"$/m);

  assert.equal(manifest.version, "0.1.1");
  assert.equal(versionMatch?.[1], manifest.version);
});

test("manifest metadata is truthful for a custom integration service", async () => {
  const manifest = JSON.parse(
    await readFile(join(integrationDir, "manifest.json"), "utf8"),
  );

  assert.equal(manifest.domain, "ha_yaml_source_editor");
  assert.equal(manifest.config_flow, true);
  assert.equal(manifest.single_config_entry, true);
  assert.equal(manifest.integration_type, "service");
  assert.equal(manifest.iot_class, "calculated");
  assert.deepEqual(manifest.dependencies, ["frontend", "http", "panel_custom"]);
  assert.deepEqual(manifest.codeowners, ["@Renbrant"]);
});

test("integration declares config-entry-only YAML schema", async () => {
  const init = await readFile(join(integrationDir, "__init__.py"), "utf8");

  assert.match(
    init,
    /CONFIG_SCHEMA = cv\.config_entry_only_config_schema\(DOMAIN\)/,
  );
});

test("custom integration English translations are complete without strings.json", async () => {
  const translations = JSON.parse(
    await readFile(join(integrationDir, "translations", "en.json"), "utf8"),
  );

  assert.equal(existsSync(join(integrationDir, "strings.json")), false);
  assert.equal(
    translations.config.step.user.title,
    "HA YAML Source Editor",
  );
  assert.equal(
    translations.config.abort.already_configured,
    "HA YAML Source Editor is already configured.",
  );
});

test("required runtime frontend vendor assets exist", () => {
  assert.equal(
    existsSync(join(integrationDir, "frontend", "vendor", "js-yaml.mjs")),
    true,
  );
  assert.equal(
    existsSync(join(integrationDir, "frontend", "vendor", "js-yaml.LICENSE")),
    true,
  );
});

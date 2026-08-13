import { dump, YAML11_SCHEMA } from "./vendor/js-yaml.mjs";

export const MAX_IMPORTED_SOURCE_BYTES = 2 * 1024 * 1024;

export function haConfigToSourceYaml(haConfig) {
  return dump(haConfig, {
    schema: YAML11_SCHEMA,
    noRefs: true,
  });
}

export function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

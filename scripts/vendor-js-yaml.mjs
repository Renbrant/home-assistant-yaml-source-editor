import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(
  root,
  "custom_components",
  "ha_yaml_source_editor",
  "frontend",
  "vendor",
);

await mkdir(vendorDir, { recursive: true });
await copyFile(
  join(root, "node_modules", "js-yaml", "dist", "js-yaml.mjs"),
  join(vendorDir, "js-yaml.mjs"),
);
await copyFile(
  join(root, "node_modules", "js-yaml", "LICENSE"),
  join(vendorDir, "js-yaml.LICENSE"),
);

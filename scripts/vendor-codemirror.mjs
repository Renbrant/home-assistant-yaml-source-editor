import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(
  root,
  "custom_components",
  "ha_yaml_source_editor",
  "frontend",
  "vendor",
);

const packages = [
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/commands",
  "@codemirror/search",
  "@codemirror/language",
  "@codemirror/lang-yaml",
  "@codemirror/lint",
  "@lezer/highlight",
];

const entry = `
export {
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
export {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
export {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
export {
  closeSearchPanel,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
export {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
export { yaml } from "@codemirror/lang-yaml";
export { lintKeymap } from "@codemirror/lint";
export { tags } from "@lezer/highlight";
`;

await mkdir(vendorDir, { recursive: true });

await esbuild.build({
  bundle: true,
  format: "esm",
  legalComments: "eof",
  outfile: join(vendorDir, "codemirror.mjs"),
  stdin: {
    contents: entry,
    loader: "js",
    resolveDir: root,
    sourcefile: "codemirror-entry.mjs",
  },
});

const licenseLines = [
  "Vendored CodeMirror runtime bundle.",
  "",
  "Generated from npm packages:",
];

for (const packageName of packages) {
  const packageJson = JSON.parse(
    await readFile(join(root, "node_modules", packageName, "package.json"), "utf8"),
  );
  licenseLines.push(`- ${packageName}@${packageJson.version}: ${packageJson.license}`);
}

licenseLines.push(
  "",
  "The bundled CodeMirror and Lezer packages are distributed under permissive open-source licenses.",
  "See the corresponding npm packages for full license text.",
  "",
);

await writeFile(join(vendorDir, "codemirror.LICENSE"), licenseLines.join("\n"));

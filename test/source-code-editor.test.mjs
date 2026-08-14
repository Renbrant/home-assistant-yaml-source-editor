import assert from "node:assert/strict";
import test from "node:test";

import {
  editorStatusFromText,
  editorTextFromDocument,
  handleSourceEditorKeydown,
  shouldNotifyEditorChange,
  shouldRestoreEditorViewportSnapshot,
  stopHostKeydownPropagation,
} from "../custom_components/ha_yaml_source_editor/frontend/source-code-editor.mjs";

test("editor text helper preserves source text exactly", () => {
  const sourceText = [
    "# keep this comment",
    "",
    "views:",
    "  - title: \"Main\"",
    "    path: main",
    "    cards:",
    "      - type: entities",
    "        title: 'Quoted value'",
    "",
    "",
  ].join("\n");

  assert.equal(editorTextFromDocument(sourceText), sourceText);
});

test("editor text helper preserves trailing newline exactly", () => {
  const sourceText = "views:\n  - title: Main\n";

  assert.equal(editorTextFromDocument(sourceText), sourceText);
});

test("programmatic document replacement is not reported as a user edit", () => {
  assert.equal(
    shouldNotifyEditorChange({ docChanged: true, programmaticUpdate: true }),
    false
  );
  assert.equal(
    shouldNotifyEditorChange({ docChanged: true, programmaticUpdate: false }),
    true
  );
  assert.equal(
    shouldNotifyEditorChange({ docChanged: false, programmaticUpdate: false }),
    false
  );
});

test("editor status reports one-based line and column", () => {
  const sourceText = "views:\n  - title: Main\n";

  assert.deepEqual(editorStatusFromText(sourceText, 0), {
    line: 1,
    column: 1,
    lineCount: 3,
  });
  assert.deepEqual(editorStatusFromText(sourceText, 9), {
    line: 2,
    column: 3,
    lineCount: 3,
  });
  assert.deepEqual(editorStatusFromText(sourceText, sourceText.length), {
    line: 3,
    column: 1,
    lineCount: 3,
  });
});

test("editor keydown isolation stops host propagation without claiming the key", () => {
  const keyCases = [
    { key: "e" },
    { key: "f", ctrlKey: true },
    { key: "f", metaKey: true },
    { key: "z", ctrlKey: true },
    { key: "y", ctrlKey: true },
    { key: "Enter" },
    { key: "Backspace" },
    { key: "Tab" },
    { key: "Tab", shiftKey: true },
  ];

  for (const keyCase of keyCases) {
    let stopped = false;
    let defaultPrevented = false;
    const event = {
      ...keyCase,
      stopPropagation() {
        stopped = true;
      },
      preventDefault() {
        defaultPrevented = true;
      },
    };

    assert.equal(stopHostKeydownPropagation(event), false);
    assert.equal(stopped, true);
    assert.equal(defaultPrevented, false);
  }
});

test("editor keydown handler uses CodeMirror event-view argument order", () => {
  let stopped = false;
  let viewStopCalled = false;
  const event = {
    key: "e",
    stopPropagation() {
      stopped = true;
    },
    preventDefault() {
      throw new Error("keydown isolation must not prevent default");
    },
  };
  const view = {
    stopPropagation() {
      viewStopCalled = true;
      throw new Error("EditorView was used as the event");
    },
  };

  assert.equal(handleSourceEditorKeydown(event, view), false);
  assert.equal(stopped, true);
  assert.equal(viewStopCalled, false);
});

test("editor viewport snapshot restores only for the same editor and document", () => {
  const editor = {};
  const replacementEditor = {};
  const effect = {};
  const snapshot = {
    editor,
    documentId: "source-document-1",
    effect,
  };

  assert.equal(
    shouldRestoreEditorViewportSnapshot(snapshot, {
      editor,
      documentId: "source-document-1",
    }),
    true
  );
  assert.equal(
    shouldRestoreEditorViewportSnapshot(snapshot, {
      editor,
      documentId: "source-document-2",
    }),
    false
  );
  assert.equal(
    shouldRestoreEditorViewportSnapshot(snapshot, {
      editor: replacementEditor,
      documentId: "source-document-1",
    }),
    false
  );
  assert.equal(
    shouldRestoreEditorViewportSnapshot(null, {
      editor,
      documentId: "source-document-1",
    }),
    false
  );
});

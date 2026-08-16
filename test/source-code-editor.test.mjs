import assert from "node:assert/strict";
import test from "node:test";

import {
  EditorState,
} from "../custom_components/ha_yaml_source_editor/frontend/vendor/codemirror.mjs";

import {
  editorContentAttributes,
  editorLineSeparatorFromText,
  editorStatusFromText,
  editorTextFromDocument,
  editorTextFromState,
  handleSourceEditorKeydown,
  shouldNotifyEditorChange,
  shouldRestoreEditorFocusSnapshot,
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

test("editor detects uniform physical line separators without guessing mixed files", () => {
  assert.equal(
    editorLineSeparatorFromText(
      "first\r\nsecond\r\n"
    ),
    "\r\n"
  );

  assert.equal(
    editorLineSeparatorFromText(
      "first\nsecond\n"
    ),
    "\n"
  );

  assert.equal(
    editorLineSeparatorFromText(
      "first\rsecond\r"
    ),
    "\r"
  );

  assert.equal(
    editorLineSeparatorFromText(
      "single line"
    ),
    null
  );

  assert.equal(
    editorLineSeparatorFromText(
      "first\r\nsecond\nthird\r\n"
    ),
    null
  );
});

test("CodeMirror round-trips a CRLF document through an edit without normalization", () => {
  const original =
    "- sensor:\r\n" +
    "    - name: Original\r\n" +
    "      unique_id: original\r\n" +
    "      state: \"{{ 1 }}\"\r\n";

  const separator =
    editorLineSeparatorFromText(original);

  assert.equal(separator, "\r\n");

  const state = EditorState.create({
    doc: original,
    extensions: [
      EditorState.lineSeparator.of(separator),
    ],
  });

  assert.equal(state.lineBreak, "\r\n");
  assert.equal(
    editorTextFromState(state),
    original
  );

  // CodeMirror document coordinates count a logical line break as one
  // position even when the physical separator is CRLF.
  const nameLine = state.doc.line(2);

  const from =
    nameLine.from +
    "    - name: ".length;

  assert.equal(
    state.sliceDoc(
      from,
      from + "Original".length
    ),
    "Original"
  );

  const transaction = state.update({
    changes: {
      from,
      to: from + "Original".length,
      insert: "Changed",
    },
  });

  const expected =
    original.replace("Original", "Changed");

  assert.equal(
    transaction.state.lineBreak,
    "\r\n"
  );

  assert.equal(
    editorTextFromState(transaction.state),
    expected
  );

  assert.equal(
    Buffer.from(
      editorTextFromState(transaction.state),
      "utf8"
    ).equals(
      Buffer.from(expected, "utf8")
    ),
    true
  );
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

test("read-only editor remains focusable for keyboard isolation", () => {
  assert.deepEqual(
    editorContentAttributes(true),
    { tabindex: "0" }
  );

  assert.deepEqual(
    editorContentAttributes(false),
    {}
  );
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
      throw new Error("EditorView was incorrectly treated as the event");
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

test("editor focus snapshot restores only for same focused editor and document", () => {
  const editor = {};
  const replacementEditor = {};
  const effect = {};
  const snapshot = {
    editor,
    documentId: "source-document-1",
    hadFocus: true,
    effect,
  };

  assert.equal(
    shouldRestoreEditorFocusSnapshot(snapshot, {
      editor,
      documentId: "source-document-1",
    }),
    true
  );
  assert.equal(
    shouldRestoreEditorFocusSnapshot({ ...snapshot, hadFocus: false }, {
      editor,
      documentId: "source-document-1",
    }),
    false
  );
  assert.equal(
    shouldRestoreEditorFocusSnapshot(snapshot, {
      editor,
      documentId: "source-document-2",
    }),
    false
  );
  assert.equal(
    shouldRestoreEditorFocusSnapshot(snapshot, {
      editor: replacementEditor,
      documentId: "source-document-1",
    }),
    false
  );
});

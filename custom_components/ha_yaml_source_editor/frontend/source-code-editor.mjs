import {
  Decoration,
  EditorState,
  EditorView,
  HighlightStyle,
  Prec,
  bracketMatching,
  defaultHighlightStyle,
  defaultKeymap,
  drawSelection,
  foldGutter,
  foldKeymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSelectionMatches,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  keymap,
  lineNumbers,
  lintKeymap,
  search,
  searchKeymap,
  syntaxHighlighting,
  tags,
  ViewPlugin,
  yaml,
} from "./vendor/codemirror.mjs";

export function createSourceCodeEditor({
  parent,
  doc,
  onChange,
  onStatusChange,
}) {
  return new SourceCodeEditor({ parent, doc, onChange, onStatusChange });
}

export function editorStatusFromText(text, position = 0) {
  const safePosition = Math.max(0, Math.min(position, text.length));
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < safePosition; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return {
    line,
    column: safePosition - lineStart + 1,
    lineCount: text.length === 0 ? 1 : text.split("\n").length,
  };
}

export function editorTextFromDocument(text) {
  return text;
}

export function shouldNotifyEditorChange({ docChanged, programmaticUpdate }) {
  return Boolean(docChanged && !programmaticUpdate);
}

export function stopHostKeydownPropagation(event) {
  event.stopPropagation();
  return false;
}

export function handleSourceEditorKeydown(event, _view) {
  return stopHostKeydownPropagation(event);
}

class SourceCodeEditor {
  constructor({ parent, doc, onChange, onStatusChange }) {
    this._onChange = onChange;
    this._onStatusChange = onStatusChange;
    this._programmaticUpdate = false;
    this._extensions = this._createExtensions();

    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: this._extensions,
      }),
    });

    this._emitStatus(this.view.state);
  }

  _createExtensions() {
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      history(),
      drawSelection(),
      yaml(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(sourceYamlHighlightStyle),
      indentationGuides(),
      sourceEditorTheme,
      Prec.high(
        EditorView.domEventHandlers({
          keydown: handleSourceEditorKeydown,
        })
      ),
      keymap.of([
        { key: "Tab", run: indentMore },
        { key: "Shift-Tab", run: indentLess },
        ...searchKeymap,
        ...foldKeymap,
        ...historyKeymap,
        ...lintKeymap,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (shouldNotifyEditorChange({
          docChanged: update.docChanged,
          programmaticUpdate: this._programmaticUpdate,
        })) {
          this._onChange?.(update.state.doc.toString());
        }

        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this._emitStatus(update.state);
        }
      }),
    ];
  }

  attach(parent) {
    if (this.view.dom.parentElement !== parent) {
      parent.appendChild(this.view.dom);
    }
  }

  destroy() {
    this.view.destroy();
  }

  focus() {
    this.view.focus();
  }

  hasFocus() {
    return this.view.hasFocus;
  }

  getText() {
    return this.view.state.doc.toString();
  }

  status() {
    const head = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(head);
    return {
      line: line.number,
      column: head - line.from + 1,
      lineCount: this.view.state.doc.lines,
    };
  }

  setText(text) {
    this.replaceText(text);
  }

  replaceText(text, { resetHistory = false } = {}) {
    if (resetHistory) {
      this._programmaticUpdate = true;
      this.view.setState(EditorState.create({
        doc: text,
        extensions: this._extensions,
      }));
      this._programmaticUpdate = false;
      this._emitStatus(this.view.state);
      return;
    }

    if (this.getText() === text) {
      this._emitStatus(this.view.state);
      return;
    }

    this._programmaticUpdate = true;
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: text,
      },
      selection: { anchor: 0 },
    });
    this._programmaticUpdate = false;
    this._emitStatus(this.view.state);
  }

  _emitStatus(state) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    this._onStatusChange?.({
      line: line.number,
      column: head - line.from + 1,
      lineCount: state.doc.lines,
    });
  }
}

const sourceYamlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#93c5fd" },
  { tag: tags.atom, color: "#f9a8d4" },
  { tag: tags.bool, color: "#f9a8d4" },
  { tag: tags.number, color: "#fbbf24" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.name, color: "#bfdbfe" },
  { tag: tags.propertyName, color: "#7dd3fc" },
  { tag: tags.comment, color: "#94a3b8", fontStyle: "italic" },
  { tag: tags.punctuation, color: "#cbd5e1" },
  { tag: tags.bracket, color: "#e2e8f0" },
  { tag: tags.invalid, color: "#fecaca" },
]);

const sourceEditorTheme = EditorView.theme(
  {
    "&": {
      minHeight: "360px",
      color: "var(--primary-text-color, #e5e7eb)",
      backgroundColor: "var(--code-editor-background-color, var(--card-background-color, #111111))",
      fontSize: "13px",
      fontFamily: "var(--code-font-family, Consolas, monospace)",
    },
    ".cm-scroller": {
      minHeight: "360px",
      maxHeight: "70vh",
      overflow: "auto",
      resize: "vertical",
      fontFamily: "inherit",
      lineHeight: "1.55",
    },
    ".cm-content": {
      caretColor: "var(--primary-text-color, #f8fafc)",
      padding: "12px 0",
    },
    ".cm-line": {
      padding: "0 16px",
    },
    ".cm-gutters": {
      backgroundColor: "var(--secondary-background-color, rgba(127, 127, 127, 0.08))",
      color: "var(--secondary-text-color, #64748b)",
      borderRight: "1px solid var(--divider-color, rgba(127, 127, 127, 0.25))",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(127, 127, 127, 0.08)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(127, 127, 127, 0.08)",
      color: "var(--primary-text-color, #cbd5e1)",
    },
    ".cm-foldGutter span": {
      cursor: "pointer",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(59, 130, 246, 0.45)",
    },
    "&.cm-focused": {
      outline: "2px solid var(--primary-color)",
      outlineOffset: "2px",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "rgba(250, 204, 21, 0.25)",
      outline: "1px solid rgba(250, 204, 21, 0.55)",
    },
    ".cm-panels": {
      color: "var(--primary-text-color, #e5e7eb)",
      backgroundColor: "var(--card-background-color, #111111)",
      borderColor: "var(--divider-color, rgba(127, 127, 127, 0.25))",
      boxShadow: "var(--ha-card-box-shadow, none)",
      fontFamily: "var(--primary-font-family, inherit)",
    },
    ".cm-search": {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px 8px",
      alignItems: "center",
      padding: "8px 10px",
      backgroundColor: "var(--card-background-color, #111111)",
      color: "var(--primary-text-color, #e5e7eb)",
      borderTop: "1px solid var(--divider-color, rgba(127, 127, 127, 0.25))",
      lineHeight: "1.4",
    },
    ".cm-search input": {
      color: "var(--primary-text-color, #e5e7eb)",
      backgroundColor: "var(--input-fill-color, var(--secondary-background-color, transparent))",
      border: "1px solid var(--divider-color, rgba(127, 127, 127, 0.35))",
      borderRadius: "4px",
      padding: "4px 8px",
      outline: "none",
      minHeight: "28px",
      boxSizing: "border-box",
    },
    ".cm-search input[type='text']": {
      width: "min(220px, 32vw)",
      minWidth: "140px",
    },
    ".cm-search input::placeholder": {
      color: "var(--secondary-text-color, #94a3b8)",
    },
    ".cm-search input:focus": {
      borderColor: "var(--primary-color, #03a9f4)",
      boxShadow: "0 0 0 1px var(--primary-color, #03a9f4)",
    },
    ".cm-search button, .cm-search button[name='close']": {
      appearance: "none",
      WebkitAppearance: "none",
      color: "var(--primary-text-color, #e5e7eb)",
      background: "var(--secondary-background-color, color-mix(in srgb, var(--card-background-color, #111111) 88%, var(--primary-text-color, #e5e7eb) 12%))",
      backgroundImage: "none",
      border: "1px solid var(--divider-color, rgba(127, 127, 127, 0.35))",
      borderRadius: "4px",
      padding: "4px 8px",
      minHeight: "28px",
      font: "inherit",
      lineHeight: "1.2",
      whiteSpace: "nowrap",
      cursor: "pointer",
    },
    ".cm-search button:hover": {
      background: "color-mix(in srgb, var(--secondary-background-color, transparent) 80%, var(--primary-color, #03a9f4) 20%)",
      backgroundImage: "none",
    },
    ".cm-search button:focus-visible": {
      backgroundImage: "none",
      outline: "2px solid var(--primary-color, #03a9f4)",
      outlineOffset: "1px",
    },
    ".cm-search button:disabled": {
      color: "var(--disabled-text-color, var(--secondary-text-color, #94a3b8))",
      background: "var(--disabled-color, color-mix(in srgb, var(--secondary-background-color, transparent) 70%, var(--card-background-color, #111111) 30%))",
      backgroundImage: "none",
      borderColor: "var(--divider-color, rgba(127, 127, 127, 0.25))",
      cursor: "default",
      opacity: "0.65",
    },
    ".cm-search button:disabled:hover": {
      background: "var(--disabled-color, color-mix(in srgb, var(--secondary-background-color, transparent) 70%, var(--card-background-color, #111111) 30%))",
      backgroundImage: "none",
    },
    ".cm-search label": {
      color: "var(--secondary-text-color, #94a3b8)",
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      whiteSpace: "nowrap",
    },
    ".cm-search input[type='checkbox']": {
      accentColor: "var(--primary-color, #03a9f4)",
      margin: "0",
      minHeight: "auto",
      width: "14px",
      height: "14px",
    },
    ".cm-search button[name='close']": {
      marginLeft: "auto",
      color: "var(--secondary-text-color, #94a3b8)",
      paddingInline: "8px",
    },
    ".cm-search button[name='close']:hover": {
      color: "var(--primary-text-color, #e5e7eb)",
    },
  },
);

function indentationGuides() {
  const guideDecoration = Decoration.mark({
    class: "cm-indent-guide",
  });

  return [
    EditorView.theme({
      ".cm-indent-guide": {
        backgroundImage:
          "linear-gradient(to right, color-mix(in srgb, var(--divider-color, #9ca3af) 55%, transparent) 1px, transparent 1px)",
        backgroundPosition: "left top",
        backgroundRepeat: "no-repeat",
        backgroundSize: "1px 100%",
      },
    }),
    ViewPlugin.fromClass(class {
      constructor(view) {
        this.decorations = buildIndentGuideDecorations(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildIndentGuideDecorations(update.view);
        }
      }
    }, {
      decorations: (plugin) => plugin.decorations,
    }),
  ];

  function buildIndentGuideDecorations(view) {
    const builder = [];
    for (const { from, to } of view.visibleRanges) {
      for (let position = from; position <= to;) {
        const line = view.state.doc.lineAt(position);
        const indentLength = leadingSpaces(line.text);
        for (let column = 0; column < indentLength; column += 2) {
          builder.push(
            guideDecoration.range(line.from + column, line.from + column + 1)
          );
        }
        position = line.to + 1;
      }
    }
    return Decoration.set(builder);
  }

  function leadingSpaces(text) {
    const match = text.match(/^ +/);
    return match ? match[0].length : 0;
  }
}

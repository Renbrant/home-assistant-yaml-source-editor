# Changelog

## [0.1.1] - 2026-08-13

Professional YAML editor UX release.

### Added

- Professional Source YAML editor powered by a locally vendored CodeMirror 6 runtime.
- YAML syntax highlighting.
- Line numbers and YAML block folding.
- Indentation guides.
- Active-line highlighting.
- Search and replace with `Ctrl+F`.
- Tab and Shift+Tab indentation controls.
- Undo and redo with isolated history between Source Documents.
- Editor status bar showing line, column, line count, YAML mode, LF mode, and
  Saved/Modified state.
- Home Assistant theme-aware editor and search UI.

### Improved

- Source editor focus, cursor, selection, scroll position, and undo history are
  preserved during normal synchronization refreshes.
- Home Assistant global keyboard shortcuts no longer intercept normal typing
  inside the Source editor.
- Deterministic frontend asset identity now changes with the integration version
  and frontend revision.
- Semantic Compare labels now distinguish historical `ADDED`, `REMOVED`, and
  `CHANGED` changes from direct `SOURCE ONLY` and `HA ONLY` differences.

### Safety

- Source YAML remains raw lossless text.
- The editor does not automatically format, normalize, trim, or parse-and-dump
  Source YAML.
- CodeMirror runtime assets are bundled locally with the integration.
- No CDN or runtime internet dependency was added.
## [0.1.0] - 2026-08-13

Initial v0.1 release preparation for HA YAML Source Editor.

Features included:

- Admin-only Home Assistant sidebar panel.
- Discovery of existing persisted Storage Mode Lovelace dashboards.
- Read-only display of Home Assistant's normalized Lovelace configuration.
- One raw Source YAML document per supported dashboard.
- Source YAML save and validation workflows.
- Text and semantic hashing for Source and Home Assistant configuration.
- Synchronization status for not deployed, in sync, source modified, HA
  modified, both modified, and sync errors.
- Safe verified deployment of saved Source YAML through Home Assistant's native
  Lovelace WebSocket API.
- Persistent synchronization baselines with semantic snapshots for new
  baselines.
- Semantic compare, including legacy two-way compare and snapshot-backed
  three-way analysis.
- Explicit conflict resolution with lossy HA import and Compare-gated overwrite.
- HACS/Hassfest/project CI workflow preparation.

Security and safety:

- Admin-only custom WebSocket commands.
- No direct `.storage` writes.
- No runtime CDN dependency.
- Source/config values are not logged by the integration.

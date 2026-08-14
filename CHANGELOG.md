# Changelog

## [0.2.2] - 2026-08-14

Source editor lifecycle stability release.

### Fixed

- Completes the fix for #21 after the v0.2.1 viewport-restoration mitigation.
- Routine Home Assistant updates no longer remount the active CodeMirror editor while the same Source Document remains active.
- Source editor viewport, focus, selection context, and keyboard handling remain stable during routine status and dashboard refreshes.
- Ctrl+A remains scoped to the Source YAML editor when CodeMirror has focus.
- Legitimate full renders preserve viewport and restore focus only for the same EditorView and Source Document when the editor previously had focus.
- Disconnect/reconnect lifecycle now destroys and recreates CodeMirror cleanly without reusing a destroyed EditorView.
- Existing Source YAML, Save, Validate, Compare, deployment, conflict detection, resolution, and baseline protections remain unchanged.

## [0.2.1] - 2026-08-14

Critical editor viewport bugfix release.

### Fixed

- Fixed #21: the Source editor no longer jumps back to the top during routine Home Assistant panel updates.
- Preserve CodeMirror vertical and horizontal viewport across routine panel rerenders.
- Restore viewport state only when the same EditorView and Source Document remain active.
- Existing Source YAML, Save, Validate, Compare, deployment, conflict detection, and baseline behavior remain unchanged.

## [0.2.0] - 2026-08-13

Workspace UX and Source bootstrap release.

### Added / Improved

- New Explorer | Editor | Inspector workspace architecture.
- YAML editor remains the primary workspace.
- Responsive Inspector with vertical edge control.
- Inspector defaults open on wide layouts and closed on narrower layouts.
- Manual Inspector choice is preserved after user interaction.
- Editor-scoped Source workflow toolbar.
- Create Source action for dashboards without a Source Document.
- Initialize from HA action for an existing but empty Source Document.
- Initialize from HA reads current Home Assistant configuration and populates
  the existing Source Document without deploying anything to HA.
- Explorer simplified to focus on dashboard navigation.
- Active dashboard/path and Source synchronization context moved into the
  Editor header.
- Clearer baseline terminology distinguishing Deployment from Imported from
  Home Assistant.
- Conflict-resolution presentation remains separate from Source initialization.

### Safety

- Source YAML remains raw/lossless.
- No automatic formatting or parse/dump normalization was introduced.
- Initialize from HA is explicitly lossy only with respect to formatting and
  comments already removed by Home Assistant.
- Deploy still uses saved Source only.
- Existing validation, Compare, conflict detection, deployment verification, and
  baseline safety remain authoritative.
- No direct `.storage` writes were introduced.

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

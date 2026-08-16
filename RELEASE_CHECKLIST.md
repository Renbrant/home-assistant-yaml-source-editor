# Release Checklist

## v0.3.0 — Template Navigator 26A

### Code and automated validation

- [x] Python regression suite passes: 49 tests.
- [x] Node regression suite passes: 142 tests.
- [x] JavaScript checks pass.
- [x] Python compile checks pass.
- [x] `git diff --check` passes.
- [x] HACS Action passes without ignores.
- [x] Hassfest passes.
- [x] Project CI passes.

### Template Navigator 26A

- [x] Existing dashboard workspace remains available.
- [x] Explorer includes `YAML Templates`.
- [x] Simple configured `template: !include ...` Source resolves safely.
- [x] Physical Template Source path is visible.
- [x] Raw Source indexing does not rewrite the file.
- [x] Name, `unique_id`, section, and physical range indexing works.
- [x] Search/filter works without remounting the active editor.
- [x] Shared top-level Template block remains the safe writable unit.
- [x] Child entities navigate within the shared block.
- [x] Targeted CodeMirror editing works.
- [x] Full physical Template Source opens read-only.
- [x] Read-only Full Source keyboard isolation works.
- [x] Full Source scroll position remains stable during routine HA updates.

### Template Save safety

- [x] Save is bound to the expected physical Source snapshot.
- [x] Targeted candidate uses raw-range splicing rather than whole-file parse/dump.
- [x] Complete candidate YAML is structurally validated.
- [x] Home Assistant Template semantic validation runs before commit.
- [x] Semantic rejection preserves the editor draft and performs zero physical write.
- [x] External Source modification causes stale Save rejection.
- [x] Stale Save preserves the external Source and does not write the draft.
- [x] Save is disabled after stale detection until reopen/reconcile.
- [x] Reopen/reconcile is protected by unsaved-change confirmation.
- [x] Physical write uses same-directory atomic replacement.
- [x] Successful write is re-read and verified.
- [x] Post-replace verification uncertainty is represented as `Commit uncertain`.
- [x] LF Source round-trip remains lossless.
- [x] CRLF Source edit/save/remove round-trip reproduced the baseline byte-for-byte.
- [x] Unrelated bytes, comments, quoting, blank lines, and formatting remain unchanged.
- [x] Original HA DEV test Source restored exactly after runtime testing.
- [x] Template Save does not automatically reload or restart Home Assistant.

### Editor lifecycle regression

- [x] Routine `hass` updates do not remount the active CodeMirror editor.
- [x] Same-document viewport/focus preservation remains intact.
- [x] Deliberate document switches still reset document-specific state.
- [x] Dashboard and Template editor modes do not leak state into each other.

### Documentation and release

- [x] README v0.3.0 content reviewed.
- [x] README screenshots reviewed for the v0.3.0 UI.
- [x] CHANGELOG v0.3.0 content reviewed.
- [x] Known limitations match actual 26A scope and safety guarantees.
- [x] Manifest and integration version are `0.3.0`.
- [ ] Post-release HACS upgrade from v0.2.2 to v0.3.0 validation completed.
  - Intentionally deferred until the final v0.3.0 release/tag exists so HACS can exercise the real user upgrade path.
- [x] Final release candidate tested after a clean Home Assistant restart.
- [x] Final PR / issue #28 acceptance criteria reviewed.
- [ ] Merge the v0.3.0 development branch.
- [ ] Create GitHub Release `v0.3.0`.

### Deferred to Template Navigator 26B

The following do not block v0.3.0:

- `!include_dir_merge_list`;
- arbitrary nested include graphs;
- package discovery;
- multiple Template Source files;
- inline `template:` blocks;
- generic YAML file browsing;
- automatic merge;
- automatic physical file splitting.

# HA YAML Source Editor

![HA YAML Source Editor banner](Photos/Banner.png)

**Keep your YAML. Keep your comments. Keep the Home Assistant UI.**

HA YAML Source Editor is a Home Assistant custom integration for people who want to
maintain hand-authored Home Assistant YAML without giving up a safe, structured UI.

The current workflows cover persisted Storage Mode Lovelace dashboards and, beginning
with v0.3.0, a curated Template Navigator for safely resolved YAML Template sources.

Home Assistant stores Lovelace dashboards as structured configuration. When YAML is
parsed and later serialized again, comments, blank lines, quoting choices, and manual
organization can disappear. HA YAML Source Editor keeps a separate raw **Source YAML**
document as the editable source of truth and deploys validated configuration through
Home Assistant's supported Lovelace WebSocket API.

**Current stable release: v0.2.2**

**Current development version: v0.3.0** — Template Navigator 26A is implemented on the
development branch and is being prepared for release.

![HA YAML Source Editor workspace](Photos/Screenshots/workspace.png)

## Table of Contents

- [Why This Exists](#why-this-exists)
- [Workspace](#workspace)
- [Workflow](#workflow)
- [Template Navigator](#template-navigator)
- [Features](#features)
- [Supported Targets](#supported-targets)
- [Installation](#installation)
- [Your First Source Document](#your-first-source-document)
- [Synchronization States](#synchronization-states)
- [Baselines](#baselines)
- [Conflict Resolution](#conflict-resolution)
- [Data and Storage](#data-and-storage)
- [Security](#security)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Why This Exists

Home Assistant is very good at managing configuration as structured data. That is also
why it cannot reliably preserve every detail of hand-authored YAML.

A configuration can remain semantically identical while losing things that matter to a
human editor:

- comments;
- blank lines;
- quoting choices;
- indentation and visual grouping;
- manual ordering and organization.

HA YAML Source Editor separates those concerns.

**Raw YAML remains the source of truth.**

For persisted Lovelace dashboards, the integration stores a separate Source Document as
raw text. Normal dashboard Source workflows never regenerate that YAML from parsed
configuration and never automatically format, normalize, trim, reorder, or
parse-and-dump it.

For Template Navigator, the configured physical Template YAML file remains the source of
truth. Targeted editing operates on exact raw Source ranges and does not rewrite
unrelated YAML through object serialization.

Dashboard deployment validates saved Source and converts it only for the purpose of
sending configuration through Home Assistant's supported Lovelace API.

Template Save is different: it safely updates the selected physical Template Source
block. It does not automatically reload Template entities or restart Home Assistant.

## Workspace

HA YAML Source Editor uses a persistent application workspace built around:

`Explorer | Editor | Inspector`

The intention is not to clone VS Code. The goal is to make the YAML editor the center of
the experience while keeping Home Assistant styling and behavior.

### Explorer

The Explorer provides navigation between supported persisted Storage Mode Lovelace
dashboards without leaving the editor workspace.

In v0.3.0 it also contains **YAML Templates**, a curated Template Navigator. For the 26A
MVP, the integration safely resolves a simple configured `template: !include ...`
source, indexes the raw file, and presents sections, logical blocks, and child entities
without turning Explorer into a general `/config` file browser.

Template search can match displayed names, `unique_id` values, and indexed section
labels.

### Editor

The central Source editor uses CodeMirror 6 and remains the primary workspace.

Editor features include:

- YAML syntax highlighting;
- line numbers;
- YAML block folding;
- indentation guides;
- active-line highlighting;
- search and replace with `Ctrl+F`;
- Tab / Shift+Tab indentation;
- undo and redo with isolated history between Source Documents;
- editor status information including line, column, line count, YAML mode, detected
  line-ending mode, and Saved/Modified state.

These are editing conveniences only. The editor does **not** automatically rewrite your
Source YAML.

### Inspector

The Inspector provides contextual information and actions for the selected Source,
including:

- Source state;
- synchronization state;
- validation;
- semantic comparison;
- deployment baseline information;
- deployment status;
- conflict resolution.

On wide layouts the Inspector opens by default. On narrower layouts it defaults closed
and can be opened with the vertical Inspector control. After you manually toggle it, the
responsive layout does not override that choice during normal updates.

![Compare and Inspector](Photos/Screenshots/compare-inspector.png)

## Workflow

The normal Source workflow is:

`Create / Initialize → Edit → Save Source → Validate → Compare → Deploy`

![Source workflow](Photos/Screenshots/source-workflow.png)

Template Navigator uses a separate physical-Source workflow:

`Discover → Navigate/Search → Open safe block → Edit → Save Template`

Template Save does not use the Lovelace deployment pipeline and does not automatically
reload or restart Home Assistant.

### Create Source

Use **Create Source** when the selected supported dashboard does not yet have a Source
Document.

This creates the Source Document only. It does not deploy anything to Home Assistant.

### Initialize from HA

Use **Initialize from HA** when a Source Document already exists but its saved Source is
genuinely empty.

Initialization:

- performs a fresh read of the current Home Assistant dashboard configuration;
- converts Home Assistant's normalized configuration into Source YAML;
- saves that YAML into the existing Source Document;
- does **not** deploy;
- does **not** modify Home Assistant;
- uses the existing HA-import semantic verification path before persistence.

Initialization is intentionally an adoption workflow for an empty Source Document.

A Source containing comments or any other non-whitespace text is not considered empty.

Home Assistant cannot return comments, blank lines, quoting, or formatting that it has
already discarded. Therefore initialization can reproduce the current dashboard
semantics, but it cannot reconstruct the original hand-authored YAML presentation.

### Edit and Save Source

Edit the Source directly in the CodeMirror editor.

**Save Source** persists the raw Source text. Saving does not deploy it to Home Assistant.

### Validate

Validation checks the saved Source for:

- YAML syntax;
- JSON/WebSocket-compatible values;
- basic Lovelace structure;
- selected target availability.

Custom cards are intentionally tolerated. HA YAML Source Editor does not attempt to
validate every custom card's private schema.

### Compare

Compare is semantic.

It compares parsed **saved Source** configuration with the current normalized Home
Assistant configuration. Comments, whitespace, quoting, and formatting are not part of
semantic comparison.

When a semantic baseline snapshot is available, the application can show three-way
analysis:

- changes in Saved Source since baseline;
- changes in Home Assistant since baseline;
- current Saved Source vs Home Assistant difference.

Older baselines without a snapshot fall back to current two-way comparison.

Arrays are compared by index. Reordering views or cards may therefore appear as multiple
indexed changes instead of a single move.

### Deploy

Deployment uses **saved Source only**, never unsaved editor text.

Before writing, HA YAML Source Editor validates Source, rechecks the target dashboard,
performs conflict/preflight checks, and asks for confirmation where appropriate.

The write is performed through Home Assistant's native Lovelace WebSocket API. The
result is then read back and verified. A new synchronization baseline is recorded only
after successful verification.

Home Assistant's Lovelace save API does not provide compare-and-swap or ETag locking.

HA YAML Source Editor uses optimistic pre-save rechecks to narrow the race window, but
does not claim atomic locking of Home Assistant's dashboard state.

## Template Navigator

v0.3.0 introduces the first usable Template Navigator from issue #28 / Template
Navigator 26A.

The goal is to make large hand-authored Template YAML files practical to navigate and
edit without physically reorganizing them or rewriting unrelated YAML.

### Discovery

The 26A implementation supports the common configuration where `configuration.yaml`
uses a simple Template include such as `template: !include templates.yaml`.

The configured path is resolved safely rather than assuming that
`/config/templates.yaml` is always the correct file.

If the Source cannot be resolved within the supported discovery model, Template
Navigator reports it as unavailable instead of scanning arbitrary YAML files.

### Explorer tree and search

The `YAML Templates` Explorer tree shows the physical Source file plus indexed logical
groups, safe top-level blocks, and child Template entities.

Index metadata includes, where available:

- physical Source path;
- physical line/range information;
- logical block boundaries;
- displayed `name`;
- `unique_id`;
- nearby section-comment grouping;
- child locations inside a shared safe block.

Search/filter can match Template names, `unique_id` values, and indexed section labels.

### Safe edit unit

A displayed child entity is not automatically treated as an independent writable YAML
fragment.

The complete indexed top-level Template block is the writable unit. Child entities are
navigation targets that can reveal their location while the editor remains scoped to
the complete safe block.

The Editor identifies the physical Source path, logical block, physical range, and edit
unit before a targeted save.

### Targeted Save

`Save Template` sends the raw replacement text together with the expected Source
snapshot identity.

Before commit, the backend:

1. re-discovers and re-reads the current physical Source;
2. verifies Source identity, path, block identity, and indexed range;
3. constructs a candidate by splicing only the selected raw range;
4. validates the complete resulting YAML structure;
5. validates the resulting Template configuration with Home Assistant's Template
   semantic validator;
6. rechecks stale state immediately before commit;
7. performs a same-directory atomic file replacement;
8. re-reads and verifies the persisted bytes and resulting Template index.

The save path never performs whole-file YAML parse → object modification → YAML dump.

Everything outside the selected raw edit region is intended to remain byte-for-byte
unchanged.

### Semantic rejection

Structurally valid YAML can still be invalid Home Assistant Template configuration.

Template Save therefore runs Home Assistant semantic validation before physical commit.
If Home Assistant rejects the candidate, the physical Source is not modified and the
unsaved editor draft remains available for correction.

### External changes and reconcile

Every opened Template block is bound to a Source snapshot.

If the physical Source changes externally before Save:

- Save is rejected;
- the external Source remains authoritative;
- the stale editor draft is not written;
- Save is disabled;
- Explorer is refreshed;
- the block must be reopened before another Save attempt.

Reopening a stale block is protected by the normal unsaved-change confirmation. The
application does not silently discard the draft and does not automatically merge
external changes.

### Commit uncertain state

A physical atomic replacement can succeed even if a later verification step cannot
complete.

In that situation the UI reports **Commit uncertain**, refreshes Explorer, disables
blind retry, and requires the user to reopen/reconcile the Source before attempting
another Save.

The application does not pretend that a post-replace verification failure means the
physical file was definitely unchanged.

### Full Source

Selecting the physical Template Source file opens the complete raw file in a distinct
**read-only** CodeMirror document.

Full Source mode is intended for inspection and navigation. v0.3.0 does not expose an
unrestricted whole-file Template write action.

### Line-ending preservation

The CodeMirror wrapper detects uniform LF, CRLF, or CR line separators and configures
the editor state with the detected physical separator.

The v0.3.0 development workflow includes automated regression coverage plus real Home
Assistant DEV round-trip verification for LF and CRLF. A CRLF Template block was edited,
saved, removed again, and reproduced the complete CRLF baseline byte-for-byte without
changing unrelated Source bytes.

Mixed line-ending styles are not currently claimed as a lossless editable format.

## Features

- Admin-only Home Assistant sidebar panel.
- Discovery of existing persisted Storage Mode Lovelace dashboards.
- Explorer | Editor | Inspector workspace.
- Professional CodeMirror 6 Source editor.
- One Source Document per supported dashboard.
- `Create Source` workflow.
- `Initialize from HA` for existing empty Source Documents.
- Raw/lossless Source YAML persistence using Home Assistant Store.
- Explicit `Save Source`.
- YAML and target validation.
- Source text hash, Source semantic hash, and current Home Assistant semantic hash.
- Synchronization states for not deployed, in sync, Source modified, HA modified,
  both modified, and sync errors.
- Semantic Compare.
- Legacy two-way comparison for older baselines.
- Snapshot-backed three-way analysis for newer baselines.
- Safe verified deployment of saved Source YAML.
- Persistent synchronization baselines after verified deployment or explicit HA import.
- Explicit conflict resolution.
- Responsive Inspector.
- Local vendored CodeMirror and js-yaml runtime dependencies.
- YAML Template Source discovery for a safely resolved simple `template: !include ...`.
- Template Explorer tree with sections, blocks, entities, names, `unique_id`, and ranges.
- Template search/filter.
- Exact targeted CodeMirror editing of safe top-level Template blocks.
- Read-only full physical Template Source view.
- Home Assistant Template semantic validation before Template writes.
- Source snapshot/stale protection with explicit reopen/reconcile workflow.
- Same-directory atomic targeted Template writes with read-back verification.
- Explicit `Commit uncertain` handling after post-replace verification failures.
- Uniform physical line-ending preservation in the CodeMirror edit path.
- No whole-file Template parse/dump rewrite.
- No direct `.storage` file writes.

## Supported Targets

Currently supported:

- Existing persisted **Storage Mode Lovelace dashboards** returned by
  `lovelace/dashboards/list`.
- One safely resolved physical **Template YAML** Source configured through the common
  simple `template: !include <file>` form in `configuration.yaml`.

For Template Navigator, the writable unit is the indexed safe top-level Template block.
Child entities are navigation targets, and the complete physical Source view is
read-only.

Currently not supported:

- Auto-generated default Overview dashboards with no persisted Lovelace configuration.
- YAML-mode Lovelace dashboards.
- `!include_dir_merge_list` Template discovery.
- arbitrary nested Template include graphs.
- Home Assistant package discovery for Template sources.
- multiple Template Source files.
- inline `template:` blocks in `configuration.yaml`.
- generic `/config` YAML file browsing.
- unrestricted whole-file Template editing.
- automatic merge of externally changed Template Source.
- automatic Template reload or Home Assistant restart after Save.
- Automations.
- Scripts.
- Scenes.
- Individual Lovelace views or cards as independent Source targets.
- Creating or deleting dashboards.

The deferred Template discovery cases belong to the 26B follow-up and do not block the
26A / v0.3.0 MVP.

## Installation

### HACS Custom Repository — Recommended

HA YAML Source Editor can be installed through HACS as a **Custom Repository**.

The integration is not currently assumed to be part of the default HACS catalog, so add
the repository manually the first time.

#### 1. Add the repository to HACS

Open **HACS** in Home Assistant.

Open the **three-dot menu (⋮)** in the upper-right corner and choose:

**Custom repositories**

Add:

- **Repository:** `https://github.com/Renbrant/home-assistant-yaml-source-editor`
- **Type:** `Integration`

Then click **ADD**.

#### 2. Download HA YAML Source Editor

After adding the repository:

1. Search HACS for **HA YAML Source Editor**.
2. Open the integration.
3. Click **Download**.
4. Select the latest version if HACS asks which release to install.
5. Wait for HACS to finish.

HACS installs the integration under Home Assistant's `custom_components` directory.

#### 3. Restart Home Assistant

Restart Home Assistant after installation:

**Settings → System → Restart Home Assistant**

A restart is required because HA YAML Source Editor includes a Python custom integration.

#### 4. Add the integration

After Home Assistant restarts:

1. Go to **Settings → Devices & services**.
2. Click **Add integration**.
3. Search for **HA YAML Source Editor**.
4. Select it and complete setup.

If the integration does not appear immediately, hard-refresh the browser (`Ctrl+F5`)
and try again.

#### 5. Open HA YAML Source Editor

After setup, **HA YAML Source Editor** appears in the Home Assistant sidebar for
administrator users.

Open it and select a supported Storage Mode dashboard.

### Manual Installation

HACS is recommended, but manual installation is also possible.

Download or clone this repository and copy:

```text
custom_components/ha_yaml_source_editor
```

into:

```text
<config>/custom_components/
```

The resulting structure should look similar to:

```text
<config>/
└── custom_components/
    └── ha_yaml_source_editor/
        ├── __init__.py
        ├── manifest.json
        ├── config_flow.py
        └── ...
```

Restart Home Assistant, then go to:

**Settings → Devices & services → Add integration**

Search for **HA YAML Source Editor** and complete setup.

## Your First Source Document

There are two common onboarding paths.

### Path A — Start with your own YAML

1. Open **HA YAML Source Editor**.
2. Select a supported Storage Mode dashboard.
3. Click **Create Source**.
4. Enter or paste the YAML you want to maintain.
5. Click **Save Source**.
6. Click **Validate**.
7. Run **Compare**.
8. **Deploy** when you are ready.

This is the best path when you already have the hand-authored YAML you want to preserve.

### Path B — Adopt an existing Home Assistant dashboard

1. Open **HA YAML Source Editor**.
2. Select the existing Storage Mode dashboard.
3. Create its Source Document if necessary.
4. With the Source still empty, click **Initialize from HA**.
5. Review the generated Source YAML.
6. Continue with **Save Source → Validate → Compare → Deploy** as you edit it later.

`Initialize from HA` does not deploy or change Home Assistant. It only establishes the
Source from Home Assistant's current normalized dashboard configuration.

The process is necessarily lossy with respect to comments and presentation that Home
Assistant has already removed.

## Synchronization States

`NOT DEPLOYED`
The Source Document has no synchronization baseline.

`IN SYNC`
Saved Source semantics match the current Home Assistant dashboard and the baseline.

`SOURCE MODIFIED`
Saved Source changed since the baseline while Home Assistant still matches it.

`HA MODIFIED`
Home Assistant changed since the baseline while saved Source still matches it.

`BOTH MODIFIED`
Saved Source and Home Assistant both changed since the baseline.

`SYNC ERROR`
Synchronization status could not be calculated.

`Source vs HA` is a separate direct comparison between current saved Source semantics
and the current Home Assistant configuration. It reports `MATCH`, `DIFFERENT`, or
`UNAVAILABLE`.

## Baselines

Synchronization baselines can have different origins.

### Deployment

A deployment baseline is established only after HA YAML Source Editor successfully
writes the saved Source to Home Assistant and verifies the resulting configuration.

For this origin, the Inspector can truthfully report deployment information such as
**Last deployed**.

### Imported from Home Assistant

A Home Assistant import/initialization baseline represents configuration adopted from
Home Assistant.

It is **not** a deployment event and should not be interpreted as "Last deployed".

This distinction is intentional in the v0.2.0 interface.

## Conflict Resolution

Conflict-resolution actions are separate from empty-Source initialization.

### Import HA Version

**Import HA Version** is an explicit conflict-resolution action that chooses the current
Home Assistant dashboard configuration as the new Source.

This is lossy with respect to Source presentation. It may replace comments, blank lines,
quoting, formatting, and manual YAML organization.

It does not modify Home Assistant.

Before saving, generated YAML is parsed and compared semantically with the Home Assistant
configuration. If the round trip changes semantics, the import is blocked.

### Overwrite HA with Saved Source

**Overwrite HA with Saved Source** chooses the saved Source as authoritative and replaces
the exact Home Assistant dashboard configuration reviewed by Compare.

It requires a fresh Compare snapshot and is only available for appropriate Home Assistant
conflict states.

If Source or Home Assistant changes after Compare, overwrite is blocked and Compare must
be run again.

## Data and Storage

Dashboard Source Documents are stored using Home Assistant Store.

Template Navigator operates on the safely resolved physical Template YAML Source under
the Home Assistant configuration directory. Targeted Template Save uses guarded raw-text
splicing and same-directory atomic replacement; it never edits Home Assistant `.storage`
files directly.

The integration does not write directly to `.storage` files.

Source YAML and dashboard configuration can contain sensitive information. Do not include
raw Source, Home Assistant configuration, or semantic diff values in bug reports unless
you intentionally sanitize them first.

Internal Store filenames and structure are implementation details, not an editing
interface.

Removing or updating the integration code does not intentionally delete Source Documents
stored by Home Assistant.

## Security

- Sidebar panel requires an administrator user.
- Custom WebSocket commands are admin-only.
- Runtime frontend assets are local to the custom integration.
- No CDN or runtime internet dependency is used by the editor.
- Source YAML, Home Assistant configuration, canonical snapshots, and diff values are
  not logged by the integration.
- Dashboard writes are performed through Home Assistant's supported Lovelace WebSocket
  API.
- Template writes require the expected Source snapshot and are validated before a
  same-directory atomic filesystem replacement.
- Stale Template snapshots are rejected before commit.
- Post-replace verification uncertainty is surfaced explicitly instead of encouraging a
  blind retry.
- No direct `.storage` writes are used for Lovelace deployment or Template editing.

## Known Limitations

- Lovelace Source management currently supports persisted Storage Mode dashboards.
- Template Navigator 26A supports one simple safely resolved
  `template: !include <file>` Source; advanced include graphs, include directories,
  packages, multiple Template Source files, and inline Template configuration are
  deferred to 26B.
- Full Template Source is read-only in v0.3.0; targeted top-level blocks are the
  writable units.
- Uniform LF, CRLF, or CR separators are detected by the editor. LF and CRLF have
  current automated/runtime coverage. Mixed physical line-ending styles are not
  guaranteed lossless.
- Template Source files larger than the integration's guarded Source-size limit are
  rejected instead of being loaded or rewritten.
- Template Save changes the physical Source only. It does not automatically reload
  Template entities or restart Home Assistant.
- External Template changes are not automatically merged. Stale Save is rejected and
  requires reopen/reconcile.
- The Template write path narrows external-write races with repeated stale checks, but
  cannot provide locking against non-cooperating external writers during the residual
  check-to-replace window.
- A post-replace verification failure can produce `Commit uncertain`; there is no
  automatic rollback after the physical replacement may already have occurred.
- Template file mode bits are preserved by the guarded write path where supported.
  Ownership, ACLs, and extended attributes are not part of the v0.3.0 preservation
  guarantee.
- HA import and initialization cannot recover comments or formatting already removed by
  Home Assistant.
- There is no deployment history or general Source versioning yet.
- Array diffs are index based.
- Home Assistant frontend-facing Lovelace APIs may change in future releases.
- Tested against Home Assistant Core 2026.8.1 and Home Assistant Frontend 20260729.6.
  Earlier or later versions may require compatibility updates.

## Troubleshooting

- After frontend updates, clear the browser cache or use `Ctrl+F5`.
- After Python integration updates, restart Home Assistant.
- Make sure you are using an administrator user.
- Check Home Assistant logs for integration setup errors.
- For HACS or manual installation, verify the folder is installed at
  `<config>/custom_components/ha_yaml_source_editor`.
- If the integration does not appear in **Add integration**, restart Home Assistant and
  clear the browser cache.

## License

MIT

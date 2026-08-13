# Changelog

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

# HA YAML Source Editor

HA YAML Source Editor is an early-stage Home Assistant custom integration for preserving YAML-authored configuration while still participating in the Home Assistant UI.

Core principle:

> Keep your YAML. Keep the Home Assistant UI.

## Current Status

This repository is in early development. M0 only proves that the integration can load through a config flow, register an admin-only sidebar panel, and communicate between the frontend panel and backend over Home Assistant's WebSocket API.

M0 does not implement YAML editing, dashboard discovery, storage, deployment, hashing, synchronization, or any editor dependencies.

## Future Goal

The long-term goal is to preserve original YAML as a lossless source of truth while deploying normalized configuration through supported Home Assistant APIs.

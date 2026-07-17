# ADR 0002 — Canonical Wasabi tree and gradual adoption

## Status

Accepted, 2026-07-17.

## Decision

Aby owns `aby/aud/` and `aby/mov/` inside the existing private Wasabi bucket. Existing `ref/` and `mov/` trees remain legacy source pools during an object-by-object migration; they are not permanent alternate authorities.

The canonical physical tree remains human-readable. Audio uses flat historiographic and curatorial codes (`20E`, `20L`, `20LAT`, `20ELE`, `pop`, `tec`, `ens`). Entity folders use lowercase ASCII compact slugs, while work titles retain their complete Unicode names.

Each adoption follows preview → copy → verify → authority switch → explicit source retirement. Since S3 does not provide atomic rename, no database commit may point at the proposed destination before the copied object is verified. Automated identification never overwrites curatorial classification.

## Consequences

- The archive can be cleaned incrementally without a bulk rewrite.
- PostgreSQL must model migration state and retain both original and canonical keys.
- Temporary duplicate bytes may exist during verification, but never two active authorities.
- MusicBrainz and image results remain provenance-bearing candidates.
- Empty or failed historical moves, such as the stray Aperghis folders observed during audit, can be handled later without blocking the first real asset.

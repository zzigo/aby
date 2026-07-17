# ADR 0001 — Aby app-capability baseline

- Status: accepted
- Date: 2026-07-17

## Context

Temporal media requires playback state, interval editing, private binary storage and costly analysis. Folding those concerns into Seshat would contaminate the bibliographic context; building an unconnected player would lose the shared epistemic model.

## Decision

1. Aby lives at `/Users/zztt/projects/apps/aby` as an independent repository and bounded context.
2. SvelteKit and TypeScript implement the product shell; Bun 1.3.14 manages the workspace and tests.
3. PostgreSQL schema `aby` is canonical. Table names are schema-qualified (`aby.assets`) rather than globally prefixed because schema ownership is explicit and migrations remain portable.
4. Wasabi stays private, with keys under `aby/media/` and playback through short-lived presigned URLs.
5. Qdrant contains only versioned, reconstructible derivative vectors.
6. Seshat, Musiki and GLIP integrations use stable IDs, SDK/API/events and provenance-bearing relations. No private table or UI imports are allowed.
7. Automated identification and analysis produce candidates. A human-inspectable commit is required before canonical metadata changes.

## Consequences

Aby can deploy and roll back independently. Shared infrastructure is reused without shared ownership. Some infrastructure adapters resemble Seshat patterns, but code extraction is postponed until contracts prove neutral and stable in at least two consumers.


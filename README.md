# Aby

Aby is a temporal media intelligence application for private audio and video archives. It is an independent app-capability with its own UI, API, schema, packages, workers and deployment at the future host `aby.zztt.org`.

Its canonical model is:

```text
Work -> Recording -> Asset -> Segment
```

PostgreSQL owns identity, metadata, ACLs, relations, provenance and job state. Private binaries remain in Wasabi under the reserved `aby/media/` prefix. Qdrant is a derived, reconstructible index. Seshat, Musiki and GLIP are sibling bounded contexts consumed only through authenticated APIs, SDKs and events.

## Phase 0 baseline

- SvelteKit/TypeScript web app with a persistent player and health endpoint.
- `@zztt/aby-domain` for invariants and contracts.
- `@zztt/aby-sdk` for the public HTTP surface.
- Media-ingest service primitives for SHA-256 and `ffprobe` inspection.
- PostgreSQL migration for the `aby` schema.
- Wasabi adapter with strict prefix validation and short-lived presigned playback URLs.
- Preview-before-write ingest flow, a local audio fixture, canonical commit and manual segment creation.

The fixture repository is development/test-only and deliberately non-canonical. Production refuses to use it. Configure `DATABASE_URL`, apply the migration, provision a dedicated Logto application and configure Wasabi before any deployment.

## Local commands

The repository pins Bun 1.3.14. If Bun is not installed globally, it can be invoked without changing the host configuration:

```bash
npx --yes bun@1.3.14 install
npx --yes bun@1.3.14 run validate
npx --yes bun@1.3.14 run dev
```

Copy `.env.example` to `.env` only when configuring real integrations. Never commit `.env`.

## Repository map

```text
apps/web                 SvelteKit product UI and authenticated API boundary
packages/domain          Domain types, validation and lifecycle contracts
packages/sdk             Stable client for external consumers
services/media-ingest    Checksum and technical metadata worker primitives
migrations               Aby-owned PostgreSQL migrations
docs                     Architecture, boundaries, operations and roadmap
```

See [Phase 0](docs/PHASE-0.md) for assumptions and validation scope.


# Aby

Aby is a temporal media intelligence application for private audio and video archives. It is an independent app-capability with its own UI, API, schema, packages, workers and deployment at the future host `aby.zztt.org`.

Its canonical model is:

```text
Work -> Recording -> Asset -> Segment
```

PostgreSQL owns identity, metadata, ACLs, relations, provenance and job state. Private binaries remain in Wasabi. `ref/` and `mov/` are legacy source pools; objects are adopted one at a time into the canonical `aby/aud/` and `aby/mov/` trees after an inspectable preview. Qdrant is a derived, reconstructible index. Seshat, Musiki and GLIP are sibling bounded contexts consumed only through authenticated APIs, SDKs and events.

## Phase 0 baseline

- SvelteKit/TypeScript web app with a persistent player and health endpoint.
- `@zztt/aby-domain` for invariants and contracts.
- `@zztt/aby-sdk` for the public HTTP surface.
- Media-ingest service primitives for SHA-256 and `ffprobe` inspection.
- PostgreSQL migration for the `aby` schema.
- Wasabi adapter with strict prefix validation and short-lived presigned playback URLs.
- Preview-before-write ingest flow, a local audio fixture, canonical commit and manual segment creation.
- Bounded one-object Wasabi preview with SHA-256, ffprobe, MusicBrainz candidates, Cover Art Archive provenance and a proposed human-readable destination.
- Dedicated Logto client on the shared issuer, preserving cross-application SSO and stable subject ownership.

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
See [VPS deployment](docs/DEPLOYMENT.md) for the live layout, tunnel and release sequence.
See [Cataloging](docs/CATALOGING.md) for the canonical Wasabi tree, three-letter codes and object-by-object adoption protocol.

## VPS workspace and tunnel

The production checkout lives at `/opt/apps/aby`, runs as the `zz` user and binds only to `127.0.0.1:4332`. Open the standard development tunnel with:

```bash
bun run tunnel:vps
```

The single SSH session exposes Aby at `localhost:4332`, PostgreSQL at `localhost:55432` and Qdrant at `localhost:56333`. Secrets remain in `/opt/apps/aby/.env`; the tunnel does not make any remote service publicly reachable.

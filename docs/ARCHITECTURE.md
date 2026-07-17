# Architecture

## Decision

Aby is an independent app-capability, not a Seshat feature and not a generic media microservice. It owns the temporal-media domain and exposes stable headless surfaces:

```text
Aby
├── App       apps/web — listening and inspection
├── API       works, recordings, assets and segments
├── Domain    @zztt/aby-domain
├── SDK       @zztt/aby-sdk
├── Events    lifecycle contracts, transport deferred
└── Workers   services/media-ingest; MIR workers follow later
```

This small workspace is justified because the web app, two publishable contracts and one independently runnable worker already have different consumers and deployment lifecycles. It is intentionally not a megamonorepo: neutral capabilities are not extracted, and the MIR service is not scaffolded until a real job exists.

## Dependency direction

`domain <- SDK, web, workers`. The domain package has no infrastructure dependencies. The SDK knows only public HTTP contracts. The web app owns PostgreSQL and Wasabi adapters. Workers consume domain job contracts but do not import UI code.

Seshat and Musiki were inspected only for patterns. Their code is not linked through relative paths. The reusable patterns are explicit configuration validation, S3-compatible clients, presigned access, stable identity subjects and health checks. Their UI, schemas, storage roots and integration secrets remain owned by those apps.

## Runtime

SvelteKit supports the persistent reactive shell needed by the player and inspector. Bun is the pinned package manager, script runner and test runner. The official Node adapter is used for a conservative deploy artifact that can run under Node 22+ or be evaluated under Bun; choosing a community-only runtime adapter is deferred until the VPS baseline is measured.

Expensive media work runs outside request handlers. Phase 0 executes `ffprobe` only for a single explicitly requested fixture. Future object analysis creates idempotent jobs with bounded concurrency and backpressure.

## Sources of truth

- PostgreSQL `aby` schema: canonical operational state.
- Wasabi `aby/media/`: private original and derivative binaries.
- Qdrant `aby_*`: derived embeddings, always rebuildable.
- Seshat: bibliography and documents.
- Musiki: its product domain and Cloudflare R2 objects.
- GLIP: validated TAE/GLILY/GLINO semantics.

See [ADR 0001](adr/0001-aby-app-capability.md).


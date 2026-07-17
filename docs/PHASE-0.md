# Phase 0 report

## Audit

- Definitive local root: `/Users/zztt/projects/apps/aby`; it did not exist and was created as an independent Git repository.
- Seshat reference root: `/Users/zztt/projects/packages/seshat`; no migration or modification is part of this work.
- Musiki reference root: `/Users/zztt/projects/26-musiki`; its framework uses Cloudflare R2 and remains unchanged.
- Available host tools at audit time: Node 24.16, ffprobe 8.1.2, PostgreSQL client 15.15. Bun was not globally installed; the repo pins Bun 1.3.14 and validation uses its npm-distributed runner.
- Local PostgreSQL was not accepting connections on port 5432. An active `org.rclone.wasabi` mount process was observed and left untouched.

## Reuse classification

| Capability | Classification | Phase 0 action |
| --- | --- | --- |
| S3 client + presigning pattern | reusable idea | reimplemented behind Aby prefix and config |
| Logto stable subject | neutral infrastructure | dedicated Aby client still required |
| Health/config status | reusable operational pattern | implemented without secret values |
| Seshat bibliography import/UI/schema | Seshat-owned | not imported |
| Musiki R2 adapter and public URLs | Musiki-owned | not imported or configured |
| Work/Recording/Asset/Segment | Aby-specific domain | implemented in domain/schema |
| ffprobe/checksum worker primitives | potentially neutral later | kept Aby-owned until a second stable consumer exists |

## Assumptions and precedence

The current Aby prompt supersedes the older proposal's provisional “Media Library” name and shared-core diagram. The Systems MOC's bounded-context and cross-system rules govern filesystem and integration decisions. The ontology and media pipeline from the older specification remain authoritative where they do not conflict.

The initial local Phase 0 created no external state. The subsequent VPS baseline provisions an independent checkout, PostgreSQL database/schema, PM2 process and Caddy route. The storage boundary was subsequently refined: `ref/` and `mov/` are legacy source pools, while `aby/aud/` and `aby/mov/` are canonical destinations populated one verified object at a time. A dedicated Logto application remains pending.

## Validation

- `bun run lint`: clean.
- `bun run typecheck`: packages compile and `svelte-check` reports 0 errors/0 warnings.
- `bun test`: the baseline suite covers domain intervals, opt-in analysis, SHA-256, ffprobe parsing, owner isolation and storage-prefix enforcement; Phase 1 adds catalog-code, legacy-source and MusicBrainz candidate tests.
- `bun run build`: SvelteKit production build succeeds with Vite 7.3.6 and the official Node adapter.
- HTTP smoke: health, fixture inspection, candidate preview, canonical commit, playback URL and manual segment creation all succeed in sequence.
- Local migration execution was unavailable because the workstation has PostgreSQL client tools but no server. The migration was subsequently applied on the VPS to the dedicated `aby` database and verified with 14 tables in schema `aby`, owned by `aby_app`.
- Seshat remained clean at commit `249480cb5730843545ecf1c2a6a8c4a4d16f296f`; Musiki had no files modified during the audit window. The existing rclone Wasabi process retained PID 3043 and no rsync process was started.
- Secret scan found only `.env.example` and no key/private-key signatures.

## Final source tree

```text
aby/
├── apps/web/              SvelteKit UI, API, adapters and tests
├── packages/domain/       domain invariants and event/job contracts
├── packages/sdk/          stable HTTP client
├── services/media-ingest/ checksum and ffprobe primitives
├── migrations/            Aby-owned PostgreSQL schema
├── scripts/               explicit migration runner
├── docs/                  architecture, boundaries, security and roadmap
├── .env.example
├── bun.lock
└── package.json
```

## Known risks

1. Real Wasabi object discovery must decide whether a single-object inspection may download the master for checksum/ffprobe or must use a colocated worker.
2. Auth middleware and ACL semantics must be completed before any non-local exposure.
3. Media Session and background playback require browser/device verification, especially iOS.
4. Large-video presigned playback needs Range/CORS verification against the selected Wasabi bucket.
5. Qdrant dimensions cannot be fixed before model artifacts and versions are selected.

## VPS organization

The operational root is `/opt/apps/aby`, owned by `zz`. Aby reserves loopback port `4332`, immediately after Seshat's `4331`. PostgreSQL and Qdrant remain shared infrastructure but Aby receives a dedicated database role/database and namespaced schema/collections. `scripts/tunnel-vps.sh` forwards app, database and Qdrant ports without exposing them on public interfaces.

PM2 process `aby-web` runs the production build on `127.0.0.1:4332`. Caddy has a validated `aby.zztt.org` reverse proxy and a pre-change backup at `/etc/caddy/Caddyfile.before-aby-20260717`. Cloudflare serves an unproxied A record to `46.225.154.68`; Caddy issued a valid certificate and the public health endpoint returns HTTP 200.

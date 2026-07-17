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

No production host, DNS, bucket, Logto client, PostgreSQL schema or Qdrant collection is created in Phase 0. The fixture proves behavior but is not a canonical production store.

## Validation

- `bun run lint`: clean.
- `bun run typecheck`: packages compile and `svelte-check` reports 0 errors/0 warnings.
- `bun test`: 8 passing tests covering domain intervals, opt-in analysis, SHA-256, ffprobe parsing, owner isolation and storage-prefix enforcement.
- `bun run build`: SvelteKit production build succeeds with Vite 7.3.6 and the official Node adapter.
- HTTP smoke: health, fixture inspection, candidate preview, canonical commit, playback URL and manual segment creation all succeed in sequence.
- Migration execution remains unverified locally: the installed PostgreSQL 15 keg contains client tools but its `postgres` server binary is absent, and no database was accepting connections. No external database was contacted.
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

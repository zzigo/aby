# Storage

## Canonical and legacy boundaries

The human-facing rclone root is `wasabi:zzttuntref/`. Operationally, that alias maps to the private bucket `untref-licmusica` and bucket-relative prefix `zzttuntref/`; Aby keeps that physical detail in `WASABI_ROOT_PREFIX` and stores human-readable logical keys below it.

The root has two existing source pools:

```text
ref/   legacy audio reference archive
mov/   legacy cinema archive
```

They are not sanitized in place and are not Aby's permanent namespace. Aby adopts one selected work at a time into:

```text
aby/
├── aud/   canonical audio
└── mov/   canonical cinema
```

The duplicate word `mov` is intentional and unambiguous because the full keys differ: `mov/...` is legacy; `aby/mov/...` is canonical. Cloudflare R2 is not an Aby data source.

## Authority during transition

There is exactly one active binary authority per asset.

1. Before promotion, the legacy key is active.
2. Preview records the legacy key, SHA-256, technical metadata and proposed canonical key.
3. Promotion performs a server-side copy because S3 has no native rename.
4. Aby verifies size, checksum, ffprobe identity and playback at the destination.
5. The legacy key enters `aby.source_retirement_candidates` with state `candidate`.
6. PostgreSQL switches the asset's active object key only after verification.
7. Retirement of the legacy object is a separate, explicit approval and deletion step.

The original filename, object key, directory, provider, checksum, import batch and timestamps remain permanently recorded as provenance. The system must never leave two objects marked active.

## Access and derived material

Wasabi stays private. The server validates ownership and the canonical `aby/` key before returning a presigned GET URL whose TTL is clamped to 60–900 seconds. The VPS does not proxy normal playback bytes.

Later derived files remain subordinate to their asset and carry tool/version/checksum provenance. Analysis starts from the master or a controlled PCM derivative. Segments remain database intervals; cached clips are disposable derivatives.

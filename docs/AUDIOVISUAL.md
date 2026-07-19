# Audiovisual surface

`VIEW` is Aby's audiovisual instrument over the private Wasabi source pool `wasabi:zzttuntref/mov`. It reuses the product rules established by `LISTEN` without pretending that large video objects can be adopted synchronously.

## Deferred adoption

`Add to catalog` performs metadata work only:

1. validate that the source remains below `mov/`;
2. read size, content type and ETag with an object `HEAD`;
3. retain provenance-bearing candidates from TMDB, Wikidata and Internet Archive;
4. propose a human-readable destination below `aby/mov/`;
5. persist an AV catalog row and one `pending` storage operation.

No copy or move occurs in this request. `EXECUTE` is a later, explicit action. It starts `rclone copyto` and records a process beacon with origin, destination, state, size, bytes transferred, speed, ETA and timestamps. The source is not deleted after completion.

## Human-readable tree

The default is author-centered but always keeps an explicit decade:

```text
aby/mov/1970s/tarkovsky/1979 — Stalker/stalker.mkv
```

The selectable strategies are:

- `author`: explicit decade, then lowercase surname; default for authored cinema;
- `decade`: chronological fallback when authority metadata is uncertain;
- `entity`: archives, collectives, studios, schools or movements;
- `saga`: editorially real series only;
- `custom`: reviewed escape hatch.

Changing the strategy changes the proposed destination, not the stable database identity.

## Metadata and analysis layers

The first metadata query fans out to TMDB, Wikidata and Internet Archive. TMDB accepts `TMDB_READ_ACCESS_TOKEN` (preferred) or `TMDB_API_KEY` as a fallback; Wikidata and Internet Archive are useful for rare, experimental, Soviet, archival and educational material. IMDb IDs remain first-class external identifiers even though IMDb is not treated as an open metadata API.

The following tools are declared as later workers rather than synchronous UI promises: ffmpeg inspection, VideoHash/perceptual hashes, PySceneDetect, OCR, WhisperX, CLIP scene embeddings and Qdrant indexing. PostgreSQL remains authoritative; vector indexes and analysis artifacts are reconstructible.

## Captures and sharing

Captures are global temporal entities for audio or video. A capture stores immutable `startTimeMs` and `endTimeMs`, optional timed annotations and an opaque share token. `/share/<token>` removes the Aby shell and exposes only a minimal player clamped to the captured interval. A future derivative-render worker should materialize a physically bounded clip for stronger byte-level isolation before public publishing.

## Workspace

`/workspace` is desktop-first and merges catalog items, legacy segments, global captures and AV storage operations. It provides live search, column visibility, locally saved column snapshots, row selection, conservative bulk edits and direct execution of pending AV operations.

# Audiovisual surface

Audiovisual adoption starts in `INSPECT`; `VIEW` is the resulting mosaic and temporal player. The AV source pool remains private at `wasabi:zzttuntref/mov`. The split reuses the product rules established by the audio `INSPECT` → `GALLERY`/`LISTEN` workflow without pretending that large video objects can be adopted synchronously.

`INSPECT` has an explicit `AUDIO` / `AV VIDEO` switch. Each medium keeps distinct source prefixes, canonical editors, metadata authorities and destination rules. `SURPRISE ME` is shared as an interaction pattern but always samples only the active medium.

## Deferred adoption

The AV `COMMIT TO CATALOG` action performs metadata work only:

1. choose an MKV, MOV, VOB, MP4, M4V, AVI or WebM below `mov/`;
2. read size, content type and ETag with an object `HEAD` and run bounded `ffprobe` through a temporary source URL;
3. initialize editable canonical fields from embedded container metadata;
4. automatically search TMDB, Wikidata and Internet Archive from the extracted filename/title, then reload each text query or canonical ID independently;
5. copy a selected authority candidate into the canonical editor only after explicit `USE`;
6. propose a human-readable destination below `aby/mov/`;
7. persist the reviewed AV catalog row and one `pending` storage operation.

No copy or move occurs in this request. `EXECUTE` is a later, explicit action. It starts `rclone copyto` and records a process beacon with origin, destination, state, size, bytes transferred, speed, ETA and timestamps. The source is not deleted after completion.

## Human-readable tree

The default is author-centered but always keeps an explicit decade:

```text
aby/mov/1970s/tarkovsky/1979-Stalker/stalker.mkv
```

The selectable strategies are:

- `author`: explicit decade, then lowercase surname; default for authored cinema;
- `decade`: chronological fallback when authority metadata is uncertain;
- `saga`: editorially real series only, stored directly below `aby/mov/<saga>/`;
- `custom`: reviewed semantic folder stored directly below `aby/mov/<folder>/`.

`entity` remains readable for historical rows but is no longer offered by the editor and never creates a redundant `/entity/` level. Tags hold genres, movements and styles without forcing them into the storage tree. Title folders use `YEAR-Title`, without spaces or a doubled dash around the separator.

Changing the strategy changes the proposed destination, not the stable database identity.

## Metadata and analysis layers

TMDB, Wikidata and Internet Archive can be reloaded independently without overwriting canonical fields. Search text and canonical IDs are distinct inputs: numeric TMDB IDs, `Q` Wikidata IDs and Internet Archive identifiers use direct lookup; everything else remains a text query. TMDB accepts `TMDB_READ_ACCESS_TOKEN` (preferred) or `TMDB_API_KEY` as a fallback. Wikidata adds a full-text correction fallback for rare titles and minor spelling errors. IMDb IDs remain first-class external identifiers even though IMDb is not treated as an open metadata API.

Canonical AV metadata includes multiple countries, languages and tags, fixed director/composer fields, plus repeatable credit rows with controlled roles. A bounded, allowlisted DVDBeaver importer can populate poster and edition/source notes from a manually supplied review URL; it records the page as provenance and never crawls the site indiscriminately.

After commit, the item appears in `VIEW`. That route combines a poster mosaic with search, type/decade/country filters, configurable property visibility and tile sizes. Country filters split multi-country values. Selecting a tile opens the player, film metadata, credits, audio-track selection, embedded subtitle and double-subtitle controls, and capture tools without leaving the mosaic context. The gallery/player divider is draggable and the mosaic can retract into player focus. ffprobe preserves every audio and subtitle stream; selected text subtitles are converted to WebVTT on demand. Provider state lives in the AV inspector and external downloads remain explicit.

The following tools are declared as later workers rather than synchronous UI promises: ffmpeg inspection, VideoHash/perceptual hashes, PySceneDetect, OCR, WhisperX, CLIP scene embeddings and Qdrant indexing. PostgreSQL remains authoritative; vector indexes and analysis artifacts are reconstructible.

## Captures and sharing

Captures are global temporal entities for audio or video. A capture stores immutable `startTimeMs` and `endTimeMs`, optional timed annotations and an opaque share token. VIEW exposes both OPEN URL and COPY URL. `/share/<token>` removes the Aby shell, fills the iframe viewport and exposes only a minimal player clamped to the captured interval. A future derivative-render worker should materialize a physically bounded clip for stronger byte-level isolation before public publishing.

## Workspace

`/workspace` is desktop-first and merges catalog items, legacy segments, global captures and AV storage operations. It provides live search, column visibility, locally saved column snapshots, row selection, conservative bulk edits and direct execution of pending AV operations.

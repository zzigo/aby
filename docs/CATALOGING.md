# Cataloging and gradual adoption

## Human-readable physical tree

The Wasabi tree is an operational catalog, not an opaque hash store. Structural folders use Luciano-readable compact codes; creators and entities use stable slugs; works retain their full names.

```text
aby/
├── aud/
│   ├── 11/
│   ├── …
│   ├── 20E/
│   ├── 20L/
│   ├── 20LAT/
│   ├── 20ELE/
│   ├── 21E/
│   ├── 21L/
│   ├── 21LAT/
│   ├── pop/
│   ├── tec/
│   └── ens/
└── mov/
```

`E` and `L` are historiographic placements, not exact date ranges. For example, Varèse belongs to `20E` and Boulez to `20L`. `LAT` means Latin America only; `ELE` means electroacoustic. Automated dates may suggest but never override this curatorial placement.

## Entity and work names

- A person uses an unambiguous lowercase ASCII surname: `aperghis`, `boulez`, `varese`.
- A band, group or ensemble uses its compact lowercase ASCII name: `pinkfloyd`, `ensembleintercontemporain`.
- Spaces and punctuation are omitted from entity slugs.
- Homonyms add the given name only when needed: `adamsjohn`, `adamsjohnluther`.
- Exact names, aliases and diacritics remain in PostgreSQL metadata.
- Work folders retain complete Unicode titles: `Récitations`, `The Sinking of the Titanic`.
- Unsafe path separators are sanitized without changing the displayed title.

## Aggregate hierarchy

Physical paths follow the domain spine where the evidence is known:

```text
aby/aud/<collection>/<entity>/<Work>/<Recording>/<Asset>
```

Recording folders remain human-readable and editable in preview. The first convention is `year-label`, preserving Unicode and replacing spaces with hyphens: `1990-Les-Disques-du-Crépuscule`. Catalog numbers remain structured release metadata and never enter the folder name. The recording's database title remains its human title; identity never depends only on path text because PostgreSQL stores stable UUIDs and external identifiers.

## One-work adoption protocol

There is no bulk ingestion by default.

```text
select one source object or folder
→ calculate SHA-256 and ffprobe metadata
→ inspect embedded tags
→ propose MusicBrainz candidates
→ propose Cover Art Archive image with provenance
→ propose canonical folders and filenames
→ human preview
→ copy to canonical key
→ verify bytes, metadata and playback
→ mark the legacy source as a deletion candidate
→ switch PostgreSQL authority
→ explicitly retire legacy source
```

Identification, cover art and filenames are candidates until confirmed. MIR remains off during this first adoption and will be an explicit later job.

## First bounded example

Selected legacy asset:

```text
ref/20 late/Gavin Bryars/The Sinking of the Titanic/Sinking of the Titanic.mp3
```

Observed technical facts: one MP3 asset, stereo, 48 kHz, 320 kb/s, approximately 60:19, no embedded cover and poor tags (`bryars`, `pas de titre`, `PisteAudio 01`). MusicBrainz contains a 3,619,000 ms recording from the 1990 Belgian release, which closely matches the embedded `TLEN` of 3,619,066 ms. The exact release has no Cover Art Archive image; any release-group image must therefore be labeled as a feature-image fallback rather than the exact edition cover.

Initial proposed destination:

```text
aby/aud/20L/bryars/The Sinking of the Titanic/1990-Les-Disques-du-Crépuscule/The Sinking of the Titanic.mp3
```

Creating the preview is non-canonical and non-destructive. Copying or retiring the source requires the subsequent promotion step.

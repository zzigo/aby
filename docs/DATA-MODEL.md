# Data model

## Aggregate spine

`Work -> Recording -> Asset -> Segment` is the primary ownership chain. `Track` is not a universal entity.

For audio release navigation, an optional `Album` groups recordings and an optional structured `Album Set` groups albums or physical volumes. Set identity is metadata (`title`, position, total discs and parent/member external IDs) and does not replace the curatorial `collectionCode` used by the physical tree.

- **Work:** intellectual or artistic expression.
- **Recording:** a concrete fixation of a performance, session or event.
- **Asset:** one binary representation, including its immutable origin and checksum.
- **Segment:** a logical interval in an asset. It is not materialized unless a later export/cache policy requires it.

Times are stored as integer milliseconds in Phase 0 to avoid floating-point drift. A segment requires `0 <= start < end` and may carry channel selection and fades.

`recordings.title` is the human title of the fixation, not its storage folder. Release date, label, catalog number, MusicBrainz evidence and the derived `year-label` folder live in structured recording metadata. Catalog numbers aid identification but do not enter filenames or folder names.

## Tables

Migration `0001_aby_core.sql` creates the schema and the requested bounded set: works, recordings, assets, segments, annotations, analysis, embeddings, transcripts, working sets, jobs, external identifiers and relations. `ingest_candidates` is the preview ledger required to separate inspection from canonical commit. During gradual adoption its JSON candidate metadata also carries the proposed canonical key, collection code, entity slug, external identification candidates and feature-image candidates. The asset row is not created until storage promotion succeeds. Migration `0002_source_retirement_candidates.sql` adds the explicit deletion-candidate queue: after a verified promotion, the legacy `ref/` or `mov/` source remains physically intact but enters this queue as `candidate` until separately approved and retired.

Migration `0007_audiovisual_workspace.sql` adds `av_catalog_items`, `storage_operations` and global `captures`. AV catalog items are deliberately staging records: they make metadata and temporal work available while the large binary still lives below `mov/`. They do not masquerade as canonical `assets`. A successful deferred storage operation changes availability but never deletes the source. Captures can point to either a canonical asset or a staged AV item, never both.

Automatic outputs retain tool/model name, version, parameters, timestamp, source checksum, confidence, job ID, review state and reviewer. Dense frame-level series remain in Wasabi as Arrow/Parquet/Zarr artifacts; PostgreSQL stores summaries and pointers only. Embedding rows retain model/version/dimension and the Qdrant point ID, not the vector as the only copy.

## Provenance

Every mutable aggregate has creator/owner and timestamps. Candidate, analysis and relation records contain structured provenance. The first slice records whether a checksum was calculated from the local fixture or registered from an upstream source, plus the `ffprobe` tool version and job/candidate ID.

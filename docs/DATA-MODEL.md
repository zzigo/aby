# Data model

## Aggregate spine

`Work -> Recording -> Asset -> Segment` is the primary ownership chain. `Track` is not a universal entity.

- **Work:** intellectual or artistic expression.
- **Recording:** a concrete fixation of a performance, session or event.
- **Asset:** one binary representation, including its immutable origin and checksum.
- **Segment:** a logical interval in an asset. It is not materialized unless a later export/cache policy requires it.

Times are stored as integer milliseconds in Phase 0 to avoid floating-point drift. A segment requires `0 <= start < end` and may carry channel selection and fades.

## Tables

Migration `0001_aby_core.sql` creates the schema and the requested bounded set: works, recordings, assets, segments, annotations, analysis, embeddings, transcripts, working sets, jobs, external identifiers and relations. `ingest_candidates` is the preview ledger required to separate inspection from canonical commit.

Automatic outputs retain tool/model name, version, parameters, timestamp, source checksum, confidence, job ID, review state and reviewer. Dense frame-level series remain in Wasabi as Arrow/Parquet/Zarr artifacts; PostgreSQL stores summaries and pointers only. Embedding rows retain model/version/dimension and the Qdrant point ID, not the vector as the only copy.

## Provenance

Every mutable aggregate has creator/owner and timestamps. Candidate, analysis and relation records contain structured provenance. The first slice records whether a checksum was calculated from the local fixture or registered from an upstream source, plus the `ffprobe` tool version and job/candidate ID.


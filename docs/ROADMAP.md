# Roadmap

## Phase 0 — bounded baseline

Independent repo, contracts, schema, storage adapter, health endpoint and a fixture-backed preview/commit/playback/manual-segment slice.

## Phase 1 — private library (in progress)

Dedicated Logto app, PostgreSQL deployment, Wasabi object discovery, bounded scan jobs, embedded tags, Chromaprint candidates, MusicBrainz/AcoustID inspection, persistent queue and mobile playback controls.

Current bounded slice: one manually selected legacy Wasabi object, SHA-256/ffprobe inspection, MusicBrainz duration match, feature-image candidate, canonical path preview and persistent PostgreSQL candidate. No bulk scan, MIR or source deletion.

## Phase 2 — deterministic analysis

Waveform pyramid, loudness and interpretable Essentia descriptors; versioned analysis artifacts; worker concurrency and retry controls.

## Phase 3 — embeddings and segmentation

Separate CLAP/MERT collections, hybrid retrieval, manual and multiscale candidate segmentation, on-demand clips and similarity explorer.

## Phase 4 — GLIP promotion

Human-reviewed candidate-to-TAE workflow, GLILY/GLINO links and provenance-preserving export.

## Phase 5 — formal analysis

Micro/meso/macro hierarchies, novelty curves, timbral trajectories, work comparison and corpus navigation.

The next vertical slice is verified promotion of the reviewed candidate: server-side copy, destination hash/metadata/playback verification, atomic authority switch, mobile playback and separately confirmed source retirement.

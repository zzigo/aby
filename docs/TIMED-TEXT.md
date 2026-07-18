# Timed Text

Aby models lyrics, subtitles and transcripts as versioned timed text attached to an asset. Providers and original formats remain explicit; the normalized cue model is the shared internal contract.

## Music v1

The implemented music slice supports:

- manual plain lyrics;
- line-synchronized LRC;
- LRCLIB lookup by track, artist, album and duration;
- immutable revisions with one current document per asset and text type;
- normalized cues with global `offsetMs` and linear `timeScale` fields reserved for later correction;
- candidate preview in the track editor before an explicit save;
- large player lyrics, with current-line emphasis when timing exists.

LRCLIB is an external enrichment source, not canonical bibliographic authority. Its original LRC is retained alongside normalized cues. A manual save creates an accepted revision rather than destroying the provider version.

## Deferred

Video subtitle providers, embedded subtitle extraction, OpenSubtitles, ASS/TTML import, drift controls, word-level alignment and forced-alignment workers are intentionally deferred until Aby's movie surface is implemented. The database discriminators already allow `lyrics`, `subtitles` and `transcript` without mixing provider or licensing rules.

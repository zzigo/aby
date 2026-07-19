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

## Video

`VIEW` now exposes the playback contract for primary/secondary subtitle languages, subtitle size and provider discovery. Persisted subtitle attachment remains gated on a canonical AV asset and an explicit provider credential. OpenSubtitles/Podnapisi download, embedded stream extraction, ASS/TTML import, drift controls, word-level alignment and WhisperX forced alignment remain jobs to implement; the UI reports that state rather than fabricating a successful download.

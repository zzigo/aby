# Storage

## Boundary

Aby reserves `aby/media/` at the bucket root. Existing Seshat code uses `zzttuntref/libros`, `zzttuntref/lseshat/<user>` and `zzttuntref/seshat-derived`; Musiki uses a separate Cloudflare R2 adapter. The new prefix therefore makes ownership visible and avoids collision without moving any object.

```text
aby/media/
├── originals/<sha256-prefix>/<sha256>/original.ext
├── derivatives/
│   ├── playback/
│   ├── waveform/
│   ├── spectrogram/
│   ├── thumbnails/
│   ├── transcripts/
│   └── analysis/
└── exports/
```

Phase 0 does not upload, move, rename or duplicate objects. Registration preserves `original_filename`, `original_object_key`, `original_directory`, SHA-256, import batch, import time and provider.

## Access

Wasabi stays private. The server validates ownership and key prefix, then returns a presigned GET URL whose TTL is clamped to 60–900 seconds (default 300). The VPS does not proxy normal playback bytes. Clip generation and transcoding may use isolated workers later.

Analysis begins from masters or controlled PCM derivatives, never a compressed playback derivative when a better source exists. Segments are database intervals; cached clips are disposable derivatives.


# UI contract: Player + Catalog

## Product posture

This surface is a hyperinstrument, not an administration table. Media is primary; metadata appears contextually. It must remain touchable, immediate and playable on a phone without importing the dense sheet/table interaction used previously in Seshat.

## Locked interaction model

- The player occupies the viewport below the global header and persistent transport.
- The initial visualization is the release/feature cover with work and creator context.
- A horizontal swipe changes visualization. Visible previous/next controls and labeled view buttons provide keyboard and accessibility parity.
- The second visualization is a real, checksum-bound `ffmpeg` spectrogram plus normalized energy, brightness, motion, gravity and tension descriptors. Generation happens server-side; long recordings are never fully decoded in mobile browser memory.
- An upward swipe from the bottom opens the catalog drawer; downward swipe closes it. The handle is also a button.
- Catalog items are large touch targets. Touching the main row loads and plays the asset. Segment rows play only their stored temporal interval.
- A minimal shortcut rail precedes catalog items. It contains recent/favorite canonical Aby folders and a `+` control; `+` reveals the complete tree derived only from `aby/aud/` and `aby/mov/`, never `ref/`.
- `Play segment` is also available in the Inspect workflow once a segment exists.

## Visual system

- Continue Aby's near-black, pale text and acid-signal palette.
- The cover is the dominant square object and may occupy most of the short viewport dimension.
- Typography remains restrained: serif only for the active work; UI, descriptors and navigation use the existing sans/mono system.
- No ornamental cards, spreadsheet grids, sortable columns or permanently exposed metadata panels.
- Motion is short and spatial: drawer translation and view crossfade. Honor `prefers-reduced-motion`.

## Touch and accessibility

- Primary touch targets are at least 48 CSS pixels.
- Horizontal view gestures use a 56 px threshold; vertical drawer gestures use 48 px.
- Gesture axes are separated: view gestures occur only on the stage, drawer gestures only on the drawer.
- Gestures are never the sole control. Every action has a visible button and semantic label.
- Errors remain literal, while successful playback avoids redundant status prose already expressed by the title and native transport.

## Data contract

- Catalog data comes from committed `Work → Recording → Asset` records owned by the authenticated Logto subject.
- Cover candidates retain their provenance and remain labeled candidates where applicable.
- Spectrogram and descriptor summaries are stored in `aby.analysis`, linked to the source asset SHA-256 and an idempotent `aby.jobs` record. The image lives in private Wasabi and reaches the browser through a short-lived signed URL.

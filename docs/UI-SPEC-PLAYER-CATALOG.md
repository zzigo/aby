# UI contract: Player + Catalog

## Product posture

This surface is a hyperinstrument, not an administration table. Media is primary; metadata appears contextually. It must remain touchable, immediate and playable on a phone without importing the dense sheet/table interaction used previously in Seshat.

## Locked interaction model

- The player occupies the viewport below the global header and persistent transport.
- The initial visualization is the release/feature cover with work and creator context.
- A horizontal swipe changes visualization. Visible previous/next controls and labeled view buttons provide keyboard and accessibility parity.
- The second visualization is the spectrogram surface plus audio descriptors. Until a real derived spectral artifact exists, the surface states this explicitly and displays only measured technical descriptors; it must never fabricate spectral data.
- An upward swipe from the bottom opens the catalog drawer; downward swipe closes it. The handle is also a button.
- Catalog items are large touch targets. Touching the main row loads and plays the asset. Segment rows play only their stored temporal interval.
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
- Empty, loading, unauthorized and missing-analysis states use literal language.

## Data contract

- Catalog data comes from committed `Work → Recording → Asset` records owned by the authenticated Logto subject.
- Cover candidates retain their provenance and remain labeled candidates where applicable.
- Descriptors use stored technical metadata only.
- Spectrogram data will later be a checksum-bound derived artifact; the first surface does not synthesize or imply analysis that does not exist.

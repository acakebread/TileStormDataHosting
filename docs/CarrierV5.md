# Browser carrier 5: experimental smaller recovery markers

Carrier 5 is selectable for evaluation; [carrier 4](CarrierV4.md), with eight
full-size brightness-balanced markers, is the default. Readers automatically
accept carriers 1, 3, 4 and 5. The preference key is
`pixelstow-carrier-v4-balanced`. Desktop and game readers still require carrier 1
until upgraded. Payload frames, compression and passwords are unchanged.

This moves the earlier disposable four-corner V4 experiment into a distinct
carrier 5. It does not retain compatibility with that discarded V4 layout.
The style experiment is retained for further work: the user reports that its
camera recovery was substantially worse than carrier 3. CRC-valid marker
headers alone do not establish accurate enough geometry for payload recovery.

## Four corner markers

Four 50 x 50 pixel square patches contain 10 x 10 five-pixel symbols. IDs
0, 2, 6 and 8 identify top-left, top-right, bottom-left and bottom-right.
Orientation comes from these identifiers, rather than a rectangular shape.
Four widely separated marker centres constrain a planar projective transform;
three centres alone do not provide its eight independent constraints.

Each corner holds eight bytes: `D5`, `50 | id`, little-endian unsigned 16-bit
original width, little-endian unsigned 16-bit original height, and the low
16 bits of CRC32 of the preceding six bytes. Whitening and Fisher-Yates cell
scattering use seed `0x50534C35`; bytes use the existing 12-bit parity code.
The first 96 scattered cells hold the header; the other four repeat its first
four coded bits. The first 24 bits are pilots. Discovery is confirmed only
after a decoded header passes CRC, never by frequency evidence alone.

The four-pixel diagonal wavelet is interpolated symmetrically to five pixels
at coordinates `(i + 0.5) * 4 / 5 - 0.5`, clamped to 0..3. Each kernel's mean
is removed. Strength is capped at 12; the outer row and column are multiplied
by 0.7 each. Reading samples at `1.25 * i + 0.125` with the existing four-pixel
difference template.

The painter preserves the chosen local colour average through clipping and
rounding. Ordinary unclipped regions retain local brightness, including any
small background rounding in the payload. On saturated colours, nearby payload
pixels can have a DC shift
to create signal headroom. Markers match that background shift, measured once
in a 12-pixel ring excluding every reservation, rather than leaving an empty
white/black patch or imposing the old large per-symbol brightness correction.
Alpha is unchanged. These remain embedded signals, not invisible markings.

## Side references

Four 24 x 16 pixel midpoint patches carry IDs 1, 3, 5 and 7. Each has a 6 x 4
grid of ordinary four-pixel wavelets, scattered with the same seed. They hold
only the first 24 coded bits of the whitened magic/ID, at 0.65 times the main
strength with the same edge taper and brightness treatment. They do not carry
dimensions or an independent checksum.

References are checked only after the corner markers establish geometry.
Matches near predicted positions record displacement in native pixels. They
do not increase header counts or encoding confidence, decide body acceptance,
or participate in the initial discovery search. Missing references never
prevent a valid body from opening. They provide local cross-checks and retain
measurements for future lens-distortion work.

This change does not add fisheye/radial-lens correction. Existing perspective
rectification and carrier phase refinement still perform photograph recovery.
Reference displacements are diagnostics, not a guarantee for curved images.

## Placement and payload

Corner reservations are 52 x 52 pixels, aligned to four-pixel payload blocks.
For width W their origins are `8` and `4 * floor((W - 60) / 4)`; height H uses
the corresponding expressions. The small references use:

| ID | x origin | y origin |
| --- | --- | --- |
| 1 | `4 * floor((W - 24) / 8)` | `8` |
| 3 | `8` | `4 * floor((H - 16) / 8)` |
| 5 | `4 * floor((W - 32) / 4)` | `4 * floor((H - 16) / 8)` |
| 7 | `4 * floor((W - 24) / 8)` | `4 * floor((H - 24) / 4)` |

Reserved area is 12,352 pixels, versus carriers 3/4's 27,648: 55.3% less. Payload
blocks are enumerated in row order excluding these reservations. Preamble
byte 1 is 5; existing checksum, scattering and seven copies remain unchanged.
Generated-image verification reads the native grid without photo discovery.

Images must fit disjoint patches, reserve no more than 30% of their area, and
meet 16-bit dimensions and the 24-megapixel encoding limit. Smaller images
that do not fit the markers fall back to carrier 1 with the existing notice.

## Compatibility and evaluation

Carrier 3's writer and eight 72 x 48 patches are retained unchanged. Discovery
profiles share image preparation, FFT and outline proposals. Cheap checksums
across all profiles precede expensive local fits. Source extraction uses each
version's own exclusions; the side references are optional diagnostics.

Smaller, softer corner markers reduce redundancy and resampling margin. Native
round-trips and controlled geometric checks are development evidence; actual
version 5 camera/print reliability needs evaluation. Carriers 3 and 4 provide
the full-size marker comparison while version 5 remains experimental.

## Large camera inputs

Photo input now accepts up to 32 megapixels, including 5712 x 4284 (24,470,208
pixels), which exceeded the old 24-million-pixel boundary. Encoding and native
carrier dimensions remain limited to 24 megapixels. For larger photographs,
marker working levels are limited to eight megapixels; final perspective
rectification samples the full original onto the recovered native grid.

Canvas-based image loading reads 1:1 strips, avoiding a single giant decoding
canvas. For inputs above 24 megapixels only the display preview backing is
reduced, to a maximum edge of 2048; its interaction coordinates still represent
the full original. Pixel buffers and exported captures keep their resolution.
Marker overlays also use bounded display canvases. Device memory still limits
very large files; no particular iPhone model's performance is guaranteed.

Focused checks: `node tests/pixelstow-v4-checks.mjs`. The existing resize suite
explicitly selects carrier 3 to keep its measured baseline separate.

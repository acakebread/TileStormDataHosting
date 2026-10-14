# Browser carrier 5: adaptive contrast and smaller recovery markers

Carrier 5 is the default browser writer and the only format searched during
normal image and camera recovery. Enable **older-format recovery (versions 1,
3 and 4)** under Image recovery options to include the earlier readers for the
current session. All four writer choices remain available; generated-image
verification and source preview read their explicitly selected format.

The preference key is `pixelstow-carrier-v5-adaptive`. The old V4 preference is
ignored so existing users start with V5; subsequent explicit writer choices
are saved. Older-format recovery starts disabled on every page load. Desktop
and game readers still require carrier 1 until upgraded. Payload frames,
compression and passwords are unchanged.

This moves the earlier disposable four-corner V4 experiment into a distinct
carrier 5. It does not retain compatibility with that discarded V4 layout.
Adaptive contrast and geometry fixes improved recovery in supplied captures.
CRC-valid marker headers alone do not establish accurate enough geometry for
payload recovery; photo and print recovery remain research features.

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
is removed. The outer row and column are multiplied by 0.7 each. Strength now
adapts as described below. Reading samples at `1.25 * i + 0.125` with the existing four-pixel
difference template.

The painter preserves the chosen local colour average through clipping and
rounding. Ordinary unclipped regions retain local brightness, including any
small background rounding in the payload. On saturated colours, nearby payload
pixels can have a DC shift
to create signal headroom. Markers match that background shift, measured once
in a 12-pixel ring excluding every reservation, rather than leaving an empty
white/black patch or imposing the old large per-symbol brightness correction.
Alpha is unchanged. These remain embedded signals, not invisible markings.

## Adaptive contrast

V5 shares [V4's adaptive payload contrast](CarrierV4.md#adaptive-contrast): actual
fractional repetition sets the nominal strength, source texture raises it
locally, and the stronger nonlinear ramp below 2x applies. The shared inverse
uplift raises the curve by 15% at 2x, tapering smoothly above it. The same headroom
limits prevent extra boost from buying large brightness or unequal RGB shifts
in dark regions with highlights. This was previously missing from the V5 writer.

Corner markers and side references also adapt to source texture. Their nominal
strength is at least 12 and texture gain at least 0.5: marker headers do not
have as many repeats as the payload. Their working peaks follow the raised
curve with the existing hard ceiling of 32. The existing edge taper, square
patches, small references and local brightness balancing remain in place.
Carrier extraction accounts for the raised payload and marker peaks.

These are contrast changes within the existing layout and headers. Existing
V5 images remain readable. Native tests cover high, moderate and low redundancy,
source preservation and clipped colours; fresh optical captures are required
to evaluate the improvement in camera recovery.

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
meet 16-bit dimensions and the 24-megapixel encoding limit. Images that cannot
fit V5 markers report zero capacity and require a larger source or an explicit
older writer selection. V5 never silently falls back to carrier 1.

## Compatibility and evaluation

Carrier 3's writer and eight 72 x 48 patches are retained unchanged. Default
discovery evaluates only V5's marker profile and frequency band. With older
recovery enabled, discovery profiles share image preparation, FFT and outline
proposals, and cheap checksums precede expensive local fits. Unselected older
seeds, candidate scans and cached transforms cannot bypass the setting.
Source extraction uses each version's own exclusions; the side references are
optional diagnostics. Encoding still checks for existing and locked native
fingerprints in all formats to prevent re-encoding them.

Smaller, softer corner markers reduce redundancy and resampling margin. Native
round-trips and controlled geometric checks are development evidence; actual
version 5 camera/print reliability needs evaluation. Carriers 3 and 4 provide
the full-size marker comparison when explicitly enabled.

Geometry discovery keeps an affine prediction from the verified corner's local
centre and axes alongside outline/projective predictions. A detected outline
can include part of the surrounding scene: its curvature can agree with one
small corner patch while projecting the other corners outside their search
windows. Independent corner measurements still establish and rank the final
transform, and the payload checksum remains required.

A supplied 4032 x 3024 V5 capture reproduced this failure, while its 1375 x 1031
clipboard copy decoded. With the alternate local prediction, both recovered
the same contents as the original 640 x 480 encoded image. Full-resolution
pixels remain the source for native-grid reconstruction; only discovery uses
reduced working images. This case did not require enlarging or strengthening
V5's markers. Outline predictions also retain pixel-centre coordinates when
carried between working scales, including when only some corners were found.

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

Focused checks: `node tests/pixelstow-v5-default-checks.mjs`,
`node tests/pixelstow-v4-checks.mjs`,
`node tests/pixelstow-v5-boost-checks.mjs` and
`node tests/pixelstow-v5-photo-checks.mjs`. The existing resize suite
explicitly selects carrier 3 to keep its measured baseline separate.

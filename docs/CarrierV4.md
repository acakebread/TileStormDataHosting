# Browser carrier 4: brightness-balanced carrier 3 markers

Carrier 4 is the default browser writer. It keeps carrier 3's eight recovery
patches, their positions, dimensions, six-pixel wavelets, full marker strength
and payload exclusions. The change is local brightness correction, not smaller
or softer markers. The [smaller-marker experiment](CarrierV5.md) is selectable
as carrier 5. Carrier 3 remains a comparison and rollback option.

Readers automatically accept carriers 1, 3, 4 and 5; the writer choice never
limits reading. The new preference key is `pixelstow-carrier-v4-balanced`, so
previous experimental preferences do not override the new default. There is
no compatibility shim for the discarded four-corner V4 images. Desktop and
game readers still require carrier 1 until their signal readers are upgraded.

## Geometry and framing

The geometry is identical to [carrier 3](ResizeRecovery.md): eight 72 x 48 pixel
patches, with IDs 0, 2, 6, 8, 1, 3, 5 and 7, each holding a 12 x 8 grid of six-pixel
symbols. All eight carry dimensions and checksums. There is no centre marker
and no additional small-reference layout. The marker signal is the original
four-pixel wavelet expanded using `floor(i * 4 / 6)`, not the interpolated
five-pixel wavelet used in the smaller-marker experiment. The reader keeps the
original sampling positions `1.5 * i + 0.5`.

Eight-byte marker headers contain `D4`, `40 | id`, little-endian unsigned
16-bit width and height, and the low 16 bits of CRC32 over the first six bytes.
Whitening and Fisher-Yates scattering use seed `0x50534C34`; the existing 12-bit
parity code supplies 96 symbols. The first 24 symbols are pilots. A marker is
confirmed only after its decoded header passes CRC, not from frequency evidence.

The eight rectangles reserve 27,648 pixels, exactly as in carrier 3. Payload
blocks use the same row order and exclusions. Preamble byte 1 is 4. PCF1 payload
frames, compression, attachment bytes, passwords, parity and repetition remain
unchanged. Generated-image verification uses the inexpensive native reader.

## Brightness correction

The expanded marker kernel's mean is removed without reducing its diagonal
contrast. There is no edge taper or reduced strength cap: amplitude follows
the payload strength and is capped at 16, as in carrier 3.

Before painting any markers, each patch measures the written payload's average
RGB shift from the original in a 12-pixel ring, excluding all marker
reservations. Each six-pixel symbol then targets its original channel average
plus that surrounding shift. A uniform offset is solved with clipping included;
rounding residuals are distributed to preserve the target integer sum. Ordinary
unclipped colours keep their local brightness rather than changing the entire
rectangle to accommodate a lobe. Saturated colours inherit the surrounding
payload's headroom adjustment. Alpha and input pixels are unchanged.

Brightness preservation and clipping can still reduce the signal on difficult
colours; the markers remain visible wavelets. The style change does not add
lens correction or establish camera/print reliability. Real photographs still
need user evaluation. Carrier 3's writer remains frozen for comparison.

## Limits and evaluation

Carrier 4 has carrier 3's minimum dimensions and capacity. Pictures too small
for disjoint markers, or with more than 30% of their area reserved, fall back
to carrier 1 with the existing notice. Encoding remains limited to 24
megapixels, while photo input accepts 32 megapixels, including 5712 x 4284.
Marker localization uses bounded working images; final perspective sampling
uses the full original capture. Canvas loading retains 1:1 source pixels in
strips, and large display previews use bounded backing canvases.

Focused checks: `node tests/pixelstow-v4-checks.mjs`. These cover the new default,
eight independent marker headers, the shared V3/V4 layout, brightness treatment,
V5 selection, source/alpha preservation, attachment/password round trips, frozen
V3 pixels, V1 reading and large-input boundaries. They do not certify camera
performance. The existing resize suite explicitly selects carrier 3.

One controlled projective resample (640 x 480 encoded grid into an 864 x 672
capture, bilinear sampling with no supplied marker seed or corners) also recovered
the message through marker discovery and full payload checksum verification.
This is geometric development evidence, not a camera/photo reliability claim.

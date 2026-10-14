# Browser carrier 4: brightness-balanced carrier 3 markers

Carrier 4 remains selectable as an older browser writer. It keeps carrier 3's
eight recovery patches, their positions, dimensions, six-pixel wavelets
and payload exclusions. The change is local brightness correction, not smaller
or softer markers. [Carrier 5](CarrierV5.md) is now the default writer and reader.
Carrier 3 remains a comparison and rollback option.

Normal recovery searches V5 only. Enable older-format recovery under Image
recovery options to read carriers 1, 3 and 4. Explicit older writer selections
still verify and preview their generated images without enabling the general
older-format detector. Writer choices use `pixelstow-carrier-v5-adaptive`;
the old V4 preference key is ignored. There is no compatibility shim for the
discarded four-corner V4 images. Desktop and game readers still require carrier
1 until their signal readers are upgraded.

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
contrast. There is no edge taper. Payload and marker amplitude now adapt as
described below; the V3 writer retains its original strength rules.

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

## Adaptive contrast

The V4 writer uses actual fractional repetition rather than a rounded count of
complete copies. The baseline starts at 8 at 5x or above, increases linearly to
17 at 2x, and adds a stronger `u * (2 - u)` ramp below 2x, where
`u = clamp(2 - ratio, 0, 1)`. A smooth reciprocal uplift then raises that curve:
`uplift = 1 + 0.45 / (max(1, ratio) + 1)`. The constants correspond to a 15%
uplift at 2x and a denominator offset of 1; both are named codec constants for
later calibration. At 2x the nominal amplitude becomes 19.55, quantised to 20.
At 1.5x and below it reaches the existing nominal ceiling of 32. Native
verification can also raise it if required. This spends more image quality on
payloads with fewer repeated symbols. It does not create extra redundancy.

Each payload block and each six-pixel marker cell measures RMS source detail
after subtracting a local brightness plane. Flat regions and smooth brightness
slopes do not trigger a texture boost. Source detail adds bounded contrast, with
more allowance below 5x. Texture gain and the working payload/marker peaks
receive the same reciprocal uplift. Its contribution decreases smoothly with
more repeated data rather than switching off above 2x. Payload and marker
peaks still have hard ceilings of 64 and 32 respectively; payload clipping still
uses the existing fitted-shift/sign
check, and markers retain their exact local brightness targets. Neither input
pixels nor alpha are modified. Stronger wavelets will be visible on dense or
textured images; this is a deliberate quality/recovery tradeoff.

Texture boost is limited by the *nominal* payload fit. For both bit orientations,
it may add at most four channel levels of DC correction at 2x and above, rising
to twelve below 2x along the same curve, and at most two levels
of additional difference between channel corrections. If the nominal fit needs
the legacy per-channel sign-flip fallback, no texture boost is applied. This
limits the additional background lift of dark blocks with bright glints and
retains the colour-cast constraint even at low redundancy. The chosen amplitude then goes
through the normal sign validation and final bias/clipping calculations; boost
is never added after that final fit. Pure black/white still need the nominal
headroom correction to carry any signal. Marker mean targets remain unchanged.

The geometry, symbol signs, preamble, envelope, repetition and marker CRCs remain
unchanged. The existing signed-correlation reader accepts varying amplitudes
without requiring an amplitude map. Frame strength records the nominal value;
source extraction allows for the larger V4 local peaks. No migration for earlier
V4 output is added. V1/V3 writing is unchanged, including the frozen V3 digest.
V5 shares this payload policy with its own smaller marker layout and taper.
Checks cover native payloads and all eight marker CRCs at both high and low
redundancy, clipped colours, dark/highlight brightness and colour bounds, and unchanged source/alpha:
`node tests/pixelstow-v4-boost-checks.mjs`. They do not establish a camera success
rate; local phone/print tests must evaluate the optical benefit.

## Limits and evaluation

Carrier 4 has carrier 3's minimum dimensions and capacity. Pictures too small
for disjoint markers, or with more than 30% of their area reserved, fall back
to carrier 1 with the existing notice. Encoding remains limited to 24
megapixels, while photo input accepts 32 megapixels, including 5712 x 4284.
Marker localization uses bounded working images; final perspective sampling
uses the full original capture. Canvas loading retains 1:1 source pixels in
strips, and large display previews use bounded backing canvases.

Focused checks: `node tests/pixelstow-v4-checks.mjs`. These explicitly enable V4
and cover eight independent marker headers, the shared V3/V4 layout, brightness treatment,
V5 selection, source/alpha preservation, attachment/password round trips, frozen
V3 pixels, V1 reading and large-input boundaries. They do not certify camera
performance. The existing resize suite explicitly selects carrier 3.

One controlled projective resample (640 x 480 encoded grid into an 864 x 672
capture, bilinear sampling with no supplied marker seed or corners) also recovered
the message through marker discovery and full payload checksum verification.
This is geometric development evidence, not a camera/photo reliability claim.

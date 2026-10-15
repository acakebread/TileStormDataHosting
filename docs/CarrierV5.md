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

Four logical 50 x 50 pixel square patches use the same 52 x 52 reservations. IDs
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

### Diagonal finder rulers (15 October 2026)

New V5 writing adds a geometric frame to IDs 0 and 8, within their existing
reservations. IDs 2 and 6 retain the five-pixel layout above. The framed corners
have a two-pixel light outer ring, a four-pixel dark border and a 40 x 40 header
grid at local offset (6, 6). The grid still has all 100 scattered cells and all
eight checksum-protected header bytes, using four-pixel wavelets. The black
frame's outer edges span local coordinates 1.5 to 49.5: a known 48-pixel ruler.
The canonical patch coordinates and native origins do not change.

`pixelstow-finder.js` scans a raster bounded to 960 pixels on its longest edge,
finds dark connected components, fits quadrilaterals and refines their edges
against the light ring. Quadrilaterals only propose positions and scale. The
codec tests orientations and both diagonal IDs and requires a real header CRC.
Two verified rulers propose an initial projective plane. The other two corners
are then independently measured by the existing marker reader before payload
recovery. A guided pyramid size targets readable symbol spacing; all original
pyramid sizes remain available. No source-image dimensions are guessed from
the capture bounds, and no full-image calibration signal is added.

For the new layout, local/global fitting uses a small continuous wavelet-energy
term as well as sign agreement. A local search compares neighbouring phase
basins when error correction has accepted a weak alignment. This avoids treating
a readable header as proof of subpixel geometry. Payload acceptance still needs
the complete frame checksum and, for locked data, authentication.

Only these two marker reservations change. Payload mapping, capacity, headroom,
PCF1 envelopes, other corner markers, side references and alpha are unchanged.
The ring/frame maps the compressed source locally to `round(value / 8 + offset)`,
with offset 223 for light and 0 for dark, and extraction applies the inverse.
This adds local quantization; the two finder frames are deliberately visible.
The original input buffer/file is never modified.

The reader recognizes both layouts without a new payload flag. Existing V5
images retain ordinary marker/frequency fallback; research writing can select
`finderMarkers: false` for comparison. Older reader builds retain native payload
compatibility, but need this update to use the new photo finder layout.

`node tests/pixelstow-finder-checks.mjs` checks arbitrary scales, tilt and a
projective capture without supplying bounds/scale, including full checked payload
recovery and a subpixel geometry regression. `tools/pixelstow-finder-appraisal.mjs`
accepts local public PNG carriers and puts private re-encodes/reports in ignored
artifacts. Controlled resampling is not an optical camera test.

Local appraisal of two supplied textured examples found both ruler headers at
0.73x, 1x and 1.37x scales. At 1.37x, header calibration took about 0.07–0.2 s,
followed by 2.9–3.5 s for all four corner measurements; both complete payloads
verified. Disabling only the ruler prepass on those same captures found zero
markers within 20–24 s. These are local timing observations, not device guarantees.
Coarse processing yields by elapsed work time; unconditional zero-delay timers
had previously added roughly 16 ms per yield on this Windows host.

The painter uses the same linearly compressed RGB reference as the payload.
It preserves that reference's local colour average through rounding. Marker
gain is bounded by available headroom for both bit orientations; it no longer
requires a separate per-cell brightness correction or channel sign flip.
Alpha is unchanged. These remain embedded signals, not invisible markings.

## Adaptive contrast

V5 shares [V4's adaptive payload contrast](CarrierV4.md#adaptive-contrast): actual
fractional repetition sets the nominal strength, source texture raises it
locally, and the stronger nonlinear ramp below 2x applies. The shared inverse
uplift raises the curve by 15% at 2x, tapering smoothly above it. The same headroom
limits prevent clipping in dark regions with highlights. This was previously
missing from the V5 writer.

The quality/durability slider is normalized to 0..1, default 0.8. Its signal
multiplier is `2^(0.8 - quality)`: 0.8 keeps the accepted boost curve, 1 is about
13% gentler and 0 about 74% stronger before existing hard ceilings. It scales
nominal strength, local texture gain and marker/payload peaks for V4 and V5;
it does not change capacity, redundancy, payload bytes or the local noise
estimator. The nominal signal applies throughout the image. Extra texture
boost uses source-only RMS after removing a local mean and plane, separately
for each 4x4 payload block and marker cell. A smooth brightness slope does not
receive that extra boost.

Corner markers and side references also adapt to source texture. Their nominal
strength is at least 12 and texture gain at least 0.5: marker headers do not
have as many repeats as the payload. Their working peaks follow the raised
curve with the existing hard ceiling of 32. The existing edge taper, square
patches, small references and local brightness balancing remain in place.
Carrier extraction accounts for the raised payload and marker peaks.

These are contrast changes within the existing marker layout and headers. Existing
V5 images remain readable. Native tests cover high, moderate and low redundancy,
source preservation and clipped colours; fresh optical captures are required
to evaluate the improvement in camera recovery.

## Linear range adjustment and source reconstruction

New V5 images reserve uniform, symmetric RGB headroom before painting wavelets:
`encodedSource = h + source * (255 - 2h) / 255`. Every RGB value participates,
including marker margins and partial edge pixels, while mid-grey remains fixed
and alpha stays unchanged. The headroom follows nominal strength plus the
redundancy/quality margin, rounded up to an even value with a ceiling of 62.
This compresses contrast in the encoded image to avoid localized brightness
and colour artefacts. Boosted payload and marker signals are limited to fit
the compressed reference with no further block brightness shift.

Carrier preamble byte 2 retains bit 1 (one-parity mode). Bit 0 is required
unless bit 7 identifies the stronger scale-pilot profile described below.
Bits 2..6 store `h / 2`; bit 7 records the scale pilot described below. The existing carrier-header CRC
protects it. The preamble length, marker headers and PCF1 payload/password
frames remain unchanged. A zero headroom denotes earlier V5 output; no separate
discovery profile is required.

Source extraction first removes payload and marker wavelets, removes the pilot
when its presence bit is set, then reverses
the recorded map: `source = (cleaned - h) * 255 / (255 - 2h)`. It restores
black/white range without estimating new endpoints from image content.
Quantization and wavelet removal remain lossy, and optical captures introduce
additional changes; this is not exact recovery of the original source pixels.

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

`node tests/pixelstow-quality-checks.mjs` verifies slider direction, the unchanged
local-noise estimator, whole-range mapping, header persistence through PNG,
source reconstruction on black/white/saturated RGB, and source/alpha preservation.

## Scale-pilot experiment: disabled

Normal V5 encoding no longer writes the full-image pilot or reserves its extra
headroom. Ordinary file recovery does not run its FFT precheck. Continuous
capture does not make a guide thumbnail or start a guide worker. Marker search
and payload recovery retain their original budgets, candidates and fallbacks.
Existing three- and sixteen-level pilot images remain readable, including source
extraction with their recorded amplitudes.

The full-image boost was visually intrusive, and the synthetic/file-based checks
did not establish a live-camera benefit. It was abandoned after phone evaluation.
A final research prototype restricted a three-level signal to a four-pixel edge
band, using shorter wavelengths 32, 21⅓ and 12.8 pixels. In the controlled planar
capture model it recovered scale in only 2/12 cases even with exact carrier
corners supplied, and 0/12 with two-pixel boundary error. The standalone flat
edge positive control passes. This prototype is not a production format.

Reproduce it with `node tools/pixelstow-edge-pilot-appraisal.mjs`, optionally
followed by paths to existing public V5 PNGs. With two local photos, four source
textures and three capture models produced the above totals. Capture models add
padding, scale, rotation, perspective, blur, exposure and noise; they are not
optical evidence. Results go under ignored `artifacts/research/edge-pilot-appraisal`.

The old full-image experiment below is retained for compatibility/research only.
It requires `{ scalePilot: true }` when encoding and `{ scaleGuide: true }` for
automatic guide appraisal during marker scanning. `scanScaleGuide` is an explicit
diagnostic operation; the application does not invoke it in normal operation.
The camera's `scaleGuideEnabled` is false on every new instance and has no UI
toggle or saved preference. No new adaptive-frequency signal has been deployed.

### Possible future direction: quiet frequency bands

A source-adaptive signal could choose the quietest pair from a small predefined
set of native frequencies, with a known frequency/phase relationship. Quiet
bands offer contrast against the source spectrum without a large absolute RGB
offset. The reader must recognise the chosen pair without having the original
source FFT. A relative ratio alone is invariant under resizing, so the allowed
native pitches must remain known, or their choice must be identifiable from the
pair. Existing four-pixel payload and five-pixel marker frequencies already give
the current reader known references. This is appraisal, not another writer change.

### Historical full-image pilot

The experimental V5 writer used a one-axis, three-tone pilot with wavelengths 128, 85⅓
and 51.2 **native pixels**. A fixed native wavelength, rather than a fixed cycle
count per image, lets the measured capture wavelength estimate capture pixels
per native pixel. Checksum-valid marker headers remain authoritative for native
dimensions; the pilot does not provide those dimensions or image boundaries.

For native column `x`, the integer RGB offset is:

```
round(16 / 2.4 * (cos(2π*2*x/256 + 0.2)
             + 0.8*cos(2π*3*x/256 + 1.1)
             + 0.6*cos(2π*5*x/256 + 2.4)))
```

The combined offset is at most sixteen RGB levels out of 255; alpha is untouched.
It is painted onto the linearly compressed reference before payload and marker
wavelets. Headroom includes the extra sixteen levels. Local texture appraisal still
uses the original source. Extraction subtracts the same integer offsets before
undoing the recorded range map. In the CRC-protected preamble, bit 7 marks pilot
presence: bit 0 set means the original three-level pilot, while bit 0 cleared
means the sixteen-level pilot. No-pilot images still require bit 0 set.
Extraction uses that recorded amplitude, so older three-level images do not
receive an excessive inverse adjustment. Payload layout, capacity, passwords and PCF1 frames
remain unchanged. Older V5 images remain readable by this reader; readers from
before this addition reject the stronger profile and need updating. Script and
worker cache versions are advanced together.

The original three-level pilot failed detection on both supplied native encoded
photos. Retaining those wavelengths but increasing the peak to sixteen, with
the confidence changes below, recovered their scale after actual re-encoding.
The pilot can be more visible, and reserving its headroom compresses source
contrast further. This does not alter the quality slider's wavelet policy or
the local noise estimator. The source preview removes the recorded pilot and
reverses the range adjustment as before.

The guide detector uses a separate low-frequency 2D FFT, since the ordinary
wavelet detector removes low frequencies. It averages to a 128-pixel maximum
edge, removes a fitted brightness plane, windows the data and retains complex
FFT values. Three collinear peaks must agree in pitch, relative amplitudes and
the translation-invariant phase relationship `phase2 + phase3 - phase5`.
An unclear full-frame result also checks a central crop. Work is bounded to
750 ms and yields between chunks. Missing scripts, an unclear signal or no pilot
returns to ordinary discovery. Rotation is allowed; perspective and photographic
texture can smear or hide the peaks, so detection is optional.

Each tone now requires local power contrast of at least 8 (previously 10), with
the existing amplitude-ratio bound. Phase error may reach 0.5 radians; an isolated
strong-window match needs contrast at least 16 and phase error below 0.4, rather
than the previous 30/0.12. Weaker matches still require consistent full/crop scale
and orientation. This remains scheduling evidence; CRC marker verification and
the full payload checksum retain their original requirements.

A detected pilot proposes an arbitrary working grid near native marker pitch
and an orientation for the first marker search. This extra attempt has a short
1.2-second allowance and uses the pilot as an unconfirmed frequency cue. It must
still decode a marker header and CRC. Every ordinary pyramid level remains
available with its original search logic, including its frequency gate, and
unvisited levels remain in the payload recovery fallback. A Fourier peak alone
never confirms an encoded image or accepts its contents.

Continuous capture independently checks a small copy of each sampled frame.
Pilot-bearing frames take priority over unhinted frames; see
[CameraCapture.md](CameraCapture.md). A marker-free pilot match cannot trigger a
payload read, and the complete payload checksum is still required.

`node tests/pixelstow-pilot-checks.mjs` covers the new writer, source removal,
alpha, measured scales 0.73/1/1.37/2.1, quarter-turn and padded 12° rotation, unencoded controls,
real guided marker/payload recovery, cancellation and all original fallback
grids after a false hint. `tests/fixtures/public-v5-before-scale-pilot.png` was
generated with the pre-pilot writer at `ea623cf` and contains only public test
text. It guards decode, extraction and padded-capture fallback for earlier V5 output. Browser worker and
camera-thumbnail mapping checks are in `tests/pixelstow-pilot-worker-checks.mjs`.
These are controlled synthetic checks, not measured optical reliability.

The frozen public `tests/fixtures/public-v5-three-level-pilot.png` from the
pre-boost writer at `9217481` guards removal of the original three-level pilot.
Twelve procedural landscapes and a deliberately wrong phase code extend the
unencoded controls for the relaxed thresholds.

`node tests/pixelstow-pilot-photo-checks.mjs <public-encoded-photo.png> [...]`
is an optional local regression for supplied photos. It reconstructs the source,
re-encodes the same public contents, checks exact PNG/payload round-trips and pilot
scale at 0.73/1/1.37, including the 512-pixel camera-analysis copy. The 1.37x copy
must recover four CRC marker headers and the exact payload through the guided
reader. It also checks
that the reconstructed source does not trigger a guide and leaves the input
files unchanged. Re-encoded examples and a metadata-only report go under ignored
`artifacts/research/scale-pilot-boost`; personal pixels/contents are not fixtures.
The two reported failures both pass these checks with scale error below 1%.
This still needs real optical capture evaluation.

### Earlier one-dimensional appraisal (15 October 2026)

`node tools/pixelstow-scale-pilot-appraisal.mjs` now provides a reproducible,
public synthetic appraisal. A fixed **cycle count** (for example eight cycles
over every carrier width) cannot determine native pixel scale: a 1024-pixel
carrier shown at 1x and a 2048-pixel carrier shown at 0.5x produce the same
observed wave. A fixed **native wavelength** does provide a scale hint. For
example, a 128-native-pixel period observed as 96 capture pixels suggests 0.75
capture pixels per native pixel. Approximate carrier bounds plus that pitch can
then suggest native dimensions. The measured pitch remains a search hint;
checksum-valid marker headers supply the authoritative dimensions.

The experiment uses three tones of wavelengths 128, 85.33 and 51.2 native pixels,
with specified phases. Their 2:3:5 frequency relationship permits a phase check
invariant to image translation, reducing coincidences with ordinary texture.
One-axis FFT column projections are tested at scales 0.5, 1 and 1.8, on four
procedural textures, with padded capture backgrounds and exact carrier crops.
Peak combined amplitudes are 1, 3 and 6 luminance levels out of 255. A controlled
flat, unpadded pilot recovers scale within 2% in all three scale cases.

At amplitude 3, the simple detector was within 5% in 9/12 carrier-cropped cases,
versus 3/12 whole-frame cases. Amplitude 1 gave 6/12 cropped successes. None of
the 24 unencoded controls passed the detector. These are small synthetic samples,
not measured camera reliability or a general false-positive bound. The tested
tilted and perspective cases all failed: projecting all rows into one spectrum
can cancel or smear the phase-coded waves. Median analysis was a few milliseconds
on this machine; image preparation and camera hardware are not benchmarked.
Detailed measurements are generated under ignored
`artifacts/research/scale-pilot-appraisal/results.json`.

Those results describe the earlier one-dimensional prototype, not the production
2D detector above. They motivated the 2D implementation and retaining the full
fallback. Natural-photo negatives, perspective, glare and fresh optical captures
remain necessary to establish real camera benefit and false-positive rates.

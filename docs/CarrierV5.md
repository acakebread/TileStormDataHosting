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

Carrier preamble byte 2 retains bit 1 (one-parity mode). Bits 2..6 store `h / 2`.
Bits (7,0) identify the guide profile: (0,1) is original V5 with no guide,
(0,0) is the subtle edge guide, (1,1) is the historical three-level full-image
pilot and (1,0) is its sixteen-level successor. The existing carrier-header CRC
protects these flags. The preamble length, marker headers and PCF1 payload/password
frames remain unchanged. A zero headroom denotes earlier V5 output; no separate
discovery profile is required.

Source extraction first removes payload and marker wavelets, removes the recorded
guide or pilot when present, then reverses
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
headroom. Ordinary file recovery does not run that pilot's FFT precheck. The
new subtle edge guide described below has a separate precheck. Marker search
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

Any future calibration guide must be visually imperceptible and measurable on
a capture reduced by 8x or 12x, so discovery can start with a cheap coarse pass.
Its measured wavelength, converted back to capture pixels, must yield the
native-to-capture scale used to target the existing embedded markers. A reduced
FFT input alone does not establish that the guide survives that reduction:
test the complete faint-signal encoding, capture, filtered reduction and scale
estimate before enabling another writer change. Visible black/white corner
frames were explicitly rejected and have been removed from normal encoding
and scanning. The original embedded markers and fallback remain in use.

A source-adaptive signal could choose the quietest pair from a small predefined
set of native frequencies, with a known frequency/phase relationship. Quiet
bands offer contrast against the source spectrum without a large absolute RGB
offset. The reader must recognise the chosen pair without having the original
source FFT. A relative ratio alone is invariant under resizing, so the allowed
native pitches must remain known, or their choice must be identifiable from the
pair. Existing four-pixel payload and five-pixel marker frequencies already give
the current reader known references. This is appraisal, not another writer change.

### Subtle known-interval edge guide (16 October 2026)

Normal browser V5 writing now includes a fixed, low-contrast opponent-colour
guide before payload and marker painting. Its RGB offset is `[d,-d,d]`, with
`d` clamped to two levels. The detector uses `(R+B)/2-G`, suppressing the
ordinary equal-RGB wavelet signal. This avoids the visible geometric boxes and
large full-image brightness changes from the rejected experiments.

The guide occupies 48px bands inset 8px from all four edges. Fixed tangential
wavelengths are 64 and 96 native pixels, modulated across each band at 24px with
a tapered envelope. Corner marker reservations (52x52) and all side-reference
patches are untouched. The guide adds no global headroom or capacity cost.
Its exact integer profile is removed after wavelet cleaning and before reversing
the recorded RGB range map. The existing source extraction remains lossy.

`pixelstow-edge-guide.js` makes one explicit box reduction, then measures the
two known frequencies locally using complex DFTs across candidate edge strips.
It uses 4x reduction for images up to 2400 pixels on their longest side, 8x up
to 3600, and 12x above that. The physical scale range and search step account
for that sampling rate; a highly magnified 4K capture can exceed the previous
2.5x search ceiling. An explicitly requested reduction still takes precedence.
The transverse envelope, opposite edges and phases relative to all four inferred
bounds must agree. This suppresses unrelated photograph texture that defeated
the earlier whole-image magnitude search. A visible image outline may propose a
rectification of this same coarse raster for tilted captures. Padding proposals
also use the RGB means from that one reduction, avoiding a second, expensive
full-resolution outline scan. When padding is present these proposals run first.
The outline itself
cannot establish encoding. The measured scale and coarse corners suggest a
marker working grid and nearby header checks before the existing scale search. A
1.2-second seed allowance protects ordinary search from false hints, while a
verified marker retains the normal full search budget. An absent guide keeps
all ordinary recovery paths; no guide alone can confirm an image or payload.

The reserved V5 flag combination (7,0)=(0,0) records this fixed guide profile.
New guided images need this updated V5 reader. All older V5 profiles and PCF1
v1 remain readable; payload framing, encryption and marker geometry are unchanged.
Explicit `edgeGuide:false` writes the previous profile. Core-only integrations
without the helper continue writing the previous profile; the browser and worker
load the helper with matching cache versions. Explicit historical `scalePilot:true`
uses only the historical pilot, never both guides.

Tests in `tests/pixelstow-edge-guide-checks.mjs`,
`tests/pixelstow-edge-codec-checks.mjs` and
`tests/pixelstow-edge-worker-checks.mjs` cover faint signal bounds/reservations,
modeled scale/rotation, actual default V5 PNG/payload round-trips, password
protection, source/alpha preservation, real browser workers and older fixtures.
Checks cover modeled 4x/8x/12x sampling and supplied optical examples at 4x/12x
reductions; this does not establish general reliability across cameras. Test a freshly
encoded V5 image and watch for the **Edge guide** scan status.

Natural-photo tests include independently re-encoded local images, their clean
sources and equivalent carriers with the guide disabled. Guide misses retain
ordinary marker recovery. A real phone-camera speed improvement still needs
optical testing; modeled resizing, rotation, blur or colour changes cannot
establish it.

#### Captured-guide recovery and diagnostics (16 October 2026)

File calibration now allows six seconds for identical work on slower devices;
live camera appraisals retain their explicit one-second limit. Padding proposals
share that budget instead of imposing a separate desktop-sized 250ms cap.
Analysis can retry a previously missed guide once, reporting a later detection
separately from the path used for the original decode. A four-times accelerated
worker clock reproduces a miss with the old limit on the supplied IMG_2379 PNG
and detection at 3.18x with the file budget. This models device speed; it is not
a direct measurement of an iPhone browser.

A supplied photographed screen exposed a detector error: one source-photo tone
could veto a match despite the intended six-of-eight component agreement. The
reader now tolerates one such outlier only when at least six correctly phased
components exceed their neighboring-frequency noise floors by 1.3 times and
at least three of four opposite-edge phase comparisons agree. This also allows
optical attenuation across unequal edges. The writer's two-level guide, profile
flags, wavelengths and source removal are unchanged.

That capture now detects at scale 1.00, versus approximately 1.02 from its known
carrier dimensions, in about 0.6 seconds at 4x reduction without marker or header
reads. Full recovery selects the guided marker grid and recovers the same exact
payload as ordinary recovery. On this machine the complete reads took about
8.9 and 9.7 seconds respectively; this is a reproduced capture, not a general
camera speed claim. Three other source photos pass six native/scaled encode
round-trips, 18 modeled scale checks and 36 guide-absent controls. Rotation,
blur, glare and other cameras can still hide this faint signal.

Recovery results retain calibration detection separately from whether that hint
actually supplied the successful marker grid. Analysis draws purple bands at
the measured guide locations and reports the scale and recovery route. A native
read has not needed calibration; enabling Analysis can run a later guide check,
which is explicitly labeled as a subsequent check rather than the original read.
Image bounds or the V5 profile flag alone never count as guide detection.

Two additional supplied captures of the same carrier exposed a scale-range and
outline-budget failure. Both contained measurable calibration; projecting them
onto independently recovered native geometry confirmed all eight component
phases. The 3024x4032 capture magnified the carrier about 3.18x, beyond the old
2.5x limit. On both files, proposing padding on the full raster could exhaust
the outline deadline before returning bounds. The coarse RGB outline pass and
sampling-aware scale range now detect their guides within one second on this machine.
Each then recovers the complete payload from a single guided marker grid,
matching ordinary fallback exactly, in about ten seconds on this machine.
No writer amplitude, guide profile or payload format changed.

Continuous capture uses the single calibrated marker grid for positive frames,
then moves to a fresh frame on failure. It retains occasional ordinary fallback
for guide misses and older images; file import and manual recovery keep their
full scale search. See [CameraCapture.md](CameraCapture.md#subtle-v5-edge-guide).

#### Earlier sampling proof

The intended fast path is a positive recognizer: weak guides at known native
pixel intervals, potentially on perpendicular edge bands, promote promising
frames and estimate marker-search scale. A missing guide retains ordinary
recovery. Multiple related intervals/phases should be recognized together;
the strongest raw frequency alone can belong to the source photograph. Band
width as well as wavelength must survive the chosen reduction. Edge placement,
visibility and optical reliability remain unvalidated.

`node tools/pixelstow-coarse-guide-appraisal.mjs` checks two fixed pitches of
96 and 64 native pixels and their known phase relationship, with a combined
maximum signal of two grey levels and 8-bit input quantization. It recovers
0.5x, 1x and 2x magnification after each of 4x, 8x and 12x box averaging (nine
cases), despite a stronger unrelated source frequency. This is an ideal 1D
sampling proof, not a camera detector or a codec/visibility test. Reports go
to ignored `artifacts/research/coarse-guide/sampling-proof.json`. This proof
predates the actual two-dimensional colour guide above.

The earlier camera path resized to a maximum edge of 512, then the Fourier
appraisal reduced again to 128. That can make a 4K capture approximately 32x
smaller, rather than a controlled 4x, 8x or 12x. Any new detector must track
the actual reduction and avoid this hidden second reduction.

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
means the sixteen-level pilot. Original no-pilot images have bit 0 set;
the new edge-guide profile uses the previously reserved zero combination.
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

# Browser visual transform reader experiment

The original research branch was `codex/visual-transform-reader`; the browser
reader is now on `main`. Current changes are for local user evaluation, with no
new versioned fixtures, commit or deployment.
Carrier 3 retains its eight 72 × 48 wavelet patches, dimensions and identifiers.
Carrier 1 remains readable, and neither carrier's byte layout changes. No centre marker,
visible ruler, border reservation, upload or service is added.

## Local use

The main page also provides **Open camera** for ranked background capture
and **Take photo** for native still capture. See [CameraCapture.md](CameraCapture.md)
for acquisition, worker scheduling, near-miss feedback and browser requirements.

Open `pixelstow.html` directly or through the existing localhost server and choose
an input image. Direct `file://` opening runs the detector on the page because
browsers block the file worker's opaque origin; it yields between chunks to keep
progress and cancellation available. HTTP/HTTPS runs the whole automatic inspection
in one disposable Web Worker, including native reads and final payload checks.
Reading starts automatically when an image is chosen, pasted or loaded from a
link. The preview appears before recovery, with progress and **Cancel search**
outside the options panel. The pipeline stops at the first readable payload:

1. Direct full-frame reading, including previous carrier 1 images.
2. A small set of common full-frame resize ratios and phases for carrier 3.
3. Marker-only geometric discovery with the existing FFT gate, outline proposals
   and frequency-derived local search. Two agreeing markers can propose a
   translation, three non-collinear markers an affine fit, and four independently
   measured markers a perspective fit. Remaining markers are located before any
   payload is read.
4. Rank the resulting fits, then read their payloads in that order, stopping at
   the first complete checksum-valid result.

Running the padding, affine and perspective modes as three separate fallback
passes would repeat FFT analysis and seed localization. Automatic reading uses
the working perspective reader once instead, after the inexpensive full-frame
checks. Translation, affine and perspective fits share the same marker evidence.
`scanMarkers` reads only locator symbols; `readMarkerCandidates` performs body
reads afterwards. Candidates are rated by agreement with all 96 known symbols,
independently aligned marker count, spatial coverage, verified headers and fit
error. Near-identical geometries are deduplicated, with at most eight retained.
A marker-search timeout retains viable fits rather than discarding them.
An immediate-read threshold requires all eight markers to be independent fit
inliers, at least two CRC-valid headers, at least 0.9 known-pattern agreement,
coverage of at least 0.6 of the native image area and mean fit error at most 0.6
working pixels. This is a scheduling heuristic, not a guarantee of readable data.
If that early read fails, ordinary file recovery resumes the unvisited scales
using its retained seed and measurements. The body checksum remains mandatory.
The successful verification
returns geometry and inspection metadata without sending payload bytes from the
worker, and avoids a duplicate verification before initial inspection returns.
Unlocking and subsequent decoding reuse recovered geometry and verify
the frame again; they do not repeat discovery.

Generated output uses a separate direct verification path: the writer supplies
the exact carrier version, image dimensions and nominal signal strength. The reader
scores that native pixel lattice and validates the complete frame/payload without
requiring locator detection or searching scales, phases or photograph geometry.
The nominal strength is tried first; the existing strength templates remain
available for blocks whose written amplitude was reduced to avoid clipping.
PNG export checks exact pixels and decoded attachment bytes; JPEG export also
uses the native lattice and is offered only if all contents survive. Compression,
parity, encryption and carrier layouts are unchanged. Ordinary full-size version
3 imports try the same direct header/payload read before looking for locators.
The encoder's input guard uses native and common-ratio checks instead of repeating
the broad resize scan. A genuine capacity error reports framed bytes required
and available, including compressed body and framing, rather than blaming every
verification failure on image space.

For geometric inputs at least 640 pixels on the longest side, available working
sizes are 1/16, 1/8, 1/4, 1/2 and full size, omitting tiny or duplicate rasters.
Search starts near a 1000-pixel longest side, or the scale predicted by a tracking
header. The measured score at each attempted size chooses the next: verified
marker agreement and fit rank take precedence, with weak 24-symbol pilot scores
used only when no header verifies. Neighbouring sizes that improve the score are
favoured; a colder neighbour lowers that direction's priority. A verified header
also supplies actual symbol spacing, favouring approximately 1.2 working pixels
per stored pixel and skipping levels outside the local detector's basis range.
Both directions remain available after weak evidence: scores are not monotonic
enough to justify an irreversible binary-search rejection.

Marker fits are ranked before payload reads, except that a complete high-confidence
fit stops further scale discovery and starts its read immediately. Every working raster
is reduced directly from the original capture using pixel-area averaging, without
cascaded resizes or accumulated rounding. These passes share the 60-second
discovery budget. Unproductive seed searches receive a share of the remaining
time, preserving time for other levels. Once a checksum-valid marker header is found, its geometry search can use
the remainder of the shared budget without discarding the localization state.
No payload read runs while individual markers are still being collected. Working-scale
verification establishes only geometry proposals; the accepted payload still
comes from the rectified full capture.
Large photographs can enlarge carrier symbols beyond the existing detector's
scale range; area filtering makes their geometry easier to locate. A weak FFT
signature, missing header or failed payload at one level does not reject the
other levels. Frequency absence at half size is not evidence that quarter size
cannot work: both undersampling and the detector's basis limits affect the result.
Working images
provide marker transforms and the original dimensions recorded in their headers.
They do not supply the accepted payload in this large-photo path. Their transforms
are mapped back into full-capture coordinates, with the pixel-centre offset.

Once geometry is established, `rectifyPhoto` samples the original full capture
directly into an image of exactly the recorded encoded dimensions. Each native
pixel represents a footprint mapped by one continuous 3 × 3 homography. Local
derivatives choose a quadrature density, bounded at eight samples per axis; every
subsample uses the exact perspective denominator and bilinear source interpolation.
This integrates enlarged pixels rather than taking isolated points through screen
moire. There is no intermediate preview resize and no two-triangle approximation.
The existing wavelet reader checks this native raster, starting with its repeated
preamble, with a small phase refinement before accepting the full frame checksum.
Phase adjustments are composed in native space on the right of the homography.

If that read fails, the photograph reader now measures local carrier phase on
the reconstructed native raster. The two symbols share a central 2 × 2 lobe,
which supplies horizontal and vertical four-pixel frequency components without
knowing any payload bits. Hann-windowed measurements on a 32-pixel grid use
second differences to suppress the underlying photo; neighbour continuity unwraps
the four-pixel phase. Weak measurements or corrections exceeding eight native
pixels are rejected. The interpolated offsets correct small residual grid errors
that a single marker homography cannot remove. They add no encoded markers and
change no carrier bytes.

The reader then reconstructs the native raster again from the **original full
capture**, applying these offsets before the continuous perspective transform.
It does not warp the already resampled preview. The correction is retained only
after complete frame and payload validation, and travels with the geometry from
the worker for subsequent decoding/unlocking and approximate source comparison.
Up to three residual measurements compose these small corrections; every sampling
pass uses the full original rather than cascading resizes. If an averaged-colour
read fails, green, red and blue channels are checked individually with the same
frame/payload checksum. The chosen channel is retained for later reads, while the
colour image stays intact. Correction attempts use one waveform template at the
native phase instead of repeatedly decoding a damaged compressed payload at every
nearby phase and strength. An ordinary successful photograph read skips this
fallback; direct generated-image verification is unchanged. Both measurement and
reconstruction yield for cancellation.
The final geometry check also permits a small edge overshoot (one percent, capped
at twelve working pixels), while retaining convexity and denominator checks.
Small framing loss still has to survive the payload checksum; it is not general
support for cropped photographs.

The supplied full-resolution 4032 × 3024 photograph of the Millmead image passed
with this fallback at its recorded 1280 × 960 resolution, including its audio
attachment. The subsequently supplied `IMG_2359.png` (also 4032 × 3024) passed at
960 × 960 with two correction passes and a green-channel read, including its audio.
Both also passed a repeat read after transferring only the recovered geometry,
correction and channel metadata to a fresh codec instance, as the worker/page
handoff does. The earlier `IMG_2353.png` still passes at 640 × 480 without local
correction or an alternate channel. Their previous marker-only/global-phase fits
failed. The marker fitting
and refinement routines were unchanged from the earlier successful photograph
reader (`6675dc8`); this adds local alignment recovery rather than changing the
writer or weakening frame validation. Personal captures and their contents remain
in ignored diagnosis artifacts, not versioned fixtures.

Input pixels, files and displayed dimensions remain unchanged. The rectified native
raster and its sampling transform are retained for later checksum-verified reads
and source extraction. Camera workers return the dimensions, homography and phase
metadata; subsequent page reads can recreate the identical raster from the original
capture. Guide coordinates stay in full-capture space. A focused diagnosis of the
supplied 4032 × 3024 PNG recovered all eight markers and a checksum-valid payload
on a 640 × 480 native grid, both through the codec and through the localhost
browser's worker/import path. The original raster remained 4032 × 3024. Its
manually resized 25% counterpart was used to compare localization and filtering;
pixel-area reduction also located all eight markers, so changing its filter was
not necessary for this capture. This is evidence for that one input, not general
phone, photographic or print support. No broad test suite was run. Private input
files and diagnostic geometry remain outside versioned fixtures.

Below the preview and image contents, **Image recovery options** provides
**Automatic · recommended** and the three individual modes for retries. **Padding
only · original size** assumes original pixels are preserved, with arbitrary
surrounding padding. Padding can contain texture or other photographic material.

The optional modes attempt affine geometry (rotation, scaling, independent
stretch and shear) and planar perspective geometry. A whole-image FFT precheck
reports likely carrier-frequency evidence immediately after spectral analysis,
with a separate indication of the coarser marker band. With no clear signature,
the attempt exits before localization. **Search anyway if the frequency signature
is weak** overrides this heuristic gate: absence of narrow peaks is not proof
that no encoded data exists, especially after blur, shrinking or perspective.

The reader then proposes a quadrilateral from a dominant padding colour when
available (including white and orange backgrounds), or searches at up to twelve
frequency-derived bases. It no longer runs 432 full-image angle/scale sweeps.
Local fits adjust both axes and shear; all discovery/fitting has a 60-second
budget. **Cancel search** terminates the worker, or aborts the next chunk in
direct-file mode. Follow-up decoding carries the same abort signal through native
pixel scoring and chunked soft-parity decoding; late worker progress is ignored.
Budgeted/cancelled searches do not imply the image is unencoded.

A cyan quadrilateral shows inferred encoded-image bounds when **Show detected
bounds and markers** is enabled. Successful reads have a clean preview by default.
If recovery confirms markers but cannot read the payload, guides appear
automatically with advice to include all four corners, fill more of the frame,
keep sharp focus and avoid glare. A successful retry hides automatic guides;
an explicit checkbox choice is retained for that image only. Inputs with no
confirmed markers and password prompts do not trigger automatic guides.
The overlay canvas is drawn on demand. Yellow rectangles have
decoded, CRC-valid headers. Green rectangles match the expected full marker
pattern after dimensions are established by a valid header. Dashed rectangles
show expected positions that were not confirmed. Counts distinguish header reads
and known-pattern matches. The overlay checkbox hides those guides without
changing reading or exported pixels. If the payload verifies,
existing message, file, audio and password controls handle it. Valid markers
with an unreadable payload block re-encoding.

## Detection and geometry

### Curved carrier tracking (experimental)

Follow-up marker search now retains a confirmed header/pattern if optional local
refinement reaches its time limit. Previously that exception could discard an
already confirmed last patch and return seven detections. Cancellation still
aborts the operation; retaining a marker does not accept its payload.

Nearby searches rank complete 96-symbol patterns once dimensions are known,
after their cheaper pilot shortlist. After global refinement, missing patches
receive a bounded final retry, including a prediction from neighbouring measured
positions/axes and a small full-pattern search. Missing-marker passes reserve
1.5 seconds from global refinement; each final patch retry is capped at 1.2 seconds
and stays within the existing overall deadline. No missing marker is invented.
Metadata records missing IDs, plane outliers, and unfinished/timed-out searches.
The image recovery and camera near-miss UI show missing positions and time limits.

Seven detections do not block decoding: geometric stability and the payload
checksum decide it. Eight individual detection opportunities also make one miss
quite common even with a good per-marker success rate. Repeated missing positions
or unfinished searches provide more useful diagnostic evidence than count alone.

`pixelstow-lattice.js` adds a photograph-only fallback after the native read and
first existing local-phase attempt fail. The remaining original phase attempts
are retained if this fallback cannot verify a payload. Generated-image reading,
encoding verification and all carrier writers are unchanged, including default
carrier 4. Both camera candidates and ordinary geometric image imports use it.

The tracker samples the full original capture around the predicted native grid,
before reducing it to one sample per original pixel. Local windows span 24 native
pixels and are sampled at half-pixel spacing. Footprint averaging suppresses
capture detail above that sampling rate without constructing a full-size floating
point raster. Marker reservations are excluded: their different frequency must
not pull the payload's grid out of alignment.

A separable complex-frequency search measures spacing, transverse frequency and
phase in both directions. Its spacing bank covers 0.84 to 1.16 times the expected
carrier frequency; transverse offsets cover -0.12 to 0.12. The shared component
of the two payload symbols supplies phase without deciding their unknown bits.
CRC-verified/known-pattern marker fits anchor native displacement. At least three
reliable independent marker patches are required; a tentative FFT signature cannot start
this recovery by itself.

Only independently localized known-pattern fits act as curved-map anchors;
prediction-only pattern matches supply no independent displacement. Strong local
marker axes also supply soft interior controls. When at least two patches supply
these measured axes, the tracker fits a bounded coarse deformation before its
first frequency measurement, so a poor straight-plane reconstruction need not
erase that measurement. Marker constraints are weighted by reliability rather
than pinning every weak match equally. Seven measured patches can supply this
initialization; eight are not required. After a tracked native read fails, a small
fractional-pixel phase bank (-0.25, 0, +0.25) checks the repeated preamble before
full body reading. Full frame/payload checks remain mandatory.

Phase is periodic by four pixels. Tracking starts near marker anchors and follows
reliable neighbouring measurements using their estimated spacing/direction. Weak
windows do not drive raster-order phase unwrapping. Inconsistent neighbouring
cycles receive less weight. A confidence-weighted thin-plate fit fills a 40-pixel
control grid, with marker constraints fixing the global phase branch. A continuous
Catmull-Rom spline supplies offsets and first/second derivatives between controls.
Fields with excessive displacement, gradients or folded/extreme local area changes
are rejected before sampling.

The native raster is reconstructed from the original capture through the combined
curved mapping and perspective transform. Local derivatives choose footprint
sampling density; a quadratic expansion within each pixel follows its curvature.
The exact projective denominator is still evaluated at every subsample. Previous
corrected rasters are never resampled into the next attempt. There are at most two
tracking attempts (averaged colour, then green), sharing an eight-second tracking
budget and respecting the caller's deadline and cancellation. Existing payload
worker termination/preemption applies to this step as well.

Only the usual preamble, frame and payload checksums accept the result. Accepted
geometry includes the typed spline controls and chosen read channel, so a fresh
worker/page can reconstruct it for decoding or unlocking. Approximate source
comparison solves an inverse map once on an eight-pixel native grid instead of
iterating the spline for every high-resolution camera pixel. That inverse lookup
is for the preview only; decoded contents use the forward footprint mapping.

Focused validation: `node tests/pixelstow-lattice-checks.mjs`. A controlled
640 x 480 carrier-4 image with smooth nonlinear displacement (up to five native
pixels horizontally and three vertically), captured into a 2112 x 1600 raster,
fails the perspective-only read and passes through original-capture tracking.
The same case checks real marker-header anchors, full payload checksum, worker-style
geometry replay, the inverse preview map and cancellation/budget handling. An older
supplied saved capture still fails with its recorded marker fit. These results do
not establish general camera, print, lens-calibration or high-resolution support.

`node tests/pixelstow-marker-search-checks.mjs` adds focused search-control checks
for the eighth-marker retry, full-pattern ranking, retention of an already verified
marker at the time limit, a genuinely missing marker, and cancellation. The curved
capture check also exercises recovery from seven independently fitted marker grids.

`pixelstow-spectrum.js` implements a radix-2, two-dimensional FFT without external
libraries. It analyzes luminance across the supplied frame, emphasizing high
frequencies and tapering edges without discarding outer marker evidence. Large
inputs use odd-stride sampling with bounded FFT dimensions; candidate frequencies
are unfolded to account for aliasing. Narrow paired peaks for the carrier lattice,
diagonal support and the lower-frequency locator family propose local read bases.
Four possible quarter-turn orientations are tried for each selected basis. These
are heuristic proposals, not calibrated probabilities or format verification.
The global magnitude spectrum cannot count or locate eight individual patches.

The frequency gate now requires both independent peaks to exceed the mean
spectral power by a factor of 32, with sum/difference support. Local contrast
alone previously accepted ordinary photographic texture at every pyramid level.
Frequency evidence is described as tentative until a locator header passes its
checksum; final UI feedback replaces that provisional message with verified
contents, verified markers with unreadable contents, or no verified encoding.
Cancelled searches clear provisional feedback. Neither FFT peaks nor an outline
block encoding or establish a valid payload by themselves.

Axis/diagonal peak pairs can represent the same lattice with a sheared basis.
Lattice reduction proposes the shorter axes first, retaining the original basis
for genuinely sheared images. Equivalent quarter-turn families are deduplicated
within the existing twelve-bank limit. Once a pyramid level reads a valid
header, later levels first reconfirm that patch against their own pixels and
reuse its dimensions and plane proposal, avoiding a repeated seed search.

Focused local checks rejected a supplied unencoded 2016 × 1512 photograph at
all five frequency scales, and retained message/audio recovery on a previously
read 4032 × 3024 photo. A separate saved 4032 × 3024 camera capture now yields
marker headers but still fails complete payload validation. It remains a
recovery limitation, not a successful fixture. Its PNG decode/write/decode
round trip preserved every RGBA byte. Camera import reuses the successful
frame's geometry; reopening an ordinary PNG starts discovery again. The PNG
contains no saved transform, so those paths need not arrive at the same fit.

The codec supplies locator definitions, parity/header decoding and known-pattern
scores to `pixelstow-transform.js`. The first 24 coded locator bits form a known
pilot (magic and patch identifier). A diagonal response field samples original
luminance using the six-pixel symbol profile. Spatial pilot correlation proposes
a bounded list of peaks. Supplied image edges are not treated as encoded bounds.

Candidate headers must pass identifier, dimension constraints, soft parity and
CRC. Unlike full-frame recovery, discovery does not compare supplied dimensions
with recorded encoded dimensions. Translation search is followed, in wider
modes, by local affine patch fitting. One patch supplies original dimensions
and an initial transform; its identifier determines the canonical position.
That predicts the remaining patches, where bounded local searches confirm other
headers or correlate against all 96 known symbols. In the affine and perspective
modes, confirmed patches are also fitted independently using the known pattern;
merely passing a threshold at a predicted position supplies no measured local
directions. Perspective refinement preserves the current patch's projective
curvature while independently adjusting its centre and both local derivatives;
it no longer flattens the patch into an affine transform. Searches prefer patches
far from existing confirmations. A small set of viable affine/projective
predictions remains available while the perspective
fit is extrapolating from one side. One damaged header need not discard a useful
marker. Contents still require the complete payload checksum.

Padding mode requires another patch to confirm the translation. Affine fitting
requires three non-collinear patch centres. A centre-only perspective fit requires
four centres with no collinear triple: the three top-row markers and a left-side
marker cannot determine a homography by themselves. An additional fit uses interior
control points derived from each independently measured local patch transform.
These are measurements of the existing pattern, not additional encoded markers.
Three non-collinear measured patches can propose that fit, but at least four
whole patches must agree before accepting perspective geometry. Fits enumerate
small subsets, reject outliers by centre and local-direction error, and refit
using weighted, normalized coordinates. Invalid fits cannot replace a viable
search prediction; full-pattern agreement ranks the remaining candidates.

Known full 96-symbol patch patterns refine pixel alignment. Convexity and a
scale-invariant denominator check reject singular/folded planes before search
predictions are updated. Coarse estimates may overshoot the supplied bounds by a
small margin while finding other markers and refining alignment; the final fit
retains the stricter three-pixel bounds check. Actual image corners are inferred
from inset marker coordinates. A padding-outline proposal alone establishes no
encoding evidence and never accepts a payload.

A 3 × 3 homography maps original pixel centres to observed pixel centres. Each
coordinate is a ratio of linear expressions. One continuous mapping covers the
plane, without two affine triangles. Payload samples go directly through that
transform in floating point for the established smaller-image path. Large photos
instead use the native raster reconstructed from the full capture as described
above. A small phase search checks the repeated preamble before scoring the whole
payload. Complete PCF1 frame validation is required.

Geometry and, where used, the rectified native raster are retained for later
reads/unlocking. Payload bytes are read and verified again. Approximate source
extraction removes signal in canonical read space, then maps that source back
for comparison, preserving surrounding padding.
The overlay is a separate canvas, excluded from exports and clipboard data.

## Files and limits

- `pixelstow-transform.js`: pilot search, local fitting, robust affine/homography
  estimation and alignment refinement; works in a worker or on the main thread.
- `pixelstow-spectrum.js`: whole-image frequency triage and candidate read bases.
- `pixelstow-transform-worker.js`: imports detector and codec, searches a
  transferred copy of input pixels, and returns geometry, progress and inspection
  metadata; payload bytes stay in the worker when checking a simpler fit.
- `pixelstow.js`: locator adapter, transform sampling, payload verification and
  geometry-aware approximate source extraction.
- `pixelstow.html`: automatic import recovery, optional manual search modes,
  cancellation and diagnostic overlay. The image viewport owns pinch zoom and
  two-finger pan, sharing one transform across both comparison images. One finger
  still drags the divider; mouse wheel zoom, left-button comparison and right-button
  pan remain available. Native page zoom is suppressed inside the viewport only.

The user has reported successful recovery from a photograph with the committed
reader (`6675dc8`). This is useful evidence for that input, rather than a general
print/camera guarantee. No general support for cropped-away markers, curved paper,
lens correction, camera blur or halftoning is claimed. Corner location and payload
recovery are reported separately: a plausible outline alone is not a successful
decode. The automatic routing changes still need local user evaluation.

Four confirmed markers can be sufficient: in padding mode only translation is
unknown, and the header gives the original dimensions. Marker rectangles contain
locator metadata; the message is distributed separately across the image with
its existing parity/repetition. Missing marker headers therefore do not imply
missing message bytes. Successful contents are accepted only after frame checks.

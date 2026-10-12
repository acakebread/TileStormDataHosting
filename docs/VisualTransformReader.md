# Browser visual transform reader experiment

Work on branch `codex/visual-transform-reader`. This is implementation for local
user evaluation, with no new fixtures, executed tests, commit or deployment.
Carrier 3 retains its eight 72 × 48 wavelet patches, dimensions and identifiers.
Carrier 1 and the ordinary full-frame reader remain unchanged. No centre marker,
visible ruler, border reservation, upload or service is added.

## Local use

The main page also provides **Open camera** for sequential background capture
and **Take photo** for native still capture. See [CameraCapture.md](CameraCapture.md)
for acquisition, worker scheduling, near-miss feedback and browser requirements.

Open `pixelstow.html` directly or through the existing localhost server and choose
an input image. Direct `file://` opening runs the detector on the page because
browsers block the file worker's opaque origin; it yields between chunks to keep
progress and cancellation available. HTTP/HTTPS uses the disposable Web Worker.
Reading starts automatically when an image is chosen, pasted or loaded from a
link. The preview appears before recovery, with progress and **Cancel search**
outside the options panel. The pipeline stops at the first readable payload:

1. Direct full-frame reading, including previous carrier 1 images.
2. A small set of common full-frame resize ratios and phases for carrier 3.
3. One shared geometric search with the existing FFT gate, outline proposals and
   frequency-derived local search. Two agreeing markers can propose a translation,
   and three non-collinear markers an affine fit; the complete frame is checked
   before either short-circuits discovery. If those fail, localization continues
   toward the existing four-marker perspective fit.

Running the padding, affine and perspective modes as three separate fallback
passes would repeat FFT analysis and seed localization. Automatic reading uses
the working perspective reader once instead, after the inexpensive full-frame
checks. Each simpler model gets at most one payload attempt; its failure keeps
the same marker/search state for the perspective fit. The successful verification
returns geometry and inspection metadata without sending payload bytes from the
worker, and avoids a duplicate verification before initial inspection returns.
Unlocking and subsequent decoding reuse recovered geometry and verify
the frame again; they do not repeat discovery. Encoding/internal codec checks
retain their existing read path and do not start photographic searches.

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
direct-file mode. Budgeted/cancelled searches do not imply the image is unencoded.

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

`pixelstow-spectrum.js` implements a radix-2, two-dimensional FFT without external
libraries. It analyzes luminance across the supplied frame, emphasizing high
frequencies and tapering edges without discarding outer marker evidence. Large
inputs use odd-stride sampling with bounded FFT dimensions; candidate frequencies
are unfolded to account for aliasing. Narrow paired peaks for the carrier lattice,
diagonal support and the lower-frequency locator family propose local read bases.
Four possible quarter-turn orientations are tried for each selected basis. These
are heuristic proposals, not calibrated probabilities or format verification.
The global magnitude spectrum cannot count or locate eight individual patches.

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
transform in floating point. A small phase search checks the repeated preamble
before scoring the whole payload. Complete PCF1 frame validation is required.

Only geometry is retained for later reads/unlocking. Payload bytes are read and
verified again. Approximate source extraction removes signal in canonical read
space, then maps that source back for comparison, preserving surrounding padding.
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
  cancellation and diagnostic overlay.

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

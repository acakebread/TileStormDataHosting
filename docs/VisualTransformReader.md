# Browser visual transform reader experiment

Work on branch `codex/visual-transform-reader`. This is implementation for local
user evaluation, with no new fixtures, executed tests, commit or deployment.
Carrier 3 retains its eight 72 × 48 wavelet patches, dimensions and identifiers.
Carrier 1 and the ordinary full-frame reader remain unchanged. No centre marker,
visible ruler, border reservation, upload or service is added.

## Local use

Open `pixelstow.html` directly or through the existing localhost server and choose
an input image. Direct `file://` opening runs the detector on the page because
browsers block the file worker's opaque origin; it yields between chunks to keep
progress and cancellation available. HTTP/HTTPS uses the disposable Web Worker.
Normal reading runs first. Below the preview and image contents, expand
**Visual transform reader — experimental** and choose **Find encoded image**.
The first/default mode is **Padding only · original size**. It assumes the
encoded rectangle's original pixels are preserved, with arbitrary surrounding
padding. Padding can contain texture or other photographic material.

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

A cyan quadrilateral shows inferred encoded-image bounds. Yellow rectangles have
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
headers or correlate against all 96 known symbols. One damaged header need not
discard a useful marker. Contents still require the complete payload checksum.

Padding mode requires another patch to confirm the translation. Affine fitting
requires three non-collinear patch centres. Perspective fitting requires four
centres in a solvable projective configuration. Fits enumerate small subsets,
reject outliers by reprojection error and refit using normalized coordinates.
Known full 96-symbol patch patterns refine pixel alignment. Convexity, denominator
and bounds checks reject invalid quadrilaterals. Actual image corners are inferred
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
  transferred copy of input pixels, and returns geometry and progress only.
- `pixelstow.js`: locator adapter, transform sampling, payload verification and
  geometry-aware approximate source extraction.
- `pixelstow.html`: explicit search modes, cancellation and diagnostic overlay.

No support for cropped-away markers, curved paper, lens correction, physical
printing, camera blur or halftoning is claimed. Corner location and payload
recovery are reported separately: a plausible outline alone is not a successful
decode. This experiment needs the user's local evaluation before reliability
or performance claims.

Four confirmed markers can be sufficient: in padding mode only translation is
unknown, and the header gives the original dimensions. Marker rectangles contain
locator metadata; the message is distributed separately across the image with
its existing parity/repetition. Missing marker headers therefore do not imply
missing message bytes. Successful contents are accepted only after frame checks.

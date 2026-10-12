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
stretch and shear) and planar perspective geometry. Initial search uses coarse
rotation/scale hypotheses; local fits adjust both axes and shear. It is not an
exhaustive search over all affine/projective parameters. Detection may fail
between hypotheses, or under substantial stretching, skew, blur or compression.
Wider searches can be expensive. Progress identifies the current bank, and
**Cancel search** terminates the worker, or aborts the next chunk in direct-file mode.

A cyan quadrilateral shows inferred encoded-image bounds. Yellow rectangles and
identifiers show the checksum-valid patches. The overlay checkbox hides those
guides without changing reading or exported pixels. If the payload verifies,
existing message, file, audio and password controls handle it. Valid markers
with an unreadable payload block re-encoding.

## Detection and geometry

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
That predicts the remaining patches, where local searches confirm other headers.

Padding mode requires another patch to confirm the translation. Affine fitting
requires three non-collinear patch centres. Perspective fitting requires four
centres in a solvable projective configuration. Fits enumerate small subsets,
reject outliers by reprojection error and refit using normalized coordinates.
Known full 96-symbol patch patterns refine pixel alignment. Convexity, denominator
and bounds checks reject invalid quadrilaterals. Actual image corners are inferred
from inset marker coordinates; no natural photograph border detector is used.

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

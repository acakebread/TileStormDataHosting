# TileStorm Evolution Data Hosting

This repository hosts the public community map catalogue for TileStorm Evolution.

Use the web portal to:

- Launch the live WebGL build.
- Browse shared maps.
- Open a shared map directly in TileStorm Evolution.
- Download a map package for local testing.
- Read the authoring guide for publishing and updating maps.

Useful links:

- Portal: `index.html`
- Authoring guide: `content-authoring-guide.html`
- Technical notes: `technical-notes.md`

The home page Eggbot icon opens `eggbot.html`, a standalone 3D animation
playground using the original Eggbot art and animations. See
[preview, checks and asset export](docs/EggbotPlayground.md).

PixelStow's browser utility is `pixelstow.html`. It encodes optional text, file
attachments and short voice recordings locally into a new image. V5 is the
default encoding and recovery format. Enable older-format recovery under Image
recovery options to read versions 1, 3 and 4; all writer choices remain available.
Decode and the [MarkerTracker lab](docs/MarkerTracker.md) at `markertracker/`
share whole-frame binary acquisition and live GPU-assisted tracking. Camera
markers can appear anywhere in the preview; there is no outer-edge restriction.
The bottom Debug link opens MarkerTracker, whose Exit button returns to PixelStow.
The lab defaults to an experimental pruned quarter-tree worker search, with
pruned halves and the previous BSP selectable; Decode keeps its previous acquisition.
See [payload format and rollout](docs/PixelStowPayloads.md). Run
`node tests/pixelstow-checks.mjs` for codec checks and
`node tests/pixelstow-v5-default-checks.mjs` for the default/opt-in recovery policy,
and `node tests/pixelstow-sizing-checks.mjs` for optional source sizing and
bounded prognosis targets. `node tests/pixelstow-prognosis-checks.mjs` checks
that quality controls intensity without resizing, while prognosis can downscale
within the payload capacity limit (using the camera checks' Playwright setup).
For the older combined browser suite,
serve this directory on localhost and open `tests/pixelstow-browser.html`
for the browser and real
MediaRecorder checks; those use a synthetic tone and never access the microphone.
The browser checks also cover separate encoding/unlocking passwords, the visible
contents summary, relocking, and context-menu suppression during image panning.
Every export offers a filename dialog before downloading, including recovered
attachments. The image picker identifies the loaded file or a clipboard paste.
Encoding uses one password slot: Encode or Enter advances to confirmation;
Change returns to the first entry. A blank password remains public.
`node tests/pixelstow-password-checks.mjs` checks this flow, protected/public
round trips and stable Encode positioning at mobile widths. It uses the same
Playwright/Chrome environment overrides as the [camera checks](docs/CameraCapture.md).
`node tests/pixelstow-preview-checks.mjs` checks the compact preview toolbar,
shared speaker control, current-image Preview button and real touch long-press,
tap, single-finger pan, pinch and cancellation behaviour on mobile, plus desktop
left-drag panning and mouse/keyboard use. The yellow Preview action comes first
in the lower action row. Its clean viewer supports a source/image toggle after
100%, without adding a divider to the transmitted picture.
Right-click in this lower preview offers **Copy image to clipboard**, copying
the full PNG of its current image/source mode. Right-drag still pans. The real
browser check `node tests/pixelstow-preview-clipboard-checks.mjs` verifies exact
pixels and menu gestures with a stubbed clipboard.
`node tests/pixelstow-recovery-ui-checks.mjs` checks cancellation followed by the
bottom Decode action, actual worker recovery and the Analysis calibration overlay.

**Post to Facebook** shares the prepared encoded photo as a file only, with no
title, text or URL in the native share payload. Choose Facebook in the share
sheet, then paste the separately copied PixelStow opening instructions into its
caption or a comment. Alternatively download the photo and attach it in Facebook
with the copied message. Finish posting in Facebook. PixelStow needs no
upload/hosting service. `node tests/pixelstow-media-sharing-checks.mjs` uses
Playwright/Chrome to check real voice conversion/first-tap preview and capture
the image-only sharing payload without posting; runtime environment overrides
match the [camera checks](docs/CameraCapture.md).

The experimental V5 edge guide is described in [CarrierV5.md](docs/CarrierV5.md#subtle-known-interval-edge-guide-16-october-2026).
Run `node tests/pixelstow-edge-guide-checks.mjs` and
`node tests/pixelstow-edge-codec-checks.mjs` for signal/codec checks, and
`node tests/pixelstow-edge-worker-checks.mjs` with the same Playwright setup for
real browser workers. Optional local-photo checks are
`node tests/pixelstow-edge-photo-checks.mjs <encoded-photo.png> [...]` and
`node tests/pixelstow-jpeg-photo-checks.mjs <source.jpg> [...]`.
`node tests/pixelstow-edge-capture-regression.mjs <camera-capture.png> <expected-scale>`
checks a supplied optical capture without marker/header reads. Add `--recover`
to verify that calibration leads to a successful read on its single guided grid.
Calibration provenance and the historical guided file grid are checked with
`node tests/pixelstow-calibration-data-checks.mjs`.
Personal input images stay unchanged; generated copies/reports go under ignored
`artifacts/research/edge-guide`. Supplied photographed screens now detect their
existing guides at both 0.82x and 3.18x magnification, including a 4K capture;
broader optical reliability still needs testing.

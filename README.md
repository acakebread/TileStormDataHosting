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
attachments and short voice recordings locally into a new image. See
[payload format and rollout](docs/PixelStowPayloads.md). Run
`node tests/pixelstow-checks.mjs` for codec checks, then serve this directory on
localhost and open `tests/pixelstow-browser.html` for the browser and real
MediaRecorder checks; those use a synthetic tone and never access the microphone.
The browser checks also cover separate encoding/unlocking passwords, the visible
contents summary, relocking, and context-menu suppression during image panning.
Every export offers a filename dialog before downloading, including recovered
attachments. The image picker identifies the loaded file or a clipboard paste.

**Post to Facebook** prepares the encoded photo and a message with the PixelStow
link and save/paste instructions. Choose Facebook in the native share sheet when
available, or download the photo and attach it in Facebook with the copied
message. Finish posting in Facebook. PixelStow needs no upload/hosting service.

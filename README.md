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

PixelStow's browser utility is `pixelstow.html`. It encodes optional text, file
attachments and short voice recordings locally into a new image. See
[payload format and rollout](docs/PixelStowPayloads.md). Run
`node tests/pixelstow-checks.mjs` for codec checks, then serve this directory on
localhost and open `tests/pixelstow-browser.html` for the browser and real
MediaRecorder checks; those use a synthetic tone and never access the microphone.
The browser checks also cover separate encoding/unlocking passwords, the visible
contents summary, relocking, and context-menu suppression during image panning.

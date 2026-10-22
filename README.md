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

PixelStow is available at `pixelstow.html`; its MarkerTracker lab is at `markertracker/`.

These files are generated production assets. Editable PixelStow sources, tests,
research and release tooling are maintained in the private PixelStow repository.
Do not edit the generated files here. Publish a checked release from PixelStow
using its `scripts/publish.mjs` workflow. All image processing stays on-device.

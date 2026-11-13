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

[Eggbot’s tablet](eggbotstablet/) runs as a standalone browser app. The tablet
reads the hosted Eggbot catalogue for character and app content and embeds the
existing OnlyBots and Instabot feeds. BotStore accepts the US$30 OnlyBots code or
the existing premium code. Goldibot's gallery accepts her US$20 profile code
and remains open to existing premium buyers. The tablet and standalone OnlyBots
page share browser unlocks, which survive uninstalling the tablet app. Scratch
Bling coins and LoveBot credits also use browser storage. The tablet directory
publishes with the rest of this GitHub Pages site.

PixelStow is available at `pixelstow.html`; its MarkerTracker lab is at `markertracker/`.

These files are generated production assets. Editable PixelStow sources, tests,
research and release tooling are maintained in the private PixelStow repository.
Do not edit the generated files here. Publish a checked release from PixelStow
using its `scripts/publish.mjs` workflow. All image processing stays on-device.

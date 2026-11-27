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
page share browser unlocks, which survive uninstalling the tablet app. To share
new Buy Me a Coffee purchases with Unity, choose **Help → Link Web Tablet** in
the game and use the browser where you play. Scratch
Bling coins and LoveBot credits also use browser storage. The tablet directory
publishes with the rest of this GitHub Pages site.

Electric Ambulance opens from the third home page or BotStore. The browser game
uses the original city's meshes, textures and audio and saves the best score in
browser storage. The JavaScript and 3D assets load when the app opens. Returning
Home ends the run and releases the graphics and audio resources.

The initial browser release reads its media from `eggbotstablet/electric-ambulance/media`.
Regenerate those files with `Tools/Prepare-ElectricAmbulanceWeb.py` in the Unity
checkout. The exporter reads the existing WebGL AssetBundle for authored models
and tuning, and copies or encodes art and audio from the imported source files.
It needs UnityPy 1.25.4, FFmpeg and the matching Unity Editor's
`Editor/Data/Resources/unity default resources` file for built-in meshes.

Turtle Time is a free BotStore install. Its rules and portrait playfield follow
the Unity tablet version. The browser remembers the installation and high
score locally and fetches the game's atlases and sounds from the Eggbot
Cloudflare Worker when the app opens. The web tablet uses a PCM WAV copy of
the original crunch sound for Safari compatibility, with the hosted MP3 as
a fallback. The game uses WebGL. Browsers that block autoplay start the surf
loop after the first interaction with the game.

When Unity's Turtle Time artwork changes, update `eggbotstablet/turtle-time-media.json`
with the `media` entries from Unity's `TurtleTime/Media.json` and the `letters`
from `TurtleTime/TitleLetters.json`. Publish the indexed media to Cloudflare
using the Unity project's `Tools/Publish-EggbotContent.mjs --turtle-time-only`
before updating the web tablet.

PixelStow is available at `pixelstow.html`; its MarkerTracker lab is at `markertracker/`.

These files are generated production assets. Editable PixelStow sources, tests,
research and release tooling are maintained in the private PixelStow repository.
Do not edit the generated files here. Publish a checked release from PixelStow
using its `scripts/publish.mjs` workflow. All image processing stays on-device.

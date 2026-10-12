# Three.js

Vendored from the official npm `three` package, version **0.186.1**.
Source: https://github.com/mrdoob/three.js
License: MIT, included in `LICENSE`.

Only the WebGL build and GLTFLoader's dependencies are included. Files are
unchanged from the npm package. The page's import map resolves `three` and
`three/addons/` locally, without a CDN or runtime package installation.

For an update, replace both build files and all three addon files together
from the same version, preserve the license, and run the Eggbot checks and
browser verification described in `docs/EggbotPlayground.md`.

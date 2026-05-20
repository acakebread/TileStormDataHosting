# TileStorm Evolution Data Hosting Technical Notes

These notes are for maintainers and tooling work. They are intentionally separate from the public-facing authoring guide.

## Repository Layout

- `index.html`: public map portal and browser.
- `content-authoring-guide.html`: player/creator-facing authoring workflow.
- `manifest.json`: catalogue consumed by the game and portal.
- `maps/`: published map packages.
- `thumbs/`: preview thumbnails.

## Naming

Published map packages use the map hash as the file name, for example `84RUrE.json` or `34v5Ak.zip`.

Thumbnail images use the same hash, for example `thumbs/84RUrE.png`.

The shared map manifest stores the human-readable map name separately from the filename so renaming a map updates the same shared entry instead of creating a duplicate.

## Publishing Notes

The Unity app publishes maps through the GitHub Contents API when a suitable token is configured. GitHub Pages then serves the static files publicly. Public Pages updates can take a short time to appear after a commit.

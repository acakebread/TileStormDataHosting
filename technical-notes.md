# TileStorm Evolution Data Hosting Technical Notes

These notes are for maintainers and tooling work. They are intentionally separate from the public-facing authoring guide.

## Repository Layout

- `index.html`: public map portal and browser.
- `content-authoring-guide.html`: player/creator-facing authoring workflow.
- `manifest.json`: catalogue consumed by the game and portal.
- `maps/`: published map packages.
- `thumbs/`: preview thumbnails.
- `shares/<unique-id>/social.png`: original encoded social images.
- `shares/<unique-id>/index.html`: static Open Graph share pages that launch the app with an image URL payload.

## Naming

Published map packages use the map hash as the file name, for example `84RUrE.json` or `34v5Ak.zip`.

Thumbnail images use the same hash, for example `thumbs/84RUrE.png`.

The shared map manifest stores the human-readable map name separately from the filename so renaming a map updates the same shared entry instead of creating a duplicate.

## Publishing Notes

The Unity app publishes maps through the GitHub Contents API when a suitable token is configured. GitHub Pages then serves the static files publicly. Public Pages updates can take a short time to appear after a commit.

The portal also cross-checks its deployed `manifest.json` against the canonical raw repository copy and warns if the Pages site falls behind the repo state.

## Facebook Social Images

The Unity **Share to Facebook** command creates an immutable image and page under a fresh `shares/` ID using the existing publisher. It waits for the public page and original image bytes before opening Facebook's composer. These uploads do not change the shared map manifest.

The page exposes the hosted image through static Open Graph metadata. Human browsers follow its JavaScript redirect to the configured stable app entry point with `?image=<encoded-image-url>`; a Play link provides a fallback. Retain the original PNG and page for as long as their posts should work. The game downloads that original PNG, rather than Facebook's resized preview, to decode the embedded map.

Implementation and live test instructions are in the Unity project's `Docs/FacebookSocialSharing.md`. No manual changes to the portal are needed for each new share.

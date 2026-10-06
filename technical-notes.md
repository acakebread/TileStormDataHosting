# TileStorm Evolution Data Hosting Technical Notes

These notes are for maintainers and tooling work. They are intentionally separate from the public-facing authoring guide.

## Repository Layout

- `index.html`: public map portal and browser.
- `content-authoring-guide.html`: player/creator-facing authoring workflow.
- `manifest.json`: catalogue consumed by the game and portal.
- `maps/`: published map packages.
- `thumbs/`: preview thumbnails.
- `shares/<unique-id>/preview.jpg`: compact display preview for new link posts.
- `shares/<unique-id>/map.json` or `map.zip`: direct social map backup, separate from the community catalogue.
- `shares/<unique-id>/index.html`: static Open Graph share page that launches the current app.
- Older shares retain their original `social.png` and image launch URL.

## Naming

Published map packages use the map hash as the file name, for example `84RUrE.json` or `34v5Ak.zip`.

Thumbnail images use the same hash, for example `thumbs/84RUrE.png`.

The shared map manifest stores the human-readable map name separately from the filename so renaming a map updates the same shared entry instead of creating a duplicate.

## Publishing Notes

The Unity app publishes maps through the GitHub Contents API when a suitable token is configured. GitHub Pages then serves the static files publicly. Public Pages updates can take a short time to appear after a commit.

The portal also cross-checks its deployed `manifest.json` against the canonical raw repository copy and warns if the Pages site falls behind the repo state.

## Facebook Social Images

The Unity app's main Facebook option now prepares an ordinary photo and a
caption with a versioned invisible map payload, without publishing files here.
Public Facebook post launches use `?facebook=<encoded-post-permalink>` and
import caption data rather than image pixels. The Editor/native app retrieves
post text directly; public WebGL requires a stateless relay or explicit caption
paste because Facebook's iframe HTML lacks CORS permission. No relay is deployed.

The previous hosted-card publisher remains a clearly labelled **Hosted link
fallback**, which creates an unencoded preview and JSON/ZIP here. The details
below describe that fallback and existing shares. Implementation and the
verified versioned photo-post result are in `Docs/FacebookSocialSharing.md`
in the Unity repository.

The Unity **Share to Facebook** command creates a JPEG preview, a raw JSON/ZIP map backup and a page under a fresh `shares/` ID using the existing publisher. It verifies the public page and both files before opening Facebook's composer. These uploads do not change the shared map manifest or create catalogue entries.

The page exposes the JPEG through static Open Graph metadata for display. Ordinary link posts launch with `?backup=<encoded-map-url>` and import the data directly. Supplying `?image=<encoded-Facebook-photo-url>` to the share page adds the primary image to its app launch URL while retaining the backup. The app always tries a supplied image first and downloads the backup only after image failure. A visible Play link provides the default launch when JavaScript is disabled.

The game's **Tools > Admin Log** records the actual source as `EMBEDDED IMAGE`, `HOSTED JSON BACKUP`, `HOSTED ZIP BACKUP`, `COMMUNITY MAP` or `DEFAULT`. Image-only links remain supported and require no backup file. Automatic Facebook photo submission/retrieval is a separate integration from the current link composer.

Implementation and live test instructions are in the Unity project's `Docs/FacebookSocialSharing.md`. No manual changes to the portal are needed for each new share.

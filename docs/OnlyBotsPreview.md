<!-- Copyright 2026 massivehadron.com ltd. -->

# Standalone OnlyBots preview

The temporary page is `onlybots-preview-8c7e4f2a/index.html`. Its link appears
under the portal's **Admin tools** after a non-empty admin token is entered or
restored in that browser. Clearing the token hides the link. The token is never
passed to the preview, included in its URL or needed by its JavaScript.

The unlisted page has its own password. After accepting it, the preview stores
it in the browser's local storage for that site and checks it again on future
visits. Clearing the site's data prompts for the password again. The browser
loads the feed only after accepting the entered or saved password. The password
is checked in the page source. The source, JSON and images remain readable from
the public repository.

The preview contains six creators and 19 photographs. Five creators use copies
of the tablet app's OnlyBots profiles. Kelly Bot has a web-only profile that
uses her existing Instabot photos and captions. The snapshot copier preserves
her profile and keeps it in the catalogue.

The feed mixes creators, keeps all initial posts and the latest 24 timed updates,
starts updates after 20 seconds, then waits 35–65 seconds between arrivals.
Creator filters, visit-local likes, reading-position preservation, the full photo
viewer and the original subscription placeholder are reproduced. Share opens
the browser's file sharing support when available, otherwise downloads the
displayed crop and mirror as a JPEG. It never shares the unlisted preview URL
or connects to the game's Facebook/sharing, premium or installation systems.

Photos are resized in the browser, preserving their aspect ratio and never
upscaling. The default maximum dimension is 512. The copied OnlyBots profiles
explicitly set `maxImageDimension` to 2048; this can be edited per profile or
overridden on an individual photo. Larger originals are downloaded and decoded
before resizing. The icon and layout are static page assets.

`catalogue.json` lists relative profile JSON paths. Each photo's `url` is relative
to its profile JSON; `resource` retains the original Unity authoring reference.
Edit the copies directly, or refresh the snapshot with:

```powershell
node tools/export-onlybots.mjs C:\GIT\MassiveHadron\TileStormEvolution
```

The copier reads the Unity checkout and writes only this preview directory. It
does not run Unity, compile, test, preview, commit or publish. Refreshing replaces
the copied JSON, so retain any website-only edits before doing that. Publish the
page with the data-hosting repository's existing GitHub Pages workflow.

No tests, builds, compilation checks or browser previews were run. Andrew owns
validation: check that entering/clearing the portal token shows/hides the link.
Open the preview directly and through Admin tools. Confirm that an incorrect
password leaves the feed hidden and the correct password opens it. Reload in
the same browser to check that the saved password opens the feed. Then review
creator filters, image framing and mirrors, opening/closing photos,
likes, sharing/download, the subscription notice and timed arrivals while
scrolled down. Review the layout on narrow screens as well.

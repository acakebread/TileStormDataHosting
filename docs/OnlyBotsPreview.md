<!-- Copyright 2026 massivehadron.com ltd. -->

# Standalone OnlyBots preview

The temporary page is `onlybots-preview-8c7e4f2a/index.html`. Its link appears
under the portal's **Admin tools** after a non-empty admin token is entered or
restored in that browser. Clearing the token hides the link. The token is never
passed to the preview, included in its URL or needed by its JavaScript.

The standalone page and BotStore accept the same Buy Me a Coffee codes as Unity.
The US$30 OnlyBots code opens the feed and its preview posts. **View profile** on
Goldibot's posts accepts her US$20 code and opens the photo and video gallery.
Existing premium codes and saved web premium unlocks open both. The standalone
page uses purchase codes in place of its old preview password.

Both pages save and read unlocks on the same site and browser. The tablet saves
installation separately, shows the home icon after installation, and keeps unlocks
when the app is uninstalled. The browser checks shared codes locally. The public
catalogue and media URLs remain directly accessible. If a code changes, update
its SHA-256 digest in `eggbotstablet/premium.js` using the code with punctuation
removed and letters uppercased.

The preview contains six creators, 19 photographs and Goldibot's videos. Five creators use copies
of the tablet app's OnlyBots profiles. Kelly Bot has a web-only profile that
uses her existing photos with captions written for OnlyBots. The snapshot
copier preserves her profile and keeps it in the catalogue.

The feed mixes creators, keeps all initial posts and the latest 24 timed updates,
starts updates after 20 seconds, then waits 35–65 seconds between arrivals.
The preview includes creator filters, visit-local likes, reading-position preservation
and the full photo viewer. Posts from creators with a video offer **View profile**, with
Photos and Videos tabs. Playing a video continues through the gallery in order and wraps
to the first clip. **Stop** returns to the current video's poster. Switching media manually
or closing the gallery ends playback. Creators without video keep the subscription
preview message. Share opens
the browser's file sharing support when available, otherwise downloads the
displayed crop and mirror as a JPEG. It shares the media file without attaching
the unlisted preview URL.

Photos are resized in the browser, preserving their aspect ratio and never
upscaling. The default maximum dimension is 512. The copied OnlyBots profiles
explicitly set `maxImageDimension` to 2048; this can be edited per profile or
overridden on an individual photo. Larger originals are downloaded and decoded
before resizing. The icon and layout are static page assets.

`catalogue.json` lists relative profile JSON paths. Each photo and video `url`, and each
optional `posterUrl`, is relative to its profile JSON. `resource` retains the Unity authoring
reference. The exporter copies video files from Unity's `Assets/StreamingAssets/Eggbots`
folder and dedicated PNG posters from the profile's Resources folder. Both URLs include a
version so browsers can pick up replacements.
Edit the copies directly, or refresh the snapshot with:

```powershell
node tools/export-onlybots.mjs C:\GIT\MassiveHadron\TileStormEvolution
```

The copier reads the Unity checkout and writes only this preview directory. It
does not run Unity, compile, test, preview, commit or publish. Refreshing replaces
the copied JSON, so retain any website-only edits before doing that. Publish the
page with the data-hosting repository's existing GitHub Pages workflow.

For browser validation, use a fresh browser profile and enter the app code in
BotStore. Check that the page-two icon appears after installation. Open Goldibot's
profile, check that the app code is rejected there, then enter her profile code.
Open the standalone page on the same origin and check that both unlocks carry
over. With a separate browser profile, check the existing premium code opens
both the feed and gallery. After uninstalling, check that the icon disappears
and reinstalling from BotStore uses the saved app unlock.

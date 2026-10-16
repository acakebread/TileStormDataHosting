# Browser camera acquisition

The image toolbar has **Browse**, **Paste**, **Decode** for reading encoded
images, **Create** for taking a new source image, and a **Full screen** icon last
in that same row. This document calls the two camera purposes Capture and Photo.
Only the explicit Browse/Paste controls open their respective pickers; the Image heading
and spaces between buttons are inert. Keyboard image paste remains available.

**Photo** opens the same camera preview for taking a new source
image on phones or desktops with a camera. **Take source photo** imports the
complete video raster into the message/file composer; no marker worker or
photographic recovery search runs in this mode. Only the inexpensive native
fingerprint check runs on import, so existing native locked/encoded images are
still rejected for re-encoding. The normal writer also retains its fingerprint
guard. Switching cameras or rotating the view preserves source mode.

The source preview has one **Take source photo** shutter; tapping the live preview
does the same thing. Drags and multi-touch gestures do not trigger capture. It
captures the live frame and opens PixelStow's preview/composer directly, without the iPhone's
native camera and Use Photo confirmation step. The separate native still-camera
shortcut is hidden in source mode. On browsers without live camera access,
Photo uses the native picker directly on phones/tablets. Capture starts scanning
and provides **Capture and read**, also available by tapping the preview, for an
immediate manual read. The native still-camera shortcut remains inside Capture
on phones and is hidden on desktop. Without live camera access, desktop users
are directed to Browse for saved photos. The picker purpose is cleared after
selection or cancellation. Captured image pixels are preserved.

**Capture** requests video only, preferring the rear camera and a 1920 × 2560
portrait or 2560 × 1920 landscape feed, according to the device's orientation.
Constraints are ideals: actual resolution depends on the browser/device.
If camera startup reports a format/read error, acquisition retries the same
selected device with no resolution/aspect-ratio preferences, then a 640 × 480,
15 fps preference. Exact device selection and video-only access remain in place.
An unavailable device or denied permission is not retried as a format failure.
Successful fallback shows the actual pixel dimensions and retains the compatible
profile during orientation adjustment. A final failure includes the browser's
error name/message and any unsatisfied constraint, rather than assuming another
app holds the camera. Other preview tabs and the Windows Settings camera preview
may need to release the device before retrying. These retries do not guarantee
that an incompatible driver can be opened by the browser.
The preview uses `muted`, `autoplay` and `playsinline` for Safari, displays the
whole video frame without cropping, and stays live while a captured raster is
read. In portrait the frame uses the full width of the camera column; the scan
notes take the height that remains. Captures use the video's actual pixel dimensions, without resizing or JPEG
conversion. The browser may already scale/process the sensor feed; video detail
can therefore be worse than a full-resolution still photograph.

During scanning, combined-lens camera names (Dual, Dual Wide or Triple) and
Ultra Wide names receive a caution beside the selected camera. These modes may
produce distorted or unreliable scan frames; the user can try a standard rear
camera instead. The name is only a heuristic: capture remains available, ordinary
Back Wide cameras are not flagged, and source-photo mode does not show a scan warning.

The live view opens in a full-viewport modal dialog, above the page's normal
layout, with safe-area padding for phone notches and controls beside the preview
on short landscape screens. The frame border follows the fitted video's actual
dimensions; inset corner guides suggest leaving room around all four corners of
the encoded picture. While scanning, that border and the corner guides use the
same red-to-orange recovery-stage colour as the status line. A found calibration
replaces it with green. Guides and controls are never included in captured pixels.
Status text and retained near misses occupy a fixed-height, scrollable area below
the controls. Updates do not move the preview or buttons; on short landscape
screens, feedback scrolls within the existing controls column. Viewport changes
refit the feed without stretching or cropping it.

Device rotation updates the preferred camera dimensions on the current video
track and cancels the old frame's search. If the browser cannot change the feed,
the existing camera remains available. **Rotate view** applies a manual 90-degree
rotation to both the displayed video and captured pixel raster; it does not
merely turn the CSS preview while leaving captures sideways. Scanning resumes
with a fresh frame after the adjustment. These controls do not modify the native
**Take photo** path.

On HTTP/HTTPS, a disposable marker worker checks frequency evidence and locates
the selected format's patches, retaining translation/affine/perspective fits without reading any
payload. Large frames use the
adaptive scale localization described in
[VisualTransformReader.md](VisualTransformReader.md),
then rectify the full capture onto the encoded dimensions for wavelet reading.
The captured raster and marker guides remain in original-resolution coordinates.
The camera captures a fresh full-resolution raster every 900 ms into one pending
slot. That slot is replaced while a marker worker is busy; there is no growing
queue of stale camera frames. Normal capture checks calibration before dispatching
marker work, with the occasional fallback described below. The tracking
header is confirmed against the new pixels before reuse, and cleared after a
scan without a verified header. Ordinary recovery can use marker spacing to skip
unusably small pyramid levels. Discovery budgets are maximum allowances,
not a promise of video-frame-rate decoding.

After two marker scans, the best eligible capture in recent history is read in
a separate disposable payload worker. History retains at most three marker-bearing
frames and 48 MiB of RGBA, allowing one larger frame alone, and expires captures
after 45 seconds. Fits within a frame and frames within history use the same
marker quality/coverage/error rating described in
[VisualTransformReader.md](VisualTransformReader.md). Frames without a stable fit
never enter automatic payload decoding. Attempted frames do not fill every
history slot and block new captures.
A complete high-confidence marker fit bypasses the two-scan wait and is
read immediately. Its threshold and the measured warmer/colder scale scheduling
are shared with ordinary geometric image recovery; full checksums are still
required. A bad early camera read yields to fresher captures rather than
continuing to exhaust the same frozen image.

One marker worker and one payload worker may run together. Capture and marker
appraisal continue during a payload read. A newly scanned frame with a stronger
rating terminates the older frame's payload worker immediately; the strongest
unattempted retained frame is then read. Payload attempts have a 30-second
limit and failed frames are skipped instead of repeatedly parsed. Ordinary
image imports use the same discovery/ranking stages after their inexpensive
native/full-frame checks, without the camera's frame-history scheduling.
Ordinary fallback retains the weak-signature gate. **Capture and read** opens
a single frame with the ordinary image recovery controls, including the option
to override that gate if required.

On success, camera tracks stop and the existing message/attachment/password UI
opens. The same RGBA object and its verified geometry are reused; discovery is
not repeated. A lossless PNG of this raster supplies the imported file for
exports/sharing. Later decoding/unlocking still verifies the complete frame.
Workers return inspection metadata/geometry only, not decrypted text, attachment
bytes or passwords. Payload formats do not change.

### Subtle V5 edge guide

New V5 encodes include a low-contrast colour guide in perpendicular edge bands.
Normal capture checks it in a separate disposable worker, directly from the
frozen full-resolution frame with one explicit 4x, 8x or 12x box reduction,
selected from capture dimensions. There is no
512px thumbnail followed by another reduction. One active guide check and one
latest pending frame are retained, while marker/payload work continues. The
calibration outline must cover at least 75% of the frame; this is a reasonably
framed scan rather than a search for small distant images.

Normal capture waits for calibration before dispatching that frame's marker
worker. The live-preview indicator reads **Searching** until a frame is checked,
**No signal** when that check finds no guide, and **Calibration found** when it
does. The scan notes still show **Edge guide · ~1.25× scale**. This
indicates measured guide evidence, not a confirmed payload. The two local
frequencies, transverse envelope and spatial phases must agree. Visible padding
can propose a tilted rectangle, but its outline alone is never a detection.

A calibrated frame attempts one guided marker grid with an eight-second budget.
Its payload worker uses only the resulting verified candidates, without
restarting a multi-scale search on the same raster. Failure returns to fresh
captures. Uncalibrated frames get occasional ordinary recovery: after an initial
five-second wait, at most once every eight seconds when marker/payload workers
and the pending slot are idle. This retains a route for missed guides and older
images. Such fallback marker checks have an eight-second budget. **Capture and
read**, file imports and bottom **Decode image** retain ordinary full recovery;
canceling an import and pressing Decode no longer skips geometric discovery.

A guide-positive frame can interrupt older unhinted marker work until a real
marker header is verified. Verified marker work is protected; a payload read is
interrupted only after the newer frame has produced better verified geometry.
Guide appraisal has a one-second budget and a separate 1.2-second hard
cancellation. Errors and missed guides remain eligible for occasional fallback.
Payload reads retain their 30-second budget and checksum requirements. The light
clears on a subsequent miss, pause, reframe or close, and source-photo mode does
not appraise guides. Calibration coordinates and detection/use provenance follow
the successful image into its Analysis display.

`tests/pixelstow-edge-guide-checks.mjs` covers bounded faint encoding and modeled
resized/rotated captures. `tests/pixelstow-edge-codec-checks.mjs` covers actual
V5 flags, payloads, source removal and older images. The real browser guide,
marker, payload and extraction workers are exercised by
`tests/pixelstow-edge-worker-checks.mjs`; queue/preemption behavior is covered by
`tests/pixelstow-camera-scheduling-checks.mjs`. Calibration provenance and the
single-grid restriction are checked by `tests/pixelstow-calibration-data-checks.mjs`.
Supplied photographed screens now detect existing guides at both 0.82x and
3.18x magnification, including a 4K capture, and recover through a single guided
grid. Padding proposals use the RGB means from the same coarse raster so that
a full-resolution outline pass cannot consume the calibration budget. Further optical captures must
establish how often the faint guide survives phone cameras and screens.

### Abandoned full-image Fourier guide

The following describes the retained research-only opt-in (`scaleGuideEnabled =
true` on the camera instance), not normal application behaviour. The old fixed-pitch scale pilot is described in
[CarrierV5.md](CarrierV5.md#historical-full-image-pilot). Each sampled capture has
a separate guide copy with maximum edge 512, taken from the same frozen raster,
including its rotation. A disposable worker runs the bounded low-frequency FFT
while marker or payload work continues. Only one guide worker and one latest
pending guide frame are retained. It does not queue behind a long marker read.

A detected pilot promotes that frame ahead of frames without it. If marker
discovery on an older unhinted frame has not verified a header, it is cancelled
and the pilot-bearing frame goes next. A search with an already verified header
keeps its allowance. Only after the new frame produces stable marker geometry
can it preempt a payload read; pilot-bearing fits outrank unhinted fits, then
the existing geometry score breaks ties. Equal-rated pilot fits do not repeatedly
interrupt one another. A stable pilot-bearing fit also bypasses the two-appraisal
wait. A pilot without verified markers never starts a payload read.

The measured wavelength supplies an initial marker search scale, not acceptance
of an image. Absent/unclear pilots and guide errors use ordinary discovery; older
V5 images do not need the signal. The guide's 1.2-second hard cancellation is
separate from the existing 24/12-second marker and 30-second payload allowances.
All ranked marker fits and remaining-scale fallback are preserved. Pause,
reframing, switching and closing abort guide work and invalidate late results.
Source-photo mode performs no guide appraisal.

`node tests/pixelstow-camera-scheduling-checks.mjs` checks independent lookahead,
pilot priority, protection of verified work, complete candidate/fallback retention,
and pause/error handling with controlled worker results. The real browser guide,
marker and payload workers are checked by `tests/pixelstow-pilot-worker-checks.mjs`
using a resized public synthetic image. Fresh optical captures must establish
whether this improves real phone scanning.

The best retained marker-bearing capture is shown with its guides and appraisal/
read status. That frozen frame is separate from the live preview: coordinates from
an old frame must not be painted over a moving camera view. **Inspect this
capture** reads its ranked fits in the ordinary recovery UI without repeating
marker discovery. It still requires the full payload checksum before displaying
contents. Equal-rated captures prefer the newer frame.

**Pause scanning** cancels both workers and clears the pending slot, leaving the preview running for
reframing. Resume then drops the retained capture queue, tracking seed and guide timing, and the next
scan starts from a new frame. After camera permission, **Switch camera** enumerates video inputs and
cycles through their exact device IDs, stopping the previous stream/search first.
This selects distinct desktop webcams even when they ignore front/rear preferences.
The current camera name is shown in the preview help; the selected device is
retained for subsequent opens in the same page once its preview plays successfully.
Source/manual/paused mode is preserved when switching. Failed devices, including
inactive virtual cameras, are skipped automatically while cycling around the
list; the preview identifies any skipped cameras. Subsequent switches in the
same capture session omit these failures. If all alternatives fail, the previous
working camera is reopened once; exhausting the list reports the browser error.
Closing during a switch cancels the remaining attempts and stops late streams.
Opening a new capture session or a device-change event makes previously failed
devices eligible again, allowing a newly started virtual camera to work.
A disconnected remembered device permits a default camera on a new open.
A single working desktop camera disables
Switch camera; device-change events refresh availability. Phones can fall back
to front/rear preference when device enumeration is unavailable.
**Close camera**, dismissing the dialog, leaving the page, or hiding the tab
stops tracks, clears retained frames and terminates both in-progress workers.
Session identity and abort checks discard late permission and worker results.
The user must reopen the camera after returning to the page.

On phones/tablets, **Take photo** uses a separate `image/*` file input with
`capture="environment"`. It stops the live stream before opening the native capture/picker. On phones
this requests the still camera; browsers may instead offer a file picker. The
result uses the existing image import/reader. This path can preserve detail that
is absent from the live feed and remains available when live access fails. It
also has a shortcut inside the live-camera dialog, using the same input and import
flow as the page's **Take photo** button. On desktop it uses manual live capture
and never substitutes a file picker for the camera. Scan camera retains continuous
scanning with the two-second framing delay.

A high-confidence marker fit can start a read before every image scale was
visited. For ordinary uncalibrated fallback, a failed payload resumes the unvisited marker
scales on that same retained raster, then ranks and reads the resulting fits.
This matches the fallback used by ordinary file recovery. The discovery retry
and payload work share the existing 30-second live-read limit; a stronger new
capture or cancellation still terminates that worker. Inspect this capture also
uses the fallback. Saving to Photos is not required by the decoder, and this
change does not make the video feed equivalent to a native still photograph.
Calibrated continuous frames instead retain the single guided grid described above.

The experimental short-turn scheduling was rolled back after live scanning
regressed. Continuous capture again uses 24-second initial / 12-second tracked
marker allowances, the full ranked candidate list, remaining-scale fallback and
the 30-second payload allowance. The two-candidate shortcut can discard the
correct transform: `node tests/pixelstow-camera-scheduling-checks.mjs` includes a
real V5 image whose first two inaccurate fits fail and whose third fit decodes
the exact public payload through the camera's read path. Separate fake-clock
checks guard longer acquisition/reads, stronger-frame replacement, latest-slot
capture and cancellation; those scheduling checks alone are not optical evidence.

Live access requires browser camera permission and a secure context. HTTPS and
localhost are the supported live-scanning routes; plain HTTP to a machine's LAN
address will not grant camera access. Direct `file://` opening cannot use this
worker and offers manual frame capture only where the browser permits camera
access. No upload, backend, service or third-party dependency is introduced.

References: [getUserMedia and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[iOS inline/muted video policy](https://webkit.org/blog/6784/new-video-policies-for-ios/),
[native file capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture),
[preferred camera aspect ratio](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/aspectRatio),
[updating video constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints),
[modal top-layer dialogs](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal).

Implementation is for local user evaluation. Focused checks verified marker-only
discovery, ranked payload recovery on the supplied full-resolution `IMG_2353.png`,
and scheduler appraisal/preemption/pause behavior with controlled worker results.
`node tests/pixelstow-camera-checks.mjs` uses Playwright/Chrome with three synthetic
camera devices to check exact switching, stream cleanup, remembering devices,
unavailable-device skipping, restoring the previous working camera, cancellation,
manual/source capture, the phone picker route and prognosis touch gestures. It
never accesses hardware.
Set `PIXELSTOW_PLAYWRIGHT` to a Playwright module file and `PIXELSTOW_CHROME` to a
Chrome executable to use an existing runtime instead of the package defaults.
Actual decoding
speed and printed-image recovery remain dependent on device and input quality.

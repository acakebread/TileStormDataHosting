# Browser camera acquisition

**Open camera** requests video only, preferring the rear camera and a 1920 × 2560
portrait or 2560 × 1920 landscape feed, according to the device's orientation.
Constraints are ideals: actual resolution depends on the browser/device.
The preview uses `muted`, `autoplay` and `playsinline` for Safari, displays the
whole video frame without cropping, and stays live while a captured raster is
read. Captures use the video's actual pixel dimensions, without resizing or JPEG
conversion. The browser may already scale/process the sensor feed; video detail
can therefore be worse than a full-resolution still photograph.

The live view opens in a full-viewport modal dialog, above the page's normal
layout, with safe-area padding for phone notches and controls beside the preview
on short landscape screens. The frame border follows the fitted video's actual
dimensions; inset corner guides suggest leaving room around all four corners of
the encoded picture. Guides and controls are never included in captured pixels.
Preview layout follows changes in available space, including status text and
retained near misses, without stretching or cropping the feed.

Device rotation updates the preferred camera dimensions on the current video
track and cancels the old frame's search. If the browser cannot change the feed,
the existing camera remains available. **Rotate view** applies a manual 90-degree
rotation to both the displayed video and captured pixel raster; it does not
merely turn the CSS preview while leaving captures sideways. Scanning resumes
with a fresh frame after the adjustment. These controls do not modify the native
**Take photo** path.

On HTTP/HTTPS, a disposable marker worker checks the FFT gate and locates the
eight patches, retaining translation/affine/perspective fits without reading any
payload. Large frames use the
adaptive scale localization described in
[VisualTransformReader.md](VisualTransformReader.md),
then rectify the full capture onto the encoded dimensions for wavelet reading.
The captured raster and marker guides remain in original-resolution coordinates.
The camera captures a fresh full-resolution raster every 900 ms into one pending
slot. That slot is replaced while a marker worker is busy; there is no growing
queue of stale camera frames. Initial marker acquisition has a 24-second budget;
subsequent scans with a verified tracking header have 12 seconds. The tracking
header is confirmed against the new pixels before reuse, and cleared after a
scan without a verified header. Known patches below the detector's basis range
skip unusably small pyramid levels. These are maximum discovery allowances,
not a promise of video-frame-rate decoding.

After two marker scans, the best eligible capture in recent history is read in
a separate disposable payload worker. History retains at most three marker-bearing
frames and 48 MiB of RGBA, allowing one larger frame alone, and expires captures
after 45 seconds. Fits within a frame and frames within history use the same
marker quality/coverage/error rating described in
[VisualTransformReader.md](VisualTransformReader.md). Frames without a stable fit
never enter automatic payload decoding. Attempted frames do not fill every
history slot and block new captures.
A complete high-confidence eight-marker fit bypasses the two-scan wait and is
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
The camera UI does not bypass the weak-signature gate. **Capture and read** opens
a single frame with the ordinary image recovery controls, including the option
to override that gate if required.

On success, camera tracks stop and the existing message/attachment/password UI
opens. The same RGBA object and its verified geometry are reused; discovery is
not repeated. A lossless PNG of this raster supplies the imported file for
exports/sharing. Later decoding/unlocking still verifies the complete frame.
Workers return inspection metadata/geometry only, not decrypted text, attachment
bytes or passwords. Original carrier and payload formats do not change.

The best retained marker-bearing capture is shown with its guides and appraisal/
read status. That frozen frame is separate from the live preview: coordinates from
an old frame must not be painted over a moving camera view. **Inspect this
capture** reads its ranked fits in the ordinary recovery UI without repeating
marker discovery. It still requires the full payload checksum before displaying
contents. Equal-rated captures prefer the newer frame.

**Pause scanning** cancels both workers and clears the pending slot, leaving the preview running for
reframing. **Switch camera** stops the current stream/search before requesting
the other facing mode. **Close camera**, dismissing the dialog, leaving the page, or hiding the tab
stops tracks, clears retained frames and terminates both in-progress workers.
Session identity and abort checks discard late permission and worker results.
The user must reopen the camera after returning to the page.

**Take photo** is a separate `image/*` file input with `capture="environment"`.
It stops the live stream before opening the native capture/picker. On phones
this requests the still camera; browsers may instead offer a file picker. The
result uses the existing image import/reader. This path can preserve detail that
is absent from the live feed and remains available when live access fails. It
also has a shortcut inside the live-camera dialog, using the same input and import
flow as the page's **Take photo** button.

A high-confidence marker fit can start a read before every image scale was
visited. If its payload fails, live reading now resumes the unvisited marker
scales on that same retained raster, then ranks and reads the resulting fits.
This matches the fallback used by ordinary file recovery. The discovery retry
and payload work share the existing 30-second live-read limit; a stronger new
capture or cancellation still terminates that worker. Inspect this capture also
uses the fallback. Saving to Photos is not required by the decoder, and this
change does not make the video feed equivalent to a native still photograph.

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
No camera/device tests, commit or deployment were performed for this change. Actual decoding
speed and printed-image recovery remain dependent on device and input quality.

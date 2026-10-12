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

On HTTP/HTTPS, one disposable worker runs the entire automatic inspection:
native reading, common resize checks, FFT gate, shared translation/affine/
perspective localization, and final payload validation. Large frames also use the
coarse-to-fine 1/16, 1/8, 1/4, 1/2 and full-size localization described in
[VisualTransformReader.md](VisualTransformReader.md),
then rectify the full capture onto the encoded dimensions for wavelet reading.
The captured raster and marker guides remain in original-resolution coordinates.
There is no frame queue or overlapping search. After a failed read, the next fresh
frame is captured after a short delay. Geometric discovery retains its existing 60-second budget
per attempt; this is continuous capture, rather than decoding at video frame rate.
The camera UI does not bypass the weak-signature gate. **Capture and read** opens
a single frame with the ordinary image recovery controls, including the option
to override that gate if required.

On success, camera tracks stop and the existing message/attachment/password UI
opens. The same RGBA object and its verified geometry are reused; discovery is
not repeated. A lossless PNG of this raster supplies the imported file for
exports/sharing. Later decoding/unlocking still verifies the complete frame.
Workers return inspection metadata/geometry only, not decrypted text, attachment
bytes or passwords. Original carrier and payload formats do not change.

Near misses retain one captured frame with confirmed markers and its guides.
That frozen frame is shown separately from the live preview: coordinates from
an old frame must not be painted over a moving camera view. **Inspect this
capture** opens it in the ordinary recovery UI. A frame with more confirmed
markers replaces the previous retained miss; ties prefer the latest capture.
Other failed frames are discarded rather than collected into a history.

**Pause scanning** cancels the current worker but leaves the preview running for
reframing. **Switch camera** stops the current stream/search before requesting
the other facing mode. **Close camera**, dismissing the dialog, leaving the page, or hiding the tab
stops tracks, clears retained frames and terminates in-progress inspection.
Session identity and abort checks discard late permission and worker results.
The user must reopen the camera after returning to the page.

**Take photo** is a separate `image/*` file input with `capture="environment"`.
It stops the live stream before opening the native capture/picker. On phones
this requests the still camera; browsers may instead offer a file picker. The
result uses the existing image import/reader. This path can preserve detail that
is absent from the live feed and remains available when live access fails. It
also has a shortcut inside the live-camera dialog, using the same input and import
flow as the page's **Take photo** button.

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

Implementation is for local user evaluation. No camera/device tests, generated
fixtures, commit or deployment were performed for this change. Actual decoding
speed and printed-image recovery remain dependent on device and input quality.

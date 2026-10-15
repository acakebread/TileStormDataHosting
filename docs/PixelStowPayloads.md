# PixelStow browser payloads

The browser milestone adds arbitrary file attachments and short microphone
recordings. Encoding, password handling, audio playback and file recovery happen
locally in the browser; there is no upload or service dependency.

Text without attachments still writes public PCF1 envelope v1 / kind 1 or
password-protected v2 / kind 2, unchanged. Writing carrier 1 preserves existing
PixelStow and TileStorm Evolution text-level interchange; the default carrier
5 currently needs the browser reader. Carriers 1, 3 and 4 remain selectable for
writing and require explicit older-format recovery for normal browser reads.
Readers in the desktop and game need
the v3 upgrade before importing an image with attachments. A game should use the
bundle's optional text for level JSON and leave unrelated attachments opaque.

## Attachment envelope v3

The PCF1 frame shuffle, whitening, 20-byte header, strength, repetition and
parity are unchanged. The browser now defaults to a separate versioned image
carrier 5 with adaptive contrast and smaller corner markers. Normal file and
camera recovery searches only V5. Image recovery options contains an unchecked
older-format recovery switch for carriers 1, 3 and 4; it resets on page load.
Generated-image verification reads the selected writer's exact format.
See [carrier 4](CarrierV4.md), [carrier 5](CarrierV5.md) and [carrier 3 resize recovery](ResizeRecovery.md)
for their layouts and limits.
The quality/durability slider defaults to 0.8, preserving the current signal
curve; moving left increases payload and marker contrast within bounded limits.
New V5 encoding also uses a recorded linear RGB range compression, reversed
after wavelet removal in the recovered source preview/export.
Header byte 4 is 3; byte 5 is 3 for a public bundle or 4 for a protected bundle. Public bundles may use raw
DEFLATE when smaller. Protected outer frames are never compressed. Frame CRC32
covers header bytes 0–15 followed by the uncompressed body, as before.

The uncompressed bundle is at most 1,048,576 bytes. The stored frame limit is
1,048,656 bytes (bundle + 60-byte protection header + 20-byte frame header).
Actual photo capacity is much smaller: one payload byte needs at least nine
complete 4×4 pixel blocks, after the 504 preamble blocks. Compression may help
text; already compressed audio usually saves little. Source sizing is optional,
and every export is checked before it is offered for download.

The bundle uses this layout, with unsigned little-endian lengths:

| Offset | Size | Value |
| --- | --- | --- |
| 0 | 4 | ASCII `PSB1` |
| 4 | 1 | Bundle version 1 |
| 5 | 1 | Reserved flags, must be 0 |
| 6 | 2 | Attachment count, unsigned 16-bit (1–65,535) |
| 8 | 4 | UTF-8 text byte length, 0–16,384 |
| 12 | variable | Strict UTF-8 text, optional |

Immediately after the text, each attachment stores a two-byte filename length,
two-byte media-type length, four-byte file length, then filename bytes, media-type
bytes and file bytes, in that order. Filenames are 1–255 UTF-8 bytes, with no path
separators, colon, ASCII controls, `.` or `..`. Media types are 1–127 bytes: an
ASCII type/subtype with optional printable parameters, including audio codecs.
Zero-byte files are valid. All file bytes are opaque. Every declared length must
fit, and trailing bytes are rejected. Names are displayed as text and only audio
is played; other files are exposed as downloads.

There is no separate eight-file policy in the writer, reader or attachment UI.
The existing 16-bit count field is unchanged. Filenames, media types, entry headers
and file bytes all consume the 1 MiB bundle allowance and the carrier's actual byte
capacity; the unsigned count field remains the format ceiling. Previously written
bundles stay readable. Older readers enforcing the former eight-file policy must
be updated to read bundles with more files; no V5 carrier or bundle version changes.

Protected v3 uses the existing `PSP1` encryption layout with protection-header
version 2 at offset 4 to distinguish a bundle from text. The plaintext limit is
the bundle limit. PBKDF2-HMAC-SHA256 at 600,000 iterations, random 16-byte salt,
AES-256-GCM, random 12-byte nonce and a 16-byte tag remain unchanged. Associated
data is the first 44 protection-header bytes. Compression happens before
encryption and decompression only after authentication, bounded by the declared
length. Text, filenames, media types and bytes are all encrypted. Inspection can
detect a locked image without decrypting; it cannot be used for re-encoding.

## Browser use and limits

Choose a photo, add optional text and files, or record a voice message. Desktop
recording keeps the original mono, 16 kbit/s WebM/Opus or Ogg/Opus preference.
iPhone/iPad recording uses the pre-compact MP4/AAC (M4A) format. Its microphone
input is mixed to mono at 16 kHz through Web Audio before the 16 kbit/s recorder;
a microphone constraint alone does not ensure the actual input sample rate.

M4A is saved as one completed file without short timeslice fragments. Its
duration is bounded by the estimated byte budget (including 1,536 bytes reserved
for overhead) and 30 seconds, rather than stopping on the first container chunk.
Opus retains the original byte-budget cutoff and 30-second limit. On a normal
Stop the input remains alive until the recorder's final data/stop events, then
microphone tracks and the audio context are released. Cancel releases them
immediately. The recording status identifies the format and final actual byte
count. This remains the default recording path.

The browser may choose a different actual bitrate, and container overhead can
exceed the estimate. This is not a fixed output-size guarantee. The codec still
checks actual capacity and refuses an export that cannot be verified. These
iPhone recorder changes require device verification; the desktop playback retry
fix remains.

Optional **Smaller voice** (8 kbit/s) and **Smallest voice** (6 kbit/s) modes
compress the finished recording to mono Opus locally with WebCodecs. They do not
change microphone capture or the working MediaRecorder settings. The nominal
audio rates are 1,000 and 750 bytes per second, plus container overhead; voice
quality is lower. Actual encoded bytes determine whether there is a saving.
The selectable options are enabled only after the browser reports encoder and
WebM/Opus playback support. Safari added AudioEncoder in version 26; older or
unsupported browsers keep the original recording. No server, CDN or external
encoder dependency is used. See [Safari 26 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes)
and [Opus configuration](https://www.w3.org/TR/webcodecs-opus-codec-registration/).

**Make voice smaller** applies the same conversion to an existing audio attachment
(up to 60 seconds / 1 MiB), using 8 kbit/s unless Smallest voice is selected.
The source is mixed to mono offline and encoded with a 48 kHz sample clock,
matching Opus timing and avoiding input-rate priming differences in Cocoa's
encoder. This does not raise the compressed bitrate. Encoder delay and final padding
are recorded in a finite WebM with an explicit duration. One-second laced blocks
reduce container overhead while retaining each encoded packet. If the native
decoder rejects their timing, the same packets are remuxed into individual blocks
and checked again. A duration mismatch reports the actual and expected times;
it still keeps the original. Container rules
follow the [Matroska Opus mapping](https://www.matroska.org/technical/codec_specs.html#a_opus).
Ogg/Opus was avoided because of [Safari's reported Ogg timing bug](https://bugs.webkit.org/show_bug.cgi?id=293310).
Before replacing the attachment, the conversion is decoded to check its duration
and that an audible source has not become silent. The original is retained if
conversion fails or produces a larger file. Cancel/import discards pending work;
the encoder closes on cancellation or a stalled queue/flush. Users should listen
to the converted recording before encoding. Native Chrome checks verify encoding,
playback duration and fallback; actual iPhone Safari use still needs device testing.

Composition audio players are retained per attachment when an audio conversion
or list refresh replaces their contents. A successful reduction switches the
existing player to the new file, requests full preloading and calls load before
the next Play gesture; the old URL is revoked. Unchanged conversions retain the
existing source and playback state. Reset/removal stops and releases discarded
players and their sources. This avoids replacing the media element or starting
a new load from the first preview tap. Decoded-image playback continues to use
its existing retained main player and gesture handling.

**Full screen preview** beside the image uses the existing zoom, pan and comparison
canvases in a viewport-filling dialog. Fit and 100% controls are available; closing
restores the previous page view. **Preview** at the end of the export actions
opens a clean transmission view of the current generated, imported, pasted or
captured image, with every control initially hidden. It never displays the
comparison divider, Encoded/Source labels, analysis overlay or audio button,
including when a tap reveals its Fit, 100%, maximise and close controls. The
maximise icon hides those controls completely for phone-to-phone capture.
Holding still for 450 milliseconds toggles the entire view between encoded
pixels and recovered source when that comparison is ready. It preserves zoom,
pan and divider position; neither image has comparison labels or a scrubber.
Short taps only toggle controls. Drags, a second finger, cancellation and closing
cancel pending holds. Each new Preview opens on the encoded image.
Preview is disabled only when no image is available. Element fullscreen is
requested where supported; iPhones retain the viewport-filling dialog fallback.
The upper fullscreen button keeps the comparison/analysis viewer. There, the
maximise icon hides controls and a short tap reveals them again. Holding one finger
still for 450 milliseconds grabs the divider from anywhere in the fullscreen
viewport, even when its handle is offscreen. Movement before that delay cancels
the hold; a second finger cancels it for pinch/two-finger pan. Releasing a held
divider does not reveal controls. Immediate handle/line dragging and desktop
mouse scrubbing remain available. Escape closes the viewer.
Successful reads start with marker overlays hidden. Failed photographs show
diagnostic markers; continuous captures start clean. Fullscreen preview has a
button-style **Analysis** toggle just before Close in the action row; it is absent
from the main page. Its computer/binary icon has a full 44 × 48 pixel touch
target, a highlighted checked state and a keyboard focus outline. Native reads,
including clipboard pastes and generated images, gather
diagnostics at the known marker positions on request without a broad search.
For V5 this includes all four checksum-bearing corner markers and four smaller
side references, whose matches do not increase the header count. Marker rectangles
surround the full pixel area rather than connecting the outer pixel centres.
Unconfirmed expected side references use dashed outlines in native analysis.
Formats without recovery markers have the control disabled with an explanation.
The separate overlay never changes captured or exported pixels. The comparison range
slider has a larger thumb and a 48-pixel-high touch target.
Choose image becomes Cancel search while automatic image recovery runs, leaving
the loaded image ready for encoding after cancellation. Continuous camera
scanning waits four seconds after the live video starts before buffering or
checking frames; manual capture remains available during that framing period.
The first camera Decode or Create discovers and ranks cameras, caching that information
for the page session. Reopening or cycling uses the cached list and opens the
best eligible camera directly, independently of the last manual selection.
Physical cameras rank ahead of virtual feeds;
on phones, a standard rear lens ranks ahead of the front camera and unusual
Dual Wide/Triple/Ultra Wide/telephoto modes. Within a group, reported resolution
and autofocus capabilities provide hints, with observed capture dimensions as a
fallback. Recent startup failures lower a device's rank until it works again or
the camera list changes. Ranking is an estimate of suitability, not measured
optical decoding quality. Per-device capability inspection is optional.
If initial permission hides cameras, the first stream exposes the list and is
replaced when a better-ranked device appears. All discarded streams are stopped.
Only the selected camera and necessary fallbacks are opened; enumeration does
not start every camera. Once ready, Switch camera cycles through the fixed ranked
order, wraps around and skips failed devices. Closing releases video tracks but
retains discovery and ranking. Discovery refreshes on a changed camera list or a
cached camera startup failure; unchanged device events and permission-hidden
names do not discard it. The opening status says **Opening camera**, rather than
claiming permission is needed on every open. Browser permission policy still
controls actual permission prompts; cached metadata does not grant camera access.
`node tests/pixelstow-camera-ranking-checks.mjs` covers ordering, permission-hidden
and partially exposed lists, cached reopen/cycling without re-enumeration,
fallback, cancellation and standard rear-lens choice
using synthetic camera streams. Browser visibility and capability limits are
documented by [enumerateDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)
and [InputDeviceInfo.getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/InputDeviceInfo/getCapabilities).
The page places the image first, with its caption below it. The image toolbar has
compact Browse, Paste, Decode and Create actions, followed immediately by fullscreen
at the right end of the same button row. Browse and Paste can open either encoded images or raw
sources; Decode opens the camera reader, while Create takes a source photo. The speaker button
sits to the left of the main comparison slider on the same row. The same button and slider
move into the fullscreen footer, then return on close. Speaker, Fit, 100%,
maximise, Analysis and close share one action row, including at 320px width,
with 44 × 48 pixel targets. The group is centred with gaps from eight to twenty
pixels, including in the clean four-button viewer; Close is always last. Icon buttons have accessible labels and tooltips;
the speaker label tracks Play/Pause without removing its SVG. Audio is disabled
and hidden when no audio is available. The footer occupies its own space below
the image. Generated pixels appear immediately while source extraction prepares
the comparison. The shared speaker button remains hidden until the comparison
slider is ready, then both appear together; decoded audio may start sooner.
Native attachment players retain their controls;
there is no second decoded-message Play button. The audio element and tap handler
are reused rather than recreated, preserving the existing Safari playback flow.

Starting a new import, camera session or recovery clears previous appraisal and
redundancy feedback immediately and invalidates pending appraisal updates. A
fixed single-line status directly below the image name follows recovery; live
camera scanning has the same line next to its preview. Colour transitions from
red through amber towards green as signature, markers, geometry and pixel-grid
reads provide stronger evidence. Rejected candidates return towards red; only a
verified payload receives the final green result. Colours describe evidence
stages, not a percentage or a guarantee. Long text is ellipsized without moving
the image or controls, while the complete recovery/result text remains below.
Cancelled or completed worker callbacks cannot overwrite a newer status.
`node tests/pixelstow-read-progress-checks.mjs` checks these states with paused
inspection, cancellation, stale events and real native payload verification.

With a source and payload selected, a **Photo-read prognosis** bar above the export actions
runs green through amber to red, with a difficulty marker and textual label.
It estimates protection from payload repetition, error correction, wavelet
intensity and native carrier density. More repetition moves towards green within
the selected payload-sized range. Strength-adjusted anchors at
one, two and five copies join smoothly, with a non-flat tail beyond five copies.
Reduced-parity images are compared on the same 12-bit coverage basis. This is a
heuristic, not a calibrated camera success percentage. Above the user's observed
1200 x 800 reference area, the model discounts the protection margin by
`1 / sqrt(carrierPixels / 960000)`. Extra strength cannot eliminate this sampling
penalty. Focus, glare, aspect ratio and framing still affect capture. Actual
codec boost policies are unchanged.
The quality/durability slider only changes wavelet intensity. Its 0.8 setting
still preserves the accepted encoding strength. It never resizes the carrier,
including when scaling is enabled. More durable settings move prognosis towards
green on the already chosen grid. If settings change after export, prognosis
estimates the next encoding and asks the user to re-encode; the saved PNG remains
unchanged. Without source scaling, dragging prognosis adjusts intensity within
its achievable range. With scaling, it selects redundancy/resolution and updates
the available quality range. Unavailable portions of both scales are shaded.

The scaling quality envelope uses the accepted 2x redundancy / 80% strength
setting as its reference. Its minimum requested signal multiplier is
`sqrt(2 / coverage) * max(1, sqrt(carrierPixels / 960000))`, and its maximum quality
is `clamp(0.8 - log2(multiplier), 0, 1)`. Coverage includes the existing parity
normalization. This is a conservative planning policy, **not** a measured optical
success boundary: current automated experiments establish native decoding and
signal limits, not a camera-safe amplitude table. The existing capped writer
gain is checked separately and a warning identifies insufficient compensation.
The prognosis interpolates the quality multiplier continuously up to the real
writer gain ceiling at each repetition anchor, avoiding jumps from rounded
integer strengths. Lower quality remains selectable for stronger wavelets;
quality above the current bound is clamped. The requested quality is retained
while prognosis changes, so moving back into a more permissive range restores
it. Quality gestures never change the selected repeat target or dimensions.
The quality input's native maximum follows this bound, and its active track
occupies only the available part of the full scale. The shaded remainder is
inert; dragging beyond it cannot store a hidden over-limit quality or change
prognosis. Returning inside the boundary responds immediately. Mouse, touch and
keyboard input use the same real limit, with the existing large touch thumb.
Repetition and parity also appear as capacity warnings. Reported repetition uses
the actual coding, and reduced error correction is identified explicitly.
The slider has a 64-pixel-high touch area and a larger visible handle. Tapping
anywhere across that area chooses a target immediately; dragging retains the
gesture outside the bar while page scrolling remains available elsewhere.
Changing byte capacity, planned dimensions and read warnings appear together in
one fixed-height status area below this bar. The separate expected-repetition
paragraph is removed; generated-image repetition is not repeated above it. The
status area scrolls if unusually long feedback exceeds its reserved space.
Its capacity figure follows the planned dimensions, and compression is not rerun
while dragging. On mobile the prognosis heading also reserves a consistent height.

Voice recording controls precede Attachments. Empty recovery status reserves no
blank space, and the open recovery options have no trailing paragraph margin.
Zoom/pan help is a small, muted, noninteractive overlay within the preview. It
disappears after a zoom or pan and returns when a new image is loaded; comparison
taps and ordinary page scrolling leave it alone.

Turning on **Scale source for payload** discards previous slider settings and
selects approximately **2x redundancy and 80% quality**, subject to the quality
envelope above. Camera source capture does the same automatically. The carrier
is the smallest grid needed for that repeat budget, including actual compressed
payload bytes, framing, password overhead, error correction and reserved marker
space. A 4032 x 3024 original with a small payload is reduced immediately in the
plan; a small original with a large payload is enlarged. No source pixels are
changed until Encode.
Moving prognosis left enlarges the carrier to add repetition; moving right shrinks
it towards the minimum fit. The selectable range is approximately **1x--3x**,
with only native block rounding beyond the requested repeat count. Tiny payloads
can exceed this range because the markers themselves require a minimum grid.
Dimensions are whole four-pixel blocks and preserve source aspect ratio to block
rounding. The original pixel count does not determine the selected carrier size.
The selectable range retains standard four-bit parity whenever that can fit within
the limit; otherwise it retains one-bit parity throughout. This prevents a parity
switch from making the displayed repeat count fall during a leftward gesture.
The 24-megapixel hard limit can truncate the repeat range below 3x (or 2x), and
the status explains this; a payload that cannot fit even once is rejected.
Large payloads can still require a dense carrier even at 1x, so the prognosis
remains poor and recommends reducing the payload rather than advertising the
larger grid as easy to photograph. Payload edits preserve the chosen repeat
target and recompute the required dimensions.
The sliders calculate dimensions without resampling. On Encode, a copy of the
retained original is resized first, the same text and attachment bytes are
embedded into that resized source, and the exported PNG is verified. Re-encoding
always starts from the original source rather than resizing a previous result.
Source exports and the comparison preview use the generated carrier dimensions.
Camera photos explicitly taken for encoding enable scaling automatically;
opening a file or pasting an image restores the last manually selected setting.
`node tests/pixelstow-sizing-checks.mjs` covers capacity bounds, size direction,
native round trips and unchanged source pixels. `node tests/pixelstow-prognosis-checks.mjs`
checks the real mobile controls, reset-on-enable, payload-sized camera defaults,
quality bounds, density warnings, monotonic repetition, forced enlargement and
verified encoding at the minimum selectable size. Its Playwright
environment overrides match the camera checks.

Capture focus, glare, source detail and distortion
still affect recovery. Recovery status/signature, near-miss advice and overlays
are cleared before a new import, retry, decode/unlock or camera read begins.

Browser WebM/Opus recordings receive a final Matroska `Info/Duration`, calculated
from cluster/block timestamps and Opus packet durations. This gives the native
player a fixed total time before playback, instead of a growing duration estimate
that distorts seek-bar movement. Only the single-track, unlaced, unindexed stream
layout is finalized; the encoded audio packets are unchanged. Existing streamed
WebM attachments get this repair in their playback copy, while their original
attachment/download bytes remain untouched. M4A recording is unaffected.

Recording needs HTTPS or localhost, browser microphone permission and
MediaRecorder support. Playback is attempted on import/unlock, with ordinary
audio controls and the image's Play audio shortcut when autoplay is blocked. The button
calls play directly from the tap and replaces a pending autoplay request if it
never reached playback. The main player is retained across image/camera imports;
image, camera and unlock gestures first play a brief silent clip on that same
element to prepare Safari's media permission. Pause is shown only after playback
actually starts. iOS can still refuse audible autoplay after asynchronous
import/decryption. Comparison source extraction runs in a disposable worker on
HTTPS/localhost so its processing does not block the playback controls; changing
images or locking cancels that worker. Unsupported formats can still be
downloaded. Only the first audio attachment autoplays, so clips do not overlap.
Loading another image, discarding a recording or locking again stops playback,
releases microphone tracks and revokes object URLs. Passwords clear after success.

The PNG is lossless and verified byte for byte. A JPEG is offered only when
decoding that exact JPEG preserves the text and every attachment byte. This does
not promise recovery after social-media processing, resize, crop or photography.

The Paste image button calls the async Clipboard API directly from the tap.
Safari can show a native Paste confirmation. When access is unavailable, denied,
or the clipboard has no image, a focused touch-and-hold paste target accepts an
actual image file. Pasted links/HTML are not fetched or inserted. Clipboard image
conversion can also change a carrier; choosing the original file is preferable.

Comparison offers a visible native slider and a pointer-captured touch handle.
Left-clicking or dragging anywhere on the comparison image moves the divider,
including after zooming or panning it offscreen. Right-button dragging pans;
touch gestures outside the divider handle remain available for page scrolling.
The page preview uses `touch-action: pan-y` and leaves the first finger uncaptured.
Two-finger touch events take over for image pinch/pan; full-screen preview retains
`touch-action: none`. Ordinary taps still reach playback buttons. Focused native
Chrome touch checks verified page scrolling, divider dragging, page/full-screen
pinch without browser zoom, and camera-source import; actual iPhone use remains
subject to device evaluation.
The header keeps the larger logo beside the title, with the shortened introduction
across the full width below. Technical notes are at the bottom of the page.

Image sharing uses the native share sheet when `navigator.canShare({files})`
allows it. A verified JPEG is preferred when available, otherwise PNG. The file
is prepared before the tap so asynchronous encoding does not lose Safari's user
activation. Select WhatsApp in the sheet; whether the app keeps the accompanying
text or treats the image as a photo depends on the recipient
app. Send as a Document/original file where possible. The fallback offers a
copyable opening message and a WhatsApp text link; it clearly requires attaching
the image separately. No passwords or decoded payload text are included in this
message. A static opening link cannot read the recipient's WhatsApp attachment.

**Post to Facebook** offers the prepared encoded photo and a copyable caption
containing the PixelStow opening link and save/paste/unlock/audio instructions.
When file sharing is available, the user chooses Facebook in the native share
sheet. That share contains only the prepared image file, with no title, text or
URL that Facebook could treat as a website preview. Copy and paste the caption
separately after attaching the photo. Otherwise, download the photo, open
Facebook, attach it and paste the caption or add it as a comment. Facebook handles
the final Post action. No Facebook photo URL is needed, and PixelStow does not
upload or host a copy, use Cloudflare, or include passwords/decoded contents in
the caption.

PNG export now uses the reversible Paeth filter before DEFLATE to improve photo
compression while retaining exact RGBA bytes. Copy image to clipboard always
writes PNG, including on mobile, to avoid introducing a JPEG conversion before
pasting into another app. This allows a comparison with the earlier JPEG path;
it does not establish the cause of Facebook import failures. JPEG downloads and
native photo sharing retain their separate verified-JPEG option.

## Payload repetition and photo margin

The preview shows the stored image's **Redundancy**, and the composition area
shows **Expected redundancy** before encoding. Both report the average repetition
of the coded payload, e.g. 1.06× or 1.64×. A fractional value means only part of the
payload has another copy, rather than an additional complete copy of every bit.
It is not a probability of successful recovery.

The ratio is usable payload blocks divided by `storedFrameBytes * bitsPerByte`.
Usable blocks exclude the 504 preamble blocks and the chosen carrier's marker
regions. The stored frame includes the 20-byte header, compressed bundle/text and,
when locked, the 60-byte protection overhead. Compression is measured before
encryption without reading a password. The codec uses 12 bits per byte with four
parity bits when it fits, otherwise nine with one parity bit. That change is
reported separately as reduced error correction. Metadata is derived from the
existing layout; it changes neither the carrier nor any encoded bytes.

Ratios below 1.25× get an inline caution that photos and resized copies are
likely harder to recover near 1×. Values below 2× suggest aiming for more room
when photographing. These are guidance thresholds, not measured success limits,
and do not prevent encoding. Smaller attachments can increase repetition; lens
mapping, blur, exposure and glare can still defeat a more redundant image.

`node tests/pixelstow-repetition-checks.mjs` checks that predicted, encoded,
inspected and decoded ratios match for compressed password-protected text and a
near-capacity public binary attachment, with unchanged recovered payload bytes.

## Local mobile checks

Serve this checkout with a static HTTP server and open `pixelstow.html` on the
computer, or its LAN address on a phone on the same network. HTTP on a LAN IP
can test layout, choosing files, manual paste, decoding and tap-to-play audio.
Direct clipboard reads, microphone recording and native sharing require HTTPS
(localhost is a browser exception on the same device). Test those permissions
in iPhone Safari on an HTTPS preview; desktop viewport checks do not emulate
Safari's actual clipboard, media policies or WhatsApp integration.

`tests/pixelstow-browser.html` exercises the real UI, with generated public
images, synthetic microphone audio and mocked clipboard/share permissions. It
does not read the user's clipboard, microphone or send any WhatsApp messages.

## Staged rollout

1. Browser codec, attachment UI, recording, playback and repeatable checks.
2. Publish and validate the HTTPS browser experience.
3. Upgrade the independent .NET core, desktop/CLI and Explorer front ends to
   inspect/read v3 and export attachments; retain v1/v2 and legacy A7/ZIP reads.
4. Upgrade TileStorm Evolution's own reader to consume optional bundle text and
   expose binary data separately. Keep PixelStow independent of game schemas.

Run `node tests/pixelstow-checks.mjs` for browser codec checks. Run
`scripts/Test.ps1` in PictureCodec for the unchanged .NET compatibility baseline.
Generated checks and local preview files belong in ignored `artifacts`.

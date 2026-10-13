# PixelStow browser payloads

The browser milestone adds arbitrary file attachments and short microphone
recordings. Encoding, password handling, audio playback and file recovery happen
locally in the browser; there is no upload or service dependency.

Text without attachments still writes public PCF1 envelope v1 / kind 1 or
password-protected v2 / kind 2, unchanged. Writing carrier 1 preserves existing
PixelStow and TileStorm Evolution text-level interchange; the new default
carrier 4 currently needs the browser reader. Carrier 3 remains available as a
recovery-format fallback. Readers in the desktop and game need
the v3 upgrade before importing an image with attachments. A game should use the
bundle's optional text for level JSON and leave unrelated attachments opaque.

## Attachment envelope v3

The PCF1 frame shuffle, whitening, 20-byte header, strength, repetition and
parity are unchanged. The browser now defaults to a separate versioned image
carrier 4 with the same eight markers as carrier 3 and balanced local brightness.
Carrier 5 makes the smaller-corner-marker experiment selectable. Carriers 1
and 3 remain readable and selectable for writing. See [carrier 4](CarrierV4.md),
[experimental carrier 5](CarrierV5.md) and [carrier 3 resize recovery](ResizeRecovery.md)
for their layouts and limits.
Header byte 4 is 3; byte 5 is 3 for a public bundle or 4 for a protected bundle. Public bundles may use raw
DEFLATE when smaller. Protected outer frames are never compressed. Frame CRC32
covers header bytes 0–15 followed by the uncompressed body, as before.

The uncompressed bundle is at most 1,048,576 bytes. The stored frame limit is
1,048,656 bytes (bundle + 60-byte protection header + 20-byte frame header).
Actual photo capacity is much smaller: one payload byte needs at least nine
complete 4×4 pixel blocks, after the 504 preamble blocks. Compression may help
text; already compressed audio usually saves little. No pixels are resized to
make more space, and every export is checked before it is offered for download.

The bundle uses this layout, with unsigned little-endian lengths:

| Offset | Size | Value |
| --- | --- | --- |
| 0 | 4 | ASCII `PSB1` |
| 4 | 1 | Bundle version 1 |
| 5 | 1 | Reserved flags, must be 0 |
| 6 | 2 | Attachment count, 1–8 |
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

**Full screen preview** beside the image uses the existing zoom, pan and comparison
canvases in a viewport-filling dialog. Fit and 100% controls are available; closing
restores the previous page view. **Preview encoded image** at the end of the export
actions opens a clean presentation of the generated image, hiding the comparison
divider, recovery overlay, audio button and toolbar. Tap to reveal controls or
press Escape to close. Pinch/two-finger pan still work. Browsers with element
fullscreen can also hide their chrome; iPhones use the viewport dialog fallback.

Browser WebM/Opus recordings receive a final Matroska `Info/Duration`, calculated
from cluster/block timestamps and Opus packet durations. This gives the native
player a fixed total time before playback, instead of a growing duration estimate
that distorts seek-bar movement. Only the single-track, unlaced, unindexed stream
layout is finalized; the encoded audio packets are unchanged. Existing streamed
WebM attachments get this repair in their playback copy, while their original
attachment/download bytes remain untouched. M4A recording is unaffected.

Recording needs HTTPS or localhost, browser microphone permission and
MediaRecorder support. Playback is attempted on import/unlock, with ordinary
audio controls and a prominent Play button when autoplay is blocked. Phones also
have a Play audio button on the preview, without scrolling to the file list. The button
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
sheet; the same caption is passed as text. The copy button remains available
because a receiving app may omit that text. Otherwise, download the photo, open
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

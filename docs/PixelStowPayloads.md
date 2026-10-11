# PixelStow browser payloads

The browser milestone adds arbitrary file attachments and short microphone
recordings. Encoding, password handling, audio playback and file recovery happen
locally in the browser; there is no upload or service dependency.

Text without attachments still writes public PCF1 envelope v1 / kind 1 or
password-protected v2 / kind 2, unchanged. This preserves existing PixelStow and
TileStorm Evolution text-level interchange. Readers in the desktop and game need
the v3 upgrade before importing an image with attachments. A game should use the
bundle's optional text for level JSON and leave unrelated attachments opaque.

## Attachment envelope v3

The image grid, C7 carrier version 1, shuffle, whitening, 20-byte PCF1 header,
strength, repetition and parity are unchanged. Header byte 4 is 3; byte 5 is 3
for a public bundle or 4 for a protected bundle. Public bundles may use raw
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

Choose a photo, add optional text and files, or record a voice message. The
recorder requests mono audio at 16 kbit/s when supported, prefers MP4/AAC for
iPhone playback and falls back to WebM/Opus or Ogg/Opus, and stops at 30 seconds
or near the available byte budget. The browser may choose a different actual
bitrate. Container
overhead and the last recorder chunk can exceed the estimate; the codec still
checks actual capacity and refuses an export that cannot be verified.

The original recording path from `e582ba7` has been restored, before the compact
quality/default and sample-rate changes. The later playback retry fix remains.

Recording needs HTTPS or localhost, browser microphone permission and
MediaRecorder support. Playback is attempted on import/unlock, with ordinary
audio controls and a prominent Play button when autoplay is blocked. Phones also
have a Play audio button on the preview, without scrolling to the file list. The button
calls play directly from the tap and reuses the loaded player; iOS can refuse
audible autoplay after asynchronous import/decryption. Unsupported formats can still be
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
compression while retaining exact RGBA bytes. Clipboard writing uses a verified
JPEG only when the browser advertises JPEG support; otherwise it uses PNG.
Safari's PNG clipboard path remains available independently of photo sharing.

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

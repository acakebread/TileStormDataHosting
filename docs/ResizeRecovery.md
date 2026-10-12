# Browser resize-recovery carrier 3

Carrier 3 is the browser's default writer. **Encoding format → Previous format
(version 1)** switches writing back immediately and remembers that choice when
browser storage is available. Reading automatically accepts both formats;
changing the writer never changes what can be read. The new preference key is
`pixelstow-carrier-v3`, so the unfinished ruler experiment's selection does not
override the new default.

This is a new **image carrier**, separate from PCF1's existing text, password and
attachment-envelope versions. PCF1 framing, DEFLATE, encryption, attachment
bytes, parity and repetition are unchanged. Desktop/Unity/TileStorm readers
currently need carrier 1 until their signal readers are upgraded. Carrier 2
was Cursor's unshipped border-ruler experiment; its version number is reserved,
and this implementation does not read or write it. The original uncommitted
experiment was backed up locally under
`artifacts/research/sparse-markers-20261012/cursor-ruler-before-sparse.patch`.

## Local markers and layout

Nine patches sit near the corners, side midpoints and centre. Each is 96 × 64
original pixels, containing a 12 × 8 array of 8 × 8 symbols. An 8 × 8 symbol
uses the existing 4 × 4 diagonal wavelet, expanded to six pixels along each axis.
Marker amplitude follows the verified payload strength, capped at 16 (normally
8 for small payloads), so routine messages do not need double-strength patches.
The marker reader uses soft diagonal scores and does not need the amplitude
before it can read the header. A constant per-channel bias fits the signal into
the pixel range; otherwise values clamp. Alpha is untouched. No continuous
stripes or ruler ticks are painted, and no whole border is reserved.

Patch origins are aligned to the payload's 4-pixel lattice. For width `W`,
the three x origins are `8`, `4*floor((W-72)/8)` and `4*floor((W-80)/4)`.
For height `H`, the y origins are `8`, `4*floor((H-48)/8)` and
`4*floor((H-56)/4)`. Patch identifiers are row-major 0–8.

Each patch carries this independent eight-byte header:

| Byte | Meaning |
| --- | --- |
| 0 | Magic `D3` |
| 1 | `30` OR patch identifier (0–8) |
| 2–3 | Original width, unsigned little-endian |
| 4–5 | Original height, unsigned little-endian |
| 6–7 | Low 16 bits of CRC32 of bytes 0–5 |

Header bytes are whitened using the existing xorshift byte stream with seed
`50534C33`, then each byte is encoded using the existing 12-bit soft parity
code. The resulting 96 symbols use the existing Fisher–Yates scatter algorithm
with the same locator seed. The decoder knows the first two bytes before reading
the dimensions and can reject incorrect marker candidates cheaply.

The payload's logical block list is the full row-major 4 × 4 image grid with
only those eight rectangles excluded. Preamble and payload scattering operate
on that logical list, using the unchanged PCF1 seed. The C7 preamble's carrier
version is 3. Every encoder capacity calculation uses the same exclusion.

Marker area is 27,648 pixels: about 1.44% of a 1600 × 1200 photo. Pictures that
cannot fit eight disjoint patches, have either dimension above 65,535, or would
spend over 30% of their pixels on markers automatically write carrier 1. The
page reports that fallback. Capacity still depends on actual compressed data.

## Reading and limits

An unchanged image has a direct marker-header and payload read without geometric
resampling. Existing carrier 1 first undergoes its usual native-grid read;
wrong grids now fail the small preamble before the whole image is scored.

For resized pictures, marker discovery searches full-frame scale candidates
between 50% and 200%, prioritizing 95%, doubling and halving. Each candidate
must pass the locator's identifier, dimensions, bounds, parity and CRC checks.
The recovered original dimensions fix the exact x/y scale ratios, including
integer rounding of resized dimensions. A bounded pixel-centre offset search
then uses the repeated C7 preamble to establish read alignment. The payload is
scored directly through this coordinate mapping, with floating-point bilinear
luminance samples, instead of saving a resampled copy and rounding every pixel.
Only complete frame/checksum validation accepts recovered contents.

An exact half-sized image has a dedicated 2 × 2 diagonal-symbol scorer. This
preserves the sign left by an aligned box reduction and avoids expanding that
symbol back into a blurred 4 × 4 block. It does not guarantee recovery through
other shrinking filters or heavy recompression. Source extraction uses confirmed
recovery geometry and removes the known marker patterns approximately; it is
not a lossless restoration of the original photograph.

A valid locator with unreadable payload is reported separately and blocks
re-encoding. Locked images still require a password, and filenames/text/binary
contents remain unavailable before successful decryption. No password is stored
in the locator header.

The scope is a full-frame digital resize, usually preserving aspect ratio.
Cropping, rotation, perspective, local warping, screenshots, prints and camera
photos are outside this version's supported recovery model. Resizing can remove
signal even when alignment is known. Large, nearly full payloads and real
photographs need further device/user verification; extra markers do not create
additional error-correction capacity.

## Focused evidence

One generated 768 × 512 colour carrier with public text and a 256-byte binary
attachment recovered every byte at native size, 95% with Pillow bilinear and
bicubic filters, 200% with nearest and bilinear filters, and 50% with the box
filter. The saved public carrier-1 fixture, carrier-1 writer rollback and native
password-protected carrier 3 were also checked. These are specific fixture
results, not a claim that every photograph/filter/social-media transformation
works. Reproduce the focused check with `node tests/pixelstow-resize-checks.mjs`
using Node with web compression APIs and Python with Pillow installed. Generated
images/results go under ignored `artifacts/research/resize-check-*`; the initial
research snapshot is under `artifacts/research/sparse-markers-20261012`.

The smaller eight-marker layout replaces the initial development version 3 directly; those initial version-3 images are intentionally not retained. Carrier 1 compatibility is unchanged.

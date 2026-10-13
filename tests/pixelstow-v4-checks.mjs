// Focused format and large-photo boundaries; real camera evaluation is manual.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const context = vm.createContext({ window: {}, Uint8Array, Uint8ClampedArray,
  TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream,
  crypto: webcrypto, setTimeout, DOMException });
const source = await fs.readFile('pixelstow.js', 'utf8');
vm.runInContext(source.replace('root.PixelStow = {',
  'root.formatChecks = { assertImage, locatorLayout, locatorBlockMap, readVisualLocator }; root.PixelStow = {'), context);
const codec = context.window.PixelStow, internals = context.window.formatChecks;
const width = 640, height = 480, pixels = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  pixels.set([Math.round(130 + 45 * Math.sin(x / 29) + 35 * Math.cos(y / 37)),
    Math.round(135 + 50 * Math.cos((x + y) / 45)), Math.round(140 + 45 * Math.sin((x - y) / 31)), 77], (x + y * width) * 4);
}
const original = pixels.slice();
const content = { text: 'Public version 4 fixture.', attachments: [{ name: 'bytes.bin',
  type: 'application/octet-stream', bytes: Uint8Array.from({ length: 256 }, (_, i) => i) }] };
function headers(image) {
  for (const patch of internals.locatorLayout(image.width, image.height, image.carrierVersion)) {
    const read = internals.readVisualLocator(image.pixels, image.width, image.height,
      [1, 0, patch.x, 0, 1, patch.y, 0, 0, 1], patch.id, image.carrierVersion);
    assert.equal(read?.carrierVersion, image.carrierVersion);
    assert.equal(read?.originalWidth, image.width);
    assert.equal(read?.originalHeight, image.height);
  }
}
const image = await codec.encodePayload(pixels, width, height, content, '');
assert.equal(image.carrierVersion, 4);
assert.equal(codec.getCarrierVersion(), 4);
assert.equal(internals.locatorLayout(width, height, 4).length, 8);
assert.deepEqual(internals.locatorLayout(width, height, 4), internals.locatorLayout(width, height, 3));
assert.deepEqual(internals.locatorBlockMap(width, height, Infinity, 4), internals.locatorBlockMap(width, height, Infinity, 3));
assert.deepEqual(pixels, original);
for (let i = 3; i < pixels.length; i += 4) assert.equal(image.pixels[i], pixels[i]);
headers(image);
const png = await codec.writePng(image.pixels, width, height);
const reloaded = await codec.decodePng(new Uint8Array(await png.arrayBuffer()));
assert(codec.payloadsEqual(await codec.decode(reloaded.pixels, width, height, '', { nativeOnly: true }), content));
console.log('PASS: default V4, eight CRCs, V3 layout/capacity, source/alpha and PNG bundle round-trip');

const locked = await codec.encodePayload(pixels, width, height, content, 'public fixture password');
assert.equal((await codec.decode(locked.pixels, width, height, '', { nativeOnly: true })).status, 'password');
assert(codec.payloadsEqual(await codec.decode(locked.pixels, width, height, 'public fixture password', { nativeOnly: true }), content));
console.log('PASS: V4 password-protected attachment');

codec.setCarrierVersion(3);
const previous = await codec.encodePayload(pixels, width, height, content, '');
// Frozen V3 writer digest, recorded against the pre-V4 writer, not this reader.
assert.equal(createHash('sha256').update(previous.pixels).digest('hex'),
  '6ed25825e34a0e9153dc71a32bf08a8d141d990cfedc3cb45351523722246d43');
assert(codec.payloadsEqual(await codec.decode(previous.pixels, width, height, '', { nativeOnly: true }), content));
const v1 = await codec.decodePng(new Uint8Array(await fs.readFile('tests/fixtures/public-v1.png')));
assert.equal((await codec.decode(v1.pixels, v1.width, v1.height, '', { nativeOnly: true })).text,
  await fs.readFile('tests/fixtures/public-v1.txt', 'utf8'));
console.log('PASS: frozen V3 pixels and V1 fixture compatibility');

codec.setCarrierVersion(5);
const experimental = await codec.encodePayload(pixels, width, height, content, '');
assert.equal(experimental.carrierVersion, 5);
assert.equal(internals.locatorLayout(width, height, 5).length, 4);
headers(experimental);
assert(codec.payloadsEqual(await codec.decode(experimental.pixels, width, height, '', { nativeOnly: true }), content));
console.log('PASS: selectable experimental V5 and distinct corner headers/payload');

codec.setCarrierVersion(4);
for (const colour of [0, 120, 255]) {
  const w = 400, h = 320, flat = new Uint8Array(w * h * 4);
  for (let i = 0; i < flat.length; i += 4) flat.set([colour, colour, colour, 255], i);
  const encoded = await codec.encode(flat, w, h, 'Public clipped-colour fixture.', '');
  assert.equal(encoded.carrierVersion, 4);
  headers(encoded);
  // Flat pictures make any brightness rectangle measurable independently of
  // underlying photo texture. Compare each patch to its surrounding carrier.
  const layout = internals.locatorLayout(w, h, 4);
  for (const patch of layout) {
    let inside = 0, outside = 0, count = 0;
    for (let y = patch.y; y < patch.y + 48; y++) for (let x = patch.x; x < patch.x + 72; x++)
      inside += encoded.pixels[(x + y * w) * 4];
    for (let y = Math.max(0, patch.y - 12); y < Math.min(h, patch.y + 60); y++)
      for (let x = Math.max(0, patch.x - 12); x < Math.min(w, patch.x + 84); x++) {
        if (layout.some((p) => x >= p.x && x < p.x + 72 && y >= p.y && y < p.y + 48)) continue;
        outside += encoded.pixels[(x + y * w) * 4]; count++;
      }
    assert(Math.abs(inside / (72 * 48) - outside / count) <= 0.05,
      `V4 patch ${patch.id} changed the brightness of flat colour ${colour}`);
  }
}
console.log('PASS: black/midtone/white eight-marker headers and surrounding brightness match');

internals.assertImage({ length: 5712 * 4284 * 4 }, 5712, 4284);
assert.equal(codec.getLimits().inputPixels, 32000000);
assert.throws(() => internals.assertImage({ length: 8000 * 6000 * 4 }, 8000, 6000), /32 megapixel/);
assert.equal(codec.estimatePayloadBytes(5712, 4284), 0); // Readable photo, not an oversized writer.
console.log('PASS: 5712 x 4284 photo input and separate encoding limit');

// Browser adapter preserves every source row while using a small strip canvas.
const expected = Uint8Array.from({ length: 20 * 600 * 4 }, (_, i) => i % 251);
let closed = false, crops = 0, currentRow = 0;
context.createImageBitmap = async () => ({ width: 20, height: 600, close() { closed = true; } });
context.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
  clearRect() {}, drawImage(_bitmap, sx, sy, sw, sh, dx, dy, dw, dh) {
    assert.equal(sx, 0); assert.equal(sw, dw); assert.equal(sh, dh);
    assert.equal(dx, 0); assert.equal(dy, 0); currentRow = sy; crops++;
  }, getImageData(_x, _y, w, h) { return { data: expected.slice(currentRow * w * 4, (currentRow + h) * w * 4) }; }
}) }) };
const stripped = await codec.readImageFile(new Blob([Uint8Array.of(1, 2, 3)]));
assert.deepEqual(stripped.pixels, expected); assert.equal(crops, 3); assert(closed);
console.log('PASS: 1:1 canvas strip loading including the final partial strip');

for (const name of ['pixelstow-spectrum.js', 'pixelstow-transform.js', 'pixelstow-transform-worker.js', 'pixelstow-camera.js'])
  new vm.Script(await fs.readFile(name, 'utf8'), { filename: name });
const html = await fs.readFile('pixelstow.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
assert.match(html, /<option value="4">/);
assert.match(html, /<option value="5">Version 5[^<]*experimental/);
assert.match(html, /pixelstow-carrier-v4-balanced/);
console.log('PASS: script syntax, V4 default and experimental V5 UI selection');

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
  'root.formatChecks = { assertImage, locatorLayout, readVisualLocator }; root.PixelStow = {'), context);
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
  for (const patch of internals.locatorLayout(image.width, image.height, 4)) {
    const read = internals.readVisualLocator(image.pixels, image.width, image.height,
      [1, 0, patch.x, 0, 1, patch.y, 0, 0, 1], patch.id, 4);
    assert.equal(read?.carrierVersion, 4);
    assert.equal(read?.originalWidth, image.width);
    assert.equal(read?.originalHeight, image.height);
  }
}
const image = await codec.encodePayload(pixels, width, height, content, '');
assert.equal(image.carrierVersion, 4);
assert.deepEqual(pixels, original);
for (let i = 3; i < pixels.length; i += 4) assert.equal(image.pixels[i], pixels[i]);
headers(image);
const png = await codec.writePng(image.pixels, width, height);
const reloaded = await codec.decodePng(new Uint8Array(await png.arrayBuffer()));
assert(codec.payloadsEqual(await codec.decode(reloaded.pixels, width, height, '', { nativeOnly: true }), content));
console.log('PASS: default V4, corner CRCs, source/alpha preservation and PNG bundle round-trip');

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

codec.setCarrierVersion(4);
for (const colour of [0, 255]) {
  const flat = new Uint8Array(300 * 256 * 4);
  for (let i = 0; i < flat.length; i += 4) flat.set([colour, colour, colour, 255], i);
  headers(await codec.encode(flat, 300, 256, 'Public clipped-colour fixture.', ''));
}
console.log('PASS: black/white corner headers with background-matched brightness');

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
console.log('PASS: script syntax and V4 UI selection');

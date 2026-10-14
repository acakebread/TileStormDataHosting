// Public synthetic source/content only. Optical capture still needs device tests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.window = {};
(0, eval)((await fs.readFile('pixelstow.js', 'utf8')).replace('root.PixelStow = {',
  'root.boostChecks = { locatorLayout, locatorBlockMap, readVisualLocator }; root.PixelStow = {'));
const c = window.PixelStow, I = window.boostChecks, width = 640, height = 480;
c.setCarrierVersion(5);
let state = 139;
function random() { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }
const pixels = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const v = x < width / 2 ? 128 : Math.round(128 + (random() - 0.5) * 64);
  pixels.set([v, v, v, 113], (x + y * width) * 4);
}
const original = pixels.slice(), bytes = Uint8Array.from({ length: 1400 }, () => Math.floor(random() * 256));
const content = n => ({ text: 'Public V5 adaptive contrast check.', attachments: [{ name: 'public.bin', type: 'application/octet-stream', bytes: bytes.slice(0, n) }] });
function rms(image) {
  const sum = [0, 0], count = [0, 0];
  for (const block of I.locatorBlockMap(width, height, Infinity, 5)) {
    const x = block % (width / 4) * 4, y = Math.floor(block / (width / 4)) * 4, half = x < width / 2 ? 0 : 1;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const i = (x + dx + (y + dy) * width) * 4; sum[half] += (image.pixels[i] - pixels[i]) ** 2; count[half]++;
    }
  }
  return sum.map((v, i) => Math.sqrt(v / count[i]));
}
const results = [];
for (const target of [6, 2.17, 1.5]) {
  let n = 600;
  for (let i = 0; i < 3; i++) {
    const budget = await c.estimateRepetition(width, height, content(n), false);
    n += Math.round(budget.framedBytes * (budget.repetitionRatio / target - 1));
  }
  const payload = content(n), image = await c.encodePayload(pixels, width, height, payload, '');
  assert(Math.abs(image.repetitionRatio - target) < 0.05);
  assert.equal(image.carrierVersion, 5);
  assert.equal(I.locatorLayout(width, height, 5).length, 4);
  assert(c.payloadsEqual(await c.decode(image.pixels, width, height, '', { nativeOnly: true }), payload));
  for (const patch of I.locatorLayout(width, height, 5)) assert(I.readVisualLocator(image.pixels, width, height,
    [1, 0, patch.x, 0, 1, patch.y, 0, 0, 1], patch.id, 5), `marker ${patch.id} at ${image.repetitionRatio.toFixed(2)}x`);
  for (let i = 3; i < pixels.length; i += 4) assert.equal(image.pixels[i], pixels[i]);
  const error = rms(image);
  assert(error[1] > error[0] * 1.15, 'V5 must adapt to source detail within the same redundancy level');
  results.push({ ratio: image.repetitionRatio, strength: image.strength, rms: error });
}
assert(results[1].strength < results[2].strength, 'the stronger under-2x ramp must apply to V5');
assert(results[1].rms[1] > results[0].rms[1] * 1.5, 'moderate redundancy must spend more contrast than high redundancy');
assert.deepEqual(pixels, original);
console.log('PASS: V5 texture and fractional-redundancy boost, unchanged four-corner layout, CRC headers, exact payload and source/alpha preservation');
console.log(JSON.stringify(results));

for (const colour of [0, 128, 255]) {
  const flat = new Uint8Array(width * height * 4);
  for (let i = 0; i < flat.length; i += 4) flat.set([colour, colour, colour, 255], i);
  const payload = content(650), image = await c.encodePayload(flat, width, height, payload, '');
  assert(c.payloadsEqual(await c.decode(image.pixels, width, height, '', { nativeOnly: true }), payload));
  for (const patch of I.locatorLayout(width, height, 5)) assert(I.readVisualLocator(image.pixels, width, height,
    [1, 0, patch.x, 0, 1, patch.y, 0, 0, 1], patch.id, 5));
  const extracted = await c.extractCarrier(image.pixels, width, height, image.strength);
  assert.equal(extracted.length, flat.length);
  let residual = 0;
  for (const block of I.locatorBlockMap(width, height, Infinity, 5)) {
    const x = block % (width / 4) * 4, y = Math.floor(block / (width / 4)) * 4;
    let sum = 0, square = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const v = extracted[(x + dx + (y + dy) * width) * 4]; sum += v; square += v * v;
    }
    // Blind extraction cannot remove the unknown DC headroom adjustment at
    // black/white. It should remove the boosted wavelet within each block.
    residual += Math.max(0, square - sum * sum / 16);
  }
  assert(Math.sqrt(residual / (I.locatorBlockMap(width, height, Infinity, 5).length * 16)) < 2);
  for (let i = 3; i < extracted.length; i += 4) assert.equal(extracted[i], flat[i]);
}
console.log('PASS: boosted V5 on black/midtone/white input retains native contents, all four headers, carrier removal and extraction alpha');

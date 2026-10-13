// Metadata-only additions: ratio predictions and reads must describe the same
// unchanged framed payload, including compression before password encryption.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.window = {};
(0, eval)(await fs.readFile('pixelstow.js', 'utf8'));
const codec = window.PixelStow, width = 640, height = 480;
const pixels = new Uint8Array(width * height * 4).fill(128);
for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
const random = new Uint8Array(1200); let state = 12345;
for (let i = 0; i < random.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; random[i] = state & 255; }
for (const [content, password] of [
  [{ text: 'Public repetition check. '.repeat(100), attachments: [] }, 'public fixture password'],
  [{ text: '', attachments: [{ name: 'public.bin', type: 'application/octet-stream', bytes: random }] }, '']
]) {
  const predicted = await codec.estimateRepetition(width, height, content, Boolean(password));
  const encoded = await codec.encodePayload(pixels, width, height, content, password);
  const inspection = await codec.inspect(encoded.pixels, width, height, { nativeOnly: true });
  const decoded = await codec.decode(encoded.pixels, width, height, password, { nativeOnly: true });
  assert(codec.payloadsEqual(decoded, content));
  for (const field of ['repetitionRatio', 'copies', 'framedBytes', 'parityBits']) {
    assert.equal(predicted[field], encoded[field], 'prediction ' + field);
    assert.equal(inspection[field], encoded[field], 'inspection ' + field);
    assert.equal(decoded[field], encoded[field], 'decode ' + field);
  }
  assert(predicted.repetitionRatio >= 1);
  if (!password) assert(predicted.repetitionRatio < 1.25);
}
assert.equal(await codec.estimateRepetition(width, height, { text: '' }), null);
console.log('PASS: exact compressed repetition ratios, near-capacity bundle, password metadata and unchanged payload bytes');

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.window = {};
for (const name of ['pixelstow-spectrum.js', 'pixelstow-transform.js', 'pixelstow.js']) (0, eval)(await fs.readFile(name, 'utf8'));
const c = window.PixelStow, T = window.PixelStowTransform, width = 640, height = 480;
const pixels = new Uint8Array(width * height * 4);
for (let i = 0; i < pixels.length; i += 4) pixels.set([110, 135, 160, 157], i);
const content = { text: 'Public V5 default recovery check.', attachments: [] };
assert.equal(c.getCarrierVersion(), 5);
assert.equal(c.getLegacyRecovery(), false);
assert.deepEqual(c.getRecoveryVersions(), [5]);
const newest = await c.encodePayload(pixels, width, height, content, '');
assert.equal(newest.carrierVersion, 5);
assert(c.payloadsEqual(await c.decode(newest.pixels, width, height, ''), content));
console.log('PASS: V5 is the default writer and sole default native recovery format');

const legacy = [];
for (const version of [1, 3, 4]) {
  c.setCarrierVersion(version);
  const image = await c.encodePayload(pixels, width, height, content, '');
  assert.equal((await c.decode(image.pixels, width, height, '', { nativeOnly: true })).status, 'none');
  assert(c.payloadsEqual(await c.decode(image.pixels, width, height, '', { includeLegacy: true, nativeOnly: true }), content));
  assert(c.payloadsEqual(await c.decode(image.pixels, width, height, '', { carrierVersion: version, nativeOnly: true }), content));
  legacy.push(image);
}
c.setLegacyRecovery(true);
assert.deepEqual(c.getRecoveryVersions(), [5, 4, 3, 1]);
assert(c.payloadsEqual(await c.decode(legacy[2].pixels, width, height, ''), content));
c.setLegacyRecovery(false);
assert.equal((await c.decode(legacy[2].pixels, width, height, '', { nativeOnly: true })).status, 'none');
console.log('PASS: earlier writers remain selectable; retrieval requires explicit per-call or session opt-in');

// Record the detector's actual adapter list. Unselected families must never
// reach the expensive outline/correlation detector, even with a previous seed.
const originalFind = T.find, calls = [];
T.find = async (_pixels, _width, _height, options, adapters) => {
  calls.push({ versions: adapters.map(a => a.carrierVersion), seed: options.seed });
  return { geometry: null, candidates: [], markers: [] };
};
try {
  const seed = { carrierVersion: 4, id: 0, originalWidth: width, originalHeight: height, matrix: [1,0,8,0,1,8,0,0,1] };
  await c.scanMarkers(legacy[2].pixels, width, height, { singleResolution: true, worker: false, seed });
  assert.deepEqual(calls.at(-1).versions, [5]);
  assert.equal(calls.at(-1).seed, undefined);
  await c.scanMarkers(legacy[2].pixels, width, height, { singleResolution: true, worker: false, includeLegacy: true });
  assert.deepEqual(calls.at(-1).versions, [5, 4, 3]);
  await c.findVisualTransform(pixels, width, height, { geometryOnly: true, worker: false, carrierVersion: 4 });
  assert.deepEqual(calls.at(-1).versions, [4]);
} finally { T.find = originalFind; }
console.log('PASS: default photo discovery runs only the V5 family and discards an unselected older seed');

const spectrum = window.PixelStowSpectrum, originalAnalyze = spectrum.analyze, bands = [];
spectrum.analyze = async (_pixels, _width, _height, options) => {
  bands.push(options.markerRatios); return { likely: false, bases: [] };
};
try {
  await c.findVisualTransform(pixels, width, height, { geometryOnly: true, worker: false });
  assert.deepEqual(bands.at(-1), [4 / 5]);
  await c.findVisualTransform(pixels, width, height, { geometryOnly: true, worker: false, includeLegacy: true });
  assert.deepEqual(bands.at(-1), [4 / 5, 2 / 3]);
} finally { spectrum.analyze = originalAnalyze; }
console.log('PASS: older marker-frequency bands are considered only when explicitly enabled');

// A previous opt-in must not let a cached older transform bypass an opt-out.
const geometry = { carrierVersion: 4, originalWidth: width, originalHeight: height, matrix: [1,0,0,0,1,0,0,0,1],
  model: 'translation', rank: 100, markerCount: 8, markerTotal: 8, inlierCount: 8,
  corners: [{x:0,y:0},{x:width-1,y:0},{x:width-1,y:height-1},{x:0,y:height-1}], expectedMarkers: [] };
const scan = { width, height, geometry, markers: [{ carrierVersion: 4, id: 0 }], candidates: [{ geometry }] };
const read = await c.readMarkerCandidates(legacy[2].pixels, width, height, scan, { includeLegacy: true, worker: false });
assert.equal(read.unreadable, false);
assert.equal((await c.decode(legacy[2].pixels, width, height, '')).status, 'none');
const disabled = await c.readMarkerCandidates(legacy[2].pixels, width, height, scan, { worker: false });
assert.equal(disabled.found, false);assert.deepEqual(disabled.markers, []);
assert(c.payloadsEqual(await c.decode(legacy[2].pixels, width, height, '', { carrierVersion: 4 }), content));
console.log('PASS: cached geometry and retained candidate scans respect the active recovery formats');

c.setCarrierVersion(4);
const locked = await c.encodePayload(pixels, width, height, content, 'public fixture password');
c.setCarrierVersion(5);
await assert.rejects(c.encodePayload(locked.pixels, width, height, content, ''), /already contains/);
assert.equal(c.getLegacyRecovery(), false);
const small = new Uint8Array(128 * 128 * 4).fill(128);
assert.equal(c.estimatePayloadBytes(128, 128), 0);
assert.equal(await c.estimateRepetition(128, 128, content), null);
await assert.rejects(c.encodePayload(small, 128, 128, content, ''), /too small for version 5/);
const v1 = await c.decodePng(new Uint8Array(await fs.readFile('tests/fixtures/public-v1.png')));
assert.equal((await c.decode(v1.pixels, v1.width, v1.height, '', { nativeOnly: true })).status, 'none');
assert.equal((await c.decode(v1.pixels, v1.width, v1.height, '', { nativeOnly: true, includeLegacy: true })).text,
  await fs.readFile('tests/fixtures/public-v1.txt', 'utf8'));
console.log('PASS: locked older input stays protected, V5 never silently emits V1, and public V1 remains available by opt-in');

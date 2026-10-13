// Focused search-control regression checks; pixel/header checks live in the codec tests.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.window = {};
const source = await fs.readFile('pixelstow-transform.js', 'utf8');
(0, eval)(source.replace('root.PixelStowTransform = {',
  'root.searchChecks = { findNear, retryMissing, geometryFor, patchMatrix }; root.PixelStowTransform = {'));
const { findNear, retryMissing, geometryFor, patchMatrix } = window.searchChecks;
const ids = [0, 2, 6, 8, 1, 3, 5, 7], layout = ids.map((id) => ({
  id, x: [8, 284, 560][id % 3], y: [8, 216, 424][Math.floor(id / 3)]
}));
const seed = { originalWidth: 640, originalHeight: 480, carrierVersion: 4, id: 0 };
const plane = [1, 0, 24, 0, 1, 24, 0, 0, 1];
let visible = true, shifted = false, fullScores = 0;
const adapter = {
  ids, carrierVersion: 4, patchWidth: 72, patchHeight: 48, layout: () => layout,
  quality(matrix, id, dimensions) {
    if (id === 8 && !visible) return 0;
    const target = patchMatrix(plane, layout.find((p) => p.id === id));
    const x = matrix[2] / matrix[8] - target[2] - (shifted && id === 8 ? 6 : 0);
    const y = matrix[5] / matrix[8] - target[5];
    if (dimensions) { fullScores++; return 0.99 * Math.exp(-(x * x + y * y) / 8); }
    // Convincing prefix decoys far from the actual full-pattern response.
    return Math.abs(x) > 8 && Math.abs(y) > 8 ? 0.95 : 0.6 * Math.exp(-(x * x + y * y) / 8);
  },
  confirm(matrix, id, dimensions) {
    const quality = this.quality(matrix, id, dimensions);
    return quality > 0.85 ? { ...seed, id, matrix: Array.from(matrix), quality, verification: 'header', localized: true } : null;
  }
};
const firstSeven = () => layout.filter((p) => p.id !== 8).map((p) => ({ ...seed, id: p.id,
  matrix: patchMatrix(plane, p), quality: 0.99, verification: 'header', localized: true }));
const options = () => ({ mode: 'perspective', deadline: Date.now() + 3000 });

const markers = firstSeven(), attempts = new Map();
assert.equal(await retryMissing(markers, seed, adapter, [{ matrix: plane, model: 'perspective' }], 720, 560, options(), attempts), true);
assert.equal(markers.length, 8);
assert.equal(attempts.get(8).finalRetry, true);
assert.deepEqual(geometryFor(plane, seed, markers, adapter, 'perspective').missingMarkerIds, []);
console.log('PASS: refined-plane retry recovers the eighth measured patch');

visible = false;
const masked = firstSeven(), failedAttempts = new Map();
assert.equal(await retryMissing(masked, seed, adapter, [{ matrix: plane, model: 'perspective' }], 720, 560, options(), failedAttempts), false);
assert.equal(masked.length, 7);
assert.deepEqual(geometryFor(plane, seed, masked, adapter, 'perspective').missingMarkerIds, [8]);
assert.equal(failedAttempts.get(8).reason, 'not-confirmed');
console.log('PASS: a genuinely absent patch remains missing, with its ID reported');

visible = true; shifted = true; fullScores = 0;
const found = await findNear(plane, layout.find((p) => p.id === 8), seed, adapter, options(), 16);
assert(found && found.id === 8);
assert(fullScores > 0);
assert(Math.abs(found.matrix[2] / found.matrix[8] - (560 + 24 + 6)) < 0.5);
console.log('PASS: full-pattern ranking rejects short-prefix decoys');

shifted = false;
const verifiedAtLimit = await findNear(plane, layout.find((p) => p.id === 8), seed, adapter,
  { ...options(), deadline: Date.now() - 1 }, 16);
assert.equal(verifiedAtLimit?.verification, 'header');
assert.equal(verifiedAtLimit?.id, 8);
console.log('PASS: optional refinement does not discard an already verified eighth marker at the time limit');

const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(findNear(plane, layout.find((p) => p.id === 8), seed, adapter,
  { ...options(), deadline: Date.now() - 1, signal: cancelled.signal }, 16), { name: 'AbortError' });
await assert.rejects(retryMissing(firstSeven(), seed, adapter, [{ matrix: plane }], 720, 560,
  { ...options(), signal: cancelled.signal }, new Map()), { name: 'AbortError' });
assert.equal(await retryMissing(firstSeven(), seed, adapter, [{ matrix: plane }], 720, 560,
  { ...options(), deadline: Date.now() - 1 }, new Map()), false);
console.log('PASS: final retries preserve cancellation and the overall time limit');

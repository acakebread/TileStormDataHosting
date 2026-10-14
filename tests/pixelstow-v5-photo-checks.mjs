// Public synthetic pixels: a verified corner with misleading outline curvature.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.window = {};
for (const name of ['pixelstow-spectrum.js', 'pixelstow-transform.js', 'pixelstow.js']) {
  let source = await fs.readFile(name, 'utf8');
  if (name === 'pixelstow.js') source = source.replace('root.PixelStow = {',
    'root.photoChecks = { locatorLayout, readVisualLocator, liftPhotoResult }; root.PixelStow = {');
  (0, eval)(source);
}
const c = window.PixelStow, I = window.photoChecks;
const width = 640, height = 480, source = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
  source.set([120 + Math.round(20 * Math.sin(x / 40)), 140 + Math.round(20 * Math.cos(y / 30)), 130, 255], (x + y * width) * 4);
c.setCarrierVersion(5);
const content = { text: 'Public V5 misleading-outline regression.', attachments: [] };
const encoded = await c.encodePayload(source, width, height, content, '');
const photoWidth = 960, photoHeight = 720, photo = new Uint8Array(photoWidth * photoHeight * 4);
for (let i = 3; i < photo.length; i += 4) photo[i] = 255;
const scale = 1.3, left = 32, top = 32;
for (let y = 0; y < photoHeight; y++) for (let x = 0; x < photoWidth; x++) {
  const u = (x - left) / scale, v = (y - top) / scale;
  if (u < 0 || v < 0 || u > width - 1 || v > height - 1) continue;
  const ix = Math.floor(u), iy = Math.floor(v), jx = Math.min(width - 1, ix + 1), jy = Math.min(height - 1, iy + 1);
  const fx = u - ix, fy = v - iy;
  for (let k = 0; k < 3; k++) photo[(x + y * photoWidth) * 4 + k] = Math.round(
    (encoded.pixels[(ix + iy * width) * 4 + k] * (1 - fx) + encoded.pixels[(jx + iy * width) * 4 + k] * fx) * (1 - fy) +
    (encoded.pixels[(ix + jy * width) * 4 + k] * (1 - fx) + encoded.pixels[(jx + jy * width) * 4 + k] * fx) * fy);
}
const point = (h, x, y) => ({ x: (h[0] * x + h[1] * y + h[2]) / (h[6] * x + h[7] * y + h[8]),
  y: (h[3] * x + h[4] * y + h[5]) / (h[6] * x + h[7] * y + h[8]) });
// Match the first patch's centre and derivatives, but give the outline a wrong
// projective term. Its small local error still permits a real header checksum.
const patch = I.locatorLayout(width, height, 5)[0], cx = 24.5, cy = 24.5;
const px = left + scale * (patch.x + cx), py = top + scale * (patch.y + cy), h = 0.0002, d = 1 - h * cy;
const matrix = [scale, px * h, px * d - scale * cx, 0, scale + py * h, py * d - scale * cy, 0, h, d];
const seed = I.readVisualLocator(photo, photoWidth, photoHeight, matrix, patch.id, 5);
assert.equal(seed?.verification, 'header', 'the inaccurate outline must still pass the local header CRC');
seed.initialMatrix = [matrix[0], matrix[1], matrix[2] - matrix[0] * patch.x - matrix[1] * patch.y,
  matrix[3], matrix[4], matrix[5] - matrix[3] * patch.x - matrix[4] * patch.y,
  matrix[6], matrix[7], matrix[8] - matrix[6] * patch.x - matrix[7] * patch.y];
const bottom = point(seed.initialMatrix, 600, 450);
assert(Math.hypot(bottom.x - (left + 600 * scale), bottom.y - (top + 450 * scale)) > 30,
  'the outline must extrapolate beyond the ordinary corner search radius');
const before = photo.slice();
const scan = await c.scanMarkers(photo, photoWidth, photoHeight, { mode: 'perspective', singleResolution: true,
  worker: false, seed, deadline: Date.now() + 8000 });
assert.equal(scan.markers.length, 4);
assert.equal(scan.geometry.inlierCount, 4);
const inspected = await c.readMarkerCandidates(photo, photoWidth, photoHeight, scan, { worker: false });
assert.equal(inspected.unreadable, false);
assert(c.payloadsEqual(await c.decode(photo, photoWidth, photoHeight, ''), content));
assert.deepEqual(photo, before);
console.log('PASS: a real V5 header with misleading outline curvature recovers all four corners and the payload');

const lifted = I.liftPhotoResult({ geometry: scan.geometry, markers: [seed], candidates: [] },
  photoWidth * 4, photoHeight * 4, photoWidth, photoHeight);
for (const key of ['matrix', 'initialMatrix']) {
  const original = point(seed[key], 123, 45), actual = point(lifted.markers[0][key], 123, 45);
  assert(Math.abs(actual.x - ((original.x + 0.5) * 4 - 0.5)) < 1e-8);
  assert(Math.abs(actual.y - ((original.y + 0.5) * 4 - 0.5)) < 1e-8);
}
console.log('PASS: both the verified patch and its outline prediction retain pixel-centre coordinates across photo scales');

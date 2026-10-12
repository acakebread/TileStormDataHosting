import fs from 'node:fs/promises';
import { fileURLToPath } from "node:url";
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
const folder = new URL('artifacts/research/resize-check-' + new Date().toISOString().replace(/[:.]/g, '-') + '/', root);
await fs.mkdir(folder, { recursive: true });
const code = await fs.readFile('pixelstow.js', 'utf8');
const context = vm.createContext({ window: {}, Uint8Array, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, crypto: webcrypto, setTimeout });
vm.runInContext(code, context);
const codec = context.window.PixelStow;
const width = 768, height = 512;
const pixels = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  pixels.set([Math.round(130 + 45 * Math.sin(x / 29) + 35 * Math.cos(y / 37)), Math.round(135 + 50 * Math.cos((x + y) / 45)), Math.round(140 + 45 * Math.sin((x - y) / 31)), 255], (x + y * width) * 4);
}
const content = { text: 'Public resize recovery fixture.', attachments: [{ name: 'public-bytes.bin', type: 'application/octet-stream', bytes: Uint8Array.from({ length: 256 }, (_, i) => i) }] };
const before = pixels.slice();
const encoded = await codec.encodePayload(pixels, width, height, content, '');
if (encoded.carrierVersion !== 3 || pixels.some((b, i) => b !== before[i])) throw Error('New default or source preservation failed');
await fs.writeFile(new URL('sparse-v3.png', folder), new Uint8Array(await (await codec.writePng(encoded.pixels, width, height)).arrayBuffer()));
execFileSync('python', ['-c', `from PIL import Image
from pathlib import Path
import sys
folder = Path(sys.argv[1])
image = Image.open(folder / 'sparse-v3.png')
for name, factor, method in [('95-bilinear',.95,Image.Resampling.BILINEAR),('95-bicubic',.95,Image.Resampling.BICUBIC),('200-nearest',2,Image.Resampling.NEAREST),('200-bilinear',2,Image.Resampling.BILINEAR),('50-box',.5,Image.Resampling.BOX)]:
    image.resize((round(image.width*factor),round(image.height*factor)),method).save(folder / (name+'.png'))
`, fileURLToPath(folder)]);
const results = [];
for (const name of ['sparse-v3', '95-bilinear', '95-bicubic', '200-nearest', '200-bilinear', '50-box']) {
  const image = await codec.decodePng(new Uint8Array(await fs.readFile(new URL(name + '.png', folder))));
  const started = Date.now();
  const decoded = await codec.decode(image.pixels, image.width, image.height, '');
  const passed = decoded.status === 'success' && codec.payloadsEqual(decoded, content);
  const item = { name, passed, status: decoded.status, milliseconds: Date.now() - started, scaleX: decoded.scaleX, scaleY: decoded.scaleY };
  results.push(item); console.log(JSON.stringify(item));
}
const legacy = await codec.decodePng(new Uint8Array(await fs.readFile('tests/fixtures/public-v1.png')));
const legacyText = await fs.readFile('tests/fixtures/public-v1.txt', 'utf8');
const legacyRead = await codec.decode(legacy.pixels, legacy.width, legacy.height, '');
results.push({ name: 'existing-v1-fixture', passed: legacyRead.status === 'success' && legacyRead.text === legacyText });
codec.setCarrierVersion(1);
const rollback = await codec.encodePayload(pixels, width, height, content, '');
results.push({ name: 'v1-writer-rollback', passed: rollback.carrierVersion === 1 && codec.payloadsEqual(await codec.decode(rollback.pixels, width, height, ''), content) });
codec.setCarrierVersion(3);
const locked = await codec.encodePayload(pixels, width, height, content, 'public research password');
const lockedInspect = await codec.inspect(locked.pixels, width, height);
results.push({ name: 'v3-password', passed: lockedInspect.found && lockedInspect.passwordProtected && (await codec.decode(locked.pixels, width, height, '')).status === 'password' && codec.payloadsEqual(await codec.decode(locked.pixels, width, height, 'public research password'), content) });
console.log('Artifacts: ' + fileURLToPath(folder));
await fs.writeFile(new URL('results.json', folder), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.slice(-3)));
if (results.some((result) => !result.passed)) process.exitCode = 1;

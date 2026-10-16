// Optional A/B research on local captures. Never print or export payload contents.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const inputs = process.argv.slice(2);
assert(inputs.length, 'Supply local capture images.');
const { chromium } = await import(process.env.PIXELSTOW_PLAYWRIGHT ? pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href : 'playwright');
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file))) throw Error('Outside workspace');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const report = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIXELSTOW_CHROME ? { executablePath: process.env.PIXELSTOW_CHROME } : {}) });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
  for (let index = 0; index < inputs.length; index++) {
    const bytes = (await fs.readFile(inputs[index])).toString('base64');
    const rows = await page.evaluate(async bytes => {
      const image = await PixelStow.readImageFile(new File([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], 'capture.png'));
      const rows = [];
      for (const earlyPayload of [false, true]) {
        const pixels = image.pixels.slice(), started = performance.now();
        const scan = await PixelStow.scanMarkers(pixels, image.width, image.height,
          { earlyPayload, deadline: Date.now() + 60000 });
        const scanned = performance.now();
        const result = await PixelStow.readMarkerCandidates(pixels, image.width, image.height, scan, { earlyPayload, resumeDiscovery: true });
        rows.push({ enabled: earlyPayload, success: Boolean(result.found && !result.unreadable),
          scanMs: Math.round(scanned - started), totalMs: Math.round(performance.now() - started),
          early: Boolean(result.earlyPayload), fallback: Boolean(result.earlyPayloadFallback),
          headers: result.geometry?.headerCount, markers: result.markers?.length });
      }
      return rows;
    }, bytes);
    assert(!rows[0].success || rows[1].success, 'Experiment must preserve baseline recovery');
    report.push({ input: index + 1, rows });
    console.log(JSON.stringify(report.at(-1)));
  }
  await fs.mkdir(path.join(root, 'artifacts/early-payload-baseline-20261016'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts/early-payload-baseline-20261016/photo-comparison.json'), JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

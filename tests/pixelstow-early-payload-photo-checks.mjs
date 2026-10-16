// Optional A/B research on local captures. Never print or export payload contents.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const live = process.argv.includes('--live');
const cpu = Number(process.argv.find(value => value.startsWith('--cpu='))?.slice(6) || 1);
const inputs = process.argv.slice(2).filter(value => value !== '--live' && !value.startsWith('--cpu='));
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
  if (cpu > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }
  await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
  for (let index = 0; index < inputs.length; index++) {
    const bytes = (await fs.readFile(inputs[index])).toString('base64');
    const rows = await page.evaluate(async ({bytes, live}) => {
      const image = await PixelStow.readImageFile(new File([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], 'capture.png'));
      const rows = [];
      for (const variant of live ? ['live', 'unguided-24s', 'full'] : [false, true]) {
        const earlyPayload = live ? false : variant;
        const pixels = image.pixels.slice(), started = performance.now();
        const guide = live && variant === 'live' ? await PixelStow.scanEdgeGuide(pixels, image.width, image.height,
          { maxMilliseconds: 3000, minimumCoverage: .5 }) : false;
        const budget = !live || variant === 'full' ? 60000 : variant === 'live' ? 8000 : 24000;
        const scan = await PixelStow.scanMarkers(pixels, image.width, image.height,
          { earlyPayload, scaleGuide: live && variant !== 'full' ? guide || false : undefined,
            calibratedOnly: Boolean(guide), deadline: Date.now() + budget });
        const scanned = performance.now();
        const result = await PixelStow.readMarkerCandidates(pixels, image.width, image.height, scan,
          { earlyPayload, resumeDiscovery: !guide, calibratedOnly: Boolean(guide) });
        rows.push({ ...(live ? { variant, guide: Boolean(guide), candidates: scan.candidates.length } : { enabled: earlyPayload }), success: Boolean(result.found && !result.unreadable),
          scanMs: Math.round(scanned - started), totalMs: Math.round(performance.now() - started),
          early: Boolean(result.earlyPayload), fallback: Boolean(result.earlyPayloadFallback),
          headers: result.geometry?.headerCount, markers: result.markers?.length,
          highConfidence: Boolean(scan.highConfidence), reason: scan.reason });
      }
      if (live) {
        // Exercise the actual camera queue and automatic payload handoff with
        // real codec workers; only the video/DOM presentation is substituted.
        const started = performance.now();
        const row = await new Promise((resolve, reject) => {
          const session = { purpose: 'read', history: [], appraised: 0, fallbackAfter: 0 };
          const camera = Object.create(PixelStowCamera.prototype);
          const timer = setTimeout(() => { session.paused = true; camera.cancelSearches(session); reject(Error('Camera did not hand off the readable capture')); }, 65000);
          Object.assign(camera, { session, progress: { textContent: '' }, signature: { textContent: '' },
            readProgress: { begin() {}, update() {}, signature() {}, finish() {} },
            showBestFrame() {}, updateCalibrationLight() {},
            sync() { if (session.paused) { clearTimeout(timer); reject(Error(camera.progress.textContent)); } },
            accept: async (s, accepted, inspection) => {
              s.handingOff = true; clearTimeout(timer);
              resolve({ variant: 'camera-handoff', success: inspection.found && !inspection.unreadable,
                totalMs: Math.round(performance.now() - started), headers: inspection.geometry?.headerCount,
                markers: inspection.markers?.length });
            } });
          camera.enqueueFrame(session, { image: { ...image, pixels: image.pixels.slice() }, guideKind: 'edge',
            guideChecked: true, frameNumber: 1, capturedAt: Date.now() });
        });
        rows.push(row);
      }
      return rows;
    }, { bytes, live });
    if (!live) assert(!rows[0].success || rows[1].success, 'Experiment must preserve baseline recovery');
    if (live && rows[2].success) assert(rows[1].success, 'extended live fallback must recover this readable capture');
    report.push({ input: index + 1, cpu, rows });
    console.log(JSON.stringify(report.at(-1)));
  }
  await fs.mkdir(path.join(root, 'artifacts/early-payload-baseline-20261016'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts/early-payload-baseline-20261016/' + (live ? 'live-comparison-cpu' + cpu + '.json' : 'photo-comparison.json')), JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

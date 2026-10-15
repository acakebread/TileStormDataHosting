// Public synthetic pixels only. Pause inspection to check intermediate UI,
// cancellation and late worker events rather than timing a photographic search.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.PIXELSTOW_PLAYWRIGHT ? pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href : 'playwright');
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root)) throw Error('Outside test directory');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'],
    ...(process.env.PIXELSTOW_CHROME ? { executablePath: process.env.PIXELSTOW_CHROME } : {}) });
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
    await page.evaluate(async () => {
      const width = 480, height = 640, pixels = new Uint8Array(width * height * 4);
      for (let i = 0; i < pixels.length; i += 4) pixels.set([100, 120, 140, 255], i);
      window.publicRaw = { pixels, width, height, exact: true };
      const encoded = await PixelStow.encodePayload(pixels, width, height, { text: 'Public read-status fixture.', attachments: [] }, '');
      window.publicEncoded = { pixels: encoded.pixels, width, height, exact: true };
      const inspection = await PixelStow.inspect(encoded.pixels, width, height, { nativeOnly: true, worker: false });
      window.publicInspection = inspection;
      await useFile(new File([], 'previous-photo.png'), 'file', { image: publicEncoded, inspection });
      await current.carrierPromise;
      showReadPrognosis({ ...inspection, fits: true });
      window.realInspect = PixelStow.inspect;
      PixelStow.inspect = (_pixels, _width, _height, options) => new Promise((resolve, reject) => {
        window.pendingRead = { options, resolve };
        options.signal.addEventListener('abort', () => reject(new DOMException('Search cancelled.', 'AbortError')), { once: true });
      });
      window.nextImport = useFile(new File([], 'new-photo.png'), 'camera', { image: publicRaw });
    });
    await page.waitForFunction(() => pendingRead && busy);
    assert(await page.locator('#read-prognosis').isHidden());
    assert.equal(await page.locator('#prognosis-detail').textContent(), '');
    assert.equal(await page.locator('#image-repetition').textContent(), '');
    assert.equal(await page.locator('#loaded-image').textContent(), 'Camera photo');
    assert((await page.locator('#image-read-status').textContent()).includes('Reading'));
    const boxes = () => page.evaluate(() => ['loaded-image', 'image-read-status', 'capacity', 'preview'].map(id => {
      const box = document.getElementById(id).getBoundingClientRect();
      return { x: box.x, y: box.y + scrollY, width: box.width, height: box.height };
    }));
    const positions = await boxes();
    assert(positions[1].y >= positions[0].y + positions[0].height);
    assert(positions[2].y >= positions[1].y + positions[1].height);
    let previous = 0;
    for (const text of ['Checking the whole-image frequency signature…', 'Found 1/4 markers. Locating marker 2…',
      'Refining perspective alignment from 4 markers…', 'Reading ranked candidate 1/3 (4/4 aligned markers)…',
      'Refining the photographed pixel grid from its carrier pattern (1/3)…', 'Checking subpixel alignment of the tracked grid…']) {
      const result = await page.evaluate(text => {
        pendingRead.options.onProgress(text);
        return { value: imageReadProgress.value, stage: document.querySelector('#image-read-status').dataset.stage };
      }, text);
      assert(result.value > previous && result.value < 1); previous = result.value;
      assert.equal(await page.locator('#image-read-status').textContent(), text);
      assert.equal(await page.locator('#transform-status').textContent(), text);
      assert.deepEqual(await boxes(), positions, 'updates must not move the preview or caption');
    }
    await page.evaluate(() => pendingRead.options.onProgress('The marker fit did not decode. Checking the remaining scales of this capture…'));
    assert.equal(await page.locator('#image-read-status').getAttribute('data-stage'), 'retry');
    assert(await page.evaluate(() => imageReadProgress.value < .1));
    await page.evaluate(() => pendingRead.options.onProgress('Locating photo markers: ' + 'a long search description '.repeat(20)));
    assert.deepEqual(await boxes(), positions, 'even a long status stays on one line');
    await page.evaluate(async () => { pendingRead.resolve({ found: false, signature: { likely: true, message: 'Frequency hints only.' } }); await nextImport; });
    assert.equal(await page.locator('#image-read-status').getAttribute('data-stage'), 'failed');
    assert((await page.locator('#status').textContent()).includes('No readable fingerprint'));
    const terminal = await page.locator('#image-read-status').textContent();
    await page.evaluate(() => pendingRead.options.onProgress('Checking subpixel alignment of the tracked grid…'));
    assert.equal(await page.locator('#image-read-status').textContent(), terminal, 'completed worker callbacks cannot resurrect a promising stage');

    await page.evaluate(() => { window.nextImport = useFile(new File([], 'cancel-photo.png'), 'clipboard', { image: publicRaw }); });
    await page.waitForFunction(() => busy && transformAbort);
    await page.locator('#choose-image').click();
    await page.evaluate(() => nextImport);
    assert.equal(await page.locator('#image-read-status').getAttribute('data-stage'), 'cancelled');
    await page.evaluate(async () => {
      PixelStow.inspect = realInspect;
      await useFile(new File([], 'verified-photo.png'), 'file', { image: publicEncoded, inspection: publicInspection });
      await current.carrierPromise;
    });
    assert.equal(await page.locator('#image-read-status').getAttribute('data-stage'), 'success');
    assert.equal(await page.locator('#image-read-status').textContent(), 'Encoded contents verified.');
    assert((await page.locator('#status').textContent()).includes('public fingerprint'));
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px previous appraisal clears before inspection; live evidence stages advance and reset without layout movement; late/cancelled events cannot overwrite results; native decoding verifies`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

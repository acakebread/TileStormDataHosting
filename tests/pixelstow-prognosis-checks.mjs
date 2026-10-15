// Public synthetic images/payloads; no camera, microphone or sharing access.
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
  for (const width of [390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
    const load = (width, height, length) => page.evaluate(async ({ width, height, length }) => {
      const pixels = new Uint8Array(width * height * 4);
      for (let i = 0; i < pixels.length; i += 4) pixels.set([100, 120, 140, 255], i);
      const image = { pixels, width, height, exact: true };
      await useFile(new File([await PixelStow.writePng(pixels, width, height)], 'public-source.png', { type: 'image/png' }), 'file', { image, sourceOnly: true });
      let seed = 317;
      const bytes = Uint8Array.from({ length }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed & 255; });
      window.publicPayload = { text: 'Public prognosis fixture.', attachments: [{ name: 'public.bin', type: 'application/octet-stream', bytes }] };
      media.files = publicPayload.attachments; message.value = publicPayload.text; media.sync(); updateByteCounts();
    }, { width, height, length });
    const dimensions = () => page.evaluate(() => ({ width: sourcePlan.width, height: sourcePlan.height }));
    const repetition = () => page.evaluate(() => sourcePlan.repetitionRatio);
    const risk = () => page.locator('#prognosis-pointer').evaluate(node => parseFloat(node.style.left));
    await load(1280, 960, 1000);
    await page.locator('#scale-source').check();
    await page.waitForFunction(() => sourcePlan?.fits && frameBudget?.framedBytes > 1000);
    assert.deepEqual(await dimensions(), { width: 1280, height: 960 });
    const controlPositions = () => page.evaluate(() => ['encoding-quality', 'prognosis-target', 'encode'].map(id => document.getElementById(id).getBoundingClientRect().top + scrollY));
    const positions = await controlPositions();
    await page.locator('#encoding-quality').fill('0'); const durable = await risk();
    await page.locator('#encoding-quality').fill('1'); const gentle = await risk();
    assert(durable < gentle); assert.deepEqual(await dimensions(), { width: 1280, height: 960 });
    assert.deepEqual(await controlPositions(), positions, 'quality and status updates keep the controls steady');
    await page.locator('#prognosis-target').fill('0');
    const largest = await dimensions(), green = await risk(), greenRepetition = await repetition();
    assert(largest.width > 1280 && largest.height > 960);
    assert.equal(await page.locator('#encoding-quality').inputValue(), '1');
    assert(await page.evaluate(() => sourcePlan.fits && sourcePlan.width === sourcePlan.maximum.width));
    await page.locator('#prognosis-target').fill('1');
    const smallest = await dimensions();
    assert(smallest.width < 1280 && smallest.height < 960);
    assert(await risk() > green && await repetition() < greenRepetition, 'green means more real payload repetition');
    let previousRepetition = await repetition();
    for (let step = 9; step >= 0; step--) {
      const target = await page.evaluate(step => String(Number((prognosisBounds.min + (prognosisBounds.max - prognosisBounds.min) * step / 10).toFixed(3))), step);
      await page.locator('#prognosis-target').fill(target);
      const actual = await repetition();
      assert(actual >= previousRepetition, 'every leftward slider step must retain or increase redundancy');
      assert(await page.evaluate(() => sourcePlan.parityBits === 4));
      assert((await page.locator('#prognosis-detail').textContent()).startsWith(actual.toFixed(2) + '× redundancy.'));
      previousRepetition = actual;
    }
    const middle = await page.evaluate(() => String(Number(((prognosisBounds.min + prognosisBounds.max) / 2).toFixed(3))));
    await page.locator('#prognosis-target').fill(middle);
    const selected = await dimensions(), selectedRepetition = await repetition();
    assert(selected.width > smallest.width && selected.width < largest.width);
    await page.locator('#encoding-quality').fill('0'); const selectedDurable = await risk();
    await page.locator('#encoding-quality').fill('1');
    assert.deepEqual(await dimensions(), selected, 'quality cannot resize the selected carrier');
    assert.equal(await repetition(), selectedRepetition, 'quality changes strength, never the stored repeat count');
    assert(await risk() > selectedDurable);
    assert.deepEqual(await controlPositions(), positions);

    // Encode at the actual lower capacity bound with standard parity and verify
    // the unchanged payload and original, rather than only testing the estimate.
    await page.locator('#prognosis-target').fill('1');
    const encodedSize = await dimensions();
    await page.locator('#encode').click();
    await page.waitForFunction(() => !busy && encodedPng, {}, { timeout: 30000 });
    assert(await page.evaluate(async ({ width, height }) => {
      const png = await PixelStow.decodePng(new Uint8Array(await encodedPng.arrayBuffer()));
      const decoded = await PixelStow.decode(png.pixels, png.width, png.height, '', { nativeOnly: true });
      return png.width === width && png.height === height && decoded.parityBits === 4 &&
        decoded.repetitionRatio === sourcePlan.repetitionRatio && PixelStow.payloadsEqual(decoded, publicPayload) &&
        current.width === 1280 && current.height === 960 && current.pixels.every((value, index) => value === [100, 120, 140, 255][index % 4]);
    }, encodedSize));

    await load(320, 240, 5200);
    await page.waitForFunction(() => sourcePlan?.fits && frameBudget?.framedBytes > 5200);
    const required = await dimensions(); assert(required.width > 320 && required.height > 240);
    assert(await page.evaluate(() => sourcePlan.width === sourcePlan.minimum.width && sourcePlan.width < sourcePlan.maximum.width));
    await page.locator('#encoding-quality').fill('0'); await page.locator('#encoding-quality').fill('1');
    assert.deepEqual(await dimensions(), required, 'payload-driven enlargement does not depend on quality');
    assert(await page.locator('#prognosis-target').isEnabled(), 'more repetition remains selectable after the automatic minimum enlargement');
    await page.locator('#prognosis-target').fill('0');
    assert((await dimensions()).width > required.width);

    await page.locator('#scale-source').uncheck();
    await load(1280, 960, 1000);
    await page.waitForFunction(() => !sourcePlan && frameBudget?.framedBytes > 1000);
    await page.locator('#prognosis-target').fill('0'); const fixedDurable = Number(await page.locator('#encoding-quality').inputValue());
    await page.locator('#prognosis-target').fill('1');
    assert(Number(await page.locator('#encoding-quality').inputValue()) > fixedDurable);
    assert(await page.evaluate(() => !sourcePlan && current.width === 1280 && current.height === 960));
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px quality changes strength only; every leftward scale gesture adds repetition, parity stays stable, minimum fitting encoding verifies unchanged payload bytes`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

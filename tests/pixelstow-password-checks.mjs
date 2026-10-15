// Public generated image and test keys only; no camera, microphone or sharing.
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
    const importSource = () => page.evaluate(async () => {
      const pixels = new Uint8Array(640 * 480 * 4);
      for (let i = 0; i < pixels.length; i += 4) pixels.set([100, 120, 140, 255], i);
      const image = { pixels, width: 640, height: 480, exact: true };
      await useFile(new File([await PixelStow.writePng(pixels, 640, 480)], 'public-source.png', { type: 'image/png' }), 'file', { image, sourceOnly: true });
    });
    await importSource();
    await page.locator('#message').fill('Public password confirmation fixture.');
    await page.locator('#password').fill('Public initial test key');
    const height = await page.locator('#encoding-passwords').evaluate(node => node.getBoundingClientRect().height);
    await page.locator('#encode').click();
    assert.equal(await page.locator('#encoding-passwords').evaluate(node => node.getBoundingClientRect().height), height);
    assert.equal(await page.locator('#encoding-passwords input:visible').count(), 1);
    assert(await page.locator('#confirm').isVisible());
    assert.equal(await page.locator('#encoding-password-label').getAttribute('for'), 'confirm');
    assert(await page.locator('#confirm').evaluate(node => document.activeElement === node));
    assert(!(await page.evaluate(() => busy || Boolean(encodedPng))));

    await page.locator('#confirm').fill('Wrong public fixture key');
    await page.locator('#encode').click();
    assert(await page.locator('#confirm').evaluate(node => !node.checkValidity()));
    assert(!(await page.evaluate(() => Boolean(encodedPng))));
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    assert(await page.locator('#password').isVisible());
    assert.equal(await page.locator('#password').inputValue(), 'Public initial test key');
    assert.equal(await page.locator('#confirm').inputValue(), '');
    await page.locator('#password').fill('Changed public fixture key');
    await page.locator('#password').press('Enter');
    await page.locator('#confirm').fill('Changed public fixture key');
    assert(await page.locator('#confirm').evaluate(node => node.checkValidity()));
    await page.locator('#confirm').press('Enter');
    await page.waitForFunction(() => !busy && encodedPng, {}, { timeout: 30000 });
    assert(await page.evaluate(async () => {
      const png = await PixelStow.decodePng(new Uint8Array(await encodedPng.arrayBuffer()));
      const read = await PixelStow.decode(png.pixels, png.width, png.height, 'Changed public fixture key');
      return read.status === 'success' && read.text === 'Public password confirmation fixture.' && read.passwordProtected;
    }));
    assert(await page.locator('#password').isVisible());
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.equal(await page.locator('#confirm').inputValue(), '');
    assert(!(await page.locator('#change-encoding-password').isVisible()));

    // A fresh import clears even an unfinished confirmation. Public encoding
    // must still take one press, without a confirmation stage or a layout jump.
    await page.locator('#password').fill('Public discarded test key');
    await page.locator('#encode').click();
    await importSource();
    assert(await page.locator('#password').isVisible());
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.equal(await page.locator('#confirm').inputValue(), '');
    await page.locator('#message').fill('Public one-press fixture.');
    await page.waitForFunction(() => !document.querySelector('#read-prognosis').hidden);
    await page.locator('#encode').scrollIntoViewIfNeeded();
    const buttonTop = () => page.locator('#encode').evaluate(node => node.getBoundingClientRect().top);
    const before = await buttonTop();
    await page.locator('#encode').click();
    assert(await page.locator('#read-prognosis').isVisible());
    assert(Math.abs(await buttonTop() - before) < 2);
    await page.waitForFunction(() => !busy && encodedPng, {}, { timeout: 30000 });
    await page.evaluate(() => current.carrierPromise);
    assert(Math.abs(await buttonTop() - before) < 2);
    assert(await page.evaluate(async () => {
      const png = await PixelStow.decodePng(new Uint8Array(await encodedPng.arrayBuffer()));
      const read = await PixelStow.decode(png.pixels, png.width, png.height);
      return read.status === 'success' && read.text === 'Public one-press fixture.' && !read.passwordProtected;
    }));
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px one-slot confirmation stays fixed, rejects mismatch, supports Change/Enter, clears secrets on success/import and keeps public Encode in place`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

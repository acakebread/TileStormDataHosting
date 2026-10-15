// Public generated picture/audio only. Real browser touch gestures, no cameras.
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
const snapshots = path.join(root, 'artifacts', 'preview-checks');
await fs.mkdir(snapshots, { recursive: true });
let browser, fixture;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'],
    ...(process.env.PIXELSTOW_CHROME ? { executablePath: process.env.PIXELSTOW_CHROME } : {}) });
  for (const width of [390, 320, 1280]) {
    const mobile = width < 500;
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
    assert(await page.getByRole('button', { name: 'Preview', exact: true }).isDisabled());
    assert(await page.locator('#preview-audio').isDisabled());
    await page.evaluate(async () => {
      const width = 480, height = 640, pixels = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([60 + Math.round(x / 4), 100 + Math.round(y / 8), 150, 255], (x + y * width) * 4);
      const image = { pixels, width, height, exact: true };
      await useFile(new File([await PixelStow.writePng(pixels, width, height)], 'public-source.png', { type: 'image/png' }), 'file', { image, sourceOnly: true });
      window.sourceFixture = image;
    });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert(await page.evaluate(() => fullPreview.openNow && !fullPreview.clean));
    assert(await page.locator('#preview-audio').isDisabled());
    await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    if (!fixture) fixture = await page.evaluate(async () => {
      const rate = 8000, count = rate * 2, wav = new Uint8Array(44 + count * 2), view = new DataView(wav.buffer);
      const word = (at, text) => { for (let i = 0; i < text.length; i++) wav[at + i] = text.charCodeAt(i); };
      word(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); word(8, 'WAVEfmt '); view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, count * 2, true);
      for (let i = 0; i < count; i++) view.setInt16(44 + 2 * i, Math.round(10000 * Math.sin(2 * Math.PI * (i % 40) / 40)), true);
      const image = await PixelStow.encodePayload(sourceFixture.pixels, 480, 640,
        { text: 'Public preview controls.', attachments: [{ name: 'public-tone.wav', type: 'audio/wav', bytes: wav }] }, '');
      return Array.from(new Uint8Array(await (await PixelStow.writePng(image.pixels, 480, 640)).arrayBuffer()));
    });
    for (const origin of ['file', 'clipboard', 'camera']) {
      await page.evaluate(async ({ bytes, origin }) => {
        const data = new Uint8Array(bytes), image = await PixelStow.decodePng(data);
        const inspection = await PixelStow.inspect(image.pixels, image.width, image.height, { nativeOnly: true, worker: false });
        await useFile(new File([data], 'public-preview.png', { type: 'image/png' }), origin, { image, inspection });
        await current.carrierPromise;
        media.voiceAudio?.audio.pause();
      }, { bytes: fixture, origin });
      assert(!(await page.getByRole('button', { name: 'Preview', exact: true }).isDisabled()));
      assert(!(await page.evaluate(() => Boolean(encodedPng))), 'imported images have no newly generated PNG');
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      assert(await page.evaluate(() => fullPreview.openNow && !compareUi.hidden));
      await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    }
    await page.waitForFunction(() => document.querySelector('#preview-audio').parentElement.id === 'preview-bottom-row');
    const mainAudio = await page.locator('#preview-audio').boundingBox(), mainSlider = await page.locator('#comparison-control').boundingBox();
    assert(Math.abs(mainAudio.y + mainAudio.height / 2 - mainSlider.y - mainSlider.height / 2) < 1);
    assert(mainAudio.x + mainAudio.width <= width);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const controls = ['#preview-audio', '#preview-markers', '#preview-screen-fit', '#preview-screen-actual', '#preview-screen-hide', '#preview-screen-close'];
    const boxes = await Promise.all(controls.map(selector => page.locator(selector).boundingBox()));
    assert(boxes.every(box => box && Math.abs(box.y - boxes[0].y) < 1 && box.x >= 0 && box.x + box.width <= width), JSON.stringify(boxes));
    assert.equal((await page.locator('#preview-markers').textContent()).trim(), 'Analysis');
    assert(await page.locator('#preview-audio svg').isVisible());
    assert(!(await page.locator('.preview-audio-label').isVisible()));
    await page.getByRole('button', { name: 'Play audio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#preview-audio').getAttribute('aria-label') === 'Pause audio');
    assert(await page.locator('#preview-audio svg').isVisible(), 'playback status must preserve the icon');
    await page.getByRole('button', { name: 'Pause audio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#preview-audio').getAttribute('aria-label') === 'Play audio');
    assert(await page.locator('#preview-audio svg').isVisible());
    await page.screenshot({ path: path.join(snapshots, `controls-${width}.png`) });
    await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
    if (mobile) {
      const cdp = await page.context().newCDPSession(page);
      const send = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      const point = (id, x, y) => ({ id, x, y });
      const split = () => page.locator('#split').inputValue();
      // Put the handle completely offscreen, as happens when inspecting at zoom.
      await page.evaluate(() => { split.value = '980'; fitMode = false; viewScale = fittedScale(imagePixels(), viewBox()) * 2; originX = 0; originY = 0; applyView(); });
      assert(await page.locator('#split-handle').evaluate(node => node.getBoundingClientRect().left > innerWidth));
      let box = await page.locator('#viewport').boundingBox(), x = box.x + box.width * .25, y = box.y + box.height * .4;
      const before = await split();
      await send('touchStart', [point(1, x, y)]);
      assert.equal(await split(), before, 'touch down alone must not scrub');
      await page.waitForFunction(() => splitPointer !== null, {}, { timeout: 1500 });
      let last = Number(await split());
      for (let step = 1; step <= 4; step++) {
        await send('touchMove', [point(1, x + step * 30, y)]);
        await page.waitForFunction(previous => Number(document.querySelector('#split').value) > previous, last, { timeout: 1500 });
        last = Number(await split());
      }
      await send('touchEnd');
      assert(!(await page.locator('#preview-screen-footer').isVisible()), 'a completed long drag must not reveal controls');
      await page.touchscreen.tap(box.x + box.width * .85, y);
      assert(await page.locator('#preview-screen-footer').isVisible(), 'a short tap reveals controls');
      await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
      await page.evaluate(() => { split.value = '500'; resetView(); });
      box = await page.locator('#viewport').boundingBox(); y = box.y + box.height * .4;
      const baseline = await split(), scale = await page.evaluate(() => viewScale);
      await send('touchStart', [point(1, width * .25, y)]);
      await send('touchStart', [point(1, width * .25, y), point(2, width * .75, y)]);
      await send('touchMove', [point(1, width * .15, y), point(2, width * .85, y)]);
      await page.waitForTimeout(550); // A cancelled hold must not fire during a pinch.
      await send('touchEnd');
      assert.equal(await split(), baseline); assert(await page.evaluate(before => viewScale > before, scale));
      assert(!(await page.locator('#preview-screen-footer').isVisible()));
      // A moving first finger cancels the hold rather than grabbing mid-swipe.
      await send('touchStart', [point(1, width * .2, y)]);
      await send('touchMove', [point(1, width * .3, y + 25)]);
      await page.waitForTimeout(550); await send('touchEnd');
      assert.equal(await split(), baseline); assert(!(await page.locator('#preview-screen-footer').isVisible()));
      await send('touchStart', [point(1, width * .2, y)]); await send('touchCancel');
      await page.waitForTimeout(550); assert(await page.evaluate(() => splitPointer === null && splitHold === null));
      await page.touchscreen.tap(width * .8, y);
      assert(await page.locator('#preview-screen-footer').isVisible());
      await cdp.detach();
      console.log(`PASS: ${width}px one-row icons and audio labels; hidden-controls long press grabs an offscreen divider, tracks continuously and leaves short taps/pinch/swipes/cancellation intact`);
    } else {
      const box = await page.locator('#compare-ui').boundingBox(), y = box.y + box.height * .3;
      await page.mouse.move(box.x + box.width * .2, y); await page.mouse.down();
      await page.mouse.move(box.x + box.width * .8, y); await page.mouse.up();
      assert(Math.abs(Number(await page.locator('#split').inputValue()) - 800) <= 2);
      assert(!(await page.locator('#preview-screen-footer').isVisible()));
      await page.keyboard.press('Tab'); assert(await page.locator('#preview-screen-footer').isVisible());
      console.log('PASS: desktop mouse scrubbing and keyboard access survive the compact toolbar; raw/file/clipboard/camera images all open from Preview');
    }
    await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#preview-audio').parentElement.id === 'preview-bottom-row');
    assert(await page.locator('#preview-audio svg').isVisible());
    await page.evaluate(() => media.render(document.querySelector('#decoded-attachments'), [], 'decoded', false));
    assert(await page.locator('#preview-audio').isDisabled());
    // Generated output is also immediately available when source extraction
    // is still pending, as can happen on a phone with a large picture.
    await page.evaluate(async () => {
      const image = sourceFixture;
      await useFile(new File([await PixelStow.writePng(image.pixels, image.width, image.height)], 'public-next-source.png', { type: 'image/png' }), 'file', { image, sourceOnly: true });
      window.realExtraction = PixelStow.extractCarrier;
      PixelStow.extractCarrier = (...args) => new Promise((resolve, reject) => { window.finishExtraction = () => realExtraction(...args).then(resolve, reject); });
    });
    await page.locator('#message').fill('Public newly generated preview.');
    await page.locator('#encode').click();
    await page.waitForFunction(() => !busy && encodedPng && window.finishExtraction);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert(await page.evaluate(() => {
      const pixels = previewEncoded.getContext('2d').getImageData(0, 0, previewEncoded.width, previewEncoded.height).data;
      return !fullPreview.clean && pixels.length === current.recoverPixels.length && pixels.every((value, index) => value === current.recoverPixels[index]);
    }), 'Preview must show the current generated pixels before its comparison is ready');
    await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    await page.evaluate(async () => { PixelStow.extractCarrier = realExtraction; await finishExtraction(); await current.carrierPromise; });
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

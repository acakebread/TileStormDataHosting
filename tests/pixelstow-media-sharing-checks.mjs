// Public synthetic audio/images only. Native sharing and clipboard are captured
// by stubs: these checks never post, upload, or access a microphone/camera.
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
  await page.waitForFunction(() => media.compactAvailable);
  await page.evaluate(async () => {
    const pixels = new Uint8Array(1600 * 1200 * 4); for (let i = 0; i < pixels.length; i += 4) pixels.set([110, 135, 160, 255], i);
    const image = { pixels, width: 1600, height: 1200, exact: true };
    await useFile(new File([await PixelStow.writePng(pixels, 1600, 1200)], 'public-source.png', { type: 'image/png' }), 'file', { image, sourceOnly: true });
    const rate = 16000, length = rate * 3, bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
    const word = (at, text) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
    word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.round(10000 * Math.sin(2 * Math.PI * 220 * i / rate)), true);
    window.publicWav = bytes;
    await media.addFiles([new File([bytes], 'public-tone.wav', { type: 'audio/wav' })]);
    window.originalPreview = document.querySelector('#attachment-list audio');
    window.originalPreviewUrl = originalPreview.src;
  });
  async function playNative(index = 0) {
    const player = page.locator('#attachment-list audio').nth(index);
    await player.scrollIntoViewIfNeeded();
    const box = await player.boundingBox();
    await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
    await page.waitForFunction(index => {
      const audio = document.querySelectorAll('#attachment-list audio')[index];
      return !audio.paused && audio.currentTime > .05 && audio.currentSrc === audio.src;
    }, index, { timeout: 8000 });
  }
  await playNative();
  await page.evaluate(() => originalPreview.pause());
  await page.getByRole('button', { name: 'Make voice smaller', exact: true }).click();
  await page.waitForFunction(() => !media.active && media.files[0].type.includes('opus'));
  assert(await page.evaluate(() => document.querySelector('#attachment-list audio') === originalPreview &&
    originalPreview.src !== originalPreviewUrl && originalPreview.preload === 'auto' && media.files[0].bytes.length < publicWav.length));
  await playNative();
  assert(await page.evaluate(() => !originalPreview.error && originalPreview.currentSrc === originalPreview.src));
  console.log('PASS: real WAV → Opus conversion retains the same audio player, prepares the new source and starts playback on the first native-control tap');
  await page.evaluate(async () => {
    window.savedPreviewUrl = originalPreview.src;
    const compact = PixelStowVoice.compact;
    PixelStowVoice.compact = async file => ({ file, saved: 0 });
    try { await media.compactAttachment(0); } finally { PixelStowVoice.compact = compact; }
  });
  assert(await page.evaluate(() => originalPreview.src === savedPreviewUrl && !originalPreview.paused));
  // A second attachment has never played before conversion; its first tap must
  // also work, without replacing the first attachment's player.
  await page.evaluate(async () => {
    originalPreview.pause();
    await media.addFiles([new File([publicWav], 'second-tone.wav', { type: 'audio/wav' })]);
    window.secondPreview = document.querySelectorAll('#attachment-list audio')[1];
    await media.compactAttachment(1);
  });
  assert(await page.evaluate(() => document.querySelectorAll('#attachment-list audio')[0] === originalPreview &&
    document.querySelectorAll('#attachment-list audio')[1] === secondPreview && media.files[1].type.includes('opus')));
  await playNative(1);
  console.log('PASS: no-saving conversion leaves playback intact; separate attachment players survive rerendering and a never-played converted clip starts on its first tap');
  await page.evaluate(() => secondPreview.pause());
  await page.locator('#message').fill('Public photo share check.');
  await page.locator('#encode').click();
  await page.waitForFunction(() => !busy && Boolean(encodedPng), {}, { timeout: 30000 });
  await page.evaluate(() => {
    window.sharedPhotos = []; window.copiedCaptions = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => data.files?.length === 1 && data.files[0].type === 'image/png' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { sharedPhotos.push(data); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copiedCaptions.push(text); } } });
    sharing.sync();
  });
  await page.locator('#post-facebook').click();
  await page.locator('#share-facebook-photo').click();
  await page.waitForFunction(() => sharedPhotos.length === 1 && !busy);
  const shared = await page.evaluate(async () => {
    const data = sharedPhotos[0], bytes = new Uint8Array(await data.files[0].arrayBuffer()), expected = new Uint8Array(await encodedPng.arrayBuffer());
    const image = await PixelStow.decodePng(bytes);
    const decoded = await PixelStow.decode(image.pixels, image.width, image.height, '', { nativeOnly: true });
    return { keys: Object.keys(data), filename: data.files[0].name, type: data.files[0].type,
      exact: bytes.length === expected.length && bytes.every((value, i) => value === expected[i]),
      text: decoded.text, attachments: decoded.attachments.length };
  });
  assert.deepEqual(shared.keys, ['files']); assert(shared.exact);
  assert.equal(shared.type, 'image/png'); assert.match(shared.filename, /pixelstow\.png$/);
  assert.equal(shared.text, 'Public photo share check.'); assert.equal(shared.attachments, 2);
  await page.locator('#copy-facebook-message').click();
  await page.waitForFunction(() => copiedCaptions.length === 1);
  assert.match(await page.evaluate(() => copiedCaptions[0]), /pixelstow\.html#open-card/);
  console.log('PASS: Facebook receives only the exact verified encoded PNG, with no shared title/text/URL; its opening instructions are copied separately');
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true,
    value: async () => { throw new DOMException('Synthetic cancellation', 'AbortError'); } }); });
  await page.locator('#share-facebook-photo').click();
  await page.waitForFunction(() => !busy && document.querySelector('#facebook-status').textContent.includes('cancelled'));
  await page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }); sharing.sync(); sharing.showFacebook(); });
  assert(!(await page.locator('#share-facebook-photo').isVisible()));
  assert(await page.locator('#download-facebook-photo').isVisible());
  console.log('PASS: sharing cancellation retains the photo; unsupported native sharing offers the download-and-attach route');
  await page.evaluate(() => { media.reset(); });
  assert(await page.evaluate(() => media.composePlayers.size === 0 && !originalPreview.hasAttribute('src') && !secondPreview.hasAttribute('src')));
  console.log('PASS: clearing the image removes audio sources and retained composition players');
  await page.evaluate(async () => {
    const pixels = new Uint8Array(640 * 480 * 4); for (let i = 0; i < pixels.length; i += 4) pixels.set([110, 135, 160, 255], i);
    await useFile(new File([await PixelStow.writePng(pixels, 640, 480)], 'public-many-file-source.png', { type: 'image/png' }),
      'file', { image: { pixels, width: 640, height: 480, exact: true }, sourceOnly: true });
    window.manyPublicFiles = Array.from({ length: 12 }, (_, i) => new File(['Public attachment ' + i], 'part-' + i + '.txt', { type: 'text/plain' }));
    await media.addFiles(manyPublicFiles.slice(0, 8));
  });
  assert(!(await page.locator('#attachment-file').isDisabled()));
  assert(!(await page.locator('#record-audio').isDisabled()));
  await page.evaluate(async () => { await media.addFiles(manyPublicFiles.slice(8)); });
  assert.equal(await page.locator('#attachment-list .attachment-row').count(), 12);
  await page.locator('#encode').click();
  await page.waitForFunction(() => !busy && encodedPng && current?.decodedAttachments?.length === 12);
  await page.evaluate(async () => {
    const saved = new File([encodedPng], 'public-twelve-attachments.png', { type: 'image/png' });
    await useFile(saved, 'file');
  });
  assert(await page.evaluate(() => current.carrierVersion === 5 && current.decodedAttachments.length === 12 &&
    current.decodedAttachments.every((file, i) => file.name === 'part-' + i + '.txt' && new TextDecoder().decode(file.bytes) === 'Public attachment ' + i)));
  assert.equal(await page.locator('#decoded-attachments .attachment-row').count(), 12);
  assert.deepEqual(errors, []);
  console.log('PASS: the eighth attachment leaves file/voice controls enabled; twelve selected files encode, verify and reimport intact through the V5 UI');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}

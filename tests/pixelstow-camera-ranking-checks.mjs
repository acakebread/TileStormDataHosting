// Rank named synthetic devices, but open actual Chrome fake video streams.
// No hardware camera, microphone, photo import or external service is accessed.
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
  browser = await chromium.launch({ headless: true,
    ...(process.env.PIXELSTOW_CHROME ? { executablePath: process.env.PIXELSTOW_CHROME } : {}),
    args: ['--disable-gpu', '--use-fake-device-for-media-stream=device-count=3', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 900 } });
  const errors = [];
  const setup = async () => {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
    await page.evaluate(async () => {
      window.fakeIds = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput').map(device => device.deviceId);
      window.cameraEvents = []; window.cameraRequests = []; window.deniedIds = [];
      window.namedDevices = [
        { kind: 'videoinput', deviceId: fakeIds[0], label: 'OBS Virtual Camera', getCapabilities: () => ({ width: { max: 3840 }, height: { max: 2160 } }) },
        { kind: 'videoinput', deviceId: fakeIds[1], label: 'Display iSight', getCapabilities: () => ({ width: { max: 640 }, height: { max: 480 } }) },
        { kind: 'videoinput', deviceId: fakeIds[2], label: 'Microsoft LifeCam HD', getCapabilities: () => ({ width: { max: 1920 }, height: { max: 1080 }, focusMode: ['continuous'] }) }
      ];
      navigator.mediaDevices.enumerateDevices = async () => { cameraEvents.push('enumerate'); return namedDevices; };
      window.acquireFakeVideo = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = constraints => {
        cameraEvents.push('acquire'); cameraRequests.push(constraints);
        if (deniedIds.includes(constraints.video.deviceId?.exact)) throw new DOMException('Synthetic unavailable camera', 'NotReadableError');
        return acquireFakeVideo(constraints);
      };
      PixelStow.scanMarkers = async () => ({ found: false, markers: [], candidates: [] });
      camera.preferredDeviceId = fakeIds[0];
    });
    return page;
  };
  const ready = page => page.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  const selected = page => page.evaluate(() => fakeIds.indexOf(camera.session.deviceId));
  const page = await setup();
  await page.locator('#open-camera').click(); await ready(page);
  assert.equal(await selected(page), 2);
  assert.deepEqual(await page.evaluate(() => camera.devices.map(device => fakeIds.indexOf(device.deviceId))), [2, 1, 0]);
  assert(await page.evaluate(() => cameraEvents[0] === 'enumerate' && cameraRequests.length === 1 && cameraRequests[0].video.deviceId.exact === fakeIds[2] && cameraRequests[0].audio === false));
  const discoveryCalls = await page.evaluate(() => cameraEvents.filter(event => event === 'enumerate').length);
  for (const expected of [1, 0, 2]) {
    await page.locator('#switch-camera').click(); await ready(page);
    assert.equal(await selected(page), expected);
    assert.deepEqual(await page.evaluate(() => camera.devices.map(device => fakeIds.indexOf(device.deviceId))), [2, 1, 0], 'learning about a stream must not shuffle the cycle');
  }
  await page.locator('#switch-camera').click(); await ready(page); assert.equal(await selected(page), 1);
  await page.locator('#close-camera').click();
  await page.locator('#open-camera').click(); await ready(page); assert.equal(await selected(page), 2);
  assert.equal(await page.evaluate(() => cameraEvents.filter(event => event === 'enumerate').length), discoveryCalls, 'cycling and reopening must reuse the page-session discovery');
  console.log('PASS: discovery opens physical HD ahead of remembered/default OBS and VGA; cycling and reopening reuse the ranked cache without enumeration');
  await page.locator('#close-camera').click();
  await page.evaluate(() => { deniedIds = [fakeIds[2]]; cameraRequests.length = 0; });
  await page.locator('#open-camera').click(); await ready(page); assert.equal(await selected(page), 1);
  assert.deepEqual(await page.evaluate(() => cameraRequests.map(request => fakeIds.indexOf(request.video.deviceId.exact))), [2, 2, 2, 1]);
  await page.locator('#close-camera').click();
  await page.evaluate(() => { cameraRequests.length = 0; });
  await page.locator('#open-camera').click(); await ready(page); assert.equal(await selected(page), 1);
  assert.equal(await page.evaluate(() => cameraRequests.length), 1, 'a known startup failure is ranked below working alternatives on a fresh open');
  await page.locator('#close-camera').click();
  await page.evaluate(async () => {
    deniedIds = [];
    const restored = namedDevices.pop(); await camera.devicesChanged();
    namedDevices.push(restored); await camera.devicesChanged();
  });
  await page.locator('#open-camera').click(); await ready(page); assert.equal(await selected(page), 2);
  console.log('PASS: an unavailable best camera falls through automatically; failures lower its next startup rank and a device change makes it eligible again');
  await page.close();

  for (const partial of [false, true]) {
    const permission = await setup();
    await permission.evaluate(partial => {
    window.namesExposed = false; window.bootstrapTracks = [];
    navigator.mediaDevices.enumerateDevices = async () => {
      cameraEvents.push('enumerate'); return namesExposed ? namedDevices : partial ? [namedDevices[0]] : [{ kind: 'videoinput', deviceId: '', label: '' }];
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      cameraEvents.push('acquire'); cameraRequests.push(constraints);
      const stream = await acquireFakeVideo(constraints);
      if (!namesExposed) { bootstrapTracks = stream.getTracks(); namesExposed = true; }
      return stream;
    };
    }, partial);
    await permission.locator('#open-camera').click(); await ready(permission);
    assert.equal(await selected(permission), 2);
    assert(await permission.evaluate(partial => cameraRequests.length === 2 &&
      (partial ? cameraRequests[0].video.deviceId.exact === fakeIds[0] : !cameraRequests[0].video.deviceId) &&
      cameraRequests[1].video.deviceId.exact === fakeIds[2] && bootstrapTracks.every(track => track.readyState === 'ended'), partial));
    const discovered = await permission.evaluate(() => ({ enumerations: cameraEvents.filter(event => event === 'enumerate').length, acquisitions: cameraRequests.length }));
    await permission.locator('#close-camera').click();
    await permission.evaluate(async () => {
      // Some browsers hide names again when the last live stream is stopped.
      namesExposed = false;
      await camera.devicesChanged();
    });
    const beforeReopen = await permission.evaluate(() => cameraEvents.filter(event => event === 'enumerate').length);
    await permission.locator('#open-camera').click(); await ready(permission);
    assert.equal(await selected(permission), 2);
    assert(await permission.evaluate(({ enumerations, acquisitions }) => cameraEvents.filter(event => event === 'enumerate').length === enumerations &&
      cameraRequests.length === acquisitions + 1 && cameraRequests.at(-1).video.deviceId.exact === fakeIds[2], { enumerations: beforeReopen, acquisitions: discovered.acquisitions }));
    console.log(`PASS: ${partial ? 'partially exposed' : 'permission-hidden'} cameras are re-enumerated; the temporary stream is stopped and replaced before capture becomes ready`);
    await permission.close();
  }

  const cancelled = await setup();
  await cancelled.evaluate(() => { navigator.mediaDevices.enumerateDevices = () => new Promise(resolve => { window.finishEnumeration = () => resolve(namedDevices); }); });
  await cancelled.locator('#open-camera').click();
  await cancelled.waitForFunction(() => Boolean(window.finishEnumeration));
  await cancelled.locator('#close-camera').click();
  await cancelled.evaluate(async () => { finishEnumeration(); await new Promise(resolve => setTimeout(resolve, 30)); });
  assert(await cancelled.evaluate(() => !camera.active && !camera.panel.open && cameraRequests.length === 0));
  console.log('PASS: closing during pre-enumeration cannot open a late camera stream');
  await cancelled.close();

  const phone = await setup();
  await phone.evaluate(() => {
    camera.nativePhotoCapture = true;
    namedDevices[0] = { kind: 'videoinput', deviceId: fakeIds[0], label: 'Camera Back Dual Wide', getCapabilities: () => ({ facingMode: ['environment'], width: { max: 4032 }, height: { max: 3024 } }) };
    namedDevices[1] = { kind: 'videoinput', deviceId: fakeIds[1], label: 'Camera Front', getCapabilities: () => ({ facingMode: ['user'], width: { max: 1920 }, height: { max: 1080 } }) };
    namedDevices[2] = { kind: 'videoinput', deviceId: fakeIds[2], label: 'Camera Back Wide', getCapabilities: () => ({ facingMode: ['environment'], width: { max: 1920 }, height: { max: 1080 } }) };
    delete namedDevices[2].getCapabilities; // Safari need not expose per-device capabilities.
  });
  await phone.locator('#camera-source').click(); await ready(phone);
  assert.equal(await selected(phone), 2);
  assert.deepEqual(await phone.evaluate(() => camera.devices.map(device => fakeIds.indexOf(device.deviceId))), [2, 1, 0]);
  assert.equal(await phone.evaluate(() => camera.session.purpose), 'source');
  await phone.locator('#switch-camera').click(); await ready(phone); assert.equal(await selected(phone), 1);
  console.log('PASS: standard rear lens outranks front and Dual Wide despite the latter advertising more pixels; source mode and manual cycling remain available');
  await phone.close();
  assert.deepEqual(errors, []);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

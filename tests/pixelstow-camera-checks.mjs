// Browser camera acquisition and touch controls: synthetic cameras, never hardware.
// npm-installed Playwright is the default; a bundled module path can be supplied.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const playwright = process.env.PIXELSTOW_PLAYWRIGHT;
const { chromium } = await import(playwright ? pathToFileURL(playwright).href : 'playwright');
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root)) throw Error('Outside test directory');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/pixelstow.html';
const screenshots = path.join(root, 'artifacts', 'camera-checks');
await fs.mkdir(screenshots, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PIXELSTOW_CHROME ? { executablePath: process.env.PIXELSTOW_CHROME } : {}),
    args: ['--disable-gpu', '--use-fake-device-for-media-stream=device-count=3', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let filePickers = 0;
  page.on('filechooser', () => filePickers++);
  await page.goto(url);
  await page.evaluate(() => {
    window.cameraRequests = []; window.markerCalls = 0; window.importedCaptures = [];
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => {
      cameraRequests.push(constraints);
      if (window.unavailableDeviceId && constraints.video.deviceId?.exact === window.unavailableDeviceId)
        throw new DOMException('Synthetic inactive OBS camera', 'NotReadableError');
      return acquire(constraints);
    };
    // The tests cover acquisition and import routing, not optical recovery.
    PixelStow.scanMarkers = async () => { markerCalls++; return { found: false, markers: [], candidates: [] }; };
    PixelStow.inspect = async () => ({ found: false });
    const importImage = camera.importImage;
    camera.importImage = (file, origin, captured) => { importedCaptures.push({ file, origin, captured }); return importImage(file, origin, captured); };
  });
  const ready = () => page.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  assert.deepEqual(await page.locator('.image-actions > button').allTextContents().then(labels => labels.map(text => text.trim())), ['Browse', 'Paste', 'Decode', 'Create', '']);
  assert(await page.locator('#full-preview').isDisabled());
  await page.evaluate(() => {
    window.clipboardReads = 0;
    navigator.clipboard.read = async () => { clipboardReads++; throw new DOMException('Synthetic empty clipboard', 'NotAllowedError'); };
  });
  // The Image heading used to be a full-width file label. Gaps and headings
  // must be inert; explicit Browse/Paste and actual keyboard paste still work.
  const label = await page.locator('.image-label').boundingBox();
  await page.mouse.click(label.x + label.width - 4, label.y + label.height / 2);
  const browse = await page.locator('#choose-image').boundingBox(), paste = await page.locator('#paste-image').boundingBox();
  await page.mouse.click((browse.x + browse.width + paste.x) / 2, browse.y + browse.height / 2);
  assert.equal(filePickers, 0); assert.equal(await page.evaluate(() => clipboardReads), 0);
  assert(!(await page.locator('#paste-dialog').isVisible()));
  const browsePicker = page.waitForEvent('filechooser');
  await page.locator('#choose-image').click(); await (await browsePicker).setFiles([]);
  assert.equal(filePickers, 1); filePickers = 0;
  await page.locator('#paste-image').click(); assert(await page.locator('#paste-dialog').isVisible());
  await page.locator('#paste-close').click(); assert.equal(await page.evaluate(() => clipboardReads), 1);
  console.log('PASS: compact actions open Browse and Paste explicitly; blank row space and the Image heading do nothing');

  const stableFeedback = async target => {
    const result = await target.evaluate(() => {
      const progress = camera.progress.textContent, signature = camera.signature.textContent, hidden = camera.nearMiss.hidden;
      const live = { text: camera.readProgress.element.textContent, stage: camera.readProgress.element.dataset.stage, value: camera.readProgress.value };
      const boxes = () => ['#camera-view', '#camera-video', '#capture-frame', '#switch-camera'].map(selector => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height };
      });
      camera.progress.textContent = ''; camera.signature.textContent = ''; camera.nearMiss.hidden = true;
      const empty = boxes();
      camera.progress.textContent = 'Hold steady.'; camera.readProgress.begin('Checking markers…'); const short = boxes();
      camera.progress.textContent = 'Recovery markers were found, but the payload did not pass its checks. '.repeat(20);
      camera.signature.textContent = 'Eight markers, partial geometry, waiting for a sharper frame. '.repeat(12);
      camera.nearMiss.hidden = false;
      camera.readProgress.update('Checking subpixel alignment of the tracked grid… ' + 'long live description '.repeat(20));
      const long = boxes(), feedback = document.querySelector('.camera-feedback');
      const scrollable = feedback.scrollHeight > feedback.clientHeight;
      camera.progress.textContent = progress; camera.signature.textContent = signature; camera.nearMiss.hidden = hidden;
      camera.readProgress.show(live.text, live.stage, live.value);
      return { empty, short, long, scrollable };
    });
    assert.deepEqual(result.empty, result.short); assert.deepEqual(result.empty, result.long); assert(result.scrollable);
  };
  await page.locator('#open-camera').click(); await ready();
  const first = await page.evaluate(() => {
    window.firstTracks = camera.session.stream.getTracks();
    return { device: camera.session.deviceId, manual: camera.session.manualCapture, paused: camera.session.paused,
      count: camera.devices.length, facing: camera.session.facing };
  });
  assert.equal(first.count, 3, 'Chrome must expose three synthetic cameras');
  await page.evaluate(async () => {
    window.unavailableDeviceId = camera.devices.at(-1).deviceId;
    const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => (await enumerate()).map(device =>
      device.deviceId === unavailableDeviceId ? { kind: 'videoinput', deviceId: device.deviceId, label: 'OBS Virtual Camera' } : device);
    await camera.refreshDevices(false, true); // Update the fixture's newly assigned label once.
  });
  assert(!first.manual && !first.paused); assert.equal(filePickers, 0);
  assert(!(await page.locator('#camera-take-photo').isVisible()));
  assert(await page.locator('#pause-camera').isVisible());
  await stableFeedback(page);
  await page.screenshot({ path: path.join(screenshots, 'desktop-scanner.png') });
  await page.locator('#pause-camera').click();
  assert.equal(await page.locator('.camera-mode-warning').count(), 0);
  await page.evaluate(() => { camera.session.deviceLabel = 'Camera Back Dual Wide'; camera.sync(); });
  assert.match(await page.locator('.camera-mode-warning').textContent(), /distorted.*standard rear camera/);
  assert(!(await page.locator('#capture-frame').isDisabled()));
  await page.evaluate(() => { camera.session.scanAfter = 0; camera.scan(camera.session); });
  assert.equal(await page.evaluate(() => markerCalls), 0);
  await page.locator('#switch-camera').click(); await ready();
  assert.equal(await page.locator('.camera-mode-warning').count(), 0, 'Changing to a normal camera clears the advisory');
  const second = await page.evaluate(() => ({ device: camera.session.deviceId, request: cameraRequests.at(-1),
    stopped: firstTracks.every(track => track.readyState === 'ended'), manual: camera.session.manualCapture,
    label: camera.session.stream.getVideoTracks()[0].label }));
  assert.notEqual(second.device, first.device);
  assert.equal(second.request.video.deviceId.exact, second.device);
  assert(!second.request.video.facingMode); assert.equal(second.request.audio, false);
  assert(second.stopped && !second.manual);
  assert((await page.locator('#camera-help').textContent()).includes(second.label));
  await page.locator('#close-camera').click();
  await page.locator('#open-camera').click(); await ready();
  assert.equal(await page.evaluate(() => camera.session.deviceId), first.device, 'a fresh Capture ranks cameras instead of retaining the last selection');
  await page.locator('#camera-view').click();
  await page.waitForFunction(() => !camera.active && current && !busy);
  const photo = await page.evaluate(async () => {
    const { file, origin, captured } = importedCaptures.at(-1), png = await PixelStow.decodePng(new Uint8Array(await file.arrayBuffer()));
    return { origin, sourceOnly: captured.sourceOnly, sameBuffer: current.pixels === captured.image.pixels,
      width: png.width, height: png.height, bytesEqual: png.pixels.every((value, i) => value === captured.image.pixels[i]) };
  });
  assert.equal(photo.origin, 'camera'); assert.equal(photo.sourceOnly, false);
  assert(photo.sameBuffer && photo.bytesEqual && photo.width > 0 && photo.height > 0);
  assert.equal(await page.evaluate(() => importedCaptures.length), 1, 'One preview tap imports only one frame');
  assert.equal(filePickers, 0);
  console.log('PASS: fresh Capture selects the ranked camera rather than the last selection; exact device cycling stops old tracks and captured PNG preserves the video raster');

  await page.locator('#camera-source').click(); await ready();
  await page.locator('#switch-camera').click(); await ready();
  await page.locator('#switch-camera').click(); await ready();
  assert.equal(await page.evaluate(() => camera.session.purpose), 'source');
  assert(await page.evaluate(() => camera.failedDevices.has(unavailableDeviceId) && camera.session.deviceId === firstTracks[0].getSettings().deviceId));
  assert.match(await page.locator('#camera-progress').textContent(), /Skipped unavailable cameras: OBS Virtual Camera/);
  const failedRequests = await page.evaluate(() => cameraRequests.filter(request => request.video.deviceId?.exact === unavailableDeviceId).length);
  assert.equal(failedRequests, 3);
  await page.locator('#switch-camera').click(); await ready();
  await page.locator('#switch-camera').click(); await ready();
  assert.equal(await page.evaluate(() => cameraRequests.filter(request => request.video.deviceId?.exact === unavailableDeviceId).length), failedRequests);
  assert(await page.evaluate(() => camera.preferredDeviceId === camera.session.deviceId));
  await page.locator('#capture-frame').click(); await page.waitForFunction(() => !camera.active && !busy);
  assert(await page.evaluate(() => importedCaptures.at(-1).captured.sourceOnly));
  assert(await page.locator('#scale-source').isChecked());
  assert.equal(await page.evaluate(() => markerCalls), 0);
  console.log('PASS: A → B → inactive OBS → A continues automatically; later switches skip the failed camera and preserve source mode, last working selection and source sizing');

  // A temporarily missing top-ranked device falls back on the next ranked ID.
  await page.evaluate(() => {
    const acquire = navigator.mediaDevices.getUserMedia;
    let fail = true;
    navigator.mediaDevices.getUserMedia = constraints => {
      if (fail && constraints.video.deviceId) { fail = false; window.missingStartupDevice = constraints.video.deviceId.exact; cameraRequests.push(constraints); throw new DOMException('Test missing camera', 'NotFoundError'); }
      return acquire(constraints);
    };
  });
  await page.locator('#open-camera').click(); await ready();
  assert(await page.evaluate(() => cameraRequests.at(-1).video.deviceId.exact !== missingStartupDevice && camera.failedDevices.has(missingStartupDevice)));
  // Exhausting every candidate, including the previous camera, stops once.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async constraints => {
      cameraRequests.push(constraints); throw new DOMException('Test unavailable camera', 'OverconstrainedError');
    };
  });
  await page.locator('#switch-camera').click();
  await page.waitForFunction(() => !camera.active && document.querySelector('#status').textContent.includes('selected camera'));
  assert.equal(filePickers, 0);
  console.log('PASS: unavailable top-ranked camera falls through to the next ranked device; exhausting remaining cameras reports a bounded failure');

  const compatibility = await context.newPage(); compatibility.on('pageerror', error => errors.push(error.message));
  await compatibility.goto(url);
  await compatibility.evaluate(() => {
    window.compatibilityRequests = [];
    window.realAcquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    PixelStow.scanMarkers = async () => ({ found: false, markers: [], candidates: [] });
  });
  await compatibility.locator('#open-camera').click();
  await compatibility.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  // Some drivers reject the advertised high-resolution format, but permit the
  // same exact device at its native default. Exercise that path on real video.
  await compatibility.evaluate(() => {
    window.compatibilityTarget = camera.devices.find(device => device.deviceId !== camera.session.deviceId).deviceId;
    navigator.mediaDevices.getUserMedia = constraints => {
      compatibilityRequests.push(constraints);
      if (constraints.video.width) throw new DOMException('Synthetic high-resolution startup failure', 'NotReadableError');
      return realAcquire(constraints);
    };
  });
  await compatibility.locator('#switch-camera').click();
  await compatibility.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  assert(await compatibility.evaluate(() => camera.session.deviceId === compatibilityTarget && camera.session.captureProfile === 'default'));
  assert(await compatibility.evaluate(() => compatibilityRequests.length === 2 &&
    compatibilityRequests.every(request => request.audio === false && request.video.deviceId.exact === compatibilityTarget) &&
    !compatibilityRequests[1].video.width && !compatibilityRequests[1].video.height && !compatibilityRequests[1].video.aspectRatio));
  assert.match(await compatibility.locator('#camera-progress').textContent(), /Compatibility mode/);
  // A driver requiring VGA must receive the final bounded profile, without
  // dropping the selected device or requesting audio.
  await compatibility.evaluate(() => {
    compatibilityRequests.length = 0;
    navigator.mediaDevices.getUserMedia = constraints => {
      compatibilityRequests.push(constraints);
      if (constraints.video.width?.ideal !== 640) throw new DOMException('Synthetic format startup failure', 'AbortError');
      return realAcquire(constraints);
    };
  });
  await compatibility.locator('#switch-camera').click();
  await compatibility.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  assert(await compatibility.evaluate(() => compatibilityRequests.length === 3 && camera.session.captureProfile === 'basic' &&
    compatibilityRequests.every(request => request.audio === false && request.video.deviceId.exact === camera.session.deviceId) &&
    compatibilityRequests.at(-1).video.height.ideal === 480));
  console.log('PASS: startup failures retry native defaults then VGA on the same exact camera, without microphone access');
  await compatibility.evaluate(() => {
    compatibilityRequests.length = 0; window.restoreDevice = camera.session.deviceId;
    navigator.mediaDevices.getUserMedia = constraints => {
      compatibilityRequests.push(constraints);
      if (constraints.video.deviceId?.exact !== restoreDevice) throw new DOMException('Synthetic unavailable alternative', 'NotReadableError');
      return realAcquire(constraints);
    };
  });
  await compatibility.locator('#switch-camera').click();
  await compatibility.waitForFunction(() => camera.session?.ready && !camera.switchOperation);
  assert(await compatibility.evaluate(() => camera.session.deviceId === restoreDevice && camera.preferredDeviceId === restoreDevice &&
    compatibilityRequests.length === 7 && camera.failedDevices.size === 2));
  assert.match(await compatibility.locator('#camera-progress').textContent(), /Kept the last working camera/);
  console.log('PASS: when alternatives fail, the last working camera is restored once and remains the remembered selection');
  // Reopening makes failed devices eligible again (e.g. OBS is now running).
  await compatibility.locator('#close-camera').click();
  await compatibility.evaluate(() => { navigator.mediaDevices.getUserMedia = constraints => realAcquire(constraints); });
  await compatibility.locator('#open-camera').click();
  await compatibility.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  assert.equal(await compatibility.evaluate(() => camera.failedDevices.size), 0);
  await compatibility.evaluate(() => {
    compatibilityRequests.length = 0; window.unplayableDevice = camera.nextDevices(camera.session.deviceId)[0].deviceId;
    window.failedVideoTracks = []; window.originalCameraPlay = HTMLMediaElement.prototype.play;
    navigator.mediaDevices.getUserMedia = async constraints => {
      compatibilityRequests.push(constraints);
      const stream = await realAcquire(constraints);
      if (constraints.video.deviceId?.exact === unplayableDevice) failedVideoTracks.push(...stream.getTracks());
      return stream;
    };
    HTMLMediaElement.prototype.play = function () {
      if (this === camera.video && this.srcObject?.getVideoTracks()[0]?.getSettings().deviceId === unplayableDevice)
        return Promise.reject(new DOMException('Synthetic unplayable camera', 'NotSupportedError'));
      return originalCameraPlay.call(this);
    };
  });
  await compatibility.locator('#switch-camera').click();
  await compatibility.waitForFunction(() => camera.session?.ready && !camera.switchOperation);
  assert(await compatibility.evaluate(() => camera.failedDevices.has(unplayableDevice) && failedVideoTracks.length > 0 &&
    failedVideoTracks.every(track => track.readyState === 'ended') && camera.preferredDeviceId === camera.session.deviceId &&
    camera.preferredDeviceId !== unplayableDevice));
  await compatibility.evaluate(() => { HTMLMediaElement.prototype.play = originalCameraPlay; });
  console.log('PASS: an acquired but unplayable camera is stopped/skipped and cannot overwrite the last working selection');
  await compatibility.evaluate(() => {
    compatibilityRequests.length = 0;
    navigator.mediaDevices.getUserMedia = constraints => {
      compatibilityRequests.push(constraints); return new Promise((resolve, reject) => { window.rejectPendingSwitch = reject; });
    };
  });
  await compatibility.locator('#switch-camera').click();
  await compatibility.waitForFunction(() => Boolean(window.rejectPendingSwitch));
  await compatibility.locator('#close-camera').click();
  await compatibility.evaluate(async () => {
    rejectPendingSwitch(new DOMException('Synthetic late switch failure', 'NotReadableError'));
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  assert(await compatibility.evaluate(() => !camera.active && !camera.switchOperation && compatibilityRequests.length === 1 && !document.querySelector('#camera-panel').open));
  console.log('PASS: closing while switching prevents late failures from trying subsequent devices');
  await compatibility.evaluate(() => { navigator.mediaDevices.getUserMedia = constraints => realAcquire(constraints); });
  await compatibility.locator('#open-camera').click();
  await compatibility.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  await compatibility.evaluate(() => {
    compatibilityRequests.length = 0;
    navigator.mediaDevices.getUserMedia = constraints => {
      compatibilityRequests.push(constraints); throw new DOMException('Synthetic driver busy', 'NotReadableError');
    };
  });
  await compatibility.locator('#switch-camera').click();
  await compatibility.waitForFunction(() => !camera.active && document.querySelector('#status').textContent.includes('Browser error'));
  assert(await compatibility.evaluate(() => compatibilityRequests.length === 9));
  assert.match(await compatibility.locator('#status').textContent(), /NotReadableError.*Synthetic driver busy/);
  assert.match(await compatibility.locator('#status').textContent(), /Windows Settings camera preview/);
  // Permission denial must not trigger format retries or a default-device open.
  await compatibility.evaluate(() => {
    compatibilityRequests.length = 0;
    navigator.mediaDevices.getUserMedia = constraints => {
      compatibilityRequests.push(constraints); throw new DOMException('Synthetic denied', 'NotAllowedError');
    };
  });
  await compatibility.locator('#open-camera').click();
  await compatibility.waitForFunction(() => !camera.active && document.querySelector('#status').textContent.includes('NotAllowedError'));
  assert(await compatibility.evaluate(() => compatibilityRequests.length === 1));
  console.log('PASS: exhausted camera retries report the browser error; denied permission is reported without retries');
  await compatibility.evaluate(() => {
    compatibilityRequests.length = 0;
    navigator.mediaDevices.getUserMedia = constraints => {
      compatibilityRequests.push(constraints); return new Promise((resolve, reject) => { window.rejectPendingCamera = reject; });
    };
  });
  await compatibility.locator('#open-camera').click();
  await compatibility.waitForFunction(() => Boolean(window.rejectPendingCamera));
  for (const size of [{width:390,height:844},{width:844,height:390},{width:1280,height:844}]) {
    await compatibility.setViewportSize(size);
    await compatibility.evaluate(()=>camera.layoutPreview());
    const pending=await compatibility.evaluate(()=>{
      const rect=node=>{const {top,bottom,width,height}=node.getBoundingClientRect();return{top,bottom,width,height};};
      return {frame:rect(camera.frame),header:rect(camera.panel.querySelector('.camera-header')),
        footer:rect(camera.panel.querySelector('.camera-footer')),visible:!camera.frame.hidden,video:getComputedStyle(camera.video).visibility};
    });
    assert(pending.visible&&pending.frame.width>100&&pending.frame.height>100,'camera startup must reserve a visible rectangle: '+JSON.stringify({size,pending}));
    assert(pending.frame.top>=pending.header.bottom&&(size.width>size.height||pending.frame.bottom<=pending.footer.top+1),'startup frame must fit between header and controls: '+JSON.stringify({size,pending}));
    assert.equal(pending.video,'hidden','a previous camera feed cannot appear during startup');
  }
  await compatibility.locator('#close-camera').click();
  await compatibility.evaluate(async () => {
    rejectPendingCamera(new DOMException('Synthetic late startup failure', 'NotReadableError'));
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  assert(await compatibility.evaluate(() => !camera.active && compatibilityRequests.length === 1 && !document.querySelector('#camera-panel').open));
  console.log('PASS: closing during startup prevents late failures from retrying or reopening the camera');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['camera'],
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1' });
  const phone = await mobile.newPage(); phone.on('pageerror', error => errors.push(error.message));
  let phoneFilePickers = 0;
  phone.on('filechooser', () => phoneFilePickers++);
  await phone.goto(url);
  await phone.evaluate(() => { PixelStow.inspect = async () => ({ found: false }); });
  await phone.locator('#open-camera').click();
  await phone.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  await stableFeedback(phone);
  const [picker] = await Promise.all([phone.waitForEvent('filechooser'), phone.locator('#camera-take-photo').click()]);
  assert(!await phone.evaluate(() => camera.active));
  const bytes = Buffer.from(await phone.evaluate(async () => {
    const pixels = new Uint8Array(640 * 480 * 4); for (let i = 0; i < pixels.length; i += 4) pixels.set([60, 120, 160, 255], i);
    return Array.from(new Uint8Array(await (await PixelStow.writePng(pixels, 640, 480)).arrayBuffer()));
  }));
  await picker.setFiles({ name: 'public-phone-photo.png', mimeType: 'image/png', buffer: bytes });
  await phone.waitForFunction(() => current && !busy);
  assert.equal(await phone.evaluate(() => camera.inputPurpose), 'read');
  await phone.evaluate(() => {
    let state = 139;
    media.files = [{ name: 'public.bin', type: 'application/octet-stream', bytes: Uint8Array.from({ length: 550 }, () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255;
    }) }];
    media.sync();
  });
  await phone.locator('#message').fill('Public touch control check.');
  await phone.waitForFunction(() => !document.querySelector('#read-prognosis').hidden && !document.querySelector('#prognosis-target').disabled);
  await phone.locator('#prognosis-target').scrollIntoViewIfNeeded();
  const target = await phone.locator('#prognosis-target').boundingBox();
  assert(target.height >= 64);
  await phone.touchscreen.tap(target.x + target.width * .9, target.y + 6);
  const gentle = await phone.locator('#encoding-quality').inputValue();
  await phone.touchscreen.tap(target.x + target.width * .1, target.y + target.height - 6);
  const durable = await phone.locator('#encoding-quality').inputValue();
  assert(Number(durable) < Number(gentle));
  const cdp = await mobile.newCDPSession(phone), beforeScroll = await phone.evaluate(() => scrollY);
  const currentTarget = await phone.locator('#prognosis-target').boundingBox(), y = currentTarget.y + currentTarget.height - 6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: currentTarget.x + currentTarget.width * .15, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: currentTarget.x + currentTarget.width * .85, y: y + 24 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(Number(await phone.locator('#encoding-quality').inputValue()) > Number(durable));
  assert.equal(await phone.evaluate(() => scrollY), beforeScroll);
  console.log('PASS: phone prognosis accepts taps above/below the bar across a 64px target and drags outside it without scrolling the page');
  await phone.locator('#camera-source').click();
  await phone.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  assert(!(await phone.locator('#camera-take-photo').isVisible()));
  assert.equal(await phone.locator('#capture-frame').textContent(), 'Take source photo');
  await stableFeedback(phone);
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.waitForFunction(() => camera.session?.ready && !camera.session.portrait && !camera.session.adjusting && !document.querySelector('#capture-frame').disabled);
  await stableFeedback(phone);
  await phone.screenshot({ path: path.join(screenshots, 'phone-landscape.png') });
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.waitForFunction(() => camera.session?.ready && camera.session.portrait && !camera.session.adjusting && !document.querySelector('#capture-frame').disabled);
  await phone.screenshot({ path: path.join(screenshots, 'phone-portrait.png') });
  await phone.evaluate(() => {
    window.phoneTracks = camera.session.stream.getTracks();
    const importImage = camera.importImage;
    camera.importImage = (file, origin, captured) => {
      window.phoneSourceCapture = captured;
      return importImage(file, origin, captured);
    };
  });
  const live = await phone.locator('#camera-view').boundingBox(), tapX = live.x + live.width / 2, tapY = live.y + live.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: tapX, y: tapY }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: tapX + 40, y: tapY + 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(await phone.evaluate(() => camera.active && !window.phoneSourceCapture));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: tapX - 20, y: tapY }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: tapX - 20, y: tapY }, { id: 2, x: tapX + 20, y: tapY }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert(await phone.evaluate(() => camera.active && !window.phoneSourceCapture));
  await phone.waitForFunction(()=>!camera.pinch&&Date.now()-(camera.pinchGuard||0)>=400);
  await phone.touchscreen.tap(tapX, tapY);
  await phone.waitForFunction(() => Boolean(window.phoneSourceCapture) && !busy && !camera.active);
  assert(await phone.evaluate(() => phoneTracks.every(track => track.readyState === 'ended') &&
    phoneSourceCapture.sourceOnly && current.pixels === phoneSourceCapture.image.pixels));
  assert.equal(phoneFilePickers, 1, 'Photo must not open another native camera/picker or confirmation screen');
  assert(await phone.locator('#preview').isVisible());
  assert(await phone.locator('#composition').isVisible());
  assert(await phone.locator('#scale-source').isChecked());
  assert.equal(await phone.evaluate(() => camera.inputPurpose), 'read');
  console.log('PASS: preview taps capture a source photo directly while drags do nothing; Capture retains the native phone camera option; long status/near-miss feedback never moves controls or preview on desktop, portrait or landscape');
  assert(await phone.evaluate(() => !manualScaleSource), 'Automatic source capture must not overwrite the manual preference');
  await phone.locator('#file').setInputFiles({ name: 'public-import-after-capture.png', mimeType: 'image/png', buffer: bytes });
  await phone.waitForFunction(() => !busy && document.querySelector('#loaded-image').textContent.includes('public-import-after-capture.png'));
  assert(!(await phone.locator('#scale-source').isChecked()));
  await phone.locator('#scale-source').check();
  await phone.locator('#camera-source').click();
  await phone.waitForFunction(() => camera.session?.ready && !document.querySelector('#capture-frame').disabled);
  await phone.locator('#capture-frame').click();
  await phone.waitForFunction(() => !camera.active && !busy);
  await phone.locator('#file').setInputFiles({ name: 'public-import-manual-scale.png', mimeType: 'image/png', buffer: bytes });
  await phone.waitForFunction(() => !busy && document.querySelector('#loaded-image').textContent.includes('public-import-manual-scale.png'));
  assert(await phone.locator('#scale-source').isChecked());
  await phone.reload();
  assert(await phone.locator('#scale-source').isChecked());
  console.log('PASS: source capture temporarily enables scaling; normal imports restore manual off/on, and only the manually selected preference persists across reloads');
  console.log('PASS: Dual Wide camera names show a scan advisory without disabling capture; a normal camera selection removes it');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}

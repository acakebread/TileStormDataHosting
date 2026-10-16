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
    assert(await page.locator('#preview-encoded-image').evaluate(button =>
      button.parentElement.firstElementChild === button && getComputedStyle(button).backgroundColor === 'rgb(245, 230, 158)'),
    'the lower Preview action comes first and has the yellow accent');
    assert(await page.locator('#preview-audio').isDisabled());
    assert(await page.locator('#preview-screen-toggle').isHidden());
    const entryButtons = await page.locator('.image-actions > button').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, fits: button.scrollWidth <= button.clientWidth };
    }));
    assert.equal(entryButtons.length, 5);
    assert(entryButtons.every((box, index) => box.fits && box.width >= 44 && box.height >= 44 && Math.abs(box.y - entryButtons[0].y) < 1 && (!index || (box.x > entryButtons[index - 1].x + entryButtons[index - 1].width && box.x - entryButtons[index - 1].x - entryButtons[index - 1].width <= 11))), 'all five actions, including maximise, must stay together in one row: ' + JSON.stringify(entryButtons));
    await page.locator('.image-toolbar').screenshot({ path: path.join(snapshots, `image-actions-${width}.png`) });
    await page.evaluate(async () => {
      const width = 480, height = 640, pixels = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([60 + Math.round(x / 4), 100 + Math.round(y / 8), 150, 255], (x + y * width) * 4);
      const image = { pixels, width, height, exact: true };
      await useFile(new File([await PixelStow.writePng(pixels, width, height)], 'public-source.png', { type: 'image/png' }), 'file', { image, sourceOnly: true });
      window.sourceFixture = image;
    });
    await page.locator('#preview-encoded-image').locator('..').screenshot({ path: path.join(snapshots, `image-actions-lower-${width}.png`) });
    const cleanLayers = ['#preview-source', '#transform-outline', '#compare-ui', '#comparison-control', '#tag-encoded', '#tag-source'];
    const checkCleanLayers = async (source = false) => {
      for (const selector of cleanLayers.filter(selector => selector !== '#preview-source')) assert(!(await page.locator(selector).isVisible()), selector + ' must never appear in the transmission viewer');
      assert.equal(await page.locator('#preview-source').isVisible(), source);
      assert.equal(await page.locator('#preview-encoded').isVisible(), !source);
      if (source) assert.equal(await page.locator('#preview-source').evaluate(node => getComputedStyle(node).clipPath), 'none');
    };
    const tapImage = async () => {
      const box = await page.locator('#viewport').boundingBox();
      if (mobile) await page.touchscreen.tap(box.x + box.width * .3, box.y + box.height * .4);
      else await page.mouse.click(box.x + box.width * .3, box.y + box.height * .4);
    };
    const holdImage = async () => {
      const box = await page.locator('#viewport').boundingBox(), x = box.x + box.width * .3, y = box.y + box.height * .4;
      if (mobile) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
        await page.waitForTimeout(550);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up();
      }
    };
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert(await page.evaluate(() => fullPreview.openNow && fullPreview.clean));
    assert(await page.locator('#preview-audio').isDisabled());
    assert(await page.locator('#show-transform').isDisabled());
    assert(!(await page.locator('#preview-screen-footer').isVisible()));
    await checkCleanLayers();
    await holdImage();
    await checkCleanLayers();
    await tapImage();
    assert(!(await page.getByRole('button', { name: 'Fit', exact: true }).isVisible()));
    assert(await page.getByRole('button', { name: '100%', exact: true }).isVisible());
    assert(await page.getByRole('button', { name: 'Show source image', exact: true }).isDisabled(), 'a source-only image has no alternate preview');
    await checkCleanLayers();
    const cleanControls = ['#preview-screen-scale', '#preview-screen-toggle', '#preview-screen-hide', '#preview-markers', '#preview-screen-close'];
    const cleanBoxes = await Promise.all(cleanControls.map(selector => page.locator(selector).boundingBox()));
    assert(cleanBoxes.every((box, index) => box && box.width >= 44 && box.height >= 48 && Math.abs(box.y - cleanBoxes[0].y) < 1 && box.x >= 0 && box.x + box.width <= width && (!index || box.x >= cleanBoxes[index - 1].x + cleanBoxes[index - 1].width + 7)), 'all five clean-view controls must fit one row, with Analysis before Close: ' + JSON.stringify(cleanBoxes));
    const checkActionSpacing = boxes => {
      for (let i = 1; i < boxes.length; i++) {
        const gap = boxes[i].x - boxes[i - 1].x - boxes[i - 1].width;
        assert(gap >= 7 && gap <= 22, 'action gaps must stay between 8px and half a button width: ' + gap);
      }
      assert(Math.abs(boxes[0].x - (width - boxes.at(-1).x - boxes.at(-1).width)) < 1, 'the action group must be centred');
    };
    checkActionSpacing(cleanBoxes);
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
      assert(await page.evaluate(() => fullPreview.openNow && fullPreview.clean));
      assert(!(await page.locator('#preview-screen-footer').isVisible()));
      await checkCleanLayers();
      const dividerBefore = await page.locator('#split').inputValue();
      await tapImage();
      assert(await page.locator('#preview-screen-footer').isVisible());
      await checkCleanLayers();
      assert.equal(await page.locator('#split').inputValue(), dividerBefore, 'a clean-view tap must not change the comparison');
      await page.getByRole('button', { name: '100%', exact: true }).click();
      assert(await page.evaluate(() => Math.abs(viewScale - 1 / devicePixelRatio) < 1e-7));
      const buttonView = await page.evaluate(() => [fitMode, viewScale, originX, originY]);
      const toggle = page.locator('#preview-screen-toggle');
      assert(!(await toggle.isDisabled()), 'a decoded carrier enables the source toggle');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      await page.getByRole('button', { name: 'Show source image', exact: true }).click();
      await checkCleanLayers(true);
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      assert.equal(await toggle.getAttribute('title'), 'Show encoded image');
      assert.deepEqual(await page.evaluate(() => [fitMode, viewScale, originX, originY]), buttonView, 'the source button preserves zoom and pan');
      await page.getByRole('button', { name: 'Show encoded image', exact: true }).click();
      await checkCleanLayers();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      assert.deepEqual(await page.evaluate(() => [fitMode, viewScale, originX, originY]), buttonView);
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
      assert(!(await page.locator('#preview-screen-footer').isVisible()));
      await checkCleanLayers();
      const viewBefore = await page.evaluate(() => [fitMode, viewScale, originX, originY]);
      await holdImage();
      await checkCleanLayers(true);
      assert.equal(await toggle.getAttribute('aria-label'), 'Show encoded image', 'holding and clicking share the source toggle state');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      assert(!(await page.locator('#preview-screen-footer').isVisible()));
      assert.equal(await page.locator('#split').inputValue(), dividerBefore);
      assert.deepEqual(await page.evaluate(() => [fitMode, viewScale, originX, originY]), viewBefore, 'a source toggle preserves zoom/pan');
      await tapImage();
      await checkCleanLayers(true);
      await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
      await holdImage();
      await checkCleanLayers();
      assert.equal(await toggle.getAttribute('aria-label'), 'Show source image');
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      if (origin === 'camera') {
        if (mobile) {
          const cdp = await page.context().newCDPSession(page), box = await page.locator('#viewport').boundingBox();
          const x = box.x + box.width * .2, y = box.y + box.height * .4;
          const send = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
          const point = (id, px, py) => ({ id, x: px, y: py });
          const view = () => page.evaluate(() => ({ x: originX, y: originY, scale: viewScale, source: fullPreview.panel.classList.contains('show-source') }));
          const centreZoom = () => page.evaluate(() => {
            const image = imagePixels(), box = viewBox();
            fitMode = false; viewScale = fittedScale(image, box) * 3;
            originX = (box.w - image.w * viewScale) / 2;
            originY = (box.h - image.h * viewScale) / 2;
            applyView();
          });
          // Only moving past the gesture threshold turns a single touch into
          // a pan. It must stay a pan even after the long-press timer expires.
          await centreZoom();
          const dragBefore = await view();
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
          assert.deepEqual(await view(), dragBefore, 'touch down alone must not move or switch the image');
          await send('touchMove', [point(1, x + 40, y + 30)]);
          const dragFirst = await view();
          assert(dragFirst.x > dragBefore.x + 20 && dragFirst.y > dragBefore.y + 15, 'a one-finger drag must pan both axes: ' + JSON.stringify({ before: dragBefore, after: dragFirst }));
          await page.waitForTimeout(550);
          await send('touchMove', [point(1, x + 75, y + 60)]);
          const dragSecond = await view();
          assert(dragSecond.x > dragFirst.x + 20 && dragSecond.y > dragFirst.y + 15, 'one-finger panning must track continuously');
          assert.equal(dragSecond.scale, dragBefore.scale, 'a one-finger pan must preserve zoom');
          assert.equal(dragSecond.source, dragBefore.source, 'a moving touch must cancel the source-toggle hold');
          await send('touchEnd');
          assert.equal(await page.locator('#split').inputValue(), dividerBefore, 'clean-view holds cannot grab the comparison');
          assert(!(await page.locator('#preview-screen-footer').isVisible()));
          await checkCleanLayers();
          // Keep the two-finger zoom/pan gesture and suppress tap/hold when it
          // finishes with one finger still touching the picture.
          await centreZoom();
          const pinchBefore = await view();
          await send('touchStart', [point(1, x, y)]);
          await send('touchStart', [point(1, x, y), point(2, x + 120, y)]);
          await send('touchMove', [point(1, x - 15, y + 25), point(2, x + 155, y + 25)]);
          assert((await view()).scale > pinchBefore.scale, 'two-finger pinch must still zoom the clean viewer');
          await send('touchEnd', [point(1, x - 15, y + 25)]);
          await send('touchMove', [point(1, x + 10, y + 45)]);
          await page.waitForTimeout(550);
          await send('touchEnd');
          await checkCleanLayers();
          assert(!(await page.locator('#preview-screen-footer').isVisible()));
          assert.equal(await page.locator('#split').inputValue(), dividerBefore);
          // A stationary hold remains available after pan/pinch and shares
          // precisely the same transform with the source-image mode.
          await holdImage();
          await checkCleanLayers(true);
          const sourceBefore = await view();
          await send('touchStart', [point(1, x, y)]);
          await send('touchMove', [point(1, x + 35, y + 25)]);
          await page.waitForTimeout(550);
          await send('touchEnd');
          const sourceAfter = await view();
          assert(sourceAfter.x > sourceBefore.x + 20 && sourceAfter.y > sourceBefore.y + 15, 'source mode also supports single-touch panning');
          assert.equal(sourceAfter.scale, sourceBefore.scale);
          await checkCleanLayers(true);
          assert(!(await page.locator('#preview-screen-footer').isVisible()));
          await holdImage();
          await checkCleanLayers();
          await tapImage();
          assert(await page.locator('#preview-screen-footer').isVisible(), 'a later short tap must still reveal controls');
          const visibleBefore = await view();
          await send('touchStart', [point(1, x, y)]);
          await send('touchMove', [point(1, x - 30, y - 25)]);
          await send('touchEnd');
          const visibleAfter = await view();
          assert(visibleAfter.x < visibleBefore.x - 15 && visibleAfter.y < visibleBefore.y - 15, 'single-touch panning works while controls are visible');
          assert(await page.locator('#preview-screen-footer').isVisible(), 'a drag must not hide visible controls');
          await send('touchStart', [point(1, x, y)]);
          await send('touchCancel');
          await page.waitForTimeout(550);
          await checkCleanLayers();
          assert(await page.locator('#preview-screen-footer').isVisible(), 'cancelled touches must not leave a tap or hold queued');
          await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
          await cdp.detach();
          console.log(`PASS: ${width}px clean preview one-finger continuous pan; tap/hold arbitration, pinch continuation, source mode and cancellation`);
        } else {
          await page.evaluate(() => {
            const image = imagePixels(), box = viewBox();
            fitMode = false; viewScale = fittedScale(image, box) * 3;
            originX = (box.w - image.w * viewScale) / 2;
            originY = (box.h - image.h * viewScale) / 2;
            applyView();
          });
          const view = () => page.evaluate(() => ({ x: originX, y: originY, scale: viewScale, source: fullPreview.panel.classList.contains('show-source') }));
          const box = await page.locator('#viewport').boundingBox(), x = box.x + box.width * .2, y = box.y + box.height * .4;
          const before = await view();
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x + 4, y + 3);
          assert.deepEqual(await view(), before, 'mouse down and small movement leave the image still');
          await page.mouse.move(x + 40, y + 30);
          const first = await view();
          assert(Math.abs(first.x - before.x - 40) < 1 && Math.abs(first.y - before.y - 30) < 1, 'LMB drag includes the full movement from mouse down');
          await page.waitForTimeout(550);
          await page.mouse.move(x + 75, y + 60); await page.mouse.up();
          const second = await view();
          assert(Math.abs(second.x - before.x - 75) < 1 && Math.abs(second.y - before.y - 60) < 1, 'LMB pan tracks continuously beyond the hold timer');
          assert.equal(second.scale, before.scale);
          assert.equal(second.source, before.source, 'dragging cancels the source-toggle hold');
          assert.equal(await page.locator('#split').inputValue(), dividerBefore);
          assert(!(await page.locator('#preview-screen-footer').isVisible()), 'dragging does not reveal hidden controls');
          await holdImage();
          await checkCleanLayers(true);
          await tapImage();
          assert(await page.locator('#preview-screen-footer').isVisible());
          const sourceBefore = await view();
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x - 30, y - 25); await page.mouse.up();
          const sourceAfter = await view();
          assert(Math.abs(sourceAfter.x - sourceBefore.x + 30) < 1 && Math.abs(sourceAfter.y - sourceBefore.y + 25) < 1, 'LMB pan works on the source with controls showing');
          assert.equal(sourceAfter.scale, sourceBefore.scale);
          await checkCleanLayers(true);
          assert(await page.locator('#preview-screen-footer').isVisible(), 'dragging does not hide visible controls');
          await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
          await holdImage();
          await checkCleanLayers();
          assert(await page.evaluate(() => !panning && panStart === null && panPointer === null), 'mouse pan state is cleared on release');
          console.log('PASS: desktop clean preview continuous LMB pan preserves zoom and comparison; click/hold remain available');
        }
        await page.screenshot({ path: path.join(snapshots, `clean-capture-${width}.png`) });
      }
      await tapImage();
      await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    }
    if (mobile) {
      // The new gesture belongs only to the bottom full-screen viewer. A
      // single finger on the ordinary page must retain native page scrolling.
      await page.locator('#viewport').scrollIntoViewIfNeeded();
      const cdp = await page.context().newCDPSession(page), box = await page.locator('#viewport').boundingBox();
      const x = box.x + box.width * .25, y = Math.min(box.y + box.height * .7, 650);
      const before = await page.evaluate(() => ({ scroll: scrollY, x: originX, y: originY, scale: viewScale, split: split.value }));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
      for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x, y: y - step * 22 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(previous => scrollY > previous + 30, before.scroll);
      assert.deepEqual(await page.evaluate(() => ({ x: originX, y: originY, scale: viewScale, split: split.value })),
        { x: before.x, y: before.y, scale: before.scale, split: before.split }, 'an inline swipe scrolls the page without panning or scrubbing');
      await cdp.detach();
    }
    await page.waitForFunction(() => document.querySelector('#preview-audio').parentElement.id === 'preview-bottom-row');
    // Measure in one frame: an inline mobile swipe can still be coasting,
    // which changes viewport-relative Y between separate browser calls.
    const [mainAudio, mainSlider] = await page.evaluate(() => ['#preview-audio', '#comparison-control'].map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    }));
    assert(Math.abs(mainAudio.y + mainAudio.height / 2 - mainSlider.y - mainSlider.height / 2) < 1);
    assert(mainAudio.x + mainAudio.width <= width);
    assert(mainAudio.x + mainAudio.width <= mainSlider.x, 'the main speaker stays left of the slider after returning from fullscreen');
    await page.getByRole('button', { name: 'Full screen preview', exact: true }).click();
    assert(await page.evaluate(() => !fullPreview.clean));
    assert(await page.locator('#preview-screen-toggle').isHidden(), 'the comparison viewer retains its divider rather than duplicating the clean-view toggle');
    const controls = ['#preview-audio', '#preview-screen-scale', '#preview-screen-hide', '#preview-markers', '#preview-screen-close'];
    const boxes = await Promise.all(controls.map(selector => page.locator(selector).boundingBox()));
    assert(boxes.every((box, index) => box && box.width >= 44 && box.height >= 48 && Math.abs(box.y - boxes[0].y) < 1 && box.x >= 0 && box.x + box.width <= width && (!index || box.x >= boxes[index - 1].x + boxes[index - 1].width + 7)), JSON.stringify(boxes));
    checkActionSpacing(boxes);
    const analysisBox = boxes[controls.indexOf('#preview-markers')];
    assert.deepEqual(await page.locator('#show-transform').boundingBox(), analysisBox, 'the entire Analysis button is the checkbox hit target');
    const analysis = page.getByRole('checkbox', { name: 'Analysis', exact: true });
    await analysis.uncheck();
    const corner = analysisBox;
    if (mobile) await page.touchscreen.tap(corner.x + 4, corner.y + 4);
    else await page.mouse.click(corner.x + 4, corner.y + 4);
    assert(await analysis.isChecked(), 'touching a corner of the Analysis icon must toggle it');
    await page.waitForFunction(() => !document.querySelector('#transform-outline').hidden);
    assert(await page.locator('.analysis-icon').evaluate(node => getComputedStyle(node).backgroundColor !== 'rgba(7, 16, 24, 0.78)'));
    await analysis.focus(); await page.keyboard.press('Space');
    assert(!(await analysis.isChecked()));
    assert(!(await page.locator('#transform-outline').isVisible()));
    await page.locator('#preview-markers').screenshot({ path: path.join(snapshots, `analysis-off-${width}.png`) });
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
      console.log('PASS: desktop comparison keeps mouse/keyboard controls; raw/file/clipboard/camera Preview opens a separate clean transmission view');
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
    await page.evaluate(async bytes => {
      const photo = await PixelStow.decodePng(new Uint8Array(bytes));
      media.files = (await PixelStow.decode(photo.pixels, photo.width, photo.height, '', { nativeOnly: true })).attachments;
      media.sync();
    }, fixture);
    await page.locator('#message').fill('Public newly generated preview.');
    await page.locator('#encode').click();
    await page.waitForFunction(() => !busy && encodedPng && window.finishExtraction);
    assert(!(await page.locator('#preview-audio').isVisible()), 'speaker waits for the source comparison');
    assert(!(await page.locator('#comparison-control').isVisible()));
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert(await page.evaluate(() => {
      const pixels = previewEncoded.getContext('2d').getImageData(0, 0, previewEncoded.width, previewEncoded.height).data;
      return fullPreview.clean && pixels.length === current.recoverPixels.length && pixels.every((value, index) => value === current.recoverPixels[index]);
    }), 'Preview must show the current generated pixels before its comparison is ready');
    await checkCleanLayers();
    assert(!(await page.locator('#preview-screen-footer').isVisible()));
    await tapImage();
    await checkCleanLayers();
    assert(await page.getByRole('button', { name: 'Show source image', exact: true }).isDisabled(), 'the source button waits for pending extraction');
    await page.evaluate(async () => { PixelStow.extractCarrier = realExtraction; await finishExtraction(); await current.carrierPromise; });
    await page.waitForFunction(() => !document.querySelector('#preview-screen-toggle').disabled);
    const cleanAudio = page.getByRole('button', { name: 'Play audio', exact: true });
    assert(await cleanAudio.isVisible(), 'available audio joins the left of the clean preview icon row');
    const cleanRow = ['#preview-audio', '#preview-screen-scale', '#preview-screen-toggle', '#preview-screen-hide', '#preview-markers', '#preview-screen-close'];
    const cleanRowBoxes = await Promise.all(cleanRow.map(selector => page.locator(selector).boundingBox()));
    assert(cleanRowBoxes.every((box, index) => box && box.width >= 44 && box.height >= 48 && Math.abs(box.y - cleanRowBoxes[0].y) < 1 && (!index || box.x >= cleanRowBoxes[index - 1].x + cleanRowBoxes[index - 1].width + 7)), 'audio and Analysis join the clean preview icon row: ' + JSON.stringify(cleanRowBoxes));
    await page.getByRole('button', { name: 'Show source image', exact: true }).click();
    await checkCleanLayers(true);
    await page.getByRole('button', { name: 'Show encoded image', exact: true }).click();
    await checkCleanLayers();
    await page.getByRole('button', { name: 'Close preview', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#preview-audio').parentElement.id === 'preview-bottom-row');
    assert(await page.locator('#preview-audio').isVisible());
    assert(await page.locator('#comparison-control').isVisible());
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

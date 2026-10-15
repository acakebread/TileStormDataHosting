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
const snapshots=path.join(root,'artifacts','prognosis-checks');
await fs.mkdir(snapshots,{recursive:true});
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'],
    ...(process.env.PIXELSTOW_CHROME ? { executablePath: process.env.PIXELSTOW_CHROME } : {}) });
  for (const width of [390, 320, 1280]) {
    const mobile=width<500;
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: mobile, hasTouch: mobile });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/pixelstow.html');
    const load = (width, height, length, origin='file') => page.evaluate(async ({ width, height, length, origin }) => {
      const pixels = new Uint8Array(width * height * 4);
      for (let i = 0; i < pixels.length; i += 4) pixels.set([100, 120, 140, 255], i);
      const image = { pixels, width, height, exact: true };
      await useFile(new File([await PixelStow.writePng(pixels, width, height)], 'public-source.png', { type: 'image/png' }), origin, { image, sourceOnly: true });
      let seed = 317;
      const bytes = Uint8Array.from({ length }, () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed & 255; });
      window.publicPayload = { text: 'Public prognosis fixture.', attachments: [{ name: 'public.bin', type: 'application/octet-stream', bytes }] };
      media.files = publicPayload.attachments; message.value = publicPayload.text; media.sync(); updateByteCounts();
    }, { width, height, length, origin });
    const dimensions = () => page.evaluate(() => ({ width: sourcePlan.width, height: sourcePlan.height }));
    const maximumQuality = () => page.locator('#encoding-quality').press('End');
    const repetition = () => page.evaluate(() => sourcePlan.repetitionRatio);
    const risk = () => page.locator('#prognosis-pointer').evaluate(node => parseFloat(node.style.left));
    await load(4032, 3024, 1000);
    await page.locator('#encoding-quality').fill('0.1');
    await page.locator('#scale-source').check();
    await page.waitForFunction(() => sourcePlan?.fits && frameBudget?.framedBytes > 1000);
    const initial=await dimensions();
    assert(initial.width<1200 && initial.height<800, 'a phone-sized original immediately becomes payload-sized');
    assert(await repetition()>=2 && await repetition()<2.05);
    assert.equal(await page.locator('#encoding-quality').inputValue(),'0.8','enabling scaling discards the old quality setting');
    const controlPositions = () => page.evaluate(() => ['encoding-quality', 'prognosis-target', 'encode'].map(id => document.getElementById(id).getBoundingClientRect().top + scrollY));
    const positions = await controlPositions();
    await page.locator('#encoding-quality').fill('0'); const durable = await risk();
    await maximumQuality(); const gentle = await risk();
    assert(durable < gentle); assert.deepEqual(await dimensions(), initial);
    assert.deepEqual(await controlPositions(), positions, 'quality and status updates keep the controls steady');
    await page.locator('#prognosis-target').fill('0');
    await maximumQuality();
    const largest = await dimensions(), green = await risk(), greenRepetition = await repetition();
    assert(largest.width>initial.width && largest.height>initial.height && largest.width<1200);
    assert(greenRepetition>=3 && greenRepetition<3.05);
    assert.equal(await page.locator('#encoding-quality').inputValue(), '1');
    assert(await page.evaluate(() => sourcePlan.fits && sourcePlan.width === sourcePlan.maximum.width));
    await page.locator('#prognosis-target').fill('1');
    const smallest = await dimensions();
    assert(smallest.width<initial.width && smallest.height<initial.height);
    assert(await repetition()>=1 && await repetition()<1.05);
    assert(Number(await page.locator('#encoding-quality').inputValue())<.35,'low repetition caps maximum quality at a stronger signal');
    const quality=page.locator('#encoding-quality');
    const qualityState=()=>page.evaluate(()=>({value:Number(encodingQuality.value),requested:requestedQuality,
      max:qualityLimit.max,bounds:{...prognosisBounds},label:encodingQualityValue.value}));
    const geometry=()=>quality.evaluate(node=>{
      const box=node.getBoundingClientRect(),full=node.parentElement.getBoundingClientRect();
      const thumb=parseFloat(getComputedStyle(node).getPropertyValue('--quality-thumb'));
      const max=Number(node.max),value=Number(node.value);
      return {x:box.x+thumb/2+(box.width-thumb)*value/max,y:box.y+box.height/2,
        limitX:box.right-thumb/2,outsideX:full.right-5};
    });
    // Exercise the browser's active drag, not just programmatic input events:
    // overdrag must not alter a hidden requested value or the prognosis bounds.
    for(const touch of mobile?[false,true]:[false]){
      await quality.fill('0.1');await quality.scrollIntoViewIfNeeded();
      const g=await geometry();
      let cdp;
      if(touch){
        cdp=await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:g.x,y:g.y}]});
      }else{await page.mouse.move(g.x,g.y);await page.mouse.down();}
      const move=async x=>touch
        ?cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:g.y}]})
        :page.mouse.move(x,g.y,{steps:4});
      await move(g.limitX);
      const atLimit=await qualityState();
      assert(Math.abs(atLimit.value-atLimit.max)<.005);
      assert(atLimit.requested<=atLimit.max+1e-12);
      await move(g.outsideX);
      const beyond=await qualityState();
      assert.deepEqual(beyond,atLimit,'overdragging the grey area must leave the actual value, requested quality and prognosis unchanged');
      await move(g.limitX-8);
      assert((await qualityState()).value<atLimit.value-.005,'returning inside the boundary must reduce quality immediately');
      if(touch){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
      else await page.mouse.up();
      await quality.press('End');const keyboardLimit=await qualityState();
      await quality.press('ArrowRight');
      assert.deepEqual(await qualityState(),keyboardLimit,'keyboard input must stop at the same real maximum');
    }
    await page.locator('.quality-label').evaluate(node => scrollTo(0,node.getBoundingClientRect().top+scrollY-15));
    await page.screenshot({path:path.join(snapshots,`payload-range-${width}.png`)});
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
    await maximumQuality();
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
        current.width === 4032 && current.height === 3024 && current.pixels.every((value, index) => value === [100, 120, 140, 255][index % 4]);
    }, encodedSize));

    await load(320, 240, 5200);
    await page.waitForFunction(() => sourcePlan?.fits && frameBudget?.framedBytes > 5200);
    const required = await dimensions(); assert(required.width > 320 && required.height > 240);
    assert(await page.evaluate(() => sourcePlan.width === sourcePlan.recommended.width && sourcePlan.width < sourcePlan.maximum.width));
    assert(await repetition()>=2 && await repetition()<2.05);
    await page.locator('#encoding-quality').fill('0'); await maximumQuality();
    assert.deepEqual(await dimensions(), required, 'payload-driven enlargement does not depend on quality');
    assert(await page.locator('#prognosis-target').isEnabled(), 'more repetition remains selectable after the automatic minimum enlargement');
    await page.locator('#prognosis-target').fill('0');
    assert((await dimensions()).width > required.width);
    await page.locator('#encoding-quality').fill('0');
    await page.locator('#scale-source').uncheck();
    await page.locator('#scale-source').check();
    assert.deepEqual(await dimensions(),required,'every toggle on restores the suggested 2x grid');
    assert(await page.evaluate(() => requestedQuality===.8 && sourceRedundancy===2 && Math.abs(Number(encodingQuality.value)-qualityLimit.quality)<1e-12));

    if(width===390){
      // Simulate Encode winning the race with the delayed UI compression pass.
      await page.evaluate(() => {
        let seed=709;
        const bytes=Uint8Array.from({length:6400},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
        publicPayload={text:'Public immediate-encode fixture.',attachments:[{name:'fresh.bin',type:'application/octet-stream',bytes}]};
        media.files=publicPayload.attachments;message.value=publicPayload.text;media.sync();updateByteCounts();
        clearTimeout(repetitionTimer);
      });
      assert(await page.evaluate(() => frameBudget.framedBytes<6400));
      await page.locator('#encode').click();
      await page.waitForFunction(() => !busy && encodedPng, {}, {timeout:30000});
      assert(await page.evaluate(async () => {
        const frame=await PixelStow.estimatePayloadFrame(publicPayload,false);
        const plan=PixelStowSizing.plan(current.width,current.height,frame.framedBytes,2);
        const limit=PixelStowSizing.scaledQuality(plan,.8);
        const png=await PixelStow.decodePng(new Uint8Array(await encodedPng.arrayBuffer()));
        return encodedPrognosis.width===plan.width && encodedPrognosis.height===plan.height &&
          Math.abs(encodedPrognosis.quality-limit.quality)<1e-12 &&
          PixelStow.payloadsEqual(await PixelStow.decode(png.pixels,png.width,png.height,'',{nativeOnly:true}),publicPayload);
      }),'Encode remeasures size and quality bounds even if the pending appraisal has not run');
    }

    await load(320,240,60000);
    await page.waitForFunction(() => sourcePlan?.fits && frameBudget?.framedBytes>60000);
    assert(await risk()>85,'even the strongest wavelets cannot advertise an enormous carrier as easy to photograph');
    assert(await page.locator('#encoding-quality').isDisabled());
    assert((await page.locator('#prognosis-detail').textContent()).includes('Large carrier'));

    await page.locator('#scale-source').uncheck();
    await load(1280, 960, 1000);
    await page.waitForFunction(() => !sourcePlan && frameBudget?.framedBytes > 1000);
    await page.locator('#prognosis-target').fill('0'); const fixedDurable = Number(await page.locator('#encoding-quality').inputValue());
    await page.locator('#prognosis-target').fill('1');
    assert(Number(await page.locator('#encoding-quality').inputValue()) > fixedDurable);
    assert(await page.evaluate(() => !sourcePlan && current.width === 1280 && current.height === 960));

    await load(320,240,1000,'camera');
    await page.waitForFunction(() => sourcePlan?.fits && frameBudget?.framedBytes>1000);
    assert(await page.locator('#scale-source').isChecked());
    assert(await page.evaluate(() => sourceRedundancy===2 && requestedQuality===.8));
    await load(640,480,1000);
    await page.waitForFunction(() => frameBudget?.framedBytes>1000);
    assert(!await page.locator('#scale-source').isChecked(),'an automatic camera default must not overwrite the manual file preference');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px mouse${mobile?'/touch':''}/keyboard quality drags stop at the actual bound with immediate return; payload-sized defaults, repetition, camera/file preferences and verified encoding remain correct`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

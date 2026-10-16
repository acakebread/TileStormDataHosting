// Optional A/B research on local captures. Never print or export payload contents.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const live = process.argv.includes('--live');
const beacon = process.argv.includes('--beacon');
const cpu = Number(process.argv.find(value => value.startsWith('--cpu='))?.slice(6) || 1);
const inputs = process.argv.slice(2).filter(value => !['--live', '--beacon'].includes(value) && !value.startsWith('--cpu='));
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
    const rows = await page.evaluate(async ({bytes, live, beacon}) => {
      const image = await PixelStow.readImageFile(new File([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], 'capture.png'));
      const rows = [];
      for (const variant of beacon ? ['full'] : live ? ['live', 'unguided-24s', 'full'] : [false, true]) {
        const earlyPayload = live || beacon ? false : variant;
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
        const row = { ...(live || beacon ? { variant, guide: Boolean(guide), candidates: scan.candidates.length } : { enabled: earlyPayload }), success: Boolean(result.found && !result.unreadable),
          scanMs: Math.round(scanned - started), totalMs: Math.round(performance.now() - started),
          early: Boolean(result.earlyPayload), fallback: Boolean(result.earlyPayloadFallback),
          headers: result.geometry?.headerCount, markers: result.markers?.length,
          highConfidence: Boolean(scan.highConfidence), reason: scan.reason, encodedBeacon: Boolean(result.edgeGuide) };
        if (beacon && row.success) {
          const baseline=await PixelStow.scanEdgeGuide(pixels,image.width,image.height,{maxMilliseconds:6000,contentSearch:false});
          row.baselineBeacon={detected:Boolean(baseline),scale:baseline?.scale};
          const started = performance.now();
          const hint = await PixelStow.scanEdgeGuide(pixels, image.width, image.height, {maxMilliseconds: 3000});
          row.rawBeacon = {detected: Boolean(hint), milliseconds: Math.round(performance.now()-started), scale: hint?.scale};
          if(row.encodedBeacon&&!hint)throw Error('Known beacon capture failed live-budget calibration detection');
          if (hint) {
            const guidedPixels=pixels.slice(),guidedStart=performance.now();
            const guidedScan=await PixelStow.scanMarkers(guidedPixels,image.width,image.height,
              {earlyPayload:false,scaleGuide:hint,calibratedOnly:true,deadline:Date.now()+8000});
            const guidedRead=await PixelStow.readMarkerCandidates(guidedPixels,image.width,image.height,guidedScan,
              {earlyPayload:false,calibratedOnly:true,resumeDiscovery:false});
            row.guidedRead={success:guidedRead.found&&!guidedRead.unreadable,milliseconds:Math.round(performance.now()-guidedStart),
              headers:guidedRead.geometry?.headerCount,localization:guidedScan.calibration?.localizationResolution};
            if (!row.guidedRead.success) throw Error('Detected beacon did not yield a readable guided grid');
          }
          // Use the successful decoder's measured transform as an oracle only
          // for diagnosis: can the existing beacon be seen once framing is known?
          const g = result.geometry, w = g.originalWidth, h = g.originalHeight, m = g.matrix;
          const rectified = new Uint8Array(w*h*4);
          for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
            const d=m[6]*x+m[7]*y+m[8],sx=(m[0]*x+m[1]*y+m[2])/d,sy=(m[3]*x+m[4]*y+m[5])/d;
            const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
            const at=(xx,yy,k)=>pixels[(Math.max(0,Math.min(image.width-1,xx))+Math.max(0,Math.min(image.height-1,yy))*image.width)*4+k];
            for(let k=0;k<3;k++) rectified[(x+y*w)*4+k]=Math.round((at(ix,iy,k)*(1-fx)+at(ix+1,iy,k)*fx)*(1-fy)+(at(ix,iy+1,k)*(1-fx)+at(ix+1,iy+1,k)*fx)*fy);
            rectified[(x+y*w)*4+3]=255;
          }
          const oracleStart=performance.now();
          const oracle=await PixelStow.scanEdgeGuide(rectified,w,h,{maxMilliseconds:6000,outlineSearch:false});
          row.rectifiedBeacon={detected:Boolean(oracle),milliseconds:Math.round(performance.now()-oracleStart),scale:oracle?.scale,width:w,height:h};
        }
        rows.push(row);
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
    }, { bytes, live, beacon });
    if (!live && !beacon) assert(!rows[0].success || rows[1].success, 'Experiment must preserve baseline recovery');
    if (live && rows[2].success) assert(rows[1].success, 'extended live fallback must recover this readable capture');
    report.push({ input: index + 1, cpu, rows });
    console.log(JSON.stringify(report.at(-1)));
  }
  await fs.mkdir(path.join(root, 'artifacts/early-payload-baseline-20261016'), { recursive: true });
  await fs.writeFile(path.join(root, 'artifacts/early-payload-baseline-20261016/' + (beacon ? 'beacon-diagnosis.json' : live ? 'live-comparison-cpu' + cpu + '.json' : 'photo-comparison.json')), JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

// Public synthetic signal and a DOM preview only. No camera or personal images.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const server=http.createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(path.relative(root,file).startsWith('..'))throw Error('Outside test root');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage({viewport:{width:480,height:900},hasTouch:true,isMobile:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  assert(await page.evaluate(()=>{
    const session={purpose:'read'};camera.session=session;
    camera.showSignal(session,{},null);camera.renderSignal(session);
    const hidden=!camera.debugEnabled&&!session.signalDebug&&camera.signalCanvas.hidden&&camera.signalReadout.hidden;
    camera.session=null;return hidden;
  }),'diagnostics must start disabled and skip the overlay');
  assert.equal(await page.locator('#debug-mode').getAttribute('aria-pressed'),'false');
  await page.locator('#debug-mode').tap();
  assert.equal(await page.locator('#debug-mode').getAttribute('aria-pressed'),'true');
  const result=await page.evaluate(async()=>{
    const w=512,h=384,source=new Uint8Array(w*h*4);
    for(let i=0;i<source.length;i+=4)source.set([128,128,128,255],i);
    const marked=PixelStowEdgeGuide.apply(source,w,h),oneEdge=source.slice();
    for(let y=8;y<56;y++)oneEdge.set(marked.subarray(y*w*4,(y+1)*w*4),y*w*4);
    const original=oneEdge.slice(),options={minimumScale:1,maximumScale:1,scaleStep:.01,maxMilliseconds:2000,outlineSearch:false,contentSearch:false};
    const plain=await PixelStow.scanEdgeGuide(oneEdge,w,h,{...options,worker:false});
    const negative=await PixelStow.scanEdgeGuide(oneEdge,w,h,{...options,diagnostic:true});
    const normal=await PixelStow.scanEdgeGuide(marked,w,h,options);
    const positive=await PixelStow.scanEdgeGuide(marked,w,h,{...options,diagnostic:true});
    const cancelled=new AbortController();cancelled.abort();let aborted=false;
    try{await PixelStow.scanEdgeGuide(marked,w,h,{...options,diagnostic:true,signal:cancelled.signal});}catch(error){aborted=error.name==='AbortError';}
    const session={purpose:'read',history:[],frames:7};camera.session=session;
    camera.panel.hidden=false;camera.panel.showModal();camera.view.style.height='360px';
    Object.assign(camera.frame.style,{left:'10px',top:'10px',width:'440px',height:'330px'});
    const entry={image:{pixels:oneEdge,width:w,height:h},frameNumber:7,capturedAt:Date.now()-1200};
    camera.showSignal(session,entry,negative);camera.updateCalibrationLight(session,entry);
    const text=camera.signalReadout.textContent;
    const drawn=Array.from(camera.signalCanvas.getContext('2d').getImageData(0,0,camera.signalCanvas.width,camera.signalCanvas.height).data).some((v,i)=>i%4===3&&v>0);
    const state=camera.frame.dataset.calibration;
    const hasCanvas=!camera.signalCanvas.hidden,hasText=!camera.signalReadout.hidden;
    camera.showSignal(session,entry,positive);
    const overlay=camera.signalCanvas.getContext('2d').getImageData(0,0,camera.signalCanvas.width,camera.signalCanvas.height).data;
    const greenOnly=Array.from(overlay).every((v,i)=>i%4!==0||!overlay[i+3]||overlay[i]<overlay[i+1]);
    const matched=camera.signalReadout.textContent.includes('Green: calibration matched')&&
      !camera.signalReadout.textContent.includes('Amber')&&camera.signalReadout.dataset.state==='detected'&&greenOnly;
    camera.cancelSearches(session);
    const cleared=camera.signalCanvas.hidden&&camera.signalReadout.hidden&&!session.signalDebug;
    camera.close();
    return {plainMiss:plain===null,negative,positive,normalScale:normal?.scale,normalCorners:normal?.corners,
      unchanged:oneEdge.every((value,i)=>value===original[i]),aborted,text,drawn,state,hasCanvas,hasText,matched,cleared};
  });
  assert(result.plainMiss,'one edge alone must not count as calibration');
  assert.equal(result.negative?.detected,false,'diagnostics must keep the response unverified');
  assert(result.negative.diagnostic.strongest.score>0);
  assert.equal(result.negative.diagnostic.strongest.band.length,4);
  assert(result.positive?.detected,'the complete synthetic guide must still match');
  assert.equal(result.positive.diagnostic.accepted.length,4,'confirmed overlays must identify their four accepted strips');
  assert.equal(result.positive.scale,result.normalScale);
  assert.deepEqual(result.positive.corners,result.normalCorners,'debug collection must not change accepted geometry');
  assert(result.unchanged&&result.aborted);
  assert(result.drawn&&result.hasCanvas&&result.hasText&&result.matched&&result.cleared);
  assert.equal(result.state,'searching','a strong rejected response cannot turn the frame green');
  assert.match(result.text,/Frame 7.*1\.2s old/);
  assert.match(result.text,/Amber: strongest guide response/);
  assert.match(result.text,/Unverified/);
  await page.evaluate(({negative,positive})=>{
    const width=512,height=384,pixels=new Uint8Array(width*height*4);
    for(let i=0;i<pixels.length;i+=4)pixels.set([97,128,149,255],i);
    window.heldTestImage={pixels,width,height};window.heldAccepts=[];
    Object.defineProperties(camera.video,{readyState:{configurable:true,get:()=>2},
      videoWidth:{configurable:true,get:()=>width},videoHeight:{configurable:true,get:()=>height}});
    camera.schedule=()=>{}; // Frame sampling is covered separately with the fake clock.
    window.openHeldTest=()=>{
      const session={purpose:'read',ready:true,rotation:0,history:[],frames:1};camera.session=session;
      camera.panel.hidden=false;camera.panel.showModal();camera.sync();
      window.heldTestEntry={image:heldTestImage,frameNumber:1,capturedAt:Date.now(),guideKind:'edge'};
      camera.showSignal(session,heldTestEntry,negative);
      return session;
    };
    camera.accept=async(s,img,inspection,markerScan)=>{
      heldAccepts.push({sameRaster:img===heldTestImage,hasScan:Boolean(markerScan?.candidates?.length)});
      s.handingOff=true;camera.cancelSearches(s);
    };
    camera.captureFrame=()=>{throw Error('A frozen action must not recapture the live video');};
    window.heldPositive=positive;
    openHeldTest();
  },result);
  await page.locator('#camera-signal-readout').tap();
  assert(await page.evaluate(()=>Boolean(camera.session.paused&&camera.session.signalHold&&!camera.frozenFrame.hidden)));
  assert.equal(await page.evaluate(()=>heldAccepts.length),0,'tapping the debug readout must not bubble into the camera shutter');
  assert(await page.evaluate(()=>{
    const shown=camera.frozenFrame.getContext('2d').getImageData(0,0,512,384).data;
    return shown.every((v,i)=>v===heldTestImage.pixels[i]);
  }),'the debug hold displays the exact sampled raster');
  await page.locator('#camera-signal-readout').tap();
  assert(await page.evaluate(()=>!camera.session.paused&&!camera.session.signalHold&&camera.frozenFrame.hidden));
  await page.evaluate(()=>camera.showSignal(camera.session,heldTestEntry,null));
  await page.locator('#camera-signal-readout').tap();
  assert(await page.evaluate(()=>{
    camera.setDebugEnabled(false);
    camera.showSignal(camera.session,heldTestEntry,null);
    return !camera.session.paused&&!camera.session.signalHold&&camera.frozenFrame.hidden&&
      camera.signalCanvas.hidden&&camera.signalReadout.hidden&&!camera.session.signalDebug;
  }),'turning debug off releases only the manual debug hold and blocks late overlay updates');
  await page.evaluate(()=>camera.setDebugEnabled(true));
  await page.evaluate(()=>camera.showSignal(camera.session,heldTestEntry,null));
  await page.locator('#camera-signal-readout').tap();
  await page.locator('#capture-frame').tap();
  assert.deepEqual(await page.evaluate(()=>heldAccepts),[{sameRaster:true,hasScan:false}],'manual read after a debug hold uses its sampled frame');
  await page.evaluate(async()=>{
    camera.close();camera.setDebugEnabled(false);const session=openHeldTest();window.heldMarkerCalls=[];
    PixelStow.scanEdgeGuide=async(p,w,h,options)=>{window.heldGuideDiagnostic=options.diagnostic;return heldPositive;};
    PixelStow.scanMarkers=(p,w,h,options)=>new Promise((resolve,reject)=>{
      heldMarkerCalls.push({pixels:p,options,resolve});
      options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
    });
    session.guidePending=heldTestEntry;
    await camera.checkScaleGuide(session);
  });
  assert(await page.evaluate(()=>camera.session.calibrationHold?.entry===heldTestEntry&&!camera.frozenFrame.hidden));
  assert(await page.evaluate(()=>heldGuideDiagnostic===false&&camera.signalCanvas.hidden&&camera.signalReadout.hidden),
    'normal calibration still freezes its frame with debug collection and overlay disabled');
  await page.locator('#rotate-camera').click();
  assert(await page.evaluate(()=>camera.session.rotation===90&&camera.session.calibrationHold?.entry===heldTestEntry&&
    camera.frozenFrame.style.transform.includes('rotate(90deg)')&&heldMarkerCalls.length===1&&!heldMarkerCalls[0].options.signal.aborted),
    'rotating a frozen view must preserve its acquired raster and active recovery');
  await page.waitForTimeout(3200);
  assert(await page.evaluate(()=>camera.session.calibrationHold?.entry===heldTestEntry&&heldMarkerCalls.length===1),
    'a real display hold must remain frozen beyond three seconds while marker recovery is active');
  assert(await page.evaluate(()=>getComputedStyle(camera.video).visibility==='hidden'));
  await page.evaluate(()=>heldMarkerCalls[0].resolve({markers:[],candidates:[]}));
  await page.waitForFunction(()=>heldMarkerCalls.length===2);
  assert(await page.evaluate(()=>heldMarkerCalls[1].pixels===heldTestImage.pixels&&!heldMarkerCalls[1].options.calibratedOnly),
    'guided misses start full recovery on the same held pixels');
  await page.evaluate(()=>heldMarkerCalls[1].resolve({markers:[],candidates:[{geometry:{rank:100}}]}));
  await page.waitForFunction(()=>heldAccepts.length===2);
  assert.deepEqual(await page.evaluate(()=>heldAccepts[1]),{sameRaster:true,hasScan:true});
  await page.evaluate(()=>camera.close());
  await page.locator('#debug-mode').tap();
  assert.equal(await page.locator('#debug-mode').getAttribute('aria-pressed'),'true');
  await page.locator('#debug-mode').tap();
  assert.equal(await page.locator('#debug-mode').getAttribute('aria-pressed'),'false');
  assert.deepEqual(errors,[]);
  console.log('PASS: strongest rejected strip reaches the overlay through a real worker; one-edge rejection, complete-guide geometry, input preservation, cancellation and stale-overlay cleanup');
  console.log('PASS: touchscreen readout holds/resumes the sampled frame without triggering the shutter; manual capture and delayed green guided/full recovery hand off those same pixels');
  console.log('PASS: Info debug toggle defaults off, hides and releases diagnostic holds, and leaves normal calibration freezing/recovery active');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}

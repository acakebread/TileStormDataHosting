// Real browser workers and camera thumbnail scaling, using public synthetic pixels.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const server=http.createServer(async(req,res)=>{
  try{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root))throw Error('Outside test directory');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage(),errors=[],workers=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('worker',worker=>workers.push(worker.url()));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  const result=await page.evaluate(async()=>{
    const w=800,h=600,pixels=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set([Math.round(110+18*Math.sin(x/70)),128,140,255],(x+y*w)*4);
    const content={text:'Public worker pilot and exact-payload check.',attachments:[]};
    const encoded=await PixelStow.encodePayload(pixels,w,h,content,'');
    const photo=await PixelStowSizing.resize(encoded,1096,822),before=photo.pixels.slice();
    // Exercise exactly the frozen capture -> 512px guide raster -> worker route.
    camera.captureCanvas.width=photo.width;camera.captureCanvas.height=photo.height;
    camera.captureCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(photo.pixels),photo.width,photo.height),0,0);
    const small=camera.captureGuideImage(photo);
    const hint=await PixelStow.scanScaleGuide(small.pixels,small.width,small.height);
    if(!hint)return {hint:false};
    const fx=hint.fx*small.width/photo.width,fy=hint.fy*small.height/photo.height;
    const guide={...hint,fx,fy,scale:hint.scale*Math.hypot(hint.fx,hint.fy)/Math.hypot(fx,fy),width:photo.width,height:photo.height};
    const scan=await PixelStow.scanMarkers(photo.pixels,photo.width,photo.height,{scaleGuide:guide,deadline:Date.now()+24000});
    const read=await PixelStow.readMarkerCandidates(photo.pixels,photo.width,photo.height,scan,{resumeDiscovery:true,deadline:Date.now()+30000});
    const decoded=await PixelStow.decode(photo.pixels,photo.width,photo.height,'');
    const clean=await PixelStow.extractCarrier(encoded.pixels,w,h,encoded.strength);
    const workerClean=await PixelStow.extractCarrier(encoded.pixels,w,h,encoded.strength,{background:true});
    const sameRemoval=workerClean.every((v,i)=>v===clean[i]);
    const weak=await PixelStow.decodePng(new Uint8Array(await(await fetch('./tests/fixtures/public-v5-three-level-pilot.png')).arrayBuffer()));
    const weakRead=await PixelStow.decode(weak.pixels,weak.width,weak.height,'',{nativeOnly:true});
    const original=await PixelStow.decodePng(new Uint8Array(await(await fetch('./tests/fixtures/public-v5-before-scale-pilot.png')).arrayBuffer()));
    const oldHint=await PixelStow.scanScaleGuide(original.pixels,original.width,original.height);
    const oldRead=await PixelStow.decode(original.pixels,original.width,original.height,'',{nativeOnly:true});
    const controller=new AbortController(),pending=PixelStow.scanScaleGuide(photo.pixels,photo.width,photo.height,{signal:controller.signal});
    controller.abort();let aborted=false;try{await pending;}catch(e){aborted=e.name==='AbortError';}
    return {hint:true,scale:guide.scale,markers:scan.markers.filter(m=>m.verification==='header').length,
      read:read.found&&!read.unreadable,exact:PixelStow.payloadsEqual(decoded,content),pilot:decoded.scalePilot,
      amplitude:decoded.scalePilotAmplitude,readAmplitude:read.scalePilotAmplitude,weakAmplitude:weakRead.scalePilotAmplitude,sameRemoval,
      intact:photo.pixels.every((v,i)=>v===before[i]),oldHint,oldText:oldRead.text,oldPilot:oldRead.scalePilot,aborted};
  });
  assert(result.hint);assert(Math.abs(result.scale/1.37-1)<.03);assert.equal(result.markers,4);
  assert(result.read&&result.exact&&result.pilot&&result.intact&&result.aborted);
  assert.equal(result.amplitude,16);assert.equal(result.readAmplitude,16);assert.equal(result.weakAmplitude,3);assert(result.sameRemoval);
  assert.equal(result.oldHint,null);assert.equal(result.oldPilot,false);
  assert.equal(result.oldText,'Public V5 compatibility fixture before the scale pilot.');
  // Guide, marker discovery, payload read and the old-image guide each finish
  // in a real worker. Immediate abort can terminate before Playwright sees it.
  assert(workers.length>=4);assert.deepEqual(errors,[]);
  console.log('PASS: actual browser guide/marker/payload workers, 512px frozen-capture scale mapping, exact new V5 payload, unchanged pre-pilot V5 and worker cancellation');
  for(const relative of process.argv.slice(2)){
    const measured=await page.evaluate(async relative=>{
      const image=await PixelStow.decodePng(new Uint8Array(await(await fetch('./'+relative)).arrayBuffer()));
      camera.captureCanvas.width=image.width;camera.captureCanvas.height=image.height;
      camera.captureCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.pixels),image.width,image.height),0,0);
      const small=camera.captureGuideImage(image),guide=await PixelStow.scanScaleGuide(small.pixels,small.width,small.height);
      const metadata=await PixelStow.inspect(image.pixels,image.width,image.height,{nativeOnly:true});
      return {scale:guide?guide.scale*image.width/small.width:null,amplitude:metadata.scalePilotAmplitude,
        payloadVerified:metadata.found&&!metadata.unreadable};
    },relative);
    assert(measured.scale!==null&&Math.abs(measured.scale-1)<.03);assert.equal(measured.amplitude,16);assert(measured.payloadVerified);
    console.log('PASS: supplied photo in actual browser Canvas/camera-thumbnail/guide worker: '+JSON.stringify(measured));
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}

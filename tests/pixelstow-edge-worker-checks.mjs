// Browser/worker integration for the subtle edge guide. Public synthetic pixels only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT
  ?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root))throw Error('Outside test directory');
    const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,
    ...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage(),errors=[],failed=[],workers=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
  page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('worker',worker=>workers.push(worker.url()));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  const result=await page.evaluate(async()=>{
    if(!window.PixelStowEdgeGuide?.apply||!PixelStow.scanEdgeGuide)throw Error('The edge-guide module did not load.');
    if(camera.scaleGuideEnabled!==false)throw Error('The old full-image pilot must remain disabled.');
    const guideRequests=[],post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(data,...transfer){
      if(data.operation==='edge-guide')guideRequests.push({reduction:data.reduction,maxMilliseconds:data.maxMilliseconds});
      return post.call(this,data,...transfer);
    };
    const w=800,h=600,pixels=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set([
      Math.round(110+18*Math.sin(x/70)),Math.round(128+9*Math.cos(y/63)),140,255
    ],(x+y*w)*4);
    const original=pixels.slice(),content={text:'Public edge-guide browser worker payload.',attachments:[]};
    const encoded=await PixelStow.encodePayload(pixels,w,h,content,'');
    if(!encoded.edgeGuide||encoded.scalePilot||encoded.scalePilotAmplitude)throw Error('Default V5 must write the edge guide without the old full-image pilot.');
    const png=await PixelStow.writePng(encoded.pixels,w,h);
    const stored=await PixelStow.decodePng(new Uint8Array(await png.arrayBuffer()));
    const native=await PixelStow.decode(stored.pixels,w,h,'',{nativeOnly:true});
    const clean=await PixelStow.extractCarrier(stored.pixels,w,h,encoded.strength,{worker:false});
    const workerClean=await PixelStow.extractCarrier(stored.pixels,w,h,encoded.strength,{background:true});
    const photo=await PixelStowSizing.resize(stored,1096,822),before=photo.pixels.slice();
    const hint=await PixelStow.scanEdgeGuide(photo.pixels,photo.width,photo.height,
      {reduction:4,maxMilliseconds:1000,deadline:Date.now()+1000});
    if(!hint)return {hint:false,encodedEdgeGuide:encoded.edgeGuide};
    const fileHint=await PixelStow.scanEdgeGuide(photo.pixels,photo.width,photo.height);
    const scan=await PixelStow.scanMarkers(photo.pixels,photo.width,photo.height,
      {scaleGuide:hint,deadline:Date.now()+24000});
    const read=await PixelStow.readMarkerCandidates(photo.pixels,photo.width,photo.height,scan,
      {resumeDiscovery:true,deadline:Date.now()+30000});
    const decoded=await PixelStow.decode(photo.pixels,photo.width,photo.height,'');
    const rotated=new Uint8Array(photo.pixels.length);
    for(let y=0;y<photo.height;y++)for(let x=0;x<photo.width;x++)
      rotated.set(photo.pixels.subarray((x+y*photo.width)*4,(x+y*photo.width)*4+4),
        (photo.height-1-y+x*photo.height)*4);
    const turnedHint=await PixelStow.scanEdgeGuide(rotated,photo.height,photo.width,{maxMilliseconds:2000});
    const turnedScan=await PixelStow.scanMarkers(rotated,photo.height,photo.width,
      {scaleGuide:turnedHint,calibratedOnly:true,deadline:Date.now()+12000});
    const turnedRead=await PixelStow.readMarkerCandidates(rotated,photo.height,photo.width,turnedScan,
      {calibratedOnly:true,resumeDiscovery:false,deadline:Date.now()+20000});
    const frozen=await PixelStow.decodePng(new Uint8Array(await(await fetch('./tests/fixtures/public-v5-before-scale-pilot.png')).arrayBuffer()));
    const old=await PixelStow.decode(frozen.pixels,frozen.width,frozen.height,'',{nativeOnly:true});
    const controller=new AbortController();
    const pending=PixelStow.scanEdgeGuide(photo.pixels,photo.width,photo.height,
      {signal:controller.signal,maxMilliseconds:1000});
    controller.abort();let aborted=false;
    try{await pending;}catch(error){aborted=error.name==='AbortError';}
    Worker.prototype.postMessage=post;
    return{
      hint:true,kind:hint.kind,confirmed:hint.confirmed,scale:hint.scale,reduction:hint.reduction,
      hintDimensions:hint.width===photo.width&&hint.height===photo.height,
      markers:scan.markers.filter(marker=>marker.verification==='header').length,
      guided:scan.scaleGuide?.kind==='edge',read:read.found&&!read.unreadable,
      exact:PixelStow.payloadsEqual(decoded,content),nativeExact:PixelStow.payloadsEqual(native,content),
      nativeEdgeGuide:native.edgeGuide,nativePilot:native.scalePilot,
      sameRemoval:workerClean.every((value,index)=>value===clean[index]),
      intact:photo.pixels.every((value,index)=>value===before[index]),
      originalIntact:pixels.every((value,index)=>value===original[index]),
      oldExact:old.text==='Public V5 compatibility fixture before the scale pilot.',
      oldEdgeGuide:Boolean(old.edgeGuide),oldPilot:Boolean(old.scalePilot),aborted,
      turned:turnedHint?.detected&&Math.abs(turnedHint.orientation-Math.PI/2)<.02&&
        turnedRead.found&&!turnedRead.unreadable&&turnedRead.calibration.used,
      guideRequest:guideRequests[0],fileGuideRequest:guideRequests[1],fileHint:Boolean(fileHint)
    };
  });
  assert(result.hint,'actual browser guide worker must detect the encoded calibration');
  assert.equal(result.kind,'edge');assert.equal(result.confirmed,false);
  assert(Math.abs(result.scale/1.37-1)<.03,'measured capture scale must be within 3%');
  assert.equal(result.reduction,4);assert(result.hintDimensions&&result.guided);
  assert.deepEqual(result.guideRequest,{reduction:4,maxMilliseconds:1000},'the actual guide worker receives the selected sampling reduction and time budget');
  assert(result.fileHint);assert.equal(result.fileGuideRequest.maxMilliseconds,6000,'file calibration gets a device-tolerant budget; explicit live budgets remain unchanged');
  assert.equal(result.markers,4);assert(result.read&&result.exact&&result.nativeExact);
  assert(result.nativeEdgeGuide&&!result.nativePilot&&result.sameRemoval);
  assert(result.oldExact&&!result.oldEdgeGuide&&!result.oldPilot);
  assert(result.originalIntact&&result.intact&&result.aborted);
  assert(result.turned,'rotated guide vectors must reach real marker/payload workers on the single calibrated grid');
  assert(workers.length>=4,'guide, markers, payload and source inverse must exercise actual browser workers');
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  console.log('PASS: page/module and actual edge-guide/marker/payload workers, one 4× reduction, 1.37× scale, exact default V5 PNG payload and identical main/worker source inverse');
  console.log('PASS: frozen pre-guide V5 remains readable; cancellation preserves both captured and original pixels; no JavaScript errors or failed page/worker requests');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}

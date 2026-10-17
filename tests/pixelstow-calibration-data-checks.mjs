// Calibration is evidence, not payload validation; report the winning path.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
globalThis.window={};
for(const name of ['pixelstow-spectrum.js','pixelstow-edge-guide.js','pixelstow-transform.js','pixelstow.js','pixelstow-sizing.js','pixelstow-camera.js'])
  (0,eval)(await fs.readFile(name,'utf8'));
const c=window.PixelStow,w=800,h=600,pixels=new Uint8Array(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set([110+Math.round(18*Math.sin(x/70)),128,140,255],(x+y*w)*4);
const content={text:'Public calibration diagnostics regression.',attachments:[]};
const encoded=await c.encodePayload(pixels,w,h,content,'');
const direct=await c.inspect(encoded.pixels,w,h,{nativeOnly:true});
assert(direct.found);assert.equal(direct.calibration.status,'not-checked');
assert.equal(direct.calibration.used,false);assert.equal(direct.calibration.method,'native');
const hint=await c.scanEdgeGuide(encoded.pixels,w,h,{worker:false});
assert(hint?.detected&&hint.corners.length===4);
const native=await c.scanMarkers(encoded.pixels,w,h,{worker:false,scaleGuide:hint,deadline:Date.now()+20000});
assert.equal(native.calibration.status,'detected');assert.equal(native.calibration.method,'native');
assert.equal(native.calibration.used,false);assert.equal(native.calibration.attempted,false);
assert.deepEqual(native.scaleGuide.corners,hint.corners);
console.log('PASS: native success is distinguished from a detected but unused calibration hint');

const photo=await window.PixelStowSizing.resize(encoded,1096,822);
const measured=await c.scanEdgeGuide(photo.pixels,photo.width,photo.height,{worker:false});
assert(measured?.detected);
const scan=await c.scanMarkers(photo.pixels,photo.width,photo.height,{worker:false,scaleGuide:measured,deadline:Date.now()+24000});
assert(scan.candidates.length);assert(scan.calibration.attempted);
const read=await c.readMarkerCandidates(photo.pixels,photo.width,photo.height,scan,{worker:false,resumeDiscovery:true});
assert(read.found&&!read.unreadable);assert.equal(read.calibration.status,'detected');
assert.equal(read.calibration.used,true);assert.equal(read.calibration.method,'guide');
assert.equal(read.calibration.attempted,true);assert.deepEqual(read.scaleGuide.corners,measured.corners);
const decoded=await c.decode(photo.pixels,photo.width,photo.height,'');
assert(c.payloadsEqual(decoded,content));assert.deepEqual(decoded.calibration,read.calibration);
assert.deepEqual(decoded.scaleGuide.corners,measured.corners);
console.log('PASS: a winning guided grid preserves captured evidence through inspection and cached decode');

for(let turns=1;turns<4;turns++) {
  const W=turns%2?photo.height:photo.width,H=turns%2?photo.width:photo.height,pixels=new Uint8Array(photo.pixels.length);
  for(let y=0;y<photo.height;y++)for(let x=0;x<photo.width;x++) {
    const [u,v]=turns===1?[photo.height-1-y,x]:turns===2?[photo.width-1-x,photo.height-1-y]:[y,photo.width-1-x];
    pixels.set(photo.pixels.subarray((x+y*photo.width)*4,(x+y*photo.width)*4+4),(u+v*W)*4);
  }
  const guide=await c.scanEdgeGuide(pixels,W,H,{worker:false,maxMilliseconds:2000});
  assert(guide?.detected,`rotated calibration ${turns}`);
  const scan=await c.scanMarkers(pixels,W,H,{worker:false,scaleGuide:guide,calibratedOnly:true,deadline:Date.now()+12000});
  const read=await c.readMarkerCandidates(pixels,W,H,scan,{worker:false,calibratedOnly:true,resumeDiscovery:false,deadline:Date.now()+20000});
  assert(read.found&&!read.unreadable,`rotated guide ${turns} must lead to verified contents`);
  assert.equal(read.calibration.method,'guide');assert(read.calibration.used);
  const expected=guide.corners.map(p=>({...p}));
  assert.deepEqual(read.scaleGuide.corners,expected,'native capture coordinates survive working-grid recovery');
  assert(c.payloadsEqual(await c.decode(pixels,W,H,''),content));
}
console.log('PASS: the rotated calibration vectors lead to real marker and payload reads on one guided grid in every orientation');

// Trace a slanted guide into the actual marker sampler, rather than checking
// only the angle of a diagnostic polygon. These are public generated pixels.
for(const angle of [-7,7]) {
  const scale=1.37,a=angle*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a);
  const W=Math.ceil(scale*(w*cs+h*Math.abs(sn)))+48,H=Math.ceil(scale*(h*cs+w*Math.abs(sn)))+48;
  const pixels=new Uint8Array(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
    const i=(x+y*W)*4,dx=(x-(W-1)/2)/scale,dy=(y-(H-1)/2)/scale;
    const u=cs*dx+sn*dy+(w-1)/2,v=-sn*dx+cs*dy+(h-1)/2;
    if(u<0||v<0||u>w-1||v>h-1){pixels.set([24,25,28,255],i);continue;}
    const ix=Math.floor(u),iy=Math.floor(v),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=u-ix,fy=v-iy;
    for(let k=0;k<4;k++)pixels[i+k]=Math.round(
      (encoded.pixels[(ix+iy*w)*4+k]*(1-fx)+encoded.pixels[(jx+iy*w)*4+k]*fx)*(1-fy)+
      (encoded.pixels[(ix+jy*w)*4+k]*(1-fx)+encoded.pixels[(jx+jy*w)*4+k]*fx)*fy);
  }
  const guide=await c.scanEdgeGuide(pixels,W,H,{worker:false,maxMilliseconds:3000});
  assert(guide?.detected,`slanted calibration ${angle}`);
  assert(Math.abs(guide.orientation-a)<.025);
  const scan=await c.scanMarkers(pixels,W,H,{worker:false,scaleGuide:guide,calibratedOnly:true,deadline:Date.now()+12000});
  const read=await c.readMarkerCandidates(pixels,W,H,scan,{worker:false,calibratedOnly:true,resumeDiscovery:false,deadline:Date.now()+20000});
  assert(read.found&&!read.unreadable,`slanted vector ${angle} must lead to verified contents`);
  assert(read.calibration.used);assert.equal(read.calibration.method,'guide');
  assert(c.payloadsEqual(await c.decode(pixels,W,H,''),content));
}
console.log('PASS: positive and negative guide angles survive working-grid conversion and lead to verified payloads');

// Reuse real verified native geometry, with a weaker guide candidate ranked
// behind it. The successful ordinary candidate must remain ordinary.
const fallbackScan={...native,candidates:native.candidates.map(candidate=>({...candidate,
  calibration:{status:'detected',attempted:true,used:false,method:'fallback'}})),
  calibration:{status:'detected',attempted:true,used:true,method:'guide'}};
const fallback=await c.readMarkerCandidates(encoded.pixels,w,h,fallbackScan,{worker:false});
assert(fallback.found&&!fallback.unreadable);assert.equal(fallback.calibration.used,false);
assert.equal(fallback.calibration.method,'fallback');assert.equal(fallback.calibration.attempted,true);
assert.equal(fallback.calibration.status,'detected');
console.log('PASS: detecting or attempting a guide does not label an ordinary winning fit as guide-assisted');

const camera=Object.create(window.PixelStowCamera.prototype);
const early={...fallback,scaleGuide:undefined,calibration:{status:'not-checked',attempted:false,used:false,method:'fallback'}};
const late={scaleGuide:hint,guideChecked:true};camera.preserveCalibration(late,early);
assert.equal(early.calibration.status,'detected');assert.equal(early.calibration.used,false);
assert.equal(early.calibration.attempted,false);assert.equal(early.scaleGuide,hint);
fallback.scaleGuide=undefined;
fallback.calibration={status:'not-checked',attempted:false,used:false,method:'fallback'};
camera.preserveCalibration(late,fallback);
const lateDecoded=await c.decode(encoded.pixels,w,h,'');
assert(c.payloadsEqual(lateDecoded,content));assert.equal(lateDecoded.calibration.status,'detected');
assert.equal(lateDecoded.calibration.used,false);assert.deepEqual(lateDecoded.scaleGuide.corners,hint.corners);
const missed={calibration:{status:'not-checked',attempted:false,used:false}};
camera.preserveCalibration({guideChecked:true},missed);assert.equal(missed.calibration.status,'not-detected');
console.log('PASS: late same-frame camera hints and completed misses remain distinct from hints used by a reader');

const transform=window.PixelStowTransform,find=transform.find,calls=[];
try {
  transform.find=async(...args)=>{calls.push({width:args[1],height:args[2],options:args[3]});return find.apply(transform,args);};
  const only=await c.scanMarkers(photo.pixels,photo.width,photo.height,{worker:false,scaleGuide:measured,
    calibratedOnly:true,deadline:Date.now()+8000});
  assert.equal(calls.length,1,'a positive camera calibration uses one detector grid');
  assert.equal(only.searchState.sizes.length,1);assert.equal(only.searchState.pending.length,0);
  assert(only.calibratedOnly&&only.calibration.attempted&&only.calibration.used);
  assert(Math.abs(calls[0].width/w-1)<.03);
  const onlyRead=await c.readMarkerCandidates(photo.pixels,photo.width,photo.height,only,{worker:false,calibratedOnly:true,resumeDiscovery:true});
  assert(onlyRead.found&&!onlyRead.unreadable);assert.equal(calls.length,1);
  transform.find=async(...args)=>{calls.push({width:args[1],height:args[2],options:args[3]});return{found:false,candidates:[],markers:[]};};
  calls.length=0;
  const misleading={...measured,scale:2,fx:1/256,fy:0};
  const miss=await c.scanMarkers(photo.pixels,photo.width,photo.height,{worker:false,scaleGuide:misleading,calibratedOnly:true,deadline:Date.now()+8000});
  assert.equal(calls.length,1);assert.equal(miss.searchState.pending.length,0);assert.equal(miss.candidates.length,0);
  await c.readMarkerCandidates(photo.pixels,photo.width,photo.height,{...miss,searchState:{...miss.searchState,pending:[0]}},
    {worker:false,resumeDiscovery:true});
  assert.equal(calls.length,1,'failed calibrated frames cannot resume ordinary marker discovery');
  calls.length=0;
  const skipped=await c.scanMarkers(photo.pixels,photo.width,photo.height,{worker:false,scaleGuide:false,calibratedOnly:true});
  assert.equal(calls.length,0);assert(!skipped.found);
  await c.scanMarkers(photo.pixels,photo.width,photo.height,{worker:false,scaleGuide:false,stopOnHighConfidence:false,deadline:Date.now()+8000});
  assert(calls.length>1,'file imports and explicitly ordinary fallback retain the complete scale pyramid');
}finally{transform.find=find;}
console.log('PASS: camera calibration checks exactly one grid, drops failed calibrated frames, and preserves ordinary/manual multi-scale fallback');

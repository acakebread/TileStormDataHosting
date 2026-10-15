// Real V5 writer, Fourier guide, photographed grids and pre-pilot public fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
globalThis.window={};
for(const name of ['pixelstow-spectrum.js','pixelstow-transform.js','pixelstow.js','pixelstow-sizing.js']){
  let source=await fs.readFile(name,'utf8');
  if(name==='pixelstow.js')source=source.replace('root.PixelStow = {','root.pilotChecks = {applyScalePilot,linearRange}; root.PixelStow = {');
  (0,eval)(source);
}
const c=window.PixelStow,S=window.PixelStowSizing,I=window.pilotChecks,w=800,h=600;
const source=new Uint8Array(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)source.set([Math.round(110+18*Math.sin(x/70)),128,140,201],(x+y*w)*4);
let seed=313;
const bytes=Uint8Array.from({length:900},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
const content={text:'Public V5 scale-pilot fixture.',attachments:[{name:'public.bin',type:'application/octet-stream',bytes}]};
const original=source.slice(),encoded=await c.encodePayload(source,w,h,content,'');
assert(encoded.scalePilot);assert.equal(encoded.scalePilotAmplitude,16);assert.deepEqual(source,original);
const png=await c.decodePng(new Uint8Array(await(await c.writePng(encoded.pixels,w,h)).arrayBuffer()));
const decoded=await c.decode(png.pixels,w,h,'',{nativeOnly:true});
assert(decoded.scalePilot);assert.equal(decoded.scalePilotAmplitude,16);assert.equal(decoded.rangeHeadroom,encoded.rangeHeadroom);assert(c.payloadsEqual(decoded,content));
const reference=I.linearRange(source,encoded.rangeHeadroom),painted=I.applyScalePilot(reference,w);
assert.deepEqual(I.applyScalePilot(painted,w,true),reference);
assert(painted.every((value,i)=>i%4===3?value===reference[i]:Math.abs(value-reference[i])<=16));
const extracted=await c.extractCarrier(png.pixels,w,h,encoded.strength);
let error=0;for(let i=0;i<source.length;i++){if(i%4===3)assert.equal(extracted[i],source[i]);else error+=Math.abs(extracted[i]-source[i]);}
assert(error/(w*h*3)<2,'source extraction removes the pilot before restoring RGB range');
console.log('PASS: default V5 pilot flag/PNG/payload, bounded reversible signal, source/alpha preservation and source removal');

for(const scale of [.73,1,1.37,2.1]){
  const photo=await S.resize(encoded,Math.round(w*scale),Math.round(h*scale));
  const guide=await c.scanScaleGuide(photo.pixels,photo.width,photo.height,{worker:false});
  assert(guide?.detected && !guide.confirmed);
  assert(Math.abs(guide.scale/scale-1)<.03,'known native pitch estimates an arbitrary capture scale');
}
const controller=new AbortController();controller.abort();
await assert.rejects(()=>c.scanScaleGuide(encoded.pixels,w,h,{worker:false,signal:controller.signal}),{name:'AbortError'});
for(const kind of ['flat','gradient','stripes','noise','wrong-phase']){
  const negative=new Uint8Array(w*h*4);let n=937;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    n^=n<<13;n^=n>>>17;n^=n<<5;
    const v=kind==='flat'?128:kind==='gradient'?50+160*x/w:kind==='stripes'?128+25*Math.cos(2*Math.PI*x/40):
      kind==='wrong-phase'?128+12*Math.cos(2*Math.PI*2*x/256)+10*Math.cos(2*Math.PI*3*x/256)+8*Math.cos(2*Math.PI*5*x/256+3):80+(n>>>0)%96;
    negative.set([v,v,v,255],(x+y*w)*4);
  }
  assert.equal(await c.scanScaleGuide(negative,w,h,{worker:false}),null,kind+' cannot confirm a pilot');
}
console.log('PASS: measured pilot guides non-power-of-two scales; ordinary flat/gradient/stripe/noise controls and cancellation retain safe fallback');

// Broad low-frequency photo-like structure, independent of the pilot's periods
// and phases. Keep these public procedural negatives alongside the real-photo
// local checks so relaxing thresholds cannot silently accept arbitrary scenery.
for(let variant=0;variant<12;variant++){
  let state=731+variant*37;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const waves=Array.from({length:8},()=>({fx:(random()-.5)/24,fy:(random()-.5)/24,phase:random()*Math.PI*2,gain:4+random()*18}));
  const landscape=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const value=128+waves.reduce((sum,t)=>sum+t.gain*Math.sin(2*Math.PI*(t.fx*x+t.fy*y)+t.phase),0);
    landscape.set([Math.round(value),Math.round(value*.8+24),Math.round(value*.6+43),255],(x+y*w)*4);
  }
  assert.equal(await c.scanScaleGuide(landscape,w,h,{worker:false}),null,'structured unencoded control '+variant);
}
console.log('PASS: twelve broad-spectrum unencoded landscapes and a wrong phase-code control do not trigger the relaxed guide');

// The guide is measured again by the real reader, not supplied as an exact fit.
const photo=await S.resize(encoded,1096,822),photoBefore=photo.pixels.slice();
const guided=await c.scanMarkers(photo.pixels,photo.width,photo.height,{worker:false,deadline:Date.now()+24000});
assert(guided.scaleGuide?.detected);assert.equal(guided.markers.filter(m=>m.verification==='header').length,4);
assert(guided.candidates.some(f=>Math.abs(f.localizationResolution.width/w-1)<.03));
const inspected=await c.readMarkerCandidates(photo.pixels,photo.width,photo.height,guided,{worker:false,resumeDiscovery:true});
assert(inspected.found&&!inspected.unreadable);
assert(c.payloadsEqual(await c.decode(photo.pixels,photo.width,photo.height,''),content));
assert.deepEqual(photo.pixels,photoBefore);
// A quarter turn moves the one-axis pilot to the other FFT axis.
const turned=new Uint8Array(encoded.pixels.length);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)turned.set(encoded.pixels.subarray((x+y*w)*4,(x+y*w)*4+4),((h-1-y)+x*h)*4);
const turnedGuide=await c.scanScaleGuide(turned,h,w,{worker:false});
assert(turnedGuide?.detected&&Math.abs(turnedGuide.scale-1)<.03);
assert(Math.abs(turnedGuide.fy)>Math.abs(turnedGuide.fx)*10);
// Bilinear camera-like resampling with both tilt and a surrounding dark frame.
const tw=1024,th=800,tilted=new Uint8Array(tw*th*4),angle=12*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle),tiltScale=1.1;
for(let y=0;y<th;y++)for(let x=0;x<tw;x++){
  const u=((x-tw/2)*cs+(y-th/2)*sn)/tiltScale+w/2,v=(-(x-tw/2)*sn+(y-th/2)*cs)/tiltScale+h/2,i=(x+y*tw)*4;
  tilted.set([40,40,40,255],i);if(u<0||v<0||u>w-1||v>h-1)continue;
  const ix=Math.floor(u),iy=Math.floor(v),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=u-ix,fy=v-iy;
  for(let k=0;k<3;k++)tilted[i+k]=Math.round((encoded.pixels[(ix+iy*w)*4+k]*(1-fx)+encoded.pixels[(jx+iy*w)*4+k]*fx)*(1-fy)+
    (encoded.pixels[(ix+jy*w)*4+k]*(1-fx)+encoded.pixels[(jx+jy*w)*4+k]*fx)*fy);
}
const tiltGuide=await c.scanScaleGuide(tilted,tw,th,{worker:false});
assert(tiltGuide?.detected&&Math.abs(tiltGuide.scale/tiltScale-1)<.03);
assert(Math.abs(Math.atan2(tiltGuide.fy,tiltGuide.fx)-angle)<.03);
console.log('PASS: real pilot-guided payload recovery preserves the capture; quarter-turn and tilted/padded captures retain the scale guide');

const old=await c.decodePng(new Uint8Array(await fs.readFile('tests/fixtures/public-v5-before-scale-pilot.png')));
const oldDecoded=await c.decode(old.pixels,old.width,old.height,'',{nativeOnly:true});
assert.equal(oldDecoded.text,'Public V5 compatibility fixture before the scale pilot.');assert.equal(oldDecoded.scalePilot,false);
assert.equal(await c.scanScaleGuide(old.pixels,old.width,old.height,{worker:false}),null);
const oldClean=await c.extractCarrier(old.pixels,old.width,old.height,oldDecoded.strength);
let oldError=0;for(let i=0;i<oldClean.length;i++){if(i%4===3)assert.equal(oldClean[i],201);else oldError+=Math.abs(oldClean[i]-[118,132,146][i%4]);}
assert(oldError/(old.width*old.height*3)<3);
// Keep an established baseline case: added padding, without the new pilot.
// Very high-redundancy flat carriers at 1.37x can miss even in the old reader.
const oldPhoto={width:864,height:664,pixels:new Uint8Array(864*664*4)};
for(let i=0;i<oldPhoto.pixels.length;i+=4)oldPhoto.pixels.set([40,40,40,255],i);
for(let y=0;y<old.height;y++)oldPhoto.pixels.set(old.pixels.subarray(y*old.width*4,(y+1)*old.width*4),((y+32)*oldPhoto.width+32)*4);
const oldScan=await c.scanMarkers(oldPhoto.pixels,oldPhoto.width,oldPhoto.height,{worker:false,deadline:Date.now()+24000});
assert(!oldScan.scaleGuide);
const oldInspection=await c.readMarkerCandidates(oldPhoto.pixels,oldPhoto.width,oldPhoto.height,oldScan,{worker:false,resumeDiscovery:true});
assert(oldInspection.found&&!oldInspection.unreadable);
assert.equal((await c.decode(oldPhoto.pixels,oldPhoto.width,oldPhoto.height,'')).text,oldDecoded.text);
console.log('PASS: frozen pre-pilot V5 PNG decodes/reconstructs unchanged and its padded capture opens through ordinary marker recovery');

const weak=await c.decodePng(new Uint8Array(await fs.readFile('tests/fixtures/public-v5-three-level-pilot.png')));
const weakDecoded=await c.decode(weak.pixels,weak.width,weak.height,'',{nativeOnly:true});
assert.equal(weakDecoded.text,'Public V5 original three-level pilot compatibility.');
assert.equal(weakDecoded.scalePilotAmplitude,3);assert(weakDecoded.scalePilot);
const weakClean=await c.extractCarrier(weak.pixels,weak.width,weak.height,weakDecoded.strength);
let weakError=0;for(let i=0;i<weakClean.length;i++){if(i%4===3)assert.equal(weakClean[i],source[i]);else weakError+=Math.abs(weakClean[i]-source[i]);}
assert(weakError/(w*h*3)<2,'old three-level images must remove their original pilot, not the new sixteen-level wave');
console.log('PASS: frozen three-level V5 pilot decodes and reconstructs with its original amplitude');

// Even a perfect isolated pilot is insufficient to establish encoding.
const pilotOnly=I.applyScalePilot(reference,w);
assert((await c.scanScaleGuide(pilotOnly,w,h,{worker:false}))?.detected);
const emptyScan=await c.scanMarkers(pilotOnly,w,h,{worker:false,deadline:Date.now()+10000});
assert(!emptyScan.markers.length&&!emptyScan.candidates.length&&!emptyScan.highConfidence);
assert(!(await c.readMarkerCandidates(pilotOnly,w,h,emptyScan,{worker:false})).found);
console.log('PASS: a physically present pilot without real carrier markers cannot confirm encoding or open a payload');

// Observe working grids without substituting marker or payload acceptance.
const find=window.PixelStowTransform.find,calls=[];
window.PixelStowTransform.find=async(p,width,height,options)=>{calls.push({width,height,options});return {markers:[],candidates:[],geometry:null};};
try{
  const blank=new Uint8Array(w*h*4);
  const badHint={detected:true,scale:1.37,width:w,height:h,fx:1/(128*1.37),fy:0};
  const scan=await c.scanMarkers(blank,w,h,{worker:false,scaleGuide:badHint,deadline:Date.now()+10000});
  assert.deepEqual([calls[0].width,calls[0].height],[Math.round(w/1.37),Math.round(h/1.37)]);
  for(const size of [[200,150],[400,300],[800,600]])assert(calls.some(v=>v.width===size[0]&&v.height===size[1]),'a false pilot must retain every original pyramid size');
  assert(!scan.highConfidence && !scan.candidates.length);
  assert(calls.every(v=>!v.options.forceSearch),'a guide must not force the ordinary fallback past its frequency gate');
  assert(scan.searchState.sizes.some(s=>s.guided));
}finally{window.PixelStowTransform.find=find;}
console.log('PASS: a guide adds an arbitrary initial grid, preserves all original scales/search state, and cannot establish a marker fit or force ordinary fallback');

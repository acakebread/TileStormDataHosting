// Public procedural carrier: exercise the actual default writer and reader.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
globalThis.window={};
for(const name of ['pixelstow-spectrum.js','pixelstow-edge-guide.js','pixelstow-transform.js','pixelstow.js','pixelstow-sizing.js'])
  (0,eval)(await fs.readFile(name,'utf8'));
const c=window.PixelStow,G=window.PixelStowEdgeGuide,w=800,h=600,source=new Uint8Array(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)source.set([Math.round(110+18*Math.sin(x/70)),128,140,201],(x+y*w)*4);
let seed=313;
const bytes=Uint8Array.from({length:900},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
const content={text:'Public V5 subtle edge-guide regression.',attachments:[{name:'public.bin',type:'application/octet-stream',bytes}]};
const before=source.slice(),encoded=await c.encodePayload(source,w,h,content,''),off=await c.encodePayload(source,w,h,content,'',{edgeGuide:false});
assert(encoded.edgeGuide&&!encoded.scalePilot);assert.equal(encoded.carrierVersion,5);
assert.equal(encoded.rangeHeadroom,off.rangeHeadroom);assert.equal(encoded.repetitionRatio,off.repetitionRatio);
const apply=G.apply;let unpainted,painted;
try{
  G.apply=(pixels,width,height,options)=>{unpainted=pixels.slice();painted=apply(pixels,width,height,options);return painted;};
  await c.encodePayload(source,w,h,content,'');
}finally{G.apply=apply;}
let changes=0;
for(let i=0;i<painted.length;i++){
  if(i%4===3)assert.equal(encoded.pixels[i],source[i]);
  else{assert(Math.abs(painted[i]-unpainted[i])<=2);if(painted[i]!==unpainted[i])changes++;}
}
assert(changes>0);assert.deepEqual(apply(painted,w,h,{inverse:true}),unpainted);
assert.deepEqual(source,before);
console.log('PASS: default V5 guide changes at most two RGB levels, preserves alpha/input, reverses exactly and costs no extra headroom or capacity');

const reopened=await c.decodePng(new Uint8Array(await(await c.writePng(encoded.pixels,w,h)).arrayBuffer()));
const decoded=await c.decode(reopened.pixels,w,h,'',{nativeOnly:true});
assert(decoded.edgeGuide&&!decoded.scalePilot&&c.payloadsEqual(decoded,content));
const scan=await c.scanMarkers(reopened.pixels,w,h,{worker:false,scaleGuide:false,deadline:Date.now()+24000});
assert.equal(scan.markers.filter(m=>m.verification==='header').length,4);
const read=await c.readMarkerCandidates(reopened.pixels,w,h,scan,{worker:false});
assert(read.edgeGuide&&read.found&&!read.unreadable);
const clean=await c.extractCarrier(reopened.pixels,w,h,encoded.strength);
let error=0;for(let i=0;i<clean.length;i++)if(i%4===3)assert.equal(clean[i],source[i]);else error+=Math.abs(clean[i]-source[i]);
assert(error/(w*h*3)<2);
await assert.rejects(()=>c.encodePayload(encoded.pixels,w,h,content,''),/already contains/);
console.log('PASS: PNG round-trip, all four CRC marker headers, exact binary payload, guide metadata and source extraction');

const locked=await c.encodePayload(source,w,h,content,'public-test-passphrase');
const inspection=await c.inspect(locked.pixels,w,h,{nativeOnly:true});
assert(inspection.found&&inspection.passwordProtected&&inspection.edgeGuide);
assert.equal((await c.decode(locked.pixels,w,h,'wrong-public-test',{nativeOnly:true})).status,'incorrect');
assert(c.payloadsEqual(await c.decode(locked.pixels,w,h,'public-test-passphrase',{nativeOnly:true}),content));
await assert.rejects(()=>c.encodePayload(locked.pixels,w,h,content,''),/already contains/);
for(const [file,text]of [['public-v5-before-scale-pilot.png','Public V5 compatibility fixture before the scale pilot.'],
  ['public-v5-three-level-pilot.png','Public V5 original three-level pilot compatibility.'],
  ['public-v5-sixteen-level-pilot.png','Public V5 sixteen-level pilot compatibility.']]){
  const image=await c.decodePng(new Uint8Array(await fs.readFile('tests/fixtures/'+file)));
  const result=await c.decode(image.pixels,image.width,image.height,'',{nativeOnly:true});
  assert.equal(result.text,text);assert.equal(result.edgeGuide,false);
}
for(const version of [1,3,4]){
  c.setCarrierVersion(version);
  const old=await c.encodePayload(source,w,h,content,'');
  assert.equal(old.carrierVersion,version);assert.equal(old.edgeGuide,false);
}
c.setCarrierVersion(5);
const pilot=await c.encodePayload(source,w,h,content,'',{scalePilot:true});
assert(pilot.scalePilot&&!pilot.edgeGuide);
console.log('PASS: locked metadata/passwords/re-encode protection, frozen V5 compatibility, older writers and explicit historical pilot');

const controller=new AbortController();controller.abort();
await assert.rejects(()=>c.scanEdgeGuide(encoded.pixels,w,h,{worker:false,signal:controller.signal}),{name:'AbortError'});
const hint=await c.scanEdgeGuide(encoded.pixels,w,h,{worker:false,maxMilliseconds:1000});
assert(hint?.detected&&!hint.confirmed&&hint.kind==='edge');assert(Math.abs(hint.scale-1)<.03);
const guideOnly=apply(source,w,h);
assert(!(await c.inspect(guideOnly,w,h,{nativeOnly:true})).found);
assert.deepEqual(source,before);
console.log('PASS: public guide API, bounded scale estimate, cancellation, and a guide alone cannot open a payload');

// Existing core-only consumers keep writing the old profile. An explicit guide
// request and source removal must not silently omit the missing format helper.
try{
  delete window.PixelStowEdgeGuide;
  await assert.rejects(()=>c.encodePayload(source,w,h,content,'',{edgeGuide:true}),/script is missing/);
  const coreOnly=await c.encodePayload(source,w,h,content,'');
  assert.equal(coreOnly.edgeGuide,false);
  assert(c.payloadsEqual(await c.decode(encoded.pixels,w,h,'',{nativeOnly:true}),content));
  await assert.rejects(()=>c.extractCarrier(encoded.pixels,w,h,encoded.strength),/script is missing/);
}finally{window.PixelStowEdgeGuide=G;}
console.log('PASS: core-only writing compatibility and explicit missing-helper errors for guide encoding/source extraction');

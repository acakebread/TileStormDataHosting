// Public synthetic carriers only. This verifies writer behaviour and native
// compatibility, not optical camera/print reliability.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const context=vm.createContext({window:{},Uint8Array,Uint8ClampedArray,TextEncoder,TextDecoder,
 Blob,Response,CompressionStream,DecompressionStream,crypto:webcrypto,setTimeout,DOMException});
vm.runInContext((await fs.readFile('pixelstow.js','utf8')).replace('root.PixelStow = {',
 'root.boostChecks = { locatorLayout, locatorBlockMap, readVisualLocator }; root.PixelStow = {'),context);
const codec=context.window.PixelStow,internals=context.window.boostChecks,w=640,h=480;
let state=127;
function random(){state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;}
const input=new Uint8Array(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
 const value=x<w/2?128:Math.round(128+(random()-.5)*64);
 input.set([value,value,value,119],(x+y*w)*4);
}
const original=input.slice(),bytes=Uint8Array.from({length:1000},()=>Math.floor(random()*256));
function content(length){return{text:'Public adaptive contrast test.',attachments:[{name:'public.bin',type:'application/octet-stream',bytes:bytes.slice(0,length)}]};}
const sparseContent=content(100),denseContent=content(1000);
const sparse=await codec.encodePayload(input,w,h,sparseContent,''),dense=await codec.encodePayload(input,w,h,denseContent,'');
assert(sparse.repetitionRatio>=5);assert(dense.repetitionRatio<2);
function errors(image){
 const sums=[0,0],counts=[0,0];
 for(const block of internals.locatorBlockMap(w,h,Infinity,4)){
  const x=block%(w/4)*4,y=Math.floor(block/(w/4))*4,half=x<w/2?0:1;
  for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){
   const i=(x+dx+(y+dy)*w)*4;sums[half]+=(image.pixels[i]-input[i])**2;counts[half]++;
  }
 }
 return sums.map((v,i)=>Math.sqrt(v/counts[i]));
}
const sparseError=errors(sparse),denseError=errors(dense);
assert(sparseError[1]>sparseError[0]*1.3,'source detail must receive more contrast at the same redundancy');
assert(denseError[0]>sparseError[0]*2,'low redundancy must increase smooth-area strength too');
assert(denseError[1]>sparseError[1]*1.7,'low redundancy must increase textured-area strength');
for(const [image,payload] of [[sparse,sparseContent],[dense,denseContent]]){
 assert.equal(image.carrierVersion,4);
 assert(codec.payloadsEqual(await codec.decode(image.pixels,w,h,'',{nativeOnly:true}),payload));
 for(const patch of internals.locatorLayout(w,h,4)){
  const marker=internals.readVisualLocator(image.pixels,w,h,[1,0,patch.x,0,1,patch.y,0,0,1],patch.id,4);
  assert.equal(marker?.originalWidth,w);assert.equal(marker?.originalHeight,h);
 }
 for(let i=3;i<input.length;i+=4)assert.equal(image.pixels[i],input[i]);
}
assert.deepEqual(input,original);
console.log('PASS: adaptive texture/low-redundancy contrast, all eight CRC headers, exact native payloads and source/alpha preservation');
console.log(JSON.stringify({highRedundancy:sparse.repetitionRatio,lowRedundancy:dense.repetitionRatio,
 highRms:sparseError,lowRms:denseError}));

// Stronger markers must retain the brightness treatment even on clipped input.
for(const colour of [0,255]){
 const flat=new Uint8Array(w*h*4);for(let i=0;i<flat.length;i+=4)flat.set([colour,colour,colour,255],i);
 const image=await codec.encodePayload(flat,w,h,denseContent,'');
 assert(codec.payloadsEqual(await codec.decode(image.pixels,w,h,'',{nativeOnly:true}),denseContent));
 for(const patch of internals.locatorLayout(w,h,4))assert(internals.readVisualLocator(image.pixels,w,h,
  [1,0,patch.x,0,1,patch.y,0,0,1],patch.id,4));
 const extracted=await codec.extractCarrier(image.pixels,w,h,image.strength);
 assert.equal(extracted.length,flat.length);
}
console.log('PASS: boosted clipped-colour markers/payloads and source extraction');

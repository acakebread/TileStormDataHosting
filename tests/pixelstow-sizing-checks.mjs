// Public fixtures only: solve real compressed payload budgets, resize source
// pixels before encoding, and retain exact payload/native-marker verification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.window={};
for(const name of ['pixelstow.js','pixelstow-sizing.js']) (0,eval)(await fs.readFile(name,'utf8'));
const c=window.PixelStow,S=window.PixelStowSizing;
let state=127;
const bytes=Uint8Array.from({length:700},()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state&255;});
const content={text:'Public source sizing check.',attachments:[{name:'public.bin',type:'application/octet-stream',bytes}]};
const frame=await c.estimatePayloadFrame(content);
assert(frame.framedBytes>700);
const large=S.plan(4032,3024,frame.framedBytes);
assert(large.fits && large.width===4032 && large.height===3024);
assert(Math.abs(large.width/large.height-4/3)<.01);
const down=S.plan(4032,3024,frame.framedBytes,.4);
assert(down.fits && down.width<large.width && down.height<large.height);
assert(S.prognosis(down,.8)<S.prognosis(large,.8),'a smaller native grid must improve the camera sampling prognosis');
assert(S.prognosis(down,0)<S.prognosis(down,1),'stronger wavelets must improve prognosis on the same grid');
assert.equal(S.plan(4032,3024,frame.framedBytes,2).width,4032,'the prognosis must not enlarge a source that already fits');
// Exercise limits with uncompressible framed lengths independently of a fixture's compression.
const limited=S.plan(5712,4284,100000);
assert(limited.fits && limited.limited);
assert(limited.width*limited.height<=c.getLimits().encodingPixels);
assert(!S.plan(640,480,1040000).fits);
const tiny=await c.estimatePayloadFrame({text:'x',attachments:[]});
const enlargedPlan=S.plan(16,16,tiny.framedBytes);
assert(enlargedPlan.fits && enlargedPlan.forcedUpscale,'small raw sources can be enlarged to fit the actual markers and payload');
assert.equal(enlargedPlan.minimum.width,enlargedPlan.maximum.width,'forced enlargement stops as soon as the payload fits');
const fixed=c.repetitionForFrame(640,480,frame.framedBytes);
const best=S.qualityForTarget(fixed,0),worst=S.qualityForTarget(fixed,1);
assert.equal(best.risk,best.min);assert.equal(worst.risk,worst.max);
assert(best.quality<=worst.quality && best.risk>=.04);
const full=c.repetitionForFrame(640,480,2000);
assert(!full.fits);assert.equal(S.qualityForTarget(full,0).risk,.99);
console.log('PASS: payload sets minimum dimensions; a prognosis gesture may downscale but only payload capacity can require enlargement; fixed-grid quality targets are bounded');

for (const version of [1, 4, 5]) for (const quality of [0, .8, 1]) {
  for (const framedBytes of [256, 5240, 70000]) {
    const endpoint = S.plan(1280, 960, framedBytes, 1, version);
    assert(endpoint.fits);
    const min=S.prognosis(endpoint.minimum,quality,version),max=S.prognosis(endpoint.maximum,quality,version);
    let previous = null;
    for (let step = 0; step <= 100; step++) {
      const target = min + (max - min) * step / 100;
      const selected = S.planForTarget(1280, 960, framedBytes, quality, target, version);
      assert(selected.fits && Math.abs(S.prognosis(selected,quality,version)-target)<.003);
      assert(selected.width>=endpoint.minimum.width&&selected.width<=endpoint.maximum.width);
      if (previous) assert(selected.width >= previous.width && selected.height >= previous.height, 'moving towards green must reduce carrier dimensions');
      previous = selected;
    }
    const lastTick = S.planForTarget(1280, 960, framedBytes, quality, max - .001, version);
    assert(endpoint.width <= lastTick.width * 1.02 && endpoint.height <= lastTick.height * 1.02,
      'the final slider tick must not skip a plateau of carrier sizes');
    assert.equal(S.planForTarget(1280,960,framedBytes,quality,0,version).width,endpoint.minimum.width);
    assert.equal(S.planForTarget(1280,960,framedBytes,quality,1,version).width,endpoint.maximum.width);
    // Repetition/parity still describe actual capacity but cannot reverse the
    // resolution direction or introduce a jump at the 9 -> 12-bit transition.
    let previousRisk=-Infinity;
    for(let scale=endpoint.minimum.scale;scale<=endpoint.maximum.scale;scale+=.01){
      const candidate=S.plan(1280,960,framedBytes,scale,version),risk=S.prognosis(candidate,quality,version);
      assert(risk>=previousRisk);previousRisk=risk;
      assert.equal(candidate.parityBits,c.repetitionForFrame(candidate.width,candidate.height,framedBytes,version).parityBits);
    }
  }
}
console.log('PASS: larger grids always worsen the sampling prognosis; inverse targets downscale continuously, stop at payload capacity and never enlarge just to add repetition');

const pixel=(r,g,b,a=255)=>new Uint8Array([r,g,b,a]);
const transparent={width:2,height:1,pixels:new Uint8Array([...pixel(255,0,0,0),...pixel(0,0,255,255)])};
const average=await S.resize(transparent,1,1);
assert.deepEqual(Array.from(average.pixels),[0,0,255,128],'premultiplied-alpha resize must not bleed hidden red into visible blue');
const checker={width:2,height:2,pixels:new Uint8Array([...pixel(0,0,0),...pixel(255,255,255),...pixel(255,255,255),...pixel(0,0,0)])};
assert.deepEqual(Array.from((await S.resize(checker,1,1)).pixels),[128,128,128,255]);
const enlarged=await S.resize(checker,4,4);assert.equal(enlarged.pixels.length,64);
const controller=new AbortController();controller.abort();await assert.rejects(()=>S.resize(checker,4,4,{signal:controller.signal}),/cancelled/);
console.log('PASS: source resampling uses area filtering for reduction, linear interpolation for enlargement, correct alpha and cancellation');

const source={width:1200,height:900,pixels:new Uint8Array(1200*900*4)};
for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)source.pixels.set([Math.round(64+x*96/1200),Math.round(70+y*90/900),130,173],(x+y*1200)*4);
const before=source.pixels.slice();
const prepared=await S.prepare(source,content,false,.5);
assert(prepared.image.width<source.width);
assert.deepEqual(source.pixels,before);
assert.notEqual(prepared.image.pixels.buffer,source.pixels.buffer);
const encoded=await c.encodePayload(prepared.image.pixels,prepared.image.width,prepared.image.height,content,'',{quality:.8});
const loaded=await c.decodePng(new Uint8Array(await(await c.writePng(encoded.pixels,encoded.width,encoded.height)).arrayBuffer()));
assert(c.payloadsEqual(await c.decode(loaded.pixels,loaded.width,loaded.height,'',{nativeOnly:true}),content));
assert(Math.abs(encoded.repetitionRatio-prepared.plan.repetitionRatio)<1e-12);
const analysis=await c.analyzeNativeMarkers(loaded.pixels,loaded.width,loaded.height,5);
assert.equal(analysis.markers.length,4);assert.equal(analysis.geometry.originalWidth,encoded.width);
assert.equal(analysis.geometry.headerCount,4);
assert.equal(analysis.geometry.referenceCount,4);
assert.equal(analysis.geometry.expectedReferenceMarkers.length,4);
assert.deepEqual(analysis.geometry.referenceMarkers.map(marker=>marker.id),[1,3,5,7]);
assert(analysis.geometry.referenceMarkers.every(marker=>marker.verification==='reference'));
assert.deepEqual(source.pixels,before);
const locked=await c.encodePayload(prepared.image.pixels,prepared.image.width,prepared.image.height,content,'public fixture password');
await assert.rejects(()=>S.prepare({pixels:locked.pixels,width:locked.width,height:locked.height},content,false,.5),/already contains/);
console.log('PASS: a smaller source is encoded and PNG-verified with identical text/file bytes; original pixels remain unchanged and locked originals cannot be resized for re-encoding');

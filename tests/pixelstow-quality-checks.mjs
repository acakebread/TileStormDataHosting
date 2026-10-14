// Public sources/payloads: slider strength, reversible headroom and local texture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
globalThis.window = {};
(0, eval)((await fs.readFile('pixelstow.js', 'utf8')).replace('root.PixelStow = {',
  'root.qualityChecks = { linearRange, qualitySignalPolicy, v4SignalPolicy, textureAmplitude, locatorLayout, locatorBlockMap, readVisualLocator }; root.PixelStow = {'));
const c = window.PixelStow, I = window.qualityChecks, width = 640, height = 480;
function flat(r, g = r, b = r) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([r, g, b, 127], i);
  return pixels;
}
const policy = I.v4SignalPolicy(2.4, 8);
const normal = I.qualitySignalPolicy(policy, .8);
for (const key of ['strength', 'textureGain', 'payloadPeak', 'markerPeak', 'biasLimit']) assert.equal(normal[key], policy[key]);
const gentle = I.qualitySignalPolicy(policy, 1), durable = I.qualitySignalPolicy(policy, 0);
assert(gentle.strength < normal.strength && durable.strength > normal.strength);
assert(gentle.textureGain < normal.textureGain && durable.textureGain > normal.textureGain);
assert.equal(c.estimateSignalGain(2.4,.8),1);
assert(c.estimateSignalGain(2.4,0)>1 && c.estimateSignalGain(2.4,1)<1);
assert(c.estimateSignalGain(1.1,0) < c.estimateSignalGain(5,0), 'prognosis must account for the boost ceilings at low redundancy');
assert.equal(c.estimateSignalGain(2.4,0,1),1);
const ramp = Uint8Array.from({length:256 * 4}, (_, i) => i % 4 === 3 ? 127 : Math.floor(i / 4));
const compressed = I.linearRange(ramp, 28), restored = I.linearRange(compressed, 28, true);
assert.equal(compressed[0], 28);assert.equal(compressed[255 * 4], 227);
assert(Math.abs(compressed[128 * 4] - 128) <= 1);
assert(compressed[250 * 4] < 250 && compressed[240 * 4] < 240);
for (let i = 0; i < ramp.length; i++) assert(Math.abs(restored[i] - ramp[i]) <= (i % 4 === 3 ? 0 : 1));
console.log('PASS: 0.8 preserves the boost curve; slider endpoints are bounded and the whole-range RGB map is reversible around mid-grey');

// A smooth plane must not buy extra boost; textured neighbours must. The source
// noise estimator is unchanged and uses uncompressed source values.
const local = new Uint8Array(8 * 4 * 4);
for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
  const value = x < 4 ? 120 + 2*x + 3*y : 128 + ((x+y)%2 ? 30 : -30);
  local.set([value,value,value,255],(x+y*8)*4);
}
assert.equal(I.textureAmplitude(local,8,0,0,4,normal,normal.payloadPeak),normal.strength);
assert(I.textureAmplitude(local,8,4,0,4,normal,normal.payloadPeak) > normal.strength);
console.log('PASS: extra texture boost remains local and does not mistake smooth brightness slopes for noise');

let state = 127;
const bytes = Uint8Array.from({length:620},()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state&255;});
const content = {text:'Public quality check.',attachments:[{name:'public.bin',type:'application/octet-stream',bytes}]};
const original = flat(128), before = original.slice(), measurements = [];
for (const quality of [1,.8,0]) {
  const image = await c.encodePayload(original,width,height,content,'',{quality});
  const decoded = await c.decode(image.pixels,width,height,'',{nativeOnly:true});
  assert(c.payloadsEqual(decoded,content));assert.equal(decoded.rangeHeadroom,image.rangeHeadroom);
  for (const marker of I.locatorLayout(width,height,5)) assert(I.readVisualLocator(image.pixels,width,height,
    [1,0,marker.x,0,1,marker.y,0,0,1],marker.id,5));
  const source = I.linearRange(original,image.rangeHeadroom);
  let signal = 0, count = 0;
  for (const block of I.locatorBlockMap(width,height,Infinity,5)) {
    const x = block % (width/4)*4, y = Math.floor(block/(width/4))*4;
    for (let dy=0;dy<4;dy++) for(let dx=0;dx<4;dx++) {
      const i=(x+dx+(y+dy)*width)*4;signal+=(image.pixels[i]-source[i])**2;count++;
    }
  }
  measurements.push(Math.sqrt(signal/count));
}
assert(measurements[0] < measurements[1] && measurements[1] < measurements[2]);
assert.deepEqual(original,before);
console.log('PASS: slider changes the actual payload pattern, keeps all four headers readable and preserves source/alpha bytes');

for (const colour of [[0,0,0],[255,255,255],[0,255,128]]) {
  const source = flat(...colour), image = await c.encodePayload(source,width,height,content,'');
  const png = await c.writePng(image.pixels,width,height);
  const loaded = await c.decodePng(new Uint8Array(await png.arrayBuffer()));
  assert(c.payloadsEqual(await c.decode(loaded.pixels,width,height,''),content));
  const extracted = await c.extractCarrier(loaded.pixels,width,height,image.strength);
  const errors = [0,0,0], count = extracted.length/4;
  for(let i=0;i<extracted.length;i+=4){
    for(let channel=0;channel<3;channel++) errors[channel]+=Math.abs(extracted[i+channel]-source[i+channel]);
    assert.equal(extracted[i+3],source[i+3]);
  }
  assert(errors.every(error=>error/count < 3), 'source extraction restores the original RGB range, including marker regions');
}
console.log('PASS: PNG import retains range metadata; source extraction restores blacks, whites and saturated RGB without changing alpha');

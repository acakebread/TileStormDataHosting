// Optional optical-capture regression. The private PNG stays outside versioned fixtures.
// node tests/pixelstow-edge-capture-regression.mjs <captured.png> [expected magnification]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const input=process.argv[2],expected=Number(process.argv[3]||1.02);
if(!input){console.log('SKIP: supply the local photographed edge-guide PNG; no private fixture is versioned.');process.exit(0);}
assert(Number.isFinite(expected)&&expected>0);
globalThis.window={};
for(const file of ['pixelstow-edge-guide.js','pixelstow-transform.js','pixelstow.js'])(0,eval)(await fs.readFile(file,'utf8'));
const codec=window.PixelStow,bytes=new Uint8Array(await fs.readFile(input)),digest=data=>createHash('sha256').update(data).digest('hex');
const image=await codec.decodePng(bytes),before=image.pixels.slice();let headerReads=0;
for(const key of ['scanMarkers','readMarkerCandidates','decode','analyzeNativeMarkers'])codec[key]=()=>{headerReads++;throw new Error('A calibration regression must not recover marker headers or a payload.');};
const started=performance.now(),hint=await codec.scanEdgeGuide(image.pixels,image.width,image.height,
  {worker:false,minimumCoverage:.75,maxMilliseconds:1200});
assert(hint?.detected,'the captured frequency guide must be found without marker/payload recovery');
assert.equal(hint.confirmed,false,'calibration cannot confirm a readable payload');
assert.equal(headerReads,0);assert.equal(hint.reduction,4);
assert(hint.coverage>=.75);assert(Math.abs(hint.scale/expected-1)<.035,'calibration must target the photographed native grid');
assert(hint.localSpectralSupport>=6,'six fixed-phase components must exceed their local noise floor');
assert(hint.phaseSupport>=6);assert(hint.outlierComponents<=1);
assert.deepEqual(image.pixels,before);assert.equal(digest(await fs.readFile(input)),digest(bytes));
console.log(JSON.stringify({passed:true,width:image.width,height:image.height,guideOnly:true,headerReads,
  scale:hint.scale,coverage:hint.coverage,localSpectralSupport:hint.localSpectralSupport,
  phaseSupport:hint.phaseSupport,outlierComponents:hint.outlierComponents,milliseconds:Math.round(performance.now()-started)}));

// Optional optical-capture regression. The private PNG stays outside versioned fixtures.
// node tests/pixelstow-edge-capture-regression.mjs <captured.png> [expected magnification] [--recover]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const input=process.argv[2],expected=Number(process.argv[3]||1.02);
if(!input){console.log('SKIP: supply the local photographed edge-guide PNG; no private fixture is versioned.');process.exit(0);}
assert(Number.isFinite(expected)&&expected>0);
globalThis.window={};
for(const file of ['pixelstow-edge-guide.js','pixelstow-transform.js','pixelstow.js','pixelstow-lattice.js'])(0,eval)(await fs.readFile(file,'utf8'));
const codec=window.PixelStow,bytes=new Uint8Array(await fs.readFile(input)),digest=data=>createHash('sha256').update(data).digest('hex');
const image=await codec.decodePng(bytes),before=image.pixels.slice();let headerReads=0;
const saved={};
for(const key of ['scanMarkers','readMarkerCandidates','decode','analyzeNativeMarkers']){
  saved[key]=codec[key];codec[key]=()=>{headerReads++;throw new Error('A calibration regression must not recover marker headers or a payload.');};
}
const started=performance.now(),hint=await codec.scanEdgeGuide(image.pixels,image.width,image.height,
  {worker:false,minimumCoverage:.75,maxMilliseconds:1200});
assert(hint?.detected,'the captured frequency guide must be found without marker/payload recovery');
assert.equal(hint.confirmed,false,'calibration cannot confirm a readable payload');
assert.equal(headerReads,0);assert([4,8,12].includes(hint.reduction));
assert.equal(hint.workingWidth,Math.floor(image.width/hint.reduction));
assert.equal(hint.workingHeight,Math.floor(image.height/hint.reduction));
assert(hint.coverage>=.75);assert(Math.abs(hint.scale/expected-1)<.035,'calibration must target the photographed native grid');
assert(hint.localSpectralSupport>=6,'six fixed-phase components must exceed their local noise floor');
assert(hint.phaseSupport>=6);assert(hint.outlierComponents<=1);
const guideMilliseconds=Math.round(performance.now()-started);let recovery;
if(process.argv.includes('--recover')){
  Object.assign(codec,saved);
  const transform=window.PixelStowTransform,find=transform.find,grids=[];
  try{
    transform.find=async(...args)=>{grids.push({width:args[1],height:args[2]});return find.apply(transform,args);};
    const scan=await codec.scanMarkers(image.pixels,image.width,image.height,{worker:false,scaleGuide:hint,calibratedOnly:true,deadline:Date.now()+8000});
    const read=await codec.readMarkerCandidates(image.pixels,image.width,image.height,scan,{worker:false,calibratedOnly:true,resumeDiscovery:false,deadline:Date.now()+30000});
    assert(read.found&&!read.unreadable,'calibration must lead to a readable payload on its single grid');
    assert(read.calibration.used);assert.equal(read.calibration.method,'guide');assert.equal(grids.length,1);
    recovery={readable:true,grids,markers:scan.markers.length,calibration:read.calibration};
  }finally{transform.find=find;}
}
assert.deepEqual(image.pixels,before);assert.equal(digest(await fs.readFile(input)),digest(bytes));
console.log(JSON.stringify({passed:true,width:image.width,height:image.height,guideOnly:!recovery,headerReads,guideMilliseconds,recovery,
  scale:hint.scale,coverage:hint.coverage,localSpectralSupport:hint.localSpectralSupport,
  phaseSupport:hint.phaseSupport,outlierComponents:hint.outlierComponents,milliseconds:Math.round(performance.now()-started)}));

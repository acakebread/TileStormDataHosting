// Explicit research opt-in for the abandoned full-image pilot.
// Optional local photo regression. Inputs/contents never enter versioned fixtures.
// node tests/pixelstow-pilot-photo-checks.mjs <encoded-public-photo.png> [...]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const paths=process.argv.slice(2);assert(paths.length,'Supply one or more existing public V5 encoded PNGs.');
globalThis.window={};
for(const name of ['pixelstow-spectrum.js','pixelstow-transform.js','pixelstow.js','pixelstow-sizing.js','pixelstow-lattice.js'])(0,eval)(await fs.readFile(name,'utf8'));
const c=window.PixelStow,S=window.PixelStowSizing;
const directory='artifacts/research/scale-pilot-boost';await fs.mkdir(directory,{recursive:true});
const report=[];
for(let index=0;index<paths.length;index++){
  const inputBytes=new Uint8Array(await fs.readFile(paths[index])),input=await c.decodePng(inputBytes),before=input.pixels.slice();
  const content=await c.decode(input.pixels,input.width,input.height,'',{nativeOnly:true});
  assert.equal(content.status,'success','This local comparison requires a public, readable image.');
  assert.equal(content.carrierVersion,5);
  const clean=await c.extractCarrier(input.pixels,input.width,input.height,content.strength);
  const encoded=await c.encodePayload(clean,input.width,input.height,content,'',{scalePilot:true});
  const png=new Uint8Array(await(await c.writePng(encoded.pixels,encoded.width,encoded.height)).arrayBuffer());
  const reopened=await c.decodePng(png),decoded=await c.decode(reopened.pixels,reopened.width,reopened.height,'',{nativeOnly:true});
  assert.equal(decoded.scalePilotAmplitude,16);assert(c.payloadsEqual(decoded,content));
  assert.deepEqual(input.pixels,before);assert.deepEqual(new Uint8Array(await fs.readFile(paths[index])),inputBytes);
  const rows=[];
  for(const scale of [.73,1,1.37]){
    const capture=await S.resize(reopened,Math.round(reopened.width*scale),Math.round(reopened.height*scale));
    const factor=512/Math.max(capture.width,capture.height);
    const small=await S.resize(capture,Math.round(capture.width*factor),Math.round(capture.height*factor));
    for(const [mode,image,expected]of [['full',capture,scale],['camera-guide',small,scale*factor]]){
      const start=performance.now(),guide=await c.scanScaleGuide(image.pixels,image.width,image.height,{worker:false});
      assert(guide?.detected&&Math.abs(guide.scale/expected-1)<.03,`photo ${index+1}, ${mode}, scale ${scale}`);
      rows.push({mode,captureScale:scale,estimatedScale:guide.scale/expected*scale,phaseError:guide.phaseError,contrast:guide.contrast,milliseconds:Math.round(performance.now()-start)});
    }
  }
  // The reconstructed photo has no pilot and must not acquire pilot priority.
  assert.equal(await c.scanScaleGuide(clean,input.width,input.height,{worker:false}),null);
  const capture=await S.resize(reopened,Math.round(reopened.width*1.37),Math.round(reopened.height*1.37));
  const scan=await c.scanMarkers(capture.pixels,capture.width,capture.height,{worker:false,scaleGuide:true,deadline:Date.now()+24000});
  assert(scan.scaleGuide?.detected);assert.equal(scan.markers.filter(m=>m.verification==='header').length,4);
  const read=await c.readMarkerCandidates(capture.pixels,capture.width,capture.height,scan,{worker:false,resumeDiscovery:true,deadline:Date.now()+30000});
  assert(read.found&&!read.unreadable);assert(c.payloadsEqual(await c.decode(capture.pixels,capture.width,capture.height,''),content));
  const file=`${directory}/encoded-${index+1}.png`;await fs.writeFile(file,png);
  const row={image:index+1,width:input.width,height:input.height,previousAmplitude:content.scalePilotAmplitude,amplitude:decoded.scalePilotAmplitude,
    payloadVerified:true,resizedMarkerAndPayloadRecovery:true,inputsPreserved:true,sourceNegative:true,file,measurements:rows};report.push(row);
  console.log(JSON.stringify(row));
}
await fs.writeFile(`${directory}/results.json`,JSON.stringify(report,null,2)+'\n');
console.log('PASS: supplied photo textures, real re-encoding/PNG/payload, scale and camera-thumbnail guidance, source negatives and untouched input files');

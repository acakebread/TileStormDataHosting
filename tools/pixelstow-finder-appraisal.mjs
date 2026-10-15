// Local private inputs remain in ignored artifacts. Never print their contents.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
globalThis.window={};
for(const file of ['pixelstow-spectrum.js','pixelstow-finder.js','pixelstow-transform.js','pixelstow.js','pixelstow-sizing.js'])
  (0,eval)(await fs.readFile(file,'utf8'));
const c=window.PixelStow,S=window.PixelStowSizing,directory=path.resolve('artifacts/research/finder-rulers');
await fs.mkdir(directory,{recursive:true});
const compare=process.argv.includes('--compare'),report=[];
for(const [index,input] of process.argv.slice(2).filter(value=>value!=='--compare').entries()){
  const image=await c.decodePng(new Uint8Array(await fs.readFile(input))),before=image.pixels.slice();
  const content=await c.decode(image.pixels,image.width,image.height,'',{nativeOnly:true});
  assert.notEqual(content.status,'locked','only public carriers may be appraised');
  const source=await c.extractCarrier(image.pixels,image.width,image.height,content.strength);
  const encoded=await c.encodePayload(source,image.width,image.height,content,'');
  assert(c.payloadsEqual(await c.decode(encoded.pixels,image.width,image.height,'',{nativeOnly:true}),content));
  const output=path.join(directory,'encoded-'+(index+1)+'.png');
  await fs.writeFile(output,new Uint8Array(await(await c.writePng(encoded.pixels,image.width,image.height)).arrayBuffer()));
  const results=[];
  for(const scale of [.73,1,1.37]){
    const photo=await S.resize(encoded,Math.round(image.width*scale),Math.round(image.height*scale));
    const started=Date.now(),finderScan=await c.scanFinderMarkers(photo.pixels,photo.width,photo.height,{worker:false});
    const result={scale,rulers:finderScan.markers.length,finderMilliseconds:Date.now()-started};
    if(scale===1.37){
      const start=Date.now(),scan=await c.scanMarkers(photo.pixels,photo.width,photo.height,{worker:false,finderScan,deadline:Date.now()+24000});
      result.markers=scan.markers?.length;result.markerMilliseconds=Date.now()-start;
      const read=await c.readMarkerCandidates(photo.pixels,photo.width,photo.height,scan,{worker:false,resumeDiscovery:true,deadline:Date.now()+30000});
      result.payloadVerified=Boolean(read.found&&!read.unreadable);
      if(result.payloadVerified)assert(c.payloadsEqual(await c.decode(photo.pixels,photo.width,photo.height,''),content));
      if(compare){
        const baselineStart=Date.now(),fallback=await c.scanMarkers(photo.pixels,photo.width,photo.height,
          {worker:false,finderSearch:false,deadline:Date.now()+24000});
        result.fallbackMilliseconds=Date.now()-baselineStart;result.fallbackMarkers=fallback.markers?.length;
      }
    }
    results.push(result);
  }
  assert.deepEqual(image.pixels,before);
  report.push({sample:index+1,width:image.width,height:image.height,results});
  console.log(JSON.stringify(report.at(-1)));
}
await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');

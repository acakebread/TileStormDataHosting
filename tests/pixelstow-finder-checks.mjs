// Public procedural carriers only. The detector receives no bounds or scale hint.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
globalThis.window={};
for(const name of ['pixelstow-spectrum.js','pixelstow-finder.js','pixelstow-transform.js','pixelstow.js','pixelstow-sizing.js']){
  let script=await fs.readFile(name,'utf8');
  if(name==='pixelstow.js')script=script.replace('root.PixelStow = {','root.finderChecks={locatorLayout,readVisualLocator};root.PixelStow = {');
  (0,eval)(script);
}
const c=window.PixelStow,S=window.PixelStowSizing,F=window.PixelStowFinder,T=window.PixelStowTransform,I=window.finderChecks;
const w=800,h=600,source=new Uint8Array(w*h*4);let random=731;
for(let y=0;y<h;y++)for(let x=0;x<w;x++)source.set([110+Math.round(35*Math.sin(x/27)*Math.cos(y/17)),135+Math.round(30*Math.cos(y/23)),151,201],(x+y*w)*4);
const bytes=Uint8Array.from({length:900},()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return random&255;});
const content={text:'Public geometric ruler regression.',attachments:[{name:'public.bin',type:'application/octet-stream',bytes}]};
const original=source.slice(),encoded=await c.encodePayload(source,w,h,content,''),legacy=await c.encodePayload(source,w,h,content,'',{finderMarkers:false});
assert(encoded.finderMarkers);assert(!encoded.scalePilot);assert.deepEqual(source,original);
assert.equal(encoded.rangeHeadroom,legacy.rangeHeadroom);
let differences=0;
const layout=I.locatorLayout(w,h,5);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let k=0;k<4;k++)if(encoded.pixels[(x+y*w)*4+k]!==legacy.pixels[(x+y*w)*4+k]){
  assert.notEqual(k,3,'alpha is preserved');
  assert(layout.some(p=>[0,8].includes(p.id)&&x>=p.x&&x<p.x+52&&y>=p.y&&y<p.y+52),'only two existing marker reservations change');differences++;
}
assert(differences>0);
const png=await c.decodePng(new Uint8Array(await(await c.writePng(encoded.pixels,w,h)).arrayBuffer()));
const decoded=await c.decode(png.pixels,w,h,'',{nativeOnly:true});assert(c.payloadsEqual(decoded,content));
const extracted=await c.extractCarrier(png.pixels,w,h,encoded.strength);
let sourceError=0;
for(let i=0;i<source.length;i++){
  if(i%4===3)assert.equal(extracted[i],source[i]);else sourceError+=Math.abs(extracted[i]-source[i]);
}
assert(sourceError/(w*h*3)<2,'finder removal restores the compressed source with bounded local quantization');
const native=await c.analyzeNativeMarkers(png.pixels,w,h);
assert.equal(native.markers.filter(m=>m.verification==='header').length,4);
assert.deepEqual(native.markers.filter(m=>m.finder).map(m=>m.id).sort(),[0,8]);
console.log('PASS: two localized V5 finders, all four CRC headers, exact PNG/payload, original pixels and alpha; unchanged body and capacity');

// Bilinear capture with arbitrary projective geometry; no oracle is passed to detection.
function capture(image,width,height,matrix,blur=false){
  const inverse=T.invert(matrix),pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=T.point(inverse,x,y),i=(x+y*width)*4;pixels.set([43,39,47,255],i);
    if(p.x<0||p.y<0||p.x>w-1||p.y>h-1)continue;
    const ix=Math.floor(p.x),iy=Math.floor(p.y),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=p.x-ix,fy=p.y-iy;
    for(let k=0;k<3;k++)pixels[i+k]=Math.round((image.pixels[(ix+iy*w)*4+k]*(1-fx)+image.pixels[(jx+iy*w)*4+k]*fx)*(1-fy)+(image.pixels[(ix+jy*w)*4+k]*(1-fx)+image.pixels[(jx+jy*w)*4+k]*fx)*fy);
  }
  if(blur){const copy=pixels.slice();for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)for(let k=0;k<3;k++){
    let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=copy[(x+dx+(y+dy)*width)*4+k]*(dx===0?2:1)*(dy===0?2:1);
    pixels[(x+y*width)*4+k]=Math.round(sum/16);
  }}
  return {pixels,width,height};
}
for(const scale of [.62,.73,1,1.37]){
  const image=await S.resize(encoded,Math.round(w*scale),Math.round(h*scale));
  const found=await c.scanFinderMarkers(image.pixels,image.width,image.height,{worker:false});
  console.log('scale',scale,'finders',found.markers.map(m=>m.id),'ms',found.milliseconds,'geometry',found.geometryMilliseconds);
  assert.equal(found.markers.length,2,'both CRC rulers at scale '+scale);
}
const angle=9*Math.PI/180,scale=1.1,cs=Math.cos(angle)*scale,sn=Math.sin(angle)*scale;
const tilted=capture(encoded,1100,900,[cs,-sn,130,sn,cs,45,0,0,1]);
const perspectiveMatrix=F.fit([[0,0],[w-1,0],[w-1,h-1],[0,h-1]],[{x:100,y:70},{x:1000,y:110},{x:920,y:800},{x:150,y:750}]);
const perspective=capture(encoded,1100,900,perspectiveMatrix);
const blurred=capture(encoded,1100,900,[cs,-sn,130,sn,cs,45,0,0,1],true);
for(const [name,image] of [['tilted',tilted],['perspective',perspective],['blurred',blurred]]){
  const found=await c.scanFinderMarkers(image.pixels,image.width,image.height,{worker:false});
  console.log(name,'finders',found.markers.map(m=>m.id),'ms',found.milliseconds,'geometry',found.geometryMilliseconds);
  assert.equal(found.markers.length,2,name+' CRC rulers');
  const scan=await c.scanMarkers(image.pixels,image.width,image.height,{worker:false,finderScan:found,deadline:Date.now()+24000});
  console.log(name,'markers',scan.markers?.length,'fits',scan.candidates?.length);
  if(name==='perspective')assert(Math.max(...[[0,0],[799,0],[799,599],[0,599]].map(([x,y])=>{
    const a=T.point(scan.geometry.matrix,x,y),b=T.point(perspectiveMatrix,x,y);return Math.hypot(a.x-b.x,a.y-b.y);
  }))<1,'ruler-guided refinement must resolve nearby wavelet-phase ambiguity');
  const read=await c.readMarkerCandidates(image.pixels,image.width,image.height,scan,{worker:false,resumeDiscovery:true,deadline:Date.now()+30000});
  assert(read.found&&!read.unreadable,name+' full payload');
  assert(c.payloadsEqual(await c.decode(image.pixels,image.width,image.height,''),content));
}
console.log('PASS: unhinted arbitrary scale, tilted, projective and blurred finder calibration leads to full checked payload recovery');

for(const image of [{pixels:source,width:w,height:h},legacy]){
  const found=await c.scanFinderMarkers(image.pixels,image.width||w,image.height||h,{worker:false});
  assert.equal(found.markers.length,0,'ordinary/older images cannot confirm new rulers');
}
const squares=source.slice();
for(const p of layout.filter(p=>[0,8].includes(p.id)))for(let y=0;y<52;y++)for(let x=0;x<52;x++){
  const i=(p.x+x+(p.y+y)*w)*4;
  for(let k=0;k<3;k++)squares[i+k]=x>=6&&x<46&&y>=6&&y<46?128:encoded.pixels[i+k];
}
const falseRulers=await c.scanFinderMarkers(squares,w,h,{worker:false});
assert(falseRulers.proposals>=2,'negative must contain convincing geometric frames');
assert.equal(falseRulers.markers.length,0,'plain framed squares have no checksum-valid calibration');
const damaged=encoded.pixels.slice(),first=layout.find(p=>p.id===0);
for(let y=6;y<46;y++)for(let x=6;x<46;x++)for(let k=0;k<3;k++)damaged[(first.x+x+(first.y+y)*w)*4+k]=128;
assert(c.payloadsEqual(await c.decode(damaged,w,h,'',{nativeOnly:true}),content),'marker damage does not alter payload pixels');
const damagedClean=await c.extractCarrier(damaged,w,h,encoded.strength),frameIndex=(first.x+3+(first.y+20)*w)*4;
assert(Math.abs(damagedClean[frameIndex]-source[frameIndex])<8,'source preview removes a clear finder frame even when its header is damaged');
const abort=new AbortController();abort.abort();
await assert.rejects(()=>c.scanFinderMarkers(encoded.pixels,w,h,{worker:false,signal:abort.signal}),{name:'AbortError'});
console.log('PASS: ordinary and old marker images reject the new calibration; cancellation remains effective');

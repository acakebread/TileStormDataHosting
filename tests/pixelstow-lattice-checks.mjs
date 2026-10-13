import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
// A controlled nonlinear capture; this is not a camera/device reliability claim.
globalThis.window={};
for(const name of ['pixelstow-transform.js','pixelstow-lattice.js','pixelstow.js']){
 let s=await fs.readFile(name,'utf8');
 if(name==='pixelstow.js')s=s.replace('root.PixelStow = {','root.testGrid = { rectifyPhoto, readVisualMapping, geometryAt, retainVisualResult, readVisualLocator, readTrackedPhoto }; root.PixelStow = {');
 (0,eval)(s);
}
const c=window.PixelStow,L=window.PixelStowLattice,T=window.PixelStowTransform,I=window.testGrid;
const w=640,h=480,source=new Uint8Array(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++)source.set([Math.round(130+45*Math.sin(x/29)+35*Math.cos(y/37)),Math.round(135+50*Math.cos((x+y)/45)),Math.round(140+45*Math.sin((x-y)/31)),255],(x+y*w)*4);
const text='Public curved-grid check, all processing stays in the browser.';
const encoded=await c.encode(source,w,h,text,''); assert.equal(encoded.carrierVersion,4);
const trueOffset=(x,y)=>({x:5*Math.sin(2*Math.PI*x/(w-1))*Math.sin(Math.PI*y/(h-1)),y:3*Math.sin(Math.PI*x/(w-1))*Math.sin(2*Math.PI*y/(h-1))});
const W=2112,H=1600,photo=new Uint8Array(W*H*4).fill(255),matrix=[3,0,90,0,3,80,0,0,1];
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const qx=(x-90)/3,qy=(y-80)/3; let ux=qx,uy=qy;
 for(let i=0;i<8;i++){const d=trueOffset(ux,uy);ux=qx-d.x;uy=qy-d.y;}
 if(ux<0||uy<0||ux>w-1||uy>h-1)continue;
 const ix=Math.floor(ux),iy=Math.floor(uy),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=ux-ix,fy=uy-iy;
 for(let k=0;k<3;k++)photo[(x+y*W)*4+k]=Math.round((encoded.pixels[(ix+iy*w)*4+k]*(1-fx)+encoded.pixels[(jx+iy*w)*4+k]*fx)*(1-fy)+(encoded.pixels[(ix+jy*w)*4+k]*(1-fx)+encoded.pixels[(jx+jy*w)*4+k]*fx)*fy);
}
const layout=[{id:0,x:8,y:8},{id:2,x:560,y:8},{id:6,x:8,y:424},{id:8,x:560,y:424},{id:1,x:284,y:8},{id:3,x:8,y:216},{id:5,x:560,y:216},{id:7,x:284,y:424}];
const anchors=layout.map(p=>{const x=p.x+36,y=p.y+24,d=trueOffset(x,y);return{x,y,dx:d.x,dy:d.y,weight:1};});
const geometry={matrix,originalWidth:w,originalHeight:h,carrierVersion:4,expectedMarkers:[]};
const bad=await I.rectifyPhoto(photo,W,H,w,h,matrix);
assert.equal((await c.decode(bad.pixels,w,h,'',{nativeOnly:true})).status,'none');
console.log('PASS: plain perspective sampling cannot decode the curved control');
let last='';const start=Date.now();
let field=await L.track(photo,W,H,geometry,{anchors,reservations:layout.map(p=>({...p,width:72,height:48})),onProgress:t=>{if(t!==last&&t.includes('0%')){console.log(t);last=t;}}});
assert(Date.now()-start<8000); assert(field?.measured>field.probes*.35);
assert(field,'direct tracking did not produce a field');
let sq=0,max=0,n=0;
for(let y=60;y<h-50;y+=20)for(let x=60;x<w-50;x+=20){const v=L.at(field,x,y),d=trueOffset(x,y),e=Math.hypot(v.x-d.x,v.y-d.y);sq+=e*e;max=Math.max(max,e);n++;}
assert(Math.sqrt(sq/n)<0.6); assert(max<1);
const fixed=await I.rectifyPhoto(photo,W,H,w,h,matrix,undefined,field);
const read=await c.decode(fixed.pixels,w,h,'',{nativeOnly:true});
assert.equal(read.carrierVersion,4);
assert.equal(read.text,text);
console.log('PASS: curved capture checksum and body, original writer unchanged');

// Local patch fits supply real CRC-verified anchors to the recovery integration.
const markers=layout.map(p=>{
 const x=p.x+36,y=p.y+24,d=trueOffset(x,y),ex=trueOffset(x+.25,y),ey=trueOffset(x,y+.25);
 const a=3*(1+(ex.x-d.x)/.25),b=3*(ey.x-d.x)/.25;
 const e=3*(ex.y-d.y)/.25,f=3*(1+(ey.y-d.y)/.25);
 const m=[a,b,3*(x+d.x)+90-a*36-b*24,e,f,3*(y+d.y)+80-e*36-f*24,0,0,1];
 return I.readVisualLocator(photo,W,H,m,p.id,4);
}).filter(Boolean);
assert(markers.length>=3);
const integrated=await I.readTrackedPhoto(photo,W,H,geometry,undefined,undefined,markers,{},
 I.geometryAt(geometry,[1,0,0,0,1,0,0,0,1]),{offsets:[0],strengths:[16]});
assert(integrated&&!integrated.locatorOnly);
assert.equal(integrated.readResolution.phaseCorrection.kind,'spline');
console.log('PASS: verified marker anchors enter the photograph recovery path');


// Recreate only from serialized geometry in a new codec, as the worker/UI do.
const resolution=structuredClone({width:w,height:h,photoMatrix:matrix,phaseCorrection:field,
 geometry:{...geometry,matrix:[1,0,0,0,1,0,0,0,1]}});
let fresh=await fs.readFile('pixelstow.js','utf8');
fresh=fresh.replace('root.PixelStow = {','root.handoffChecks = { retainVisualResult }; root.PixelStow = {');
(0,eval)(fresh);
window.handoffChecks.retainVisualResult(photo,W,H,{geometry,carrierVersion:4,readResolution:resolution});
assert.equal((await window.PixelStow.decode(photo,W,H,'')).text,text);
console.log('PASS: worker-style geometry handoff recreates the same checksum-valid read');

const previewInverse=await L.inverse(field);
for(let y=60;y<h-60;y+=60)for(let x=60;x<w-60;x+=60){
 const d=L.at(field,x,y),back=L.inverseAt(previewInverse,x+d.x,y+d.y);
 assert(Math.hypot(back.x-x,back.y-y)<0.05);
}
const cancelled=new AbortController();cancelled.abort();
await assert.rejects(L.track(photo,W,H,geometry,{anchors,signal:cancelled.signal}),{name:'AbortError'});
assert.equal(await L.track(photo,W,H,geometry,{anchors,budgetMs:-1}),null);
console.log('PASS: inverse preview map, cancellation and bounded tracking');

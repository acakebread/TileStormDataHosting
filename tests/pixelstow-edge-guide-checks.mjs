// Public procedural sources only. No camera, uploads, private images or fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
globalThis.window={};
for(const file of['pixelstow-edge-guide.js','pixelstow-transform.js'])(0,eval)(await fs.readFile(file,'utf8'));
const E=window.PixelStowEdgeGuide,w=960,h=720;
const clamp=v=>Math.max(0,Math.min(255,Math.round(v)));
function source(width,height,texture=true) {
  const pixels=new Uint8Array(width*height*4);let state=123;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    state^=state<<13;state^=state>>>17;state^=state<<5;const noise=((state>>>0)%101/100-.5)*17;
    pixels.set(texture?[clamp(90+45*Math.sin(x/53)+30*Math.sin(y/31)+noise),clamp(110+40*Math.sin(x/69)+30*Math.sin(y/97)+noise),clamp(130+45*Math.sin(x/75)+20*Math.sin(y/43)+noise),153]:[128,128,128,153],(x+y*width)*4);
  }
  return pixels;
}
function sample(p,width,height,x,y,k) {
  const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(width-1,ix+1),jy=Math.min(height-1,iy+1),fx=x-ix,fy=y-iy;
  return (p[(ix+iy*width)*4+k]*(1-fx)+p[(jx+iy*width)*4+k]*fx)*(1-fy)+(p[(ix+jy*width)*4+k]*(1-fx)+p[(jx+jy*width)*4+k]*fx)*fy;
}
function capture(p,width,height,scale,angle=0,margin=0) {
  const a=angle*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a),W=Math.ceil(scale*(width*cs+height*Math.abs(sn)))+margin*2,H=Math.ceil(scale*(height*cs+width*Math.abs(sn)))+margin*2;
  const pixels=new Uint8Array(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) {
    const dx=(x-(W-1)/2)/scale,dy=(y-(H-1)/2)/scale,sx=cs*dx+sn*dy+(width-1)/2,sy=-sn*dx+cs*dy+(height-1)/2,i=(x+y*W)*4;
    if(sx<0||sy<0||sx>width-1||sy>height-1){pixels.set([24,25,28,255],i);continue;}
    for(let k=0;k<4;k++)pixels[i+k]=clamp(sample(p,width,height,sx,sy,k));
  }
  return {pixels,width:W,height:H};
}
const original=source(w,h),before=original.slice(),marked=E.apply(original,w,h),restored=E.apply(marked,w,h,{inverse:true});
assert.deepEqual(original,before,'input remains unchanged');
assert.deepEqual(restored,original,'faint integer deltas reverse exactly inside normal encoder headroom');
const corners=[{x:8,y:8},{x:4*Math.floor((w-60)/4),y:8},{x:8,y:4*Math.floor((h-60)/4)},{x:4*Math.floor((w-60)/4),y:4*Math.floor((h-60)/4)}].map(p=>({...p,w:52,h:52}));
const mx=Math.floor((w-24)/8)*4,my=Math.floor((h-16)/8)*4;
const reserved=corners.concat([{x:mx,y:8,w:24,h:16},{x:8,y:my,w:24,h:16},{x:Math.floor((w-32)/4)*4,y:my,w:24,h:16},{x:mx,y:Math.floor((h-24)/4)*4,w:24,h:16}]);
let changed=0,maxDelta=0,squared=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
  const i=(x+y*w)*4,insideBand=(x>=64&&x<w-64&&(y>=8&&y<56||y>=h-56&&y<h-8))||(y>=64&&y<h-64&&(x>=8&&x<56||x>=w-56&&x<w-8));
  assert.equal(marked[i+3],original[i+3],'alpha is preserved');
  for(let k=0;k<3;k++) {const d=marked[i+k]-original[i+k];maxDelta=Math.max(maxDelta,Math.abs(d));squared+=d*d;if(d)changed++;if(!insideBand||reserved.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h))assert.equal(d,0,'only unreserved edge strips can change');}
}
assert.equal(maxDelta,2);assert(changed>0);assert(Math.sqrt(squared/(w*h*3))<.5);
console.log('PASS: max 2 RGB levels, source/alpha preserved, exact inverse, marker reservations untouched; no global bands or boxes');
assert.equal(E.profile.experimental,true);
const measurements=[];
for(const textured of[false,true]) {
  const clean=source(w,h,textured),encoded=E.apply(clean,w,h);
  for(const scale of[.75,1,1.5]) {
    const image=capture(encoded,w,h,scale),hint=await E.detect(image.pixels,image.width,image.height,{maxMilliseconds:1600});
    assert(hint,`missing ${textured?'textured':'grey'} hint at ${scale}x`);
    assert.equal(hint.confirmed,false);assert.equal(hint.reduction,4);
    assert.equal(hint.workingWidth,Math.ceil(image.width/4),'no second hidden reduction');
    assert(Math.abs(hint.scale/scale-1)<.015,`scale ${hint.scale} expected ${scale}`);
    assert(Math.abs(1/(128*Math.hypot(hint.fx,hint.fy))-hint.scale)<1e-10,'legacy transform calibration convention');
    measurements.push(hint.milliseconds);
    const negative=capture(clean,w,h,scale);
    assert.equal(await E.detect(negative.pixels,negative.width,negative.height,{maxMilliseconds:1600}),null,'ordinary colour texture must not be promoted in these controls');
  }
}
console.log('PASS: quarter-resolution scale calibration at .75x / 1x / 1.5x; all six unencoded controls rejected');
// A photographed channel may attenuate the guide while one unrelated source
// frequency dominates a single component. The other fixed-phase components
// must still stand above neighbouring frequencies; one strong tone is not proof.
const grey=source(w,h,false),fullGuide=E.apply(grey,w,h),weak=grey.slice(),interferenceOnly=grey.slice();
for(let i=0;i<weak.length;i++)if(i%4!==3)weak[i]=Math.round(grey[i]+.55*(fullGuide[i]-grey[i]));
for(let y=8;y<56;y++)for(let x=64;x<w-64;x++) {
  const d=y-8,envelope=Math.sin(Math.PI*(d+.5)/48)*Math.cos(2*Math.PI*d/24+.43);
  const delta=Math.round(1.2*Math.cos(2*Math.PI*x/64+.31+2.4)*envelope),i=(x+y*w)*4;
  for(const pixels of [weak,interferenceOnly]){pixels[i]+=delta;pixels[i+1]-=delta;pixels[i+2]+=delta;}
}
const weakBefore=weak.slice(),weakHint=await E.detect(weak,w,h,{maxMilliseconds:1600,minimumCoverage:.75});
assert(weakHint&&Math.abs(weakHint.scale-1)<.02);
assert(weakHint.localSpectralSupport>=6);assert(weakHint.phaseSupport>=6);assert.equal(weakHint.outlierComponents,1);
assert.equal(await E.detect(interferenceOnly,w,h,{maxMilliseconds:1600}),null,'one source-frequency peak is insufficient');
assert.deepEqual(weak,weakBefore);
console.log('PASS: attenuated guide with one obscured tone calibrates from six independent spectral/phase components');
for(const scale of[.75,1,1.5])for(const angle of[-7,3,9]) {
  const image=capture(marked,w,h,scale,angle,24),hint=await E.detect(image.pixels,image.width,image.height,{maxMilliseconds:1600});
  assert(hint,`missing rotated hint at ${scale}x / ${angle}deg`);
  assert(Math.abs(hint.scale/scale-1)<.02);
  const error=Math.abs(Math.atan2(Math.sin(4*(hint.orientation-angle*Math.PI/180)),Math.cos(4*(hint.orientation-angle*Math.PI/180))))/4;
  assert(error<.025,`orientation error ${error*180/Math.PI}deg`);
  measurements.push(hint.milliseconds);
}
console.log('PASS: all nine letterboxed/rotated captures calibrate within 2% scale and 1.5 degrees');
const controller=new AbortController();controller.abort();
await assert.rejects(E.detect(marked,w,h,{signal:controller.signal,diagnostic:true}),error=>error.name==='AbortError');
assert.equal(await E.detect(marked,w,h,{deadline:Date.now()-1,diagnostic:true}),null);
assert.deepEqual(E.apply(new Uint8Array(128*96*4),128,96),new Uint8Array(128*96*4),'small legacy images are left alone');
assert.throws(()=>E.apply(new Uint8Array(4),w,h),/Invalid/);
assert(Math.max(...measurements)<1700,'a modeled precheck must remain bounded');
console.log(`PASS: cancellation/deadline; 15 positive appraisals ${Math.min(...measurements)}-${Math.max(...measurements)} ms (real camera performance still needs testing)`);



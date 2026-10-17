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
function turnImage(image,turns) {
  const {width,height}=image,W=turns%2?height:width,H=turns%2?width:height,pixels=new Uint8Array(image.pixels.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const [u,v]=turns===0?[x,y]:turns===1?[height-1-y,x]:turns===2?[width-1-x,height-1-y]:[y,width-1-x];
    pixels.set(image.pixels.subarray((x+y*width)*4,(x+y*width)*4+4),(u+v*W)*4);
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
// Both the guide's vector and its ordered corners must follow the original
// carrier axes, including when the phone sees a quarter-turned picture.
const tilted=capture(marked,w,h,1.25,6,24),tiltedControl=capture(original,w,h,1.25,6,24);
for(let turns=0;turns<4;turns++) {
  const image=turnImage(tilted,turns),before=image.pixels.slice();
  const hint=await E.detect(image.pixels,image.width,image.height,{diagnostic:true,maxMilliseconds:2000});
  assert(hint?.detected,`quarter-turn ${turns} must calibrate`);
  assert(Math.abs(hint.scale/1.25-1)<.02);
  const expected=6*Math.PI/180+turns*Math.PI/2;
  assert(Math.abs(Math.atan2(Math.sin(hint.orientation-expected),Math.cos(hint.orientation-expected)))<.025,
    'orientation must identify the source x axis, not just an unoriented screen edge');
  const [a,b]=hint.corners,angle=Math.atan2(b.y-a.y,b.x-a.x);
  assert(Math.abs(angle-hint.orientation)<1e-10);
  assert(Math.abs(hint.fx*Math.sin(angle)-hint.fy*Math.cos(angle))<1e-10);
  assert.equal(hint.diagnostic.accepted.length,4);
  assert.deepEqual(image.pixels,before);
  const negative=turnImage(tiltedControl,turns);
  assert.equal(await E.detect(negative.pixels,negative.width,negative.height,{maxMilliseconds:2000}),null);
}
console.log('PASS: all four quarter-turns retain the physical guide vector and corners; rotated guide-free controls rejected');
const controller=new AbortController();controller.abort();
await assert.rejects(E.detect(marked,w,h,{signal:controller.signal,diagnostic:true}),error=>error.name==='AbortError');
assert.equal(await E.detect(marked,w,h,{deadline:Date.now()-1,diagnostic:true}),null);
assert.deepEqual(E.apply(new Uint8Array(128*96*4),128,96),new Uint8Array(128*96*4),'small legacy images are left alone');
assert.throws(()=>E.apply(new Uint8Array(4),w,h),/Invalid/);
assert(Math.max(...measurements)<1700,'a modeled precheck must remain bounded');
// A 4K camera can magnify a small carrier beyond the original 2.5x range.
// Padding proposals must use the same coarse raster, within the guide budget.
const pw=896,ph=1116,plain=source(pw,ph),guided=E.apply(plain,pw,ph);
function framed(input) {
  const large=capture(input,pw,ph,3.18),width=3024,height=4032,pixels=new Uint8Array(width*height*4).fill(18);
  for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
  for(let y=0;y<large.height;y++)pixels.set(large.pixels.subarray(y*large.width*4,(y+1)*large.width*4),((y+40)*width+86)*4);
  return {pixels,width,height};
}
const largeFrame=framed(guided),largeHint=await E.detect(largeFrame.pixels,largeFrame.width,largeFrame.height,{minimumCoverage:.75,maxMilliseconds:1600});
assert(largeHint&&Math.abs(largeHint.scale/3.18-1)<.02,'large framed capture needs the correct native scale beyond 2.5x');
assert.equal(largeHint.reduction,12);assert.equal(largeHint.workingWidth,252);assert.equal(largeHint.workingHeight,336);
const mediumFrame=capture(largeFrame.pixels,largeFrame.width,largeFrame.height,.7);
const mediumHint=await E.detect(mediumFrame.pixels,mediumFrame.width,mediumFrame.height,{minimumCoverage:.75,maxMilliseconds:1600});
assert(mediumHint&&Math.abs(mediumHint.scale/(3.18*.7)-1)<.02);assert.equal(mediumHint.reduction,8);
const smallFrame=capture(largeFrame.pixels,largeFrame.width,largeFrame.height,773/3024);
const smallHint=await E.detect(smallFrame.pixels,smallFrame.width,smallFrame.height,{minimumCoverage:.75,maxMilliseconds:1600});
assert(smallHint&&Math.abs(smallHint.scale/(3.18*773/3024)-1)<.02);assert.equal(smallHint.reduction,4);
const largeControl=framed(plain);
assert.equal(await E.detect(largeControl.pixels,largeControl.width,largeControl.height,{minimumCoverage:.75,maxMilliseconds:1600}),null);
console.log('PASS: framed captures use one 4x/8x/12x reduction according to size and find the native scale; guide-free large control rejected');
// A toolbar and bezel are not a flat black field. The guide has to be measured
// on the picture span, or the surround is averaged in and the match disappears.
function busySurround(image) {
  const top=Math.round(image.height*.16),bottom=Math.round(image.height*.14),side=Math.round(image.width*.08);
  const width=image.width+side*2,height=image.height+top+bottom,pixels=new Uint8Array(width*height*4);
  let state=99;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    state=(Math.imul(state,1103515245)+12345)>>>0;const n=state%90,i=(x+y*width)*4;
    if(y<top){pixels.set([30+n,80+(x%70),150,255],i);continue;}
    if(y>=height-bottom){pixels.set([15+(x%110),25,40+n,255],i);continue;}
    if(x<side||x>=width-side){pixels.set([190-(y%80),150,50+n,255],i);continue;}
    pixels.set(image.pixels.subarray((x-side+(y-top)*image.width)*4,(x-side+(y-top)*image.width)*4+4),i);
  }
  return {pixels,width,height};
}
const surrounded=busySurround({pixels:marked,width:w,height:h});
const surroundHint=await E.detect(surrounded.pixels,surrounded.width,surrounded.height,{outlineSearch:false,contentSearch:false,minimumCoverage:.5,maxMilliseconds:3000});
assert(surroundHint&&Math.abs(surroundHint.scale-1)<.02,'a toolbar and bezel must not hide the guide');
const plainSurround=busySurround({pixels:original,width:w,height:h});
assert.equal(await E.detect(plainSurround.pixels,plainSurround.width,plainSurround.height,{outlineSearch:false,contentSearch:false,minimumCoverage:.5,maxMilliseconds:3000}),null,'surrounding chrome without a guide is not calibration');
console.log('PASS: guide surrounded by a toolbar and bezel still calibrates; the same chrome without a guide does not');
// A phone pointed at a browser: the picture is resampled inside a toolbar and
// taskbar, so its guide is not on the camera-frame inset and its amplitude is
// diluted. The outline has to land on that picture, within the camera budget.
function monitorPhoto(image, scale) {
  const pictureW=Math.round(image.width*scale),pictureH=Math.round(image.height*scale);
  const width=2560,height=1920,pixels=new Uint8Array(width*height*4);
  const monX=90,monY=70,monW=width-180,monH=height-150;
  const top=Math.round(monH*.07),bottom=Math.round(monH*.06),side=Math.round(monW*.012);
  const viewW=monW-side*2,viewH=monH-top-bottom;
  const fit=Math.min(viewW/pictureW,viewH/pictureH);
  const drawW=Math.round(pictureW*fit),drawH=Math.round(pictureH*fit);
  const ox=monX+side+Math.round((viewW-drawW)/2),oy=monY+top+Math.round((viewH-drawH)/2);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=(x+y*width)*4,inMonitor=x>=monX&&x<monX+monW&&y>=monY&&y<monY+monH;
    if(!inMonitor){pixels.set([18,18,20,255],i);continue;}
    const lx=x-monX,ly=y-monY;
    if(ly<top){pixels.set([36+(lx%40),90,160,255],i);continue;}
    if(ly>=monH-bottom){pixels.set([20+(lx%90),22,28,255],i);continue;}
    if(lx<side||lx>=monW-side){pixels.set([12,12,14,255],i);continue;}
    const sx=(x-ox)/scale/fit,sy=(y-oy)/scale/fit;
    if(sx<0||sy<0||sx>image.width-1||sy>image.height-1){pixels.set([248,248,248,255],i);continue;}
    let r=0,g=0,b=0;
    for(const [dx,dy] of [[0,0],[.6,0],[-.6,0],[0,.6],[0,-.6]]) {
      r+=sample(image.pixels,image.width,image.height,sx+dx,sy+dy,0);
      g+=sample(image.pixels,image.width,image.height,sx+dx,sy+dy,1);
      b+=sample(image.pixels,image.width,image.height,sx+dx,sy+dy,2);
    }
    pixels.set([clamp(r/5+((x*13+y)%5)-2),clamp(g/5+((x+y*9)%5)-2),clamp(b/5+((x*3+y*7)%5)-2),255],i);
  }
  return {pixels,width,height,picture:{x:ox,y:oy,w:drawW,h:drawH},expected:scale*fit};
}
const monitored=monitorPhoto({pixels:marked,width:w,height:h},1.6);
const monitorHint=await E.detect(monitored.pixels,monitored.width,monitored.height,{minimumCoverage:.5,maxMilliseconds:3000,diagnostic:true});
assert(monitorHint,'a monitor photo of an encoded picture must calibrate');
assert(Math.abs(monitorHint.scale/monitored.expected-1)<.03,`scale ${monitorHint.scale} expected ${monitored.expected}`);
const bounds={
  left:Math.min(...monitorHint.corners.map(p=>p.x)),top:Math.min(...monitorHint.corners.map(p=>p.y)),
  right:Math.max(...monitorHint.corners.map(p=>p.x)),bottom:Math.max(...monitorHint.corners.map(p=>p.y))};
const picture=monitored.picture;
assert(Math.max(Math.abs(bounds.left-picture.x),Math.abs(bounds.top-picture.y),Math.abs(bounds.right-(picture.x+picture.w)),Math.abs(bounds.bottom-(picture.y+picture.h)))<16,
  'calibration outline follows the picture, not the camera frame');
const monitorPlain=monitorPhoto({pixels:original,width:w,height:h},1.6);
assert.equal(await E.detect(monitorPlain.pixels,monitorPlain.width,monitorPlain.height,{minimumCoverage:.5,maxMilliseconds:3000}),null,
  'the same monitor chrome without a guide is not calibration');
console.log('PASS: a resampled picture inside monitor chrome calibrates on the picture edges within the camera budget');
console.log(`PASS: cancellation/deadline; 15 positive appraisals ${Math.min(...measurements)}-${Math.max(...measurements)} ms (real camera performance still needs testing)`);



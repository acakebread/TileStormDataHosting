// Research only: four-pixel edge pilot, with oracle bounds as an optimistic
// upper bound. No production profile, camera access, uploads or personal fixtures.
// Optional arguments: existing public V5 PNGs, reconstructed only in memory.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
globalThis.window={};
for(const file of ['pixelstow-spectrum.js','pixelstow-transform.js','pixelstow.js']){
  let code=await fs.readFile(file,'utf8');
  code=code.replace('root.PixelStowSpectrum = { analyze, scaleGuide };','root.edgeFFT = fft; root.PixelStowSpectrum = { analyze, scaleGuide };');
  code=code.replace('root.PixelStowTransform = {','root.edgeFit = fitPoints; root.PixelStowTransform = {');
  (0,eval)(code);
}
const c=window.PixelStow,T=window.PixelStowTransform,fft=window.edgeFFT,fit=window.edgeFit;
const period=64,amplitude=3,border=4,tones=[{k:2,phase:.2,weight:1},{k:3,phase:1.1,weight:.8},{k:5,phase:2.4,weight:.6}];
const clamp=v=>Math.max(0,Math.min(255,Math.round(v)));
const wave=x=>Math.round(amplitude/2.4*tones.reduce((s,t)=>s+t.weight*Math.cos(2*Math.PI*t.k*x/period+t.phase),0));
function paint(image){
  const {width:w,height:h}=image,pixels=image.pixels.slice();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const horizontal=y<border||y>=h-border,edge=horizontal||x<border||x>=w-border;
    if(!edge)continue;
    for(let k=0;k<3;k++)pixels[(x+y*w)*4+k]=clamp(pixels[(x+y*w)*4+k]+wave(horizontal?x:y));
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let k=0;k<4;k++){
    const i=(x+y*w)*4+k,difference=Math.abs(pixels[i]-image.pixels[i]);
    assert(difference<=amplitude);if(k===3||x>=border&&x<w-border&&y>=border&&y<h-border)assert.equal(difference,0);
  }
  return {...image,pixels};
}
function sample(image,x,y,k){
  const {width:w,height:h,pixels:p}=image;
  if(x<0||y<0||x>w-1||y>h-1)return [24,25,28][k];
  const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=x-ix,fy=y-iy;
  return (p[(ix+iy*w)*4+k]*(1-fx)+p[(jx+iy*w)*4+k]*fx)*(1-fy)+(p[(ix+jy*w)*4+k]*(1-fx)+p[(jx+jy*w)*4+k]*fx)*fy;
}
function capture(image,model){
  const {width:w,height:h}=image,a=model.angle*Math.PI/180,s=model.scale;
  let H=[s*Math.cos(a),-s*Math.sin(a),0,s*Math.sin(a),s*Math.cos(a),0,model.perspective/w,-model.perspective/(2*h),1];
  const native=[[-.5,-.5],[w-.5,-.5],[w-.5,h-.5],[-.5,h-.5]];
  const corners=native.map(([x,y])=>T.point(H,x,y)),left=40-Math.min(...corners.map(p=>p.x)),top=40-Math.min(...corners.map(p=>p.y));
  H=[H[0]+left*H[6],H[1]+left*H[7],left,H[3]+top*H[6],H[4]+top*H[7],top,H[6],H[7],1];
  const quad=native.map(([x,y])=>T.point(H,x,y)),width=Math.ceil(Math.max(...quad.map(p=>p.x))+40),height=Math.ceil(Math.max(...quad.map(p=>p.y))+40);
  const pixels=new Uint8Array(width*height*4),inverse=T.invert(H);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=T.point(inverse,x,y);for(let k=0;k<3;k++)pixels[(x+y*width)*4+k]=clamp(sample(image,p.x,p.y,k));pixels[(x+y*width)*4+3]=255;
  }
  if(model.blur){
    const temp=pixels.slice();
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)for(let k=0;k<3;k++){
      let value=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)value+=temp[(x+dx+(y+dy)*width)*4+k];
      pixels[(x+y*width)*4+k]=clamp(value/9);
    }
  }
  if(model.lighting){
    let state=713;
    for(let i=0;i<pixels.length;i+=4)for(let k=0;k<3;k++){
      state^=state<<13;state^=state>>>17;state^=state<<5;
      pixels[i+k]=clamp(255*.88*(pixels[i+k]/255)**1.1+6+((state>>>0)%101/100-.5)*2);
    }
  }
  return {pixels,width,height,quad};
}
function detect(values){
  const n=values.length;let size=1;while(size<n*8)size*=2;
  const real=new Float64Array(size),imag=new Float64Array(size),weighted=new Float64Array(n),mean=values.reduce((s,v)=>s+v,0)/n;
  for(let x=0;x<n;x++)real[x]=weighted[x]=(values[x]-mean)*(.5-.5*Math.cos(2*Math.PI*x/(n-1)));
  fft(real,imag);const power=Float64Array.from(real,(v,i)=>v*v+imag[i]*imag[i]),peaks=[];
  for(let i=4;i<size/2-1;i++)if(power[i]>power[i-1]&&power[i]>=power[i+1]){
    const a=Math.log(power[i-1]+1e-20),b=Math.log(power[i]+1e-20),d=Math.log(power[i+1]+1e-20);
    peaks.push({f:(i+.5*(a-d)/(a-2*b+d))/size,power:power[i]});
  }
  const dft=f=>{
    let re=0,im=0;for(let x=0;x<n;x++){re+=weighted[x]*Math.cos(2*Math.PI*f*x);im-=weighted[x]*Math.sin(2*Math.PI*f*x);}
    const noise=[-24,-16,16,24].map(offset=>power[Math.max(0,Math.min(size/2,Math.round(f*size)+offset))]).sort((a,b)=>a-b);
    return {phase:Math.atan2(im,re),power:re*re+im*im,contrast:(re*re+im*im)/Math.max(1e-8,noise[2])};
  };
  const matches=[];
  for(const peak of peaks.sort((a,b)=>b.power-a.power).slice(0,48))for(const tone of tones){
    const base=peak.f/tone.k,scale=1/(period*base);if(scale<.3||scale>3||base*5>=.5)continue;
    const measured=tones.map(t=>dft(base*t.k));
    if(measured.some(m=>m.contrast<8))continue;
    const phase=measured[0].phase+measured[1].phase-measured[2].phase+1.1,error=Math.abs(Math.atan2(Math.sin(phase),Math.cos(phase)));
    if(error>.5)continue;
    matches.push({scale,phaseError:error,contrast:Math.min(...measured.map(m=>m.contrast)),score:measured.reduce((s,m)=>s+Math.log(m.contrast),0)});
  }
  return matches.sort((a,b)=>b.score-a.score)[0]||null;
}
function analyse(image,boundsError=0){
  const quad=image.quad.map((p,i)=>({x:p.x+(i===0||i===3?-boundsError:boundsError),y:p.y+(i<2?-boundsError:boundsError)}));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),rw=Math.round((distance(quad[0],quad[1])+distance(quad[3],quad[2]))/2),rh=Math.round((distance(quad[0],quad[3])+distance(quad[1],quad[2]))/2);
  const H=fit([[0,0],[1,0],[1,1],[0,1]].map(([x,y],i)=>({source:{x,y},target:quad[i]})),true);
  const edges=[];
  for(let side=0;side<4;side++){
    const horizontal=side<2,n=Math.min(2048,horizontal?rw:rh),values=new Float64Array(n);
    for(let i=0;i<n;i++){
      let sum=0;for(const depth of [.5,1.5,2.5,3.5]){
        const along=(i+.5)/n,cross=depth/(horizontal?rh:rw);
        const p=T.point(H,horizontal?along:side===2?cross:1-cross,horizontal?(side===0?cross:1-cross):along);
        for(let k=0;k<3;k++)sum+=sample(image,p.x,p.y,k)/12;
      }
      values[i]=sum;
    }
    const hint=detect(values);edges.push(hint?{...hint,nativeLength:n/hint.scale}:null);
  }
  const pair=(a,b)=>edges[a]&&edges[b]&&Math.abs(Math.log(edges[a].nativeLength/edges[b].nativeLength))<.05;
  return {detected:Boolean(pair(0,1)||pair(2,3)),width:pair(0,1)?(edges[0].nativeLength+edges[1].nativeLength)/2:null,
    height:pair(2,3)?(edges[2].nativeLength+edges[3].nativeLength)/2:null,edges};
}
// Validate the detector independently of image content and capture sampling.
const pure=Float64Array.from({length:800},(_,x)=>128+tones.reduce((s,t)=>s+amplitude/2.4*t.weight*Math.cos(2*Math.PI*t.k*x/period+t.phase),0));
assert(Math.abs(detect(pure).scale-1)<.02);
const sources=[];
for(const texture of ['flat','detail']){
  const width=800,height=600,pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const v=texture==='flat'?128:128+30*Math.sin(x/151)+20*Math.cos((x+y)/53)+18*Math.sin(x/8.7)*Math.cos(y/6.3);
    pixels.set([clamp(v),clamp(v*.8+24),clamp(v*.6+44),255],(x+y*width)*4);
  }
  sources.push({name:texture,width,height,pixels});
}
for(const path of process.argv.slice(2)){
  const input=await c.decodePng(new Uint8Array(await fs.readFile(path))),decoded=await c.decode(input.pixels,input.width,input.height,'',{nativeOnly:true});
  assert.equal(decoded.status,'success','Local photo must be public and readable.');
  sources.push({name:'local-photo-'+(sources.length-1),width:input.width,height:input.height,pixels:await c.extractCarrier(input.pixels,input.width,input.height,decoded.strength)});
}
const models=[{name:'frontal',scale:1,angle:0,perspective:0},
  {name:'smaller-tilted',scale:.62,angle:9,perspective:.15,blur:true,lighting:true},
  {name:'perspective',scale:.9,angle:-12,perspective:.25,blur:true,lighting:true}],rows=[];
const positive=analyse(capture(paint(sources[0]),models[0]));
assert(positive.detected&&Math.abs(positive.width/sources[0].width-1)<.03,'end-to-end flat edge control must work');
for(const source of sources){
  let seed=313;const bytes=Uint8Array.from({length:Math.max(128,Math.floor(source.width*source.height/384)-200)},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
  const encoded=await c.encodePayload(source.pixels,source.width,source.height,{text:'Public edge pilot appraisal.',attachments:[{name:'public.bin',type:'application/octet-stream',bytes}]},'',{scalePilot:false});
  const edge=paint(encoded);assert((await c.inspect(edge.pixels,edge.width,edge.height,{nativeOnly:true})).found);
  for(const model of models)for(const present of [false,true]){
    const image=capture(present?edge:encoded,model);
    for(const boundsError of [0,2]){
      const start=performance.now(),result=analyse(image,boundsError);
      const correct=result.detected&&(!result.width||Math.abs(result.width/source.width-1)<.05)&&(!result.height||Math.abs(result.height/source.height-1)<.05);
      rows.push({source:source.name,model:model.name,present,boundsError,detected:result.detected,correct,
        inferredWidth:result.width,inferredHeight:result.height,milliseconds:Math.round(performance.now()-start)});
    }
  }
}
const summarize=(present,error)=>{const set=rows.filter(r=>r.present===present&&r.boundsError===error);return {present,boundsError:error,correct:set.filter(r=>r.correct).length,detected:set.filter(r=>r.detected).length,total:set.length};};
const report={pilot:{border,amplitude,period,wavelengths:tones.map(t=>period/t.k)},
  limitations:'Optimistic: exact carrier corners supplied before sampling. Two-pixel error probes boundary sensitivity. Bilinear planar camera model, blur/exposure/noise; no optical evidence or production integration.',
  summary:[summarize(true,0),summarize(true,2),summarize(false,0),summarize(false,2)],rows};
await fs.mkdir('artifacts/research/edge-pilot-appraisal',{recursive:true});
await fs.writeFile('artifacts/research/edge-pilot-appraisal/results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pilot:report.pilot,limitations:report.limitations,summary:report.summary,positiveControl:positive},null,2));

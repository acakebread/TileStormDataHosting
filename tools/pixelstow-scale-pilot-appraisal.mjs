// Research only. No production writer/reader changes, personal inputs or network.
// A horizontal, phase-coded three-tone pilot has known native pixel wavelengths.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const root=new URL('../',import.meta.url),out=new URL('artifacts/research/scale-pilot-appraisal/',root);
await fs.mkdir(out,{recursive:true});
const context={self:{},setTimeout};
vm.runInNewContext((await fs.readFile(new URL('pixelstow-spectrum.js',root),'utf8'))
  .replace('root.PixelStowSpectrum = { analyze };','root.PixelStowSpectrum = { analyze, fft };'),context);
const fft=context.self.PixelStowSpectrum.fft;
const tones=[{k:2,phase:.2,weight:1},{k:3,phase:1.1,weight:.8},{k:5,phase:2.4,weight:.6}];
const period=256,width=1024,height=768;
const pilot=x=>tones.reduce((sum,t)=>sum+t.weight*Math.cos(2*Math.PI*t.k*x/period+t.phase),0)/2.4;
const wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
const phaseCode=tones[0].phase+tones[1].phase-tones[2].phase;
let state=7591;
const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
const textures={
  flat:()=>128,
  smooth:(x,y)=>130+38*Math.sin(x/230)+24*Math.cos(y/140)+14*Math.sin((x+y)/175),
  detail:(x,y)=>128+24*Math.sin(x/177)+18*Math.cos((x+y)/73)+14*Math.sin(x/15.7)*Math.cos(y/11.3)+12*Math.sin((x-y)/6.1),
  stripes:(x,y)=>128+18*Math.cos(2*Math.PI*x/120)+13*Math.cos(2*Math.PI*x/80)+10*Math.cos(2*Math.PI*x/48)+12*Math.sin(y/77)
};
function capture(texture,amplitude,scale,{tilt=0,perspective=0,padding=60}={}){
  const n=Math.round(width*scale)+padding*2,result=new Float64Array(n);
  for(let row=0;row<64;row++){
    const y=(row+.5)*height/64,localScale=scale*(1+perspective*(y/height-.5));
    for(let x=0;x<n;x++){
      const u=(x-padding)/localScale+tilt*(y-height/2);
      result[x]+=u>=0&&u<width?texture(u,y)+amplitude*pilot(u):45;
    }
  }
  for(let x=0;x<n;x++)result[x]=result[x]/64+(random()-.5)*.3;
  return result;
}
function detect(values){
  const start=performance.now(),n=values.length;let size=1;while(size<n*8)size*=2;
  const re=new Float64Array(size),im=new Float64Array(size),weighted=new Float64Array(n);
  const mean=values.reduce((a,b)=>a+b,0)/n;
  for(let x=0;x<n;x++)re[x]=weighted[x]=(values[x]-mean)*(.5-.5*Math.cos(2*Math.PI*x/(n-1)));
  fft(re,im);
  const power=Float64Array.from(re,(v,i)=>v*v+im[i]*im[i]);
  const peaks=[];
  for(let i=Math.ceil(size/512);i<Math.min(size/2,size/24);i++){
    if(power[i]>power[i-1]&&power[i]>=power[i+1]){
      const a=Math.log(power[i-1]+1e-20),b=Math.log(power[i]+1e-20),c=Math.log(power[i+1]+1e-20);
      peaks.push({frequency:(i+.5*(a-c)/(a-2*b+c))/size,power:power[i]});
    }
  }
  const dft=f=>{
    let real=0,imag=0;for(let x=0;x<n;x++){real+=weighted[x]*Math.cos(2*Math.PI*f*x);imag-=weighted[x]*Math.sin(2*Math.PI*f*x);}
    return {phase:Math.atan2(imag,real),power:real*real+imag*imag};
  };
  const candidates=[];
  for(const peak of peaks.sort((a,b)=>b.power-a.power).slice(0,48)){
    const base=peak.frequency/2,scale=1/(period*base);
    if(scale<.3||scale>3)continue;
    const measured=tones.map(t=>dft(base*t.k));
    const contrasts=tones.map((t,j)=>{
      const bin=Math.round(base*t.k*size),noise=[];
      for(const offset of [-24,-20,-16,16,20,24])if(bin+offset>0)noise.push(power[bin+offset]);
      noise.sort((a,b)=>a-b);
      return measured[j].power/Math.max(1e-9,noise[Math.floor(noise.length/2)]||1e-9);
    });
    const phaseError=Math.abs(wrap(measured[0].phase+measured[1].phase-measured[2].phase-phaseCode));
    if(Math.min(...contrasts)<8||phaseError>.45)continue;
    candidates.push({scale,phaseError,contrast:Math.min(...contrasts),score:contrasts.reduce((s,c)=>s+Math.log(c),0)});
  }
  candidates.sort((a,b)=>b.score-a.score);
  return {...candidates[0],found:Boolean(candidates.length),milliseconds:performance.now()-start};
}
// Fixed cycle count over the whole image cannot distinguish native grids.
const fixedCycles=(nativeWidth,scale)=>Float64Array.from({length:Math.round(nativeWidth*scale)},(_,x)=>Math.cos(2*Math.PI*8*(x/scale)/nativeWidth));
assert.deepEqual(fixedCycles(1024,1),fixedCycles(2048,.5));
const results=[];
for(const framing of ['whole-frame','carrier-bounds'])for(const texture of Object.keys(textures))for(const amplitude of [0,1,3,6])for(const scale of [.5,1,1.8]){
  const result=detect(capture(textures[texture],amplitude,scale,{padding:framing==='carrier-bounds'?0:60}));
  results.push({framing,texture,amplitude,actualScale:scale,...result,error:result.found?Math.abs(result.scale/scale-1):null});
}
for(const [name,options]of [['tilted',{tilt:.15}],['perspective',{perspective:.25}]])for(const scale of [.5,1,1.8]){
  const result=detect(capture(textures.detail,3,scale,options));
  results.push({texture:name,amplitude:3,actualScale:scale,...result,error:result.found?Math.abs(result.scale/scale-1):null});
}
for(const scale of [.5,1,1.8]){
  const result=detect(capture(textures.flat,3,scale,{padding:0}));
  assert(result.found&&Math.abs(result.scale/scale-1)<.02,'known native wavelength calibrates a controlled front-facing image');
}
const report={reference:{width,height,period,wavelengths:tones.map(t=>period/t.k),phaseCode,
  limitations:'One-axis column projection, idealized scaling/padding/noise. No real camera or arbitrary rotation test; hints never confirm a payload.'},
  fixedCyclesAmbiguous:true,results,
  summary:['whole-frame','carrier-bounds'].flatMap(framing=>[1,3,6].map(amplitude=>{
    const rows=results.filter(r=>r.amplitude===amplitude&&r.framing===framing);
    return {framing,amplitude,correct:rows.filter(r=>r.found&&r.error<.05).length,total:rows.length};
  })),falsePositives:results.filter(r=>r.amplitude===0&&r.found).map(r=>({framing:r.framing,texture:r.texture,scale:r.actualScale,inferred:r.scale}))};
await fs.writeFile(new URL('results.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({fixedCyclesAmbiguous:true,summary:report.summary,falsePositives:report.falsePositives,
  distorted:results.filter(r=>['tilted','perspective'].includes(r.texture)).map(r=>({texture:r.texture,scale:r.actualScale,found:r.found,error:r.error})),
  milliseconds:results.map(r=>r.milliseconds).sort((a,b)=>a-b)[Math.floor(results.length/2)]},null,2));

// Sampling/scale proof only: no production codec or camera changes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
export function run(){
  const count=1536,pitches=[96,64],phases=[1.1,.2],weights=[.8,1],phaseCode=3*phases[0]-2*phases[1];
  const angleError=a=>Math.abs(Math.atan2(Math.sin(a),Math.cos(a)));
  const signature=x=>weights.reduce((sum,w,i)=>sum+w*Math.cos(2*Math.PI*x/pitches[i]+phases[i]),0)/1.8;
  function spectrum(values){
    const n=values.length,mean=values.reduce((a,b)=>a+b,0)/n,result=[];
    for(let k=1;k<n/2;k++){
      let re=0,im=0;for(let x=0;x<n;x++){const a=2*Math.PI*k*x/n;re+=(values[x]-mean)*Math.cos(a);im-=(values[x]-mean)*Math.sin(a);}
      result.push({bin:k,amplitude:2*Math.hypot(re,im)/n,phase:Math.atan2(im,re)});
    }
    return result.filter((v,i)=>v.amplitude>.05&&v.amplitude>=(result[i-1]?.amplitude||0)&&v.amplitude>=(result[i+1]?.amplitude||0));
  }
  function average(values,factor){return Float64Array.from({length:values.length/factor},(_,i)=>{
    let sum=0;for(let j=0;j<factor;j++)sum+=values[i*factor+j];return sum/factor;
  });}
  function detect(values,factor){
    const peaks=spectrum(values),matches=[];
    for(const a of peaks)for(const b of peaks){
      if(Math.abs(b.bin/a.bin-1.5)>.001||angleError(3*a.phase-2*b.phase-phaseCode)>.05)continue;
      const scale=factor*values.length/a.bin/pitches[0];
      matches.push({scale,score:Math.min(a.amplitude,b.amplitude),wavelengths:[values.length/a.bin,values.length/b.bin],amplitudes:[a.amplitude,b.amplitude]});
    }
    return {match:matches.sort((a,b)=>b.score-a.score)[0]||null,strongest:peaks.sort((a,b)=>b.amplitude-a.amplitude)[0]||null};
  }
  const rows=[];
  for(const scale of [.5,1,2])for(const factor of [4,8,12]){
    // A stronger unrelated host frequency must not displace the known guide pair.
    const capture=Uint8Array.from({length:count},(_,x)=>Math.round(128+2*signature(x/scale)+20*Math.sin(2*Math.PI*x/(256*scale))));
    const measured=detect(average(capture,factor),factor);
    assert(measured.match&&Math.abs(measured.match.scale-scale)<1e-8);
    const rawPeakScale=factor*(count/factor)/measured.strongest.bin/pitches[1];
    assert(Math.abs(rawPeakScale/scale-4)<1e-8,'largest host peak is not the signature');
    rows.push({scale,factor,inferred:measured.match.scale,wavelengths:measured.match.wavelengths,amplitudes:measured.match.amplitudes,rawPeakScale});
  }
  for(const factor of [4,8,12]){
    const ordinary=Float64Array.from({length:count},(_,x)=>128+20*Math.sin(2*Math.PI*x/256));
    assert.equal(detect(average(ordinary,factor),factor).match,null,'one strong ordinary frequency cannot match both guide intervals/phases');
  }
  return {nativePitches:pitches,maximumAddedSignal:2,testsPassed:rows.length,rows,
    limitations:'Ideal periodic 1D calculation at integer-cycle scales. 8-bit input quantization included. No perspective, cropping, optical or visibility validation. Demonstrates sampling/calibration and paired-peak matching only.'};
}
const report=run(),output=new URL('../artifacts/research/coarse-guide/',import.meta.url);
await fs.mkdir(output,{recursive:true});await fs.writeFile(new URL('sampling-proof.json',output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({testsPassed:report.testsPassed,nativePitches:report.nativePitches,maximumAddedSignal:report.maximumAddedSignal,limitations:report.limitations},null,2));

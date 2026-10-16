// Optional local research: personal inputs/contents stay in ignored artifacts.
// node tests/pixelstow-edge-photo-checks.mjs [--strict] [--recover] [--diagnostic] <public-V5.png> [...]
// --strict requires every plain resize scale to be correct and every control to
// be rejected. At least one rotated/padded capture per photo must also work.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=new URL('../',import.meta.url);
const clamp=value=>Math.max(0,Math.min(255,Math.round(value)));
let loaded;
async function load(){
  if(!loaded){
    globalThis.window={};
    for(const name of ['pixelstow-spectrum.js','pixelstow-edge-guide.js','pixelstow-transform.js',
      'pixelstow.js','pixelstow-sizing.js','pixelstow-lattice.js'])
      (0,eval)(await fs.readFile(new URL(name,root),'utf8'));
    loaded={codec:window.PixelStow,guide:window.PixelStowEdgeGuide,sizing:window.PixelStowSizing};
  }
  return loaded;
}

// No oracle bounds are supplied to detection. The image only supplies pixels.
export function capturePhoto(image,{scale=1,angle=0,margin=0}={}){
  const {pixels:source,width,height}=image,a=angle*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a);
  const W=Math.ceil(scale*(width*Math.abs(cs)+height*Math.abs(sn)))+margin*2;
  const H=Math.ceil(scale*(height*Math.abs(cs)+width*Math.abs(sn)))+margin*2;
  const pixels=new Uint8Array(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const dx=(x-(W-1)/2)/scale,dy=(y-(H-1)/2)/scale;
    const sx=cs*dx+sn*dy+(width-1)/2,sy=-sn*dx+cs*dy+(height-1)/2,i=(x+y*W)*4;
    if(sx<0||sy<0||sx>width-1||sy>height-1){pixels.set([24,25,28,255],i);continue;}
    const ix=Math.floor(sx),iy=Math.floor(sy),jx=Math.min(width-1,ix+1),jy=Math.min(height-1,iy+1),fx=sx-ix,fy=sy-iy;
    for(let k=0;k<4;k++)pixels[i+k]=clamp(
      (source[(ix+iy*width)*4+k]*(1-fx)+source[(jx+iy*width)*4+k]*fx)*(1-fy)+
      (source[(ix+jy*width)*4+k]*(1-fx)+source[(jx+jy*width)*4+k]*fx)*fy);
  }
  return {pixels,width:W,height:H};
}

export async function measureGuide(image,expectedScale,options={}){
  const {codec}=await load(),before=image.pixels.slice(),started=performance.now();
  let hint,error;
  try{
    hint=await codec.scanEdgeGuide(image.pixels,image.width,image.height,
      {worker:false,maxMilliseconds:1000,...options});
  }catch(cause){error={name:cause.name,message:cause.message};}
  assert.deepEqual(image.pixels,before,'guide appraisal must preserve captured pixels');
  const measurement={detected:Boolean(hint?.detected),estimatedScale:hint?.scale??null,
    accurate:Boolean(hint?.detected&&Math.abs(hint.scale/expectedScale-1)<.03),
    milliseconds:Math.round(performance.now()-started),
    contrast:hint?.contrast??null,support:hint?.support??null,score:hint?.score??null,
    orientation:hint?.orientation??null,reduction:hint?.reduction??null,diagnostic:Boolean(hint?.diagnostic),
    ...(error?{error}:{})};
  return {measurement,hint};
}

export function degradePhoto(image){
  const {width,height,pixels:source}=image,pixels=source.slice(),gains=[1.03,.97,1.01];let state=713;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)for(let k=0;k<3;k++){
    let sum=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=source[(x+dx+(y+dy)*width)*4+k];
    state^=state<<13;state^=state>>>17;state^=state<<5;
    pixels[(x+y*width)*4+k]=clamp(sum/9*gains[k]+((state>>>0)%1001/1000-.5));
  }
  return {pixels,width,height};
}

export async function runPhotoChecks(paths,{strict=false,recover=false,diagnostic=false,directory}={}){
  assert(paths.length,'Supply one or more existing public V5 PNGs.');
  const {codec,guide,sizing}=await load();
  const output=directory?path.resolve(directory):fileURLToPath(new URL('artifacts/research/edge-guide/',root));
  await fs.mkdir(output,{recursive:true});
  const report={profile:guide.profile,diagnostic,scaleTolerance:.03,images:[]};
  const save=()=>fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
  for(let index=0;index<paths.length;index++){
    const inputBytes=new Uint8Array(await fs.readFile(paths[index])),input=await codec.decodePng(inputBytes),before=input.pixels.slice();
    const content=await codec.decode(input.pixels,input.width,input.height,'',{nativeOnly:true});
    assert.equal(content.status,'success','Local input must be public and readable.');
    assert.equal(content.carrierVersion,5,'This comparison uses existing V5 carriers.');
    const clean=await codec.extractCarrier(input.pixels,input.width,input.height,content.strength);
    const sourceBefore=clean.slice(),encoded=await codec.encodePayload(clean,input.width,input.height,content,'',{edgeGuide:true});
    const noGuide=await codec.encodePayload(clean,input.width,input.height,content,'',{edgeGuide:false});
    const bytes=new Uint8Array(await(await codec.writePng(encoded.pixels,encoded.width,encoded.height)).arrayBuffer());
    const file=path.join(output,`encoded-${index+1}.png`);await fs.writeFile(file,bytes);
    const reopened=await codec.decodePng(bytes),decoded=await codec.decode(reopened.pixels,reopened.width,reopened.height,'',{nativeOnly:true});
    const row={image:index+1,width:input.width,height:input.height,file,
      nativePayloadVerified:codec.payloadsEqual(decoded,content),edgeGuide:Boolean(decoded.edgeGuide),
      scalePilot:Boolean(decoded.scalePilot),measurements:[]};
    report.images.push(row);await save();
    assert(row.nativePayloadVerified&&row.edgeGuide&&!row.scalePilot,'new PNG must preserve the exact payload and guide metadata');
    const cleanImage={pixels:clean,width:input.width,height:input.height};
    for(const scale of [.73,1,1.37])for(const mode of ['resize','rotated-padded']){
      const model={scale,angle:mode==='resize'?0:6,margin:mode==='resize'?0:32};
      const capture=mode==='resize'?await sizing.resize(reopened,Math.round(reopened.width*scale),Math.round(reopened.height*scale)):capturePhoto(reopened,model);
      const sourceControl=mode==='resize'?await sizing.resize(cleanImage,capture.width,capture.height):capturePhoto(cleanImage,model);
      const payloadControl=mode==='resize'?await sizing.resize(noGuide,capture.width,capture.height):capturePhoto(noGuide,model);
      const {measurement,hint}=await measureGuide(capture,scale,{diagnostic});
      const cleanResult=await measureGuide(sourceControl,scale,{diagnostic}),payloadResult=await measureGuide(payloadControl,scale,{diagnostic});
      const measured={mode,captureScale:scale,width:capture.width,height:capture.height,...measurement,
        sourceNegative:!cleanResult.measurement.detected,payloadNegative:!payloadResult.measurement.detected,
        sourceControl:cleanResult.measurement,payloadControl:payloadResult.measurement};
      row.measurements.push(measured);await save();
      console.log(JSON.stringify({image:index+1,mode,captureScale:scale,detected:measured.detected,
        estimatedScale:measured.estimatedScale,accurate:measured.accurate,
        sourceNegative:measured.sourceNegative,payloadNegative:measured.payloadNegative,milliseconds:measured.milliseconds}));
      if(recover&&mode==='resize'&&scale===1.37&&measurement.accurate){
        const started=performance.now(),scaleGuide={...hint,kind:'edge',width:capture.width,height:capture.height};
        const scan=await codec.scanMarkers(capture.pixels,capture.width,capture.height,{worker:false,scaleGuide,deadline:Date.now()+24000});
        const read=await codec.readMarkerCandidates(capture.pixels,capture.width,capture.height,scan,
          {worker:false,resumeDiscovery:true,deadline:Date.now()+30000});
        const actual=read.found&&!read.unreadable?await codec.decode(capture.pixels,capture.width,capture.height,'',{worker:false}):null;
        measured.recovery={markers:scan.markers?.filter(marker=>marker.verification==='header').length||0,
          exactPayload:Boolean(actual&&codec.payloadsEqual(actual,content)),milliseconds:Math.round(performance.now()-started)};
        await save();console.log(JSON.stringify({image:index+1,recovery:measured.recovery}));
      }
    }
    const cameraModel={scale:1.37,angle:6,margin:32};
    const modeled=await measureGuide(degradePhoto(capturePhoto(reopened,cameraModel)),cameraModel.scale,{diagnostic});
    const modeledSource=await measureGuide(degradePhoto(capturePhoto(cleanImage,cameraModel)),cameraModel.scale,{diagnostic});
    const modeledPayload=await measureGuide(degradePhoto(capturePhoto(noGuide,cameraModel)),cameraModel.scale,{diagnostic});
    row.modeledCamera={scale:cameraModel.scale,angle:cameraModel.angle,margin:cameraModel.margin,
      blur:'3x3 box',gains:[1.03,.97,1.01],noiseAmplitude:.5,...modeled.measurement,
      sourceNegative:!modeledSource.measurement.detected,payloadNegative:!modeledPayload.measurement.detected,
      sourceControl:modeledSource.measurement,payloadControl:modeledPayload.measurement};
    console.log(JSON.stringify({image:index+1,mode:'blur-gains-noise',...modeled.measurement,
      sourceNegative:row.modeledCamera.sourceNegative,payloadNegative:row.modeledCamera.payloadNegative}));
    assert.deepEqual(clean,sourceBefore,'encoding must preserve the reconstructed source');
    assert.deepEqual(input.pixels,before);assert.deepEqual(new Uint8Array(await fs.readFile(paths[index])),inputBytes);
    row.inputsPreserved=true;await save();
  }
  const plain=report.images.flatMap(image=>image.measurements.filter(measurement=>measurement.mode==='resize'));
  const rotated=report.images.flatMap(image=>image.measurements.filter(measurement=>measurement.mode==='rotated-padded'));
  report.summary={plainAccurate:plain.filter(m=>m.accurate).length,plainTotal:plain.length,
    rotatedAccurate:rotated.filter(m=>m.accurate).length,rotatedTotal:rotated.length,
    negativeControlsRejected:report.images.flatMap(image=>image.measurements).reduce((sum,m)=>sum+Number(m.sourceNegative)+Number(m.payloadNegative),0),
    negativeControlsTotal:(plain.length+rotated.length)*2};
  await save();console.log(JSON.stringify(report.summary));
  if(strict){
    assert.equal(report.summary.plainAccurate,report.summary.plainTotal,'every plain capture must recover scale within 3%');
    assert.equal(report.summary.negativeControlsRejected,report.summary.negativeControlsTotal,'ordinary sources and payload-only controls must not produce guides');
    for(const image of report.images)assert(image.measurements.some(m=>m.mode==='rotated-padded'&&m.accurate),
      'each natural photo must acquire at least one 6-degree rotated/padded capture');
    if(recover)for(const image of report.images)assert(image.measurements.find(m=>m.mode==='resize'&&m.captureScale===1.37)?.recovery?.exactPayload);
  }
  return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),strict=args.includes('--strict'),recover=args.includes('--recover'),diagnostic=args.includes('--diagnostic');
  const paths=args.filter(arg=>!['--strict','--recover','--diagnostic'].includes(arg));
  await runPhotoChecks(paths,{strict,recover,diagnostic});
}

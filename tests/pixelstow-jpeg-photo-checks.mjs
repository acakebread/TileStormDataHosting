// Optional local JPEG round-trip. Personal pixels stay in ignored artifacts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),inputs=process.argv.slice(2);
assert(inputs.length,'Supply local source JPEGs.');
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const directory=path.join(root,'artifacts/research/edge-guide/user-photos',new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(directory,{recursive:true});
const server=http.createServer(async(req,res)=>{
  try{
    const requested=new URL(req.url,'http://localhost').pathname;
    if(requested==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+requested);
    if(!file.startsWith(root))throw Error('Outside workspace');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const report=[];
try{
  browser=await chromium.launch({headless:true,...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('saveTestOutput',async(name,base64)=>{
    assert.equal(path.basename(name),name);
    await fs.writeFile(path.join(directory,name),Buffer.from(base64,'base64'),{flag:'wx'});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  for(let index=0;index<inputs.length;index++){
    const input=new Uint8Array(await fs.readFile(inputs[index]));
    const hash=createHash('sha256').update(input).digest('hex');
    const result=await page.evaluate(async({input,index})=>{
      const c=PixelStow,S=PixelStowSizing;
      const source=await c.readImageFile(new File([new Uint8Array(input)],'source.jpg',{type:'image/jpeg'}));
      const original=source.pixels.slice(),content={text:'Public PixelStow photograph round-trip test.',attachments:[]};
      let seed=731;
      const bytes=Uint8Array.from({length:4096},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
      content.attachments.push({name:'public-test.bin',type:'application/octet-stream',bytes});
      const rows=[];
      for(const mode of ['native','scaled-2x']){
        const prepared=mode==='native'?{image:source}:await S.prepare(source,content,false,2,5);
        const image=prepared.image,quality=prepared.plan?S.scaledQuality(prepared.plan,.8,5).quality:.8;
        const encoded=await c.encodePayload(image.pixels,image.width,image.height,content,'',{quality});
        const pngBytes=new Uint8Array(await(await c.writePng(encoded.pixels,encoded.width,encoded.height)).arrayBuffer());
        const reopened=await c.decodePng(pngBytes),decoded=await c.decode(reopened.pixels,reopened.width,reopened.height,'',{nativeOnly:true});
        const markers=await c.analyzeNativeMarkers(reopened.pixels,reopened.width,reopened.height,5);
        // Compare the previous writer on the identical source. Some difficult
        // photographs already miss a marker while their full payload verifies.
        const baseline=await c.encodePayload(image.pixels,image.width,image.height,content,'',{quality,edgeGuide:false});
        const baselineMarkers=await c.analyzeNativeMarkers(baseline.pixels,image.width,image.height,5);
        const measurements=[];
        for(const scale of [.73,1,1.37]){
          const capture=await S.resize(reopened,Math.round(reopened.width*scale),Math.round(reopened.height*scale));
          const hint=await c.scanEdgeGuide(capture.pixels,capture.width,capture.height,{maxMilliseconds:1000});
          measurements.push({captureScale:scale,detected:Boolean(hint),estimatedScale:hint?.scale??null,
            accurate:Boolean(hint&&Math.abs(hint.scale/scale-1)<.03)});
        }
        let binary='';for(let start=0;start<pngBytes.length;start+=32768)binary+=String.fromCharCode(...pngBytes.subarray(start,start+32768));
        const file=`photo-${index+1}-${mode}.png`;
        await window.saveTestOutput(file,btoa(binary));
        rows.push({mode,width:reopened.width,height:reopened.height,quality,guide:decoded.edgeGuide,
          framedBytes:encoded.framedBytes,redundancy:encoded.repetitionRatio,strength:encoded.strength,
          exactPayload:c.payloadsEqual(decoded,content),markers:markers.markers.filter(m=>m.verification==='header').length,
          markerIds:markers.markers.filter(m=>m.verification==='header').map(m=>m.id),
          baselineMarkerIds:baselineMarkers.markers.filter(m=>m.verification==='header').map(m=>m.id),file,measurements});
      }
      return{width:source.width,height:source.height,originalPixelsPreserved:source.pixels.every((v,i)=>v===original[i]),rows};
    },{input:Array.from(input),index});
    assert(result.originalPixelsPreserved);
    for(const row of result.rows){assert(row.exactPayload);assert.deepEqual(row.markerIds,row.baselineMarkerIds);row.file=path.join(directory,row.file);}
    assert.equal(createHash('sha256').update(await fs.readFile(inputs[index])).digest('hex'),hash);
    report.push({photo:index+1,input:path.basename(inputs[index]),...result,originalFilePreserved:true});
    console.log(JSON.stringify(report.at(-1)));
    await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(report,null,2)+'\n');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: native and 2x-redundancy encodes, PNG import, marker counts match the existing writer, exact message/4096 attachment bytes and unchanged original files.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}

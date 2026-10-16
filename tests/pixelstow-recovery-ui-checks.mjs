// Actual browser/worker recovery after a cancelled import. Public pixels only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT
  ?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root))throw Error('Outside test directory');
    const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,
    ...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage(),errors=[],failed=[];
  page.setDefaultTimeout(90000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  const files=await page.evaluate(async()=>{
    const w=800,h=600,pixels=new Uint8Array(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set([
      Math.round(110+18*Math.sin(x/70)),Math.round(128+9*Math.cos(y/63)),140,255
    ],(x+y*w)*4);
    let seed=313;
    const bytes=Uint8Array.from({length:900},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
    const content={text:'Public cancelled-import recovery and calibration UI regression.',
      attachments:[{name:'public.bin',type:'application/octet-stream',bytes}]};
    const before=pixels.slice(),encoded=await PixelStow.encodePayload(pixels,w,h,content,'');
    const photo=await PixelStowSizing.resize(encoded,1096,822);
    const nativeBlob=await PixelStow.writePng(encoded.pixels,w,h),photoBlob=await PixelStow.writePng(photo.pixels,photo.width,photo.height);
    window.recoveryFixture={source:pixels,before,encoded,photo,photoBefore:photo.pixels.slice(),content,nativeBlob,photoBlob};
    window.recoveryCalls=[];
    const inspect=PixelStow.inspect,decode=PixelStow.decode;
    PixelStow.inspect=async function(pixels,width,height,options){
      const call={kind:'inspect',automatic:options?.automatic,background:options?.background,signal:options?.signal};
      recoveryCalls.push(call);
      if(recoveryCalls.filter(item=>item.kind==='inspect').length===1){
        return new Promise((resolve,reject)=>options.signal.addEventListener('abort',
          ()=>reject(new DOMException('Synthetic cancellation before reading pixels.','AbortError')),{once:true}));
      }
      return inspect.call(this,pixels,width,height,options);
    };
    PixelStow.decode=async function(...args){recoveryCalls.push({kind:'decode'});return decode.apply(this,args);};
    return {photo:Array.from(new Uint8Array(await photoBlob.arrayBuffer())),native:Array.from(new Uint8Array(await nativeBlob.arrayBuffer()))};
  });
  await page.locator('#file').setInputFiles({name:'public-resized-guide.png',mimeType:'image/png',buffer:Buffer.from(files.photo)});
  await page.waitForFunction(()=>recoveryCalls.length===1&&Boolean(transformAbort));
  assert.equal(await page.locator('#choose-image').textContent(),'Cancel search');
  await page.locator('#choose-image').click();
  await page.waitForFunction(()=>!busy&&!transformAbort);
  assert(await page.locator('#decode').isVisible());
  assert(await page.locator('#decode').isEnabled());
  await page.locator('#decode').click();
  await page.waitForFunction(()=>!busy&&Boolean(current?.decodedText));
  const recovered=await page.evaluate(()=>{
    const calls=recoveryCalls.filter(item=>item.kind==='inspect'),f=recoveryFixture;
    return {calls:calls.length,automatic:calls.every(call=>call.automatic===true&&call.background===true),
      cancelled:calls[0].signal.aborted,freshSignal:calls[0].signal!==calls[1].signal&&!calls[1].signal.aborted,
      order:recoveryCalls.map(call=>call.kind),exact:PixelStow.payloadsEqual({text:current.decodedText,attachments:current.decodedAttachments},f.content),
      unchanged:f.source.every((value,index)=>value===f.before[index])&&f.photo.pixels.every((value,index)=>value===f.photoBefore[index]),
      calibration:current.transformResult?.calibration,guide:current.transformResult?.scaleGuide,
      analysisChecked:showTransform.checked,analysisHidden:document.querySelector('#calibration-analysis').hidden};
  });
  assert.equal(recovered.calls,2);assert(recovered.automatic&&recovered.cancelled&&recovered.freshSignal);
  assert.deepEqual(recovered.order.slice(0,3),['inspect','inspect','decode']);
  assert(recovered.exact&&recovered.unchanged,'bottom Decode must run real recovery and preserve the input');
  assert(recovered.calibration?.used&&recovered.calibration.status==='detected','actual automatic recovery must retain its positive calibration provenance');
  assert(recovered.guide?.detected&&recovered.guide.corners?.length===4);
  assert(!recovered.analysisChecked&&recovered.analysisHidden);
  console.log('PASS: cancelling Browse then bottom Decode runs the same automatic worker pipeline with a fresh AbortSignal and recovers the exact public text/binary payload');

  await page.evaluate(()=>{
    window.calibrationStrokes=[];
    const stroke=CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke=function(...args){
      if(this.canvas.id==='transform-outline')calibrationStrokes.push(this.strokeStyle);
      return stroke.apply(this,args);
    };
  });
  await page.locator('#full-preview').click();
  await page.locator('#show-transform').check();
  await page.waitForFunction(()=>!document.querySelector('#calibration-analysis').hidden);
  const positive=await page.evaluate(()=>({state:document.querySelector('#calibration-analysis').dataset.state,
    text:document.querySelector('#calibration-analysis').textContent,overlay:!transformOutline.hidden,
    purple:calibrationStrokes.includes('#de9aff'),trace:current.transformResult.calibration}));
  assert.equal(positive.state,'detected');assert(/calibration/i.test(positive.text));assert(/scale|×/.test(positive.text));
  assert(positive.overlay&&positive.purple&&positive.trace.used,'Analysis must draw the measured calibration bands');
  await page.locator('#show-transform').uncheck();
  assert(await page.evaluate(()=>document.querySelector('#calibration-analysis').hidden&&transformOutline.hidden));
  await page.locator('#show-transform').check();
  await page.waitForFunction(()=>!transformOutline.hidden);
  await page.locator('#preview-screen-close').click();
  await page.waitForFunction(()=>!fullPreview.openNow&&!showTransform.checked&&transformOutline.hidden&&calibrationAnalysis.hidden);
  assert(await page.evaluate(()=>!showTransform.checked&&transformOutline.hidden&&calibrationAnalysis.hidden),'leaving fullscreen revokes Analysis');
  const strokesBeforeImport=await page.evaluate(()=>calibrationStrokes.length);
  console.log('PASS: Analysis shows measured calibration provenance and purple bands only while enabled');

  await page.locator('#file').setInputFiles({name:'public-native-guide.png',mimeType:'image/png',buffer:Buffer.from(files.native)});
  await page.waitForFunction(()=>!busy&&current?.file?.name==='public-native-guide.png'&&Boolean(current.decodedText));
  const native=await page.evaluate(()=>({trace:current.transformResult.calibration,guide:current.transformResult.scaleGuide,
    encodedFlag:current.repetition.edgeGuide,checked:showTransform.checked,hidden:document.querySelector('#calibration-analysis').hidden}));
  assert(native.encodedFlag,'control must contain the new guide');
  assert(!native.trace?.used&&!native.guide?.detected,'a native read must not claim the guide was used just because its encoded flag exists');
  assert(!native.checked&&native.hidden);
  assert.equal(await page.evaluate(()=>calibrationStrokes.length),strokesBeforeImport,'new imports must not paint diagnostics before Analysis is requested');
  await page.locator('#full-preview').click();
  await page.locator('#show-transform').check();
  await page.waitForFunction(()=>current?.transformResult?.calibration?.analysisOnly===true);
  const nativeAnalysis=await page.evaluate(()=>({state:document.querySelector('#calibration-analysis').dataset.state,
    text:document.querySelector('#calibration-analysis').textContent,trace:current.transformResult.calibration}));
  assert.equal(nativeAnalysis.state,'detected');
  assert(nativeAnalysis.trace.analysisOnly&&!nativeAnalysis.trace.used);
  assert(/checked during analysis/i.test(nativeAnalysis.text)&&/original read.*native pixel grid/i.test(nativeAnalysis.text));
  await page.evaluate(()=>camera.clearFeedback());
  assert(await page.evaluate(()=>!showTransform.checked&&transformOutline.hidden&&calibrationAnalysis.hidden),'starting the next camera capture revokes Analysis immediately');
  await page.evaluate(()=>clearPreviewFrame());
  assert(await page.evaluate(()=>preview.hidden&&[previewEncoded,previewSource,transformOutline].every(c=>!c.width&&!c.height&&!c.dataset.imageWidth&&!c.dataset.imageHeight)),
    'capture handoff must erase both old image rasters and diagnostics, not just hide the overlay');
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  console.log('PASS: native imports distinguish an encoded guide from an actually detected/used calibration; no page errors or failed requests');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}

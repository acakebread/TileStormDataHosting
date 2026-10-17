// Public synthetic signal and a DOM preview only. No camera or personal images.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const server=http.createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(path.relative(root,file).startsWith('..'))throw Error('Outside test root');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage({viewport:{width:480,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  const result=await page.evaluate(async()=>{
    const w=512,h=384,source=new Uint8Array(w*h*4);
    for(let i=0;i<source.length;i+=4)source.set([128,128,128,255],i);
    const marked=PixelStowEdgeGuide.apply(source,w,h),oneEdge=source.slice();
    for(let y=8;y<56;y++)oneEdge.set(marked.subarray(y*w*4,(y+1)*w*4),y*w*4);
    const original=oneEdge.slice(),options={minimumScale:1,maximumScale:1,scaleStep:.01,maxMilliseconds:2000,outlineSearch:false,contentSearch:false};
    const plain=await PixelStow.scanEdgeGuide(oneEdge,w,h,{...options,worker:false});
    const negative=await PixelStow.scanEdgeGuide(oneEdge,w,h,{...options,diagnostic:true});
    const normal=await PixelStow.scanEdgeGuide(marked,w,h,options);
    const positive=await PixelStow.scanEdgeGuide(marked,w,h,{...options,diagnostic:true});
    const cancelled=new AbortController();cancelled.abort();let aborted=false;
    try{await PixelStow.scanEdgeGuide(marked,w,h,{...options,diagnostic:true,signal:cancelled.signal});}catch(error){aborted=error.name==='AbortError';}
    const session={purpose:'read',history:[],frames:7};camera.session=session;
    camera.panel.hidden=false;camera.panel.showModal();camera.view.style.height='360px';
    Object.assign(camera.frame.style,{left:'10px',top:'10px',width:'440px',height:'330px'});
    const entry={image:{pixels:oneEdge,width:w,height:h},frameNumber:7,capturedAt:Date.now()-1200};
    camera.showSignal(session,entry,negative);camera.updateCalibrationLight(session,entry);
    const text=camera.signalReadout.textContent;
    const drawn=Array.from(camera.signalCanvas.getContext('2d').getImageData(0,0,camera.signalCanvas.width,camera.signalCanvas.height).data).some((v,i)=>i%4===3&&v>0);
    const state=camera.frame.dataset.calibration;
    const hasCanvas=!camera.signalCanvas.hidden,hasText=!camera.signalReadout.hidden;
    camera.showSignal(session,entry,positive);
    const matched=camera.signalReadout.textContent.includes('Green: calibration matched');
    camera.cancelSearches(session);
    const cleared=camera.signalCanvas.hidden&&camera.signalReadout.hidden&&!session.signalDebug;
    camera.close();
    return {plainMiss:plain===null,negative,positive,normalScale:normal?.scale,normalCorners:normal?.corners,
      unchanged:oneEdge.every((value,i)=>value===original[i]),aborted,text,drawn,state,hasCanvas,hasText,matched,cleared};
  });
  assert(result.plainMiss,'one edge alone must not count as calibration');
  assert.equal(result.negative?.detected,false,'diagnostics must keep the response unverified');
  assert(result.negative.diagnostic.strongest.score>0);
  assert.equal(result.negative.diagnostic.strongest.band.length,4);
  assert(result.positive?.detected,'the complete synthetic guide must still match');
  assert.equal(result.positive.scale,result.normalScale);
  assert.deepEqual(result.positive.corners,result.normalCorners,'debug collection must not change accepted geometry');
  assert(result.unchanged&&result.aborted);
  assert(result.drawn&&result.hasCanvas&&result.hasText&&result.matched&&result.cleared);
  assert.equal(result.state,'searching','a strong rejected response cannot turn the frame green');
  assert.match(result.text,/Frame 7.*1\.2s old/);
  assert.match(result.text,/Amber: strongest guide response/);
  assert.match(result.text,/Unverified/);
  assert.deepEqual(errors,[]);
  console.log('PASS: strongest rejected strip reaches the overlay through a real worker; one-edge rejection, complete-guide geometry, input preservation, cancellation and stale-overlay cleanup');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}

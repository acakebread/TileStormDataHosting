// Real video/canvas rendering with an upright synthetic phone camera. No hardware.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const oldCameraUrl='/pixelstow-camera.js?v=20261017-view-rotation',cameraRequests=[];
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/camera-cache-check.html'){
      res.setHeader('Content-Type','text/html');res.end('<script src="'+oldCameraUrl+'"></script>');return;
    }
    if(req.url===oldCameraUrl){
      cameraRequests.push(req.url);res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','public, max-age=600');
      res.end('window.cachedOldCamera = true;');return;
    }
    if(req.url.startsWith('/pixelstow-camera.js'))cameraRequests.push(req.url);
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(path.relative(root,file).startsWith('..'))throw Error('Outside test root');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const output=path.join(root,'artifacts','camera-checks');await fs.mkdir(output,{recursive:true});
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/camera-cache-check.html');
  assert(await page.evaluate(()=>window.cachedOldCamera),'the old camera URL must be cached before testing the repaired page');
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  assert.equal(await page.evaluate(()=>typeof PixelStowCamera),'function','the repaired page must bypass the old cached camera script');
  assert.equal(cameraRequests.length,2);assert.notEqual(cameraRequests[1],oldCameraUrl);
  await page.evaluate(()=>{
    window.portraitSensor=document.createElement('canvas');portraitSensor.width=480;portraitSensor.height=640;
    const ctx=portraitSensor.getContext('2d'),image=ctx.createImageData(480,640);
    for(let y=0;y<640;y++)for(let x=0;x<480;x++)image.data.set([x%251,y%251,(3*x+5*y)%251,255],(x+y*480)*4);
    ctx.putImageData(image,0,0);
    window.formatChanges=[];window.sensorTracks=[];
    navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'upright',label:'Back Wide Camera'}];
    navigator.mediaDevices.getUserMedia=async()=>{
      const stream=portraitSensor.captureStream(5),track=stream.getVideoTracks()[0];sensorTracks.push(track);
      const frames=setInterval(()=>ctx.drawImage(portraitSensor,0,0),100);
      track.addEventListener('ended',()=>clearInterval(frames));
      // Model a phone that supplies a portrait raster despite landscape ideals.
      track.applyConstraints=async constraints=>{formatChanges.push(constraints);};
      return stream;
    };
    camera.schedule=()=>{};
    window.captured=[];camera.importImage=async(file,origin,options)=>{captured.push(options.image);};
    window.checkPortraitFrame=(zoom=1)=>{
      const raw=document.createElement('canvas');raw.width=camera.video.videoWidth;raw.height=camera.video.videoHeight;
      raw.getContext('2d').drawImage(camera.video,0,0);
      const expected=raw.getContext('2d').getImageData(zoom===1?0:120,zoom===1?140:230,480/zoom,360/zoom).data,frame=camera.captureFrame();
      return {width:frame.width,height:frame.height,exact:frame.exact,
        samePixels:frame.pixels.length===expected.length&&frame.pixels.every((value,i)=>value===expected[i])};
    };
  });
  const ready=()=>page.waitForFunction(()=>camera.session?.ready&&!camera.captureButton.disabled,null,{timeout:10000}).catch(async error=>{
    console.log(await page.evaluate(()=>({status:document.querySelector('#status').textContent,progress:camera.progress.textContent,
      ready:camera.session?.ready,video:camera.video.readyState,width:camera.video.videoWidth,height:camera.video.videoHeight})));
    throw error;
  });
  const wide=async()=>{
    const state=await page.evaluate(()=>{const frame=camera.frame.getBoundingClientRect();
      return {rawWidth:camera.video.videoWidth,rawHeight:camera.video.videoHeight,width:frame.width,height:frame.height};});
    assert(state.rawWidth<state.rawHeight,'the test must actually deliver a portrait sensor raster');
    assert(state.width>state.height,'a portrait sensor must open a landscape preview without moving the phone: '+JSON.stringify(state));
    assert(Math.abs(state.width/state.height-4/3)<.01);
    assert.deepEqual(await page.evaluate(()=>checkPortraitFrame()),{width:480,height:360,exact:true,samePixels:true},
      'capture must match the visible centre at native pixels, without rotating or resampling');
  };
  await page.locator('#open-camera').click();await ready();await wide();
  await page.screenshot({path:path.join(output,'upright-portrait-sensor.png')});
  await page.evaluate(()=>camera.setZoom(camera.session,2));
  assert.deepEqual(await page.evaluate(()=>checkPortraitFrame(2)),{width:240,height:180,exact:true,samePixels:true},
    'zoom must capture exactly the narrower visible centre without resampling');
  await page.evaluate(()=>camera.setZoom(camera.session,1));
  await page.locator('#rotate-camera').click();
  assert.deepEqual(await page.evaluate(()=>checkPortraitFrame()),{width:480,height:360,exact:true,samePixels:true},'Rotate view must retain the same captured pixels');
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(()=>!camera.session.portrait);
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>camera.session.portrait);
  assert.equal(await page.evaluate(()=>camera.session.rotation),90,'physical rotation must not reset an explicitly rotated view');
  for(let i=0;i<3;i++)await page.locator('#rotate-camera').click();
  await wide();
  assert.equal(await page.evaluate(()=>formatChanges.length),0,'device rotation must not renegotiate or reset the working camera feed');
  await page.locator('#capture-frame').click();await page.waitForFunction(()=>!camera.active&&captured.length===1);
  assert.deepEqual(await page.evaluate(()=>[captured[0].width,captured[0].height]),[480,360]);
  await page.locator('#camera-source').click();await ready();await wide();
  await page.locator('#capture-frame').click();await page.waitForFunction(()=>!camera.active&&captured.length===2);
  assert(await page.evaluate(()=>sensorTracks.every(track=>track.readyState==='ended')));
  assert.deepEqual(errors,[]);
  console.log('PASS: a real portrait video opens wide while the phone is upright; scan/source capture preserves exact visible native pixels, view rotation and physical round trips');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}

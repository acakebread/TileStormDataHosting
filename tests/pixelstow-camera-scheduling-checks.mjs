// Preserve working recovery while scheduling camera frames. Public buffers only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const source=await fs.readFile(new URL('pixelstow-camera.js',root),'utf8');
let now=100000,sequence=0;const timers=new Map(),codec={},window={};
vm.runInNewContext(source,{window,PixelStow:codec,AbortController,DOMException,
  Date:{now:()=>now},setTimeout:(callback,delay)=>{const id=++sequence;timers.set(id,{at:now+delay,callback});return id;},
  clearTimeout:id=>timers.delete(id)});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const advance=async ms=>{now+=ms;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}await flush();};
const image=id=>({width:16,height:16,pixels:Uint8Array.from({length:1024},()=>id)});
const scan=(score=100)=>({width:16,height:16,markers:[{id:0,verification:'header',carrierVersion:5}],
  candidates:[0,1,2].map(n=>({geometry:{rank:score-n,matrix:[1,0,0,0,1,0,0,0,1]}})),
  geometry:{rank:score,matrix:[1,0,0,0,1,0,0,0,1]}});
const entry=(id,score=100)=>({image:image(id),scan:scan(score),score,frameNumber:id,capturedAt:now});
{
  const camera=Object.create(window.PixelStowCamera.prototype);
  camera.view={clientWidth:200,clientHeight:100};
  camera.session={rotation:0};
  const full=camera.visibleVideoRect(400,200,1);
  assert.equal(full.sx,0);assert.equal(full.sy,0);assert.equal(full.sw,400);assert.equal(full.sh,200);
  const zoomed=camera.visibleVideoRect(400,200,2);
  assert.equal(zoomed.sx,100);assert.equal(zoomed.sy,50);assert.equal(zoomed.sw,200);assert.equal(zoomed.sh,100);
  camera.session.rotation=90;
  const turned=camera.visibleVideoRect(400,200,2);
  assert.equal(turned.sw,200);assert.equal(turned.sh,200);assert.equal(turned.sx,100);assert.equal(turned.sy,0);
  assert.equal(camera.snapZoom(2.24,{min:1,max:8,step:0.5}),2);
  assert.equal(camera.snapZoom(9,{min:1,max:4,step:0}),4);
  const hardware={zoom:1},track={getCapabilities:()=>({zoom:{min:1,max:6,step:0.5}}),getSettings:()=>({zoom:1})};
  camera.configureZoom(hardware,track);
  assert.equal(hardware.zoomMode,'hardware');assert.equal(hardware.zoom,1);assert.equal(hardware.zoomRange.max,6);
  const held={zoom:3.2};camera.configureZoom(held,track);assert.equal(held.zoom,3);assert.equal(held.zoomMode,'hardware');
  const plain={};camera.configureZoom(plain,{getCapabilities:()=>({})});
  assert.equal(plain.zoomMode,'simulated');assert.equal(plain.zoom,1);assert.equal(plain.zoomRange.max,4);
  camera.restartZoomDevices=new Set(['xr']);
  const older={deviceId:'xr'};
  camera.configureZoom(older,{getCapabilities:()=>({zoom:{min:1,max:6,step:0.1}}),getSettings:()=>({zoom:2})});
  assert.equal(older.zoomMode,'simulated');assert.equal(older.zoom,1);assert.equal(older.zoomRange.max,4);
  const video={readyState:2,videoWidth:1280,currentTime:1,addEventListener(){},removeEventListener(){}};
  camera.video=video;
  const live=camera.zoomLeavesPreviewRunning({applyConstraints(){return Promise.resolve();}},1.2);
  await flush();
  await advance(250);
  assert.equal(await live,true);
  video.readyState=1;
  assert.equal(await camera.zoomLeavesPreviewRunning({applyConstraints(){video.readyState=1;return Promise.resolve();}},1.2),false);
  video.readyState=2;
  assert.equal(await camera.zoomLeavesPreviewRunning({applyConstraints(){now+=400;return Promise.resolve();}},1.2),false);
  let hardwareCalls=0;
  camera.applyHardwareZoom=()=>{hardwareCalls+=1;};
  camera.layoutPreview=()=>{};
  const preview=camera.session={zoomMode:'simulated',zoomRange:{min:1,max:4,step:0},zoom:1};
  camera.setZoom(preview,2);
  assert.equal(hardwareCalls,0);assert.equal(preview.zoom,2);
}
const ui={readProgress:{begin(){},update(){},signature(){},finish(){},syncFrame(){}},showBestFrame(){},clearFeedback(){},sync(){},schedule(){}};
function setup(){
  timers.clear();
  const camera=Object.create(window.PixelStowCamera.prototype),session={purpose:'read',history:[],frames:0,appraised:2};
  Object.assign(camera,ui,{session,progress:{textContent:''},signature:{textContent:''}});
  return {camera,session};
}
function workerQueue(){
  const calls=[];
  codec.readMarkerCandidates=(pixels,width,height,scan,options)=>new Promise((resolve,reject)=>{
    calls.push({id:pixels[0],scan,options,resolve});
    options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  return calls;
}
{
  const {camera,session}=setup(),calls=workerQueue();let accepted;
  session.history=[entry(1)];camera.accept=async(s,img)=>{s.handingOff=true;accepted=img;};
  camera.readBestFrame(session);await flush();
  assert.equal(calls[0].scan.candidates.length,3,'camera recovery must retain all ranked fits');
  assert.equal(calls[0].options.resumeDiscovery,true,'a promising early fit must retain remaining-scale recovery');
  assert.equal(calls[0].options.deadline-now,30000);
  await advance(9000);
  assert(!calls[0].options.signal.aborted,'a valid read taking longer than eight seconds must be allowed to finish');
  session.pending=entry(2);codec.scanMarkers=async()=>scan(100);
  await camera.scanMarkers(session);await advance(5000);
  assert(!calls[0].options.signal.aborted,'equal marker fits must not repeatedly interrupt an ongoing valid read');
  calls[0].resolve({found:true,unreadable:false});await flush();
  assert.equal(accepted.pixels[0],1);assert.equal(timers.size,0);
}
{
  const {camera,session}=setup(),calls=workerQueue();
  session.history=[entry(1)];camera.readBestFrame(session);await advance(100);
  session.pending=entry(2);codec.scanMarkers=async()=>scan(110);
  await camera.scanMarkers(session);await flush();
  assert(calls[0].options.signal.aborted);assert.equal(calls[1].id,2,'a genuinely stronger capture still preempts');
  session.paused=true;camera.cancelSearches(session);await flush();assert.equal(timers.size,0);
}
{
  const {camera,session}=setup();let id=0;const scans=[];
  camera.video={readyState:2,currentTime:1};camera.captureFrame=()=>image(++id);
  codec.scanScaleGuide=()=>{throw Error('Normal capture must not run pilot analysis');};
  codec.scanMarkers=(pixels,width,height,options)=>new Promise(resolve=>scans.push({id:pixels[0],options,resolve}));
  camera.scan(session);camera.video.currentTime=2;camera.scan(session);camera.video.currentTime=3;camera.scan(session);
  assert.equal(scans.length,1);assert.equal(session.pending.image.pixels[0],3);
  assert.equal(scans[0].options.deadline-now,24000);
  await advance(23000);assert(!scans[0].options.signal.aborted,'do not kill useful marker acquisition after six seconds');
  scans[0].resolve({markers:[],candidates:[]});await flush();
  assert.equal(scans[1].id,3,'latest-slot capture replacement still skips the intermediate frame');
  session.paused=true;camera.cancelSearches(session);scans[1].resolve({markers:[],candidates:[]});await flush();
  delete codec.scanScaleGuide;
}
{
  const {camera,session}=setup();let options;
  session.tracking={scan:scan()};session.pending=entry(4);
  codec.scanMarkers=async(p,w,h,o)=>{options=o;return {markers:[],candidates:[]};};
  await camera.scanMarkers(session);
  assert.equal(options.deadline-now,12000);assert(options.seed);
}
{
  const {camera,session}=setup(),reads=workerQueue();let finishScan,accepted;
  session.appraised=0;
  session.pending={...entry(9),guideKind:'edge',fallback:true};
  codec.scanMarkers=(p,w,h,options)=>new Promise(resolve=>{finishScan={resolve,options};});
  camera.accept=async(s,img)=>{s.handingOff=true;accepted=img;};
  const work=camera.scanMarkers(session);
  assert.equal(finishScan.options.deadline-now,24000,'uncalibrated fallback retains the full acquisition budget');
  assert.equal(finishScan.options.scaleGuide,false);
  await advance(9000);
  assert(!finishScan.options.signal.aborted,'a cluttered frame must be allowed to search beyond the old eight-second limit');
  assert.equal(reads.length,0,'payload reading still requires marker geometry');
  finishScan.resolve({...scan(),highConfidence:false});await work;await flush();
  assert.equal(reads.length,1,'the first usable uncalibrated fit proceeds to payload verification without a second appraisal');
  reads[0].resolve({found:true,unreadable:false});await flush();
  assert.equal(accepted.pixels[0],9);assert.equal(timers.size,0);
}
{
  const {camera,session}=setup();let finish,accepted=0;
  codec.readMarkerCandidates=()=>new Promise(resolve=>{finish=resolve;});camera.accept=async()=>accepted++;
  session.history=[entry(1)];camera.readBestFrame(session);await flush();
  session.paused=true;camera.cancelSearches(session);finish({found:true,unreadable:false});await flush();
  assert.equal(accepted,0,'cancelled workers cannot hand off late results');assert.equal(timers.size,0);
}
console.log('PASS: working search budgets, complete fit list/fallback, uninterrupted slower reads, stronger-frame promotion, latest-slot replacement and cancellation');

const pilot={detected:true,confirmed:false,scale:1,fx:1/128,fy:0,width:16,height:16};
{
  const {camera,session}=setup(),guides=[],markers=[];let id=0,reads=0;
  camera.scaleGuideEnabled=true;
  camera.video={readyState:2,currentTime:1};camera.captureFrame=()=>image(++id);camera.captureGuideImage=img=>img;
  codec.scanScaleGuide=(p,w,h,options)=>new Promise(resolve=>guides.push({id:p[0],options,resolve}));
  codec.scanMarkers=(p,w,h,options)=>new Promise((resolve,reject)=>{
    markers.push({id:p[0],options,resolve});
    options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  codec.readMarkerCandidates=async()=>{reads++;return {found:false};};
  camera.scan(session);assert.equal(guides.length,1);assert.equal(markers.length,0);
  assert.equal(guides[0].options.minimumCoverage,undefined,'the historical FFT research route keeps its existing contract');
  guides[0].resolve(null);await flush();assert.equal(markers[0].id,1);
  camera.video.currentTime=2;camera.scan(session);camera.video.currentTime=3;camera.scan(session);
  assert.equal(guides.length,2);assert.equal(session.guidePending.frameNumber,3);
  guides[1].resolve(null);await flush();assert.equal(guides[2].id,3);
  guides[2].resolve(pilot);await flush();
  assert(markers[0].options.signal.aborted,'a later pilot must jump an unconfirmed marker search');
  assert.equal(markers[1].id,3);assert(markers[1].options.scaleGuide.detected);
  assert.equal(markers[1].options.deadline-now,24000);
  markers[1].resolve({markers:[],candidates:[]});await flush();
  assert.equal(reads,0,'a Fourier match without verified marker geometry must never start a payload read');
  assert.equal(timers.size,0);
}
{
  const {camera,session}=setup();session.scanning=true;session.scanningEntry={...entry(1),markerConfirmed:true};
  session.abort=new AbortController();
  const positive={...entry(2),scaleGuide:pilot};camera.enqueueFrame(session,positive);camera.enqueueFrame(session,entry(3));
  assert.equal(session.pending,positive,'unhinted arrivals cannot displace a pending pilot');
  assert(session.abort.signal.aborted,'positive calibration preempts an acquisition that started without calibration, even after a marker verifies');
}
{
  const {camera,session}=setup(),calls=workerQueue();
  session.history=[entry(1,200)];camera.readBestFrame(session);await flush();
  session.pending={...entry(2,50),scaleGuide:pilot};codec.scanMarkers=async()=>scan(50);
  await camera.scanMarkers(session);await flush();
  assert(calls[0].options.signal.aborted);assert.equal(calls[1].id,2,'a verified pilot-bearing frame takes priority even with a lower geometry score');
  assert.equal(calls[1].scan.candidates.length,3);assert(calls[1].options.resumeDiscovery);
  session.pending={...entry(3,50),scaleGuide:pilot};await camera.scanMarkers(session);await flush();
  assert(!calls[1].options.signal.aborted,'equal pilot-bearing fits do not repeatedly restart a valid read');
  session.paused=true;camera.cancelSearches(session);await flush();assert.equal(timers.size,0);
}
{
  const {camera,session}=setup();let finish;const enqueued=[];
  camera.enqueueFrame=(s,e)=>enqueued.push(e);session.guidePending={...entry(1),guideImage:image(1)};
  codec.scanScaleGuide=()=>new Promise(resolve=>{finish=resolve;});
  camera.checkScaleGuide(session);session.paused=true;camera.cancelSearches(session);finish(pilot);await flush();
  assert.equal(enqueued.length,0,'pause invalidates even a late pilot-positive result');assert.equal(timers.size,0);
  session.paused=false;session.guidePending={...entry(2),guideImage:image(2)};
  codec.scanScaleGuide=async()=>{throw Error('Synthetic guide failure');};await camera.checkScaleGuide(session);
  assert.equal(enqueued[0].frameNumber,2);assert(!enqueued[0].scaleGuide,'guide errors retain ordinary discovery');
  session.guidePending={...entry(3),guideImage:image(3)};
  codec.scanScaleGuide=(p,w,h,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
  camera.checkScaleGuide(session);await advance(3500);
  assert.equal(enqueued[1].frameNumber,3);assert(!enqueued[1].scaleGuide);assert.equal(timers.size,0);
  session.purpose='source';camera.captureFrame=()=>{throw Error('Source mode must not sample for analysis');};camera.scan(session);
}
delete codec.scanScaleGuide;
console.log('PASS: independent latest-frame Fourier lookahead, pilot-first priority, marker/payload verification, tie protection and cancelled/error fallback');

{
  const {camera,session}=setup(),guides=[],markers=[],captured=[];let id=0,reads=0;
  camera.calibrationLight={textContent:'',setAttribute(name,value){this[name]=value;}};
  camera.video={readyState:2,currentTime:1};camera.captureFrame=()=>{const current=image(++id);captured.push(current);return current;};
  camera.captureGuideImage=()=>{throw Error('Do not reduce before edge appraisal');};
  codec.scanScaleGuide=()=>{throw Error('Do not run the abandoned full-image pilot');};
  codec.scanEdgeGuide=(p,w,h,options)=>new Promise(resolve=>guides.push({pixels:p,id:p[0],w,h,options,resolve}));
  codec.scanMarkers=(p,w,h,options)=>new Promise((resolve,reject)=>{
    markers.push({id:p[0],options,resolve});options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  codec.readMarkerCandidates=async()=>{reads++;return {found:false};};
  camera.scan(session);assert.equal(guides.length,1);assert.equal(markers.length,0,'uncalibrated frames only start cheap appraisal');
  assert.equal(guides[0].pixels,captured[0].pixels);assert.equal(guides[0].options.deadline-now,3000);
  assert.equal(guides[0].options.minimumCoverage,.5,'live calibration retains the existing half-frame coverage floor');
  guides[0].resolve(null);await flush();assert.equal(markers.length,0);assert.equal(camera.calibrationLight['data-state'],'none');
  assert.equal(camera.calibrationLight.textContent,'No signal');
  await advance(4900);camera.video.currentTime=2;camera.scan(session);guides[1].resolve(null);await flush();assert.equal(markers.length,0);
  await advance(100);camera.video.currentTime=3;camera.scan(session);guides[2].resolve(null);await flush();
  assert.equal(markers.length,1);assert.equal(markers[0].id,3);assert.equal(markers[0].options.deadline-now,24000);assert.equal(markers[0].options.calibratedOnly,false);
  camera.video.currentTime=4;camera.scan(session);camera.video.currentTime=5;camera.scan(session);
  assert.equal(session.guidePending.frameNumber,5);guides[3].resolve(null);await flush();assert.equal(guides[4].id,5);
  guides[4].resolve(pilot);await flush();
  assert(markers[0].options.signal.aborted,'a green frame immediately preempts an uncalibrated fallback');
  assert.equal(markers[1].id,5);assert.equal(markers[1].options.calibratedOnly,true);assert.equal(markers[1].options.deadline-now,8000);
  assert.equal(markers[1].options.seed,undefined);assert.equal(markers[1].options.scaleGuide.scale,pilot.scale);assert.equal(markers[1].options.scaleGuide.fx,pilot.fx);
  assert.equal(camera.calibrationLight['data-state'],'detected');assert.match(camera.calibrationLight.textContent,/Calibration found/);
  markers[1].resolve({markers:[],candidates:[],calibratedOnly:true});await flush();assert.equal(reads,0);
  await advance(7900);camera.video.currentTime=6;camera.scan(session);guides[5].resolve(null);await flush();assert.equal(markers.length,2);
  await advance(100);camera.video.currentTime=7;camera.scan(session);guides[6].resolve(null);await flush();assert.equal(markers.length,3,'one ordinary sample per eight seconds');
  markers[2].resolve({markers:[],candidates:[]});await flush();camera.video.currentTime=8;camera.scan(session);guides[7].resolve(null);await flush();assert.equal(markers.length,3);
  session.paused=true;camera.cancelSearches(session);await flush();assert.equal(timers.size,0);delete codec.scanScaleGuide;
}
{
  const {camera,session}=setup(),guides=[],markers=[];let id=0;
  camera.video={readyState:2,currentTime:1};camera.captureFrame=()=>image(++id);
  codec.scanEdgeGuide=()=>new Promise(resolve=>guides.push(resolve));
  codec.scanMarkers=(p,w,h,options)=>new Promise((resolve,reject)=>{
    markers.push({id:p[0],options,resolve});options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  camera.scan(session);assert.equal(markers.length,0);guides[0](pilot);await flush();assert.equal(markers.length,1);
  camera.enqueueFrame(session,session.scanningEntry);assert.equal(markers.length,1,'same frame cannot restart its own worker');
  camera.video.currentTime=2;camera.scan(session);guides[1](pilot);await flush();
  assert(!markers[0].options.signal.aborted,'equal positives do not repeatedly restart acquisition');assert.equal(session.pending.frameNumber,2);
  camera.video.currentTime=3;camera.scan(session);guides[2](null);await flush();assert.equal(session.pending.frameNumber,2,'miss cannot evict pending positive');
  session.paused=true;camera.cancelSearches(session);await flush();assert.equal(timers.size,0);
}
{
  const {camera,session}=setup(),calls=workerQueue();session.history=[{...entry(1),guideKind:'edge',scaleGuide:pilot,calibratedOnly:true}];
  camera.readBestFrame(session);await flush();assert.equal(calls[0].options.resumeDiscovery,false);assert.equal(calls[0].options.calibratedOnly,true);
  calls[0].resolve({found:true,unreadable:true});await flush();assert(!session.paused);assert.equal(calls.length,1);
}
{
  const {camera,session}=setup();let finish;const enqueued=[];
  camera.enqueueFrame=(s,e)=>enqueued.push(e);session.guidePending={...entry(1),guideKind:'edge'};
  codec.scanEdgeGuide=()=>new Promise(resolve=>{finish=resolve;});camera.checkScaleGuide(session);await advance(3500);
  assert.equal(enqueued.length,1,'unresponsive appraisal releases frame to throttled fallback gate');assert(!enqueued[0].scaleGuide);assert(!session.guideBusy);assert.equal(timers.size,0);
  finish(pilot);await flush();assert.equal(enqueued.length,1,'timed-out late hint cannot enqueue twice');
  session.guidePending={...entry(2),guideKind:'edge'};camera.checkScaleGuide(session);camera.cancelSearches(session);finish(pilot);await flush();assert.equal(enqueued.length,1);
  session.guidePending={...entry(3),guideKind:'edge'};codec.scanEdgeGuide=async()=>{throw Error('Synthetic edge-guide failure');};await camera.checkScaleGuide(session);assert.equal(enqueued[1].frameNumber,3);
  session.purpose='source';session.guidePending={...entry(4),guideKind:'edge'};codec.scanEdgeGuide=()=>{throw Error('Source mode must not analyze');};await camera.checkScaleGuide(session);
  assert.equal(enqueued.length,2);assert.equal(timers.size,0);
}
delete codec.scanEdgeGuide;
console.log('PASS: calibration-first full-raster appraisal, delayed/periodic fallback, positive preemption, one guided grid, green indicator, latest-slot replacement and cancellation');

{
  const {camera,session}=setup(),reads=workerQueue(),markers=[];let accepted;
  session.appraised=0;
  camera.accept=async(s,img)=>{s.handingOff=true;accepted=img;};
  codec.scanMarkers=(p,w,h,options)=>new Promise((resolve,reject)=>{
    markers.push({id:p[0],options,resolve});
    options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  camera.enqueueFrame(session,{...entry(1),guideKind:'edge',scaleGuide:pilot});await flush();
  assert.equal(markers[0].options.calibratedOnly,true);
  await advance(5000);
  camera.enqueueFrame(session,{...entry(2),guideKind:'edge',scaleGuide:pilot});await flush();
  camera.enqueueFrame(session,{...entry(3),guideKind:'edge',scaleGuide:pilot});await flush();
  assert.equal(session.pending.frameNumber,3);
  assert(session.pending.fallback,'newer green frames cannot erase a queued full-search turn');
  markers[0].resolve({markers:[],candidates:[]});await flush();
  assert.equal(markers[1].options.calibratedOnly,false,'repeated green hints must still allow ordinary-scale fallback');
  assert.equal(markers[1].options.deadline-now,24000);
  markers[1].resolve(scan(100));await flush();
  assert.equal(reads.length,1,'the first usable fit starts decoding without waiting for a second appraisal');
  assert.equal(reads[0].options.resumeDiscovery,true);
  camera.enqueueFrame(session,{...entry(4),guideKind:'edge',scaleGuide:pilot});await flush();
  markers[2].resolve(scan(101));await flush();
  assert(!reads[0].options.signal.aborted,'minor score jitter must not cancel a valid payload read');
  reads[0].resolve({found:true,unreadable:false});await flush();
  assert.equal(accepted.pixels[0],3);assert.equal(timers.size,0);
}
console.log('PASS: repeated calibration positives retain full fallback, first-fit payload handoff and score-jitter protection');


{
  const {camera,session}=setup(),reads=workerQueue(),markerCalls=[];let accepted;
  session.history=[entry(1)];camera.readBestFrame(session);await flush();
  codec.scanMarkers=(p,w,h,o)=>new Promise((resolve,reject)=>{
    markerCalls.push({id:p[0],options:o,resolve});o.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  camera.accept=async(s,img)=>{s.handingOff=true;accepted=img;};
  camera.enqueueFrame(session,{...entry(2),guideKind:'edge',scaleGuide:pilot});
  assert(reads[0].options.signal.aborted,'a green frame cancels an uncalibrated payload read before marker appraisal completes');
  await flush();assert.equal(markerCalls[0].id,2);assert(markerCalls[0].options.calibratedOnly);
  assert.equal(reads.length,1,'the new frame still requires its own marker fit before reading');
  markerCalls[0].resolve(scan(50));await flush();
  assert.equal(reads[1].id,2);
  camera.enqueueFrame(session,{...entry(3),guideKind:'edge',scaleGuide:pilot});await flush();
  assert(!reads[1].options.signal.aborted,'another green frame must not interrupt a read already started from calibration');
  markerCalls[1].resolve({markers:[],candidates:[]});await flush();
  reads[1].resolve({found:true,unreadable:false});await flush();
  assert.equal(accepted.pixels[0],2);assert.equal(timers.size,0);
}
console.log('PASS: a green frame immediately replaces uncalibrated payload reads, while calibrated reads remain protected');

{
  const {camera,session}=setup();
  session.ready=true;session.paused=true;session.pending=entry(2);session.guidePending=entry(3);
  session.history=[entry(1)];session.best=session.history[0];session.tracking={scan:scan()};
  session.fallbackAfter=now+8000;session.scanAfter=now+5000;session.lastTime=4;session.appraised=3;
  const abort=new AbortController();session.abort=abort;
  let scheduled=null;
  Object.assign(camera,{backgroundAvailable:true,working:()=>false,nearMiss:{hidden:false},
    still:{width:8,height:8},guides:{width:8,height:8},schedule:(active,delay)=>{scheduled={active,delay};}});
  camera.togglePause();
  assert.equal(session.paused,false);
  assert.equal(session.pending,null);
  assert.equal(session.guidePending,null);
  assert.equal(session.history.length,0);
  assert.equal(session.best,null);
  assert.equal(session.tracking,null);
  assert.equal(session.fallbackAfter,undefined);
  assert.equal(session.scanAfter,0);
  assert.equal(session.lastTime,-1);
  assert.equal(session.appraised,0);
  assert(abort.signal.aborted,'resume must cancel work that was still finishing');
  assert.equal(scheduled.active,session);assert.equal(scheduled.delay,400);
  console.log('PASS: resume drops the pending capture, retained queue and tracking seed before the next scan');
}
// Real codec regression: inaccurate higher-ranked transforms may precede the
// correct one. The camera must not silently discard the third valid candidate.
globalThis.window={};
(0,eval)(await fs.readFile(new URL('pixelstow.js',root),'utf8'));
const actual=globalThis.window.PixelStow,w=320,h=240,pixels=new Uint8Array(w*h*4);
for(let i=0;i<pixels.length;i+=4)pixels.set([120,140,130,255],i);
const content={text:'Public third-candidate camera recovery.',attachments:[]};
const encoded=await actual.encodePayload(pixels,w,h,content,'');
const native=await actual.analyzeNativeMarkers(encoded.pixels,w,h,5);
const candidate=(offset,rank)=>({markers:native.markers,geometry:{...native.geometry,model:'translation',rank,
  matrix:[1,0,offset,0,1,0,0,0,1],corners:native.geometry.corners.map(p=>({x:p.x+offset,y:p.y}))}});
const measured={...native,width:w,height:h,candidates:[candidate(40,120),candidate(-40,110),candidate(0,100)]};
const truncated=await actual.readMarkerCandidates(encoded.pixels,w,h,{...measured,candidates:measured.candidates.slice(0,2)},{worker:false});
assert(truncated.unreadable,'fixture must require a candidate beyond the previous two-fit limit');
const actualWindow=globalThis.window;
vm.runInNewContext(source,{window:actualWindow,PixelStow:actual,AbortController,DOMException,setTimeout,clearTimeout});
const camera=Object.create(actualWindow.PixelStowCamera.prototype);
const captured={image:{pixels:encoded.pixels,width:w,height:h},scan:measured,score:120,frameNumber:1,capturedAt:Date.now()};
const session={purpose:'read',history:[captured],appraised:2};let accepted;
Object.assign(camera,ui,{session,progress:{textContent:''},signature:{textContent:''},
  accept:async(s,image,inspection)=>{s.handingOff=true;accepted={image,inspection};}});
await camera.readBestFrame(session);
assert(accepted&&!accepted.inspection.unreadable);
assert.equal(accepted.image.pixels,encoded.pixels);
assert(actual.payloadsEqual(await actual.decode(encoded.pixels,w,h,'',{nativeOnly:true}),content));
console.log('PASS: a real V5 payload fails with two inaccurate fits but the restored camera succeeds using its third candidate and preserves the captured pixels');

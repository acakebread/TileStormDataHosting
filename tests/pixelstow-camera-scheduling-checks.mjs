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
const ui={readProgress:{begin(){},update(){},signature(){},finish(){}},showBestFrame(){},clearFeedback(){},sync(){},schedule(){}};
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
  assert(!session.abort.signal.aborted,'a verified marker protects useful acquisition until the later frame is appraised');
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
  camera.checkScaleGuide(session);await advance(1200);
  assert.equal(enqueued[1].frameNumber,3);assert(!enqueued[1].scaleGuide);assert.equal(timers.size,0);
  session.purpose='source';camera.captureFrame=()=>{throw Error('Source mode must not sample for analysis');};camera.scan(session);
}
delete codec.scanScaleGuide;
console.log('PASS: independent latest-frame Fourier lookahead, pilot-first priority, marker/payload verification, tie protection and cancelled/error fallback');

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

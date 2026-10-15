// Deterministic live-worker scheduling. Public buffers, fake clock, no hardware.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../pixelstow-camera.js',import.meta.url),'utf8');
let now=100000,sequence=0;const timers=new Map();
const codec={},window={};
vm.runInNewContext(source,{window,PixelStow:codec,AbortController,DOMException,
  Date:{now:()=>now},setTimeout:(callback,delay)=>{const id=++sequence;timers.set(id,{at:now+delay,callback});return id;},
  clearTimeout:id=>timers.delete(id)});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const advance=async ms=>{now+=ms;for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}await flush();};
const image=id=>({width:16,height:16,pixels:Uint8Array.from({length:1024},()=>id)});
const scan=(score=100)=>({width:16,height:16,markers:[{id:0,verification:'header',carrierVersion:5}],
  candidates:[0,1,2].map(n=>({geometry:{rank:score-n,matrix:[1,0,0,0,1,0,0,0,1]}})),
  geometry:{rank:score,matrix:[1,0,0,0,1,0,0,0,1]}});
const entry=(id,score=100,age=0)=>({image:image(id),scan:scan(score),score,frameNumber:id,capturedAt:now-age});
function setup(){
  timers.clear();
  const camera=Object.create(window.PixelStowCamera.prototype),session={purpose:'read',history:[],frames:0};
  Object.assign(camera,{session,progress:{textContent:''},signature:{textContent:''},
    readProgress:{begin(){},update(){},signature(){},finish(){}},showBestFrame(){},clearFeedback(){},sync(){},schedule(){}});
  return {camera,session};
}
function workerQueue(){
  const calls=[];
  codec.readMarkerCandidates=(pixels,width,height,scan,options)=>new Promise((resolve,reject)=>{
    calls.push({id:pixels[0],scan,options,resolve,reject});
    options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  return calls;
}

for(const freshScore of [100,99,98]){
  const {camera,session}=setup(),calls=workerQueue();
  session.history=[entry(1)];camera.readBestFrame(session);await flush();
  assert.equal(calls.length,1,'the first stable fit gets a bounded read without waiting for a second scan');
  assert.equal(calls[0].scan.candidates.length,2);assert.equal(calls[0].options.resumeDiscovery,false);
  assert.equal(calls[0].options.deadline-now,8000);
  await advance(200);session.history.push(entry(2,freshScore));camera.promoteFreshFrame(session);
  assert(!calls[0].options.signal.aborted,'an equal fit gives the active read its initial grace');
  await advance(2300);
  assert(calls[0].options.signal.aborted);assert.equal(calls[1].id,2,'the queued equal fit promotes when grace expires, even without another scan callback');
  assert.equal(session.history[0].state,'replaced by a fresher capture');
  camera.cancelSearches(session);session.paused=true;await flush();
}
{
  const {camera,session}=setup(),calls=workerQueue();
  session.history=[entry(1,100)];camera.readBestFrame(session);await advance(100);
  session.history.push(entry(2,110));camera.promoteFreshFrame(session);await flush();
  assert(calls[0].options.signal.aborted);assert.equal(calls[1].id,2,'a clearly stronger capture preempts immediately');
  await advance(3000);session.history.push(entry(3,70));camera.promoteFreshFrame(session);await flush();
  assert(!calls[1].options.signal.aborted,'recency must not promote a substantially worse fit');
  await advance(5000);assert(calls[1].options.signal.aborted,'a slow payload worker has a hard bounded turn');
  session.paused=true;camera.cancelSearches(session);await flush();
}
{
  const {camera,session}=setup();let id=0;const scans=[];
  camera.video={readyState:2,currentTime:1};camera.captureFrame=()=>image(++id);
  codec.scanMarkers=(pixels,width,height,options)=>new Promise((resolve,reject)=>{
    scans.push({id:pixels[0],options,resolve});
    options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  });
  camera.scan(session);camera.video.currentTime=2;camera.scan(session);camera.video.currentTime=3;camera.scan(session);
  assert.equal(scans.length,1);assert.equal(session.pending.image.pixels[0],3);
  assert.equal(scans[0].options.deadline-now,6000);
  await advance(6500);
  assert(scans[0].options.signal.aborted);assert.equal(scans[1].id,3,'a timed-out marker worker yields to the latest slot, skipping the intermediate frame');
  assert(!session.paused,'normal live time slicing must not pause capture');
  session.paused=true;camera.cancelSearches(session);await flush();
}
{
  const {camera,session}=setup();let options;
  session.tracking={scan:scan()};session.pending=entry(4);
  codec.scanMarkers=async(p,w,h,o)=>{options=o;return {markers:[],candidates:[]};};
  await camera.scanMarkers(session);
  assert.equal(options.deadline-now,3000);assert(options.seed,'verified dimensions/pose are reused only as a seed for fresh pixels');
  session.history=[entry(1,120,13000),entry(2,100,1000),entry(3,100,0)];
  assert.equal(camera.nextReadFrame(session).frameNumber,3,'fresh ties beat older captures and stale high scores cannot re-enter the automatic queue');
  session.paused=true;camera.cancelSearches(session);
}
{
  const {camera,session}=setup();let finish,accepted=0;
  codec.readMarkerCandidates=()=>new Promise(resolve=>{finish=resolve;});
  camera.accept=async()=>accepted++;
  session.history=[entry(1)];camera.readBestFrame(session);await flush();
  session.paused=true;camera.cancelSearches(session);
  finish({found:true,unreadable:false});await flush();
  assert.equal(accepted,0,'a cancelled worker cannot hand off a late successful result');
  assert.equal(timers.size,0,'pause clears promotion and worker timers');
}
{
  const {camera,session}=setup(),calls=workerQueue();let accepted;
  const original=entry(1);session.history=[original];
  camera.accept=async(s,image)=>{s.handingOff=true;accepted=image;};
  camera.readBestFrame(session);await flush();calls[0].resolve({found:true,unreadable:false});await flush();
  assert.equal(accepted,original.image,'only the worker-confirmed capture is handed off, without borrowing newer pixels');
  assert.equal(timers.size,0);
}
{
  const {camera,session}=setup(),calls=workerQueue();let accepted;
  camera.accept=async(s,image)=>{s.handingOff=true;accepted=image;};
  session.history=[entry(1)];camera.readBestFrame(session);await flush();
  for(const id of [2,3]){
    await advance(100);session.history.push(entry(id));camera.promoteFreshFrame(session);await advance(2400);
    assert.equal(calls.at(-1).id,id);
  }
  await advance(100);session.history.push(entry(4));camera.promoteFreshFrame(session);await advance(5000);
  assert(!calls.at(-1).options.signal.aborted,'a stream of near-ties must eventually give the decoder a full bounded turn');
  calls.at(-1).resolve({found:true,unreadable:false});await flush();
  assert.equal(accepted.pixels[0],3,'a slower successful read can finish despite more comparable arrivals');
  assert.equal(session.freshPromotions,0);assert.equal(timers.size,0);
}
console.log('PASS: latest-slot marker time slicing, bounded payload turns, immediate stronger/equal-after-grace promotion, stale/worse rejection, tracking reuse and cancellation');

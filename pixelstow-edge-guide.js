/* Low-contrast V5 calibration hint. It is never proof of a readable payload.
 * The profile is a carrier-format detail: keep these pitches, phases, placement
 * and integer rounding stable so apply(..., {inverse:true}) can remove it.
 * scale is capture pixels per native carrier pixel. fx/fy deliberately use the
 * existing transform's 1/(128*scale) convention, not the physical guide pitch.
 */
(function(root) {
  'use strict';
  const TAU=Math.PI*2, BAND=48, INSET=8, NORMAL=24, PITCHES=[64,96], PHASES=[.31,1.19], LIMIT=2;
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  const clamp=value=>Math.max(0,Math.min(255,value));
  function reservations(w,h) {
    const xs=[8,4*Math.floor((w-60)/4)],ys=[8,4*Math.floor((h-60)/4)];
    const result=[];for(const x of xs)for(const y of ys)result.push({x,y,w:52,h:52});
    const mx=Math.floor((w-24)/8)*4,my=Math.floor((h-16)/8)*4;
    result.push({x:mx,y:8,w:24,h:16},{x:8,y:my,w:24,h:16},{x:Math.floor((w-32)/4)*4,y:my,w:24,h:16},{x:mx,y:Math.floor((h-24)/4)*4,w:24,h:16});
    return result;
  }
  function apply(pixels,w,h,options={}) {
    if(!Number.isInteger(w)||!Number.isInteger(h)||pixels.length!==w*h*4)throw new Error('Invalid edge-guide image.');
    const output=new Uint8Array(pixels),reserved=reservations(w,h),sign=options.inverse?-1:1;
    if(w<256||h<192)return output;
    const waves=Float64Array.from({length:Math.max(w,h)},(_,x)=>Math.cos(TAU*x/64+PHASES[0])+Math.cos(TAU*x/96+PHASES[1]));
    const envelope=Float64Array.from({length:BAND},(_,d)=>Math.sin(Math.PI*(d+.5)/BAND)*Math.cos(TAU*d/NORMAL+.43));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      let normal=-1,tangent;
      if(x>=64&&x<w-64) {
        if(y>=INSET&&y<INSET+BAND){normal=y-INSET;tangent=x;}
        else if(y>=h-INSET-BAND&&y<h-INSET){normal=h-INSET-1-y;tangent=x;}
      }
      if(normal<0&&y>=64&&y<h-64) {
        if(x>=INSET&&x<INSET+BAND){normal=x-INSET;tangent=y;}
        else if(x>=w-INSET-BAND&&x<w-INSET){normal=w-INSET-1-x;tangent=y;}
      }
      if(normal<0||reserved.some(r=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h))continue;
      const delta=sign*Math.max(-LIMIT,Math.min(LIMIT,Math.round(waves[tangent]*envelope[normal]))),i=(x+y*w)*4;
      output[i]=clamp(output[i]+delta);output[i+1]=clamp(output[i+1]-delta);output[i+2]=clamp(output[i+2]+delta);
    }
    return output;
  }
  const angleDistance=value=>Math.abs(Math.atan2(Math.sin(value),Math.cos(value)));
  function scanAxis(q,scale,vertical,check) {
    const {data,w,h,reduction}=q,N=vertical?h:w,M=vertical?w:h;
    const start=Math.round(64*scale/reduction),stop=N-start,L=Math.round(BAND*scale/reduction);
    if(stop<start+16||L<4||M<L)return [];
    const state=q.axes[vertical?1:0],{rs,basis,prefix}=state,stride=(N+1)*4,normalization=2/(stop-start);
    for(let x=0;x<N;x++) {
      const a=TAU*(x+.5)*reduction/(64*scale),b=TAU*(x+.5)*reduction/(96*scale),i=x*4;
      basis[i]=Math.cos(a);basis[i+1]=Math.sin(a);basis[i+2]=Math.cos(b);basis[i+3]=Math.sin(b);
    }
    for(let y=0;y<M;y++) {
      if((y&63)===0)check();
      const i=y*4,row=y*stride;let a=0,b=0,c=0,d=0;
      for(let x=0;x<N;x++) {
        const value=vertical?data[y+x*w]:data[x+y*w],j=x*4,to=row+(x+1)*4;
        a+=value*basis[j];b+=value*basis[j+1];c+=value*basis[j+2];d+=value*basis[j+3];
        prefix[to]=a;prefix[to+1]=b;prefix[to+2]=c;prefix[to+3]=d;
      }
      for(let k=0;k<4;k++)rs[i+k]=(prefix[row+stop*4+k]-prefix[row+start*4+k])*normalization;
    }
    const kernel=new Float64Array(L);let mean=0,slope=0,energy=0;
    for(let j=0;j<L;j++) {
      const d=(j+.5)*reduction/scale-.5;
      kernel[j]=Math.sin(Math.PI*(d+.5)/BAND)*Math.cos(TAU*d/NORMAL+.43);mean+=kernel[j];
    }
    mean/=L;
    for(let j=0;j<L;j++)slope+=(j-(L-1)/2)*(kernel[j]-mean);
    slope/=L*(L*L-1)/12;
    for(let j=0;j<L;j++){kernel[j]-=mean+slope*(j-(L-1)/2);energy+=kernel[j]*kernel[j];}
    state.kernel=kernel;state.energy=energy;
    const found=[];
    for(let y=0;y<=M-L;y++)for(let direction=0;direction<2;direction++) {
      if(q.knownBounds&&Math.min(Math.abs(y-INSET*scale/reduction),Math.abs(y-(M-(INSET+BAND)*scale/reduction)))>2.5)continue;
      let a=0,b=0,c=0,d=0;
      for(let j=0;j<L;j++) {
        const value=kernel[direction?L-1-j:j]/energy,i=(y+j)*4;
        a+=rs[i]*value;b+=rs[i+1]*value;c+=rs[i+2]*value;d+=rs[i+3]*value;
      }
      const amplitude=[Math.hypot(a,b),Math.hypot(c,d)],phase=[Math.atan2(b,a),Math.atan2(d,c)];
      const closure=angleDistance(2*phase[0]-3*phase[1]-(6*PHASES[1]-4*PHASES[0])/2),score=Math.min(...amplitude);
      if(score>(q.knownBounds?.3:.5)&&closure<(q.knownBounds?Math.PI:1.1))found.push({position:y,direction,amplitude,phase,closure,score});
    }
    found.sort((a,b)=>b.score-a.score);const separated=[];
    for(const value of found)if(!separated.some(previous=>previous.direction===value.direction&&Math.abs(previous.position-value.position)<L*.3))separated.push(value);
    return separated.slice(0,40);
  }
  function measureStrip(q,scale,vertical,strip,start,stop) {
    const {w,h}=q,N=vertical?h:w,state=q.axes[vertical?1:0],{kernel,energy,prefix}=state,L=kernel.length,stride=(N+1)*4;
    start=Math.max(0,Math.ceil(start));stop=Math.min(N,Math.floor(stop));
    if(stop-start<24)return null;
    const z=[0,0,0,0];
    for(let j=0;j<L;j++) {
      const y=strip.position+j,weight=kernel[strip.direction?L-1-j:j]/energy,from=y*stride+start*4,to=y*stride+stop*4;
      for(let k=0;k<4;k++)z[k]+=(prefix[to+k]-prefix[from+k])*weight;
    }
    const amplitude=[Math.hypot(z[0],z[1]),Math.hypot(z[2],z[3])].map(value=>value*2/(stop-start));
    return {...strip,amplitude,phase:[Math.atan2(z[1],z[0]),Math.atan2(z[3],z[2])],score:Math.min(...amplitude)};
  }
  function matchFrame(q,scale,check) {
    const sides=[scanAxis(q,scale,false,check),scanAxis(q,scale,true,check)],pairs=[];
    for(let axis=0;axis<2;axis++) {
      const candidates=[],values=sides[axis],dimension=axis===0?q.h:q.w;
      for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++) {
        const a=values[i],b=values[j],first=a.position<b.position?a:b;
        if(Math.abs(a.position-b.position)<dimension*.5)continue;
        if(q.knownBounds&&(Math.abs(first.position-INSET*scale/q.reduction)>2.5||
          Math.abs((first===a?b:a).position-(dimension-(INSET+BAND)*scale/q.reduction))>2.5))continue;
        const coherence=Math.max(...a.phase.map((value,k)=>angleDistance(value-b.phase[k])));
        if(coherence>(q.knownBounds?1.2:.4))continue;
        const score=Math.min(a.score,b.score);
        candidates.push({score,coherence,first,second:first===a?b:a});
      }
      pairs.push(candidates.sort((a,b)=>b.score-a.score).slice(0,30));
    }
    let best=null;
    for(const horizontal of pairs[0])for(const vertical of pairs[1]) {
      check();
      const sx=vertical.first.position+(64-INSET)*scale/q.reduction,ex=vertical.second.position+(INSET+BAND-64)*scale/q.reduction;
      const sy=horizontal.first.position+(64-INSET)*scale/q.reduction,ey=horizontal.second.position+(INSET+BAND-64)*scale/q.reduction;
      const measured=[{...horizontal,first:measureStrip(q,scale,false,horizontal.first,sx,ex),second:measureStrip(q,scale,false,horizontal.second,sx,ex)},
        {...vertical,first:measureStrip(q,scale,true,vertical.first,sy,ey),second:measureStrip(q,scale,true,vertical.second,sy,ey)}];
      if(measured.some(pair=>!pair.first||!pair.second))continue;
      const phaseErrors=[],coherences=[],amplitudes=[];
      for(let axis=0;axis<2;axis++) {
        const perpendicular=axis===0?vertical:horizontal,origin=perpendicular.first.position-INSET*scale/q.reduction;
        const expected=PITCHES.map((pitch,i)=>-PHASES[i]+TAU*(origin+.5*scale/q.reduction)/(pitch*scale/q.reduction));
        const pair=measured[axis];
        for(const strip of [pair.first,pair.second])for(let k=0;k<2;k++) {
          phaseErrors.push(angleDistance(strip.phase[k]-expected[k]));amplitudes.push(strip.amplitude[k]);
        }
        coherences.push(...pair.first.phase.map((phase,k)=>angleDistance(phase-pair.second.phase[k])));
      }
      const error=Math.max(...phaseErrors),score=Math.min(...amplitudes);
      const strong=phaseErrors.filter((error,i)=>error<.75&&amplitudes[i]>.7).length;
      const robustScore=amplitudes.slice().sort((a,b)=>a-b)[2];
      if(q.knownBounds) {
        if(strong<6||robustScore<.8||phaseErrors.some((error,i)=>error>1.2&&amplitudes[i]>.3)||
          coherences.filter(error=>error<.6).length<3||Math.max(...coherences)>1.2)continue;
      } else if(error>.75||Math.max(...coherences)>.4||score<1.05)continue;
      const confidence=q.knownBounds?robustScore:score;
      if(!best||confidence>best.score)best={scale,score:confidence,pairs:measured,phaseError:error};
    }
    return best;
  }
  function axisStorage(q) {
    const axis=(N,M)=>({basis:new Float64Array(N*4),rs:new Float64Array(M*4),prefix:new Float32Array(M*(N+1)*4)});
    q.axes=[axis(q.w,q.h),axis(q.h,q.w)];return q;
  }
  function hasFlatBorder(pixels,width,height) {
    const colours=[];
    for(let i=0;i<12;i++)for(const [x,y] of [[i*(width-1)/11,0],[i*(width-1)/11,height-1],[0,i*(height-1)/11],[width-1,i*(height-1)/11]]) {
      const at=(Math.round(x)+Math.round(y)*width)*4;colours.push([pixels[at],pixels[at+1],pixels[at+2]]);
    }
    return colours.some(seed=>colours.filter(value=>Math.max(...value.map((v,i)=>Math.abs(v-seed[i])))<20).length>=24);
  }
  function quadMap(corners) {
    const [a,b,c,d]=corners,dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
    const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y,denominator=dx1*dy2-dx2*dy1;
    if(Math.abs(denominator)<1e-8)return null;
    const g=(dx3*dy2-dx2*dy3)/denominator,h=(dx1*dy3-dx3*dy1)/denominator;
    const H=[b.x-a.x+g*b.x,d.x-a.x+h*d.x,a.x,b.y-a.y+g*b.y,d.y-a.y+h*d.y,a.y,g,h];
    return (x,y)=>{const z=g*x+h*y+1;return{x:(H[0]*x+H[1]*y+H[2])/z,y:(H[3]*x+H[4]*y+H[5])/z};};
  }
  function rectify(q,quad,check) {
    const start=quad.reduce((best,p,i)=>p.x+p.y<quad[best].x+quad[best].y?i:best,0);
    quad=quad.slice(start).concat(quad.slice(0,start));
    const length=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),r=q.reduction;
    const w=Math.round((length(quad[0],quad[1])+length(quad[3],quad[2]))/(2*r));
    const h=Math.round((length(quad[0],quad[3])+length(quad[1],quad[2]))/(2*r));
    const map=quadMap(quad);
    if(!map||w<64||h<48||w*h>q.w*q.h*1.2)return null;
    const data=new Float64Array(w*h),offset=(r-1)/2;
    for(let y=0;y<h;y++) {
      if((y&31)===0)check();
      for(let x=0;x<w;x++) {
        const p=map((x+.5)/w,(y+.5)/h),sx=Math.max(0,Math.min(q.w-1,(p.x-offset)/r)),sy=Math.max(0,Math.min(q.h-1,(p.y-offset)/r));
        const ix=Math.floor(sx),iy=Math.floor(sy),jx=Math.min(q.w-1,ix+1),jy=Math.min(q.h-1,iy+1),fx=sx-ix,fy=sy-iy;
        data[x+y*w]=(q.data[ix+iy*q.w]*(1-fx)+q.data[jx+iy*q.w]*fx)*(1-fy)+(q.data[ix+jy*q.w]*(1-fx)+q.data[jx+jy*q.w]*fx)*fy;
      }
    }
    return axisStorage({data,w,h,reduction:r,map,quad,knownBounds:true});
  }
  function orthogonalQuads(quads) {
    const groups=[];
    for(const quad of quads)for(let i=0;i<4;i++) {
      const a=quad[i],b=quad[(i+1)%4];let angle=Math.atan2(b.y-a.y,b.x-a.x);
      angle=Math.atan2(Math.sin(4*angle),Math.cos(4*angle))/4;
      let group=groups.find(group=>angleDistance(group.angle-angle)<.004);
      if(!group){group={angle,values:[]};groups.push(group);}group.values.push(angle);
      group.angle=group.values.reduce((sum,value)=>sum+value,0)/group.values.length;
    }
    const points=quads.flat();
    return groups.sort((a,b)=>b.values.length-a.values.length).slice(0,3).map(group=> {
      const cs=Math.cos(group.angle),sn=Math.sin(group.angle),xs=points.map(p=>cs*p.x+sn*p.y),ys=points.map(p=>-sn*p.x+cs*p.y);
      const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
      return [[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>({x:cs*x-sn*y,y:sn*x+cs*y}));
    });
  }
  async function searchQuarter(q,options,check) {
    let best=null,lastYield=Date.now();
    const low=options.minimumScale||.5,high=options.maximumScale||2.5,step=options.scaleStep||.01;
    for(let scale=low;scale<=high+step/2;scale+=step) {
      check();const candidate=matchFrame(q,scale,check);
      if(candidate&&(!best||candidate.score>best.score))best=candidate;
      if(Date.now()-lastYield>40){await pause();lastYield=Date.now();}
    }
    return best;
  }
  async function detect(pixels,width,height,options={}) {
    if(width<192||height<128||pixels.length!==width*height*4)return null;
    const started=Date.now(),deadline=Math.min(options.deadline||Infinity,started+(options.maxMilliseconds||1000));
    const check=()=> {
      if(options.signal?.aborted){const error=new Error('Search cancelled.');error.name='AbortError';throw error;}
      if(Date.now()>=deadline){const error=new Error('Edge-guide appraisal time limit.');error.name='EdgeGuideLimit';throw error;}
    };
    try {
      const reduction=options.reduction||4;
      if(!Number.isInteger(reduction)||reduction<1||reduction>12)return null;
      // This is the only image reduction. Full-resolution pixel positions map
      // directly to this explicitly chosen sampling grid.
      const w=Math.floor(width/reduction),h=Math.floor(height/reduction),data=new Float64Array(w*h);
      for(let y=0;y<h;y++) {
        if((y&63)===0){check();if(y===0)await pause();}
        for(let x=0;x<w;x++) {
          let value=0;
          for(let dy=0;dy<reduction;dy++)for(let dx=0;dx<reduction;dx++) {
            const i=(x*reduction+dx+(y*reduction+dy)*width)*4;
            value+=(pixels[i]+pixels[i+2])*.5-pixels[i+1];
          }
          data[x+y*w]=value/(reduction*reduction);
        }
      }
      const original=axisStorage({data,w,h,reduction});let selected=original,best=null;
      original.knownBounds=true;
      best=await searchQuarter(original,options,check);
      original.knownBounds=false;
      if(!best&&options.outlineSearch!==false&&root.PixelStowTransform?.proposeOutlines&&hasFlatBorder(pixels,width,height)) {
        let quads=[];
        try {quads=await root.PixelStowTransform.proposeOutlines(pixels,width,height,{signal:options.signal,deadline:Math.min(deadline,Date.now()+250)});}
        catch(error){if(error.name==='AbortError')throw error;}
        for(const quad of orthogonalQuads(quads).concat(quads.slice(0,1))) {
          const rectified=rectify(original,quad,check);if(!rectified)continue;
          const candidate=await searchQuarter(rectified,options,check);
          if(candidate){best=candidate;selected=rectified;break;}
        }
      }
      if(!best)best=await searchQuarter(original,options,check);
      if(!best)return null;
      const horizontal=best.pairs[0],vertical=best.pairs[1];
      const bounds={left:vertical.first.position*reduction-INSET*best.scale,
        top:horizontal.first.position*reduction-INSET*best.scale,
        right:vertical.second.position*reduction+(INSET+BAND)*best.scale,
        bottom:horizontal.second.position*reduction+(INSET+BAND)*best.scale};
      let corners=[{x:bounds.left,y:bounds.top},{x:bounds.right-best.scale,y:bounds.top},
        {x:bounds.right-best.scale,y:bounds.bottom-best.scale},{x:bounds.left,y:bounds.bottom-best.scale}],orientation=0;
      if(selected.map) {
        corners=corners.map(point=>selected.map((point.x+.5)/(selected.w*reduction),(point.y+.5)/(selected.h*reduction)));
        orientation=Math.atan2(corners[1].y-corners[0].y,corners[1].x-corners[0].x);
      }
      return {detected:true,confirmed:false,experimental:true,kind:'opponent-edge-guide',width,height,reduction,
        scale:best.scale,fx:Math.cos(orientation)/(128*best.scale),fy:Math.sin(orientation)/(128*best.scale),orientation,score:best.score,agreement:true,
        contrast:best.score,support:4,...(selected.map?{rectifiedBounds:bounds}:{bounds}),corners,outlined:Boolean(selected.map),workingWidth:w,workingHeight:h,milliseconds:Date.now()-started,
        evidence:best.pairs.map(pair=>({coherence:pair.coherence,closure:[pair.first.closure,pair.second.closure],
          positions:[pair.first.position*reduction,pair.second.position*reduction]}))};
    } catch(error){if(error.name==='EdgeGuideLimit')return null;throw error;}
  }
  root.PixelStowEdgeGuide={apply,detect,profile:Object.freeze({experimental:true,amplitude:LIMIT,band:BAND,inset:INSET,normalPitch:NORMAL,pitches:Object.freeze(PITCHES.slice())})};
})(typeof window!=='undefined'?window:self);

// Coarse geometric rulers for two V5 corners. No DOM, payload or acceptance gate.
(function(root) {
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  function check(options){
    if(options.signal?.aborted)throw new DOMException("Search cancelled.","AbortError");
    return Date.now()<(options.deadline||Infinity);
  }
  function point(h,x,y){const d=h[6]*x+h[7]*y+h[8];return {x:(h[0]*x+h[1]*y+h[2])/d,y:(h[3]*x+h[4]*y+h[5])/d};}
  function fit(source,target){
    const rows=[];
    for(let i=0;i<4;i++){
      const [x,y]=source[i],{x:u,y:v}=target[i];
      rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);
    }
    for(let col=0;col<8;col++){
      let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(rows[row][col])>Math.abs(rows[pivot][col]))pivot=row;
      if(Math.abs(rows[pivot][col])<1e-9)return null;
      [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
      const divisor=rows[col][col];for(let j=col;j<=8;j++)rows[col][j]/=divisor;
      for(let row=0;row<8;row++)if(row!==col){const amount=rows[row][col];for(let j=col;j<=8;j++)rows[row][j]-=amount*rows[col][j];}
    }
    return rows.map(row=>row[8]).concat(1);
  }
  function hull(points){
    points.sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),lower=[],upper=[];
    for(const p of points){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(let i=points.length-1;i>=0;i--){const p=points[i];while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    const polygon=lower.slice(0,-1).concat(upper.slice(0,-1));
    while(polygon.length>4){
      let best=0,area=Infinity;
      for(let i=0;i<polygon.length;i++){const value=Math.abs(cross(polygon[(i+polygon.length-1)%polygon.length],polygon[i],polygon[(i+1)%polygon.length]));if(value<area){best=i;area=value;}}
      polygon.splice(best,1);
    }
    return polygon;
  }
  function sample(luma,w,h,x,y){
    if(x<0||y<0||x>w-1||y>h-1)return NaN;
    const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),fx=x-ix,fy=y-iy;
    return (luma[ix+iy*w]*(1-fx)+luma[jx+iy*w]*fx)*(1-fy)+(luma[ix+jy*w]*(1-fx)+luma[jx+jy*w]*fx)*fy;
  }
  function quality(luma,w,h,matrix){
    let white=0,black=0,count=0,good=0;
    for(const t of [8,14,20,26,32,38,44])for(let side=0;side<4;side++){
      const xy=d=>side===0?[d,t]:side===1?[51-d,t]:side===2?[t,d]:[t,51-d];
      const wp=point(matrix,...xy(.5)),bp=point(matrix,...xy(3.5));
      const a=sample(luma,w,h,wp.x,wp.y),b=sample(luma,w,h,bp.x,bp.y);
      if(!Number.isFinite(a+b))return -Infinity;
      white+=a;black+=b;good+=a-b>60;count++;
    }
    return (white-black)/count*Math.min(1,good/(count*.85));
  }
  function refineEdges(luma,w,h,quad){
    const lines=[];
    for(let side=0;side<4;side++){
      const a=quad[side],b=quad[(side+1)%4],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
      const nx=dy/length,ny=-dx/length,points=[];
      for(let j=2;j<=8;j++){
        const x=a.x+dx*j/10,y=a.y+dy*j/10;let best=-Infinity,offset=0;
        for(let d=-2;d<=2;d+=.125){
          const score=sample(luma,w,h,x+(d+.65)*nx,y+(d+.65)*ny)-sample(luma,w,h,x+(d-.65)*nx,y+(d-.65)*ny);
          if(score>best){best=score;offset=d;}
        }
        if(best>60)points.push({x:x+offset*nx,y:y+offset*ny});
      }
      if(points.length<4)return quad;
      const x=points.reduce((s,p)=>s+p.x,0)/points.length,y=points.reduce((s,p)=>s+p.y,0)/points.length;
      let xx=0,xy=0,yy=0;for(const p of points){xx+=(p.x-x)**2;xy+=(p.x-x)*(p.y-y);yy+=(p.y-y)**2;}
      const angle=.5*Math.atan2(2*xy,xx-yy),vx=Math.cos(angle),vy=Math.sin(angle);
      lines.push({x,y,vx,vy});
    }
    const result=[];
    for(let i=0;i<4;i++){
      const a=lines[(i+3)%4],b=lines[i],cross=a.vx*b.vy-a.vy*b.vx;if(Math.abs(cross)<.2)return quad;
      const t=((b.x-a.x)*b.vy-(b.y-a.y)*b.vx)/cross;
      const p={x:a.x+t*a.vx,y:a.y+t*a.vy};if(Math.hypot(p.x-quad[i].x,p.y-quad[i].y)>4)return quad;
      result.push(p);
    }
    return result;
  }
  async function find(pixels,width,height,options={}){
    const deadline=Math.min(options.deadline||Infinity,Date.now()+600);options={...options,deadline};
    let yieldedAt=Date.now();
    const checkpoint=async()=>{
      if(!check(options))return false;
      // Windows can round a zero-delay timer up to ~16 ms. Yield by elapsed
      // CPU time, rather than paying that delay at every row/component block.
      if(Date.now()-yieldedAt>=8){await pause();yieldedAt=Date.now();}
      return check(options);
    };
    const factor=Math.min(1,960/Math.max(width,height)),w=Math.round(width*factor),h=Math.round(height*factor);
    const luma=new Uint8Array(w*h),histogram=new Uint32Array(256);
    for(let y=0;y<h;y++){
      if((y&63)===0&&!await checkpoint())return [];
      const sy=Math.min(height-1,Math.floor((y+.5)*height/h));
      for(let x=0;x<w;x++){const sx=Math.min(width-1,Math.floor((x+.5)*width/w)),i=(sx+sy*width)*4,v=Math.round((pixels[i]+pixels[i+1]+pixels[i+2])/3);luma[x+y*w]=v;histogram[v]++;}
    }
    const quantile=q=>{let total=0;for(let i=0;i<256;i++){total+=histogram[i];if(total>=luma.length*q)return i;}return 255;};
    const adaptiveThreshold=Math.max(35,Math.min(95,quantile(.05)+.28*(quantile(.95)-quantile(.05))));
    const queue=new Int32Array(luma.length),proposals=[];
    // Native frame pixels are at most 32. Start there so ordinary mid-tone
    // payload texture does not generate thousands of component hypotheses.
    // The broader pass accommodates raised camera black levels if necessary.
    for(const threshold of [...new Set([35,Math.round(adaptiveThreshold)])]){
    const seen=new Uint8Array(luma.length);
    for(let start=0;start<luma.length;start++){
      if((start&32767)===0&&!await checkpoint())return proposals.sort((a,b)=>b.score-a.score).slice(0,12);
      if(seen[start]||luma[start]>threshold)continue;
      let head=0,tail=1,minX=w,maxX=0,minY=h,maxY=0;queue[0]=start;seen[start]=1;const boundary=[];
      while(head<tail){
        const i=queue[head++],x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        let edge=false;
        for(let side=0;side<4;side++){
          const n=side===0?(x?i-1:-1):side===1?(x<w-1?i+1:-1):side===2?(y?i-w:-1):(y<h-1?i+w:-1);
          if(n<0||luma[n]>threshold){edge=true;continue;}
          if(!seen[n]){seen[n]=1;queue[tail++]=n;}
        }
        if(edge&&tail<12000)boundary.push({x,y});
        if((head&32767)===0&&!await checkpoint())return proposals.sort((a,b)=>b.score-a.score).slice(0,12);
      }
      const bw=maxX-minX+1,bh=maxY-minY+1;
      if(bw<13||bh<13||bw>320||bh>320||Math.max(bw/bh,bh/bw)>2||tail<bw*bh*.12||boundary.length<16)continue;
      let quad=hull(boundary);if(quad.length!==4)continue;
      const cx=quad.reduce((s,p)=>s+p.x,0)/4,cy=quad.reduce((s,p)=>s+p.y,0)/4;
      quad=quad.map(p=>({x:cx+(p.x-cx)*(1+1/bw),y:cy+(p.y-cy)*(1+1/bh)}));
      quad=refineEdges(luma,w,h,quad);
      const matrix=fit([[1.5,1.5],[49.5,1.5],[49.5,49.5],[1.5,49.5]],quad);if(!matrix)continue;
      const score=quality(luma,w,h,matrix);if(score<100)continue;
      // Lift pixel centres directly to the untouched full capture.
      const lifted=[matrix[0]*width/w+(width/w-1)/2*matrix[6],matrix[1]*width/w+(width/w-1)/2*matrix[7],matrix[2]*width/w+(width/w-1)/2*matrix[8],
        matrix[3]*height/h+(height/h-1)/2*matrix[6],matrix[4]*height/h+(height/h-1)/2*matrix[7],matrix[5]*height/h+(height/h-1)/2*matrix[8],matrix[6],matrix[7],matrix[8]];
      const liftedQuad=quad.map(p=>({x:(p.x+.5)*width/w-.5,y:(p.y+.5)*height/h-.5}));
      if(!proposals.some(proposal=>proposal.quad.every((p,i)=>Math.hypot(p.x-liftedQuad[i].x,p.y-liftedQuad[i].y)<3)))
        proposals.push({matrix:lifted,quad:liftedQuad,score});
    }
    if(proposals.length>=2)break;
    }
    return proposals.sort((a,b)=>b.score-a.score).slice(0,12);
  }
  root.PixelStowFinder={find,fit,point};
})(typeof window!=="undefined"?window:self);

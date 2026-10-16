// Optional UI regression with local captures; screenshots/metadata stay ignored.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),inputs=process.argv.slice(2);
assert(inputs.length,'Supply decoded camera captures.');
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const server=http.createServer(async(req,res)=>{
  try {
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(path.relative(root,file).startsWith('..'))throw Error('Outside workspace');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const output=path.join(root,'artifacts/recovered-preview-checks');await fs.mkdir(output,{recursive:true});
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage({viewport:{width:476,height:900},isMobile:true,hasTouch:true});
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  for(let i=0;i<inputs.length;i++) {
    const bytes=(await fs.readFile(inputs[i])).toString('base64');
    await page.evaluate(async bytes=>{
      const file=new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'capture.png',{type:'image/png'});
      await useFile(file,'camera');await current.carrierPromise;
    },bytes);
    await page.getByRole('button',{name:'Preview',exact:true}).click();
    await page.evaluate(()=>fullPreview.controls(true));
    for(const analysis of [false,true,false]) {
      await page.getByRole('checkbox',{name:'Analysis',exact:true}).setChecked(analysis);
      if(analysis)await page.waitForFunction(()=>!transformOutline.hidden);
      const state=await page.evaluate(()=>({input:{w:current.width,h:current.height},shown:imagePixels(),
        geometry:current.transformResult?.geometry,frame:grabbedFrame(),viewFrame:viewFrame(),
        clip:compare.style.clipPath,fit:fitMode,scale:viewScale,origin:[originX,originY],
        source:fullPreview.panel.classList.contains('show-source'),viewport:{w:viewport.clientWidth,h:viewport.clientHeight}}));
      console.log(JSON.stringify({input:i+1,analysis,frame:state.frame,clip:state.clip,source:state.source}));
      await fs.writeFile(path.join(output,`${i+1}-${analysis?'analysis':'clean'}.json`),JSON.stringify(state,null,2));
      await page.screenshot({path:path.join(output,`${i+1}-${analysis?'analysis':'clean'}.png`)});
      assert(state.frame,'recovered capture must retain framing');
      if(!analysis)assert(state.clip.startsWith('polygon('),'clean preview must clip to the recovered carrier');
      else assert(state.clip.startsWith('inset('),'analysis must retain a bounded diagnostic margin rather than expose the full camera frame');
    }
    await page.getByRole('button',{name:'Close preview',exact:true}).click();
  }
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}

// Public generated pixels only; clipboard is stubbed, never the user's clipboard.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.PIXELSTOW_PLAYWRIGHT?pathToFileURL(process.env.PIXELSTOW_PLAYWRIGHT).href:'playwright');
const server=http.createServer(async(req,res)=>{
  try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root))throw Error('Outside test root');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.PIXELSTOW_CHROME?{executablePath:process.env.PIXELSTOW_CHROME}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/pixelstow.html');
  await page.evaluate(async()=>{
    window.clipboardCopies=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async items=>{
      const blob=await items[0].getType('image/png'),image=await PixelStow.decodePng(new Uint8Array(await blob.arrayBuffer()));
      const expected=fullPreview.panel.classList.contains('show-source')?await carrierFor(current):current.recoverPixels;
      clipboardCopies.push({width:image.width,height:image.height,exact:image.pixels.length===expected.length&&image.pixels.every((v,i)=>v===expected[i])});
    }}});
    const width=480,height=640,pixels=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set([80+Math.round(x/5),110+Math.round(y/10),140,255],(x+y*width)*4);
    const encoded=await PixelStow.encodePayload(pixels,width,height,{text:'Public preview clipboard test.',attachments:[]},'');
    const png=await PixelStow.writePng(encoded.pixels,width,height),image={...encoded,exact:true};
    const inspection=await PixelStow.inspect(image.pixels,width,height,{worker:false,nativeOnly:true});
    await useFile(new File([png],'public-clipboard.png',{type:'image/png'}),'file',{image,inspection});
    await current.carrierPromise;
  });
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  assert(await page.evaluate(()=>fullPreview.panel.classList.contains('show-source')),'lower preview opens on corrected source');
  await page.evaluate(()=>fullPreview.toggleSource());
  await page.evaluate(()=>{
    const img=imagePixels(),box=viewBox();fitMode=false;viewScale=fittedScale(img,box)*3;
    originX=(box.w-img.w*viewScale)/2;originY=(box.h-img.h*viewScale)/2;applyView();
  });
  const view=()=>page.evaluate(()=>[originX,originY,viewScale,split.value,fullPreview.panel.classList.contains('show-source')]);
  const rect=await page.locator('#viewport').boundingBox(),x=rect.x+rect.width*.4,y=rect.y+rect.height*.4,before=await view();
  await page.mouse.click(x,y,{button:'right'});
  assert(await page.getByRole('menu',{name:'Preview actions'}).isVisible());
  assert.deepEqual(await view(),before,'right click alone must not pan or switch modes');
  await page.getByRole('menuitem',{name:'Copy image to clipboard'}).click();
  await page.waitForFunction(()=>clipboardCopies.length===1&&!busy);
  assert.deepEqual(await page.evaluate(()=>clipboardCopies[0]),{width:480,height:640,exact:true},'copy uses the full stored raster, without zoom, labels or overlays');
  assert(await page.locator('#preview-context-menu').isHidden());
  assert(await page.locator('#preview-screen-footer').isHidden());
  await page.mouse.move(x,y);await page.mouse.down({button:'right'});
  await page.mouse.move(x+55,y+35);await page.mouse.up({button:'right'});
  const moved=await view();assert(Math.abs(moved[0]-before[0]-55)<1&&Math.abs(moved[1]-before[1]-35)<1);
  assert(await page.locator('#preview-context-menu').isHidden(),'a right drag pans without opening a menu');
  assert.equal(moved[2],before[2]);assert.equal(moved[3],before[3]);
  await page.keyboard.press('Shift+F10');
  assert(await page.locator('#preview-context-menu').isVisible());
  await page.keyboard.press('Escape');
  assert(await page.locator('#preview-context-menu').isHidden());assert(await page.evaluate(()=>fullPreview.openNow));
  await page.mouse.click(x,y);await page.getByRole('button',{name:'Show source image',exact:true}).click();
  await page.mouse.click(x,y,{button:'right'});
  await page.getByRole('menuitem',{name:'Copy image to clipboard'}).click();
  await page.waitForFunction(()=>clipboardCopies.length===2&&!busy);
  assert.deepEqual(await page.evaluate(()=>clipboardCopies[1]),{width:480,height:640,exact:true},'source mode copies the full extracted source');
  await page.mouse.click(x,y,{button:'right'});await page.mouse.click(x+260,y+120);
  assert(await page.locator('#preview-context-menu').isHidden(),'clicking outside dismisses the menu');
  assert.deepEqual(errors,[]);
  console.log('PASS: lower preview right-click/keyboard Copy menu copies exact native PNG pixels in encoded and source modes; right-drag pans, Escape/outside click dismiss, no real clipboard access');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}

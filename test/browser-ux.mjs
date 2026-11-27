import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)||pathname.split('/').some(part=>part.startsWith('.')&&part!=='.')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  const pageErrors=[];const requests=[];
  await context.addInitScript(()=>{
    window.turnstile={render:(element,options)=>{window.__qaTurnstile=options;element.textContent='Turnstile local mock';return 'local-mock';},reset:()=>{},remove:()=>{}};
  });
  await context.route('https://challenges.cloudflare.com/**',route=>route.abort());
  await context.route('https://vinfqa-public-gateway.ptlocnguyen.workers.dev/**',async route=>{
    const url=new URL(route.request().url());let data={};
    if(url.pathname==='/health')data={status:'ready',capabilities:{extended_demo:true,max_new_tokens:[32,64,128],models:[
      {model_id:'s3-v04-4b',enabled:true},{model_id:'s3-extended-4b',enabled:true},{model_id:'m7-7b-nb136',enabled:true},
    ]}};
    else if(url.pathname==='/backend-status')data={model_id:url.searchParams.get('model_id'),backend:{status:'Ready',checked_at:new Date().toISOString()}};
    else if(url.pathname==='/quota')data={status:'available',remaining_seconds:289,base_seconds:300,checked_at:new Date().toISOString()};
    else if(['/infer','/infer-multi'].includes(url.pathname)){
      const form=await route.request().postDataBuffer();const text=form.toString('latin1');
      const modelId=['m7-7b-nb136','s3-extended-4b','s3-v04-4b'].find(id=>text.includes(id));
      const token=modelId==='m7-7b-nb136'?96:Number(text.match(/name="max_new_tokens"\r\n\r\n(32|64|128)\r\n/)?.[1]||32);
      requests.push({path:url.pathname,modelId,token});
      data={status:'INFERENCE_COMPLETED',answer:'Câu trả lời MOCK',request_id:`qa-${requests.length}`,history_mode:modelId==='m7-7b-nb136'?'LOCAL_ONLY':'NONE',provenance:{
        inference_mode:modelId==='m7-7b-nb136'?'M7_MULTI_IMAGE_DEMO':modelId==='s3-extended-4b'?'EXTENDED_DEMO':'SSRC_V04',
        model_id:modelId,requested_max_new_tokens:token,max_new_tokens:token,output_tokens:3,image_count:modelId==='m7-7b-nb136'?4:1,
        elapsed_seconds:.01,verification_status:'VERIFIED',possible_truncation:false,backend_revision:'LOCAL_MOCK',
      }};
    }else throw Error(`Unexpected Gateway request: ${url.pathname}`);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__qaTurnstile);
  await page.locator('.model-menu > summary').click();
  assert.equal(await page.locator('#modelChoices button').count(),2);
  await page.keyboard.press('Escape');
  await page.locator('.attachment-menu > summary').click();
  await page.locator('#loadSampleImages').click();
  await page.locator('.selected-image-card').first().waitFor();
  assert.equal(await page.locator('.selected-image-card').count(),1);
  await page.locator('#questionInput').fill('Câu hỏi 32');
  await page.evaluate(()=>window.__qaTurnstile.callback('LOCAL_MOCK_ONLY'));
  await page.locator('#sendButton').click();
  await page.locator('.message.assistant .msg-body').first().waitFor();
  assert.deepEqual(requests.at(-1),{path:'/infer',modelId:'s3-v04-4b',token:32});
  await page.locator('#questionInput').fill('Bản nháp giữ lại');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('label.token-option:has(input[value="64"])').click();
  assert.equal(await page.locator('input[name="max_new_tokens"]:checked').inputValue(),'32');
  page.once('dialog',dialog=>dialog.accept());await page.locator('label.token-option:has(input[value="64"])').click();
  assert.equal(await page.locator('#questionInput').inputValue(),'Bản nháp giữ lại');
  await page.locator('.attachment-menu > summary').click();await page.locator('#loadSampleImages').click();await page.locator('.selected-image-card').first().waitFor();
  await page.evaluate(()=>window.__qaTurnstile.callback('LOCAL_MOCK_ONLY'));
  await page.locator('#sendButton').click();await page.locator('.message.assistant .msg-body').last().waitFor();
  assert.deepEqual(requests.at(-1),{path:'/infer',modelId:'s3-extended-4b',token:64});
  await page.locator('label.token-option:has(input[value="128"])').click();
  await page.locator('#questionInput').fill('Câu hỏi 128');await page.evaluate(()=>window.__qaTurnstile.callback('LOCAL_MOCK_ONLY'));
  await page.locator('#sendButton').click();
  assert.deepEqual(requests.at(-1),{path:'/infer',modelId:'s3-extended-4b',token:128});
  await page.locator('#newChat').click();await page.locator('.model-menu > summary').click();await page.locator('#modelChoices button').nth(1).click();
  await page.locator('.attachment-menu > summary').click();await page.locator('#loadSampleImages').click();
  await page.locator('.selected-image-card').nth(3).waitFor();assert.equal(await page.locator('.selected-image-card').count(),4);
  await page.locator('#questionInput').fill('Câu hỏi bốn ảnh');await page.evaluate(()=>window.__qaTurnstile.callback('LOCAL_MOCK_ONLY'));
  await page.locator('#sendButton').click();
  assert.deepEqual(requests.at(-1),{path:'/infer-multi',modelId:'m7-7b-nb136',token:96});
  await page.locator('.session-gallery-disclosure > summary').click();
  assert.equal(await page.locator('.session-image-context').count(),4);
  await page.locator('.session-image-context').nth(2).click();
  assert.match(await page.locator('#imageViewerMeta').innerText(),/Ảnh 3/);
  await page.locator('#closeImageViewer').click();
  await page.locator('#questionInput').focus();await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#questionInput').inputValue(),'Câu hỏi bốn ảnh');
  await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#questionInput').inputValue(),'');
  await page.setViewportSize({width:320,height:700});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  await page.goto(origin+'/register.html');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),700);
  assert.deepEqual(pageErrors,[]);
  console.log('Browser UX mock PASS: 32/64/128/M7, gallery, viewer, recall, 320px layout; no GPU request.');
}finally{await browser?.close();server.close();}

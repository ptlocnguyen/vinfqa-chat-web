import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)||pathname.split('/').some(part=>part.startsWith('.')&&part!=='.')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin=`http://127.0.0.1:${server.address().port}`;
const screenshots=process.env.VISUAL_QA_DIR||null;
if(screenshots)await mkdir(screenshots,{recursive:true});
let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  await context.addInitScript(()=>{window.__widgetCount=0;window.__widgetReset=0;window.turnstile={render:(element,options)=>{window.__widgetCount++;window.__widget=options;element.textContent='Turnstile local mock';return 'research-widget';},reset:()=>{window.__widgetReset++;},remove:()=>{}};});
  await context.route('https://challenges.cloudflare.com/**',route=>route.abort());
  const requests=[];let remoteDeleteAttempts=0;
  await context.route('https://vinfqa-public-gateway.ptlocnguyen.workers.dev/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/health'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ready',capabilities:{max_new_tokens:[32,64,128],models:[
        {model_id:'s3-v04-4b',enabled:true,image_min:1,image_max:1,max_new_tokens:[32]},{model_id:'s3-extended-4b',enabled:true,image_min:1,image_max:1,max_new_tokens:[64,128]},{model_id:'m7-7b-nb136',enabled:true,image_min:2,image_max:4,max_new_tokens:[96]},
      ]}})});return;
    }
    if(path==='/backend-status'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({model_id:'s3-v04-4b',backend:{status:'Ready',checked_at:new Date().toISOString()}})});return;}
    if(path==='/quota'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'available',remaining_seconds:289,base_seconds:300,checked_at:new Date().toISOString()})});return;}
    if(path==='/history'&&route.request().method()==='GET'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({conversations:[{id:'11111111-1111-4111-8111-111111111111',title:'Phiên tài khoản',messages:[]}]})});return;}
    if(path.startsWith('/history/')&&route.request().method()==='DELETE'){remoteDeleteAttempts++;throw Error('Research branch must not delete cloud history');}
    assert.ok(['/infer','/infer-multi'].includes(path),`Unexpected Gateway path ${path}`);
    const text=route.request().postDataBuffer().toString('latin1');
    const modelId=['m7-7b-nb136','s3-extended-4b','s3-v04-4b'].find(id=>text.includes(id));
    const cap=modelId==='m7-7b-nb136'?96:Number(text.match(/name="max_new_tokens"\r\n\r\n(32|64|128)\r\n/)?.[1]||32);
    const imageCount=modelId==='m7-7b-nb136'?(text.match(/name="images"/g)||[]).length:1;
    requests.push({path,modelId,cap,imageCount});
    if(text.includes('MOCK_QUOTA')){await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({status:'ERROR',code:'HF_QUOTA_EXHAUSTED',request_id:`mock-${requests.length}`})});return;}
    const provenance={inference_mode:modelId==='m7-7b-nb136'?'M7_MULTI_IMAGE_DEMO':modelId==='s3-extended-4b'?'EXTENDED_DEMO':'SSRC_V04',requested_max_new_tokens:cap,max_new_tokens:cap,output_tokens:3,verification_status:'VERIFIED',elapsed_seconds:.04};
    if(modelId==='m7-7b-nb136')Object.assign(provenance,{model_id:modelId,image_count:imageCount});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'INFERENCE_COMPLETED',answer:imageCount===4?'85':'24',request_id:`mock-${requests.length}`,provenance})});
  });
  const page=await context.newPage();const errors=[];let nextDialogAnswer='';page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{void dialog.accept(nextDialogAnswer);nextDialogAnswer='';});
  const capture=async name=>{if(!screenshots)return;await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(100);await page.screenshot({path:`${screenshots}/${name}`,fullPage:true});};
  await page.goto(`${origin}/research.html`,{waitUntil:'domcontentloaded'});
  await page.getByText('Gateway sẵn sàng').waitFor();
  assert.equal(await page.locator('.research-trial').count(),0);
  assert.equal(await page.evaluate(()=>window.__widgetCount),0);
  await capture('research-empty-desktop-local-mock.png');
  await page.locator('[data-scenario="chart-a-feb"]').click();
  await page.getByText('Ảnh mẫu và đáp án tham chiếu khớp').waitFor();
  assert.equal(await page.locator('.research-image').count(),1);
  assert.equal(await page.locator('.research-trial').count(),1);
  assert.equal(await page.locator('.research-trial select[aria-label="Model cho lượt thử"] option').count(),2);
  await page.locator('#addModel').click();await page.locator('#addToken').click();
  assert.equal(await page.locator('.research-trial').count(),3);
  assert.deepEqual(await page.locator('.research-trial select[aria-label="Giới hạn token"]').evaluateAll(nodes=>nodes.map(node=>Number(node.value))),[32,64,128]);
  await capture('research-compare-desktop-local-mock.png');
  await page.locator('.research-trial').first().locator('.trial-run').click();
  assert.equal(requests.length,0,'No inference request before explicit Turnstile completion');
  await page.waitForFunction(()=>window.__widgetCount===1);
  assert.equal(await page.evaluate(()=>window.__widget.action),'vinfqa_infer');
  await page.evaluate(()=>window.__widget['error-callback']('110200'));
  assert.match(await page.locator('#researchTurnstileStatus').innerText(),/110200/);
  assert.equal(requests.length,0);
  await page.locator('#researchRetry').click();
  assert.equal(await page.evaluate(()=>window.__widgetReset),1);
  await page.evaluate(()=>window.__widget.callback('LOCAL_MOCK_1'));
  await page.locator('.research-trial').first().locator('.trial-run').click();
  await page.locator('.research-trial').first().locator('.trial-status[data-state="PASS"]').waitFor();
  assert.deepEqual(requests[0],{path:'/infer',modelId:'s3-v04-4b',cap:32,imageCount:1});
  assert.equal(requests.length,1);
  assert.equal(await page.locator('.research-trial').first().locator('.trial-run').isDisabled(),true);
  await page.locator('.research-trial').first().locator('.trial-assessment select').selectOption('CORRECT');
  await page.locator('.research-trial').first().locator('.trial-assessment input').fill('Đúng theo mẫu tổng hợp.');
  await page.locator('#researchVerify').click();await page.waitForFunction(()=>window.__widgetReset===2);
  await page.evaluate(()=>window.__widget.callback('LOCAL_MOCK_2'));
  await page.locator('.research-trial').nth(1).locator('.trial-run').click();
  await page.locator('.research-trial').nth(1).locator('.trial-status[data-state="PASS"]').waitFor();
  assert.deepEqual(requests[1],{path:'/infer',modelId:'s3-extended-4b',cap:64,imageCount:1});
  await page.locator('#researchVerify').click();await page.evaluate(()=>window.__widget.callback('LOCAL_MOCK_3'));
  await page.locator('.research-trial').nth(2).locator('.trial-run').click();
  await page.locator('.research-trial').nth(2).locator('.trial-status[data-state="PASS"]').waitFor();
  assert.deepEqual(requests[2],{path:'/infer',modelId:'s3-extended-4b',cap:128,imageCount:1});
  await capture('research-results-desktop-local-mock.png');
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#exportResearchJson').click()]);
  const data=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(data.trials.length,3);assert.equal(data.trials[0].assessment,'CORRECT');assert.equal(data.images.length,1);assert.match(data.images[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(data).includes('LOCAL_MOCK_'),false);
  await page.locator('[data-scenario="compare-abcd"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.research-image').length===4);
  assert.equal(await page.locator('.research-trial select[aria-label="Model cho lượt thử"] option').count(),1);
  assert.equal(await page.locator('.research-trial select[aria-label="Giới hạn token"]').inputValue(),'96');
  await page.locator('.research-image-tools button').first().click();
  assert.equal(await page.locator('#researchImageViewer').evaluate(node=>node.open),true);
  await page.locator('#researchCloseViewer').click();
  await capture('research-four-images-desktop-local-mock.png');
  await page.locator('#researchVerify').click();await page.evaluate(()=>window.__widget.callback('LOCAL_MOCK_4'));
  await page.locator('.research-trial').first().locator('.trial-run').click();
  await page.locator('.research-trial').first().locator('.trial-status[data-state="PASS"]').waitFor();
  assert.deepEqual(requests[3],{path:'/infer-multi',modelId:'m7-7b-nb136',cap:96,imageCount:4});
  await page.locator('#addVariant').click();
  await page.locator('.research-trial').nth(1).locator('textarea').fill('MOCK_QUOTA · câu hỏi thử lỗi');
  assert.equal(await page.locator('.research-trial').nth(1).locator('input').inputValue(),'');
  await page.locator('#researchVerify').click();await page.evaluate(()=>window.__widget.callback('LOCAL_MOCK_5'));
  await page.locator('.research-trial').nth(1).locator('.trial-run').click();
  await page.locator('.research-trial').nth(1).locator('.trial-status[data-state="ERROR"]').waitFor();
  assert.match(await page.locator('#researchNotice').innerText(),/Quota ZeroGPU/);
  assert.equal(requests.length,5,'Quota failure is not retried automatically');
  await capture('research-error-desktop-local-mock.png');
  await page.locator('#researchTheme').click();assert.equal(await page.locator('html.theme-light').count(),1);
  await capture('research-four-images-light-local-mock.png');
  await page.locator('#researchTheme').click();
  for(const [width,height] of [[768,1024],[390,844],[320,700]]){
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,`Horizontal overflow at ${width}`);
    await capture(`research-four-images-${width}-local-mock.png`);
  }
  await page.locator('#researchFiles').setInputFiles([resolve(root,'assets/samples/khu-vuc-a.png'),resolve(root,'assets/samples/khu-vuc-b.png')]);
  await page.waitForFunction(()=>document.querySelectorAll('.research-image').length===2);
  assert.equal(await page.locator('.research-trial select[aria-label="Model cho lượt thử"]').inputValue(),'m7-7b-nb136');
  assert.equal(await page.locator('.research-trial input').inputValue(),'');
  await page.locator('.research-image').first().getByRole('button',{name:/Đưa ảnh xuống sau/}).click();
  assert.match(await page.locator('.research-image').first().innerText(),/khu-vuc-b/);
  await capture('research-uploaded-two-images-local-mock.png');
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('.research-workspace-link').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.chat-row').length===1);
  await page.locator('#newChat').click();
  assert.equal(await page.locator('.chat-row').count(),2);
  nextDialogAnswer='Phiên nghiên cứu';
  await page.locator('.chat-row').first().getByRole('button',{name:/Đổi tên phiên/}).click();
  assert.match(await page.locator('.chat-row').first().innerText(),/Phiên nghiên cứu/);
  await page.locator('.chat-row').first().getByRole('button',{name:/Ghim phiên/}).click();
  await page.locator('#chatSearch').fill('nghiên cứu');
  assert.equal(await page.locator('.chat-row').count(),1);
  await page.locator('#chatSearch').fill('không có');
  assert.equal(await page.locator('.chat-row').count(),0);
  await page.locator('#chatSearch').fill('');
  await capture('chat-session-management-desktop-local-mock.png');
  await page.locator('#openSidebar').click();
  assert.equal(await page.locator('.sidebar-collapsed .chat-row-actions').first().isVisible(),false);
  assert.equal(await page.locator('.research-workspace-link').isVisible(),true);
  await capture('chat-sidebar-collapsed-research-link-local-mock.png');
  await page.locator('#openSidebar').click();
  await page.locator('.chat-row').first().getByRole('button',{name:/Xóa phiên/}).click();
  assert.equal(await page.locator('.chat-row').count(),1);
  assert.equal(requests.length,5,'Chat management does not call inference');
  await context.addInitScript(()=>sessionStorage.setItem('vinfqa.auth.tab-session',JSON.stringify({access_token:'LOCAL_MOCK_ACCESS',refresh_token:'LOCAL_MOCK_REFRESH',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'11111111-1111-4111-8111-111111111111',email:'mock@example.test'}})));
  const signedPage=await context.newPage();signedPage.on('dialog',dialog=>void dialog.accept());
  await signedPage.goto(origin,{waitUntil:'domcontentloaded'});
  await signedPage.getByRole('button',{name:/Phiên tài khoản/}).first().waitFor();
  await signedPage.locator('.chat-row').first().getByRole('button',{name:/Ẩn phiên khỏi tab/}).click();
  await signedPage.waitForFunction(()=>!document.querySelector('#chatList')?.textContent.includes('Phiên tài khoản'));
  assert.equal(remoteDeleteAttempts,0,'Cloud history is never deleted from this frontend action');
  await signedPage.close();
  assert.deepEqual(errors,[]);
  console.log(`Research browser mock PASS: ${requests.length} manual requests; screenshots ${screenshots||'disabled'}`);
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}

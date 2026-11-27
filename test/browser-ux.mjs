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
    window.__qaWidgetCounts={render:0,reset:0,remove:0};
    window.turnstile={render:(element,options)=>{window.__qaWidgetCounts.render++;window.__qaTurnstile=options;element.textContent='Turnstile local mock';return 'local-mock';},reset:()=>{window.__qaWidgetCounts.reset++;},remove:()=>{window.__qaWidgetCounts.remove++;}};
  });
  await context.route('https://challenges.cloudflare.com/**',route=>route.abort());
  await context.route('https://vinfqa-public-gateway.ptlocnguyen.workers.dev/**',async route=>{
    const url=new URL(route.request().url());let data={};
    if(url.pathname==='/health')data={status:'ready',capabilities:{extended_demo:true,max_new_tokens:[32,64,128],models:[
      {model_id:'s3-v04-4b',enabled:true},{model_id:'s3-extended-4b',enabled:true},{model_id:'m7-7b-nb136',enabled:true},
    ]}};
    else if(url.pathname==='/history')data={conversations:[]};
    else if(url.pathname==='/backend-status')data={model_id:url.searchParams.get('model_id'),backend:{status:'Ready',checked_at:new Date().toISOString()}};
    else if(url.pathname==='/quota')data={status:'available',remaining_seconds:289,base_seconds:300,checked_at:new Date().toISOString()};
    else if(['/infer','/infer-multi'].includes(url.pathname)){
      const form=await route.request().postDataBuffer();const text=form.toString('latin1');
      const modelId=['m7-7b-nb136','s3-extended-4b','s3-v04-4b'].find(id=>text.includes(id));
      const token=modelId==='m7-7b-nb136'?96:Number(text.match(/name="max_new_tokens"\r\n\r\n(32|64|128)\r\n/)?.[1]||32);
      requests.push({path:url.pathname,modelId,token});
      if(text.includes('QA_429')){await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({code:'MOCK_RATE_LIMIT',message:'Lỗi mock HTTP 429',request_id:'qa-error',timestamp:new Date().toISOString()})});return;}
      data={status:'INFERENCE_COMPLETED',answer:text.includes('QA_LONG')?'Câu trả lời MOCK dài '+('chuỗi_liên_tục_'.repeat(60)):'Câu trả lời MOCK',request_id:`qa-${requests.length}`,history_mode:modelId==='m7-7b-nb136'?'LOCAL_ONLY':'NONE',provenance:{
        inference_mode:modelId==='m7-7b-nb136'?'M7_MULTI_IMAGE_DEMO':modelId==='s3-extended-4b'?'EXTENDED_DEMO':'SSRC_V04',
        model_id:modelId,requested_max_new_tokens:token,max_new_tokens:token,output_tokens:3,image_count:modelId==='m7-7b-nb136'?4:1,
        elapsed_seconds:.01,verification_status:'VERIFIED',possible_truncation:false,backend_revision:'LOCAL_MOCK',
      }};
    }else throw Error(`Unexpected Gateway request: ${url.pathname}`);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
  const waitMobileSidebar=async()=>page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=1);
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#proofRow').getAttribute('data-state'),'idle');
  assert.equal(await page.evaluate(()=>window.__qaWidgetCounts.render),0);
  await page.locator('#openVerification').click();
  await page.waitForFunction(()=>window.__qaTurnstile).catch(error=>{throw Error(`${error.message}; page errors: ${pageErrors.join(' | ')}`);});
  assert.equal(await page.evaluate(()=>window.__qaWidgetCounts.render),1);
  assert.equal(await page.locator('#turnstileStatus').isVisible(),true);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/turnstile-loading-desktop-local-mock.png'});
  await page.setViewportSize({width:390,height:844});
  await waitMobileSidebar();
  assert.equal(await page.locator('.inline-verification').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),true);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/turnstile-loading-mobile-local-mock.png'});
  await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>window.__qaTurnstile['error-callback']('110200'));
  assert.match(await page.locator('#turnstileStatus').innerText(),/110200/);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/turnstile-error-desktop-local-mock.png'});
  await page.setViewportSize({width:390,height:844});
  await waitMobileSidebar();
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/turnstile-error-mobile-local-mock.png'});
  await page.setViewportSize({width:1366,height:768});
  await page.locator('#refreshCaptcha').click();
  assert.equal(await page.evaluate(()=>window.__qaWidgetCounts.reset),1);
  await page.evaluate(()=>window.__qaTurnstile['timeout-callback']());
  assert.equal(await page.locator('#proofRow').getAttribute('data-state'),'timeout');
  await page.locator('#refreshCaptcha').click();
  await page.evaluate(()=>window.__qaTurnstile['expired-callback']());
  assert.equal(await page.locator('#proofRow').getAttribute('data-state'),'expired');
  await page.locator('#refreshCaptcha').click();
  await page.evaluate(()=>{window.__qaOldTurnstile=window.__qaTurnstile;});
  await page.locator('#themeToggle').click();await page.locator('#openVerification').click();await page.waitForFunction(()=>window.__qaWidgetCounts.render===2);
  await page.evaluate(()=>window.__qaOldTurnstile['error-callback']('110200'));
  assert.equal(await page.locator('#proofRow').getAttribute('data-state'),'loading');
  await page.locator('#themeToggle').click();await page.locator('#openVerification').click();await page.waitForFunction(()=>window.__qaWidgetCounts.render===3);
  await page.evaluate(()=>window.__qaTurnstile.callback('LOCAL_MOCK_ONLY'));
  assert.equal(await page.locator('#proofRow').getAttribute('data-state'),'verified');
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/turnstile-verified-desktop-local-mock.png'});
  await page.setViewportSize({width:390,height:844});
  await waitMobileSidebar();
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/turnstile-verified-mobile-local-mock.png'});
  await page.setViewportSize({width:1366,height:768});
  await page.locator('#themeToggle').click();
  assert.equal(await page.locator('#proofRow').getAttribute('data-state'),'verified');
  assert.equal(await page.evaluate(()=>window.__qaWidgetCounts.remove),2);
  await page.locator('#themeToggle').click();
  const verifyMock=async()=>{
    await page.locator('#openVerification').click();
    await page.waitForFunction(()=>window.__qaTurnstile);
    await page.evaluate(()=>window.__qaTurnstile.callback('LOCAL_MOCK_ONLY'));
  };
  assert.match(await page.locator('#composerFootnote').innerText(),/không lưu vào tài khoản/);
  assert.equal(await page.locator('.topbar-actions > #themeToggle').count(),1);
  await page.locator('.account-menu > summary').click();await page.locator('#sidebarLogin').waitFor({state:'visible'});
  assert.equal(await page.locator('#sidebarLogin').isVisible(),true);
  assert.equal(await page.locator('#sidebarRegister').isVisible(),true);
  const accountWidth=(await page.locator('.account-menu .disclosure-panel').boundingBox()).width;
  assert.ok(accountWidth<=260,`Account popover width ${accountWidth}`);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/after-account-guest-desktop-local-mock.png'});
  await page.keyboard.press('Escape');
  await page.locator('#themeToggle').click();assert.equal(await page.locator('html.theme-light').count(),1);
  await page.waitForTimeout(250);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/after-home-light-desktop-local-mock.png'});
  await page.locator('#themeToggle').click();assert.equal(await page.locator('html.theme-light').count(),0);
  for(const [width,height] of [[1920,1080],[1024,768],[768,1024],[390,844]]){
    await page.setViewportSize({width,height});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+`/after-home-${width}-local-mock.png`});
  }
  await page.setViewportSize({width:1366,height:768});
  await page.locator('#sidebarResize').focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#sidebarResize').getAttribute('aria-valuenow'),'280');
  await page.locator('#sidebarResize').dblclick();
  assert.equal(await page.locator('#sidebarResize').getAttribute('aria-valuenow'),'264');
  const handle=await page.locator('#sidebarResize').boundingBox();
  await page.mouse.move(handle.x+5,handle.y+80);await page.mouse.down();await page.mouse.move(350,handle.y+80,{steps:8});await page.mouse.up();
  assert.equal(await page.locator('#sidebarResize').getAttribute('aria-valuenow'),'350');
  assert.equal(await page.evaluate(()=>localStorage.getItem('vinfqa.sidebar.width')),'350');
  assert.equal(await page.locator('#sidebarResize').evaluate(node=>node.classList.contains('is-resizing')),false);
  await page.locator('#openSidebar').click();await page.locator('#openSidebar').click();
  assert.equal(await page.locator('#sidebarResize').getAttribute('aria-valuenow'),'350');
  await page.locator('.model-menu > summary').click();
  assert.equal(await page.locator('#modelChoices button').count(),2);
  await page.keyboard.press('Escape');
  await page.locator('.attachment-menu > summary').click();
  await page.locator('#loadSampleImages').click();
  await page.locator('.selected-image-card').first().waitFor();
  assert.equal(await page.locator('.selected-image-card').count(),1);
  await page.locator('#questionInput').fill('Câu hỏi 32');
  await page.locator('#sendButton').click();
  await page.locator('.message.assistant .msg-body').first().waitFor();
  assert.deepEqual(requests.at(-1),{path:'/infer',modelId:'s3-v04-4b',token:32});
  await page.locator('.chat-item .chat-title').first().evaluate(node=>node.textContent='Tiêu đề hội thoại tiếng Việt rất dài, gồm nhiều nội dung cần xem lại');
  await page.locator('#sidebarResize').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowLeft');
  await page.locator('.chat-item').first().hover();await page.locator('#chatTitleTooltip').waitFor({state:'visible'});
  assert.match(await page.locator('#chatTitleTooltip').innerText(),/Tiêu đề hội thoại/);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/after-sidebar-tooltip-desktop-local-mock.png'});
  await page.locator('#openSidebar').click();await page.locator('.chat-item').first().focus();
  await page.locator('#chatTitleTooltip').waitFor({state:'visible'});
  await page.locator('#openSidebar').click();
  assert.equal(await page.locator('#chatTitleTooltip').isVisible(),false);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/after-sidebar-chat-desktop-local-mock.png'});
  await page.locator('#questionInput').fill('Bản nháp giữ lại');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('label.token-option:has(input[value="64"])').click();
  assert.equal(await page.locator('input[name="max_new_tokens"]:checked').inputValue(),'32');
  page.once('dialog',dialog=>dialog.accept());await page.locator('label.token-option:has(input[value="64"])').click();
  assert.equal(await page.locator('#questionInput').inputValue(),'Bản nháp giữ lại');
  await page.locator('.attachment-menu > summary').click();await page.locator('#loadSampleImages').click();await page.locator('.selected-image-card').first().waitFor();
  await verifyMock();
  await page.locator('#sendButton').click();await page.locator('.message.assistant .msg-body').last().waitFor();
  assert.deepEqual(requests.at(-1),{path:'/infer',modelId:'s3-extended-4b',token:64});
  await page.locator('label.token-option:has(input[value="128"])').click();
  await page.locator('#questionInput').fill('Câu hỏi 128');await verifyMock();
  await page.locator('#sendButton').click();
  assert.deepEqual(requests.at(-1),{path:'/infer',modelId:'s3-extended-4b',token:128});
  await page.locator('#newChat').click();await page.locator('.model-menu > summary').click();await page.locator('#modelChoices button').nth(1).click();
  await page.locator('.attachment-menu > summary').click();await page.locator('#loadSampleImages').click();
  await page.locator('.selected-image-card').nth(3).waitFor();assert.equal(await page.locator('.selected-image-card').count(),4);
  await page.locator('#questionInput').fill('Câu hỏi bốn ảnh');await verifyMock();
  await page.locator('#sendButton').click();
  assert.deepEqual(requests.at(-1),{path:'/infer-multi',modelId:'m7-7b-nb136',token:96});
  await page.locator('#openSidebar').click();
  const collapsedGap=await page.evaluate(()=>document.querySelector('.chat-item').getBoundingClientRect().top-document.querySelector('#newChat').getBoundingClientRect().bottom);
  assert.ok(collapsedGap>=12,`Collapsed sidebar gap ${collapsedGap}`);
  await page.waitForTimeout(250);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/sidebar-collapsed-three-sessions-local-mock.png'});
  await page.locator('#openSidebar').click();
  await page.locator('.session-gallery-disclosure > summary').click();
  assert.equal(await page.locator('.session-image-context').count(),4);
  await page.locator('.session-image-context').nth(2).click();
  assert.match(await page.locator('#imageViewerMeta').innerText(),/Ảnh 3/);
  await page.locator('#closeImageViewer').click();
  await page.locator('#questionInput').focus();await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#questionInput').inputValue(),'Câu hỏi bốn ảnh');
  await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#questionInput').inputValue(),'');
  for(let i=0;i<16;i++){
    await page.locator('#questionInput').fill(i===15?'QA_LONG câu hỏi dài '+('nội dung '.repeat(70)):`QA message ${i}`);
    await verifyMock();
    await page.locator('#sendButton').click();
    await page.waitForFunction(expected=>document.querySelectorAll('.message').length===expected,2+2*(i+1));
  }
  assert.equal(await page.locator('.message').count(),34);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),1366);
  const scrollGeometry=await page.locator('#messages').evaluate(node=>({right:node.getBoundingClientRect().right,viewport:innerWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight}));
  assert.ok(scrollGeometry.viewport-scrollGeometry.right<2);
  assert.ok(scrollGeometry.scrollHeight>scrollGeometry.clientHeight);
  await page.waitForTimeout(300);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/after-34-messages-local-mock.png'});
  await page.locator('#questionInput').fill('QA_429');await verifyMock();
  await page.locator('#sendButton').click();await page.locator('#errorNotice').getByText('Lỗi mock HTTP 429',{exact:false}).waitFor();
  assert.equal(requests.filter(item=>item.path==='/infer-multi').length,18);
  await page.setViewportSize({width:320,height:700});
  if(await page.locator('#sidebar').evaluate(node=>node.classList.contains('open')))await page.locator('#closeSidebar').click();
  await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  assert.equal(await page.locator('#sidebarResize').isVisible(),false);
  assert.equal(await page.locator('#themeToggle').isVisible(),true);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/after-chat-320-local-mock.png'});
  await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>sessionStorage.setItem('vinfqa.auth.tab-session',JSON.stringify({access_token:'LOCAL_MOCK_ONLY',refresh_token:'LOCAL_MOCK_ONLY',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000000',user_metadata:{display_name:'Người dùng kiểm thử với tên rất dài để xem cắt chữ'}}})));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#accountStatus')?.textContent.includes('Người dùng kiểm thử'));
  assert.equal(await page.locator('#sidebarResize').getAttribute('aria-valuenow'),'248');
  assert.match(await page.locator('#composerFootnote').innerText(),/Lịch sử 4B có thể đồng bộ/);
  await page.locator('.account-menu > summary').click();await page.locator('#sidebarRegister').waitFor({state:'visible'});
  assert.equal(await page.locator('#sidebarLogin').isVisible(),false);
  assert.equal(await page.locator('#sidebarRegister').isVisible(),true);
  if(process.env.VISUAL_QA_DIR)await page.screenshot({path:process.env.VISUAL_QA_DIR+'/after-account-signed-in-local-mock.png'});
  await page.keyboard.press('Escape');
  await page.locator('.model-menu > summary').click();await page.locator('#modelChoices button').nth(1).click();
  assert.match(await page.locator('#composerFootnote').innerText(),/M7 chỉ giữ hội thoại trong tab/);
  await page.evaluate(()=>sessionStorage.removeItem('vinfqa.auth.tab-session'));
  await page.setViewportSize({width:320,height:700});
  await page.goto(origin+'/register.html');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight),700);
  assert.deepEqual(pageErrors,[]);
  console.log('Browser UX mock PASS: 32/64/128/M7, gallery, viewer, recall, 34 messages, HTTP 429, 320px layout; no GPU request.');
}finally{await browser?.close();server.close();}

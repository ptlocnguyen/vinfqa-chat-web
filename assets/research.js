import {MODEL_REGISTRY,UI_MODEL_IDS} from './model-registry.mjs';
import {imageSha256} from './image-items.mjs';
import {SAMPLE_IMAGES,SAMPLE_SCENARIOS,compatibleModels,validateResearchTrial,makeResearchForm,checkedResult,researchExport,researchCsv,researchMarkdown} from './research-core.mjs';

const cfg=window.VINFQA_PUBLIC_CONFIG||{};
const $=selector=>document.querySelector(selector);
const refs={gateway:$('#researchGateway'),notice:$('#researchNotice'),library:$('#sampleLibrary'),images:$('#researchImages'),imageCount:$('#imageCount'),hashStatus:$('#imageHashStatus'),files:$('#researchFiles'),drop:$('#researchDrop'),trials:$('#researchTrials'),capability:$('#researchCapability'),verify:$('#researchVerify'),widget:$('#researchWidget'),retry:$('#researchRetry'),turnstileStatus:$('#researchTurnstileStatus')};
const state={health:null,images:[],trials:[],scenarioId:null,busy:false,loadingImages:false,turnstileToken:'',widgetId:null,widgetEpoch:0,widgetTheme:'',widgetNeedsReset:false,widgetOpened:false,turnstileTimer:null};
const apiBase=typeof cfg.API_BASE_URL==='string'?cfg.API_BASE_URL.replace(/\/$/,''):'';
const configured=/^https:\/\//.test(apiBase)&&Boolean(cfg.TURNSTILE_SITE_KEY);
const models=()=>compatibleModels(state.health,state.images.length);
const note=(message,type='info')=>{refs.notice.textContent=message;refs.notice.hidden=!message;refs.notice.dataset.type=type;};
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{2,64}$/.test(value)?value:null;
const escapeAttribute=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');

async function loadHealth(){
  if(!configured){refs.gateway.textContent='Chưa cấu hình Gateway';refs.gateway.dataset.state='error';note('Thiếu URL Gateway hoặc Turnstile sitekey công khai.','error');return;}
  try{
    const response=await fetch(`${apiBase}/health`,{cache:'no-store',signal:AbortSignal.timeout(10_000)});
    const payload=await response.json();
    if(!response.ok||payload?.status!=='ready'||!Array.isArray(payload.capabilities?.models))throw Error('Gateway chưa công bố model capabilities.');
    state.health=payload;refs.gateway.textContent='Gateway sẵn sàng';refs.gateway.dataset.state='ready';note('');
  }catch{state.health=null;refs.gateway.textContent='Gateway chưa xác minh';refs.gateway.dataset.state='error';note('Không đọc được capabilities từ Gateway. Lượt thử bị khóa; hãy tải lại khi Gateway sẵn sàng.','error');}
  render();
}

function renderLibrary(){
  refs.library.replaceChildren();
  for(const scenario of SAMPLE_SCENARIOS){
    const button=document.createElement('button');button.type='button';button.dataset.scenario=scenario.id;
    const name=document.createElement('strong');name.textContent=scenario.title;
    const category=document.createElement('span');category.className='category';category.textContent=scenario.category;
    const count=document.createElement('span');count.className='sample-count';count.textContent=`${scenario.imageIds.length} ảnh`;
    button.append(name,category,count);button.title=`${scenario.question} · tham chiếu ${scenario.reference}`;
    button.addEventListener('click',()=>void useScenario(scenario));refs.library.append(button);
  }
}

function hasResults(){return state.trials.some(trial=>trial.status!=='NOT_RUN');}
function confirmReplace(){return !hasResults()||confirm('Thay bộ ảnh sẽ xóa kết quả hiện có trong tab. Tiếp tục?');}
function clearImages(images){for(const image of images)if(image.url)URL.revokeObjectURL(image.url);}
async function makeImage(file,source,expectedHash=null){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<=0||file.size>8*1024*1024)throw Error('Chỉ nhận PNG, JPG hoặc WebP hợp lệ, tối đa 8 MB/ảnh.');
  const bitmap=await createImageBitmap(file);
  try{if(bitmap.width*bitmap.height>12_000_000)throw Error('Ảnh vượt 12 megapixel.');}finally{bitmap.close();}
  const sha256=await imageSha256(file);
  if(expectedHash&&sha256!==expectedHash)throw Error('SHA-256 ảnh mẫu đã thay đổi. Cần kiểm tra lại đáp án tham chiếu trước khi dùng.');
  return {id:crypto.randomUUID(),file,source,sha256,url:URL.createObjectURL(file)};
}
function defaultTrial(question='',reference='',model=models()[0],referenceSource='USER_REVIEW_REQUIRED'){
  return {id:crypto.randomUUID(),modelId:model?.model_id||'',maxNewTokens:model?.max_new_tokens[0]||32,question,reference,referenceSource,answer:'',status:'NOT_RUN',assessment:'NOT_ASSESSED',notes:'',provenance:null,errorCode:null,httpStatus:null,requestId:null,wallSeconds:null,startedAt:null,completedAt:null};
}
function resetResults(){for(const trial of state.trials){Object.assign(trial,{answer:'',status:'NOT_RUN',assessment:'NOT_ASSESSED',notes:'',provenance:null,errorCode:null,httpStatus:null,requestId:null,wallSeconds:null,startedAt:null,completedAt:null});}}
async function useScenario(scenario){
  if(state.busy||state.loadingImages)return;
  if(!confirmReplace())return;
  state.loadingImages=true;refs.hashStatus.textContent='Đang xác minh SHA-256 các ảnh mẫu…';
  const next=[];
  try{
    for(const id of scenario.imageIds){
      const sample=SAMPLE_IMAGES[id];
      const response=await fetch(sample.path,{cache:'no-store'});if(!response.ok)throw Error('Không tải được ảnh mẫu.');
      const blob=await response.blob();const file=new File([blob],`khu-vuc-${id}.png`,{type:'image/png'});
      next.push(await makeImage(file,`sample:${id}`,sample.sha256));
    }
    clearImages(state.images);state.images=next;state.scenarioId=scenario.id;
    state.trials=[defaultTrial(scenario.question,scenario.reference,compatibleModels(state.health,next.length)[0],'LOCKED_SYNTHETIC')];
    refs.hashStatus.textContent='Ảnh mẫu và đáp án tham chiếu khớp với SHA-256 đã khóa.';note('');render();
  }catch(error){clearImages(next);refs.hashStatus.textContent='Không thể xác minh bộ ảnh mẫu.';note(error.message,'error');}
  finally{state.loadingImages=false;renderImages();renderTrials();}
}
async function useUploadedFiles(fileList){
  if(state.busy||state.loadingImages)return;
  const files=Array.from(fileList||[]);if(!files.length)return;
  if(files.length>4){note('Tối đa bốn ảnh mỗi bộ.','error');return;}
  if(files.reduce((total,file)=>total+file.size,0)>24*1024*1024){note('Tổng dung lượng tối đa là 24 MB.','error');return;}
  if(!confirmReplace())return;
  state.loadingImages=true;refs.hashStatus.textContent='Đang tính SHA-256 và kiểm tra kích thước ảnh…';
  const next=[];
  try{
    for(const file of files)next.push(await makeImage(file,'uploaded'));
    clearImages(state.images);state.images=next;state.scenarioId=null;state.trials=[defaultTrial('', '',compatibleModels(state.health,next.length)[0])];
    refs.hashStatus.textContent='SHA-256 đã tính trong trình duyệt. Nhập đáp án tham chiếu nếu bạn có nguồn kiểm tra.';note('');render();
  }catch(error){clearImages(next);note(error.message,'error');refs.hashStatus.textContent='Bộ ảnh cũ được giữ nguyên.';}
  finally{state.loadingImages=false;refs.files.value='';renderImages();renderTrials();}
}

function renderImages(){
  refs.imageCount.textContent=`${state.images.length} ảnh`;refs.images.replaceChildren();
  state.images.forEach((image,index)=>{
    const row=document.createElement('div');row.className='research-image';
    const preview=document.createElement('img');preview.src=image.url;preview.alt=`Ảnh ${index+1}`;
    const copy=document.createElement('div');copy.className='research-image-copy';
    const title=document.createElement('strong');title.textContent=`${index+1}. ${image.source.startsWith('sample:')?'Khu vực '+image.source.slice(-1).toUpperCase():image.file.name}`;
    const hash=document.createElement('small');hash.textContent=`SHA-256 ${image.sha256.slice(0,16)}… · ${(image.file.size/1024).toFixed(0)} KB`;hash.title=image.sha256;
    copy.append(title,hash);
    const tools=document.createElement('div');tools.className='research-image-tools';
    for(const [label,text,fn] of [['Xem ảnh lớn','↗',()=>openImage(index)],['Đưa ảnh lên trước','↑',()=>moveImage(index,-1)],['Đưa ảnh xuống sau','↓',()=>moveImage(index,1)]]){
      const button=document.createElement('button');button.type='button';button.textContent=text;button.title=label;button.setAttribute('aria-label',`${label} ${index+1}`);button.disabled=state.busy||state.loadingImages||(text==='↑'&&index===0)||(text==='↓'&&index===state.images.length-1);button.onclick=fn;tools.append(button);
    }
    row.append(preview,copy,tools);refs.images.append(row);
  });
}
function moveImage(index,direction){
  if(state.busy||state.loadingImages||hasResults()&&!confirm('Đổi thứ tự ảnh sẽ xóa kết quả hiện có. Tiếp tục?'))return;
  const next=index+direction;if(next<0||next>=state.images.length)return;
  [state.images[index],state.images[next]]=[state.images[next],state.images[index]];
  state.scenarioId=null;resetResults();for(const trial of state.trials){trial.reference='';trial.referenceSource='USER_REVIEW_REQUIRED';}note('Thứ tự ảnh đã đổi. Hãy kiểm tra lại câu hỏi và nhập lại đáp án tham chiếu.');render();
}
function openImage(index){const image=state.images[index];if(!image)return;$('#researchImageTitle').textContent=`Ảnh ${index+1} · ${image.source}`;$('#researchImageLarge').src=image.url;$('#researchImageViewer').showModal();}

function renderTrials(){
  refs.trials.replaceChildren();const choices=models();
  refs.capability.textContent=state.images.length?`${choices.length} model tương thích`:'Chọn ảnh để bắt đầu';
  for(const trial of state.trials){
    const card=document.createElement('article');card.className='research-trial';card.dataset.trial=trial.id;
    const header=document.createElement('div');header.className='research-trial-head';const name=document.createElement('strong');name.textContent=`Lượt ${state.trials.indexOf(trial)+1}`;const status=document.createElement('span');status.textContent=trial.status==='PASS'?'Hoàn thành':trial.status==='ERROR'?'Có lỗi':trial.status==='RUNNING'?'Đang chạy':'Chưa gửi';header.append(name,status);
    const selectors=document.createElement('div');selectors.className='trial-selectors';
    const modelLabel=document.createElement('label');modelLabel.textContent='Model';const modelSelect=document.createElement('select');modelSelect.setAttribute('aria-label','Model cho lượt thử');
    for(const item of choices){const option=document.createElement('option');option.value=item.model_id;option.textContent=`${MODEL_REGISTRY[item.model_id].shortName} · ${MODEL_REGISTRY[item.model_id].backbone}`;modelSelect.append(option);}modelSelect.value=trial.modelId;modelSelect.disabled=state.busy||choices.length===0||trial.status!=='NOT_RUN';modelLabel.append(modelSelect);
    const tokenLabel=document.createElement('label');tokenLabel.textContent='Giới hạn';const tokenSelect=document.createElement('select');tokenSelect.setAttribute('aria-label','Giới hạn token');
    const setTokenOptions=()=>{tokenSelect.replaceChildren();for(const token of choices.find(item=>item.model_id===modelSelect.value)?.max_new_tokens||[]){const option=document.createElement('option');option.value=String(token);option.textContent=`${token} tokens`;tokenSelect.append(option);}tokenSelect.value=String(trial.maxNewTokens);};setTokenOptions();tokenSelect.disabled=state.busy||!tokenSelect.options.length||trial.status!=='NOT_RUN';tokenLabel.append(tokenSelect);selectors.append(modelLabel,tokenLabel);
    modelSelect.onchange=()=>{trial.modelId=modelSelect.value;trial.maxNewTokens=choices.find(item=>item.model_id===trial.modelId)?.max_new_tokens[0]||32;resetTrial(trial);renderTrials();};
    tokenSelect.onchange=()=>{trial.maxNewTokens=Number(tokenSelect.value);resetTrial(trial);renderTrials();};
    const questionLabel=document.createElement('label');questionLabel.textContent='Câu hỏi';const question=document.createElement('textarea');question.maxLength=1000;question.value=trial.question;question.placeholder='Câu hỏi bằng tiếng Việt…';question.disabled=state.busy||trial.status!=='NOT_RUN';question.addEventListener('input',()=>{if(trial.question!==question.value){trial.question=question.value;trial.reference='';trial.referenceSource='USER_REVIEW_REQUIRED';reference.value='';resetTrial(trial);statusLine.textContent='Câu hỏi đã đổi. Cần kiểm tra lại đáp án tham chiếu.';}});questionLabel.append(question);
    const referenceLabel=document.createElement('label');referenceLabel.textContent='Đáp án tham chiếu · do bạn xác minh';const reference=document.createElement('input');reference.maxLength=300;reference.value=trial.reference;reference.placeholder='Chưa có tham chiếu';reference.disabled=state.busy;reference.oninput=()=>{trial.reference=reference.value;trial.referenceSource='USER_ENTERED';};referenceLabel.append(reference);
    const toolbar=document.createElement('div');toolbar.className='trial-toolbar';const run=document.createElement('button');run.className='trial-run';run.type='button';run.textContent=trial.status==='NOT_RUN'?'Gửi một lượt':'Đã gửi · tạo lượt mới';run.disabled=state.busy||state.loadingImages||!choices.length||trial.status!=='NOT_RUN';run.onclick=()=>void runTrial(trial.id);const remove=document.createElement('button');remove.className='trial-remove';remove.type='button';remove.textContent='Xóa lượt';remove.disabled=state.busy;remove.onclick=()=>{if(trial.status!=='NOT_RUN'&&!confirm('Xóa lượt thử và kết quả trong tab?'))return;state.trials=state.trials.filter(item=>item!==trial);renderTrials();};toolbar.append(run,remove);
    const statusLine=document.createElement('p');statusLine.className='trial-status';statusLine.dataset.state=trial.status;statusLine.textContent=trial.status==='PASS'?'Gateway đã trả kết quả và provenance hợp lệ.':trial.status==='ERROR'?`Lỗi ${trial.errorCode||'không rõ'} · HTTP ${trial.httpStatus??'—'} · request ${trial.requestId||'—'}`:trial.status==='RUNNING'?'Đang chờ Gateway; không gửi thêm lượt khác.':'Mỗi lần bấm chỉ gửi đúng một request.';
    card.append(header,selectors,questionLabel,referenceLabel,toolbar,statusLine);
    if(trial.status==='PASS'||trial.status==='ERROR')card.append(resultNode(trial));
    refs.trials.append(card);
  }
}
function resetTrial(trial,clearAssessment=true){Object.assign(trial,{answer:'',status:'NOT_RUN',provenance:null,errorCode:null,httpStatus:null,requestId:null,wallSeconds:null,startedAt:null,completedAt:null});if(clearAssessment){trial.assessment='NOT_ASSESSED';trial.notes='';}}
function resultNode(trial){
  const box=document.createElement('div');box.className='research-result';
  const answer=document.createElement('div');answer.className='answer';answer.textContent=trial.status==='PASS'?trial.answer:'Không có đáp án cho lượt thất bại.';box.append(answer);
  const dl=document.createElement('dl');
  const pairs=[['Model ID',trial.provenance?.model_id||trial.modelId],['Số ảnh',trial.provenance?.image_count??state.images.length],['Latency',trial.provenance?.elapsed_seconds!=null?`${trial.provenance.elapsed_seconds} s backend · ${trial.wallSeconds} s tổng`:`${trial.wallSeconds??'—'} s tổng`],['Token usage',trial.provenance?.output_tokens!=null?`${trial.provenance.output_tokens}/${trial.maxNewTokens}`:'—'],['Xác minh',trial.provenance?.verification_status||'NOT_VERIFIED'],['Request ID',trial.requestId||'—']];
  for(const [label,value] of pairs){const item=document.createElement('div');const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=String(value);item.append(dt,dd);dl.append(item);}box.append(dl);
  if(trial.provenance){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Provenance đầy đủ';const pre=document.createElement('pre');pre.textContent=JSON.stringify(trial.provenance,null,2);details.append(summary,pre);box.append(details);}
  const assessment=document.createElement('div');assessment.className='trial-assessment';const assessLabel=document.createElement('label');assessLabel.textContent='Đánh giá thủ công';const select=document.createElement('select');for(const [value,label] of [['NOT_ASSESSED','Chưa đánh giá'],['CORRECT','Đúng'],['INCORRECT','Sai'],['PARTIAL','Một phần']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}select.value=trial.assessment;select.onchange=()=>{trial.assessment=select.value;};assessLabel.append(select);const noteLabel=document.createElement('label');noteLabel.textContent='Ghi chú lỗi';const noteInput=document.createElement('input');noteInput.maxLength=1000;noteInput.placeholder='Ví dụ: sai phép cộng…';noteInput.value=trial.notes;noteInput.oninput=()=>{trial.notes=noteInput.value;};noteLabel.append(noteInput);assessment.append(assessLabel,noteLabel);box.append(assessment);return box;
}
function render(){renderImages();renderTrials();}

function addTrial(kind){
  if(state.busy||!state.images.length){note('Chọn bộ ảnh trước khi tạo lượt thử.','error');return;}
  const available=models();if(!available.length){note('Gateway chưa công bố model tương thích cho bộ ảnh này.','error');return;}
  const base=state.trials.at(-1)||defaultTrial();let selected=available.find(item=>item.model_id===base.modelId)||available[0];let token=base.maxNewTokens;
  if(kind==='model'){
    const other=available.find(item=>item.model_id!==base.modelId);
    if(!other){note('Bộ ảnh này chỉ có một model tương thích. Dùng biến thể câu hỏi để so sánh.');return;}
    selected=other;token=other.max_new_tokens[0];
  }else if(kind==='token'){
    let next=selected.max_new_tokens.find(value=>value!==base.maxNewTokens);
    if(next==null){selected=available.find(item=>item.max_new_tokens.length>1)||selected;next=selected.max_new_tokens.find(value=>value!==base.maxNewTokens);}
    if(next==null){note('Không có mức token khác cho bộ ảnh/model này.');return;}token=next;
  }
  const trial=defaultTrial(base.question,base.reference,selected,base.referenceSource);trial.maxNewTokens=token;state.trials.push(trial);note('');renderTrials();trialCardFocus(trial.id);
}
function trialCardFocus(id){refs.trials.querySelector(`[data-trial="${escapeAttribute(id)}"] textarea`)?.focus();}

function verificationMessage(value){refs.turnstileStatus.textContent=value;}
function removeWidget(){clearTimeout(state.turnstileTimer);state.widgetEpoch++;if(window.turnstile&&state.widgetId!==null)try{window.turnstile.remove(state.widgetId);}catch{}state.widgetId=null;state.widgetTheme='';refs.widget.replaceChildren();}
function showVerification(){
  state.widgetOpened=true;refs.widget.hidden=false;refs.verify.hidden=true;verificationMessage('Đang tải xác minh…');
  renderWidget(Date.now());
}
function renderWidget(started){
  if(!state.widgetOpened)return;
  if(state.widgetId!==null){
    if(state.widgetNeedsReset){try{window.turnstile.reset(state.widgetId);state.widgetNeedsReset=false;verificationMessage('Hoàn tất xác minh trong khung bên dưới.');}catch{removeWidget();verificationMessage('Không thể đặt lại widget. Bấm thử xác minh lại.');refs.retry.hidden=false;}}return;
  }
  if(!window.turnstile){if(Date.now()-started>15_000){verificationMessage('Không tải được Turnstile. Kiểm tra kết nối rồi thử lại.');refs.retry.hidden=false;return;}state.turnstileTimer=setTimeout(()=>renderWidget(started),300);return;}
  const epoch=++state.widgetEpoch;
  try{
    state.widgetId=window.turnstile.render(refs.widget,{
      sitekey:cfg.TURNSTILE_SITE_KEY,theme:document.documentElement.classList.contains('theme-light')?'light':'dark',size:'compact',action:'vinfqa_infer',retry:'never',
      callback:token=>{if(epoch!==state.widgetEpoch||typeof token!=='string'||!token)return;state.turnstileToken=token;state.widgetNeedsReset=false;verificationMessage('Đã xác minh cho một lượt gửi.');refs.widget.hidden=true;refs.verify.hidden=false;refs.verify.textContent='Đã xác minh';refs.retry.hidden=true;},
      'expired-callback':()=>{if(epoch!==state.widgetEpoch)return;state.turnstileToken='';state.widgetNeedsReset=true;refs.widget.hidden=false;refs.verify.hidden=true;refs.retry.hidden=false;verificationMessage('Xác minh hết hạn. Cần token mới.');},
      'timeout-callback':()=>{if(epoch!==state.widgetEpoch)return;state.turnstileToken='';state.widgetNeedsReset=true;refs.retry.hidden=false;verificationMessage('Xác minh quá thời gian. Bấm thử lại.');},
      'error-callback':code=>{if(epoch!==state.widgetEpoch)return true;state.turnstileToken='';state.widgetNeedsReset=true;refs.retry.hidden=false;verificationMessage(`Turnstile chưa hoàn thành${/^\d{6}$/.test(String(code))?` · mã ${code}`:''}. Bấm thử lại.`);return true;},
    });state.widgetTheme=document.documentElement.classList.contains('theme-light')?'light':'dark';verificationMessage('Hoàn tất xác minh trong khung bên dưới.');
  }catch{verificationMessage('Không tạo được widget Turnstile. Bấm thử lại.');refs.retry.hidden=false;}
}
function retryVerification(){state.turnstileToken='';refs.widget.hidden=false;refs.verify.hidden=true;refs.retry.hidden=true;verificationMessage('Đang tải lại xác minh…');state.widgetNeedsReset=true;renderWidget(Date.now());}
function consumeVerification(){state.turnstileToken='';state.widgetNeedsReset=true;state.widgetOpened=false;refs.widget.hidden=true;refs.verify.hidden=false;refs.verify.textContent='Mở Turnstile';refs.retry.hidden=true;verificationMessage('Token đã dùng cho một lượt. Xác minh lại trước lượt tiếp theo.');}

function errorDescription(code,status){
  if(code==='HF_ZERO_GPU_QUOTA_EXHAUSTED'||code==='HF_QUOTA_EXHAUSTED')return 'Quota ZeroGPU đã hết.';
  if(code==='BACKEND_STARTING'||code==='BACKEND_NOT_READY')return 'Backend đang khởi động. Hãy kiểm tra lại rồi gửi thủ công.';
  if(status===429)return 'Gateway đang bận hoặc chặn gửi liên tục.';
  if(status===403)return 'Turnstile không hợp lệ hoặc đã hết hạn.';
  if(status===504)return 'Backend quá thời gian.';
  return 'Lượt suy luận không hoàn thành.';
}
async function runTrial(id){
  if(state.busy||state.loadingImages)return;
  const trial=state.trials.find(item=>item.id===id);if(!trial)return;
  if(trial.status!=='NOT_RUN'){note('Lượt đã chạy được giữ nguyên để so sánh. Hãy tạo biến thể mới nếu muốn gửi lại.');return;}
  const validation=validateResearchTrial(trial,state.images,models());if(validation){note(validation,'error');return;}
  if(!state.turnstileToken){note('Xác minh Turnstile trước khi gửi lượt thử.','error');showVerification();return;}
  const packed=makeResearchForm(trial,state.images,state.turnstileToken);if(!packed){note('Không tạo được request hợp lệ.','error');return;}
  consumeVerification();state.busy=true;resetTrial(trial);trial.status='RUNNING';trial.startedAt=new Date().toISOString();renderTrials();note('Đang gửi đúng một request. Không gửi song song hoặc tự thử lại.');
  const begin=performance.now();
  try{
    const response=await fetch(`${apiBase}${packed.endpoint}`,{method:'POST',body:packed.body,signal:AbortSignal.timeout(390_000)});
    trial.httpStatus=response.status;let payload;
    try{payload=await response.json();}catch{throw Error('INVALID_GATEWAY_JSON');}
    const rawRequestId=typeof payload.request_id==='string'?payload.request_id:response.headers.get('X-Request-ID');
    trial.requestId=typeof rawRequestId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(rawRequestId)?rawRequestId:null;
    if(!response.ok){trial.errorCode=safeCode(payload.code)||`HTTP_${response.status}`;throw Error(errorDescription(trial.errorCode,response.status));}
    const checked=checkedResult(payload,trial,state.images.length);
    if(!checked){trial.errorCode='PROVENANCE_MISMATCH';throw Error('Gateway trả kết quả không khớp model, token hoặc số ảnh.');}
    trial.answer=checked.answer;trial.provenance=checked.provenance;trial.status='PASS';note('Lượt thử hoàn thành. Đánh giá đáp án thủ công trước khi xuất.');
  }catch(error){trial.status='ERROR';trial.errorCode=trial.errorCode||(error?.name==='TimeoutError'?'CLIENT_TIMEOUT':'NETWORK_OR_RESPONSE_ERROR');note(`${error?.message||'Lượt thử thất bại.'} Không tự gửi lại. HTTP ${trial.httpStatus??'—'} · ${trial.errorCode} · request ${trial.requestId||'—'}.`,'error');}
  finally{trial.completedAt=new Date().toISOString();trial.wallSeconds=Number(((performance.now()-begin)/1000).toFixed(3));state.busy=false;renderTrials();}
}

function download(type){const data=researchExport(state);let content,mime,extension;if(type==='json'){content=JSON.stringify(data,null,2);mime='application/json';extension='json';}else if(type==='csv'){content=researchCsv(data);mime='text/csv;charset=utf-8';extension='csv';}else{content=researchMarkdown(data);mime='text/markdown;charset=utf-8';extension='md';}const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`vinfqa-research-${new Date().toISOString().slice(0,10)}.${extension}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

renderLibrary();render();void loadHealth();
$('#researchAttach').onclick=()=>refs.files.click();refs.files.onchange=()=>void useUploadedFiles(refs.files.files);
refs.drop.addEventListener('dragover',event=>{event.preventDefault();refs.drop.classList.add('drag-over');});
refs.drop.addEventListener('dragleave',()=>refs.drop.classList.remove('drag-over'));
refs.drop.addEventListener('drop',event=>{event.preventDefault();refs.drop.classList.remove('drag-over');void useUploadedFiles(event.dataTransfer.files);});
$('#addVariant').onclick=()=>addTrial('variant');$('#addModel').onclick=()=>addTrial('model');$('#addToken').onclick=()=>addTrial('token');
refs.verify.onclick=()=>{if(state.turnstileToken){verificationMessage('Đã xác minh cho một lượt gửi. Chọn lượt thử và bấm Gửi.');return;}showVerification();};
refs.retry.onclick=retryVerification;
$('#exportResearchJson').onclick=()=>download('json');$('#exportResearchCsv').onclick=()=>download('csv');$('#exportResearchMarkdown').onclick=()=>download('markdown');
$('#researchCloseViewer').onclick=()=>$('#researchImageViewer').close();$('#researchImageViewer').onclick=event=>{if(event.target.id==='researchImageViewer')event.target.close();};
$('#researchTheme').onclick=()=>{document.documentElement.classList.toggle('theme-light');const light=document.documentElement.classList.contains('theme-light');try{localStorage.setItem('vinfqa.theme',light?'light':'dark');}catch{}if(!state.turnstileToken&&state.widgetOpened){removeWidget();renderWidget(Date.now());}};
try{if(localStorage.getItem('vinfqa.theme')==='light')document.documentElement.classList.add('theme-light');}catch{}
addEventListener('beforeunload',()=>clearImages(state.images));

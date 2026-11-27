import {accountLabel, authConfigured, fetchPrivateImage, getSession, signOut} from './supabase-auth.js';
import {assistantModelLabel,DEFAULT_MAX_NEW_TOKENS,provenanceBranch,provenancePresentation, supportedTokenLimits as readSupportedTokenLimits} from './inference-mode.mjs';
import {UI_MODEL_IDS,backendForUiChoice,modelGroup,modelForSession,uiModelCapabilities,validateImageCount} from './model-registry.mjs';
import {conversationMarkdown,exportConversation,safeProvenance} from './conversation-export.mjs';
import {icon,setIcon} from './lucide-icons.mjs';
import {disambiguateNames,imageSha256,moveItem,removeItem} from './image-items.mjs';
import {recallQuestion} from './question-recall.mjs';

const cfg = window.VINFQA_PUBLIC_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;
// Four M7 images upload sequentially (up to 4 × 45s), then submit (30s) and await SSE (150s).
// Leave room for that 360s upstream ceiling plus gateway/quota overhead.
const INFERENCE_TIMEOUT_MS = 390_000;
const HEALTH_TIMEOUT_MS = 10_000;
const BACKEND_STATUS_TIMEOUT_MS = 15_000;
const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;
const HEALTH_RETRY_DELAYS_MS = [3_000,10_000,30_000];
const MAX_SESSIONS = 10;
const state = {
  sessions: [], active: null, busy: false, turnstileToken: '', widgetId: null, verificationRequested: false, verificationPinned:false,
  configured: /^https:\/\//.test(cfg.API_BASE_URL || '') && Boolean(cfg.TURNSTILE_SITE_KEY), serviceReady: false,
  healthAttempt: 0, healthTimer: null, turnstileStartedAt: 0, turnstileTimer: null,
  backendStatusTimer:null, backendStatusBusy:false, backendStatusQueued:false,
  authSession: null,
  supportedTokenLimits: [DEFAULT_MAX_NEW_TOKENS],
  models:uiModelCapabilities(null), imageOperation:0, imageQueue:Promise.resolve(), recallIndex:-1, recallDraft:'', renderedSessionId:null,
};
const refs = {
  sidebar: $('#sidebar'), chatList: $('#chatList'), empty: $('#emptyState'),
  messages: $('#messages'), question: $('#questionInput'), imageInput: $('#imageInput'),
  imageChip: $('#imageChip'), error: $('#errorNotice'), send: $('#sendButton'),
  turnstile: $('#turnstileBox'), proof: $('#proofRow'), status: $('#serviceStatus'), refreshCaptcha: $('#refreshCaptcha'),
  verifyTrigger: $('#openVerification'), verifyTriggerLabel: $('#verificationTriggerLabel'), verificationShield: $('#verificationShield'),
  sidebarBackdrop: $('#sidebarBackdrop'), openSidebar: $('#openSidebar'), closeSidebar: $('#closeSidebar'),
  accountLink: $('#accountLink'), accountLabel: $('#accountLabel'), sidebarLogin: $('#sidebarLogin'), sidebarRegister: $('#sidebarRegister'),
  saveImageOption: $('#saveImageOption'), saveImage: $('#saveImage'),
  composer: $('#composer'), attachButton: $('#attachButton'), inputHint: $('.input-hint'), sessionLock: $('#sessionLockState'),
  sampleButton: $('#loadSampleImages'),
  imageViewer: $('#imageViewer'), imageViewerContent: $('#imageViewerContent'), imageViewerMeta: $('#imageViewerMeta'),
  tokenInputs: [...document.querySelectorAll('input[name="max_new_tokens"]')],
  tokenStatus: $('#tokenCapabilityStatus'), composerFootnote: $('#composerFootnote'),
  modelSelector:$('#modelSelector'),modelStatus:$('#modelCapabilityStatus'),tokenSelector:$('#tokenSelector'),
  activeModelTitle:$('#activeModelTitle'),activeModelVersion:$('#activeModelVersion'),
  backendLifecycleStatus:$('#backendLifecycleStatus'),
};

function setupProgressiveDisclosure(){
  const makeMenu=(className,label,parent,before=null)=>{const details=htmlElement('details',className);const summary=htmlElement('summary','disclosure-trigger',label);summary.append(icon('chevron-down'));const panel=htmlElement('div','disclosure-panel');details.append(summary,panel);parent.insertBefore(details,before);return {details,summary,panel};};
  const topbar=document.querySelector('.topbar');
  const quota=makeMenu('quota-menu','GPU --',topbar,document.querySelector('.gpu-quota-strip'));
  const quotaStrip=$('#gpuQuota');quota.panel.append(quotaStrip);
  quota.summary.setAttribute('aria-label','Mở chi tiết quota ZeroGPU');
  const miniTop=htmlElement('span','mini-quota-top');
  miniTop.append(htmlElement('i','mini-quota-dot'));
  miniTop.append(htmlElement('span','mini-quota-label-desktop','ZeroGPU demo'));
  miniTop.append(htmlElement('span','mini-quota-label-mobile','ZeroGPU'));
  const miniValue=htmlElement('strong','mini-quota-value','--');
  const miniRemaining=htmlElement('strong','mini-quota-remaining','--');
  miniTop.append(miniValue,miniRemaining);
  const miniTrack=htmlElement('span','mini-quota-progress');
  const miniFill=htmlElement('span','mini-quota-fill');miniTrack.append(miniFill);
  quota.summary.replaceChildren(miniTop,miniTrack);
  const syncMiniQuota=()=>{
    const compact=$('#gpuQuotaCompact')?.textContent?.trim()||'--';
    miniValue.textContent=compact;
    miniRemaining.textContent=compact.split('/')[0].trim();
    miniFill.style.width=$('#gpuQuotaBar')?.style.width||'0%';
    quota.details.dataset.state=quotaStrip.dataset.state||'loading';
  };
  const quotaObserver=new MutationObserver(syncMiniQuota);
  quotaObserver.observe(quotaStrip,{attributes:true,subtree:true,childList:true,characterData:true});
  syncMiniQuota();
  const status=makeMenu('system-menu','Trạng thái',topbar,document.querySelector('.topbar-actions'));
  status.summary.prepend(htmlElement('i','status-dot'));
  status.panel.append(refs.status,refs.backendLifecycleStatus);
  refs.backendLifecycleStatus.classList.add('system-backend-status');
  const actions=document.querySelector('.topbar-actions');
  const account=makeMenu('account-menu','Tài khoản',actions,null);
  account.summary.setAttribute('aria-label','Tài khoản và giao diện');
  account.panel.append(refs.accountLink,refs.sidebarLogin,refs.sidebarRegister,$('#themeToggle'));
  const modelRow=document.querySelector('.model-selector-row');
  const composer=modelRow.parentElement;
  const model=makeMenu('model-menu','Chọn mô hình',composer,modelRow);
  const modelChoices=htmlElement('div','model-choice-list');
  modelChoices.id='modelChoices';
  modelRow.classList.add('model-selector-native');
  model.panel.append(modelChoices,modelRow,refs.tokenStatus);
  const sidebarVerify=document.querySelector('.sidebar-verification');
  const composerBottom=document.querySelector('.composer-bottom');
  composerBottom.querySelector('.left-tools').append(model.details);
  composerBottom.querySelector('.left-tools').append(refs.tokenSelector);
  composerBottom.insertBefore(sidebarVerify,composerBottom.querySelector('#openVerification'));
  sidebarVerify.classList.add('inline-verification');
  const placeVerification=()=>{
    if(!sidebarVerify.classList.contains('is-open'))return;
    const anchor=refs.verifyTrigger.getBoundingClientRect();
    if(!refs.verifyTrigger.isConnected||anchor.width===0||anchor.bottom<0||anchor.top>innerHeight){sidebarVerify.classList.remove('is-open');return;}
    const rect=sidebarVerify.getBoundingClientRect();
    const width=Math.min(rect.width,innerWidth-24);
    const height=rect.height;
    const left=Math.max(12,Math.min(anchor.right-width,innerWidth-width-12));
    const above=anchor.top>=height+12;
    sidebarVerify.style.left=`${left}px`;
    sidebarVerify.style.top=`${above?anchor.top-height-8:Math.min(innerHeight-height-12,anchor.bottom+8)}px`;
  };
  refs.verifyTrigger.addEventListener('click',()=>requestAnimationFrame(placeVerification));
  addEventListener('resize',placeVerification);
  addEventListener('scroll',placeVerification,true);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(placeVerification).observe(sidebarVerify);
  document.addEventListener('pointerdown',event=>{if(!sidebarVerify.contains(event.target)&&!refs.verifyTrigger.contains(event.target)){sidebarVerify.classList.remove('is-open');state.verificationPinned=false;}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebarVerify.classList.contains('is-open')){sidebarVerify.classList.remove('is-open');refs.verifyTrigger.focus();}});
  refs.verifyTrigger.addEventListener('mouseenter',()=>{if(refs.proof.dataset.state==='verified'){sidebarVerify.classList.add('is-open');requestAnimationFrame(placeVerification);}});
  refs.verifyTrigger.addEventListener('focus',()=>{if(refs.proof.dataset.state==='verified'){sidebarVerify.classList.add('is-open');requestAnimationFrame(placeVerification);}});
  refs.verifyTrigger.addEventListener('mouseleave',()=>{if(refs.proof.dataset.state==='verified'&&!state.verificationPinned&&!sidebarVerify.matches(':hover'))sidebarVerify.classList.remove('is-open');});
  refs.verifyTrigger.addEventListener('blur',()=>{if(refs.proof.dataset.state==='verified'&&!state.verificationPinned&&!sidebarVerify.matches(':hover'))sidebarVerify.classList.remove('is-open');});
  sidebarVerify.addEventListener('mouseleave',()=>{if(refs.proof.dataset.state==='verified'&&!state.verificationPinned)sidebarVerify.classList.remove('is-open');});
  const attachmentMenu=makeMenu('attachment-menu','+',document.querySelector('.left-tools'),model.details);
  setIcon(attachmentMenu.summary,'plus');
  attachmentMenu.summary.setAttribute('aria-label','Đính kèm ảnh hoặc chọn ảnh mẫu');
  attachmentMenu.summary.title='Đính kèm ảnh hoặc chọn ảnh mẫu';
  attachmentMenu.panel.append(refs.attachButton,refs.sampleButton,refs.inputHint,refs.saveImageOption);
  refs.verifyTrigger.hidden=false;
  refs.verifyTrigger.querySelector('[aria-hidden]')?.replaceWith(icon('shield-alert'));
  setIcon(refs.send,'arrow-up');
  setIcon($('#openSidebar'),'panel-left');setIcon(refs.closeSidebar,'x');
  setIcon($('#gpuQuotaRefresh'),'refresh-cw');
  setIcon($('#themeToggle'),'sun');setIcon($('#aboutToggle'),'info');
  $('#newChat .plus-icon')?.replaceWith(icon('plus'));
  setIcon($('#closeImageViewer'),'x');setIcon($('#closeAbout'),'x');
  const accountSummary=account.summary;accountSummary.prepend(icon('circle-user-round'));
  const sidebarBottom=document.querySelector('.sidebar-bottom');
  const info=makeMenu('help-menu','Trợ giúp & thông tin',sidebarBottom,sidebarBottom.querySelector('.mini-info'));
  info.panel.append(sidebarBottom.querySelector('.mini-info'),sidebarBottom.querySelector('p'),sidebarBottom.querySelector('a'),$('#aboutToggle'));
  for(const menu of document.querySelectorAll('.topbar details, .sidebar-bottom details, .composer details')){
    menu.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary')?.focus();}});
    document.addEventListener('pointerdown',event=>{if(menu.open&&!menu.contains(event.target))menu.open=false;});
  }
  for(const menu of [quota.details,status.details,account.details,model.details,attachmentMenu.details]) setupOverlay(menu,menu.querySelector('.disclosure-panel'));
  setupOverlay(info.details,info.panel);
  refs.messages.addEventListener('scroll',()=>{for(const menu of refs.messages.querySelectorAll('.message-actions-menu[open]'))menu.open=false;},{passive:true});
  document.addEventListener('pointerdown',event=>{for(const menu of refs.messages.querySelectorAll('.message-actions-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
}

function setupOverlay(details,panel){
  const hasPopover=typeof panel.showPopover==='function';
  if(hasPopover)panel.setAttribute('popover','manual');
  else panel.classList.add('fallback-overlay');
  const place=()=>{
    if(!details.open)return;
    const anchor=details.querySelector('summary').getBoundingClientRect();
    const rect=panel.getBoundingClientRect();
    const width=Math.min(rect.width,innerWidth-24);
    const above=details.closest('.composer, .sidebar-bottom')!==null;
    panel.style.setProperty('left',`${Math.max(12,Math.min(anchor.left,innerWidth-width-12))}px`,'important');
    panel.style.setProperty('top',`${above?Math.max(12,anchor.top-rect.height-8):Math.min(innerHeight-rect.height-12,anchor.bottom+8)}px`,'important');
  };
  details.addEventListener('toggle',()=>{
    if(details.open){
      if(hasPopover){panel.style.visibility='hidden';panel.showPopover();}
      requestAnimationFrame(()=>{place();panel.style.visibility='';});
    }else if(hasPopover&&panel.matches(':popover-open'))panel.hidePopover();
  });
  if(!details.classList.contains('message-actions-menu'))addEventListener('resize',place);
  if(!details.classList.contains('message-actions-menu')&&typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{if(details.open)requestAnimationFrame(place);}).observe(panel);
  details.addEventListener('vinfqa:overlay-resize',()=>requestAnimationFrame(place));
  details.addEventListener('keydown',event=>{if(event.key==='Escape'&&details.open){details.open=false;details.querySelector('summary')?.focus();}});
}

function renderModelChoices(){
  const list=document.querySelector('#modelChoices');if(!list)return;
  const active=modelGroup(current()?.modelId);
  const qwen=state.models.find(item=>item.model_id===UI_MODEL_IDS.V04);
  const extended=state.models.find(item=>item.model_id===UI_MODEL_IDS.EXTENDED);
  const m7=state.models.find(item=>item.model_id===UI_MODEL_IDS.M7);
  const choices=[
    {group:'qwen4b',name:'Qwen3-VL-4B',detail:`Qwen3-VL-4B-Instruct · 1 ảnh · 32 tokens: SSRC v04 · 64/128 tokens: ${extended?.enabled?'Extended Demo':'chưa khả dụng'}`,enabled:Boolean(qwen?.enabled||extended?.enabled)},
    {group:'m7',name:'M7 QLoRA 7B',detail:'Qwen2.5-VL-7B-Instruct · 2–4 ảnh · 96 tokens',enabled:Boolean(m7?.enabled)},
  ];
  list.replaceChildren(...choices.map(choice=>{
    const button=htmlElement('button','model-choice');button.type='button';button.disabled=!choice.enabled;
    button.dataset.selected=String(choice.group===active);
    button.setAttribute('aria-pressed',String(choice.group===active));
    const check=htmlElement('span','model-choice-check');if(choice.group===active)check.append(icon('check'));
    button.append(htmlElement('span','model-choice-name',choice.name),check,htmlElement('small','',choice.detail+(choice.enabled?'':' · Chưa khả dụng')));
    button.onclick=()=>{
      const target=choice.group==='m7'?m7:backendForUiChoice('qwen4b',selectedMaxNewTokens(),state.models)||[qwen,extended].find(item=>item?.enabled);
      if(target){switchBackend(target.model_id);if(modelGroup(current()?.modelId)===choice.group)document.querySelector('.model-menu').open=false;}
    };
    return button;
  }));
  document.querySelector('.model-menu')?.dispatchEvent(new Event('vinfqa:overlay-resize'));
}

const htmlElement = (tag, cls, text) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text; // Always textContent for user/model text.
  return element;
};
const current = () => state.sessions.find((s) => s.id === state.active);
const sessionLocked = (session) => Boolean(session?.messages?.some((message) => message.role === 'user'));
const imagesOf = (session) => Array.isArray(session?.images) ? session.images : (session?.file ? [{id:session.id,file:session.file,url:session.url}] : []);
const currentModel = () => modelForSession(state.models,current()?.modelId || UI_MODEL_IDS.V04);
const selectedMaxNewTokens = () => currentModel()?.model_id === UI_MODEL_IDS.M7 ? 96 : Number(refs.tokenInputs.find((input) => input.checked)?.value || DEFAULT_MAX_NEW_TOKENS);
function showError(message = '') {
  refs.error.textContent = message;
  refs.error.hidden = !message;
}
function updateAccountUI() {
  const loggedIn = Boolean(state.authSession);
  const label = loggedIn ? accountLabel(state.authSession) : 'Đăng nhập';
  refs.accountLabel.textContent = label;
  refs.accountLink.href = loggedIn ? '#account' : './login.html';
  refs.accountLink.title = loggedIn ? `${label} · Nhấn để đăng xuất` : 'Đăng nhập';
  refs.accountLink.setAttribute('aria-label',loggedIn ? `Tài khoản ${label}. Nhấn để đăng xuất` : 'Đăng nhập');
  refs.sidebarLogin.textContent = loggedIn ? label : 'Đăng nhập';
  refs.sidebarLogin.href = loggedIn ? '#account' : './login.html';
  refs.sidebarRegister.textContent = loggedIn ? 'Đăng xuất' : 'Đăng ký';
  refs.sidebarRegister.href = loggedIn ? '#logout' : './register.html';
  if (!loggedIn) refs.saveImage.checked = false;
}
function releaseSessionImages(sessions = state.sessions) {
  for (const session of sessions) {
    for (const image of imagesOf(session)) if (image.url) URL.revokeObjectURL(image.url);
  }
}
async function hydratePrivateImages(sessions) {
  if (!state.authSession) return;
  const authSession = state.authSession;
  await Promise.allSettled(sessions.map(async (session) => {
    const attachment = session.messages.find((message) => message.attachmentPath);
    if (!attachment) return;
    try {
      const blob = await fetchPrivateImage(attachment.attachmentPath,authSession);
      if (sessions !== state.sessions || state.authSession?.access_token !== authSession.access_token) return;
      const extension = attachment.attachmentPath.split('.').pop() || 'png';
      const fileName = `Ảnh đã lưu.${extension}`;
      const file = new File([blob],fileName,{type:blob.type});
      session.images = [{id:crypto.randomUUID(),file,originalName:file.name,displayName:file.name,sha256:await imageSha256(file),url:URL.createObjectURL(blob)}];
      session.imageStored = true;
    } finally { session.imageHydrating = false; }
  }));
  if (sessions === state.sessions) render();
}
async function logoutAccount() {
  if (!state.authSession || !confirm('Đăng xuất và xóa lịch sử đang hiển thị khỏi tab này?')) return;
  await signOut();
  releaseSessionImages();
  state.authSession = null; state.sessions = []; state.active = null;
  updateAccountUI(); addSession();
}
async function loadRemoteHistory() {
  if (!state.authSession || !state.configured) return false;
  try {
    const response = await fetch(cfg.API_BASE_URL.replace(/\/$/,'') + '/history', {
      headers:{'Authorization':`Bearer ${state.authSession.access_token}`},
      cache:'no-store', signal:AbortSignal.timeout(15_000),
    });
    if (response.status === 401) {
      await signOut(); state.authSession = null; updateAccountUI(); return false;
    }
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.conversations)) throw Error(payload.message || 'Chưa tải được lịch sử.');
    const previousSessions = state.sessions;
    const remoteSessions = payload.conversations.map((conversation) => {
      const messages = Array.isArray(conversation.messages) ? conversation.messages.map((message) => ({
        id:message.id, role:message.role, text:message.content,
        meta:message.role === 'assistant' && message.metadata && typeof message.metadata === 'object' ? message.metadata : null,
        attachmentPath:message.role === 'user' && typeof message.attachment_path === 'string' ? message.attachment_path : '',
      })) : [];
      const assistantMeta=messages.find(message=>message.role==='assistant'&&message.meta)?.meta;
      const historicalModel=assistantMeta?.model_id===UI_MODEL_IDS.M7 ? UI_MODEL_IDS.M7 :
        (assistantMeta?.inference_mode==='EXTENDED_DEMO' ? UI_MODEL_IDS.EXTENDED : UI_MODEL_IDS.V04);
      messages.forEach((message)=>{message.modelId=historicalModel;});
      return {
        id:conversation.id, title:conversation.title || 'Cuộc trò chuyện mới', messages,
        images:[],modelId:historicalModel,
        remote:true,imageHydrating:messages.some((message) => message.attachmentPath),
      };
    });
    releaseSessionImages(previousSessions);
    state.sessions = remoteSessions;
    state.active = state.sessions[0]?.id || null;
    void hydratePrivateImages(remoteSessions);
    return state.sessions.length > 0;
  } catch (error) {
    showError(error?.name === 'TimeoutError' ? 'Tải lịch sử tài khoản quá thời gian.' : (error.message || 'Chưa tải được lịch sử tài khoản.'));
    return false;
  }
}
function addSession() {
  state.imageOperation++;
  const session = { id: crypto.randomUUID(), title: 'Cuộc trò chuyện mới', messages: [], images: [], modelId:UI_MODEL_IDS.V04, maxNewTokens:32, draft:'', imageStored:false, imageSavePreference:false };
  state.sessions.unshift(session);
  while (state.sessions.length > MAX_SESSIONS) {
    const removed = state.sessions.pop();
    if (removed) releaseSessionImages([removed]);
  }
  state.active = session.id;
  resetRecall();
  render();
  if(state.configured){setBackendLifecycleStatus('NOT_VERIFIED');void checkBackendStatus();}
}
function renderSidebar() {
  refs.chatList.replaceChildren();
  for (const session of state.sessions) {
    const item = htmlElement('button', 'chat-item' + (state.active === session.id ? ' active' : ''));
    item.type = 'button'; item.setAttribute('aria-current', state.active === session.id ? 'page' : 'false');
    const chatIcon=htmlElement('span','chat-icon');chatIcon.append(icon('file-text'));
    item.append(chatIcon, htmlElement('span', '', session.title));
    item.onclick = () => { if (!state.busy) { state.imageOperation++;state.active = session.id; resetRecall(); closeSidebar(); render(); setBackendLifecycleStatus('NOT_VERIFIED'); void checkBackendStatus(); } };
    refs.chatList.append(item);
  }
}
function render() {
  renderSidebar();
  const session = current();
  const sessionChanged=state.renderedSessionId!==state.active;
  const followBottom=sessionChanged||refs.messages.scrollHeight-refs.messages.scrollTop-refs.messages.clientHeight<120;
  const previousScrollTop=refs.messages.scrollTop;
  state.renderedSessionId=state.active;
  if(sessionChanged){refs.question.value=session.draft||'';resizeInput();}
  if(session){const token=session.modelId===UI_MODEL_IDS.M7?32:(session.maxNewTokens || (session.modelId===UI_MODEL_IDS.EXTENDED?64:32));const input=refs.tokenInputs.find(item=>Number(item.value)===token);if(input)input.checked=true;}
  refs.empty.hidden = session.messages.length > 0;
  refs.messages.classList.toggle('active', session.messages.length > 0);
  for(const panel of refs.messages.querySelectorAll('.message-actions:popover-open'))panel.hidePopover();
  refs.messages.replaceChildren();
  if (sessionLocked(session)) refs.messages.append(createSessionImageNode(session));
  for (const msg of session.messages) refs.messages.append(createMessageNode(msg));
  syncModelControls();
  syncImageChip();
  updateSendState();
  if(followBottom)scrollToBottom();else refs.messages.scrollTop=previousScrollTop;
}
function syncModelControls() {
  const session=current();const model=currentModel();
  for(const option of refs.modelSelector.options){
    const capability=state.models.find(item=>item.model_id===option.value);
    option.disabled=!capability?.enabled;
    option.textContent=capability?.label+(capability?.enabled?'':' — Chưa khả dụng');
  }
  refs.modelSelector.value=model?.model_id || UI_MODEL_IDS.V04;
  const isM7=model?.model_id===UI_MODEL_IDS.M7;
  refs.activeModelTitle.textContent='Hỏi đáp infographic';
  refs.activeModelVersion.hidden=true;
  refs.imageInput.multiple=isM7;
  refs.tokenSelector.hidden=isM7;
  refs.tokenSelector.disabled=isM7;
  refs.tokenSelector.classList.toggle('token-selector-disabled',refs.tokenSelector.disabled);
  const isExtended=model?.model_id===UI_MODEL_IDS.EXTENDED;
  refs.modelStatus.textContent=isM7
    ? (model.enabled?'2–4 ảnh theo thứ tự · cố định 96 tokens':'M7 đang bị khóa bởi Gateway')
    :(isExtended?(model.enabled?'Một ảnh · 64/128 tokens':'Extended đang bị khóa bởi Gateway'):'Một ảnh · cố định 32 tokens');
  const dropTitle=refs.composer.querySelector('.drop-overlay strong');
  const dropHint=refs.composer.querySelector('.drop-overlay small');
  if(dropTitle)dropTitle.textContent=isM7?'Thả 2–4 ảnh theo đúng thứ tự':'Thả ảnh để bắt đầu phiên';
  if(dropHint)dropHint.textContent=isM7?'PNG, JPG hoặc WebP · tối đa 8 MB/ảnh, 24 MB tổng':'PNG, JPG hoặc WebP · tối đa 8 MB';
  if(session && model)session.modelId=model.model_id;
  const modelSummary=document.querySelector('.model-menu > summary');
  if(modelSummary)modelSummary.replaceChildren(document.createTextNode(isM7?'M7 QLoRA 7B · 96':'Qwen3-VL-4B'),icon('chevron-down'));
  renderModelChoices();
  renderPromptSuggestions(isM7);
}
function renderPromptSuggestions(isM7){
  const examples=$('#examples');
  const prompts=isM7?[
    ['So sánh số liệu','Đọc và so sánh số liệu giữa các ảnh.'],
    ['Tính chênh lệch','Nêu số liệu ở từng ảnh rồi tính chênh lệch giữa chúng.'],
    ['Tổng hợp nhiều ảnh','Tổng hợp thông tin chính xuất hiện trong các ảnh.'],
    ['Tìm thông tin','Ảnh nào chứa thông tin về nội dung tôi cần tìm?'],
  ]:[
    ['Tóm tắt nội dung','Infographic này nói về chủ đề gì?'],
    ['Đếm thông tin','Có bao nhiêu nội dung được liệt kê trong ảnh?'],
    ['Đọc số liệu','Những số liệu chính trong infographic là gì?'],
    ['Tìm quy định','Các quy định được nêu ở phần nào của infographic?'],
  ];
  examples.replaceChildren(...prompts.map(([title,prompt],index)=>{const button=htmlElement('button');button.type='button';button.dataset.prompt=prompt;button.append(htmlElement('strong','',title),htmlElement('small','',isM7?'Soạn câu hỏi cho bộ ảnh theo thứ tự':'Nắm nhanh thông tin trong một ảnh'));return button;}));
}
function syncTokenControls() {
  const model=currentModel();
  if(model?.model_id===UI_MODEL_IDS.M7){
    refs.tokenStatus.textContent='M7 dùng giới hạn cố định 96 tokens.';
    refs.composerFootnote.textContent='Không gửi ảnh chứa dữ liệu cá nhân hoặc nhạy cảm.';
    return;
  }
  const allowed=state.models.filter(item=>item.enabled&&item.model_id!==UI_MODEL_IDS.M7).flatMap(item=>item.max_new_tokens);
  const selected = selectedMaxNewTokens();
  for (const input of refs.tokenInputs) {
    const value = Number(input.value); const supported = allowed.includes(value);
    input.disabled = state.busy || !supported;
    input.closest('.token-option').hidden=false;
    input.title=supported?(value===32?'SSRC v04':'Extended Demo'):`${value} tokens chưa khả dụng theo Gateway`;
  }
  refs.tokenStatus.textContent='32 tokens dùng SSRC v04; 64/128 tokens dùng Extended Demo khi Gateway cho phép.';
  refs.composerFootnote.textContent = 'Không gửi ảnh chứa dữ liệu cá nhân hoặc nhạy cảm.';
}
function createSessionImageNode(session) {
  const images=imagesOf(session);
  if (!images.length) {
    const text = session.imageHydrating
      ? 'Đang tải ảnh riêng tư của cuộc trò chuyện…'
      : 'Ảnh của cuộc trò chuyện này không được lưu. Hãy tạo cuộc trò chuyện mới để tiếp tục hỏi trên một ảnh khác.';
    return htmlElement('div','session-image-missing',text);
  }
  const disclosure=htmlElement('details','session-gallery-disclosure');
  const gallerySummary=htmlElement('summary','',`${images.length} ảnh của phiên · Xem ảnh`);
  disclosure.append(gallerySummary);
  disclosure.addEventListener('toggle',()=>{gallerySummary.textContent=disclosure.open?'Thu gọn ảnh':`${images.length} ảnh của phiên · Xem ảnh`;});
  const group=htmlElement('div','session-image-gallery');
  images.forEach((item,index)=>{
    const button = htmlElement('button','session-image-context');
    button.type = 'button'; button.title = `Mở ảnh ${index+1} kích thước lớn`;
    const image = htmlElement('img'); image.src = item.url; image.alt = '';
    const copy = htmlElement('span','session-image-copy');
    copy.append(htmlElement('strong','',`Ảnh ${index+1}: ${item.displayName||item.file.name}`),htmlElement('small','', 'Ảnh cố định · Nhấn để xem lớn'));
    button.append(image,copy,htmlElement('span','session-image-action','Xem ảnh'));
    button.onclick = () => openImageViewer(session,index);group.append(button);
  });disclosure.append(group);return disclosure;
}
function createMessageNode(msg) {
  const wrap = htmlElement('article', `message ${msg.role}`);
  if (msg.role === 'assistant') wrap.append(htmlElement('div', 'bot-avatar', 'V'));
  const content = htmlElement('div', 'message-content');
  if (msg.role === 'assistant') content.append(htmlElement('div', 'msg-label', assistantModelLabel(msg.modelId,msg.meta)));
  content.append(htmlElement('div', 'msg-body', msg.text));
  if (msg.notice) content.append(htmlElement('div', 'message-note', msg.notice));
  if (msg.loading) {
    const wait = htmlElement('div', 'typing');
    wait.append(htmlElement('span', '', 'Đang đợi ZeroGPU và suy luận'));
    const dots = htmlElement('span', 'typing-dots');
    for (let i=0;i<3;i++) dots.append(htmlElement('i'));
    wait.append(dots); content.append(wait);
  }
  if (msg.meta) {
    const pills = htmlElement('div', 'message-meta');
    const meta = msg.meta; const presentation = provenancePresentation(meta);
    const session=current();
    const count=Number.isInteger(meta.image_count)?meta.image_count:imagesOf(session).length;
    const elapsed=typeof meta.elapsed_seconds==='number'?meta.elapsed_seconds.toLocaleString('vi-VN'):'—';
    pills.append(htmlElement('span','meta-summary',`${count||'—'} ảnh · ${elapsed} giây · ${presentation.outputTokens??'—'}/${presentation.limit??'—'} tokens`));
    const verification=htmlElement('span',`provenance-mark ${presentation.verified?'verified':'unverified'}`);verification.append(icon(presentation.verified?'shield-check':'shield-alert'));
    verification.title=presentation.verified?'Provenance đã xác minh theo metadata backend; không xác nhận đáp án đúng.':'NOT_VERIFIED: metadata chưa đủ điều kiện xác minh.';
    verification.setAttribute('aria-label',verification.title);pills.append(verification);
    if(!presentation.verified)pills.append(htmlElement('span','meta-warning','NOT_VERIFIED'));
    if(presentation.truncation)pills.append(htmlElement('span','meta-warning',presentation.truncation));
    content.append(pills);
  }
  if(msg.role==='assistant'&&!msg.loading&&msg.text){
    const toolbar=htmlElement('div','answer-toolbar');
    const copyAnswer=htmlElement('button','copy-answer');copyAnswer.append(icon('copy'),document.createTextNode(' Sao chép'));copyAnswer.type='button';copyAnswer.title='Sao chép câu trả lời';copyAnswer.onclick=()=>copyText(msg.text,copyAnswer);
    toolbar.append(copyAnswer);
    const actions=htmlElement('details','message-actions-menu');
    const actionSummary=htmlElement('summary','icon-btn');actionSummary.append(icon('ellipsis'));actionSummary.setAttribute('aria-label','Thao tác câu trả lời');actionSummary.title='Thao tác câu trả lời';actions.append(actionSummary);
    const actionPanel=htmlElement('div','message-actions');actions.append(actionPanel);
    setupOverlay(actions,actionPanel);
    if(msg.meta){
      const safe=safeProvenance(msg.meta);
      const dialog=htmlElement('dialog','provenance-dialog');
      const header=htmlElement('div','provenance-dialog-header');header.append(htmlElement('strong','', 'Provenance'));
      const close=htmlElement('button','icon-btn');close.append(icon('x'));close.type='button';close.setAttribute('aria-label','Đóng provenance');close.onclick=()=>dialog.close();header.append(close);
      const branch=provenanceBranch(safe);if(branch)dialog.append(htmlElement('p','provenance-branch',`Nhánh: ${branch}`));
      dialog.prepend(header);dialog.append(htmlElement('pre','',JSON.stringify(safe,null,2)));
      content.append(dialog);
      const view=htmlElement('button','text-btn','Xem provenance');view.type='button';view.onclick=()=>{actions.open=false;dialog.showModal();};actionPanel.append(view);
      const copyMeta=htmlElement('button','text-btn','Sao chép provenance');copyMeta.type='button';copyMeta.onclick=()=>copyText(JSON.stringify(safe,null,2),copyMeta);actionPanel.append(copyMeta);
    }
    const json=htmlElement('button','text-btn','Tải JSON');json.type='button';json.onclick=()=>downloadConversation('json');
    const markdown=htmlElement('button','text-btn','Tải Markdown');markdown.type='button';markdown.onclick=()=>downloadConversation('markdown');
    actionPanel.append(json,markdown);toolbar.append(actions);content.append(toolbar);
  }
  wrap.append(content); return wrap;
}
function scrollToBottom() { requestAnimationFrame(() => { refs.messages.scrollTop = refs.messages.scrollHeight; }); }
async function copyText(value,button){try{await navigator.clipboard.writeText(String(value??''));const original=[...button.childNodes].map(node=>node.cloneNode(true));button.textContent='Đã sao chép';setTimeout(()=>{button.replaceChildren(...original);},1600);}catch{showError('Không thể truy cập clipboard. Hãy kiểm tra quyền trình duyệt.');}}
function downloadConversation(format){
  const session=current();if(!session)return;
  const data=exportConversation(session,state.models);
  const content=format==='markdown'?conversationMarkdown(data):JSON.stringify(data,null,2);
  const blob=new Blob([content],{type:format==='markdown'?'text/markdown;charset=utf-8':'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);const link=htmlElement('a');link.href=url;link.download=`vinfqa-conversation-${new Date().toISOString().replace(/[:.]/g,'-')}.${format==='markdown'?'md':'json'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function openImageViewer(session = current(),index=0) {
  const item=imagesOf(session)[index];if(!item)return;
  refs.imageViewerContent.src = item.url;
  refs.imageViewerMeta.textContent = `Ảnh ${index+1} · ${item.displayName||item.file.name} · ${(item.file.size/1024/1024).toFixed(2)} MB`;
  if (!refs.imageViewer.open) refs.imageViewer.showModal();
}
function syncImageChip() {
  const session = current(); const images=imagesOf(session);const exists = images.length>0; const locked = sessionLocked(session);
  refs.imageChip.hidden = !exists || locked;
  refs.attachButton.hidden = locked;
  refs.inputHint.hidden = locked;
  refs.sessionLock.hidden = !locked || !exists;
  refs.saveImageOption.hidden = !state.authSession || locked || !exists;
  if(currentModel()?.model_id===UI_MODEL_IDS.M7)refs.saveImageOption.hidden=true;
  refs.composer.classList.toggle('image-locked',locked);
  refs.imageChip.replaceChildren();
  if(!exists||locked)return;
  images.forEach((item,index)=>{
    const card=htmlElement('div','selected-image-card');
    const preview=htmlElement('button','image-chip-preview');preview.type='button';preview.title=`Xem lớn ảnh ${index+1}`;
    const thumbnail=htmlElement('img');thumbnail.src=item.url;thumbnail.alt=`Ảnh ${index+1}`;preview.append(thumbnail);preview.onclick=()=>openImageViewer(session,index);
    const copy=htmlElement('div','image-chip-text');copy.append(htmlElement('span','selected-image-index',`Ảnh ${index+1}`),htmlElement('strong','',item.displayName||item.file.name),htmlElement('small','',`${(item.file.size/1024/1024).toFixed(2)} MB · ${item.file.type.replace('image/','').toUpperCase()}`));
    const actions=htmlElement('div','image-order-actions');
    for(const [name,delta] of [['arrow-up',-1],['arrow-down',1]]){const button=htmlElement('button','');button.append(icon(name));button.type='button';button.title=delta<0?'Chuyển ảnh lên':'Chuyển ảnh xuống';button.setAttribute('aria-label',button.title);button.disabled=index+delta<0||index+delta>=images.length;button.onclick=()=>moveImage(item.id,index+delta);actions.append(button);}
    const remove=htmlElement('button','remove-image');remove.append(icon('x'));remove.type='button';remove.setAttribute('aria-label',`Bỏ ảnh ${index+1}`);remove.onclick=()=>removeSelectedImage(item.id);
    actions.append(remove);card.append(preview,copy,actions);refs.imageChip.append(card);
  });
}
function updateSendState() {
  const session = current();const images=imagesOf(session);const model=currentModel(); const unavailable = sessionLocked(session) && !images.length;
  const tokenLimitSupported = Boolean(model?.enabled&&model.max_new_tokens.includes(selectedMaxNewTokens()));
  const imageCountReady=Boolean(model&&validateImageCount(model,images.length));
  refs.send.disabled = state.busy || unavailable || !tokenLimitSupported || !state.configured || !state.serviceReady || !imageCountReady || !refs.question.value.trim() || !state.turnstileToken;
  refs.send.title = !state.configured ? 'Chưa cấu hình Worker API và Turnstile' : 'Gửi câu hỏi';
  refs.question.disabled = state.busy || unavailable;
  refs.question.placeholder = unavailable ? 'Phiên này không còn ảnh để tiếp tục' : (sessionLocked(session) ? 'Hỏi tiếp về infographic này…' : (model?.model_id===UI_MODEL_IDS.M7?'Chọn 2–4 ảnh rồi đặt câu hỏi…':'Chọn một ảnh rồi đặt câu hỏi…'));
  refs.imageInput.disabled = state.busy || sessionLocked(session);
  refs.sampleButton.disabled=state.busy||sessionLocked(session);
  syncTokenControls();
}
async function checkImage(file) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw Error('Chỉ hỗ trợ PNG, JPG hoặc WebP.');
  if (file.size > 8*1024*1024) throw Error('Ảnh vượt quá 8 MB. Vui lòng chọn ảnh nhỏ hơn.');
  const bitmap = await createImageBitmap(file);
  const pixelCount = bitmap.width * bitmap.height; bitmap.close();
  if (pixelCount > 12_000_000) throw Error('Ảnh vượt quá 12 megapixel. Vui lòng giảm kích thước ảnh.');
}
async function chooseFiles(files,{replace=false}={}) {
  const candidates=Array.from(files||[]);if(!candidates.length)return;
  const session=current();const model=currentModel();const operation=state.imageOperation;
  try {
    if (sessionLocked(session)) throw Error('Ảnh đã khóa cho phiên này. Hãy tạo cuộc trò chuyện mới để đổi ảnh.');
    if(!model)throw Error('Mã mô hình của phiên không còn được hỗ trợ. Hãy tạo cuộc trò chuyện mới.');const existing=imagesOf(session);
    const baseImages=replace||model.image_max===1?[]:existing;
    if(baseImages.length+candidates.length>model.image_max)throw Error(`Mô hình ${model.label} chỉ nhận tối đa ${model.image_max} ảnh.`);
    for(const file of candidates)await checkImage(file);
    const combinedBytes=[...baseImages,...candidates.map(file=>({file}))].reduce((sum,item)=>sum+item.file.size,0);
    if(combinedBytes>24*1024*1024)throw Error('Tổng dung lượng ảnh vượt quá 24 MB. Vui lòng giảm kích thước ảnh.');
    const selected=[...baseImages];
    for(const file of candidates){
      const sha256=await imageSha256(file);
      if(selected.some(item=>item.sha256===sha256)&&!confirm(`Ảnh ${file.name} trùng nội dung với ảnh đã chọn. Chọn OK để giữ thêm, Cancel để bỏ qua.`))continue;
      selected.push({id:crypto.randomUUID(),file,originalName:file.name,sha256});
    }
    if(current()!==session||currentModel()?.model_id!==model.model_id||state.imageOperation!==operation||sessionLocked(session))return;
    if(selected.length>model.image_max)throw Error(`Mô hình ${model.label} chỉ nhận tối đa ${model.image_max} ảnh.`);
    const combined=disambiguateNames(selected.map(item=>item.url?item:{...item,url:URL.createObjectURL(item.file)}));
    if(replace||model.image_max===1)for(const item of existing)if(item.url)URL.revokeObjectURL(item.url);
    session.images=combined;
    showError(); syncImageChip(); updateSendState();
  } catch (error) { showError(error.message || 'Không đọc được ảnh.'); }
}
function queueChooseFiles(files,options){
  const sessionId=state.active;const snapshot=Array.from(files||[]);
  const job=state.imageQueue.then(()=>sessionId===state.active?chooseFiles(snapshot,options):undefined);
  state.imageQueue=job.catch(()=>{});return job;
}
function moveImage(id,to){const session=current();if(sessionLocked(session))return;state.imageOperation++;session.images=disambiguateNames(moveItem(imagesOf(session),id,to));syncImageChip();}
function removeSelectedImage(id){const session=current();if(sessionLocked(session))return;state.imageOperation++;const images=imagesOf(session);const removed=images.find(item=>item.id===id);if(removed?.url)URL.revokeObjectURL(removed.url);session.images=disambiguateNames(removeItem(images,id));session.imageSavePreference=false;refs.saveImage.checked=false;syncImageChip();updateSendState();}
function resetChallenge() {
  state.turnstileToken = '';
  setProofState('loading');
  if (window.turnstile && state.widgetId !== null) window.turnstile.reset(state.widgetId);
  updateSendState();
}
function setProofState(value) {
  refs.proof.dataset.state = value;
  const verificationPanel=document.querySelector('.inline-verification');
  if(verificationPanel)verificationPanel.dataset.state=value;
  state.verificationPinned=false;
  refs.verifyTrigger.hidden = !state.configured;
  refs.verifyTriggerLabel.textContent = value === 'verified' ? 'Đã xác minh' : value === 'error' ? 'Thử lại' : 'Xác minh';
  setIcon(refs.verificationShield,value === 'verified' ? 'shield-check' : 'shield-alert');
  const shieldIcon=refs.verifyTrigger.querySelector('svg');if(shieldIcon)shieldIcon.replaceWith(icon(value==='verified'?'shield-check':'shield-alert'));
  refs.verifyTrigger.dataset.state = value;
  if(value==='verified')refs.verifyTrigger.setAttribute('aria-label','Đã xác minh Turnstile');
  else refs.verifyTrigger.setAttribute('aria-label','Mở xác minh Turnstile');
  if(value==='verified')verificationPanel?.classList.remove('is-open');
}
function retryLabel(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return ` Có thể thử lại sau khoảng ${Math.ceil(seconds)} giây.`;
  return ` Có thể thử lại sau khoảng ${Math.ceil(seconds/60)} phút.`;
}
async function send() {
  const session = current(); const question = refs.question.value.trim();const images=imagesOf(session);const model=currentModel();
  if(!model){showError('Mã mô hình của phiên không còn được hỗ trợ. Hãy tạo cuộc trò chuyện mới.');return;}
  if (!state.configured || state.busy || !validateImageCount(model,images.length) || !question || !state.turnstileToken) return;
  const isFirstTurn = !sessionLocked(session);
  const maxNewTokens = selectedMaxNewTokens();
  if (!model.enabled||!model.max_new_tokens.includes(maxNewTokens)) {
    showError('Mức token đã chọn chưa được backend hỗ trợ.'); return;
  }
  let sessionExpired = false;
  if (state.authSession) {
    state.authSession = await getSession();
    updateAccountUI();
    sessionExpired = !state.authSession;
  }
  if (isFirstTurn) session.imageSavePreference = Boolean(state.authSession && refs.saveImage.checked);
  const saveImageRequested = Boolean(model.model_id!==UI_MODEL_IDS.M7&&state.authSession && session.imageSavePreference && !session.imageStored);
  showError(sessionExpired ? 'Phiên đăng nhập đã hết hạn. Lượt này sẽ không được đồng bộ vào tài khoản.' : '');
  state.busy = true; updateSendState();
  if (!session.messages.length) session.title = question.length > 37 ? question.slice(0,37) + '…' : question;
  const userMessage = {id:crypto.randomUUID(),role:'user',text:question,createdAt:new Date().toISOString(),modelId:model.model_id};
  session.messages.push(userMessage);
  const assistant = {id: crypto.randomUUID(), role: 'assistant', text: '', loading: true,createdAt:null,modelId:model.model_id};
  session.messages.push(assistant); refs.question.value = '';session.draft=''; resizeInput(); render();scrollToBottom();
  const token = state.turnstileToken; state.turnstileToken = '';
  let restoreQuestion=false;
  try {
    const body = new FormData();
    if(model.model_id===UI_MODEL_IDS.M7){
      body.append('model_id',UI_MODEL_IDS.M7);
      for(const item of images)body.append('images',item.file,item.file.name);
    }else{body.append('model_id',model.model_id);body.append('image',images[0].file,images[0].file.name);}
    body.append('question', question);
    body.append('turnstile', token);
    if (maxNewTokens !== DEFAULT_MAX_NEW_TOKENS) body.append('max_new_tokens',String(maxNewTokens));
    if (state.authSession) {
      body.append('conversation_id',session.id);
      body.append('conversation_title',session.title);
      body.append('user_message_id',userMessage.id);
      body.append('assistant_message_id',assistant.id);
      if (saveImageRequested) body.append('save_image','true');
    }
    const response = await fetch(cfg.API_BASE_URL.replace(/\/$/,'') + (model.model_id===UI_MODEL_IDS.M7?'/infer-multi':'/infer'), {
      method: 'POST', body,
      headers:state.authSession ? {'Authorization':`Bearer ${state.authSession.access_token}`} : {},
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
    let payload;
    try { payload = await response.json(); } catch { throw Error('Gateway trả về dữ liệu không hợp lệ.'); }
    if (!response.ok) {
      if(payload.backend_status==='Starting')restoreQuestion=true;
      if(Object.hasOwn(BACKEND_STATUS_LABELS,payload.backend_status)) {
        setBackendLifecycleStatus(payload.backend_status,payload.timestamp);
        if(payload.backend_status==='Starting')state.backendStatusTimer=setTimeout(()=>void checkBackendStatus(),20_000);
      }
      if (payload.code === 'EXTENDED_BACKEND_UNAVAILABLE') {
        state.models=state.models.map(item=>item.model_id===UI_MODEL_IDS.EXTENDED?{...item,enabled:false}:item);syncModelControls();syncTokenControls();
      }
      const suffix = response.status === 429 ? retryLabel(response.headers.get('Retry-After')) : '';
      const safeCode = typeof payload.code === 'string' && /^[A-Z0-9_]{2,64}$/.test(payload.code) ? payload.code : '';
      const requestId = typeof (payload.request_id || response.headers.get('X-Request-ID')) === 'string'
        ? String(payload.request_id || response.headers.get('X-Request-ID')).slice(0, 64) : '';
      const upstreamStatus = Number.isInteger(payload.upstream_status) ? `upstream HTTP ${payload.upstream_status}` : '';
      const timestamp = typeof payload.timestamp === 'string' && !Number.isNaN(Date.parse(payload.timestamp))
        ? `lúc ${new Date(payload.timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` : '';
      const diagnostic = [
        `HTTP ${response.status}`,
        upstreamStatus,
        safeCode ? `mã ${safeCode}` : '',
        requestId ? `request ${requestId}` : '',
        timestamp,
      ].filter(Boolean).join(' · ');
      assistant.meta={status:'ERROR',request_id:requestId||null,error_code:safeCode||null,http_status:response.status,timestamp:payload.timestamp||null};
      throw Error(`${payload.message || `Gateway từ chối (${response.status}).`}${suffix}\n${diagnostic}`);
    }
    if (payload.status !== 'INFERENCE_COMPLETED') throw Error('Backend không hoàn thành lượt suy luận.');
    assistant.text = typeof payload.answer === 'string' ? payload.answer : '';
    assistant.meta = payload.provenance || null;
    if(assistant.meta)assistant.meta={...assistant.meta,request_id:payload.request_id||null,client_recorded_at:new Date().toISOString()};
     assistant.createdAt = new Date().toISOString();
    if (payload.image_saved === true) session.imageStored = true;
    if (payload.history_mode === 'LOCAL_ONLY')
      assistant.notice = 'M7: cuộc trò chuyện chỉ được giữ trong tab này; chưa đồng bộ lên tài khoản.';
    else if (state.authSession && payload.history_saved === false)
      showError('Đã nhận câu trả lời nhưng chưa đồng bộ được lượt chat vào tài khoản.');
    else if (saveImageRequested && payload.image_saved === false)
      showError('Đã đồng bộ câu hỏi và câu trả lời, nhưng ảnh chưa được lưu vào lịch sử.');
  } catch (error) {
    if(restoreQuestion){refs.question.value=question;session.draft=question;resizeInput();}
    const message = error?.name === 'TimeoutError'
      ? 'Trình duyệt đã chờ quá 6 phút 30 giây. Request có thể đã tới backend; kiểm tra trạng thái trước khi gửi lại và dùng CAPTCHA mới nếu thử thủ công.'
      : (error.message || 'Lỗi kết nối.');
    assistant.text = 'Không thể hoàn thành lượt suy luận. ' + message;
    showError(message);
  } finally {
    if(!assistant.createdAt)assistant.createdAt=new Date().toISOString();
    assistant.loading = false; state.busy = false; resetChallenge();
    window.dispatchEvent(new CustomEvent('vinfqa:inference-finished'));
    render(); refs.question.focus();
  }
}
function resizeInput() { refs.question.style.height = 'auto'; refs.question.style.height = Math.min(refs.question.scrollHeight,160)+'px'; }
function setServiceState(ready, label) {
  state.serviceReady = ready; updateSendState(); refs.status.classList.toggle('ready',ready);
  refs.status.classList.toggle('paused',!ready); refs.status.lastChild.textContent = label;
  const menu=document.querySelector('.system-menu');
  if(menu){menu.dataset.gateway=ready?'ready':'unavailable';if(!ready)menu.dataset.state='unavailable';}
}
const BACKEND_STATUS_LABELS=Object.freeze({Sleeping:'Backend đang ngủ',Starting:'Backend đang khởi động',Ready:'Backend sẵn sàng',Unavailable:'Backend không khả dụng',NOT_VERIFIED:'Backend chưa xác minh'});
function setBackendLifecycleStatus(status,checkedAt) {
  if(!refs.backendLifecycleStatus)return;
  const known=Object.hasOwn(BACKEND_STATUS_LABELS,status)?status:'NOT_VERIFIED';
  refs.backendLifecycleStatus.dataset.state=known==='Ready'?'ready':known==='Starting'?'starting':known==='Sleeping'?'sleeping':known==='Unavailable'?'unavailable':'unknown';
  const menu=document.querySelector('.system-menu');
  if(menu)menu.dataset.state=known==='Ready'&&state.serviceReady?'ready':known==='Starting'||known==='Sleeping'?'starting':known==='Unavailable'||!state.serviceReady?'unavailable':'unknown';
  const checked=typeof checkedAt==='string'&&!Number.isNaN(Date.parse(checkedAt))?` · kiểm tra ${new Date(checkedAt).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`:'';
  refs.backendLifecycleStatus.lastElementChild.textContent=' '+BACKEND_STATUS_LABELS[known]+checked;
  const warning=document.querySelector('#backendComposerWarning');
  if(warning){
    warning.hidden=!['Starting','Sleeping','Unavailable'].includes(known);
    warning.textContent=known==='Sleeping'?'Backend đang ngủ. Gửi yêu cầu để đánh thức; hãy gửi lại thủ công khi backend sẵn sàng.'
      :known==='Starting'?'Backend đang khởi động. Giữ câu hỏi và gửi khi sẵn sàng.'
      :'Backend chưa khả dụng. Vui lòng kiểm tra lại sau.';
  }
}
async function checkBackendStatus() {
  if (!refs.backendLifecycleStatus || document.hidden || !state.configured) return;
  clearTimeout(state.backendStatusTimer);
  if(state.backendStatusBusy){state.backendStatusQueued=true;return;}
  const model=currentModel();if(!model)return;
  const requestedModelId=model.model_id;
  state.backendStatusBusy=true;
  try {
    const url=new URL(cfg.API_BASE_URL.replace(/\/$/,'')+'/backend-status');url.searchParams.set('model_id',requestedModelId);
    const response=await fetch(url,{method:'GET',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(BACKEND_STATUS_TIMEOUT_MS)});
    const data=await response.json();if(!response.ok||data.model_id!==requestedModelId)throw Error('backend status unavailable');
    const status=Object.hasOwn(BACKEND_STATUS_LABELS,data.backend?.status)?data.backend.status:'NOT_VERIFIED';
    if(currentModel()?.model_id===requestedModelId)setBackendLifecycleStatus(status,data.backend?.checked_at);else state.backendStatusQueued=true;
    if(status==='Starting')state.backendStatusTimer=setTimeout(()=>void checkBackendStatus(),20_000);
  } catch {
    if(currentModel()?.model_id===requestedModelId)setBackendLifecycleStatus('NOT_VERIFIED');
    else state.backendStatusQueued=true;
  }
  finally {
    state.backendStatusBusy=false;
    if(state.backendStatusQueued&&!document.hidden){state.backendStatusQueued=false;setTimeout(()=>void checkBackendStatus(),0);}
  }
}
function scheduleHealthRetry() {
  if (state.healthAttempt >= HEALTH_RETRY_DELAYS_MS.length || document.hidden) return;
  clearTimeout(state.healthTimer);
  const delay = HEALTH_RETRY_DELAYS_MS[state.healthAttempt++];
  state.healthTimer = setTimeout(()=>void checkService(),delay);
}
async function checkService(resetAttempts = false) {
  if (resetAttempts) state.healthAttempt = 0;
  clearTimeout(state.healthTimer);
  try {
    const response = await fetch(cfg.API_BASE_URL.replace(/\/$/,'')+'/health', {
      cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const data = await response.json();
    const ready = response.ok && data.status === 'ready';
    state.supportedTokenLimits = readSupportedTokenLimits(data,cfg.EXTENDED_DEMO_UI_ENABLED === true);
    state.models=uiModelCapabilities(data);
    syncModelControls();
    syncTokenControls();
    setServiceState(ready,ready ? ' Gateway sẵn sàng' : ' Đang khóa inference');
    void checkBackendStatus();
    if (!ready) scheduleHealthRetry();
  } catch {
    state.supportedTokenLimits = [DEFAULT_MAX_NEW_TOKENS];state.models=uiModelCapabilities(null);syncModelControls();syncTokenControls();
    setServiceState(false,' Gateway chưa sẵn sàng'); scheduleHealthRetry();
  }
}
function renderTurnstileWidget() {
  clearTimeout(state.turnstileTimer);
  if (!window.turnstile) {
    if (Date.now()-state.turnstileStartedAt >= TURNSTILE_LOAD_TIMEOUT_MS) {
      setProofState('error');
      refs.refreshCaptcha.hidden = false;
      showError('Không tải được xác minh Turnstile. Kiểm tra kết nối hoặc trình chặn nội dung rồi thử lại.');
      return;
    }
    state.turnstileTimer = setTimeout(renderTurnstileWidget,350); return;
  }
  try {
    state.widgetId = window.turnstile.render(refs.turnstile, {
      sitekey: cfg.TURNSTILE_SITE_KEY,
      theme: root.classList.contains('theme-light') ? 'light' : 'dark',
      size: 'compact',
      action: 'vinfqa_infer',
      callback: (token) => {
        state.turnstileToken = token; setProofState('verified'); updateSendState();
        if (state.verificationRequested) (refs.send.disabled ? refs.question : refs.send).focus();
        state.verificationRequested = false;
      },
      'expired-callback': () => {state.turnstileToken = ''; setProofState('loading'); updateSendState();},
      'error-callback': () => {state.turnstileToken = ''; setProofState('error'); refs.refreshCaptcha.hidden=false; updateSendState();},
    });
  } catch { setProofState('error'); refs.refreshCaptcha.hidden = false; }
}
function rerenderTurnstile() {
  state.turnstileToken = '';
  clearTimeout(state.turnstileTimer);
  if (window.turnstile && state.widgetId !== null) {
    try { window.turnstile.remove(state.widgetId); } catch {}
  }
  state.widgetId = null; state.turnstileStartedAt = Date.now(); setProofState('loading'); refs.refreshCaptcha.hidden = true;
  updateSendState(); renderTurnstileWidget();
}
function initTurnstile() {
  if (!state.configured) { setProofState('unavailable'); refs.status.classList.add('paused'); refs.status.lastChild.textContent = ' Chế độ xem trước'; return; }
  rerenderTurnstile(); void checkService(true);
}
function resetRecall(){state.recallIndex=-1;state.recallDraft='';}
refs.question.addEventListener('input',()=>{if(state.recallIndex>=0)resetRecall();if(current())current().draft=refs.question.value;resizeInput();updateSendState();});
refs.question.addEventListener('keydown',(event)=>{
  if(event.isComposing||event.keyCode===229)return;
  if((event.key==='ArrowUp'||event.key==='ArrowDown')&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){
    const result=recallQuestion(current()?.messages||[],state.recallIndex,state.recallDraft,event.key==='ArrowUp'?'up':'down',refs.question.value);
    if(result){
      event.preventDefault();
      state.recallIndex=result.index;state.recallDraft=result.draft;refs.question.value=result.value;if(current())current().draft=result.value;
      if(event.key==='ArrowDown'&&result.index===(current()?.messages||[]).filter(item=>item.role==='user').length)resetRecall();
      resizeInput();updateSendState();return;
    }
  }
  if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();resetRecall();void send();}
});
refs.send.addEventListener('click',()=>void send());
for (const input of refs.tokenInputs) input.addEventListener('change',()=>{
  const token=Number(input.value);const previous=current()?.maxNewTokens||(current()?.modelId===UI_MODEL_IDS.EXTENDED?64:32);
  const target=backendForUiChoice('qwen4b',token,state.models);
  if(!target||!switchBackend(target.model_id,token)){const old=refs.tokenInputs.find(item=>Number(item.value)===previous);if(old)old.checked=true;}
  syncTokenControls();updateSendState();
});
refs.imageInput.addEventListener('change',(e)=>{void queueChooseFiles(e.target.files);e.target.value='';});
function switchBackend(next,token=next===UI_MODEL_IDS.M7?96:next===UI_MODEL_IDS.V04?32:64){
  const session=current();if(!session)return false;
  if(next===session.modelId){session.maxNewTokens=token;syncModelControls();syncTokenControls();updateSendState();return true;}
  if((sessionLocked(session)||imagesOf(session).length)&&!confirm('Đổi backend sẽ bắt đầu cuộc trò chuyện mới để không trộn ảnh hoặc lịch sử. Tiếp tục?')){refs.modelSelector.value=session.modelId;return false;}
  const draft=refs.question.value;state.imageOperation++;
  if(sessionLocked(session)||imagesOf(session).length)addSession();
  const target=current();target.modelId=next;target.maxNewTokens=token;target.draft=draft;refs.question.value=draft;resizeInput();
  refs.modelSelector.value=next;const selected=refs.tokenInputs.find(item=>Number(item.value)===token);if(selected)selected.checked=true;
  syncModelControls();syncImageChip();syncTokenControls();updateSendState();showError();setBackendLifecycleStatus('NOT_VERIFIED');void checkBackendStatus();return true;
}
refs.modelSelector.addEventListener('change',()=>{const next=refs.modelSelector.value;switchBackend(next);});
$('#newChat').onclick=()=>{if(!state.busy){const defaultInput=refs.tokenInputs.find((input)=>Number(input.value)===DEFAULT_MAX_NEW_TOKENS);if(defaultInput)defaultInput.checked=true;addSession();showError();closeSidebar();}};
function closeSidebar(restoreFocus = false){refs.sidebar.classList.remove('open');refs.sidebarBackdrop.hidden=true;if(restoreFocus)refs.openSidebar.focus();}
refs.openSidebar.onclick=()=>{if(matchMedia('(min-width: 1025px)').matches){document.querySelector('.app-shell').classList.toggle('sidebar-collapsed');return;}refs.sidebar.classList.add('open');refs.sidebarBackdrop.hidden=false;refs.closeSidebar.focus();};
refs.closeSidebar.onclick=()=>closeSidebar(true);
refs.sidebarBackdrop.onclick=()=>closeSidebar(true);
refs.verifyTrigger.onclick=()=>{
  state.verificationRequested = refs.proof.dataset.state!=='verified';
  const panel=document.querySelector('.inline-verification');
  if(panel){if(refs.proof.dataset.state==='verified'){state.verificationPinned=true;panel.classList.add('is-open');}else panel.classList.toggle('is-open');}
  if(!panel?.classList.contains('is-open'))state.verificationRequested=false;
  if(panel?.classList.contains('is-open'))refs.proof.focus({preventScroll:true});
  if (refs.proof.dataset.state === 'error') rerenderTurnstile();
};
$('#themeToggle').onclick=()=>{root.classList.toggle('theme-light');setIcon($('#themeToggle'),root.classList.contains('theme-light')?'moon':'sun');if(state.configured)rerenderTurnstile();};
$('#aboutToggle').onclick=()=>$('#aboutDialog').showModal();
$('#closeAbout').onclick=()=>$('#aboutDialog').close();
$('#understood').onclick=()=>$('#aboutDialog').close();
$('#closeImageViewer').onclick=()=>refs.imageViewer.close();
refs.imageViewer.addEventListener('click',(event)=>{if(event.target===refs.imageViewer)refs.imageViewer.close();});
refs.imageViewer.addEventListener('close',()=>refs.imageViewerContent.removeAttribute('src'));
refs.refreshCaptcha.onclick=()=>{showError();rerenderTurnstile();};
$('#examples').addEventListener('click',(event)=>{
  const button=event.target.closest('[data-prompt]');if(button){refs.question.value=button.dataset.prompt;if(current())current().draft=refs.question.value;resizeInput();updateSendState();refs.question.focus();}
});
$('#loadSampleImages').addEventListener('click',async()=>{
  const model=currentModel();if(!model){showError('Mã mô hình không khả dụng.');return;}
  const sessionId=state.active;
  if(sessionLocked(current())){showError('Hãy tạo cuộc trò chuyện mới trước khi nạp ảnh mẫu.');return;}
  if(imagesOf(current()).length&&!confirm('Thay bộ ảnh đang chọn bằng ảnh mẫu tổng hợp?'))return;
  try{
    const names=model.model_id===UI_MODEL_IDS.M7?['khu-vuc-a','khu-vuc-b','khu-vuc-c','khu-vuc-d']:['khu-vuc-a'];
    const files=await Promise.all(names.map(async(name)=>{const response=await fetch(`./assets/samples/${name}.png`,{credentials:'omit',cache:'force-cache'});if(!response.ok)throw Error('Không tải được ảnh mẫu.');return new File([await response.blob()],`${name}.png`,{type:'image/png'});}));
    if(state.active===sessionId&&currentModel()?.model_id===model.model_id){await queueChooseFiles(files,{replace:true});document.querySelector('.attachment-menu').open=false;}
  }catch(error){showError(error.message||'Không nạp được ảnh mẫu.');}
});
window.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&refs.sidebar.classList.contains('open'))closeSidebar(true);if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!state.busy) addSession();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.configured){void checkService(true);void checkBackendStatus();}});
let dragDepth = 0;
const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
refs.composer.addEventListener('dragenter',(event)=>{
  if(!isFileDrag(event))return;
  event.preventDefault();dragDepth+=1;
  if(!state.busy&&!sessionLocked(current()))refs.composer.classList.add('drag-active');
});
refs.composer.addEventListener('dragover',(event)=>{
  if(!isFileDrag(event))return;
  event.preventDefault();
  event.dataTransfer.dropEffect=!state.busy&&!sessionLocked(current())?'copy':'none';
});
refs.composer.addEventListener('dragleave',(event)=>{
  if(!isFileDrag(event))return;
  dragDepth=Math.max(0,dragDepth-1);if(dragDepth===0)refs.composer.classList.remove('drag-active');
});
refs.composer.addEventListener('drop',(event)=>{
  if(!isFileDrag(event))return;
  event.preventDefault();dragDepth=0;refs.composer.classList.remove('drag-active');
  if(state.busy)return;
  if(sessionLocked(current())){showError('Mỗi cuộc trò chuyện chỉ dùng một ảnh. Hãy tạo cuộc trò chuyện mới để đổi ảnh.');return;}
  void queueChooseFiles(event.dataTransfer.files);
});
document.addEventListener('dragend',()=>{dragDepth=0;refs.composer.classList.remove('drag-active');});
for (const link of [refs.accountLink,refs.sidebarLogin,refs.sidebarRegister]) {
  link.addEventListener('click',(event)=>{
    if (!state.authSession) return;
    event.preventDefault(); void logoutAccount();
  });
}
async function initialize() {
  setupProgressiveDisclosure();
  if (authConfigured) state.authSession = await getSession();
  updateAccountUI();
  const loaded = await loadRemoteHistory();
  if (loaded) render(); else addSession();
  syncModelControls();
  initTurnstile();
}
void initialize();
if(!state.configured) showError('Đây là bản giao diện xem trước. Quản trị viên cần cấu hình config.js và Cloudflare Worker trước khi mở suy luận công khai.');

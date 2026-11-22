import {accountLabel, authConfigured, fetchPrivateImage, getSession, signOut} from './supabase-auth.js';
import {DEFAULT_MAX_NEW_TOKENS, provenancePresentation, supportedTokenLimits as readSupportedTokenLimits} from './inference-mode.mjs';

const cfg = window.VINFQA_PUBLIC_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;
const INFERENCE_TIMEOUT_MS = 240_000;
const HEALTH_TIMEOUT_MS = 10_000;
const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;
const HEALTH_RETRY_DELAYS_MS = [3_000,10_000,30_000];
const MAX_SESSIONS = 10;
const state = {
  sessions: [], active: null, busy: false, turnstileToken: '', widgetId: null, verificationRequested: false,
  configured: /^https:\/\//.test(cfg.API_BASE_URL || '') && Boolean(cfg.TURNSTILE_SITE_KEY), serviceReady: false,
  healthAttempt: 0, healthTimer: null, turnstileStartedAt: 0, turnstileTimer: null,
  authSession: null,
  supportedTokenLimits: [DEFAULT_MAX_NEW_TOKENS],
};
const refs = {
  sidebar: $('#sidebar'), chatList: $('#chatList'), empty: $('#emptyState'),
  messages: $('#messages'), question: $('#questionInput'), imageInput: $('#imageInput'),
  imageChip: $('#imageChip'), preview: $('#previewImage'), imageName: $('#imageName'),
  imageMeta: $('#imageMeta'), error: $('#errorNotice'), send: $('#sendButton'),
  turnstile: $('#turnstileBox'), proof: $('#proofRow'), status: $('#serviceStatus'), refreshCaptcha: $('#refreshCaptcha'),
  verifyTrigger: $('#openVerification'), verifyTriggerLabel: $('#verificationTriggerLabel'), verificationShield: $('#verificationShield'),
  sidebarBackdrop: $('#sidebarBackdrop'), openSidebar: $('#openSidebar'), closeSidebar: $('#closeSidebar'),
  accountLink: $('#accountLink'), accountLabel: $('#accountLabel'), sidebarLogin: $('#sidebarLogin'), sidebarRegister: $('#sidebarRegister'),
  saveImageOption: $('#saveImageOption'), saveImage: $('#saveImage'),
  composer: $('#composer'), attachButton: $('#attachButton'), inputHint: $('.input-hint'), sessionLock: $('#sessionLockState'),
  imageViewer: $('#imageViewer'), imageViewerContent: $('#imageViewerContent'), imageViewerMeta: $('#imageViewerMeta'),
  tokenInputs: [...document.querySelectorAll('input[name="max_new_tokens"]')],
  tokenStatus: $('#tokenCapabilityStatus'), composerFootnote: $('#composerFootnote'),
};

const htmlElement = (tag, cls, text) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text; // Always textContent for user/model text.
  return element;
};
const current = () => state.sessions.find((s) => s.id === state.active);
const sessionLocked = (session) => Boolean(session?.messages?.some((message) => message.role === 'user'));
const selectedMaxNewTokens = () => Number(refs.tokenInputs.find((input) => input.checked)?.value || DEFAULT_MAX_NEW_TOKENS);
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
    if (session.url) URL.revokeObjectURL(session.url);
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
      session.file = new File([blob],fileName,{type:blob.type});
      session.url = URL.createObjectURL(blob);
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
      return {
        id:conversation.id, title:conversation.title || 'Cuộc trò chuyện mới', messages,
        file:null,url:'',remote:true,imageHydrating:messages.some((message) => message.attachmentPath),
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
  const session = { id: crypto.randomUUID(), title: 'Cuộc trò chuyện mới', messages: [], file: null, url: '', imageStored:false, imageSavePreference:false };
  state.sessions.unshift(session);
  while (state.sessions.length > MAX_SESSIONS) {
    const removed = state.sessions.pop();
    if (removed) releaseSessionImages([removed]);
  }
  state.active = session.id;
  render();
}
function renderSidebar() {
  refs.chatList.replaceChildren();
  for (const session of state.sessions) {
    const item = htmlElement('button', 'chat-item' + (state.active === session.id ? ' active' : ''));
    item.type = 'button'; item.setAttribute('aria-current', state.active === session.id ? 'page' : 'false');
    item.append(htmlElement('span', 'chat-icon', '▤'), htmlElement('span', '', session.title));
    item.onclick = () => { if (!state.busy) { state.active = session.id; closeSidebar(); render(); } };
    refs.chatList.append(item);
  }
}
function render() {
  renderSidebar();
  const session = current();
  refs.empty.hidden = session.messages.length > 0;
  refs.messages.classList.toggle('active', session.messages.length > 0);
  refs.messages.replaceChildren();
  if (sessionLocked(session)) refs.messages.append(createSessionImageNode(session));
  for (const msg of session.messages) refs.messages.append(createMessageNode(msg));
  syncImageChip();
  updateSendState();
  scrollToBottom();
}
function syncTokenControls() {
  const selected = selectedMaxNewTokens();
  if (!state.supportedTokenLimits.includes(selected)) {
    const defaultInput = refs.tokenInputs.find((input) => Number(input.value) === DEFAULT_MAX_NEW_TOKENS);
    if (defaultInput) defaultInput.checked = true;
  }
  for (const input of refs.tokenInputs) {
    const value = Number(input.value); const supported = state.supportedTokenLimits.includes(value);
    input.disabled = state.busy || !supported;
    const detail = input.nextElementSibling?.querySelector('small');
    if (detail && value !== DEFAULT_MAX_NEW_TOKENS)
      detail.textContent = supported ? 'Extended Demo' : 'Extended · Chưa khả dụng';
  }
  const extendedAvailable = state.supportedTokenLimits.includes(64) && state.supportedTokenLimits.includes(128);
  refs.tokenStatus.textContent = extendedAvailable
    ? 'Extended Demo khả dụng với giới hạn 64 và 128 tokens.'
    : 'Extended Demo chưa khả dụng. Giới hạn hiện tại là 32 tokens.';
  const active = selectedMaxNewTokens();
  refs.composerFootnote.textContent = `Một ảnh cố định cho mỗi cuộc trò chuyện · Ảnh không được lưu mặc định · ${active === 32 ? 'SSRC v04' : 'Extended Demo'}: tối đa ${active} tokens`;
}
function createSessionImageNode(session) {
  if (!session.file || !session.url) {
    const text = session.imageHydrating
      ? 'Đang tải ảnh riêng tư của cuộc trò chuyện…'
      : 'Ảnh của cuộc trò chuyện này không được lưu. Hãy tạo cuộc trò chuyện mới để tiếp tục hỏi trên một ảnh khác.';
    return htmlElement('div','session-image-missing',text);
  }
  const button = htmlElement('button','session-image-context');
  button.type = 'button'; button.title = 'Mở ảnh kích thước lớn';
  const image = htmlElement('img'); image.src = session.url; image.alt = '';
  const copy = htmlElement('span','session-image-copy');
  copy.append(htmlElement('strong','',session.file.name),htmlElement('small','', 'Ảnh cố định của cuộc trò chuyện · Nhấn để xem lớn'));
  button.append(image,copy,htmlElement('span','session-image-action','Xem ảnh'));
  button.onclick = () => openImageViewer(session);
  return button;
}
function createMessageNode(msg) {
  const wrap = htmlElement('article', `message ${msg.role}`);
  if (msg.role === 'assistant') wrap.append(htmlElement('div', 'bot-avatar', 'V'));
  const content = htmlElement('div', 'message-content');
  if (msg.role === 'assistant') content.append(htmlElement('div', 'msg-label', 'S3-QLoRA · Trợ lý infographic'));
  content.append(htmlElement('div', 'msg-body', msg.text));
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
    pills.append(htmlElement('span','meta-pill mode',presentation.modeLabel));
    pills.append(htmlElement('span','meta-pill', meta.selected_branch || meta.route_predicted || 'S3-QLoRA'));
    if (typeof meta.elapsed_seconds === 'number') pills.append(htmlElement('span','meta-pill', `${meta.elapsed_seconds.toLocaleString('vi-VN')} giây`));
    pills.append(htmlElement('span','meta-pill',presentation.tokenLabel));
    if (presentation.truncation) pills.append(htmlElement('span','meta-pill warn',presentation.truncation));
    content.append(pills);
    const details = htmlElement('details','detail-box');
    details.append(htmlElement('summary','', 'Thông tin suy luận / provenance'));
    details.append(htmlElement('pre','', JSON.stringify(meta, null, 2)));
    content.append(details);
  }
  wrap.append(content); return wrap;
}
function scrollToBottom() { requestAnimationFrame(() => { refs.messages.scrollTop = refs.messages.scrollHeight; }); }
function openImageViewer(session = current()) {
  if (!session?.url || !session?.file) return;
  refs.imageViewerContent.src = session.url;
  refs.imageViewerMeta.textContent = `${session.file.name} · ${(session.file.size/1024/1024).toFixed(2)} MB`;
  if (!refs.imageViewer.open) refs.imageViewer.showModal();
}
function syncImageChip() {
  const session = current(); const exists = Boolean(session?.file); const locked = sessionLocked(session);
  refs.imageChip.hidden = !exists || locked;
  refs.attachButton.hidden = locked;
  refs.inputHint.hidden = locked;
  refs.sessionLock.hidden = !locked || !exists;
  refs.saveImageOption.hidden = !state.authSession || locked || !exists;
  refs.composer.classList.toggle('image-locked',locked);
  if (exists && !locked) {
    refs.preview.src = session.url;
    refs.imageName.textContent = session.file.name;
    refs.imageMeta.textContent = `${(session.file.size/1024/1024).toFixed(2)} MB · ${session.file.type.replace('image/','').toUpperCase()}`;
  } else { refs.preview.removeAttribute('src'); }
}
function updateSendState() {
  const session = current(); const unavailable = sessionLocked(session) && !session?.file;
  const tokenLimitSupported = state.supportedTokenLimits.includes(selectedMaxNewTokens());
  refs.send.disabled = state.busy || unavailable || !tokenLimitSupported || !state.configured || !state.serviceReady || !session?.file || !refs.question.value.trim() || !state.turnstileToken;
  refs.send.title = !state.configured ? 'Chưa cấu hình Worker API và Turnstile' : 'Gửi câu hỏi';
  refs.question.disabled = state.busy || unavailable;
  refs.question.placeholder = unavailable ? 'Phiên này không còn ảnh để tiếp tục' : (sessionLocked(session) ? 'Hỏi tiếp về infographic này…' : 'Chọn một ảnh rồi đặt câu hỏi…');
  refs.imageInput.disabled = state.busy || sessionLocked(session);
  syncTokenControls();
}
async function checkImage(file) {
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw Error('Chỉ hỗ trợ PNG, JPG hoặc WebP.');
  if (file.size > 8*1024*1024) throw Error('Ảnh vượt quá 8 MB. Vui lòng chọn ảnh nhỏ hơn.');
  const bitmap = await createImageBitmap(file);
  const pixelCount = bitmap.width * bitmap.height; bitmap.close();
  if (pixelCount > 12_000_000) throw Error('Ảnh vượt quá 12 megapixel. Vui lòng giảm kích thước ảnh.');
}
async function chooseFile(file) {
  if (!file) return;
  try {
    if (sessionLocked(current())) throw Error('Mỗi cuộc trò chuyện chỉ dùng một ảnh. Hãy tạo cuộc trò chuyện mới để đổi ảnh.');
    await checkImage(file);
    const session = current(); if (session.url) URL.revokeObjectURL(session.url);
    session.file = file; session.url = URL.createObjectURL(file);
    showError(); syncImageChip(); updateSendState();
  } catch (error) { showError(error.message || 'Không đọc được ảnh.'); }
}
function resetChallenge() {
  state.turnstileToken = '';
  setProofState('loading');
  if (window.turnstile && state.widgetId !== null) window.turnstile.reset(state.widgetId);
  updateSendState();
}
function setProofState(value) {
  refs.proof.dataset.state = value;
  refs.verifyTrigger.hidden = value === 'verified' || !state.configured;
  refs.verifyTriggerLabel.textContent = value === 'error' ? 'Thử lại' : 'Xác minh';
  refs.verificationShield.textContent = value === 'verified' ? '✓' : '◇';
  refs.verifyTrigger.dataset.state = value;
}
function retryLabel(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return ` Có thể thử lại sau khoảng ${Math.ceil(seconds)} giây.`;
  return ` Có thể thử lại sau khoảng ${Math.ceil(seconds/60)} phút.`;
}
async function send() {
  const session = current(); const question = refs.question.value.trim();
  if (!state.configured || state.busy || !session.file || !question || !state.turnstileToken) return;
  const isFirstTurn = !sessionLocked(session);
  const maxNewTokens = selectedMaxNewTokens();
  if (!state.supportedTokenLimits.includes(maxNewTokens)) {
    showError('Mức token đã chọn chưa được backend hỗ trợ.'); return;
  }
  let sessionExpired = false;
  if (state.authSession) {
    state.authSession = await getSession();
    updateAccountUI();
    sessionExpired = !state.authSession;
  }
  if (isFirstTurn) session.imageSavePreference = Boolean(state.authSession && refs.saveImage.checked);
  const saveImageRequested = Boolean(state.authSession && session.imageSavePreference && !session.imageStored);
  showError(sessionExpired ? 'Phiên đăng nhập đã hết hạn. Lượt này sẽ không được đồng bộ vào tài khoản.' : '');
  state.busy = true; updateSendState();
  if (!session.messages.length) session.title = question.length > 37 ? question.slice(0,37) + '…' : question;
  const userMessage = {id:crypto.randomUUID(),role:'user',text:question};
  session.messages.push(userMessage);
  const assistant = {id: crypto.randomUUID(), role: 'assistant', text: '', loading: true};
  session.messages.push(assistant); refs.question.value = ''; resizeInput(); render();
  const token = state.turnstileToken; state.turnstileToken = '';
  try {
    const body = new FormData();
    body.append('image', session.file, session.file.name);
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
    const response = await fetch(cfg.API_BASE_URL.replace(/\/$/,'') + '/infer', {
      method: 'POST', body,
      headers:state.authSession ? {'Authorization':`Bearer ${state.authSession.access_token}`} : {},
      signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
    let payload;
    try { payload = await response.json(); } catch { throw Error('Gateway trả về dữ liệu không hợp lệ.'); }
    if (!response.ok) {
      if (payload.code === 'EXTENDED_BACKEND_UNAVAILABLE') {
        state.supportedTokenLimits = [DEFAULT_MAX_NEW_TOKENS]; syncTokenControls();
      }
      const suffix = response.status === 429 ? retryLabel(response.headers.get('Retry-After')) : '';
      throw Error((payload.message || `Gateway từ chối (${response.status}).`) + suffix);
    }
    if (payload.status !== 'INFERENCE_COMPLETED') throw Error('Backend không hoàn thành lượt suy luận.');
    assistant.text = typeof payload.answer === 'string' ? payload.answer : '';
    assistant.meta = payload.provenance || null;
    if (payload.image_saved === true) session.imageStored = true;
    if (state.authSession && payload.history_saved === false)
      showError('Đã nhận câu trả lời nhưng chưa đồng bộ được lượt chat vào tài khoản.');
    else if (saveImageRequested && payload.image_saved === false)
      showError('Đã đồng bộ câu hỏi và câu trả lời, nhưng ảnh chưa được lưu vào lịch sử.');
  } catch (error) {
    const message = error?.name === 'TimeoutError'
      ? 'Lượt suy luận vượt quá 4 phút. Gateway có thể vẫn đang kết thúc tác vụ; vui lòng chờ rồi thử lại với CAPTCHA mới.'
      : (error.message || 'Lỗi kết nối.');
    assistant.text = 'Không thể hoàn thành lượt suy luận. ' + message;
    showError(message);
  } finally {
    assistant.loading = false; state.busy = false; resetChallenge();
    window.dispatchEvent(new CustomEvent('vinfqa:inference-finished'));
    render(); refs.question.focus();
  }
}
function resizeInput() { refs.question.style.height = 'auto'; refs.question.style.height = Math.min(refs.question.scrollHeight,160)+'px'; }
function setServiceState(ready, label) {
  state.serviceReady = ready; updateSendState(); refs.status.classList.toggle('ready',ready);
  refs.status.classList.toggle('paused',!ready); refs.status.lastChild.textContent = label;
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
    syncTokenControls();
    setServiceState(ready,ready ? ' Gateway sẵn sàng' : ' Đang khóa inference');
    if (!ready) scheduleHealthRetry();
  } catch {
    state.supportedTokenLimits = [DEFAULT_MAX_NEW_TOKENS];syncTokenControls();
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
        if (state.verificationRequested && matchMedia('(max-width: 1024px)').matches) {
          closeSidebar(); (refs.send.disabled ? refs.question : refs.send).focus();
        }
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
refs.question.addEventListener('input',()=>{resizeInput();updateSendState();});
refs.question.addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send();}});
refs.send.addEventListener('click',()=>void send());
for (const input of refs.tokenInputs) input.addEventListener('change',()=>{showError();syncTokenControls();updateSendState();});
refs.imageInput.addEventListener('change',(e)=>void chooseFile(e.target.files?.[0]));
$('#openSelectedImage').onclick=()=>openImageViewer();
$('#removeImage').onclick=()=>{
  const session=current();
  if(sessionLocked(session)){showError('Ảnh đã được khóa cho cuộc trò chuyện này. Hãy tạo cuộc trò chuyện mới để đổi ảnh.');return;}
  if(session.url) URL.revokeObjectURL(session.url);
  session.file=null;session.url='';session.imageSavePreference=false;refs.imageInput.value='';refs.saveImage.checked=false;syncImageChip();updateSendState();
};
$('#newChat').onclick=()=>{if(!state.busy){const defaultInput=refs.tokenInputs.find((input)=>Number(input.value)===DEFAULT_MAX_NEW_TOKENS);if(defaultInput)defaultInput.checked=true;addSession();refs.question.value='';resizeInput();showError();closeSidebar();}};
function closeSidebar(restoreFocus = false){refs.sidebar.classList.remove('open');refs.sidebarBackdrop.hidden=true;if(restoreFocus)refs.openSidebar.focus();}
refs.openSidebar.onclick=()=>{refs.sidebar.classList.add('open');refs.sidebarBackdrop.hidden=false;refs.closeSidebar.focus();};
refs.closeSidebar.onclick=()=>closeSidebar(true);
refs.sidebarBackdrop.onclick=()=>closeSidebar(true);
refs.verifyTrigger.onclick=()=>{
  state.verificationRequested = true;
  refs.sidebar.classList.add('open'); refs.sidebarBackdrop.hidden = false;
  refs.proof.scrollIntoView({block:'center',behavior:'smooth'});
  refs.proof.focus({preventScroll:true});
  if (refs.proof.dataset.state === 'error') rerenderTurnstile();
};
$('#themeToggle').onclick=()=>{root.classList.toggle('theme-light');$('#themeToggle').textContent=root.classList.contains('theme-light')?'☾':'☀';if(state.configured)rerenderTurnstile();};
$('#aboutToggle').onclick=()=>$('#aboutDialog').showModal();
$('#closeAbout').onclick=()=>$('#aboutDialog').close();
$('#understood').onclick=()=>$('#aboutDialog').close();
$('#closeImageViewer').onclick=()=>refs.imageViewer.close();
refs.imageViewer.addEventListener('click',(event)=>{if(event.target===refs.imageViewer)refs.imageViewer.close();});
refs.imageViewer.addEventListener('close',()=>refs.imageViewerContent.removeAttribute('src'));
refs.refreshCaptcha.onclick=()=>{showError();rerenderTurnstile();};
$('#examples').addEventListener('click',(event)=>{
  const button=event.target.closest('[data-prompt]');if(button){refs.question.value=button.dataset.prompt;resizeInput();updateSendState();refs.question.focus();}
});
window.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&refs.sidebar.classList.contains('open'))closeSidebar(true);if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!state.busy) addSession();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.configured)void checkService(true);});
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
  void chooseFile(event.dataTransfer.files?.[0]);
});
document.addEventListener('dragend',()=>{dragDepth=0;refs.composer.classList.remove('drag-active');});
for (const link of [refs.accountLink,refs.sidebarLogin,refs.sidebarRegister]) {
  link.addEventListener('click',(event)=>{
    if (!state.authSession) return;
    event.preventDefault(); void logoutAccount();
  });
}
async function initialize() {
  if (authConfigured) state.authSession = await getSession();
  updateAccountUI();
  const loaded = await loadRemoteHistory();
  if (loaded) render(); else addSession();
  initTurnstile();
}
void initialize();
if(!state.configured) showError('Đây là bản giao diện xem trước. Quản trị viên cần cấu hình config.js và Cloudflare Worker trước khi mở suy luận công khai.');

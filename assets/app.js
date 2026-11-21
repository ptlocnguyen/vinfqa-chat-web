const cfg = window.VINFQA_PUBLIC_CONFIG || {};
const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;
const INFERENCE_TIMEOUT_MS = 240_000;
const HEALTH_TIMEOUT_MS = 10_000;
const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;
const HEALTH_RETRY_DELAYS_MS = [3_000,10_000,30_000];
const MAX_SESSIONS = 10;
const state = {
  sessions: [], active: null, busy: false, turnstileToken: '', widgetId: null,
  configured: /^https:\/\//.test(cfg.API_BASE_URL || '') && Boolean(cfg.TURNSTILE_SITE_KEY), serviceReady: false,
  healthAttempt: 0, healthTimer: null, turnstileStartedAt: 0, turnstileTimer: null,
};
const refs = {
  sidebar: $('#sidebar'), chatList: $('#chatList'), empty: $('#emptyState'),
  messages: $('#messages'), question: $('#questionInput'), imageInput: $('#imageInput'),
  imageChip: $('#imageChip'), preview: $('#previewImage'), imageName: $('#imageName'),
  imageMeta: $('#imageMeta'), error: $('#errorNotice'), send: $('#sendButton'),
  turnstile: $('#turnstileBox'), status: $('#serviceStatus'), refreshCaptcha: $('#refreshCaptcha'),
  sidebarBackdrop: $('#sidebarBackdrop'), openSidebar: $('#openSidebar'), closeSidebar: $('#closeSidebar'),
};

const htmlElement = (tag, cls, text) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text; // Always textContent for user/model text.
  return element;
};
const current = () => state.sessions.find((s) => s.id === state.active);
function showError(message = '') {
  refs.error.textContent = message;
  refs.error.hidden = !message;
}
function addSession() {
  const session = { id: crypto.randomUUID(), title: 'Cuộc trò chuyện mới', messages: [], file: null, url: '' };
  state.sessions.unshift(session);
  while (state.sessions.length > MAX_SESSIONS) {
    const removed = state.sessions.pop();
    if (removed?.url) URL.revokeObjectURL(removed.url);
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
  for (const msg of session.messages) refs.messages.append(createMessageNode(msg));
  syncImageChip();
  updateSendState();
  scrollToBottom();
}
function createMessageNode(msg) {
  const wrap = htmlElement('article', `message ${msg.role}`);
  if (msg.role === 'assistant') wrap.append(htmlElement('div', 'bot-avatar', 'V'));
  const content = htmlElement('div', 'message-content');
  if (msg.role === 'assistant') content.append(htmlElement('div', 'msg-label', 'S3-QLoRA · Trợ lý infographic'));
  if (msg.imageURL) {
    const img = htmlElement('img', 'message-image'); img.src = msg.imageURL;
    img.alt = 'Ảnh infographic do người dùng đính kèm'; content.append(img);
  }
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
    const meta = msg.meta;
    pills.append(htmlElement('span','meta-pill', meta.selected_branch || meta.route_predicted || 'S3-QLoRA'));
    if (typeof meta.elapsed_seconds === 'number') pills.append(htmlElement('span','meta-pill', `${meta.elapsed_seconds.toLocaleString('vi-VN')} giây`));
    if (Number.isInteger(meta.output_tokens)) pills.append(htmlElement('span','meta-pill', `${meta.output_tokens}/32 tokens`));
    if (meta.possible_truncation) pills.append(htmlElement('span','meta-pill warn', 'Có thể bị cắt ở 32 tokens'));
    content.append(pills);
    const details = htmlElement('details','detail-box');
    details.append(htmlElement('summary','', 'Thông tin suy luận / provenance'));
    details.append(htmlElement('pre','', JSON.stringify(meta, null, 2)));
    content.append(details);
  }
  wrap.append(content); return wrap;
}
function scrollToBottom() { requestAnimationFrame(() => { refs.messages.scrollTop = refs.messages.scrollHeight; }); }
function syncImageChip() {
  const session = current(); const exists = Boolean(session?.file);
  refs.imageChip.hidden = !exists;
  if (exists) {
    refs.preview.src = session.url;
    refs.imageName.textContent = session.file.name;
    refs.imageMeta.textContent = `${(session.file.size/1024/1024).toFixed(2)} MB · ${session.file.type.replace('image/','').toUpperCase()}`;
  } else { refs.preview.removeAttribute('src'); }
}
function updateSendState() {
  refs.send.disabled = state.busy || !state.configured || !state.serviceReady || !current()?.file || !refs.question.value.trim() || !state.turnstileToken;
  refs.send.title = !state.configured ? 'Chưa cấu hình Worker API và Turnstile' : 'Gửi câu hỏi';
  refs.question.disabled = state.busy; refs.imageInput.disabled = state.busy;
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
    await checkImage(file);
    const session = current(); if (session.url) URL.revokeObjectURL(session.url);
    session.file = file; session.url = URL.createObjectURL(file);
    showError(); syncImageChip(); updateSendState();
  } catch (error) { showError(error.message || 'Không đọc được ảnh.'); }
}
function resetChallenge() {
  state.turnstileToken = '';
  if (window.turnstile && state.widgetId !== null) window.turnstile.reset(state.widgetId);
  updateSendState();
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
  showError(); state.busy = true; updateSendState();
  if (!session.messages.length) session.title = question.length > 37 ? question.slice(0,37) + '…' : question;
  session.messages.push({ id: crypto.randomUUID(), role: 'user', text: question, imageURL: session.url });
  const assistant = {id: crypto.randomUUID(), role: 'assistant', text: '', loading: true};
  session.messages.push(assistant); refs.question.value = ''; resizeInput(); render();
  const token = state.turnstileToken; state.turnstileToken = '';
  try {
    const body = new FormData();
    body.append('image', session.file, session.file.name);
    body.append('question', question);
    body.append('turnstile', token);
    const response = await fetch(cfg.API_BASE_URL.replace(/\/$/,'') + '/infer', {
      method: 'POST', body, signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
    let payload;
    try { payload = await response.json(); } catch { throw Error('Gateway trả về dữ liệu không hợp lệ.'); }
    if (!response.ok) {
      const suffix = response.status === 429 ? retryLabel(response.headers.get('Retry-After')) : '';
      throw Error((payload.message || `Gateway từ chối (${response.status}).`) + suffix);
    }
    if (payload.status !== 'INFERENCE_COMPLETED') throw Error('Backend không hoàn thành lượt suy luận.');
    assistant.text = typeof payload.answer === 'string' ? payload.answer : '';
    assistant.meta = payload.provenance || null;
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
    setServiceState(ready,ready ? ' Gateway sẵn sàng' : ' Đang khóa inference');
    if (!ready) scheduleHealthRetry();
  } catch {
    setServiceState(false,' Gateway chưa sẵn sàng'); scheduleHealthRetry();
  }
}
function renderTurnstileWidget() {
  clearTimeout(state.turnstileTimer);
  if (!window.turnstile) {
    if (Date.now()-state.turnstileStartedAt >= TURNSTILE_LOAD_TIMEOUT_MS) {
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
      action: 'vinfqa_infer',
      callback: (token) => { state.turnstileToken = token; updateSendState(); },
      'expired-callback': () => {state.turnstileToken = ''; updateSendState();},
      'error-callback': () => {state.turnstileToken = ''; refs.refreshCaptcha.hidden=false; updateSendState();},
    });
  } catch { refs.refreshCaptcha.hidden = false; }
}
function rerenderTurnstile() {
  state.turnstileToken = '';
  clearTimeout(state.turnstileTimer);
  if (window.turnstile && state.widgetId !== null) {
    try { window.turnstile.remove(state.widgetId); } catch {}
  }
  state.widgetId = null; state.turnstileStartedAt = Date.now(); refs.refreshCaptcha.hidden = true;
  updateSendState(); renderTurnstileWidget();
}
function initTurnstile() {
  if (!state.configured) { refs.status.classList.add('paused'); refs.status.lastChild.textContent = ' Chế độ xem trước'; return; }
  rerenderTurnstile(); void checkService(true);
}
refs.question.addEventListener('input',()=>{resizeInput();updateSendState();});
refs.question.addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void send();}});
refs.send.addEventListener('click',()=>void send());
refs.imageInput.addEventListener('change',(e)=>void chooseFile(e.target.files?.[0]));
$('#removeImage').onclick=()=>{const s=current();if(s.url){URL.revokeObjectURL(s.url);}s.file=null;s.url='';refs.imageInput.value='';syncImageChip();updateSendState();};
$('#newChat').onclick=()=>{if(!state.busy){addSession();refs.question.value='';resizeInput();showError();closeSidebar();}};
function closeSidebar(restoreFocus = false){refs.sidebar.classList.remove('open');refs.sidebarBackdrop.hidden=true;if(restoreFocus)refs.openSidebar.focus();}
refs.openSidebar.onclick=()=>{refs.sidebar.classList.add('open');refs.sidebarBackdrop.hidden=false;refs.closeSidebar.focus();};
refs.closeSidebar.onclick=()=>closeSidebar(true);
refs.sidebarBackdrop.onclick=()=>closeSidebar(true);
$('#themeToggle').onclick=()=>{root.classList.toggle('theme-light');$('#themeToggle').textContent=root.classList.contains('theme-light')?'☾':'☀';if(state.configured)rerenderTurnstile();};
$('#aboutToggle').onclick=()=>$('#aboutDialog').showModal();
$('#closeAbout').onclick=()=>$('#aboutDialog').close();
$('#understood').onclick=()=>$('#aboutDialog').close();
refs.refreshCaptcha.onclick=()=>{showError();rerenderTurnstile();};
$('#examples').addEventListener('click',(event)=>{
  const button=event.target.closest('[data-prompt]');if(button){refs.question.value=button.dataset.prompt;resizeInput();updateSendState();refs.question.focus();}
});
window.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&refs.sidebar.classList.contains('open'))closeSidebar(true);if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!state.busy) addSession();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.configured)void checkService(true);});
for(const type of ['dragenter','dragover']) $('#composer').addEventListener(type,(e)=>{e.preventDefault();});
$('#composer').addEventListener('drop',(e)=>{e.preventDefault();if(!state.busy)void chooseFile(e.dataTransfer.files?.[0]);});
addSession();initTurnstile();
if(!state.configured) showError('Đây là bản giao diện xem trước. Quản trị viên cần cấu hình config.js và Cloudflare Worker trước khi mở suy luận công khai.');

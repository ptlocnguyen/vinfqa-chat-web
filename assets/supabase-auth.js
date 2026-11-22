const cfg = window.VINFQA_PUBLIC_CONFIG || {};
const LOCAL_KEY = 'vinfqa.auth.session';
const SESSION_KEY = 'vinfqa.auth.tab-session';

export const authConfigured = (() => {
  try {
    const url = new URL(cfg.SUPABASE_URL || '');
    const key = cfg.SUPABASE_PUBLISHABLE_KEY || '';
    return url.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) &&
      url.pathname === '/' && key.length >= 20 && key.length <= 2048 && !/\s/.test(key);
  } catch { return false; }
})();

const endpoint = (path) => cfg.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1' + path;
const authHeaders = (token = '') => ({
  'apikey':cfg.SUPABASE_PUBLISHABLE_KEY,
  'Content-Type':'application/json',
  ...(token ? {'Authorization':`Bearer ${token}`} : {}),
});

async function authRequest(path, options = {}) {
  if (!authConfigured) throw Error('Dịch vụ tài khoản chưa được cấu hình.');
  const response = await fetch(endpoint(path), {
    ...options,
    headers:{...authHeaders(options.token),...(options.headers || {})},
    signal:AbortSignal.timeout(15_000),
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const raw = String(payload.msg || payload.message || payload.error_description || '');
    if (/invalid login credentials/i.test(raw)) throw Error('Email hoặc mật khẩu chưa đúng.');
    if (/already registered|already exists/i.test(raw)) throw Error('Email này đã được đăng ký.');
    if (/password/i.test(raw) && /characters|least/i.test(raw)) throw Error('Mật khẩu chưa đáp ứng yêu cầu bảo mật.');
    if (/rate limit|too many/i.test(raw)) throw Error('Bạn thao tác quá nhanh. Vui lòng thử lại sau.');
    throw Error(raw ? raw.slice(0,180) : `Dịch vụ tài khoản trả về lỗi ${response.status}.`);
  }
  return payload;
}

function readStoredSession() {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const raw = storage.getItem(storage === localStorage ? LOCAL_KEY : SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
  }
  return null;
}

function persistSession(session, remember = false) {
  clearSession();
  if (!session?.access_token || !session?.refresh_token) return;
  const normalized = {...session, remember};
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem(remember ? LOCAL_KEY : SESSION_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent('vinfqa:auth-changed',{detail:{session:normalized}}));
}

export function clearSession() {
  try { localStorage.removeItem(LOCAL_KEY); } catch {}
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

export async function getSession() {
  const session = readStoredSession();
  if (!session?.access_token || !session?.refresh_token) return null;
  if (Number(session.expires_at || 0) * 1000 > Date.now() + 60_000) return session;
  try {
    const refreshed = await authRequest('/token?grant_type=refresh_token', {
      method:'POST', body:JSON.stringify({refresh_token:session.refresh_token}),
    });
    persistSession(refreshed,session.remember === true);
    return {...refreshed,remember:session.remember === true};
  } catch { clearSession(); return null; }
}

export async function signIn(email, password, remember = false) {
  const session = await authRequest('/token?grant_type=password', {
    method:'POST', body:JSON.stringify({email,password}),
  });
  persistSession(session,remember);
  return session;
}

export async function signUp(email, password, displayName) {
  const result = await authRequest('/signup', {
    method:'POST', body:JSON.stringify({email,password,data:{display_name:displayName}}),
  });
  if (result.access_token) persistSession(result,false);
  return result;
}

export async function sendPasswordRecovery(email) {
  return authRequest('/recover', {
    method:'POST',
    body:JSON.stringify({email,redirect_to:new URL('./reset-password.html',location.href).href}),
  });
}

export async function consumeRecoverySession() {
  const params = new URLSearchParams(location.hash.replace(/^#/,'') || location.search.replace(/^\?/,''));
  if (params.get('type') !== 'recovery') return null;
  const accessToken = params.get('access_token') || '';
  const refreshToken = params.get('refresh_token') || '';
  if (!accessToken || !refreshToken) throw Error(params.get('error_description') || 'Liên kết khôi phục không hợp lệ.');
  const user = await authRequest('/user',{method:'GET',token:accessToken});
  const session = {
    access_token:accessToken,
    refresh_token:refreshToken,
    expires_at:Math.floor(Date.now()/1000) + Number(params.get('expires_in') || 3600),
    token_type:params.get('token_type') || 'bearer',
    user,
  };
  persistSession(session,false);
  history.replaceState(null,'',location.pathname);
  return session;
}

export async function updatePassword(newPassword, accessToken) {
  return authRequest('/user',{method:'PUT',body:JSON.stringify({password:newPassword}),token:accessToken});
}

export async function signOut() {
  const session = readStoredSession();
  clearSession();
  if (session?.access_token && authConfigured) {
    try { await authRequest('/logout',{method:'POST',body:'{}',token:session.access_token}); } catch {}
  }
  window.dispatchEvent(new CustomEvent('vinfqa:auth-changed',{detail:{session:null}}));
}

export const accountLabel = (session) => {
  const name = session?.user?.user_metadata?.display_name?.trim();
  if (name) return name.slice(0,24);
  const email = session?.user?.email || '';
  return email.includes('@') ? email.split('@')[0].slice(0,24) : 'Tài khoản';
};

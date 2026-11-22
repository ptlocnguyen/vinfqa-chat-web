import {authConfigured, getSession, sendPasswordRecovery, signIn, signUp} from './supabase-auth.js';

const form = document.getElementById('authForm');
const notice = document.getElementById('authNotice');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirmPassword');
const passwordToggle = document.querySelector('.password-toggle');
const meter = document.querySelector('.password-meter span');
const submitButton = form?.querySelector('[type="submit"]');

const setError = (name, message = '') => {
  const input = form?.elements.namedItem(name);
  const target = document.querySelector(`[data-error-for="${name}"]`);
  if (input instanceof HTMLElement) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (target) target.textContent = message;
};

const showNotice = (message, state = 'error') => {
  notice.textContent = message;
  notice.dataset.state = state;
  notice.hidden = false;
  notice.focus?.();
};

const setBusy = (busy) => {
  for (const element of form?.elements || []) element.disabled = busy;
  form?.setAttribute('aria-busy',String(busy));
  if (submitButton) submitButton.textContent = busy ? 'Đang xử lý…' : (form.dataset.mode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập');
};

const passwordScore = (value) => [
  value.length >= 8,
  /[a-z]/.test(value) && /[A-Z]/.test(value),
  /\d/.test(value),
  /[^A-Za-z0-9]/.test(value),
].filter(Boolean).length;

if (meter && password) {
  password.addEventListener('input', () => {
    const score = passwordScore(password.value);
    meter.style.width = `${score * 25}%`;
    meter.style.background = score >= 4 ? '#79deb0' : score >= 3 ? '#e8b96e' : '#db7b68';
  });
}

passwordToggle?.addEventListener('click', () => {
  const reveal = password?.type === 'password';
  for (const input of [password, confirmPassword]) if (input) input.type = reveal ? 'text' : 'password';
  passwordToggle.textContent = reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu';
  passwordToggle.setAttribute('aria-pressed', String(reveal));
});

document.querySelector('[data-action="recover"]')?.addEventListener('click', async () => {
  const email = form.elements.namedItem('email');
  if (!email.value.trim() || !email.validity.valid) {
    setError('email','Nhập email hợp lệ để nhận liên kết khôi phục.');
    email.focus();
    return;
  }
  try {
    setBusy(true);
    await sendPasswordRecovery(email.value.trim());
    showNotice('Nếu email tồn tại, Supabase đã gửi liên kết khôi phục mật khẩu.', 'success');
  } catch (error) { showNotice(error.message || 'Chưa gửi được email khôi phục.'); }
  finally { setBusy(false); }
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  notice.hidden = true;
  let valid = true;
  const email = form.elements.namedItem('email');
  const displayName = form.elements.namedItem('displayName');
  const terms = form.elements.namedItem('terms');

  if (displayName) {
    const message = displayName.value.trim().length < 2 ? 'Tên hiển thị cần ít nhất 2 ký tự.' : '';
    setError('displayName', message); valid &&= !message;
  }
  const emailMessage = !email.value.trim() ? 'Vui lòng nhập email.' : !email.validity.valid ? 'Email chưa đúng định dạng.' : '';
  setError('email', emailMessage); valid &&= !emailMessage;
  const passwordMessage = password.value.length < 8 ? 'Mật khẩu cần ít nhất 8 ký tự.' : '';
  setError('password', passwordMessage); valid &&= !passwordMessage;
  if (confirmPassword) {
    const message = confirmPassword.value !== password.value ? 'Mật khẩu nhập lại chưa khớp.' : '';
    setError('confirmPassword', message); valid &&= !message;
  }
  if (terms) {
    const message = terms.checked ? '' : 'Bạn cần xác nhận lưu ý của demo.';
    setError('terms', message); valid &&= !message;
  }
  if (!valid) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  if (!authConfigured) {
    showNotice('Quản trị viên chưa kết nối Supabase cho bản triển khai này.');
    return;
  }

  try {
    setBusy(true);
    if (form.dataset.mode === 'register') {
      const result = await signUp(email.value.trim(),password.value,displayName.value.trim());
      if (result.access_token) location.replace('./index.html');
      else {
        form.reset();
        showNotice('Tài khoản đã được tạo. Hãy kiểm tra email để xác nhận trước khi đăng nhập.', 'success');
      }
    } else {
      const remember = form.elements.namedItem('remember')?.checked === true;
      await signIn(email.value.trim(),password.value,remember);
      location.replace('./index.html');
    }
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'Dịch vụ tài khoản phản hồi quá chậm. Vui lòng thử lại.' : error.message;
    showNotice(message || 'Không thể hoàn thành yêu cầu tài khoản.');
  } finally { setBusy(false); }
});

if (!authConfigured) showNotice('Dịch vụ tài khoản đang chờ cấu hình Supabase. Form chưa gửi dữ liệu.', 'info');
else {
  void getSession().then((session) => {
    if (session && form?.dataset.mode === 'login') showNotice('Bạn đang đăng nhập. Gửi form để chuyển sang tài khoản khác.', 'info');
  });
}

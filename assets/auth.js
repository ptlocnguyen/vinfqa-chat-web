const form = document.getElementById('authForm');
const notice = document.getElementById('authNotice');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirmPassword');
const passwordToggle = document.querySelector('.password-toggle');
const meter = document.querySelector('.password-meter span');

const setError = (name, message = '') => {
  const input = form?.elements.namedItem(name);
  const target = document.querySelector(`[data-error-for="${name}"]`);
  if (input instanceof HTMLElement) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (target) target.textContent = message;
};

const showNotice = (message) => {
  notice.textContent = message;
  notice.hidden = false;
  notice.focus?.();
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

document.querySelectorAll('[data-notice]').forEach((button) => {
  button.addEventListener('click', () => showNotice(button.dataset.notice));
});

form?.addEventListener('submit', (event) => {
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

  showNotice('Dịch vụ tài khoản chưa được kết nối với Cloudflare Gateway. Thông tin vừa nhập chưa được gửi hoặc lưu lại.');
});

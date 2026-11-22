import {authConfigured, consumeRecoverySession, signOut, updatePassword} from './supabase-auth.js';

const form = document.getElementById('resetForm');
const notice = document.getElementById('authNotice');
const password = document.getElementById('password');
const confirmation = document.getElementById('confirmPassword');
const submit = form.querySelector('[type="submit"]');
let recoverySession = null;

function showNotice(message,state='error') {
  notice.textContent=message; notice.dataset.state=state; notice.hidden=false;
}
function setBusy(busy) {
  for (const element of form.elements) element.disabled=busy;
  submit.textContent=busy?'Đang xử lý…':'Lưu mật khẩu mới';
}

form.addEventListener('submit',async(event)=>{
  event.preventDefault(); notice.hidden=true;
  const passwordError=password.value.length<8?'Mật khẩu cần ít nhất 8 ký tự.':'';
  const confirmationError=confirmation.value!==password.value?'Mật khẩu nhập lại chưa khớp.':'';
  document.querySelector('[data-error-for="password"]').textContent=passwordError;
  document.querySelector('[data-error-for="confirmPassword"]').textContent=confirmationError;
  if(passwordError||confirmationError) return;
  if(!recoverySession) {showNotice('Liên kết khôi phục không hợp lệ hoặc đã hết hạn.');return;}
  try {
    setBusy(true);
    await updatePassword(password.value,recoverySession.access_token);
    await signOut();
    showNotice('Đã cập nhật mật khẩu. Đang chuyển về trang đăng nhập…','success');
    setTimeout(()=>location.replace('./login.html'),900);
  } catch(error) {showNotice(error.message||'Chưa cập nhật được mật khẩu.');setBusy(false);}
});

if(!authConfigured) showNotice('Dịch vụ tài khoản chưa được cấu hình.');
else {
  void consumeRecoverySession().then((session)=>{
    recoverySession=session;
    if(!session) showNotice('Hãy mở trang này từ liên kết khôi phục trong email.','info');
  }).catch((error)=>showNotice(error.message||'Liên kết khôi phục không hợp lệ.'));
}

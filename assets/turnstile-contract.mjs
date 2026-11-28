export const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;

export function safeTurnstileErrorCode(value){
  return /^\d{6}$/.test(String(value))?String(value):'';
}

export function turnstileErrorText(code){
  const safeCode=safeTurnstileErrorCode(code);
  const config=['110100','110110','110200','400020','400021','400070'].includes(safeCode);
  const network=safeCode==='200500';
  const clock=safeCode==='200100';
  return `${config?'Cấu hình xác minh chưa hợp lệ. Báo quản trị viên.':network?'Không tải được khung xác minh. Kiểm tra kết nối hoặc trình chặn nội dung.':clock?'Kiểm tra ngày giờ máy và tải lại trang.':'Xác minh thất bại. Thử lại hoặc dùng trình duyệt khác.'}${safeCode?` Mã ${safeCode}.`:''}`;
}

export function turnstileWidgetOptions({sitekey,theme,isCurrent,onVerified,onExpired,onTimeout,onError}){
  return {
    sitekey,theme,size:'compact',action:'vinfqa_infer',retry:'never',
    callback:token=>{if(isCurrent()&&typeof token==='string'&&token)onVerified(token);},
    'expired-callback':()=>{if(isCurrent())onExpired();},
    'timeout-callback':()=>{if(isCurrent())onTimeout();},
    'error-callback':code=>{if(isCurrent())onError(safeTurnstileErrorCode(code));return true;},
  };
}

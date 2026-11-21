// Public, read-only ZeroGPU quota. No token or account credential in this file.
// Quota belongs to the account behind the Worker, not to each visitor.
const quotaCfg = window.VINFQA_PUBLIC_CONFIG || {};
const quotaRoot = document.getElementById('gpuQuota');
const quotaValue = document.getElementById('gpuQuotaRemaining');
const quotaCompact = document.getElementById('gpuQuotaCompact');
const quotaReset = document.getElementById('gpuQuotaReset');
const quotaUpdated = document.getElementById('gpuQuotaUpdated');
const quotaBar = document.getElementById('gpuQuotaBar');
const quotaRefresh = document.getElementById('gpuQuotaRefresh');

if (quotaRoot && quotaValue && quotaCompact && quotaReset && quotaUpdated && quotaBar && quotaRefresh) {
  let busy = false;
  let lastRequest = 0;
  const interval = 120000;
  const secondsLabel = (n) => {
    const total = Math.max(0, Math.floor(n));
    const mins = Math.floor(total/60);
    return mins === 0 ? String(total) + ' giây' : String(mins) + ' phút' + (total%60 ? ' ' + String(total%60) + ' giây' : '');
  };
  const vnTime = (iso) => new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));
  const compactLabel = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    return 'GPU ' + String(Math.floor(total/60)) + ':' + String(total%60).padStart(2, '0');
  };
  const unavailable = (message) => {
    quotaRoot.dataset.state = 'unavailable';
    quotaValue.textContent = 'Quota chưa khả dụng';
    quotaCompact.textContent = 'GPU --';
    quotaReset.textContent = message;
    quotaUpdated.textContent = 'Không suy đoán số phút còn lại';
    quotaBar.style.width = '0%';
    quotaBar.parentElement.setAttribute('aria-valuenow', '0');
  };
  async function refreshQuota(force = false) {
    if (busy || (!force && Date.now() - lastRequest < interval)) return;
    if (typeof quotaCfg.API_BASE_URL !== 'string' || !/^https:\/\//.test(quotaCfg.API_BASE_URL)) {
      unavailable('Chưa cấu hình Cloudflare gateway'); return;
    }
    busy = true; lastRequest = Date.now(); quotaRefresh.disabled = true;
    try {
      const response = await fetch(quotaCfg.API_BASE_URL.replace(/\/$/, '') + '/quota', {
        method: 'GET', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'available' ||
          !Number.isFinite(data.remaining_seconds) || !Number.isFinite(data.base_seconds) || data.base_seconds <= 0) {
        throw Error('QUOTA_UNAVAILABLE');
      }
      const left = Math.max(0, data.remaining_seconds);
      const fraction = Math.min(100, Math.max(0, 100 * left / data.base_seconds));
      quotaRoot.dataset.state = left <= 0 ? 'exhausted' : left < 60 ? 'low' : 'available';
      quotaValue.textContent = 'Còn ' + secondsLabel(left) + ' / ' + secondsLabel(data.base_seconds);
      quotaCompact.textContent = compactLabel(left);
      quotaReset.textContent = data.resets_at ? 'Cấp lại: ' + vnTime(data.resets_at) + ' (giờ VN)' : 'Chưa có mốc đặt lại (có thể chưa dùng GPU trong chu kỳ)';
      const checked = Date.parse(data.checked_at);
      quotaUpdated.textContent = Number.isFinite(checked) ? 'Đo lúc ' + new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(checked)) + ' (giờ VN)' : 'Chưa xác minh thời điểm đo';
      quotaBar.style.width = String(fraction.toFixed(2)) + '%';
      quotaBar.parentElement.setAttribute('aria-valuenow', String(Math.round(fraction)));
    } catch {
      unavailable('Không đọc được quota từ Hugging Face; thử lại sau');
    } finally { busy = false; quotaRefresh.disabled = false; }
  }
  quotaRefresh.addEventListener('click', () => void refreshQuota(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshQuota(); });
  window.addEventListener('vinfqa:inference-finished', () => {
    lastRequest = 0;
    setTimeout(() => void refreshQuota(true), 1200);
  });
  void refreshQuota(true);
  setInterval(() => { if (!document.hidden) void refreshQuota(); }, interval);
}

// CÔNG KHAI: chỉ điền Worker API URL và Turnstile SITE key, KHÔNG bao giờ đặt HF token tại đây.
window.VINFQA_PUBLIC_CONFIG = Object.freeze({
  API_BASE_URL: "https://vinfqa-public-gateway.ptlocnguyen.workers.dev", // Ví dụ: https://vinfqa-gateway.YOUR-SUBDOMAIN.workers.dev
  TURNSTILE_SITE_KEY: "0x4AAAAAAGLssT8z9hsJeQzT", // Public site key, đăng ký cho tên miền GitHub Pages
  SUPABASE_URL: "https://szgktielbhaiwknapffq.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SiwFZH9lhIih4Yw42XPMcA_kyZx1Alf", // Public key; không đặt secret/service_role key ở frontend
  // Chỉ hiện bộ chọn. 64/128 vẫn bị khóa cho tới khi /health quảng bá capability tương ứng.
  EXTENDED_DEMO_UI_ENABLED: true,
});

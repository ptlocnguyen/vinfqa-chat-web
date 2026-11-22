// CÔNG KHAI: chỉ điền Worker API URL và Turnstile SITE key, KHÔNG bao giờ đặt HF token tại đây.
window.VINFQA_PUBLIC_CONFIG = Object.freeze({
  API_BASE_URL: "https://vinfqa-public-gateway.ptlocnguyen.workers.dev", // Ví dụ: https://vinfqa-gateway.YOUR-SUBDOMAIN.workers.dev
  TURNSTILE_SITE_KEY: "0x4AAAAAAGLssT8z9hsJeQzT", // Public site key, đăng ký cho tên miền GitHub Pages
  SUPABASE_URL: "", // Ví dụ: https://YOUR_PROJECT_REF.supabase.co
  SUPABASE_PUBLISHABLE_KEY: "", // Chỉ dùng sb_publishable_...; không đặt secret/service_role key ở frontend
});

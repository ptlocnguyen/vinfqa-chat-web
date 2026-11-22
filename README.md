# VietInfographicQA Chat — GitHub Pages

Frontend công khai cho demo S3-QLoRA SSRC v04. Dự án dùng HTML/CSS/JavaScript thuần, không có build step, package npm, checkpoint hoặc Hugging Face token.

## Cấu trúc

- `index.html`: giao diện, thông báo dữ liệu, Turnstile và Content Security Policy.
- `login.html`, `register.html`, `reset-password.html`: Supabase Auth email/password, khôi phục mật khẩu và validation phía trình duyệt.
- `config.js`: chỉ chứa Worker URL, Turnstile site key, Supabase URL và publishable key công khai.
- `assets/app.js`: chat trong bộ nhớ tab, đồng bộ lịch sử khi đăng nhập, kiểm ảnh, `/health`, Turnstile và `/infer`.
- `assets/auth.js`, `assets/supabase-auth.js`, `assets/auth.css`: giao diện tài khoản, session/refresh token và kết nối Supabase Auth.
- `assets/quota.js`: đọc quota tài khoản demo qua `/quota` mỗi 120 giây.
- `assets/styles.css`: responsive, dark/light theme và trạng thái quota.

## Trạng thái source hiện tại

`config.js` đang trỏ tới `https://vinfqa-public-gateway.ptlocnguyen.workers.dev` và có Turnstile site key cho `ptlocnguyen.github.io`. Đây không phải bằng chứng rằng bản GitHub Pages hoặc Worker đang chạy đúng version mới nhất; cần kiểm tra sau khi deploy.

Luồng inference: trình duyệt gửi ảnh, câu hỏi, token Turnstile và JWT tùy chọn tới Cloudflare Worker. Worker xác minh và chuyển request tới private Hugging Face Space. Khi người dùng đăng nhập, Worker lưu câu hỏi, câu trả lời và provenance vào Supabase sau inference thành công. Ảnh chỉ được lưu vào bucket private khi người dùng chủ động bật “Lưu ảnh”; mặc định ảnh không được lưu. Lịch sử chat không được gửi làm prompt; ảnh vẫn đi qua Cloudflare/Hugging Face và có thể được Space lưu tạm. Không tải dữ liệu cá nhân hoặc nhạy cảm.

Tài khoản chỉ hoạt động khi `SUPABASE_URL` và `SUPABASE_PUBLISHABLE_KEY` được cấu hình ở cả frontend và Worker. Mặc định session nằm trong `sessionStorage`; tùy chọn “Ghi nhớ thiết bị này” dùng `localStorage`. Mật khẩu được gửi thẳng tới Supabase Auth qua HTTPS, không đi qua Worker hoặc Hugging Face. Supabase RLS giới hạn lịch sử và ảnh riêng tư theo `auth.uid()`.

## Chạy kiểm tra tĩnh cục bộ

Không mở file trực tiếp bằng `file://` vì ES module/CSP có thể hoạt động khác HTTP. Có thể phục vụ thư mục bằng static server bất kỳ, sau đó kiểm tra desktop/mobile. Khi chạy trên localhost, hostname Turnstile và CORS production sẽ không hợp lệ nếu chưa có cấu hình dev riêng; không hạ kiểm tra production chỉ để test local.

Kiểm tra cú pháp không gọi network hoặc inference:

```powershell
node --check .\assets\app.js
node --check .\assets\quota.js
node --check .\assets\auth.js
node --check .\assets\supabase-auth.js
node --check .\assets\reset-password.js
```

## Deploy GitHub Pages

1. Review diff và xác nhận `config.js` chỉ có giá trị công khai.
2. Nếu đổi Worker URL, cập nhật cả `API_BASE_URL` và directive `connect-src` trong CSP ở `index.html`.
3. Push commit đã duyệt lên branch dùng cho Pages; không đưa Secrets vào repository.
4. Trong GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.
5. Sau khi Pages hoàn tất, hard refresh và kiểm tra `/health`, Turnstile, quota, responsive và một smoke inference duy nhất nếu chấp nhận dùng ZeroGPU.

## Giới hạn khoa học và vận hành

- Mỗi câu hỏi là một inference độc lập với ảnh hiện tại.
- UI giới hạn ảnh 8 MiB, 12 megapixel và câu hỏi 1.000 ký tự; gateway kiểm lại phía server.
- Client dừng chờ sau 4 phút; gateway có các timeout upstream riêng và lease tối đa 300 giây.
- Output model được giới hạn 32 token và có thể bị cắt.
- Thanh ZeroGPU hiển thị quota của tài khoản demo, không phải hạn mức riêng của từng khách truy cập.

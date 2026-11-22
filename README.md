# VietInfographicQA Chat — GitHub Pages

Frontend công khai cho demo S3-QLoRA SSRC v04. Dự án dùng HTML/CSS/JavaScript thuần, không có build step, package npm, checkpoint hoặc Hugging Face token.

## Cấu trúc

- `index.html`: giao diện, thông báo dữ liệu, Turnstile và Content Security Policy.
- `login.html`, `register.html`: giao diện tài khoản và validation phía trình duyệt; chưa gửi dữ liệu vì gateway chưa có API xác thực.
- `config.js`: chỉ chứa Worker URL và Turnstile site key công khai.
- `assets/app.js`: chat trong bộ nhớ tab, kiểm ảnh, `/health`, Turnstile và `/infer`.
- `assets/auth.js`, `assets/auth.css`: hành vi và giao diện dùng chung cho đăng nhập/đăng ký.
- `assets/quota.js`: đọc quota tài khoản demo qua `/quota` mỗi 120 giây.
- `assets/styles.css`: responsive, dark/light theme và trạng thái quota.

## Trạng thái source hiện tại

`config.js` đang trỏ tới `https://vinfqa-public-gateway.ptlocnguyen.workers.dev` và có Turnstile site key cho `ptlocnguyen.github.io`. Đây không phải bằng chứng rằng bản GitHub Pages hoặc Worker đang chạy đúng version mới nhất; cần kiểm tra sau khi deploy.

Luồng inference: trình duyệt gửi ảnh, câu hỏi và token Turnstile tới Cloudflare Worker. Worker xác minh và chuyển request tới private Hugging Face Space. Lịch sử chat không được gửi làm prompt; ảnh và câu hỏi vẫn đi qua Cloudflare/Hugging Face và có thể được Space lưu tạm. Không tải dữ liệu cá nhân hoặc nhạy cảm.

Trang đăng nhập/đăng ký hiện là lớp giao diện chuẩn bị, không phải hệ thống xác thực hoàn chỉnh. Form chỉ kiểm tra dữ liệu trong trình duyệt rồi thông báo backend chưa sẵn sàng; không dùng `localStorage`, cookie hay request mạng để giả lập phiên đăng nhập. Muốn bật tài khoản thật cần thiết kế API, kho người dùng, password hashing hoặc OAuth, session và chính sách bảo vệ endpoint ở gateway.

## Chạy kiểm tra tĩnh cục bộ

Không mở file trực tiếp bằng `file://` vì ES module/CSP có thể hoạt động khác HTTP. Có thể phục vụ thư mục bằng static server bất kỳ, sau đó kiểm tra desktop/mobile. Khi chạy trên localhost, hostname Turnstile và CORS production sẽ không hợp lệ nếu chưa có cấu hình dev riêng; không hạ kiểm tra production chỉ để test local.

Kiểm tra cú pháp không gọi network hoặc inference:

```powershell
node --check .\assets\app.js
node --check .\assets\quota.js
node --check .\assets\auth.js
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

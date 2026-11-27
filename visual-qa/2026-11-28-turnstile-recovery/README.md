# Turnstile recovery & sidebar — local mock, 28/11/2026

Baseline production trước sửa: frontend `89f3a44be091dca39c27a3f4a55a5be5ee34c545`. Các screenshot trong thư mục này do Chromium chụp tại localhost; Turnstile, Gateway và inference đều là mock. Mã `110200` trong ảnh lỗi là dữ liệu kiểm thử chủ động đưa vào callback, không phải lỗi thực tế từ Cloudflare.

Ảnh gồm loading, error/retry, verified trên desktop và mobile, cùng sidebar thu gọn có nhiều phiên. Chúng kiểm tra bố cục và trạng thái giao diện, không chứng minh CAPTCHA thật đã cấp token hoặc Siteverify thành công.

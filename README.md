# VietInfographicQA Chat — GitHub Pages

Giao diện chat công khai cho demo **S3-QLoRA SSRC v04**. Mã frontend là HTML/CSS/JavaScript thuần, không chứa checkpoint hoặc token Hugging Face.

## Trạng thái triển khai

- **Frontend:** đã upload lên branch `main`; cần bật GitHub Pages trong **Settings → Pages → Deploy from a branch → main / (root)**.
- **AI inference:** **chưa bật**. `config.js` cố ý để trống `API_BASE_URL` và `TURNSTILE_SITE_KEY`. Website chỉ hoạt động ở chế độ xem trước cho đến khi Cloudflare Worker + Turnstile được cấu hình và kiểm thử.
- **Backend:** Space riêng tư `ptlocnguyen/s3-qlora-v04-demo` được giữ nguyên, không có trọng số trong repo này.

Website dự kiến: https://ptlocnguyen.github.io/vinfqa-chat-web/

## Kết nối inference (giai đoạn sau)

1. Tạo Cloudflare Worker, Turnstile và secret đọc private Space **riêng**; không đưa token vào repo.
2. Xác nhận endpoint Gradio thực tế của Space, quyền truy cập, kiểm tra giới hạn lượt/ngày và kiểm tra chống lạm dụng.
3. Sau khi gateway PASS, chỉ cấu hình hai giá trị **công khai** trong `config.js`: Worker URL và Turnstile site key. Không đặt Hugging Face token hay Turnstile secret trong frontend.
4. Kiểm thử bốn đường suy luận trước khi bật chế độ công khai.

**Giới hạn khoa học:** Mỗi tin nhắn là một lần suy luận độc lập với ảnh đã đính kèm. UI hiển thị lịch sử nhưng không gửi lịch sử hội thoại vào prompt. Giữ nguyên `max_new_tokens=32` và cảnh báo cắt đầu ra của S3 v04.

# Visual QA — 28/11/2026

`baseline-home-local.jpg` là ảnh giao diện baseline `2428d504` chạy tại localhost trước sửa đổi. Tất cả tệp `after-*` là ảnh chụp trình duyệt Chromium tại localhost sau sửa đổi. Các tên có `local-mock` hoặc `mock` sử dụng phản hồi Gateway và Turnstile giả lập bằng browser interception; chúng không chứng minh inference, quota hoặc xác minh Turnstile production.

Ảnh sau sửa đổi bao gồm màn hình 1920, 1366, 1024, 768, 390 và 320 px; dark/light; đăng nhập/đăng ký; menu model, ảnh đính kèm và quota; Turnstile chưa xác minh và đã xác minh bằng mock; bốn ảnh M7, ảnh trùng tên, gallery, image viewer và câu trả lời giả lập. Browser interaction test có thể chạy bằng `npm run test:browser` trên máy có Chrome.

`after-34-messages-local-mock.png` ghi lại hội thoại M7 dài 34 thông điệp với câu trả lời dài giả lập. Browser test cũng kiểm tra lỗi HTTP 429 giả lập và bố cục 320 px.

Không có ảnh chụp production trong bộ này. Không có lượt suy luận GPU nào được thực hiện để tạo ảnh.

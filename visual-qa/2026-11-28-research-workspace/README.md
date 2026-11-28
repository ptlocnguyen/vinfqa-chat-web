# Research Workspace · visual QA

Các PNG trong thư mục này là ảnh chụp **local browser với Gateway và Turnstile mock**. Chúng không chứng minh Turnstile Siteverify hoặc inference production. Browser test không gửi request tới GPU.

- `research-empty-desktop-local-mock.png`: trang mới, chưa chọn ảnh.
- `research-compare-desktop-local-mock.png`: SSRC v04 32 và Extended 4B 64/128 cùng ảnh.
- `research-results-desktop-local-mock.png`: kết quả mock đặt cạnh nhau.
- `research-four-images-desktop-local-mock.png`: bốn ảnh M7 theo thứ tự.
- `research-four-images-light-local-mock.png`: giao diện sáng.
- `research-four-images-768-local-mock.png`, `research-four-images-390-local-mock.png`, `research-four-images-320-local-mock.png`: tablet và mobile.
- `research-error-desktop-local-mock.png`: lỗi quota giả lập, không retry.
- `research-uploaded-two-images-local-mock.png`: hai file người dùng nạp và đổi thứ tự trên mobile 320 px.
- `chat-session-management-desktop-local-mock.png`, `chat-sidebar-collapsed-research-link-local-mock.png`: tìm kiếm, ghim/đổi tên/xóa và điều hướng Research trong Chat.

Chạy lại browser test: `node test/browser-research.mjs`. Để tạo lại screenshot trong PowerShell: đặt `$env:VISUAL_QA_DIR` thành đường dẫn thư mục này, rồi chạy test; xóa biến môi trường sau khi xong. Test thông thường không ghi đè ảnh đã lưu.

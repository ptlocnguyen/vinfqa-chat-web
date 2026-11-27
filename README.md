# VietInfographicQA Multi-model Chat — GitHub Pages

Frontend HTML/CSS/JavaScript thuần cho SSRC v04, Extended 4B và M7 7B multi-image. M7 chỉ xuất hiện khi capability đã được Gateway xác minh; source frontend không chứa checkpoint hoặc Hugging Face token.

## Cấu trúc

- `index.html`: giao diện, thông báo dữ liệu, Turnstile và Content Security Policy.
- `login.html`, `register.html`, `reset-password.html`: Supabase Auth email/password, khôi phục mật khẩu và validation phía trình duyệt.
- `config.js`: chỉ chứa Worker URL, Turnstile site key, Supabase URL và publishable key công khai.
- `assets/app.js`: chat theo model capability, khóa 1 ảnh cho S3 hoặc 2–4 ảnh có thứ tự cho M7, đồng bộ lịch sử, Turnstile và `/infer`/`/infer-multi`.
- `assets/model-registry.mjs`: ánh xạ registry từ `/health` thành các lựa chọn UI; model bị tắt không thể được chọn.
- `assets/inference-mode.mjs`: chuẩn hóa capability 32/64/128, identity model và trình bày provenance theo mode/cap/output thực tế.
- `assets/conversation-export.mjs`: xuất JSON/Markdown cục bộ theo allowlist metadata; không kèm bytes ảnh hoặc credential.
- `assets/samples/`: bốn infographic tổng hợp dùng làm ảnh mẫu tùy chọn; nạp ảnh không tự gửi câu hỏi.
- `assets/auth.js`, `assets/supabase-auth.js`, `assets/auth.css`: giao diện tài khoản, session/refresh token và kết nối Supabase Auth.
- `assets/quota.js`: đọc quota tài khoản demo qua `/quota` mỗi 120 giây.
- `assets/styles.css`: responsive, dark/light theme và trạng thái quota.

## Trạng thái production — 2026-11-25

Production đang chạy frontend commit `6472c2052a73f58557b35c42a25d9b9d0a1680fc` trên `https://ptlocnguyen.github.io/vinfqa-chat-web/`; GitHub Pages workflow run `45545761595` đã hoàn tất thành công. Gateway Worker production version là `bb8379fc-efe2-49ce-93f9-8bd4dee615ec`, được triển khai từ Gateway commit `7c2d41ca0e50b4877c4f0233fc2d357c944b1a29`. Extended/M7 Hugging Face Space revision là `5f62891ce2ee42a36c18739554e0c56a380cd5ae`. Các giá trị này ghi nhận bản phát hành đã xác minh; không thay bằng HEAD mới hơn khi cần khôi phục.

Luồng inference: trình duyệt gửi ảnh, câu hỏi, token Turnstile và JWT tùy chọn tới Cloudflare Worker. Worker xác minh và chuyển request tới private Hugging Face Space. Khi người dùng đăng nhập, Worker lưu câu hỏi, câu trả lời và provenance vào Supabase sau inference thành công. Ảnh chỉ được lưu vào bucket private khi người dùng chủ động bật “Lưu ảnh”; mặc định ảnh không được lưu. Lịch sử chat không được gửi làm prompt; ảnh vẫn đi qua Cloudflare/Hugging Face và có thể được Space lưu tạm. Không tải dữ liệu cá nhân hoặc nhạy cảm.

Trong một tab, người dùng chọn hoặc kéo-thả bộ ảnh một lần khi bắt đầu cuộc trò chuyện; các câu tiếp theo tự dùng lại đúng bộ ảnh và thứ tự đó. Ảnh bị khóa sau câu hỏi đầu tiên. M7 hiện chỉ lưu lịch sử trong tab, chưa đồng bộ hội thoại hoặc ảnh nhiều ảnh lên Supabase. Migration Supabase nhiều ảnh chưa được áp dụng; lịch sử S3 một ảnh giữ hành vi cũ.

Bộ chọn độ dài mặc định 32 tokens. 32 đi tới SSRC v04; 64/128 đi tới Extended Demo; frontend không tự fallback Extended sang v04. M7 nhận 2–4 ảnh theo thứ tự và dùng cố định 96 tokens.

Tài khoản chỉ hoạt động khi `SUPABASE_URL` và `SUPABASE_PUBLISHABLE_KEY` được cấu hình ở cả frontend và Worker. Mặc định session nằm trong `sessionStorage`; tùy chọn “Ghi nhớ thiết bị này” dùng `localStorage`. Mật khẩu được gửi thẳng tới Supabase Auth qua HTTPS, không đi qua Worker hoặc Hugging Face. Supabase RLS giới hạn lịch sử và ảnh riêng tư theo `auth.uid()`.

## Chạy kiểm tra tĩnh cục bộ

Không mở file trực tiếp bằng `file://` vì ES module/CSP có thể hoạt động khác HTTP. Có thể phục vụ thư mục bằng static server bất kỳ, sau đó kiểm tra desktop/mobile. Khi chạy trên localhost, hostname Turnstile và CORS production sẽ không hợp lệ nếu chưa có cấu hình dev riêng; không hạ kiểm tra production chỉ để test local.

Kiểm tra cú pháp không gọi network hoặc inference:

```powershell
node --check .\assets\app.js
node --test .\test\*.test.mjs
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
- Output SSRC v04 được giới hạn 32 token; Extended hỗ trợ 32/64/128; M7 cố định 96 token. Có thể gặp output chạm giới hạn.
- Thanh ZeroGPU hiển thị quota của tài khoản demo, không phải hạn mức riêng của từng khách truy cập.

## Ghi nhận phát hành PRODUCTION_RELEASED

- Luồng 32 tokens → Space SSRC v04 bất biến, API `generate` với hợp đồng `[image, question]`.
- Luồng 64/128 → Space Extended, API `generate` với `[image, question, max_new_tokens]`.
- Luồng M7 → cùng Space Extended, API `generate_multi`, 2–4 ảnh có thứ tự, model `Qwen/Qwen2.5-VL-7B-Instruct` revision `cc594898137f460bfe9f0759e9844b3ce807cfb5` và adapter NB136.
- Artifact M7: private repo revision `a3c1de52625fb5ce6d810c8bccfecef6bb55c013`; adapter SHA-256 `78065f44555a6fbee907400c61fe6e6121ac31f70b5dc4468964634b103eb131`.
- Ba production smoke test dùng ảnh tổng hợp nguyên gốc đều PASS: Extended@64 trả `20` (3/64 tokens); M7 hai ảnh trả `30` (3/96); M7 bốn ảnh trả `41` (3/96). Thời gian giao diện lần lượt khoảng 1,633; 1,267; 1,515 giây theo định dạng thập phân `vi-VN`. Quota HF ghi nhận giảm 291→279 giây trong chiến dịch.
- Đây là kiểm tra routing/inference trên ví dụ tổng hợp, không phải đánh giá benchmark hay bằng chứng tăng chất lượng VQA. UI hiển thị model và số token; JSON provenance chi tiết vẫn thu gọn trong ảnh kiểm thử nên các trường ẩn chưa được đối chiếu độc lập. VRAM/RAM thực tế không được đo.
- Không bật dịch vụ GPU trả phí hoặc đổi billing. Đây là mức dùng ZeroGPU miễn phí trong quota được cấp; không bảo đảm quota luôn sẵn có hoặc không bị thay đổi theo chính sách Hugging Face. Quota tài khoản chia sẻ còn 279/300 giây ở lần đọc sau smoke tests (reset dự kiến `2026-11-25T17:38:49Z`). Gateway production từ 2026-11-25 đã bỏ giới hạn inference/ngày do ứng dụng đặt trên toàn hệ thống và theo IP. Durable Object vẫn cho một inference đồng thời; Turnstile, upload limits, timeout và quota ZeroGPU Hugging Face vẫn áp dụng. Không tự động retry lỗi hết quota.

## Rollback

1. Tắt M7 trước bằng cách đặt `M7_DEMO_ENABLED=false` cho Worker production; xác nhận `/health` báo M7 disabled và 32/64/128 vẫn bật. Trong `wrangler.jsonc`, M7 hiện mặc định `false`; production đã được bật bằng override triển khai.
2. Nếu cần khôi phục toàn bộ Worker về trạng thái trước khi bật M7, dùng Cloudflare version `a6f3341f-334c-481a-8173-75eefc12e8e4`; sau rollback kiểm tra Extended vẫn bật và M7 đã tắt. Bản bỏ quota lượt/ngày được phát hành ở Worker version `0edd4b71-e6ff-42a9-9ff2-df566d9f51db`; tránh rollback về bản cũ nếu cần giữ chính sách này.
3. Mốc frontend trước lần hoàn thiện UI ngày 2026-11-27 là GitHub Pages workflow run `45545761595`, commit `6472c2052a73f58557b35c42a25d9b9d0a1680fc`. Có thể revert commit UI mới trên `main` rồi chờ Pages workflow hoàn tất.
4. Không rollback hay chỉnh Space SSRC v04. Chỉ rollback Space Extended nếu lỗi thuộc backend; revision trước multi-model là `ff784e9cd72c032e42c8dbf2bd231139e65c09c2`. Worker rollback không tự hoàn tác quota, Durable Object state hoặc Secrets.

## Bổ sung model/checkpoint hoặc pipeline mới

Tạo checkpoint trong private artifact repository riêng, cố định immutable revision và SHA-256 manifest, rồi xác minh quyền đọc bằng token read-only riêng. Đăng ký model ID/API contract và provenance riêng; thêm load/public gate độc lập để có thể nạp kiểm tra kín trước khi công bố. Kiểm tra tương thích prompt/preprocessing, RAM/VRAM, thời gian khởi động, concurrency chung và quota trước khi phát hành. Bổ sung mock tests cho routing, validation, timeout, provenance và rollback; chỉ chạy số lượt GPU tối thiểu đã được duyệt. Không ghi đè checkpoint cũ; không áp dụng migration Supabase cho đến khi được phê duyệt riêng.

## Hoàn thiện giao diện và bằng chứng — 2026-11-27

- Giao diện phân biệt SSRC v04, Extended 4B và M7 7B. M7 không nhận nhãn branch S3 khi provenance không có branch/route.
- Chỉ trình bày provenance VERIFIED khi backend gửi `verification_status=VERIFIED`, cap đúng với mode và output token count không vượt cap. Metadata thiếu hoặc không hợp lệ hiển thị `NOT_VERIFIED`; cap M7 không bị mặc định về 32.
- Model ID lạ không tự chuyển sang v04. Trước lượt hỏi đầu, có thể thay ảnh single-image mà không bị tính nhầm vào giới hạn ảnh.
- Gợi ý câu hỏi theo model. Nút “Ảnh mẫu” nạp một ảnh giả lập cho S3/Extended hoặc bốn ảnh giả lập đúng thứ tự cho M7; không tự gửi yêu cầu.
- Copy answer/provenance và tải JSON/Markdown chạy phía trình duyệt. Export chứa văn bản, thứ tự/kích thước ảnh và provenance allowlist; không kèm tên file hay bytes ảnh. Một số mẫu credential phổ biến được che khỏi văn bản; hãy rà soát nội dung trước khi chia sẻ. JWT, Turnstile token và Secret không được lấy từ storage hoặc state ứng dụng. M7 chỉ lưu hội thoại trong tab.
- Kiểm tra local: 13 unit tests PASS, cú pháp JavaScript PASS, tương tác mock browser cho chọn M7, gợi ý M7, nạp 4 ảnh và nạp/thay 1 ảnh PASS. Không gọi inference hoặc GPU. Turnstile thật chưa thể kiểm chứng localhost; CORS production chặn localhost.
- Các smoke test production trước đây được ghi riêng ở trên và không chạy lại cho thay đổi giao diện. Smoke test xác nhận luồng chức năng trên mẫu tổng hợp, không chứng minh độ chính xác hoặc chất lượng mô hình.

## UX/UI progressive disclosure (2026-11)

The production chat interface is being refreshed on feature branch `feat/ux-progressive-disclosure-20261127`. It groups model and token selection, quota details, system status, account/theme actions, attachment actions, help and response exports into compact native disclosure menus while preserving the existing inference, authentication, Turnstile, history, image, provenance and export code paths. The sidebar supports desktop collapse and mobile drawer behavior; image galleries can be collapsed and reopened.

Local browser preview was checked at 1920×1080, 390×844 and 320×700. The 320 px mobile viewport had no document-level horizontal overflow. Local preview cannot verify production CORS, Turnstile Siteverify or backend requests; do not treat those expected localhost restrictions as production failures. The production deployment revision is recorded in the GitHub Pages workflow after release.

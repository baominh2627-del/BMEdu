# 🚀 BỘ PROMPT CHUYỂN ĐỔI TOÀN BỘ HỆ THỐNG WEB TỪ `MTS` SANG `BM / BMEdu`

Tài liệu này lưu lại **Prompt chuẩn hóa A–Z** để bạn tái sử dụng bất cứ lúc nào cần chuyển đổi, đồng bộ hoặc nhân bản hệ thống web/đề thi từ thương hiệu cũ (`MTS` / `MTSedu`) sang thương hiệu mới (`BM` / `BMEdu` / `BM Education`) mà **không mất bất kỳ dữ liệu, tính năng, lịch sử Git hay liên kết Database nào**.

---

## 📌 PROMPT 1: CHUYỂN TOÀN BỘ WEB CHÍNH `MTSedu` SANG `BMEdu` & ĐẨY LÊN GITHUB

> Copy nguyên khối bên dưới gửi cho AI Agent (Antigravity / Cursor / Claude Code):

```text
Hãy thực hiện chuyển đổi toàn bộ dự án web từ thư mục nguồn `MTSedu` sang thư mục đích `BMEdu` và tạo repository mới `BMEdu` trên GitHub từ A đến Z theo đúng các yêu cầu bắt buộc sau:

1. SAO CHÉP MÃ NGUỒN & GIỮ NGUYÊN 100% LỊCH SỬ:
   - Sao chép toàn bộ mã nguồn, giao diện (React + Vite + Tailwind CSS), tài nguyên tĩnh (`public/`), công cụ (`tools/`), tài liệu hướng dẫn (`_Database/`, `_TaiLieu_HuongDan/`, `_Tao_Taikhoan/`, `_TomTat_Code/`), biến môi trường `.env` (chỉ lưu local, nằm trong `.gitignore`) và toàn bộ lịch sử commit Git (`.git/`) từ `MTSedu` sang `BMEdu`.
   - Giữ nguyên 100% mọi logic xử lý hiện có: đăng nhập/xác thực SHA-256, lịch sử làm bài học sinh, theo dõi thời gian học trên web & xem video, khóa học video (YouTube/Google Drive/Local), thả cảm xúc, bình luận, ảnh đại diện, trang cá nhân và toàn bộ bảng Quản trị Admin.

2. ĐỔI TOÀN BỘ NHẬN DIỆN TỪ "MTS" SANG "BM / BMEdu":
   - Quét toàn bộ tên file, giao diện, tiêu đề, thẻ SEO/OpenGraph/JSON-LD, class CSS, localStorage key, custom event, comment và tài liệu hướng dẫn; đổi tất cả những gì liên quan đến `MTS` / `MTSedu` thành `BM` / `BMEdu` / `BM Education`:
     + Tên package (`package.json`, `package-lock.json`): `bmedu`
     + Đường dẫn base cho GitHub Pages (`vite.config.js`, `.github/workflows/deploy.yml`): `/BMEdu/`
     + Đổi tên file: `3_Ma_QR_Trang_Chu_MTSedu.html` -> `3_Ma_QR_Trang_Chu_BMEdu.html`, `logo_MTS.svg` -> `logo_BM.svg`, `mtsedu-auth.js` -> `bmedu-auth.js`
     + Đổi CSS & key nội bộ: `.mts-bg` -> `.bm-bg`, `mtsedu_avatar_*` -> `bmedu_avatar_*`, `mts_avatar_changed` -> `bm_avatar_changed`, `mts_video_note_*` -> `bm_video_note_*`, `mts-chapter-suggestions` -> `bm-chapter-suggestions`, nhãn Admin `Realtime Database MTS` -> `Realtime Database BM`.
     + Cập nhật bộ khuôn mẫu đề thi trong `_TaiLieu_HuongDan/` sang chuẩn `bmedu-auth.js`, `bmedu_session`, `bmedu_user`, `BMEDU_EXAM_*`.

3. GIỮ NGUYÊN TUYỆT ĐỐI DATABASE CŨ & TƯƠNG THÍCH ĐỀ THI:
   - TUYỆT ĐỐI KHÔNG đổi cấu hình kết nối Firebase Realtime Database hiện hành (`projectId: "mtsedu-85ea3"`, `databaseURL: "https://mtsedu-85ea3-default-rtdb.asia-southeast1.firebasedatabase.app"`, `authDomain`, `storageBucket`, `apiKey`, `appId`) và Supabase URL/Key hiện có. Web `BMEdu` mới phải đọc/ghi trực tiếp trên cùng Database cũ (giữ nguyên toàn bộ tài khoản `users`, điểm thi `testResults`, bài giảng `videos`, khóa học `courses`, tiến độ `videoProgress`, thời gian học `activity`/`videoWatch`, bình luận `videoComments` và góp ý `feedbacks`).
   - Khi mở iframe đề thi (`SubjectPage.jsx`, `CoursePlayerView.jsx`, `ExamFullscreenOverlay.jsx`), truyền tham số chuẩn mới (`bmedu_user`, `bmedu_name`, `bmedu_id`, `bmedu_return`) ĐỒNG THỜI kèm tham số tương thích ngược (`mtsedu_*` và lắng nghe cả `BMEDU_EXAM_*` lẫn `MTSEDU_EXAM_*`) để toàn bộ các repo đề thi đã xuất bản trước đó vẫn đăng nhập và nộp điểm trơn tru.

4. KIỂM TRA BUILD & TẠO REPO GITHUB `BMEdu`:
   - Chạy `npm install` và `npm run build` (với `VITE_BASE=/BMEdu/`) để đảm bảo không có bất kỳ lỗi biên dịch nào và bundle vẫn kết nối đúng Firebase Database cũ.
   - Tạo repository mới tên `BMEdu` trên GitHub, đổi `origin` của thư mục `BMEdu` sang `https://github.com/<username>/BMEdu.git` (không ghi đè lên repo `MTSedu` cũ), commit toàn bộ thay đổi và push nhánh `main` (giữ trọn lịch sử commit) lên GitHub, kích hoạt GitHub Actions deploy lên GitHub Pages.
```

---

## 📌 PROMPT 2 (TÙY CHỌN): ĐỔI THƯƠNG HIỆU `MTS` SANG `BM` TRÊN TOÀN BỘ CÁC REPO ĐỀ THI CON

> Dùng khi bạn muốn cập nhật luôn dòng chữ đăng nhập & nút quay về trang chủ trên 14 repo đề thi độc lập (`02_Bo_De_Thi_HSA_VNES` và `03_De_Kiem_Tra_Vat_Ly_Toan`):

```text
Hãy duyệt qua toàn bộ các thư mục đề thi trong `02_Bo_De_Thi_HSA_VNES` và `03_De_Kiem_Tra_Vat_Ly_Toan`:
1. Cập nhật file xác thực (`mtsedu-auth.js` / `bmedu-auth.js`) và giao diện trong từng đề để:
   - Đổi toàn bộ chữ hiển thị từ `MTS Education` / `MTSedu` sang `BM Education` / `BMEdu`.
   - Đổi link trang chủ mặc định sang web `BMEdu` mới (`https://bmedu.vercel.app` hoặc `https://baominh2627-del.github.io/BMEdu/`).
   - Chấp nhận cả URL params mới (`bmedu_user`, `bmedu_name`, `bmedu_id`, `bmedu_return`) và cũ (`mtsedu_*`).
2. TUYỆT ĐỐI GIỮ NGUYÊN `firebase-config.js` (`mtsedu-85ea3-default-rtdb`) và mã đề `MA_DE` để toàn bộ lịch sử điểm thi cũ và mới vẫn nằm chung một Database.
3. Commit và push cập nhật lên từng repo GitHub tương ứng.
```

---

## ✅ BẢNG TÓM TẮT NGUYÊN TẮC AN TOÀN

| Thành phần | Giá trị sau chuyển đổi | Ghi chú |
| :--- | :--- | :--- |
| **Tên dự án & Giao diện** | `BM Education` (`BMEdu`) | Toàn bộ Navbar, Login, Profile, Admin, SEO, QR Code |
| **Repository GitHub mới** | `https://github.com/baominh2627-del/BMEdu` | Độc lập với repo cũ, giữ nguyên toàn bộ lịch sử commit |
| **Link GitHub Pages** | `https://baominh2627-del.github.io/BMEdu/` | Tự động build & deploy qua GitHub Actions (`VITE_BASE=/BMEdu/`) |
| **Firebase Realtime DB** | `mtsedu-85ea3-default-rtdb` *(Giữ nguyên)* | Dùng chung 100% tài khoản, lịch sử điểm, video, tiến độ học |
| **Iframe Đề thi (SSO)** | `bmedu_*` + tương thích ngược `mtsedu_*` | Mọi đề thi cũ & mới đều nhận diện học sinh và lưu điểm bình thường |

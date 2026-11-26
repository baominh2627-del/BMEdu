# Tự động tải video Drive → Upload YouTube + Ảnh bìa → Cập nhật Web

Script [youtube-sync.mjs](./youtube-sync.mjs) dùng Node.js thuần (không cần `pip`/`npm install` thêm) để tự động hóa toàn bộ quy trình:

1. Tải video `.mp4` từ Google Drive (hoặc lấy file trên máy).
2. Tự dò thời lượng bài giảng bằng `ffprobe` và tự nén ảnh bìa dưới `2 MB` nếu cần.
3. Upload video lên kênh YouTube của bạn qua **YouTube Data API v3** + gắn ảnh bìa tùy chỉnh (`thumbnails.set`).
4. Tự động ghi thêm/cập nhật bài giảng vào `edtech-phase1/src/data/videosData.js` và lưu ảnh bìa tại `public/video-covers/`.

---

## Thiết lập OAuth 1 lần duy nhất (~2 phút)

1. Mở [Google Cloud Console](https://console.cloud.google.com/) và chọn hoặc tạo 1 project mới (ví dụ `bmedu-youtube-sync`).
2. Vào **APIs & Services → Library**, bật cả 2 API:
   - **YouTube Data API v3**
   - **Google Drive API**
3. Vào **Google Auth platform (hoặc OAuth consent screen)**:
   - Chọn **External** → **Create**.
   - Vào **Audience / Test users**, bấm **Add users** và thêm đúng email Google quản lý kênh YouTube (vd: `baominh2627@gmail.com`).
4. Vào **Clients / Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Desktop app** (Ứng dụng trên máy tính) → **Create**.
   - Bấm **Download JSON** và lưu file thành:
     ```
     .secrets/youtube_client_secrets.json
     ```
     *(Thư mục `.secrets/` đã nằm trong `.gitignore`, không bao giờ bị đẩy lên GitHub).*
5. Chạy xác thực 1 lần để trình duyệt mở trang cấp quyền Google:
   ```bash
   node tools/youtube-sync.mjs auth
   ```
   Sau khi đăng nhập và bấm Cho phép, token sẽ được lưu tại `.secrets/youtube_token.json` — các lần sau chạy hoàn toàn tự động.

> **Lưu ý về ảnh bìa trên YouTube:** Để YouTube API cho phép gắn ảnh bìa tùy chỉnh (`thumbnails.set`), kênh YouTube cần xác minh SĐT ở mức **Tính năng trung bình (Intermediate features)** tại `https://www.youtube.com/verify`. Nếu chưa xác minh, video vẫn lên YouTube bình thường và web vẫn hiển thị ảnh bìa riêng ở `public/video-covers/`.

---

## Chạy thử 1 video (`BUỔI 1/11: PHƯƠNG TRÌNH TRẠNG THÁI`)

```bash
node tools/youtube-sync.mjs run \
  --drive-id "1zjQCG4m1A6lhhU2hN8MPzuYBg4v-zuVc" \
  --cover "public/video-covers/lesson_buoi0111_phuong_trinh_trang_thai.jpg" \
  --id "phys12_n01_0111_pttt" \
  --title "BUỔI 1/11 - NHÓM LÝ 12 - 01: PHƯƠNG TRÌNH TRẠNG THÁI" \
  --course "Vật Lý 12 — Nhóm Lý 12 - 01" \
  --chapter "Chữa đề & Luyện tập" \
  --order 1 \
  --tags "Lý,Lớp 12" \
  --privacy "unlisted"
```

Sau khi chạy xong, build và cập nhật web:

```bash
npm run build
```

## Chạy hàng loạt nhiều video

Tạo file JSON mảng các object (ví dụ `.secrets/batch.json`) rồi chạy:

```bash
node tools/youtube-sync.mjs batch .secrets/batch.json
```

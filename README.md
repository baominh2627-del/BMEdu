# BM Education (BMEdu)

Nền tảng học tập, bài giảng video và ôn thi trực tuyến các môn Toán, Lý, Hóa, Tin, HSA, TSA, V-ACT và TNTHPT của **BM Education**.

## Công nghệ & Kiến trúc
- **Frontend:** React 19 + Vite 7 + Tailwind CSS v4
- **Database & Realtime Tracking:** Firebase Realtime Database (giữ nguyên liên kết CSDL hiện hành: `users`, `testResults`, `examLogs`, `activity`, `videoWatch`, `videos`, `courses`, `videoProgress`, `videoComments`, `videoReactions`, `feedbacks`)
- **Deploy:** GitHub Pages (`/BMEdu/`) & Vercel (`/`)

## Chạy trên máy local
```bash
npm install
npm run dev
```

## Build production
```bash
npm run build
```

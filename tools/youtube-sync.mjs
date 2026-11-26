#!/usr/bin/env node
/**
 * Tự động đồng bộ video bài giảng:
 *   Google Drive (hoặc file local) -> Upload lên YouTube + gắn ảnh bìa -> Cập nhật videosData.js
 *
 * Dùng Node.js >= 20 built-ins (không cần cài thêm package npm/pip).
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SECRETS_DIR = path.join(ROOT_DIR, '.secrets');
const TMP_VIDEOS_DIR = path.join(SECRETS_DIR, 'tmp_videos');
const DEFAULT_SECRETS_PATH = path.join(SECRETS_DIR, 'youtube_client_secrets.json');
const DEFAULT_TOKEN_PATH = path.join(SECRETS_DIR, 'youtube_token.json');
const COVERS_DIR = path.join(ROOT_DIR, 'public', 'video-covers');
const VIDEOS_DATA_PATH = path.join(ROOT_DIR, 'edtech-phase1', 'src', 'data', 'videosData.js');

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB (bội số của 256 KiB theo spec YouTube)
const MAX_THUMB_BYTES = 2 * 1024 * 1024; // Giới hạn thumbnail YouTube: 2 MB

function printUsage() {
  console.log(`
BMEdu YouTube Sync Tool

Cú pháp:
  node tools/youtube-sync.mjs auth [--secrets <path>]
      Xác thực OAuth 2.0 một lần với tài khoản Google / YouTube của bạn.

  node tools/youtube-sync.mjs run [options]
      Tải video từ Drive (hoặc lấy file local), upload lên YouTube, gắn ảnh bìa,
      và cập nhật bài giảng mới vào edtech-phase1/src/data/videosData.js.

  node tools/youtube-sync.mjs batch <manifest.json> [--dry-run]
      Chạy lần lượt nhiều video khai báo trong file JSON.

Tùy chọn cho "run":
  --drive-id <ID|URL>   ID hoặc link Google Drive của video .mp4
  --file <path>         Đường dẫn file video .mp4 trên máy (thay cho --drive-id)
  --cover <path>        Đường dẫn ảnh bìa (.jpg/.png), nên lưu trong public/video-covers/
  --id <slug>           Mã duy nhất trong videosData.js (vd: phys12_n01_0111_pttt)
  --title <text>        Tiêu đề video trên YouTube & web
  --course <text>       Tên khóa học trên web (vd: "Vật Lý 12 — Nhóm Lý 12 - 01")
  --chapter <text>      Tên chương/chủ đề
  --order <number>      Thứ tự bài trong chương (mặc định: 1)
  --tags <csv>          Nhãn lọc phân tách dấu phẩy (vd: "Lý,Lớp 12")
  --teacher <text>      Giảng viên (mặc định: "Bảo Minh")
  --description <text>  Mô tả hiển thị trên YouTube
  --privacy <mode>      unlisted | public | private (mặc định: unlisted)
  --secrets <path>      Đường dẫn client_secrets.json (mặc định: .secrets/youtube_client_secrets.json)
  --keep-temp           Giữ lại file video tải tạm thay vì xóa sau khi upload xong
  --no-web              Chỉ up lên YouTube, không sửa file videosData.js
  --dry-run             Kiểm tra file, ảnh bìa, thời lượng và bản ghi sẽ ghi vào web (không up lên YouTube)
`.trim());
}

/** Phân tích tham số CLI đơn giản dạng `--flag value` hoặc `--boolean-flag`. */
function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const opts = {};
  const positionals = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i += 1;
    }
  }
  return { command, opts, positionals };
}

function parseDriveId(input) {
  const s = String(input || '').trim();
  const match = s.match(/\/d\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/);
  if (match) return match[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}

function slugifyId(title) {
  return String(title || 'video')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || `video_${Date.now()}`;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveSecretsPath(explicitPath) {
  const candidates = [
    explicitPath ? path.resolve(explicitPath) : null,
    DEFAULT_SECRETS_PATH,
    path.join(ROOT_DIR, 'client_secrets.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(
    `Chưa tìm thấy file OAuth client secrets.\n` +
    `Hãy tải OAuth Desktop App JSON từ Google Cloud Console và lưu tại:\n  ${DEFAULT_SECRETS_PATH}\n` +
    `(Xem hướng dẫn chi tiết trong tools/README-youtube-sync.md)`,
  );
}

async function loadClientCredentials(secretsPath) {
  const raw = JSON.parse(await fs.readFile(secretsPath, 'utf8'));
  const block = raw.installed || raw.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new Error(`File ${secretsPath} không đúng định dạng OAuth Client JSON của Google (thiếu client_id / client_secret).`);
  }
  return {
    clientId: block.client_id,
    clientSecret: block.client_secret,
    tokenUri: block.token_uri || 'https://oauth2.googleapis.com/token',
    authUri: block.auth_uri || 'https://accounts.google.com/o/oauth2/v2/auth',
  };
}

function openExternalUrl(url) {
  if (process.platform === 'win32') {
    execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url.replace(/'/g, "''")}'`], () => {});
  } else if (process.platform === 'darwin') {
    execFile('open', [url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}

function base64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function exchangeOAuthCode({ creds, code, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  const res = await fetch(creds.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Đổi OAuth token thất bại (${res.status}): ${JSON.stringify(data)}`);
  }
  return {
    ...data,
    obtained_at: Date.now(),
  };
}

async function refreshAccessToken(creds, tokenData) {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: tokenData.refresh_token,
    grant_type: 'refresh_token',
  });
  const res = await fetch(creds.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const fresh = await res.json();
  if (!res.ok) {
    throw new Error(`Làm mới OAuth token thất bại (${res.status}): ${JSON.stringify(fresh)}`);
  }
  return {
    ...tokenData,
    ...fresh,
    refresh_token: fresh.refresh_token || tokenData.refresh_token,
    obtained_at: Date.now(),
  };
}

/** Xác thực OAuth loopback qua trình duyệt máy local và lưu token vào .secrets/youtube_token.json. */
async function performOAuthLoopback(creds, tokenPath = DEFAULT_TOKEN_PATH) {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = base64Url(crypto.randomBytes(16));

  const { authCode, redirectUri } = await new Promise((resolve, reject) => {
    let activeRedirectUri = '';
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404).end('Not found');
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        res.end(`<h3>Đăng nhập thất bại: ${err}</h3>`);
        server.close();
        server.closeAllConnections?.();
        reject(new Error(`Google OAuth trả về lỗi: ${err}`));
        return;
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
        res.end('<h3>Sai tham số bảo mật state.</h3>');
        return;
      }
      const code = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end('<div style="font-family:sans-serif;padding:24px"><h2>✅ Đã cấp quyền thành công!</h2><p>Bạn có thể đóng tab này và quay lại terminal.</p></div>');
      server.close();
      server.closeAllConnections?.();
      resolve({ authCode: code, redirectUri: activeRedirectUri });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      activeRedirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const authParams = new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: activeRedirectUri,
        response_type: 'code',
        scope: OAUTH_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      const authUrl = `${creds.authUri}?${authParams.toString()}`;
      console.log('\n[Auth] Đang mở trình duyệt để cấp quyền YouTube Upload & Google Drive...');
      console.log(`Nếu trình duyệt không tự mở, hãy mở link sau:\n${authUrl}\n`);
      openExternalUrl(authUrl);
    });
    server.on('error', reject);
  });

  const tokenData = await exchangeOAuthCode({ creds, code: authCode, redirectUri, codeVerifier });
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2), 'utf8');
  return tokenData;
}

async function getAccessToken({ secretsPath, tokenPath = DEFAULT_TOKEN_PATH, forceAuth = false }) {
  const resolvedSecrets = await resolveSecretsPath(secretsPath);
  const creds = await loadClientCredentials(resolvedSecrets);

  if (!forceAuth && (await fileExists(tokenPath))) {
    const tokenData = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
    const expiresAt = (tokenData.obtained_at || 0) + ((tokenData.expires_in || 3600) - 90) * 1000;
    if (tokenData.access_token && Date.now() < expiresAt) {
      return tokenData.access_token;
    }
    if (tokenData.refresh_token) {
      const updated = await refreshAccessToken(creds, tokenData);
      await fs.writeFile(tokenPath, JSON.stringify(updated, null, 2), 'utf8');
      return updated.access_token;
    }
  }

  const fresh = await performOAuthLoopback(creds, tokenPath);
  return fresh.access_token;
}

function hasCommand(cmd) {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Tải file từ Google Drive: ưu tiên gdrive CLI nếu sẵn sàng, ngược lại dùng Drive API v3 qua OAuth token. */
async function downloadDriveVideo(driveId, outPath, accessToken) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  if (hasCommand('gdrive')) {
    console.log(`[Drive] Đang tải file ${driveId} qua gdrive CLI -> ${path.relative(ROOT_DIR, outPath)}...`);
    await execFileAsync('gdrive', ['readonly', 'download', driveId, '--out', outPath]);
    return outPath;
  }

  if (!accessToken) {
    throw new Error('Không tìm thấy CLI gdrive trên PATH và chưa có OAuth token để tải từ Drive API.');
  }

  console.log(`[Drive] Đang tải file ${driveId} qua Google Drive API v3 -> ${path.relative(ROOT_DIR, outPath)}...`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Tải video từ Google Drive thất bại (${res.status}): ${errText}`);
  }

  const total = Number(res.headers.get('content-length') || 0);
  const fileHandle = await fs.open(outPath, 'w');
  let received = 0;
  let lastPct = -1;
  try {
    for await (const chunk of res.body) {
      await fileHandle.write(chunk);
      received += chunk.length;
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        if (pct >= lastPct + 10 || pct === 100) {
          lastPct = pct;
          console.log(`[Drive] ${pct}% (${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)`);
        }
      }
    }
  } finally {
    await fileHandle.close();
  }
  return outPath;
}

/** Dùng ffprobe đọc thời lượng thật của video định dạng M:SS hoặc H:MM:SS. */
async function probeVideoDuration(videoPath) {
  if (!hasCommand('ffprobe')) return '';
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    const sec = Math.round(Number.parseFloat(stdout.trim()));
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  } catch {
    return '';
  }
}

/** Đảm bảo ảnh bìa nằm trong public/video-covers/ (cho web) và <= 2 MB (cho YouTube). */
async function prepareCoverAssets(coverInput, lessonId) {
  if (!coverInput) return { webCoverPath: '', uploadThumbPath: '', thumbMime: '', cleanupThumb: false };

  const absInput = path.resolve(ROOT_DIR, coverInput);
  if (!(await fileExists(absInput))) {
    throw new Error(`Không tìm thấy file ảnh bìa: ${coverInput}`);
  }

  const ext = path.extname(absInput).toLowerCase() || '.jpg';
  await fs.mkdir(COVERS_DIR, { recursive: true });
  const inCoversDir = path.resolve(absInput).startsWith(path.resolve(COVERS_DIR) + path.sep);
  const publicDest = inCoversDir ? absInput : path.join(COVERS_DIR, `${lessonId}${ext}`);

  if (!inCoversDir) {
    await fs.copyFile(absInput, publicDest);
  }

  const relFromPublic = '/' + path.relative(path.join(ROOT_DIR, 'public'), publicDest).replace(/\\/g, '/');
  const stat = await fs.stat(publicDest);
  if (stat.size <= MAX_THUMB_BYTES) {
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { webCoverPath: relFromPublic, uploadThumbPath: publicDest, thumbMime: mime, cleanupThumb: false };
  }

  if (!hasCommand('ffmpeg')) {
    throw new Error(`Ảnh bìa lớn hơn 2 MB (${(stat.size / 1048576).toFixed(2)} MB) và thiếu ffmpeg để nén.`);
  }
  await fs.mkdir(SECRETS_DIR, { recursive: true });
  const compressedThumb = path.join(SECRETS_DIR, `${lessonId}_yt_thumb.jpg`);
  await execFileAsync('ffmpeg', [
    '-y', '-i', publicDest,
    '-vf', "scale='min(1280,iw)':-2",
    '-q:v', '4',
    compressedThumb,
  ]);
  return { webCoverPath: relFromPublic, uploadThumbPath: compressedThumb, thumbMime: 'image/jpeg', cleanupThumb: true };
}

/** Upload chunked có khả năng tiếp tục (Resumable Upload) lên YouTube Data API v3. */
async function uploadVideoToYoutube({ videoPath, title, description, tags, privacy, accessToken }) {
  const stat = await fs.stat(videoPath);
  const totalBytes = stat.size;
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(totalBytes),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: title.slice(0, 100),
          description: description || `${title}\nBài giảng trực tuyến BM Education.`,
          tags: tags || [],
          categoryId: '27', // Education
          defaultLanguage: 'vi',
        },
        status: {
          privacyStatus: privacy || 'unlisted',
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => '');
    throw new Error(`Khởi tạo phiên upload YouTube thất bại (${initRes.status}): ${errText}`);
  }
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube không trả về Location URI cho phiên upload.');
  }

  console.log(`[YouTube] Bắt đầu upload ${(totalBytes / 1048576).toFixed(1)} MB (${privacy || 'unlisted'})...`);
  const handle = await fs.open(videoPath, 'r');
  try {
    let offset = 0;
    while (offset < totalBytes) {
      const chunkLen = Math.min(CHUNK_SIZE, totalBytes - offset);
      const buffer = Buffer.allocUnsafe(chunkLen);
      const { bytesRead } = await handle.read(buffer, 0, chunkLen, offset);
      const slice = bytesRead === chunkLen ? buffer : buffer.subarray(0, bytesRead);
      const end = offset + slice.length - 1;

      const res = await putChunkWithRetry(uploadUrl, slice, offset, end, totalBytes);
      offset = end + 1;
      const pct = Math.round((offset / totalBytes) * 100);
      console.log(`[YouTube] ${pct}% (${(offset / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB)`);

      if (res.status === 200 || res.status === 201) {
        const videoJson = await res.json();
        return videoJson.id;
      }
    }
  } finally {
    await handle.close();
  }
  throw new Error('Upload kết thúc nhưng không nhận được ID video từ YouTube.');
}

async function putChunkWithRetry(uploadUrl, chunk, start, end, totalBytes) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      redirect: 'manual',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
        'Content-Type': 'video/mp4',
      },
      body: chunk,
    });
    if (res.status === 308 || res.status === 200 || res.status === 201) return res;
    if (attempt < 3 && (res.status >= 500 || res.status === 429)) {
      const waitMs = attempt * 2000;
      console.warn(`[YouTube] Lỗi tạm thời ${res.status}, thử lại sau ${waitMs}ms...`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`Upload chunk thất bại (${res.status}): ${errText}`);
  }
}

async function uploadYoutubeThumbnail({ videoId, thumbPath, thumbMime, accessToken }) {
  if (!thumbPath) return false;
  const imgBuf = await fs.readFile(thumbPath);
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': thumbMime || 'image/jpeg',
        'Content-Length': String(imgBuf.length),
      },
      body: imgBuf,
    },
  );
  if (res.ok) {
    console.log(`[YouTube] Đã gắn ảnh bìa tùy chỉnh cho video ${videoId}.`);
    return true;
  }
  const errText = await res.text().catch(() => '');
  if (res.status === 403) {
    console.warn(`[Cảnh báo] Video ${videoId} đã lên YouTube, nhưng kênh chưa xác minh SĐT để gắn Custom Thumbnail (${res.status}). Mở https://www.youtube.com/verify để bật tính năng này; trên web vẫn hiển thị ảnh bìa từ local.`);
    return false;
  }
  throw new Error(`Upload thumbnail lên YouTube thất bại (${res.status}): ${errText}`);
}

/** Tìm vị trí kết thúc object `{ ... }` bắt đầu tại `openBraceIdx`, bỏ qua chuỗi nháy. */
function findMatchingBrace(source, openBraceIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openBraceIdx; i < source.length; i += 1) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : '';
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function formatVideoObjectEntry(entry) {
  const lines = [
    '  {',
    `    id: ${JSON.stringify(entry.id)},`,
    `    title: ${JSON.stringify(entry.title)},`,
    ...(entry.course ? [`    course: ${JSON.stringify(entry.course)},`] : []),
    ...(entry.chapter ? [`    chapter: ${JSON.stringify(entry.chapter)},`] : []),
    `    order: ${Number(entry.order) || 1},`,
    `    tags: ${JSON.stringify(entry.tags || [])},`,
    `    source: "youtube",`,
    `    youtubeId: ${JSON.stringify(entry.youtubeId)},`,
    `    cover: ${JSON.stringify(entry.cover || `https://i.ytimg.com/vi/${entry.youtubeId}/maxresdefault.jpg`)},`,
    `    teacher: ${JSON.stringify(entry.teacher || 'Bảo Minh')},`,
    ...(entry.duration ? [`    duration: ${JSON.stringify(entry.duration)},`] : []),
    `    createdAt: ${entry.createdAt || Date.now()},`,
    '  },',
  ];
  return lines.join('\n');
}

/** Chèn mới hoặc cập nhật bài giảng trong edtech-phase1/src/data/videosData.js mà không làm hỏng định dạng file. */
async function upsertVideosData(entry, { dryRun = false } = {}) {
  const src = await fs.readFile(VIDEOS_DATA_PATH, 'utf8');
  const exportMarker = 'export const videos = [';
  const arrayStart = src.indexOf(exportMarker);
  if (arrayStart === -1) {
    throw new Error(`Không tìm thấy "${exportMarker}" trong ${VIDEOS_DATA_PATH}`);
  }
  const arrayOpenIdx = arrayStart + exportMarker.length - 1;
  const formatted = formatVideoObjectEntry(entry);

  const idRegex = new RegExp(`id\\s*:\\s*["']${entry.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
  const idMatch = idRegex.exec(src.slice(arrayOpenIdx));

  let updated;
  let action = 'inserted';
  if (idMatch) {
    const absIdPos = arrayOpenIdx + idMatch.index;
    const objStart = src.lastIndexOf('{', absIdPos);
    const objEnd = findMatchingBrace(src, objStart);
    if (objStart > arrayOpenIdx && objEnd > objStart) {
      const lineStart = src.lastIndexOf('\n', objStart) + 1;
      const hasComma = src[objEnd + 1] === ',';
      const replaceEnd = hasComma ? objEnd + 2 : objEnd + 1;
      updated = src.slice(0, lineStart) + formatted + src.slice(replaceEnd);
      action = 'updated';
    }
  }

  if (!updated) {
    const insertPos = src.indexOf('\n', arrayOpenIdx) + 1;
    updated = src.slice(0, insertPos) + formatted + '\n' + src.slice(insertPos);
  }

  if (!dryRun) {
    await fs.writeFile(VIDEOS_DATA_PATH, updated, 'utf8');
  }
  return { action, formatted };
}

async function runSingleJob(opts) {
  const driveId = parseDriveId(opts['drive-id']);
  const localFile = opts.file ? path.resolve(ROOT_DIR, opts.file) : '';
  if (!driveId && !localFile) {
    throw new Error('Cần truyền --drive-id <ID|URL> hoặc --file <đường dẫn file video>.');
  }
  if (!opts.title) {
    throw new Error('Cần truyền --title "<Tiêu đề bài giảng>".');
  }

  const lessonId = opts.id || slugifyId(opts.title);
  const dryRun = Boolean(opts['dry-run']);
  const tags = String(opts.tags || 'Lý,Lớp 12')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  let accessToken = null;
  if (!dryRun) {
    accessToken = await getAccessToken({ secretsPath: opts.secrets });
  } else if (driveId && !hasCommand('gdrive') && !localFile) {
    console.log('[DryRun] Bỏ qua tải Drive trực tiếp khi chạy dry-run.');
  }

  let videoPath = localFile;
  let downloadedTemp = false;
  if (driveId && !videoPath) {
    const targetTemp = path.join(TMP_VIDEOS_DIR, `${lessonId}.mp4`);
    if (await fileExists(targetTemp)) {
      videoPath = targetTemp;
      console.log(`[Drive] Dùng lại file đã tải sẵn: ${path.relative(ROOT_DIR, videoPath)}`);
    } else if (!dryRun) {
      videoPath = await downloadDriveVideo(driveId, targetTemp, accessToken);
      downloadedTemp = true;
    }
  }

  if (videoPath && !(await fileExists(videoPath))) {
    throw new Error(`Không tìm thấy file video: ${videoPath}`);
  }

  const duration = opts.duration || (videoPath ? await probeVideoDuration(videoPath) : '');
  const coverInfo = await prepareCoverAssets(opts.cover, lessonId);

  try {
    if (dryRun) {
      const previewEntry = {
        id: lessonId,
        title: opts.title,
        course: opts.course || '',
        chapter: opts.chapter || 'Bài giảng video',
        order: Number(opts.order) || 1,
        tags,
        youtubeId: 'DRY_RUN_YT_ID',
        cover: coverInfo.webCoverPath || '',
        teacher: opts.teacher || 'Bảo Minh',
        duration,
        createdAt: Date.now(),
      };
      const { action, formatted } = await upsertVideosData(previewEntry, { dryRun: true });
      console.log('\n[DryRun] Kiểm tra sẵn sàng hoàn tất:');
      console.log(`- Video đầu vào: ${videoPath ? `${path.relative(ROOT_DIR, videoPath)} (${((await fs.stat(videoPath)).size / 1048576).toFixed(1)} MB)` : `Drive ID ${driveId}`}`);
      console.log(`- Thời lượng dò được: ${duration || '(không rõ)'}`);
      console.log(`- Ảnh bìa web: ${coverInfo.webCoverPath || '(lấy mặc định từ YouTube)'}`);
      console.log(`- Bản ghi sẽ ${action} vào videosData.js:\n${formatted}`);
      return previewEntry;
    }

    const youtubeId = await uploadVideoToYoutube({
      videoPath,
      title: opts.title,
      description: opts.description,
      tags,
      privacy: opts.privacy || 'unlisted',
      accessToken,
    });
    console.log(`[YouTube] Đã upload xong -> https://youtu.be/${youtubeId}`);

    if (coverInfo.uploadThumbPath) {
      await uploadYoutubeThumbnail({
        videoId: youtubeId,
        thumbPath: coverInfo.uploadThumbPath,
        thumbMime: coverInfo.thumbMime,
        accessToken,
      });
    }

    const finalEntry = {
      id: lessonId,
      title: opts.title,
      course: opts.course || '',
      chapter: opts.chapter || 'Bài giảng video',
      order: Number(opts.order) || 1,
      tags,
      youtubeId,
      cover: coverInfo.webCoverPath || `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
      teacher: opts.teacher || 'Bảo Minh',
      duration,
      createdAt: Date.now(),
    };

    if (!opts['no-web']) {
      const { action } = await upsertVideosData(finalEntry, { dryRun: false });
      console.log(`[Web] Đã ${action === 'updated' ? 'cập nhật' : 'thêm mới'} bài "${lessonId}" trong edtech-phase1/src/data/videosData.js`);
    }

    const isTempVideo = downloadedTemp
      || path.resolve(videoPath).startsWith(path.resolve(TMP_VIDEOS_DIR) + path.sep);
    if (isTempVideo && !opts['keep-temp']) {
      await fs.rm(videoPath, { force: true });
      console.log(`[Cleanup] Đã xóa file tạm ${path.relative(ROOT_DIR, videoPath)}`);
    }

    return finalEntry;
  } finally {
    if (coverInfo.cleanupThumb && coverInfo.uploadThumbPath) {
      await fs.rm(coverInfo.uploadThumbPath, { force: true });
    }
  }
}

async function runBatch(manifestFile, globalOpts) {
  const resolved = path.resolve(ROOT_DIR, manifestFile);
  const items = JSON.parse(await fs.readFile(resolved, 'utf8'));
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`File manifest ${manifestFile} phải là mảng JSON các video.`);
  }
  const results = [];
  for (const [idx, item] of items.entries()) {
    console.log(`\n=== [${idx + 1}/${items.length}] ${item.title || item.id} ===`);
    const merged = {
      ...item,
      ...(Array.isArray(item.tags) ? { tags: item.tags.join(',') } : {}),
      ...globalOpts,
    };
    results.push(await runSingleJob(merged));
  }
  return results;
}

async function main() {
  const { command, opts, positionals } = parseArgs(process.argv.slice(2));
  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }
  if (command === 'auth') {
    await getAccessToken({ secretsPath: opts.secrets, forceAuth: true });
    console.log(`[Auth] Đã lưu OAuth token tại ${path.relative(ROOT_DIR, DEFAULT_TOKEN_PATH)}`);
    return;
  }
  if (command === 'run') {
    await runSingleJob(opts);
    return;
  }
  if (command === 'batch') {
    const target = positionals[0] || opts.manifest;
    if (!target) throw new Error('Cần chỉ định file manifest JSON: batch <manifest.json>');
    await runBatch(target, opts);
    return;
  }
  printUsage();
  process.exitCode = 1;
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isEntrypoint) {
  main().catch((err) => {
    console.error(`\n[Lỗi] ${err.message}`);
    process.exit(1);
  });
}

export { parseDriveId, slugifyId, upsertVideosData, formatVideoObjectEntry };

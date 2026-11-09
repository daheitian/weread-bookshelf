// 书房服务：静态文件 + 微信读书同步 + 封面代理。
//
// 单用户自用版：只读服务端 .env 里的 WEREAD_API_KEY（房主的书房），
// 访客不带 Key、也带不了 —— 没有「每人一间」的多租户。
// 没配 Key 时回落到示例书架（lib/demo.mjs），方便先看版面。
//
// 运行：WEREAD_API_KEY=wrk-xxx node server.mjs
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { demoLibrary, demoNotebooks } from './lib/demo.mjs';
import {
  fetchLibrary,
  fetchProgress,
  fetchNotes,
  fetchNotebooks,
  fetchBookInfo,
  hasOwnerKey,
} from './lib/weread.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');

// 读同目录 .env：不引 dotenv，够用就行。已存在的环境变量优先。
try {
  const raw = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* 没有 .env 就靠外部环境变量 */
}

const PORT = Number(process.env.PORT || 4599);
const TTL = 1000 * 60 * 60 * 6; // 6 小时
const OWNER_KEY = String(process.env.WEREAD_API_KEY || process.env.WEREAD_KEY || '').trim();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

/* ───────────── 谁在敲门 ───────────── */

// 单用户：只有房主的书房。访客一律看到房主的书（或示例），不认浏览器带来的 Key。
function who() {
  if (OWNER_KEY) return { key: OWNER_KEY, uid: 'owner', scope: 'owner' };
  return { key: '', uid: '', scope: 'demo' };
}

const udir = (uid) => path.join(DATA, 'u', uid);

/* ───────────── 书架缓存 ───────────── */

async function readCache(uid) {
  if (!uid) return null;
  try {
    const raw = await fs.readFile(path.join(udir(uid), 'library.json'), 'utf8');
    const data = JSON.parse(raw);
    const age = Date.now() - new Date(data.generatedAt).getTime();
    return { data, fresh: Number.isFinite(age) && age < TTL };
  } catch {
    return null;
  }
}

async function writeCache(uid, data) {
  if (!uid) return;
  await fs.mkdir(udir(uid), { recursive: true });
  await fs.writeFile(path.join(udir(uid), 'library.json'), JSON.stringify(data), 'utf8');
}

const inflight = new Map();

async function library({ force = false, key = '', uid = '', scope = 'demo' } = {}) {
  const cached = await readCache(uid);
  if (!force && cached?.fresh) return { ...cached.data, cached: true, scope };
  if (!key) {
    return { ...demoLibrary(), hint: 'demo', scope };
  }
  if (inflight.has(uid)) return inflight.get(uid);
  const job = (async () => {
    try {
      const data = await fetchLibrary({ key, uid });
      await writeCache(uid, data);
      return { ...data, scope };
    } catch (err) {
      if (cached?.data) return { ...cached.data, cached: true, scope, warning: `同步失败：${err.message}` };
      return { ...demoLibrary(), scope, warning: `同步失败：${err.message}` };
    } finally {
      inflight.delete(uid);
    }
  })();
  inflight.set(uid, job);
  return job;
}

/* ───────────── 封面代理 ───────────── */

// 微信读书 CDN 会校验 referer，直连会被 403。封面跟账号无关，全站共用一份缓存。
const COVER_DIR = path.join(DATA, 'covers');
const coverCache = new Map();
const COVER_MAX = 600;

function coverFile(target) {
  const h = crypto.createHash('sha1').update(target).digest('hex').slice(0, 20);
  return path.join(COVER_DIR, h + '.jpg');
}

async function cover(res, target) {
  const file = coverFile(target);
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800', 'Content-Length': buf.length });
    return res.end(buf);
  } catch {
    /* 未缓存 */
  }
  const hit = coverCache.get(target);
  if (hit) {
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=604800', 'Content-Length': hit.buf.length });
    return res.end(hit.buf);
  }
  try {
    const upstream = await fetch(target, {
      headers: {
        Referer: 'https://weread.qq.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
    });
    if (!upstream.ok) {
      res.writeHead(502).end('cover ' + upstream.status);
      return;
    }
    const type = upstream.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (coverCache.size > COVER_MAX) coverCache.clear();
    coverCache.set(target, { type, buf });
    fs.mkdir(COVER_DIR, { recursive: true })
      .then(() => fs.writeFile(file, buf))
      .catch(() => {});
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800', 'Content-Length': buf.length });
    res.end(buf);
  } catch (err) {
    res.writeHead(502).end('cover error');
  }
}

/* ───────────── 笔记 ───────────── */

const NOTE_TTL = 1000 * 60 * 60 * 24 * 3;
const noteMemo = new Map();

const noteFile = (uid, bookId) =>
  path.join(udir(uid), 'notes', bookId.replace(/[^\w-]/g, '_') + '.json');

function persistNotes(uid, bookId, data) {
  const file = noteFile(uid, bookId);
  fs.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.writeFile(file, JSON.stringify(data), 'utf8'))
    .catch(() => {});
}

// 版权页信息跟笔记一起返回、一起缓存。老缓存没有 info 字段时补一次再写回。
async function withInfo(data, key) {
  if (data.info !== undefined) return data;
  if (!key) {
    data.info = null;
    return data;
  }
  try {
    data.info = await fetchBookInfo(data.bookId, key);
  } catch {
    data.info = null;
  }
  return data;
}

async function notes(bookId, { key = '', uid = '' } = {}) {
  if (!uid) return { bookId, marks: [], thoughts: [], info: null, error: '没有可用的微信读书 Key' };
  const memoKey = uid + ':' + bookId;
  const hit = noteMemo.get(memoKey);
  if (hit && Date.now() - hit.at < NOTE_TTL && hit.data.info !== undefined) return hit.data;

  try {
    const raw = JSON.parse(await fs.readFile(noteFile(uid, bookId), 'utf8'));
    if (Date.now() - new Date(raw.at).getTime() < NOTE_TTL) {
      const fresh = raw.info !== undefined;
      const data = await withInfo(raw, key);
      noteMemo.set(memoKey, { at: Date.now(), data });
      if (!fresh) persistNotes(uid, bookId, data);
      return data;
    }
  } catch {
    /* 没缓存过 */
  }

  if (!key) {
    return { bookId, marks: [], thoughts: [], info: null, error: '没有可用的微信读书 Key' };
  }
  const [noteData, info] = await Promise.all([fetchNotes(bookId, key), fetchBookInfo(bookId, key).catch(() => null)]);
  const data = { ...noteData, info, at: new Date().toISOString() };
  noteMemo.set(memoKey, { at: Date.now(), data });
  persistNotes(uid, bookId, data);
  return data;
}

/* ───────────── 哪些书有笔记 ───────────── */

const NB_TTL = 1000 * 60 * 60 * 6;
const nbMemo = new Map();

async function notebookCounts({ key = '', uid = '' } = {}) {
  if (!uid) return {};
  const hit = nbMemo.get(uid);
  if (hit && Date.now() - hit.at < NB_TTL) return hit.data;
  const file = path.join(udir(uid), 'notebooks.json');
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    if (Date.now() - new Date(raw.at).getTime() < NB_TTL) {
      nbMemo.set(uid, { at: Date.now(), data: raw.data });
      return raw.data;
    }
  } catch {
    /* 没缓存过 */
  }
  if (!key) return demoNotebooks();
  const data = await fetchNotebooks(key);
  nbMemo.set(uid, { at: Date.now(), data });
  fs.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.writeFile(file, JSON.stringify({ at: new Date().toISOString(), data }), 'utf8'))
    .catch(() => {});
  return data;
}

/* ───────────── 静态文件 ───────────── */

async function serveStatic(res, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  let file = path.join(PUBLIC, clean === '/' ? 'index.html' : clean);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(PUBLIC, 'index.html'); // 单页回退
  }
  try {
    const buf = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
}

/* ───────────── 路由 ───────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const me = who();
  try {
    if (url.pathname === '/api/library') {
      return json(res, 200, await library({ force: url.searchParams.get('sync') === '1', ...me }));
    }
    if (url.pathname === '/api/progress') {
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { error: 'missing id' });
      if (!me.key) return json(res, 200, { progress: null, error: '没有可用的微信读书 Key' });
      try {
        return json(res, 200, await fetchProgress(id, me.key));
      } catch (err) {
        return json(res, 200, { progress: null, error: err.message });
      }
    }
    if (url.pathname === '/api/status') {
      return json(res, 200, {
        weread: !!me.key,
        demo: !me.key,
        scope: me.scope,
        owner: hasOwnerKey(),
        uid: me.uid ? me.uid.slice(0, 6) : null,
      });
    }
    if (url.pathname === '/api/notes') {
      const id = url.searchParams.get('id');
      if (!id) return json(res, 400, { error: 'missing id' });
      try {
        return json(res, 200, await notes(id, me));
      } catch (err) {
        return json(res, 200, { bookId: id, marks: [], thoughts: [], error: err.message });
      }
    }
    if (url.pathname === '/api/nb') {
      try {
        return json(res, 200, await notebookCounts(me));
      } catch (err) {
        return json(res, 200, { error: err.message });
      }
    }
    if (url.pathname === '/api/cover') {
      const u = url.searchParams.get('u');
      if (!u || !/^https?:\/\//.test(u)) return res.writeHead(400).end('bad url');
      return cover(res, u);
    }
    return serveStatic(res, url.pathname);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
});

// 旧版按 Key 的 sha1 分目录（data/u/<hash>/）。单用户版统一收进 data/u/owner/，
// 首次启动把已存在的那一份搬过来，免得重新同步 500 本（一次约 20 秒）。
async function migrateToSingleUser() {
  const ownerDir = udir('owner');
  try {
    await fs.access(ownerDir);
    return; // 已经迁过
  } catch {
    /* 还没迁 */
  }
  try {
    const base = path.join(DATA, 'u');
    const dirs = (await fs.readdir(base)).filter((d) => d !== 'owner');
    if (!dirs.length) return;
    const src = path.join(base, dirs[0]);
    await fs.mkdir(path.dirname(ownerDir), { recursive: true });
    await fs.rename(src, ownerDir);
    console.log(`  迁移旧书房缓存 → u/owner/`);
  } catch {
    /* 没旧数据就算了 */
  }
}

await migrateToSingleUser();

server.listen(PORT, () => {
  console.log(`\n  书房已开张  →  http://localhost:${PORT}`);
  console.log(`  本机房主：${OWNER_KEY ? '已配微信读书 Key' : '未配置，看到的是示例书架（在 .env 里放 WEREAD_API_KEY）'}`);
  console.log(`  没配 Key 的访客看到的是示例书架\n`);
});

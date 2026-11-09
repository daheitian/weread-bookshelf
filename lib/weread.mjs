// 微信读书适配层：把 /shelf/sync 的原始回包翻译成书架需要的模型。
// 只在服务端运行，API Key 不出现在前端。

import fs from 'node:fs/promises';

const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.5';

// Key 现在由调用方传进来（每个访客用自己的 Key），没传才回落到本机 .env。
// 这样同一个进程能同时服务很多人的书房，各拉各的，谁也不串。
function keyOf(k) {
  return String(k || '').trim() || String(process.env.WEREAD_API_KEY || process.env.WEREAD_KEY || '').trim();
}

export function hasKey(k) {
  return keyOf(k).length > 0;
}

// 只回答「这台机器自己配了 Key 没有」，别拿它决定某个请求用谁的账号
export function hasOwnerKey() {
  return String(process.env.WEREAD_API_KEY || process.env.WEREAD_KEY || '').trim().length > 0;
}

async function call(apiName, params = {}, k = '', opts = {}) {
  const apiKey = keyOf(k);
  if (!apiKey) throw new Error('WEREAD_API_KEY 未设置');
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ api_name: apiName, ...params, skill_version: SKILL_VERSION }),
    signal: opts.signal,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`微信读书返回了非 JSON（${res.status}）：${text.slice(0, 160)}`);
  }
  if (!res.ok) throw new Error(`微信读书 ${res.status}：${data?.errmsg || text.slice(0, 160)}`);
  if (data?.errcode && data.errcode !== 0) {
    throw new Error(`微信读书错误 ${data.errcode}：${data.errmsg || ''}`);
  }
  return data;
}

// 微信读书的 category 形如「文学-小说」「经济理财-财经」，取第一段当作书架分区
function topCategory(raw) {
  const c = (raw || '').trim();
  if (!c) return '未归档';
  const head = c.split(/[-/·>]/)[0].trim();
  return head || c;
}

function mapBook(b) {
  const progress = Number(b.progress) || 0;
  const finish = Number(b.finishReading) === 1 || progress === 100 ? 1 : 0;
  return {
    id: String(b.bookId || b.id || ''),
    title: (b.title || '无题').trim(),
    author: (b.author || '佚名').trim(),
    pages: null,
    category: topCategory(b.category),
    categoryName: topCategory(b.category),
    status: finish ? 'read' : progress > 0 ? 'reading' : 'to-read',
    progress: finish ? 100 : progress,
    readAt: Number(b.readUpdateTime) * 1000 || null,
    addedAt: null,
    finish,
    link: b.readerLink || b.deepLink || '',
    detail: b.deepLink || '',
    cover: b.cover || null,
    secret: Number(b.secret) === 1,
    pinned: Number(b.isTop) === 1,
    kind: 'book',
    source: 'weread',
  };
}

function mapAlbum(a) {
  const info = a.albumInfo || {};
  const extra = a.albumInfoExtra || {};
  return {
    id: 'album-' + String(info.albumId || ''),
    title: (info.name || '未命名专辑').trim(),
    author: (info.authorName || '佚名').trim(),
    pages: null,
    category: '有声书',
    categoryName: '有声书',
    status: extra.lectureReadUpdateTime ? 'reading' : 'to-read',
    progress: 0,
    readAt: Number(extra.lectureReadUpdateTime) * 1000 || null,
    finish: 0,
    link: `weread://album?albumId=${info.albumId}`,
    cover: info.cover || null,
    secret: Number(extra.secret) === 1,
    pinned: Number(extra.isTop) === 1,
    kind: 'album',
    source: 'weread',
  };
}

function orderCategories(books) {
  const stat = new Map();
  for (const b of books) {
    const k = b.categoryName;
    const cur = stat.get(k) || { slug: slugOf(k), name: k, count: 0 };
    cur.count += 1;
    stat.set(k, cur);
  }
  let list = [...stat.values()].sort((a, b) => b.count - a.count);
  // 边角料并入「其他」，免得书架尾部出现一根孤零零的书
  const small = list.filter((c) => c.count < 3);
  if (small.length > 1) {
    list = list.filter((c) => c.count >= 3);
    list.push({ slug: 'other', name: '其他', count: small.reduce((n, c) => n + c.count, 0), merge: small.map((c) => c.name) });
    const merged = new Set(small.map((c) => c.name));
    for (const b of books) {
      if (merged.has(b.categoryName)) {
        b.category = 'other';
        b.categoryName = '其他';
      }
    }
  }
  // 未归档的书往往最多，但排在最前面会让整面墙从「杂乱」开始，所以压到最后一格
  const tail = new Set(['未归档', '其他']);
  list = [...list.filter((c) => !tail.has(c.name)), ...list.filter((c) => tail.has(c.name))];

  // 前端按 category（slug）分组，这里把中文分类名统一换成 slug，合并过的归到 other
  const byName = new Map(list.map((c) => [c.name, c.slug]));
  for (const b of books) {
    b.category = byName.get(b.categoryName) || slugOf(b.categoryName);
  }
  return list;
}

function slugOf(name) {
  return encodeURIComponent(name);
}

// 阅读进度只在 /book/getprogress 里，一本一次；500 本全量拉一遍约 20 秒。
// 所以按「最近阅读时间」做版本号缓存：书没被翻过就不再问，二次同步基本是秒回。
// 缓存按访客分文件（uid = Key 的 sha1 前缀），不然甲的进度会盖到乙的书上。
const PCACHE = new URL('../data/progress.json', import.meta.url);
const pcaches = new Map();
const pcacheDirty = new Set();

function progressFile(uid) {
  return uid ? new URL(`../data/u/${uid}/progress.json`, import.meta.url) : PCACHE;
}

async function loadProgressCache(uid) {
  if (pcaches.has(uid)) return pcaches.get(uid);
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(progressFile(uid), 'utf8'));
  } catch {
    data = {};
  }
  pcaches.set(uid, data);
  return data;
}

async function saveProgressCache(uid) {
  if (!pcacheDirty.has(uid)) return;
  const file = progressFile(uid);
  await fs.mkdir(new URL('.', file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(pcaches.get(uid) || {}), 'utf8');
  pcacheDirty.delete(uid);
}

function applyProgress(b, rec) {
  const p = Number(rec.p) || 0;
  b.progress = p;
  b.readingTime = Number(rec.t) || 0;
  if (p >= 100) {
    b.finish = 1;
    b.status = 'read';
  } else if (p > 0) {
    b.status = 'reading';
  } else if (b.status !== 'read' && b.status !== 'reading') {
    b.status = 'to-read';
  }
}

async function enrichProgress(books, key = '', uid = '', concurrency = 10) {
  const cache = await loadProgressCache(uid);
  const queue = [];
  for (const b of books) {
    if (b.kind !== 'book') continue;
    const v = String(b.readAt || 0);
    const rec = cache[b.id];
    if (rec && rec.v === v) {
      applyProgress(b, rec);
    } else if (b.readAt) {
      queue.push({ b, v });
    }
  }

  const stat = { total: queue.length, ok: 0, fail: 0 };
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (i < queue.length) {
      const { b, v } = queue[i++];
      try {
        const r = await call('/book/getprogress', { bookId: b.id }, key);
        const d = r?.book || {};
        const rec = {
          v,
          p: Number(d.progress) || 0,
          t: Number(d.recordReadingTime) || Number(d.readingTime) || 0,
          f: d.finishTime || 0,
        };
        cache[b.id] = rec;
        pcacheDirty.add(uid);
        applyProgress(b, rec);
        stat.ok++;
      } catch {
        stat.fail++; // 单本失败不影响整架
      }
    }
  });
  await Promise.all(workers);
  await saveProgressCache(uid);
  return stat;
}

export async function fetchLibrary({ withProgress = true, withRatings = true, key = '', uid = '' } = {}) {
  const raw = await call('/shelf/sync', {}, key);
  const books = [];
  for (const b of raw.books || []) {
    const m = mapBook(b);
    if (m.id) books.push(m);
  }
  for (const a of raw.albums || []) {
    const m = mapAlbum(a);
    if (m.id !== 'album-') books.push(m);
  }
  if (!books.length) throw new Error('书架是空的（或该账号未返回任何书籍）');

  let pstat = null;
  if (withProgress) {
    const t0 = Date.now();
    pstat = await enrichProgress(books, key, uid);
    console.log(
      `  进度[${uid || 'owner'}]：新拉 ${pstat.ok}/${pstat.total}，失败 ${pstat.fail}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
  }

  // 评分：并入书架，给「按评分排序 / 辉光」用。缓存命中率高，首拉之后基本白嫖。
  if (withRatings && key) {
    try {
      const t0 = Date.now();
      const rstat = await enrichRatings(books, key, uid);
      console.log(
        `  评分[${uid || 'owner'}]：新拉 ${rstat.ok}/${rstat.total}，失败 ${rstat.fail}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    } catch (err) {
      console.warn('  评分并入失败（跳过，不影响书架）：', err.message);
    }
  }

  const categories = orderCategories(books);
  // 在读在最前，其余按最近阅读倒序，没读过的按标题
  books.sort((a, b) => {
    const w = (x) => (x.status === 'reading' ? 2 : x.status === 'read' ? 1 : 0);
    if (w(b) !== w(a)) return w(b) - w(a);
    if (b.readAt && a.readAt && b.readAt !== a.readAt) return b.readAt - a.readAt;
    return a.title.localeCompare(b.title, 'zh');
  });

  return {
    source: 'weread',
    generatedAt: new Date().toISOString(),
    counts: {
      books: books.filter((b) => b.kind === 'book').length,
      albums: books.filter((b) => b.kind === 'album').length,
    },
    progressStat: pstat,
    categories,
    books,
  };
}

// 验证一把 Key 是不是能读书架，顺便告诉前端「你的书房有多少本」
export async function verifyKey(k) {
  const raw = await call('/shelf/sync', {}, k);
  const books = (raw.books || []).length;
  const albums = (raw.albums || []).length;
  return { books, albums, total: books + albums };
}

export async function fetchProgress(bookId, key = '') {
  const r = await call('/book/getprogress', { bookId }, key);
  const b = r?.book || {};
  return {
    progress: Number(b.progress) || 0,
    readingTime: Number(b.recordReadingTime) || 0,
    finishTime: b.finishTime || null,
    chapter: b.chapterName || null,
  };
}

/* ───────────── 评分：并进书架，给「按评分排序 / 辉光」用 ───────────── */

// /book/info 里才有推荐值；一本一次，和进度同步一样按 uid 缓存，默认 30 天。
// 只有缓存失效（或新书）才再去问，首拉之后基本是秒回。失败不影响整架。
const RATING_TTL = 1000 * 60 * 60 * 24 * 30;
const rcaches = new Map();
const rcacheDirty = new Set();

function ratingFile(uid) {
  return uid ? new URL(`../data/u/${uid}/ratings.json`, import.meta.url) : null;
}

async function loadRatingCache(uid) {
  if (rcaches.has(uid)) return rcaches.get(uid);
  let data = {};
  const f = ratingFile(uid);
  if (f) {
    try {
      data = JSON.parse(await fs.readFile(f, 'utf8'));
    } catch {
      data = {};
    }
  }
  rcaches.set(uid, data);
  return data;
}

async function saveRatingCache(uid) {
  if (!rcacheDirty.has(uid)) return;
  const f = ratingFile(uid);
  if (!f) return;
  await fs.mkdir(new URL('.', f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(rcaches.get(uid) || {}), 'utf8');
  rcacheDirty.delete(uid);
}

// 微信读书的 newRating 可能是 0–10（8.5）也可能是 0–100（85），统一归一到 0–10
function normRating(r) {
  const v = Number(r) || 0;
  if (v <= 0) return null;
  return v > 10 ? v / 10 : v;
}

async function fetchOneRating(bookId, key) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await call('/book/info', { bookId }, key, { signal: ctrl.signal });
    const b = r?.book || r || {};
    const rating = normRating(b.newRating) ?? normRating(b.rating);
    const count = Number(b.newRatingCount) || Number(b.ratingCount) || 0;
    return { rating, count };
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichRatings(books, key = '', uid = '', concurrency = 8) {
  if (!key) return { total: 0, ok: 0, fail: 0 };
  const cache = await loadRatingCache(uid);
  const now = Date.now();
  const queue = [];
  for (const b of books) {
    if (b.kind !== 'book') continue;
    const c = cache[b.id];
    if (c && now - (c.ts || 0) < RATING_TTL) {
      b.rating = c.r;
      b.ratingCount = c.c;
    } else {
      queue.push(b);
    }
  }
  const stat = { total: queue.length, ok: 0, fail: 0 };
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (i < queue.length) {
      const b = queue[i++];
      try {
        const { rating, count } = await fetchOneRating(b.id, key);
        b.rating = rating;
        b.ratingCount = count;
        cache[b.id] = { r: rating, c: count, ts: now };
        rcacheDirty.add(uid);
        stat.ok++;
      } catch {
        stat.fail++; // 单本失败不影响整架
      }
    }
  });
  await Promise.all(workers);
  await saveRatingCache(uid);
  return stat;
}

/* ───────────── 版权页：出版社、年份、评分、简介 ───────────── */

// /book/info 返回的东西很杂，这里只取扉页用得上的几样。
export async function fetchBookInfo(bookId, key = '') {
  const r = await call('/book/info', { bookId }, key);
  const b = r?.book || r || {};
  const num = (v) => (Number(v) > 0 ? Number(v) : 0);
  const words = num(b.wordCount);
  return {
    bookId,
    publisher: (b.publisher || '').trim() || null,
    year: (b.publishTime || '').trim().slice(0, 10) || null,
    isbn: (b.isbn || '').trim() || null,
    rating: num(b.newRating) ? Math.round(num(b.newRating)) / 10 : num(b.rating) || null,
    ratingCount: num(b.newRatingCount) || num(b.ratingCount) || 0,
    words: words || null,
    intro: (b.intro || '').trim().replace(/\s*\n+\s*/g, ' ').slice(0, 220) || null,
  };
}

/* ───────────── 笔记：划线 + 想法 ───────────── */

const tsOf = (v) => {
  const n = Number(v) || 0;
  return n > 1e12 ? n : n * 1000;
};

// 单本书的笔记内容：/book/bookmarklist 拿划线（带章节），/review/list/mine 拿想法。
// 两个接口各自可能失败（有些有声书没有划线），失败只影响自己那一半。
export async function fetchNotes(bookId, key = '') {
  const marks = [];
  let markErr = null;
  try {
    const r = await call('/book/bookmarklist', { bookId }, key);
    const titles = new Map((r.chapters || []).map((c) => [c.chapterUid, c.title]));
    for (const m of r.updated || []) {
      const text = (m.markText || '').trim();
      if (!text) continue;
      marks.push({ id: m.bookmarkId, text, chapter: titles.get(m.chapterUid) || '', time: tsOf(m.createTime) });
    }
  } catch (err) {
    markErr = err.message;
  }

  const thoughts = [];
  let thoughtErr = null;
  try {
    let synckey = 0;
    for (let page = 0; page < 5; page++) {
      const r = await call('/review/list/mine', { bookid: bookId, count: 50, ...(synckey ? { synckey } : {}) }, key);
      for (const it of r.reviews || []) {
        const rv = it.review || {};
        const text = (rv.content || '').trim();
        if (!text) continue;
        thoughts.push({
          id: rv.reviewId,
          text,
          quote: (rv.abstract || '').trim(),
          chapter: rv.chapterName || '',
          star: Number(rv.star) || 0,
          time: tsOf(rv.createTime),
        });
      }
      if (!Number(r.hasMore) || !r.synckey || r.synckey === synckey) break;
      synckey = r.synckey;
    }
  } catch (err) {
    thoughtErr = err.message;
  }

  return {
    bookId,
    marks,
    thoughts,
    error: markErr && thoughtErr ? `${markErr} / ${thoughtErr}` : null,
  };
}

// 哪些书有笔记、各有几条：一次性拉全，前端用来在书名旁标数字
export async function fetchNotebooks(key = '', maxPages = 8) {
  const out = {};
  let lastSort = 0;
  for (let page = 0; page < maxPages; page++) {
    const r = await call('/user/notebooks', { count: 100, ...(lastSort ? { lastSort } : {}) }, key);
    const list = r.books || [];
    for (const b of list) {
      if (!b.bookId) continue;
      out[b.bookId] = {
        n: Number(b.noteCount) || 0,
        t: Number(b.reviewCount) || 0,
        m: Number(b.bookmarkCount) || 0,
        p: Number(b.readingProgress) || 0,
      };
    }
    if (!Number(r.hasMore)) break;
    lastSort = Number(list.at(-1)?.sort) || 0;
    if (!lastSort) break;
  }
  return out;
}

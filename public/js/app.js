import { BookshelfScene, DECOR_KINDS } from './scene.js';
import { DECOR_ICONS } from './icons.js';
import { createCoverAtlas, fillCoverAtlas, bakeSpines, coverSrc } from './atlas.js';
import { createTimeline } from './timeline.js';

const $ = (s) => document.querySelector(s);
const el = {
  app: $('#app'),
  stage: $('#stage'),
  chips: $('#chips'),
  roomTag: $('#roomTag'),
  roomName: $('#roomName'),
  roomMeta: $('#roomMeta'),
  tooltip: $('#tooltip'),
  ttTitle: $('#ttTitle'),
  ttAuthor: $('#ttAuthor'),
  ttMeta: $('#ttMeta'),
  toggle: $('#viewToggle'),
  tlStage: $('#tlStage'),
  zoomOut: $('#zoomOut'),
  hint: $('#hint'),
  hintOk: $('#hintOk'),
  loading: $('#loading'),
  loadbar: $('#loadbar'),
  searchOpen: $('#searchOpen'),
  searchbar: $('#searchbar'),
  q: $('#q'),
  qcount: $('#qcount'),
  searchClose: $('#searchClose'),
  reader: $('#reader'),
  bk: $('#bk'),
  bkImg: $('#bkImg'),
  pgL: $('#pgL'),
  pgR: $('#pgR'),
  rdRead: $('#rdRead'),
  rdClose: $('#rdClose'),
  lamp: $('#lamp'),
  lampIco: $('#lampIco'),
  lampTxt: $('#lampTxt'),
  sortToggle: $('#sortToggle'),
  dockLeft: $('#dockLeft'),
  decorOpen: $('#decorOpen'),
  decorTray: $('#decorTray'),
  decorGrid: $('#decorGrid'),
  decorClose: $('#decorClose'),
  decorBar: $('#decorBar'),
  dbName: $('#dbName'),
  dbSize: $('#dbSize'),
  dbSizeVal: $('#dbSizeVal'),
  paperDlg: $('#paperDlg'),
  pdKicker: $('#pdKicker'),
  pdTitle: $('#pdTitle'),
  pdText: $('#pdText'),
  pdCount: $('#pdCount'),
  pdClear: $('#pdClear'),
  pdSave: $('#pdSave'),
  pdTip: $('#pdTip'),
  pdClose: $('#pdClose'),
};

/* ───────── 这间书房 ───────── */
// 单用户：书房只认服务端 .env 里的 WEREAD_API_KEY，前端不碰 Key。
const NAME_STORE = 'bookshelf.roomName';

const store = {
  get(k) {
    try {
      return localStorage.getItem(k) || '';
    } catch {
      return '';
    }
  },
  set(k, v) {
    try {
      v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
    } catch {}
  },
};

function api(path, opts = {}) {
  return fetch(path, { ...opts, headers: new Headers(opts.headers || {}) });
}

const progress = (p) => {
  el.loadbar.style.setProperty('--p', Math.round(p * 100) + '%');
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const scene = new BookshelfScene(el.stage);
window.__scene = scene;

// 推近时右下角浮出「整架」，给一条明确的回头路
scene.onZoom = (z) => el.app.classList.toggle('zoomed', (z || 1) < 0.95);

// 墙上那个开关和「关灯」按钮是同一套：点哪个都行
scene.onSwitch = () => applyNight(!night);

/* 笔记条数：先拉一份概览，悬停和书页里都能直接显示 */
let noteCounts = {};

function statusText(b) {
  if (b.status === 'read') return '已读完';
  if (b.progress > 0) return '在读 · ' + b.progress + '%';
  return '未读';
}

function dur(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`;
}

function metaText(b) {
  const bits = [];
  if (b.cat) bits.push(b.cat);
  bits.push(statusText(b));
  if (b.readingTime > 60) bits.push('读了 ' + dur(b.readingTime));
  const nb = noteCounts[b.id];
  if (nb && nb.n + nb.t > 0) bits.push(`${nb.n + nb.t} 条笔记`);
  if (b.kind === 'album') bits.push('有声书');
  return bits.join(' · ');
}

/* ───────── 悬停浮层 ───────── */
let lastHover = null;
el.stage.addEventListener('pointermove', (e) => {
  lastHover = { x: e.clientX, y: e.clientY };
  if (scene.hovered >= 0) placeTip();
});

function placeTip() {
  if (!lastHover) return;
  const pad = 16;
  const r = el.tooltip.getBoundingClientRect();
  let x = lastHover.x + pad;
  let y = lastHover.y + pad;
  if (x + r.width > innerWidth - 10) x = lastHover.x - r.width - pad;
  if (y + r.height > innerHeight - 10) y = lastHover.y - r.height - pad;
  el.tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

scene.onHover = (b) => {
  if (!b) {
    el.tooltip.classList.remove('visible');
    el.tooltip.setAttribute('aria-hidden', 'true');
    return;
  }
  el.ttTitle.textContent = b.title;
  el.ttAuthor.textContent = b.author || '';
  el.ttMeta.textContent = metaText(b);
  placeTip();
  el.tooltip.classList.add('visible');
  el.tooltip.setAttribute('aria-hidden', 'false');
};

/* ───────── 第一次来的操作提示 ───────── */
const HINT_KEY = 'bookshelf.hintSeen';
let hintTimer = 0;

function hideHint() {
  clearTimeout(hintTimer);
  if (el.hint.hidden) return;
  el.hint.classList.remove('show');
  store.set(HINT_KEY, '1');
  setTimeout(() => {
    el.hint.hidden = true;
  }, 560);
}

function showHint() {
  if (store.get(HINT_KEY) || !el.hint) return;
  // 手机上没有滚轮，换一套说法
  const txt = el.hint.querySelector('.hint-txt');
  if (txt && matchMedia('(pointer: coarse)').matches) {
    txt.textContent = '单指拖动逛书架 · 双指捏合放大 · 推近后上下拖动看最上层 · 点一本书翻开';
  }
  el.hint.hidden = false;
  requestAnimationFrame(() => el.hint.classList.add('show'));
  hintTimer = setTimeout(hideHint, 12000);
}

if (el.hintOk) el.hintOk.addEventListener('click', hideHint);
if (el.zoomOut)
  el.zoomOut.addEventListener('click', () => {
    scene.resetView();
    hideHint();
  });

/* ───────── 点开一本书：封面飞起来、翻开，右页是笔记 ───────── */
let readerBook = null;
let readerTimer = 0;
const noteCache = new Map();

function leftPageHTML(b, d) {
  const nb = d ? { n: d.n || 0, t: d.t || 0 } : noteCounts[b.id] || { n: 0, t: 0 };
  const total = nb.n + nb.t;
  const info = (d && d.info) || null;
  const pct = b.status === 'read' ? 100 : Number(b.progress) || 0;
  const pctLabel = b.status === 'read' ? '已读完' : pct > 0 ? '读到' : '未读';

  // 版权行：出版社 · 年月，有几项写几项
  const pub = [];
  if (info?.publisher) pub.push(esc(info.publisher));
  if (info?.year) {
    const [y, m] = info.year.split('-');
    pub.push(`${y} 年${Number(m) ? ` ${Number(m)} 月` : ''}`);
  }
  const rating = info?.rating
    ? `推荐值 <b>${info.rating.toFixed(1)}%</b>${info.ratingCount ? `<i>${info.ratingCount} 人评过</i>` : ''}`
    : '';

  return (
    `<div class="tt-kicker"><span>${esc(b.cat || '未归档')}</span></div>` +
    `<div class="tt-mid">` +
    `<div class="tt-1">${esc(b.title)}</div>` +
    (b.author ? `<div class="tt-2">${esc(b.author)}</div>` : '') +
    (pub.length ? `<div class="tt-colophon">${pub.join(' · ')}</div>` : '') +
    (rating ? `<div class="tt-rating">${rating}</div>` : '') +
    (info?.intro ? `<p class="tt-intro">${esc(info.intro)}</p>` : '') +
    `</div>` +
    `<div class="tt-sep"></div>` +
    `<div class="tt-stat">` +
    `<div><b>${pct ? pct + '%' : '—'}</b><span>${pctLabel}</span></div>` +
    `<div><b>${nb.n}</b><span>条划线</span></div>` +
    `<div><b>${nb.t}</b><span>条想法</span></div>` +
    `</div>` +
    `<div class="tt-foot">${esc(
      [b.kind === 'album' ? '有声书' : '微信读书', b.readingTime > 60 ? `读过 ${dur(b.readingTime)}` : '', total ? `${total} 条笔记` : '']
        .filter(Boolean)
        .join(' · ')
    )}</div>`
  );
}

// 书名长了就缩字号，别让标题把整页占满
function setLeft(b, d) {
  el.pgL.innerHTML = leftPageHTML(b, d);
  const t = el.pgL.querySelector('.tt-1');
  if (!t) return;
  const n = (b.title || '').length;
  t.style.fontSize = n > 26 ? '19px' : n > 16 ? '22px' : '26px';
}

function notesHTML(b, data) {
  const marks = (data && data.marks) || [];
  const thoughts = (data && data.thoughts) || [];
  const head =
    `<div class="pr-run"><span class="pr-cat">${esc(b.cat || '未分类')}</span>` +
    `<span class="pr-t">${esc(b.title)}</span>` +
    `<i>${marks.length} 划线 · ${thoughts.length} 想法</i></div>` +
    `<div class="pr-stat">${esc(statusText(b))}${b.readingTime > 60 ? ` · 读过 ${esc(dur(b.readingTime))}` : ''}</div>` +
    `<div class="pr-rule"></div>`;

  const seen = new Set();
  const list = [];
  for (const t of thoughts) {
    list.push({ q: t.quote || '', t: t.text, ch: t.chapter || '', time: t.time || 0 });
    if (t.quote) seen.add(t.quote);
  }
  for (const m of marks) {
    if (seen.has(m.text)) continue;
    list.push({ q: m.text, t: '', ch: m.chapter || '', time: m.time || 0 });
  }
  list.sort((a, c) => c.time - a.time);

  if (!list.length) {
    return (
      head +
      `<div class="nt-empty"><b>这本书还没有笔记</b><span>${esc(data && data.error ? '笔记本没取到：' + data.error : '在微信读书里划一句，它就会出现在这里')}</span></div>`
    );
  }
  const shown = list.slice(0, 80);
  let prev = '';
  const body = shown
    .map((e) => {
      // 同一章的标签只贴一次，不然每条前面都挂一遍
      const ch = e.ch && e.ch !== prev ? e.ch : '';
      prev = e.ch;
      return (
        `<figure class="nt">` +
        (ch ? `<div class="nt-ch">${esc(ch)}</div>` : '') +
        (e.q ? `<blockquote class="nt-q">${esc(e.q)}</blockquote>` : '') +
        (e.t ? `<p class="nt-t">${esc(e.t)}</p>` : '') +
        `</figure>`
      );
    })
    .join('');
  const more = list.length > shown.length ? `<div class="nt-more">还有 ${list.length - shown.length} 条</div>` : '';
  return head + `<div class="nt-list">${body}${more}</div>`;
}

async function loadNotes(b) {
  let data = noteCache.get(b.id);
  if (!data) {
    try {
      const res = await api('/api/notes?id=' + encodeURIComponent(b.id));
      data = await res.json();
    } catch {
      data = { marks: [], thoughts: [], error: '网络断了' };
    }
    noteCache.set(b.id, data);
  }
  if (!readerBook || readerBook.id !== b.id) return;
  el.pgR.innerHTML = notesHTML(b, data);
  setLeft(b, { n: (data.marks || []).length, t: (data.thoughts || []).length, info: data.info });
}

function openBook(b, at) {
  if (!b) return closeBook();
  if (readerBook && readerBook.id === b.id && el.reader.classList.contains('show')) return;
  readerBook = b;
  clearTimeout(readerTimer);

  // 封面从鼠标点的位置飞起来，不是凭空出现
  const dx = at ? at.x - innerWidth / 2 : 0;
  const dy = at ? at.y - innerHeight / 2 : 80;
  el.bk.style.setProperty('--dx', Math.round(dx) + 'px');
  el.bk.style.setProperty('--dy', Math.round(dy) + 'px');
  el.bk.classList.remove('open');

  el.bkImg.src = b.cover ? coverSrc(b) : '';
  setLeft(b);
  el.pgR.innerHTML = `<div class="pr-run"><span class="pr-cat">我的笔记</span></div><div class="nt-empty"><b>正在翻这本书的笔记…</b></div>`;
  if (b.link) {
    el.rdRead.href = b.link;
    el.rdRead.style.display = '';
  } else {
    el.rdRead.style.display = 'none';
  }
  el.tooltip.classList.remove('visible');
  el.app.classList.add('reading');
  el.reader.classList.add('show');
  el.reader.setAttribute('aria-hidden', 'false');

  readerTimer = setTimeout(() => {
    el.bk.classList.add('open');
    loadNotes(b);
  }, 520);
}

function closeBook() {
  if (!readerBook) return;
  readerBook = null;
  clearTimeout(readerTimer);
  el.bk.classList.remove('open');
  el.reader.classList.remove('show');
  el.reader.setAttribute('aria-hidden', 'true');
  el.app.classList.remove('reading');
  scene.selected = null;
  scene.releasePick();
  readerTimer = setTimeout(() => {
    el.pgL.innerHTML = '';
    el.pgR.innerHTML = '';
    el.bkImg.removeAttribute('src');
  }, 900);
}

scene.onSelect = (b, at) => {
  if (b) openBook(b, at);
  else closeBook();
};

el.rdClose.addEventListener('click', closeBook);
el.reader.addEventListener('click', (e) => {
  if (e.target === el.reader) closeBook();
});

/* ───────── 分类 ───────── */
let clearChip = () => {};
let jumpToKey = () => {};

// 当前看到哪儿写进地址栏：刷新、发给朋友、浏览器后退都能回到同一处
function writeHash(key) {
  let hash = '';
  if (key === 'reading') hash = '#reading';
  else if (key === 'to-read') hash = '#to-read';
  else if (key && key.startsWith('cat:')) hash = '#cat-' + key.slice(4);
  history.replaceState(null, '', location.pathname + location.search + hash);
}

function readHash() {
  const raw = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  if (raw === 'reading' || raw === 'to-read') return raw;
  if (raw.startsWith('cat-')) return 'cat:' + raw.slice(4);
  return '';
}

function renderChips(cats) {
  el.chips.innerHTML = '';
  const add = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.addEventListener('click', fn);
    el.chips.appendChild(b);
    return b;
  };
  const sep = () => {
    const s = document.createElement('span');
    s.className = 'chip-sep';
    el.chips.appendChild(s);
  };
  const chipReading = add('在读', () => jumpTo('reading'));
  const chipWant = add('想读', () => jumpTo('to-read'));
  sep();
  const catChips = cats.map((c) => {
    const b = add(c.name, () => jumpTo('cat:' + c.name));
    b.title = c.name + ' · ' + c.count + ' 本';
    return b;
  });
  let active = null;
  function clear() {
    [chipReading, chipWant, ...catChips].forEach((b) => b.classList.remove('on'));
    if (active) active = null;
  }
  clearChip = () => {
    clear();
    scene.setCat(null);
    writeHash('');
  };
  jumpToKey = jumpTo;
  function jumpTo(key) {
    clear();
    let btn = null;
    if (key === 'reading') {
      btn = chipReading;
      scene.setCat('reading');
      scene.focusSpot('reading'); // 在读的书摊在左边那张矮桌上
    } else if (key === 'to-read') {
      btn = chipWant;
      scene.setCat('to-read');
      scene.focusSpot('want'); // 想读的书摞在靠柜子那张
    } else {
      const name = key.slice(4);
      scene.setCat(name);
      scene.focusSpot('home');
      const first = scene.books.find((x) => x.cat === name && !scene.tableIds?.has(x.id));
      if (first) scene.focusBook(first);
      btn = catChips[cats.findIndex((c) => c.name === name)];
    }
    if (btn) {
      btn.classList.add('on');
      active = key;
    }
    writeHash(key);
  }
}

/* ───────── 视图切换 ───────── */
let timeline = null;

function syncToggle(v) {
  for (const b of el.toggle.querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === v);
}

// 进入年表：3D 房间让位给 DOM 长河；出来则还回 3D
function enterTimeline() {
  el.app.classList.add('show-timeline');
  el.app.classList.add('ready');
  el.tlStage.setAttribute('aria-hidden', 'false');
  timeline?.enter();
}
function exitTimeline() {
  el.app.classList.remove('show-timeline');
  el.tlStage.setAttribute('aria-hidden', 'true');
  timeline?.exit();
}

// 统一的视图落地：切换胶囊、写进地址栏、3D / 年表各走各的路
function applyView(v) {
  if (v === scene.view) return;
  syncToggle(v);
  const u = new URL(location.href);
  if (v === 'covers') u.searchParams.set('view', 'covers');
  else if (v === 'timeline') u.searchParams.set('view', 'timeline');
  else u.searchParams.delete('view');
  history.replaceState(null, '', u);

  const wasTimeline = scene.view === 'timeline';
  if (v === 'timeline') {
    scene.setView('timeline'); // 只改标记、不重建 3D（scene 里特判）
    enterTimeline();
    return;
  }
  if (wasTimeline) exitTimeline();
  el.app.classList.remove('ready');
  setTimeout(() => {
    scene.setView(v);
    if (scene.spot !== 'home') scene.focusSpot(scene.spot);
    el.app.classList.add('ready');
  }, 180);
}

el.toggle.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  applyView(btn.dataset.view);
});

/* ───────── 灯：白天是窗帘外的光，关掉只剩柜子里的暗藏灯带 ───────── */
const LAMP_KEY = 'bookshelf.night';
let night = false;

function applyNight(on, save = true) {
  night = !!on;
  scene.setNight(night);
  el.app.classList.toggle('night', night);
  el.lampIco.textContent = night ? '☾' : '☀';
  el.lampTxt.textContent = night ? '开灯' : '关灯';
  el.lamp.setAttribute('aria-label', night ? '开灯' : '关灯');
  el.lamp.title = (night ? '开灯' : '关灯') + '（L）';
  if (save) {
    try {
      localStorage.setItem(LAMP_KEY, night ? '1' : '0');
    } catch {}
  }
}

el.lamp.addEventListener('click', () => applyNight(!night));

/* ───────── 排序：分类内按评分降序 ───────── */
function syncSort(mode) {
  for (const b of el.sortToggle.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.sort === mode);
  }
}

el.sortToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sort]');
  if (!btn) return;
  const mode = btn.dataset.sort || '';
  if (mode === (scene.sortBy || '')) return;
  syncSort(mode);
  // 书脊上看不出是哪本书，按评分没意义 —— 顺手切到封面模式，一步看到「评分墙」
  const toCovers = mode === 'rating' && scene.view !== 'covers';
  if (toCovers) {
    syncToggle('covers');
    el.app.classList.remove('ready');
  }
  const u = new URL(location.href);
  if (mode) u.searchParams.set('sort', mode);
  else u.searchParams.delete('sort');
  if (toCovers) u.searchParams.set('view', 'covers');
  history.replaceState(null, '', u);
  setTimeout(() => {
    if (toCovers) scene.setView('covers');
    scene.setSort(mode);
    if (toCovers) {
      if (scene.spot !== 'home') scene.focusSpot(scene.spot);
      el.app.classList.add('ready');
    }
  }, 160);
});

/* ───────── 摆件 ───────── */
// 抽屉里 28 种。点一下放到最靠镜头、还空着的那格，放完顺手选中，
// 底部就会亮出「尺寸 / 换层 / 挪动 / 移除」——不用再点它一次。
let trayOpen = false;

function renderDecorGrid() {
  el.decorGrid.innerHTML = DECOR_KINDS.map(
    (k) =>
      `<button class="ds-item" data-kind="${k.id}" title="${esc(k.name)}">` +
      `<span class="ds-ico">${DECOR_ICONS[k.id] || ''}</span>` +
      `<span class="ds-name">${esc(k.name)}</span></button>`
  ).join('');
}

// 线稿只是占位，真正好看的是实物小样：场景里那套几何离屏拍一遍，
// 拍好了把格子里的图换掉（一张一张换，不会整块闪）。
let thumbs = null;
function paintThumbs() {
  if (!thumbs) return;
  for (const b of el.decorGrid.querySelectorAll('.ds-item')) {
    const src = thumbs[b.dataset.kind];
    if (!src) continue;
    const ico = b.querySelector('.ds-ico');
    if (!ico || ico.dataset.done) continue;
    const img = new Image();
    img.alt = '';
    img.src = src;
    img.onload = () => {
      ico.textContent = '';
      ico.appendChild(img);
      ico.dataset.done = '1';
      ico.classList.add('shot');
    };
  }
}
function ensureThumbs() {
  if (thumbs) return paintThumbs();
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 400));
  idle(() => {
    try {
      thumbs = scene.decorThumbs(128);
    } catch (err) {
      console.warn('摆件小样生成失败', err);
    }
    paintThumbs();
  });
}

function openTray() {
  trayOpen = true;
  el.decorTray.hidden = false;
  el.decorOpen.classList.add('on');
  el.decorOpen.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => el.decorTray.classList.add('on'));
  ensureThumbs();
}
function closeTray() {
  if (!trayOpen) return;
  trayOpen = false;
  el.decorTray.classList.remove('on');
  el.decorOpen.classList.remove('on');
  el.decorOpen.setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    if (!trayOpen) el.decorTray.hidden = true;
  }, 240);
}
el.decorOpen.addEventListener('click', (e) => {
  e.stopPropagation();
  if (trayOpen) closeTray();
  else openTray();
});
el.decorClose.addEventListener('click', closeTray);
el.decorTray.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  const d = scene.addDecor(b.dataset.kind);
  if (!d) {
    el.decorTray.classList.add('shake');
    setTimeout(() => el.decorTray.classList.remove('shake'), 400);
    return;
  }
  // 放完不关抽屉，方便连摆几件
  el.decorTray.classList.remove('bump');
  void el.decorTray.offsetWidth;
  el.decorTray.classList.add('bump');
  scene.selectDecor(d);
});
addEventListener('pointerdown', (e) => {
  if (!trayOpen) return;
  if (el.decorTray.contains(e.target) || el.decorOpen.contains(e.target)) return;
  closeTray();
});

/* 摆件编辑条：点中某一件才出现 */
let pickedDecor = null;

scene.onDecorSelect = (d) => {
  pickedDecor = d;
  if (!d) {
    el.decorBar.classList.remove('on');
    setTimeout(() => {
      if (!pickedDecor) el.decorBar.hidden = true;
    }, 220);
    return;
  }
  const k = DECOR_KINDS.find((x) => x.id === d.kind);
  el.dbName.textContent = k ? k.name : '摆件';
  // 手机上抽屉占满下半屏，会把编辑条整个盖住 —— 选中就先把抽屉收起来
  if (window.matchMedia('(max-width: 720px)').matches) closeTray();
  const pct = Math.round((d.s || 1) * 100);
  el.dbSize.value = String(pct);
  el.dbSizeVal.textContent = String(pct);
  el.decorBar.hidden = false;
  requestAnimationFrame(() => el.decorBar.classList.add('on'));
};

el.dbSize.addEventListener('input', () => {
  if (!pickedDecor) return;
  const v = Number(el.dbSize.value) || 100;
  el.dbSizeVal.textContent = String(v);
  scene.updateDecor(pickedDecor, { s: v / 100 });
});

el.decorBar.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !pickedDecor) return;
  const act = b.dataset.act;
  if (act === 'remove') {
    const d = pickedDecor;
    scene.selectDecor(null);
    scene.removeDecor(d);
  } else if (act === 'done') {
    scene.selectDecor(null);
  } else if (act === 'up') scene.updateDecor(pickedDecor, { row: 1 });
  else if (act === 'down') scene.updateDecor(pickedDecor, { row: -1 });
  else if (act === 'left') scene.updateDecor(pickedDecor, { dx: -0.025 });
  else if (act === 'right') scene.updateDecor(pickedDecor, { dx: 0.025 });
});

/* ───────── 桌上那张纸：点纸写字，点钢笔写信 ───────── */
// 字存在这台浏览器里，跟着书房 uid 分开：换一把 Key 就是另一张纸
const PAPER_KEY = 'bookshelf.paper';
let paperMode = 'note';
let paperOpen = false;
let paperStore = { notes: '', letter: '', mode: 'note' };

function loadPaper() {
  try {
    const v = JSON.parse(localStorage.getItem(PAPER_KEY) || 'null');
    if (v && typeof v === 'object') paperStore = { ...paperStore, ...v };
  } catch {}
  scene.setPaper(paperStore);
}

function savePaper(patch) {
  paperStore = { ...paperStore, ...patch };
  try {
    localStorage.setItem(PAPER_KEY, JSON.stringify(paperStore));
  } catch {}
  scene.setPaper(paperStore);
}

function countUp() {
  const n = el.pdText.value.trim().length;
  el.pdCount.textContent = n ? `${n} 字` : '';
}

function openPaper(mode) {
  paperMode = mode === 'letter' ? 'letter' : 'note';
  const letter = paperMode === 'letter';
  paperOpen = true;
  el.pdKicker.textContent = letter ? 'A LETTER' : 'DESK NOTES';
  el.pdTitle.textContent = letter ? '写一封信' : '在纸上写点什么';
  el.pdSave.textContent = letter ? '让钢笔写' : '写到纸上';
  el.pdTip.textContent = letter ? '收起面板，钢笔会一笔一笔把信念出来' : '写完这张纸会重新裱好，字是手写的';
  el.pdText.value = (letter ? paperStore.letter : paperStore.notes) || '';
  el.pdText.placeholder = letter ? '展信佳……' : '今天读到的一句，或一句想记住的话……';
  countUp();
  el.paperDlg.hidden = false;
  requestAnimationFrame(() => el.paperDlg.classList.add('on'));
  // 镜头先凑到桌前，关掉面板就是那张纸
  scene.focusDesk();
  setTimeout(() => el.pdText.focus(), 260);
}

function closePaper() {
  if (!paperOpen) return;
  paperOpen = false;
  el.paperDlg.classList.remove('on');
  setTimeout(() => {
    if (!paperOpen) el.paperDlg.hidden = true;
  }, 300);
}

scene.onPaper = () => openPaper('note');
scene.onPen = () => openPaper('letter');

el.pdText.addEventListener('input', countUp);
el.pdClose.addEventListener('click', closePaper);
el.paperDlg.addEventListener('click', (e) => {
  if (e.target === el.paperDlg) closePaper();
});
el.pdClear.addEventListener('click', () => {
  el.pdText.value = '';
  countUp();
  el.pdText.focus();
});
el.pdSave.addEventListener('click', () => {
  const text = el.pdText.value.trim();
  if (!text) {
    el.pdText.focus();
    return;
  }
  if (paperMode === 'letter') {
    savePaper({ letter: text, mode: 'letter' });
    closePaper();
    setTimeout(() => scene.writeLetter(text), 300);
  } else {
    savePaper({ notes: text, mode: 'note' });
    closePaper();
  }
});

// 没写过字的话，从最近读的那本里挑一句真的划线，先写上
async function seedPaper() {
  if (paperStore.notes) return;
  const b = scene.deskPicks?.[0] || scene.readingPicks?.[0];
  let line = '';
  if (b) {
    try {
      const d = await api('/api/notes?id=' + encodeURIComponent(b.id)).then((r) => r.json());
      const t = (d.thoughts || []).find((x) => x.text);
      line = (t && t.text) || (d.marks || [])[0]?.text || '';
    } catch {}
  }
  const fallback = '今天从架子上抽出一本旧书，\n翻开的那页正好有一句：\n\n慢一点也没关系，书不会跑。';
  const body = line ? `「${line.slice(0, 96)}」\n\n—— ${b.title}` : fallback;
  savePaper({ notes: body, mode: 'note' });
}

/* ───────── 书房：名字刻在门口 ───────── */
let roomName = store.get(NAME_STORE) || '见室小册的书房';

function applyRoomName(name, save = true) {
  roomName = String(name || '').trim() || '见室小册的书房';
  el.roomName.textContent = roomName;
  document.title = roomName;
  scene.setSign(roomName);
  if (save) store.set(NAME_STORE, roomName);
}

function setRoomMeta(n, scope) {
  const tail = scope === 'demo' ? '示例' : '我的';
  el.roomMeta.textContent = `${n} 本书 · ${tail}`;
}

/* ───────── 搜索 ───────── */
let searchOpen = false;
function openSearch() {
  if (searchOpen) return;
  searchOpen = true;
  el.searchbar.hidden = false;
  requestAnimationFrame(() => el.searchbar.classList.add('on'));
  el.searchOpen.classList.add('hidden');
  setTimeout(() => el.q.focus(), 60);
}
function closeSearch() {
  if (!searchOpen) return;
  searchOpen = false;
  el.searchbar.classList.remove('on');
  el.searchOpen.classList.remove('hidden');
  el.q.value = '';
  el.qcount.textContent = '';
  scene.setQuery('');
  setTimeout(() => {
    if (!searchOpen) el.searchbar.hidden = true;
  }, 220);
}
el.searchOpen.addEventListener('click', openSearch);
el.searchClose.addEventListener('click', closeSearch);
el.q.addEventListener('input', () => {
  const q = el.q.value;
  if (q) clearChip();
  scene.setQuery(q);
  const n = scene.hits.size;
  el.qcount.textContent = q ? (n ? n + ' 本 · 回车跳过去' : '没有这本') : '';
});
el.q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const b = scene.firstHit();
    if (b) {
      scene.focusBook(b);
      scene.select(b, { x: innerWidth / 2, y: innerHeight / 2 });
      closeSearch();
    }
  }
});

addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  // 年表模式下，方向键 / T / Esc 走自己的逻辑，不与 3D 平移打架
  if (scene.view === 'timeline' && !readerBook) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); timeline?.prev(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); timeline?.next(); return; }
    if (e.key === 'Escape') { applyView('spines'); return; }
    if ((e.key === 't' || e.key === 'T') && !typing) { applyView('spines'); return; }
  }
  if (e.key === '/' && !typing) {
    e.preventDefault();
    openSearch();
  } else if ((e.key === 'l' || e.key === 'L') && !typing && !readerBook) {
    applyNight(!night);
  } else if ((e.key === 't' || e.key === 'T') && !typing && !readerBook && scene.view !== 'timeline') {
    applyView('timeline');
  } else if (e.key === 'Escape') {
    if (paperOpen) closePaper();
    else if (pickedDecor) scene.selectDecor(null);
    else if (trayOpen) closeTray();
    else if (searchOpen) closeSearch();
    else if (readerBook) closeBook();
    else if (scene.view === 'timeline') applyView('spines');
    else scene.select(null);
  } else if (!typing && !readerBook && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    scene.panTo(scene.panTarget + (e.key === 'ArrowLeft' ? -0.45 : 0.45));
  } else if (!typing && !readerBook && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0')) {
    // +/- 推近拉远，0 回到原来的取景
    if (e.key === '0') scene.setZoom(1);
    else scene.setZoom((scene.zoom || 1) * (e.key === '+' || e.key === '=' ? 0.86 : 1.16));
  }
});

/* ───────── 启动 ───────── */
async function boot() {
  renderDecorGrid();

  let status = { scope: 'owner' };
  try {
    status = await api('/api/status').then((r) => r.json());
  } catch {
    /* 拿不到状态就按房主处理 */
  }

  let lib;
  try {
    const res = await api('/api/library');
    lib = await res.json();
  } catch (err) {
    el.loading.innerHTML = '<span>书架加载失败</span>';
    console.error(err);
    return;
  }
  const books = lib.books || [];
  const scope = lib.scope || status.scope || 'owner';
  const qs = new URLSearchParams(location.search);
  if (qs.get('view') === 'covers') {
    scene.view = 'covers';
    syncToggle('covers');
  }
  if (qs.get('sort') === 'rating') {
    scene.sortBy = 'rating';
    syncSort('rating');
  }
  progress(0.2);

  // 先上架：书脊是画出来的，不用等网络
  const coverAtlas = createCoverAtlas(books);
  const spineTex = bakeSpines(books);
  progress(0.6);

  await scene.setLibrary(lib, { coverTex: coverAtlas.tex, spineTex });
  renderChips(scene.cats);

  // 年表视图：拿到整份 books 后才建（按读到年份分桶）
  timeline = createTimeline({ books, onOpen: openBook, esc });
  timeline.attach(el.tlStage);
  // 深链：?view=timeline 直接落进年表；?view=covers 沿用上面那段
  if (qs.get('view') === 'timeline') applyView('timeline');
  // 桌上那张纸：先按本地存档铺好，没写过就从最近读的那本里挑一句
  loadPaper();
  seedPaper().catch(() => {});
  // 地址栏里带着分类 / 桌子就直奔那里（分享出去的链接、刷新都落回同一处）
  const deep = readHash();
  if (deep) jumpToKey(deep);
  addEventListener('hashchange', () => {
    const k = readHash();
    if (k) jumpToKey(k);
  });
  applyRoomName(roomName, false);
  setRoomMeta(books.length, scope);
  // 摆件小样在空闲时先拍好，等用户点开抽屉就是实物图了
  ensureThumbs();
  try {
    applyNight(localStorage.getItem(LAMP_KEY) === '1', false);
  } catch {
    applyNight(false, false);
  }
  progress(1);
  requestAnimationFrame(() => {
    el.app.classList.add('ready');
    el.loading.style.opacity = '0';
  });

  // 操作提示：第一次来的人看一眼就知道怎么逛
  setTimeout(showHint, !store.get('bookshelf.hintSeen') ? 3600 : 1800);

  // 笔记概览随后到，不挡首屏；详情里会显示条数
  api('/api/nb')
    .then((r) => r.json())
    .then((m) => {
      if (m && !m.error) {
        noteCounts = m;
      }
    })
    .catch(() => {});

  // 封面随后一张张贴上去，不挡首屏
  fillCoverAtlas(coverAtlas, books, (p) => {
    if (p >= 1) {
      for (const b of books) b.paletteReady = true;
      scene.setSpineTexture(bakeSpines(books));
    }
  }).catch((err) => console.warn('封面加载中断', err));
}

boot();

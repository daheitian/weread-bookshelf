// 年表视图（Timeline）：把书架的书按「读到的年份」排成一条横向的书架长河。
// 纯 DOM，不碰 three.js；与 Spines / Covers 共享同一份 books，点书同样调用 openBook 翻开。
//
// 设计参照 bentossell.com/books：真实封面裁成书脊立在一排排木架上，大号年份，
// 底部一条按年份聚合、宽度随书量变化的轴上。拖动 / 滚轮横移，方向键跳年，点轴跳年。

const YEAR_NOW = new Date().getFullYear();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function yearOf(b) {
  const t = Number(b.addedAt || b.readAt || b.finishedDate || 0);
  return t ? new Date(t).getFullYear() : 'none';
}

function dateOf(b) {
  return Number(b.readAt || b.addedAt || b.finishedDate || 0);
}

function smallHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function statusText(b) {
  if (b.status === 'read') return '读完';
  if (b.progress > 0) return '在读 ' + b.progress + '%';
  return '想读';
}

export function createTimeline({ books = [], onOpen, esc: eFn } = {}) {
  const E = eFn || esc;

  // ── 按年份分桶：数字年份降序（最新在左），未记年垫底 ──
  const groups = new Map();
  for (const b of books) {
    const y = yearOf(b);
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(b);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === 'none') return 1;
    if (b === 'none') return -1;
    return b - a;
  });
  const byId = new Map(books.map((b) => [b.id, b]));
  for (const k of keys) groups.get(k).sort((a, b) => dateOf(b) - dateOf(a));

  const minYear = Math.min(...keys.filter((k) => k !== 'none'));
  const maxYear = Math.max(...keys.filter((k) => k !== 'none'), YEAR_NOW);

  // ── 骨架 ──
  const root = document.createElement('div');
  root.className = 'tl-inner';
  root.innerHTML = `
    <div class="tl-stats"></div>
    <div class="tl-scroll">
      <div class="tl-groups"></div>
      <div class="tl-axis"></div>
    </div>
    <div class="tl-now" aria-hidden="true"></div>
    <div class="tl-card" aria-hidden="true"></div>
  `;
  const scroll = root.querySelector('.tl-scroll');
  const groupsEl = root.querySelector('.tl-groups');
  const axisEl = root.querySelector('.tl-axis');
  const nowEl = root.querySelector('.tl-now');
  const cardEl = root.querySelector('.tl-card');
  const statsEl = root.querySelector('.tl-stats');

  statsEl.innerHTML =
    `${books.length} 本 · ${keys.length} 个年份 · ${Number.isFinite(minYear) ? minYear : '—'}–${maxYear}`;

  const secs = [];
  const ticks = [];
  for (const k of keys) {
    const list = groups.get(k);
    const label = k === 'none' ? '未记年' : String(k);
    const isNow = k === YEAR_NOW;

    const sec = document.createElement('section');
    sec.className = 'tl-group' + (isNow ? ' now' : '');
    sec.dataset.year = String(k);
    sec.innerHTML =
      `<div class="tl-year">${E(label)}</div>` +
      `<div class="tl-shelf">` +
      list
        .map((b) => {
          const pal = b.palette || { dominant: '#b3a894', text: '#f3ece0' };
          const bh = 138 + (smallHash(b.id) % 66); // 书高略带参差，像随手插回去的
          return (
            `<button class="tl-book" data-id="${E(b.id)}" ` +
            `style="--bh:${bh}px;--bg:${pal.dominant};--fg:${pal.text}" ` +
            `title="${E(b.title)} — ${E(b.author || '')}">` +
            `<span class="tl-spine"><span class="tl-spine-title">${E(b.title)}</span></span>` +
            `</button>`
          );
        })
        .join('') +
      `</div>` +
      `<div class="tl-count">${list.length} 本</div>`;
    groupsEl.appendChild(sec);
    secs.push(sec);

    const tick = document.createElement('div');
    tick.className = 'tl-tick' + (isNow ? ' now' : '');
    tick.dataset.year = String(k);
    tick.innerHTML = `<span>${E(label)}</span>`;
    tick.addEventListener('click', () => goTo(k));
    axisEl.appendChild(tick);
    ticks.push(tick);
  }

  // ── 滚动 / 拖动 ──
  let downX = 0, downY = 0, startLeft = 0, moved = false, suppress = false;
  scroll.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; startLeft = scroll.scrollLeft; moved = false; suppress = false;
  });
  scroll.addEventListener('pointermove', (e) => {
    if (e.buttons !== 1) return;
    const dx = e.clientX - downX, dy = e.clientY - downY;
    if (!moved && Math.hypot(dx, dy) > 6) moved = true;
    if (moved) scroll.scrollLeft = startLeft - dx;
  });
  scroll.addEventListener('pointerup', () => {
    if (moved) suppress = true;
  });
  scroll.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      scroll.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  // ── 点书 → 翻开 ──
  groupsEl.addEventListener('click', (e) => {
    if (suppress) { suppress = false; return; }
    const btn = e.target.closest('.tl-book');
    if (!btn) return;
    const b = byId.get(btn.dataset.id);
    if (b) onOpen?.(b, { x: e.clientX, y: e.clientY });
  });

  // ── 悬停浮卡 ──
  groupsEl.addEventListener('pointermove', (e) => {
    const btn = e.target.closest('.tl-book');
    if (!btn) { hideCard(); return; }
    const b = byId.get(btn.dataset.id);
    if (!b) { hideCard(); return; }
    showCard(btn, b);
  });
  groupsEl.addEventListener('pointerleave', hideCard);

  function showCard(btn, b) {
    const r = btn.getBoundingClientRect();
    cardEl.innerHTML =
      `<div class="tc-title">${E(b.title)}</div>` +
      (b.author ? `<div class="tc-author">${E(b.author)}</div>` : '') +
      `<div class="tc-meta">${E(statusText(b))}${b.categoryName ? ' · ' + E(b.categoryName) : ''}</div>`;
    cardEl.classList.add('show');
    const cw = cardEl.offsetWidth || 220;
    let x = r.left + r.width / 2 - cw / 2;
    x = Math.max(12, Math.min(innerWidth - cw - 12, x));
    const y = r.top - cardEl.offsetHeight - 12;
    cardEl.style.left = Math.round(x) + 'px';
    cardEl.style.top = Math.round(Math.max(12, y)) + 'px';
  }
  function hideCard() {
    cardEl.classList.remove('show');
  }

  // ── 当前年份标记 ──
  function setNow(y) {
    const n = groups.get(y === 'none' ? 'none' : Number(y))?.length || 0;
    nowEl.innerHTML = `<b>${y === 'none' ? '未记年' : y}</b><span>${n} 本</span>`;
  }
  function updateNow() {
    const y = currentYear();
    if (y) setNow(y);
  }
  scroll.addEventListener('scroll', updateNow, { passive: true });

  // 轴刻度宽度跟随分组实际宽度：分组按内容自适应（书脊数量决定），
  // 不再用手写宽度公式，resize / 字体加载后也能对齐。
  function syncTicks() {
    for (let i = 0; i < secs.length; i++) {
      if (secs[i] && ticks[i]) ticks[i].style.width = secs[i].offsetWidth + 'px';
    }
  }
  window.addEventListener('resize', () => { if (root.offsetParent) syncTicks(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (root.offsetParent) syncTicks(); });
  }

  // ── 公开方法 ──
  function goTo(key) {
    const sec = secs.find((s) => s.dataset.year === String(key));
    if (!sec) return;
    // 跳年是「定位」不是「浏览」：相邻年份组动辄几千像素，平滑滚会拖上近一秒，
    // 年份标记还会在中途闪烁。瞬时到位 + 同步刷新标记，拖拽/滚轮仍保留惯性。
    scroll.scrollTo({ left: Math.max(0, sec.offsetLeft - 64), behavior: 'auto' });
    setNow(String(key));
  }
  // 当前年份 = 左锚点（scrollLeft + 64）最近的分组，与 goTo 的对齐方式一致，
  // 这样「跳到下一年」后标记精确跟随，不会被宽视口把中心甩进邻组。
  function currentGroup() {
    const anchor = scroll.scrollLeft + 64;
    let best = null, bd = Infinity;
    for (const s of secs) {
      const d = Math.abs(s.offsetLeft - anchor);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? best.dataset.year : null;
  }
  function currentYear() {
    const y = currentGroup();
    return y;
  }
  function step(dir) {
    const cur = currentYear();
    const idx = keys.findIndex((k) => String(k) === String(cur));
    const ni = Math.max(0, Math.min(keys.length - 1, (idx < 0 ? 0 : idx) + (dir < 0 ? -1 : 1)));
    goTo(keys[ni]);
  }

  return {
    root,
    attach(parent) { parent.appendChild(root); },
    enter() {
      // 默认落在最新年份（最左），让一进来就是最近在读的。
      // 同步执行：切到年表时 #tlStage 刚变 display:block，读 offsetLeft 会强制 reflow，
      // 布局已就绪；不依赖 rAF（display 切换后的首个 rAF 在部分浏览器会延迟派发）。
      syncTicks();
      goTo(keys[0]);
      updateNow();
    },
    exit() { hideCard(); },
    goTo,
    next() { step(1); },
    prev() { step(-1); },
    currentYear,
    get years() { return keys.map((k) => String(k)); },
  };
}

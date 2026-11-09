// 年表视图端到端验证：桌面 + 移动，覆盖切换 / 分组 / 滚动 / 轴跳年 / 点书翻开 / 深链 / T 键 / 重叠。
// 用法：先 npm start，再 npm test（可选 BASE=http://localhost:4599 / BROWSER_CHANNEL=msedge）
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4599';
const browser = await chromium.launch({
  ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
  args: ['--no-proxy-server', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--in-process-gpu'],
});

const results = [];
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ·  ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(ctx) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  await p.route('**/api/cover*', (r) => r.abort());
  return { p, errs };
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.2 });
const { p, errs } = await newPage(ctx);

/* ── 0. 准备好：等首屏，统计年份数 ── */
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => document.querySelector('.app')?.classList.contains('ready'), { timeout: 120000 });
await wait(1500);
const meta = await p.evaluate(() => {
  const yrs = new Set(window.__scene.books.map((b) => {
    const t = Number(b.addedAt || b.readAt || b.finishedDate || 0);
    return t ? new Date(t).getFullYear() : 'none';
  }));
  return { yearCount: yrs.size, bookCount: window.__scene.books.length };
});
const yearCount = meta.yearCount;
const bookCount = meta.bookCount;

/* ── 1. 默认 spines → 点胶囊进 timeline ── */
await p.click('[data-view="timeline"]');
await wait(800);
let tl = await p.evaluate(() => {
  const stage = document.querySelector('#tlStage');
  const scroll = document.querySelector('.tl-scroll');
  return {
    visible: getComputedStyle(stage).display !== 'none',
    showClass: document.querySelector('.app').classList.contains('show-timeline'),
    groups: document.querySelectorAll('.tl-group').length,
    ticks: document.querySelectorAll('.tl-tick').length,
    scrollW: scroll.scrollWidth, clientW: scroll.clientWidth,
    now: document.querySelector('.tl-now')?.textContent?.trim() || '',
    stats: document.querySelector('.tl-stats')?.textContent?.trim() || '',
    books: document.querySelectorAll('.tl-book').length,
  };
});
ok('timeline 显示', tl.visible && tl.showClass);
ok('分组数 == 年份数', tl.groups === yearCount, `groups=${tl.groups} years=${yearCount}`);
ok('轴刻度 == 分组数', tl.ticks === tl.groups, `ticks=${tl.ticks}`);
ok('横向可滚动', tl.scrollW > tl.clientW, `scrollW=${tl.scrollW} clientW=${tl.clientW}`);
ok('书都渲染出来', tl.books === bookCount, `books=${tl.books}/${bookCount}`);
ok('当前年份标记有内容', /\d{4}|未记年/.test(tl.now), tl.now);
ok('统计条有内容', /本/.test(tl.stats), tl.stats);

/* ── 2. 方向键跳年（按当前年份标记判定，避免宽视口下像素读数抖动） ── */
const y0 = await p.evaluate(() => document.querySelector('.tl-now')?.textContent?.trim());
await p.keyboard.press('ArrowRight'); await wait(1100);
const yr = await p.evaluate(() => document.querySelector('.tl-now')?.textContent?.trim());
ok('→ 键跳到下一年', yr !== y0, `from ${y0} → ${yr}`);
await p.keyboard.press('ArrowLeft'); await wait(1100);
const yb = await p.evaluate(() => document.querySelector('.tl-now')?.textContent?.trim());
ok('← 键跳回上一年', yb === y0, `back to ${yb} (was ${y0})`);

/* ── 3. 点轴刻度跳年 ── */
const jump = await p.evaluate(() => {
  const ticks = [...document.querySelectorAll('.tl-tick')];
  const t = ticks[Math.floor(ticks.length / 2)];
  const y = t.dataset.year;
  const before = document.querySelector('.tl-scroll').scrollLeft;
  t.click();
  return { y, before, left: document.querySelector('.tl-scroll').scrollLeft };
});
await wait(700);
const afterJump = await p.evaluate(() => ({ now: document.querySelector('.tl-now')?.textContent?.trim(), left: document.querySelector('.tl-scroll').scrollLeft }));
// 「未记年」组的 data-year 是 none，但显示文本是中文；按标签判定而不是原始 key
const jumpLabel = jump.y === 'none' ? '未记年' : jump.y;
ok('点轴跳年', afterJump.now.includes(jumpLabel) || afterJump.left !== jump.before,
  `target=${jumpLabel} now="${afterJump.now}" left ${jump.before}→${afterJump.left}`);

/* ── 4. 点书 → 翻开读者 → Esc 合上 ── */
await p.evaluate(() => document.querySelector('.tl-book')?.click());
await wait(900);
const opened = await p.evaluate(() => ({
  reading: document.querySelector('.app').classList.contains('reading'),
  readerShow: document.querySelector('#reader').classList.contains('show'),
  title: document.querySelector('#pgL .tt-1')?.textContent?.trim() || '',
}));
ok('点书翻开读者', opened.reading && opened.readerShow, opened.title);
await p.keyboard.press('Escape'); await wait(500);
ok('Esc 合上读者', await p.evaluate(() => !document.querySelector('.app').classList.contains('reading')));

/* ── 5. Esc 退出年表，T 进 / T 退 ── */
await p.keyboard.press('Escape'); await wait(500);
ok('Esc 退出年表到 3D', await p.evaluate(() => !document.querySelector('.app').classList.contains('show-timeline')));
await p.keyboard.press('t'); await wait(500);
ok('T 进入年表', await p.evaluate(() => document.querySelector('.app').classList.contains('show-timeline')));
await p.keyboard.press('t'); await wait(500);
ok('T 退出年表', await p.evaluate(() => !document.querySelector('.app').classList.contains('show-timeline')));

/* ── 6. 深链 ?view=timeline 刷新保持 ── */
await p.goto(BASE + '/?view=timeline', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => document.querySelector('.app')?.classList.contains('ready'), { timeout: 120000 });
await wait(1200);
const deep = await p.evaluate(() => ({
  show: document.querySelector('.app').classList.contains('show-timeline'),
  toggleOn: document.querySelector('[data-view="timeline"]').classList.contains('on'),
  groups: document.querySelectorAll('.tl-group').length,
}));
ok('深链直接进入年表', deep.show && deep.toggleOn, `groups=${deep.groups}`);

/* ── 7. 移动端 390×844 ── */
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const { p: mp, errs: merrs } = await newPage(mctx);
await mp.goto(BASE + '/?view=timeline', { waitUntil: 'domcontentloaded' });
await mp.waitForFunction(() => document.querySelector('.app')?.classList.contains('ready'), { timeout: 120000 });
await mp.waitForTimeout(1200);
const mob = await mp.evaluate(() => {
  const scroll = document.querySelector('.tl-scroll');
  const toggle = document.querySelector('#viewToggle').getBoundingClientRect();
  const axis = document.querySelector('.tl-axis').getBoundingClientRect();
  const stats = document.querySelector('.tl-stats').getBoundingClientRect();
  return {
    groups: document.querySelectorAll('.tl-group').length,
    scrollW: scroll.scrollWidth, clientW: scroll.clientWidth,
    overlapToggleAxis: !(toggle.right < axis.left || toggle.left > axis.right || toggle.bottom < axis.top || toggle.top > axis.bottom),
    toggleBottom: Math.round(toggle.bottom), axisTop: Math.round(axis.top),
  };
});
ok('移动端分组存在', mob.groups > 0, `groups=${mob.groups}`);
ok('移动端可滚动', mob.scrollW > mob.clientW, `scrollW=${mob.scrollW} clientW=${mob.clientW}`);
ok('视图胶囊不压轴', !mob.overlapToggleAxis, `toggleBottom=${mob.toggleBottom} axisTop=${mob.axisTop}`);

/* ── 汇总 ── */
console.log('\n── Timeline E2E ──');
for (const r of results) console.log(r);
console.log('\npage errors (desktop):', errs.length ? errs.slice(0, 8) : 'none');
console.log('page errors (mobile):', merrs.length ? merrs.slice(0, 8) : 'none');

await browser.close();

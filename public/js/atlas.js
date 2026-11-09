// 把 500 张封面 + 程序化书脊烘成两张图集：整面书架只需要 2 次贴图绑定。
import * as THREE from './three.module.js';

export const COVER_ATLAS = { size: 4096, cw: 128, ch: 184, cols: 32, rows: 22 };
// 书脊格子：48×256。脊宽只有 48px，但字号要占到四成，推近才读得出书名；
// 一列 85 格、八行，够 680 本用（超过的会退回到最后一格，不会整排变黑）。
export const SPINE_ATLAS = { size: 4096, h: 2048, cw: 48, ch: 256, cols: 85, rows: 8 };

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rnd = (h, n) => ((h >>> (n % 19)) % 1000) / 1000;

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function coverSrc(book) {
  return book.cover ? '/api/cover?u=' + encodeURIComponent(book.cover) : '';
}

// 取封面的代表色：直方图挑「最像这本书」的饱和色，而不是把整张图平均成一团灰
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}
function hsl2rgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const hexOf = (rgb, k = 1) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0')).join('');

function paletteOf(img, seed) {
  const fallback = ['#7d3a34', '#33506b', '#3f5a42', '#7a5a2e', '#4a3f66', '#8a4a2c'];
  if (!img) return { dominant: fallback[seed % fallback.length], accent: fallback[(seed + 2) % fallback.length], text: '#f3ece0' };
  const c = document.createElement('canvas');
  c.width = 20;
  c.height = 28;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, 20, 28);
  const d = x.getImageData(0, 0, 20, 28).data;
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2], A = d[i + 3];
    if (A < 200) continue;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mx > 246 && mn > 240) continue;
    if (mx < 16) continue;
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const key = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4);
    const cur = bins.get(key);
    const w = 0.12 + sat * sat * 3.4;
    if (cur) {
      cur.r += R; cur.g += G; cur.b += B; cur.w += w; cur.n += 1;
    } else bins.set(key, { r: R, g: G, b: B, w, n: 1 });
  }
  if (!bins.size) return { dominant: fallback[seed % fallback.length], accent: fallback[(seed + 2) % fallback.length], text: '#f3ece0' };
  let best = null;
  for (const v of bins.values()) if (!best || v.w > best.w) best = v;
  const r = best.r / best.n, g = best.g / best.n, b = best.b / best.n;
  let [h, sv, l] = rgb2hsl(r, g, b);
  sv = Math.max(0.1, Math.min(0.62, sv * 1.12 + 0.05));
  l = Math.max(0.12, Math.min(0.46, l * 0.7 + 0.14));
  const dom = hsl2rgb(h, sv, l);
  const accent = hsl2rgb((h + 0.045) % 1, Math.min(0.9, sv + 0.08), Math.max(0.14, l - 0.16));
  return {
    dominant: hexOf(dom),
    accent: hexOf(accent),
    text: l > 0.42 ? '#2b2620' : '#f3ece0',
  };
}

function drawCoverFit(ctx, img, x, y, w, h) {
  const ar = img.width / img.height;
  const tr = w / h;
  let dw = w;
  let dh = h;
  if (ar > tr) dw = h * ar;
  else dh = w / ar;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function wrap(ctx, text, maxWidth, maxLines) {
  const out = [];
  let line = '';
  for (const ch of text) {
    const t = line + ch;
    if (ctx.measureText(t).width > maxWidth && line) {
      out.push(line);
      line = ch;
      if (out.length >= maxLines) break;
    } else line = t;
  }
  if (line && out.length < maxLines) out.push(line);
  return out;
}

function placeholder(ctx, book, x, y, w, h, pal) {
  ctx.fillStyle = pal.dominant;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  ctx.fillRect(x, y, w, h * 0.26);
  ctx.fillStyle = pal.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = Math.max(9, Math.min(15, 128 / Math.max(6, book.title.length) * 2.4));
  ctx.font = `500 ${fs}px "EB Garamond", Georgia, serif`;
  const lines = wrap(ctx, book.title, w - 18, 4);
  const lh = fs * 1.35;
  let ty = y + h * 0.44 - ((lines.length - 1) * lh) / 2;
  for (const l of lines) {
    ctx.fillText(l, x + w / 2, ty);
    ty += lh;
  }
  ctx.font = `400 8px "Inter Tight", sans-serif`;
  ctx.globalAlpha = 0.7;
  ctx.fillText((book.author || '').slice(0, 12), x + w / 2, y + h - 16);
  ctx.globalAlpha = 1;
}

// 先建一张空图集：格子位置按序号算好，书先按书脊排上架，封面随后一张张填进来
export function createCoverAtlas(books) {
  const A = COVER_ATLAS;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = A.size;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#e3dbcb';
  ctx.fillRect(0, 0, A.size, A.size);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  books.forEach((b, idx) => {
    const col = idx % A.cols;
    const row = Math.floor(idx / A.cols);
    if (row >= A.rows) return;
    const x = col * A.cw;
    const y = row * A.ch;
    b.palette = { dominant: '#b3a894', accent: '#7d7566', text: '#f3ece0' };
    placeholder(ctx, b, x + 1, y + 1, A.cw - 2, A.ch - 2, b.palette);
    b.uvC = [(x + 1.5) / A.size, 1 - (y + A.ch - 1.5) / A.size, (A.cw - 3) / A.size, (A.ch - 3) / A.size];
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return { canvas, ctx, tex };
}

export async function fillCoverAtlas(atlas, books, onProgress) {
  const A = COVER_ATLAS;
  const ctx = atlas.ctx;
  const total = books.length;
  const BATCH = 10;
  let done = 0;
  for (let i = 0; i < total; i += BATCH) {
    const slice = books.slice(i, i + BATCH);
    const imgs = await Promise.all(slice.map((b) => (b.cover ? loadImage(coverSrc(b)) : Promise.resolve(null))));
    slice.forEach((b, k) => {
      const idx = i + k;
      const col = idx % A.cols;
      const row = Math.floor(idx / A.cols);
      if (row >= A.rows) return;
      const x = col * A.cw;
      const y = row * A.ch;
      const img = imgs[k];
      const pal = paletteOf(img, hash(b.id));
      b.palette = pal;
      if (img) drawCoverFit(ctx, img, x + 1, y + 1, A.cw - 2, A.ch - 2);
      else placeholder(ctx, b, x + 1, y + 1, A.cw - 2, A.ch - 2, pal);
    });
    done += slice.length;
    atlas.tex.needsUpdate = true;
    onProgress?.(done / total);
  }
  atlas.tex.needsUpdate = true;
}

// 真书架上，米白和深色占了大多数，彩色是点缀
const SPINE_PALETTE = [
  '#e8dec6', '#efe7d4', '#ddd0b4', '#f0e8d6', '#d8cbb0',
  '#2a2724', '#1b1c20', '#22282f', '#3a3a38', '#141414',
  '#8c3a32', '#a5352a', '#c05a33', '#b8802f', '#c9a53c',
  '#6f7f47', '#3f6b56', '#2f5f6e', '#33506b', '#2b3a5c',
  '#5a4470', '#7a3f5c', '#8a2f42', '#9c8f7a', '#b9a88d',
];

function spineStyle(book) {
  const h = hash(book.id + 'spine');
  const pal = book.palette || { dominant: '#6a5a44', accent: '#40382c', text: '#f3ece0' };
  const roll = h % 100;

  // 三成多是纸色书脊
  if (roll < 40) {
    const bg = ['#e9e0c9', '#eee5d0', '#e2d7bd', '#f1e9d8'][h % 4];
    return { bg, fg: '#37312a', band: SPINE_PALETTE[10 + ((h >>> 5) % 12)], style: 'paper' };
  }
  // 近两成是黑／深灰／藏青的精装书
  if (roll < 64) {
    const bg = ['#2a2724', '#1b1c20', '#232b36', '#141414'][h % 4];
    return { bg, fg: '#c9b391', band: '#c9b391', style: 'dark' };
  }

  const base = SPINE_PALETTE[12 + (h % 13)];
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // 保持饱和度，只把明度收进印刷油墨的区间，别整排发灰
  c.setHSL(hsl.h, Math.min(0.56, hsl.s * 1.05), Math.max(0.15, Math.min(0.37, hsl.l)));
  const bg = '#' + c.getHexString();
  const fg = hsl.l > 0.34 ? '#2a241e' : '#f2ecdf';
  if (roll < 62) return { bg, fg, band: 'rgba(255,255,255,.22)', style: 'band' };
  return { bg, fg, band: 'rgba(255,255,255,.34)', style: 'rule' };
}

export function spineColor(book) {
  return spineStyle(book).bg;
}

export function bakeSpines(books) {
  const A = SPINE_ATLAS;
  const canvas = document.createElement('canvas');
  canvas.width = A.size;
  canvas.height = A.h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#d8cfbd';
  ctx.fillRect(0, 0, A.size, A.h);

  books.forEach((b, idx) => {
    // 书太多、格子不够时，后面的书退回到最后一格 —— 至少是一根正常的书脊
    const cell = Math.min(idx, A.cols * A.rows - 1);
    const col = cell % A.cols;
    const row = Math.floor(cell / A.cols);
    const x = col * A.cw;
    const y = row * A.ch;
    const w = A.cw;
    const h = A.ch;
    const st = spineStyle(b);

    ctx.fillStyle = st.bg;
    ctx.fillRect(x, y, w, h);

    if (st.style === 'band') {
      ctx.fillStyle = st.band;
      ctx.fillRect(x, y + h * 0.045, w, h * 0.04);
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      ctx.fillRect(x, y + h * 0.9, w, h * 0.04);
    } else if (st.style === 'rule') {
      ctx.fillStyle = st.band;
      ctx.fillRect(x + 5, y + 14, w - 10, 2);
      ctx.fillRect(x + 5, y + h - 16, w - 10, 2);
    } else if (st.style === 'paper') {
      ctx.fillStyle = st.band;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y + 5, w, 6);
      ctx.globalAlpha = 1;
    }

    // 书脊的圆柱感：两侧压暗、中间提亮。
    // 之前压得太狠（0.34 / 0.42），书名正好落在暗边上，推到跟前也发灰。
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, 'rgba(0,0,0,.26)');
    g.addColorStop(0.16, 'rgba(255,255,255,.14)');
    g.addColorStop(0.45, 'rgba(255,255,255,.02)');
    g.addColorStop(0.8, 'rgba(0,0,0,.07)');
    g.addColorStop(1, 'rgba(0,0,0,.3)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // 竖排书名：字号占脊宽四成，再用一道细描边把笔画撑起来；
    // 太长就先缩字号，缩到底还放不下才截断加省略号。
    const title = b.title.replace(/\s+/g, ' ').trim();
    const serif = '"EB Garamond", "Songti SC", "STSong", "SimSun", Georgia, serif';
    ctx.save();
    ctx.translate(x + w / 2, y + h * 0.5 + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = st.fg;
    ctx.strokeStyle = st.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.96;
    const maxW = h - 74;
    let fs = 21;
    ctx.font = `500 ${fs}px ${serif}`;
    while (fs > 14 && ctx.measureText(title).width > maxW) {
      fs -= 1;
      ctx.font = `500 ${fs}px ${serif}`;
    }
    let t = title;
    while (t.length > 2 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
    if (t !== title) t = t.slice(0, -1) + '…';
    ctx.lineWidth = Math.max(0.7, fs * 0.05);
    ctx.lineJoin = 'round';
    ctx.strokeText(t, 0, 0);
    ctx.fillText(t, 0, 0);
    ctx.restore();

    // 作者小字
    ctx.save();
    ctx.translate(x + w / 2, y + h - 34);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = st.fg;
    ctx.globalAlpha = 0.56;
    ctx.font = '400 9px "Inter Tight", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((b.author || '').replace(/\[.*?\]/g, '').slice(0, 12), 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;

    const u = (x + 1) / A.size;
    const v = 1 - (y + h - 1) / A.h;
    b.uvS = [u, v, (w - 2) / A.size, (h - 2) / A.h];
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

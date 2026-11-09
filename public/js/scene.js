// 3D 书架场景：一间屋子、一面木书柜、几百本真书。
// 木作尺寸照真实的柜子来（毫米级），排版规则也照真实书架的习惯：
// 每个分类先用一本正面朝外的书起头，中间一排书脊，末尾一小摞躺平的书。
import * as THREE from './three.module.js';
import { spineColor } from './atlas.js';

const DEG = Math.PI / 180;

export const S = {
  sidePad: 0.01, // 格内左右留白
  spineInset: 0.018, // 书脊比层板前沿缩进多少
  bookGap: 0.0008, // 书与书之间的缝
  leanDeg: 7, // 靠着的书倾斜角度
};

// 两种视图其实是两套木作：书脊视图是密排的高柜，封面视图是宽格的书报架
export const GEO = {
  spines: {
    rows: 5, compW: 0.84, compH: 0.318, panel: 0.024, depth: 0.32,
    plinth: 0.078, top: 0.04, fill: 0.9, lip: false,
  },
  covers: {
    rows: 6, compW: 1.16, compH: 0.312, panel: 0.024, depth: 0.18,
    plinth: 0.078, top: 0.04, fill: 0.93, lip: true,
  },
};

const CAM = { fov: 30, y: 1.1, lookY: 1.1, offsetX: 0.42 };

const slugOf = (name) =>
  name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'x';

const hashOf = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const rnd = (h, n = 0) => ((h >>> (n % 17)) % 1000) / 1000;

function mutedColor(hex, amount = 0.45) {
  const c = new THREE.Color(hex || '#6a5a44');
  const paper = new THREE.Color('#ded3bd');
  return c.lerp(paper, amount);
}

/* ───────────── 程序化纹理 ───────────── */
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

// 灰米色的抹灰墙：站远看几乎是一块整色，凑近才有颗粒

/* ───────────── 摆件：共用材质与小贴图 ───────────── */
// 摆件都复用同一批材质，几十件东西也不会多编译几十个 shader
const DMAT = new Map();
function dmat(color, opts = {}) {
  const k = color + '|' + JSON.stringify(opts);
  let m = DMAT.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...opts });
    DMAT.set(k, m);
  }
  return m;
}

let _globeTex = null;
function globeTex() {
  if (_globeTex) return _globeTex;
  _globeTex = canvasTex(768, 384, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#35606a');
    g.addColorStop(0.5, '#2c5560');
    g.addColorStop(1, '#35606a');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    // 大陆：一团团不规则色块拼出来，远看够用
    const land = ['#7d9068', '#6f8560', '#8a9a72'];
    const blobs = [
      [0.18, 0.3, 90], [0.24, 0.52, 70], [0.3, 0.72, 55],
      [0.46, 0.26, 80], [0.5, 0.42, 95], [0.52, 0.62, 65],
      [0.68, 0.34, 88], [0.74, 0.56, 72], [0.84, 0.28, 60],
      [0.12, 0.44, 46], [0.6, 0.78, 40],
    ];
    for (const [cx, cy, r] of blobs) {
      x.fillStyle = land[Math.floor(r) % 3];
      x.beginPath();
      for (let i = 0; i <= 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const rr = r * (0.62 + ((i * 37) % 13) / 22);
        const px = cx * w + Math.cos(a) * rr;
        const py = cy * h + Math.sin(a) * rr * 0.72;
        if (i === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.closePath();
      x.fill();
    }
    // 极冠
    x.fillStyle = 'rgba(240,244,240,0.9)';
    x.fillRect(0, 0, w, 22);
    x.fillRect(0, h - 22, w, 22);
    // 经纬网
    x.strokeStyle = 'rgba(232,240,232,0.16)';
    x.lineWidth = 1.6;
    for (let i = 1; i < 12; i++) {
      x.beginPath();
      x.moveTo((i / 12) * w, 0);
      x.lineTo((i / 12) * w, h);
      x.stroke();
    }
    for (let i = 1; i < 6; i++) {
      x.beginPath();
      x.moveTo(0, (i / 6) * h);
      x.lineTo(w, (i / 6) * h);
      x.stroke();
    }
  });
  return _globeTex;
}

let _clockTex = null;
function clockTex() {
  if (_clockTex) return _clockTex;
  _clockTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#f7f0de';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(120,98,66,0.5)';
    x.lineWidth = 3;
    x.beginPath();
    x.arc(128, 128, 120, 0, 6.3);
    x.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      x.strokeStyle = i % 3 === 0 ? 'rgba(74,58,38,0.85)' : 'rgba(74,58,38,0.45)';
      x.lineWidth = i % 3 === 0 ? 4 : 2;
      x.beginPath();
      x.moveTo(128 + Math.cos(a) * 104, 128 + Math.sin(a) * 104);
      x.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116);
      x.stroke();
    }
    // 十点十分
    x.strokeStyle = '#4a3a26';
    x.lineCap = 'round';
    x.lineWidth = 5;
    x.beginPath();
    x.moveTo(128, 128);
    x.lineTo(128 + Math.cos(-1.05) * 56, 128 + Math.sin(-1.05) * 56);
    x.stroke();
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(128, 128);
    x.lineTo(128 + Math.cos(-0.35) * 84, 128 + Math.sin(-0.35) * 84);
    x.stroke();
    x.fillStyle = '#4a3a26';
    x.beginPath();
    x.arc(128, 128, 6, 0, 6.3);
    x.fill();
  });
  return _clockTex;
}

function plasterTex() {
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#e2dbcb';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const r = Math.random() * 1.5;
      const dark = Math.random() > 0.48;
      x.fillStyle = dark
        ? `rgba(150,140,124,${0.05 + Math.random() * 0.09})`
        : `rgba(252,248,238,${0.05 + Math.random() * 0.1})`;
      x.beginPath();
      x.arc(Math.random() * w, Math.random() * h, r, 0, 6.3);
      x.fill();
    }
    // 大块的云状不均。每块在九个方向上重复画一遍，贴图才能无缝拼，不然墙上会有竖缝
    for (let i = 0; i < 34; i++) {
      const cx = Math.random() * w;
      const cy = Math.random() * h;
      const r = 50 + Math.random() * 130;
      const a = 0.03 + Math.random() * 0.05;
      const light = Math.random() > 0.5;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r);
          g.addColorStop(0, light ? `rgba(255,252,244,${a})` : `rgba(168,158,140,${a})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g;
          x.fillRect(0, 0, w, h);
        }
      }
    }
  }, [4, 1.2]);
}

// 人字/错缝的实木地板
function floorTex() {
  return canvasTex(1024, 1024, (x, w, h) => {
    x.fillStyle = '#a87f52';
    x.fillRect(0, 0, w, h);
    const cols = 4;
    const rows = 26;
    const pw = w / cols;
    const ph = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const seed = r * 31 + c * 17;
        const tone = 0.9 + ((seed % 11) / 11) * 0.2;
        const R = Math.round(172 * tone);
        const G = Math.round(133 * tone);
        const B = Math.round(93 * tone);
        const off = ((r * 7) % 4) * (pw / 4);
        const px = c * pw + off - pw / 2;
        const py = r * ph;
        x.fillStyle = `rgb(${R},${G},${B})`;
        x.fillRect(px + 1.5, py + 1, pw - 3, ph - 2);
        // 木纹
        for (let k = 0; k < 9; k++) {
          const yy = py + 3 + Math.random() * (ph - 6);
          x.strokeStyle = `rgba(${R - 34},${G - 28},${B - 20},${0.05 + Math.random() * 0.12})`;
          x.lineWidth = 0.7 + Math.random() * 1.6;
          x.beginPath();
          x.moveTo(px + 2, yy);
          x.bezierCurveTo(px + pw * 0.35, yy + (Math.random() - 0.5) * 4, px + pw * 0.7, yy + (Math.random() - 0.5) * 4, px + pw - 2, yy + (Math.random() - 0.5) * 3);
          x.stroke();
        }
        // 板缝
        x.strokeStyle = 'rgba(96,70,44,0.5)';
        x.lineWidth = 2;
        x.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
      }
    }
  }, [8, 4]);
}

// 阅读角那块地毯：米色底 + 细密的织纹 + 一圈深色包边
function rugTex() {
  return canvasTex(768, 512, (x, w, h) => {
    x.fillStyle = '#cbbca4';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const yy = Math.random() * h;
      const tone = 0.82 + Math.random() * 0.32;
      x.strokeStyle = `rgba(${Math.round(180 * tone)},${Math.round(160 * tone)},${Math.round(130 * tone)},0.5)`;
      x.lineWidth = 1 + Math.random() * 1.6;
      x.beginPath();
      x.moveTo(0, yy);
      x.lineTo(w, yy + (Math.random() - 0.5) * 2);
      x.stroke();
    }
    // 纬线方向的细纹，凑近才看得出是织的
    for (let i = 0; i < 220; i++) {
      const xx = Math.random() * w;
      x.strokeStyle = 'rgba(150,132,106,0.16)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(xx, 0);
      x.lineTo(xx, h);
      x.stroke();
    }
    x.strokeStyle = 'rgba(122,104,80,0.5)';
    x.lineWidth = 10;
    x.strokeRect(18, 18, w - 36, h - 36);
    x.strokeStyle = 'rgba(122,104,80,0.28)';
    x.lineWidth = 3;
    x.strokeRect(34, 34, w - 68, h - 68);
  });
}

function marbleTex() {
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#efece5';
    x.fillRect(0, 0, w, h);
    // Carrara 的灰脉：几条粗细不一的斜线，走得慢、拐得软
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = `rgba(${140 + Math.random() * 30},${138 + Math.random() * 28},${132 + Math.random() * 26},${0.1 + Math.random() * 0.22})`;
      x.lineWidth = 0.6 + Math.random() * 3.4;
      x.beginPath();
      let px = -40 + Math.random() * (w + 80);
      let py = -30;
      x.moveTo(px, py);
      while (py < h + 30) {
        py += 24 + Math.random() * 46;
        px += (Math.random() - 0.5) * 46;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    // 细碎的灰点，让表面不寡淡
    for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(150,146,138,${Math.random() * 0.13})`;
      x.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
    }
  });
}

function woodTex(base = [104, 66, 40], repeat = [2, 2]) {
  return canvasTex(512, 512, (x, w, h) => {
    const [r, g, b] = base;
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 170; i++) {
      const yy = Math.random() * h;
      const wid = 1 + Math.random() * 3.4;
      const dark = Math.random() > 0.42;
      x.strokeStyle = dark
        ? `rgba(${r - 44},${g - 30},${b - 16},${0.1 + Math.random() * 0.32})`
        : `rgba(${r + 44},${g + 30},${b + 16},${0.04 + Math.random() * 0.12})`;
      x.lineWidth = wid;
      x.beginPath();
      x.moveTo(0, yy);
      x.bezierCurveTo(w * 0.3, yy + (Math.random() - 0.5) * 20, w * 0.7, yy + (Math.random() - 0.5) * 20, w, yy + (Math.random() - 0.5) * 12);
      x.stroke();
    }
    // 纵向的板缝
    for (let i = 0; i <= 1; i++) {
      x.fillStyle = 'rgba(0,0,0,.2)';
      x.fillRect((i * w) / 2 - 1, 0, 2, h);
    }
  }, repeat);
}

/* ───────────── 书本实例几何 ───────────── */
// 局部坐标：X = 书脊方向的厚度？不。X 方向是「书脊面」所在的一侧（-X 是书脊），
// Y 是书高，Z 是封面法线。实例化时靠旋转把三者摆到需要的位置。
function bookGeometry() {
  const pos = [];
  const nor = [];
  const uv = [];
  const push = (corners, n, uvs = null) => {
    const u = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...corners[k]);
      nor.push(...n);
      uv.push(...u[k]);
    }
  };
  const h = 0.5;
  push([[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], [0, 0, 1]); // 封面
  push([[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]], [0, 0, -1], [[1, 0], [0, 0], [0, 1], [1, 1]]); // 封底
  push([[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]], [-1, 0, 0]); // 书脊
  push([[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]], [1, 0, 0]); // 书口
  push([[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]], [0, 1, 0]); // 上切口
  push([[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]], [0, -1, 0]); // 下切口

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, 12, 0); // 封面 + 封底
  g.addGroup(12, 6, 1); // 书脊
  g.addGroup(18, 18, 2); // 纸页
  return g;
}

function uvPatch(mat, name) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 ${name};
attribute float aBayTop;
attribute float aBayH;
varying float vGlow;`
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
  // 暗藏灯带在每格顶上：越靠上越亮，往下慢慢掉进暗处
  {
    vec4 iw = instanceMatrix * vec4(position, 1.0);
    float wy = (modelMatrix * iw).y;
    float t = clamp(1.0 - (aBayTop - wy) / max(aBayH, 0.0001), 0.0, 1.0);
    vGlow = 0.09 + 0.91 * pow(t, 1.25);
  }
#ifdef USE_MAP
  vMapUv = ${name}.xy + vMapUv * ${name}.zw;
#endif
#ifdef USE_EMISSIVEMAP
  vEmissiveMapUv = ${name}.xy + vEmissiveMapUv * ${name}.zw;
#endif`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',         `#include <common>
varying float vGlow;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance *= vGlow;`
      );
  };
  mat.customProgramCacheKey = () => 'uvrect-' + name;
  return mat;
}

// 三种摆法
const YAW_90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
// 躺平：书脊朝外（+Z）、封面朝上（+Y）、书高沿 X 轴
const FLAT = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0)
  )
);
// 摊在桌上：封面朝上（+Y）、书顶朝里（-Z），像刚从包里拿出来放平
const FLAT_UP = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, 0)
  )
);
const YAW_Q = new THREE.Quaternion();
const YA = new THREE.Vector3(0, 1, 0);

// 两张矮桌的尺寸照参考站来（毫米换算成米）：
// 在读那张最靠左、更高更小；想读那张紧挨着柜子、更宽，书是摞起来的
export const TABLES = {
  reading: { x: -2.4, z: 0.54, w: 1.04, d: 0.56, h: 0.46, books: 10, cols: 5 },
  want: { x: -1.01, z: 0.47, w: 1.34, d: 0.6, h: 0.42, books: 88 },
};

/* 摆件预设：抽屉里按这个顺序排，图标只是给一眼认出来 */
export const DECOR_KINDS = [
  { id: 'bust', name: '石膏头像', icon: '🗿' },
  { id: 'globe', name: '地球仪', icon: '🌍' },
  { id: 'plant', name: '小盆栽', icon: '🪴' },
  { id: 'vase', name: '白瓷瓶', icon: '🏺' },
  { id: 'bowl', name: '陶碗', icon: '🥣' },
  { id: 'stones', name: '叠石', icon: '🪨' },
  { id: 'hourglass', name: '沙漏', icon: '⌛' },
  { id: 'frame', name: '木相框', icon: '🖼' },
  { id: 'candle', name: '黄铜烛台', icon: '🕯' },
  { id: 'clock', name: '台钟', icon: '🕰' },
  { id: 'quill', name: '羽毛笔', icon: '🪶' },
  { id: 'lamp', name: '台灯', icon: '💡' },
  { id: 'dryflower', name: '干花', icon: '🌾' },
  { id: 'lavender', name: '薰衣草', icon: '💐' },
  { id: 'telescope', name: '望远镜', icon: '🔭' },
  { id: 'horse', name: '马首雕像', icon: '🐴' },
  { id: 'torso', name: '大理石躯干', icon: '🗽' },
  { id: 'corkboard', name: '软木板', icon: '📌' },
  { id: 'camera', name: '相机', icon: '📷' },
  { id: 'bear', name: '泰迪熊', icon: '🧸' },
  { id: 'cat', name: '卧猫', icon: '🐈' },
  { id: 'capital', name: '科林斯柱头', icon: '🏛' },
  { id: 'heart', name: '爱心相框', icon: '💗' },
  { id: 'nightlight', name: '氛围灯', icon: '🟠' },
  { id: 'gift', name: '礼品盒', icon: '🎁' },
  { id: 'headphone', name: '耳机', icon: '🎧' },
  { id: 'polaroid', name: '宝丽来', icon: '🎞' },
  { id: 'tree', name: '小圣诞树', icon: '🎄' },
];

/* ───────────── 墙上的海报：包豪斯 / 现代主义那几张 ───────────── */
// 全是 canvas 画的 —— 纸色、铅字、线描的网壳和椅子。远看是墙上的色块，凑近有字。
const POSTER_FONT = '"Inter Tight", "Arial Narrow", Impact, sans-serif';
const POSTER_SERIF = '"EB Garamond", Georgia, serif';

// 逐字排版：canvas 没有可靠的 letter-spacing，宁可自己量
function trackText(x, text, startX, y, gap = 0.94) {
  let tx = startX;
  for (const ch of text) {
    x.fillText(ch, tx, y);
    tx += x.measureText(ch).width * gap;
  }
  return tx;
}

// 一只很抽象的鸽子：两片翼 + 一个头，参考图里那种剪纸感
function posterBird(x, cx, cy, s, rot) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.scale(s, s);
  x.beginPath();
  x.moveTo(-4, 6);
  x.quadraticCurveTo(-34, 6, -52, -20);
  x.quadraticCurveTo(-26, -12, -4, -1);
  x.quadraticCurveTo(18, -16, 50, -30);
  x.quadraticCurveTo(40, -2, 8, 7);
  x.closePath();
  x.fill();
  x.beginPath();
  x.arc(7, -3, 5.6, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.moveTo(11, -6);
  x.lineTo(19, -4.5);
  x.lineTo(11, -2);
  x.closePath();
  x.fill();
  x.restore();
}

// 线描的网格穹顶：外轮廓 + 经线 + 纬线，参考图里那张 SPACE 的主体
function wireGlobe(x, cx, cy, rx, ry, lw) {
  x.save();
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  x.clip();
  x.strokeStyle = 'rgba(22,21,18,0.82)';
  x.lineWidth = lw;
  // 经线
  for (let i = 1; i < 10; i++) {
    const k = Math.abs(Math.cos((i / 10) * Math.PI));
    x.beginPath();
    x.ellipse(cx, cy, rx * k, ry, 0, 0, Math.PI * 2);
    x.stroke();
  }
  // 纬线
  for (let i = 1; i < 7; i++) {
    const yy = cy - ry + (i / 7) * ry * 2;
    x.beginPath();
    x.moveTo(cx - rx, yy);
    x.lineTo(cx + rx, yy);
    x.stroke();
  }
  x.restore();
  x.strokeStyle = 'rgba(22,21,18,0.9)';
  x.lineWidth = lw * 1.5;
  x.beginPath();
  x.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  x.stroke();
}

function posterSpace(x, w, h) {
  x.fillStyle = '#f2efe4';
  x.fillRect(0, 0, w, h);
  const pad = w * 0.062;
  x.fillStyle = '#17150f';
  x.textBaseline = 'alphabetic';
  x.font = `900 ${Math.round(w * 0.247)}px ${POSTER_FONT}`;
  trackText(x, 'SPACE', pad, h * 0.2, 0.9);

  // 小字副标题三行并排
  x.font = `500 ${Math.round(w * 0.024)}px ${POSTER_FONT}`;
  const subs = ['Satollo Gamma', 'Colorful Symphony', 'Obstetric Disorder'];
  subs.forEach((s, i) => {
    x.fillText(s, pad + i * w * 0.29, h * 0.245);
  });

  wireGlobe(x, w * 0.5, h * 0.5, w * 0.365, h * 0.175, w * 0.0042);

  // 下半两张小图：同心圆 / 漏斗
  const boxY = h * 0.745;
  const bw = w * 0.245;
  const bh = h * 0.115;
  x.strokeStyle = 'rgba(22,21,18,0.55)';
  x.lineWidth = w * 0.0035;
  [
    [pad + bw * 0.5, 5],
    [w - pad - bw * 0.5, 9],
  ].forEach(([bx], k) => {
    x.strokeRect(bx - bw / 2, boxY - bh / 2, bw, bh);
    for (let i = 1; i <= 4; i++) {
      x.beginPath();
      x.ellipse(bx, boxY + (k ? i * 1.2 : -i * 1.2), bw * (i * 0.11), bh * (i * 0.2), 0, 0, Math.PI * 2);
      x.stroke();
    }
  });

  x.fillStyle = '#17150f';
  x.font = `700 ${Math.round(w * 0.052)}px ${POSTER_FONT}`;
  x.fillText('宇宙', pad, h * 0.935);
  x.font = `400 ${Math.round(w * 0.022)}px ${POSTER_FONT}`;
  x.fillText('SPACE, an expansive series of shifting overlaps, where', pad, h * 0.962);
  x.fillText('subtense creates a cosmic imaginary, reversing the', pad, h * 0.982);
}

function posterBraque(x, w, h) {
  x.fillStyle = '#1f3785';
  x.fillRect(0, 0, w, h);
  x.fillStyle = '#f6f4ec';
  posterBird(x, w * 0.52, h * 0.3, w * 0.0056, -0.12);
  posterBird(x, w * 0.42, h * 0.46, w * 0.0046, 0.34);
  // 手写签名
  x.save();
  x.translate(w * 0.22, h * 0.52);
  x.rotate(-0.07);
  x.font = `italic 600 ${Math.round(w * 0.135)}px ${POSTER_SERIF}`;
  x.fillText('G. Braque', 0, 0);
  x.restore();

  x.font = `600 ${Math.round(w * 0.052)}px ${POSTER_FONT}`;
  x.fillText('Braque. Leben und Werk', w * 0.09, h * 0.72);
  x.font = `400 ${Math.round(w * 0.03)}px ${POSTER_FONT}`;
  const lines = ['Die konstruktiven Sequenzen der Bilder führen', 'durch alle Schaffensperioden. Werkverzeichnis', 'der Graphik · Herausgegeben von E. Boesser'];
  lines.forEach((s, i) => x.fillText(s, w * 0.09, h * 0.775 + i * h * 0.035));
  x.fillStyle = 'rgba(246,244,236,0.55)';
  x.fillRect(w * 0.09, h * 0.68, w * 0.82, 1.6);
}

function posterBauhaus(x, w, h) {
  x.fillStyle = '#e58768';
  x.fillRect(0, 0, w, h);
  x.fillStyle = '#16140f';
  x.textBaseline = 'alphabetic';
  x.font = `800 ${Math.round(w * 0.17)}px ${POSTER_FONT}`;
  trackText(x, 'original', w * 0.07, h * 0.22, 0.9);
  x.font = `900 ${Math.round(w * 0.235)}px ${POSTER_FONT}`;
  trackText(x, 'bauhaus', w * 0.06, h * 0.45, 0.86);

  // 线描的钢管椅：座面 + 靠背 + 两条腿
  x.strokeStyle = 'rgba(22,20,15,0.9)';
  x.lineWidth = w * 0.009;
  x.lineCap = 'round';
  const cx = w * 0.58;
  const cy = h * 0.66;
  x.beginPath();
  x.moveTo(cx - w * 0.16, cy);
  x.lineTo(cx + w * 0.14, cy - w * 0.02);
  x.moveTo(cx + w * 0.14, cy - w * 0.02);
  x.lineTo(cx + w * 0.16, cy - w * 0.28);
  x.moveTo(cx - w * 0.16, cy);
  x.lineTo(cx - w * 0.2, cy + w * 0.24);
  x.moveTo(cx + w * 0.14, cy - w * 0.02);
  x.lineTo(cx + w * 0.2, cy + w * 0.22);
  x.stroke();

  x.font = `500 ${Math.round(w * 0.032)}px ${POSTER_FONT}`;
  const lines = ['die jubiläumsausstellung', 'bauhaus archiv', 'der heranwachsenden'];
  lines.forEach((s, i) => x.fillText(s, w * 0.07, h * 0.9 + i * h * 0.032));
  x.font = `800 ${Math.round(w * 0.04)}px ${POSTER_FONT}`;
  x.fillText('DV', w * 0.86, h * 0.075);
}

function posterChair(x, w, h) {
  // 红底 + 四道下缘扇贝 + 中间一张白卡
  x.fillStyle = '#b23a2a';
  x.fillRect(0, 0, w, h);
  x.fillStyle = '#f4efe3';
  const r = w * 0.075;
  for (let i = 0; i < 4; i++) {
    x.beginPath();
    x.arc(w * (0.205 + i * 0.197), h + r * 0.32, r, 0, Math.PI * 2);
    x.fill();
  }
  const cw = w * 0.56;
  const ch = h * 0.5;
  x.beginPath();
  x.roundRect((w - cw) / 2, h * 0.24, cw, ch, w * 0.02);
  x.fill();

  x.strokeStyle = '#b23a2a';
  x.lineWidth = w * 0.016;
  x.lineCap = 'round';
  const cx = w * 0.5;
  const cy = h * 0.5;
  x.beginPath();
  x.moveTo(cx - w * 0.13, cy + h * 0.06);
  x.lineTo(cx + w * 0.1, cy + h * 0.05);
  x.moveTo(cx + w * 0.1, cy + h * 0.05);
  x.lineTo(cx + w * 0.13, cy - h * 0.1);
  x.moveTo(cx - w * 0.13, cy + h * 0.06);
  x.lineTo(cx - w * 0.16, cy + h * 0.18);
  x.moveTo(cx + w * 0.1, cy + h * 0.05);
  x.lineTo(cx + w * 0.16, cy + h * 0.17);
  x.stroke();
}

// 书桌上那张：一块压着一块的几何色块，参考图里木框那张的味道
function posterAbstract(x, w, h) {
  x.fillStyle = '#f0ebe0';
  x.fillRect(0, 0, w, h);
  const u = w / 12;
  x.fillStyle = '#20201d';
  x.fillRect(u * 3.2, u * 2.2, u * 2.0, u * 7.2); // 竖着的黑条
  x.fillRect(u * 5.0, u * 6.6, u * 4.4, u * 2.8); // 横着的黑条
  x.fillStyle = '#2f6fb0';
  x.fillRect(u * 5.0, u * 3.0, u * 4.6, u * 2.6); // 蓝色的块
  x.fillStyle = '#d8613f';
  x.fillRect(u * 6.2, u * 5.0, u * 3.4, u * 2.2); // 红橘错开的块
  x.fillStyle = '#8e9a72';
  x.fillRect(u * 3.2, u * 8.0, u * 1.8, u * 1.4);
  // 纸的颗粒
  for (let i = 0; i < 2400; i++) {
    x.fillStyle = `rgba(90,78,60,${Math.random() * 0.05})`;
    x.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
  }
}

/* ───────────── 桌面上那张纸：手写 ───────────── */
// 纸张贴图按 A4 横放的比例做：0.30 × 0.21，画布 1180 × 826
const PAPER_W = 1480;
const PAPER_H = 1036;
const PAPER_M = { w: 0.3, h: 0.21 };

// 手写字体：先找系统里的手写体 / 楷体，找不到才落到 serif。
// 中文字符在 Segoe Script 里没有字形，浏览器会逐字退到楷体 —— 正好。
const HAND_FONT =
  '"Sees Hand","Ma Shan Zheng","STXingkai","华文行楷","Kaiti SC","STKaiti","LXGW WenKai","KaiTi","楷体",cursive,serif';
const HAND = { x: 186, y: 344, w: 1216, fs: 92, lh: 130, maxLines: 6, color: '#2e3038' };

// 确定性伪随机：同一个字每次重绘抖动一致，不会闪
function rnd01(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// 排版：把一段话拆成一个个字，算好每个字的落笔位置
function handLayout(ctx, text, opt = HAND) {
  const { x, y, w, fs, lh, maxLines } = opt;
  ctx.font = `${fs}px ${HAND_FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const items = [];
  let cx = x;
  let cy = y;
  let line = 0;
  for (const para of String(text || '').split(/\n/)) {
    const chars = [...para];
    if (!chars.length) {
      cy += lh;
      if (++line >= maxLines) break;
      continue;
    }
    for (const ch of chars) {
      const cw = ctx.measureText(ch).width;
      if (cx > x && cx + cw > x + w) {
        cx = x;
        cy += lh;
        if (++line >= maxLines) return items;
      }
      items.push({ ch, x: cx, y: cy });
      cx += cw;
    }
    cx = x;
    cy += lh;
    if (++line >= maxLines) break;
  }
  return items;
}

// 单个字：微微歪、微微跳、墨色深浅不一 —— 楷体也能看出是手写的
function handDraw(ctx, it, i, opt = HAND) {
  const { fs, color } = opt;
  ctx.save();
  ctx.font = `${fs}px ${HAND_FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.translate(it.x, it.y + (rnd01(i * 3 + 1) - 0.5) * 3.2);
  ctx.rotate(-0.05 + (rnd01(i * 3 + 2) - 0.5) * 0.05);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, fs / 58);
  ctx.globalAlpha = 0.86 + rnd01(i * 3 + 3) * 0.14;
  ctx.strokeText(it.ch, 0, 0);
  ctx.fillText(it.ch, 0, 0);
  ctx.restore();
}

// 纸的底子：横线、页边红线、一点纤维、一圈咖啡渍、抬头和日期
function paperBase(ctx, { head, date }) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, PAPER_W, PAPER_H);
  ctx.fillStyle = '#f6efdf';
  ctx.fillRect(0, 0, PAPER_W, PAPER_H);

  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = `rgba(122,104,78,${0.01 + rnd01(i + 3) * 0.028})`;
    ctx.fillRect(rnd01(i + 7) * PAPER_W, rnd01(i + 11) * PAPER_H, 2.2, 2.2);
  }

  // 一圈渗开的咖啡渍：纸才有被人用过的样子
  const st = ctx.createRadialGradient(PAPER_W - 208, PAPER_H - 152, 10, PAPER_W - 208, PAPER_H - 152, 108);
  st.addColorStop(0, 'rgba(150,108,58,.055)');
  st.addColorStop(0.72, 'rgba(150,108,58,.045)');
  st.addColorStop(0.88, 'rgba(150,108,58,.085)');
  st.addColorStop(1, 'rgba(150,108,58,0)');
  ctx.fillStyle = st;
  ctx.beginPath();
  ctx.arc(PAPER_W - 208, PAPER_H - 152, 108, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(86,108,140,.15)';
  ctx.lineWidth = 1.4;
  for (let y = HAND.y + 10; y < PAPER_H - 42; y += HAND.lh) {
    ctx.beginPath();
    ctx.moveTo(146, y);
    ctx.lineTo(PAPER_W - 74, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(186,92,74,.18)';
  ctx.beginPath();
  ctx.moveTo(150, 130);
  ctx.lineTo(150, PAPER_H - 50);
  ctx.stroke();

  ctx.fillStyle = 'rgba(58,50,40,.4)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `34px ${HAND_FONT}`;
  ctx.fillText(head, 120, 160);
  ctx.textAlign = 'right';
  ctx.font = `31px ${HAND_FONT}`;
  ctx.fillStyle = 'rgba(58,50,40,.32)';
  ctx.fillText(date, PAPER_W - 80, 160);
  ctx.textAlign = 'left';
}

// 手写字体提前拉：等桌面那张纸建出来时，字形已经在缓存里了
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.load('92px "Sees Hand"', '见室小册').catch(() => {});
}

/* ───────────── 场景 ───────────── */
export class BookshelfScene {
  constructor(container) {
    this.el = container;
    this.books = [];
    this.view = 'spines';
    this.pan = 0;
    this.panTarget = 0;
    this.pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    this.hovered = -1;
    this.selected = null;
    this.query = '';
    this.hits = new Set();
    this.caseW = 3;
    this.geo = GEO.spines;
    this.camZTarget = 4.8;
    this.eyeY = CAM.y;
    this.eyeYTarget = CAM.y;
    this.lookY = CAM.lookY;
    this.lookYTarget = CAM.lookY;
    // 放大之后才有意义的一维：视点上下移动，去看最上层或最下层
    this.eyeBase = CAM.y;
    this.lookBase = CAM.lookY;
    this.panY = 0;
    this.panYTarget = 0;
    this.zoom = 1;
    this.camYOff = 0;
    this._touch = null;
    this._dirty = true;
    this.spot = 'home';
    this.onHover = () => {};
    this.onSelect = () => {};
    this.onZoom = () => {};
    this.decorMeshes = [];
    this._drops = [];
    // 单用户：摆件固定存一处；兼容旧版按 uid 分桶留下的本地存档
    this.decorStoreKey = 'bookshelf.decors';
    try {
      this.decors = JSON.parse(localStorage.getItem(this.decorStoreKey) || '[]');
      if (!Array.isArray(this.decors)) this.decors = [];
      if (!this.decors.length) {
        const oldUid = localStorage.getItem('bookshelf.uid') || '';
        const legacy = oldUid ? JSON.parse(localStorage.getItem('bookshelf.decors.' + oldUid) || '[]') : [];
        if (Array.isArray(legacy) && legacy.length) {
          this.decors = legacy;
          localStorage.setItem(this.decorStoreKey, JSON.stringify(legacy));
        }
      }
    } catch {
      this.decors = [];
    }
    this.liftState = null;
    // 桌上那张纸：画布只建一次，换视图不重来
    this.paperData = { mode: 'note', notes: '', letter: '' };
    this.paperCanvas = null;
    this.paperCtx = null;
    this.paperTex = null;
    this.penMeshes = [];
    this._penAnim = null;
    this.hoverPaper = false;
    this.hoverPen = false;
    this._decorDrag = null;
    this._init();
  }

  _init() {
    const w = this.el.clientWidth || innerWidth;
    const h = this.el.clientHeight || innerHeight;
    // 系统里勾了「减少动态效果」：关掉视差，镜头也别晃
    this._reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xded8ca);

    this.camera = new THREE.PerspectiveCamera(CAM.fov, w / h, 0.05, 120);
    this.camZ = 4.8;
    this.camera.position.set(0, CAM.y, this.camZ);

    const hemi = new THREE.HemisphereLight(0xfff6e8, 0xb9a68c, 0.66);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(0xfff6ec, 0.18);
    this.scene.add(amb);
    this.hemi = hemi;
    this.amb = amb;

    const key = new THREE.DirectionalLight(0xfff2dc, 2.15);
    key.position.set(-2.6, 3.4, 5.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -4.6;
    key.shadow.camera.right = 4.6;
    key.shadow.camera.top = 3.8;
    key.shadow.camera.bottom = -1.4;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 18;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.024;
    key.shadow.radius = 4;
    key.target.position.set(0, 1.1, 0);
    this.scene.add(key);
    this.scene.add(key.target);
    this.key = key;

    // 从前下方补一点回落光：柜格深处不至于糊成一块黑
    const bounce = new THREE.DirectionalLight(0xffecd2, 0.34);
    bounce.position.set(-1.2, 0.3, 4.2);
    bounce.target.position.set(-1.2, 1.3, 0);
    this.scene.add(bounce);
    this.scene.add(bounce.target);
    this.bounce = bounce;

    // 侧窗漏进来的暖光，给白墙一点层次
    const glow = new THREE.SpotLight(0xfff3df, 26, 24, 1.0, 1, 1.5);
    glow.position.set(-6, 3.0, 4.4);
    glow.target.position.set(-1.4, 1.2, -0.3);
    this.scene.add(glow);
    this.scene.add(glow.target);
    this.glow = glow;

    // 关灯之后，柜子里藏着的灯带把书照亮：三条暖光 + 每层一条灯带
    this.caseLights = [];
    for (let i = 0; i < 3; i++) {
      const pl = new THREE.PointLight(0xffdca8, 0, 3.6, 1.9);
      this.scene.add(pl);
      this.caseLights.push(pl);
    }
    this.night = false;
    this.sortBy = null; // 排序方式：null=默认，'rating'=分类内按评分降序

    this.room = this._room();
    this.scene.add(this.room);

    this.raycaster = new THREE.Raycaster();
    this._loop = this._loop.bind(this);
    // 小屏 + 高 dpr 的机器先降一档，省得开机就烫手
    this._qLevel = 0;
    if (innerWidth < 620 && (devicePixelRatio || 1) > 1.5) this._setQuality(1);
    this._loop();

    addEventListener('resize', () => this.resize());
    this._bindInput();
  }

  _room() {
    const g = new THREE.Group();
    const D = 0.32;

    const wallMat = new THREE.MeshStandardMaterial({ map: plasterTex(), color: 0xfffaf0, roughness: 1, metalness: 0 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 4.6), wallMat);
    wall.position.set(0, 2.3, -D - 0.004);
    wall.receiveShadow = true;
    g.add(wall);

    // 墙面的明暗过渡：靠地的部分压暗，顶上留亮
    const gc = document.createElement('canvas');
    gc.width = 8;
    gc.height = 256;
    const gx = gc.getContext('2d');
    const gg = gx.createLinearGradient(0, 256, 0, 0);
    gg.addColorStop(0, 'rgba(50,44,36,0.11)');
    gg.addColorStop(0.18, 'rgba(50,44,36,0.055)');
    gg.addColorStop(0.55, 'rgba(50,44,36,0.012)');
    gg.addColorStop(1, 'rgba(255,250,240,0.10)');
    gx.fillStyle = gg;
    gx.fillRect(0, 0, 8, 256);
    const gt = new THREE.CanvasTexture(gc);
    gt.colorSpace = THREE.SRGBColorSpace;
    const wallShade = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 4.6),
      new THREE.MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false })
    );
    wallShade.position.set(0, 2.3, -D - 0.002);
    g.add(wallShade);
    this.wallShade = wallShade;

    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.58, metalness: 0.02 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 6.6);
    floor.receiveShadow = true;
    g.add(floor);
    // 关灯时把墙和地压黑，屋里只剩柜子里的灯
    this.roomMats = [wallMat, floorMat];

    // 踢脚线
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xe4dccd, roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(30, 0.075, 0.018), baseMat);
    base.position.set(0, 0.037, -D + 0.004);
    base.receiveShadow = true;
    g.add(base);

    // 柜子落地的一圈接触阴影
    const cc = document.createElement('canvas');
    cc.width = 512;
    cc.height = 96;
    const cx = cc.getContext('2d');
    const cg = cx.createLinearGradient(0, 0, 0, 96);
    cg.addColorStop(0, 'rgba(48,34,18,0)');
    cg.addColorStop(0.4, 'rgba(48,34,18,0.26)');
    cg.addColorStop(1, 'rgba(48,34,18,0)');
    cx.fillStyle = cg;
    cx.fillRect(0, 0, 512, 96);
    const ct = new THREE.CanvasTexture(cc);
    ct.colorSpace = THREE.SRGBColorSpace;
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false })
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.003, 0.2);
    strip.scale.set(3, 0.55, 1);
    strip.renderOrder = 2;
    g.add(strip);
    this.contactStrip = strip;

    // 墙上的电灯开关
    const sw = new THREE.Group();
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.078, 0.115, 0.008),
      new THREE.MeshStandardMaterial({ color: 0xf3ede1, roughness: 0.6 })
    );
    plate.castShadow = true;
    sw.add(plate);
    const knob = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.038, 0.016),
      new THREE.MeshStandardMaterial({ color: 0xefe7d8, roughness: 0.5 })
    );
    knob.position.z = 0.008;
    sw.add(knob);
    sw.position.set(-0.72, 1.33, -D + 0.012);
    g.add(sw);

    // 书房门口的木招牌：挂在柜子左边那片空墙上
    this.signNode = this._sign();
    this.signNode.position.set(-0.19, 1.44, -D + 0.04);
    g.add(this.signNode);

    return g;
  }

  /* ───────────── 门口的招牌：木框 + 纸面 + 铜钉 + 挂绳 ───────────── */
  _sign() {
    const g = new THREE.Group();
    // 竖牌。横匾要占掉半面墙，竖着挂在柜子左边那条窄墙上正好，
    // 也不跟书抢横向的空间。
    const W = 0.32;
    const H = 0.8;

    // 外框：深胡桃木，四周比纸面高一点点，像真的装裱过
    const frameMat = new THREE.MeshStandardMaterial({
      map: woodTex([62, 39, 24], [1, 1]),
      roughness: 0.56,
      metalness: 0.04,
    });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.024), frameMat);
    frame.castShadow = true;
    frame.receiveShadow = true;
    g.add(frame);

    // 纸面：一块 canvas，字是现画的，换名字只要重画这张
    const c = document.createElement('canvas');
    c.width = 288;
    c.height = 800;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.sign = { canvas: c, tex, text: '' };
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.048, H - 0.048),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.88,
        metalness: 0,
        emissive: 0xfff3d8,
        emissiveMap: tex,
        emissiveIntensity: 0.12,
      })
    );
    paper.position.z = 0.0126;
    paper.receiveShadow = true;
    g.add(paper);
    this.signMat = paper.material;

    // 顶部一根挂绳，穿过两颗黄铜钉
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x6b5940, roughness: 0.92 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4e, roughness: 0.32, metalness: 0.72 });
    for (const sx of [-1, 1]) {
      const x0 = sx * (W / 2 - 0.035);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.13, 8), ropeMat);
      rope.position.set(x0 * 0.62, H / 2 + 0.062, -0.008);
      rope.rotation.z = -sx * 0.42;
      g.add(rope);
      const nail = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 12, 10), brass);
      nail.position.set(x0 * 0.24, H / 2 + 0.124, -0.01);
      nail.castShadow = true;
      g.add(nail);
    }
    // 底下一个小铜托，牌子不至于像贴在墙上
    const rest = new THREE.Mesh(new THREE.BoxGeometry(W * 0.5, 0.008, 0.02), brass);
    rest.position.set(0, -H / 2 + 0.006, 0.006);
    g.add(rest);

    this.setSign('见室小册的书房');
    return g;
  }

  // 换招牌上的字：竖排，一个字一个字往下落；名字长了就缩字号
  setSign(text) {
    const s = this.sign;
    if (!s) return;
    const label = String(text || '见室小册的书房').trim() || '见室小册的书房';
    if (label === s.text) return;
    s.text = label;

    const w = s.canvas.width;
    const h = s.canvas.height;
    const p = s.canvas.getContext('2d');

    // 纸：米白底，压一层很淡的纤维纹
    p.fillStyle = '#ece1c9';
    p.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) {
      p.fillStyle = Math.random() > 0.5 ? 'rgba(120,102,76,0.03)' : 'rgba(255,252,244,0.05)';
      p.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1);
    }
    // 内框线
    p.strokeStyle = 'rgba(92,70,44,0.3)';
    p.lineWidth = 2.5;
    p.strokeRect(13, 13, w - 26, h - 26);

    p.textAlign = 'center';
    p.textBaseline = 'middle';

    // 顶上一个小记号，像旧书房牌子上的编号
    p.fillStyle = 'rgba(92,70,44,0.55)';
    p.font = '400 20px "Inter Tight", "Helvetica Neue", Arial, sans-serif';
    p.fillText('SEES', w / 2, 54);
    p.strokeStyle = 'rgba(92,70,44,0.35)';
    p.lineWidth = 1.6;
    p.beginPath();
    p.moveTo(w / 2 - 26, 76);
    p.lineTo(w / 2 + 26, 76);
    p.stroke();

    // 竖排书名
    const chars = [...label];
    const room = h - 236;
    let size = 104;
    while (size > 26 && chars.length * size * 1.3 > room) size -= 2;
    const step = size * 1.3;
    const total = chars.length * step;
    let y = (h - 40 - total) / 2 + size / 2 + 40;
    p.fillStyle = '#2e2418';
    p.font = `500 ${size}px "Songti SC", "Noto Serif SC", "SimSun", "PingFang SC", serif`;
    for (const ch of chars) {
      p.fillText(ch, w / 2, y);
      y += step;
    }

    // 底下落款：一枚小印
    const sealY = h - 74;
    p.fillStyle = '#9d3f31';
    p.fillRect(w / 2 - 24, sealY - 24, 48, 48);
    p.fillStyle = '#f2e6cf';
    p.font = '500 29px "Songti SC", "SimSun", serif';
    p.fillText('见', w / 2, sealY + 1);

    s.tex.needsUpdate = true;
    this.invalidate();
  }

  /* ───────────── 排版：先算每本书怎么摆，再决定柜子多宽 ───────────── */

  _items(view) {
    const cats = this.cats || [];
    const groups = [];
    const onTable = this.tableIds || new Set();
    for (const cat of cats) {
      let list = this.books.filter((b) => b.cat === cat.name && !onTable.has(b.id));
      if (!list.length) continue;
      // 「按评分」时，分类内按推荐值降序，好书自然排到前头
      if (this.sortBy === 'rating') {
        list = [...list].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
      }

      if (view === 'covers') {
        // 封面视图：全部正面朝外，格子里摊开摆
        groups.push({
          cat,
          items: list.map((b) => ({ kind: 'face', books: [b], width: b.w + 0.022 })),
        });
        continue;
      }

      // 书脊视图：每个分类挑一本「值得露脸」的，再挑几本厚大的躺着摞起来
      const face =
        this.sortBy === 'rating'
          ? list[0]
          : [...list].sort((a, b) => (b.status === 'reading') - (a.status === 'reading') || (b.readAt || 0) - (a.readAt || 0))[0];
      const rest = list.filter((b) => b !== face);
      const stack =
        list.length >= 12
          ? [...rest]
              .sort((a, b) => b.h * b.w - a.h * a.w)
              .slice(0, 2 + Math.floor(rnd(hashOf('stack:' + cat.name)) * 2))
          : [];
      const items = [];
      if (face) items.push({ kind: 'face', books: [face], width: face.w + 0.026 });
      for (const b of rest) {
        if (stack.includes(b)) continue;
        items.push({ kind: 'upright', books: [b], width: b.t + S.bookGap });
      }
      if (stack.length) items.push({ kind: 'stack', books: stack, width: Math.max(...stack.map((b) => b.h)) + 0.024 });
      groups.push({ cat, items });
    }
    return groups;
  }

  _layout(view) {
    const g = { ...GEO[view] };
    const usable = g.compW - S.sidePad * 2;
    const pack = usable * 0.93; // 一层只用九成，剩下的留给摆件和空隙
    const groups = this._items(view);

    // 一层一层往上装：装不下才另开一层；小分类就接着上一层的空位放
    const shelves = [];
    let cur = null;
    const open = () => {
      cur = { items: [], used: 0, marks: [] };
      shelves.push(cur);
    };

    for (const grp of groups) {
      const w = grp.items.reduce((a, it) => a + it.width, 0);
      let k = 0;
      for (const it of grp.items) {
        if (!cur) open();
        if (cur.used > 0 && cur.used + it.width > pack) open();
        if (k === 0) {
          // 新分类起头：当前这层剩得不多，就换一层，别把标签挤在角落里
          const room = usable - cur.used;
          if (cur.used > 0 && room < Math.min(usable * 0.3, w)) open();
          cur.marks.push({ x: cur.used, name: grp.cat.name });
        }
        cur.items.push({ ...it, cat: grp.cat });
        cur.used += it.width;
        k++;
      }
    }
    if (!shelves.length) open();

    const cols = Math.max(2, Math.ceil(shelves.length / g.rows));
    // 按列均分，别让最后一整列空着；每列从下往上装，空出来的层留在顶上
    const perCol = Math.ceil(shelves.length / cols);

    shelves.forEach((sh, i) => {
      sh.col = Math.min(cols - 1, Math.floor(i / perCol));
      sh.row = g.rows - 1 - Math.min(g.rows - 1, i - sh.col * perCol);
      sh.x0 = sh.col * (g.compW + g.panel) + g.panel + S.sidePad;
      sh.floorY = g.plinth + (g.rows - 1 - sh.row) * (g.compH + g.panel) + g.panel;
      sh.cat = sh.marks[0] ? { name: sh.marks[0].name } : null;
    });

    g.cols = cols;
    g.width = cols * g.compW + (cols + 1) * g.panel;
    g.height = g.plinth + g.rows * g.compH + (g.rows + 1) * g.panel + g.top;
    g.usable = usable;
    return { geo: g, shelves };
  }

  /* ───────────── 木作 ───────────── */
  _buildCase(g) {
    const group = new THREE.Group();
    const W = g.width;
    const H = g.height;
    const D = g.depth;

    const wood = new THREE.MeshStandardMaterial({ map: woodTex([94, 63, 42], [1, 2]), roughness: 0.54, metalness: 0.04 });
    const woodDark = new THREE.MeshStandardMaterial({ map: woodTex([68, 45, 30], [1, 2]), roughness: 0.68 });
    const backMat = new THREE.MeshStandardMaterial({ map: woodTex([66, 45, 30], [1, 1]), roughness: 0.9 });
    this.caseMats = [wood, woodDark, backMat];

    const box = (sx, sy, sz, x, y, z, mat, shadow = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };

    // 背板
    const bp = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, H - g.plinth - 0.004), backMat);
    bp.position.set(W / 2, (H + g.plinth) / 2, -D + 0.004);
    bp.receiveShadow = true;
    group.add(bp);

    // 侧板
    for (let i = 0; i <= g.cols; i++) {
      const x = i * (g.compW + g.panel) + g.panel / 2;
      box(g.panel, H - g.plinth, D, x, g.plinth + (H - g.plinth) / 2, -D / 2, wood);
    }
    // 层板
    for (let r = 0; r <= g.rows; r++) {
      const y = g.plinth + r * (g.compH + g.panel) + g.panel / 2;
      box(W, g.panel, D - 0.006, W / 2, y, -D / 2 - 0.002, wood);
      // 层板下沿的暗线，交代厚度
      box(W - 0.002, 0.005, 0.006, W / 2, y + g.panel / 2 - 0.0025, 0.001, woodDark, false);
    }
    // 书报架式的前挡条
    if (g.lip) {
      for (let r = 0; r <= g.rows; r++) {
        const y = g.plinth + r * (g.compH + g.panel) + g.panel + 0.009;
        box(W - 0.01, 0.018, 0.008, W / 2, y, 0.001, wood, false);
      }
    }

    // 每格里侧的假 AO：上沿和靠背处压暗，柜子才有进深
    const ao = document.createElement('canvas');
    ao.width = 8;
    ao.height = 96;
    const ax = ao.getContext('2d');
    const ag = ax.createLinearGradient(0, 0, 0, 96);
    ag.addColorStop(0, 'rgba(24,13,4,0.42)');
    ag.addColorStop(0.25, 'rgba(24,13,4,0.14)');
    ag.addColorStop(1, 'rgba(24,13,4,0)');
    ax.fillStyle = ag;
    ax.fillRect(0, 0, 8, 96);
    const aoTex = new THREE.CanvasTexture(ao);
    aoTex.colorSpace = THREE.SRGBColorSpace;
    const aoMat = new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false });

    const side = document.createElement('canvas');
    side.width = 64;
    side.height = 8;
    const sx2 = side.getContext('2d');
    const sg = sx2.createLinearGradient(0, 0, 64, 0);
    sg.addColorStop(0, 'rgba(24,13,4,0.3)');
    sg.addColorStop(0.12, 'rgba(24,13,4,0.05)');
    sg.addColorStop(0.88, 'rgba(24,13,4,0.05)');
    sg.addColorStop(1, 'rgba(24,13,4,0.3)');
    sx2.fillStyle = sg;
    sx2.fillRect(0, 0, 64, 8);
    const sideTex = new THREE.CanvasTexture(side);
    sideTex.colorSpace = THREE.SRGBColorSpace;
    const sideMat = new THREE.MeshBasicMaterial({ map: sideTex, transparent: true, depthWrite: false });

    // 暗藏灯带洒在背板上的光：白天不亮，关灯后每格顶上亮起一片暖光
    const glowC = document.createElement('canvas');
    glowC.width = 8;
    glowC.height = 128;
    const gx = glowC.getContext('2d');
    const gr = gx.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,228,176,0.95)');
    gr.addColorStop(0.22, 'rgba(255,213,152,0.55)');
    gr.addColorStop(0.6, 'rgba(255,196,128,0.18)');
    gr.addColorStop(1, 'rgba(255,188,120,0.02)');
    gx.fillStyle = gr;
    gx.fillRect(0, 0, 8, 128);
    const glowTex = new THREE.CanvasTexture(glowC);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    this.glowMat = glowMat;

    for (let c = 0; c < g.cols; c++) {
      for (let r = 0; r < g.rows; r++) {
        const y0 = g.plinth + (g.rows - 1 - r) * (g.compH + g.panel) + g.panel;
        const cx = c * (g.compW + g.panel) + g.panel + g.compW / 2;
        const w = g.compW;
        const hgt = g.compH;
        const top = new THREE.Mesh(new THREE.PlaneGeometry(w, Math.min(0.11, hgt * 0.36)), aoMat);
        top.position.set(cx, y0 + hgt - Math.min(0.11, hgt * 0.36) / 2, -D + 0.008);
        top.renderOrder = 1;
        group.add(top);
        const left = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.1, w * 0.16), hgt), sideMat);
        left.position.set(cx - w / 2 + Math.min(0.1, w * 0.16) / 2, y0 + hgt / 2, -D + 0.008);
        left.renderOrder = 1;
        group.add(left);
        const right = left.clone();
        right.position.x = cx + w / 2 - Math.min(0.1, w * 0.16) / 2;
        group.add(right);

        const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.03, hgt - 0.02), glowMat);
        glow.position.set(cx, y0 + (hgt - 0.02) / 2 + 0.006, -D + 0.014);
        glow.renderOrder = 2;
        group.add(glow);
      }
    }

    // 分类小牌子：夹在各段起点的层板前沿，像图书馆的架标
    this.plateMats = [];
    for (const sh of this.layout.shelves) {
      for (const mk of sh.marks) {
        const plate = this._labelPlate(mk.name);
        const w = plate.userData.w;
        const x = sh.x0 + mk.x + w / 2 + 0.014;
        plate.position.set(x, sh.floorY - 0.019, 0.0065);
        plate.rotation.x = -0.045;
        group.add(plate);
        this.plateMats.push(plate.userData.mat);
      }
    }

    // 层板下的暗藏灯带
    this.strips = this._strips(g);
    group.add(this.strips);

    // 踢脚 + 顶檐
    box(W + 0.03, g.plinth, D + 0.02, W / 2, g.plinth / 2, -D / 2, woodDark);
    box(W + 0.05, g.top, D + 0.03, W / 2, H - g.top / 2, -D / 2 + 0.006, wood);
    return group;
  }

  /* 层板前沿的小牌子：像图书馆那样，把分类钉在架子上 */
  _labelPlate(name) {
    const text = String(name || '');
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    let p = c.getContext('2d');
    const fontOf = (s) => `500 ${s}px "Inter Tight", "PingFang SC", "Microsoft YaHei", sans-serif`;
    let size = 58;
    p.font = fontOf(size);
    const tw = p.measureText(text).width;
    const cw = Math.max(150, Math.min(560, Math.ceil(tw + 64)));
    c.width = cw;
    p = c.getContext('2d');

    p.fillStyle = '#efe5cf';
    p.fillRect(0, 0, cw, 96);
    p.strokeStyle = 'rgba(122,98,64,.45)';
    p.lineWidth = 3;
    p.strokeRect(4.5, 4.5, cw - 9, 87);
    p.fillStyle = '#57452e';
    p.font = fontOf(size);
    p.textAlign = 'center';
    p.textBaseline = 'middle';
    if ('letterSpacing' in p) p.letterSpacing = '0.5px';
    p.fillText(text, cw / 2, 51);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    const h = 0.038;
    const w = (h * cw) / 96;
    const plate = new THREE.Group();

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.0035),
      new THREE.MeshStandardMaterial({ color: 0xdfd3ba, roughness: 0.8 })
    );
    board.castShadow = true;
    plate.add(board);

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.66,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 0,
      })
    );
    face.position.z = 0.0019;
    plate.add(face);
    plate.userData.w = w;
    plate.userData.mat = face.material;
    return plate;
  }

  /* 层板下的暗藏灯带：白天不亮，关灯之后每格顶上一条 */
  _strips(g) {
    const geo = new THREE.BoxGeometry(g.compW - 0.05, 0.008, 0.01);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe2b0 });
    const n = g.cols * g.rows;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let c = 0; c < g.cols; c++) {
      for (let r = 0; r < g.rows; r++) {
        const y0 = g.plinth + r * (g.compH + g.panel) + g.panel;
        const cx = c * (g.compW + g.panel) + g.panel + g.compW / 2;
        m.makeTranslation(cx, y0 + g.compH - 0.0045, -0.002);
        mesh.setMatrixAt(k++, m);
      }
    }
    mesh.visible = this.night;
    mesh.frustumCulled = false;
    return mesh;
  }

  /* ───────────── 摆书 ───────────── */
  _buildBooks(layout, view, coverTex, spineTex) {
    const g = layout.geo;
    const n = this.books.length;
    const geo = bookGeometry();

    const coverMat = uvPatch(
      new THREE.MeshStandardMaterial({
        map: coverTex,
        roughness: 0.72,
        metalness: 0,
        emissiveMap: coverTex,
        emissive: 0xffe6bd,
        emissiveIntensity: 0,
      }),
      'aUvC'
    );
    const spineMat = uvPatch(
      new THREE.MeshStandardMaterial({
        map: spineTex,
        roughness: 0.78,
        metalness: 0,
        emissiveMap: spineTex,
        emissive: 0xffe6bd,
        emissiveIntensity: 0,
      }),
      'aUvS'
    );
    this.coverMat = coverMat;
    this.spineMat = spineMat;
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xe8ddc6, roughness: 0.94 });

    const mesh = new THREE.InstancedMesh(geo, [coverMat, spineMat, paperMat], n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const uvC = new Float32Array(n * 4);
    const uvS = new Float32Array(n * 4);
    const bayTop = new Float32Array(n);
    const bayH = new Float32Array(n).fill(g.compH);
    const mats = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qz = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, 1);
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    this.slots = new Array(n);
    const byId = new Map(this.books.map((b, i) => [b.id, i]));
    const D = g.depth;
    // 留给摆件的空位，等书摆完再往里塞东西
    this.gaps = [];

    const place = (b, x, y, z, quat, lean = 0, bay = null) => {
      const i = byId.get(b.id);
      if (i == null) return;
      pos.set(x, y, z);
      scale.set(b.w, b.h, b.t);
      q.copy(quat);
      if (lean) {
        qz.setFromAxisAngle(Z, lean);
        q.premultiply(qz);
      }
      mats.compose(pos, q, scale);
      mesh.setMatrixAt(i, mats);
      uvC.set(b.uvC, i * 4);
      uvS.set(b.uvS, i * 4);
      bayTop[i] = bay ? bay.top : y + g.compH;
      bayH[i] = bay ? bay.h : g.compH;
      this.slots[i] = { x, y, z, shelf: null };
    };

    for (const sh of layout.shelves) {
      if (!sh.items.length) {
        this.gaps.push({ shelf: sh, x: sh.x0, left: g.usable });
        continue;
      }
      const r = rnd(hashOf('lean:' + sh.col + ':' + sh.row));
      const used = sh.items.reduce((a, it) => a + it.width, 0);
      let left = g.usable - used;
      let cur = sh.x0;
      const detail = view === 'covers';

      // 封面视图里把书摊开摆，留白匀到缝里
      const spread = detail && sh.items.length > 1 ? Math.max(0, left) / (sh.items.length - 1) : 0;

      sh.items.forEach((it, k) => {
        const b = it.books[0];
        if (it.kind === 'upright') {
          const z = -(S.spineInset + b.w / 2);
          const isLast = k === sh.items.length - 1;
          const leanIt = !spread && isLast && sh.items.length > 3 && left > b.h * 0.16 && r < 0.65;
          if (leanIt) {
            const th = (S.leanDeg + r * 3) * DEG;
            const cx = cur + b.h * Math.sin(th) + (b.t / 2) * Math.cos(th) + 0.001;
            const cy = sh.floorY + (b.h / 2) * Math.cos(th) + (b.t / 2) * Math.sin(th);
            place(b, cx, cy, z, YAW_90, th);
            cur += b.t + 0.002;
          } else {
            place(b, cur + b.t / 2, sh.floorY + b.h / 2, z, YAW_90);
            cur += it.width;
          }
        } else if (it.kind === 'face') {
          const z = -(S.spineInset + b.w / 2);
          place(b, cur + it.width / 2, sh.floorY + b.h / 2, z, new THREE.Quaternion());
          cur += it.width;
        } else {
          // 躺平的一摞，书脊朝外
          let y = sh.floorY;
          const widest = Math.max(...it.books.map((x) => x.h));
          for (const sb of it.books) {
            const jz = (rnd(hashOf(sb.id + 'z')) - 0.5) * 0.006;
            place(
              sb,
              cur + widest / 2 + (rnd(hashOf(sb.id + 'x')) - 0.5) * 0.012,
              y + sb.t / 2,
              -(S.spineInset + sb.w / 2) + jz,
              FLAT
            );
            y += sb.t;
          }
          cur += it.width;
        }
        cur += spread;
      });

      left = g.usable - cur + sh.x0;
      if (left > 0.1) this.gaps.push({ shelf: sh, x: cur, left, top: sh.floorY });
    }

    for (const sh of layout.shelves) {
      for (const it of sh.items) for (const b of it.books) {
        const i = byId.get(b.id);
        if (i != null && this.slots[i]) this.slots[i].shelf = sh;
      }
    }

    /* ── 桌上的书：在读平摊在左桌，想读摞在靠柜子那张 ── */
    const rt = TABLES.reading;
    const rp = this.readingPicks || [];
    if (rp.length) {
      // 摊成两排，封面朝上；每本之间留出刚好不压到别人的距离
      const cols = rt.cols;
      const pitch = (rt.w - 0.16) / cols;
      rp.forEach((b, k) => {
        const row = Math.floor(k / cols);
        const col = k % cols;
        const x = rt.x - (cols * pitch) / 2 + pitch * (col + 0.5) + (rnd(hashOf(b.id + 'tx')) - 0.5) * 0.012;
        const z = rt.z + (row === 0 ? rt.d / 4 : -rt.d / 4) + (rnd(hashOf(b.id + 'tz')) - 0.5) * 0.03;
        YAW_Q.setFromAxisAngle(YA, (rnd(hashOf(b.id + 'ty')) - 0.5) * 0.3);
        const q = FLAT_UP.clone().premultiply(YAW_Q);
        place(b, x, rt.h + 0.021 + b.t / 2, z, q);
        const i = byId.get(b.id);
        if (i != null) Object.assign(this.slots[i], { shelf: null, table: 'reading' });
      });
    }

    const wt = TABLES.want;
    const wp = this.wantPicks || [];
    if (wp.length) {
      const cols = 4;
      const rows = 2;
      const per = Math.ceil(wp.length / (cols * rows));
      const innerW = wt.w - 0.18;
      for (let r = 0; r < rows; r++) {
        const z = wt.z + (r === 0 ? wt.d / 2 - 0.11 : -wt.d / 2 + 0.12);
        for (let c = 0; c < cols; c++) {
          const x = wt.x - innerW / 2 + (innerW / cols) * (c + 0.5);
          const chunk = wp.slice((r * cols + c) * per, (r * cols + c + 1) * per);
          let y = wt.h + 0.021;
          for (const b of chunk) {
            YAW_Q.setFromAxisAngle(YA, (rnd(hashOf(b.id + 'wy')) - 0.5) * 0.08);
            const q = FLAT.clone().premultiply(YAW_Q);
            place(b, x + (rnd(hashOf(b.id + 'wx')) - 0.5) * 0.018, y + b.t / 2, z + (rnd(hashOf(b.id + 'wz')) - 0.5) * 0.022, q);
            y += b.t;
            const i = byId.get(b.id);
            if (i != null) Object.assign(this.slots[i], { shelf: null, table: 'want' });
          }
        }
      }
    }

    /* ── 桌面右侧那两本：最近翻过的，摞在桌上，点开就能接着读 ── */
    const dp = this.deskPicks || [];
    if (dp.length) {
      const bx = -4.42 + 0.4;
      const bz = -0.03 - 0.09;
      let y = 0.762 + 0.002;
      dp.forEach((b, k) => {
        YAW_Q.setFromAxisAngle(YA, (k === 0 ? 0.09 : -0.12));
        const q = FLAT_UP.clone().premultiply(YAW_Q);
        place(
          b,
          bx + (k ? 0.014 : 0) + (rnd(hashOf(b.id + 'dx')) - 0.5) * 0.012,
          y + b.t / 2,
          bz + (k ? -0.012 : 0),
          q
        );
        y += b.t + 0.0012;
        const i = byId.get(b.id);
        if (i != null) Object.assign(this.slots[i], { shelf: null, table: 'desk' });
      });
    }

    // 桌上的书不在格子里，给它们一片均匀的光
    for (const b of [...rp, ...wp, ...dp]) {
      const i = byId.get(b.id);
      if (i == null || !this.slots[i]) continue;
      bayTop[i] = this.slots[i].y;
      bayH[i] = 1;
    }

    geo.setAttribute('aUvC', new THREE.InstancedBufferAttribute(uvC, 4));
    geo.setAttribute('aUvS', new THREE.InstancedBufferAttribute(uvS, 4));
    geo.setAttribute('aBayTop', new THREE.InstancedBufferAttribute(bayTop, 1));
    geo.setAttribute('aBayH', new THREE.InstancedBufferAttribute(bayH, 1));

    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) mesh.setColorAt(i, white);
    mesh.instanceColor.needsUpdate = true;

    this.bookMesh = mesh;
    this.baseMatrices = new Float32Array(mesh.instanceMatrix.array);
    this.scene.add(mesh);
    return mesh;
  }

  _setInstance(i, scaleMul = 1, lift = 0) {
    if (!this.bookMesh || i < 0) return;
    const m = new THREE.Matrix4().fromArray(this.baseMatrices, i * 16);
    if (scaleMul !== 1 || lift) {
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      m.decompose(p, q, s);
      s.multiplyScalar(scaleMul);
      p.z += lift;
      m.compose(p, q, s);
    }
    this.bookMesh.setMatrixAt(i, m);
    this.bookMesh.instanceMatrix.needsUpdate = true;
  }

  /* 把某一本摆成「拔出来一点、抬起来」的姿势：f=0 在架上，f=1 完全抽出 */
  _pose(i, { dy = 0, dz = 0, roll = 0, scale = 1 } = {}) {
    if (!this.bookMesh || i < 0 || !this.baseMatrices) return;
    const m = new THREE.Matrix4().fromArray(this.baseMatrices, i * 16);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    s.multiplyScalar(scale);
    p.y += dy;
    p.z += dz;
    if (roll) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    m.compose(p, q, s);
    this.bookMesh.setMatrixAt(i, m);
    this.bookMesh.instanceMatrix.needsUpdate = true;
  }

  _lift(i, target, dur = 300) {
    const from = this.liftState && this.liftState.i === i ? this.liftState.f : 0;
    this.liftState = { i, f: from, from, target, t0: performance.now(), dur };
  }

  releasePick() {
    if (this.liftState) this._lift(this.liftState.i, 0, 420);
  }

  _projectSlot(i) {
    const slot = this.slots?.[i];
    if (!slot) return null;
    const v = new THREE.Vector3(slot.x, slot.y + 0.17, slot.z + 0.12);
    v.project(this.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }

  /* ───────────── 层板上的摆件 ───────────── */
  /* ───────────── 二十来种小东西 ───────────── */
  // 摆件全部程序化生成：一层 318mm，最高的那件（望远镜）也没顶到上一层板。
  _decorMore(kind) {
    const g = new THREE.Group();
    const put = (parent, geo, m, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const Cyl = (rt, rb, h, n = 22) => new THREE.CylinderGeometry(rt, rb, h, n);
    const Ball = (r, a = 20, b = 14) => new THREE.SphereGeometry(r, a, b);
    const M = dmat;
    const done = (width) => {
      g.userData.w = width;
      return g;
    };
    const wood = M(0x8a6a44, { roughness: 0.66 });
    const brass = M(0xb08a4e, { roughness: 0.32, metalness: 0.72 });
    const plaster = M(0xf0e9dc, { roughness: 0.6 });

    if (kind === 'globe') {
      const base = put(g, Cyl(0.042, 0.056, 0.016), wood, 0, 0.008);
      base.rotation.y = 0.3;
      put(g, Cyl(0.007, 0.007, 0.034, 12), brass, 0, 0.032);
      const ring = put(g, new THREE.TorusGeometry(0.076, 0.0042, 8, 44), brass, 0, 0.104);
      ring.rotation.y = 0.16;
      const ball = put(g, Ball(0.067, 28, 20), new THREE.MeshStandardMaterial({ map: globeTex(), roughness: 0.58 }));
      ball.position.y = 0.104;
      ball.rotation.set(0.1, -0.5, 0.18);
      return done(0.16);
    }

    if (kind === 'candle') {
      put(g, Cyl(0.048, 0.054, 0.008), brass, 0, 0.004);
      put(g, Cyl(0.009, 0.013, 0.062), brass, 0, 0.039);
      put(g, Cyl(0.024, 0.019, 0.011), brass, 0, 0.075);
      put(g, Cyl(0.015, 0.0155, 0.082, 16), M(0xf2e9d6, { roughness: 0.88 }), 0, 0.122);
      const flame = put(g, Ball(0.0085, 12, 10), M(0xffb545, { emissive: 0xff9a2e, emissiveIntensity: 1.6, roughness: 0.4 }), 0, 0.172);
      flame.scale.y = 1.5;
      return done(0.09);
    }

    if (kind === 'clock') {
      put(g, Box(0.118, 0.014, 0.052), wood, 0, 0.007);
      for (const sx of [-1, 1]) put(g, Cyl(0.0055, 0.0055, 0.062, 12), brass, sx * 0.042, 0.045);
      const face = put(g, Cyl(0.053, 0.053, 0.024), brass, 0, 0.104);
      face.rotation.x = Math.PI / 2;
      const dial = put(g, new THREE.CircleGeometry(0.045, 32), new THREE.MeshStandardMaterial({ map: clockTex(), roughness: 0.7 }), 0, 0.104, 0.0125);
      dial.rotation.y = 0;
      put(g, Ball(0.008, 12, 10), brass, 0, 0.166);
      return done(0.13);
    }

    if (kind === 'quill') {
      put(g, Cyl(0.026, 0.032, 0.042, 18), M(0x2e3a3d, { roughness: 0.24, metalness: 0.16 }), 0, 0.021);
      put(g, Cyl(0.028, 0.028, 0.006, 18), brass, 0, 0.045);
      put(g, Cyl(0.0022, 0.0022, 0.15, 8), M(0xdcd0b6, { roughness: 0.8 }), 0.012, 0.115, 0);
      const vane = put(g, new THREE.ConeGeometry(0.018, 0.13, 5), M(0xefe6d2, { roughness: 0.82, side: THREE.DoubleSide }), 0.026, 0.132, 0);
      vane.scale.z = 0.22;
      vane.rotation.z = -0.42;
      return done(0.1);
    }

    if (kind === 'lamp') {
      put(g, Cyl(0.046, 0.056, 0.014), brass, 0, 0.007);
      put(g, Cyl(0.0055, 0.0055, 0.13, 12), brass, 0, 0.078);
      const shade = put(g, new THREE.ConeGeometry(0.058, 0.068, 26, 1, true), M(0xf3e7cd, { roughness: 0.86, side: THREE.DoubleSide }), 0, 0.163);
      shade.receiveShadow = false;
      put(g, Ball(0.016, 12, 10), M(0xfff0c8, { emissive: 0xffd489, emissiveIntensity: 0.9 }), 0, 0.14);
      return done(0.12);
    }

    if (kind === 'dryflower') {
      put(g, Cyl(0.031, 0.025, 0.058, 20), M(0xd9c4a4, { roughness: 0.86 }), 0, 0.029);
      const stem = M(0xbfa87f, { roughness: 0.9 });
      const head = M(0xd8c49a, { roughness: 0.94 });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.3;
        const lean = 0.16 + (i % 3) * 0.05;
        const h = 0.11 + (i % 4) * 0.012;
        const s = put(g, Cyl(0.0016, 0.0016, h, 6), stem, Math.cos(a) * 0.012, 0.055 + h / 2, Math.sin(a) * 0.012);
        s.rotation.z = Math.cos(a) * lean;
        s.rotation.x = -Math.sin(a) * lean;
        put(g, Ball(0.0075, 8, 7), head, Math.cos(a) * (0.012 + h * lean), 0.055 + h, Math.sin(a) * (0.012 + h * lean));
      }
      return done(0.09);
    }

    if (kind === 'lavender') {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector2(0.016 + Math.sin(t * Math.PI * 0.85) * 0.03, t * 0.1));
      }
      put(g, new THREE.LatheGeometry(pts, 24), M(0xe6dcc8, { roughness: 0.58 }), 0, 0);
      const stem = M(0x7b8a63, { roughness: 0.9 });
      const bud = M(0x8072a8, { roughness: 0.86 });
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const r = 0.008 + (i % 3) * 0.006;
        const h = 0.12 + (i % 5) * 0.016;
        const s = put(g, Cyl(0.0014, 0.0014, h, 6), stem, Math.cos(a) * r, 0.09 + h / 2, Math.sin(a) * r);
        s.rotation.z = Math.cos(a) * 0.14;
        s.rotation.x = -Math.sin(a) * 0.14;
        const tip = put(g, Cyl(0.0055, 0.003, 0.038, 8), bud, Math.cos(a) * (r + h * 0.14), 0.09 + h, Math.sin(a) * (r + h * 0.14));
        tip.rotation.z = Math.cos(a) * 0.14;
      }
      return done(0.1);
    }

    if (kind === 'telescope') {
      // 三条腿，筒子斜指上去
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const leg = put(g, Box(0.007, 0.145, 0.007), wood, Math.cos(a) * 0.03, 0.07, Math.sin(a) * 0.03);
        leg.rotation.z = Math.cos(a) * 0.24;
        leg.rotation.x = -Math.sin(a) * 0.24;
      }
      put(g, Cyl(0.02, 0.022, 0.012, 16), brass, 0, 0.142);
      const tube = put(g, Cyl(0.019, 0.026, 0.15, 20), brass, 0, 0.185, 0.01);
      tube.rotation.x = -1.02;
      tube.rotation.z = 0.1;
      put(g, Cyl(0.014, 0.014, 0.03, 14), M(0x2f2a25, { roughness: 0.4, metalness: 0.2 }), 0, 0.243, 0.056);
      return done(0.13);
    }

    if (kind === 'horse') {
      // 马首做成侧脸浮雕：圆柱脖子加方盒脑袋从哪个角度都像柱子，
      // 侧面轮廓挤出来才有「雕刻」的意思，正面看也认得出。
      const base = put(g, Box(0.084, 0.016, 0.05), M(0x3a352e, { roughness: 0.5 }), 0, 0.008);
      base.receiveShadow = true;
      const s = new THREE.Shape();
      s.moveTo(0.0, 0.03); // 吻端最左
      s.lineTo(0.004, 0.04); // 鼻梁
      s.lineTo(0.016, 0.046); // 额
      s.lineTo(0.016, 0.06); // 前耳尖
      s.lineTo(0.024, 0.048); // 耳间
      s.lineTo(0.032, 0.062); // 后耳尖
      s.lineTo(0.038, 0.044); // 脑后
      s.quadraticCurveTo(0.052, 0.03, 0.058, 0.004); // 颈背
      s.lineTo(0.058, 0.0);
      s.lineTo(0.03, 0.0); // 颈底
      s.lineTo(0.03, 0.016); // 颈前
      s.quadraticCurveTo(0.024, 0.02, 0.019, 0.015); // 下颌内凹
      s.lineTo(0.007, 0.024); // 下唇
      s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, {
        depth: 0.022,
        bevelEnabled: true,
        bevelSize: 0.0025,
        bevelThickness: 0.0025,
        bevelSegments: 2,
        curveSegments: 12,
      });
      const head = new THREE.Mesh(geo, plaster);
      head.rotation.y = -0.06;
      head.position.set(-0.028, 0.014, -0.011);
      head.castShadow = true;
      head.receiveShadow = true;
      g.add(head);
      return done(0.09);
    }

    if (kind === 'torso') {
      const pts = [
        [0.052, 0], [0.056, 0.012], [0.05, 0.03], [0.04, 0.055],
        [0.036, 0.075], [0.045, 0.098], [0.055, 0.12], [0.052, 0.14],
        [0.036, 0.155], [0.02, 0.163],
      ].map(([r, y]) => new THREE.Vector2(r, y));
      const body = put(g, new THREE.LatheGeometry(pts, 30), M(0xf1eae0, { roughness: 0.52 }), 0, 0.02, 0);
      body.scale.z = 0.62;
      put(g, Box(0.085, 0.02, 0.055), M(0xe8e0d2, { roughness: 0.7 }), 0, 0.01);
      return done(0.13);
    }

    if (kind === 'corkboard') {
      const b = put(g, Box(0.16, 0.115, 0.008), wood, 0, 0.06, 0);
      b.rotation.x = -0.14;
      const cork = put(g, new THREE.PlaneGeometry(0.144, 0.1), M(0xb98f5c, { roughness: 0.98 }), 0, 0.06, 0.0045);
      cork.rotation.x = -0.14;
      const notes = [
        [0.04, 0.075, -0.24, 0xf6f0e2],
        [-0.035, 0.055, 0.18, 0xefe3c8],
        [0.005, 0.095, 0.08, 0xf3ece0],
      ];
      for (const [x, y, rot, c] of notes) {
        const n = put(g, new THREE.PlaneGeometry(0.042, 0.05), M(c, { roughness: 0.92 }), x, y, 0.007);
        n.rotation.set(-0.14, 0, rot);
        const pin = put(g, Ball(0.0038, 8, 6), M(0xa8452f, { roughness: 0.5 }), x, y + 0.02, 0.011);
        pin.castShadow = false;
      }
      return done(0.17);
    }

    if (kind === 'camera') {
      const body = put(g, Box(0.116, 0.072, 0.042), M(0x272420, { roughness: 0.46 }), 0, 0.036, 0);
      put(g, Box(0.116, 0.012, 0.044), M(0x9a9488, { roughness: 0.42, metalness: 0.3 }), 0, 0.06, 0);
      const lens = put(g, Cyl(0.026, 0.028, 0.03, 22), M(0x1b1916, { roughness: 0.34 }), 0.012, 0.036, 0.03);
      lens.rotation.x = Math.PI / 2;
      put(g, Cyl(0.017, 0.017, 0.006, 18), M(0x4a443c, { roughness: 0.24, metalness: 0.5 }), 0.012, 0.036, 0.047);
      put(g, Box(0.022, 0.014, 0.014), M(0x2f2b26, { roughness: 0.5 }), -0.036, 0.073, -0.004);
      put(g, Cyl(0.006, 0.006, 0.008, 12), M(0xa9a294, { roughness: 0.3, metalness: 0.6 }), 0.038, 0.074, 0);
      return done(0.13);
    }

    if (kind === 'bear') {
      const fur = M(0xa9784f, { roughness: 0.94 });
      const cloth = M(0x8c3b32, { roughness: 0.9 });
      put(g, Ball(0.046, 18, 14), fur, 0, 0.05, 0).scale.set(1, 1.08, 0.92);
      put(g, Ball(0.034, 18, 14), fur, 0, 0.116, 0.004);
      for (const sx of [-1, 1]) {
        put(g, Ball(0.013, 10, 8), fur, sx * 0.026, 0.144, 0);
        put(g, Ball(0.016, 10, 8), fur, sx * 0.042, 0.056, 0.01);
        put(g, Ball(0.017, 10, 8), fur, sx * 0.024, 0.014, 0.022);
      }
      put(g, Ball(0.013, 12, 10), M(0xc9a67c, { roughness: 0.92 }), 0, 0.106, 0.028);
      put(g, Ball(0.004, 8, 6), M(0x3a2d22, { roughness: 0.5 }), 0, 0.11, 0.04);
      const scarf = put(g, new THREE.TorusGeometry(0.03, 0.008, 8, 20), cloth, 0, 0.086, 0);
      scarf.rotation.x = Math.PI / 2;
      return done(0.1);
    }

    if (kind === 'cat') {
      // 卧猫：身子是个压扁的球，头朝外，两只耳朵立起来，
      // 前爪并在一起——俯视看就是一只盘着的猫，不是一团毛。
      const fur = M(0xd9a05f, { roughness: 0.96 });
      const body = put(g, Ball(0.052, 20, 16), fur, 0, 0.034, -0.008);
      body.scale.set(1.16, 0.62, 0.94);
      const head = put(g, Ball(0.031, 20, 16), fur, 0, 0.046, 0.046);
      head.scale.set(1, 0.94, 0.94);
      for (const sx of [-1, 1]) {
        const ear = put(g, new THREE.ConeGeometry(0.011, 0.022, 7), fur, sx * 0.016, 0.07, 0.046);
        ear.rotation.z = sx * 0.26;
        // 前爪
        const paw = put(g, Ball(0.0115, 12, 9), fur, sx * 0.016, 0.013, 0.052);
        paw.scale.set(1, 0.62, 1.35);
      }
      put(g, Ball(0.0034, 8, 6), M(0x4a382c, { roughness: 0.6 }), 0, 0.042, 0.073);
      // 尾巴从身后绕到侧面
      const tail = put(g, new THREE.TorusGeometry(0.04, 0.0085, 8, 24, 2.4), fur, 0.002, 0.014, -0.012);
      tail.rotation.set(Math.PI / 2, 0, 2.5);
      return done(0.13);
    }

    if (kind === 'capital') {
      // 柱身 → 钟形向上张开 → 顶上压一块顶板，涡卷从四角翻出来
      put(g, Cyl(0.034, 0.04, 0.09, 20), M(0xece5d8, { roughness: 0.68 }), 0, 0.045);
      put(g, Cyl(0.044, 0.032, 0.032, 18), M(0xe6dfd0, { roughness: 0.66 }), 0, 0.106);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const volute = put(g, new THREE.TorusGeometry(0.012, 0.0048, 6, 14, 4.6), M(0xe6dfd0, { roughness: 0.66 }), sx * 0.032, 0.124, sz * 0.032);
        volute.rotation.set(0, Math.atan2(sz, sx), 0.5 * sx * sz);
      }
      put(g, Box(0.1, 0.013, 0.1), M(0xece5d8, { roughness: 0.68 }), 0, 0.132);
      return done(0.12);
    }

    if (kind === 'heart') {
      const s = new THREE.Shape();
      s.moveTo(0, -0.05);
      s.bezierCurveTo(-0.056, -0.008, -0.046, 0.046, -0.019, 0.046);
      s.bezierCurveTo(-0.007, 0.046, 0, 0.034, 0, 0.026);
      s.bezierCurveTo(0, 0.034, 0.007, 0.046, 0.019, 0.046);
      s.bezierCurveTo(0.046, 0.046, 0.056, -0.008, 0, -0.05);
      const frame = put(g, new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 18 }), M(0xefe7d8, { roughness: 0.56 }), 0, 0.075, 0);
      frame.rotation.x = -0.1;
      const s2 = new THREE.Shape();
      s2.moveTo(0, -0.034);
      s2.bezierCurveTo(-0.038, -0.004, -0.031, 0.033, -0.013, 0.033);
      s2.bezierCurveTo(-0.005, 0.033, 0, 0.024, 0, 0.018);
      s2.bezierCurveTo(0, 0.024, 0.005, 0.033, 0.013, 0.033);
      s2.bezierCurveTo(0.031, 0.033, 0.038, -0.004, 0, -0.034);
      const pic = put(g, new THREE.ShapeGeometry(s2, 16), M(0xc9a878, { roughness: 0.9 }), 0, 0.075, 0.0125);
      pic.rotation.x = -0.1;
      const stand = put(g, Box(0.006, 0.05, 0.006), wood, 0, 0.024, -0.014);
      stand.rotation.x = 0.5;
      return done(0.13);
    }

    if (kind === 'nightlight') {
      put(g, Cyl(0.042, 0.048, 0.016), brass, 0, 0.008);
      put(g, Cyl(0.03, 0.038, 0.014), brass, 0, 0.022);
      const dome = put(
        g,
        new THREE.SphereGeometry(0.046, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
        M(0xf0a23c, { emissive: 0xff9c2e, emissiveIntensity: 1.2, roughness: 0.34, transparent: true, opacity: 0.94 }),
        0,
        0.028
      );
      dome.scale.y = 1.15;
      put(g, Cyl(0.042, 0.042, 0.006), brass, 0, 0.082);
      return done(0.1);
    }

    if (kind === 'gift') {
      const paper = M(0xd8c9ae, { roughness: 0.9 });
      const ribbon = M(0xa8b0a2, { roughness: 0.72 });
      put(g, Box(0.096, 0.076, 0.096), paper, 0, 0.038);
      put(g, Box(0.1, 0.012, 0.1), ribbon, 0, 0.076);
      put(g, Box(0.012, 0.078, 0.098), ribbon, 0, 0.038);
      for (const sx of [-1, 1]) {
        const bow = put(g, new THREE.TorusGeometry(0.016, 0.005, 6, 16), ribbon, sx * 0.014, 0.09, 0);
        bow.rotation.set(Math.PI / 2, 0, sx * 0.5);
      }
      return done(0.11);
    }

    if (kind === 'headphone') {
      const metal = M(0x9aa0a2, { roughness: 0.3, metalness: 0.6 });
      const pad = M(0x3a3a3c, { roughness: 0.8 });
      put(g, Box(0.07, 0.012, 0.05), wood, 0, 0.006);
      put(g, Cyl(0.008, 0.008, 0.085, 12), metal, 0, 0.05);
      const band = put(g, new THREE.TorusGeometry(0.052, 0.007, 8, 26, Math.PI), M(0x8f9598, { roughness: 0.42, metalness: 0.36 }), 0, 0.168, 0);
      band.rotation.z = 0;
      for (const sx of [-1, 1]) {
        put(g, Cyl(0.024, 0.026, 0.02, 18), pad, sx * 0.052, 0.14, 0).rotation.z = Math.PI / 2;
      }
      return done(0.12);
    }

    if (kind === 'polaroid') {
      put(g, Box(0.088, 0.1, 0.008), M(0xf5f1e8, { roughness: 0.8 }), 0, 0.05, 0);
      const shot = put(g, new THREE.PlaneGeometry(0.072, 0.07), M(0x8e9aa6, { roughness: 0.6 }), 0, 0.062, 0.0045);
      shot.rotation.x = 0;
      const cap = put(g, new THREE.PlaneGeometry(0.072, 0.02), M(0xf5f1e8, { roughness: 0.8 }), 0, 0.014, 0.0045);
      cap.rotation.x = 0;
      const leg = put(g, Box(0.05, 0.006, 0.03), M(0xe6dfd2, { roughness: 0.8 }), 0, 0.002, -0.012);
      leg.rotation.x = 0.2;
      return done(0.1);
    }

    if (kind === 'tree') {
      const green = M(0x3f5f43, { roughness: 0.94 });
      put(g, Cyl(0.008, 0.01, 0.026, 10), wood, 0, 0.013);
      for (let i = 0; i < 3; i++) {
        const c = put(g, new THREE.ConeGeometry(0.052 - i * 0.013, 0.062, 12), green, 0, 0.05 + i * 0.042);
        c.rotation.y = i * 0.4;
      }
      const star = put(g, new THREE.OctahedronGeometry(0.011), M(0xd8b45a, { emissive: 0x6a4c12, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.4 }), 0, 0.176);
      star.scale.y = 1.5;
      return done(0.1);
    }

    return null;
  }

  _decor(kind) {
    const more = this._decorMore(kind);
    if (more) return more;
    const g = new THREE.Group();
    const plaster = new THREE.MeshStandardMaterial({ color: 0xf2ebde, roughness: 0.56, metalness: 0.02 });
    const clay = new THREE.MeshStandardMaterial({ color: 0xe7dbc6, roughness: 0.82 });

    if (kind === 'bust') {
      // 石膏胸像：方底座、肩胸、颈、头，一圈卷发和鼻梁，侧着脸
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.135, 0.026, 0.135),
        new THREE.MeshStandardMaterial({ color: 0x33302b, roughness: 0.42, metalness: 0.06 })
      );
      base.position.y = 0.013;
      base.castShadow = true;
      base.receiveShadow = true;
      const bg = new THREE.Group();
      bg.add(base);

      // 肩胸：上宽下收的断面，两侧切平，像真的胸像那样被截断
      const pts = [
        [0.004, 0.0], [0.062, 0.0], [0.068, 0.004], [0.062, 0.012],
        [0.058, 0.03], [0.052, 0.05], [0.044, 0.068], [0.035, 0.082],
        [0.028, 0.092], [0.026, 0.1],
      ].map(([r, y]) => new THREE.Vector2(r, y + 0.022));
      const chest = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), plaster);
      chest.scale.set(1, 1, 0.72);
      chest.castShadow = true;
      chest.receiveShadow = true;
      bg.add(chest);

      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.029, 0.05, 24), plaster);
      neck.position.y = 0.148;
      neck.castShadow = true;
      bg.add(neck);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.046, 32, 24), plaster);
      head.scale.set(0.84, 1.06, 0.92);
      head.position.set(0, 0.212, 0.004);
      head.castShadow = true;
      bg.add(head);

      // 下颌
      const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.032, 24, 18), plaster);
      jaw.scale.set(0.86, 0.7, 0.86);
      jaw.position.set(0, 0.19, 0.012);
      jaw.castShadow = true;
      bg.add(jaw);

      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, 10), plaster);
      nose.rotation.x = Math.PI / 2.1;
      nose.position.set(0, 0.206, 0.046);
      bg.add(nose);

      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.007, 0.01), plaster);
      brow.position.set(0, 0.226, 0.042);
      bg.add(brow);

      // 卷发：向阳面密、后颈留白
      const hairMat = new THREE.MeshStandardMaterial({ color: 0xe9e0cf, roughness: 0.72 });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const yy = 0.238 + Math.sin(a * 3) * 0.008;
        const curl = new THREE.Mesh(new THREE.SphereGeometry(0.0185, 10, 8), hairMat);
        curl.position.set(Math.cos(a) * 0.03, yy, Math.sin(a) * 0.028 - 0.004);
        curl.scale.y = 0.9;
        curl.castShadow = true;
        bg.add(curl);
      }
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.037, 16, 12), hairMat);
      top.scale.set(1, 0.62, 1);
      top.position.set(0, 0.253, -0.002);
      bg.add(top);

      bg.rotation.y = 0.34;
      bg.rotation.z = -0.02;
      g.add(bg);
      g.userData.w = 0.16;
      return g;
    }

    if (kind === 'plant') {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.072, 20), clay);
      pot.position.y = 0.036;
      pot.castShadow = true;
      pot.receiveShadow = true;
      g.add(pot);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x5c7648, roughness: 0.76, side: THREE.DoubleSide });
      for (let i = 0; i < 9; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), leafMat);
        const a = (i / 9) * Math.PI * 2;
        leaf.scale.set(0.32, 1.35, 0.19);
        leaf.position.set(Math.cos(a) * 0.024, 0.108 + (i % 3) * 0.016, Math.sin(a) * 0.024);
        leaf.rotation.set(Math.cos(a) * 0.5, a, Math.sin(a) * 0.5);
        leaf.castShadow = true;
        g.add(leaf);
      }
      g.userData.w = 0.12;
      return g;
    }

    if (kind === 'vase') {
      const pts = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        pts.push(new THREE.Vector2(0.012 + Math.sin(t * Math.PI * 0.92) * 0.028 + t * 0.002, t * 0.17));
      }
      const m = new THREE.Mesh(
        new THREE.LatheGeometry(pts, 28),
        new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.4, metalness: 0.02 })
      );
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      g.userData.w = 0.09;
      return g;
    }

    if (kind === 'bowl') {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.058, 28, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
        new THREE.MeshStandardMaterial({ color: 0xeee5d3, roughness: 0.62, side: THREE.DoubleSide })
      );
      m.position.y = 0.046;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      g.userData.w = 0.12;
      return g;
    }

    if (kind === 'hourglass') {
      const wood = new THREE.MeshStandardMaterial({ map: woodTex([150, 108, 68], [1, 1]), roughness: 0.6 });
      const glass = new THREE.MeshStandardMaterial({
        color: 0xfff4dc,
        roughness: 0.15,
        metalness: 0.1,
        transparent: true,
        opacity: 0.42,
      });
      for (const y of [0.008, 0.148]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.014, 24), wood);
        cap.position.y = y;
        cap.castShadow = true;
        g.add(cap);
      }
      for (const [sign, y] of [[1, 0.052], [-1, 0.104]]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.048, 22), glass);
        c.position.y = y;
        c.rotation.x = sign > 0 ? Math.PI : 0;
        g.add(c);
      }
      const sand = new THREE.Mesh(
        new THREE.ConeGeometry(0.026, 0.026, 18),
        new THREE.MeshStandardMaterial({ color: 0xd8bd8c, roughness: 0.95 })
      );
      sand.position.y = 0.034;
      sand.rotation.x = Math.PI;
      g.add(sand);
      g.userData.w = 0.08;
      return g;
    }

    if (kind === 'stones') {
      const mats = [0x9d968c, 0x8d867c, 0xb0a89c].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 })
      );
      let y = 0;
      const sizes = [[0.062, 0.026], [0.048, 0.022], [0.034, 0.018]];
      sizes.forEach(([r, h], i) => {
        const st = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mats[i]);
        st.scale.set(1, h / (r * 2), 0.82);
        y += h / 2;
        st.position.y = y;
        st.rotation.y = i * 0.7;
        st.castShadow = true;
        st.receiveShadow = true;
        g.add(st);
        y += h / 2;
      });
      g.userData.w = 0.13;
      return g;
    }

    // 相框
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.128, 0.168, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.6 })
    );
    frame.position.y = 0.084;
    frame.rotation.x = -0.13;
    frame.castShadow = true;
    g.add(frame);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 84;
    const cx = c.getContext('2d');
    cx.fillStyle = '#efe8d8';
    cx.fillRect(0, 0, 64, 84);
    cx.fillStyle = 'rgba(96,80,60,.45)';
    cx.beginPath();
    cx.arc(32, 42, 15, 0, 6.3);
    cx.fill();
    cx.fillStyle = 'rgba(96,80,60,.28)';
    cx.fillRect(14, 60, 36, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pic = new THREE.Mesh(
      new THREE.PlaneGeometry(0.098, 0.132),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
    );
    pic.position.set(0, 0.084, 0.0075);
    pic.rotation.x = -0.13;
    g.add(pic);
    g.userData.w = 0.14;
    return g;
  }

  _mountDecor(d) {
    const g = this.geo;
    const sh = this.layout.shelves.find((s) => s.col === d.col && s.row === d.row);
    if (!sh) return null;
    const item = this._decor(d.kind);
    item.position.set(sh.x0 + d.x, sh.floorY, -(g.depth * 0.36));
    if (d.s && Math.abs(d.s - 1) > 0.001) item.scale.setScalar(d.s);
    item.userData.decor = d;
    item.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.decor = d;
        (this.decorMeshes || (this.decorMeshes = [])).push(o);
      }
    });
    if (!this.decorGroups) this.decorGroups = new Map();
    this.decorGroups.set(d, item);
    return item;
  }

  _buildProps(layout) {
    const group = new THREE.Group();
    const g = layout.geo;
    this.decorGroup = group;
    this.decorMeshes = [];
    this.decorGroups = new Map();

    // 1）我自己摆的，照存档复原
    const saved = (this.decors || []).filter((d) => d.view === this.view);
    for (const d of saved) {
      const item = this._mountDecor(d);
      if (item) group.add(item);
    }

    // 2）空着的层里随手放几件，别摆得太规律
    //    只挑矮的、窄的：空位本来就不宽，地球仪望远镜往上一站会把书挤掉
    const kinds = ['plant', 'vase', 'bowl', 'stones', 'hourglass', 'frame', 'bust', 'candle', 'clock', 'cat', 'bear', 'camera', 'dryflower', 'lavender', 'capital', 'gift', 'polaroid', 'tree', 'heart', 'lamp'];
    for (const gap of this.gaps) {
      if (gap.left < 0.14) continue;
      const sh = gap.shelf;
      if (saved.some((d) => d.col === sh.col && d.row === sh.row)) continue;
      const h = hashOf('prop:' + sh.col + ':' + sh.row);
      if (h % 10 > 4) continue;
      const kind = kinds[h % kinds.length];
      // 随手摆的这几件也要能拖：给它一份和存档里一样的身份
      const d = {
        view: this.view,
        col: sh.col,
        row: sh.row,
        x: +(gap.x + 0.062 - sh.x0).toFixed(4),
        s: 1,
        kind,
        auto: 1,
      };
      this.decors.push(d);
      const item = this._mountDecor(d);
      if (item) group.add(item);
    }
    return group;
  }

  /* ───────────── 摆件小样：给抽屉拍一套实物缩略图 ───────────── */
  // 手绘图示在 24px 下认不出来（马首怎么画都像瓶子），索性用同一套几何
  // 在离屏渲染器里各拍一张：光还是屋里的光，物件就是架上那件。
  // 整套 28 张只跑一次，约 200ms，结果留在内存里。
  decorThumbs(size = 128) {
    if (this._thumbs) return this._thumbs;
    let r;
    try {
      r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    } catch {
      return {};
    }
    r.setPixelRatio(2);
    r.setSize(size, size, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.18;
    r.setClearAlpha(0);

    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xfff5e6, 0x2b2118, 2.0));
    const keyL = new THREE.DirectionalLight(0xfff1dc, 2.6);
    keyL.position.set(1.8, 3, 2.6);
    sc.add(keyL);
    const rimL = new THREE.DirectionalLight(0xffd9a8, 1.0);
    rimL.position.set(-2.4, 1.4, 1.2);
    sc.add(rimL);

    const cam = new THREE.PerspectiveCamera(24, 1, 0.005, 20);
    const box = new THREE.Box3();
    const center = new THREE.Vector3();
    const span = new THREE.Vector3();
    const out = {};

    for (const k of DECOR_KINDS) {
      const g = this._decor(k.id);
      if (!g) continue;
      box.setFromObject(g);
      box.getCenter(center);
      box.getSize(span);
      g.position.set(-center.x, -center.y, -center.z);
      const wrap = new THREE.Group();
      wrap.add(g);
      // 半径按最长边算，每件东西在图里占的比重就接近
      const radius = Math.max(span.x, span.y, span.z) * 0.5 || 0.05;
      const dist = radius / Math.tan((24 * DEG) / 2) * 1.06;
      // 偏侧一点、略俯视：马首、睡猫这种只有侧面才认得出的东西才看得明白
      cam.position.set(dist * 0.46, dist * 0.34, dist * 0.84);
      cam.lookAt(0, 0, 0);
      sc.add(wrap);
      r.render(sc, cam);
      out[k.id] = r.domElement.toDataURL('image/png');
      sc.remove(wrap);
    }

    r.dispose();
    this._thumbs = out;
    return out;
  }

  /* 挑一件摆件放到最靠镜头、还有空位的那格 */
  addDecor(kind) {
    if (!this.layout) return null;
    const g = this.geo;
    const saved = this.decors || [];
    const spots = this.gaps.filter((gp) => {
      if (gp.left < 0.12) return false;
      const sh = gp.shelf;
      return !saved.some((d) => d.view === this.view && d.col === sh.col && d.row === sh.row);
    });
    if (!spots.length) return null;
    const mid = (s) => s.shelf.x0 + g.compW / 2;
    spots.sort((a, b) => Math.abs(mid(a) - this.pan) - Math.abs(mid(b) - this.pan));
    const gap = spots[0];
    const d = {
      view: this.view,
      col: gap.shelf.col,
      row: gap.shelf.row,
      x: +(gap.x - gap.shelf.x0 + 0.062).toFixed(4),
      s: 1,
      kind,
    };
    this.decors.push(d);
    this._saveDecors();
    this.gaps = this.gaps.filter((gp) => gp !== gap);
    const item = this._mountDecor(d);
    if (item && this.decorGroup) {
      this.decorGroup.add(item);
      item.userData.drop = performance.now();
      (this._drops || (this._drops = [])).push(item);
    }
    return d;
  }

  /* 点中一件摆件：给它套一圈黄框，底部弹出「尺寸 / 换层 / 挪动 / 移除」 */
  selectDecor(d) {
    this.pickedDecor = d || null;
    if (this._decorBox) {
      this.scene.remove(this._decorBox);
      this._decorBox.geometry.dispose();
      this._decorBox.material.dispose();
      this._decorBox = null;
    }
    if (d) {
      const item = this.decorGroups ? this.decorGroups.get(d) : null;
      if (item) {
        item.updateWorldMatrix(true, true);
        const box = new THREE.BoxHelper(item, 0xffc24a);
        box.material.depthTest = false;
        box.material.transparent = true;
        box.material.opacity = 0.95;
        box.renderOrder = 999;
        box.update();
        this.scene.add(box);
        this._decorBox = box;
      }
    }
    this.onDecorSelect?.(this.pickedDecor);
    this.invalidate();
    return this.pickedDecor;
  }

  // patch: { s: 缩放, dx: 横向挪动, row: 层数加减 }
  updateDecor(d, patch = {}) {
    if (!d) return null;
    const item = this.decorGroups ? this.decorGroups.get(d) : null;
    const sh = this.layout ? this.layout.shelves.find((s) => s.col === d.col && s.row === d.row) : null;

    if (patch.s != null) {
      d.s = Math.round(Math.max(0.6, Math.min(1.8, patch.s)) * 100) / 100;
      if (item) item.scale.setScalar(d.s);
    }
    if (patch.dx != null && sh) {
      const maxX = Math.max(0.05, this.geo.compW - 0.05);
      d.x = Math.round(Math.max(0.03, Math.min(maxX, d.x + patch.dx)) * 1000) / 1000;
      if (item) item.position.x = sh.x0 + d.x;
    }
    if (patch.row != null && sh) {
      const next = this.layout.shelves.find((s) => s.col === d.col && s.row === sh.row + patch.row);
      if (next) {
        d.row = next.row;
        if (item) {
          item.position.y = next.floorY;
          item.position.x = next.x0 + d.x;
        }
      }
    }
    this._saveDecors();
    if (this._decorBox && item) {
      item.updateWorldMatrix(true, true);
      this._decorBox.setFromObject(item);
    }
    return d;
  }

  removeDecor(d) {
    if (!d) return;
    const sh = this.layout ? this.layout.shelves.find((s) => s.col === d.col && s.row === d.row) : null;
    this.decors = (this.decors || []).filter((x) => x !== d);
    this._saveDecors();
    for (const m of [...(this.decorMeshes || [])]) {
      if (m.userData.decor !== d) continue;
      let o = m;
      while (o.parent && o.parent !== this.decorGroup) o = o.parent;
      if (o.parent === this.decorGroup) this.decorGroup.remove(o);
    }
    this.decorMeshes = (this.decorMeshes || []).filter((m) => m.userData.decor !== d);
    if (this.decorGroups) this.decorGroups.delete(d);
    if (this.pickedDecor === d) this.selectDecor(null);
    // 位置让回去，之后还能再摆
    if (sh) this.gaps.push({ shelf: sh, x: sh.x0 + d.x - 0.062, left: 0.14 });
    this.onDecorChange?.(this.decors.length);
  }

  _saveDecors() {
    try {
      localStorage.setItem(this.decorStoreKey || 'bookshelf.decors', JSON.stringify(this.decors || []));
    } catch {}
    this.invalidate();
  }

  /* 光标落在摆件那一层板上的位置（拖动都用它换算） */
  _decorPlaneAt(cx, cy) {
    if (!this.layout) return null;
    const g = this.geo;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // 摆件都贴在同一个深度上，就拿这一面当拖动的画布
    const z = -(g.depth * 0.36);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  /* 按住摆件拖：沿层板走，上下拖就是换层，跨格也行 */
  _dragDecorTo(cx, cy) {
    const dd = this._decorDrag;
    if (!dd || !this.layout) return;
    const g = this.geo;
    const raw = this._decorPlaneAt(cx, cy);
    if (!raw) return;
    // 拖起来有点「轻」：光标走 1，东西走 1.7。一格宽一米，1:1 的话
    // 从层板这头挪到那头要横拉整个屏幕，太笨。
    const GAIN = 1.7;
    const p = raw.clone();
    if (dd.ax != null) {
      p.x = dd.ax + (raw.x - dd.ax) * GAIN;
      p.y = dd.ay + (raw.y - dd.ay) * GAIN;
    }

    const pitch = g.compW + g.panel;
    const col = Math.max(0, Math.min(g.cols - 1, Math.floor((p.x - g.panel - S.sidePad) / pitch)));
    const rows = this.layout.shelves.filter((s) => s.col === col);
    if (!rows.length) return;
    let best = rows[0];
    for (const s of rows) if (Math.abs(s.floorY - p.y) < Math.abs(best.floorY - p.y)) best = s;
    const x = Math.max(0.03, Math.min(g.compW - 0.05, p.x - best.x0));

    const d = dd.d;
    d.col = best.col;
    d.row = best.row;
    d.x = Math.round(x * 1000) / 1000;
    const item = this.decorGroups ? this.decorGroups.get(d) : null;
    if (item) {
      item.position.set(best.x0 + d.x, best.floorY, -(g.depth * 0.36));
      if (this._decorBox) {
        item.updateWorldMatrix(true, true);
        this._decorBox.setFromObject(item);
      }
    }
    this.invalidate();
  }

  /* ───────────── 桌上那张纸：写、擦、被钢笔写 ───────────── */
  _initPaper() {
    const c = document.createElement('canvas');
    c.width = PAPER_W;
    c.height = PAPER_H;
    this.paperCanvas = c;
    this.paperCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    this.paperTex = tex;
    this._paintPaper();
    this._ensureHandFont();
  }

  // 手写字体是随站点打包的 woff2，canvas 拿到字体之前画出来的是后备字形。
  // 字体到位后重画一次纸面（正在写的信不打断）。
  _ensureHandFont() {
    if (this._handFontAsked || typeof document === 'undefined' || !document.fonts) return;
    this._handFontAsked = true;
    // 字体刚就绪时 canvas 的字形缓存常常还是旧的（同一个 canvas 要过一拍才换字），
    // 所以连续补画几次：就绪即刻一次、下一帧一次、半秒后再一次，直到画成手写体为止。
    const repaint = () => {
      if (!this.paperCanvas || this._penAnim) return false;
      this._paintPaper();
      return true;
    };
    const done = () => {
      if (repaint()) {
        requestAnimationFrame(() => repaint());
        setTimeout(() => repaint(), 220);
        setTimeout(() => repaint(), 900);
      }
    };
    document.fonts.load('92px "Sees Hand"', '见室小册今天读到一句话').then(done).catch(() => {});
    document.fonts.ready.then(done).catch(() => {});
  }

  _paperDate() {
    const t = new Date();
    return `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`;
  }

  setPaper(data) {
    this.paperData = { ...this.paperData, ...(data || {}) };
    if (this.paperCanvas) this._paintPaper();
    return this.paperData;
  }

  _paintPaper() {
    const ctx = this.paperCtx;
    if (!ctx) return;
    const d = this.paperData || {};
    const letter = d.mode === 'letter';
    paperBase(ctx, { head: letter ? '一封信' : '今天读到', date: this._paperDate() });
    const text = (letter ? d.letter : d.notes) || '';
    if (text.trim()) {
      const items = handLayout(ctx, text, HAND);
      items.forEach((it, i) => handDraw(ctx, it, i, HAND));
    } else {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.font = `38px ${HAND_FONT}`;
      ctx.fillStyle = '#3a342c';
      ctx.fillText(letter ? '点钢笔，写一封信…' : '点这张纸，写下今天读到的一句…', HAND.x, HAND.y);
      ctx.restore();
    }
    if (letter) {
      ctx.save();
      ctx.textAlign = 'right';
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = HAND.color;
      ctx.font = `40px ${HAND_FONT}`;
      ctx.fillText('— 见室小册', PAPER_W - 108, PAPER_H - 78);
      ctx.restore();
    }
    if (this.paperTex) this.paperTex.needsUpdate = true;
    this.invalidate();
  }

  /* 钢笔写字：先把纸清空、把字排好版，再一个字一个字地落到纸上 */
  writeLetter(text, onDone) {
    if (!this.paperCtx || !this.penPivot) return 0;
    this.paperData = { ...this.paperData, mode: 'letter', letter: text };
    const ctx = this.paperCtx;
    paperBase(ctx, { head: '一封信', date: this._paperDate() });
    // 一封信写多长都得落在纸上：先按正常字号排，排不下就一级级收字号，
    // 收到 54 还是写不下才截断（末尾留省略号）。落款那一行始终空出来。
    const bottom = PAPER_H - 148;
    const wrap = String(text || '');
    const lastLine = (arr, o) => (arr.length ? Math.floor((arr[arr.length - 1].y - o.y) / o.lh) + 1 : 0);
    let opt = { ...HAND, maxLines: 999 };
    let items = handLayout(ctx, wrap, opt);
    while (lastLine(items, opt) * opt.lh + opt.y > bottom && opt.fs > 54) {
      const fs = opt.fs - 6;
      opt = { ...opt, fs, lh: Math.round(fs * 1.412) };
      items = handLayout(ctx, wrap, opt);
    }
    const cap = Math.max(1, Math.floor((bottom - opt.y) / opt.lh) + 1);
    if (lastLine(items, opt) > cap) {
      items = handLayout(ctx, wrap, { ...opt, maxLines: cap });
      const tail = items[items.length - 1];
      if (tail) items.push({ ch: '…', x: tail.x + 6, y: tail.y });
    }
    // 短信别挤在纸头上：整块往下匀一匀，落在版心中间偏上
    const lines = lastLine(items, opt);
    const shift = Math.max(0, (bottom - opt.y - lines * opt.lh) / 2);
    if (shift > 4) for (const it of items) it.y += shift;
    this.paperTex.needsUpdate = true;
    this.focusDesk();
    this._penAnim = {
      items,
      opt,
      i: 0,
      t0: performance.now() + 900, // 先给镜头一点时间凑近
      // 长信写快点，短信写慢点：整封控制在四五秒
      step: Math.max(24, Math.min(66, 4200 / Math.max(1, items.length))),
      doneAt: 0,
      onDone,
    };
    this._penPose('write');
    this.invalidate();
    return items.length;
  }

  _penPose(mode) {
    const dir =
      mode === 'write' ? new THREE.Vector3(0.4, 0.88, 0.26) : new THREE.Vector3(0.93, 0.04, 0.36);
    this._penTargetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }

  /* 凑到桌前：纸上的字要看清，又得留住半张桌子 */
  focusDesk() {
    // 桌面这一景要把四样东西一起收进画面：杯子、纸、钢笔、右手边两本书。
    // 竖屏左右只有一条缝，多退半步、镜头略偏右（钢笔在纸右边），别把笔挡在画外。
    const narrow = (this.camera.aspect || 1.6) < 1;
    this.spot = 'desk';
    this.panY = 0;
    this.panYTarget = 0;
    this.camYOff = 0;
    this.panTarget = this._clampPan(-4.36 + (narrow ? 0 : 0.06));
    this.spotDist = 1.5 * (narrow ? 2.2 : 1);
    this.eyeBase = narrow ? 1.42 : 1.47;
    this.lookBase = narrow ? 0.74 : 0.79;
    this.zoom = narrow ? 1 : 0.7;
    this.camZTarget = this.spotDist * this.zoom;
    this._syncVertical();
    this.onZoom?.(this.zoom);
    this.invalidate();
  }

  /* ───────────── 墙上的海报：挂在最左侧那张桌子上方 ───────────── */
  _posters() {
    const g = new THREE.Group();
    const D = 0.32;
    const make = (draw, w, h, cx, cy, frame) => {
      const c = document.createElement('canvas');
      const scale = 1180 / Math.max(w, h);
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      draw(c.getContext('2d'), c.width, c.height);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;

      const board = new THREE.Group();
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0 })
      );
      face.position.z = 0.008;
      face.receiveShadow = true;
      board.add(face);

      const fm =
        frame === 'silver'
          ? new THREE.MeshStandardMaterial({ color: 0xc4c4bd, roughness: 0.36, metalness: 0.58 })
          : frame === 'red'
            ? new THREE.MeshStandardMaterial({ color: 0xa33a2b, roughness: 0.62 })
            : new THREE.MeshStandardMaterial({ map: woodTex([178, 134, 94], [1, 1]), roughness: 0.7 });
      const t = 0.013;
      const bar = (bw, bh, bx, by) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.019), fm);
        m.position.set(bx, by, 0.0055);
        m.castShadow = true;
        board.add(m);
      };
      bar(w + t * 2, t, 0, h / 2 + t / 2);
      bar(w + t * 2, t, 0, -h / 2 - t / 2);
      bar(t, h, -w / 2 - t / 2, 0);
      bar(t, h, w / 2 + t / 2, 0);

      board.position.set(cx, cy, -D + 0.012);
      g.add(board);
      return board;
    };

    // 五张全挂在书桌上方那面墙：一大四小、高低错落的一面小画廊，
    // 底边都压在书桌台面（0.745）以上，坐下抬头正好看见
    make(posterSpace, 0.44, 0.58, -4.78, 1.44, 'silver');
    make(posterBraque, 0.28, 0.38, -4.3, 1.58, 'none');
    make(posterBauhaus, 0.28, 0.38, -4.3, 1.14, 'none');
    make(posterChair, 0.24, 0.3, -3.98, 1.5, 'red');
    make(posterAbstract, 0.26, 0.34, -3.98, 1.1, 'none');
    return g;
  }

  /* ───────────── 桌边的阅读角：沙发、Flos 台灯、HAY 书桌 ───────────── */
  _corner() {
    const g = new THREE.Group();
    const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const Cyl = (rt, rb, h, n = 20) => new THREE.CylinderGeometry(rt, rb, h, n);
    const put = (parent, geo, m, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };
    // 两点之间一根杆：椅子腿、桌撑都靠它
    const up = new THREE.Vector3(0, 1, 0);
    const rod = (parent, a, b, r, m) => {
      const A = new THREE.Vector3(...a);
      const B = new THREE.Vector3(...b);
      const dir = B.clone().sub(A);
      const o = new THREE.Mesh(Cyl(r, r, dir.length(), 12), m);
      o.position.copy(A).add(B).multiplyScalar(0.5);
      o.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
      return o;
    };

    const oak = new THREE.MeshStandardMaterial({ map: woodTex([206, 180, 140], [1, 1]), roughness: 0.6 });
    const oakDeep = new THREE.MeshStandardMaterial({ map: woodTex([176, 148, 112], [2, 1]), roughness: 0.7 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x3b352e, roughness: 0.46, metalness: 0.5 });

    /* —— 地毯：把这一小块从地板上圈出来 —— */
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(4.1, 1.85),
      new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-5.35, 0.006, 0.52);
    rug.receiveShadow = true;
    g.add(rug);

    /* —— HAY 那张书桌：薄台面 + 四条外撇的腿 + 深色横撑 —— */
    const desk = new THREE.Group();
    desk.position.set(-4.42, 0, -0.03);
    const DW = 1.15;
    const DD = 0.6;
    const DH = 0.745;
    put(desk, Box(DW, 0.034, DD), oak, 0, DH);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = put(desk, Box(0.05, DH, 0.052), oak, sx * 0.508, DH / 2, sz * 0.245);
        leg.rotation.z = sx * 0.045;
        leg.rotation.x = -sz * 0.03;
      }
      put(desk, Box(0.02, 0.075, 0.5), oak, sx * 0.512, DH - 0.055, 0);
    }
    for (const sz of [-1, 1]) {
      put(desk, Box(DW - 0.2, 0.028, 0.02), darkSteel, 0, 0.4, sz * 0.25);
    }

    /* —— Flos Snoopy（1967，Castiglioni 兄弟）：
       一只矮胖的白色 Carrara 大理石圆鼓（Ø260 × 高 110），光源藏在里面；
       上面扣一片 Ø370 的黑搪瓷铝碟，后沿被铬钢小臂挑起，前沿压到座子边上 ——
       像 Snoopy 低头把鼻子探进水盆，光从檐口往前淌到桌面上。 —— */
    const marble = new THREE.MeshStandardMaterial({
      map: marbleTex(),
      color: 0xffffff,
      roughness: 0.42,
      metalness: 0.02,
    });
    const lampChrome = new THREE.MeshStandardMaterial({ color: 0xd0d3d8, roughness: 0.32, metalness: 0.4 });
    const lamp = new THREE.Group();
    lamp.position.set(-0.34, DH + 0.017, -0.13);

    // 大理石鼓：Ø230（近底略收），高 110，顶沿一圈 6mm 的圆边
    const basePts = [
      [0.0, 0.0], [0.113, 0.0], [0.122, 0.012], [0.122, 0.086],
      [0.12, 0.099], [0.113, 0.107], [0.095, 0.11], [0.0, 0.11],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    put(lamp, new THREE.LatheGeometry(basePts, 56), marble, 0, 0, 0);
    // 座身正面三个散热孔：小小的、贴着下缘，别摆成一排眼睛
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x332e28, roughness: 0.9 });
    for (const hx of [-0.016, 0, 0.016]) {
      const hole = put(lamp, Cyl(0.0034, 0.0034, 0.003, 12), holeMat, hx, 0.046, 0.1225);
      hole.rotation.x = Math.PI / 2;
    }
    // 座顶那片厚玻璃：光从这里透出去，被罩子挡住大半，只从檐下漏
    const glass = put(
      lamp,
      Cyl(0.094, 0.094, 0.006, 36),
      new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.38 }),
      0,
      0.109
    );
    glass.castShadow = false;

    // 罩子：Ø370 的浅碟，拱高 55，外黑釉内白搪瓷，罩沿一圈翻边
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0x0d0d10,
      roughness: 0.18,
      metalness: 0.16,
      side: THREE.DoubleSide,
      emissive: 0xffcf95,
      emissiveIntensity: 0,
    });
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xf8f2e6,
      roughness: 0.4,
      metalness: 0,
      side: THREE.BackSide,
      emissive: 0xffd7a6,
      emissiveIntensity: 0,
    });
    const rimR = 0.185;
    const outerPts = [
      [rimR, 0.0], [0.183, 0.008], [0.176, 0.016], [0.158, 0.024],
      [0.124, 0.03], [0.076, 0.033], [0.0, 0.034],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const innerPts = [
      [rimR - 0.005, 0.003], [0.177, 0.011], [0.17, 0.019], [0.152, 0.026],
      [0.119, 0.031], [0.072, 0.034], [0.0, 0.035],
    ].map(([x, y]) => new THREE.Vector2(x, y));

    const shade = new THREE.Group();
    // 罩心悬在座面之上：前沿落到离座顶 1cm 的地方，后沿高高抬起
    shade.position.set(0, 0.181, 0.004);
    // 往前压（+x 旋转 = 前沿下沉），光顺着檐口泼向桌子前方
    shade.rotation.x = 0.3;
    const outer = new THREE.Mesh(new THREE.LatheGeometry(outerPts, 64), shadeMat);
    outer.castShadow = true;
    outer.receiveShadow = true;
    shade.add(outer);
    const inner = new THREE.Mesh(new THREE.LatheGeometry(innerPts, 64), innerMat);
    inner.castShadow = false;
    shade.add(inner);
    // 罩沿的翻边，让边缘有厚度，不是一张纸
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.002, 0.005, 8, 72), shadeMat);
    rim.rotation.x = Math.PI / 2;
    rim.castShadow = true;
    shade.add(rim);
    this.lampMat = innerMat;
    this.lampShell = shadeMat;
    lamp.add(shade);

    // 座子后侧那截铬钢小臂：从大理石顶面斜挑到罩子后背，只露出一小段
    const arm = put(lamp, Cyl(0.0075, 0.0075, 0.13, 14), lampChrome, 0, 0.158, -0.093);
    arm.rotation.x = 0.42;
    put(lamp, Cyl(0.011, 0.011, 0.016, 16), lampChrome, 0, 0.222, -0.118);

    // 藏在罩里的灯泡：贴檐口一点，光才往前跑
    const bulb = new THREE.PointLight(0xffcf9c, 0.3, 2.4, 2);
    bulb.position.set(0, 0.13, 0.03);
    lamp.add(bulb);
    this.lampLight = bulb;
    // 真品总高 369、罩子 Ø394；桌面上按 0.86 收一点，免得黑罩子压掉半张桌子
    lamp.scale.setScalar(0.86);
    lamp.position.y = DH + 0.017;
    desk.add(lamp);

    /* —— 桌上：一杯咖啡、一张摊开的纸、一支钢笔 —— */
    const TOP = DH + 0.017; // 台面上表面

    // 咖啡杯：先一只浅浅的碟，再一只敞口杯，杯耳朝右
    const ceramic = new THREE.MeshStandardMaterial({ color: 0xf1ece1, roughness: 0.42 });
    const ceramicOpen = new THREE.MeshStandardMaterial({ color: 0xf1ece1, roughness: 0.42, side: THREE.DoubleSide });
    const ceramicIn = new THREE.MeshStandardMaterial({ color: 0xe6dfd1, roughness: 0.55, side: THREE.BackSide });
    const coffee = new THREE.MeshStandardMaterial({ color: 0x3a2114, roughness: 0.22, metalness: 0.02 });
    const cup = new THREE.Group();
    // 摆在纸的左前方、靠里一点：离镜头太近会显得比纸还大
    cup.position.set(-0.335, TOP, 0.075);
    cup.rotation.y = -0.62;
    // 碟：一圈浅浅的盘沿
    put(cup, Cyl(0.074, 0.066, 0.009, 44), ceramic, 0, 0.0045);
    put(cup, Cyl(0.05, 0.047, 0.006, 34), ceramic, 0, 0.0118);
    // 杯身：厚壁直筒、口沿厚一点，才像瓷杯不像纸杯
    put(cup, Cyl(0.0445, 0.0425, 0.088, 44), ceramicOpen, 0, 0.056);
    put(cup, Cyl(0.0388, 0.0372, 0.084, 40), ceramicIn, 0, 0.0575);
    const cupRim = put(cup, new THREE.TorusGeometry(0.0418, 0.0038, 10, 44), ceramic, 0, 0.0995);
    cupRim.rotation.x = Math.PI / 2;
    const coffeeTop = put(cup, new THREE.CircleGeometry(0.0385, 40), coffee, 0, 0.0835);
    coffeeTop.rotation.x = -Math.PI / 2;
    // 杯耳：偏上、略扁，握着才顺手
    const cupH = put(cup, new THREE.TorusGeometry(0.0205, 0.0048, 10, 28), ceramic, 0.0455, 0.062);
    cupH.rotation.set(0, 0, Math.PI / 2);
    cupH.scale.set(1, 1, 1.12);
    desk.add(cup);

    /* —— 一张纸：手写笔记就写在这上面（点它可以重写） —— */
    if (!this.paperCanvas) this._initPaper();
    const PN = PAPER_M.h;
    const PW = PAPER_M.w;
    const rig = new THREE.Group();
    rig.position.set(0.03, TOP + 0.0018, 0.02);
    rig.rotation.y = 0.04;
    desk.add(rig);
    this.paperRig = rig;
    // 底下垫两张：纸才有分量，也压出一点错位的边
    const underMat = new THREE.MeshStandardMaterial({ color: 0xeee5d2, roughness: 0.96 });
    for (const [dx, dz, rot, dy] of [
      [-0.007, 0.005, -0.03, -0.0012],
      [0.006, -0.004, 0.021, -0.0024],
    ]) {
      const u = new THREE.Mesh(new THREE.PlaneGeometry(PW - 0.006, PN - 0.006), underMat);
      u.rotation.set(-Math.PI / 2, 0, rot);
      u.position.set(dx, dy, dz);
      u.receiveShadow = true;
      rig.add(u);
    }
    const paperMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PW, PN),
      new THREE.MeshStandardMaterial({ map: this.paperTex, roughness: 0.95, metalness: 0 })
    );
    paperMesh.rotation.x = -Math.PI / 2;
    paperMesh.receiveShadow = true;
    rig.add(paperMesh);
    this.paperMesh = paperMesh;

    /* —— 钢笔：黑树脂笔杆、金色笔尖，不用的时候斜搁在纸右边 —— */
    const penPivot = new THREE.Group();
    rig.add(penPivot);
    this.penPivot = penPivot;
    this.penMeshes = [];
    const resin = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.2, metalness: 0.14 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.28, metalness: 0.66 });
    const body = new THREE.Group();
    body.scale.setScalar(0.9);
    penPivot.add(body);
    const seg = (geo, mat, y) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      body.add(m);
      return m;
    };
    const nib = seg(new THREE.ConeGeometry(0.0042, 0.026, 16), gold, 0.013);
    nib.rotation.x = Math.PI;
    seg(Cyl(0.0046, 0.0046, 0.007, 16), gold, 0.029);
    seg(Cyl(0.0052, 0.0059, 0.03, 18), resin, 0.047);
    seg(Cyl(0.0061, 0.0061, 0.098, 18), resin, 0.111);
    seg(Cyl(0.0062, 0.0054, 0.014, 18), gold, 0.167);
    const clip = new THREE.Mesh(Box(0.0018, 0.036, 0.0042), gold);
    clip.position.set(0.0068, 0.152, 0);
    body.add(clip);
    // 看不见的「点击区」：笔太细，按上去得有个宽容的手感
    const hit = new THREE.Mesh(Cyl(0.016, 0.016, 0.19, 8), new THREE.MeshBasicMaterial());
    hit.position.y = 0.095;
    hit.material.visible = false;
    body.add(hit);
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.userData.pen = true;
      this.penMeshes.push(o);
    });
    const UP = new THREE.Vector3(0, 1, 0);
    this._penHome = {
      pos: new THREE.Vector3(PW / 2 + 0.055, 0.0045, 0.12),
      quat: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(0.93, 0.04, 0.36).normalize()),
    };
    penPivot.position.copy(this._penHome.pos);
    penPivot.quaternion.copy(this._penHome.quat);
    this._penTargetPos = this._penHome.pos.clone();
    this._penTargetQuat = this._penHome.quat.clone();
    g.add(desk);

    /* —— 桌前的椅子：HAY About A Chair 的样子 —— 一体弯壳坐面 + 四条外撇的黑钢管腿 —— */
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xe4ddd0, roughness: 0.62 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2c2926, roughness: 0.42, metalness: 0.55 });
    const chair = new THREE.Group();
    chair.position.set(-4.42, 0, 0.5);
    chair.rotation.y = Math.PI + 0.14; // 基本正对桌子，稍歪一点才像有人刚坐过
    // 圆角矩形轮廓 + 挤出 + 倒角 = 有厚度、边缘圆润的壳
    const rrect = (w, d, r) => {
      const s = new THREE.Shape();
      const hw = w / 2;
      const hd = d / 2;
      s.moveTo(-hw + r, -hd);
      s.lineTo(hw - r, -hd);
      s.quadraticCurveTo(hw, -hd, hw, -hd + r);
      s.lineTo(hw, hd - r);
      s.quadraticCurveTo(hw, hd, hw - r, hd);
      s.lineTo(-hw + r, hd);
      s.quadraticCurveTo(-hw, hd, -hw, hd - r);
      s.lineTo(-hw, -hd + r);
      s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
      return s;
    };
    const shell = (w, d, depth, bevel) => {
      const geo = new THREE.ExtrudeGeometry(rrect(w, d, Math.min(w, d) * 0.26), {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 10,
      });
      geo.rotateX(-Math.PI / 2); // 轮廓是俯视图，转成水平放（挤出方向变成向上的厚度）
      geo.translate(0, bevel, 0); // 底面（含倒角）落在 y=0，往上长
      return geo;
    };
    // 立起来的板：轮廓在 XY 竖直面上，厚度沿 Z —— 椅背用
    const panel = (w, h, depth, bevel) =>
      new THREE.ExtrudeGeometry(rrect(w, h, Math.min(w, h) * 0.3), {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 10,
      });
    // 坐面：0.44 × 0.42，微微前倾 2°
    const seat = put(chair, shell(0.44, 0.42, 0.03, 0.011), shellMat, 0, 0.428, 0);
    seat.rotation.x = 0.035;
    // 靠背：比坐面窄一拳，向后仰 10°，下沿埋进坐面
    const back = put(chair, panel(0.38, 0.34, 0.026, 0.01), shellMat, 0, 0.56, -0.19);
    back.rotation.x = -0.18;
    // 四条腿：前后各自向外撇，像随时要往前走
    for (const sx of [-1, 1]) {
      rod(chair, [sx * 0.18, 0.435, 0.155], [sx * 0.225, 0.008, 0.205], 0.012, legMat);
      rod(chair, [sx * 0.18, 0.435, -0.155], [sx * 0.235, 0.008, -0.215], 0.012, legMat);
      // 左右两侧的横撑，把前后腿箍成一体
      rod(chair, [sx * 0.2, 0.2, 0.175], [sx * 0.208, 0.2, -0.18], 0.009, legMat);
    }
    g.add(chair);

    /* —— 柯布西耶 LC3 双人位：干邑色皮垫装在铬钢管外框里，垫子边缘圆润 —— */
    const leatherBase = new THREE.MeshStandardMaterial({ color: 0x8a5932, roughness: 0.66 });
    const leatherPad = new THREE.MeshStandardMaterial({ color: 0x9d6c40, roughness: 0.62 });
    // 场景里没有环境贴图，纯金属会反射成一团黑；压低金属度、提亮底色，
    // 才看得出是抛光铬钢管
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd3d6da, roughness: 0.34, metalness: 0.42 });
    const sofa = new THREE.Group();
    // 挪到书桌的左侧，中间隔开不到一米的空地 —— 是一角，不是两件家具
    sofa.position.set(-6.35, 0, 0.42);
    sofa.rotation.y = 0.55; // 侧身朝屋里，正脸偏一点对着书桌
    // 皮座底板（垫子都长在它上面）
    put(sofa, Box(0.98, 0.04, 0.56), leatherBase, 0, 0.27, 0);
    // 两块坐垫 + 两块靠背垫 + 两块扶手垫，全是圆角挤出的软垫；
    // 垫子都收在铬钢框里面，扶手垫顶面跟侧管齐平（LC3 的做法）
    for (const sx of [-1, 1]) {
      put(sofa, shell(0.31, 0.48, 0.115, 0.014), leatherPad, sx * 0.165, 0.3, 0.01);
      const bc = put(sofa, shell(0.31, 0.28, 0.15, 0.014), leatherPad, sx * 0.165, 0.47, -0.205);
      bc.rotation.x = -0.16;
      put(sofa, shell(0.12, 0.5, 0.11, 0.012), leatherPad, sx * 0.39, 0.36, 0);
    }
    // 铬钢外框：四角立管直通扶手上沿，每侧两根横杆箍住皮垫
    for (const sx of [-1, 1]) {
      rod(sofa, [sx * 0.47, 0, 0.28], [sx * 0.47, 0.52, 0.28], 0.014, chrome);
      rod(sofa, [sx * 0.47, 0, -0.28], [sx * 0.47, 0.52, -0.28], 0.014, chrome);
      rod(sofa, [sx * 0.47, 0.52, -0.28], [sx * 0.47, 0.52, 0.28], 0.014, chrome);
      rod(sofa, [sx * 0.47, 0.3, -0.28], [sx * 0.47, 0.3, 0.28], 0.014, chrome);
    }
    // 底部前后两根横杆，靠背后面的两根短立管 + 一根顶杆
    for (const sz of [-1, 1]) rod(sofa, [-0.47, 0.08, sz * 0.28], [0.47, 0.08, sz * 0.28], 0.014, chrome);
    for (const sx of [-1, 1]) rod(sofa, [sx * 0.38, 0.52, -0.31], [sx * 0.38, 0.63, -0.31], 0.014, chrome);
    rod(sofa, [-0.38, 0.63, -0.31], [0.38, 0.63, -0.31], 0.014, chrome);
    g.add(sofa);

    /* —— 墙上的电灯开关：就在画廊右手边，点一下开灯 / 关灯 —— */
    const sw = new THREE.Group();
    sw.position.set(-3.62, 1.18, -0.31);
    const plate = put(sw, Box(0.078, 0.118, 0.007), new THREE.MeshStandardMaterial({ color: 0xf3eee3, roughness: 0.88 }));
    const rocker = put(
      sw,
      Box(0.03, 0.044, 0.016),
      new THREE.MeshStandardMaterial({ color: 0xf8f4ea, roughness: 0.8, emissive: 0xffcf95, emissiveIntensity: 0 }),
      0,
      0.012,
      0.009
    );
    plate.userData.switchHit = true;
    rocker.userData.switchHit = true;
    this.rocker = rocker;
    this.rockerMat = rocker.material;
    this.switchParts = [plate, rocker];
    g.add(sw);

    return g;
  }

  _tables() {
    const group = new THREE.Group();
    const light = new THREE.MeshStandardMaterial({ map: woodTex([202, 176, 138], [1, 1]), roughness: 0.72 });
    const make = (spec, thick = 0.042) => {
      const t = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry(spec.w, thick, spec.d), light);
      top.position.y = spec.h;
      top.castShadow = true;
      top.receiveShadow = true;
      t.add(top);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, spec.h, 0.05), light);
        leg.position.set((sx * (spec.w - 0.09)) / 2, spec.h / 2, (sz * (spec.d - 0.09)) / 2);
        leg.castShadow = true;
        leg.receiveShadow = true;
        t.add(leg);
      }
      t.position.set(spec.x, 0, spec.z);
      return t;
    };
    group.add(make(TABLES.reading));
    group.add(make(TABLES.want));
    return group;
  }

  /* ───────────── 数据 → 场景 ───────────── */
  async setLibrary(lib, { coverTex, spineTex } = {}) {
    this.lib = lib;
    this.books = lib.books.map((b) => {
      // 高矮厚三样各自独立取随机，别让一本书的三个维度互相牵连
      const bh = 0.216 + rnd(hashOf(b.id + 'H')) * 0.06; // 0.194–0.276，一层 318mm 刚好留一指
      const bw = bh * (0.63 + rnd(hashOf(b.id + 'W')) * 0.12);
      const bt = 0.009 + rnd(hashOf(b.id + 'T')) * 0.023; // 9–32mm
      return { ...b, h: bh, w: bw, t: bt, cat: b.categoryName || b.category || '未分类' };
    });
    this.cats = (lib.categories || []).map((c) => ({ name: c.name, count: c.count }));
    this.cats.sort((a, b) => {
      const tail = (c) => (c.name === '未归档' || c.name === '其他' ? 1 : 0);
      return tail(a) - tail(b) || b.count - a.count;
    });
    this.coverTex = coverTex;
    this.spineTex = spineTex;

    // 桌上摆哪些：在读里最近翻过的十几本摊在左桌，想读里最近动过的一摞压在右桌
    const recent = (a, b) => (b.readAt || 0) - (a.readAt || 0);
    this.readingPicks = this.books.filter((b) => b.status === 'reading').sort(recent).slice(0, TABLES.reading.books);
    this.wantPicks = this.books.filter((b) => b.status === 'to-read').sort(recent).slice(0, TABLES.want.books);
    // 书桌右侧那两本：最近确实翻过的（跟左桌不重复），点开就能接着读
    this.deskPicks = this.books
      .filter((b) => b.status === 'reading' && !this.readingPicks.includes(b))
      .sort(recent)
      .slice(0, 2);
    if (this.deskPicks.length < 2) {
      for (const b of [...this.books].sort(recent)) {
        if (this.deskPicks.length >= 2) break;
        if (this.deskPicks.includes(b) || this.readingPicks.includes(b) || !b.readAt) continue;
        this.deskPicks.push(b);
      }
    }
    this.tableIds = new Set([...this.readingPicks, ...this.wantPicks, ...this.deskPicks].map((b) => b.id));

    this.build();
    this.ready = true;
  }

  build() {
    // 重建之前先把摆件的选中框摘掉，不然它会指着一个已经被 dispose 的对象
    if (this._decorBox) {
      this.scene.remove(this._decorBox);
      this._decorBox.geometry.dispose();
      this._decorBox.material.dispose();
      this._decorBox = null;
    }
    if (this.pickedDecor) {
      this.pickedDecor = null;
      this.onDecorSelect?.(null);
    }
    if (this.caseGroup) {
      this.scene.remove(this.caseGroup);
      this.caseGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    if (this.bookMesh) {
      this.scene.remove(this.bookMesh);
      this.bookMesh.geometry.dispose();
      this.bookMesh = null;
    }
    const first = !this.caseGroup;
    const layout = this._layout(this.view);
    this.layout = layout;
    this.geo = layout.geo;
    this.caseW = layout.geo.width;
    this.caseH = layout.geo.height;
    // 书的前脸比墙面凸出一点，缩放锚点要用这个深度才不会漂
    this.caseFrontZ = (layout.geo.depth || 0.32) * 0.42;

    const g = new THREE.Group();
    g.add(this._buildCase(layout.geo));
    g.add(this._buildBooks(layout, this.view, this.coverTex, this.spineTex));
    g.add(this._buildProps(layout));
    g.add(this._tables());
    g.add(this._corner()); // 左侧桌边的阅读角：沙发 / 台灯 / 书桌
    g.add(this._posters()); // 桌子上面那面墙的几张海报

    this.caseGroup = g;
    this.scene.add(g);

    if (this.contactStrip) {
      this.contactStrip.scale.set(this.caseW + 1.4, 0.55, 1);
      this.contactStrip.position.x = this.caseW / 2;
    }

    this.bookMesh.position.x = 0;
    this.spotDist = this._fitDist();
    this.camZ = this.spotDist * (this.zoom || 1);
    if (this.spot === 'home') {
      this.camZTarget = this.camZ;
      // 柜子在画面里上下居中，不然最下层会被屏幕底边切掉
      this.eyeBase = CAM.y;
      this.lookBase = this.caseH / 2;
      this._syncVertical();
      this.lookY = this.lookYTarget;
    }
    if (first) {
      this.panTarget = this._homePan();
      this.pan = this.panTarget;
    } else {
      this.panTarget = this._clampPan(this.panTarget);
      this.pan = this._clampPan(this.pan);
    }
    this.applyFilter();
    this._applyNight();
    this.invalidate();
  }

  _homePan() {
    // 柜子左边缘外挂着门口的木牌，所以默认视线往左偏一点，
    // 宁可右边多切掉半米（能拖过去看），也要让牌子整块露出来。
    return this.caseW / 2 - CAM.offsetX - 0.36;
  }

  _fitDist() {
    const tan = Math.tan((this.camera.fov * DEG) / 2);
    const aspect = this.camera.aspect || 1.6;
    // 按高度取景：柜子再宽也靠拖动看，不为了塞下整面墙把书缩成邮票。
    // 留一点点余量，别让最下一层贴着屏幕底边被切掉。
    const pad = this.view === 'covers' ? 1.05 : 1.13;
    return (this.caseH * pad) / (2 * tan);
  }

  setSpineTexture(tex) {
    if (!this.spineMat) return;
    this.spineMat.map = tex;
    if (this.spineMat.emissiveMap) this.spineMat.emissiveMap = tex;
    this.spineMat.needsUpdate = true;
    this.invalidate();
  }

  /* ───────────── 灯：白天是窗光，关灯只剩柜子里的暗藏灯带 ───────────── */
  setNight(on) {
    this.night = !!on;
    this._applyNight();
  }

  _applyNight() {
    const on = this.night;
    if (this.hemi) this.hemi.intensity = on ? 0.05 : 0.66;
    if (this.amb) this.amb.intensity = on ? 0.03 : 0.18;
    if (this.key) {
      this.key.intensity = on ? 0.04 : 2.15;
      this.key.castShadow = !on;
    }
    if (this.glow) this.glow.intensity = on ? 0.45 : 26;
    if (this.bounce) this.bounce.intensity = on ? 0.03 : 0.34;
    this.scene.background.set(on ? '#131009' : '#ded8ca');
    this.renderer.toneMappingExposure = on ? 1.02 : 0.98;
    for (const m of this.roomMats || []) m.color.setScalar(on ? 0.12 : 1);
    for (const m of this.caseMats || []) m.color.setScalar(on ? 0.5 : 1);
    if (this.strips) this.strips.visible = on;
    if (this.glowMat) this.glowMat.opacity = on ? 0.55 : 0;
    if (this.coverMat) this.coverMat.emissiveIntensity = on ? 0.95 : 0;
    if (this.spineMat) this.spineMat.emissiveIntensity = on ? 0.88 : 0;
    for (const m of this.plateMats || []) m.emissiveIntensity = on ? 0.5 : 0;
    if (this.wallShade) this.wallShade.visible = !on;
    if (this.contactStrip) this.contactStrip.material.opacity = on ? 0.18 : 1;
    for (const pl of this.caseLights || []) pl.intensity = on ? 1.3 : 0;
    // 关灯后招牌不该跟着消失：让纸面自己亮一点，像被走廊的灯照着
    // 0.5 时整块像灯箱，压到 0.3 —— 只留一层薄光
    if (this.signMat) this.signMat.emissiveIntensity = on ? 0.3 : 0.1;
    // 阅读角那盏灯：白天只是个小暖点，夜里它能照亮沙发和半面墙
    // 黑釉罩子自己发太多光会像一块黑炭在烧，只留檐口一圈暖意
    if (this.lampMat) this.lampMat.emissiveIntensity = on ? 0.32 : 0.04;
    if (this.lampLight) this.lampLight.intensity = on ? 2.6 : 0.32;
    // 墙上开关的拨杆跟着翻，夜里拨杆透一点暖光
    if (this.rocker) this.rocker.rotation.x = on ? 0.5 : -0.5;
    if (this.rockerMat) this.rockerMat.emissiveIntensity = on ? 0.35 : 0;
    this.invalidate();
  }

  /* ───────────── 排序：分类内按评分降序 ───────────── */
  setSort(mode) {
    this.sortBy = mode || null;
    this.build();
  }

  setView(view) {
    if (view === this.view) return;
    // 年表是独立于 3D 房间的 DOM 层：只改标记、不重建场景，房间在 CSS 里让位
    if (view === 'timeline') {
      this.view = 'timeline';
      this.selected = null;
      return;
    }
    this.view = view;
    this.selected = null;
    const keep = this.pan;
    this.build();
    this.panTarget = this._clampPan(keep);
    this.pan = this.panTarget;
    this.invalidate();
  }

  // 柜子越宽，同样的手势要拉得越远，不然一屏拖不完
  _panRate() {
    return Math.max(0.0042, (this.caseW || 3) / 1800);
  }

  _clampPan(x) {
    // 左边现在有沙发和书桌，能一直拖过去；右边留一点余量
    return Math.max(-6.9, Math.min(this.caseW + 0.4, x));
  }

  panTo(x, smooth = true) {
    this.panTarget = this._clampPan(x);
    if (!smooth) this.pan = this.panTarget;
  }

  // 三个落脚点：整面柜子、在读的矮桌、想读的矮桌
  focusSpot(spot = 'home') {
    this.spot = spot;
    // 换落脚点时视点回正，不然从「最上层」跳到桌子会一直仰着头
    this.panY = 0;
    this.panYTarget = 0;
    this.camYOff = 0;
    // 竖屏时左右能看到的范围太窄，往后退一点，别把桌子怼到脸上
    const wide = (this.camera.aspect || 1.6) < 1 ? 1.34 : 1;
    if (spot === 'reading') {
      // 这一脚现在是一整个阅读角：左边沙发、书桌+墙上的画廊、桌前的椅子、右边矮桌
      // 沙发挪到桌子左侧后整块宽了，视点往左挪、往后退一点，左右两边都收得进来
      this.panTarget = this._clampPan(-5.02);
      this.spotDist = (this.view === 'covers' ? 6.25 : 6.1) * wide;
      this.eyeBase = 1.24;
      this.lookBase = 0.8;
      this.camZTarget = this.spotDist * (this.zoom || 1);
      this._syncVertical();
      return;
    }
    if (spot === 'want') {
      this.panTarget = this._clampPan(TABLES.want.x);
      this.spotDist = (this.view === 'covers' ? 2.7 : 2.36) * wide;
      this.eyeBase = 1.14;
      this.lookBase = TABLES.want.h + 0.22;
      this.camZTarget = this.spotDist * (this.zoom || 1);
      this._syncVertical();
      return;
    }
    this.panTarget = this._homePan();
    this.spotDist = this._fitDist();
    this.camZTarget = this.spotDist * (this.zoom || 1);
    this.eyeBase = CAM.y;
    this.lookBase = this.caseH / 2 || CAM.lookY;
    this._syncVertical();
  }

  /* ───────────── 视点上下：只在放大后生效，像真的蹲下 / 踮脚 ───────────── */
  _zoomHome() {
    return this.spotDist || this._fitDist();
  }

  _zoomedIn() {
    return (this.camZTarget || this.camZ) < this._zoomHome() * 0.94;
  }

  // 视点能走多高多低：底边留一点，顶边留一点
  _clampLook(y) {
    const top = Math.max(0.9, (this.caseH || 2.0) - 0.12);
    return Math.max(0.34, Math.min(top, y));
  }

  _syncVertical() {
    const want = this._clampLook(this.lookBase + this.panYTarget);
    this.panYTarget = want - this.lookBase;
    // 眼随视点走六成：踮脚看顶层时，人不会贴在原地把脖子仰断
    this.eyeYTarget = this.eyeBase + this.panYTarget * 0.6;
    this.lookYTarget = want;
  }

  panYBy(dy) {
    this.panYTarget += dy;
    this._syncVertical();
  }

  /* ───────────── 缩放：以指针下的那一点为锚 — 手指按住哪本书，哪本书就不动 ───────────── */
  // o = { camZ, lookY, eyeY, panX }，不给就用当前值；缩放时会拿「目标姿态」再算一遍
  _wallPoint(cx, cy, o = {}) {
    const r = this.renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const z = Math.max(0.4, o.camZ == null ? this.camZ : o.camZ);
    const near = Math.min(1, z / 4.4);
    const panX = o.panX == null ? this.pan : o.panX;
    const eyeY = o.eyeY == null ? this.eyeY : o.eyeY;
    const lookY = o.lookY == null ? this.lookY : o.lookY;
    const off = this.camYOff || 0;
    const px = panX + (this.pointer.x - 0.5) * 0.09 * near;
    const py = eyeY + off + (0.5 - this.pointer.y) * 0.045 * near;
    const cam = this._probeCam || (this._probeCam = this.camera.clone());
    cam.fov = this.camera.fov;
    cam.aspect = this.camera.aspect;
    cam.near = this.camera.near;
    cam.far = this.camera.far;
    cam.position.set(px, py, z);
    cam.lookAt(px + (this.pointer.x - 0.5) * 0.06 * near, lookY + off, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.raycaster.setFromCamera(ndc, cam);
    // 锚在书的前脸而不是墙面上：书比墙面凸出十几厘米，投影到 z=0 会留十几像素漂移
    const zPlane = o.planeZ == null ? this._anchorZ() : o.planeZ;
    const plane = this._wallPlane || (this._wallPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
    plane.constant = -zPlane;
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, p) ? p : null;
  }

  // 手指下面是哪本书就拿那本书的深度当锚平面；没悬停在书上就用柜子的前脸
  _anchorZ() {
    const i = this.hovered >= 0 ? this.hovered : this.lastHover;
    const s = i != null && i >= 0 ? this.slots?.[i] : null;
    return s ? s.z : (this.caseFrontZ || 0.12);
  }

  zoomAt(cx, cy, z) {
    const now = performance.now();
    // 一次手势（连续滚轮/连续捏合）只认第一次落点：相机还在缓动的时候，
    // 每帧现算锚点会把中间态当成起点，松手时那本书已经漂出几十像素
    const fresh = !this._anchor || now - this._anchor.t > 420;
    if (fresh) {
      const zp = this._anchorZ();
      const p = this._wallPoint(cx, cy, { planeZ: zp });
      if (p) this._anchor = { x: p.x, y: p.y, z: zp, t: now };
    }
    const A = this._anchor;
    if (!A) return;
    A.t = now;

    this.setZoom(z);
    // 眼随视点动、镜头还有俯仰，一次修正会有几像素残差 —— 迭代到看不见为止
    for (let k = 0; k < 6; k++) {
      const lookY = this._clampLook(this.lookBase + this.panYTarget);
      const after = this._wallPoint(cx, cy, {
        camZ: this.camZTarget,
        lookY,
        eyeY: this.eyeBase + this.panYTarget * 0.6,
        panX: this.panTarget,
        planeZ: A.z,
      });
      if (!after) break;
      const dx = A.x - after.x;
      const dy = A.y - after.y;
      if (Math.abs(dx) < 0.0004 && Math.abs(dy) < 0.0004) break;
      this.panTarget = this._clampPan(this.panTarget + dx);
      this.panYTarget += dy;
      this._syncVertical();
    }
    this.invalidate();
  }

  focusShelf(shelf) {
    this.panTo(shelf.col * (this.geo.compW + this.geo.panel) + this.geo.compW / 2);
  }

  focusBook(book) {
    const i = this.books.findIndex((b) => b.id === book.id);
    const slot = this.slots?.[i];
    if (!slot) return;
    if (slot.table) this.focusSpot(slot.table);
    else if (this.spot !== 'home') this.focusSpot('home');
    this.panTo(slot.x);
  }

  _bindInput() {
    const el = this.renderer.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    // 多点触控：两指捏合 = 缩放；捏合时不让画布跟着平移
    const pts = new Map();
    let pinch = null;

    const pinchInfo = () => {
      const [a, b] = [...pts.values()];
      return {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    };

    el.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const p = pinchInfo();
        pinch = { d0: p.d, z0: this.zoom || 1 };
        dragging = false;
        return;
      }
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      // 按在摆件上：这一下拖的是它，不是镜头
      this._pick(e.clientX, e.clientY);
      if (this.hoverDecor) {
        const a = this._decorPlaneAt(e.clientX, e.clientY);
        this._decorDrag = { d: this.hoverDecor, lx: e.clientX, ly: e.clientY, moved: 0, ax: a ? a.x : null, ay: a ? a.y : null };
        dragging = false;
        el.setPointerCapture(e.pointerId);
        return;
      }
      dragging = true;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pointer.tx = e.clientX / innerWidth;
      this.pointer.ty = e.clientY / innerHeight;

      // 两指：比例缩放，锚在两指中点
      if (pinch && pts.size >= 2) {
        const p = pinchInfo();
        const z = Math.max(0.34, Math.min(1, (pinch.z0 * pinch.d0) / p.d));
        this.zoomAt(p.cx, p.cy, z);
        moved = 99;
        return;
      }

      // 拖着摆件走
      const dd = this._decorDrag;
      if (dd) {
        dd.moved += Math.abs(e.clientX - dd.lx) + Math.abs(e.clientY - dd.ly);
        dd.lx = e.clientX;
        dd.ly = e.clientY;
        if (dd.moved > 5) {
          el.style.cursor = 'grabbing';
          this.hoverDecor = null;
          this._dragDecorTo(e.clientX, e.clientY);
        }
        return;
      }

      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX;
        lastY = e.clientY;
        this.panTarget = this._clampPan(this.panTarget - dx * this._panRate());
        this.pan = this.panTarget;
        if (this._zoomedIn()) {
          // 凑近了：上下拖就是蹲下、踮脚
          this.panYBy(dy * 0.0026);
        } else {
          this.camYOff = Math.max(-0.1, Math.min(0.1, (this.camYOff || 0) - dy * 0.0014));
        }
        if (moved > 8) this._setHover(-1);
        return;
      }
      this._pick(e.clientX, e.clientY);
    });

    const stop = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    };

    el.addEventListener('pointerup', (e) => {
      const dd = this._decorDrag;
      if (dd) {
        this._decorDrag = null;
        stop(e);
        el.style.cursor = '';
        if (dd.moved > 5) {
          // 挪好了：落地、存档、顺手选上它
          this._saveDecors();
          this.selectDecor(dd.d);
          return;
        }
      }
      const wasDrag = moved > 8;
      stop(e);
      if (wasDrag) return;
      // 墙上的开关优先：点一下开灯/关灯
      if (this.hoverSwitch) {
        this.hoverSwitch = false;
        el.style.cursor = '';
        this.onSwitch?.();
        return;
      }
      // 桌上的纸、钢笔
      if (this.hoverPaper) {
        this.hoverPaper = false;
        this.onPaper?.();
        return;
      }
      if (this.hoverPen) {
        this.hoverPen = false;
        this.onPen?.();
        return;
      }
      if (this.hovered >= 0) {
        this.selectDecor(null);
        this.select(this.books[this.hovered], { x: e.clientX, y: e.clientY });
      } else if (this.hoverDecor) {
        // 点摆件是「选中」，删除走底部那条编辑栏
        const d = this.hoverDecor;
        this.hoverDecor = null;
        this.selectDecor(d);
      } else {
        this.selectDecor(null);
        this.select(null);
      }
    });
    el.addEventListener('pointercancel', (e) => {
      this._decorDrag = null;
      stop(e);
    });
    el.addEventListener('pointerleave', () => {
      this.hoverDecor = null;
      this.hoverSwitch = false;
      this.hoverPaper = false;
      this.hoverPen = false;
      el.style.cursor = '';
      this._setHover(-1);
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // ⌘/Ctrl + 滚轮（触控板双指捏合）= 推近拉远，锚在指针底下
        if (e.ctrlKey || e.metaKey) {
          this.zoomAt(e.clientX, e.clientY, (this.zoom || 1) * (1 + e.deltaY * 0.0022));
          return;
        }
        const unit = e.deltaMode === 1 ? 40 : 1;
        const dx = (e.shiftKey ? e.deltaY : e.deltaX) * unit;
        const dy = e.shiftKey ? 0 : e.deltaY * unit;
        if (this._zoomedIn()) {
          // 近看时：横向滚轮还是沿墙走，竖向滚轮上下搓书架
          if (dx) this.panTo(this.panTarget + dx * this._panRate() * 0.7);
          if (dy) this.panYBy(-dy * 0.0017);
        } else {
          const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
          this.panTo(this.panTarget + d * this._panRate() * 0.38);
        }
      },
      { passive: false }
    );

    // 双击：就地推近；已经放大了就退回整面
    el.addEventListener('dblclick', (e) => {
      if ((this.zoom || 1) > 0.9) this.zoomAt(e.clientX, e.clientY, 0.5);
      else this.resetView();
    });
  }

  // 回到整面柜子：位置、缩放、视点一起归位
  resetView(spot = this.spot || 'home') {
    this.zoom = 1;
    this.focusSpot(spot);
    if (spot === 'home') {
      this.pan = this.panTarget;
      this.camZ = this.camZTarget;
      this.lookY = this.lookYTarget;
      this.eyeY = this.eyeYTarget;
    }
    this.panY = 0;
    this.panYTarget = 0;
    this.camYOff = 0;
    this._syncVertical();
    this.onZoom?.(1);
    this.invalidate();
  }

  setZoom(z) {
    if (!Number.isFinite(z)) return;
    // 0.34 ≈ 推到离书脊一米出头，够看清字；1 = 整面柜子
    this.zoom = Math.max(0.34, Math.min(1, z));
    // 不管站在哪个落脚点，都按那一点的原距离等比推近
    if (!this.spotDist) this.spotDist = this.spot === 'home' || !this.spot ? this._fitDist() : this.camZTarget;
    this.camZTarget = this.spotDist * this.zoom;
    // 退回整面时视点归位
    if (this.zoom > 0.94) {
      this.panYTarget = 0;
      this._syncVertical();
    }
    this.onZoom?.(this.zoom);
    this.invalidate();
  }

  // 场景是「按需渲染」的：任何不经过动画的状态变化都要喊一声
  invalidate() {
    this._dirty = true;
    this._warm = 3;
  }

  _pick(cx, cy) {
    if (!this.bookMesh) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);

    // 把能点的东西都投一遍，谁在前面算谁的 —— 这样摆件站在书前面也点得到
    const hits = [];
    const add = (kind, list, pick) => {
      if (!list || !list.length) return;
      const h = this.raycaster.intersectObjects(list, false)[0];
      if (h) hits.push({ kind, d: h.distance, data: pick ? pick(h) : undefined });
    };
    if (this.bookMesh) {
      const h = this.raycaster.intersectObject(this.bookMesh, false)[0];
      if (h) hits.push({ kind: 'book', d: h.distance, i: h.instanceId != null ? h.instanceId : -1 });
    }
    add('decor', this.decorMeshes, (h) => h.object.userData.decor || null);
    add('paper', this.paperMesh ? [this.paperMesh] : null);
    add('pen', this.penMeshes);
    add('switch', this.switchParts);
    hits.sort((a, b) => a.d - b.d);
    const top = hits[0];

    const kind = top ? top.kind : '';
    const i = kind === 'book' ? top.i : -1;
    this.hoverDecor = kind === 'decor' ? top.data : null;
    this.hoverPaper = kind === 'paper';
    this.hoverPen = kind === 'pen';
    this.hoverSwitch = kind === 'switch';
    this.renderer.domElement.style.cursor = kind ? 'pointer' : '';
    this._setHover(i);
  }

  _setHover(i) {
    if (i === this.hovered) return;
    const prev = this.hovered;
    this.hovered = i;
    if (i >= 0) this.lastHover = i;
    const lifted = this.liftState ? this.liftState.i : -1;
    if (prev >= 0 && prev !== lifted) this._setInstance(prev, 1, 0);
    if (i >= 0 && i !== lifted) this._setInstance(i, 1.03, 0.026);
    if (i >= 0) this.onHover?.(this.books[i]);
    else this.onHover?.(null);
    this.invalidate();
  }

  select(book, at = null) {
    this.selected = book || null;
    if (book) this.selectDecor(null);
    clearTimeout(this._selTimer);
    if (!book) {
      this.releasePick();
      this.onSelect?.(null, null);
      return;
    }
    const i = this.books.findIndex((b) => b.id === book.id);
    const slot = this.slots?.[i];
    if (i < 0 || !slot || slot.table) {
      this.releasePick();
      this.onSelect?.(book, at);
      return;
    }
    // 先从架子上抽出来、抬一下，等书真的离架了再交给 HTML 翻页
    if (this.liftState && this.liftState.i !== i) this._lift(this.liftState.i, 0, 220);
    this._lift(i, 1, 330);
    this._selTimer = setTimeout(() => {
      const p = this._projectSlot(i);
      this.onSelect?.(book, p || at);
    }, 330);
  }

  setQuery(q) {
    this.query = (q || '').trim().toLowerCase();
    this.applyFilter();
  }

  setCat(cat) {
    this.catFilter = cat || null;
    this.applyFilter();
  }

  applyFilter() {
    if (!this.bookMesh) return;
    const q = this.query;
    const cat = this.catFilter;
    this.hits.clear();
    const white = new THREE.Color(1, 1, 1);
    const dim = new THREE.Color(0.42, 0.4, 0.37);
    const hi = new THREE.Color(1.12, 1.08, 1.02);
    const active = !!q || !!cat;
    for (let i = 0; i < this.books.length; i++) {
      const b = this.books[i];
      let ok = true;
      if (q) ok = (b.title + ' ' + b.author + ' ' + b.cat).toLowerCase().includes(q);
      if (ok && cat) {
        if (cat === 'reading') ok = b.status === 'reading';
        else if (cat === 'to-read') ok = b.status === 'to-read';
        else ok = b.cat === cat;
      }
      if (ok) this.hits.add(i);
      this.bookMesh.setColorAt(i, !active || ok ? (q && ok ? hi : white) : dim);
    }
    if (this.bookMesh.instanceColor) this.bookMesh.instanceColor.needsUpdate = true;
    this.invalidate();
  }

  firstHit() {
    if (!this.query) return null;
    for (const i of this.hits) {
      if (this.slots?.[i]) return this.books[i];
    }
    return null;
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this._last || now)) / 1000) || 1 / 60;
    this._last = now;
    const still = this._reduced ? 0 : 1;

    let moved = false;
    const ease = (key, target, rate) => {
      const cur = this[key];
      const next = cur + (target - cur) * rate;
      if (Math.abs(target - next) < 1e-4) {
        this[key] = target;
        return;
      }
      this[key] = next;
      moved = true;
    };

    // 帧率无关的缓动：120Hz 屏和 30fps 的手感一致
    ease('pan', this.panTarget, 1 - Math.exp(-dt * 8));
    ease('camZ', this.camZTarget, 1 - Math.exp(-dt * 5.4));
    ease('eyeY', this.eyeYTarget, 1 - Math.exp(-dt * 5.4));
    ease('lookY', this.lookYTarget, 1 - Math.exp(-dt * 5.4));

    // 指针视差：鼠标往右，视线跟着偏一点点（关掉动效时不晃）
    const pk = 1 - Math.exp(-dt * 3.2);
    const pnx = this.pointer.x + (this.pointer.tx - this.pointer.x) * pk;
    const pny = this.pointer.y + (this.pointer.ty - this.pointer.y) * pk;
    // 阈值别给太小：0.09 的视差幅度下，3e-4 已经看不出来，
    // 留 1e-5 会让它多缓动一秒多，白白多画几十帧
    if (Math.abs(pnx - this.pointer.x) > 3e-4 || Math.abs(pny - this.pointer.y) > 3e-4) moved = true;
    this.pointer.x = pnx;
    this.pointer.y = pny;
    if (this.camYOff) {
      this.camYOff *= 1 - Math.exp(-dt * 6);
      if (Math.abs(this.camYOff) < 1e-4) this.camYOff = 0;
      else moved = true;
    }

    // 推近之后镜头别跟着鼠标乱晃，幅度按距离收一收
    const near = Math.min(1, this.camZ / 4.4);
    const px = this.pan + (this.pointer.x - 0.5) * 0.09 * near * still;
    const py = this.eyeY + (this.camYOff || 0) + (0.5 - this.pointer.y) * 0.045 * near * still;
    this.camera.position.set(px, py, this.camZ);
    this.camera.lookAt(px + (this.pointer.x - 0.5) * 0.06 * near * still, this.lookY + (this.camYOff || 0), 0);

    if (this.key) {
      this.key.position.x = px - 2.8;
      this.key.target.position.x = px;
      this.key.target.updateMatrixWorld();
    }

    // 关灯时，柜子里的几盏暖光跟着镜头走
    if (this.night && this.caseLights) {
      this.caseLights.forEach((pl, i) => {
        pl.position.set(px + (i - 1) * 1.15, 0.5 + i * 0.6, 0.45);
      });
    }

    // 抽书：先往外拔一截，再抬起来
    const L = this.liftState;
    if (L) {
      const k = Math.min(1, (now - L.t0) / L.dur);
      const e = 1 - Math.pow(1 - k, 3);
      L.f = L.from + (L.target - L.from) * e;
      const f = L.f;
      const out = Math.min(1, f / 0.4);
      const up = Math.max(0, (f - 0.4) / 0.6);
      const easeUp = up * up * (3 - 2 * up);
      this._pose(L.i, {
        dz: 0.14 * out,
        dy: 0.02 * out + 0.2 * easeUp,
        roll: -0.07 * easeUp,
        scale: 1 + 0.02 * f,
      });
      if (k >= 1 && L.target === 0) this.liftState = null;
      moved = true;
    }

    // 新摆的摆件轻轻落下
    if (this._drops && this._drops.length) {
      for (let i = this._drops.length - 1; i >= 0; i--) {
        const o = this._drops[i];
        const k = Math.min(1, (now - o.userData.drop) / 460);
        const e = 1 - Math.pow(1 - k, 3);
        if (o.userData.baseY == null) o.userData.baseY = o.position.y;
        o.scale.setScalar(0.84 + 0.16 * e);
        o.position.y = o.userData.baseY + (1 - e) * 0.07;
        if (k >= 1) {
          o.scale.setScalar(1);
          o.position.y = o.userData.baseY;
          this._drops.splice(i, 1);
        }
      }
      moved = true;
    }

    // 钢笔在纸上写字：一个字一个字地落，笔尖跟着走
    const P = this._penAnim;
    if (P) {
      const n = Math.max(0, Math.floor((now - P.t0) / P.step));
      if (n > P.i) {
        const ctx = this.paperCtx;
        while (P.i < n && P.i < P.items.length) {
          handDraw(ctx, P.items[P.i], P.i, P.opt);
          P.i++;
        }
        if (this.paperTex) this.paperTex.needsUpdate = true;
        this.invalidate();
      }
      const at = P.items[Math.min(P.i, P.items.length - 1)];
      if (at) {
        const x = (at.x / PAPER_W - 0.5) * PAPER_M.w;
        const z = (at.y / PAPER_H - 0.5) * PAPER_M.h;
        this._penTargetPos = this._penTargetPos || new THREE.Vector3();
        this._penTargetPos.set(x, 0.0024, z);
      }
      if (P.items.length && P.i >= P.items.length) {
        if (!P.doneAt) {
          P.doneAt = now + 560;
        } else if (now > P.doneAt) {
          this._penAnim = null;
          // 收笔：落款
          const ctx = this.paperCtx;
          if (ctx) {
            ctx.save();
            ctx.textAlign = 'right';
            ctx.globalAlpha = 0.72;
            ctx.fillStyle = HAND.color;
            ctx.font = `42px ${HAND_FONT}`;
            ctx.fillText('— 见室小册', PAPER_W - 108, PAPER_H - 76);
            ctx.restore();
            this.paperTex.needsUpdate = true;
          }
          this._penPose('rest');
          if (this._penHome) this._penTargetPos = this._penHome.pos.clone();
          P.onDone?.();
        }
      }
      moved = true;
    }

    // 笔的跟随：写字时跟得紧，回位时慢一点
    if (this.penPivot && this._penTargetPos) {
      const k = 1 - Math.exp(-dt * 15);
      this.penPivot.position.lerp(this._penTargetPos, k);
      if (this._penTargetQuat) this.penPivot.quaternion.slerp(this._penTargetQuat, 1 - Math.exp(-dt * 9));
      if (this.penPivot.position.distanceToSquared(this._penTargetPos) > 1e-9) moved = true;
      if (this._penTargetQuat && Math.abs(this.penPivot.quaternion.dot(this._penTargetQuat)) < 0.99998) moved = true;
    }

    // 按需渲染：没人动的时候不画，笔记本风扇和手机电量都省下来。
    // 另外每 4 秒补一帧，兜住字体、贴图这类异步变化。
    const heartbeat = now - (this._painted || 0) > 4000;
    if (moved || this._dirty || this._warm > 0 || heartbeat) {
      if (this._warm > 0) this._warm--;
      this.renderer.render(this.scene, this.camera);
      this._dirty = false;
      this._painted = now;
      if (moved) this._sample(dt);
    }
  }

  /* ───────────── 画质自适应：撑不住就降一档，只降不升，避免来回抖 ───────────── */
  _sample(dt) {
    if (dt <= 0 || dt > 0.25) return;
    this._samples = (this._samples || 0) + 1;
    // 首屏装载贴图、跑入场动画那几秒不算数，否则一进来就被判「跑不动」
    if (this._samples < 90) return;
    (this._times || (this._times = [])).push(dt);
    if (this._times.length < 48) return;
    const avg = this._times.reduce((a, b) => a + b, 0) / this._times.length;
    this._times.length = 0;
    this._slow = avg > 1 / 32 ? (this._slow || 0) + 1 : 0;
    // 连续两个窗口都不足 32fps 才降；只降不升，避免在阈值上来回抖
    if (this._slow >= 2 && (this._qLevel || 0) < 2 && performance.now() - (this._qAt || 0) > 6000) {
      this._qAt = performance.now();
      this._slow = 0;
      this._setQuality((this._qLevel || 0) + 1);
    }
  }

  _setQuality(level) {
    this._qLevel = level;
    const dpr = Math.min(devicePixelRatio || 1, level === 0 ? 2 : level === 1 ? 1.4 : 1);
    this.renderer.setPixelRatio(dpr);
    const w = this.el.clientWidth || innerWidth;
    const h = this.el.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    if (level >= 2) {
      this.renderer.shadowMap.enabled = false;
      if (this.key) this.key.castShadow = false;
    } else if (this.key) {
      this.renderer.shadowMap.enabled = true;
      this.key.castShadow = !this.night;
      const size = level === 0 ? 2048 : 1024;
      if (this.key.shadow.mapSize.x !== size) {
        if (this.key.shadow.map) {
          this.key.shadow.map.dispose();
          this.key.shadow.map = null;
        }
        this.key.shadow.mapSize.set(size, size);
      }
    }
    this.invalidate();
  }

  resize() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.caseH) {
      const d = this._fitDist();
      if (this.spot === 'home') {
        // 转屏 / 改窗口时保留当前推近的程度，别把读者弹回整面
        this.spotDist = d;
        this.camZ = d * (this.zoom || 1);
        this.camZTarget = this.camZ;
      }
    }
    this.panTarget = this._clampPan(this.panTarget);
    this._syncVertical();
    this.invalidate();
  }
}

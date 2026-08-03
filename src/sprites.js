/* 程序化像素精灵:全部代码绘制,加载时离屏预渲染缓存为位图。
 * 美术 pass 2:建筑重新设计剪影——指挥中心(主楼+二层+穹顶+雷达碟+双天线)、
 * 精炼厂(主厂房+双烟囱+料斗+传送管+储料罐);烟囱冒烟/雷达扫描在渲染层动画。 */
(function (RS) {
  'use strict';

  const TW = RS.config.TILE_W, TH = RS.config.TILE_H;

  const P = {
    sand:      ['#b8643c', '#af5f39', '#c06a40', '#b2603a', '#a85a35', '#bd6b42'],
    sandDark:  '#9c4f30', sandLight: '#d4885a', sandSpot: '#8f452a',
    duneDark:  '#a3532f', duneLight: '#cd7a4e',
    oreGround: '#8a4630', oreCrack: '#6f3623',
    oreCore:   '#e6f7ff', oreMid: '#4fc3f7', oreDark: '#2b7fb8', oreLine: '#1a5c86',
    rockTop:   '#9b887e', rockLeft: '#7a6a63', rockRight: '#5d504b', rockHi: '#b5a295',
    hullTop:   '#eef6fb', hullLeft: '#b9cdd9', hullRight: '#8fa9b8',
    hullDark:  '#5b7484', hullLine: '#3d5566',
    accent:    '#2e7fd9', accentDark: '#1d5aa8',
    track:     '#33383d', trackLight: '#5c646d',
    glass:     '#9fd8ef', glassHi: '#e6f7ff',
    shadow:    'rgba(20,8,4,0.35)',
    chimney:   '#6d7b85', warn: '#f5a623',
    skin:      '#e8c39a', cloth: '#2e7fd9', clothDark: '#1d5aa8', gunmetal: '#3a3f45',
    line:      'rgba(28,14,9,0.6)',
    conc:      '#7a6f66', concSide: '#5f564f', concSeam: '#6b6059',
    shrub:     '#6b6b3a', pebble:   '#7c5a48',
  };

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { c, x: c.getContext('2d') };
  }

  function poly(x, pts, color) {
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]);
    x.closePath();
    x.fill();
  }
  function strokePoly(x, pts, color, w) {
    x.strokeStyle = color; x.lineWidth = w || 1;
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]);
    x.closePath();
    x.stroke();
  }
  function rect(x, px, py, w, h, color, outline) {
    x.fillStyle = color; x.fillRect(px, py, w, h);
    if (outline) { x.strokeStyle = outline; x.lineWidth = 1; x.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1); }
  }

  // 等距方盒:地面中心 (cx,cy),占地 n×m 格,高 h;三面三色 + 描边
  function isoBox(x, cx, cy, n, m, h, top, left, right, outline) {
    const R = [(n + m) * TW / 4, (n - m) * TH / 4];
    const B = [(n - m) * TW / 4, (n + m) * TH / 4];
    const L = [-(n + m) * TW / 4, (m - n) * TH / 4];
    const T = [(m - n) * TW / 4, -(n + m) * TH / 4];
    const up = p => [cx + p[0], cy + p[1] - h];
    const dn = p => [cx + p[0], cy + p[1]];
    poly(x, [up(T), up(R), up(B), up(L)], top);
    poly(x, [dn(L), dn(B), up(B), up(L)], left);
    poly(x, [dn(B), dn(R), up(R), up(B)], right);
    const o = outline || P.line;
    strokePoly(x, [up(T), up(R), up(B), up(L)], o, 1);
    strokePoly(x, [dn(L), dn(B), up(B)], o, 1);
    strokePoly(x, [dn(B), dn(R), up(R)], o, 1);
  }

  function hash(a, b) { let h = (a * 374761393 + b * 668265263) ^ 0x5bf03635; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

  const S = RS.sprites = { init, tiles: null, decor: null, rock: null, cc: null, refinery: null, units: null, shadow: null };

  // ---------- 地形 ----------
  function sandTile(v) {
    const { c, x } = mk(TW, TH);
    const dia = [[TW / 2, 0], [TW, TH / 2], [TW / 2, TH], [0, TH / 2]];
    poly(x, dia, P.sand[v]);
    x.save(); x.beginPath(); x.moveTo(TW / 2, 0); x.lineTo(TW, TH / 2); x.lineTo(TW / 2, TH); x.lineTo(0, TH / 2); x.closePath(); x.clip();
    x.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const rx = hash(v * 31 + k, 7), ry = hash(v * 17 + k, 13);
      x.strokeStyle = k % 2 ? P.duneDark : P.duneLight;
      x.beginPath();
      x.ellipse(10 + rx * 44, 6 + ry * 20, 14 + rx * 10, 5 + ry * 3, 0.2, 0.3, Math.PI * 0.9);
      x.stroke();
    }
    for (let k = 0; k < 12; k++) {
      const rx = hash(v * 97 + k, 3), ry = hash(v * 57 + k, 11);
      x.fillStyle = k % 3 === 0 ? P.sandSpot : (k % 3 === 1 ? P.sandDark : P.sandLight);
      x.fillRect(Math.round(6 + rx * (TW - 12)), Math.round(4 + ry * (TH - 8)), 2, 2);
    }
    x.restore();
    return { canvas: c, ax: TW / 2, ay: TH / 2 };
  }

  function crystal(x, px, py, s, outline) {
    const body = [[px, py - 6 * s], [px + 4 * s, py - 2 * s], [px + 3 * s, py + 3 * s], [px - 3 * s, py + 3 * s], [px - 4 * s, py - 2 * s]];
    poly(x, body, P.oreMid);
    poly(x, [[px, py - 6 * s], [px + 4 * s, py - 2 * s], [px, py]], P.oreCore);
    poly(x, [[px - 3 * s, py + 3 * s], [px + 3 * s, py + 3 * s], [px, py + 5 * s]], P.oreDark);
    if (outline) strokePoly(x, body, P.oreLine, 1);
  }

  function oreTile(level) { // 2 富矿 / 1 半采 / 0 稀疏
    const { c, x } = mk(TW, TH);
    poly(x, [[TW / 2, 0], [TW, TH / 2], [TW / 2, TH], [0, TH / 2]], P.oreGround);
    x.save(); x.beginPath(); x.moveTo(TW / 2, 0); x.lineTo(TW, TH / 2); x.lineTo(TW / 2, TH); x.lineTo(0, TH / 2); x.closePath(); x.clip();
    x.strokeStyle = P.oreCrack; x.lineWidth = 1;
    x.beginPath(); x.moveTo(14, 10); x.lineTo(26, 15); x.lineTo(30, 22); x.stroke();
    x.beginPath(); x.moveTo(48, 9); x.lineTo(40, 16); x.lineTo(44, 23); x.stroke();
    const spots = [[32, 16], [22, 12], [42, 12], [27, 21], [38, 20], [16, 17], [48, 17]];
    const n = level === 2 ? 7 : level === 1 ? 4 : 2;
    for (let k = 0; k < n; k++) crystal(x, spots[k][0], spots[k][1], 1, true);
    x.restore();
    return { canvas: c, ax: TW / 2, ay: TH / 2 };
  }

  function decorSprite(kind) {
    const { c, x } = mk(TW, TH);
    if (kind === 1) {
      for (let k = 0; k < 4; k++) {
        const rx = hash(kind * 11 + k, 5), ry = hash(kind * 23 + k, 9);
        x.fillStyle = P.pebble;
        x.fillRect(Math.round(14 + rx * 36), Math.round(8 + ry * 16), 3, 2);
        x.fillStyle = P.rockHi;
        x.fillRect(Math.round(14 + rx * 36), Math.round(8 + ry * 16), 1, 1);
      }
    } else if (kind === 2) {
      x.strokeStyle = P.shrub; x.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const rx = hash(kind * 7 + k, 3);
        x.beginPath();
        x.moveTo(28 + k * 2, 18);
        x.lineTo(26 + k * 2 + rx * 6, 10 + rx * 4);
        x.stroke();
      }
    } else {
      x.fillStyle = P.sandSpot;
      x.beginPath(); x.ellipse(32, 16, 14, 6, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = P.sandLight; x.lineWidth = 1;
      x.beginPath(); x.ellipse(32, 15, 14, 6, 0, Math.PI * 1.05, Math.PI * 1.85); x.stroke();
    }
    return { canvas: c, ax: TW / 2, ay: TH / 2 };
  }

  // 沉积红岩:层叠板岩 + 层理横纹 + 顶部高光,与沙漠同色系,一眼是石头
  function rockSprite(variant) {
    const { c, x } = mk(TW, TH + 30);
    const cy = TH / 2 + 15;
    const top = '#c08256', left = '#a96843', right = '#8a4f33', line = 'rgba(60,26,14,0.6)';
    const strata = '#78402a', hi = '#dba06e';
    const h1 = 9 + variant * 3, h2 = 7 + variant * 2, h3 = 6 + variant;
    isoBox(x, TW / 2, cy, 1, 1, h1, top, left, right, line);
    isoBox(x, TW / 2 - 3, cy - 3, 0.75, 0.75, h1 + h2, top, left, right, line);
    isoBox(x, TW / 2 + 5, cy + 2, 0.45, 0.45, h1 + h2 + h3, top, left, right, line);
    x.strokeStyle = strata; x.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      const yy = cy - k * 4;
      x.beginPath(); x.moveTo(TW / 2 - 26, yy + 6); x.lineTo(TW / 2, yy + 19); x.stroke();
      x.beginPath(); x.moveTo(TW / 2 + 26, yy + 6); x.lineTo(TW / 2, yy + 19); x.stroke();
    }
    x.fillStyle = hi;
    x.fillRect(TW / 2 - 8, cy - h1 - h2 - h3 + 4, 5, 2);
    x.fillRect(TW / 2 + 3, cy - h1 - h2 - h3 + 7, 4, 2);
    return { canvas: c, ax: TW / 2, ay: cy };
  }

  // ---------- 建筑 ----------
  function apron(x, cx, cy, n, m) {
    isoBox(x, cx, cy, n + 0.4, m + 0.4, 3, P.conc, P.concSide, P.concSide, 'rgba(0,0,0,0.35)');
    x.strokeStyle = P.concSeam; x.lineWidth = 1;
    x.beginPath(); x.moveTo(cx - n * TW / 4, cy - m * TH / 4); x.lineTo(cx + m * TW / 4, cy + n * TH / 4); x.stroke();
    x.beginPath(); x.moveTo(cx + n * TW / 4, cy - m * TH / 4); x.lineTo(cx - m * TW / 4, cy + n * TH / 4); x.stroke();
  }

  function panelSeams(x, cx, cy, wpx, hTop, hBot, color) {
    x.strokeStyle = color; x.lineWidth = 1;
    for (let dx = -wpx; dx <= wpx; dx += 11) {
      x.beginPath();
      x.moveTo(cx + dx, cy + hTop + Math.abs(dx) * 0.24);
      x.lineTo(cx + dx, cy + hBot - Math.abs(dx) * 0.24);
      x.stroke();
    }
  }

  // 指挥中心:主楼 + 二层 + 蓝穹顶 + 雷达碟 + 双天线——"一眼是老大"
  function commandCenter() {
    const W = 3 * TW, H = 3 * TH + 56;
    const { c, x } = mk(W, H);
    const cx = W / 2, cy = H - 3 * TH / 2 - 6;
    apron(x, cx, cy, 3, 3);
    // 主楼
    isoBox(x, cx, cy, 3, 3, 26, P.hullTop, P.hullLeft, P.hullRight);
    panelSeams(x, cx, cy, 40, -22, -4, P.hullLine);
    // 窗带(正面两层)
    for (let wx = -24; wx <= 12; wx += 8) rect(x, cx + wx, cy - 18, 5, 4, P.glass, P.hullLine);
    // 蓝色腰线
    x.fillStyle = P.accent;
    x.fillRect(cx - 46, cy - 9, 92, 3);
    // 二层(退台,视觉重心)
    isoBox(x, cx, cy - 28, 2, 2, 16, P.hullTop, P.hullLeft, P.hullRight);
    for (let wx = -14; wx <= 6; wx += 7) rect(x, cx + wx, cy - 40, 4, 4, P.glass, P.hullLine);
    // 蓝色穹顶 + 高光
    x.fillStyle = P.accent;
    x.beginPath(); x.ellipse(cx, cy - 52, 16, 9, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = P.accentDark; x.lineWidth = 1;
    x.beginPath(); x.ellipse(cx, cy - 52, 16, 9, 0, 0, Math.PI * 2); x.stroke();
    x.fillStyle = P.glass;
    x.beginPath(); x.ellipse(cx, cy - 54, 9, 5, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = P.glassHi; x.fillRect(cx - 4, cy - 58, 4, 2);
    // 雷达:立杆 + 碟面(扫描线在渲染层旋转)
    x.strokeStyle = P.hullDark; x.lineWidth = 3;
    x.beginPath(); x.moveTo(cx - 24, cy - 46); x.lineTo(cx - 24, cy - 66); x.stroke();
    x.fillStyle = P.hullLeft;
    x.beginPath(); x.ellipse(cx - 24, cy - 68, 8, 4, -0.5, 0, Math.PI * 2); x.fill();
    x.strokeStyle = P.hullLine; x.lineWidth = 1;
    x.beginPath(); x.ellipse(cx - 24, cy - 68, 8, 4, -0.5, 0, Math.PI * 2); x.stroke();
    // 双天线(右高左矮,顶端警示灯在高天线)
    x.strokeStyle = P.hullDark; x.lineWidth = 3;
    x.beginPath(); x.moveTo(cx + 18, cy - 44); x.lineTo(cx + 18, cy - 76); x.stroke();
    x.lineWidth = 2;
    x.beginPath(); x.moveTo(cx + 27, cy - 42); x.lineTo(cx + 27, cy - 62); x.stroke();
    x.fillStyle = P.hullDark; x.fillRect(cx + 14, cy - 50, 9, 4);
    // 大门 + 台阶
    rect(x, cx - 13, cy - 14, 26, 12, P.accent, P.accentDark);
    x.fillStyle = P.accentDark; x.fillRect(cx - 13, cy - 6, 26, 4);
    x.fillStyle = P.conc; x.fillRect(cx - 16, cy - 2, 32, 3);
    const spr = { canvas: c, ax: cx, ay: cy };
    spr.beacon = { dx: 18, dy: -78 };   // 警示灯(渲染层闪烁)
    spr.radar = { dx: -24, dy: -68 };   // 雷达碟中心(渲染层扫描线)
    return spr;
  }

  // 精炼厂:主厂房 + 双烟囱 + 矿石料斗 + 传送管 + 储料罐——"一眼是炼矿的"
  function refinery() {
    const W = (3 + 2) * TW / 2, H = (3 + 2) * TH / 2 + 62;
    const { c, x } = mk(W, H);
    const cx = W / 2, cy = H - (3 + 2) * TH / 4 - 6;
    apron(x, cx, cy, 3, 2);
    // 主厂房
    isoBox(x, cx, cy, 3, 2, 22, P.hullTop, P.hullLeft, P.hullRight);
    panelSeams(x, cx, cy, 32, -18, -4, P.hullLine);
    // 双烟囱(左高右矮,深色帽 + 红点)
    rect(x, cx - 48, cy - 64, 12, 46, P.chimney, P.hullDark);
    rect(x, cx - 34, cy - 54, 12, 36, P.chimney, P.hullDark);
    x.fillStyle = P.hullDark;
    x.fillRect(cx - 48, cy - 64, 12, 5); x.fillRect(cx - 34, cy - 54, 12, 5);
    x.fillStyle = '#e04c3a';
    x.fillRect(cx - 44, cy - 70, 4, 4); x.fillRect(cx - 30, cy - 60, 4, 4);
    // 连接管道(烟囱 → 厂房)
    x.strokeStyle = P.hullDark; x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx - 28, cy - 38); x.lineTo(cx - 10, cy - 28); x.stroke();
    // 储料罐(右侧圆顶罐)
    isoBox(x, cx + 46, cy + 2, 0.9, 0.9, 14, P.hullLeft, P.hullLeft, P.hullRight);
    x.fillStyle = P.accent;
    x.beginPath(); x.ellipse(cx + 46, cy - 14, 13, 7, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = P.accentDark; x.lineWidth = 1;
    x.beginPath(); x.ellipse(cx + 46, cy - 14, 13, 7, 0, 0, Math.PI * 2); x.stroke();
    // 矿石料斗(正面,警示条纹框 + 晶矿)
    rect(x, cx - 6, cy - 20, 40, 18, '#43302a', P.hullDark);
    for (let sx = 0; sx < 40; sx += 8) {
      x.fillStyle = (sx / 8) % 2 ? P.warn : '#2b2b2b';
      x.fillRect(cx - 6 + sx, cy - 22, 8, 3);
    }
    crystal(x, cx + 4, cy - 9, 0.9, false); crystal(x, cx + 16, cy - 8, 0.9, false);
    // 传送管(料斗 → 厂房顶部)
    x.strokeStyle = P.gunmetal; x.lineWidth = 6;
    x.beginPath(); x.moveTo(cx + 18, cy - 24); x.lineTo(cx + 4, cy - 38); x.stroke();
    x.strokeStyle = P.warn; x.lineWidth = 2;
    x.beginPath(); x.moveTo(cx + 18, cy - 24); x.lineTo(cx + 4, cy - 38); x.stroke();
    const spr = { canvas: c, ax: cx, ay: cy };
    spr.smoke = [{ dx: -42, dy: -68 }, { dx: -28, dy: -58 }]; // 烟囱口(渲染层冒烟)
    return spr;
  }

  // 深层开采站：低矮动力底座 + 中央钻塔 + 发光矿芯，保持 45° 等距剪影。
  function deepMine() {
    const { c, x } = mk(144, 118);
    const cx = 72, cy = 92;
    apron(x, cx, cy, 2, 2);
    // 2×2 逻辑占地不变，但顶面用深色机械甲板打散大块白色，避免像一整块空平台。
    isoBox(x, cx, cy, 2, 2, 15, '#9fb4c1', '#6f8796', '#526f80');
    const deck = [[cx, cy - 43], [cx + 46, cy - 20], [cx, cy + 3], [cx - 46, cy - 20]];
    poly(x, deck, '#29475a');
    strokePoly(x, deck, P.hullLine, 2);
    x.strokeStyle = P.accent; x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx - 45, cy - 18); x.lineTo(cx, cy + 5); x.lineTo(cx + 45, cy - 18); x.stroke();
    // 右后方动力机柜和甲板检修盖。
    isoBox(x, cx + 30, cy - 16, 0.52, 0.52, 17, P.hullTop, P.hullLeft, P.hullRight);
    rect(x, cx + 24, cy - 35, 12, 5, P.accent, P.accentDark);
    x.fillStyle = '#8096a4';
    x.beginPath(); x.ellipse(cx - 26, cy - 22, 11, 5, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = P.hullLine; x.lineWidth = 2;
    x.beginPath(); x.ellipse(cx - 26, cy - 22, 11, 5, 0, 0, Math.PI * 2); x.stroke();
    // 钻塔三角桁架
    x.strokeStyle = '#38576a'; x.lineWidth = 4;
    x.beginPath();
    x.moveTo(cx - 19, cy - 17); x.lineTo(cx, cy - 76); x.lineTo(cx + 19, cy - 17);
    x.moveTo(cx - 13, cy - 37); x.lineTo(cx + 13, cy - 37);
    x.moveTo(cx - 8, cy - 55); x.lineTo(cx + 8, cy - 55);
    x.stroke();
    x.strokeStyle = '#8da8b7'; x.lineWidth = 2;
    x.beginPath();
    x.moveTo(cx - 16, cy - 25); x.lineTo(cx + 12, cy - 37);
    x.moveTo(cx + 16, cy - 25); x.lineTo(cx - 8, cy - 55);
    x.stroke();
    x.strokeStyle = P.warn; x.lineWidth = 2;
    x.beginPath(); x.moveTo(cx, cy - 70); x.lineTo(cx, cy - 4); x.stroke();
    // 动力轮与地表钻口
    x.fillStyle = P.gunmetal;
    x.beginPath(); x.arc(cx - 26, cy - 22, 9, 0, Math.PI * 2); x.fill();
    x.strokeStyle = P.warn; x.lineWidth = 3;
    x.beginPath(); x.arc(cx - 26, cy - 22, 6, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#152b38';
    x.beginPath(); x.ellipse(cx, cy - 7, 18, 8, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = P.oreMid;
    x.beginPath(); x.ellipse(cx, cy - 9, 9, 4, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = P.oreCore;
    x.fillRect(cx - 3, cy - 12, 6, 3);
    return { canvas: c, ax: cx, ay: cy };
  }

  // ---------- 单位(俯视朝向 +x 绘制,旋转 φ=θ+45° 后压扁) ----------
  function rotSquash(x, k, cx, cy) {
    x.translate(cx, cy);
    x.scale(1, 0.5);
    x.rotate(k * Math.PI / 4 + Math.PI / 4);
  }

  function harvesterDir(k, loaded) {
    const { c, x } = mk(72, 64);
    rotSquash(x, k, 36, 44);
    rect(x, -19, -14, 38, 7, P.track, '#1d2124');
    rect(x, -19, 7, 38, 7, P.track, '#1d2124');
    x.fillStyle = P.trackLight;
    for (let t = -14; t <= 14; t += 7) {
      x.beginPath(); x.arc(t, -10.5, 2.2, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(t, 10.5, 2.2, 0, Math.PI * 2); x.fill();
    }
    rect(x, -16, -9, 30, 9, P.hullTop, P.hullLine);
    rect(x, -16, 0, 30, 9, P.hullLeft, P.hullLine);
    rect(x, -14, -7, 15, 14, P.accent, P.accentDark);
    if (loaded) {
      crystal(x, -10, -1, 0.8, false);
      crystal(x, -5, 1, 0.8, false);
      crystal(x, -8, -4, 0.7, false);
    } else {
      x.fillStyle = P.accentDark;
      for (let s = -12; s <= 0; s += 5) x.fillRect(s, -7, 2, 14);
    }
    rect(x, 4, -8, 10, 16, P.hullTop, P.hullLine);
    rect(x, 9, -5, 5, 10, P.glass, P.hullLine);
    x.fillStyle = P.glassHi; x.fillRect(10, -4, 2, 4);
    rect(x, 14, -8, 8, 4, P.hullDark, '#1d2124');
    rect(x, 14, 4, 8, 4, P.hullDark, '#1d2124');
    x.fillStyle = P.warn; x.fillRect(20, -8, 3, 4); x.fillRect(20, 4, 3, 4);
    return { canvas: c, ax: 36, ay: 44 };
  }

  function drillRigDir(k) {
    const base = harvesterDir(k, false);
    const { c, x } = mk(72, 72);
    x.drawImage(base.canvas, 0, 8);
    x.strokeStyle = P.hullDark; x.lineWidth = 3;
    x.beginPath();
    x.moveTo(27, 45); x.lineTo(36, 15); x.lineTo(45, 45);
    x.moveTo(30, 34); x.lineTo(42, 34);
    x.stroke();
    x.strokeStyle = P.warn; x.lineWidth = 2;
    x.beginPath(); x.moveTo(36, 17); x.lineTo(36, 48); x.stroke();
    x.fillStyle = P.oreMid;
    x.beginPath(); x.arc(36, 17, 3, 0, Math.PI * 2); x.fill();
    return { canvas: c, ax: 36, ay: 52 };
  }

  function soldierDir(k, rocket) {
    const { c, x } = mk(40, 40);
    rotSquash(x, k, 20, 28);
    x.fillStyle = P.clothDark;
    x.fillRect(-6, -4, 4, 3); x.fillRect(-6, 1, 4, 3);
    x.fillStyle = '#152c4a';
    x.beginPath(); x.arc(0, 0, 6, 0, Math.PI * 2); x.fill();
    x.fillStyle = P.cloth;
    x.beginPath(); x.arc(0, 0, 5, 0, Math.PI * 2); x.fill();
    x.fillStyle = P.clothDark;
    x.beginPath(); x.arc(2.5, 0, 3.4, 0, Math.PI * 2); x.fill();
    x.fillStyle = P.glassHi; x.fillRect(1, -2, 2, 1);
    x.fillStyle = P.skin;
    x.beginPath(); x.arc(4.5, 0, 1.8, 0, Math.PI * 2); x.fill();
    if (rocket) {
      rect(x, -7, -2.5, 16, 5, P.gunmetal, '#1d2124');
      x.fillStyle = P.warn; x.fillRect(7, -2.5, 3, 5);
    } else {
      rect(x, 3, -1.2, 8, 2.4, P.gunmetal, '#1d2124');
    }
    return { canvas: c, ax: 20, ay: 28 };
  }

  function shadowSprite() {
    const { c, x } = mk(48, 24);
    x.fillStyle = P.shadow;
    x.beginPath(); x.ellipse(24, 12, 20, 9, 0, 0, Math.PI * 2); x.fill();
    return { canvas: c, ax: 24, ay: 12 };
  }

  // ---------- AI 生图接入(加载失败时保留程序化版本) ----------
  // 建筑特效锚点:相对处理后图像左上角的比例位置
  const ART_BUILDING_FX = {
    cc: { beacon: [0.22, 0.14], radar: [0.13, 0.24] },
    refinery: { smoke: [[0.50, 0.10], [0.64, 0.17]] },
  };
  const ART_UNITS = {
    harvester: 'harvester', infantry: 'infantry', rocket: 'rocket',
    'light-tank': 'lightTank', 'heavy-tank': 'heavyTank', artillery: 'artillery',
    flametank: 'flametank', repair: 'repair', drone: 'drone', mech: 'mech', // mech:沙暴模式遗迹战甲
  };

  function loadImage(uri) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = uri;
    });
  }

  // [过渡方案] 正俯视图 → 8 个朝向(旋转后压扁 0.68,等第三轮等距素材替换)
  function unitDirsFromImage(img) {
    const arr = [];
    for (let k = 0; k < 8; k++) {
      const { c, x } = mk(96, 88);
      x.translate(48, 56);
      x.scale(1, 0.68);
      x.rotate(k * Math.PI / 4 + Math.PI / 4);
      x.imageSmoothingEnabled = true;
      x.drawImage(img, -img.width / 2, -img.height / 2);
      arr.push({ canvas: c, ax: 48, ay: 56 });
    }
    return arr;
  }

  // 矿车满载版:在货斗(图像左后)叠加晶矿
  function loadedComposite(img) {
    const { c, x } = mk(img.width, img.height);
    x.drawImage(img, 0, 0);
    const s = img.width / 60;
    crystal(x, img.width * 0.24, img.height * 0.45, s, false);
    crystal(x, img.width * 0.32, img.height * 0.55, s, false);
    crystal(x, img.width * 0.20, img.height * 0.62, s * 0.8, false);
    return c;
  }

  // 等距双视角素材(fr 斜前方 / br 斜后方)→ 水平镜像出另两侧 → 4 方向;
  // 素材顺序 [FR, BR, FL, BL],世界 8 向按屏幕运动角映射:
  // 0(+x)→FR 1(对角下)→FR 2(+y)→FL 3(对角左)→FL 4(-x)→BL 5(对角上)→BR 6(-y)→BR 7(对角右)→FR
  const DIR8MAP = [0, 0, 2, 2, 3, 1, 1, 0];
  function mirrored(img) {
    const { c, x } = mk(img.width, img.height);
    x.translate(img.width, 0); x.scale(-1, 1);
    x.drawImage(img, 0, 0);
    return c;
  }
  function isoAnchor(img) { return { canvas: img, ax: img.width / 2, ay: img.height - 3 }; }
  function isoBuildingAnchor(img, drop) {
    return { canvas: img, ax: img.width / 2, ay: img.height - drop };
  }
  function isoUnitDirs(fr, br) {
    const dirs = [isoAnchor(fr), isoAnchor(br), isoAnchor(mirrored(fr)), isoAnchor(mirrored(br))];
    return DIR8MAP.map(i => dirs[i]);
  }
  function isoBuildingDirs(fr, br, drop) {
    const dirs = [
      isoBuildingAnchor(fr, drop), isoBuildingAnchor(br, drop),
      isoBuildingAnchor(mirrored(fr), drop), isoBuildingAnchor(mirrored(br), drop),
    ];
    return DIR8MAP.map(i => dirs[i]);
  }

  function integrateArt(name, img) {
    if (ART_UNITS[name]) {
      const kind = ART_UNITS[name];
      // 无人机只有一张 45° 修复态:镜像成两侧视角,避免像俯视素材那样旋转后破坏透视。
      S.units[kind] = kind === 'drone' ? isoUnitDirs(img, img) : unitDirsFromImage(img);
      if (kind === 'harvester')
        for (const spr of unitDirsFromImage(loadedComposite(img))) S.units[kind].push(spr);
      return;
    }
    // 建筑:锚点 = 底边中心上收半个菱形高((n+m)*TH/4)
    const drop = { cc: 48, power: 32, refinery: 40, barracks: 32, factory: 48, turret: 32 }[name] || 32;
    const spr = { canvas: img, ax: img.width / 2, ay: img.height - drop };
    const fx = ART_BUILDING_FX[name];
    if (fx) {
      if (fx.beacon) spr.beacon = { dx: fx.beacon[0] * img.width - spr.ax, dy: fx.beacon[1] * img.height - spr.ay };
      if (fx.radar) spr.radar = { dx: fx.radar[0] * img.width - spr.ax, dy: fx.radar[1] * img.height - spr.ay };
      if (fx.smoke) spr.smoke = fx.smoke.map(p => ({ dx: p[0] * img.width - spr.ax, dy: p[1] * img.height - spr.ay }));
    }
    S.buildings[name] = spr;
  }

  function init() {
    S.tiles = {
      sand: [0, 1, 2, 3, 4, 5].map(sandTile),
      ore: [oreTile(0), oreTile(1), oreTile(2)],
    };
    S.decor = [decorSprite(1), decorSprite(2), decorSprite(3)].map(s => Object.assign(s, { block: false }));
    S.rock = [rockSprite(0), rockSprite(1), rockSprite(2)];
    S.cc = commandCenter();
    S.refinery = refinery();
    S.deepMine = deepMine();
    S.units = { harvester: [], drillRig: [], infantry: [], rocket: [] };
    for (let k = 0; k < 8; k++) {
      S.units.harvester.push(harvesterDir(k, false));
      S.units.drillRig.push(drillRigDir(k));
      S.units.infantry.push(soldierDir(k, false));
      S.units.rocket.push(soldierDir(k, true));
    }
    for (let k = 0; k < 8; k++) S.units.harvester.push(harvesterDir(k, true));
    S.shadow = shadowSprite();
    S.buildings = { cc: S.cc, refinery: S.refinery, deepMine: S.deepMine };

    if (!RS.artData) return Promise.resolve();
    const names = Object.keys(RS.artData);
    return Promise.all(names.map(n => loadImage(RS.artData[n]).then(img => [n, img]).catch(() => null)))
      .then(loaded => {
        const IM = {};
        for (const it of loaded) if (it) IM[it[0]] = it[1];
        const rockArts = [];
        const turretLayers = new Set(['turret-base', 'enemy-turret-base', 'turret-top', 'enemy-turret-top']);
        const guideArts = new Set([
          'field-guide-archive', 'field-guide-factions', 'field-guide-salvage', 'archive-terminal',
        ]);
        for (const name of Object.keys(IM)) {
          if (name.endsWith('-fr') || name.endsWith('-br')) continue; // 等距单位,下面统一处理
          if (name.startsWith('rock-')) { rockArts.push(IM[name]); continue; }
          if (turretLayers.has(name)) continue; // 炮塔分层素材不注册为普通建筑
          if (guideArts.has(name)) continue; // 图鉴插画/终端由下面的彩蛋入口独立注册
          integrateArt(name, IM[name]);
        }
        // 等距双视角单位:fr/br 成对存在才启用(覆盖过渡版)
        for (const file of Object.keys(ART_UNITS)) {
          const fr = IM[file + '-fr'], br = IM[file + '-br'];
          if (fr && br) S.units[ART_UNITS[file]] = isoUnitDirs(fr, br);
        }
        // 士兵跑动帧:w1/w3 缺帧用静态图补位,只有 w2 时构成"静态-跨步-静态"三相位
        S.unitsWalk = {};
        for (const file of ['infantry', 'rocket']) {
          const base = S.units[ART_UNITS[file]];
          const w1f = IM[file + '-fr-w1'], w1b = IM[file + '-br-w1'];
          const w2f = IM[file + '-fr-w2'], w2b = IM[file + '-br-w2'];
          const w3f = IM[file + '-fr-w3'], w3b = IM[file + '-br-w3'];
          const f1 = w1f ? isoUnitDirs(w1f, w1b || w1f) : base;
          const f2 = w2f ? isoUnitDirs(w2f, w2b || w2f) : null;
          const f3 = w3f ? isoUnitDirs(w3f, w3b || w3f) : base;
          if (f2) S.unitsWalk[ART_UNITS[file]] = [f1, f2, f3];
        }
        // 矿车满载造型(可选):存为 8..15 号位,载矿过半时切换
        if (IM['harvester-full-fr'] && IM['harvester-full-br']) {
          const full = isoUnitDirs(IM['harvester-full-fr'], IM['harvester-full-br']);
          S.units.harvester = S.units.harvester.slice(0, 8).concat(full);
        }
        // 炮塔转向素材(第九轮,可选):fr/br 双视角镜像出 8 向,渲染时按瞄准方向选帧
        if (IM['turret-aim-fr']) {
          S.turretAim = S.turretAim || {};
          S.turretAim.player = isoBuildingDirs(
            IM['turret-aim-fr'], IM['turret-aim-br'] || IM['turret-aim-fr'], 32);
        }
        // 炮管组件(第十轮,可选):单张朝 fr 方向的炮管,渲染时自由旋转到任意角度(最顺滑)
        if (IM['turret-top']) {
          S.turretTop = S.turretTop || {};
          S.turretTop.player = IM['turret-top'];
        }
        // 固定底座与旋转炮头分层,避免整塔素材与炮头组件重复叠出“双头”
        if (IM['turret-base']) {
          S.turretBase = S.turretBase || {};
          S.turretBase.player = {
            canvas: IM['turret-base'],
            ax: IM['turret-base'].width / 2,
            ay: IM['turret-base'].height - 32,
          };
        }
        // 战痕焦痕贴图(第十一轮,可选):透明斑块,按透明度贴地
        if (IM['scar-1']) S.scars = [IM['scar-1'], IM['scar-2'] || IM['scar-1']].map(img => ({ canvas: img }));
        // 爆炸序列帧(第十一轮,可选):小爆/大爆各 3 帧
        if (IM['explosion-1']) S.explosion = [IM['explosion-1'], IM['explosion-2'] || IM['explosion-1'], IM['explosion-3'] || IM['explosion-2'] || IM['explosion-1']];
        if (IM['big-explosion-1']) S.bigExplosion = [IM['big-explosion-1'], IM['big-explosion-2'] || IM['big-explosion-1'], IM['big-explosion-3'] || IM['big-explosion-2'] || IM['big-explosion-1']];
        // 沙雾覆盖纹理(第十一轮,可选):可平铺半透明,沙暴加剧时全屏漂移
        if (IM['sand-overlay']) S.sandOverlay = IM['sand-overlay'];
        // 遗迹(沙暴模式,可选):中立古铜残骸,渲染于 derelict 通道
        if (IM['relic']) S.relic = { canvas: IM['relic'], ax: IM['relic'].width / 2, ay: IM['relic'].height - 24 };
        // 地表纹理(第十轮,可选):AI 沙地/矿区菱形瓦片替换程序化底色
        const groundArts = [IM['ground-1'], IM['ground-2'], IM['ground-3'], IM['ground-4'], IM['ground-5'], IM['ground-6']].filter(Boolean);
        if (groundArts.length) {
          const n0 = groundArts.length;
          while (groundArts.length < 6) groundArts.push(groundArts[groundArts.length % n0]); // 不足 6 张循环补齐
          S.tiles.sand = groundArts.map(img => ({ canvas: img, ax: img.width / 2, ay: img.height / 2 }));
        }
        if (IM['ore-ground-1']) {
          const og = [IM['ore-ground-1'], IM['ore-ground-2'] || IM['ore-ground-1']]
            .map(img => ({ canvas: img, ax: img.width / 2, ay: img.height / 2 }));
          S.tiles.ore = [og[0], og[0], og[1]]; // 矿区三档密度共用两张图
        }
        // 新兵种占位:素材未到时用现有造型顶替(AI 图到位后自动换装)
        if (!S.units.flametank) S.units.flametank = S.units.heavyTank;
        if (!S.units.repair) S.units.repair = S.units.harvester.slice(0, 8);
        if (!S.units.drone) S.units.drone = S.units.repair;
        // AI 岩石:最多 3 个变体,不足用镜像凑齐
        if (rockArts.length) {
          const rocks = rockArts.slice(0, 3).map(img => ({ canvas: img, ax: img.width / 2, ay: img.height - 2 }));
          let mi = 0;
          while (rocks.length < 3) {
            const m = mirrored(rockArts[mi++ % rockArts.length]);
            rocks.push({ canvas: m, ax: m.width / 2, ay: m.height - 2 });
          }
          S.rock = rocks;
        }
        // 标题封面(可选)
        if (IM['title-bg']) S.titleBg = IM['title-bg'];
        // 战地图鉴彩蛋:章节插画只用于全屏档案页;终端是地图角落的可交互道具。
        S.fieldGuide = {
          archive: IM['field-guide-archive'] || S.titleBg || null,
          factions: IM['field-guide-factions'] || S.titleBg || null,
          salvage: IM['field-guide-salvage'] || S.titleBg || null,
        };
        if (IM['archive-terminal']) {
          S.guideTerminal = {
            canvas: IM['archive-terminal'],
            ax: IM['archive-terminal'].width / 2,
            ay: IM['archive-terminal'].height - 3,
          };
        }
        // AI 地表装饰(枯树/石柱挡路,沙柳可通行;骸骨/晶簇/无人机只做特殊物,不再当普通装饰)
        const PROP_DEFS = [['prop-1', true], ['prop-5', true], ['prop-6', false]];
        const props = [];
        for (const [file, block] of PROP_DEFS) if (IM[file]) props.push({ img: IM[file], block });
        if (props.length) {
          S.decor = props.map(p => ({ canvas: p.img, ax: p.img.width / 2, ay: p.img.height - 2, block: p.block }));
          let mi = 0;
          while (S.decor.length < 6) {
            const m = mirrored(props[mi++ % props.length].img);
            const src = props[(mi - 1) % props.length];
            S.decor.push({ canvas: m, ax: m.width / 2, ay: m.height - 2, block: src.block });
          }
        }
        // 特殊互动道具引用(骸骨/观赏晶簇/坠毁无人机)
        S.props = {
          bone: IM['prop-2'] ? { canvas: IM['prop-2'], ax: IM['prop-2'].width / 2, ay: IM['prop-2'].height - 2 } : null,
          bigcrystal: IM['prop-3'] ? { canvas: IM['prop-3'], ax: IM['prop-3'].width / 2, ay: IM['prop-3'].height - 2 } : null,
          drone: IM['prop-4'] ? { canvas: IM['prop-4'], ax: IM['prop-4'].width / 2, ay: IM['prop-4'].height - 2 } : null,
        };
      });
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

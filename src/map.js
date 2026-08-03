/* 地图:128×128 逻辑网格。沙漠地表 + 矿区 + 岩壁 + 装饰 + 可互动特殊物。
 * gen(seed):默认种子 1337 = 经典布局(测试基准);其他种子基地全图随机(留边 12、
 * 间距 ≥80,守卫 300 次为尽力而为),主矿在基地旁随机方向。特殊物:骸骨/观赏晶簇(可采集)、坠毁无人机(可维修回收)。 */
(function (RS) {
  'use strict';

  const W = RS.config.MAP_W, H = RS.config.MAP_H;

  const map = RS.map = {
    tiles: null,
    blocked: null,
    oreTiles: [],
    rockTiles: [],
    specials: [],      // [{type:'bone'|'bigcrystal'|'drone', i, j}]
    playerBase: { i: 30, j: 98 },
    aiBase: { i: 98, j: 30 },
    gen, inBounds, at, isBlocked, setBlocked, oreAt,
  };

  // 经典布局:仅测试基准种子 1337 使用(其余种子走 pickBases 全图随机,间距 ≥80)
  const BASES = {
    player: [{ b: [30, 98], o: [22, 92] }],
    ai: [{ b: [98, 30], o: [106, 36] }],
  };

  function idx(i, j) { return j * W + i; }
  function inBounds(i, j) { return i >= 0 && j >= 0 && i < W && j < H; }
  function at(i, j) { return inBounds(i, j) ? map.tiles[j][i] : null; }
  function isBlocked(i, j) { if (!inBounds(i, j)) return true; return map.blocked[idx(i, j)] === 1; }
  function setBlocked(i, j, v) { if (inBounds(i, j)) map.blocked[idx(i, j)] = v ? 1 : 0; }
  function oreAt(i, j) { const t = at(i, j); return t ? t.ore : 0; }

  function lcg(seed) {
    let s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function putRock(i, j) {
    if (!inBounds(i, j)) return;
    const t = map.tiles[j][i];
    if (t.rock) return;
    t.rock = true; t.ore = 0; t.d = 0;
    setBlocked(i, j, true);
    map.rockTiles.push({ i, j });
  }

  function orePatch(ci, cj, r, perTile, rnd) {
    for (let j = Math.floor(cj - r - 1); j <= Math.ceil(cj + r + 1); j++) {
      for (let i = Math.floor(ci - r - 1); i <= Math.ceil(ci + r + 1); i++) {
        if (!inBounds(i, j)) continue;
        const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj);
        if (d < r - 1 + rnd() * 1.5) {
          const t = map.tiles[j][i];
          if (t.rock) { t.rock = false; setBlocked(i, j, false); }
          if (t.ore <= 0) map.oreTiles.push({ i, j });
          t.ore = perTile; t.oreOrigin = true; t.d = 0;
        }
      }
    }
  }

  function clearRocks(ci, cj, r) {
    map.rockTiles = map.rockTiles.filter(({ i, j }) => {
      if (Math.hypot(i + 0.5 - ci, j + 0.5 - cj) < r) {
        map.tiles[j][i].rock = false;
        setBlocked(i, j, false);
        return false;
      }
      return true;
    });
  }

  function ridge(fn, from, to, gapFrom, gapTo) {
    for (let i = from; i <= to; i++) {
      if (i >= gapFrom && i <= gapTo) continue;
      putRock(i, fn(i));
    }
  }

  // 基地全图随机:任意位置均可(留边 12),只强制双方间距 ≥ 80;
  // 主矿在基地旁随机方向 7~9 格。默认种子 1337 = 经典布局(测试基准)。
  function pickBases(rnd, seed) {
    if (seed === 1337) return [BASES.player[0], BASES.ai[0]];
    let pb = null, ab = null, guard = 0;
    do {
      pb = { b: [12 + Math.floor(rnd() * 92), 12 + Math.floor(rnd() * 92)], o: null };
      ab = { b: [12 + Math.floor(rnd() * 92), 12 + Math.floor(rnd() * 92)], o: null };
    } while (guard++ < 300 && Math.hypot(pb.b[0] - ab.b[0], pb.b[1] - ab.b[1]) < 80);
    for (const base of [pb, ab]) {
      const ang = rnd() * Math.PI * 2, d = 7 + Math.floor(rnd() * 3);
      base.o = [
        Math.max(8, Math.min(119, Math.round(base.b[0] + Math.cos(ang) * d))),
        Math.max(8, Math.min(119, Math.round(base.b[1] + Math.sin(ang) * d))),
      ];
    }
    return [pb, ab];
  }

  // 在开阔地放特殊物(距双方基地 ≥ 20)
  function placeSpecials(rnd, PB, AB) {
    const want = [['bone', 4], ['bigcrystal', 3], ['drone', 3 + Math.floor(rnd() * 3)]];
    for (const [type, count] of want) {
      for (let k = 0; k < count; k++) {
        let i = 0, j = 0, ok = false, guard = 0;
        while (!ok && guard++ < 80) {
          i = 6 + Math.floor(rnd() * (W - 12));
          j = 6 + Math.floor(rnd() * (H - 12));
          if (Math.hypot(i - PB.b[0], j - PB.b[1]) < 20) continue;
          if (Math.hypot(i - AB.b[0], j - AB.b[1]) < 20) continue;
          const t = at(i, j);
          if (!t || t.rock || t.ore > 0) continue;
          if (t.d > 0) continue; // 不落在装饰格上(特殊物消失时恢复通行会错清装饰的阻挡)
          if (map.specials.some(s => Math.hypot(s.i - i, s.j - j) < 12)) continue;
          ok = true;
        }
        if (!ok) continue;
        map.specials.push({ type, i, j });
        const t = map.tiles[j][i];
        setBlocked(i, j, true); // 特殊物存在时挡路
        if (type === 'bone') { t.ore = 300; t.sp = 'bone'; map.oreTiles.push({ i, j }); }
        if (type === 'bigcrystal') { t.ore = 1000; t.sp = 'bigcrystal'; map.oreTiles.push({ i, j }); }
      }
    }
  }

  function gen(seed) {
    const sd = seed === undefined ? 1337 : seed;
    const rnd = lcg(sd);
    map.tiles = []; map.oreTiles = []; map.rockTiles = []; map.specials = [];
    map.blocked = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      const row = [];
      for (let i = 0; i < W; i++) row.push({
        ore: 0, oreOrigin: false, rock: false, v: Math.floor(rnd() * 6), d: 0, sp: null,
      });
      map.tiles.push(row);
    }

    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++)
        if (rnd() < 0.006) putRock(i, j);

    ridge(i => Math.round(118 - i), 52, 76, 60, 66);
    ridge(i => Math.round(i - 20), 48, 80, 56, 62);

    const [PB, AB] = pickBases(rnd, sd);
    map.playerBase = { i: PB.b[0], j: PB.b[1] };
    map.aiBase = { i: AB.b[0], j: AB.b[1] };

    const O = RS.config.ore;
    orePatch(PB.o[0], PB.o[1], 4, O.mainPerTile, rnd);
    orePatch(AB.o[0], AB.o[1], 4, O.mainPerTile, rnd);
    // 中立矿:双方基地连线的中点两侧(对双方真正"中立",不是固定坐标的抽签私矿)
    const mx = (PB.b[0] + AB.b[0]) / 2, my = (PB.b[1] + AB.b[1]) / 2;
    const bdx = AB.b[0] - PB.b[0], bdy = AB.b[1] - PB.b[1], bl = Math.hypot(bdx, bdy) || 1;
    const px = -bdy / bl, py = bdx / bl;
    const clamp = (v) => Math.max(10, Math.min(W - 11, Math.round(v)));
    const N1 = { i: clamp(mx + px * 14), j: clamp(my + py * 14) };
    const N2 = { i: clamp(mx - px * 14), j: clamp(my - py * 14) };
    map.neutralOres = [N1, N2];
    orePatch(N1.i, N1.j, 5, O.neutralPerTile, rnd);
    orePatch(N2.i, N2.j, 5, O.neutralPerTile, rnd);

    clearRocks(PB.b[0], PB.b[1], 14);
    clearRocks(AB.b[0], AB.b[1], 14);
    clearRocks(PB.o[0], PB.o[1], 7); clearRocks(AB.o[0], AB.o[1], 7);
    clearRocks(N1.i, N1.j, 8); clearRocks(N2.i, N2.j, 8);

    // 基地与矿点周边留净空区(挡路的枯树/石柱会卡死出生点和矿车路线)
    const noDecor = [
      [PB.b[0], PB.b[1], 15], [AB.b[0], AB.b[1], 15],
      [PB.o[0], PB.o[1], 8], [AB.o[0], AB.o[1], 8],
      [N1.i, N1.j, 9], [N2.i, N2.j, 9],
    ];

    // 地表装饰(类型由精灵表决定:枯树/石柱挡路,沙柳等可通行)
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const t = map.tiles[j][i];
        if (!t.rock && t.ore <= 0 && rnd() < 0.02) {
          let near = false;
          for (const [nx, ny, nr] of noDecor)
            if (Math.abs(i - nx) + Math.abs(j - ny) < nr) { near = true; break; }
          if (near) continue;
          const decos = RS.sprites && RS.sprites.decor;
          const di = Math.floor(rnd() * (decos ? decos.length : 3));
          t.d = 1 + di;
          if (decos && decos[di] && decos[di].block) setBlocked(i, j, true);
        }
      }

    placeSpecials(rnd, PB, AB);
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

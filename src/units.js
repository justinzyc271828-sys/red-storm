/* 兵种数据表 + 移动系统(A* 寻路 + 路径平滑 + 编队落点 + 软分离)。
 * 无 DOM 依赖,可在 Node 中测试。数值来源:docs/M0-设计稿.md 第 6 节。
 * 寻路修复:平滑禁穿对角石缝;找不到路时原地不动(不再直线硬闯穿模)。 */
(function (RS) {
  'use strict';

  const MW = RS.config.MAP_W, MH = RS.config.MAP_H;

  // dmg/range/vsVehicle/minRange/splash/rof/proj 为 M3 战斗参数
  const TYPES = {
    infantry:  { name: '步兵',     cost: 100, hp: 60,  dmg: 6,  range: 3,   speed: 2.2, buildTime: 3,  quickGroup: 'infantry', vsVehicle: 0.35, rof: 1.2,  proj: 'bullet' },
    rocket:    { name: '火箭兵',   cost: 150, hp: 50,  dmg: 15, range: 4,   speed: 2.0, buildTime: 4,  quickGroup: 'infantry', vsVehicle: 2, vsAir: 2, canHitAir: true, rof: 0.5,  proj: 'rocket' },
    lightTank: { name: '轻型坦克', cost: 350, hp: 180, dmg: 14, range: 4,   speed: 2.8, buildTime: 6,  vehicle: true, quickGroup: 'vehicle', rof: 0.8,  proj: 'shell' },
    heavyTank: { name: '重型坦克', cost: 700, hp: 450, dmg: 30, range: 4.5, speed: 1.6, buildTime: 10, vehicle: true, quickGroup: 'vehicle', rof: 0.6,  proj: 'shell' },
    artillery: { name: '自行火炮', role: '攻城：超远程·无自愈·最低射程2', cost: 900, hp: 140, dmg: 50, range: 8,   speed: 1.4, buildTime: 12, vehicle: true, quickGroup: 'vehicle', minRange: 2, splash: 2.0, rof: 0.25, proj: 'arty', vsBuilding: 3 },
    flametank: { name: '喷火战车', role: '反步兵：近程范围火焰', cost: 500, hp: 220, dmg: 12, range: 2.5, speed: 2.4, buildTime: 8,  vehicle: true, quickGroup: 'vehicle', vsInfantry: 3, vsVehicle: 0.3, splash: 1.4, rof: 2, proj: 'flame' },
    repair:    {
      name: '维修车', role: '支援：自动修车辆/建筑·范围5',
      cost: 450, hp: 160, dmg: 0, range: 0, speed: 2.4, buildTime: 8,
      vehicle: true, quickGroup: 'vehicle',
      repairRange: 5, repairVehiclePct: 0.04, repairVehicleFlat: 3,
      repairVehicleCap: 18, repairBuildingRate: 6, repairDerelictRate: 15,
    },
    harvester: { name: '矿车',     cost: 500, hp: 300, dmg: 0,  range: 0,   speed: 2.2, buildTime: 8,  vehicle: true },
    drillRig:  {
      name: '深层钻探车', role: '经济：驶入采空矿区后展开·每方最多两座',
      cost: 900, hp: 240, dmg: 0, range: 0, speed: 1.6, buildTime: 12, vehicle: true,
    },
    drone:     {
      name: '战斗无人机', role: '空袭：高速高伤·低耐久·可与敌方无人机互相攻击',
      cost: 0, hp: 72, dmg: 18, range: 4.5, speed: 4.6, buildTime: 0,
      air: true, vision: 8, rof: 1.2, proj: 'bullet', canHitAir: true, vsAir: 1,
    },
    mech:      {
      name: '遗迹战甲', role: '史诗：唯一·不可再修·可对空·激活后90s禁对建筑开火',
      cost: 0, hp: 8200, dmg: 45, range: 5, speed: 1.2, buildTime: 0,
      vehicle: true, vision: 5, splash: 1.0, rof: 0.6, proj: 'shell', canHitAir: true,
      vsVehicle: 2.9, vsBuilding: 4,
    },
  };

  // ---------- A* 寻路(8 向,禁切角) ----------
  const N = MW * MH;
  const gScore = new Float64Array(N);
  const fScore = new Float64Array(N);
  const came = new Int32Array(N);
  const state = new Uint8Array(N);
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

  const heap = [];
  function hpush(i) {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (fScore[heap[p]] <= fScore[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]]; k = p;
    }
  }
  function hpop() {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
        if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  }

  function nearestOpen(i, j) {
    if (!RS.map.isBlocked(i, j)) return { i, j };
    for (let r = 1; r <= 6; r++)
      for (let a = -r; a <= r; a++)
        for (let b = -r; b <= r; b++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
          if (!RS.map.isBlocked(i + a, j + b)) return { i: i + a, j: j + b };
        }
    return null;
  }

  // 贴墙惩罚:让路径自然与障碍保持半格距离(绕行更顺滑)
  function adjacentBlocked(i, j) {
    return RS.map.isBlocked(i + 1, j) || RS.map.isBlocked(i - 1, j) || RS.map.isBlocked(i, j + 1) || RS.map.isBlocked(i, j - 1);
  }

  function octile(i, j, gi, gj) {
    const dx = Math.abs(i - gi), dy = Math.abs(j - gj);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  }

  // 直线可视(路径平滑):沿连线采样;斜穿两格间缝隙时,两直角邻格都必须可通行
  // —— 否则单位会从两块对角石头中间"挤过去"(穿模)。
  // 必须从格心采样:移动走格心连线,按角点采样会漏掉真正穿过的格子
  function los(a, b) {
    const steps = Math.ceil(Math.hypot(b.i - a.i, b.j - a.j) * 3) || 1;
    let pi = a.i, pj = a.j;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = a.i + 0.5 + (b.i - a.i) * t, y = a.j + 0.5 + (b.j - a.j) * t;
      const ci = Math.floor(x), cj = Math.floor(y);
      if (RS.map.isBlocked(ci, cj)) return false;
      if (ci !== pi && cj !== pj) { // 斜向跨格
        if (RS.map.isBlocked(pi, cj) || RS.map.isBlocked(ci, pj)) return false;
        pi = ci; pj = cj;
      } else if (ci !== pi || cj !== pj) {
        pi = ci; pj = cj;
      }
    }
    return true;
  }

  function smooth(cells) {
    if (cells.length <= 2) return cells;
    const out = [cells[0]];
    let anchor = 0;
    for (let k = 2; k < cells.length; k++) {
      if (!los(cells[anchor], cells[k])) { out.push(cells[k - 1]); anchor = k - 1; }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }

  function findPath(si, sj, gi, gj) {
    const goal = nearestOpen(gi, gj);
    if (!goal || RS.map.isBlocked(si, sj)) return null;
    const start = sj * MW + si, g = goal.j * MW + goal.i;
    gScore.fill(Infinity); fScore.fill(Infinity); state.fill(0);
    heap.length = 0;
    gScore[start] = 0; fScore[start] = octile(si, sj, goal.i, goal.j);
    state[start] = 1; came[start] = -1; hpush(start);
    let found = false, guard = 0;
    while (heap.length && guard++ < 30000) {
      const cur = hpop();
      if (cur === g) { found = true; break; }
      if (state[cur] === 2) continue;
      state[cur] = 2;
      const ci = cur % MW, cj = Math.floor(cur / MW);
      for (const [di, dj, c] of DIRS) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= MW || nj >= MH) continue;
        if (RS.map.isBlocked(ni, nj)) continue;
        if (di && dj && (RS.map.isBlocked(ci + di, cj) || RS.map.isBlocked(ci, cj + dj))) continue;
        const nidx = nj * MW + ni;
        if (state[nidx] === 2) continue;
        // 贴墙惩罚(目标格豁免,保证能到位)
        const penalty = (ni === goal.i && nj === goal.j) ? 0 : (adjacentBlocked(ni, nj) ? 0.4 : 0);
        const ng = gScore[cur] + c + penalty;
        if (ng < gScore[nidx]) {
          gScore[nidx] = ng; came[nidx] = cur;
          fScore[nidx] = ng + octile(ni, nj, goal.i, goal.j);
          if (state[nidx] !== 1) state[nidx] = 1;
          hpush(nidx);
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = g; c !== -1; c = came[c]) cells.push({ i: c % MW, j: Math.floor(c / MW) });
    cells.reverse();
    return smooth(cells);
  }

  // ---------- 单位移动 ----------
  // 找不到路 → u.path = null(原地不动),绝不直线硬闯;目的地记入 u.dest 供重新寻路
  function setPath(u, tx, ty) {
    const type = TYPES[u.kind];
    if (type && type.air) {
      const x = Math.max(0.5, Math.min(MW - 0.5, tx));
      const y = Math.max(0.5, Math.min(MH - 0.5, ty));
      u.dest = { x, y };
      u.path = [{ x, y }];
      return true;
    }
    const s = RS.iso.tileOf(u.x, u.y), g = RS.iso.tileOf(tx, ty);
    const cells = findPath(s.i, s.j, g.i, g.j);
    u.dest = { x: tx, y: ty };
    if (!cells || !cells.length) { u.path = null; return false; }
    u.path = cells.map(c => ({ x: c.i + 0.5, y: c.j + 0.5 }));
    u.path[u.path.length - 1] = { x: tx, y: ty };
    return true;
  }

  // 沿路径移动;返回是否已走完全程。拐角贴墙时沿墙滑行(单轴),彻底堵死才停。
  function moveAlongPath(u, dt) {
    if (!u.path || !u.path.length) return true;
    const t = u.path[0];
    const dx = t.x - u.x, dy = t.y - u.y;
    const dist = Math.hypot(dx, dy);
    const step = (u.groupSpeed || u.speed) * dt; // 集群行军:全队取最慢速度
    if (dist <= Math.max(step, 0.15)) {
      u.x = t.x; u.y = t.y; u.path.shift();
      if (u.path.length === 0) { u.path = null; u.dest = null; u.groupSpeed = null; return true; } // 走完全程清空(不留空数组/残留集团速度)
      return false;
    }
    const nx = u.x + dx / dist * step, ny = u.y + dy / dist * step;
    const air = TYPES[u.kind] && TYPES[u.kind].air;
    if (air || !RS.map.isBlocked(RS.iso.tileOf(nx, ny).i, RS.iso.tileOf(nx, ny).j)) {
      u.x = nx; u.y = ny;
    } else if (!RS.map.isBlocked(RS.iso.tileOf(nx, u.y).i, RS.iso.tileOf(nx, u.y).j)) {
      u.x = nx;
    } else if (!RS.map.isBlocked(RS.iso.tileOf(u.x, ny).i, RS.iso.tileOf(u.x, ny).j)) {
      u.y = ny;
    } else {
      u.path = null; u.groupSpeed = null; return true;
    }
    u.dir = RS.iso.dir8(dx, dy);
    return false;
  }

  // ---------- 编队落点 ----------
  function formationTargets(units, tx, ty) {
    const offs = [{ dx: 0, dy: 0 }];
    for (let ring = 1; offs.length < units.length; ring++)
      for (let a = -ring; a <= ring; a++)
        for (let b = -ring; b <= ring; b++)
          if (Math.max(Math.abs(a), Math.abs(b)) === ring) offs.push({ dx: a * 1.4, dy: b * 1.4 });
    return units.map((u, k) => {
      const o = offs[k];
      const t = RS.iso.tileOf(tx + o.dx, ty + o.dy);
      const g = nearestOpen(t.i, t.j) || t;
      return { x: g.i + 0.5, y: g.j + 0.5 };
    });
  }

  // 软分离不是刚性碰撞：单位仍可穿过狭窄地形和彼此让路，只在中心过近时施加
  // 小幅、可失败的横向位移。矿车不参与，避免改变卸矿与采集经济；空中单位也跳过。
  // 空间桶把大会战的比较量从全量 O(n²) 降到相邻桶，40–100 单位仍可稳定运行。
  function applySoftSeparation(units, dt) {
    const list = units.filter(u => {
      const t = TYPES[u.kind];
      return u.hp > 0 && t && !t.air && u.kind !== 'harvester' &&
        (t.dmg > 0 || u.kind === 'repair');
    });
    if (list.length < 2) return;

    const CELL = 1.5;
    const bins = new Map();
    const impulses = new Map();
    const key = (x, y) => x + ',' + y;
    for (const u of list) {
      const bx = Math.floor(u.x / CELL), by = Math.floor(u.y / CELL);
      const k = key(bx, by);
      if (!bins.has(k)) bins.set(k, []);
      bins.get(k).push(u);
      impulses.set(u, { x: 0, y: 0 });
    }

    const seen = new Set();
    for (const u of list) {
      const bx = Math.floor(u.x / CELL), by = Math.floor(u.y / CELL);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const near = bins.get(key(bx + ox, by + oy));
        if (!near) continue;
        for (const v of near) {
          if (u === v || u.owner !== v.owner) continue;
          const a = Math.min(u.uid || 0, v.uid || 0);
          const b = Math.max(u.uid || 0, v.uid || 0);
          const pairKey = a + ':' + b;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);

          let dx = v.x - u.x, dy = v.y - u.y;
          const rawDist = Math.hypot(dx, dy);
          let dist = rawDist;
          const desired = (u.vehicle || v.vehicle) ? 0.86 : 0.68;
          if (dist >= desired) continue;
          if (dist < 0.001) {
            // 同坐标时用稳定编号决定方向，避免每帧随机抖动。
            const hash = ((a + 1) * 73856093 ^ (b + 1) * 19349663) >>> 0;
            const ang = hash / 4294967296 * Math.PI * 2;
            dx = Math.cos(ang); dy = Math.sin(ang); dist = 1;
          } else {
            dx /= dist; dy /= dist;
          }
          const force = Math.min(1, (desired - Math.min(rawDist, desired)) / desired);
          const push = force * 0.5;
          const iu = impulses.get(u), iv = impulses.get(v);
          iu.x -= dx * push; iu.y -= dy * push;
          iv.x += dx * push; iv.y += dy * push;
        }
      }
    }

    // 分离速度远低于兵种行军速度，避免追击/撤退时被队友反向推力明显减速。
    const maxStep = 0.45 * dt;
    for (const u of list) {
      const p = impulses.get(u);
      const mag = Math.hypot(p.x, p.y);
      if (mag < 0.0001) continue;
      const step = Math.min(maxStep, mag);
      const nx = u.x + p.x / mag * step;
      const ny = u.y + p.y / mag * step;
      const open = (x, y) => {
        const t = RS.iso.tileOf(x, y);
        return t.i >= 0 && t.j >= 0 && t.i < MW && t.j < MH && !RS.map.isBlocked(t.i, t.j);
      };
      if (open(nx, ny)) { u.x = nx; u.y = ny; }
      else if (open(nx, u.y)) u.x = nx;
      else if (open(u.x, ny)) u.y = ny;
    }
  }

  RS.units = {
    TYPES, findPath, setPath, moveAlongPath, formationTargets, applySoftSeparation,
    nearestOpen, _los: los,
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

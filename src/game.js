/* 游戏状态:经济 + 单位 + 建筑(建造/电力/生产)+ 选择集 + 指令 + 阵营 + 游戏状态机。
 * 无 DOM 依赖,可在 Node 中仿真。
 * M3b/M4:state(title/playing/won/lost)、startGame(难度)、AI 挂接、生产分账(玩家/AI 钱包)、
 *        胜负判定(任一方建筑全灭)、音效钩子。 */
(function (RS) {
  'use strict';

  const TUTORIAL_AUTO_CLOSE_DELAY = 4;
  // 本文件局部变量大量占用 t,翻译函数改名 tStr(铁律:同名换名)
  const tStr = RS.i18n.t;
  const tf = RS.i18n.tf;

  const game = RS.game = {
    money: 0, time: 0,
    state: 'playing',       // main.js 启动后设为 'title';测试默认 'playing'
    difficulty: 'normal',
    waveWarn: 0,
    buildings: [],
    units: [],
    selection: new Set(),
    buildingSel: null,
    markers: [],
    init, update, startGame,
    openFieldGuide, closeFieldGuide, setFieldGuidePage,
    selectOnly, addSelect, clearSelection, commandSmart, commandAttack, toggleHoldFire,
    selectUnitGroup,
    tutorialAction,
    selectBuilding, clearBuildingSel, enqueueUnit, cancelLastUnit,
    pickUnitAt, pickBuildingAt,
    canPlace, startConstruction, findBuildSpot, recycleBuilding, recycleValue,
    powerSupply, powerUsed, lowPower,
    deepMineStatus, deepMineInfo, deepMineSites, findDeepMineSite, deployDrillRig,
    spawnUnitAt, placeStructure, releaseClaims, refundQueue,
    recordUnitDestroyed, recordBuildingDestroyed, recordEconomy, recordMainAttack,
  };

  function sfx(n) { if (RS.audio) RS.audio.sfx(n); }

  function mkUnit(kind, x, y, owner) {
    const t = RS.units.TYPES[kind];
    return {
      uid: game.nextUnitId++,
      kind, x, y, dir: 0, speed: t.speed, hp: t.hp, maxHp: t.hp,
      owner: owner || 'player', vehicle: !!t.vehicle,
      path: null, cmd: null, cool: 0, target: null, aggro: false,
      state: kind === 'harvester' ? 'toOre' : null,
      load: 0, timer: 0, trips: 0,
      post: { x, y }, // 哨位记忆:被钓鱼离岗能走回来
    };
  }

  function spawnUnitAt(kind, x, y, owner) {
    const u = mkUnit(kind, x, y, owner);
    game.units.push(u);
    return u;
  }

  function mkBuilding(type, i, j, done, owner) {
    const def = RS.config.buildings[type];
    const b = {
      type, def, i, j, n: def.n, m: def.m,
      cx: i + def.n / 2, cy: j + def.m / 2,
      hp: def.hp, maxHp: def.hp, owner: owner || 'player',
      done, progress: done ? def.buildTime : 0,
      queue: [], prodProgress: 0, rally: null, cool: 0, target: null,
      lastDamageT: -Infinity, repairFxT: 0, selfRepairFxT: 0,
    };
    if (type === 'turret') {
      // 初始朝向地图中心,避免首个目标出现时炮管瞬移到目标方向并在同帧开火。
      b.aim = Math.atan2(RS.config.MAP_H / 2 - b.cy, RS.config.MAP_W / 2 - b.cx);
      b.aimDir = RS.iso.dir8(Math.cos(b.aim), Math.sin(b.aim));
      b.scanT = 0;
      b.muzzleT = 0;
    }
    if (type === 'refinery') {
      b.dock = pickDock(b); // 卸矿口选朝向矿区的一侧,避免矿车绕厂房打转
    }
    for (let y = j; y < j + def.m; y++)
      for (let x = i; x < i + def.n; x++) {
        RS.map.setBlocked(x, y, true);
        const t = RS.map.at(x, y);
        if (t) { t.ore = 0; t.d = 0; }
      }
    game.buildings.push(b);
    return b;
  }

  function placeStructure(type, i, j, owner, done) { return mkBuilding(type, i, j, done !== false, owner); }

  function findGuideTerminal() {
    const PB = RS.map.playerBase;
    const corners = [
      [7, 7], [RS.config.MAP_W - 8, 7],
      [7, RS.config.MAP_H - 8], [RS.config.MAP_W - 8, RS.config.MAP_H - 8],
    ].sort((a, b) =>
      Math.hypot(b[0] - PB.i, b[1] - PB.j) - Math.hypot(a[0] - PB.i, a[1] - PB.j));
    const usable = (i, j) => {
      const t = RS.map.at(i, j);
      if (!t || RS.map.isBlocked(i, j) || t.ore > 0 || t.rock || t.d > 0) return false;
      if (Math.hypot(i - PB.i, j - PB.j) < 18) return false;
      if (Math.hypot(i - RS.map.aiBase.i, j - RS.map.aiBase.j) < 18) return false;
      return !RS.map.specials.some(s => Math.hypot(s.i - i, s.j - j) < 4);
    };
    for (const [ci, cj] of corners) {
      for (let r = 0; r <= 12; r++)
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
            const i = ci + di, j = cj + dj;
            if (usable(i, j)) return { x: i + 0.5, y: j + 0.5 };
          }
    }
    return null;
  }

  function init() {
    RS.map.gen(RS.gameSeed);
    if (RS.srand) RS.srand(RS.gameSeed); // 可复现随机流(同种子同对局)
    game.money = RS.config.startMoney;
    game.nextUnitId = 1;
    game.time = 0;
    game.state = 'playing';
    game.paused = false;
    game.waveWarn = 0;
    game.suddenDeath = false;
    game.enemyVisible = false;
    game.enemyContactUntil = 0;
    game.notice = null;
    game.tutorial = null;
    game.guideOpen = false;
    game.guidePage = 0;
    game.guideSource = null;
    game.guideWasPaused = false;
    game.sdWarned = false;
    game.oreWarned = false;
    game.buildings = []; game.units = []; game.markers = [];
    game.scars = []; // 战痕(弹坑/焦痕,越打越旧)
    game.selection = new Set();
    game.buildingSel = null;
    game.hvTimer = {};
    game.hasRefP = true; // HUD 预警用:玩家是否有可用精炼厂
    game.enemyWallet = { money: RS.config.startMoney }; // 无 AI 的 Node 仿真:敌方账本独立,不进玩家钱包
    game.stats = {
      unitsKilled: 0,
      unitsLost: 0,
      buildingsDestroyed: 0,
      buildingsLost: 0,
      unitsProduced: 0,
      producedByKind: {},
      lostByKind: {},
      resourcesMined: 0,
      passiveIncome: 0,
      firstMainAttackTime: null,
      buildingsCompletedByType: {},
      moneyPeak: game.money,
      moneyLow: game.money,
      achievements: [],
      finalized: false,
    };
    // 清掉上一局的战场残留(页内重开/Node 多局仿真不串局)
    if (RS.combat) { RS.combat.projectiles.length = 0; RS.combat.explosions.length = 0; }
    RS.map.visited = null; RS.map.visible = null; RS.map.enemyVisible = null; RS.map.enemyVisited = null;
    RS.map.visitedRev = 0; // 双方迷雾同样不串局(探索刷新时重建)
    endCheckT = 0; exploreT = 0; lastLow = false;
    game.derelicts = RS.map.specials.filter(s => s.type === 'drone')
      .map(s => ({ x: s.i + 0.5, y: s.j + 0.5, hp: 0, maxHp: 150, isDerelict: true, vehicle: true }));
    game.guideTerminal = findGuideTerminal();

    const PB = RS.map.playerBase, AB = RS.map.aiBase;
    // 双方精炼厂一律朝自家矿点摆放(收入几何对等,不吃朝向运气)
    const oreNear = b => {
      let sx = 0, sy = 0, n = 0;
      for (const t of RS.map.oreTiles)
        if (Math.hypot(t.i - b.i, t.j - b.j) < 14) { sx += t.i; sy += t.j; n++; }
      return n ? [sx / n, sy / n] : [b.i, b.j - 8];
    };
    const refSpot = (b, o) => {
      const dx = o[0] - b[0], dy = o[1] - b[1], len = Math.hypot(dx, dy) || 1;
      const ox = Math.round(dx / len * 4), oy = Math.round(dy / len * 4);
      const def = RS.config.buildings.refinery;
      const fits = (i, j) => {
        for (let y = j; y < j + def.m; y++)
          for (let x = i; x < i + def.n; x++)
            if (!RS.map.inBounds(x, y) || RS.map.isBlocked(x, y) || RS.map.oreAt(x, y) > 0) return false;
        return true;
      };
      // 全候选评估,选"真实首趟路径(矿格→卸矿口)最短"的可建点:先到先得 + 双方
      // CC 相对锚点朝向不同(玩家南/AI 西北)曾使 AI 朝矿位更常被 CC 卡掉;只看厂心
      // 距离又会选到"近矿侧卸矿口被占、矿车绕厂"的点(三轮验收 P1-03)。
      // 候选 = 朝矿 4 格 + 3~5 格环全格;评分 = 临时占住脚印后的 dock→矿 A* 路长。
      const scoreSpot = (i, j) => {
        for (let y = j; y < j + def.m; y++) for (let x = i; x < i + def.n; x++) RS.map.setBlocked(x, y, true);
        const cx = i + def.n / 2, cy = j + def.m / 2;
        const ore = nearestOreTile(cx, cy);
        const cands = [];
        for (let x = i; x < i + def.n; x++) cands.push([x, j - 1], [x, j + def.m]);
        for (let y = j; y < j + def.m; y++) cands.push([i - 1, y], [i + def.n, y]);
        let dock = null, bd2 = Infinity;
        for (const [x, y] of cands) {
          if (RS.map.isBlocked(x, y)) continue;
          const d = ore ? Math.hypot(x + 0.5 - ore.i, y + 0.5 - ore.j) : 0;
          if (d < bd2) { bd2 = d; dock = { x: x + 0.5, y: y + 0.5 }; }
        }
        let len = 99;
        if (ore && dock) {
          const cells = RS.units.findPath(ore.i, ore.j, Math.floor(dock.x), Math.floor(dock.y));
          if (cells) { len = 0; for (let k = 1; k < cells.length; k++) len += Math.hypot(cells[k].i - cells[k - 1].i, cells[k].j - cells[k - 1].j); }
        }
        for (let y = j; y < j + def.m; y++) for (let x = i; x < i + def.n; x++) RS.map.setBlocked(x, y, false);
        return len;
      };
      let best = null, bd = Infinity;
      const consider = (i, j) => {
        if (!fits(i, j)) return;
        const d = scoreSpot(i, j);
        if (d < bd) { bd = d; best = { i, j }; }
      };
      consider(b[0] + ox, b[1] + oy); // 朝矿方向优先(同分时保持旧行为)
      for (let r = 3; r <= 5; r++)
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
            consider(b[0] + di, b[1] + dj);
          }
      return best || { i: b[0], j: b[1] - 4 };
    };
    mkBuilding('cc', PB.i, PB.j + 2, true, 'player');
    const ps = refSpot([PB.i, PB.j], oreNear(PB));
    const ref = mkBuilding('refinery', ps.i, ps.j, true, 'player');

    // 开局矿车直接出生在矿边:双方首趟路径对等,不吃出生点运气
    const spawnStarterHarvester = (refB, owner) => {
      const ore = nearestOre(refB.cx, refB.cy);
      const g = ore && RS.units.nearestOpen(ore.i, ore.j);
      if (g) {
        const u = mkUnit('harvester', g.i + 0.5, g.j + 0.5, owner);
        game.units.push(u);
        return u;
      }
      return spawnHarvesterNear(refB);
    };
    ref.bonusHarvester = spawnStarterHarvester(ref, 'player');

    const squad = [
      ['infantry', PB.i + 4.5, PB.j + 2.5], ['infantry', PB.i + 6.5, PB.j + 3.5], ['infantry', PB.i + 4.5, PB.j + 4.5],
      ['rocket', PB.i + 6.5, PB.j + 2.5], ['rocket', PB.i + 5.5, PB.j + 4.5],
    ];
    for (const [kind, x, y] of squad) game.units.push(mkUnit(kind, x, y, 'player'));

    // 敌方前哨(开局镜像玩家:数值对等,无免费炮塔;精炼厂同样朝矿)
    placeStructure('cc', AB.i - 2, AB.j - 2, 'enemy');
    const es = refSpot([AB.i, AB.j], oreNear(AB));
    const eref = placeStructure('refinery', es.i, es.j, 'enemy');
    eref.bonusHarvester = spawnStarterHarvester(eref, 'enemy');
    const eSquad = [
      ['infantry', AB.i - 2.5, AB.j + 1.5], ['infantry', AB.i - 0.5, AB.j + 4.5], ['infantry', AB.i - 4.5, AB.j + 3.5],
      ['rocket', AB.i + 1.5, AB.j + 0.5], ['rocket', AB.i - 1.5, AB.j + 4.5],
    ];
    for (const [kind, x, y] of eSquad) game.units.push(mkUnit(kind, x, y, 'enemy'));
  }

  function startGame(difficulty, opts) {
    const guided = difficulty === 'tutorial';
    game.difficulty = guided ? 'easy' : (difficulty || 'normal');
    game.mode = opts && opts.mode === 'campaign' ? 'campaign' : 'skirmish';
    game.campaignChapter = game.mode === 'campaign' ? (opts.chapter || 1) : null;
    RS.ai.init(game.difficulty, { profile: opts && opts.aiProfile || null });
    if (guided) {
      game.tutorial = {
        step: 0,
        flags: { moved: false },
        baseVisited: null,
        completedAt: null,
      };
    } else {
      game.tutorial = null;
    }
    // 沙暴模式(可选):opts.storm 开启;种子随机 T ∈ [15,23] 分钟,替代固定闹钟
    game.stormMode = !guided && !!(opts && opts.storm);
    if (game.stormMode) initStorm();
    game.state = 'playing';
  }

  // ---------- 沙暴模式(2026-07-25 设计 v3) ----------
  function initStorm() {
    const S = RS.config.storm;
    const T = Math.round(S.triggerMin + RS.rnd() * (S.triggerMax - S.triggerMin));
    game.storm = {
      t: T, active: false, warned: false, revealed: false,
      relic: null, mechOwner: null,
    };
  }

  // 遗迹选址:双方 A* 路长差 ≤ relicPathDiff(不足放宽到 Max),各距 ≥25,避开矿 4 格
  function pickRelicSite() {
    const S = RS.config.storm, PB = RS.map.playerBase, AB = RS.map.aiBase;
    // 基地锚点可能压在建筑脚下(AI CC 覆盖 AB 锚点),寻路原点取最近空地
    const PA = RS.units.nearestOpen(PB.i, PB.j) || PB, QA = RS.units.nearestOpen(AB.i, AB.j) || AB;
    const MW = RS.config.MAP_W, MH = RS.config.MAP_H;
    const pathLen = (a, b) => {
      const probe = { x: a.i + 0.5, y: a.j + 0.5, path: null };
      return RS.units.setPath(probe, b.i + 0.5, b.j + 0.5) ? pathCost(probe.path) : Infinity;
    };
    const pathCost = p => {
      let c = 0;
      for (let k = 1; k < p.length; k++) c += Math.hypot(p[k].x - p[k - 1].x, p[k].y - p[k - 1].y);
      return c;
    };
    const clear = (i, j) => {
      if (Math.hypot(i - PB.i, j - PB.j) < S.relicMinBaseDist) return false;
      if (Math.hypot(i - AB.i, j - AB.j) < S.relicMinBaseDist) return false;
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          if (!RS.map.inBounds(i + a, j + b) || RS.map.isBlocked(i + a, j + b)) return false; // 3×3 落脚点通畅(岩壁天然被挡格覆盖)
      for (const t of RS.map.oreTiles) if (Math.hypot(t.i - i, t.j - j) < S.relicOreClearance) return false;
      return true;
    };
    for (const limit of [S.relicPathDiff, S.relicPathDiffMax, 0.5]) {
      let best = null, bestScore = Infinity;
      for (let k = 0; k < 400; k++) {
        const i = Math.floor(RS.rnd() * MW), j = Math.floor(RS.rnd() * MH);
        if (!clear(i, j)) continue;
        const lp = pathLen(PA, { i, j }), la = pathLen(QA, { i, j });
        if (!isFinite(lp) || !isFinite(la) || !lp || !la) continue;
        const diff = Math.abs(lp - la) / Math.max(lp, la);
        if (diff > limit) continue;
        const score = diff + Math.abs((lp + la) / 2 - 60) / 200; // 等距优先,且别离双方太近
        if (score < bestScore) { bestScore = score; best = { i, j }; }
      }
      if (best) return best;
    }
    return null;
  }

  function spawnRelic() {
    const site = pickRelicSite();
    if (!site) return; // 极端地形:无遗迹,纯视野压制局
    const relic = {
      x: site.i + 0.5, y: site.j + 0.5, isRelic: true, vehicle: true,
      hp: 0, maxHp: 1, revealed: false,
      pools: { player: 0, enemy: 0 }, lastRepairT: { player: -999, enemy: -999 },
      activated: false, owner: null,
    };
    game.storm.relic = relic;
    game.derelicts.push(relic); // 维修选择器复用 derelict 通道
    RS.map.setBlocked(site.i, site.j, true);
    // 象限提示(按地图象限统一表述)
    const qi = site.i < RS.config.MAP_W / 2 ? tStr('西') : tStr('东'), qj = site.j < RS.config.MAP_H / 2 ? tStr('北') : tStr('南');
    game.notice = { text: tf('沙暴从{dir}方向卷来了金属撞击声……', { dir: qj + qi }), until: game.time + 8 };
    sfx('warn');
  }

  function updateStorm(dt) {
    const st = game.storm, S = RS.config.storm, t = game.time;
    // T-60s 预警
    if (!st.warned && t >= st.t - S.warnLead) {
      st.warned = true;
      game.notice = { text: tStr('电离异常：沙暴将在 60 秒后到达，所有感知将被压制。'), until: t + 8 };
      sfx('warn');
      if (RS.ai && RS.ai.onStormWarn) RS.ai.onStormWarn();
    }
    // T 降临:视野压制 + 吹出遗迹
    if (!st.active && t >= st.t) {
      st.active = true;
      game.suddenDeath = true; // 并入双倍伤语义(替代旧 25 分钟闹钟)
      game.notice = { text: tStr('沙暴降临！视野被压制，遗迹已被吹出沙面。'), until: t + 8 };
      sfx('warn');
      spawnRelic();
      if (RS.ai && RS.ai.onStormActive) RS.ai.onStormActive();
    }
    // T+90s 遗迹明牌
    if (st.active && st.relic && !st.relic.revealed && t >= st.t + S.relicRevealDelay) {
      st.relic.revealed = true;
      game.notice = { text: tStr('遗迹位置已被双方的侦测网锁定！'), until: t + 6 };
      sfx('warn');
      if (RS.ai && RS.ai.onRelicRevealed) RS.ai.onRelicRevealed();
    }
    // T+5 分钟起 CC 流血(与旧 30 分钟闹钟同节奏)
    if (st.active && t >= st.t + S.bleedDelay) {
      for (const b of game.buildings) {
        if (b.type !== 'cc' || b.destroyed) continue;
        b.hp -= (b.maxHp / 187) * dt;
        b.lastDamageT = t;
        if (b.hp <= 0) { b.hp = 0; RS.combat.destroyBuilding(b); }
      }
    }
    // 修理池衰减与激活
    const r = st.relic;
    if (r && !r.activated) {
      for (const o of ['player', 'enemy']) {
        if (r.pools[o] > 0 && t - r.lastRepairT[o] > S.repairDecayDelay)
          r.pools[o] = Math.max(0, r.pools[o] * (1 - S.repairDecayRate * dt));
      }
    }
  }

  // 遗迹被修满一方修理池 → 激活机甲并广播
  function activateRelic(owner) {
    const r = game.storm.relic;
    r.activated = true; r.owner = owner;
    game.storm.mechOwner = owner;
    game.notice = { text: owner === 'player' ? tStr('我方激活了遗迹战甲！') : tStr('敌方激活了遗迹战甲！'), until: game.time + 8 };
    sfx('warn');
    const dt2 = RS.iso.tileOf(r.x, r.y);
    RS.map.setBlocked(dt2.i, dt2.j, false);
    const u = spawnUnitAt('mech', r.x, r.y, owner);
    if (u) u.noFireBuildingsUntil = game.time + RS.config.storm.mechNoFireBuildings;
    game.derelicts.splice(game.derelicts.indexOf(r), 1);
    RS.combat.explosions.push({ x: r.x, y: r.y, t: 0, dur: 0.8, r: 32 });
    if (RS.ai && RS.ai.onMechActivated) RS.ai.onMechActivated(owner);
  }

  function openFieldGuide(source) {
    if (game.guideOpen) return false;
    game.guideOpen = true;
    game.guidePage = 0;
    game.guideSource = source || 'unknown';
    game.guideWasPaused = !!game.paused;
    if (game.state === 'playing') game.paused = true;
    return true;
  }

  function closeFieldGuide() {
    if (!game.guideOpen) return false;
    game.guideOpen = false;
    if (game.state === 'playing' && !game.guideWasPaused) game.paused = false;
    game.guideSource = null;
    game.guideWasPaused = false;
    return true;
  }

  function setFieldGuidePage(page) {
    const n = RS.fieldGuide ? RS.fieldGuide.pageCount : 5;
    game.guidePage = Math.max(0, Math.min(n - 1, Math.round(page)));
    return game.guidePage;
  }

  function tutorialAction(action) {
    const t = game.tutorial;
    if (!t) return false;
    if (action === 'skip') {
      game.tutorial = null;
      return true;
    }
    if (action === 'next') {
      if (t.step >= 7) game.tutorial = null;
      else {
        t.step++;
        if (t.step >= 7) t.completedAt = game.time;
      }
      sfx('build');
      return true;
    }
    return false;
  }

  function visitedCount() {
    let n = 0;
    if (RS.map.visited) for (const v of RS.map.visited) n += v;
    return n;
  }

  function updateTutorial() {
    const t = game.tutorial;
    if (!t) return;
    if (t.step >= 7) {
      if (t.completedAt === null) t.completedAt = game.time;
      if (game.time - t.completedAt >= TUTORIAL_AUTO_CLOSE_DELAY)
        game.tutorial = null;
      return;
    }
    if (t.baseVisited === null && RS.map.visited) t.baseVisited = visitedCount();
    let complete = false;
    if (t.step === 1) complete = game.selection.size > 0;
    else if (t.step === 2) complete = t.flags.moved;
    else if (t.step === 3) complete = game.buildings.some(b =>
      b.owner === 'player' && b.type === 'power' && !b.destroyed);
    else if (t.step === 4) complete = game.buildings.some(b =>
      b.owner === 'player' && b.type === 'barracks' && b.done && !b.destroyed);
    else if (t.step === 5) complete = game.units.filter(u =>
      u.owner === 'player' && u.kind === 'infantry' && u.hp > 0).length > 3;
    else if (t.step === 6 && t.baseVisited !== null)
      complete = visitedCount() >= t.baseVisited + 180;
    if (complete) {
      t.step++;
      if (t.step >= 7) t.completedAt = game.time;
      sfx('build');
    }
  }

  // ---------- 电力(分阵营:各自算各自的) ----------
  function powerSupply(owner) {
    let s = 0;
    for (const b of game.buildings) if (b.owner === (owner || 'player') && b.done && b.def.power > 0) s += b.def.power;
    return s;
  }
  function powerUsed(owner) {
    let s = 0;
    for (const b of game.buildings) if (b.owner === (owner || 'player') && b.done && b.def.power < 0) s -= b.def.power;
    return s;
  }
  function lowPower(owner) { return powerUsed(owner) > powerSupply(owner); }

  // ---------- 建造 ----------
  function tilesFree(i, j, n, m, ignoreUnit) {
    for (let y = j; y < j + m; y++)
      for (let x = i; x < i + n; x++) {
        if (!RS.map.inBounds(x, y) || RS.map.isBlocked(x, y)) return false;
        if (RS.map.oreAt(x, y) > 0) return false;
      }
    for (const u of game.units) {
      if (u === ignoreUnit) continue;
      const t = RS.iso.tileOf(u.x, u.y);
      if (t.i >= i && t.i < i + n && t.j >= j && t.j < j + m) return false;
    }
    for (const b of game.buildings) { // 不许盖住任何精炼厂的卸矿口
      if (b.type !== 'refinery' || b.destroyed || !b.dock) continue;
      const dt = RS.iso.tileOf(b.dock.x, b.dock.y);
      if (dt.i >= i && dt.i < i + n && dt.j >= j && dt.j < j + m) return false;
    }
    return true;
  }

  function nearExisting(i, j, n, m) {
    const R = RS.config.buildRadius;
    for (const b of game.buildings) {
      if (b.owner !== 'player') continue;
      const dx = Math.max(b.i - (i + n), i - (b.i + b.n), 0);
      const dy = Math.max(b.j - (j + m), j - (b.j + b.m), 0);
      if (Math.hypot(dx, dy) <= R) return true;
    }
    return false;
  }

  function canPlace(type, i, j) {
    const def = RS.config.buildings[type];
    if (!def || def.deployedOnly) return false;
    if (game.buildings.some(b => b.owner === 'player' && !b.done)) return false;
    return tilesFree(i, j, def.n, def.m) && nearExisting(i, j, def.n, def.m);
  }

  function startConstruction(type, i, j) {
    const def = RS.config.buildings[type];
    if (!def || def.deployedOnly || game.money < def.cost || !canPlace(type, i, j)) return false;
    game.money -= def.cost;
    recordEconomy();
    mkBuilding(type, i, j, false, 'player');
    return true;
  }

  function recycleValue(b) {
    if (!b || b.owner !== 'player' || b.destroyed || b.type === 'cc') return 0;
    let recoverableCost = b.def.cost;
    // 精炼厂赠送的矿车若仍存活且随玩家保留,先扣掉其价值,防止反复建卖刷廉价矿车。
    if (b.done && b.bonusHarvester && b.bonusHarvester.hp > 0 && game.units.includes(b.bonusHarvester))
      recoverableCost = Math.max(0, recoverableCost - RS.units.TYPES.harvester.cost);
    const structure = b.done
      ? Math.floor(recoverableCost * RS.config.buildingRecycleRatio)
      : recoverableCost;
    const queued = b.queue.reduce((sum, kind) => sum + RS.units.TYPES[kind].cost, 0);
    return structure + queued;
  }

  // 玩家主动拆除:施工中全额退建筑款;成品退 60%;生产队列始终另行全额退款。
  // 不走 combat.destroyBuilding,避免主动回收产生爆炸、焦痕和遇袭语义。
  function recycleBuilding(b) {
    const idx = game.buildings.indexOf(b);
    if (idx < 0 || !b || b.owner !== 'player' || b.destroyed || b.type === 'cc') return false;
    const total = recycleValue(b);
    const queued = b.queue.reduce((sum, kind) => sum + RS.units.TYPES[kind].cost, 0);
    refundQueue(b);
    game.money += total - queued;
    recordEconomy();
    b.destroyed = true;
    b.hp = 0;
    for (let y = b.j; y < b.j + b.m; y++)
      for (let x = b.i; x < b.i + b.n; x++) RS.map.setBlocked(x, y, false);
    game.buildings.splice(idx, 1);
    if (game.buildingSel === b) clearBuildingSel();
    return total;
  }

  // 为任意阵营在 (ci,cj) 周边环形搜索可建点(贴近己方建筑、无阻挡无矿);AI 建造/重建用
  function findBuildSpot(type, ci, cj, owner, maxR) {
    const def = RS.config.buildings[type];
    if (!def) return null;
    const R = maxR || 10;
    for (let r = 0; r <= R; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (!tilesFree(i, j, def.n, def.m)) continue;
          let near = false;
          for (const b of game.buildings) {
            if (b.owner !== owner || b.destroyed) continue;
            const dx = Math.max(b.i - (i + def.n), i - (b.i + b.n), 0);
            const dy = Math.max(b.j - (j + def.m), j - (b.j + b.m), 0);
            if (Math.hypot(dx, dy) <= RS.config.buildRadius) { near = true; break; }
          }
          if (near) return { i, j };
        }
    return null;
  }

  // ---------- 深层经济 ----------
  function countDepletedOre(x, y) {
    const cfg = RS.config.deepEconomy;
    let count = 0;
    const r = cfg.deployRadius;
    for (let j = Math.floor(y - r); j <= Math.ceil(y + r); j++)
      for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
        if (Math.hypot(i + 0.5 - x, j + 0.5 - y) > r) continue;
        const t = RS.map.at(i, j);
        if (t && t.oreOrigin && t.ore <= 1e-6) count++;
      }
    return count;
  }

  function deepMineInfo(target) {
    const cfg = RS.config.deepEconomy;
    const x = target && target.cx !== undefined ? target.cx : target.x;
    const y = target && target.cy !== undefined ? target.cy : target.y;
    const depleted = Number.isFinite(x) && Number.isFinite(y) ? countDepletedOre(x, y) : 0;
    let tier = 0;
    for (let k = 0; k < cfg.tierDepleted.length; k++)
      if (depleted >= cfg.tierDepleted[k]) tier = k + 1;
    const payout = tier ? cfg.tierPayout[tier - 1] : 0;
    return {
      depleted, tier, payout,
      perMinute: payout * 60 / cfg.incomeTick,
    };
  }

  function deepMineCount(owner) {
    return game.buildings.filter(b =>
      b.owner === owner && b.type === 'deepMine' && !b.destroyed).length;
  }

  function deepMineTooClose(x, y) {
    const spacing = RS.config.deepEconomy.minSpacing;
    return game.buildings.some(b =>
      b.type === 'deepMine' && !b.destroyed &&
      Math.hypot(b.cx - x, b.cy - y) < spacing);
  }

  function findDeepMineFootprint(u, ignoreUnit) {
    const def = RS.config.buildings.deepMine;
    const bi = Math.floor(u.x) - Math.floor(def.n / 2);
    const bj = Math.floor(u.y) - Math.floor(def.m / 2);
    let best = null;
    for (let r = 0; r <= 2; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = bi + di, j = bj + dj;
          if (!tilesFree(i, j, def.n, def.m, ignoreUnit || u)) continue;
          const cx = i + def.n / 2, cy = j + def.m / 2;
          if (deepMineTooClose(cx, cy)) continue;
          const info = deepMineInfo({ x: cx, y: cy });
          if (info.depleted < RS.config.deepEconomy.deployMinDepleted) continue;
          if (!best || info.depleted > best.info.depleted)
            best = { i, j, cx, cy, info };
        }
    return best;
  }

  function deepMineStatus(u) {
    const cfg = RS.config.deepEconomy;
    const status = {
      valid: false, reason: tStr('请选择深层钻探车'), depleted: 0, tier: 0,
      payout: 0, perMinute: 0, spot: null,
    };
    if (!u || u.kind !== 'drillRig' || u.hp <= 0 || !game.units.includes(u)) return status;
    const local = deepMineInfo(u);
    Object.assign(status, local);
    if (deepMineCount(u.owner) >= cfg.maxPerOwner) {
      status.reason = tStr('已达到每方两座上限');
      return status;
    }
    if (local.depleted < cfg.deployMinDepleted) {
      status.reason = tf('附近采空矿格 {depleted}/{min}', { depleted: local.depleted, min: cfg.deployMinDepleted });
      return status;
    }
    const spot = findDeepMineFootprint(u);
    if (!spot) {
      status.reason = deepMineTooClose(u.x, u.y) ? tStr('同一矿区已有深层开采站') : tStr('附近没有可展开的 2×2 空地');
      return status;
    }
    Object.assign(status, spot.info);
    status.valid = true;
    status.reason = tf('可展开：每分钟 +${m}', { m: status.perMinute });
    status.spot = spot;
    return status;
  }

  // 玩家选中钻探车时的地图提示：只列出历史探索过、当前确实能展开的 2×2 位置。
  // 候选与实际展开复用同一套 footprint/间距/上限判定，避免 UI 画绿但落地失败；
  // 同一矿区按 minSpacing 合并成一个最佳位置，防止几十个重叠框淹没地图。
  function deepMineSites(owner, exploredOnly, ignoreUnit) {
    const cfg = RS.config.deepEconomy;
    if (deepMineCount(owner) >= cfg.maxPerOwner) return [];
    const mask = owner === 'enemy' ? RS.map.enemyVisited : RS.map.visited;
    const raw = [], footprints = new Set();
    for (const pos of RS.map.oreTiles) {
      const t = RS.map.at(pos.i, pos.j);
      if (!t || !t.oreOrigin || t.ore > 1e-6) continue;
      if (exploredOnly && (!mask || !mask[pos.j * RS.config.MAP_W + pos.i])) continue;
      const probe = {
        kind: 'drillRig', owner, hp: 1,
        x: pos.i + 0.5, y: pos.j + 0.5,
      };
      const spot = findDeepMineFootprint(probe, ignoreUnit);
      if (!spot) continue;
      if (exploredOnly) {
        let known = true;
        for (let y = spot.j; y < spot.j + RS.config.buildings.deepMine.m; y++)
          for (let x = spot.i; x < spot.i + RS.config.buildings.deepMine.n; x++)
            if (!mask[y * RS.config.MAP_W + x]) known = false;
        if (!known) continue;
      }
      const key = spot.i + ':' + spot.j;
      if (footprints.has(key)) continue;
      footprints.add(key);
      raw.push(spot);
    }
    const origin = ignoreUnit || (owner === 'enemy' ? RS.map.aiBase : RS.map.playerBase);
    const ox = Number.isFinite(origin.x) ? origin.x : origin.i;
    const oy = Number.isFinite(origin.y) ? origin.y : origin.j;
    raw.sort((a, b) => b.info.depleted - a.info.depleted ||
      Math.hypot(a.cx - ox, a.cy - oy) - Math.hypot(b.cx - ox, b.cy - oy));
    const sites = [];
    for (const spot of raw) {
      if (sites.some(s => Math.hypot(s.cx - spot.cx, s.cy - spot.cy) < cfg.minSpacing)) continue;
      sites.push({
        i: spot.i, j: spot.j, n: RS.config.buildings.deepMine.n,
        m: RS.config.buildings.deepMine.m, cx: spot.cx, cy: spot.cy,
        depleted: spot.info.depleted, tier: spot.info.tier,
        payout: spot.info.payout, perMinute: spot.info.perMinute,
      });
    }
    return sites;
  }

  function findDeepMineSite(owner, fromX, fromY, minPerMinute) {
    if (deepMineCount(owner) >= RS.config.deepEconomy.maxPerOwner) return null;
    const base = owner === 'enemy' ? RS.map.aiBase : RS.map.playerBase;
    const ox = Number.isFinite(fromX) ? fromX : base.i;
    const oy = Number.isFinite(fromY) ? fromY : base.j;
    let best = null, score = Infinity;
    for (const pos of RS.map.oreTiles) {
      const t = RS.map.at(pos.i, pos.j);
      if (!t || !t.oreOrigin || t.ore > 1e-6) continue;
      const probe = { kind: 'drillRig', owner, hp: 1, x: pos.i + 0.5, y: pos.j + 0.5 };
      const def = RS.config.buildings.deepMine;
      const bi = pos.i - Math.floor(def.n / 2), bj = pos.j - Math.floor(def.m / 2);
      if (!tilesFree(bi, bj, def.n, def.m)) continue;
      const cx = bi + def.n / 2, cy = bj + def.m / 2;
      if (deepMineTooClose(cx, cy)) continue;
      const info = deepMineInfo(probe);
      if (info.depleted < RS.config.deepEconomy.deployMinDepleted) continue;
      if (minPerMinute && info.perMinute < minPerMinute) continue;
      const s = Math.hypot(probe.x - ox, probe.y - oy) - info.depleted * 0.15;
      if (s < score) {
        score = s;
        best = { x: probe.x, y: probe.y, depleted: info.depleted, perMinute: info.perMinute };
      }
    }
    return best;
  }

  function deployDrillRig(u) {
    const status = deepMineStatus(u);
    if (!status.valid) {
      if (u && u.owner === 'player')
        game.notice = { text: status.reason, until: game.time + 3.5 };
      return false;
    }
    const idx = game.units.indexOf(u);
    if (idx < 0) return false;
    game.units.splice(idx, 1);
    game.selection.delete(u);
    const b = mkBuilding('deepMine', status.spot.i, status.spot.j, true, u.owner);
    b.incomeTimer = 0;
    Object.assign(b, {
      deepDepleted: status.depleted,
      deepTier: status.tier,
      deepPayout: status.payout,
      deepPerMinute: status.perMinute,
      deepPowered: !lowPower(u.owner),
    });
    if (u.owner === 'player') {
      game.stats.buildingsCompletedByType.deepMine =
        (game.stats.buildingsCompletedByType.deepMine || 0) + 1;
      selectBuilding(b);
      game.notice = { text: tf('深层开采站已展开：每分钟 +${m}', { m: status.perMinute }), until: game.time + 4 };
      sfx('build');
    }
    return b;
  }

  function updateDeepMine(b, dt, powered) {
    const info = deepMineInfo(b);
    b.deepDepleted = info.depleted;
    b.deepTier = info.tier;
    b.deepPayout = info.payout;
    b.deepPerMinute = info.perMinute;
    b.deepPowered = powered && info.payout > 0;
    if (!b.deepPowered) return;
    b.incomeTimer = (b.incomeTimer || 0) + dt;
    const tick = RS.config.deepEconomy.incomeTick;
    while (b.incomeTimer >= tick) {
      b.incomeTimer -= tick;
      walletForOwner(b.owner).money += info.payout;
      b.incomeFxT = 1;
      if (b.owner === 'player') {
        game.stats.passiveIncome += info.payout;
        recordEconomy();
      }
    }
  }

  function spawnHarvesterNear(b) {
    const g = RS.units.nearestOpen(Math.round(b.cx), b.j - 1)
      || RS.units.nearestOpen(Math.round(b.cx), b.j + b.m + 1);
    if (g) {
      const u = mkUnit('harvester', g.i + 0.5, g.j + 0.5, b.owner);
      game.units.push(u);
      return u;
    }
    return null;
  }

  // ---------- 生产(玩家/AI 分账;无 AI 时敌方走独立兜底账本) ----------
  function walletForOwner(owner) {
    if (owner === 'enemy') return RS.ai ? RS.ai.wallet : game.enemyWallet;
    return game;
  }
  function walletFor(b) { return walletForOwner(b.owner); }

  // 建筑被毁时队列全额退款(与手动取消 cancelLastUnit 同一约定:钱不蒸发)
  function refundQueue(b) {
    for (const kind of b.queue) walletForOwner(b.owner).money += RS.units.TYPES[kind].cost;
    b.queue = [];
    b.prodProgress = 0;
    if (b.owner === 'player') recordEconomy();
  }

  function enqueueUnit(b, kind) {
    if (!b.done || !b.def.produces || !b.def.produces.includes(kind)) return false;
    const def = RS.units.TYPES[kind];
    const w = walletFor(b);
    if (w.money < def.cost || b.queue.length >= 5) return false;
    w.money -= def.cost;
    if (b.owner === 'player') recordEconomy();
    b.queue.push(kind);
    return true;
  }

  function cancelLastUnit(b) {
    const kind = b.queue.pop();
    if (!kind) return false;
    walletFor(b).money += RS.units.TYPES[kind].cost;
    if (b.owner === 'player') recordEconomy();
    if (!b.queue.length) b.prodProgress = 0;
    return true;
  }

  function spawnUnit(b, kind) {
    const cands = [];
    for (let x = b.i - 1; x <= b.i + b.n; x++) cands.push([x, b.j + b.m]);
    for (let y = b.j - 1; y <= b.j + b.m; y++) { cands.push([b.i - 1, y]); cands.push([b.i + b.n, y]); }
    let g = null;
    for (const [x, y] of cands) {
      if (!RS.map.inBounds(x, y) || RS.map.isBlocked(x, y)) continue;
      let occupied = false; // 出生格不许与闲置单位重叠
      for (const u of game.units) if (Math.abs(u.x - (x + 0.5)) < 0.6 && Math.abs(u.y - (y + 0.5)) < 0.6) { occupied = true; break; }
      if (!occupied) { g = { i: x, j: y }; break; }
    }
    if (!g) g = RS.units.nearestOpen(Math.round(b.cx), Math.round(b.j + b.m + 1));
    if (!g) {
      walletFor(b).money += RS.units.TYPES[kind].cost;
      if (b.owner === 'player') recordEconomy();
      return;
    } // 出生点全堵:退款,不吞兵
    const u = mkUnit(kind, g.i + 0.5, g.j + 0.5, b.owner);
    game.units.push(u);
    if (b.owner === 'player') {
      game.stats.unitsProduced++;
      game.stats.producedByKind[kind] = (game.stats.producedByKind[kind] || 0) + 1;
    }
    if (b.rally && kind !== 'harvester') RS.units.setPath(u, b.rally.x, b.rally.y);
    if (b.owner === 'player') sfx('ready');
  }

  // ---------- 选择 / 悬停 ----------
  function selectOnly(list) { game.selection = new Set(list); game.buildingSel = null; }
  function addSelect(list) { for (const u of list) game.selection.add(u); game.buildingSel = null; }
  function clearSelection() { game.selection.clear(); }
  function selectBuilding(b) { game.buildingSel = b; game.selection = new Set(); }
  function clearBuildingSel() { game.buildingSel = null; }
  function selectUnitGroup(group, add) {
    const hit = game.units.filter(u =>
      u.owner === 'player' && u.hp > 0 && RS.units.TYPES[u.kind].quickGroup === group);
    if (add) addSelect(hit);
    else selectOnly(hit);
    return hit;
  }

  function pickUnitAt(wx, wy) {
    let best = null, bd = 0.7;
    for (const u of game.units) {
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  function pickBuildingAt(wx, wy) {
    for (const b of game.buildings)
      if (wx >= b.i && wx < b.i + b.n && wy >= b.j && wy < b.j + b.m) return b;
    return null;
  }

  // ---------- 智能指令 ----------
  function commandSmart(wx, wy) {
    const sel = [...game.selection];
    if (!sel.length) return;
    const t = RS.iso.tileOf(wx, wy);
    const ore = RS.map.oreAt(t.i, t.j) > 0;
    const knownOre = ore && (!RS.map.visited ||
      !!RS.map.visited[t.j * RS.config.MAP_W + t.i]);
    const clickedB = pickBuildingAt(wx, wy);
    const refClick = !!(clickedB && clickedB.type === 'refinery' && clickedB.owner === 'player' && clickedB.done && !clickedB.destroyed);
    game.markers.push({ x: wx, y: wy, t: game.time });

    const movers = sel.filter(u => !(u.kind === 'harvester' && (knownOre || refClick)));
    const targets = RS.units.formationTargets(movers, wx, wy);
    const gs = movers.length > 1 ? Math.min(...movers.map(u => u.speed)) : null; // 编队同速
    movers.forEach((u, k) => {
      if (u.kind === 'harvester') { u.cmd = 'move'; releaseClaims(u); }
      u.target = null; u.aggro = false; u.attackMove = null; // 普通移动必须清攻击移动,否则撤退变边打边进
      u.groupSpeed = gs;
      RS.units.setPath(u, targets[k].x, targets[k].y);
    });
    if (game.tutorial && movers.length) game.tutorial.flags.moved = true;

    for (const u of sel) {
      if (u.kind !== 'harvester') continue;
      if (knownOre) {
        u.cmd = null; u.path = null; u.manualIdle = false; // 点矿解除驻车
        u.waitingForScout = false;
        releaseClaims(u);
        u.target = { i: t.i, j: t.j };
        const ct = RS.map.at(t.i, t.j);
        if (ct) ct.claim = u; // 手动锁定矿格
        u.state = 'toOre';
      } else if (refClick) {
        u.cmd = null; u.path = null; u.manualIdle = false; // 点精炼厂 = 去卸矿(不是驻车)
        releaseClaims(u);
        u.target = null;
        u.state = 'toRefinery';
      }
    }
  }

  // ---------- 攻击指令 ----------
  function commandAttack(wx, wy) {
    // 战斗指令只认当前视野:历史探索过但此刻看不见的单位/建筑都不能隔雾锁定。
    const MW = RS.config.MAP_W, V = RS.map.visible;
    const visAt = (x, y) => !V || !!V[Math.floor(y) * MW + Math.floor(x)];
    let target = null, bd = 1.0;
    for (const u of game.units) {
      if (u.owner !== 'enemy' || u.hp <= 0) continue;
      if (!visAt(u.x, u.y)) continue;
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < bd) { bd = d; target = u; }
    }
    if (!target) {
      const b = pickBuildingAt(wx, wy);
      if (b && b.owner === 'enemy' && !b.destroyed && visAt(b.cx, b.cy)) target = b;
    }
    if (!target) return false;
    const fighters = [...game.selection].filter(u =>
      RS.combat.canAttackTarget(u, target));
    if (!fighters.length && RS.units.TYPES[target.kind] && RS.units.TYPES[target.kind].air) {
      game.notice = {
        text: tStr('空中目标：需火箭兵、战斗无人机或遗迹战甲；防御炮塔会自动拦截'),
        until: game.time + 3.5,
      };
      return true; // 吞掉点击,避免不能对空的单位反而向无人机脚下移动
    }
    if (!fighters.length) return false;
    recordMainAttack(fighters,
      target.cx !== undefined ? target.cx : target.x,
      target.cy !== undefined ? target.cy : target.y);
    RS.combat.attackCommand(fighters, target);
    game.markers.push({ x: wx, y: wy, t: game.time, kind: 'attack' });
    return true;
  }

  // ---------- 开火模式(H 键/面板按钮) ----------
  // 停火 = 只打点名目标:不站岗索敌、不还击、不协防(combat.js 三处豁免);
  // 显式指令(右键点名/攻击移动)不受影响。批量语义:全部已停火 → 全部恢复自由,否则全部停火。
  function toggleHoldFire() {
    const fighters = [...game.selection].filter(u => RS.units.TYPES[u.kind].dmg);
    if (!fighters.length) return null;
    const next = !fighters.every(u => u.holdFire);
    for (const u of fighters) u.holdFire = next;
    game.notice = {
      text: next ? tStr('停火：仅攻击点名目标（H 切换）') : tStr('自由开火：自动索敌与还击（H 切换）'),
      until: game.time + 3,
    };
    return next;
  }

  // ---------- 矿车行为 ----------
  // 卸矿口选择:朝向矿区、避开阻挡(被新建筑盖住时会重选)
  function pickDock(b) {
    const ore = nearestOreTile(b.cx, b.cy);
    const cands = [];
    for (let x = b.i; x < b.i + b.n; x++) cands.push([x, b.j - 1], [x, b.j + b.m]);
    for (let y = b.j; y < b.j + b.m; y++) cands.push([b.i - 1, y], [b.i + b.n, y]);
    let best = { x: b.cx, y: b.j - 0.5 }, bd = Infinity;
    for (let [x, y] of cands) {
      if (RS.map.isBlocked(x, y)) continue;
      const d = ore ? Math.hypot(x + 0.5 - ore.i, y + 0.5 - ore.j) : 0;
      if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
    return best;
  }

  function nearestOreTile(x, y) {
    let best = null, bd = Infinity;
    for (const t of RS.map.oreTiles) {
      if (RS.map.oreAt(t.i, t.j) <= 0) continue;
      const d = Math.hypot(t.i - x, t.j - y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function oreKnownTo(u, t) {
    if (!u) return true;
    const W = RS.config.MAP_W;
    if (u.owner === 'player') {
      const V = RS.map.visited;
      return !!(V && V[t.j * W + t.i]);
    }
    // 雾中对等审计:AI 矿车同走累积探索制(可用 config.storm.oreVisitedParity 回退)
    if (RS.config.storm.oreVisitedParity) {
      const V = RS.map.enemyVisited;
      return !!(V && V[t.j * W + t.i]);
    }
    return true;
  }

  function nearestOre(x, y, u, ignoreClaims) {
    let best = null, bd = Infinity;
    for (const t of RS.map.oreTiles) {
      if (RS.map.oreAt(t.i, t.j) <= 0) continue;
      if (!oreKnownTo(u, t)) continue; // 玩家矿车只认历史上已侦察过的矿脉
      if (u && !ignoreClaims) { // 矿格认领:别人锁定的不抢(防多矿车堆同一格)
        const ct = RS.map.at(t.i, t.j);
        if (ct && ct.claim && ct.claim !== u && ct.claim.hp > 0) continue;
      }
      const d = Math.hypot(t.i + 0.5 - x, t.j + 0.5 - y);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best && u && !ignoreClaims) return nearestOre(x, y, u, true); // 共享仍不得穿透未探索区
    return best;
  }

  // 释放某矿车的全部矿格认领(改令/驻车/死亡时调用)
  function releaseClaims(u) {
    for (const row of RS.map.tiles) for (const t of row) if (t.claim === u) t.claim = null;
  }

  function nearestDock(u) {
    let best = null, bd = Infinity;
    for (const b of game.buildings) {
      if (b.type !== 'refinery' || !b.done || b.destroyed || b.owner !== u.owner) continue;
      const dt2 = RS.iso.tileOf(b.dock.x, b.dock.y);
      if (RS.map.isBlocked(dt2.i, dt2.j)) b.dock = pickDock(b); // 卸矿口被新建筑盖住 → 重选
      const d = Math.hypot(b.dock.x - u.x, b.dock.y - u.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function updateHarvester(u, dt) {
    const H = RS.config.harvester;
    u.hvRetry = Math.max(0, (u.hvRetry || 0) - dt); // 寻路失败退避计时(不每帧全图 A*)

    if (u.cmd === 'move') {
      if (RS.units.moveAlongPath(u, dt)) { u.cmd = null; u.state = 'idle'; u.manualIdle = true; u.target = null; } // 手动驻车:不自动复工
      return;
    }

    switch (u.state) {
      case 'toOre': {
        if (!u.target || RS.map.oreAt(u.target.i, u.target.j) <= 0 ||
          !oreKnownTo(u, u.target)) {
          u.target = nearestOre(u.x, u.y, u); u.path = null;
          if (u.target) { const ct = RS.map.at(u.target.i, u.target.j); if (ct) ct.claim = u; } // 锁定矿格
        }
        if (!u.target) {
          u.waitingForScout = u.owner === 'player';
          u.state = 'idle';
          break;
        }
        u.waitingForScout = false;
        const tx = u.target.i + 0.5, ty = u.target.j + 0.5;
        if (Math.hypot(u.x - tx, u.y - ty) <= 1.6) { u.state = 'harvest'; u.timer = 0; u.path = null; break; }
        if (!u.path) {
          let gx = tx, gy = ty;
          if (RS.map.isBlocked(u.target.i, u.target.j)) { // 骸骨/晶簇所在格挡路 → 采它旁边
            const g = RS.units.nearestOpen(u.target.i, u.target.j);
            if (!g) break;
            gx = g.i + 0.5; gy = g.j + 0.5;
          }
          if (u.hvRetry > 0) break; // 退避中
          if (!RS.units.setPath(u, gx, gy)) {
            u.hvRetry = 1; u.hvFails = (u.hvFails || 0) + 1;
            if (u.hvFails >= 5) { u.hvFails = 0; releaseClaims(u); u.state = 'idle'; } // 连续失败:释格待命(自动复工兜底)
            break;
          }
          u.hvFails = 0;
        }
        if (RS.units.moveAlongPath(u, dt)) u.path = null; // 是否到采位下帧按距离判定
        break;
      }
      case 'harvest': {
        if (Math.hypot(u.x - (u.target.i + 0.5), u.y - (u.target.j + 0.5)) > 2) { u.state = 'toOre'; u.path = null; break; } // 防隔空采
        u.timer += dt;
        const t = RS.map.at(u.target.i, u.target.j);
        const take = Math.min(H.harvestRate * dt, H.capacity - u.load, t.ore);
        t.ore -= take; u.load += take;
        if (t.ore <= 0 && t.sp) { // 骸骨/晶簇采空 → 特殊物消失,恢复通行
          t.sp = null;
          RS.map.setBlocked(u.target.i, u.target.j, false);
        }
        if (t.ore <= 0) t.claim = null; // 采空释放认领
        if (u.load >= H.capacity - 1e-6 || t.ore <= 0) u.state = 'toRefinery';
        break;
      }
      case 'toRefinery': {
        if (!u.path) {
          const dockB = nearestDock(u);
          if (!dockB) { u.state = 'idle'; break; }
          u.dockB = dockB;
          if (u.hvRetry > 0) break; // 退避中
          if (!RS.units.setPath(u, dockB.dock.x, dockB.dock.y)) { u.hvRetry = 1; break; }
        }
        if (RS.units.moveAlongPath(u, dt)) { u.state = 'unload'; u.timer = 0; u.path = null; }
        break;
      }
      case 'unload': {
        if (u.dockB && u.dockB.destroyed) { u.dockB = null; u.state = 'toRefinery'; break; } // 厂没了不下矿,另找
        u.timer += dt;
        if (u.timer >= H.unloadTime) {
          const income = Math.round(u.load);
          walletForOwner(u.owner).money += income; // 按阵营入账
          if (u.owner === 'player') {
            game.stats.resourcesMined += income;
            recordEconomy();
          }
          u.trips++; u.load = 0; u.dockB = null;
          u.state = 'toOre';
          if (u.owner === 'player') sfx('unload');
        }
        break;
      }
      case 'idle': {
        if (u.manualIdle) break; // 玩家手动驻车,保持待命
        u.idleT = (u.idleT || 0) + dt;
        if (u.idleT >= 2) { // 精炼厂重建/出现新矿后自动复工(AI 经济不会暗死)
          u.idleT = 0;
          if (u.load > 0 && nearestDock(u)) u.state = 'toRefinery';
          else if (u.load <= 0 && nearestDock(u) && nearestOre(u.x, u.y, u)) {
            u.waitingForScout = false;
            u.state = 'toOre';
          } else if (u.owner === 'player' && u.load <= 0) u.waitingForScout = true;
        }
        break;
      }
    }
  }

  function recordEconomy() {
    if (!game.stats) return;
    game.stats.moneyPeak = Math.max(game.stats.moneyPeak, game.money);
    game.stats.moneyLow = Math.min(game.stats.moneyLow, game.money);
  }

  // 战役第二章只记录第一次由玩家主动发起的主力进攻；小股侦察或单兵点射不算主攻。
  function recordMainAttack(units, x, y) {
    const s = game.stats;
    if (!s || s.firstMainAttackTime !== null || !units || units.length < 3) return false;
    const combat = units.filter(u =>
      u && u.owner === 'player' && u.hp > 0 && RS.units.TYPES[u.kind] && RS.units.TYPES[u.kind].dmg);
    if (combat.length < 3) return false;
    const PB = RS.map.playerBase, AB = RS.map.aiBase;
    const px = PB.i + 0.5, py = PB.j + 0.5, ax = AB.i + 0.5, ay = AB.j + 0.5;
    const tx = Number.isFinite(x) ? x : combat[0].x;
    const ty = Number.isFinite(y) ? y : combat[0].y;
    if (Math.hypot(tx - ax, ty - ay) >= Math.hypot(tx - px, ty - py)) return false;
    s.firstMainAttackTime = game.time;
    return true;
  }

  function recordUnitDestroyed(u, attacker) {
    if (!game.stats || !u || u.statsDestroyed) return;
    u.statsDestroyed = true;
    if (u.owner === 'player') {
      game.stats.unitsLost++;
      game.stats.lostByKind[u.kind] = (game.stats.lostByKind[u.kind] || 0) + 1;
    }
    else if (attacker && attacker.owner === 'player') game.stats.unitsKilled++;
  }

  function recordBuildingDestroyed(b, attacker) {
    if (!game.stats || !b || b.statsDestroyed) return;
    b.statsDestroyed = true;
    if (b.owner === 'player') game.stats.buildingsLost++;
    else if (attacker && attacker.owner === 'player') game.stats.buildingsDestroyed++;
  }

  function finalizeStats() {
    const s = game.stats;
    if (!s || s.finalized) return;
    recordEconomy();
    s.finalized = true;
    s.duration = game.time;
    s.totalIncome = (s.resourcesMined || 0) + (s.passiveIncome || 0);
    const badges = [];
    if (s.unitsKilled >= 10) badges.push(tStr('战场清道夫'));
    if (s.buildingsDestroyed >= 3) badges.push(tStr('攻城先锋'));
    if (s.unitsKilled >= 5 && s.unitsLost === 0) badges.push(tStr('零损突击'));
    if (s.resourcesMined >= 5000) badges.push(tStr('矿业大亨'));
    if (s.unitsProduced >= 20) badges.push(tStr('钢铁洪流'));
    if (game.state === 'won' && game.time <= 15 * 60) badges.push(tStr('速战速决'));
    if (game.state === 'lost' && game.time >= 15 * 60) badges.push(tStr('不屈防线'));
    s.achievements = badges.slice(0, 3);
  }

  function finishGame(state) {
    game.state = state;
    finalizeStats();
    sfx(state === 'won' ? 'won' : 'lost');
  }

  // 胜负判定(设计稿:指挥中心被毁即败;同归于尽比家底,平则玩家胜) ----------
  let endCheckT = 0;
  function checkEnd() {
    if (game.state !== 'playing') return;
    const enemyCC = game.buildings.some(b => b.owner === 'enemy' && b.type === 'cc' && !b.destroyed);
    const playerCC = game.buildings.some(b => b.owner === 'player' && b.type === 'cc' && !b.destroyed);
    if (!enemyCC && !playerCC) {
      const eb = game.buildings.filter(b => b.owner === 'enemy' && !b.destroyed).length;
      const pb = game.buildings.filter(b => b.owner === 'player' && !b.destroyed).length;
      finishGame(eb > pb ? 'lost' : 'won');
    } else if (!enemyCC) finishGame('won');
    else if (!playerCC) finishGame('lost');
  }

  // ---------- 探索视野(小地图 + 战争迷雾,每 0.5s 刷新) ----------
  let exploreT = 0;
  function revealAt(wx, wy, r, V, N) {
    const ci = Math.round(wx), cj = Math.round(wy), MWv = RS.config.MAP_W, MHv = RS.config.MAP_H;
    for (let y = cj - r; y <= cj + r; y++)
      for (let x = ci - r; x <= ci + r; x++)
        if (x >= 0 && y >= 0 && x < MWv && y < MHv && Math.hypot(x - wx, y - wy) <= r) { V[y * MWv + x] = 1; N[y * MWv + x] = 1; }
  }
  function explore(dt) {
    exploreT -= dt;
    if (exploreT > 0) return;
    exploreT = 0.5;
    const V = RS.map.visited || (RS.map.visited = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H));
    const N = RS.map.visible || (RS.map.visible = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H));
    const E = RS.map.enemyVisible ||
      (RS.map.enemyVisible = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H));
    N.fill(0); // visible = 当前帧可见,每轮重算;visited = 历史已探索,累积
    E.fill(0); // AI 同样缓存当前视野，战斗层不做逐目标三重扫描
    const stormOn = !!(game.storm && game.storm.active), S = RS.config.storm;
    const EV = RS.map.enemyVisited || (RS.map.enemyVisited = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H)); // AI 侧累积探索(雾中对等审计)
    for (const u of game.units) {
      const type = RS.units.TYPES[u.kind];
      let sight = type.vision || (u.vehicle ? 7 : 6);
      if (stormOn) sight = type.vision ? Math.min(type.vision, 5) : S.visionUnit; // 沙暴钳制;无人机 8→5,机甲 5 豁免
      if (u.owner === 'player') revealAt(u.x, u.y, sight, V, N);
      else revealAt(u.x, u.y, sight, EV, E);
    }
    for (const b of game.buildings) {
      if (b.destroyed) continue;
      const bsight = stormOn ? S.visionBuilding : 9;
      if (b.owner === 'player') revealAt(b.cx, b.cy, bsight, V, N);
      else revealAt(b.cx, b.cy, bsight, EV, E);
    }
    game.enemyVisible = game.units.some(u =>
      u.owner === 'enemy' && u.hp > 0 && !!N[Math.floor(u.y) * RS.config.MAP_W + Math.floor(u.x)]);
    if (game.enemyVisible) game.enemyContactUntil = game.time + 8;
    RS.map.visitedRev = (RS.map.visitedRev || 0) + 1; // 小地图离屏缓存的失效信号(render 按修订号重画)
  }

  let lastLow = false;
  function update(dt) {
    if (game.state !== 'playing' || game.paused) return; // 暂停:逻辑冻结(渲染照常)
    recordEconomy();
    game.time += dt;
    if (game.storm) {
      updateStorm(dt); // 沙暴模式:T/T-60s/明牌/双倍伤/CC 流血全部并入状态机
    } else {
      game.suddenDeath = game.time >= 1500; // 25 分钟沙暴加剧:建筑受双倍伤害,终结龟缩
      if (!game.sdWarned && game.time >= 1470) { game.sdWarned = true; sfx('warn'); } // 沙暴预警
      if (game.time >= 1800) { // 30 分钟沙暴吞噬:指挥中心持续掉血,约 3 分钟内必然终结
        for (const b of game.buildings) {
          if (b.type !== 'cc' || b.destroyed) continue;
          b.hp -= (b.maxHp / 187) * dt; // 流血与 CC 血量联动:收尾恒 ~187s
          b.lastDamageT = game.time;
          if (b.hp <= 0) { b.hp = 0; RS.combat.destroyBuilding(b); }
        }
      }
    }
    if (!game.oreWarned && game.time > 60) { // 主矿将尽提示(该扩张了)
      const PB2 = RS.map.playerBase;
      let left = 0;
      for (const t of RS.map.oreTiles) if (Math.hypot(t.i - PB2.i, t.j - PB2.j) < 14) left += RS.map.oreAt(t.i, t.j);
      if (left < 1500) { game.oreWarned = true; sfx('warn'); }
    }
    explore(dt);
    updateTutorial();
    game.markers = game.markers.filter(m => game.time - m.t < 1);
    // 战痕老化淡出
    for (let k = game.scars.length - 1; k >= 0; k--) {
      game.scars[k].t += dt;
      if (game.scars[k].t >= game.scars[k].dur) game.scars.splice(k, 1);
    }

    const lowP = lowPower('player'), lowE = lowPower('enemy');
    if (lowP && !lastLow) sfx('warn'); // 低电警报只对玩家
    lastLow = lowP;

    // 精炼厂全灭警报:经济中断必须让玩家立刻知道(配合 HUD 红字,见 render)
    const hasRefP = game.buildings.some(b => b.owner === 'player' && b.type === 'refinery' && b.done && !b.destroyed);
    if (!hasRefP && game.hasRefP) sfx('warn');
    game.hasRefP = hasRefP;

    for (const b of game.buildings) {
      b.repairFxT = Math.max(0, (b.repairFxT || 0) - dt);
      b.selfRepairFxT = Math.max(0, (b.selfRepairFxT || 0) - dt);
      b.incomeFxT = Math.max(0, (b.incomeFxT || 0) - dt);
      const factor = (b.owner === 'enemy' ? lowE : lowP) ? RS.config.lowPowerFactor : 1; // 各自阵营算电力
      if (!b.done) {
        b.progress += dt * factor;
        if (b.progress >= b.def.buildTime) {
          b.done = true;
          if (b.def.givesHarvester) b.bonusHarvester = spawnHarvesterNear(b); // 双方精炼厂完工都送矿车
          if (b.owner === 'player') {
            game.stats.buildingsCompletedByType[b.type] =
              (game.stats.buildingsCompletedByType[b.type] || 0) + 1;
            sfx('build');
          }
        }
        continue;
      }
      // 指挥中心不接受维修车堆叠。脱战一段时间后才以极慢速度自修，沙暴加剧时停用。
      if (b.type === 'cc' && b.hp > 0 && b.hp < b.maxHp && !game.suddenDeath &&
        game.time - b.lastDamageT >= b.def.selfRepairDelay) {
        b.hp = Math.min(b.maxHp, b.hp + b.def.selfRepairRate * dt);
        b.selfRepairFxT = 0.16;
      }
      if (b.type === 'deepMine') updateDeepMine(b, dt, !(b.owner === 'enemy' ? lowE : lowP));
      if (b.queue.length) {
        b.prodProgress += dt * factor;
        const need = RS.units.TYPES[b.queue[0]].buildTime;
        if (b.prodProgress >= need) {
          b.prodProgress = 0;
          spawnUnit(b, b.queue.shift());
        }
      }
    }

    for (const d of game.derelicts) d.repairFxT = Math.max(0, (d.repairFxT || 0) - dt);
    for (const u of game.units) {
      u.repairFxT = Math.max(0, (u.repairFxT || 0) - dt);
      // 卡住自愈:1 秒无净位移且仍在赶路 → 弃路重寻(A* 会绕开)
      u.posT = (u.posT || 0) + dt;
      if (u.posT >= 1) {
        if (u.path && u.lastPos && Math.hypot(u.x - u.lastPos.x, u.y - u.lastPos.y) < 0.25) u.path = null;
        u.lastPos = { x: u.x, y: u.y }; u.posT = 0;
      }
      if (u.kind === 'harvester') { updateHarvester(u, dt); continue; }
      // 攻击移动与 aggro 追击的移动统一在 combat.update(否则一帧动两次 = 双倍速)
      if (u.path && !u.attackMove && !(u.aggro && u.target)) {
        if (RS.units.moveAlongPath(u, dt)) u.post = { x: u.x, y: u.y }; // 走完记哨位
      }
      else if (u.dest && !u.target && !u.attackMove) {
        u.repathT = (u.repathT || 0) - dt;
        if (u.repathT <= 0) {
          u.repathT = 0.5;
          u.repaths = (u.repaths || 0) + 1;
          if (RS.units.setPath(u, u.dest.x, u.dest.y)) u.repaths = 0;
          else if (u.repaths > 10) { u.dest = null; u.repaths = 0; }
        }
      }
      // 维修车:自动修复范围内最虚弱的友军车辆/已完工建筑;车辆按耐久缩放,
      // 避免低血火炮被固定 15 点/秒瞬间灌满。坠毁无人机仍按 15 点/秒回收。
      if (u.kind === 'repair') {
        const rep = RS.units.TYPES.repair;
        const range = rep.repairRange || 4;
        const targetPos = t => t.cx !== undefined ? { x: t.cx, y: t.cy } : t;
        u.repT = (u.repT || 0) - dt;
        if (u.repT <= 0) {
          u.repT = 0.5;
          let best = null, worst = 1, bestDist = Infinity;
          const consider = target => {
            const p = targetPos(target);
            const dist = Math.hypot(p.x - u.x, p.y - u.y);
            if (dist > range) return;
            const ratio = target.hp / target.maxHp;
            if (ratio < worst || (ratio === worst && dist < bestDist)) {
              worst = ratio; bestDist = dist; best = target;
            }
          };
          for (const v of game.units) {
            if (v.owner !== u.owner || !v.vehicle || v === u || v.hp >= v.maxHp || v.hp <= 0) continue; // 满血/尸体都不选
            consider(v);
          }
          for (const b of game.buildings) {
            if (b.owner !== u.owner || b.type === 'cc' || !b.done || b.destroyed ||
              b.hp >= b.maxHp || b.hp <= 0) continue;
            consider(b);
          }
          for (const d of game.derelicts) {
            if (d.hp < d.maxHp) consider(d);
          }
          u.repTarget = best;
        }
        if (u.repTarget) {
          const p = targetPos(u.repTarget);
          if (u.repTarget.type === 'cc' ||
            (!u.repTarget.isDerelict && !u.repTarget.isRelic && u.repTarget.hp <= 0) || u.repTarget.destroyed ||
            u.repTarget.hp >= u.repTarget.maxHp || Math.hypot(p.x - u.x, p.y - u.y) > range)
            u.repTarget = null; // 不治尸体;坠毁无人机/遗迹 hp 恒 0 起步,豁免
        }
        if (u.repTarget && u.repTarget.isRelic) {
          // 遗迹:双方各自修理池,按引导秒累计;先满者激活(沙暴模式)
          const r = u.repTarget;
          if (r.activated || r.pools[u.owner] === undefined) u.repTarget = null;
          else {
            r.pools[u.owner] += dt;
            r.lastRepairT[u.owner] = game.time;
            r.repairFxT = 0.16;
            if (r.pools[u.owner] >= RS.config.storm.repairSeconds) activateRelic(u.owner);
          }
        } else if (u.repTarget) {
          const rate = u.repTarget.isDerelict ? rep.repairDerelictRate
            : u.repTarget.cx !== undefined ? rep.repairBuildingRate
              : Math.min(rep.repairVehicleCap,
                rep.repairVehicleFlat + u.repTarget.maxHp * rep.repairVehiclePct);
          u.repTarget.hp = Math.min(u.repTarget.maxHp, u.repTarget.hp + rate * dt);
          u.repTarget.repairFxT = 0.16;
          if (u.repTarget.isDerelict && u.repTarget.hp >= u.repTarget.maxHp) {
            // 坠毁无人机修复完成 → 变成独立空中单位,残骸消失恢复通行。
            const dt2 = RS.iso.tileOf(u.repTarget.x, u.repTarget.y);
            RS.map.setBlocked(dt2.i, dt2.j, false);
            spawnUnitAt('drone', u.repTarget.x, u.repTarget.y, u.owner);
            game.derelicts.splice(game.derelicts.indexOf(u.repTarget), 1);
            RS.combat.explosions.push({ x: u.repTarget.x, y: u.repTarget.y, t: 0, dur: 0.5, r: 16 });
            u.repTarget = null;
            sfx('build');
          }
        }
      }
    }

    // 紧急矿车:有可用精炼厂但矿车绝种满 45 秒 → 补一辆(防经济死锁;双方同规则,
    // 骚扰仍有意义——45 秒断粮 + 新车还要再活下来)
    for (const owner of ['player', 'enemy']) {
      const hasRef = game.buildings.some(b => b.owner === owner && b.type === 'refinery' && b.done && !b.destroyed);
      const hasHv = game.units.some(u => u.owner === owner && u.kind === 'harvester');
      if (hasRef && !hasHv) {
        game.hvTimer[owner] = (game.hvTimer[owner] || 0) + dt;
        if (game.hvTimer[owner] >= 45) {
          const ok = spawnHarvesterNear(game.buildings.find(b => b.owner === owner && b.type === 'refinery' && b.done && !b.destroyed));
          game.hvTimer[owner] = ok ? 0 : 40; // 出生点被堵:5s 后重试,不白等 45s
        }
      } else game.hvTimer[owner] = 0;
    }

    if (RS.ai) RS.ai.update(dt);
    RS.combat.update(dt);
    RS.units.applySoftSeparation(game.units, dt);
    recordEconomy();
    if (RS.audio && RS.audio.update) RS.audio.update(dt, game);

    endCheckT -= dt;
    if (endCheckT <= 0) { endCheckT = 1; checkEnd(); }
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

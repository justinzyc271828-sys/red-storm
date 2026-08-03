/* AI 对手(DOM 无关):真实经济 + 建造/重建 + 波次进攻。
 * 公平基线(与玩家同一套规则):
 *   - 无固定工资,收入只来自矿车卸矿;精炼厂/矿车被打 = 经济真断;
 *   - 电力、建造速度、生产速度、单位数值与玩家完全一致;
 *   - 开局资产镜像玩家(指挥中心+精炼厂+1 矿车+3 步兵+2 火箭兵+1000 金)。
 * 难度 = 纯行为差异(何时打、打哪里、反应多快):
 *   简单 = 慢且直(只冲指挥中心);
 *   普通 = 节奏加快,前两波打精炼厂掐经济;
 *   困难 = 快攻 + 猎杀可见矿车 + 威胁守家 + 反击拳 + 侦察驱动的克制编组。
 * 情报规则:建筑要被 AI 单位见过才进目标库(建筑不移动,记忆合法);
 *   矿车只打当前可见的;指挥中心位置按遭遇战惯例开局已知。 */
(function (RS) {
  'use strict';

  const DIFF = {
    easy:   { firstWave: 240, interval: 300, hunter: 0, counterPunch: false, smart: false, allInAt: 1200, buildPace: 1.4, defendThreat: 40, armyBase: 6,  armyEvery: 20, armyMax: 18,  guardEarly: 6,  guardLate: 4 },
    normal: { firstWave: 300, interval: 180, hunter: 1, counterPunch: false, smart: false, allInAt: 1000, buildPace: 1.0, defendThreat: 20, armyBase: 8,  armyEvery: 5.5, armyMax: 56,  guardEarly: 8,  guardLate: 6 },
    hard:   { firstWave: 330, interval: 165, hunter: 2, counterPunch: false, smart: true,  allInAt: 720,  buildPace: 0.7, defendThreat: 8,  armyBase: 10, armyEvery: 5,  armyMax: 100, guardEarly: 24, guardLate: 8 },
  };

  // 剧情第三章的固定战术预设。只在载入时选一次，doctrineAt 不再读取玩家当前编成。
  const CAMPAIGN_PROFILES = {
    balanced: {
      early: ['rocket', 'rocket', 'infantry', 'flametank', 'lightTank'],
      late: ['rocket', 'lightTank', 'rocket', 'heavyTank', 'artillery'],
    },
    antiRush: {
      diff: { guardEarly: 34, guardLate: 12, allInAt: 840 },
      early: ['infantry', 'rocket', 'flametank', 'lightTank', 'rocket'],
      late: ['rocket', 'lightTank', 'flametank', 'heavyTank', 'artillery'],
    },
    antiInfantry: {
      early: ['flametank', 'rocket', 'flametank', 'infantry', 'lightTank'],
      late: ['flametank', 'rocket', 'flametank', 'heavyTank', 'artillery'],
    },
    antiArmor: {
      early: ['rocket', 'rocket', 'infantry', 'lightTank', 'rocket'],
      late: ['rocket', 'artillery', 'rocket', 'heavyTank', 'artillery'],
    },
    antiTurtle: {
      diff: { firstWave: 270, interval: 135, allInAt: 600, guardEarly: 18, guardLate: 6 },
      early: ['rocket', 'lightTank', 'artillery', 'infantry', 'rocket'],
      late: ['artillery', 'rocket', 'heavyTank', 'artillery', 'repair'],
    },
  };

  // 波次规模 = 实际发兵人数目标;发兵门槛 = min(规模, 12)(见 update 发兵口)
  function waveSizeOf(diff, n) {
    if (diff.smart) return Math.min(34, 14 + n * 3);
    if (diff.hunter >= 1) return Math.min(14, Math.round(4 + n * 1.5));
    return Math.min(8, 3 + n);
  }

  // 定点发展脚本(di/dj 相对敌方基地;被占会环形找替代点,不会硬跳过;only 限定难度)
  // 第二兵营 t=130 为 normal 专属:经济对等修复(P1-03)后 normal 的瓶颈是产能,
  // 双兵营开顶住 7 分钟快攻窗口;hard 的瓶颈是配钱不是产能(2026-07-25 复测证实:
  // hard 双兵营反而更弱,bot-match 3/7→6/4,已回滚——历史注释 11/9→2/8 在现数值面仍成立)
  const BUILD_ORDER = [
    { t: 10,  type: 'power',    di: 5,  dj: -4 },
    { t: 40,  type: 'barracks', di: -5, dj: -2 },
    { t: 100, type: 'factory',  di: -1, dj: 5 },
    { t: 130, type: 'barracks', di: -7, dj: 1, only: ['normal'] },
    { t: 160, type: 'power',    di: 5,  dj: 1 },
    { t: 300, type: 'refinery', di: -6, dj: 5 },
    { t: 420, type: 'turret',   di: -3, dj: 7 },
    { t: 600, type: 'turret',   di: 6,  dj: 4 },
  ];

  // 重建底线:[类型, 最低数量, 该时间(×节奏)之后才补]
  const MINIMUMS = [
    ['refinery', 1, 60], ['power', 2, 170], ['barracks', 1, 60], ['factory', 1, 150],
  ];

  const ai = RS.ai = {
    wallet: { money: 1000 }, active: false, diff: null, profile: null,
    waveIndex: 0, nextWaveAt: 0,
    staging: { x: 95.5, y: 40.5 },
    known: new Set(),
    knownDerelicts: new Set(),
    init, update,
    planDroneRaidPath,
    onStormWarn, onStormActive, onRelicRevealed, onMechActivated, // 沙暴模式钩子(game.js 状态机回调)
  };
  let buildIdx = 0, prodCycle = 0, tick = 0;
  const R = () => (RS.rnd ? RS.rnd() : Math.random()); // 可复现随机流

  function init(difficulty, opts) {
    ai.diff = Object.assign({}, DIFF[difficulty] || DIFF.normal); // 浅拷贝:不污染共享 DIFF 表
    ai.diff.name = difficulty;
    ai.profile = opts && CAMPAIGN_PROFILES[opts.profile] ? opts.profile : null;
    if (ai.profile && CAMPAIGN_PROFILES[ai.profile].diff)
      Object.assign(ai.diff, CAMPAIGN_PROFILES[ai.profile].diff);
    ai.wallet = { money: RS.config.startMoney };
    ai.active = true;
    ai.waveIndex = 0;
    ai.nextWaveAt = ai.diff.firstWave * (0.9 + R() * 0.2); // 波次零随机=打卡,±10% 抖动
    ai.staging = { x: RS.map.aiBase.i - 2.5, y: RS.map.aiBase.j + 10.5 };
    // 战术状态全部重置,不把上一局带进这一局
    ai.known = new Set();
    ai.knownDerelicts = new Set();
    const pcc = RS.game.buildings.find(b => b.owner === 'player' && b.type === 'cc');
    if (pcc) ai.known.add(pcc); // 遭遇战惯例:开局互知指挥中心方位
    ai.wasInvaded = false; ai.repelled = false; ai.playerAttacked = false;
    ai.cpCoolUntil = 0; ai.rpCoolUntil = 0; ai.allInFired = false; ai.scoutCoolUntil = 0;
    ai.atkSerial = 0; ai.warnedSerial = 0; // 攻击序列号:只有正式进攻(波次/反击拳)打标,警报只看打标单位
    buildIdx = 0; prodCycle = 0; tick = 0;
    ai.order = BUILD_ORDER.filter(e => !e.only || e.only.includes(difficulty)); // 难度专属脚本项
    ai.relicScoutSent = false; ai.relicPauseUntil = 0; ai.relicDutyCount = 0; // 沙暴遗迹争夺状态
  }

  const T = k => RS.units.TYPES[k];
  const isCombat = u => !!T(u.kind).dmg;

  // ---------- 情报 ----------
  // 视野与玩家完全对等(车辆 7 / 步兵 6 / 建筑 9),不吃信息红利;
  // 沙暴模式:与 game.js explore() 同一钳制值(雾中对等审计,无人机/机甲按 TYPES vision 豁免)
  function visibleToEnemy(x, y) {
    const G = RS.game, stormOn = !!(G.storm && G.storm.active), S = RS.config.storm;
    for (const u of G.units) {
      if (u.owner !== 'enemy') continue;
      const v = T(u.kind).vision;
      const r = stormOn ? (v ? Math.min(v, 5) : S.visionUnit) : (u.vehicle ? 7 : 6);
      if (Math.hypot(u.x - x, u.y - y) < r) return true;
    }
    for (const b of G.buildings)
      if (b.owner === 'enemy' && !b.destroyed && Math.hypot(b.cx - x, b.cy - y) < (stormOn ? S.visionBuilding : 9)) return true;
    return false;
  }
  function updateIntel() {
    for (const b of RS.game.buildings)
      if (b.owner === 'player' && !b.destroyed && visibleToEnemy(b.cx, b.cy)) ai.known.add(b);
    for (const b of ai.known) if (b.destroyed) ai.known.delete(b);
    for (const d of RS.game.derelicts)
      if (visibleToEnemy(d.x, d.y)) ai.knownDerelicts.add(d);
    for (const d of ai.knownDerelicts)
      if (!RS.game.derelicts.includes(d)) ai.knownDerelicts.delete(d);
  }
  // 已知建筑里选最优:离集结点近 + 血量低
  function bestKnown(filter) {
    let best = null, bs = Infinity;
    for (const b of ai.known) {
      if (b.destroyed || !filter(b)) continue;
      const score = Math.hypot(b.cx - ai.staging.x, b.cy - ai.staging.y) + 40 * (b.hp / b.maxHp);
      if (score < bs) { bs = score; best = b; }
    }
    return best;
  }
  function playerCCTarget() {
    const cc = RS.game.buildings.find(b => b.owner === 'player' && b.type === 'cc' && !b.destroyed);
    if (cc) return { x: cc.cx, y: cc.cy };
    const PB = RS.map.playerBase;
    return { x: PB.i + 1.5, y: PB.j + 3.5 };
  }

  function bestKnownEconomy(from) {
    const priority = { deepMine: 4, refinery: 3, power: 2.5 };
    const ox = from ? from.x : ai.staging.x;
    const oy = from ? from.y : ai.staging.y;
    let best = null, bs = Infinity;
    for (const b of ai.known) {
      const p = priority[b.type] || 0;
      if (!p || b.destroyed) continue;
      const score = Math.hypot(b.cx - ox, b.cy - oy) / p +
        18 * (b.hp / b.maxHp);
      if (score < bs) { bs = score; best = b; }
    }
    return best;
  }

  // ---------- 生产 doctrine ----------
  // 困难:按可见的玩家兵种构成出克制兵种(侦察驱动,不是固定配方);
  // 前期一律火箭+轻坦(性价比最高的拳头),600 秒后才上重装备
  function smartSeq() {
    let inf = 0, veh = 0;
    for (const u of RS.game.units) {
      if (u.owner !== 'player' || !isCombat(u)) continue;
      if (!visibleToEnemy(u.x, u.y)) continue;
      if (u.vehicle) veh++; else inf++;
    }
    if (inf >= 8 && inf >= veh * 1.5) return ['flametank', 'flametank', 'rocket', 'lightTank']; // 步兵海 → 立刻喷火,不等后期
    if (RS.game.time < 600) return ['rocket', 'rocket', 'infantry', 'flametank', 'rocket', 'lightTank']; // hard 加强 R2-3:火箭双向件 1/2(反甲×2+对步不弱),火焰 1/6 保底
    if (inf >= Math.max(4, veh * 1.5)) return ['flametank', 'rocket', 'flametank', 'heavyTank']; // 步兵占优 → 喷火
    if (veh >= Math.max(4, inf * 2)) return ['rocket', 'rocket', 'lightTank', 'heavyTank'];       // 车辆海 → 火箭
    return ['rocket', 'lightTank', 'rocket', 'heavyTank'];
  }
  // 普通难度也反步兵海(看见 ≥8 且占绝对多数 → 出一半喷火)
  function blobVisible() {
    let inf = 0, veh = 0;
    for (const u of RS.game.units) {
      if (u.owner !== 'player' || !isCombat(u)) continue;
      if (!visibleToEnemy(u.x, u.y)) continue;
      if (u.vehicle) veh++; else inf++;
    }
    return inf >= 8 && inf >= veh * 1.5;
  }
  function doctrineAt(k, t) {
    // 沙暴分支(2026-07-25):3 格视野下火炮是废铁,转火箭/喷火主力
    if (RS.game.storm && RS.game.storm.active) {
      const seq = ['rocket', 'infantry', 'flametank', 'rocket', 'lightTank'];
      return seq[k % seq.length];
    }
    if (ai.profile) {
      const fixed = CAMPAIGN_PROFILES[ai.profile];
      const seq = t < 600 ? fixed.early : fixed.late;
      return seq[k % seq.length];
    }
    if (!ai.diff.smart && ai.diff.hunter >= 1 && blobVisible()) return k % 2 ? 'flametank' : 'rocket';
    let seq;
    if (ai.diff.smart) seq = smartSeq();
    else if (t < 300) seq = ['rocket', 'infantry', 'lightTank', 'flametank']; // 前期即含轻坦+1/4 喷火保底(反 all-in,2026-07-25 治理)
    else if (t < 720) seq = ['lightTank', 'rocket', 'infantry'];
    else seq = ['heavyTank', 'lightTank', 'rocket'];
    let kind = seq[k % seq.length];
    if (ai.diff.hunter >= 1 && t > 300 && k % 5 === 4) kind = 'flametank'; // 常备喷火 hedge(反步兵海保底)
    if (t > 720 && k % 4 === 3) kind = 'artillery'; // 后期穿插攻城(2026-07-25 起 easy 也配:否则 easy 无攻城手段,龟缩局只能拖闹钟)
    if (ai.diff.smart && t > 600 && k % 8 === 6) kind = 'repair';          // 困难带维修车
    return kind;
  }
  // 从序列里挑这座建筑能生产的第一项(兵营/工厂各产各的,不会互相卡死)
  function pickFor(b, t) {
    if (ai.diff.smart && b.type === 'factory' && t >= 240) {
      const hasSiege = RS.game.units.some(u =>
        u.owner === 'enemy' && u.kind === 'artillery' && u.hp > 0) ||
        RS.game.buildings.some(x =>
          x.owner === 'enemy' && x.queue && x.queue.includes('artillery'));
      if (!hasSiege) return 'artillery'; // 困难至少保有一门远程火炮，惩罚无脑远程兵海
    }
    for (let o = 0; o < 8; o++) {
      const kind = doctrineAt(prodCycle + o, t);
      // 可产且买得起才选:高价 doctrine 项(如喷火)不再卡死队列,顺延到买得起的项
      if (b.def.produces.includes(kind) && ai.wallet.money >= T(kind).cost) return kind;
    }
    return null;
  }

  // ---------- 建造 ----------
  function tryBuild(type, di, dj) {
    const def = RS.config.buildings[type];
    if (ai.wallet.money < def.cost) return false;
    const AB = RS.map.aiBase;
    const spot = RS.game.findBuildSpot(type, AB.i + (di || 0), AB.j + (dj || 0), 'enemy', 10);
    if (!spot) return false;
    ai.wallet.money -= def.cost;
    RS.game.placeStructure(type, spot.i, spot.j, 'enemy', false);
    return true;
  }
  const countDone = type =>
    RS.game.buildings.filter(b => b.owner === 'enemy' && b.type === type && b.done && !b.destroyed).length;
  function rebuildNeed(t) {
    for (const [type, min, at] of MINIMUMS)
      if (t >= at * ai.diff.buildPace && countDone(type) < min) return type;
    return null;
  }

  // ---------- 打击目标 ----------
  function nearestVisibleHarvester() {
    let best = null, bd = Infinity;
    for (const u of RS.game.units) {
      if (u.owner !== 'player' || u.kind !== 'harvester') continue;
      if (!visibleToEnemy(u.x, u.y)) continue;
      const d = Math.hypot(u.x - ai.staging.x, u.y - ai.staging.y);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }
  function waveTarget(n) {
    if (ai.diff.hunter >= 2) {
      const deep = bestKnown(b => b.type === 'deepMine');
      if (deep) return { x: deep.cx, y: deep.cy };
      const hv = nearestVisibleHarvester(); // 猎杀可见矿车(掐采矿命脉)
      if (hv) return { x: hv.x, y: hv.y, hunt: hv };
      const eco = bestKnown(b => b.type === 'refinery' || b.type === 'power');
      if (eco) return { x: eco.cx, y: eco.cy };
      const prod = bestKnown(b => b.def.produces);
      if (prod) return { x: prod.cx, y: prod.cy };
    }
    if (ai.diff.hunter >= 1 && n < 2) { // 普通前两波打精炼厂
      const ref = bestKnown(b => b.type === 'deepMine' || b.type === 'refinery');
      if (ref) return { x: ref.cx, y: ref.cy };
    }
    return playerCCTarget();
  }

  function queuedCount(kind) {
    return RS.game.buildings.reduce((sum, b) =>
      sum + (b.owner === 'enemy' && b.queue ? b.queue.filter(k => k === kind).length : 0), 0);
  }

  function queueFactoryKind(kind) {
    const factory = RS.game.buildings.find(b =>
      b.owner === 'enemy' && b.type === 'factory' && b.done && !b.destroyed &&
      b.queue.length < 2 && b.def.produces.includes(kind));
    return !!(factory && ai.wallet.money >= T(kind).cost && RS.game.enqueueUnit(factory, kind));
  }

  function manageDeepEconomy() {
    const G = RS.game;
    const minYield = RS.config.deepEconomy.tierPayout[1] *
      (60 / RS.config.deepEconomy.incomeTick);
    const rigs = G.units.filter(u => u.owner === 'enemy' && u.kind === 'drillRig' && u.hp > 0);
    for (const u of rigs) {
      const status = G.deepMineStatus(u);
      if (status.valid) {
        G.deployDrillRig(u);
        continue;
      }
      if (!u.drillSite)
        u.drillSite = G.findDeepMineSite('enemy', u.x, u.y, minYield);
      if (!u.drillSite) continue;
      const d = Math.hypot(u.x - u.drillSite.x, u.y - u.drillSite.y);
      if (d < 1.2) {
        u.drillSite = null; // 位置被临时堵住时重新找，不在原地永久罚站
        continue;
      }
      if (!u.path || !u.dest ||
        Math.hypot(u.dest.x - u.drillSite.x, u.dest.y - u.drillSite.y) > 1)
        RS.units.setPath(u, u.drillSite.x, u.drillSite.y);
    }

    const mines = G.buildings.filter(b =>
      b.owner === 'enemy' && b.type === 'deepMine' && !b.destroyed).length;
    if (mines >= RS.config.deepEconomy.maxPerOwner || rigs.length || queuedCount('drillRig')) return;
    const site = G.findDeepMineSite('enemy', undefined, undefined, minYield);
    // AI 不按时间表白送钱：至少等矿区自然进入二档收益，才投入 900 资源。
    if (site && queueFactoryKind('drillRig')) prodCycle++;
  }

  function manageDerelictSalvage() {
    const G = RS.game;
    const wrecks = [...ai.knownDerelicts];
    if (!wrecks.length) return;
    const repairs = G.units.filter(u => u.owner === 'enemy' && u.kind === 'repair' && u.hp > 0);
    if (!repairs.length && !queuedCount('repair')) {
      if (queueFactoryKind('repair')) prodCycle++;
      return;
    }
    for (const u of repairs) {
      if (u.repTarget || u.relicDuty) continue; // relicDuty:遗迹抢修任务优先于残骸回收
      let best = null, bd = Infinity;
      for (const d of wrecks) {
        const dist = Math.hypot(d.x - u.x, d.y - u.y);
        if (dist < bd) { bd = dist; best = d; }
      }
      if (!best || bd <= T('repair').repairRange - 0.5) continue;
      if (!u.salvageTarget || u.salvageTarget !== best || !u.path) {
        u.salvageTarget = best;
        RS.units.setPath(u, best.x, best.y);
      }
    }
  }

  // ---------- 沙暴模式钩子与遗迹争夺(2026-07-25 设计 v3) ----------
  function onStormWarn() {
    const G = RS.game, S = RS.config.storm;
    // 波次让路:T±45s 内将发的下一波延迟 60s(双方对等预移动窗)
    if (Math.abs(ai.nextWaveAt - G.storm.t) <= S.waveDelayBuffer) ai.nextWaveAt += S.waveDelay;
  }

  function onStormActive() {
    // 主力向指挥中心预移动(不在沙暴里裸站中场);机甲不受调动
    const ecc = RS.game.buildings.find(b => b.owner === 'enemy' && b.type === 'cc' && !b.destroyed);
    if (!ecc) return;
    for (const u of RS.game.units) {
      if (u.owner !== 'enemy' || !isCombat(u) || u.kind === 'mech') continue;
      RS.units.setPath(u, ecc.cx + (RS.rnd() * 8 - 4), ecc.cy + (RS.rnd() * 8 - 4));
    }
  }

  function onRelicRevealed() {} // 派遣在 manageRelicContest 每 tick 管理
  function onMechActivated() {} // 机甲由波次/守家逻辑自然接管

  // 遗迹争夺:明牌前派侦察,明牌后护送抢修;值班维修车死亡 → 停派 60s(死亡学习)
  function manageRelicContest() {
    const G = RS.game, st = G.storm;
    if (!st || !st.active || !st.relic || st.relic.activated) return;
    if (ai.diff.name === 'easy') return; // easy 不争夺,保持可学
    const r = st.relic;
    if (!r.revealed) {
      if (!ai.relicScoutSent) {
        ai.relicScoutSent = true;
        const scouts = G.units.filter(u => u.owner === 'enemy' && isCombat(u) && !u.attackMove && !u.target);
        scouts.sort((a, b) => T(b.kind).speed - T(a.kind).speed);
        if (scouts[0]) RS.units.setPath(scouts[0], r.x, r.y);
      }
      return;
    }
    // 死亡学习:值班维修车变少 → 停派 60s(不再无脑送修,顺手治理 salvage 放血)
    const onDuty = G.units.filter(u => u.owner === 'enemy' && u.kind === 'repair' && u.hp > 0 && u.relicDuty).length;
    if (onDuty < (ai.relicDutyCount || 0)) ai.relicPauseUntil = G.time + 60;
    ai.relicDutyCount = onDuty;
    if (G.time < (ai.relicPauseUntil || 0)) return;
    if (G.units.some(u => u.owner === 'enemy' && u.kind === 'repair' && u.hp > 0 &&
      Math.hypot(u.x - r.x, u.y - r.y) < 12)) return; // 已有维修车在场
    const u = G.units.find(x => x.owner === 'enemy' && x.kind === 'repair' && x.hp > 0 && !x.relicDuty);
    if (!u) {
      if (!queuedCount('repair') && queueFactoryKind('repair')) prodCycle++;
      return;
    }
    u.relicDuty = true;
    RS.units.setPath(u, r.x + 1.5, r.y + 1.5);
    const escorts = G.units.filter(v => v.owner === 'enemy' && isCombat(v) && !v.attackMove && !v.target && !v.retreat).slice(0, 6);
    if (escorts.length) RS.combat.attackMoveGroup(escorts, r.x, r.y);
  }

  function segmentPointDistance(a, b, p) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const ll = dx * dx + dy * dy;
    const q = ll ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / ll)) : 0;
    return Math.hypot(p.x - (a.x + dx * q), p.y - (a.y + dy * q));
  }

  // 防空威胁只读取 AI 已侦察到的炮塔和当前可见的对空单位，不借路线规划开天眼。
  function droneThreats() {
    const threats = [];
    for (const b of ai.known) {
      if (b.type !== 'turret' || b.destroyed || !b.done) continue;
      const w = b.def.weapon;
      threats.push({ x: b.cx, y: b.cy, radius: w.range + 1.5, weight: w.dmg * w.rof });
    }
    for (const u of RS.game.units) {
      if (u.owner !== 'player' || u.hp <= 0 || u.kind === 'drone' || !visibleToEnemy(u.x, u.y)) continue;
      const w = T(u.kind);
      if (!w.dmg || !w.canHitAir) continue;
      threats.push({ x: u.x, y: u.y, radius: w.range + 1.25, weight: w.dmg * (w.rof || 1) });
    }
    return threats;
  }

  function droneRouteScore(start, path, threats) {
    let score = 0, a = start;
    for (const b of path) {
      score += Math.hypot(b.x - a.x, b.y - a.y);
      for (const t of threats) {
        const d = segmentPointDistance(a, b, t);
        if (d < t.radius)
          score += (t.radius - d + 1) * (90 + t.weight * 5);
      }
      a = b;
    }
    return score;
  }

  // 空中单位仍能直飞；这里只给敌方袭扰无人机挑一条低风险折线。
  // 直线安全时不绕远，防空带挡路时比较左右两侧与逐威胁绕行候选。
  function planDroneRaidPath(u, target) {
    const goal = {
      x: target.cx !== undefined ? target.cx : target.x,
      y: target.cy !== undefined ? target.cy : target.y,
    };
    const start = { x: u.x, y: u.y };
    const threats = droneThreats();
    const dx = goal.x - start.x, dy = goal.y - start.y;
    const len = Math.hypot(dx, dy);
    if (!len || !threats.length) return [goal];
    const nx = -dy / len, ny = dx / len;
    const crossed = threats.filter(t => segmentPointDistance(start, goal, t) < t.radius + 0.5);
    if (!crossed.length) return [goal];
    crossed.sort((a, b) =>
      ((a.x - start.x) * dx + (a.y - start.y) * dy) -
      ((b.x - start.x) * dx + (b.y - start.y) * dy));
    const clamp = p => ({
      x: Math.max(1, Math.min(RS.config.MAP_W - 1, p.x)),
      y: Math.max(1, Math.min(RS.config.MAP_H - 1, p.y)),
    });
    const candidates = [[goal]];
    for (const t of crossed)
      for (const sign of [-1, 1])
        candidates.push([clamp({
          x: t.x + nx * (t.radius + 1.5) * sign,
          y: t.y + ny * (t.radius + 1.5) * sign,
        }), goal]);
    for (const sign of [-1, 1]) {
      const path = crossed.map(t => clamp({
        x: t.x + nx * (t.radius + 1.5) * sign,
        y: t.y + ny * (t.radius + 1.5) * sign,
      }));
      path.push(goal);
      candidates.push(path);
    }
    let best = candidates[0], bs = droneRouteScore(start, best, threats);
    for (let k = 1; k < candidates.length; k++) {
      const s = droneRouteScore(start, candidates[k], threats);
      if (s < bs) { bs = s; best = candidates[k]; }
    }
    return best;
  }

  function bestDroneRaidTarget(u) {
    const economy = bestKnownEconomy(u);
    if (economy) return economy;
    let best = null, bs = Infinity;
    for (const v of RS.game.units) {
      if (v.owner !== 'player' || v.hp <= 0 || !visibleToEnemy(v.x, v.y)) continue;
      // 无经济目标时追坦克/普通步兵/敌方无人机；火箭兵与战甲是规避对象。
      if (v.kind === 'rocket' || v.kind === 'mech' ||
        v.kind === 'repair' || v.kind === 'drillRig') continue;
      if (v.kind !== 'infantry' && v.kind !== 'drone' && v.kind !== 'harvester' && !v.vehicle) continue;
      const priority = v.kind === 'harvester' ? 3 : v.kind === 'drone' ? 1.4 : 2;
      const score = Math.hypot(v.x - u.x, v.y - u.y) / priority +
        8 * (v.hp / v.maxHp);
      if (score < bs) { bs = score; best = v; }
    }
    return best;
  }

  function manageDroneRaids() {
    for (const u of RS.game.units) {
      if (u.owner !== 'enemy' || u.kind !== 'drone' || u.hp <= 0 || u.target) continue;
      if (u.attackMove && RS.game.time < (u.droneRouteAt || 0)) continue;
      const target = bestDroneRaidTarget(u);
      if (!target) continue;
      const goal = {
        x: target.cx !== undefined ? target.cx : target.x,
        y: target.cy !== undefined ? target.cy : target.y,
      };
      u.econRaid = target;
      u.attackMove = goal;
      u.path = planDroneRaidPath(u, target);
      u.dest = goal;
      u.droneRouteAt = RS.game.time + 1.25;
    }
  }

  function update(dt) {
    if (!ai.active) return;
    const G = RS.game, t = G.time, AB = RS.map.aiBase;
    tick -= dt;
    if (tick > 0) return;
    tick = 1;

    updateIntel();
    manageDeepEconomy();
    manageDerelictSalvage();
    manageDroneRaids();
    manageRelicContest(); // 沙暴遗迹争夺(easy 内部跳过)

    // ---- 建造:候选按优先级排队,买得起才建;计划建筑买不起不再压住重建 ----
    const underConstruction = G.buildings.some(b => b.owner === 'enemy' && !b.done && !b.destroyed);
    const nb = ai.order[buildIdx];
    const nbDue = nb && t >= nb.t * ai.diff.buildPace;
    if (!underConstruction) {
      const rb = rebuildNeed(t);
      const cands = [];
      if (G.lowPower('enemy') && countDone('power') >= 1) cands.push(['power', 4, 3, false]);
      if (nbDue) cands.push([nb.type, nb.di, nb.dj, true]);
      if (rb) cands.push([rb, 0, 4, false]);
      let builtOne = false;
      for (const [type, di, dj, isPlan] of cands) {
        if (ai.wallet.money < RS.config.buildings[type].cost) continue;
        if (tryBuild(type, di, dj)) { builtOne = true; if (isPlan) { buildIdx++; ai.planWait = 0; } break; }
      }
      // 产能扩张:余钱堆积而产能全满(现金闲置花不出去)→ 补建第二工厂/兵营。
      // easy 兵力封顶填不满队列自然不触发;normal/hard 经济上来后不再有钱花不出(三轮 P1-03 后真实瓶颈)
      const prodsBusy = G.buildings.filter(b => b.owner === 'enemy' && b.done && !b.destroyed && b.def.produces);
      if (!builtOne && prodsBusy.length && prodsBusy.every(b => b.queue.length >= 2) && ai.wallet.money >= 1200) {
        const type = countDone('factory') <= countDone('barracks') ? 'factory' : 'barracks';
        tryBuild(type, 3, 3);
      }
      // 计划项到期却久建不成(没位置/一直差钱):45s 后跳过,不卡死后续项
      if (nbDue) { ai.planWait = (ai.planWait || 0) + 1; if (ai.planWait > 45) { buildIdx++; ai.planWait = 0; } }
      else ai.planWait = 0;
    }

    // ---- 生产:攒到当波规模即停(cap = waveSize);矿车保有量优先 ----
    const allIn = t >= ai.diff.allInAt;
    if (!ai.allInFired && allIn) { // 总攻只触发一次到点即打,之后按 120s 脉搏
      ai.allInFired = true;
      if (ai.nextWaveAt > t) ai.nextWaveAt = t;
    }
    const need = waveSizeOf(ai.diff, ai.waveIndex);
    const hvQueued = G.buildings.reduce((s, b) => s + (b.owner === 'enemy' ? b.queue.filter(q => q === 'harvester').length : 0), 0);
    const hvCount = G.units.filter(u => u.owner === 'enemy' && u.kind === 'harvester').length + hvQueued;
    const hvNeed = Math.min(2, G.buildings.filter(b => b.owner === 'enemy' && b.type === 'refinery' && b.done && !b.destroyed).length);
    const idleArmy = G.units.filter(u => u.owner === 'enemy' && isCombat(u) && !u.attackMove).length;
    // 生产目标 = 波次规模 + 随时间增长的守军(像真人一样滚兵力,收入是唯一约束)
    const armyTarget = allIn ? 80 : Math.min(ai.diff.armyMax, Math.floor(ai.diff.armyBase + t / ai.diff.armyEvery));
    const cap = Math.max(need, armyTarget);
    // 经济脑死亡防护:无精炼厂且钱不够重建时,停产攒钱(队列退款见 combat.destroyBuilding)
    const refineryDown = countDone('refinery') === 0 && ai.wallet.money < RS.config.buildings.refinery.cost;
    // 攒钱建到期计划建筑(困难专属行为):否则产兵每 tick 抢光现金,600 的精炼厂/500 的炮塔永远排不上;
    // 但敌军压境时不攒——被围攻还停产等于自杀。easy/normal 不攒钱(保持"简单直给"的难度性格)
    const savingFor = ai.diff.smart && nbDue && !underConstruction && ai.wallet.money < RS.config.buildings[nb.type].cost
      && !G.units.some(u => u.owner === 'player' && isCombat(u) && Math.hypot(u.x - AB.i, u.y - AB.j) < 40);
    if (!savingFor && !refineryDown && idleArmy < cap) {
      // 轮换起点:防止先建的兵营每 tick 先抢钱,工厂被永久饿死
      const prods = G.buildings.filter(b => b.owner === 'enemy' && b.done && !b.destroyed && b.def.produces);
      for (let k = 0; k < prods.length; k++) {
        const b = prods[(prodCycle + k) % prods.length];
        if (b.queue.length >= 2) continue;
        let kind = null;
        if (b.type === 'factory' && hvCount < hvNeed) kind = 'harvester'; // 补经济单位
        else kind = pickFor(b, t);
        if (!kind) continue;
        // 无预留金:建造优先序每秒已自然保障;买不起就产兵,不冻结资金(死锁修复)
        if (ai.wallet.money >= T(kind).cost && G.enqueueUnit(b, kind)) prodCycle++;
      }
    }

    // ---- 守家:按 DPS 加权威胁,守离指挥中心最近的入侵者;困难召回攻击移动部队 ----
    const ecc = G.buildings.find(b => b.owner === 'enemy' && b.type === 'cc' && !b.destroyed);
    const home = ecc ? { x: ecc.cx, y: ecc.cy } : { x: AB.i, y: AB.j };
    const invaders = G.units.filter(u =>
      u.owner === 'player' && isCombat(u) && Math.hypot(u.x - home.x, u.y - home.y) < 25);
    const threat = invaders.reduce((s, u) => s + T(u.kind).dmg * (T(u.kind).rof || 1), 0);
    if (threat >= ai.diff.defendThreat) {
      let prime = invaders[0], pd = Infinity;
      for (const u of invaders) { const d = Math.hypot(u.x - home.x, u.y - home.y); if (d < pd) { pd = d; prime = u; } }
      const recallAll = (ai.diff.smart && threat >= ai.diff.defendThreat * 2) || threat >= 60; // 大军压境:普通也召回波次部队
      const defenders = G.units.filter(u =>
        u.owner === 'enemy' && isCombat(u) && !u.target &&
        (!u.attackMove || recallAll) && Math.hypot(u.x - home.x, u.y - home.y) < 40);
      if (defenders.length && prime) RS.combat.attackMoveGroup(defenders, prime.x, prime.y);
      ai.wasInvaded = true;
      ai.repelled = false;
    } else if (ai.diff.smart && ai.wasInvaded && invaders.length <= 1) {
      ai.repelled = true; // 基本肃清入侵者才算击退
      ai.wasInvaded = false;
    }

    // ---- 击退反打(困难):玩家远征受挫、青黄不接时断其兵源;60 秒冷却 ----
    const playerArmyNow = G.units.filter(u => u.owner === 'player' && isCombat(u)).length;
    if (ai.repelled && playerArmyNow < 25 && t >= ai.rpCoolUntil) {
      ai.repelled = false;
      const idleE = G.units.filter(u => u.owner === 'enemy' && isCombat(u) && !u.attackMove && !u.target && !u.retreat); // 撤退伤员不被抓丁
      if (idleE.length >= 6) {
        const prod = bestKnown(b => b.def.produces);
        const tgt = prod ? { x: prod.cx, y: prod.cy } : playerCCTarget();
        RS.combat.attackMoveGroup(idleE, tgt.x, tgt.y);
        ai.rpCoolUntil = t + 60;
      }
    }

    // ---- 残局追猎:玩家兵 <3 且建筑 ≤3 时清剿残余 ----
    const remainB = G.buildings.filter(b => b.owner === 'player' && !b.destroyed);
    const remainArmy = G.units.filter(u => u.owner === 'player' && isCombat(u)).length;
    if (remainB.length > 0 && remainB.length <= 3 && remainArmy < 3) {
      for (const u of G.units) {
        if (u.owner !== 'enemy' || u.attackMove || u.target || !isCombat(u)) continue;
        let bd = Infinity, tgt = null;
        for (const b of remainB) { const d = Math.hypot(b.cx - u.x, b.cy - u.y); if (d < bd) { bd = d; tgt = b; } }
        if (tgt) RS.combat.attackMoveGroup([u], tgt.cx, tgt.cy);
      }
    }

    // ---- 猎杀目标跟踪:锁定具体矿车,死了转打最近已知经济建筑 ----
    for (const u of G.units) {
      if (u.owner !== 'enemy' || !u.hunt) continue;
      if (u.hunt.hp <= 0) {
        u.hunt = null;
        const fb = bestKnown(b => b.type === 'deepMine' || b.type === 'power' ||
          b.type === 'refinery' || b.def.produces);
        const cc = G.buildings.find(b => b.owner === 'player' && b.type === 'cc' && !b.destroyed);
        const t2 = fb || cc;
        if (t2) { u.attackMove = { x: t2.cx, y: t2.cy }; u.path = null; u.target = null; }
        continue;
      }
      if (!u.target && u.attackMove && Math.hypot(u.attackMove.x - u.hunt.x, u.attackMove.y - u.hunt.y) > 3) {
        u.attackMove = { x: u.hunt.x, y: u.hunt.y }; u.path = null;
      }
    }

    // ---- 困难:残血车辆无任务时撤回集结区(修好后再归队) ----
    if (ai.diff.smart) {
      for (const u of G.units) {
        if (u.owner !== 'enemy' || !u.vehicle || u.kind === 'harvester' || u.kind === 'mech' || u.attackMove) continue; // 机甲不撤退(不可再修,撤退=雪藏)
        if (!u.retreat && u.hp < u.maxHp * 0.25) {
          u.retreat = true; u.target = null;
          RS.units.setPath(u, ai.staging.x, ai.staging.y);
        } else if (u.retreat && u.hp > u.maxHp * 0.9) u.retreat = false;
      }
      // 维修车驻防集结区:与撤退机制闭环(残血车撤回 → 修好 → 归队)
      for (const u of G.units) {
        if (u.owner !== 'enemy' || u.kind !== 'repair' || u.repTarget || u.relicDuty || u.path ||
          (u.salvageTarget && G.derelicts.includes(u.salvageTarget))) continue;
        if (Math.hypot(u.x - ai.staging.x, u.y - ai.staging.y) > 3)
          RS.units.setPath(u, ai.staging.x, ai.staging.y);
      }
    }

    // ---- 波次进攻(反击拳共用发兵口) ----
    const PB = RS.map.playerBase;
    const playerOut = G.units.filter(u => u.owner === 'player' && isCombat(u) && Math.hypot(u.x - AB.i, u.y - AB.j) < 35).length;
    const playerHome = G.units.filter(u => u.owner === 'player' && isCombat(u) && Math.hypot(u.x - PB.i, u.y - PB.j) < 25).length;
    if (playerOut >= 3) ai.playerAttacked = true; // 玩家亮过拳头(锁存)
    // 困难防守反击:玩家没进攻前不送波次(不往更强的大军上撞),玩家一出手就往死里打
    const hardHold = ai.diff.smart && !allIn && !ai.playerAttacked;
    // 困难骚扰:主力按兵不动时,派 4-6 人猎杀小队掐矿(有可见经济/生产目标才派,不硬撞)
    if (hardHold && t >= ai.nextWaveAt) {
      const tgt = waveTarget(ai.waveIndex); // hunter>=2:优先可见矿车/精炼厂
      const pool = G.units.filter(u => u.owner === 'enemy' && isCombat(u) && !u.attackMove && !u.target && !u.retreat); // 撤退伤员不被抓丁
      const sendN = Math.min(6, pool.length - ai.diff.guardEarly); // 早期看家底不动
      // 有经济/生产目标打目标;侦察拿不到情报超过 6 分钟就直接上门(武力侦察)
      const fallback = t > 360 ? playerCCTarget() : null;
      const aim = (tgt.hunt || bestKnown(b => b.type === 'refinery' || b.def.produces)) ? tgt : fallback;
      if (sendN >= 4 && aim) {
        pool.sort((a, b) => Math.hypot(a.x - ai.staging.x, a.y - ai.staging.y) - Math.hypot(b.x - ai.staging.x, b.y - ai.staging.y));
        const send = pool.slice(0, sendN);
        RS.combat.attackMoveGroup(send, aim.x, aim.y);
        if (aim === tgt && tgt.hunt) for (const u of send) u.hunt = tgt.hunt;
        ai.nextWaveAt = t + 140 + R() * 40;
      } else {
        ai.nextWaveAt = t + 20;
      }
    }
    // 困难侦察:没有经济情报时派快车去玩家基地看一圈(看见了,骚扰链才有目标)
    if (hardHold && t >= ai.scoutCoolUntil && !bestKnown(b => b.type === 'refinery')) {
      const scouts = G.units.filter(u => u.owner === 'enemy' && u.kind === 'lightTank' && !u.attackMove && !u.target).slice(0, 2);
      if (scouts.length) {
        const pb = playerCCTarget();
        RS.combat.attackMoveGroup(scouts, pb.x, pb.y);
        ai.scoutCoolUntil = t + 45;
      } else ai.scoutCoolUntil = t + 15;
    }
    const cp = ai.diff.counterPunch && playerOut >= 8 && playerHome <= 18 &&
      invaders.length < 3 && t >= ai.cpCoolUntil;
    if ((t >= ai.nextWaveAt || cp) && !hardHold) {
      // 全图闲置兵力按距集结点排序取用(不再限死 12 格圈,生产的兵都算数);撤退伤员不被抓丁
      const army = G.units.filter(u =>
        u.owner === 'enemy' && isCombat(u) && u.hp > 0 && !u.target && !u.attackMove && !u.retreat);
      // 单位散开后范围伤害效率下降，三档各自保留明确看家底；反击拳也不能掏空基地。
      const guard = allIn ? 0 : (t < 600 ? ai.diff.guardEarly : ai.diff.guardLate);
      const available = Math.max(0, army.length - guard);
      const gate = cp ? 5 : (allIn ? 6 : Math.min(need, 12));
      const pool = available;
      if (pool >= gate) {
        army.sort((a, b) =>
          Math.hypot(a.x - ai.staging.x, a.y - ai.staging.y) - Math.hypot(b.x - ai.staging.x, b.y - ai.staging.y));
        const send = army.slice(0, cp ? Math.min(available, 16) : (allIn ? army.length : Math.min(need, available))); // 反击拳上限 16,同时保留看家底
        const tgt = cp ? playerCCTarget() : waveTarget(ai.waveIndex);
        RS.combat.attackMoveGroup(send, tgt.x, tgt.y);
        ai.atkSerial++; for (const u of send) u.atkSerial = ai.atkSerial; // 正式进攻打标(波次/反击拳),警报只认标
        if (tgt.hunt) for (const u of send) u.hunt = tgt.hunt;
        if (cp) {
          ai.cpCoolUntil = t + 90; // 反击拳独立冷却,不占波次编号
        } else {
          ai.waveIndex++;
          ai.nextWaveAt = t + (allIn ? 120 : ai.diff.interval * (0.9 + R() * 0.2)); // ±10% 抖动
        }
      } else if (!cp) {
        ai.nextWaveAt = t + 15;
      }
    }

    // ---- 波次警报:先头部队逼近玩家基地 30 格才响(与接敌时间吻合);只认正式进攻打标单位,侦察/骚扰不误报、反击拳不漏报 ----
    if (ai.warnedSerial !== ai.atkSerial) {
      const pb = playerCCTarget();
      let minD = Infinity;
      for (const u of G.units)
        if (u.owner === 'enemy' && u.atkSerial === ai.atkSerial && u.hp > 0)
          minD = Math.min(minD, Math.hypot(u.x - pb.x, u.y - pb.y));
      if (minD < 30) { G.waveWarn = t; ai.warnedSerial = ai.atkSerial; }
    }
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

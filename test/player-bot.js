/* 共享机器人玩家(bot-match.js / debug-match.js 共用)。
 * 休闲玩家模型:手速有限(1.2s 决策一次)、家里来敌只派一半闲人、
 * 攒够 35 才远征——模拟一个"会玩但不极限"的普通玩家。 */
'use strict';

const RS = () => globalThis.RS;
const STEP = 1 / 30;

function makeBot(opts) {
  opts = opts || {};
  const THINK = opts.think || 1.2; // 决策间隔(技能矩阵可覆盖:高级 0.5/中级 1.2/初级 2.5)
  let built = 0, attackT = opts.attackT || 360, thinkT = 0; // attackT 可参数化:攻击时钟扫描(240/360/480)
  const ORDER = [
    ['power', 4, -2], ['barracks', 4, 6], ['factory', 8, 6],
    ['power', 7, -2], ['turret', 3, -5], ['turret', 8, 0], ['refinery', 0, -5],
  ];
  const ORDER_T = [5, 40, 110, 180, 300, 400, 480];
  const combatUnits = G => G.units.filter(u => u.owner === 'player' && RS().units.TYPES[u.kind].dmg);
  const HOME = () => ({ x: RS().map.playerBase.i + 1.5, y: RS().map.playerBase.j + 1 });

  function findSpot(type, pi, pj) {
    for (let r = 0; r <= 6; r++)
      for (let a = -r; a <= r; a++)
        for (let b = -r; b <= r; b++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
          if (RS().game.canPlace(type, pi + a, pj + b)) return { i: pi + a, j: pj + b };
        }
    return null;
  }

  return function tick(t) {
    thinkT -= STEP;
    if (thinkT > 0) return;
    thinkT = THINK; // 休闲手速(或技能矩阵指定值)
    const G = RS().game, PB = RS().map.playerBase, home = HOME();
    // 建造
    if (built < ORDER.length && t >= ORDER_T[built]) {
      const [type, di, dj] = ORDER[built];
      const s = findSpot(type, PB.i + di, PB.j + dj);
      if (s && G.startConstruction(type, s.i, s.j)) built++;
      else if (G.money > 2500) built++;
    }
    // 深层经济不看钟表：矿区达到二档收益后，才值得投入钻探车。
    const minYield = RS().config.deepEconomy.tierPayout[1] *
      (60 / RS().config.deepEconomy.incomeTick);
    const rigs = G.units.filter(u => u.owner === 'player' && u.kind === 'drillRig' && u.hp > 0);
    for (const u of rigs) {
      const status = G.deepMineStatus(u);
      if (status.valid) {
        G.deployDrillRig(u);
        continue;
      }
      if (!u.drillSite) u.drillSite = G.findDeepMineSite('player', u.x, u.y, minYield);
      if (u.drillSite && (!u.dest ||
        Math.hypot(u.dest.x - u.drillSite.x, u.dest.y - u.drillSite.y) > 1))
        RS().units.setPath(u, u.drillSite.x, u.drillSite.y);
    }
    const deepMines = G.buildings.filter(b =>
      b.owner === 'player' && b.type === 'deepMine' && !b.destroyed).length;
    const deepQueued = G.buildings.some(b =>
      b.owner === 'player' && b.queue && b.queue.includes('drillRig'));
    const deepSite = deepMines < RS().config.deepEconomy.maxPerOwner && !rigs.length &&
      !deepQueued ? G.findDeepMineSite('player', undefined, undefined, minYield) : null;
    let needsRig = !!deepSite;
    // 生产
    for (const b of G.buildings) {
      if (b.owner !== 'player' || !b.done || !b.def.produces) continue;
      if (b.queue.length >= 2) continue;
      if (b.type === 'barracks') G.enqueueUnit(b, 'rocket');
      if (b.type === 'factory') {
        if (needsRig && G.enqueueUnit(b, 'drillRig')) {
          needsRig = false;
          continue;
        }
        if (t > 420 && G.money > 900) G.enqueueUnit(b, 'artillery');
        else if (t > 300 && G.money > 900) G.enqueueUnit(b, 'heavyTank');
        else G.enqueueUnit(b, 'lightTank');
      }
    }
    // 防御:敌人进家才反应,只派一半闲人拦截
    const inv = G.units.filter(u => u.owner === 'enemy' && Math.hypot(u.x - home.x, u.y - home.y) < 28);
    if (inv.length) {
      const cx = inv.reduce((s, u) => s + u.x, 0) / inv.length;
      const cy = inv.reduce((s, u) => s + u.y, 0) / inv.length;
      const free = combatUnits(G).filter(u => !u.target && !u.expedition);
      free.slice(0, Math.ceil(free.length / 2)).forEach(u => { u.attackMove = { x: cx, y: cy }; });
      return;
    }
    // 远征:攒够 35 才出门
    const free = combatUnits(G).filter(u => !u.target && !u.expedition);
    if (t >= attackT && free.length >= 35) {
      attackT = t + 150;
      let ccx = 0, ccy = 0;
      for (const u of free) { ccx += u.x; ccy += u.y; }
      ccx /= free.length; ccy /= free.length;
      let tgt = null, bd = Infinity;
      for (const b of G.buildings) {
        if (b.owner !== 'enemy') continue;
        const d = Math.hypot(b.cx - ccx, b.cy - ccy);
        if (d < bd) { bd = d; tgt = { x: b.cx, y: b.cy }; }
      }
      if (!tgt) return;
      for (const u of free) u.expedition = true;
      RS().combat.attackMoveGroup(free, tgt.x, tgt.y);
      if (RS().debugBot) console.log('[' + (t / 60).toFixed(1) + '分] 远征 ' + free.length);
    }
    for (const u of combatUnits(G)) if (u.expedition && !u.attackMove && !u.target) u.expedition = false;
  };
}

module.exports = { makeBot };

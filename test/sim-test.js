/* Node 仿真冒烟测试:不依赖 DOM,验证等距变换与矿车经济循环。
 * 运行:node test/sim-test.js */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');
require('../src/ai.js'); // 敌方卸矿入账 AI 钱包,需要 RS.ai 存在

const RS = globalThis.RS;
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// 1. 等距变换往返一致
const s = RS.iso.toScreen(3.7, -2.4);
const w = RS.iso.toWorld(s.x, s.y);
check('iso 变换往返', Math.abs(w.x - 3.7) < 1e-9 && Math.abs(w.y + 2.4) < 1e-9);

// 2. 地图生成
RS.map.gen();
check('主矿存在', RS.map.oreAt(22, 92) > 0, 'ore(22,92)=' + RS.map.oreAt(22, 92));
check('中立矿存在', RS.map.neutralOres.every(n => RS.map.oreAt(n.i, n.j) > 0));
check('出生区无岩石', !RS.map.isBlocked(30, 98) && !RS.map.isBlocked(26, 96));

// 3. 经济仿真:240 秒,资金应显著增长
// (理论上限:采集 5s + 卸矿 1s → 300/6s = 3000/分钟;本图矿近,往返很快)
RS.game.init();
RS.game.units = RS.game.units.filter(u => u.owner === 'player'); // 只测玩家经济(敌方矿车入 AI 钱包)
const startMoney = RS.game.money;
const STEP = RS.config.SIM_STEP;
for (let t = 0; t < 240; t += STEP) RS.game.update(STEP);

const hv = RS.game.units[0];
const income = RS.game.money - startMoney;
const rate = income / 240 * 60;
check('矿车完成多趟往返', hv.trips >= 8, hv.trips + ' 趟/240s');
check('资金增长', income >= 300 * 8, '+' + income);
check('采矿速率在合理区间(≤ 理论上限 3000/分钟)', rate > 600 && rate <= 3000, Math.round(rate) + '/分钟');
check('矿车未卡死', hv.state !== 'idle' || RS.map.oreAt(22, 92) <= 0, 'state=' + hv.state);

// 4. 特殊矿(骸骨,所在格挡路)也能采:自动采旁边,不死锁
RS.game.init();
const PB = RS.map.playerBase;
let bi = 0, bj = 0;
outer: for (let r = 6; r < 14; r++)
  for (let a = -r; a <= r; a++)
    for (let b = -r; b <= r; b++) {
      const ci = PB.i + a, cj = PB.j + b;
      if (!RS.map.isBlocked(ci, cj) && RS.map.oreAt(ci, cj) <= 0) { bi = ci; bj = cj; break outer; }
    }
const bt = RS.map.at(bi, bj);
bt.ore = 300; bt.sp = 'bone'; RS.map.setBlocked(bi, bj, true); RS.map.oreTiles.push({ i: bi, j: bj });
const bh = RS.game.spawnUnitAt('harvester', bi + 1.5, bj + 0.5, 'player');
const sm0 = RS.game.money;
for (let t = 0; t < 60; t += STEP) RS.game.update(STEP);
check('骸骨矿可采集(不死锁)', bt.ore < 300, '残矿 ' + Math.round(bt.ore) + '/300');
check('骸骨矿采完有收获', bh.trips >= 1 || bh.load > 0 || RS.game.money > sm0,
  'trips=' + bh.trips + ' load=' + Math.round(bh.load));

// 5. 开局采矿几何对等(三轮验收 P1-03):多种子双方首趟 A* 路径无系统性偏斜
{
  const lens = { player: [], enemy: [] };
  for (let s = 0; s < 60; s++) {
    RS.gameSeed = 91000 + s * 37;
    RS.game.init();
    for (const side of ['player', 'enemy']) {
      const ref = RS.game.buildings.find(b => b.owner === side && b.type === 'refinery');
      let ore = null, bd = Infinity;
      for (const t of RS.map.oreTiles) {
        if (RS.map.oreAt(t.i, t.j) <= 0) continue;
        const d = Math.hypot(t.i + 0.5 - ref.cx, t.j + 0.5 - ref.cy);
        if (d < bd) { bd = d; ore = t; }
      }
      const cells = RS.units.findPath(ore.i, ore.j, Math.floor(ref.dock.x), Math.floor(ref.dock.y));
      let len = 0;
      for (let k = 1; cells && k < cells.length; k++) len += Math.hypot(cells[k].i - cells[k - 1].i, cells[k].j - cells[k - 1].j);
      lens[side].push(cells ? len : 99);
    }
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const avgP = avg(lens.player), avgE = avg(lens.enemy);
  let skewed = 0, sumAbs = 0, worstD = 0;
  for (let s = 0; s < 60; s++) {
    const d = Math.abs(lens.player[s] - lens.enemy[s]); // 绝对差:双近零时比值无意义
    sumAbs += d;
    if (d > 3) skewed++;
    if (d > worstD) worstD = d;
  }
  check('双方首趟路径均值无系统偏斜(|Δ|≤0.6)', Math.abs(avgP - avgE) <= 0.6,
    '玩家 ' + avgP.toFixed(2) + ' vs AI ' + avgE.toFixed(2));
  check('路径绝对差 >3 的种子 ≤ 1/60', skewed <= 1, '偏斜 ' + skewed + ',最坏差 ' + worstD.toFixed(1) + ',均值 ' + (sumAbs / 60).toFixed(2));
}

// 6. 沙暴终局(三轮验收 P2-01):30 分钟后指挥中心持续掉血,35 分钟上限前必终结;同帧双灭按家底裁决
RS.gameSeed = 4242;
RS.game.init();
RS.game.time = 1799.9;
while (RS.game.state === 'playing' && RS.game.time < 40 * 60) RS.game.update(STEP);
check('沙暴在 35 分钟上限前终结对局', RS.game.state !== 'playing' && RS.game.time < 35 * 60,
  RS.game.state + ' @ ' + (RS.game.time / 60).toFixed(1) + ' 分');
RS.game.init();
RS.game.time = 1800;
for (const b of RS.game.buildings) if (b.type === 'cc') b.hp = 0.01;
for (let k = 0; k < 90; k++) RS.game.update(STEP);
check('同帧双灭按剩余建筑裁决(平局玩家胜)', RS.game.state === 'won', RS.game.state);

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

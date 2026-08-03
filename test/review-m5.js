/* 复查脚本:按《M5-AI逻辑与经济战略精修问题报告》第二节"关键仿真结果"
 * 逐项重跑最小实验,确认修复生效。运行:node test/review-m5.js */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');
require('../src/ai.js');

const RS = globalThis.RS;
const STEP = RS.config.SIM_STEP;
const run = sec => { for (let t = 0; t < sec; t += STEP) RS.game.update(STEP); };
let failures = 0;
function check(name, cond, detail) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!cond) failures++;
}

// 1. 摧毁全部敌方精炼厂+矿车 → AI 收入应停止(原:10 秒仍 +251)
RS.game.init(); RS.ai.init('normal');
run(5);
for (const b of RS.game.buildings) if (b.owner === 'enemy' && b.type === 'refinery') b.destroyed = true;
RS.game.units = RS.game.units.filter(u => !(u.owner === 'enemy' && u.kind === 'harvester'));
const m0 = RS.ai.wallet.money;
run(10);
check('P0-01 断经济=断收入', RS.ai.wallet.money <= m0, '10秒变化 ' + Math.round(RS.ai.wallet.money - m0));

// 2. 敌方初始矿车(原:0)
RS.game.init(); RS.ai.init('normal');
check('P0-02 敌方开局有矿车', RS.game.units.some(u => u.owner === 'enemy' && u.kind === 'harvester'));

// 3. 敌方新精炼厂完工自带矿车(原:仍为 0)
const eref = RS.game.placeStructure('refinery', 100, 44, 'enemy', false);
eref.progress = eref.def.buildTime; // 直接推进到完工边缘
const hvBefore = RS.game.units.filter(u => u.owner === 'enemy' && u.kind === 'harvester').length;
run(1);
const hvAfter = RS.game.units.filter(u => u.owner === 'enemy' && u.kind === 'harvester').length;
check('P0-02 敌方精炼厂完工送矿车', hvAfter === hvBefore + 1, hvBefore + ' → ' + hvAfter);

// 4. 敌方矿车卸 300:玩家 +0,AI +300(原:玩家 +300,AI +0)
const eh = RS.game.units.find(u => u.owner === 'enemy' && u.kind === 'harvester');
eh.state = 'unload'; eh.load = 300; eh.timer = 10;
const pm0 = RS.game.money, am0 = RS.ai.wallet.money;
RS.game.update(STEP);
check('P0-03 卸矿入账正确阵营', RS.game.money === pm0 && RS.ai.wallet.money === am0 + 300,
  '玩家 +' + (RS.game.money - pm0) + ' / AI +' + (RS.ai.wallet.money - am0));

// 5. 玩家缺电不再拖慢敌方(原:敌方生产减半)
RS.game.init(); RS.ai.init('normal');
// 让玩家缺电:塞 3 座完工工厂(-60);敌方电力充裕(补电站)
RS.game.placeStructure('factory', 20, 90, 'player', true);
RS.game.placeStructure('factory', 24, 90, 'player', true);
RS.game.placeStructure('factory', 28, 90, 'player', true);
RS.game.placeStructure('power', 96, 40, 'enemy', true);
const ebar = RS.game.placeStructure('barracks', 92, 44, 'enemy', true);
RS.ai.wallet.money = 5000;
RS.game.enqueueUnit(ebar, 'infantry');
run(1);
check('P0-04 玩家缺电/敌方全速', RS.game.lowPower('player') && Math.abs(ebar.prodProgress - 1) < 0.05,
  'progress=' + ebar.prodProgress.toFixed(2));

// 6. 攻击移动速度(原:5.6 格/秒)
RS.game.init(); RS.ai.init('easy');
const tk = RS.game.spawnUnitAt('lightTank', 60, 60, 'enemy');
RS.combat.attackMoveGroup([tk], 60, 70);
const ty0 = tk.y; run(1);
check('P0-05 攻击移动=面板速度', Math.abs((tk.y - ty0) - 2.8) < 0.35, (tk.y - ty0).toFixed(2) + ' 格/秒');

// 6b. 旧集结路径吞新进攻令(原:新攻击移动被清除)
const tk2 = RS.game.spawnUnitAt('lightTank', 42.7, 60, 'enemy');
RS.units.setPath(tk2, 42.7, 61); // 旧集结路径,马上走完
RS.combat.attackMoveGroup([tk2], 52.5, 60);
RS.game.update(STEP); RS.game.update(STEP);
check('P0-06 新命令不被旧路径吞掉', !!tk2.attackMove && Math.abs(tk2.attackMove.x - 52.5) < 6,
  tk2.attackMove ? 'attackMove→' + tk2.attackMove.x.toFixed(1) : '被清掉了');

// 7. 普通第一波实际人数(原:名义 3 实出 60)
RS.game.init(); RS.ai.init('normal');
const stg = RS.ai.staging;
for (let k = 0; k < 10; k++) RS.game.spawnUnitAt('lightTank', stg.x + (k % 5), stg.y + Math.floor(k / 5), 'enemy');
RS.ai.nextWaveAt = 0;
run(2);
const sent = RS.game.units.filter(u => u.owner === 'enemy' && u.attackMove).length;
check('P0-07 实发人数=waveSize(4)', sent === 4, sent + ' 人');

// 8. 简单难度会持续生产(原:590 秒仍只有开局 4 个)
RS.game.init(); RS.ai.init('easy');
run(590);
const easyArmy = RS.game.units.filter(u => u.owner === 'enemy' && RS.units.TYPES[u.kind].dmg).length;
check('P1-07 简单前十分钟持续扩军', easyArmy > 6, easyArmy + ' 个作战单位@590s');

// 9. 跨局状态重置(原:wasInvaded/repelled 泄漏)
RS.ai.wasInvaded = true; RS.ai.repelled = true;
RS.ai.init('easy');
check('P0-09 重开重置战术状态', !RS.ai.wasInvaded && !RS.ai.repelled && !RS.ai.allInFired);

// 10. 初始资产对等(原:AI 3850 vs 玩家 1600)
RS.game.init(); RS.ai.init('normal');
const eTurrets = RS.game.buildings.filter(b => b.owner === 'enemy' && b.type === 'turret').length;
const eArmyCost = RS.game.units.filter(u => u.owner === 'enemy')
  .reduce((s, u) => s + RS.units.TYPES[u.kind].cost, 0);
check('P1-01 敌无免费炮塔+开局资产镜像', eTurrets === 0 && RS.ai.wallet.money === 1000 && eArmyCost === 1100,
  '炮塔' + eTurrets + ' 资金' + RS.ai.wallet.money + ' 单位值' + eArmyCost + '(玩家同为 1100)');

// 11. 紧急矿车:绝种 45 秒补一辆
RS.game.init(); RS.ai.init('normal');
RS.game.units = RS.game.units.filter(u => !(u.owner === 'enemy' && u.kind === 'harvester'));
run(46);
check('经济死锁防护:45 秒补矿车', RS.game.units.some(u => u.owner === 'enemy' && u.kind === 'harvester'));

// 12. 波次警报:先头距玩家基地 ≤30 格才响(原:出发即响)
RS.game.init(); RS.ai.init('normal');
const stg2 = RS.ai.staging;
const w1 = RS.game.spawnUnitAt('lightTank', stg2.x, stg2.y, 'enemy');
const w2 = RS.game.spawnUnitAt('lightTank', stg2.x + 1, stg2.y, 'enemy');
const w3 = RS.game.spawnUnitAt('lightTank', stg2.x + 2, stg2.y, 'enemy');
const w4 = RS.game.spawnUnitAt('lightTank', stg2.x + 3, stg2.y, 'enemy');
RS.ai.nextWaveAt = 0;
run(2);
check('P1-29 出发瞬间不响警报', RS.game.waveWarn === 0, 'waveWarn=' + RS.game.waveWarn.toFixed(0));
let warnAt = 0, guard = 0;
while (!warnAt && guard++ < 300 * 30) {
  RS.game.update(STEP);
  if (RS.game.waveWarn > 0) warnAt = RS.game.time;
}
const pb = { x: RS.map.playerBase.i + 1.5, y: RS.map.playerBase.j + 3.5 };
const nearD = Math.min(...RS.game.units.filter(u => u.owner === 'enemy' && u.attackMove)
  .map(u => Math.hypot(u.x - pb.x, u.y - pb.y)));
check('P1-29 逼近 30 格才响警报', warnAt > 0 && nearD <= 31,
  't=' + warnAt.toFixed(0) + 's 先头距基地 ' + nearD.toFixed(1) + ' 格');

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

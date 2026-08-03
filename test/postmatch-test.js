/* 单局战绩测试:死亡/摧毁事件、经济区间、采集收入、成就结算。
 * 运行:node test/postmatch-test.js */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');

const RS = globalThis.RS;
const STEP = RS.config.SIM_STEP;
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function run(sec) {
  for (let t = 0; t < sec && RS.game.state === 'playing'; t += STEP) RS.game.update(STEP);
}
function freshEmpty() {
  RS.game.init();
  RS.game.units = [];
}

// 1. 真实战斗死亡点记账，而不是结算时反推场上余量。
freshEmpty();
RS.game.spawnUnitAt('heavyTank', 50, 50, 'player');
RS.game.spawnUnitAt('infantry', 52.5, 50, 'enemy');
run(8);
check('玩家击毁敌军计入战绩', RS.game.stats.unitsKilled === 1,
  '击毁=' + RS.game.stats.unitsKilled);

freshEmpty();
RS.game.spawnUnitAt('infantry', 50, 50, 'player');
RS.game.spawnUnitAt('heavyTank', 52.5, 50, 'enemy');
run(8);
check('我军阵亡计入战绩', RS.game.stats.unitsLost === 1,
  '损失=' + RS.game.stats.unitsLost);

// 2. 建筑摧毁区分敌我，主动回收不走该事件。
freshEmpty();
const siege = RS.game.spawnUnitAt('heavyTank', 50, 50, 'player');
const enemyPower = RS.game.placeStructure('power', 52, 49, 'enemy', true);
enemyPower.hp = 1;
RS.combat.attackCommand([siege], enemyPower);
run(3);
check('摧毁敌方建筑计入战绩', RS.game.stats.buildingsDestroyed === 1);

freshEmpty();
const raider = RS.game.spawnUnitAt('heavyTank', 50, 50, 'enemy');
const playerPower = RS.game.placeStructure('power', 52, 49, 'player', true);
playerPower.hp = 1;
RS.combat.attackCommand([raider], playerPower);
run(3);
check('我方建筑被毁计入战绩', RS.game.stats.buildingsLost === 1);

// 3. 采矿收入和余额峰谷分别记录。
RS.game.init();
const hv = RS.game.units.find(u => u.owner === 'player' && u.kind === 'harvester');
const pref = RS.game.buildings.find(b => b.owner === 'player' && b.type === 'refinery');
hv.state = 'unload'; hv.load = 300; hv.timer = RS.config.harvester.unloadTime; hv.dockB = pref; hv.path = null;
RS.game.update(STEP);
check('卸矿收入计入本局采集资源', RS.game.stats.resourcesMined === 300,
  '采集=$' + RS.game.stats.resourcesMined);
RS.game.money = 120; RS.game.recordEconomy();
RS.game.money = 1800; RS.game.recordEconomy();
check('经济最高/最低余额被保留',
  RS.game.stats.moneyPeak === 1800 && RS.game.stats.moneyLow === 120,
  '最高=' + RS.game.stats.moneyPeak + ' 最低=' + RS.game.stats.moneyLow);

// 4. 终局冻结时长并计算至多三个本局成就。
freshEmpty();
RS.game.stats.unitsKilled = 12;
RS.game.stats.buildingsDestroyed = 4;
RS.game.stats.resourcesMined = 5200;
const finisher = RS.game.spawnUnitAt('heavyTank', 50, 50, 'player');
const enemyCC = RS.game.buildings.find(b => b.owner === 'enemy' && b.type === 'cc');
RS.combat.destroyBuilding(enemyCC, finisher);
run(2);
check('终局统计被冻结', RS.game.state === 'won' && RS.game.stats.finalized &&
  RS.game.stats.duration > 0);
check('根据本局表现解锁成就且不塞满结算屏',
  RS.game.stats.achievements.length === 3 &&
  RS.game.stats.achievements.includes('战场清道夫') &&
  RS.game.stats.achievements.includes('攻城先锋'),
  RS.game.stats.achievements.join('/'));

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

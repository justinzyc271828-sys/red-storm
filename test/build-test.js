/* M2b 测试:建造规则、单队列、电力供需、施工进度、精炼厂自带矿车、建筑回收。
 * 运行:node test/build-test.js */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');

const RS = globalThis.RS;
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

RS.game.init();
const STEP = RS.config.SIM_STEP;

// 1. 初始电力:指挥中心 +20,精炼厂 -15 → 不缺电
check('初始电力供需', RS.game.powerSupply() === 20 && RS.game.powerUsed() === 15,
  RS.game.powerSupply() + '供 / ' + RS.game.powerUsed() + '需');
check('初始不缺电', !RS.game.lowPower());
check('防御炮塔耐久提升到 450 且不额外加伤害',
  RS.config.buildings.turret.hp === 450 && RS.config.buildings.turret.weapon.dmg === 18);
check('防御炮塔实际占地与底座一致为 2×2',
  RS.config.buildings.turret.n === 2 && RS.config.buildings.turret.m === 2);

// 2. 放置校验
check('压在已有建筑上:拒绝', !RS.game.canPlace('turret', 31, 101));
check('压在矿脉上:拒绝', !RS.game.canPlace('turret', 22, 92));
const rock = RS.map.rockTiles[0];
check('压在岩石上:拒绝', !RS.game.canPlace('turret', rock.i, rock.j));
check('远离基地:拒绝', !RS.game.canPlace('turret', 60, 60));
check('兵营合法位置:接受', RS.game.canPlace('barracks', 34, 104));

// 3. 建造扣钱 + 单队列
check('兵营开工', RS.game.startConstruction('barracks', 34, 104));
check('开工扣钱', RS.game.money === 600, '剩 ' + RS.game.money);
check('队列占满时第二个被拒', !RS.game.startConstruction('turret', 35, 99));

// 4. 施工进度:8 秒完工
for (let t = 0; t < 9; t += STEP) RS.game.update(STEP);
const bar = RS.game.buildings.find(b => b.type === 'barracks');
check('兵营按时完工', bar && bar.done);

// 5. 电力不足:再造炮塔(累计耗电 25 > 供电 20)→ 施工减速
const turSpot = RS.game.findBuildSpot('turret', RS.map.playerBase.i, RS.map.playerBase.j, 'player', 10);
check('炮塔开工', !!turSpot && RS.game.startConstruction('turret', turSpot.i, turSpot.j));
for (let t = 0; t < 9; t += STEP) RS.game.update(STEP); // 全速本应完工
const tur = RS.game.buildings.find(b => b.type === 'turret' && b.owner === 'player');
check('电力不足', RS.game.lowPower(), RS.game.powerSupply() + '供 / ' + RS.game.powerUsed() + '需');
check('缺电导致施工减半(9 秒未完工)', tur && !tur.done,
  tur ? '进度 ' + tur.progress.toFixed(1) + '/' + tur.def.buildTime : '炮塔不存在');
for (let t = 0; t < 9; t += STEP) RS.game.update(STEP);
check('减速后最终完工', tur.done);

// 6. 精炼厂完工自带矿车 + 矿车就近卸矿
check('精炼厂开工', RS.game.startConstruction('refinery', 33, 94));
for (let t = 0; t < 20; t += STEP) RS.game.update(STEP); // 缺电减半,需 16 秒
const ref2 = RS.game.buildings.filter(b => b.type === 'refinery')[1];
const hvCount = RS.game.units.filter(u => u.kind === 'harvester' && u.owner === 'player').length;
check('精炼厂完工', ref2 && ref2.done);
check('新精炼厂自带矿车', hvCount === 2, hvCount + ' 辆矿车');
for (let t = 0; t < 60; t += STEP) RS.game.update(STEP);
check('两辆矿车都在干活', RS.game.units.filter(u => u.kind === 'harvester' && u.owner === 'player').every(u => u.state !== 'idle' || u.cmd === 'move'));

// 7. 施工中取消:建筑款全额退回、占地释放、选择清空
RS.game.init();
let spot = RS.game.findBuildSpot('power', RS.map.playerBase.i, RS.map.playerBase.j, 'player', 10);
const cancelMoney0 = RS.game.money;
check('取消测试电站可开工', !!spot && RS.game.startConstruction('power', spot.i, spot.j));
let recycleTarget = RS.game.buildings.find(b => b.type === 'power' && b.owner === 'player');
recycleTarget.progress = recycleTarget.def.buildTime / 2;
RS.game.selectBuilding(recycleTarget);
const cancelRefund = RS.game.recycleBuilding(recycleTarget);
check('施工到一半取消全额退款', cancelRefund === 300 && RS.game.money === cancelMoney0,
  '退款 ' + cancelRefund + ' / 资金 ' + RS.game.money);
check('取消施工释放占地并清除选择',
  !RS.game.buildings.includes(recycleTarget) &&
  !RS.map.isBlocked(spot.i, spot.j) &&
  RS.game.buildingSel === null);

// 8. 成品回收:只退 60%;生产队列的独立成本仍全额退回
RS.game.init();
spot = RS.game.findBuildSpot('barracks', RS.map.playerBase.i, RS.map.playerBase.j, 'player', 10);
check('回收测试兵营可开工', !!spot && RS.game.startConstruction('barracks', spot.i, spot.j));
recycleTarget = RS.game.buildings.find(b => b.type === 'barracks' && b.owner === 'player');
for (let t = 0; t < recycleTarget.def.buildTime + STEP; t += STEP) RS.game.update(STEP);
check('回收测试兵营已完工', recycleTarget.done);
check('待回收兵营可加入生产队列', RS.game.enqueueUnit(recycleTarget, 'infantry'));
const recycleMoney0 = RS.game.money;
const sellRefund = RS.game.recycleBuilding(recycleTarget);
check('成品建筑退 60% 且队列全退',
  sellRefund === 340 && RS.game.money === recycleMoney0 + 340,
  '退款 ' + sellRefund + ' / 资金 ' + RS.game.money);
const cc = RS.game.buildings.find(b => b.owner === 'player' && b.type === 'cc');
check('指挥中心禁止回收', RS.game.recycleValue(cc) === 0 && RS.game.recycleBuilding(cc) === false && RS.game.buildings.includes(cc));

// 9. 精炼厂回收不允许靠保留赠送矿车刷资产
RS.game.init();
const starterRef = RS.game.buildings.find(b => b.owner === 'player' && b.type === 'refinery');
const starterHv = starterRef.bonusHarvester;
const refMoney0 = RS.game.money;
const refRefund = RS.game.recycleBuilding(starterRef);
check('精炼厂回收扣除仍保留的赠送矿车价值',
  refRefund === 60 && RS.game.money === refMoney0 + 60,
  '退款 ' + refRefund + ' / 资金 ' + RS.game.money);
check('回收精炼厂时赠送矿车继续保留',
  starterHv && starterHv.hp > 0 && RS.game.units.includes(starterHv));

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

/* M2c 测试:生产队列、扣钱退钱、出厂位置、集结点、矿车出厂自动开工。
 * 运行:node test/prod-test.js */
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
const run = sec => { for (let t = 0; t < sec; t += STEP) RS.game.update(STEP); };
RS.game.money = 99999;

// 0. 先补两座电站,避免缺电减速干扰计时
RS.game.startConstruction('power', 34, 96); run(8);
RS.game.startConstruction('power', 37, 96); run(8);
check('电站完工,电力充裕', !RS.game.lowPower(), RS.game.powerSupply() + '供/' + RS.game.powerUsed() + '需');

// 1. 兵营生产
check('兵营开工', RS.game.startConstruction('barracks', 34, 104));
run(10);
const bar = RS.game.buildings.find(b => b.type === 'barracks');
check('兵营完工', bar && bar.done);

const money0 = RS.game.money, units0 = RS.game.units.length;
check('入队 2 名步兵', RS.game.enqueueUnit(bar, 'infantry') && RS.game.enqueueUnit(bar, 'infantry'));
check('入队扣钱', RS.game.money === money0 - 200, '扣了 ' + (money0 - RS.game.money));
check('队列长度 2', bar.queue.length === 2);

run(3.5);
check('3 秒后第一名出厂', RS.game.units.length === units0 + 1 && bar.queue.length === 1);
run(3.5);
check('第二名出厂', RS.game.units.length === units0 + 2 && bar.queue.length === 0);

// 2. 取消退钱(矿车在背景持续挣钱,用相对值断言)
RS.game.enqueueUnit(bar, 'rocket');
const mBefore = RS.game.money;
check('取消最后一名退钱', RS.game.cancelLastUnit(bar) && RS.game.money === mBefore + 150);
check('队列为空', bar.queue.length === 0);

// 3. 集结点:新兵自动开赴
bar.rally = { x: 55, y: 80 };
RS.game.enqueueUnit(bar, 'rocket');
run(5);
const rk = RS.game.units[RS.game.units.length - 1];
check('集结点生效(新兵在途中)', rk.kind === 'rocket' && (rk.path || Math.hypot(rk.x - 55, rk.y - 80) < 8),
  'pos=(' + rk.x.toFixed(1) + ',' + rk.y.toFixed(1) + ')');

// 4. 战车工厂 + 矿车出厂自动采矿(不吃集结点)
check('工厂开工', RS.game.startConstruction('factory', 38, 104));
run(14);
const fac = RS.game.buildings.find(b => b.type === 'factory');
check('工厂完工', fac && fac.done);
const hv0 = RS.game.units.filter(u => u.kind === 'harvester').length;
fac.rally = { x: 55, y: 80 };
RS.game.enqueueUnit(fac, 'harvester');
run(9);
const hvNew = RS.game.units[RS.game.units.length - 1];
check('矿车出厂', RS.game.units.filter(u => u.kind === 'harvester').length === hv0 + 1);
check('矿车直接开工(锁定矿点而非集结点)', hvNew.kind === 'harvester' && hvNew.state !== 'idle' && !!hvNew.target,
  'state=' + hvNew.state + (hvNew.target ? ' target=(' + hvNew.target.i + ',' + hvNew.target.j + ')' : ''));
check('工厂可产坦克', RS.game.enqueueUnit(fac, 'lightTank'));
run(7);
check('轻坦出厂', RS.game.units[RS.game.units.length - 1].kind === 'lightTank');

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

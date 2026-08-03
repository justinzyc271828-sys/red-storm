/* 新手教学、探索后采矿、空中寻路回归。
 * 运行:node test/onboarding-test.js */
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
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function run(sec) {
  for (let t = 0; t < sec; t += STEP) RS.game.update(STEP);
}

// 1. 教学入口使用简单 AI,并按真实操作推进。
RS.game.init();
RS.game.startGame('tutorial');
check('新手教学启用且使用简单 AI',
  RS.game.tutorial && RS.game.tutorial.step === 0 && RS.game.difficulty === 'easy');
RS.game.tutorialAction('next');
const scout = RS.game.units.find(u => u.owner === 'player' && u.kind === 'infantry');
RS.game.selectOnly([scout]);
run(STEP);
check('选择单位后教学自动推进', RS.game.tutorial.step === 2);
RS.game.commandSmart(scout.x + 2, scout.y);
run(STEP);
check('下达移动命令后教学自动推进', RS.game.tutorial.step === 3);
RS.game.tutorialAction('skip');
check('教学可以随时关闭', RS.game.tutorial === null);

// 2. 完成全部教学后显示短暂总结并自动退出。
RS.game.init();
RS.game.startGame('tutorial');
run(STEP);
RS.game.tutorial.step = 6;
RS.game.tutorial.baseVisited = 0;
RS.map.visited.fill(0);
RS.map.visited.fill(1, 0, 180);
run(STEP);
check('完成最后一步后进入教学总结',
  RS.game.tutorial && RS.game.tutorial.step === 7 &&
  RS.game.tutorial.completedAt !== null);
run(3.8);
check('总结显示期间教学仍可见', RS.game.tutorial !== null);
run(0.3);
check('教学完成四秒后自动退出', RS.game.tutorial === null);

// 3. 玩家矿车不会自动锁定未探索矿脉,侦察后才恢复自动寻矿。
RS.game.init();
RS.ai.active = false;
const hv = RS.game.units.find(u => u.owner === 'player' && u.kind === 'harvester');
let remote = null;
for (let j = 10; j < 35 && !remote; j++)
  for (let i = 90; i < 118; i++)
    if (!RS.map.isBlocked(i, j)) { remote = { i, j }; break; }
for (const t of RS.map.oreTiles) {
  const tile = RS.map.at(t.i, t.j);
  if (tile) tile.ore = 0;
}
const rt = RS.map.at(remote.i, remote.j);
rt.ore = 300;
RS.map.oreTiles = [remote];
RS.map.visited = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H);
RS.map.visible = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H);
RS.map.enemyVisible = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H);
RS.game.units = [hv];
hv.state = 'toOre'; hv.target = null; hv.path = null; hv.manualIdle = false;
run(3);
check('未探索矿脉不会被自动锁定',
  !hv.target && hv.waitingForScout === true, 'state=' + hv.state);
RS.map.visited[remote.j * RS.config.MAP_W + remote.i] = 1;
hv.state = 'toOre'; hv.target = null;
run(STEP);
check('矿脉侦察后自动寻矿恢复',
  hv.target && hv.target.i === remote.i && hv.target.j === remote.j);

// 4. 战斗无人机不受地面阻挡寻路限制。
const drone = RS.game.spawnUnitAt('drone', 49.5, 50.5, 'player');
RS.map.setBlocked(50, 50, true);
RS.units.setPath(drone, 52.5, 50.5);
for (let t = 0; t < 1; t += STEP) RS.units.moveAlongPath(drone, STEP);
check('战斗无人机可越过地面阻挡', drone.x > 50.7, 'x=' + drone.x.toFixed(2));

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

/* M2a 测试:A* 寻路、编队指令、矿车回归。
 * 运行:node test/path-test.js */
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

// 1. A*:基地 → 中立矿区,路径存在且不穿越障碍
const N1 = RS.map.neutralOres[0];
const path = RS.units.findPath(34, 100, N1.i, N1.j);
check('A* 找到基地→中立矿路径', !!path, path ? path.length + ' 个路径点(平滑后)' : 'null');
if (path) {
  const blockedOnPath = path.some(c => RS.map.isBlocked(c.i, c.j));
  check('路径不穿越障碍', !blockedOnPath);
  check('路径长度合理', path.length < 120, path.length + ' 点');
}

// 2. 编队指令:5 个兵 → 目标点 (50,85),60 秒内全部到位
const squad = RS.game.units.filter(u => u.owner === 'player' && (u.kind === 'infantry' || u.kind === 'rocket'));
RS.game.selectOnly(squad);
check('选择集生效', RS.game.selection.size === 5);
RS.game.commandSmart(50, 85);
for (let t = 0; t < 60; t += STEP) RS.game.update(STEP);
let arrived = 0;
for (const u of squad) if (Math.hypot(u.x - 50, u.y - 85) < 6) arrived++;
check('编队 60 秒内到位', arrived === 5, arrived + '/5');

// 3. 矿车不受指挥干扰,持续采矿
const hv = RS.game.units.find(u => u.kind === 'harvester');
const tripsBefore = hv.trips;
for (let t = 0; t < 60; t += STEP) RS.game.update(STEP);
check('矿车持续往返', hv.trips > tripsBefore, (hv.trips - tripsBefore) + ' 趟/60s');

// 4. 手动指挥矿车:右键移动到 (40,95),到位后原地待命(新行为,不自动返回)
RS.game.selectOnly([hv]);
RS.game.commandSmart(40, 95);
for (let t = 0; t < 30; t += STEP) RS.game.update(STEP);
check('矿车手动移动后原地待命', hv.cmd === null && hv.state === 'idle', 'state=' + hv.state);

// 5. 点矿指令:指挥矿车去中立矿
RS.game.selectOnly([hv]);
if (RS.map.visited) RS.map.visited[N1.j * RS.config.MAP_W + N1.i] = 1; // 先侦察再下采矿令
RS.game.commandSmart(N1.i, N1.j);
check('点矿指令进入采矿状态', hv.state === 'toOre' && hv.target && Math.abs(hv.target.i - N1.i) <= 5 && Math.abs(hv.target.j - N1.j) <= 5,
  hv.target ? 'target=(' + hv.target.i + ',' + hv.target.j + ') 矿点=(' + N1.i + ',' + N1.j + ')' : 'no target');

// 6. 矿格认领:两辆矿车不堆同一矿格
RS.game.init();
const hvA = RS.game.units.find(u => u.owner === 'player' && u.kind === 'harvester');
const hvB = RS.game.spawnUnitAt('harvester', hvA.x + 1, hvA.y + 1, 'player');
for (let t = 0; t < 20; t += STEP) RS.game.update(STEP);
const sameTile = hvA.target && hvB.target && hvA.target.i === hvB.target.i && hvA.target.j === hvB.target.j;
check('两辆矿车分开采矿格', !sameTile,
  (hvA.target ? 'A=(' + hvA.target.i + ',' + hvA.target.j + ')' : 'A=(-)') + ' ' + (hvB.target ? 'B=(' + hvB.target.i + ',' + hvB.target.j + ')' : 'B=(-)'));

// 7. 点精炼厂 = 去卸矿(不是驻车)
const pref = RS.game.buildings.find(b => b.owner === 'player' && b.type === 'refinery');
hvA.load = 200;
RS.game.selectOnly([hvA]);
RS.game.commandSmart(pref.cx, pref.cy);
check('点精炼厂进入卸矿状态', hvA.state === 'toRefinery', 'state=' + hvA.state);

// 8. 软分离:人形单位即使从完全相同坐标开始，也会逐步散开；不使用刚性碰撞、不推入障碍。
RS.game.init();
RS.game.units = [];
const open = RS.units.nearestOpen(60, 60);
const packed = [];
for (let k = 0; k < 20; k++)
  packed.push(RS.game.spawnUnitAt(k % 3 ? 'infantry' : 'rocket', open.i + 0.5, open.j + 0.5, 'player'));
const countClosePairs = limit => {
  let n = 0;
  for (let a = 0; a < packed.length; a++)
    for (let b = a + 1; b < packed.length; b++)
      if (Math.hypot(packed[a].x - packed[b].x, packed[a].y - packed[b].y) < limit) n++;
  return n;
};
const packedBefore = countClosePairs(0.2);
for (let k = 0; k < 120; k++) RS.units.applySoftSeparation(packed, STEP);
const packedAfter = countClosePairs(0.2);
const pushedIntoWall = packed.some(u => {
  const t = RS.iso.tileOf(u.x, u.y);
  return RS.map.isBlocked(t.i, t.j);
});
check('20 名人形单位不会长期精确重叠',
  packedBefore === 190 && packedAfter === 0,
  '近重叠对 ' + packedBefore + ' → ' + packedAfter);
check('软分离不会把单位推入障碍', !pushedIntoWall);

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

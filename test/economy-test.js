/* 深层经济与经济袭扰回归测试。 */
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
function check(name, ok, detail) {
  console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
  if (!ok) failures++;
}
function run(sec) {
  for (let t = 0; t < sec; t += STEP) RS.game.update(STEP);
}
function depletedPatch(cx, cy, count, reset, clearTerrain) {
  const r = RS.config.deepEconomy.deployRadius;
  const cells = [];
  for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
    for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
      if (d > r) continue;
      const t = RS.map.at(i, j);
      if (!t) continue;
      cells.push({ i, j, d, t });
      t.ore = 0;
      if (reset) t.oreOrigin = false;
      if (clearTerrain !== false) {
        t.rock = false;
        t.d = 0;
        RS.map.setBlocked(i, j, false);
      }
    }
  cells.sort((a, b) => a.d - b.d);
  for (let k = 0; k < Math.min(count, cells.length); k++) {
    cells[k].t.oreOrigin = true;
    if (!RS.map.oreTiles.some(p => p.i === cells[k].i && p.j === cells[k].j))
      RS.map.oreTiles.push({ i: cells[k].i, j: cells[k].j });
  }
}

// 玩家钻探车：采空矿格自然解锁、耗电停产、三档增产、同矿区与总量限制。
RS.gameSeed = 1337;
RS.game.init();
RS.ai.active = false;
RS.map.visited = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H);
RS.game.units = RS.game.units.filter(u => u.kind !== 'harvester');
depletedPatch(45.5, 70.5, 11, true);
const rig = RS.game.spawnUnitAt('drillRig', 45.5, 70.5, 'player');
let status = RS.game.deepMineStatus(rig);
check('不足 12 个采空矿格不能展开',
  !status.valid && status.depleted === 11, status.reason);

depletedPatch(45.5, 70.5, 12, true);
status = RS.game.deepMineStatus(rig);
check('采空 12 格自然开放一档深钻',
  status.valid && status.tier === 1 && status.perMinute === 120,
  status.reason);
for (const pos of RS.map.oreTiles)
  if (Math.hypot(pos.i + 0.5 - rig.x, pos.j + 0.5 - rig.y) <= RS.config.deepEconomy.deployRadius)
    RS.map.visited[pos.j * RS.config.MAP_W + pos.i] = 1;
let guideSites = RS.game.deepMineSites('player', true, rig);
check('已探索采空矿区提供绿色展开候选',
  guideSites.length > 0 && guideSites[0].n === 2 && guideSites[0].m === 2,
  '候选=' + guideSites.length);
for (const pos of RS.map.oreTiles)
  if (Math.hypot(pos.i + 0.5 - rig.x, pos.j + 0.5 - rig.y) <= RS.config.deepEconomy.deployRadius)
    RS.map.visited[pos.j * RS.config.MAP_W + pos.i] = 0;
check('未探索采空矿区不会被绿色提示泄露',
  RS.game.deepMineSites('player', true, rig).length === 0);
for (let j = 66; j <= 79; j++) for (let i = 50; i <= 63; i++)
  RS.map.visited[j * RS.config.MAP_W + i] = 1;
const mine = RS.game.deployDrillRig(rig);
check('钻探车展开后转换为 2×2 深层开采站',
  mine && mine.type === 'deepMine' && !RS.game.units.includes(rig) &&
  mine.n === 2 && mine.m === 2);

const money0 = RS.game.money;
run(5.2);
check('缺电时深层开采完全停产',
  RS.game.money === money0 && mine.deepPowered === false,
  '$' + money0 + ' → $' + RS.game.money);

RS.game.placeStructure('power', 6, 6, 'player');
run(5.2);
check('恢复供电后一档每五秒收入 10',
  RS.game.money === money0 + 10 && mine.deepPowered === true,
  '$' + money0 + ' → $' + RS.game.money);

depletedPatch(mine.cx, mine.cy, 32, true, false);
run(STEP);
const info3 = RS.game.deepMineInfo(mine);
check('矿区继续枯竭后自动提升到三档',
  info3.tier === 3 && info3.perMinute === 240,
  '采空' + info3.depleted + '格 / $' + info3.perMinute + '每分');

const sameFieldRig = RS.game.spawnUnitAt('drillRig', mine.cx + 2, mine.cy + 1, 'player');
const sameField = RS.game.deepMineStatus(sameFieldRig);
check('同一片矿区不能堆第二座开采站',
  !sameField.valid && sameField.reason.includes('已有'), sameField.reason);
RS.game.units.splice(RS.game.units.indexOf(sameFieldRig), 1);

depletedPatch(88.5, 42.5, 32, true);
const rig2 = RS.game.spawnUnitAt('drillRig', 88.5, 42.5, 'player');
const mine2 = RS.game.deployDrillRig(rig2);
check('不同枯竭矿区允许部署第二座', !!mine2);
depletedPatch(108.5, 82.5, 32, true);
const rig3 = RS.game.spawnUnitAt('drillRig', 108.5, 82.5, 'player');
const cap = RS.game.deepMineStatus(rig3);
check('每方最多两座深层开采站',
  !cap.valid && cap.reason.includes('两座上限'), cap.reason);

// 无人机不加伤害：严格先打经济命脉，再打普通坦克/步兵，最后才考虑防空威胁。
RS.game.init();
RS.ai.active = false;
RS.game.units = [];
RS.map.visible = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H);
RS.map.enemyVisible = new Uint8Array(RS.config.MAP_W * RS.config.MAP_H);
RS.map.visible.fill(1);
RS.map.enemyVisible.fill(1);
const raidMine = RS.game.placeStructure('deepMine', 58, 58, 'player');
const raidPower = RS.game.placeStructure('power', 61, 58, 'player');
const raidTank = RS.game.spawnUnitAt('lightTank', 60.5, 61, 'player');
const raidInf = RS.game.spawnUnitAt('infantry', 59.5, 61.5, 'player');
const raidRocket = RS.game.spawnUnitAt('rocket', 60.5, 62, 'player');
const drone = RS.game.spawnUnitAt('drone', 60.5, 61.5, 'enemy');
drone.scanT = 0;
RS.combat.update(0.31);
check('无人机自动索敌优先深层经济建筑',
  drone.target === raidMine, drone.target && drone.target.type);
raidMine.destroyed = true;
raidPower.destroyed = true;
drone.target = null;
drone.scanT = 0;
RS.combat.update(0.31);
check('无经济目标后优先坦克或步兵而非火箭兵',
  (drone.target === raidTank || drone.target === raidInf) && drone.target !== raidRocket,
  drone.target && drone.target.kind);

// 敌方袭扰航路只根据已侦察防空区绕行，直线安全时才直接飞。
RS.game.init();
RS.ai.init('normal');
RS.game.units = [];
RS.game.buildings = [];
const routeDrone = RS.game.spawnUnitAt('drone', 40, 50, 'enemy');
const routeTarget = RS.game.placeStructure('deepMine', 69, 49, 'player');
const routeTurret = RS.game.placeStructure('turret', 54, 49, 'player');
RS.ai.known.add(routeTarget);
RS.ai.known.add(routeTurret);
const route = RS.ai.planDroneRaidPath(routeDrone, routeTarget);
check('已发现炮塔挡住直线时无人机生成绕行航点',
  route.length > 1 && Math.abs(route[0].y - routeDrone.y) > 1,
  JSON.stringify(route));

// AI 在看见残骸/枯竭矿区后才投入维修车和钻探车，不使用时间解锁。
RS.game.init();
RS.game.startGame('normal');
const factory = RS.game.placeStructure('factory', 78, 78, 'enemy');
RS.ai.wallet.money = 5000;
const wreck = { x: 82.5, y: 82.5, hp: 0, maxHp: 150, isDerelict: true, vehicle: true };
RS.game.derelicts = [wreck];
RS.game.spawnUnitAt('infantry', 82.5, 81.5, 'enemy');
RS.ai.update(1);
check('AI 看见坠毁无人机后生产维修车争夺',
  factory.queue.includes('repair'), factory.queue.join(','));

factory.queue = [];
factory.prodProgress = 0;
RS.game.derelicts = [];
RS.ai.knownDerelicts.clear();
depletedPatch(70.5, 82.5, 12, true);
RS.ai.update(1.1);
check('AI 不会因时间到点就在一档矿区盲投钻探车',
  !factory.queue.includes('drillRig'), factory.queue.join(','));

factory.queue = [];
factory.prodProgress = 0;
depletedPatch(66.5, 86.5, 32, true);
RS.ai.update(1.1);
check('AI 发现枯竭矿区后生产深层钻探车',
  factory.queue.includes('drillRig'), factory.queue.join(','));

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

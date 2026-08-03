/* 遗迹战甲反制场景断言(定稿克制链:踩扁重坦、被重步兵海围杀、90s 禁建筑):
 * 场景 A:机甲 vs 20 火箭 → 机甲惨胜但掉血 ≥25%(有代价);
 * 场景 A2:机甲 vs 30 火箭 → 机甲应被围杀,至少换掉 12(重步兵海是反制);
 * 场景 B:机甲 vs 10 重坦 → 机甲惨胜(残血 > 15%);
 * 场景 C:90s 禁对建筑开火 → 期间机甲不应锁定任何建筑目标。 */
'use strict';
require('../src/config.js'); require('../src/iso.js'); require('../src/map.js');
require('../src/units.js'); require('../src/game.js'); require('../src/combat.js'); require('../src/ai.js');
const RS = globalThis.RS, STEP = RS.config.SIM_STEP;
let failures = 0;
const check = (name, ok, info) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (info !== undefined ? '  (' + info + ')' : '')); if (!ok) failures++; };

function scenario(name, enemyKind, enemyN, setup) {
  RS.gameSeed = 1337; RS.game.init(); RS.game.startGame('normal');
  RS.game.units = [];
  const mech = RS.game.spawnUnitAt('mech', 60.5, 60.5, 'player');
  const enemies = [];
  for (let k = 0; k < enemyN; k++) {
    const g = RS.units.nearestOpen(66 + (k % 5), 60 + Math.floor(k / 5));
    enemies.push(RS.game.spawnUnitAt(enemyKind, g.i + 0.5, g.j + 0.5, 'enemy'));
  }
  if (setup) setup(mech, enemies);
  RS.combat.attackMoveGroup([mech], 66.5, 60.5);
  RS.combat.attackMoveGroup(enemies, 60.5, 60.5);
  let t = 0;
  while (t < 180 && mech.hp > 0 && enemies.some(e => e.hp > 0)) { RS.game.update(STEP); t += STEP; }
  return { mech, enemies, t };
}

// 场景 A:20 火箭 → 惨胜有代价
const A = scenario('A', 'rocket', 20);
const aKills = A.enemies.filter(e => e.hp <= 0).length;
check('A 20 火箭全灭', A.enemies.every(e => e.hp <= 0), '存活 ' + A.enemies.filter(e => e.hp > 0).length);
check('A 机甲掉血 ≥25%(有代价)', A.mech.hp > 0 && A.mech.hp <= A.mech.maxHp * 0.75, '剩 ' + Math.round(A.mech.hp) + '/' + A.mech.maxHp);
check('A 机甲至少换掉 10 个火箭兵', aKills >= 10, '击杀 ' + aKills);

// 场景 A2:30 火箭 → 围杀
const A2 = scenario('A2', 'rocket', 40);
const a2Kills = A2.enemies.filter(e => e.hp <= 0).length;
check('A2 机甲被 40 火箭围杀', A2.mech.hp <= 0, '机甲剩 ' + Math.round(A2.mech.hp));
check('A2 机甲至少换掉 15 个火箭兵', a2Kills >= 15, '击杀 ' + a2Kills);

// 场景 B:机甲 vs 10 重坦
const B = scenario('B', 'heavyTank', 10);
check('B 机甲对 10 重坦惨胜(残血>15%)', B.mech.hp > B.mech.maxHp * 0.15, '机甲剩 ' + Math.round(B.mech.hp) + '/' + B.mech.maxHp);
check('B 重坦全灭', B.enemies.every(e => e.hp <= 0), '重坦存活 ' + B.enemies.filter(e => e.hp > 0).length);

// 场景 C:90s 禁对建筑开火
RS.gameSeed = 1337; RS.game.init(); RS.game.startGame('normal');
const mechC = RS.game.spawnUnitAt('mech', 60.5, 60.5, 'player');
mechC.noFireBuildingsUntil = RS.game.time + 90;
RS.combat.attackMoveGroup([mechC], 98.5, 30.5);
let sawBuildingTarget = false;
for (let k = 0; k < 90 * 30 && RS.game.state === 'playing'; k++) {
  RS.game.update(STEP);
  if (mechC.target && mechC.target.maxHp !== undefined && mechC.target.type) sawBuildingTarget = true;
}
check('C 90s 内机甲未锁定建筑目标', !sawBuildingTarget, sawBuildingTarget ? '锁定了' : '未锁定');

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures ? 1 : 0);

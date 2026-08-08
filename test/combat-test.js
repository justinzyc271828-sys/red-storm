/* M3a 测试:克制链、溅射、炮塔、建筑摧毁、还击、穿模回归。
 * 运行:node test/combat-test.js */
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

const STEP = RS.config.SIM_STEP;
const run = sec => { for (let t = 0; t < sec; t += STEP) RS.game.update(STEP); };
const fresh = () => { RS.game.init(); RS.combat.projectiles = []; RS.combat.explosions = []; };

// 1. 克制链:3 火箭兵胜 1 轻坦;3 步兵负于轻坦(引用追踪,排除初始卫队干扰)
fresh();
const r1 = RS.game.spawnUnitAt('rocket', 50, 50, 'player');
const r2 = RS.game.spawnUnitAt('rocket', 50.8, 50.5, 'player');
const r3 = RS.game.spawnUnitAt('rocket', 50.4, 51, 'player');
const t1 = RS.game.spawnUnitAt('lightTank', 54, 50, 'enemy');
run(15);
check('火箭兵克制轻坦', t1.hp <= 0 && [r1, r2, r3].filter(u => u.hp > 0).length >= 2,
  '火箭兵存活 ' + [r1, r2, r3].filter(u => u.hp > 0).length + '/3');
fresh();
const i1 = RS.game.spawnUnitAt('infantry', 50, 50, 'player');
const i2 = RS.game.spawnUnitAt('infantry', 50.8, 50, 'player');
const i3 = RS.game.spawnUnitAt('infantry', 50.4, 50.8, 'player');
const t2 = RS.game.spawnUnitAt('lightTank', 53, 50, 'enemy');
run(25);
check('轻坦压制步兵', t2.hp > 0 && [i1, i2, i3].every(u => u.hp <= 0),
  '坦克余血 ' + Math.round(t2.hp) + ',步兵全灭=' + [i1, i2, i3].every(u => u.hp <= 0));

// 2. 火炮溅射
fresh();
RS.game.spawnUnitAt('artillery', 50, 50, 'player');
const e1 = RS.game.spawnUnitAt('infantry', 56.5, 50, 'enemy');
const e2 = RS.game.spawnUnitAt('infantry', 57, 51, 'enemy');
const e3 = RS.game.spawnUnitAt('infantry', 56.2, 50.9, 'enemy');
run(12);
{
  const hpSum = [e1, e2, e3].reduce((s, u) => s + Math.max(0, u.hp), 0);
check('火炮溅射覆盖集群', hpSum < 120, '三人总余血 ' + Math.round(hpSum) + '/180');
}

// 2b. 火炮主目标移动出直击点但仍在爆区内,必须受到溅射而不是稳定 0 伤害
fresh();
const artyMove = RS.game.spawnUnitAt('artillery', 50, 50, 'player');
const slowMove = RS.game.spawnUnitAt('heavyTank', 57.5, 50, 'enemy');
RS.combat.attackCommand([artyMove], slowMove);
for (let t = 0; t < 1.2; t += STEP) {
  slowMove.y += slowMove.speed * STEP;
  RS.combat.update(STEP);
}
check('火炮爆区能伤到移动中的主目标',
  slowMove.hp < slowMove.maxHp && slowMove.hp > slowMove.maxHp - RS.units.TYPES.artillery.dmg,
  '重坦余血 ' + Math.round(slowMove.hp) + '/' + slowMove.maxHp);

// 3. 防御炮塔自动索敌(先补电,防缺电停摆)
fresh();
RS.game.placeStructure('power', 38, 90, 'player');
RS.game.placeStructure('turret', 40, 90, 'player');
RS.game.spawnUnitAt('infantry', 44.5, 90.5, 'enemy');
run(8);
check('炮塔自动击杀来犯敌人', !RS.game.units.some(u => u.owner === 'enemy' && u.kind === 'infantry' && u.hp > 0 && u.x > 40 && u.x < 50));

// 4. 火炮远程拆建筑(射程 8 > 炮塔 6,不受反击)
fresh();
const arty = RS.game.spawnUnitAt('artillery', 106.5, 38.5, 'player');
const ref = RS.game.buildings.find(b => b.owner === 'enemy' && b.type === 'refinery');
const siegeScout = RS.game.spawnUnitAt('repair', ref.cx + 4, ref.cy, 'player');
siegeScout.hp = siegeScout.maxHp = 999999; // 为远程攻城提供持续侦察，不让本测试退化成隔雾攻击
RS.combat.attackCommand([arty], ref);
run(75);
check('敌方精炼厂被摧毁', ref.destroyed === true);
check('建筑残骸不再阻挡', !RS.map.isBlocked(101, 34));

// 5. 还击:被打后反咬攻击者(自行火炮射程外白嫖→坦克反冲;在坦克反杀前断言)
fresh();
const arty2 = RS.game.spawnUnitAt('artillery', 50, 50, 'player');
const tank2 = RS.game.spawnUnitAt('heavyTank', 56.5, 50, 'enemy'); // 视野内且超出坦克索敌 4.5
RS.combat.attackCommand([arty2], tank2);
run(4);
check('挨打单位还击并获得目标', tank2.target === arty2,
  'target=' + (tank2.target ? tank2.target.kind : '无') + ',坦克余血 ' + Math.round(tank2.hp));

// 6. 穿模回归
fresh();
RS.map.setBlocked(50, 50, true); RS.map.setBlocked(51, 51, true);
check('对角石缝不可挤过', RS.units._los({ i: 50, j: 51 }, { i: 51, j: 50 }) === false);
RS.map.setBlocked(50, 50, false); RS.map.setBlocked(51, 51, false);
check('拆除后恢复可视', RS.units._los({ i: 50, j: 51 }, { i: 51, j: 50 }) === true);

// 石墙必须绕行,全程不得踏入阻挡格
RS.map.setBlocked(50, 89, true); RS.map.setBlocked(50, 90, true); RS.map.setBlocked(50, 91, true);
const walker = RS.game.spawnUnitAt('infantry', 45.5, 90.5, 'player');
RS.units.setPath(walker, 55.5, 90.5);
let clipped = false;
for (let t = 0; t < 30 && walker.path; t += STEP) {
  RS.units.moveAlongPath(walker, STEP);
  const ti = RS.iso.tileOf(walker.x, walker.y);
  if (RS.map.isBlocked(ti.i, ti.j)) clipped = true;
}
check('绕石墙全程无穿模', !clipped && Math.hypot(walker.x - 55.5, walker.y - 90.5) < 1.5,
  '落点=(' + walker.x.toFixed(1) + ',' + walker.y.toFixed(1) + ')');
RS.map.setBlocked(50, 89, false); RS.map.setBlocked(50, 90, false); RS.map.setBlocked(50, 91, false);

// 7. 远距离攻击指令不得绕过当前视野
fresh();
const atk = RS.game.spawnUnitAt('heavyTank', 40, 90, 'player');
const foe = RS.game.spawnUnitAt('infantry', 65, 90, 'enemy'); // 25 格,远超射程×3
RS.combat.attackCommand([atk], foe);
const atkX0 = atk.x;
run(1);
check('内部攻击指令也不能追击视野外敌人',
  !atk.target && Math.abs(atk.x - atkX0) < 0.1 && foe.hp === foe.maxHp,
  'target=' + !!atk.target + ' 位移=' + (atk.x - atkX0).toFixed(2));

// 8. 路径被新建筑堵死 → 自动重新寻路绕行到达
fresh();
const w2 = RS.game.spawnUnitAt('infantry', 45.5, 90.5, 'player');
RS.units.setPath(w2, 55.5, 90.5);
run(0.5);
RS.game.money = 9999;
RS.game.startConstruction('turret', 50, 90); // 正落在直线路径上
let clipped2 = false;
for (let t = 0; t < 30 && (w2.path || w2.dest); t += STEP) {
  RS.game.update(STEP);
  const ti = RS.iso.tileOf(w2.x, w2.y);
  if (RS.map.isBlocked(ti.i, ti.j)) clipped2 = true;
}
check('受阻后自动绕路到达', !clipped2 && Math.hypot(w2.x - 55.5, w2.y - 90.5) < 2,
  '落点=(' + w2.x.toFixed(1) + ',' + w2.y.toFixed(1) + ')');

// 9. 矿车手动移动:到位后原地待命,不自动返回矿点
fresh();
const hv9 = RS.game.units.find(u => u.kind === 'harvester');
RS.game.selectOnly([hv9]);
RS.game.commandSmart(40, 99);
for (let t = 0; t < 15 && hv9.cmd === 'move'; t += STEP) RS.game.update(STEP);
RS.game.update(STEP);
check('矿车到位后待命不返回', hv9.state === 'idle' && hv9.cmd === null, 'state=' + hv9.state);

// 10. 喷火战车:反步兵海,反装甲无力
fresh();
RS.game.spawnUnitAt('flametank', 50, 50, 'player');
const f1 = RS.game.spawnUnitAt('infantry', 52, 50, 'enemy');
const f2 = RS.game.spawnUnitAt('infantry', 52.5, 50.8, 'enemy');
const f3 = RS.game.spawnUnitAt('infantry', 52.2, 49.5, 'enemy');
run(8);
check('喷火战车烧步兵海', [f1, f2, f3].every(u => u.hp <= 0),
  '步兵存活 ' + [f1, f2, f3].filter(u => u.hp > 0).length + '/3');
fresh();
RS.game.spawnUnitAt('flametank', 50, 50, 'player');
const hvA = RS.game.spawnUnitAt('heavyTank', 52.5, 50, 'enemy');
run(10);
check('喷火对重坦挠痒痒', hvA.hp > hvA.maxHp * 0.5, '重坦余血 ' + Math.round(hvA.hp));

// 11. 维修车:车辆按最大耐久缩放维修,也能修已完工建筑;火炮自身绝不回血
fresh();
const loneArty = RS.game.spawnUnitAt('artillery', 50, 50, 'player');
loneArty.hp = 30;
run(5);
check('自行火炮无维修车时不会自动回血', loneArty.hp === 30, 'hp=' + loneArty.hp);

fresh();
RS.game.spawnUnitAt('repair', 50, 50, 'player');
const dmgT = RS.game.spawnUnitAt('heavyTank', 52, 50, 'player');
dmgT.hp = 100;
run(10);
check('维修车对重型车辆有明显价值', dmgT.hp > 260, 'hp=' + Math.round(dmgT.hp));
const rp2 = RS.game.spawnUnitAt('repair', 60, 60, 'player'); // 远处第二辆,验证不误修
run(2);
check('超范围不维修', rp2.repTarget == null, '远处维修车目标=' + (rp2.repTarget ? '有' : '无'));

fresh();
RS.game.spawnUnitAt('repair', 50, 50, 'player');
const supportedArty = RS.game.spawnUnitAt('artillery', 52, 50, 'player');
supportedArty.hp = 30;
run(5);
check('火炮回血明确来自维修车且不再六秒灌满',
  supportedArty.hp > 55 && supportedArty.hp < 75,
  'hp=' + Math.round(supportedArty.hp) + '/' + supportedArty.maxHp);

fresh();
RS.game.spawnUnitAt('repair', 50, 50, 'player');
const damagedTurret = RS.game.placeStructure('turret', 52, 50, 'player', true);
damagedTurret.hp = 100;
run(10);
check('维修车可修复已完工建筑', damagedTurret.hp >= 155 && damagedTurret.hp <= 165,
  '炮塔 hp=' + Math.round(damagedTurret.hp));

// 11b. 指挥中心:维修车无效,脱战 10 秒后才以 2/秒缓慢自修
fresh();
const cc11 = RS.game.buildings.find(b => b.owner === 'player' && b.type === 'cc');
cc11.hp = 1000;
cc11.lastDamageT = RS.game.time;
const ccRepairers = [
  RS.game.spawnUnitAt('repair', cc11.cx + 4, cc11.cy, 'player'),
  RS.game.spawnUnitAt('repair', cc11.cx - 4, cc11.cy, 'player'),
  RS.game.spawnUnitAt('repair', cc11.cx, cc11.cy + 4, 'player'),
];
ccRepairers[0].repTarget = cc11;
ccRepairers[0].repT = 99; // 即便残留/强塞目标也必须在下一帧清掉
run(5);
check('指挥中心拒绝维修车且不能靠多车叠修',
  cc11.hp === 1000 && ccRepairers.every(u => u.repTarget !== cc11),
  'hp=' + cc11.hp + ' 锁定数=' + ccRepairers.filter(u => u.repTarget === cc11).length);
run(6);
check('指挥中心脱战后缓慢自修',
  cc11.hp > 1000 && cc11.hp < 1005 && cc11.selfRepairFxT > 0,
  'hp=' + cc11.hp.toFixed(1));

// 12. 坠毁无人机:维修车修满回收为战斗无人机,残骸恢复通行
fresh();
RS.game.derelicts = [{ x: 52, y: 50, hp: 0, maxHp: 150, isDerelict: true, vehicle: true }];
RS.map.setBlocked(52, 50, true);
RS.game.spawnUnitAt('repair', 50, 50, 'player');
run(12);
check('坠毁无人机修满变战斗无人机',
  RS.game.units.some(u => u.kind === 'drone' && Math.hypot(u.x - 52, u.y - 50) < 1.5) && RS.game.derelicts.length === 0,
  'derelicts 剩 ' + RS.game.derelicts.length);
check('残骸清除后恢复通行', !RS.map.isBlocked(52, 50));

// 12b. 空中目标规则:普通地面部队不能锁定；火箭兵、无人机、战甲与炮塔可以。
fresh();
const airTarget = RS.game.spawnUnitAt('drone', 53, 50, 'enemy');
const groundInf = RS.game.spawnUnitAt('infantry', 50, 50, 'player');
const groundTank = RS.game.spawnUnitAt('lightTank', 50, 51, 'player');
const groundArty = RS.game.spawnUnitAt('artillery', 49, 51, 'player');
const groundFlame = RS.game.spawnUnitAt('flametank', 49, 50, 'player');
const aaRocket = RS.game.spawnUnitAt('rocket', 50, 49, 'player');
const aaDrone = RS.game.spawnUnitAt('drone', 51, 49, 'player');
const aaMech = RS.game.spawnUnitAt('mech', 51, 51, 'player');
const assignedAir = RS.combat.attackCommand(
  [groundInf, groundTank, groundArty, groundFlame, aaRocket, aaDrone, aaMech], airTarget);
check('对空权限矩阵只开放火箭兵、无人机与遗迹战甲',
  assignedAir === 3 && aaRocket.target === airTarget && aaDrone.target === airTarget &&
  aaMech.target === airTarget && !groundInf.target && !groundTank.target &&
  !groundArty.target && !groundFlame.target,
  'assigned=' + assignedAir);
RS.game.units = RS.game.units.filter(u =>
  u !== aaRocket && u !== aaDrone && u !== aaMech && u !== airTarget);
const turretAir = RS.game.spawnUnitAt('drone', 53, 53, 'enemy');
RS.game.placeStructure('power', 46, 46, 'player', true);
const aaTurret = RS.game.placeStructure('turret', 49, 52, 'player', true);
run(1);
check('防御炮塔能够自动锁定空中目标',
  aaTurret.target === turretAir || RS.combat.projectiles.some(p => p.shooter === aaTurret));

fresh();
const droneDuelP = RS.game.spawnUnitAt('drone', 50, 50, 'player');
const droneDuelE = RS.game.spawnUnitAt('drone', 53, 50, 'enemy');
run(1.2);
check('敌我战斗无人机能够自动互相攻击',
  droneDuelP.hp < droneDuelP.maxHp && droneDuelE.hp < droneDuelE.maxHp,
  '我=' + droneDuelP.hp + ' 敌=' + droneDuelE.hp);

// 13. 炮塔射程复验:目标跑出射程即放手,不越图狙杀
fresh();
RS.game.placeStructure('power', 46, 46, 'player', true); // 补电,炮塔才工作
const tur = RS.game.placeStructure('turret', 50, 50, 'player', true);
const prey = RS.game.spawnUnitAt('infantry', tur.cx + 5, tur.cy, 'enemy');
run(1.5);
check('炮塔锁定射程内目标', tur.target === prey);
RS.units.setPath(prey, tur.cx + 30, tur.cy);
run(4);
check('目标跑出射程炮塔放手', tur.target !== prey, 'target=' + (tur.target ? '仍锁定' : '已放手'));

// 13b. 炮塔耐久提升后仍保留明确克制:重坦险胜,自行火炮射程外拆塔
fresh();
RS.game.placeStructure('power', 46, 46, 'player', true);
const durableTurret = RS.game.placeStructure('turret', 50, 50, 'player', true);
const duelHeavy = RS.game.spawnUnitAt('heavyTank', 54, 50, 'enemy');
run(30);
check('450 血炮塔不再纸脆但仍会被重坦险胜',
  durableTurret.hp <= 0 && duelHeavy.hp > 0 && duelHeavy.hp < 100,
  '炮塔=' + Math.round(durableTurret.hp) + ' 重坦=' + Math.round(duelHeavy.hp));

fresh();
RS.game.placeStructure('power', 46, 46, 'player', true);
const siegeTurret = RS.game.placeStructure('turret', 50, 50, 'player', true);
const siegeArty = RS.game.spawnUnitAt('artillery', 58, 50, 'enemy');
const siegeSpotter = RS.game.spawnUnitAt('repair', 55, 50, 'enemy');
siegeSpotter.hp = siegeSpotter.maxHp = 999999; // 火炮需要前线视野，维修车承担观察手
run(10);
check('自行火炮保持射程外克制防御炮塔',
  siegeTurret.hp <= 0 && siegeArty.hp > 0,
  '炮塔=' + Math.round(siegeTurret.hp) + ' 火炮=' + Math.round(siegeArty.hp));

// 14. 火炮贴脸不空追(minRange 内放弃目标)
fresh();
const artyE = RS.game.spawnUnitAt('artillery', 50, 50, 'enemy');
const melee = RS.game.spawnUnitAt('lightTank', 51, 50, 'player'); // 距离 1 < minRange 2
melee.target = artyE; melee.aggro = 'cmd';
run(3);
check('火炮被贴脸不空追', !artyE.target && Math.hypot(artyE.x - 50, artyE.y - 50) < 0.5,
  artyE.target ? '仍在追' : '原地不动');

// 15. aggro 追击速度 = 面板(无双倍速回归)
fresh();
const chaser = RS.game.spawnUnitAt('lightTank', 50, 50, 'enemy');
const runner = RS.game.spawnUnitAt('infantry', 56.8, 50, 'player');
chaser.target = runner; chaser.aggro = true;
const cx0 = chaser.x;
run(1);
check('追击一秒 ≈ 2.8 格', Math.abs((chaser.x - cx0) - 2.8) < 0.4, (chaser.x - cx0).toFixed(2) + ' 格');

// 16. 攻击移动目标点阻挡:走到邻位即完成推进,不死锁不刷屏
fresh();
const stuck = RS.game.spawnUnitAt('lightTank', 50, 50, 'enemy');
// 用建筑围死目标点本身(寻路会把终点对齐到最近可达格)
for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) RS.map.setBlocked(70 + a, 60 + b, true);
RS.combat.attackMoveGroup([stuck], 70.5, 60.5);
const t0 = Date.now();
run(15);
const cost = Date.now() - t0;
check('到邻位完成推进(不死锁)', !stuck.attackMove, 'attackMove=' + !!stuck.attackMove + ' pos=' + stuck.x.toFixed(1) + ',' + stuck.y.toFixed(1));
check('仿真不因 A* 刷屏卡死', cost < 3000, cost + 'ms / 15s 仿真');

// 17. 炮塔转向瞄准:首个目标也必须先转到位,不能瞬移炮管并在同帧开火
fresh();
RS.game.placeStructure('power', 46, 46, 'player', true);
const tur2 = RS.game.placeStructure('turret', 50, 50, 'player', true);
const tur2Aim0 = tur2.aim;
const tur2Prey = RS.game.spawnUnitAt('infantry', tur2.cx + 5, tur2.cy, 'enemy');
RS.game.update(STEP);
check('炮塔自动锁定射程内敌人', tur2.target === tur2Prey);
check('炮管按转速开始转向而非瞬移', tur2.aim !== tur2Aim0 && Math.abs(tur2.aim - tur2Aim0) <= RS.config.buildings.turret.weapon.turnRate * STEP + 1e-6,
  '转角=' + Math.abs(tur2.aim - tur2Aim0).toFixed(3));
check('未瞄准时禁止提前开火', RS.combat.projectiles.length === 0 && tur2.cool === 0);
let tur2Shot = null;
for (let t = 0; t < 1 && !tur2Shot; t += STEP) {
  RS.game.update(STEP);
  tur2Shot = RS.combat.projectiles.find(p => p.shooter === tur2) || null;
}
check('炮塔获得当前瞄准朝向', tur2.aimDir === RS.iso.dir8(Math.cos(tur2.aim), Math.sin(tur2.aim)),
  'aim=' + tur2.aim.toFixed(2) + ' dir=' + tur2.aimDir);
check('瞄准完成后从炮口开火', tur2.cool > 0 && tur2Shot && Math.hypot(tur2Shot.x - tur2.cx, tur2Shot.y - tur2.cy) > 0.8,
  'cool=' + (tur2.cool || 0).toFixed(2));

// 17b. 敌方炮塔使用同一套自动索敌/瞄准/开火逻辑
fresh();
RS.game.placeStructure('power', 66, 66, 'enemy', true);
const enemyTur = RS.game.placeStructure('turret', 70, 70, 'enemy', true);
const playerPrey = RS.game.spawnUnitAt('infantry', enemyTur.cx - 5, enemyTur.cy, 'player');
run(1);
check('敌方炮塔也会自动瞄准并开火', enemyTur.target === playerPrey && enemyTur.cool > 0,
  'target=' + (enemyTur.target === playerPrey) + ' cool=' + (enemyTur.cool || 0).toFixed(2));

// 17c. 炮塔最差大角度转向也要在半秒内回应,避免视觉上发呆
fresh();
RS.game.placeStructure('power', 46, 46, 'player', true);
const fastTur = RS.game.placeStructure('turret', 50, 50, 'player', true);
fastTur.aim = 0;
const rearPrey = RS.game.spawnUnitAt('infantry', fastTur.cx - 5, fastTur.cy, 'enemy');
let responseT = 0;
for (; responseT < 1 && !RS.combat.projectiles.some(p => p.shooter === fastTur); responseT += STEP) RS.game.update(STEP);
check('炮塔大角度转向半秒内开火', responseT <= 0.5 && fastTur.target === rearPrey,
  '响应 ' + responseT.toFixed(2) + 's');

// 18. 穿雾锁敌封堵:迷雾中的敌人不可被右键攻击锁定(渲染层防雾,指令层同规则)
fresh();
const fogTgt = RS.game.spawnUnitAt('lightTank', 100, 20, 'enemy'); // 远离玩家,未探索
const fogSel = RS.game.spawnUnitAt('lightTank', 31, 98, 'player');
RS.game.selectOnly([fogSel]);
run(1); // 探索刷新一次(迷雾数据就绪)
const fogOk = RS.game.commandAttack(100.5, 20.5);
check('穿雾锁定被拒绝(退化移动)', !fogOk && !fogSel.target, 'commandAttack=' + fogOk);
const visTgt = RS.game.spawnUnitAt('infantry', 34, 96, 'enemy'); // 玩家基地视野内
run(0.6);
const visOk = RS.game.commandAttack(34.2, 96.2);
check('视野内敌人正常锁定', visOk && fogSel.target === visTgt, 'target=' + (fogSel.target && fogSel.target.kind));

// 18b. 自动索敌/持续开火同样只认当前视野，不能靠武器射程多出来的一格穿雾
fresh();
const fogArty = RS.game.spawnUnitAt('artillery', 50, 50, 'player');
const edgeEnemy = RS.game.spawnUnitAt('infantry', 57.2, 52.4, 'enemy'); // 射程内，但所在格在 7 格车辆视野外
run(0.7);
check('自动索敌不会锁定当前视野外敌人',
  !fogArty.target && !RS.combat.projectiles.some(p => p.shooter === fogArty),
  'target=' + !!fogArty.target);
edgeEnemy.x = 56; edgeEnemy.y = 52;
run(0.7);
check('敌人进入当前视野后可正常自动开火',
  fogArty.target === edgeEnemy || RS.combat.projectiles.some(p => p.shooter === fogArty));
edgeEnemy.x = 57.2; edgeEnemy.y = 52.4;
fogArty.cool = 0;
RS.combat.projectiles = [];
run(0.7);
check('目标离开当前视野后立即停止锁定和续射',
  !fogArty.target && !RS.combat.projectiles.some(p => p.shooter === fogArty),
  'target=' + !!fogArty.target);

// 18c. 敌方也服从自己的对等视野，不能保留单方面开天眼
fresh();
const enemyFogArty = RS.game.spawnUnitAt('artillery', 50, 50, 'enemy');
const playerEdge = RS.game.spawnUnitAt('infantry', 57.2, 52.4, 'player');
run(0.7);
check('敌方自动战斗同样不能锁定其视野外目标',
  !enemyFogArty.target && !RS.combat.projectiles.some(p => p.shooter === enemyFogArty),
  'target=' + !!enemyFogArty.target);
playerEdge.x = 56; playerEdge.y = 52;
run(0.7);
check('目标进入敌方对等视野后可正常开火',
  enemyFogArty.target === playerEdge || RS.combat.projectiles.some(p => p.shooter === enemyFogArty));

// 19. 改令清 attackMove:普通移动与点杀都不得残留旧攻击移动
fresh();
const am1 = RS.game.spawnUnitAt('lightTank', 50, 50, 'player');
RS.combat.attackMoveGroup([am1], 60, 60);
RS.game.selectOnly([am1]);
RS.game.commandSmart(45, 45);
check('普通移动清除 attackMove', !am1.attackMove, 'attackMove=' + !!am1.attackMove);
const am2t = RS.game.spawnUnitAt('infantry', 52, 50, 'enemy');
RS.combat.attackMoveGroup([am1], 60, 60);
RS.combat.attackCommand([am1], am2t);
check('点杀指令清除 attackMove', !am1.attackMove && am1.target === am2t);

// 20. 建筑被毁队列全额退款(与手动取消同一约定:钱不蒸发)
fresh();
RS.game.money = 5000;
const rf = RS.game.placeStructure('factory', 40, 90, 'player', true);
RS.game.enqueueUnit(rf, 'heavyTank');
RS.game.enqueueUnit(rf, 'lightTank');
const mBefore = RS.game.money;
RS.combat.destroyBuilding(rf);
check('工厂被毁队列全额退款', RS.game.money === mBefore + RS.units.TYPES.heavyTank.cost + RS.units.TYPES.lightTank.cost,
  Math.round(mBefore) + ' → ' + Math.round(RS.game.money));

// 21. 维修车不治尸体(坠毁无人机 hp=0 起步是合法目标,不受影响)
fresh();
const rep = RS.game.spawnUnitAt('repair', 50, 50, 'player');
const wreck = RS.game.spawnUnitAt('lightTank', 51, 50, 'player');
wreck.hp = 0;
rep.repTarget = wreck; rep.repT = 99; // 锁住重选,只看清除条件
RS.game.update(STEP);
check('死亡单位被放弃治疗', rep.repTarget === null, 'repTarget=' + !!rep.repTarget);

// 22. 配乐敌情源:敌军进入当前视野即接战,离开后保留短暂尾奏而不瞬间跳回
fresh();
const contactScout = RS.game.units.find(u => u.owner === 'player' && u.kind === 'infantry');
const contactEnemy = RS.game.spawnUnitAt('infantry', contactScout.x + 5.4, contactScout.y, 'enemy');
RS.game.update(STEP);
check('敌军进入视野被敌情状态捕获',
  RS.game.enemyVisible && RS.game.enemyContactUntil > RS.game.time);
contactEnemy.x = 10; contactEnemy.y = 10;
run(0.6);
check('敌军离开视野后进入八秒脱战保持',
  !RS.game.enemyVisible && RS.game.enemyContactUntil > RS.game.time);

// 23. 混编途中改攻击令:旧编队最慢速不残留,快车恢复面板速度(三轮验收 P1-04)
fresh();
const lt23 = RS.game.spawnUnitAt('lightTank', 50, 50, 'player');
const ar23 = RS.game.spawnUnitAt('artillery', 50.5, 50, 'player');
RS.game.selectOnly([lt23, ar23]);
RS.game.commandSmart(76, 50); // 编队移动:groupSpeed = min(2.8, 1.4) = 1.4
run(3);
check('编队移动中 groupSpeed=1.4', lt23.groupSpeed === 1.4, 'gs=' + lt23.groupSpeed);
const tgt23 = RS.game.spawnUnitAt('heavyTank', lt23.x + 7, lt23.y, 'enemy'); // 处于轻坦当前视野边缘
RS.map.visible[Math.floor(tgt23.y) * RS.config.MAP_W + Math.floor(tgt23.x)] = 1;
RS.combat.attackCommand([lt23], tgt23);
check('攻击令清除 groupSpeed', lt23.groupSpeed == null, 'gs=' + lt23.groupSpeed);
const x23 = lt23.x;
run(1);
check('快车按面板速度追击(1 秒 ≈2.8 格)', lt23.x - x23 > 2.2, '位移=' + (lt23.x - x23).toFixed(2));

// 24. 停火(holdFire):不站岗索敌、不还击;右键点名不受影响(H/面板按钮切换)
fresh();
const hf1 = RS.game.spawnUnitAt('rocket', 50, 50, 'player');
hf1.holdFire = true;
const hfFoe = RS.game.spawnUnitAt('infantry', 52.5, 50, 'enemy');
run(5);
check('停火单位不站岗索敌也不还击', !hf1.target && hf1.hp < hf1.maxHp,
  'target=' + !!hf1.target + ',余血=' + Math.round(hf1.hp) + '/' + hf1.maxHp);
RS.combat.attackCommand([hf1], hfFoe);
run(4);
check('停火单位点名攻击可开火', hfFoe.hp < hfFoe.maxHp,
  '敌余血=' + Math.round(hfFoe.hp) + '/' + hfFoe.maxHp);

// 25. 建筑遇袭基地动员:defendRadius(12) 内且武器够得着(射程×2.5)的闲置单位参战;
//     范围外与停火者不动。nearG 距建筑 11>7——旧 7 格规则不会协防,新规则会。
fresh();
const homeB = RS.game.placeStructure('barracks', 60, 60, 'player');
const nearG = RS.game.spawnUnitAt('rocket', 72, 61, 'player');   // 距建筑中心 11<12 且距敌 8.5<10
const farG = RS.game.spawnUnitAt('rocket', 90, 61, 'player');    // 距 29>12(且距敌 26.5>10)
const holdG = RS.game.spawnUnitAt('rocket', 70, 61, 'player');   // 距 9 < 24 但停火
holdG.holdFire = true;
const invader = RS.game.spawnUnitAt('lightTank', 63.5, 61, 'enemy');
RS.combat.attackCommand([invader], homeB);
run(2);
check('建筑遇袭:12格内且够得着的单位协防', nearG.target === invader,
  'target=' + (nearG.target ? nearG.target.kind : 'none'));
check('建筑遇袭:12格外单位不动', !farG.target,
  'target=' + (farG.target ? farG.target.kind : 'none'));
check('建筑遇袭:停火单位不协防', !holdG.target,
  'target=' + (holdG.target ? holdG.target.kind : 'none'));

// 26. 单位遇袭协防仍限 7 格 + 射程 2.5 倍(回归,不被建筑动员规则波及)
fresh();
const buddy1 = RS.game.spawnUnitAt('rocket', 50, 50, 'player');
const buddy2 = RS.game.spawnUnitAt('rocket', 56.5, 50, 'player'); // 距 buddy1 6.5<7;距敌 8<4×2.5
const buddy3 = RS.game.spawnUnitAt('rocket', 59, 50, 'player');   // 距 buddy1 9>7
const shooter = RS.game.spawnUnitAt('lightTank', 48.5, 50, 'enemy');
RS.combat.attackCommand([shooter], buddy1);
run(2);
check('单位遇袭:7格内友军仍协防', buddy2.target === shooter,
  'target=' + (buddy2.target ? buddy2.target.kind : 'none'));
check('单位遇袭:7格外友军不动', !buddy3.target,
  'target=' + (buddy3.target ? buddy3.target.kind : 'none'));

// 27. toggleHoldFire 批量语义:非全停火→全停火,全停火→全自由,无作战单位返回 null
fresh();
const tg1 = RS.game.spawnUnitAt('rocket', 50, 50, 'player');
const tg2 = RS.game.spawnUnitAt('lightTank', 52, 50, 'player');
const tg3 = RS.game.spawnUnitAt('harvester', 54, 50, 'player'); // 无 dmg,不受影响
RS.game.selectOnly([tg1, tg2, tg3]);
check('首次切换全部停火(矿车除外)',
  RS.game.toggleHoldFire() === true && tg1.holdFire && tg2.holdFire && !tg3.holdFire);
check('再次切换全部自由开火',
  RS.game.toggleHoldFire() === false && !tg1.holdFire && !tg2.holdFire);
RS.game.clearSelection();
check('空选切换返回 null', RS.game.toggleHoldFire() === null);

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

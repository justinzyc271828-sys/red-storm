/* M3b/M4 测试:AI 发展、生产、波次、攻击移动接敌、难度节奏、胜负判定。
 * 运行:node test/ai-test.js */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');
require('../src/ai.js');

const RS = globalThis.RS;
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const STEP = RS.config.SIM_STEP;
const run = sec => { for (let t = 0; t < sec; t += STEP) RS.game.update(STEP); };
const enemyUnits = () => RS.game.units.filter(u => u.owner === 'enemy' && RS.units.TYPES[u.kind].dmg);

// 1. AI 发展与生产(普通难度)
RS.game.init();
RS.ai.init('normal');
run(16);
check('AI 按计划开建(电站)', RS.game.buildings.filter(b => b.owner === 'enemy').length >= 3,
  '敌方建筑 ' + RS.game.buildings.filter(b => b.owner === 'enemy').length);
run(145);
check('AI 战车工厂就位', RS.game.buildings.some(b => b.owner === 'enemy' && b.type === 'factory'));
run(90);
check('AI 按波次攒兵(达到早期上限)', enemyUnits().length >= 4, '敌方作战单位 ' + enemyUnits().length);

// 2. 波次进攻(普通 5.5 分钟第一波)
run(190); // ≈ 412s
check('第一波已发出', RS.ai.waveIndex >= 1, 'waveIndex=' + RS.ai.waveIndex);
let sawMarch = false;
for (let s = 0; s < 240 && !sawMarch; s += STEP) {
  RS.game.update(STEP);
  if (RS.game.units.some(u => u.owner === 'enemy' && u.attackMove)) sawMarch = true;
}
check('进攻部队已上路(攻击移动)', sawMarch);
check('波次警报触发', RS.game.waveWarn > 0);

// 3. 攻击移动:沿途接敌,消灭后继续推进
RS.game.init();
RS.ai.init('normal');
const attacker = RS.game.spawnUnitAt('lightTank', 60, 80, 'enemy');
attacker.attackMove = { x: 40, y: 90 };
const defender = RS.game.spawnUnitAt('infantry', 54, 83, 'player');
run(4);
check('攻击移动沿途接敌', attacker.target === defender);
const x0 = attacker.x;
run(12);
check('消灭敌人后继续推进', !attacker.attackMove || attacker.x < x0 - 3 || attacker.hp <= 0,
  'x: ' + x0.toFixed(1) + ' → ' + attacker.x.toFixed(1));

// 4. 难度节奏:简单更晚但必来(firstWave 240±10%);困难防守反击(不被激怒不出拳,被激怒立刻反击)
RS.game.init();
RS.ai.init('easy');
run(200);
check('简单难度 3 分钟内没来', RS.ai.waveIndex === 0, 'waveIndex=' + RS.ai.waveIndex);
run(100);
check('简单难度 5 分钟前必来', RS.ai.waveIndex >= 1, 'waveIndex=' + RS.ai.waveIndex);
RS.game.init();
RS.ai.init('hard');
run(360);
check('困难未被挑衅前按兵不动', RS.ai.waveIndex === 0, 'waveIndex=' + RS.ai.waveIndex);
const AB2 = RS.map.aiBase;
for (let k = 0; k < 8; k++) RS.game.spawnUnitAt('lightTank', AB2.i - 8 + k, AB2.j + 20, 'player');
run(10);
check('困难被挑衅后立刻反击',
  RS.ai.waveIndex >= 1 || RS.game.units.some(u => u.owner === 'enemy' && u.attackMove),
  'waveIndex=' + RS.ai.waveIndex);

// 5. 胜负判定(设计稿:指挥中心被毁即败)
RS.game.init();
RS.ai.init('normal');
for (const b of RS.game.buildings) if (b.owner === 'enemy') b.destroyed = true;
run(2);
check('敌方建筑全灭 → 胜利', RS.game.state === 'won');
RS.game.init();
RS.ai.init('normal');
for (const b of RS.game.buildings) if (b.owner === 'player') b.destroyed = true;
run(2);
check('我方建筑全灭 → 失败', RS.game.state === 'lost');
RS.game.init();
RS.ai.init('normal');
const ecc = RS.game.buildings.find(b => b.owner === 'enemy' && b.type === 'cc');
ecc.destroyed = true; // 只拆指挥中心,其余建筑还在
run(2);
check('只拆敌方指挥中心 → 胜利', RS.game.state === 'won');
RS.game.init();
RS.ai.init('normal');
RS.game.buildings.find(b => b.owner === 'player' && b.type === 'cc').destroyed = true;
run(2);
check('只拆我方指挥中心 → 失败', RS.game.state === 'lost');

// 6. P0 回归:真实经济
RS.game.init();
RS.ai.init('normal');
const ehv = RS.game.units.find(u => u.owner === 'enemy' && u.kind === 'harvester');
check('敌方开局有矿车', !!ehv);
ehv.state = 'unload'; ehv.load = 300; ehv.timer = 10;
const w0 = RS.ai.wallet.money;
RS.game.update(STEP);
check('敌方矿车卸矿入账 AI 钱包(不资敌)', RS.ai.wallet.money === w0 + 300, '+' + (RS.ai.wallet.money - w0));
for (const b of RS.game.buildings) if (b.owner === 'enemy' && b.type === 'refinery') b.destroyed = true;
RS.game.units = RS.game.units.filter(u => !(u.owner === 'enemy' && u.kind === 'harvester'));
const w1 = RS.ai.wallet.money;
run(10);
check('精炼厂/矿车全灭 → AI 收入停止', RS.ai.wallet.money <= w1, Math.round(w1) + ' → ' + Math.round(RS.ai.wallet.money));

// 7. P0 回归:分阵营电力
RS.game.init();
RS.ai.init('normal');
RS.game.placeStructure('factory', 90, 40, 'enemy', true); // -20 → 敌方立刻缺电
check('敌方缺电判定(不再只看玩家)', RS.game.lowPower('enemy'));
check('玩家电力不受敌方影响', !RS.game.lowPower('player'));
const ebar = RS.game.placeStructure('barracks', 92, 44, 'enemy', true);
RS.ai.wallet.money = 5000;
RS.game.enqueueUnit(ebar, 'infantry');
run(1);
check('敌方缺电减自己的产速', ebar.prodProgress > 0.4 && ebar.prodProgress < 0.6, 'progress=' + ebar.prodProgress.toFixed(2));

// 8. P0 回归:攻击移动速度 = 面板(无双倍速)
RS.game.init();
RS.ai.init('easy');
const mtk = RS.game.spawnUnitAt('lightTank', 60, 60, 'enemy');
RS.combat.attackMoveGroup([mtk], 60, 70);
const my0 = mtk.y;
run(1);
check('攻击移动一秒 ≈ 2.8 格', Math.abs((mtk.y - my0) - 2.8) < 0.35, (mtk.y - my0).toFixed(2) + ' 格');

// 9. P0 回归:波次实际人数 = waveSize(普通第一波 4 人)
RS.game.init();
RS.ai.init('normal');
const stg = RS.ai.staging;
for (let k = 0; k < 10; k++) RS.game.spawnUnitAt('lightTank', stg.x + (k % 5), stg.y + Math.floor(k / 5), 'enemy');
RS.ai.nextWaveAt = 0;
run(2);
const sentN = RS.game.units.filter(u => u.owner === 'enemy' && u.attackMove).length;
check('第一波实际发兵 = waveSize(4)', sentN === 4, sentN + ' 人');

// 10. P0 回归:跨局状态重置
RS.ai.wasInvaded = true; RS.ai.repelled = true;
RS.ai.init('easy');
check('重开不继承入侵/反击状态', RS.ai.wasInvaded === false && RS.ai.repelled === false);

// 11. 重开完整性:弹道/爆炸/沙暴加剧不串局
RS.game.init();
RS.ai.init('normal');
RS.game.spawnUnitAt('lightTank', 50, 50, 'enemy');
RS.game.spawnUnitAt('heavyTank', 54, 50, 'player');
run(0.5); // 打出在途炮弹
RS.game.suddenDeath = true;
RS.game.init();
check('重开清空弹道/爆炸/沙暴', RS.combat.projectiles.length === 0 && RS.combat.explosions.length === 0 && RS.game.suddenDeath === false);

// 12. 困难侦察:无经济情报时派轻型坦克上门(骚扰链的眼睛)
RS.game.init();
RS.ai.init('hard');
let sawScout = false;
for (let s = 0; s < 180 * 30 && !sawScout; s++) {
  RS.game.update(STEP);
  if (RS.game.units.some(u => u.owner === 'enemy' && u.kind === 'lightTank' && u.attackMove)) sawScout = true;
}
check('困难派出侦察单位(轻坦攻击移动)', sawScout);

// 13. 撤退伤员不被波次抓丁(困难;守家存亡除外)
RS.game.init();
RS.ai.init('hard');
RS.ai.playerAttacked = true; // 解锁 hardHold,让波次可发
const stg3 = RS.ai.staging;
const wounded = RS.game.spawnUnitAt('lightTank', stg3.x, stg3.y, 'enemy');
wounded.hp = wounded.maxHp * 0.2;
for (let k = 0; k < 26; k++) RS.game.spawnUnitAt('lightTank', stg3.x + 2 + (k % 6), stg3.y + 2 + Math.floor(k / 6), 'enemy');
run(3);
check('残血车辆被标记撤退', wounded.retreat === true, 'retreat=' + wounded.retreat);
RS.ai.nextWaveAt = 0;
run(3);
check('撤退伤员未被波次抓丁', wounded.retreat === true && !wounded.attackMove,
  'retreat=' + wounded.retreat + ' attackMove=' + !!wounded.attackMove);

// 14. 战车工厂建成后不空转(普通难度前期序列含轻坦)
RS.game.init();
RS.ai.init('normal');
run(200);
const efac = RS.game.buildings.find(b => b.owner === 'enemy' && b.type === 'factory');
const vehOut = RS.game.units.some(u => u.owner === 'enemy' && u.vehicle && u.kind !== 'harvester' && u.kind !== 'repair');
check('工厂 200s 前开始产车', !!efac && efac.done && (vehOut || efac.queue.length > 0),
  'done=' + (efac && efac.done) + ' queue=' + (efac ? efac.queue.length : '-') + ' 车辆=' + vehOut);

// 15. 波次警报只认正式进攻打标:侦察不误报,打标不漏报
RS.game.init();
RS.ai.init('hard');
const pb3 = { x: RS.map.playerBase.i + 1.5, y: RS.map.playerBase.j + 3.5 };
const scout2 = RS.game.spawnUnitAt('lightTank', pb3.x + 10, pb3.y, 'enemy');
scout2.attackMove = { x: pb3.x, y: pb3.y }; // 侦察式逼近(无打标)
run(1);
check('侦察逼近不触发波次警报', RS.game.waveWarn === 0, 'waveWarn=' + RS.game.waveWarn);
RS.ai.atkSerial = 7; scout2.atkSerial = 7; // 变成正式进攻打标
run(1);
check('打标进攻逼近 30 格触发警报', RS.game.waveWarn > 0, 'waveWarn=' + RS.game.waveWarn);

// 16. 波次取兵不限 12 格集结圈:圈外闲置兵力按距离排序照样入伍(三轮验收 P1-01)
//     2026-07-25 平衡治理:easy/normal 新增守家底数 guardEarly=8——波次只能在守家底数之上发兵。
//     本用例兵力补足到 12(守家 8 + 首波 4),原断言(圈外补员)保持不变。
RS.game.init();
RS.ai.init('normal');
RS.game.units = RS.game.units.filter(u => u.owner !== 'enemy'); // 清场,只留本用例兵力
const stg4 = RS.ai.staging;
for (let k = 0; k < 2; k++) RS.game.spawnUnitAt('lightTank', stg4.x + k, stg4.y, 'enemy'); // 圈内 2 个
const farSquad = [];
for (let k = 0; k < 10; k++) {
  const g = RS.units.nearestOpen(Math.round(stg4.x + 14 + (k % 3)), Math.round(stg4.y + 16 + Math.floor(k / 3)));
  farSquad.push(RS.game.spawnUnitAt('lightTank', g.i + 0.5, g.j + 0.5, 'enemy')); // 圈外(>12 格)10 个
}
RS.ai.nextWaveAt = 0;
run(2);
const sentTotal = RS.game.units.filter(u => u.owner === 'enemy' && u.attackMove).length;
const sentFar = farSquad.filter(u => u.attackMove).length;
check('首波发满 waveSize(4):圈内不足圈外补', sentTotal === 4 && sentFar === 2,
  '实发 ' + sentTotal + ',其中圈外 ' + sentFar);

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

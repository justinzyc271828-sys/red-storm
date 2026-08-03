/* 自对弈测试台:机器人扮演玩家对抗 AI,全程无头高速仿真。
 * 运行:node test/bot-match.js [难度] [局数] */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');
require('../src/ai.js');
const { makeBot } = require('./player-bot.js');

const RS = globalThis.RS;
const STEP = RS.config.SIM_STEP;

function playMatch(difficulty, maxMin, seed) {
  RS.gameSeed = seed === undefined ? 1337 : seed; // 可换种子验证随机布局
  RS.game.init();
  RS.game.startGame(difficulty);
  const bot = makeBot();
  let minMoney = Infinity, peakArmy = 0;
  const maxT = (maxMin || 35) * 60;
  while (RS.game.state === 'playing' && RS.game.time < maxT) {
    RS.game.update(STEP);
    bot(RS.game.time);
    if (RS.game.money < minMoney) minMoney = RS.game.money;
    peakArmy = Math.max(peakArmy, RS.game.units.filter(u => u.owner === 'player' && RS.units.TYPES[u.kind].dmg).length);
  }
  const G = RS.game;
  return {
    result: G.state === 'playing' ? '超时' : G.state === 'won' ? '胜' : '负',
    time: (G.time / 60).toFixed(1) + '分',
    waves: RS.ai.waveIndex,
    peakArmy,
    minMoney: minMoney === Infinity ? '-' : Math.round(minMoney),
    enemyLeft: G.buildings.filter(b => b.owner === 'enemy').length,
    playerLeft: G.buildings.filter(b => b.owner === 'player').length,
  };
}

const diffs = process.argv[2] ? [process.argv[2]] : ['easy', 'normal', 'hard'];
const n = parseInt(process.argv[3] || '3', 10);
// 目标带:胜率落带、超时率 ≤30%,严重偏离 → 退出码 1(P2-03)
const TARGET = { easy: [0.7, 1.0], normal: [0.2, 0.6], hard: [0.0, 0.4] }; // 玩家胜率区间(按局数缩放)
let bad = 0;
for (const d of diffs) {
  console.log('--- 难度 ' + d + ' ---');
  let win = 0, lose = 0, draw = 0;
  for (let k = 0; k < n; k++) {
    const r = playMatch(d, 35, 1337 + k * 999); // 每局换种子,顺带验证随机布局
    if (r.result === '胜') win++; else if (r.result === '负') lose++; else draw++;
    console.log(`  第${k + 1}局 ${r.result}  时长${r.time}  承受波次${r.waves}  峰值兵力${r.peakArmy}  最低资金${r.minMoney}  剩余建筑 我${r.playerLeft}/敌${r.enemyLeft}`);
  }
  console.log(`  小计:胜${win} 负${lose} 超时${draw}`);
  const toRate = draw / n;
  if (n >= 6) {
    const [loR, hiR] = TARGET[d] || [0, 1];
    const lo = Math.floor(loR * n), hi = Math.ceil(hiR * n);
    if (toRate > 0.3) { console.log(`  ✗ 超时率 ${(toRate * 100).toFixed(0)}% > 30%`); bad++; }
    if (win < lo || win > hi) { console.log(`  ✗ 玩家胜场 ${win} 偏离目标带 [${lo},${hi}](${loR * 100}%~${hiR * 100}%)`); bad++; }
  }
}
process.exit(bad ? 1 : 0);

/* 深度调试:逐 30 秒采样一场普通局(输出到 test/debug-match.log) */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');
require('../src/ai.js');
const { makeBot } = require('./player-bot.js');
const fs = require('fs');
const RS = globalThis.RS;
const STEP = RS.config.SIM_STEP;
const log = [];
const say = s => { log.push(s); };

RS.game.init();
RS.game.startGame('normal');
const bot = makeBot();
let lastLog = 0;
while (RS.game.state === 'playing' && RS.game.time < 20 * 60) {
  RS.game.update(STEP);
  bot(RS.game.time);
  if (RS.game.time - lastLog >= 30) {
    lastLog = RS.game.time;
    const pu = RS.game.units.filter(u => u.owner === 'player' && RS.units.TYPES[u.kind].dmg);
    const eu = RS.game.units.filter(u => u.owner === 'enemy');
    const near = pu.filter(u => Math.hypot(u.x - 97, u.y - 30) < 18).length;
    say('[' + (RS.game.time / 60).toFixed(1) + '分] 我军' + pu.length +
      '(敌基地附近' + near + ') 敌军' + eu.length +
      ' 敌建筑' + RS.game.buildings.filter(b => b.owner === 'enemy').length +
      ' 我建筑' + RS.game.buildings.filter(b => b.owner === 'player').length +
      ' 资金' + RS.game.money);
  }
}
say('终局: ' + RS.game.state + ' @ ' + (RS.game.time / 60).toFixed(1) + '分');
fs.writeFileSync(__dirname + '/debug-match.log', log.join('\n') + '\n');
console.log('已写出 test/debug-match.log(' + log.length + ' 行)');

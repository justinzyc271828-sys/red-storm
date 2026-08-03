/* 平衡矩阵:风格×难度×种子,逐局 JSON + 分桶汇总(预注册达标线见 docs/balance/README.md)。
 * 用法:node test/balance-matrix.js [styles] [diffs] [seeds] [attackT] [skills]
 *   styles  逗号分隔,默认全部(std,turtle,rush,allin,inf,tank,newbie)
 *   diffs   逗号分隔,默认 easy,normal,hard
 *   seeds   种子数 N,默认 5;种子 = 1337 + k*999(与 bot-match 同族)
 *   attackT 可选,仅作用于 std 风格(攻击时钟扫描:240/360/480);占位写 -
 *   skills  可选,逗号分隔(beginner,intermediate,advanced),默认不包水平
 * 本工具只测量不设退出码;判定按 docs/balance/README.md 协议人工执行。 */
'use strict';
require('../src/config.js'); require('../src/iso.js'); require('../src/map.js');
require('../src/units.js'); require('../src/game.js'); require('../src/combat.js'); require('../src/ai.js');
const { STYLES, SKILLS, playMatch } = require('./player-styles.js');

const argStyles = process.argv[2] ? process.argv[2].split(',') : STYLES;
const argDiffs = process.argv[3] ? process.argv[3].split(',') : ['easy', 'normal', 'hard'];
const nSeeds = parseInt(process.argv[4] || '5', 10);
const attackT = process.argv[5] && process.argv[5] !== '-' ? parseInt(process.argv[5], 10) : undefined;
const argSkills = process.argv[6] && process.argv[6] !== '-' ? process.argv[6].split(',') : [null];
const stormMode = process.argv[7] === 'storm'; // 沙暴模式(2026-07-25):node test/balance-matrix.js std normal 20 - - storm

const BUCKETS = ['<8', '8-12', '12-18', '18-24', '24+', '超时'];
function bucketOf(r) {
  if (r.result === '超时') return '超时';
  if (r.min < 8) return '<8';
  if (r.min < 12) return '8-12';
  if (r.min < 18) return '12-18';
  if (r.min < 24) return '18-24';
  return '24+';
}
function median(xs) {
  if (!xs.length) return '-';
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1);
}

for (const style of argStyles) {
  for (const skill of argSkills) {
    if (skill && !SKILLS[skill]) { console.error('未知水平: ' + skill); process.exit(2); }
    for (const diff of argDiffs) {
      const rs = [];
      for (let k = 0; k < nSeeds; k++) {
        const r = playMatch(style, diff, 1337 + k * 999, { attackT, skill, storm: stormMode });
        if (skill) r.skill = skill;
        if (stormMode) r.stormT = r.stormInfo && r.stormInfo.t;
        rs.push(r);
        console.log(JSON.stringify(r));
      }
      const W = { 胜: 0, 负: 0, 超时: 0 };
      const B = Object.fromEntries(BUCKETS.map(b => [b, 0]));
      for (const r of rs) { W[r.result]++; B[bucketOf(r)]++; }
      const mins = rs.map(r => r.min);
      const waves2 = rs.filter(r => r.waves >= 2).length;
      console.log(`## ${style}${skill ? '/' + skill : ''}/${diff} n=${rs.length} 胜${W.胜} 负${W.负} 超时${W.超时}` +
        ` 中位时长${median(mins)}分 波次≥2占比${((waves2 / rs.length) * 100).toFixed(0)}%` +
        ' 分桶[' + BUCKETS.map(b => `${b}:${B[b]}`).join(' ') + ']');
    }
  }
}

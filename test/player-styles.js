/* 玩家风格库(由 test/tmp-r2-styles.js 提升为正式模块,task 05 要求)。
 * 每个风格 = 一个 make* 工厂,返回 tick(t);playMatch 跑一局返回结构化结果。
 * 风格清单:turtle 龟缩 / rush 火箭速推 / inf 步兵海 / tank 坦克流 / newbie 新手
 *          allin 三兵营步兵 all-in(版本答案型,双评审刁钻玩家①要求纳入)
 *          std   标准休闲 bot(player-bot.js,attackT 可参数化,用于攻击时钟扫描) */
'use strict';
const { makeBot } = require('./player-bot.js');

const RS = () => globalThis.RS;
const STEP = 1 / 30;

const combat = () => RS().game.units.filter(u => u.owner === 'player' && RS().units.TYPES[u.kind].dmg);
const home = () => ({ x: RS().map.playerBase.i + 1.5, y: RS().map.playerBase.j + 1 });
const producers = type => RS().game.buildings.filter(b => b.owner === 'player' && b.type === type && !b.destroyed);

function findSpot(type, pi, pj) {
  for (let r = 0; r <= 6; r++)
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        if (RS().game.canPlace(type, pi + a, pj + b)) return { i: pi + a, j: pj + b };
      }
  return null;
}
function tryBuild(type, di, dj) {
  const PB = RS().map.playerBase;
  const s = findSpot(type, PB.i + di, PB.j + dj);
  return s ? RS().game.startConstruction(type, s.i, s.j) : false;
}
function queueUp(b, kind) { if (b.done && !b.destroyed && b.queue.length < 3) RS().game.enqueueUnit(b, kind); }
function enemyTarget(G) { // 优先指挥中心,否则最近建筑
  const cc = G.buildings.find(b => b.owner === 'enemy' && b.type === 'cc' && !b.destroyed);
  return cc || G.buildings.find(b => b.owner === 'enemy' && !b.destroyed);
}

function makeTurtle(interval) {
  const THINK = interval || 1.0;
  const ORDER = [['power', 4, -2, 5], ['barracks', 4, 6, 40], ['turret', 3, -5, 150], ['turret', 8, 0, 200],
    ['factory', 8, 6, 240], ['turret', 0, 8, 300], ['turret', 6, 8, 360], ['refinery', 0, -5, 450]];
  let built = 0, think = 0;
  return t => {
    think -= STEP; if (think > 0) return; think = THINK;
    const G = RS().game, h = home();
    if (built < ORDER.length && t >= ORDER[built][3])
      if (tryBuild(ORDER[built][0], ORDER[built][1], ORDER[built][2])) built++;
    for (const b of producers('barracks')) queueUp(b, 'rocket');
    for (const b of producers('factory')) queueUp(b, 'lightTank');
    const inv = G.units.filter(u => u.owner === 'enemy' && Math.hypot(u.x - h.x, u.y - h.y) < 28);
    const free = combat().filter(u => !u.target);
    if (inv.length) {
      const cx = inv.reduce((s, u) => s + u.x, 0) / inv.length, cy = inv.reduce((s, u) => s + u.y, 0) / inv.length;
      if (free.length) RS().combat.attackMoveGroup(free, cx, cy);
    } else {
      for (const u of free) if (Math.hypot(u.x - h.x, u.y - h.y) > 16 && !u.path) RS().units.setPath(u, h.x, h.y);
    }
  };
}

function makeRush(interval) {
  const THINK = interval || 0.8;
  const ORDER = [['power', 4, -2, 5], ['barracks', 4, 6, 12], ['barracks', 7, 6, 90]];
  let built = 0, think = 0, sent = 0;
  return t => {
    think -= STEP; if (think > 0) return; think = THINK;
    const G = RS().game;
    if (built < ORDER.length && t >= ORDER[built][3])
      if (tryBuild(ORDER[built][0], ORDER[built][1], ORDER[built][2])) built++;
    for (const b of producers('barracks')) queueUp(b, 'rocket');
    const free = combat().filter(u => !u.target && !u.attackMove);
    if ((free.length >= 12 && t - sent > 20) || (t > 240 && free.length >= 6 && t - sent > 20)) {
      sent = t;
      const eb = enemyTarget(G);
      if (eb) RS().combat.attackMoveGroup(free, eb.cx, eb.cy);
    }
  };
}

/* 三兵营步兵 all-in:双评审刁钻玩家①的版本答案。
 * 电力先行(真实运营),步兵为主混 1/5 火箭(防喷火 hedge),攒 28 准时出门。 */
function makeAllIn(interval) {
  const THINK = interval || 0.8;
  const ORDER = [['power', 4, -2, 5], ['barracks', 4, 6, 12], ['barracks', 7, 6, 60], ['barracks', 9, 4, 150]];
  let built = 0, think = 0, sent = 0, produced = 0;
  return t => {
    think -= STEP; if (think > 0) return; think = THINK;
    const G = RS().game;
    if (built < ORDER.length && t >= ORDER[built][3])
      if (tryBuild(ORDER[built][0], ORDER[built][1], ORDER[built][2])) built++;
    for (const b of producers('barracks')) {
      if (b.queue.length >= 3) continue;
      produced++;
      queueUp(b, produced % 5 === 0 ? 'rocket' : 'infantry');
    }
    const free = combat().filter(u => !u.target && !u.attackMove);
    if ((free.length >= 28 && t >= 240 && t - sent > 30) || (t >= 330 && free.length >= 16 && t - sent > 30)) {
      sent = t;
      const eb = enemyTarget(G);
      if (eb) RS().combat.attackMoveGroup(free, eb.cx, eb.cy);
    }
  };
}

function makeMono(kind, n, firstAt, interval) {
  const THINK = interval || 1.0;
  const ORDER = kind === 'infantry'
    ? [['power', 4, -2, 5], ['barracks', 4, 6, 12], ['barracks', 7, 6, 90]]
    : [['power', 4, -2, 5], ['factory', 8, 6, 30]];
  const prodType = kind === 'infantry' ? 'barracks' : 'factory';
  let built = 0, think = 0, sent = 0;
  return t => {
    think -= STEP; if (think > 0) return; think = THINK;
    const G = RS().game;
    if (built < ORDER.length && t >= ORDER[built][3])
      if (tryBuild(ORDER[built][0], ORDER[built][1], ORDER[built][2])) built++;
    for (const b of producers(prodType)) queueUp(b, kind);
    const free = combat().filter(u => !u.target && !u.attackMove);
    if (free.length >= n && t - sent > 25 && t >= firstAt) {
      sent = t;
      const eb = enemyTarget(G);
      if (eb) RS().combat.attackMoveGroup(free, eb.cx, eb.cy);
    }
  };
}

function makeNewbie(rng) {
  const WANT = ['barracks', 'factory', 'power', 'turret', 'refinery'];
  let think = 0, built = 0;
  return t => {
    think -= STEP; if (think > 0) return; think = 2.5;
    const G = RS().game, r = rng();
    if (r < 0.3 && built < WANT.length) {
      const type = WANT[built];
      if (G.money >= RS().config.buildings[type].cost + 150)
        if (tryBuild(type, Math.floor(rng() * 12) - 4, Math.floor(rng() * 12) - 4)) built++;
    } else if (r < 0.55) {
      const mine = combat(); if (!mine.length) return;
      const u = mine[Math.floor(rng() * mine.length)];
      RS().game.selectOnly([u]);
      RS().game.commandSmart(rng() * 120, rng() * 120); // 全图乱点
    } else if (r < 0.7) {
      for (const b of producers('barracks')) queueUp(b, rng() < 0.5 ? 'infantry' : 'rocket');
      for (const b of producers('factory')) queueUp(b, 'lightTank');
    }
  };
}

const STYLES = ['std', 'turtle', 'rush', 'allin', 'inf', 'tank', 'newbie'];

/* 玩家水平模型(2026-07-25,应 Justin 要求):决策间隔直接注入风格内部计时器,
 * 忘操作(skip)由本包装层在决策槽位上随机跳过——两者不得相乘(初版 bug 已修)。
 * advanced = 0.5s 零失误;intermediate = 1.2s + 10% 忘操作;beginner = 2.5s + 30% 忘操作。 */
const SKILLS = {
  beginner: { think: 2.5, skip: 0.3 },
  intermediate: { think: 1.2, skip: 0.1 },
  advanced: { think: 0.5, skip: 0 },
};
function withSkill(tick, level, rng) {
  const sk = SKILLS[level];
  if (!sk) return tick;
  return t => { if (sk.skip && rng() < sk.skip) return; tick(t); };
}

function makeStyle(name, rng, opts) {
  const sk = opts && opts.skill ? SKILLS[opts.skill] : null;
  const think = sk ? sk.think : undefined;
  let tick;
  switch (name) {
    case 'std': tick = makeBot({ attackT: opts && opts.attackT, think }); break;
    case 'turtle': tick = makeTurtle(think); break;
    case 'rush': tick = makeRush(think); break;
    case 'allin': tick = makeAllIn(think); break;
    case 'inf': tick = makeMono('infantry', 25, 240, think); break;
    case 'tank': tick = makeMono('lightTank', 10, 240, think); break;
    case 'newbie': return makeNewbie(rng); // 新手模型本身就是混沌低级,不再包水平
    default: throw new Error('未知风格: ' + name);
  }
  return withSkill(tick, opts && opts.skill, rng);
}

function playMatch(style, diff, seed, opts) {
  RS().gameSeed = seed; RS().game.init(); RS().game.startGame(diff, { storm: !!(opts && opts.storm) });
  let rngS = seed;
  const rng = () => (rngS = (rngS * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const bot = makeStyle(style, rng, opts);
  const pcc = RS().game.buildings.find(b => b.owner === 'player' && b.type === 'cc');
  let firstContact = null, minMoney = Infinity, peakArmy = 0;
  const maxT = 35 * 60;
  while (RS().game.state === 'playing' && RS().game.time < maxT) {
    RS().game.update(STEP); bot(RS().game.time);
    if (RS().game.money < minMoney) minMoney = RS().game.money;
    peakArmy = Math.max(peakArmy, combat().length);
    if (firstContact === null && RS().game.units.some(u => u.owner === 'enemy' && Math.hypot(u.x - pcc.cx, u.y - pcc.cy) < 40))
      firstContact = RS().game.time;
  }
  const G = RS().game;
  return {
    style, diff, seed,
    result: G.state === 'playing' ? '超时' : G.state === 'won' ? '胜' : '负',
    min: +(G.time / 60).toFixed(1),
    contact: firstContact === null ? '-' : +(firstContact / 60).toFixed(1),
    waves: RS().ai.waveIndex,
    peakArmy,
    minMoney: minMoney === Infinity ? '-' : Math.round(minMoney),
    playerLeft: G.buildings.filter(b => b.owner === 'player' && !b.destroyed).length,
    enemyLeft: G.buildings.filter(b => b.owner === 'enemy' && !b.destroyed).length,
    stormInfo: G.storm ? {
      t: +(G.storm.t / 60).toFixed(1),
      relicActivated: !!(G.storm.relic && G.storm.relic.activated),
      mechOwner: G.storm.mechOwner || null,
    } : null,
  };
}

module.exports = { STYLES, SKILLS, playMatch };

// 自检:node test/player-styles.js → 各风格 normal 种子 1337 一局
if (require.main === module) {
  require('../src/config.js'); require('../src/iso.js'); require('../src/map.js');
  require('../src/units.js'); require('../src/game.js'); require('../src/combat.js'); require('../src/ai.js');
  for (const s of STYLES) console.log(JSON.stringify(playMatch(s, 'normal', 1337)));
}

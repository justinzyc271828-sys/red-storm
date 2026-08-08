/* DOM 冒烟测试:用最小浏览器桩在 Node 中加载全部脚本,
 * 跑通标题屏 → 开局 → 渲染 → 指挥 → 建造 → 生产全路径。
 * 运行:node test/dom-test.js */
'use strict';

function noop() {}

function makeCtx(canvas) {
  const store = {};
  return new Proxy(store, {
    get(t, prop) {
      if (prop === 'canvas') return canvas;
      if (!(prop in t)) {
        t[prop] = function () {
          if (prop === 'measureText') return { width: 10 };
          if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return { addColorStop: noop };
          return undefined;
        };
      }
      return t[prop];
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

function makeCanvas() {
  const c = {
    width: 300, height: 150, style: {}, listeners: {},
    addEventListener: (ev, fn) => { (c.listeners[ev] = c.listeners[ev] || []).push(fn); },
    setPointerCapture: noop, releasePointerCapture: noop,
  };
  c.getContext = () => makeCtx(c);
  return c;
}

const mainCanvas = makeCanvas();
const windowListeners = {};
const documentListeners = {};
global.window = globalThis;
let reloads = 0;
global.location = { reload: () => { reloads++; } };
window.__RS_SEED__ = 1337; // 固定种子,测试用经典布局
window.innerWidth = 1280;
window.innerHeight = 720;
window.addEventListener = (ev, fn) => { (windowListeners[ev] = windowListeners[ev] || []).push(fn); };
window.requestAnimationFrame = fn => { global.__raf = fn; };
global.document = {
  createElement: tag => (tag === 'canvas' ? makeCanvas() : { style: {} }),
  getElementById: id => id === 'game' ? mainCanvas : null,
  readyState: 'complete',
  hidden: false,
  addEventListener: (ev, fn) => { (documentListeners[ev] = documentListeners[ev] || []).push(fn); },
};
global.Image = class {
  constructor() { this.width = 64; this.height = 64; }
  set src(v) { const self = this; setTimeout(() => { if (self.onload) self.onload(); }, 0); }
};

require('../src/config.js');
require('../src/art-data.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/field-guide.js');
require('../src/sprites.js');
require('../src/enemy-art.js');
require('../src/camera.js');
require('../src/input.js');
require('../src/game.js');
require('../src/combat.js');
require('../src/ai.js');
require('../src/audio.js');
require('../src/render.js');
require('../src/main.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

const RS = globalThis.RS;

function runFrames(from, to) {
  for (let f = from; f <= to; f++) {
    const cb = global.__raf;
    global.__raf = null;
    if (!cb) throw new Error('rAF 链断裂于第 ' + f + ' 帧(上一帧抛了异常)');
    cb(f * 33.3);
  }
}

function firePointer(type, ev) {
  const ls = mainCanvas.listeners[type] || [];
  for (const fn of ls) fn(Object.assign({ preventDefault: noop, pointerId: 1, pointerType: 'mouse' }, ev));
}

function fireKey(type, ev) {
  const ls = windowListeners[type] || [];
  let prevented = false;
  const full = Object.assign({
    code: '', repeat: false, shiftKey: false, ctrlKey: false, altKey: false,
    preventDefault: () => { prevented = true; },
  }, ev);
  for (const fn of ls) fn(full);
  return prevented;
}

function fireDocument(type) {
  for (const fn of (documentListeners[type] || [])) fn();
}

(async () => {
  try {
    await new Promise(r => setTimeout(r, 30));
    check('启动后为标题屏', RS.game.state === 'title');
    check('我方与敌方炮塔底座分层素材已加载',
      !!(RS.sprites.turretBase && RS.sprites.turretBase.player && RS.sprites.turretBase.enemy));
    check('炮塔使用等距前后方向帧而非自由旋转炮头',
      !!(RS.sprites.turretAim && RS.sprites.turretAim.player && RS.sprites.turretAim.enemy &&
        RS.sprites.turretAim.player.length === 8 && RS.sprites.turretAim.enemy.length === 8 &&
        RS.sprites.turretAim.player[0].canvas !== RS.sprites.turretAim.player[5].canvas &&
        RS.sprites.turretAim.enemy[0].canvas !== RS.sprites.turretAim.enemy[5].canvas));
    check('炮塔方向帧使用 2×2 建筑锚点贴合底座',
      RS.sprites.turretAim.player.every(s => s.ay === s.canvas.height - 32) &&
      RS.sprites.turretAim.enemy.every(s => s.ay === s.canvas.height - 32));
    check('战斗无人机斜前/斜后成对方向素材已加载',
      !!(RS.sprites.units.drone && RS.sprites.units.drone.length === 8 &&
        RS.sprites.units.drone[0].canvas !== RS.sprites.units.drone[5].canvas));
    check('图鉴同时收录矿车与深层钻探车',
      RS.fieldGuide.unitOrder.includes('harvester') && RS.fieldGuide.unitOrder.includes('drillRig'));
    check('战地图鉴章节插画与地图终端素材已加载',
      !!(RS.sprites.fieldGuide && RS.sprites.fieldGuide.archive &&
        RS.sprites.fieldGuide.factions && RS.sprites.fieldGuide.salvage &&
        RS.sprites.guideTerminal));
    runFrames(1, 30);
    const norm = RS.render.titleRects.find(r => r.key === 'normal');
    check('难度按钮已布局', !!norm);
    check('标题屏提供独立新手教学入口',
      !!RS.render.titleRects.find(r => r.key === 'tutorial'));
    const logo = RS.render.titleLogoRect;
    check('标题名称彩蛋命中区已布局', !!logo);
    for (let k = 0; k < 5; k++)
      firePointer('pointerdown', { clientX: logo.x + logo.w / 2, clientY: logo.y + logo.h / 2, button: 0 });
    check('连续点击标题名称五次打开战地图鉴',
      RS.game.guideOpen && RS.game.guideSource === 'title' && RS.game.state === 'title');
    RS.render.frame(1 / 60);
    const nextGuide = RS.render.fieldGuideRects.find(r => r.action === 'next');
    check('图鉴翻页与关闭控件已布局', !!nextGuide &&
      !!RS.render.fieldGuideRects.find(r => r.action === 'close'));
    firePointer('pointerdown', { clientX: nextGuide.x + 4, clientY: nextGuide.y + 4, button: 0 });
    check('图鉴下一页按钮生效', RS.game.guidePage === 1);
    fireKey('keydown', { code: 'ArrowRight' });
    check('图鉴键盘右方向翻页', RS.game.guidePage === 2);
    fireKey('keydown', { code: 'Escape' });
    check('Esc 关闭标题页图鉴', !RS.game.guideOpen && RS.game.state === 'title');
    firePointer('pointerdown', { clientX: norm.x + 5, clientY: norm.y + 5, button: 0 });
    check('点击难度进入游戏(AI 激活)', RS.game.state === 'playing' && RS.ai.active === true);
    check('初始单位齐(玩家 6)', RS.game.units.filter(u => u.owner === 'player').length === 6);
    const normalPower = RS.render.powerStatus();
    check('电力状态明确区分供给/用量/余量',
      !normalPower.low && normalPower.label.includes('供20') &&
      normalPower.label.includes('用15') && normalPower.label.includes('余5'),
      normalPower.label);
    RS.game.buildings.push({ owner: 'player', done: true, destroyed: false, def: RS.config.buildings.turret });
    const lowPower = RS.render.powerStatus();
    RS.game.buildings.pop();
    check('缺电提示明确说明生产减半与炮塔停摆',
      lowPower.low && lowPower.detail.includes('-50%') &&
      lowPower.detail.includes('防御炮塔停摆') &&
      lowPower.detail.includes('深层开采站停产') && lowPower.detail.includes('太阳能电站'),
      lowPower.detail);
    for (const fn of (windowListeners.blur || [])) fn();
    check('普通窗口失焦不误暂停', RS.game.paused === false);
    document.hidden = true;
    fireDocument('visibilitychange');
    check('切到其他标签页自动暂停', RS.game.paused === true);
    document.hidden = false;
    fireDocument('visibilitychange');
    check('返回标签页自动继续', RS.game.paused === false);
    fireKey('keydown', { code: 'KeyP' });
    fireKey('keyup', { code: 'KeyP' });
    firePointer('pointerdown', { clientX: 500, clientY: 300, button: 2 });
    check('手动暂停时右键不误恢复', RS.game.paused === true);
    firePointer('pointerdown', { clientX: 500, clientY: 300, button: 0 });
    check('手动暂停时左键恢复', RS.game.paused === false);
    runFrames(31, 90);
    check('60 帧游戏渲染无异常', true);

    // 地图远角的第二入口：探索终端后左键打开，图鉴期间冻结，关闭后继续。
    const terminal = RS.game.guideTerminal;
    const terminalIndex = Math.floor(terminal.y) * RS.config.MAP_W + Math.floor(terminal.x);
    RS.map.visited[terminalIndex] = 1;
    RS.camera.centerOnWorld(terminal.x, terminal.y);
    RS.render.frame(1 / 60);
    const terminalClient = RS.render.worldToClient(terminal.x, terminal.y);
    check('探索后地图终端可命中', RS.render.guideTerminalHit(terminalClient.x, terminalClient.y));
    firePointer('pointerdown', { clientX: terminalClient.x, clientY: terminalClient.y, button: 0 });
    check('点击地图终端打开图鉴并冻结战局',
      RS.game.guideOpen && RS.game.guideSource === 'terminal' && RS.game.paused);
    RS.render.frame(1 / 60);
    const closeGuide = RS.render.fieldGuideRects.find(r => r.action === 'close');
    firePointer('pointerdown', { clientX: closeGuide.x + 3, clientY: closeGuide.y + 3, button: 0 });
    check('关闭地图图鉴恢复战局', !RS.game.guideOpen && !RS.game.paused);

    // 指挥指令
    RS.game.selectOnly(RS.game.units.filter(u => u.owner === 'player' && u.kind === 'infantry'));
    RS.game.commandSmart(50, 85);
    runFrames(91, 150);
    check('含指令标记/选中面板的渲染无异常', true);

    // 建造栏 → 放置模式 → 幽灵 → 取消
    const pal = RS.render.paletteRects.find(r => r.type === 'power');
    check('建造栏已布局', !!pal);
    firePointer('pointerdown', { clientX: pal.x + 5, clientY: pal.y + 5, button: 0 });
    check('点建造栏进入放置模式', RS.input.buildMode === 'power');
    firePointer('pointermove', { clientX: 500, clientY: 300 });
    runFrames(151, 160);
    check('幽灵放置预览渲染无异常', true);
    firePointer('pointerdown', { clientX: 500, clientY: 300, button: 2 });
    check('右键取消放置模式', RS.input.buildMode === null);
    const mk0 = RS.game.markers.length;
    firePointer('pointerdown', { clientX: pal.x + 5, clientY: pal.y + 5, button: 2 });
    check('右键点建造栏不下指令(不穿透 UI)', RS.input.buildMode === null && RS.game.markers.length === mk0);

    // 生产面板:建兵营 → 选中 → 点图标入队 → 出兵
    RS.game.money = 5000;
    check('兵营开工', RS.game.startConstruction('barracks', 34, 104));
    for (let t = 0; t < 10; t += RS.config.SIM_STEP) RS.game.update(RS.config.SIM_STEP);
    const bar = RS.game.buildings.find(b => b.type === 'barracks' && b.owner === 'player');
    check('兵营完工', bar && bar.done);
    RS.game.selectBuilding(bar);
    runFrames(161, 170);
    const pr = RS.render.prodRects.find(r => r.kind === 'infantry');
    check('生产面板已布局', !!pr);
    const money0 = RS.game.money, n0 = RS.game.units.length;
    firePointer('pointerdown', { clientX: pr.x + 5, clientY: pr.y + 5, button: 0 });
    check('点击图标步兵入队', bar.queue.length === 1 && RS.game.money === money0 - 100);
    for (let t = 0; t < 8; t += RS.config.SIM_STEP) RS.game.update(RS.config.SIM_STEP);
    check('步兵出厂', RS.game.units.length === n0 + 1);
    runFrames(171, 180);
    check('含集结点/生产面板的渲染无异常', true);

    // 建筑面板:成品回收按钮可见、点击退 60% 并清理建筑
    const action = RS.render.buildingActionRect;
    check('选中建筑显示回收按钮', !!action);
    const sellMoney0 = RS.game.money;
    firePointer('pointerdown', { clientX: action.x + 5, clientY: action.y + 5, button: 0 });
    check('点击回收按钮清理建筑并退款',
      !RS.game.buildings.includes(bar) && RS.game.money === sellMoney0 + Math.floor(bar.def.cost * RS.config.buildingRecycleRatio));

    // 深层经济：工厂生产栏包含钻探车；选中钻探车后可用面板按钮展开。
    const factory = RS.game.placeStructure('factory', 42, 102, 'player');
    RS.game.selectBuilding(factory);
    RS.render.frame(1 / 60);
    check('战车工厂生产栏包含深层钻探车',
      RS.render.prodRects.length === 7 && !!RS.render.prodRects.find(r => r.kind === 'drillRig'));
    const dcx = 56.5, dcy = 72.5;
    const depleted = [];
    for (let j = 67; j <= 78; j++) for (let i = 51; i <= 62; i++) {
      const d = Math.hypot(i + 0.5 - dcx, j + 0.5 - dcy);
      if (d > RS.config.deepEconomy.deployRadius) continue;
      const t = RS.map.at(i, j);
      if (!t) continue;
      t.ore = 0; t.oreOrigin = false; t.rock = false; t.d = 0;
      RS.map.setBlocked(i, j, false);
      depleted.push({ t, d, i, j });
    }
    depleted.sort((a, b) => a.d - b.d);
    for (let k = 0; k < 32; k++) {
      depleted[k].t.oreOrigin = true;
      RS.map.visited[depleted[k].j * RS.config.MAP_W + depleted[k].i] = 1;
      if (!RS.map.oreTiles.some(p => p.i === depleted[k].i && p.j === depleted[k].j))
        RS.map.oreTiles.push({ i: depleted[k].i, j: depleted[k].j });
    }
    for (let j = 68; j <= 76; j++) for (let i = 52; i <= 60; i++)
      RS.map.visited[j * RS.config.MAP_W + i] = 1;
    const drillRig = RS.game.spawnUnitAt('drillRig', dcx, dcy, 'player');
    RS.game.selectOnly([drillRig]);
    RS.render.frame(1 / 60);
    const deployAction = RS.render.unitActionRect;
    check('钻探车选中面板显示展开按钮', !!deployAction);
    check('选中钻探车后地图显示绿色可展开位置',
      RS.render.deepMineGuideSpots.length > 0,
      '候选=' + RS.render.deepMineGuideSpots.length);
    firePointer('pointerdown', {
      clientX: deployAction.x + 5, clientY: deployAction.y + 5, button: 0,
    });
    check('点击展开按钮转换为深层开采站',
      !RS.game.units.includes(drillRig) &&
      RS.game.buildings.some(b => b.owner === 'player' && b.type === 'deepMine'));
    RS.render.frame(1 / 60);
    check('钻探车展开后绿色位置提示消失', RS.render.deepMineGuideSpots.length === 0);

    // 开火模式:选中作战单位显示切换按钮;点击与 H 键都翻转停火状态
    const fmU = RS.game.spawnUnitAt('rocket', dcx + 2, dcy, 'player');
    RS.game.selectOnly([fmU]);
    RS.render.frame(1 / 60);
    const fmBtn = RS.render.fireModeRect;
    check('选中作战单位显示开火模式按钮', !!fmBtn);
    firePointer('pointerdown', { clientX: fmBtn.x + 5, clientY: fmBtn.y + 5, button: 0 });
    check('点击开火按钮切换为停火', fmU.holdFire === true);
    fireKey('keydown', { code: 'KeyH' });
    fireKey('keyup', { code: 'KeyH' });
    check('H 键恢复自由开火', fmU.holdFire === false);
    RS.game.clearSelection();
    RS.render.frame(1 / 60);
    check('清空选择后开火按钮隐藏', RS.render.fireModeRect === null);

    // 缩放:按 delta 平滑变化、鼠标锚点不漂、可拉远到战略视野
    const zoom0 = RS.camera.zoom;
    const anchor0 = RS.render.clientToWorld(420, 260);
    firePointer('wheel', { deltaY: -100, deltaMode: 0, clientX: 420, clientY: 260 });
    const anchor1 = RS.render.clientToWorld(420, 260);
    check('滚轮向前平滑放大', RS.camera.zoom > zoom0, 'zoom=' + RS.camera.zoom.toFixed(2));
    check('缩放以鼠标位置为锚',
      Math.hypot(anchor1.x - anchor0.x, anchor1.y - anchor0.y) < 0.001,
      '偏差=' + Math.hypot(anchor1.x - anchor0.x, anchor1.y - anchor0.y).toFixed(5));
    for (let k = 0; k < 24; k++)
      firePointer('wheel', { deltaY: 100, deltaMode: 0, clientX: 640, clientY: 360 });
    check('滚轮向后可拉远到战略视野', RS.camera.zoom <= 0.43,
      'zoom=' + RS.camera.zoom.toFixed(2));
    runFrames(181, 200);
    check('缩放后渲染无异常', true);

    // 一键兵种召集:左Alt+1=步兵类,左Alt+2=作战载具;矿车不混入战车组
    RS.game.spawnUnitAt('rocket', 38, 98, 'player');
    RS.game.spawnUnitAt('heavyTank', 39, 98, 'player');
    RS.game.clearSelection();
    fireKey('keydown', { code: 'Digit1' });
    check('单独数字 1 不触发兵种召集', RS.game.selection.size === 0);
    fireKey('keyup', { code: 'Digit1' });
    fireKey('keydown', { code: 'AltRight', altKey: true });
    fireKey('keydown', { code: 'Digit1', altKey: true });
    check('右 Alt+1 不触发兵种召集', RS.game.selection.size === 0);
    fireKey('keyup', { code: 'Digit1', altKey: true });
    fireKey('keyup', { code: 'AltRight' });
    fireKey('keydown', { code: 'AltLeft', altKey: true });
    const alt1Prevented = fireKey('keydown', { code: 'Digit1', altKey: true });
    let expectedGroup = RS.game.units.filter(u =>
      u.owner === 'player' && RS.units.TYPES[u.kind].quickGroup === 'infantry');
    check('左 Alt+1 全选步兵与火箭兵且拦截默认键',
      alt1Prevented && RS.game.selection.size === expectedGroup.length &&
      expectedGroup.every(u => RS.game.selection.has(u)));
    fireKey('keyup', { code: 'Digit1', altKey: true });
    const alt2Prevented = fireKey('keydown', { code: 'Digit2', altKey: true });
    expectedGroup = RS.game.units.filter(u =>
      u.owner === 'player' && RS.units.TYPES[u.kind].quickGroup === 'vehicle');
    check('左 Alt+2 全选作战载具且拦截默认键',
      alt2Prevented && RS.game.selection.size === expectedGroup.length &&
      expectedGroup.every(u => RS.game.selection.has(u)));
    check('战车快捷组排除矿车',
      [...RS.game.selection].every(u => u.kind !== 'harvester'));
    fireKey('keyup', { code: 'Digit2', altKey: true });
    RS.camera.x = 0; RS.camera.y = 0;
    fireKey('keydown', { code: 'Digit1', altKey: true });
    fireKey('keyup', { code: 'Digit1', altKey: true });
    fireKey('keydown', { code: 'Digit1', altKey: true });
    const selectedInf = [...RS.game.selection];
    const cx = selectedInf.reduce((sum, u) => sum + u.x, 0) / selectedInf.length;
    const cy = selectedInf.reduce((sum, u) => sum + u.y, 0) / selectedInf.length;
    const cp = RS.iso.toScreen(cx, cy);
    check('连按两次左 Alt+1 选择并居中到步兵组',
      Math.hypot(RS.camera.x - cp.x, RS.camera.y - cp.y) < 0.001);
    fireKey('keyup', { code: 'Digit1', altKey: true });
    fireKey('keyup', { code: 'AltLeft' });

    const v = RS.map.visited;
    check('基地周边已探索', !!(v && v[100 * RS.config.MAP_W + 31] === 1));
    check('远方角落未探索(全黑)', !!(v && v[10 * RS.config.MAP_W + 10] === 0));
    check('装饰阻挡规则(枯树石柱挡路,沙柳放行)',
      RS.sprites.decor[0].block === true && RS.sprites.decor[1].block === true && RS.sprites.decor[2].block === false);
    const mm = RS.render.minimapHit(window.innerWidth - 90, 124);
    check('小地图命中检测', !!mm, mm ? (mm.x.toFixed(0) + ',' + mm.y.toFixed(0)) : 'null');
    const camX0 = RS.camera.x;
    firePointer('pointerdown', { clientX: window.innerWidth - 90, clientY: 124, button: 0 });
    check('点小地图镜头跳转', RS.camera.x !== camX0);

    // BGM:Node 无 AudioContext 应降级为空操作且不抛异常
    check('audio.bgm 存在', !!(RS.audio && RS.audio.bgm));
    check('视野出现敌军选择战斗配乐',
      RS.pickBgmTrack({ state: 'playing', time: 20, enemyVisible: true, enemyContactUntil: 0, suddenDeath: false, waveWarn: 0 }) === 'tension');
    check('脱离接触后短暂保持战斗配乐',
      RS.pickBgmTrack({ state: 'playing', time: 20, enemyVisible: false, enemyContactUntil: 24, suddenDeath: false, waveWarn: 0 }) === 'tension');
    check('无敌情时选择发展配乐',
      RS.pickBgmTrack({ state: 'playing', time: 20, enemyVisible: false, enemyContactUntil: 0, suddenDeath: false, waveWarn: 0 }) === 'peace');
    RS.audio.bgm.set('title'); RS.audio.bgm.set('tension'); RS.audio.bgm.set(null);
    runFrames(201, 210);
    check('BGM 切换/主循环共存无异常', true);

    // 触屏:点按建造栏进入/退出放置模式;点小地图跳转;暂停逻辑冻结
    firePointer('pointerdown', { clientX: pal.x + 5, clientY: pal.y + 5, pointerType: 'touch', button: 0 });
    firePointer('pointerup', { clientX: pal.x + 5, clientY: pal.y + 5, pointerType: 'touch', button: 0 });
    check('触屏点建造栏进入放置模式', RS.input.buildMode === 'power');
    firePointer('pointerdown', { clientX: pal.x + 5, clientY: pal.y + 5, pointerType: 'touch', button: 0 });
    firePointer('pointerup', { clientX: pal.x + 5, clientY: pal.y + 5, pointerType: 'touch', button: 0 });
    check('触屏再点退出放置模式', RS.input.buildMode === null);
    let touchJump = false;
    const origCOW = RS.camera.centerOnWorld;
    RS.camera.centerOnWorld = (x, y) => { touchJump = true; return origCOW(x, y); };
    firePointer('pointerdown', { clientX: window.innerWidth - 90, clientY: 124, pointerType: 'touch', button: 0 });
    firePointer('pointerup', { clientX: window.innerWidth - 90, clientY: 124, pointerType: 'touch', button: 0 });
    check('触屏点小地图镜头跳转', touchJump);
    RS.camera.centerOnWorld = origCOW;
    RS.game.paused = true;
    const gt0 = RS.game.time;
    runFrames(211, 220);
    check('暂停时逻辑冻结(渲染照常)', RS.game.time === gt0);
    RS.game.paused = false;

    // 终局战报:完整统计与成就可渲染；只有明确按钮的左键会返回标题。
    RS.game.stats.unitsKilled = 17;
    RS.game.stats.unitsLost = 6;
    RS.game.stats.buildingsDestroyed = 4;
    RS.game.stats.buildingsLost = 2;
    RS.game.stats.unitsProduced = 23;
    RS.game.stats.resourcesMined = 6100;
    RS.game.stats.moneyPeak = 2400;
    RS.game.stats.moneyLow = 35;
    RS.game.stats.achievements = ['战场清道夫', '攻城先锋'];
    RS.game.state = 'won';
    runFrames(221, 222);
    check('终局战绩与成就面板已布局', !!RS.render.endActionRect);
    firePointer('pointerdown', { clientX: 30, clientY: 30, button: 0 });
    check('结算屏空白点击不误重开', reloads === 0);
    const endBtn = RS.render.endActionRect;
    firePointer('pointerdown', { clientX: endBtn.x + 5, clientY: endBtn.y + 5, button: 2 });
    check('结算按钮右键不误重开', reloads === 0);
    firePointer('pointerdown', { clientX: endBtn.x + 5, clientY: endBtn.y + 5, button: 0 });
    check('结算按钮左键返回标题', reloads === 1);
  } catch (e) {
    failures++;
    console.log('  FAIL  运行时异常: ' + e.message);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }

  console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
  process.exit(failures === 0 ? 0 : 1);
})();

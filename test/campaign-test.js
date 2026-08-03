/* 三章剧情模式回归：章节/目标、隐藏判型、第三章固定战术、CG 时长与过场完成。
 * 运行：node test/campaign-test.js */
'use strict';

require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/game.js');
require('../src/combat.js');
require('../src/ai.js');
require('../src/cutscene.js');
require('../src/campaign.js');

const RS = globalThis.RS;
const campaign = RS.campaign;
const cutscene = RS.cutscene;
let failures = 0;
const STYLE_LABELS = {
  balanced: '均衡',
  rush: '速攻',
  infantry: '步兵海',
  armor: '装甲推进',
  turtle: '龟缩防守',
};

function check(name, condition, detail) {
  if (condition) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

function sumDuration(scene) {
  return scene.frames.reduce((sum, frame) => sum + Number(frame.duration || 0), 0);
}

function skipScene() {
  check('当前过场可跳过', cutscene.active && cutscene.skip());
}

function beginCampaign(difficulty) {
  campaign.init();
  campaign.open();
  check('战役难度选择有效：' + difficulty, campaign.selectDifficulty(difficulty));
  check('难度在开场前已保存：' + difficulty,
    campaign.getState().difficulty === difficulty);
  skipScene();
  const state = campaign.getState();
  check('开场后进入第一章简报：' + difficulty,
    state.phase === 'briefing' && state.chapter === 1);
}

function winCurrentChapter(stats) {
  check('从简报开始当前章节', campaign.handleAction('start-chapter'));
  if (stats) Object.assign(RS.game.stats, stats);
  RS.game.state = 'won';
  campaign.update(0);
}

function finishChapterTransition() {
  skipScene();
  skipScene();
}

function reachThirdChapter(difficulty, secondChapterStats) {
  beginCampaign(difficulty);
  winCurrentChapter();
  finishChapterTransition();
  winCurrentChapter(secondChapterStats);
  const styleAfterWin = campaign.getState().style;
  finishChapterTransition();
  const briefing = campaign.getState();
  check('第二章胜利后进入第三章简报：' + difficulty,
    briefing.phase === 'briefing' && briefing.chapter === 3);
  const storyView = JSON.stringify(campaign.draw(null, 1280, 720));
  check('第三章可以开始：' + difficulty, campaign.handleAction('start-chapter'));
  return {
    styleAfterWin,
    storyView,
    state: campaign.getState(),
  };
}

const STYLE_FIXTURES = {
  balanced: {
    duration: 1050,
    firstMainAttackTime: 500,
    unitsProduced: 11,
    unitsLost: 3,
    producedByKind: { infantry: 5, rocket: 1, lightTank: 3, heavyTank: 2 },
    lostByKind: { infantry: 2, lightTank: 1 },
    buildingsCompletedByType: { refinery: 2, turret: 1 },
    totalIncome: 5200,
  },
  rush: {
    duration: 600,
    firstMainAttackTime: 100,
    unitsProduced: 8,
    unitsLost: 1,
    producedByKind: { infantry: 3, rocket: 1, lightTank: 3, heavyTank: 1 },
    lostByKind: { infantry: 1 },
    buildingsCompletedByType: { refinery: 1 },
    totalIncome: 3000,
  },
  infantry: {
    duration: 1050,
    firstMainAttackTime: 500,
    unitsProduced: 42,
    unitsLost: 12,
    producedByKind: { infantry: 28, rocket: 12, lightTank: 2 },
    lostByKind: { infantry: 9, rocket: 3 },
    buildingsCompletedByType: { refinery: 2, turret: 1 },
    totalIncome: 6500,
  },
  armor: {
    duration: 1050,
    firstMainAttackTime: 500,
    unitsProduced: 32,
    unitsLost: 5,
    producedByKind: {
      infantry: 1, rocket: 1, lightTank: 12, heavyTank: 10, artillery: 8,
    },
    lostByKind: { lightTank: 3, heavyTank: 2 },
    buildingsCompletedByType: { refinery: 2, turret: 1 },
    totalIncome: 7200,
  },
  turtle: {
    duration: 1600,
    firstMainAttackTime: 900,
    unitsProduced: 15,
    unitsLost: 3,
    producedByKind: { infantry: 5, rocket: 3, lightTank: 4, heavyTank: 3 },
    lostByKind: { infantry: 2, lightTank: 1 },
    buildingsCompletedByType: { refinery: 3, deepMine: 1, turret: 6 },
    totalIncome: 12000,
  },
};

console.log('\n[章节与唯一目标]');
check('正篇恰好三章', campaign.chapters.length === 3,
  '章节数=' + campaign.chapters.length);
const objectiveKeysValid = campaign.chapters.every(chapter => {
  const keys = Object.keys(chapter).filter(key => /objective|goal/i.test(key));
  return keys.length === 1 && keys[0] === 'objective';
});
check('每章只声明一个目标字段', objectiveKeysValid);
check('三章唯一目标均为摧毁指挥中心',
  campaign.chapters.every(chapter =>
    chapter.objective.id === 'destroy-command-center' &&
    chapter.objective.targetOwner === 'enemy' &&
    chapter.objective.targetType === 'cc' &&
    /^摧毁(?:敌方|中枢主)指挥中心$/.test(chapter.objective.text)),
  campaign.chapters.map(chapter => chapter.objective.text).join(' / '));
check('目标中没有护送、上传、占点、收集或黑客任务',
  campaign.chapters.every(chapter =>
    !/护送|上传|占点|收集|黑客|入侵/.test(chapter.objective.text)));

console.log('\n[CG 时长]');
check('开场 CG 为 53 秒', sumDuration(campaign.scenes.opening) === 53,
  sumDuration(campaign.scenes.opening) + 's');
const verticalSlice = campaign.scenes.opening.frames.filter(frame =>
  campaign.openingSample.frameIds.includes(frame.id));
check('O-02 至 O-04 三镜完整', verticalSlice.length === 3);
check('O-02 至 O-04 合计 23 秒',
  campaign.openingSample.duration === 23 &&
  verticalSlice.reduce((sum, frame) => sum + frame.duration, 0) === 23,
  verticalSlice.reduce((sum, frame) => sum + frame.duration, 0) + 's');
check('最终胜利 CG 为 40 秒', sumDuration(campaign.scenes.finalVictory) === 40,
  sumDuration(campaign.scenes.finalVictory) + 's');
check('最终战败 CG 为 40 秒', sumDuration(campaign.scenes.finalDefeat) === 40,
  sumDuration(campaign.scenes.finalDefeat) + 's');

console.log('\n[关键帧数据]');
const motionNames = new Set(Object.keys(cutscene.motions || {}));
let frameCount = 0;
const badFrames = [];
const uniqueArt = new Set();
for (const sceneData of Object.values(campaign.scenes)) {
  for (const frame of sceneData.frames) {
    frameCount++;
    uniqueArt.add(frame.art);
    if (!/^art\/campaign\/cg\/.+\.png$/.test(frame.art || '')) badFrames.push(frame.id + ':art');
    if (!motionNames.has(frame.motion)) badFrames.push(frame.id + ':motion=' + frame.motion);
  }
}
check('全部 ' + frameCount + ' 个镜头都有合法 CG 路径与运镜预设',
  badFrames.length === 0, badFrames.join(' / '));
check('CG 关键帧恰好 25 张', uniqueArt.size === 25, uniqueArt.size + ' 张');
check('播放器提供图片预热接口', typeof cutscene.warm === 'function');
check('带 art 的镜头在 Node 下降级为兜底且不报错', (function () {
  const artScene = {
    id: 'art-test',
    frames: [{ id: 'X', duration: 0.1, art: 'art/campaign/cg/none.png', motion: 'slow-push', visual: 'chapter-card' }],
  };
  const ok = cutscene.start(artScene, () => {});
  cutscene.update(0.2);
  return ok && !cutscene.active;
})());

console.log('\n[五类风格判定]');
const classified = {};
for (const [expected, stats] of Object.entries(STYLE_FIXTURES)) {
  classified[expected] = campaign.classifyStyle(stats);
  check('判定样本：' + STYLE_LABELS[expected],
    classified[expected] === expected,
    '实际=' + classified[expected]);
}
const allowedStyles = ['balanced', 'rush', 'infantry', 'armor', 'turtle'];
check('判定结果恰好覆盖五类',
  new Set(Object.values(classified)).size === 5 &&
  Object.values(classified).every(style => allowedStyles.includes(style)),
  Object.values(classified).join(' / '));

console.log('\n[判定时机]');
beginCampaign('hard');
check('第一章开始前没有风格判定',
  campaign.getState().style === null && !campaign.getState().styleClassified);
winCurrentChapter();
check('第一章胜利后仍不判型',
  campaign.getState().style === null && !campaign.getState().styleClassified);
finishChapterTransition();
check('第二章简报阶段仍不判型',
  campaign.getState().chapter === 2 &&
  campaign.getState().style === null &&
  !campaign.getState().styleClassified);
check('第二章可以开始', campaign.handleAction('start-chapter'));
Object.assign(RS.game.stats, STYLE_FIXTURES.rush);
campaign.update(0);
check('第二章战斗未胜利时不判型',
  RS.game.state === 'playing' &&
  campaign.getState().style === null &&
  !campaign.getState().styleClassified);
RS.game.state = 'won';
campaign.update(0);
check('第二章胜利后才完成一次判型',
  campaign.getState().style === 'rush' &&
  campaign.getState().styleClassified);

beginCampaign('ultra');
winCurrentChapter();
finishChapterTransition();
check('第二章失败样本可以开始', campaign.handleAction('start-chapter'));
Object.assign(RS.game.stats, STYLE_FIXTURES.armor);
RS.game.state = 'lost';
campaign.update(0);
check('第二章失败不进行风格判定',
  campaign.getState().style === null &&
  !campaign.getState().styleClassified);

console.log('\n[第三章固定战术]');
const hardRun = reachThirdChapter('hard', STYLE_FIXTURES.infantry);
check('Hard 保留第二章后台判定但固定 balanced',
  hardRun.styleAfterWin === 'infantry' &&
  hardRun.state.frozenProfile === 'balanced' &&
  RS.ai.profile === 'balanced',
  'style=' + hardRun.styleAfterWin + ', profile=' + hardRun.state.frozenProfile);

const expectedProfiles = {
  balanced: 'balanced',
  rush: 'antiRush',
  infantry: 'antiInfantry',
  armor: 'antiArmor',
  turtle: 'antiTurtle',
};
const ultraStoryViews = [];
for (const [style, stats] of Object.entries(STYLE_FIXTURES)) {
  const ultraRun = reachThirdChapter('ultra', stats);
  ultraStoryViews.push(ultraRun.storyView);
  check('Ultra 第三章载入固定克制战术：' + STYLE_LABELS[style],
    ultraRun.styleAfterWin === style &&
    ultraRun.state.frozenProfile === expectedProfiles[style] &&
    RS.ai.profile === expectedProfiles[style],
    'style=' + ultraRun.styleAfterWin + ', profile=' + ultraRun.state.frozenProfile);
}
const fixedBefore = campaign.getState().frozenProfile;
Object.assign(RS.game.stats, STYLE_FIXTURES.rush);
campaign.update(0);
check('第三章战斗中不重新判型或切换战术',
  campaign.getState().frozenProfile === fixedBefore &&
  RS.ai.profile === fixedBefore,
  'profile=' + campaign.getState().frozenProfile);

console.log('\n[剧情保密与难度同文]');
const visibleStory = JSON.stringify({
  chapters: campaign.chapters,
  scenes: campaign.scenes,
});
const forbiddenLeaks = [
  '已识别你的风格', '正在针对', '针对玩家', '克制战术',
  '均衡', '速攻', '步兵海', '装甲推进', '龟缩防守',
  'antiRush', 'antiInfantry', 'antiArmor', 'antiTurtle',
];
const leaks = forbiddenLeaks.filter(word => visibleStory.includes(word));
check('剧情、简报和过场不泄露判型或针对信息',
  leaks.length === 0, leaks.join(' / '));
const chapter3Keys = Object.keys(campaign.chapters[2]);
check('第三章不存在 Hard/Ultra 分支文案字段',
  !chapter3Keys.some(key => /hard|ultra/i.test(key)),
  chapter3Keys.join(','));
check('Hard 与 Ultra Hard 读取完全相同的第三章剧情',
  ultraStoryViews.length === 5 &&
  ultraStoryViews.every(storyView => storyView === hardRun.storyView));

console.log('\n[过场播放器]');
campaign.init();
let completed = 0;
let completeEvent = null;
const completeScene = {
  id: 'test-complete',
  frames: [
    { id: 'A', duration: 0.1, visual: 'chapter-card' },
    { id: 'B', duration: 0.2, visual: 'chapter-card' },
  ],
};
check('过场播放器接受合法场景',
  cutscene.start(completeScene, event => {
    completed++;
    completeEvent = event;
  }));
check('过场总时长正确',
  Math.abs(cutscene.getState().totalDuration - 0.3) < 0.000001);
cutscene.update(0.31);
check('自然播完只回调一次',
  !cutscene.active && completed === 1 &&
  completeEvent.reason === 'complete' && !completeEvent.skipped);

let skipped = 0;
let skipEvent = null;
check('可重新开始过场',
  cutscene.start(completeScene, event => {
    skipped++;
    skipEvent = event;
  }));
check('skip 结束正在播放的过场', cutscene.skip());
check('跳过只回调一次并标记 skipped',
  !cutscene.active && skipped === 1 &&
  skipEvent.reason === 'skipped' && skipEvent.skipped);
check('停止后再次 skip 不会重复完成', !cutscene.skip() && skipped === 1);

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

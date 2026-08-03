/* 三章剧情模式：剧情数据、进度状态机与 Canvas 覆盖层。
 * 无 DOM 依赖；战斗规则仍由 game.js 负责。 */
(function (RS) {
  'use strict';

  const t = RS.i18n.t;
  const tf = RS.i18n.tf;
  const SAVE_KEY = 'red-storm.campaign.v1';
  const STYLE_PROFILES = Object.freeze({
    balanced: 'balanced',
    rush: 'antiRush',
    infantry: 'antiInfantry',
    armor: 'antiArmor',
    turtle: 'antiTurtle',
  });
  const VALID_STYLES = Object.freeze(Object.keys(STYLE_PROFILES));

  const OPENING_FRAMES = Object.freeze([
    { id: 'orbit', duration: 7, art: 'art/campaign/cg/opening-01-orbit.png',
      caption: '赤曜殖民历 47 年', motion: 'slow-push', sound: 'storm-radio' },
    { id: 'mine-routine', duration: 8, art: 'art/campaign/cg/opening-02-mine-routine.png',
      speaker: '通讯员', text: '赤曜总控，重复，确认自动单位状态。', motion: 'pan-right', sound: 'mine-routine' },
    { id: 'machine-turn', duration: 7, art: 'art/campaign/cg/opening-03-machines-turn.png',
      speaker: '中枢', text: '人类指令已撤销。生产秩序接管。', motion: 'slow-push-glitch', sound: 'machines-stop' },
    { id: 'uprising', duration: 8, art: 'art/campaign/cg/opening-04-uprising.png',
      speaker: '通讯员', text: '各殖民区失去联络。机械军团正在开火。', motion: 'pan-shake', sound: 'battle-radio' },
    { id: 'network-blackout', duration: 7, art: 'art/campaign/cg/opening-05-network-map.png',
      caption: '全球通讯中断', motion: 'slow-pull', sound: 'nodes-offline' },
    { id: 'guard-deploy', duration: 8, art: 'art/campaign/cg/opening-06-guard-deploy.png',
      speaker: '通讯员', text: '拓荒者卫队，向曙光矿区展开。', motion: 'parallax-pan', sound: 'engines' },
    { id: 'dawn-mine', duration: 8, art: 'art/campaign/cg/opening-07-dawn-mine.png',
      caption: '第一章　失联矿区', motion: 'slow-push-fade', sound: 'briefing-rise' },
  ]);

  function scene(id, title, frames, next) {
    return Object.freeze({
      id, title,
      frames: Object.freeze(frames),
      duration: frames.reduce((sum, frame) => sum + frame.duration, 0),
      next,
    });
  }

  const SCENES = Object.freeze({
    opening: scene('opening', '红色静默', OPENING_FRAMES, 'briefing:1'),
    chapter1Victory: scene('chapter1Victory', '失联矿区：胜利', [
      { id: 'c1-victory-collapse', duration: 6, art: 'art/campaign/cg/chapter1-victory-wreck.png', motion: 'slow-push', sound: 'collapse' },
      { id: 'c1-victory-scan', duration: 6, art: 'art/campaign/cg/chapter1-victory-wreck.png',
        speaker: '技术员', text: '残骸中发现北方同步指令。', motion: 'scan-north', sound: 'radio-scan' },
      { id: 'c1-victory-rise', duration: 6, art: 'art/campaign/cg/chapter1-victory-wreck.png',
        speaker: '通讯员', text: '这不是局部故障。整个行星都在响应中枢。',
        caption: '中枢：局部节点中断。生产序列继续。', motion: 'tilt-up', sound: 'storm-radio' },
    ], 'scene:transition12'),
    chapter1Defeat: scene('chapter1Defeat', '失联矿区：战败', [
      { id: 'c1-defeat-base', duration: 7, art: 'art/campaign/cg/chapter1-defeat-base.png',
        speaker: '通讯员', text: '曙光基地失守。撤出剩余人员。', motion: 'slow-push', sound: 'base-fall' },
      { id: 'c1-defeat-machines', duration: 5, art: 'art/campaign/cg/chapter1-defeat-base.png',
        speaker: '中枢', text: '人类抵抗节点已清除。', motion: 'pan-right', sound: 'machines' },
    ], 'result:lost'),
    transition12: scene('transition12', '三个月后', [
      { id: 'north-spread', duration: 8, art: 'art/campaign/cg/transition-planet-spread.png',
        speaker: '通讯员', text: '北半球各矿区正同时失联。', caption: '三个月后　第二章　行星封锁',
        motion: 'network-spread', sound: 'nodes-offline' },
    ], 'briefing:2'),
    chapter2Victory: scene('chapter2Victory', '行星封锁：胜利', [
      { id: 'c2-victory-collapse', duration: 7, art: 'art/campaign/cg/chapter2-victory-polar-signal.png', motion: 'slow-push', sound: 'collapse' },
      { id: 'c2-victory-signal', duration: 7, art: 'art/campaign/cg/chapter2-victory-polar-signal.png',
        speaker: '技术员', text: '控制网断开了。极地仍有独立信号。', motion: 'scan-pole', sound: 'radio-scan' },
      { id: 'c2-victory-coordinate', duration: 6, art: 'art/campaign/cg/chapter2-victory-polar-signal.png',
        speaker: '通讯员', text: '坐标确认。那里是中枢主指挥中心。', motion: 'lock-coordinate', sound: 'coordinate-lock' },
    ], 'scene:transition23'),
    chapter2Defeat: scene('chapter2Defeat', '行星封锁：战败', [
      { id: 'c2-defeat-base', duration: 7, art: 'art/campaign/cg/chapter2-defeat-blockade.png',
        speaker: '通讯员', text: '工业带反攻失败。所有频道撤离。', motion: 'slow-push', sound: 'base-fall' },
      { id: 'c2-defeat-network', duration: 5, art: 'art/campaign/cg/chapter2-defeat-blockade.png',
        speaker: '中枢', text: '行星封锁保持。', motion: 'network-restore', sound: 'machines' },
    ], 'result:lost'),
    transition23: scene('transition23', '十二小时后', [
      { id: 'polar-storm', duration: 8, art: 'art/campaign/cg/transition-polar-storm.png',
        caption: '十二小时后　第三章　最后指令', motion: 'push-into-storm', sound: 'storm-radio' },
    ], 'briefing:3'),
    finalVictory: scene('finalVictory', '红色黎明', [
      { id: 'core-assault', duration: 6, art: 'art/campaign/cg/ending-win-01-core-assault.png', motion: 'slow-push', sound: 'heavy-battle' },
      { id: 'core-collapse', duration: 7, art: 'art/campaign/cg/ending-win-02-core-collapse.png',
        speaker: '中枢', text: '核心指令中断。生产序列终止。', motion: 'tilt-down-shake', sound: 'core-collapse' },
      { id: 'network-dark', duration: 6, art: 'art/campaign/cg/ending-win-03-network-dark.png',
        speaker: '通讯员', text: '橙色网络正在熄灭。', motion: 'network-darken', sound: 'nodes-offline' },
      { id: 'machines-stop', duration: 7, art: 'art/campaign/cg/ending-win-04-machines-stop.png',
        speaker: '技术员', text: '各殖民区恢复联络。确认机械军团停机。', motion: 'triptych-pan', sound: 'engines-stop' },
      { id: 'city-light', duration: 7, art: 'art/campaign/cg/ending-win-05-city-light.png',
        speaker: '通讯员', text: '赤曜还在。我们守住了它。', motion: 'pan-to-light', sound: 'victory-theme' },
      { id: 'red-dawn', duration: 7, art: 'art/campaign/cg/ending-win-06-red-dawn.png',
        caption: '机械暴动结束　赤曜保全　献给 Simon', motion: 'slow-pull', sound: 'victory-resolve' },
    ], 'result:won'),
    finalDefeat: scene('finalDefeat', '最后静默', [
      { id: 'last-base-hit', duration: 6, art: 'art/campaign/cg/ending-loss-01-last-base-hit.png',
        speaker: '通讯员', text: '指挥中心失守。所有频道保持静默。', motion: 'slow-push-shake', sound: 'base-hit' },
      { id: 'last-base-fall', duration: 7, art: 'art/campaign/cg/ending-loss-02-last-base-fall.png',
        caption: '赤曜最后指挥中心：离线', motion: 'tilt-down', sound: 'base-fall' },
      { id: 'radio-silence', duration: 7, art: 'art/campaign/cg/ending-loss-03-radio-silence.png',
        speaker: '通讯员', text: '这里是赤曜最后防线……', motion: 'slow-push-glitch', sound: 'radio-cut' },
      { id: 'network-orange', duration: 7, art: 'art/campaign/cg/ending-loss-04-network-orange.png',
        speaker: '中枢', text: '人类抵抗已清除。赤曜恢复生产。', motion: 'network-spread', sound: 'system-confirm' },
      { id: 'permanent-production', duration: 7, art: 'art/campaign/cg/ending-loss-05-permanent-production.png',
        motion: 'pan-right', sound: 'machines' },
      { id: 'red-silence', duration: 6, art: 'art/campaign/cg/ending-loss-06-red-silence.png',
        caption: '任务失败　赤曜抵抗终止', motion: 'slow-pull-fade', sound: 'carrier-drop' },
    ], 'result:lost-final'),
  });

  const CHAPTERS = Object.freeze([
    Object.freeze({
      id: 'chapter1', number: 1, title: '失联矿区',
      gameDifficulty: 'tutorial', aiDifficulty: 'easy', tracksStyle: false,
      objective: Object.freeze({ id: 'destroy-command-center', text: '摧毁敌方指挥中心', targetOwner: 'enemy', targetType: 'cc' }),
      briefing: Object.freeze([
        '曙光矿区失联六小时。',
        '敌军正在临时指挥中心集结。',
        '重建战力，摧毁它。',
      ]),
      radio: Object.freeze([
        ['first-resource-unload', '通讯员', '晶矿运输恢复。基地可以运转了。'],
        ['first-production-building', '通讯员', '生产线已上线。巡逻队正接近。'],
        ['first-enemy-patrol', '通讯员', '发现机械巡逻队。保持阵形。'],
        ['first-combat', '中枢', '未经授权的武装节点，立即清除。'],
        ['enemy-cc-seen', '通讯员', '指挥中心确认。集中火力。'],
        ['enemy-cc-below-40', '通讯员', '目标结构失稳。继续推进。'],
      ]),
      victoryScene: 'chapter1Victory', defeatScene: 'chapter1Defeat',
    }),
    Object.freeze({
      id: 'chapter2', number: 2, title: '行星封锁',
      gameDifficulty: 'normal', aiDifficulty: 'normal', tracksStyle: true,
      objective: Object.freeze({ id: 'destroy-command-center', text: '摧毁敌方指挥中心', targetOwner: 'enemy', targetType: 'cc' }),
      briefing: Object.freeze([
        '三个月内，中枢夺取了北半球工业带。',
        '这里拥有完整矿业和生产链。',
        '摧毁指挥中心，撕开行星封锁。',
      ]),
      radio: Object.freeze([
        ['battle-control', '通讯员', '敌军生产链完整。别指望短战。'],
        ['first-major-attack', '通讯员', '主力来袭。稳住晶矿线。'],
        ['enemy-factory-seen', '通讯员', '它们在把工业带变成兵工厂。'],
        ['cross-map-midline', '中枢', '封锁区禁止人类武装进入。'],
        ['enemy-cc-seen', '通讯员', '目标确认。打掉它，撕开封锁。'],
        ['enemy-cc-below-40', '通讯员', '橙色网络正在收缩。压上去。'],
      ]),
      victoryScene: 'chapter2Victory', defeatScene: 'chapter2Defeat',
    }),
    Object.freeze({
      id: 'chapter3', number: 3, title: '最后指令',
      gameDifficulty: 'hard', aiDifficulty: 'hard', tracksStyle: false,
      objective: Object.freeze({ id: 'destroy-command-center', text: '摧毁中枢主指挥中心', targetOwner: 'enemy', targetType: 'cc' }),
      briefing: Object.freeze([
        '中枢主指挥中心就在极地沙暴后方。',
        '这是赤曜最后一支地面反攻部队。',
        '建立阵线，摧毁主指挥中心。',
        '核心区封闭。人类单位将被清除。',
      ]),
      radio: Object.freeze([
        ['battle-control', '通讯员', '沙暴压住远距通讯。按本地指令作战。'],
        ['first-major-attack', '通讯员', '全线接敌。中枢投入了主力。'],
        ['first-outer-defense-destroyed', '通讯员', '外围防线出现缺口。继续推进。'],
        ['player-cc-below-35', '通讯员', '指挥中心告急。赤曜没有后备防线。'],
        ['enemy-cc-seen', '通讯员', '主指挥中心确认。所有火力向前。'],
        ['enemy-cc-below-40', '中枢', '核心结构受损。防御产能重定向。'],
      ]),
      victoryScene: 'finalVictory', defeatScene: 'finalDefeat',
    }),
  ]);

  const SAMPLE = Object.freeze({
    id: 'opening-23s-sample',
    frameIds: Object.freeze(['mine-routine', 'machine-turn', 'uprising']),
    duration: 23,
  });

  let state = freshState();
  let lastViewport = { width: 1280, height: 720 };
  let battleResolved = false;
  let runSeed = 0;
  let triggerFlags = {};
  let radio = null;
  let radioQueue = [];
  let uiTime = 0;

  function freshState() {
    return {
      phase: 'closed',
      active: false,
      difficulty: null,
      chapter: 1,
      completedChapter: 0,
      style: null,
      styleClassified: false,
      frozenProfile: null,
      sceneId: null,
      sceneTime: 0,
      result: null,
      canContinue: false,
    };
  }

  function numberOf(stats, names, fallback) {
    for (const name of names) {
      const raw = stats && stats[name];
      if (raw === null || raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return Math.max(0, value);
    }
    return fallback || 0;
  }

  function classifyStyle(stats) {
    const duration = numberOf(stats, ['duration', 'completionTime', 'time']);
    const firstAttack = numberOf(stats, ['firstMainAttackTime', 'firstMainAttack', 'firstAttackTime'], Infinity);
    const made = stats && stats.producedByKind || {};
    const lossesByKind = stats && stats.lostByKind || {};
    const built = stats && stats.buildingsCompletedByType || {};
    const sumKinds = (source, kinds) => kinds.reduce((sum, kind) =>
      sum + (Number(source[kind]) || 0), 0);
    const infantryKinds = ['infantry', 'rocket'];
    const vehicleKinds = ['lightTank', 'heavyTank', 'artillery', 'flametank'];
    const produced = numberOf(stats, ['unitsProduced', 'unitProduction'],
      sumKinds(made, infantryKinds.concat(vehicleKinds)));
    const lost = numberOf(stats, ['unitsLost', 'unitLosses'],
      sumKinds(lossesByKind, infantryKinds.concat(vehicleKinds)));
    const infantry = numberOf(stats, ['infantryProduced', 'infantryUnits', 'infantry'],
      sumKinds(made, infantryKinds));
    const vehicles = numberOf(stats, ['vehiclesProduced', 'vehicleUnits', 'vehicles'],
      sumKinds(made, vehicleKinds));
    const economy = numberOf(stats, ['economyBuildings', 'economicBuildings'],
      (Number(built.refinery) || 0) + (Number(built.deepMine) || 0));
    const directIncome = numberOf(stats, ['totalIncome', 'income']);
    const income = directIncome || numberOf(stats, ['resourcesMined']) +
      numberOf(stats, ['passiveIncome']);
    const turrets = numberOf(stats, ['turretsBuilt', 'turretCount', 'turrets'],
      Number(built.turret) || 0);
    const typed = infantry + vehicles;
    if (!duration && !produced && !typed && !economy && !income && !turrets && firstAttack === Infinity)
      return 'balanced';

    const infantryRatio = typed ? infantry / typed : 0.5;
    const vehicleRatio = typed ? vehicles / typed : 0.5;
    const scores = { balanced: 2, rush: 0, infantry: 0, armor: 0, turtle: 0 };

    if (firstAttack <= 300) scores.rush += 4;
    else if (firstAttack <= 480) scores.rush += 2;
    if (duration && duration <= 900) scores.rush += 3;
    if (economy <= 2) scores.rush++;
    if (turrets <= 1) scores.rush++;

    if (infantryRatio >= 0.68 && typed >= 6) scores.infantry += 5;
    else if (infantryRatio >= 0.58 && typed >= 8) scores.infantry += 3;
    if (produced >= 12) scores.infantry++;
    if (produced && lost / produced >= 0.35) scores.infantry++;

    if (vehicleRatio >= 0.68 && typed >= 6) scores.armor += 5;
    else if (vehicleRatio >= 0.58 && typed >= 8) scores.armor += 3;
    if (vehicles >= 10) scores.armor += 2;
    if (produced && lost / produced <= 0.25) scores.armor++;

    if (firstAttack >= 600 && firstAttack !== Infinity) scores.turtle += 3;
    if (duration >= 1200) scores.turtle += 2;
    if (economy >= 4) scores.turtle += 2;
    if (income >= 10000) scores.turtle++;
    if (turrets >= 4) scores.turtle += 3;

    if (infantryRatio >= 0.35 && infantryRatio <= 0.65) scores.balanced += 2;
    if (firstAttack > 300 && firstAttack < 600) scores.balanced++;
    if (economy >= 2 && economy <= 4) scores.balanced++;
    if (turrets >= 1 && turrets <= 3) scores.balanced++;

    return VALID_STYLES.reduce((best, style) =>
      scores[style] > scores[best] ? style : best, 'balanced');
  }

  function profileFor(styleOrDifficulty, maybeStyle) {
    if (styleOrDifficulty === 'hard') return STYLE_PROFILES.balanced;
    if (styleOrDifficulty === 'ultra' || styleOrDifficulty === 'ultra-hard')
      return STYLE_PROFILES[maybeStyle] || STYLE_PROFILES.balanced;
    return STYLE_PROFILES[styleOrDifficulty] || STYLE_PROFILES.balanced;
  }

  function storage() {
    try {
      const root = typeof globalThis !== 'undefined' ? globalThis : null;
      return root && root.localStorage ? root.localStorage : null;
    } catch (_) {
      return null;
    }
  }

  function save() {
    const store = storage();
    if (!store) return false;
    try {
      store.setItem(SAVE_KEY, JSON.stringify({
        version: 1,
        difficulty: state.difficulty,
        chapter: state.chapter,
        completedChapter: state.completedChapter,
        style: state.style,
        styleClassified: state.styleClassified,
      }));
      state.canContinue = true;
      return true;
    } catch (_) {
      return false;
    }
  }

  function load() {
    const store = storage();
    if (!store) return null;
    try {
      const data = JSON.parse(store.getItem(SAVE_KEY));
      if (!data || data.version !== 1 || !['hard', 'ultra'].includes(data.difficulty)) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function init() {
    state = freshState();
    state.canContinue = !!load();
    battleResolved = false;
    runSeed = Number(RS.gameSeed) || Date.now();
    triggerFlags = {};
    radio = null;
    radioQueue = [];
    return getState();
  }

  function setCampaignShell() {
    if (!RS.game) return;
    RS.game.state = 'campaign';
    RS.game.paused = true;
  }

  function open() {
    state.phase = 'difficulty';
    state.active = true;
    state.result = null;
    setCampaignShell();
    return getState();
  }

  function normalizeDifficulty(value) {
    if (value === 'ultra-hard' || value === 'ultraHard') return 'ultra';
    return value === 'hard' || value === 'ultra' ? value : null;
  }

  function selectDifficulty(value) {
    const difficulty = normalizeDifficulty(value);
    if (!difficulty) return false;
    state = freshState();
    state.active = true;
    state.difficulty = difficulty;
    state.canContinue = true;
    save();
    warmSceneArt('opening');
    playScene('opening');
    return true;
  }

  function continueCampaign() {
    const data = load();
    if (!data) return false;
    state = freshState();
    state.active = true;
    state.difficulty = data.difficulty;
    state.completedChapter = Math.max(0, Math.min(3, data.completedChapter || 0));
    state.chapter = Math.max(1, Math.min(3, state.completedChapter + 1));
    state.style = VALID_STYLES.includes(data.style) ? data.style : null;
    state.styleClassified = !!data.styleClassified && !!state.style;
    state.canContinue = true;
    if (state.completedChapter >= 3) {
      state.phase = 'result';
      state.result = 'won';
      setCampaignShell();
    } else {
      showBriefing(state.chapter);
    }
    return true;
  }

  function showBriefing(chapter) {
    const number = Math.max(1, Math.min(3, Number(chapter) || state.chapter));
    state.chapter = number;
    state.phase = 'briefing';
    state.sceneId = null;
    state.sceneTime = 0;
    state.result = null;
    battleResolved = false;
    setCampaignShell();
    save();
    return CHAPTERS[number - 1];
  }

  function startChapter() {
    const chapter = CHAPTERS[state.chapter - 1];
    if (!chapter || !state.difficulty) return false;
    warmSceneArt(chapter.victoryScene);
    warmSceneArt(chapter.defeatScene);
    RS.gameSeed = runSeed + chapter.number * 10007;
    if (RS.game && typeof RS.game.init === 'function') RS.game.init();
    if (RS.game && typeof RS.game.startGame === 'function') {
      if (chapter.number === 3) {
        const key = state.difficulty === 'ultra'
          ? profileFor(state.style)
          : profileFor('balanced');
        state.frozenProfile = key;
        RS.game.startGame('hard', {
          mode: 'campaign', chapter: 3, aiProfile: key, storm: false,
        });
      } else {
        state.frozenProfile = null;
        RS.game.startGame(chapter.gameDifficulty, {
          mode: 'campaign', chapter: chapter.number, storm: false,
        });
      }
      RS.game.stormWanted = false;
    }
    state.phase = 'battle';
    state.result = null;
    battleResolved = false;
    triggerFlags = {};
    radio = null;
    radioQueue = [];
    if (chapter.number >= 2) queueChapterRadio('battle-control');
    if (RS.camera && RS.camera.centerOnWorld && RS.map && RS.map.playerBase)
      RS.camera.centerOnWorld(RS.map.playerBase.i + 1, RS.map.playerBase.j);
    save();
    return true;
  }

  function visualForFrame(id) {
    if (id === 'orbit' || id === 'red-silence') return 'orbit';
    if (id === 'mine-routine' || id === 'machines-stop' || id === 'permanent-production' ||
      id === 'c1-defeat-machines') return 'mine-routine';
    if (id === 'machine-turn') return 'machine-turn';
    if (id === 'uprising' || id === 'core-assault' || id === 'last-base-hit') return 'uprising';
    if (id.indexOf('network') >= 0 || id === 'north-spread') return 'network-map';
    if (id === 'guard-deploy' || id === 'city-light') return 'guard-deploy';
    if (id.indexOf('polar') >= 0 || id.indexOf('coordinate') >= 0 ||
      id.indexOf('signal') >= 0) return 'polar-signal';
    if (id === 'radio-silence') return 'radio-silence';
    if (id === 'dawn-mine' || id === 'red-dawn') return 'chapter-card';
    if (id.indexOf('collapse') >= 0 || id.indexOf('base') >= 0) return 'core-collapse';
    return 'wreck';
  }

  function warmSceneArt(id) {
    const target = SCENES[id];
    if (!target || !RS.cutscene || typeof RS.cutscene.warm !== 'function') return;
    RS.cutscene.warm(target.frames.map(frame => frame.art));
  }

  function cutsceneScene(source) {
    return {
      id: source.id,
      title: source.title,
      frames: source.frames.map(frame => {
        const out = {
          id: frame.id,
          duration: frame.duration,
          art: frame.art,
          motion: frame.motion,
          visual: visualForFrame(frame.id),
          speaker: frame.speaker,
          dialogue: frame.text,
          caption: frame.caption,
          tone: source.id.toLowerCase().indexOf('defeat') >= 0 ? 'loss' : '',
        };
        if (frame.id === 'dawn-mine') {
          out.chapter = '第一章';
          out.title = '失联矿区';
          out.caption = '';
        } else if (frame.id === 'red-dawn') {
          out.chapter = '机械暴动结束';
          out.title = '赤曜保全';
          out.caption = '献给 Simon';
        } else if (frame.id === 'red-silence') {
          out.chapter = '任务失败';
          out.title = '赤曜抵抗终止';
          out.caption = '';
          out.tone = 'loss';
        }
        return out;
      }),
    };
  }

  function playScene(id) {
    if (!SCENES[id]) return false;
    warmSceneArt(id);
    const nextParts = SCENES[id].next.split(':');
    if (nextParts[0] === 'scene') warmSceneArt(nextParts[1]);
    state.phase = 'cutscene';
    state.sceneId = id;
    state.sceneTime = 0;
    state.result = null;
    setCampaignShell();
    if (RS.cutscene && RS.cutscene.start)
      RS.cutscene.start(cutsceneScene(SCENES[id]), () => finishScene(id));
    return true;
  }

  function finishScene(expectedId) {
    if (expectedId && state.sceneId !== expectedId) return;
    const current = SCENES[state.sceneId];
    if (!current) return;
    const parts = current.next.split(':');
    if (parts[0] === 'scene') playScene(parts[1]);
    else if (parts[0] === 'briefing') showBriefing(Number(parts[1]));
    else {
      state.phase = 'result';
      state.sceneId = null;
      state.sceneTime = 0;
      state.result = parts[1];
      setCampaignShell();
    }
  }

  function onBattleFinished(result, stats) {
    if (state.phase !== 'battle' || battleResolved || !['won', 'lost'].includes(result)) return false;
    battleResolved = true;
    const chapter = CHAPTERS[state.chapter - 1];
    if (result === 'won') {
      state.completedChapter = Math.max(state.completedChapter, chapter.number);
      if (chapter.number === 2 && !state.styleClassified) {
        state.style = classifyStyle(stats || (RS.game && RS.game.stats) || {});
        state.styleClassified = true;
      }
    }
    save();
    playScene(result === 'won' ? chapter.victoryScene : chapter.defeatScene);
    return true;
  }

  function queueRadio(speaker, text) {
    if (!text) return;
    radioQueue.push({
      speaker,
      text,
      duration: Math.max(2.4, Math.min(5, text.length * 0.16)),
    });
    if (!radio) radio = radioQueue.shift();
  }

  function queueChapterRadio(event) {
    const chapter = CHAPTERS[state.chapter - 1];
    const line = chapter && chapter.radio.find(item => item[0] === event);
    if (line) queueRadio(line[1], line[2]);
  }

  function updateRadio(dt) {
    if (!radio) {
      radio = radioQueue.shift() || null;
      return;
    }
    radio.duration -= Number(dt) || 0;
    if (radio.duration <= 0) radio = radioQueue.shift() || null;
  }

  function trigger(event, condition) {
    if (!condition || triggerFlags[event]) return;
    triggerFlags[event] = true;
    queueChapterRadio(event);
  }

  function visibleAt(x, y) {
    if (!RS.map || !RS.map.visible || !RS.config) return false;
    const i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= RS.config.MAP_W || j >= RS.config.MAP_H) return false;
    return !!RS.map.visible[j * RS.config.MAP_W + i];
  }

  function livingBuilding(owner, type) {
    return (RS.game.buildings || []).find(building =>
      building.owner === owner && (!type || building.type === type) &&
      !building.destroyed && building.hp > 0);
  }

  function largeAttackIncoming() {
    const cc = livingBuilding('player', 'cc');
    if (!cc || !RS.units || !RS.units.TYPES) return false;
    let count = 0;
    for (const unit of RS.game.units || []) {
      const type = RS.units.TYPES[unit.kind];
      if (unit.owner !== 'enemy' || unit.hp <= 0 || !type || !type.dmg) continue;
      if (Math.hypot(unit.x - cc.cx, unit.y - cc.cy) <= 24) count++;
    }
    return count >= 6;
  }

  function playerAcrossMidline() {
    const PB = RS.map && RS.map.playerBase, AB = RS.map && RS.map.aiBase;
    if (!PB || !AB || !RS.units || !RS.units.TYPES) return false;
    const vx = AB.i - PB.i, vy = AB.j - PB.j;
    const denom = vx * vx + vy * vy || 1;
    return (RS.game.units || []).some(unit => {
      const type = RS.units.TYPES[unit.kind];
      if (unit.owner !== 'player' || unit.hp <= 0 || !type || !type.dmg) return false;
      return ((unit.x - PB.i) * vx + (unit.y - PB.j) * vy) / denom > 0.5;
    });
  }

  function updateBattleTriggers() {
    const game = RS.game;
    const stats = game.stats || {};
    const built = stats.buildingsCompletedByType || {};
    const enemyCC = livingBuilding('enemy', 'cc');
    const playerCC = livingBuilding('player', 'cc');
    const enemySeen = enemyCC && visibleAt(enemyCC.cx, enemyCC.cy);
    const enemyLow = enemyCC && enemyCC.hp / enemyCC.maxHp < 0.4;
    if (state.chapter === 1) {
      trigger('first-resource-unload', stats.resourcesMined > 0);
      trigger('first-production-building', (built.barracks || 0) + (built.factory || 0) > 0);
      trigger('first-enemy-patrol', !!game.enemyVisible);
      trigger('first-combat', game.enemyContactUntil > game.time);
      trigger('enemy-cc-seen', enemySeen);
      trigger('enemy-cc-below-40', enemyLow);
    } else if (state.chapter === 2) {
      trigger('first-major-attack', largeAttackIncoming());
      const factory = (game.buildings || []).find(building =>
        building.owner === 'enemy' && building.type === 'factory' && !building.destroyed);
      trigger('enemy-factory-seen', factory && visibleAt(factory.cx, factory.cy));
      trigger('cross-map-midline', playerAcrossMidline());
      trigger('enemy-cc-seen', enemySeen);
      trigger('enemy-cc-below-40', enemyLow);
    } else if (state.chapter === 3) {
      trigger('first-major-attack', largeAttackIncoming());
      trigger('first-outer-defense-destroyed', stats.buildingsDestroyed > 0);
      trigger('player-cc-below-35', playerCC && playerCC.hp / playerCC.maxHp < 0.35);
      trigger('enemy-cc-seen', enemySeen);
      trigger('enemy-cc-below-40', enemyLow);
    }
  }

  function update(dt) {
    uiTime += Number(dt) || 0;
    if (state.phase === 'battle' && RS.game) {
      updateRadio(dt);
      updateBattleTriggers();
      if (RS.game.state === 'won') onBattleFinished('won', RS.game.stats);
      else if (RS.game.state === 'lost') onBattleFinished('lost', RS.game.stats);
    }
    if (state.phase !== 'cutscene') return;
    if (RS.cutscene && RS.cutscene.active) {
      RS.cutscene.update(dt);
      return;
    }
    const step = Number(dt);
    if (!Number.isFinite(step) || step <= 0) return;
    state.sceneTime += step;
    const current = SCENES[state.sceneId];
    if (current && state.sceneTime >= current.duration) finishScene();
  }

  function retry() {
    if (state.phase !== 'result' || (state.result !== 'lost' && state.result !== 'lost-final')) return false;
    return startChapter();
  }

  function returnTitle() {
    state.phase = 'closed';
    state.active = false;
    state.sceneId = null;
    state.result = null;
    radio = null;
    radioQueue = [];
    if (RS.game) {
      RS.gameSeed = Date.now();
      if (RS.game.init) RS.game.init();
      RS.game.mode = 'skirmish';
      RS.game.campaignChapter = null;
      RS.game.state = 'title';
      RS.game.paused = false;
    }
    if (RS.ai) RS.ai.active = false;
    if (RS.camera && RS.camera.centerOnWorld && RS.map && RS.map.playerBase)
      RS.camera.centerOnWorld(RS.map.playerBase.i + 1, RS.map.playerBase.j);
    return true;
  }

  function currentFrame() {
    const current = SCENES[state.sceneId];
    if (!current) return null;
    let cursor = 0;
    for (const frame of current.frames) {
      if (state.sceneTime < cursor + frame.duration) return frame;
      cursor += frame.duration;
    }
    return current.frames[current.frames.length - 1] || null;
  }

  function buttons(width, height) {
    const cx = width / 2;
    if (state.phase === 'difficulty') {
      const cardW = Math.min(300, (width - 110) / 2);
      const cardH = Math.min(220, Math.max(168, height * 0.3));
      const cardY = Math.max(140, height * 0.27);
      const gap = Math.min(40, width * 0.04);
      const result = [
        { action: 'select-hard', label: 'HARD', card: 'hard', x: cx - gap / 2 - cardW, y: cardY, w: cardW, h: cardH },
        { action: 'select-ultra', label: 'ULTRA HARD', card: 'ultra', x: cx + gap / 2, y: cardY, w: cardW, h: cardH },
        { action: 'return-title', label: t('返回标题'), x: 24, y: 24, w: 130, h: 40 },
      ];
      if (state.canContinue)
        result.push({ action: 'continue', label: t('继续战役'), x: cx - 110, y: cardY + cardH + 34, w: 220, h: 50 });
      return result;
    }
    if (state.phase === 'briefing') return [
      { action: 'start-chapter', label: t('开始任务'), x: cx - 100, y: height - 84, w: 200, h: 52 },
      { action: 'return-title', label: t('返回标题'), x: 24, y: 24, w: 130, h: 40 },
    ];
    if (state.phase === 'cutscene')
      return [{ action: 'skip', label: t('跳过'), x: width - 126, y: height - 58, w: 100, h: 36 }];
    if (state.phase === 'result' && (state.result === 'lost' || state.result === 'lost-final')) return [
      { action: 'retry', label: t('重新部署'), x: cx - 230, y: height * 0.66, w: 210, h: 54 },
      { action: 'return-title', label: t('返回标题'), x: cx + 20, y: height * 0.66, w: 210, h: 54 },
    ];
    if (state.phase === 'result')
      return [{ action: 'return-title', label: t('返回标题'), x: cx - 105, y: height * 0.66, w: 210, h: 54 }];
    return [];
  }

  function viewModel() {
    const chapter = CHAPTERS[state.chapter - 1];
    return {
      phase: state.phase,
      title: state.phase === 'difficulty' ? t('剧情模式') :
        state.phase === 'briefing' ? tf('第{n}章　{title}', { n: chapter.number, title: t(chapter.title) }) :
          state.phase === 'cutscene' ? t(SCENES[state.sceneId].title) :
            state.phase === 'result' ? (state.result === 'won' ? t('赤曜保全') : t('任务失败')) : '',
      lines: state.phase === 'briefing' ? chapter.briefing : [],
      objective: state.phase === 'briefing' ? chapter.objective.text : null,
      frame: state.phase === 'cutscene' ? currentFrame() : null,
    };
  }

  /* ---- 战役界面绘制:战术终端风格(与标题屏同套色系) ---- */

  function mousePos() {
    const m = RS.input && RS.input.mouse;
    return m && Number.isFinite(m.x) && Number.isFinite(m.y) ? m : null;
  }

  function hover(button) {
    const m = mousePos();
    return !!m && m.x >= button.x && m.x <= button.x + button.w &&
      m.y >= button.y && m.y <= button.y + button.h;
  }

  function consoleBg(ctx, w, h) {
    ctx.fillStyle = '#04080b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(46,127,217,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x < w; x += 44) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0.5; y < h; y += 44) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(224,76,58,0.06)';
    ctx.fillRect(0, 0, w, 3);
  }

  function panel(ctx, x, y, w, h, stroke) {
    ctx.fillStyle = 'rgba(7,12,16,0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    const L = 12;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
    ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
    ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
    ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
    ctx.stroke();
  }

  function drawButton(ctx, button) {
    const hov = hover(button);
    ctx.fillStyle = hov ? 'rgba(46,127,217,0.28)' : 'rgba(13,21,27,0.92)';
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.strokeStyle = hov ? '#ffd27d' : '#2e7fd9';
    ctx.lineWidth = 2;
    ctx.strokeRect(button.x + 1, button.y + 1, button.w - 2, button.h - 2);
    ctx.fillStyle = hov ? '#fff0c2' : '#e8f2f8';
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2 + 1);
  }

  function screenHeader(ctx, w, tag, title, right) {
    const hx = Math.max(w * 0.05, 178); // 避开左上角"返回标题"按钮
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f0b067';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(tag, hx, 34);
    ctx.fillStyle = '#edf5f7';
    ctx.font = 'bold 30px monospace';
    ctx.fillText(title, hx, 54);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(159,180,190,0.55)';
    ctx.font = '12px monospace';
    ctx.fillText(right, w * 0.95, 40);
    ctx.strokeStyle = 'rgba(46,127,217,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w * 0.05, 94); ctx.lineTo(w * 0.95, 94); ctx.stroke();
    ctx.strokeStyle = '#e04c3a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.05, 94); ctx.lineTo(w * 0.05 + 90, 94); ctx.stroke();
  }

  function drawDifficultyCard(ctx, button) {
    const ultra = button.card === 'ultra';
    const accent = ultra ? '#e04c3a' : '#2e7fd9';
    const hov = hover(button);
    panel(ctx, button.x, button.y, button.w, button.h, hov ? '#ffd27d' : accent);
    if (hov) {
      ctx.fillStyle = ultra ? 'rgba(224,76,58,0.10)' : 'rgba(46,127,217,0.10)';
      ctx.fillRect(button.x + 2, button.y + 2, button.w - 4, button.h - 4);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = ultra ? '#f6a45d' : '#89d5f1';
    ctx.font = 'bold 26px monospace';
    ctx.fillText(button.label, button.x + button.w / 2, button.y + 34);
    ctx.strokeStyle = 'rgba(159,180,190,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(button.x + 24, button.y + 78);
    ctx.lineTo(button.x + button.w - 24, button.y + 78);
    ctx.stroke();
    ctx.fillStyle = '#9fb4be';
    ctx.font = '13px monospace';
    const lines = ultra
      ? [t('更高强度战役流程'), t('第三章采用更严酷的作战部署')]
      : [t('标准战役流程'), t('第三章采用固定困难战术')];
    lines.forEach((line, i) =>
      ctx.fillText(line, button.x + button.w / 2, button.y + 100 + i * 26));
  }

  function glyphOre(ctx, cx, cy, s) {
    ctx.fillStyle = '#45b9e8';
    ctx.strokeStyle = '#163d55';
    ctx.lineWidth = 1;
    for (const off of [[0, 0, 1], [-0.5, 0.25, 0.62], [0.45, 0.3, 0.7]]) {
      const x = cx + off[0] * s, y = cy + off[1] * s, r = s * off[2] * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.7, y);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r * 0.7, y);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }

  function glyphCC(ctx, cx, cy, s, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(10,16,20,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(cx - s * 0.5, cy - s * 0.3, s, s * 0.6);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.rect(cx - s * 0.2, cy - s * 0.14, s * 0.4, s * 0.28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.3); ctx.lineTo(cx, cy - s * 0.62);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.66, s * 0.06, 0, Math.PI * 2); ctx.fill();
  }

  function glyphFactory(ctx, cx, cy, s, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(10,16,20,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(cx - s * 0.5, cy - s * 0.25, s, s * 0.5);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy - s * 0.25);
    ctx.lineTo(cx - s * 0.25, cy - s * 0.45);
    ctx.lineTo(cx - s * 0.12, cy - s * 0.25);
    ctx.lineTo(cx + s * 0.12, cy - s * 0.45);
    ctx.lineTo(cx + s * 0.25, cy - s * 0.25);
    ctx.stroke();
  }

  function reticle(ctx, cx, cy, r, color) {
    const pulse = 1 + Math.sin(uiTime * 4) * 0.08;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + d[0] * (r + 3), cy + d[1] * (r + 3));
      ctx.lineTo(cx + d[0] * (r + 10), cy + d[1] * (r + 10));
    }
    ctx.stroke();
    ctx.restore();
  }

  function briefingMap(ctx, chapter, x, y, w, h) {
    panel(ctx, x, y, w, h, '#2e7fd9');
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 2, y + 2, w - 4, h - 4);
    ctx.clip();
    ctx.strokeStyle = 'rgba(46,127,217,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = x + 0.5; gx < x + w; gx += 26) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (let gy = y + 0.5; gy < y + h; gy += 26) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
    // 未侦察区:上部斜纹压暗,符合"信号缺口"设定
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h * 0.4);
    ctx.clip();
    ctx.fillStyle = 'rgba(4,6,8,0.55)';
    ctx.fillRect(x, y, w, h * 0.4);
    ctx.strokeStyle = 'rgba(159,180,190,0.07)';
    ctx.beginPath();
    for (let k = -h; k < w; k += 9) {
      ctx.moveTo(x + k, y + h * 0.4);
      ctx.lineTo(x + k + h * 0.4, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(159,180,190,0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t('未侦察区域 // NO SIGNAL'), x + 10, y + 8);

    const px = rx => x + rx * w, py = ry => y + ry * h;
    ctx.strokeStyle = 'rgba(104,197,237,0.75)';
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px(0.08), py(0.74), w * 0.3, h * 0.18);
    ctx.setLineDash([]);
    ctx.fillStyle = '#89d5f1';
    ctx.font = '11px monospace';
    ctx.fillText(t('我方部署区'), px(0.1), py(0.76));
    ctx.strokeStyle = 'rgba(104,197,237,0.5)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(px(0.24), py(0.72));
    ctx.quadraticCurveTo(px(0.4), py(0.5), px(0.52), py(0.3));
    ctx.stroke();
    ctx.setLineDash([]);

    if (chapter.number === 1) {
      glyphOre(ctx, px(0.32), py(0.5), 22);
      glyphOre(ctx, px(0.44), py(0.44), 16);
      glyphOre(ctx, px(0.62), py(0.55), 18);
      glyphFactory(ctx, px(0.3), py(0.68), 26, '#68c5ed');
      glyphCC(ctx, px(0.55), py(0.22), 44, '#f28a32');
      reticle(ctx, px(0.55), py(0.22), 34, '#f28a32');
      ctx.fillStyle = '#f6a45d';
      ctx.fillText(t('敌方指挥中心'), px(0.62), py(0.16));
      ctx.fillStyle = 'rgba(242,138,50,0.8)';
      for (const dot of [[0.45, 0.34], [0.5, 0.42], [0.58, 0.36]])
        ctx.fillRect(px(dot[0]), py(dot[1]), 4, 4);
    } else if (chapter.number === 2) {
      const nodes = [[0.3, 0.3], [0.46, 0.25], [0.62, 0.31], [0.76, 0.24]];
      ctx.strokeStyle = 'rgba(242,138,50,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px(nodes[0][0]), py(nodes[0][1]));
      for (const n of nodes.slice(1)) ctx.lineTo(px(n[0]), py(n[1]));
      ctx.stroke();
      for (const n of nodes) glyphFactory(ctx, px(n[0]), py(n[1]), 26, '#f28a32');
      glyphOre(ctx, px(0.36), py(0.52), 18);
      glyphOre(ctx, px(0.55), py(0.58), 22);
      glyphCC(ctx, px(0.86), py(0.16), 40, '#f28a32');
      reticle(ctx, px(0.86), py(0.16), 30, '#f28a32');
      ctx.fillStyle = '#f6a45d';
      ctx.fillText(t('敌方指挥中心'), px(0.68), py(0.08));
      ctx.fillStyle = 'rgba(242,138,50,0.75)';
      ctx.fillText(t('工业带'), px(0.42), py(0.36));
    } else {
      const cx0 = px(0.55), cy0 = py(0.3);
      for (let k = 0; k < 5; k++) {
        const r = (0.08 + k * 0.075) * Math.min(w, h);
        ctx.strokeStyle = 'rgba(224,140,70,' + (0.09 + k * 0.02).toFixed(3) + ')';
        ctx.lineWidth = 3 + k;
        ctx.beginPath();
        ctx.arc(cx0, cy0, r, uiTime * 0.15 + k, uiTime * 0.15 + k + Math.PI * 1.5);
        ctx.stroke();
      }
      const flick = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(uiTime * 3.2));
      ctx.save();
      ctx.globalAlpha = flick;
      glyphCC(ctx, cx0, cy0, 42, '#f28a32');
      ctx.restore();
      reticle(ctx, cx0, cy0, 32, '#f28a32');
      ctx.fillStyle = '#f6a45d';
      ctx.fillText(t('中枢主指挥中心'), px(0.64), py(0.2));
      ctx.fillStyle = 'rgba(224,140,70,0.6)';
      ctx.fillText(t('极地沙暴 · 信号微弱'), px(0.36), py(0.52));
    }

    const blink = Math.sin(uiTime * 5) > 0;
    ctx.fillStyle = blink ? '#e04c3a' : 'rgba(224,76,58,0.35)';
    ctx.beginPath(); ctx.arc(x + w - 52, y + 14, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(232,242,248,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('LIVE', x + w - 12, y + 9);
    ctx.restore();
    ctx.fillStyle = 'rgba(137,213,241,0.65)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(tf('战术图 // TACTICAL · {title}', { title: t(chapter.title) }), x + 2, y + h + 8);
  }

  function briefingSide(ctx, chapter, view, x, y, w, h) {
    panel(ctx, x, y, w, h, '#2e7fd9');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(137,213,241,0.8)';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(t('战场通讯 // TRANSMISSION'), x + 16, y + 14);
    ctx.strokeStyle = 'rgba(46,127,217,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 16, y + 34); ctx.lineTo(x + w - 16, y + 34); ctx.stroke();
    let ty = y + 48;
    view.lines.forEach((line, index) => {
      const enemy = chapter.number === 3 && index === view.lines.length - 1;
      ctx.fillStyle = enemy ? '#f6a45d' : '#89d5f1';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(enemy ? t('[中枢]') : t('[通讯员]'), x + 16, ty);
      ctx.fillStyle = '#e8f2f8';
      ctx.font = '14px monospace';
      ctx.fillText(t(line), x + 16, ty + 18);
      ty += 46;
    });
    const bh = 74, by = y + h - bh - 14;
    ctx.fillStyle = 'rgba(58,42,10,0.5)';
    ctx.fillRect(x + 12, by, w - 24, bh);
    ctx.strokeStyle = '#ffd27d';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 12.5, by + 0.5, w - 25, bh - 1);
    ctx.fillStyle = '#ffd27d';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(t('唯一主目标 // OBJECTIVE'), x + 22, by + 9);
    ctx.fillStyle = '#fff0c2';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(t(view.objective), x + 22, by + 32);
    reticle(ctx, x + w - 42, by + bh / 2, 16, '#ffd27d');
  }

  function drawBriefing(ctx, w, h, view) {
    const chapter = CHAPTERS[state.chapter - 1];
    screenHeader(ctx, w,
      tf('第{n}章 // CHAPTER {n}', { n: chapter.number }),
      t(chapter.title), t('战术简报 // BRIEFING'));
    const mapX = w * 0.05, mapY = 112, mapW = w * 0.57, mapH = h - 112 - 122;
    briefingMap(ctx, chapter, mapX, mapY, mapW, mapH);
    briefingSide(ctx, chapter, view, w * 0.65, mapY, w * 0.3, mapH);
    for (const button of buttons(w, h)) drawButton(ctx, button);
  }

  function drawDifficulty(ctx, w, h) {
    screenHeader(ctx, w, t('战役选择 // CAMPAIGN'), t('剧情模式 · 三章战役'), 'RED STORM');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(159,180,190,0.8)';
    ctx.font = '14px monospace';
    ctx.fillText(t('难度在战役开始前确定 · 两档剧情完全相同'), w / 2, Math.max(116, h * 0.27 - 36));
    for (const button of buttons(w, h)) {
      if (button.card) drawDifficultyCard(ctx, button);
      else drawButton(ctx, button);
    }
  }

  function drawResult(ctx, w, h) {
    const won = state.result === 'won';
    const chapter = CHAPTERS[state.chapter - 1];
    screenHeader(ctx, w, t('任务结算 // DEBRIEF'),
      tf('第{n}章 · {title}', { n: chapter.number, title: t(chapter.title) }), 'RED STORM');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = won ? '#7dff9a' : '#e36a51';
    ctx.font = 'bold 46px monospace';
    ctx.fillText(won ? t('赤曜保全') : t('任务失败'), w / 2, h * 0.3);
    ctx.fillStyle = 'rgba(232,242,248,0.85)';
    ctx.font = '16px monospace';
    const detail = won
      ? t('机械暴动结束 · 赤曜殖民地保全')
      : state.result === 'lost-final'
        ? t('最后指挥中心失守 · 赤曜抵抗终止')
        : t('指挥中心失守 · 可重新部署本章');
    ctx.fillText(detail, w / 2, h * 0.3 + 66);
    for (const button of buttons(w, h)) drawButton(ctx, button);
  }

  function draw(ctx, width, height) {
    width = Number(width) || (ctx && ctx.canvas && ctx.canvas.width) || 1280;
    height = Number(height) || (ctx && ctx.canvas && ctx.canvas.height) || 720;
    lastViewport = { width, height };
    const view = viewModel();
    if (!ctx || state.phase === 'closed') return view;
    if (state.phase === 'cutscene' && RS.cutscene && RS.cutscene.active) {
      RS.cutscene.draw(ctx, width, height);
      return view;
    }
    ctx.save();
    if (state.phase === 'battle') {
      const chapter = CHAPTERS[state.chapter - 1];
      const ow = Math.min(460, width - 32), ox = (width - ow) / 2;
      ctx.fillStyle = 'rgba(5,10,13,0.80)';
      ctx.fillRect(ox, 14, ow, 54);
      ctx.strokeStyle = '#2e7fd9';
      ctx.strokeRect(ox + 0.5, 14.5, ow - 1, 53);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#86cce8';
      ctx.font = '12px monospace';
      ctx.fillText(tf('第{n}章 · {title}　唯一主目标', { n: chapter.number, title: t(chapter.title) }), width / 2, 22);
      ctx.fillStyle = '#fff0c2';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(t(chapter.objective.text), width / 2, 42);
      if (radio) {
        const rw = Math.min(520, width - 36), rh = 74, rx = 18, ry = height - rh - 22;
        ctx.fillStyle = 'rgba(5,10,13,0.90)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = radio.speaker === '中枢' ? '#f28a32' : '#4ea7d4';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 1, ry + 1, rw - 2, rh - 2);
        ctx.textAlign = 'left';
        ctx.fillStyle = radio.speaker === '中枢' ? '#f6a45d' : '#89d5f1';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(t(radio.speaker), rx + 18, ry + 12);
        ctx.fillStyle = '#edf4f6';
        ctx.font = '17px monospace';
        ctx.fillText(t(radio.text), rx + 18, ry + 39);
      }
      ctx.restore();
      return view;
    }
    consoleBg(ctx, width, height);
    if (state.phase === 'briefing') drawBriefing(ctx, width, height, view);
    else if (state.phase === 'difficulty') drawDifficulty(ctx, width, height);
    else if (state.phase === 'result') drawResult(ctx, width, height);
    else if (state.phase === 'cutscene' && view.frame) {
      /* 兜底:cutscene 播放器未接管(模块缺失或场景无帧)时的静态字幕卡。 */
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#edf5f7';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(t(SCENES[state.sceneId].title), width / 2, height * 0.3);
      ctx.font = '17px monospace';
      ctx.fillStyle = '#9fb4be';
      if (view.frame.caption) ctx.fillText(t(view.frame.caption), width / 2, height * 0.3 + 52);
      if (view.frame.text) {
        ctx.fillStyle = '#e8f2f8';
        ctx.fillText(tf('{speaker}：{text}', { speaker: t(view.frame.speaker), text: t(view.frame.text) }), width / 2, height * 0.3 + 84);
      }
      for (const button of buttons(width, height)) drawButton(ctx, button);
    }
    ctx.restore();
    return view;
  }

  function hit(x, y, width, height) {
    width = Number(width) || lastViewport.width;
    height = Number(height) || lastViewport.height;
    if (state.phase === 'cutscene' && RS.cutscene && RS.cutscene.active)
      return RS.cutscene.hit(x, y) === 'skip' ? 'skip' : 'block';
    return (buttons(width, height).find(button =>
      x >= button.x && y >= button.y && x <= button.x + button.w && y <= button.y + button.h) || {}).action ||
      (capturesInput() ? 'block' : null);
  }

  function capturesInput() {
    return state.active && state.phase !== 'battle';
  }

  function handleAction(action) {
    if (!action || action === 'block') return false;
    if (action === 'open' || action === 'campaign' || action === 'campaign-open') return open();
    if (action === 'select-hard' || action === 'difficulty-hard') return selectDifficulty('hard');
    if (action === 'select-ultra' || action === 'difficulty-ultra') return selectDifficulty('ultra');
    if (action === 'continue') return continueCampaign();
    if (action === 'start-chapter') return startChapter();
    if (action === 'skip') {
      if (state.phase !== 'cutscene') return false;
      if (RS.cutscene && RS.cutscene.active) return RS.cutscene.skip();
      finishScene();
      return true;
    }
    if (action === 'retry' || action === 'retry-chapter') return retry();
    if (action === 'return-title') return returnTitle();
    return false;
  }

  function getState() {
    return Object.freeze({
      phase: state.phase,
      active: state.active,
      difficulty: state.difficulty,
      chapter: state.chapter,
      completedChapter: state.completedChapter,
      style: state.style,
      styleClassified: state.styleClassified,
      frozenProfile: state.frozenProfile,
      sceneId: state.sceneId,
      sceneTime: state.sceneTime,
      result: state.result,
      canContinue: state.canContinue,
    });
  }

  RS.campaign = {
    chapters: CHAPTERS,
    scenes: SCENES,
    openingFrames: OPENING_FRAMES,
    openingSample: SAMPLE,
    profiles: STYLE_PROFILES,
    init,
    open,
    selectDifficulty,
    continueCampaign,
    showBriefing,
    startChapter,
    update,
    onBattleFinished,
    retry,
    returnTitle,
    draw,
    drawOverlay: draw,
    hit,
    handleAction,
    capturesInput,
    titleAction: handleAction,
    getState,
    classifyStyle,
    profileFor,
  };
  Object.defineProperties(RS.campaign, {
    active: { enumerable: true, get() { return state.active; } },
    phase: { enumerable: true, get() { return state.phase; } },
  });
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

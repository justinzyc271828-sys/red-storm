/* 入口:初始化各子系统,等待精灵(含 AI 生图)加载完成后启动主循环。 */
(function (RS) {
  'use strict';

  function boot() {
    const canvas = document.getElementById('game');
    initAudioSettings();
    // 种子:测试可注入固定种子(__RS_SEED__),否则每局随机
    RS.gameSeed = (typeof window !== 'undefined' && window.__RS_SEED__) ? window.__RS_SEED__ : Date.now();
    RS.render.init(canvas);
    RS.input.init(canvas);
    Promise.resolve(RS.sprites.init())
      .then(() => Promise.resolve(RS.enemyArt.init()))
      .then(() => {
        RS.game.init(); // 在精灵之后初始化地图(装饰阻挡信息来自精灵)
        RS.game.state = 'title'; // 先进入标题屏(选难度后 startGame)
        if (RS.campaign && RS.campaign.init) RS.campaign.init();
        RS.camera.centerOnWorld(RS.map.playerBase.i + 1, RS.map.playerBase.j);
        startLoop();
      });
  }

  function initAudioSettings() {
    const panel = document.getElementById('audio-settings');
    const music = document.getElementById('bgm-volume');
    const sfx = document.getElementById('sfx-volume');
    const atmosphere = document.getElementById('atmosphere-volume');
    const musicValue = document.getElementById('bgm-volume-value');
    const sfxValue = document.getElementById('sfx-volume-value');
    const atmosphereValue = document.getElementById('atmosphere-volume-value');
    if (!panel || !music || !sfx || !atmosphere || !RS.audio || !RS.audio.getVolumes) return;

    const saved = RS.audio.getVolumes();
    music.value = Math.round(saved.music * 100);
    sfx.value = Math.round(saved.sfx * 100);
    atmosphere.value = Math.round(saved.atmosphere * 100);
    const sync = (input, output, setter) => {
      const value = Number(input.value);
      if (output) output.textContent = value + '%';
      setter(value / 100);
    };
    if (musicValue) musicValue.textContent = music.value + '%';
    if (sfxValue) sfxValue.textContent = sfx.value + '%';
    if (atmosphereValue) atmosphereValue.textContent = atmosphere.value + '%';
    panel.addEventListener('pointerdown', () => RS.audio.unlock());
    music.addEventListener('input', () => sync(music, musicValue, RS.audio.setMusicVolume));
    sfx.addEventListener('input', () => sync(sfx, sfxValue, RS.audio.setSfxVolume));
    atmosphere.addEventListener('input', () =>
      sync(atmosphere, atmosphereValue, RS.audio.setAtmosphereVolume));

    // 语言切换:面板静态文案由 JS 按当前语言重写;画布文本每帧经 t() 渲染,自动生效
    const langZh = document.getElementById('lang-zh');
    const langEn = document.getElementById('lang-en');
    const TEXT_IDS = [
      ['settings-title', '设置'],
      ['lang-label', '语言'],
      ['bgm-label', '背景音乐'],
      ['sfx-label', '游戏音效'],
      ['atmo-label', '氛围厚度'],
      ['settings-note', '设为 0% 可做原声 A/B 对比 · 设置自动保存 · M 键全部静音'],
    ];
    const refreshSettingsText = () => {
      if (!RS.i18n) return;
      for (const [id, zh] of TEXT_IDS) {
        const el = document.getElementById(id);
        if (el) el.textContent = RS.i18n.t(zh);
      }
      document.title = RS.i18n.t('红色风暴 · 献给 Simon');
      const lang = RS.i18n.getLang();
      if (langZh) langZh.classList.toggle('active', lang === 'zh');
      if (langEn) langEn.classList.toggle('active', lang === 'en');
      panel.setAttribute('aria-label', RS.i18n.t('设置'));
    };
    if (RS.i18n) {
      if (langZh) langZh.addEventListener('click', () => RS.i18n.setLang('zh'));
      if (langEn) langEn.addEventListener('click', () => RS.i18n.setLang('en'));
      RS.i18n.onChange(refreshSettingsText);
      refreshSettingsText();
    }
  }

  function updateAudioSettingsVisibility() {
    const panel = document.getElementById('audio-settings');
    if (!panel) return;
    panel.hidden = RS.game.state !== 'title' || RS.game.guideOpen;
    if (RS.audio && RS.audio.getStatus) {
      const status = JSON.stringify(RS.audio.getStatus());
      if (panel.dataset.audioStatus !== status) panel.dataset.audioStatus = status;
    }
  }

  // BGM 曲目选择:标题屏舒缓;敌军进入当前视野/我方遇袭/波次临近时转战斗;脱战 8 秒后回落。
  function pickBgmTrack(g) {
    const st = g.state;
    if (RS.campaign && RS.campaign.active && RS.campaign.phase !== 'battle') return 'title';
    if (st === 'title') return 'title';
    if (st !== 'playing') return null;
    const contact = g.enemyVisible || g.time < (g.enemyContactUntil || 0);
    return (contact || g.suddenDeath || (g.waveWarn && g.time - g.waveWarn < 10)) ? 'tension' : 'peace';
  }
  RS.pickBgmTrack = pickBgmTrack;

  function updateBgm() {
    if (!RS.audio || !RS.audio.bgm) return;
    RS.audio.bgm.set(pickBgmTrack(RS.game));
    if (RS.audio.syncGameState) RS.audio.syncGameState(RS.game);
  }

  function startLoop() {
    const STEP = RS.config.SIM_STEP;
    let last = performance.now(), acc = 0;

    function loop(now) {
      let dtReal = (now - last) / 1000;
      last = now;
      if (dtReal > 0.25) dtReal = 0.25;
      acc += dtReal;
      let steps = 0;
      while (acc >= STEP && steps < 8) {
        RS.game.update(STEP);
        if (RS.campaign && RS.campaign.update) RS.campaign.update(STEP);
        RS.camera.update(STEP);
        acc -= STEP; steps++;
      }
      RS.render.frame(dtReal);
      updateAudioSettingsVisibility();
      updateBgm();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

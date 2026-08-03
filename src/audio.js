/* 音频:文件音频 + WebAudio 合成兜底。含音效(sfx)与 BGM。
 * BGM 双模式:art/music/ 下有对应 mp3 就用文件(曲目池顺序轮换),没有就程序化合成兜底。
 * Suno 成品音效位于 art/sfx/:炮击/爆炸用并发池,履带/采矿由可见游戏状态控制循环。
 * 首次点击时解锁(浏览器自动播放策略);页面隐藏/失焦自动暂停,回来自动恢复。
 * 无 AudioContext 的环境(Node 测试)自动降级为空操作。 */
(function () {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  const RS = G.RS = G.RS || {};
  const AC = G.AudioContext || G.webkitAudioContext;
  const SETTINGS_KEY = 'red-storm.audio-settings.v1';
  let muted = false;
  let applyVolumeState = () => {};
  // 懒取 i18n:audio-test 的 vm 沙盒不注入 RS.i18n,缺省时原样返回中文
  const tStr = s => (RS.i18n ? RS.i18n.t(s) : s);

  function clampVolume(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  }

  function loadSettings() {
    try {
      const raw = G.localStorage && G.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { music: 1, sfx: 1, atmosphere: 0.7 };
      const saved = JSON.parse(raw);
      return {
        music: clampVolume(saved.music),
        sfx: clampVolume(saved.sfx),
        atmosphere: saved.atmosphere == null ? 0.7 : clampVolume(saved.atmosphere),
      };
    } catch (e) {
      return { music: 1, sfx: 1, atmosphere: 0.7 };
    }
  }

  const settings = loadSettings();

  function saveSettings() {
    try {
      if (G.localStorage) G.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  function getVolumes() {
    return {
      music: settings.music,
      sfx: settings.sfx,
      atmosphere: settings.atmosphere,
      muted,
    };
  }

  function setMusicVolume(value) {
    settings.music = clampVolume(value);
    saveSettings();
    applyVolumeState();
    return settings.music;
  }

  function setSfxVolume(value) {
    settings.sfx = clampVolume(value);
    saveSettings();
    applyVolumeState();
    return settings.sfx;
  }

  function setAtmosphereVolume(value) {
    settings.atmosphere = clampVolume(value);
    saveSettings();
    applyVolumeState();
    return settings.atmosphere;
  }

  if (!AC) {
    RS.audio = {
      sfx() {}, update() {}, unlock() { return false; }, isUnlocked() { return true; },
      toggleMute() { muted = !muted; return muted; },
      getVolumes, setMusicVolume, setSfxVolume, setAtmosphereVolume,
      syncGameState() {},
      getStatus() { return { context: 'unavailable', loaded: 0, failed: [], loops: [] }; },
      bgm: { set() {}, apply() {}, current: null },
    };
    return;
  }

  let ctx = null, master = null, synthGain = null, musicGain = null;
  let atmosphereGain = null, choirGain = null;
  let atmosphereScene = null, atmosphereActive = true;
  let atmosphereNoise = null, choirVoices = [];
  const lastPlay = {};
  const SYNTH_SFX_VOLUME = 0.65;
  const SYNTH_MUSIC_VOLUME = 0.182; // 保持原有 0.28 × 0.65 的合成配乐基准响度
  const FILE_VOLUMES = { title: 0.22, peace: 0.16, tension: 0.20 };
  // 氛围层不是另一首歌:低频空气/机械底噪负责重量,无词和声负责空间。
  // 战斗时提高底噪、压低人声垫,给枪炮和爆炸保留清晰度。
  const ATMOSPHERE_SCENES = {
    title: { bed: 0.036, choir: 0.018, chord: [50, 57, 62, 69] },
    peace: { bed: 0.043, choir: 0.014, chord: [50, 57, 62, 69] },
    tension: { bed: 0.055, choir: 0.009, chord: [38, 45, 50, 57] },
  };
  const FILE_SFX = {
    shot_bullet: { src: 'art/sfx/rifle-shot.wav', volume: 0.36 },
    shot_shell: { src: 'art/sfx/tank-cannon.wav', volume: 0.32 },
    shot_rocket: { src: 'art/sfx/rocket-launch.wav', volume: 0.27 },
    shot_arty: { src: 'art/sfx/artillery-fire.wav', volume: 0.26 },
    shot_flame: { src: 'art/sfx/flamethrower-burst.wav', volume: 0.34 },
    impact: { src: 'art/sfx/metal-impact.wav', volume: 0.18 },
    explosion: { src: 'art/sfx/explosion.wav', volume: 0.24 },
    bigExplosion: { src: 'art/sfx/explosion.wav', volume: 0.38 },
    move_infantry: { src: 'art/sfx/infantry-steps.wav', volume: 0.055, loop: true },
    move_vehicle: { src: 'art/sfx/tank-tread.wav', volume: 0.10, loop: true },
    move_harvester: { src: 'art/sfx/harvester-engine.wav', volume: 0.065, loop: true },
    harvest: { src: 'art/sfx/mining.wav', volume: 0.085, loop: true },
    unload: { src: 'art/sfx/ore-unload.wav', volume: 0.38 },
    build: { src: 'art/sfx/construction-complete.wav', volume: 0.22 },
    ready: { src: 'art/sfx/unit-ready.wav', volume: 0.24 },
    warn: { src: 'art/sfx/attack-warning.wav', volume: 0.13 },
    won: { src: 'art/sfx/victory-sting.wav', volume: 0.26 },
    lost: { src: 'art/sfx/defeat-sting.wav', volume: 0.26 },
  };
  const rawSfxPromises = {};
  const sfxBuffers = {};
  const sfxLoadErrors = {};
  const loopSources = {};
  const mediaLoopSources = {};
  const mediaSfxPools = {};
  const mediaSfxCursor = {};
  const useMediaSfx = !!(G.location && G.location.protocol === 'file:' && G.Audio);
  const sfxStats = {
    bufferPlays: 0, mediaPlays: 0, synthPlays: 0,
    loopStarts: 0, mediaLoopStarts: 0,
    updates: 0, visibleUnits: 0, harvestDetections: 0, vehicleDetections: 0,
  };
  let sfxLoadPromise = null;

  function musicVolume(track) {
    return muted ? 0 : FILE_VOLUMES[track] * settings.music;
  }

  function applyVolumes() {
    if (master) master.gain.value = muted ? 0 : settings.sfx;
    if (synthGain) synthGain.gain.value = SYNTH_SFX_VOLUME;
    if (musicGain) musicGain.gain.value = muted ? 0 : SYNTH_MUSIC_VOLUME * settings.music;
    for (const key in filePlayers) {
      const p = filePlayers[key];
      p.audio.volume = musicVolume(p.track);
    }
    for (const name in mediaSfxPools) {
      const volume = muted ? 0 : FILE_SFX[name].volume * settings.sfx;
      mediaSfxPools[name].forEach(audio => { audio.volume = volume; });
    }
    for (const name in mediaLoopSources) {
      mediaLoopSources[name].volume = muted ? 0 : FILE_SFX[name].volume * settings.sfx;
    }
    refreshAtmosphere(0.25);
  }

  applyVolumeState = applyVolumes;

  function toggleMute() {
    muted = !muted;
    applyVolumes();
    if (muted) {
      for (const name in loopSources) stopLoopSfx(name);
      for (const name in mediaLoopSources) stopLoopSfx(name);
    }
    return muted;
  }

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      bgm.apply();
      return false;
    }
    ctx = new AC();
    master = ctx.createGain(); // 音效总线:文件音效与合成兜底共同受 SFX 滑杆控制
    master.gain.value = muted ? 0 : settings.sfx;
    master.connect(ctx.destination);
    synthGain = ctx.createGain();
    synthGain.gain.value = SYNTH_SFX_VOLUME;
    synthGain.connect(master);
    musicGain = ctx.createGain(); // 独立合成音乐通道,不再受音效滑杆影响
    musicGain.gain.value = muted ? 0 : SYNTH_MUSIC_VOLUME * settings.music;
    musicGain.connect(ctx.destination);
    atmosphereGain = ctx.createGain();
    atmosphereGain.gain.value = 0;
    atmosphereGain.connect(ctx.destination);
    choirGain = ctx.createGain();
    choirGain.gain.value = 0;
    choirGain.connect(ctx.destination);
    startAtmosphereLayers();
    startSfxLoading();
    bindAutoPause();
    bgm.apply(); // 必须在用户手势内重试播放,否则标题音乐会被自动播放策略拦截
    refreshAtmosphere(1.5);
    return true;
  }

  function isUnlocked() { return !!ctx; }

  function automateGain(node, value, seconds) {
    if (!node) return;
    const gain = node.gain;
    const target = Math.max(0, value);
    if (!ctx || !seconds || !gain.linearRampToValueAtTime) {
      gain.value = target;
      return;
    }
    const now = ctx.currentTime;
    if (gain.cancelScheduledValues) gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + seconds);
  }

  function atmosphereTargets() {
    const scene = ATMOSPHERE_SCENES[atmosphereScene];
    if (!scene || !atmosphereActive || muted ||
        settings.music <= 0 || settings.atmosphere <= 0) {
      return { bed: 0, choir: 0 };
    }
    const scale = settings.music * settings.atmosphere;
    return { bed: scene.bed * scale, choir: scene.choir * scale };
  }

  function refreshAtmosphere(seconds) {
    const target = atmosphereTargets();
    automateGain(atmosphereGain, target.bed, seconds || 0);
    automateGain(choirGain, target.choir, seconds || 0);
  }

  function retuneChoir(sceneName) {
    const scene = ATMOSPHERE_SCENES[sceneName];
    if (!ctx || !scene || !choirVoices.length) return;
    const now = ctx.currentTime;
    choirVoices.forEach((voice, index) => {
      const frequency = voice.frequency;
      const next = 440 * Math.pow(2, (scene.chord[index] - 69) / 12);
      frequency.setValueAtTime(Math.max(1, frequency.value || next), now);
      frequency.exponentialRampToValueAtTime(next, now + 3.5);
    });
  }

  function setAtmosphereScene(name) {
    if (name === atmosphereScene) return;
    atmosphereScene = name;
    retuneChoir(name);
    refreshAtmosphere(2.5);
  }

  function syncGameState(game) {
    const active = !!game &&
      (game.state === 'title' || game.state === 'campaign' ||
        (game.state === 'playing' && !game.paused));
    if (active === atmosphereActive) return;
    atmosphereActive = active;
    refreshAtmosphere(1.2);
  }

  function startAtmosphereLayers() {
    if (!ctx || atmosphereNoise) return;

    // 8 秒棕噪循环经低通后形成极轻的空气与机械底噪,不抢旋律。
    const len = Math.max(1, Math.floor(ctx.sampleRate * 8));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = brown * 0.985 + (Math.random() * 2 - 1) * 0.015;
      data[i] = brown * 0.72;
    }
    atmosphereNoise = ctx.createBufferSource();
    atmosphereNoise.buffer = buffer;
    atmosphereNoise.loop = true;
    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.setValueAtTime(420, ctx.currentTime);
    atmosphereNoise.connect(bedFilter);
    bedFilter.connect(atmosphereGain);
    atmosphereNoise.start();

    // 两根不齐整的低频正弦提供厚度,音量极低,避免变成明显的嗡鸣。
    [43, 64.5].forEach((hz, index) => {
      const oscillator = ctx.createOscillator();
      const voiceGain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(hz, ctx.currentTime);
      voiceGain.gain.value = index === 0 ? 0.22 : 0.09;
      oscillator.connect(voiceGain);
      voiceGain.connect(atmosphereGain);
      oscillator.start();
    });

    // 四声部无词人声垫只使用 D/A 根音与五度,不写旋律或三度,避免与原曲和声打架。
    const choirFilter = ctx.createBiquadFilter();
    choirFilter.type = 'lowpass';
    choirFilter.frequency.setValueAtTime(1250, ctx.currentTime);
    const initial = ATMOSPHERE_SCENES[atmosphereScene] || ATMOSPHERE_SCENES.title;
    choirVoices = initial.chord.map((note, index) => {
      const oscillator = ctx.createOscillator();
      const voiceGain = ctx.createGain();
      oscillator.type = index % 2 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(
        440 * Math.pow(2, (note - 69) / 12) * (index === 3 ? 1.002 : 1),
        ctx.currentTime
      );
      voiceGain.gain.value = [0.09, 0.065, 0.055, 0.035][index];
      oscillator.connect(voiceGain);
      voiceGain.connect(choirFilter);
      oscillator.start();
      return oscillator;
    });
    choirFilter.connect(choirGain);
  }

  function blip(f0, f1, dur, type, vol, delay) {
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(synthGain);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const noiseBufs = new Map(); // 噪声按长度预渲染复用:密集战斗不再每次新建 AudioBuffer + JS 循环填充
  function getNoiseBuf(len) {
    let buf = noiseBufs.get(len);
    if (!buf) {
      buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      noiseBufs.set(len, buf);
    }
    return buf;
  }

  function noise(dur, f0, f1, vol, delay) {
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const src = ctx.createBufferSource(); src.buffer = getNoiseBuf(len);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass';
    flt.frequency.setValueAtTime(f0, t0);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(synthGain);
    src.start(t0);
  }

  const DEFS = {
    shot_bullet:  () => { noise(0.045, 5200, 1700, 0.055); blip(1900, 430, 0.075, 'square', 0.10); },
    shot_shell:   () => {
      noise(0.18, 1500, 110, 0.20);
      blip(390, 65, 0.18, 'triangle', 0.16);
      blip(2200, 800, 0.045, 'square', 0.045);
    },
    shot_rocket:  () => {
      noise(0.32, 4200, 650, 0.13);
      blip(260, 1050, 0.28, 'sawtooth', 0.07);
      noise(0.12, 1800, 300, 0.055, 0.16);
    },
    shot_arty:    () => {
      blip(135, 32, 0.48, 'triangle', 0.24);
      noise(0.48, 800, 70, 0.23);
      noise(0.22, 1700, 180, 0.08, 0.12);
    },
    shot_flame:   () => { noise(0.30, 2600, 360, 0.15); blip(180, 90, 0.24, 'sawtooth', 0.045); },
    impact:       () => { noise(0.08, 2800, 420, 0.055); blip(680, 190, 0.06, 'triangle', 0.035); },
    explosion:    () => { noise(0.42, 1500, 90, 0.20); blip(120, 42, 0.34, 'triangle', 0.12); },
    bigExplosion: () => {
      noise(0.78, 1300, 55, 0.28);
      blip(105, 28, 0.70, 'triangle', 0.22);
      noise(0.32, 2400, 140, 0.10, 0.16);
    },
    move_infantry: () => {
      noise(0.055, 2600, 650, 0.035);
      noise(0.05, 2200, 520, 0.028, 0.18);
    },
    move_vehicle: () => {
      blip(82, 58, 0.34, 'sawtooth', 0.045);
      noise(0.08, 1900, 260, 0.04);
      blip(680, 240, 0.045, 'square', 0.03, 0.18);
    },
    move_harvester: () => {
      blip(68, 52, 0.48, 'sawtooth', 0.055);
      noise(0.12, 1200, 160, 0.045);
      blip(920, 420, 0.05, 'square', 0.035, 0.24);
    },
    harvest:      () => {
      noise(0.32, 2300, 180, 0.085);
      blip(1150, 360, 0.075, 'square', 0.05, 0.05);
      blip(760, 260, 0.06, 'square', 0.04, 0.22);
    },
    unload:       () => { blip(880, 880, 0.07, 'sine', 0.09); blip(1320, 1320, 0.09, 'sine', 0.08, 0.08); },
    build:        () => { blip(520, 780, 0.12, 'triangle', 0.11); blip(780, 1040, 0.1, 'triangle', 0.09, 0.1); },
    ready:        () => blip(660, 990, 0.08, 'sine', 0.07),
    warn:         () => { blip(220, 180, 0.22, 'square', 0.11); blip(220, 180, 0.22, 'square', 0.09, 0.28); },
    won:          () => [523, 659, 784, 1046].forEach((f, k) => blip(f, f, 0.22, 'triangle', 0.12, k * 0.16)),
    lost:         () => [400, 340, 280, 180].forEach((f, k) => blip(f, f * 0.9, 0.3, 'sawtooth', 0.1, k * 0.22)),
  };
  const MIN_GAP = {
    shot_bullet: 0.05, shot_shell: 0.10, shot_rocket: 0.10, shot_arty: 0.14, impact: 0.04,
    explosion: 0.16, bigExplosion: 0.32, move_infantry: 0.35,
    move_harvester: 0.65, warn: 13,
  };

  function noteSfxLoadError(src, error) {
    sfxLoadErrors[src] = String(error && (error.message || error));
    if (G.console && G.console.warn)
      G.console.warn(tStr('[audio] 音效文件加载失败,已启用合成兜底:'), src, sfxLoadErrors[src]);
  }

  function preloadSfxData() {
    const canFetch = typeof G.fetch === 'function' &&
      !(G.location && G.location.protocol === 'file:');
    if (!canFetch) return;
    for (const name in FILE_SFX) {
      const src = FILE_SFX[name].src;
      if (rawSfxPromises[src]) continue;
      rawSfxPromises[src] = G.fetch(src, { cache: 'force-cache' })
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.arrayBuffer();
        })
        .catch(error => { noteSfxLoadError(src, error); return null; });
    }
  }

  function startSfxLoading() {
    if (sfxLoadPromise || !ctx || typeof ctx.decodeAudioData !== 'function') return sfxLoadPromise;
    const jobs = Object.keys(rawSfxPromises).map(src => rawSfxPromises[src].then(async data => {
      if (!data) return;
      try {
        sfxBuffers[src] = await ctx.decodeAudioData(data.slice(0));
        delete sfxLoadErrors[src];
      } catch (error) {
        noteSfxLoadError(src, error);
      }
    }));
    sfxLoadPromise = Promise.all(jobs);
    return sfxLoadPromise;
  }

  function makeBufferSource(name, loop) {
    const def = FILE_SFX[name];
    const buffer = def && sfxBuffers[def.src];
    if (!ctx || !buffer) return null;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = !!loop;
    gain.gain.value = def.volume;
    source.connect(gain);
    gain.connect(master);
    return { source, gain };
  }

  function playBufferSfx(name) {
    const node = makeBufferSource(name, false);
    if (!node) return false;
    try {
      node.source.start();
      sfxStats.bufferPlays++;
      return true;
    } catch (error) {
      noteSfxLoadError(FILE_SFX[name].src, error);
      return false;
    }
  }

  // 直接双击 index.html 时浏览器禁止 file:// fetch,但媒体元素仍能读取同目录文件。
  // HTTP(S) 继续走 WebAudio 缓冲区;只有 file:// 才启用这个兼容通道。
  function makeMediaSfx(name, loop) {
    const def = FILE_SFX[name];
    if (!useMediaSfx || !def) return null;
    const audio = new G.Audio();
    audio.src = def.src;
    audio.preload = 'auto';
    audio.loop = !!loop;
    audio.volume = muted ? 0 : def.volume * settings.sfx;
    if (audio.addEventListener) {
      audio.addEventListener('error', () =>
        noteSfxLoadError(def.src, new Error('HTMLAudio media error')));
    }
    return audio;
  }

  function playMediaSfx(name) {
    if (!useMediaSfx) return false;
    const pool = mediaSfxPools[name] = mediaSfxPools[name] || [];
    let audio = pool.find(item => item.paused || item.ended);
    if (!audio && pool.length < 4) {
      audio = makeMediaSfx(name, false);
      if (audio) pool.push(audio);
    }
    if (!audio && pool.length) {
      const index = mediaSfxCursor[name] || 0;
      audio = pool[index % pool.length];
      mediaSfxCursor[name] = (index + 1) % pool.length;
    }
    if (!audio) return false;
    try {
      audio.currentTime = 0;
      const result = audio.play();
      if (result && result.catch)
        result.catch(error => noteSfxLoadError(FILE_SFX[name].src, error));
      sfxStats.mediaPlays++;
      return true;
    } catch (error) {
      noteSfxLoadError(FILE_SFX[name].src, error);
      return false;
    }
  }

  function startMediaLoopSfx(name) {
    if (!useMediaSfx || mediaLoopSources[name]) return !!mediaLoopSources[name];
    const audio = makeMediaSfx(name, true);
    if (!audio) return false;
    try {
      mediaLoopSources[name] = audio;
      const result = audio.play();
      if (result && result.catch) result.catch(error => {
        if (mediaLoopSources[name] === audio) delete mediaLoopSources[name];
        noteSfxLoadError(FILE_SFX[name].src, error);
      });
      sfxStats.mediaLoopStarts++;
      return true;
    } catch (error) {
      delete mediaLoopSources[name];
      noteSfxLoadError(FILE_SFX[name].src, error);
      return false;
    }
  }

  function stopLoopSfx(name) {
    const node = loopSources[name];
    if (node) {
      delete loopSources[name];
      try { node.source.stop(); } catch (e) {}
      if (node.source.disconnect) node.source.disconnect();
      if (node.gain.disconnect) node.gain.disconnect();
    }
    const media = mediaLoopSources[name];
    if (media) {
      delete mediaLoopSources[name];
      try { media.pause(); media.currentTime = 0; } catch (e) {}
    }
  }

  function setLoopSfx(name, active) {
    if (!active || muted || settings.sfx <= 0) {
      stopLoopSfx(name);
      return false;
    }
    if (loopSources[name] || mediaLoopSources[name]) return true;
    const node = makeBufferSource(name, true);
    if (!node) return startMediaLoopSfx(name);
    try {
      loopSources[name] = node;
      node.source.onended = () => {
        if (loopSources[name] === node) delete loopSources[name];
      };
      node.source.start();
      sfxStats.loopStarts++;
      return true;
    } catch (error) {
      delete loopSources[name];
      noteSfxLoadError(FILE_SFX[name].src, error);
      return false;
    }
  }

  function sfx(name) {
    if (!ctx || ctx.state !== 'running' || muted || settings.sfx <= 0) return;
    const def = DEFS[name];
    if (!def) return;
    const now = ctx.currentTime;
    if (lastPlay[name] && now - lastPlay[name] < (MIN_GAP[name] || 0.03)) return;
    lastPlay[name] = now;
    if (FILE_SFX[name] && !FILE_SFX[name].loop &&
        (playBufferSfx(name) || playMediaSfx(name))) return;
    sfxStats.synthPlays++;
    def();
  }

  const ambienceT = { infantry: 0, harvester: 0, vehicle: 0, harvest: 0 };

  function audibleUnit(u) {
    if (u.hp <= 0) return false;
    if (u.owner === 'enemy') {
      const V = RS.map && RS.map.visible;
      const mw = RS.config && RS.config.MAP_W;
      if (!V || !mw || !V[Math.floor(u.y) * mw + Math.floor(u.x)]) return false;
    }
    if (RS.render && RS.render.worldToClient && typeof G.innerWidth === 'number') {
      const p = RS.render.worldToClient(u.x, u.y);
      return p.x >= -80 && p.y >= -80 && p.x <= G.innerWidth + 80 && p.y <= G.innerHeight + 80;
    }
    return u.owner === 'player';
  }

  function moving(u) {
    return !!((u.path && u.path.length) || u.attackMove ||
      (u.aggro && u.target && Math.hypot(u.target.x - u.x, u.target.y - u.y) > 1));
  }

  // 低频环境音由游戏状态驱动,按屏幕内单位聚合,避免每个单位各自制造噪声墙。
  function update(dt, game) {
    syncGameState(game);
    if (!ctx || ctx.state !== 'running' || muted || settings.sfx <= 0 ||
        !game || game.state !== 'playing' || game.paused) {
      setLoopSfx('move_vehicle', false);
      setLoopSfx('move_harvester', false);
      setLoopSfx('move_infantry', false);
      setLoopSfx('harvest', false);
      return;
    }
    for (const key in ambienceT) ambienceT[key] -= dt;
    const units = game.units.filter(audibleUnit);
    const hasHarvest = units.some(u => u.kind === 'harvester' && u.state === 'harvest');
    const hasHarvesterMove = units.some(u => u.kind === 'harvester' && moving(u));
    const hasVehicleMove = units.some(u => u.vehicle && u.kind !== 'harvester' && moving(u));
    const hasInfantryMove = units.some(u => !u.vehicle && moving(u));
    sfxStats.updates++;
    sfxStats.visibleUnits = units.length;
    if (hasHarvest) sfxStats.harvestDetections++;
    if (hasVehicleMove) sfxStats.vehicleDetections++;

    const harvestLoop = setLoopSfx('harvest', hasHarvest);
    const vehicleLoop = setLoopSfx('move_vehicle', hasVehicleMove);
    const harvesterLoop = setLoopSfx('move_harvester', hasHarvesterMove);
    const infantryLoop = setLoopSfx('move_infantry', hasInfantryMove);
    if (hasHarvest && !harvestLoop && ambienceT.harvest <= 0) {
      sfx('harvest'); ambienceT.harvest = 0.55;
    }
    if (hasVehicleMove && !vehicleLoop && ambienceT.vehicle <= 0) {
      sfx('move_vehicle'); ambienceT.vehicle = 0.72;
    }
    if (hasHarvesterMove && !harvesterLoop && ambienceT.harvester <= 0) {
      sfx('move_harvester'); ambienceT.harvester = 0.82;
    }
    if (hasInfantryMove && !infantryLoop && ambienceT.infantry <= 0) {
      sfx('move_infantry'); ambienceT.infantry = 0.46;
    }
  }

  /* ================= BGM =================
   * 三种状态:title(标题屏)/ peace(发展期)/ tension(交战与沙暴)。
   * 文件模式:每种状态可配置一首或多首;多首自然结束后顺序轮换;
   * 合成兜底:lookahead 步进音序器(每 100ms 排未来 0.35s 音符,D 小调)。 */

  const MUSIC_FILES = {
    title: ['art/music/title.mp3'],
    peace: ['art/music/peace-01.mp3', 'art/music/peace-02.mp3'],
    tension: ['art/music/tension.mp3'],
  };
  const filePlayers = {};
  const trackPlayers = {};
  const selectedFile = {};

  function initFileMusic() {
    if (typeof Audio === 'undefined') return;
    for (const track in MUSIC_FILES) {
      trackPlayers[track] = trackPlayers[track] || [];
      MUSIC_FILES[track].forEach((src, index) => {
        const key = track + ':' + index;
        if (filePlayers[key]) return;
        const a = new Audio();
        a.loop = MUSIC_FILES[track].length === 1;
        a.volume = musicVolume(track); a.preload = 'auto';
        const p = filePlayers[key] = { audio: a, ok: null, track, index };
        trackPlayers[track].push(p);
        a.addEventListener('canplaythrough', () => {
          p.ok = true;
          if (RS.audio.bgm.current === track) RS.audio.bgm.apply();
        });
        a.addEventListener('error', () => {
          p.ok = false;
          if (selectedFile[track] === p) selectedFile[track] = null;
          if (RS.audio.bgm.current === track) RS.audio.bgm.apply();
        });
        a.addEventListener('ended', () => {
          if (RS.audio.bgm.current !== track || selectedFile[track] !== p) return;
          const next = selectFile(track, true);
          if (next) next.audio.currentTime = 0;
          RS.audio.bgm.apply();
        });
        a.src = src;
      });
    }
  }

  function selectFile(track, advance) {
    const available = (trackPlayers[track] || []).filter(p => p.ok !== false);
    if (!available.length) { selectedFile[track] = null; return null; }
    const current = selectedFile[track];
    if (!advance && current && current.ok !== false) return current;
    const currentIndex = available.indexOf(current);
    const next = available[(currentIndex + 1) % available.length];
    selectedFile[track] = next;
    return next;
  }

  // 页面隐藏/失焦自动暂停(合成轨挂 AudioContext,文件轨是独立 Audio 元素,都要停)
  let autoPaused = false, resumeFile = null;
  function onHide() {
    if (!ctx || autoPaused) return;
    autoPaused = true; resumeFile = null;
    if (ctx.state === 'running') ctx.suspend();
    for (const key in filePlayers) {
      const p = filePlayers[key];
      if (!p.audio.paused) { resumeFile = key; p.audio.pause(); }
    }
    for (const name in loopSources) stopLoopSfx(name);
    for (const name in mediaLoopSources) stopLoopSfx(name);
    for (const name in mediaSfxPools)
      mediaSfxPools[name].forEach(audio => { try { audio.pause(); } catch (e) {} });
  }
  function onShow() {
    if (!autoPaused) return;
    autoPaused = false;
    if (ctx && ctx.state === 'suspended') ctx.resume();
    const p = resumeFile && filePlayers[resumeFile];
    if (p && RS.audio.bgm.current === p.track && selectedFile[p.track] === p)
      p.audio.play().catch(() => {});
    resumeFile = null;
  }
  function bindAutoPause() {
    if (typeof document !== 'undefined' && document.addEventListener)
      document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('blur', onHide);
      window.addEventListener('focus', onShow);
    }
  }

  /* ---- 合成兜底:谱面 ---- */
  const midi = m => 440 * Math.pow(2, (m - 69) / 12);

  function mnote(m, t, dur, type, vol, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(midi(m), t);
    const a = Math.min(attack || 0.01, dur * 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function mnoise(dur, f0, f1, vol, t) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass';
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(musicGain);
    src.start(t);
  }

  // 标题屏:Dm → Bb → F → C,每和弦两小节;长音垫底 + 稀疏琶音
  const TITLE_CHORDS = [[50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55]];
  const TITLE_ARP = [0, 3, 6, 10, 12]; // 每 16 步内稀疏落点

  // 发展期:Dm 五声音阶小乐句(4 小节,64 步)
  const PEACE_BASS_ROOT = [38, 41, 36, 43]; // D2 F2 C2 G2,每小节一根
  const PEACE_MELODY = [
    [0, 62, 2], [3, 65, 1], [6, 67, 2], [10, 69, 2], [12, 67, 2],
    [16, 65, 2], [20, 62, 2], [24, 60, 3],
    [32, 67, 2], [36, 69, 2], [40, 72, 3], [44, 69, 2],
    [48, 67, 2], [52, 65, 2], [56, 62, 4],
  ];

  const TRACKS = {
    title: {
      bpm: 60, steps: 64,
      step(k, t, sd) {
        const bar = Math.floor(k / 16), s = k % 16;
        if (s === 0) { // 长音垫底(整个和弦两小节)
          const ch = TITLE_CHORDS[bar];
          for (const m of ch) mnote(m, t, sd * 16 * 1.05, 'sine', 0.05, sd * 3);
          mnote(ch[0] - 12, t, sd * 16 * 1.05, 'triangle', 0.04, sd * 3);
        }
        if (TITLE_ARP.includes(s)) { // 稀疏琶音,高八度
          const ch = TITLE_CHORDS[bar];
          mnote(ch[(s / 3 | 0) % 3] + 12, t, sd * 2.5, 'sine', 0.035, 0.02);
        }
      },
    },
    peace: {
      bpm: 96, steps: 64,
      step(k, t, sd) {
        const bar = Math.floor(k / 16), s = k % 16;
        if (s === 0 || s === 8) mnote(PEACE_BASS_ROOT[bar], t, sd * 3, 'triangle', 0.075);
        if (s === 12) mnote(PEACE_BASS_ROOT[bar] + 7, t, sd * 2, 'triangle', 0.055);
        for (const [st, m, len] of PEACE_MELODY) if (st === k) mnote(m, t, sd * len * 0.9, 'triangle', 0.05);
        if (s % 4 === 2) mnoise(0.03, 6000, 3000, 0.012, t);
      },
    },
    tension: {
      bpm: 132, steps: 32,
      step(k, t, sd) {
        mnote(38, t, sd * 0.55, 'sawtooth', k % 8 === 0 ? 0.075 : 0.05); // 低音脉冲 D2
        if (k === 0 || k === 6 || k === 16 || k === 22) { // 不协和双击 stab(D + Eb)
          mnote(62, t, sd * 1.4, 'sawtooth', 0.035);
          mnote(63, t, sd * 1.4, 'sawtooth', 0.035);
        }
        if (k === 0) mnoise(0.4, 2000, 200, 0.028, t); // 开头扫频下坠
        if (k === 0 || k === 16) mnote(k === 0 ? 74 : 75, t, sd * 15, 'sine', 0.018, sd * 4); // 高音悬留 D5/Eb5
        if (k % 4 === 0) mnoise(0.04, 5000, 2500, 0.014, t);
      },
    },
  };

  const bgm = (function () {
    let cur = null, curName = null, timer = null, stepIdx = 0, nextT = 0;

    function tick() {
      if (!ctx || ctx.state !== 'running' || !cur) return;
      if (!nextT || nextT < ctx.currentTime - 1) nextT = ctx.currentTime + 0.08;
      const sd = 60 / cur.bpm / 2; // 步长 = 八分音符
      while (nextT < ctx.currentTime + 0.35) {
        cur.step(stepIdx % cur.steps, Math.max(nextT, ctx.currentTime + 0.02), sd);
        stepIdx++; nextT += sd;
      }
    }

    function apply() {
      const fp = curName && selectFile(curName, false);
      const useFile = !!fp;
      cur = useFile ? null : (curName ? TRACKS[curName] : null);
      stepIdx = 0; nextT = 0;
      if (cur && !timer) timer = setInterval(tick, 100);
      for (const key in filePlayers) {
        const p = filePlayers[key];
        if (useFile && p === fp) { if (p.audio.paused) p.audio.play().catch(() => {}); }
        else if (!p.audio.paused) p.audio.pause();
      }
    }

    function set(name) {
      if (name === curName) return;
      curName = name;
      setAtmosphereScene(name);
      apply();
    }

    return { set, apply, get current() { return curName; } };
  })();

  function getStatus() {
    return {
      context: ctx ? ctx.state : 'locked',
      sfxMode: useMediaSfx ? 'html-media-file' : 'webaudio-buffer',
      loaded: Object.keys(sfxBuffers).length,
      failed: Object.keys(sfxLoadErrors),
      loops: Object.keys(loopSources).concat(Object.keys(mediaLoopSources)),
      atmosphere: {
        scene: atmosphereScene,
        active: atmosphereActive,
        amount: settings.atmosphere,
        bed: atmosphereTargets().bed,
        choir: atmosphereTargets().choir,
      },
      stats: {
        bufferPlays: sfxStats.bufferPlays,
        mediaPlays: sfxStats.mediaPlays,
        synthPlays: sfxStats.synthPlays,
        loopStarts: sfxStats.loopStarts,
        mediaLoopStarts: sfxStats.mediaLoopStarts,
        updates: sfxStats.updates,
        visibleUnits: sfxStats.visibleUnits,
        harvestDetections: sfxStats.harvestDetections,
        vehicleDetections: sfxStats.vehicleDetections,
      },
    };
  }

  RS.audio = {
    sfx, update, unlock, isUnlocked, toggleMute,
    getVolumes, setMusicVolume, setSfxVolume, setAtmosphereVolume,
    syncGameState, getStatus, bgm,
  };
  preloadSfxData(); // HTTP(S) 下提前下载;解码等待首次用户手势创建 AudioContext
  initFileMusic(); // 页面加载即预取;首次用户手势只负责解锁和立即播放
})();

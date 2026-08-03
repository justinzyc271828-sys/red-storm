'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  PASS  ' + name);
  else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
  }
}

class FakeAudio {
  static instances = [];

  constructor() {
    this.events = {};
    this.paused = true;
    this.currentTime = 0;
    this.volume = 1;
    this.loop = false;
    this.playCalls = 0;
    FakeAudio.instances.push(this);
  }

  addEventListener(name, fn) { this.events[name] = fn; }
  play() { this.paused = false; this.playCalls++; return Promise.resolve(); }
  pause() { this.paused = true; }
  emit(name) { if (this.events[name]) this.events[name](); }
}

class FakeAudioContext {
  static oscillators = 0;
  static buffers = 0;
  static gains = [];
  static sources = [];
  static decodes = 0;

  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.sampleRate = 48000;
  }

  createGain() {
    const node = {
      gain: {
        value: 1,
        setValueAtTime(v) { this.value = v; },
        exponentialRampToValueAtTime(v) { this.value = v; },
        linearRampToValueAtTime(v) { this.value = v; },
        cancelScheduledValues() {},
      },
      connect() {},
      disconnect() {},
    };
    FakeAudioContext.gains.push(node);
    return node;
  }
  createOscillator() {
    FakeAudioContext.oscillators++;
    return {
      type: 'sine',
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}, start() {}, stop() {},
    };
  }
  createBuffer(channels, len) {
    FakeAudioContext.buffers++;
    return { getChannelData() { return new Float32Array(len); } };
  }
  createBufferSource() {
    const node = {
      buffer: null, loop: false, started: false, stopped: false, onended: null,
      connect() {}, disconnect() {},
      start() { this.started = true; },
      stop() {
        this.stopped = true;
        if (this.onended) this.onended();
      },
    };
    FakeAudioContext.sources.push(node);
    return node;
  }
  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
  decodeAudioData() {
    FakeAudioContext.decodes++;
    return Promise.resolve({ decoded: true, id: FakeAudioContext.decodes });
  }
  resume() { this.state = 'running'; }
  suspend() { this.state = 'suspended'; }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'audio.js'), 'utf8');

function makeSandbox(fetchImpl, storageData, quietWarnings, protocol) {
  const listeners = {};
  const sandbox = {
    console: quietWarnings ? { log: console.log, warn() {} } : console,
    Audio: FakeAudio,
    AudioContext: FakeAudioContext,
    fetch: fetchImpl,
    location: { protocol: protocol || 'http:' },
    setInterval: () => 1,
    document: {
      hidden: false,
      addEventListener(name, fn) { listeners['document:' + name] = fn; },
    },
    addEventListener(name, fn) { listeners['window:' + name] = fn; },
    localStorage: {
      getItem(key) { return storageData[key] || null; },
      setItem(key, value) { storageData[key] = value; },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.RS = {};
  vm.runInNewContext(source, sandbox, { filename: 'audio.js' });
  return sandbox;
}

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const storageData = {};
  const fetchCalls = [];
  const expectedSfxFiles = [
    'art/sfx/rifle-shot.wav',
    'art/sfx/tank-cannon.wav',
    'art/sfx/rocket-launch.wav',
    'art/sfx/artillery-fire.wav',
    'art/sfx/flamethrower-burst.wav',
    'art/sfx/metal-impact.wav',
    'art/sfx/explosion.wav',
    'art/sfx/infantry-steps.wav',
    'art/sfx/tank-tread.wav',
    'art/sfx/harvester-engine.wav',
    'art/sfx/mining.wav',
    'art/sfx/ore-unload.wav',
    'art/sfx/construction-complete.wav',
    'art/sfx/unit-ready.wav',
    'art/sfx/attack-warning.wav',
    'art/sfx/victory-sting.wav',
    'art/sfx/defeat-sting.wav',
  ];
  const sandbox = makeSandbox(src => {
    fetchCalls.push(src);
    return Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  }, storageData, false);

  check('页面加载只创建四个 BGM 播放器', FakeAudio.instances.length === 4);
  check('17 个正式 WAV 地址去重预取',
    fetchCalls.length === expectedSfxFiles.length &&
    expectedSfxFiles.every(src => fetchCalls.includes(src)));
  check('解锁前状态为 false', sandbox.RS.audio.isUnlocked() === false);
  sandbox.RS.audio.unlock();
  check('首次手势完成解锁', sandbox.RS.audio.isUnlocked() === true);
  const atmosphereOscillators = FakeAudioContext.oscillators;
  check('重复解锁不会叠建氛围层',
    sandbox.RS.audio.unlock() === false &&
    FakeAudioContext.oscillators === atmosphereOscillators);

  // 解码尚未完成时不能吞声:应立刻使用程序化兜底。
  const fallbackBefore = FakeAudioContext.oscillators + FakeAudioContext.buffers;
  sandbox.RS.audio.sfx('shot_shell');
  sandbox.RS.audio.sfx('explosion');
  check('文件未就绪时炮击/爆炸立即走合成兜底',
    FakeAudioContext.oscillators + FakeAudioContext.buffers > fallbackBefore);

  await flushPromises();
  await flushPromises();
  const readyStatus = sandbox.RS.audio.getStatus();
  check('17 个正式 WAV 全部完成 WebAudio 解码',
    readyStatus.loaded === expectedSfxFiles.length && readyStatus.failed.length === 0);

  const [title, peaceA, peaceB, tension] = FakeAudio.instances;
  check('标题文件路径', title.src === 'art/music/title.mp3');
  check('发展期曲目池路径', peaceA.src === 'art/music/peace-01.mp3' && peaceB.src === 'art/music/peace-02.mp3');
  check('战斗文件路径', tension.src === 'art/music/tension.mp3');

  for (const audio of FakeAudio.instances) audio.emit('canplaythrough');
  sandbox.RS.audio.bgm.set('peace');
  check('发展期先播放 A', !peaceA.paused && peaceB.paused);

  peaceA.emit('ended');
  check('A 结束后切换 B', peaceA.paused && !peaceB.paused);
  peaceB.emit('ended');
  check('B 结束后轮回 A', !peaceA.paused && peaceB.paused && peaceA.currentTime === 0);

  peaceA.currentTime = 42;
  sandbox.RS.audio.bgm.set('tension');
  const tensionAtmosphere = sandbox.RS.audio.getStatus().atmosphere;
  check('进入战斗时暂停发展曲', peaceA.paused && !tension.paused);
  sandbox.RS.audio.bgm.set('peace');
  const peaceAtmosphere = sandbox.RS.audio.getStatus().atmosphere;
  check('返回发展期续播原曲', !peaceA.paused && tension.paused && peaceA.currentTime === 42);
  check('交战时底板加重而人声层主动让位',
    tensionAtmosphere.bed > peaceAtmosphere.bed &&
    tensionAtmosphere.choir < peaceAtmosphere.choir);

  const [sfxBus, synthBus, musicBus] = FakeAudioContext.gains;
  const atmosphereBus = FakeAudioContext.gains[3];
  const choirBus = FakeAudioContext.gains[4];
  check('标题氛围层含低频底板与四声部无词和声',
    atmosphereBus && choirBus && FakeAudioContext.oscillators >= 6 &&
    sandbox.RS.audio.getStatus().atmosphere.scene === 'peace');
  check('静音返回 true', sandbox.RS.audio.toggleMute() === true);
  check('静音覆盖 BGM 与音效总线',
    FakeAudio.instances.every(a => a.volume === 0) && sfxBus.gain.value === 0 &&
    musicBus.gain.value === 0 && atmosphereBus.gain.value === 0 && choirBus.gain.value === 0);
  check('取消静音返回 false', sandbox.RS.audio.toggleMute() === false);
  check('取消静音恢复分轨音量',
    title.volume === 0.22 && peaceA.volume === 0.16 && peaceB.volume === 0.16 && tension.volume === 0.20);
  check('取消静音恢复独立总线',
    sfxBus.gain.value === 1 && synthBus.gain.value === 0.65 &&
    Math.abs(musicBus.gain.value - 0.182) < 0.000001 &&
    atmosphereBus.gain.value > 0 && choirBus.gain.value > 0);

  sandbox.RS.audio.setMusicVolume(0.5);
  check('BGM 滑杆只缩放文件与合成配乐',
    title.volume === 0.11 && peaceA.volume === 0.08 && peaceB.volume === 0.08 &&
    tension.volume === 0.10 && Math.abs(musicBus.gain.value - 0.091) < 0.000001 &&
    sfxBus.gain.value === 1);

  sandbox.RS.audio.setSfxVolume(0.5);
  check('音效滑杆只缩放音效总线',
    sfxBus.gain.value === 0.5 && synthBus.gain.value === 0.65 &&
    Math.abs(musicBus.gain.value - 0.091) < 0.000001);
  check('音乐与音效音量写入浏览器存储',
    JSON.parse(storageData['red-storm.audio-settings.v1']).music === 0.5 &&
    JSON.parse(storageData['red-storm.audio-settings.v1']).sfx === 0.5);
  sandbox.RS.audio.setAtmosphereVolume(0);
  check('氛围厚度归零可做原声 A/B 对比',
    atmosphereBus.gain.value === 0 && choirBus.gain.value === 0);
  check('音量设置写入浏览器存储',
    JSON.parse(storageData['red-storm.audio-settings.v1']).music === 0.5 &&
    JSON.parse(storageData['red-storm.audio-settings.v1']).sfx === 0.5 &&
    JSON.parse(storageData['red-storm.audio-settings.v1']).atmosphere === 0);
  check('音量查询返回三个独立值',
    sandbox.RS.audio.getVolumes().music === 0.5 &&
    sandbox.RS.audio.getVolumes().sfx === 0.5 &&
    sandbox.RS.audio.getVolumes().atmosphere === 0);
  sandbox.RS.audio.setMusicVolume(1);
  sandbox.RS.audio.setSfxVolume(1);
  sandbox.RS.audio.setAtmosphereVolume(0.7);

  const decodedBefore = FakeAudioContext.sources.filter(s => s.buffer && s.buffer.decoded && s.started).length;
  sandbox.RS.audio.sfx('shot_shell');
  sandbox.RS.audio.sfx('explosion');
  const decodedAfter = FakeAudioContext.sources.filter(s => s.buffer && s.buffer.decoded && s.started).length;
  check('坦克炮与爆炸通过 WebAudio 缓冲区并发播放', decodedAfter === decodedBefore + 2);

  sandbox.RS.audio.update(0.5, {
    state: 'playing', paused: false,
    units: [
      { owner: 'player', kind: 'infantry', vehicle: false, hp: 60, x: 1, y: 1, path: [{ x: 2, y: 1 }] },
      { owner: 'player', kind: 'lightTank', vehicle: true, hp: 180, x: 2, y: 2, path: [{ x: 3, y: 2 }] },
      { owner: 'player', kind: 'harvester', vehicle: true, hp: 300, x: 3, y: 3, path: null, state: 'harvest' },
    ],
  });
  check('可见步兵、移动坦克与采矿启动 WebAudio 循环',
    sandbox.RS.audio.getStatus().loops.includes('move_infantry') &&
    sandbox.RS.audio.getStatus().loops.includes('move_vehicle') &&
    sandbox.RS.audio.getStatus().loops.includes('harvest'));

  const activeLoops = FakeAudioContext.sources.filter(s => s.buffer && s.buffer.decoded && s.loop && s.started && !s.stopped);
  sandbox.RS.audio.update(0.5, { state: 'playing', paused: false, units: [] });
  check('对应状态消失后停止环境循环',
    activeLoops.length >= 3 && activeLoops.every(s => s.stopped));

  // 两个循环文件加载失败时仍应持续产生合成音,不能永久沉默。
  const failedStorage = {};
  const failedSandbox = makeSandbox(src => {
    const failed = src.includes('tank-tread') || src.includes('mining');
    return Promise.resolve({
      ok: !failed,
      status: failed ? 404 : 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  }, failedStorage, true);
  failedSandbox.RS.audio.unlock();
  await flushPromises();
  await flushPromises();
  const failedStatus = failedSandbox.RS.audio.getStatus();
  check('加载失败被记录而不是伪装成功',
    failedStatus.loaded === expectedSfxFiles.length - 2 && failedStatus.failed.length === 2);
  const failedFallbackBefore = FakeAudioContext.oscillators + FakeAudioContext.buffers;
  failedSandbox.RS.audio.update(0.5, {
    state: 'playing', paused: false,
    units: [
      { owner: 'player', kind: 'lightTank', vehicle: true, hp: 180, x: 2, y: 2, path: [{ x: 3, y: 2 }] },
      { owner: 'player', kind: 'harvester', vehicle: true, hp: 300, x: 3, y: 3, path: null, state: 'harvest' },
    ],
  });
  check('履带/采矿文件失败时立即使用合成循环兜底',
    FakeAudioContext.oscillators + FakeAudioContext.buffers > failedFallbackBefore &&
    failedSandbox.RS.audio.getStatus().loops.length === 0);

  // README 允许直接双击 index.html。file:// 不能 fetch,必须用 HTMLAudio 播放正式 WAV。
  let fileFetchCalls = 0;
  const fileAudioStart = FakeAudio.instances.length;
  const fileSandbox = makeSandbox(() => {
    fileFetchCalls++;
    return Promise.reject(new Error('file fetch should not run'));
  }, {}, true, 'file:');
  fileSandbox.RS.audio.unlock();
  fileSandbox.RS.audio.sfx('shot_bullet');
  fileSandbox.RS.audio.update(0.5, {
    state: 'playing', paused: false,
    units: [
      { owner: 'player', kind: 'infantry', vehicle: false, hp: 60, x: 1, y: 1, path: [{ x: 2, y: 1 }] },
      { owner: 'player', kind: 'lightTank', vehicle: true, hp: 180, x: 2, y: 2, path: [{ x: 3, y: 2 }] },
      { owner: 'player', kind: 'harvester', vehicle: true, hp: 300, x: 3, y: 3, path: null, state: 'harvest' },
      { owner: 'player', kind: 'harvester', vehicle: true, hp: 300, x: 4, y: 4, path: [{ x: 5, y: 4 }], state: 'toOre' },
    ],
  });
  const fileStatus = fileSandbox.RS.audio.getStatus();
  const fileSfxPlayers = FakeAudio.instances.slice(fileAudioStart + 4);
  check('file 协议不错误调用 fetch', fileFetchCalls === 0);
  check('file 协议启用 HTMLAudio 正式音效通道',
    fileStatus.sfxMode === 'html-media-file' && fileStatus.stats.mediaPlays === 1 &&
    fileStatus.stats.mediaLoopStarts === 4);
  check('直接打开时步枪与四类环境循环均播放正式文件',
    fileSfxPlayers.some(audio => audio.src === 'art/sfx/rifle-shot.wav' && audio.playCalls === 1) &&
    ['infantry-steps.wav', 'tank-tread.wav', 'harvester-engine.wav', 'mining.wav'].every(name =>
      fileSfxPlayers.some(audio => audio.src === 'art/sfx/' + name && audio.playCalls === 1)));
  fileSandbox.RS.audio.update(0.5, { state: 'playing', paused: false, units: [] });
  check('file 协议环境循环随状态停止',
    fileSandbox.RS.audio.getStatus().loops.length === 0 &&
    fileSfxPlayers.filter(audio => audio.loop).every(audio => audio.paused));

  console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
  process.exitCode = failures ? 1 : 0;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

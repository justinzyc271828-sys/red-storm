/* 过场播放器:数据驱动的 Canvas 2.5D 关键帧。
 * 帧带 art 路径时按真关键帧渲染(图片 Ken Burns 推拉/横移/抖动 + 沙尘/信号故障/字幕叠加)；
 * 图片缺失、加载失败或尚未加载完成时，回退到 visual 指定的程序化灰板场景。无 DOM 依赖；
 * 输入层可用 hit() 查询右上角跳过按钮，再调用 skip()。 */
(function (RS) {
  'use strict';

  const t = RS.i18n.t;
  const tf = RS.i18n.tf;
  const DEFAULT_DURATION = 4;
  const FADE_TIME = 0.3;

  let playing = false;
  let scene = null;
  let frameIndex = 0;
  let frameElapsed = 0;
  let elapsed = 0;
  let totalDuration = 0;
  let completion = null;
  let skipRect = null;
  let lastW = 1280;
  let lastH = 720;
  let lastReason = null;

  /* 关键帧图片缓存:path -> { img, state: 'loading'|'ready'|'error' }。
   * Node 环境没有 Image,requestImage 一律返回 null,走程序化兜底。 */
  const imageCache = Object.create(null);

  /* 关键帧 Ken Burns 预设:z0/z1 为缩放起止(≥1 保证不露边),
   * dx/dy 为横/纵移幅度(占画面宽/高的比例),shake 加镜头抖动,glitch 增强信号故障。 */
  const MOTIONS = Object.freeze({
    'slow-push': Object.freeze({ z0: 1.03, z1: 1.12, dx: 0, dy: 0 }),
    'slow-push-glitch': Object.freeze({ z0: 1.03, z1: 1.12, dx: 0, dy: 0, glitch: 1 }),
    'slow-push-fade': Object.freeze({ z0: 1.03, z1: 1.11, dx: 0, dy: 0 }),
    'slow-push-shake': Object.freeze({ z0: 1.04, z1: 1.12, dx: 0, dy: 0, shake: 1 }),
    'push-into-storm': Object.freeze({ z0: 1.04, z1: 1.18, dx: 0, dy: 0 }),
    'slow-pull': Object.freeze({ z0: 1.14, z1: 1.03, dx: 0, dy: 0 }),
    'slow-pull-fade': Object.freeze({ z0: 1.14, z1: 1.03, dx: 0, dy: 0 }),
    'pan-right': Object.freeze({ z0: 1.07, z1: 1.07, dx: 0.05, dy: 0 }),
    'parallax-pan': Object.freeze({ z0: 1.07, z1: 1.07, dx: 0.08, dy: 0 }),
    'triptych-pan': Object.freeze({ z0: 1.07, z1: 1.07, dx: 0.09, dy: 0 }),
    'pan-shake': Object.freeze({ z0: 1.07, z1: 1.07, dx: 0.05, dy: 0, shake: 1 }),
    'scan-north': Object.freeze({ z0: 1.08, z1: 1.08, dx: 0, dy: -0.07 }),
    'tilt-up': Object.freeze({ z0: 1.08, z1: 1.08, dx: 0, dy: -0.06 }),
    'scan-pole': Object.freeze({ z0: 1.06, z1: 1.12, dx: 0, dy: -0.05 }),
    'tilt-down': Object.freeze({ z0: 1.08, z1: 1.08, dx: 0, dy: 0.06 }),
    'tilt-down-shake': Object.freeze({ z0: 1.08, z1: 1.08, dx: 0, dy: 0.06, shake: 1 }),
    'lock-coordinate': Object.freeze({ z0: 1.1, z1: 1.16, dx: 0, dy: 0 }),
    'network-spread': Object.freeze({ z0: 1.12, z1: 1.04, dx: 0, dy: 0 }),
    'network-restore': Object.freeze({ z0: 1.07, z1: 1.07, dx: -0.05, dy: 0 }),
    'network-darken': Object.freeze({ z0: 1.12, z1: 1.04, dx: 0, dy: 0 }),
    'pan-to-light': Object.freeze({ z0: 1.07, z1: 1.07, dx: 0.06, dy: 0 }),
  });

  const cutscene = RS.cutscene = {
    start,
    update,
    draw,
    skip,
    hit,
    getState,
    warm,
    motions: MOTIONS,
  };

  Object.defineProperties(cutscene, {
    active: {
      enumerable: true,
      get() { return playing; },
    },
    current: {
      enumerable: true,
      get() { return currentFrame(); },
    },
  });

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function finite(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function smooth(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function frameDuration(frame) {
    return Math.max(0.05, finite(frame && frame.duration, DEFAULT_DURATION));
  }

  function currentFrame() {
    if (!playing || !scene || !scene.frames) return null;
    return scene.frames[frameIndex] || null;
  }

  /* 清单门控:RS.campaignArt(tools/convert-cg.js 生成)存在时,
   * 只加载清单内的关键帧,未交付的美术不发起请求(避免控制台 404)。 */
  function artAllowed(path) {
    const list = RS.campaignArt;
    if (!Array.isArray(list)) return true;
    return list.indexOf(path.split('/').pop()) >= 0;
  }

  /* 请求一张关键帧图片;未加载完成或失败时返回 null(调用方走程序化兜底)。
   * 已在缓存中的路径不会重复发起加载。 */
  function requestImage(path) {
    if (!path || typeof Image !== 'function' || !artAllowed(path)) return null;
    let entry = imageCache[path];
    if (!entry) {
      entry = { img: null, state: 'loading' };
      imageCache[path] = entry;
      try {
        const img = new Image();
        img.onload = () => { entry.img = img; entry.state = 'ready'; };
        img.onerror = () => { entry.state = 'error'; };
        img.src = path;
      } catch (_) {
        entry.state = 'error';
      }
    }
    return entry.state === 'ready' ? entry.img : null;
  }

  /* 提前预热一组关键帧路径(战役在选难度/开战时调用,减少播到才加载的等待)。 */
  function warm(paths) {
    const list = Array.isArray(paths) ? paths : [paths];
    let kicked = 0;
    for (const path of list) {
      if (!path || typeof Image !== 'function') continue;
      requestImage(path);
      kicked++;
    }
    return kicked;
  }

  function frameMotion(frame) {
    const name = frame && frame.motion;
    return MOTIONS[name] || MOTIONS['slow-push'];
  }

  function start(nextScene, onComplete) {
    if (!nextScene || !Array.isArray(nextScene.frames) || !nextScene.frames.length) return false;
    scene = nextScene;
    playing = true;
    frameIndex = 0;
    frameElapsed = 0;
    elapsed = 0;
    totalDuration = nextScene.frames.reduce((sum, frame) => sum + frameDuration(frame), 0);
    completion = typeof onComplete === 'function' ? onComplete : null;
    skipRect = null;
    lastReason = null;
    for (const frame of nextScene.frames) {
      if (frame && frame.art) requestImage(frame.art);
    }
    return true;
  }

  function finish(reason) {
    if (!playing) return false;
    const cb = completion;
    const finishedScene = scene;
    playing = false;
    completion = null;
    lastReason = reason;
    skipRect = null;
    if (cb) {
      cb({
        reason,
        skipped: reason === 'skipped',
        scene: finishedScene,
      });
    }
    return true;
  }

  function update(dt) {
    if (!playing) return false;
    let step = finite(dt, 0);
    if (step <= 0) return true;
    elapsed = Math.min(totalDuration, elapsed + step);
    frameElapsed += step;

    while (playing) {
      const duration = frameDuration(currentFrame());
      if (frameElapsed < duration) break;
      frameElapsed -= duration;
      frameIndex++;
      if (!scene || frameIndex >= scene.frames.length) {
        frameIndex = scene ? scene.frames.length - 1 : 0;
        frameElapsed = scene ? frameDuration(scene.frames[frameIndex]) : 0;
        elapsed = totalDuration;
        finish('complete');
      }
    }
    return playing;
  }

  function skip() {
    if (!playing) return false;
    elapsed = totalDuration;
    if (scene && scene.frames.length) {
      frameIndex = scene.frames.length - 1;
      frameElapsed = frameDuration(scene.frames[frameIndex]);
    }
    return finish('skipped');
  }

  function skipButtonRect(w, h) {
    const margin = Math.max(16, Math.min(w, h) * 0.035);
    const bw = clamp(w * 0.09, 88, 116);
    const bh = clamp(h * 0.052, 32, 42);
    return { x: w - margin - bw, y: margin, w: bw, h: bh };
  }

  function hit(x, y) {
    if (!playing) return null;
    const r = skipRect || skipButtonRect(lastW, lastH);
    const px = finite(x, -1), py = finite(y, -1);
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h ? 'skip' : null;
  }

  function getState() {
    const frame = currentFrame();
    const duration = frame ? frameDuration(frame) : 0;
    return {
      active: playing,
      scene,
      sceneId: scene && (scene.id || scene.key || null),
      frame,
      frameIndex,
      frameElapsed,
      frameDuration: duration,
      frameProgress: duration ? clamp(frameElapsed / duration, 0, 1) : 0,
      elapsed,
      totalDuration,
      progress: totalDuration ? clamp(elapsed / totalDuration, 0, 1) : 0,
      reason: lastReason,
    };
  }

  function visualType(frame) {
    if (!frame) return 'chapter-card';
    if (typeof frame.visual === 'string') return frame.visual;
    if (frame.visual && typeof frame.visual === 'object')
      return frame.visual.type || frame.visual.name || 'chapter-card';
    return 'chapter-card';
  }

  function visualOptions(frame) {
    return frame && frame.visual && typeof frame.visual === 'object' ? frame.visual : {};
  }

  function toneName(frame) {
    return String(frame && frame.tone || '').toLowerCase();
  }

  function makeGradient(ctx, kind, args, stops, fallback) {
    if (!ctx || typeof ctx[kind] !== 'function') return fallback;
    const g = ctx[kind].apply(ctx, args);
    if (!g || typeof g.addColorStop !== 'function') return fallback;
    for (const stop of stops) g.addColorStop(stop[0], stop[1]);
    return g;
  }

  function imageOf(sprite) {
    if (!sprite) return null;
    return sprite.canvas || sprite;
  }

  function imageSize(img) {
    if (!img) return null;
    const w = finite(img.naturalWidth || img.videoWidth || img.width, 0);
    const h = finite(img.naturalHeight || img.videoHeight || img.height, 0);
    return w > 0 && h > 0 ? { w, h } : null;
  }

  function safeDrawImage(ctx, img) {
    if (!ctx || typeof ctx.drawImage !== 'function' || !img) return false;
    const args = Array.prototype.slice.call(arguments, 2);
    try {
      ctx.drawImage.apply(ctx, [img].concat(args));
      return true;
    } catch (e) {
      return false;
    }
  }

  function drawCover(ctx, img, w, h, zoom, panX, panY) {
    const size = imageSize(img);
    if (!size) return false;
    const scale = Math.max(w / size.w, h / size.h) * finite(zoom, 1);
    const dw = size.w * scale, dh = size.h * scale;
    const x = (w - dw) / 2 + finite(panX, 0);
    const y = (h - dh) / 2 + finite(panY, 0);
    return safeDrawImage(ctx, img, x, y, dw, dh);
  }

  function hash(a, b) {
    let h = (a * 374761393 + b * 668265263) ^ 0x5bf03635;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  function drawBase(ctx, w, h, type, frame, t) {
    const dark = type === 'orbit' || type === 'network-map' || type === 'polar-signal'
      || type === 'radio-silence';
    const tone = toneName(frame);
    const top = dark ? '#05070a' : '#341a14';
    const bottom = dark ? '#120b0a' : '#8a3f28';
    ctx.fillStyle = makeGradient(ctx, 'createLinearGradient', [0, 0, 0, h], [
      [0, top],
      [0.55, tone === 'human' ? '#172735' : '#3a1c17'],
      [1, bottom],
    ], top);
    ctx.fillRect(0, 0, w, h);

    const titleBg = RS.sprites && RS.sprites.titleBg;
    const useTitle = type !== 'orbit' && type !== 'network-map' && type !== 'polar-signal'
      && type !== 'radio-silence';
    if (useTitle && titleBg) {
      ctx.save();
      ctx.globalAlpha = type === 'chapter-card' ? 0.62 : 0.2;
      drawCover(ctx, titleBg, w, h, 1.05 + t * 0.025, (t - 0.5) * w * 0.025, 0);
      ctx.restore();
      ctx.fillStyle = type === 'chapter-card' ? 'rgba(9,8,9,0.48)' : 'rgba(36,13,8,0.34)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  function motionFor(type) {
    const motions = {
      orbit: { zoom: 0.035, x: -0.018, y: 0.006 },
      'mine-routine': { zoom: 0.045, x: 0.032, y: -0.006 },
      'machine-turn': { zoom: 0.065, x: -0.018, y: 0 },
      uprising: { zoom: 0.055, x: -0.025, y: 0.008 },
      'network-map': { zoom: 0.04, x: 0, y: 0 },
      'guard-deploy': { zoom: 0.05, x: 0.034, y: -0.006 },
      'chapter-card': { zoom: 0.025, x: -0.012, y: 0 },
      wreck: { zoom: 0.06, x: -0.015, y: 0.008 },
      'polar-signal': { zoom: 0.045, x: 0, y: -0.01 },
      'core-collapse': { zoom: 0.075, x: 0, y: 0.008 },
      'radio-silence': { zoom: 0.012, x: 0, y: 0 },
    };
    return motions[type] || { zoom: 0.035, x: 0.02, y: 0 };
  }

  function pickUnit(owner, kind, dir) {
    const S = RS.sprites || {};
    const enemy = owner === 'enemy' && S.enemy && S.enemy.units;
    const base = S.units || {};
    const set = enemy && enemy[kind] || base[kind];
    if (!set) return null;
    if (!Array.isArray(set)) return set;
    if (!set.length) return null;
    const index = ((Math.round(finite(dir, 0)) % set.length) + set.length) % set.length;
    return set[index] || set[0] || null;
  }

  function pickBuilding(owner, type) {
    const S = RS.sprites || {};
    if (owner === 'enemy' && S.enemy && S.enemy.buildings && S.enemy.buildings[type])
      return { sprite: S.enemy.buildings[type], nativeEnemy: true };
    if (S.buildings && S.buildings[type])
      return { sprite: S.buildings[type], nativeEnemy: owner !== 'enemy' };
    if (type === 'cc' && S.cc) return { sprite: S.cc, nativeEnemy: owner !== 'enemy' };
    if (type === 'refinery' && S.refinery)
      return { sprite: S.refinery, nativeEnemy: owner !== 'enemy' };
    return null;
  }

  function factionColor(owner) {
    return owner === 'enemy' ? '#f28a32' : '#68c5ed';
  }

  function drawShadow(ctx, x, y, rx, ry, alpha) {
    ctx.save();
    ctx.globalAlpha = finite(alpha, 0.28);
    ctx.fillStyle = '#050303';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFallbackUnit(ctx, owner, kind, x, y, size, dir) {
    const color = factionColor(owner);
    const ang = finite(dir, 0) * Math.PI / 4;
    ctx.save();
    ctx.translate(x, y - size * 0.28);
    ctx.rotate(ang * 0.15);
    ctx.fillStyle = owner === 'enemy' ? '#55575a' : '#dbe5e9';
    ctx.strokeStyle = '#17191b';
    ctx.lineWidth = Math.max(1.5, size * 0.025);
    if (kind === 'infantry' || kind === 'rocket') {
      ctx.beginPath();
      ctx.arc(0, -size * 0.33, size * 0.11, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillRect(-size * 0.09, -size * 0.22, size * 0.18, size * 0.32);
      ctx.strokeRect(-size * 0.09, -size * 0.22, size * 0.18, size * 0.32);
      ctx.fillStyle = color;
      ctx.fillRect(-size * 0.04, -size * 0.16, size * 0.08, size * 0.17);
    } else {
      ctx.beginPath();
      ctx.moveTo(-size * 0.48, 0);
      ctx.lineTo(-size * 0.32, -size * 0.35);
      ctx.lineTo(size * 0.34, -size * 0.35);
      ctx.lineTo(size * 0.48, 0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillRect(-size * 0.25, -size * 0.29, size * 0.5, size * 0.08);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.26);
      ctx.lineTo(Math.cos(ang) * size * 0.4, -size * 0.26 + Math.sin(ang) * size * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawUnit(ctx, owner, kind, x, y, size, dir, alpha) {
    drawShadow(ctx, x, y + 2, size * 0.34, size * 0.1, 0.28 * finite(alpha, 1));
    const sprite = pickUnit(owner, kind, dir);
    const img = imageOf(sprite);
    const dims = imageSize(img);
    if (!dims) {
      drawFallbackUnit(ctx, owner, kind, x, y, size, dir);
      return;
    }
    const scale = Math.min(size / dims.h, size * 1.6 / dims.w);
    const dw = dims.w * scale, dh = dims.h * scale;
    ctx.save();
    ctx.globalAlpha = finite(alpha, 1);
    ctx.imageSmoothingEnabled = false;
    safeDrawImage(ctx, img, x - dw / 2, y - dh, dw, dh);
    if (owner === 'enemy' && !(RS.sprites && RS.sprites.enemy && RS.sprites.enemy.units
      && RS.sprites.enemy.units[kind])) {
      ctx.fillStyle = '#f28a32';
      ctx.fillRect(x - size * 0.2, y - size * 0.42, size * 0.4, Math.max(2, size * 0.045));
    }
    ctx.restore();
  }

  function drawFallbackBuilding(ctx, owner, type, x, y, size) {
    const color = factionColor(owner);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = owner === 'enemy' ? '#4b4f52' : '#d8e1e5';
    ctx.strokeStyle = '#17191b';
    ctx.lineWidth = Math.max(2, size * 0.018);
    ctx.beginPath();
    ctx.moveTo(-size * 0.46, 0);
    ctx.lineTo(-size * 0.32, -size * 0.56);
    ctx.lineTo(size * 0.28, -size * 0.56);
    ctx.lineTo(size * 0.46, -size * 0.12);
    ctx.lineTo(size * 0.34, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-size * 0.25, -size * 0.46, size * 0.5, size * 0.08);
    if (type === 'cc') {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.55);
      ctx.lineTo(0, -size * 0.84);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -size * 0.86, size * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBuilding(ctx, owner, type, x, y, size, alpha) {
    drawShadow(ctx, x, y + 4, size * 0.46, size * 0.14, 0.34 * finite(alpha, 1));
    const picked = pickBuilding(owner, type);
    const img = picked && imageOf(picked.sprite);
    const dims = imageSize(img);
    if (!dims) {
      drawFallbackBuilding(ctx, owner, type, x, y, size);
      return;
    }
    const scale = Math.min(size / dims.h, size * 1.7 / dims.w);
    const dw = dims.w * scale, dh = dims.h * scale;
    ctx.save();
    ctx.globalAlpha = finite(alpha, 1);
    ctx.imageSmoothingEnabled = false;
    safeDrawImage(ctx, img, x - dw / 2, y - dh, dw, dh);
    if (owner === 'enemy' && picked && !picked.nativeEnemy) {
      ctx.fillStyle = '#f28a32';
      ctx.fillRect(x - size * 0.28, y - size * 0.58, size * 0.56, Math.max(3, size * 0.035));
    }
    ctx.restore();
  }

  function drawSandPlane(ctx, w, h, t, dark) {
    const horizon = h * 0.43;
    ctx.fillStyle = makeGradient(ctx, 'createLinearGradient', [0, horizon, 0, h], [
      [0, dark ? '#45261e' : '#9c5235'],
      [0.45, dark ? '#63301f' : '#b96742'],
      [1, dark ? '#2d1814' : '#6d3121'],
    ], dark ? '#45261e' : '#9c5235');
    ctx.fillRect(-w * 0.12, horizon, w * 1.24, h * 0.7);
    ctx.lineWidth = 1;
    for (let k = 0; k < 10; k++) {
      const y = horizon + (k + 1) * (h - horizon) / 11;
      const spread = (y - horizon) * 1.55;
      ctx.strokeStyle = 'rgba(255,198,140,' + (0.05 + k * 0.008).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(w / 2 - spread, y);
      ctx.quadraticCurveTo(w / 2 + Math.sin(k * 2.1 + t) * spread * 0.25, y - 8, w / 2 + spread, y);
      ctx.stroke();
    }
  }

  function drawOreCluster(ctx, x, y, size) {
    const crystals = [[0, 0, 1], [-0.32, 0.08, 0.7], [0.3, 0.12, 0.8]];
    for (const c of crystals) {
      const cx = x + c[0] * size, cy = y + c[1] * size, s = size * c[2];
      ctx.fillStyle = '#45b9e8';
      ctx.strokeStyle = '#163d55';
      ctx.lineWidth = Math.max(1, size * 0.025);
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.65);
      ctx.lineTo(cx + s * 0.22, cy - s * 0.12);
      ctx.lineTo(cx + s * 0.16, cy + s * 0.18);
      ctx.lineTo(cx - s * 0.18, cy + s * 0.18);
      ctx.lineTo(cx - s * 0.24, cy - s * 0.12);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(232,250,255,0.65)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.55);
      ctx.lineTo(cx + s * 0.13, cy - s * 0.12);
      ctx.lineTo(cx, cy - s * 0.04);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawSmoke(ctx, x, y, size, t, color) {
    for (let k = 0; k < 7; k++) {
      const age = (t * 0.7 + k / 7) % 1;
      const px = x + Math.sin(k * 3.2 + t * 4) * size * (0.08 + age * 0.12);
      const py = y - age * size * 0.8;
      const r = size * (0.08 + age * 0.15);
      ctx.fillStyle = color || 'rgba(38,35,34,' + (0.4 * (1 - age)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawExplosion(ctx, x, y, size, phase) {
    const pulse = 0.7 + Math.sin(phase * Math.PI * 4) * 0.18;
    const r = size * pulse;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = makeGradient(ctx, 'createRadialGradient', [x, y, 0, x, y, r], [
      [0, 'rgba(255,245,190,0.95)'],
      [0.25, 'rgba(255,154,45,0.9)'],
      [0.62, 'rgba(224,62,35,0.55)'],
      [1, 'rgba(120,30,20,0)'],
    ], 'rgba(245,102,45,0.72)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,113,0.8)';
    ctx.lineWidth = Math.max(1, size * 0.04);
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4 + phase;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * r * 0.35, y + Math.sin(ang) * r * 0.35);
      ctx.lineTo(x + Math.cos(ang) * r * 1.35, y + Math.sin(ang) * r * 1.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawOrbit(ctx, w, h, t) {
    ctx.fillStyle = '#030508';
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
    for (let k = 0; k < 90; k++) {
      const x = hash(k, 7) * w;
      const y = hash(k, 19) * h * 0.82;
      const a = 0.35 + hash(k, 31) * 0.6;
      ctx.fillStyle = 'rgba(220,235,240,' + a.toFixed(3) + ')';
      const s = hash(k, 43) > 0.9 ? 2 : 1;
      ctx.fillRect(x, y, s, s);
    }
    const r = Math.min(w, h) * 0.35;
    const x = w * 0.57, y = h * 0.68;
    ctx.fillStyle = makeGradient(ctx, 'createRadialGradient', [
      x - r * 0.36, y - r * 0.42, r * 0.08, x, y, r,
    ], [
      [0, '#e38d5d'],
      [0.42, '#bd5637'],
      [0.78, '#6b2a20'],
      [1, '#1a0c0b'],
    ], '#a94b34');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,177,116,0.22)';
    for (let k = 0; k < 8; k++) {
      const yy = y - r * 0.65 + k * r * 0.2;
      ctx.lineWidth = r * (0.025 + (k % 3) * 0.012);
      ctx.beginPath();
      ctx.ellipse(x + Math.sin(t * 2 + k) * r * 0.08, yy, r * 0.92, r * 0.16, 0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#75d5f5';
    const beacon = 0.5 + 0.5 * Math.sin(elapsed * 4);
    ctx.globalAlpha = 0.45 + beacon * 0.55;
    ctx.beginPath();
    ctx.arc(x - r * 0.28, y - r * 0.22, Math.max(2, r * 0.012), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawMineRoutine(ctx, w, h, t) {
    drawSandPlane(ctx, w, h, t, false);
    drawOreCluster(ctx, w * 0.24, h * 0.72, Math.min(w, h) * 0.1);
    drawOreCluster(ctx, w * 0.35, h * 0.78, Math.min(w, h) * 0.07);
    drawBuilding(ctx, 'player', 'refinery', w * 0.72, h * 0.7, Math.min(w, h) * 0.31, 1);
    const drift = (t - 0.5) * w * 0.05;
    drawUnit(ctx, 'player', 'harvester', w * 0.42 + drift, h * 0.75, Math.min(w, h) * 0.13, 0, 1);
    drawUnit(ctx, 'player', 'harvester', w * 0.55 + drift * 0.55, h * 0.82, Math.min(w, h) * 0.11, 7, 0.9);
    drawSmoke(ctx, w * 0.75, h * 0.44, Math.min(w, h) * 0.14, t, null);
    ctx.strokeStyle = 'rgba(100,205,240,0.34)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(w * 0.29, h * 0.7);
    ctx.quadraticCurveTo(w * 0.48, h * 0.63, w * 0.68, h * 0.69);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawMachineTurn(ctx, w, h, t) {
    drawSandPlane(ctx, w, h, t, true);
    drawOreCluster(ctx, w * 0.25, h * 0.75, Math.min(w, h) * 0.085);
    const turn = t < 0.38 ? 0 : (t < 0.62 ? 2 : 4);
    const ys = [0.66, 0.76, 0.86];
    for (let k = 0; k < 3; k++) {
      const x = w * (0.36 + k * 0.13);
      drawUnit(ctx, 'enemy', 'harvester', x, h * ys[k], Math.min(w, h) * 0.14, turn, 1);
      ctx.strokeStyle = 'rgba(242,138,50,' + (0.45 + 0.35 * Math.sin(elapsed * 5 + k)).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, h * ys[k] - Math.min(w, h) * 0.09, 10 + t * 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(242,138,50,0.62)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.26, h * 0.55);
    ctx.lineTo(w * 0.75, h * 0.55);
    ctx.stroke();
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? '#f28a32' : '#3b2a22';
      ctx.fillRect(w * 0.29 + k * w * 0.055, h * 0.535, w * 0.032, 4);
    }
  }

  function drawUprising(ctx, w, h, t) {
    drawSandPlane(ctx, w, h, t, true);
    drawBuilding(ctx, 'player', 'cc', w * 0.26, h * 0.72, Math.min(w, h) * 0.34, 0.92);
    drawBuilding(ctx, 'player', 'refinery', w * 0.44, h * 0.82, Math.min(w, h) * 0.22, 0.8);
    drawUnit(ctx, 'enemy', 'heavyTank', w * 0.72, h * 0.76, Math.min(w, h) * 0.16, 4, 1);
    drawUnit(ctx, 'enemy', 'infantry', w * 0.79, h * 0.84, Math.min(w, h) * 0.1, 4, 1);
    drawUnit(ctx, 'enemy', 'rocket', w * 0.65, h * 0.88, Math.min(w, h) * 0.1, 4, 1);
    const pulse = (elapsed * 1.8) % 1;
    ctx.strokeStyle = 'rgba(255,158,62,' + (0.55 + 0.35 * (1 - pulse)).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2, h * 0.006);
    ctx.beginPath();
    ctx.moveTo(w * 0.68, h * 0.67);
    ctx.lineTo(w * (0.4 - pulse * 0.05), h * (0.62 - pulse * 0.02));
    ctx.stroke();
    drawExplosion(ctx, w * 0.39, h * 0.61, Math.min(w, h) * 0.105, elapsed * 0.7);
    drawSmoke(ctx, w * 0.3, h * 0.51, Math.min(w, h) * 0.18, t, null);
  }

  function drawNetworkMap(ctx, w, h, t) {
    ctx.fillStyle = '#07090a';
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
    ctx.strokeStyle = 'rgba(242,138,50,0.09)';
    ctx.lineWidth = 1;
    const grid = Math.max(36, Math.min(w, h) * 0.07);
    for (let x = -grid; x < w + grid; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = -grid; y < h + grid; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const cx = w * 0.5, cy = h * 0.53, r = Math.min(w, h) * 0.33;
    ctx.strokeStyle = 'rgba(211,100,54,0.62)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.42, r, 0, 0, Math.PI * 2); ctx.stroke();
    const nodes = [
      [-0.62, -0.24], [-0.35, 0.42], [-0.06, -0.52], [0.12, 0.12],
      [0.34, -0.2], [0.56, 0.38], [0.7, -0.48], [-0.68, 0.36],
    ];
    const visible = Math.max(1, Math.ceil(t * nodes.length));
    ctx.lineWidth = 2;
    for (let k = 0; k < visible; k++) {
      const n = nodes[k], x = cx + n[0] * r, y = cy + n[1] * r;
      if (k > 0) {
        const p = nodes[Math.floor((k - 1) / 2)];
        ctx.strokeStyle = 'rgba(242,138,50,0.56)';
        ctx.beginPath();
        ctx.moveTo(cx + p[0] * r, cy + p[1] * r);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.fillStyle = k < visible - 1 ? '#f28a32' : '#ffd27d';
      ctx.beginPath();
      ctx.arc(x, y, 4 + (k === visible - 1 ? Math.sin(elapsed * 7) * 2 : 0), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(242,138,50,0.18)';
    ctx.lineWidth = Math.max(8, r * 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.35 + t * 0.65), 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawGuardDeploy(ctx, w, h, t) {
    drawSandPlane(ctx, w, h, t, false);
    drawBuilding(ctx, 'player', 'cc', w * 0.72, h * 0.72, Math.min(w, h) * 0.31, 1);
    drawBuilding(ctx, 'player', 'barracks', w * 0.82, h * 0.82, Math.min(w, h) * 0.2, 0.92);
    const advance = t * w * 0.08;
    drawUnit(ctx, 'player', 'infantry', w * 0.3 + advance, h * 0.76, Math.min(w, h) * 0.11, 0, 1);
    drawUnit(ctx, 'player', 'rocket', w * 0.4 + advance, h * 0.84, Math.min(w, h) * 0.11, 0, 1);
    drawUnit(ctx, 'player', 'heavyTank', w * 0.5 + advance, h * 0.78, Math.min(w, h) * 0.17, 0, 1);
    ctx.strokeStyle = 'rgba(104,197,237,0.58)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(w * 0.19, h * 0.68);
    ctx.quadraticCurveTo(w * 0.46, h * 0.59, w * 0.67, h * 0.68);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawChapterCard(ctx, w, h, t) {
    const y = h * 0.53;
    const width = w * (0.36 + t * 0.24);
    ctx.fillStyle = 'rgba(8,10,12,0.68)';
    ctx.fillRect(w / 2 - width / 2, y - 2, width, 4);
    ctx.fillStyle = '#d9573d';
    ctx.fillRect(w / 2 - width * 0.16, y - 3, width * 0.32, 6);
    ctx.strokeStyle = 'rgba(104,197,237,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.18, h * 0.28);
    ctx.lineTo(w * 0.28, h * 0.28);
    ctx.moveTo(w * 0.72, h * 0.72);
    ctx.lineTo(w * 0.82, h * 0.72);
    ctx.stroke();
  }

  function drawWreck(ctx, w, h, t, frame) {
    drawSandPlane(ctx, w, h, t, true);
    const owner = toneName(frame).indexOf('human') >= 0 ? 'player' : 'enemy';
    ctx.save();
    ctx.translate(w * 0.5, h * 0.74);
    ctx.rotate(-0.035);
    ctx.translate(-w * 0.5, -h * 0.74);
    drawBuilding(ctx, owner, 'cc', w * 0.5, h * 0.76, Math.min(w, h) * 0.38, 0.52);
    ctx.restore();
    ctx.fillStyle = 'rgba(20,16,14,0.88)';
    for (let k = 0; k < 9; k++) {
      const x = w * 0.35 + hash(k, 22) * w * 0.3;
      const y = h * 0.73 + hash(k, 44) * h * 0.12;
      const s = Math.min(w, h) * (0.018 + hash(k, 66) * 0.035);
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.lineTo(x + s * 0.4, y - s);
      ctx.lineTo(x + s, y + s * 0.25);
      ctx.closePath();
      ctx.fill();
    }
    drawSmoke(ctx, w * 0.47, h * 0.52, Math.min(w, h) * 0.25, t, null);
    ctx.fillStyle = 'rgba(224,72,42,' + (0.25 + 0.18 * Math.sin(elapsed * 6)).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(w * 0.56, h * 0.69, Math.min(w, h) * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPolarSignal(ctx, w, h, t) {
    ctx.fillStyle = '#070a0d';
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
    const cx = w * 0.5, cy = h * 0.57, r = Math.min(w, h) * 0.31;
    ctx.fillStyle = makeGradient(ctx, 'createRadialGradient', [
      cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r,
    ], [
      [0, '#71341f'],
      [0.72, '#3a1d17'],
      [1, '#120b0a'],
    ], '#492319');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(106,183,224,0.22)';
    ctx.lineWidth = 1;
    for (let k = -4; k <= 4; k++) {
      const yy = cy + k * r * 0.2;
      ctx.beginPath();
      ctx.ellipse(cx, yy, r * Math.sqrt(Math.max(0.08, 1 - (k * 0.2) ** 2)), r * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    const px = cx + r * 0.08, py = cy - r * 0.78;
    const pulse = (elapsed * 0.55) % 1;
    for (let k = 0; k < 3; k++) {
      const p = (pulse + k / 3) % 1;
      ctx.strokeStyle = 'rgba(242,138,50,' + (0.7 * (1 - p)).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 8 + p * r * 0.34, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = '#ffd27d';
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(242,138,50,0.5)';
    ctx.beginPath();
    ctx.moveTo(px, py); ctx.lineTo(cx, cy); ctx.stroke();
  }

  function drawCoreCollapse(ctx, w, h, t) {
    drawSandPlane(ctx, w, h, t, true);
    const fade = 1 - t * 0.42;
    ctx.save();
    ctx.translate(0, t * h * 0.018);
    drawBuilding(ctx, 'enemy', 'cc', w * 0.5, h * 0.76, Math.min(w, h) * 0.42, fade);
    ctx.restore();
    const blasts = [
      [0.43, 0.55, 0.08, 0],
      [0.57, 0.61, 0.1, 0.35],
      [0.5, 0.46, 0.075, 0.68],
    ];
    for (const b of blasts) {
      const phase = (t + b[3]) % 1;
      if (phase < 0.72)
        drawExplosion(ctx, w * b[0], h * b[1], Math.min(w, h) * b[2] * (0.7 + phase), phase);
    }
    for (let k = 0; k < 14; k++) {
      const phase = (t * 1.5 + hash(k, 14)) % 1;
      const x = w * (0.38 + hash(k, 28) * 0.24) + Math.sin(k) * phase * w * 0.04;
      const y = h * (0.48 + hash(k, 42) * 0.18) + phase * h * 0.25;
      ctx.fillStyle = k % 3 ? '#24201e' : '#f28a32';
      ctx.fillRect(x, y, 3 + hash(k, 56) * 7, 3 + hash(k, 70) * 7);
    }
    drawSmoke(ctx, w * 0.5, h * 0.5, Math.min(w, h) * 0.32, t, null);
  }

  function drawRadioSilence(ctx, w, h, t) {
    ctx.fillStyle = '#030405';
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
    const left = w * 0.18, right = w * 0.82, cy = h * 0.53;
    ctx.strokeStyle = 'rgba(92,145,163,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left, h * 0.33, right - left, h * 0.4);
    ctx.strokeStyle = 'rgba(242,138,50,' + (0.7 * (1 - t)).toFixed(3) + ')';
    ctx.lineWidth = Math.max(2, h * 0.004);
    ctx.beginPath();
    const points = 100;
    for (let k = 0; k <= points; k++) {
      const p = k / points;
      const amp = h * 0.12 * (1 - t) * (0.3 + 0.7 * Math.sin(p * Math.PI));
      const y = cy + Math.sin(p * Math.PI * 16 + elapsed * 7) * amp;
      const x = left + p * (right - left);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(104,197,237,' + (0.28 + 0.42 * t).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(left, cy);
    ctx.lineTo(right, cy);
    ctx.stroke();
    const dotAlpha = Math.max(0, 1 - t * 1.4);
    ctx.fillStyle = 'rgba(242,138,50,' + dotAlpha.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(right, cy, 5, 0, Math.PI * 2); ctx.fill();
  }

  const VISUAL_DRAWERS = {
    orbit: drawOrbit,
    'mine-routine': drawMineRoutine,
    'machine-turn': drawMachineTurn,
    uprising: drawUprising,
    'network-map': drawNetworkMap,
    'guard-deploy': drawGuardDeploy,
    'chapter-card': drawChapterCard,
    wreck: drawWreck,
    'polar-signal': drawPolarSignal,
    'core-collapse': drawCoreCollapse,
    'radio-silence': drawRadioSilence,
  };

  function drawUnknown(ctx, w, h, t) {
    drawSandPlane(ctx, w, h, t, true);
    ctx.strokeStyle = 'rgba(104,197,237,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.25, h * 0.3, w * 0.5, h * 0.4);
    ctx.beginPath();
    ctx.moveTo(w * 0.25, h * 0.3); ctx.lineTo(w * 0.75, h * 0.7);
    ctx.moveTo(w * 0.75, h * 0.3); ctx.lineTo(w * 0.25, h * 0.7);
    ctx.stroke();
  }

  function drawSandEffect(ctx, w, h, type, intensity) {
    if (type === 'orbit' || type === 'network-map' || type === 'radio-silence') return;
    const overlay = RS.sprites && RS.sprites.sandOverlay;
    const dims = imageSize(overlay);
    if (dims) {
      const scale = Math.max(0.55, Math.min(1.2, Math.min(w / dims.w, h / dims.h)));
      const tw = dims.w * scale, th = dims.h * scale;
      const ox = -((elapsed * 24) % tw);
      const oy = -((elapsed * 7) % th);
      ctx.save();
      ctx.globalAlpha = 0.07 + intensity * 0.11;
      for (let y = oy - th; y < h + th; y += th)
        for (let x = ox - tw; x < w + tw; x += tw)
          safeDrawImage(ctx, overlay, x, y, tw, th);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.lineWidth = 1;
    for (let k = 0; k < 34; k++) {
      const speed = 26 + hash(k, 9) * 74;
      const x = ((hash(k, 18) * (w + 180) + elapsed * speed) % (w + 180)) - 90;
      const y = hash(k, 27) * h;
      const len = 22 + hash(k, 36) * 76;
      ctx.strokeStyle = 'rgba(235,166,111,' + (0.035 + intensity * 0.09).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y - len * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  function signalIntensity(type, frame) {
    const tone = toneName(frame);
    if (type === 'machine-turn' || type === 'network-map' || type === 'polar-signal'
      || type === 'radio-silence') return 0.75;
    if (tone.indexOf('signal') >= 0 || tone.indexOf('enemy') >= 0) return 0.55;
    return 0.22;
  }

  function drawSignalEffect(ctx, w, h, type, frame, boost) {
    const intensity = Math.min(1, signalIntensity(type, frame) + (Number(boost) || 0));
    ctx.save();
    ctx.fillStyle = 'rgba(210,225,225,' + (0.012 + intensity * 0.018).toFixed(3) + ')';
    for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 1);
    const tick = Math.floor(elapsed * 15);
    if ((tick + frameIndex * 3) % 19 < 2) {
      for (let k = 0; k < 3; k++) {
        const y = hash(tick + k, frameIndex + 17) * h;
        const hh = 2 + hash(tick + k, 41) * h * 0.025;
        const dx = (hash(tick + k, 83) - 0.5) * w * 0.035 * intensity;
        ctx.fillStyle = k % 2
          ? 'rgba(242,138,50,' + (0.05 + intensity * 0.1).toFixed(3) + ')'
          : 'rgba(104,197,237,' + (0.04 + intensity * 0.08).toFixed(3) + ')';
        ctx.fillRect(Math.min(0, dx), y, w - Math.abs(dx), hh);
      }
    }
    ctx.restore();
  }

  function drawVignette(ctx, w, h, frame) {
    const tone = toneName(frame);
    const edge = tone.indexOf('danger') >= 0 || tone.indexOf('enemy') >= 0
      ? 'rgba(52,6,4,0.62)' : 'rgba(0,0,0,0.68)';
    ctx.fillStyle = makeGradient(ctx, 'createRadialGradient', [
      w / 2, h / 2, Math.min(w, h) * 0.2,
      w / 2, h / 2, Math.max(w, h) * 0.72,
    ], [
      [0, 'rgba(0,0,0,0)'],
      [0.65, 'rgba(0,0,0,0.08)'],
      [1, edge],
    ], 'rgba(0,0,0,0.16)');
    ctx.fillRect(0, 0, w, h);
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const source = String(text == null ? '' : text);
    if (!source) return [];
    const lines = [];
    const paragraphs = source.split('\n');
    for (const paragraph of paragraphs) {
      let line = '';
      for (const ch of paragraph) {
        const next = line + ch;
        if (line && ctx.measureText(next).width > maxWidth) {
          lines.push(line);
          line = ch;
          if (lines.length >= maxLines) break;
        } else {
          line = next;
        }
      }
      if (lines.length >= maxLines) break;
      if (line) lines.push(line);
      if (!paragraph && lines.length < maxLines) lines.push('');
      if (lines.length >= maxLines) break;
    }
    if (lines.length === maxLines) {
      const full = paragraphs.join('');
      const joined = lines.join('');
      if (joined.length < full.length) {
        let last = lines[lines.length - 1];
        while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
        lines[lines.length - 1] = last + '…';
      }
    }
    return lines;
  }

  function drawChapterText(ctx, w, h, frame, type) {
    const chapter = frame.chapter != null ? frame.chapter : scene && scene.chapter;
    const title = frame.title != null ? frame.title : scene && scene.title;
    if (chapter == null && title == null) return;
    ctx.save();
    ctx.textBaseline = 'top';
    if (type === 'chapter-card') {
      ctx.textAlign = 'center';
      if (chapter != null) {
        ctx.font = 'bold ' + Math.round(clamp(h * 0.048, 22, 40)) + 'px monospace';
        ctx.fillStyle = '#f0b067';
        ctx.fillText(t(String(chapter)), w / 2, h * 0.31);
      }
      if (title != null) {
        ctx.font = 'bold ' + Math.round(clamp(h * 0.085, 34, 68)) + 'px monospace';
        ctx.fillStyle = '#edf5f7';
        ctx.shadowColor = 'rgba(222,77,57,0.62)';
        ctx.shadowBlur = 14;
        ctx.fillText(t(String(title)), w / 2, h * 0.39);
        ctx.shadowBlur = 0;
      }
    } else {
      const margin = Math.max(18, Math.min(w, h) * 0.055);
      ctx.textAlign = 'left';
      if (chapter != null) {
        ctx.font = 'bold ' + Math.round(clamp(h * 0.028, 15, 22)) + 'px monospace';
        ctx.fillStyle = '#f0b067';
        ctx.fillText(t(String(chapter)), margin, margin);
      }
      if (title != null) {
        ctx.font = 'bold ' + Math.round(clamp(h * 0.045, 21, 34)) + 'px monospace';
        ctx.fillStyle = '#edf5f7';
        ctx.fillText(t(String(title)), margin, margin + clamp(h * 0.04, 25, 34));
      }
    }
    ctx.restore();
  }

  function drawDialogue(ctx, w, h, frame) {
    const dialogue = frame.dialogue == null ? '' : t(String(frame.dialogue));
    let caption = frame.caption == null || frame.caption === false ? '' : t(String(frame.caption));
    if (caption === dialogue) caption = '';
    if (!dialogue && !caption) return;

    const safeX = Math.max(20, w * 0.085);
    const safeBottom = Math.max(24, h * 0.075);
    const boxW = w - safeX * 2;
    const textX = safeX + clamp(w * 0.025, 18, 32);
    const innerW = boxW - (textX - safeX) * 2;
    const fontSize = Math.round(clamp(h * 0.035, 18, 27));
    const captionSize = Math.round(clamp(h * 0.025, 14, 19));
    const lineH = Math.round(fontSize * 1.38);
    const capH = Math.round(captionSize * 1.35);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = fontSize + 'px monospace';
    const dialogueLines = wrapText(ctx, dialogue, innerW, 2);
    ctx.font = captionSize + 'px monospace';
    const captionLines = wrapText(ctx, caption, innerW, 2);
    const speakerH = frame.speaker ? Math.round(clamp(h * 0.034, 20, 28)) : 0;
    const boxH = 20 + speakerH + dialogueLines.length * lineH
      + (dialogueLines.length && captionLines.length ? 8 : 0)
      + captionLines.length * capH + 18;
    const y = h - safeBottom - boxH;

    ctx.fillStyle = 'rgba(5,9,12,0.84)';
    ctx.fillRect(safeX, y, boxW, boxH);
    ctx.strokeStyle = frame.speaker === '中枢' ? '#f28a32' : '#4ea7d4';
    ctx.lineWidth = 2;
    ctx.strokeRect(safeX + 1, y + 1, boxW - 2, boxH - 2);
    ctx.fillStyle = frame.speaker === '中枢' ? '#f28a32' : '#68c5ed';
    ctx.fillRect(safeX, y, 5, boxH);

    let ty = y + 13;
    if (frame.speaker) {
      ctx.font = 'bold ' + Math.round(clamp(h * 0.024, 14, 18)) + 'px monospace';
      ctx.fillStyle = frame.speaker === '中枢' ? '#f6a45d' : '#89d5f1';
      ctx.fillText(t(String(frame.speaker)), textX, ty);
      ty += speakerH;
    }
    ctx.font = fontSize + 'px monospace';
    ctx.fillStyle = '#f1f5f6';
    for (const line of dialogueLines) {
      ctx.fillText(line, textX, ty);
      ty += lineH;
    }
    if (dialogueLines.length && captionLines.length) ty += 8;
    ctx.font = captionSize + 'px monospace';
    ctx.fillStyle = '#d5b49d';
    for (const line of captionLines) {
      ctx.fillText(line, textX, ty);
      ty += capH;
    }
    ctx.restore();
  }

  function drawSkipButton(ctx, w, h) {
    skipRect = skipButtonRect(w, h);
    const r = skipRect;
    ctx.save();
    ctx.fillStyle = 'rgba(5,9,12,0.72)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(216,226,230,0.72)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.round(clamp(h * 0.022, 13, 17)) + 'px monospace';
    ctx.fillStyle = '#e8eef0';
    ctx.fillText(t('跳过  »'), r.x + r.w / 2, r.y + r.h / 2);
    ctx.restore();
  }

  function drawProgress(ctx, w, h) {
    const margin = Math.max(18, Math.min(w, h) * 0.055);
    const y = h - Math.max(10, margin * 0.38);
    const p = totalDuration ? clamp(elapsed / totalDuration, 0, 1) : 0;
    ctx.fillStyle = 'rgba(225,235,238,0.16)';
    ctx.fillRect(margin, y, w - margin * 2, 2);
    ctx.fillStyle = '#d9573d';
    ctx.fillRect(margin, y, (w - margin * 2) * p, 2);
  }

  function drawLetterbox(ctx, w, h) {
    const bar = clamp(h * 0.032, 12, 28);
    ctx.fillStyle = '#020303';
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }

  function draw(ctx, w, h) {
    if (!playing || !ctx || typeof ctx.save !== 'function') return false;
    const frame = currentFrame();
    if (!frame) return false;
    w = Math.max(2, finite(w, lastW));
    h = Math.max(2, finite(h, lastH));
    lastW = w;
    lastH = h;

    const duration = frameDuration(frame);
    const rawT = clamp(frameElapsed / duration, 0, 1);
    const t = smooth(rawT);
    const type = visualType(frame);
    const img = frame.art ? requestImage(frame.art) : null;
    const motion = img ? frameMotion(frame) : null;

    ctx.save();
    if (img) {
      /* 真关键帧:Ken Burns 推拉/横移 + 可选抖动,叠在纯黑底上。 */
      ctx.fillStyle = '#04060a';
      ctx.fillRect(0, 0, w, h);
      const zoom = motion.z0 + (motion.z1 - motion.z0) * t;
      let panX = (motion.dx || 0) * w * (t - 0.5);
      let panY = (motion.dy || 0) * h * (t - 0.5);
      if (motion.shake) {
        const amp = h * 0.007 * (1 - t * 0.4);
        panX += Math.sin(elapsed * 43) * amp;
        panY += Math.cos(elapsed * 37) * amp * 0.7;
      }
      ctx.imageSmoothingEnabled = true;
      drawCover(ctx, img, w, h, zoom, panX, panY);
    } else {
      /* 程序化灰板兜底:图片缺失/未就绪时的占位场景。 */
      const opts = visualOptions(frame);
      const fm = motionFor(type);
      const zoom = 1 + finite(opts.zoom, fm.zoom) * t;
      const panX = finite(opts.panX, fm.x) * w * (t - 0.5);
      const panY = finite(opts.panY, fm.y) * h * (t - 0.5);
      ctx.imageSmoothingEnabled = false;
      drawBase(ctx, w, h, type, frame, t);

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-w / 2 + panX, -h / 2 + panY);
      const drawer = VISUAL_DRAWERS[type] || drawUnknown;
      drawer(ctx, w, h, t, frame);
      ctx.restore();
    }

    const sandStrength = toneName(frame).indexOf('quiet') >= 0 ? 0.15 : 0.55;
    drawSandEffect(ctx, w, h, type, sandStrength);
    drawSignalEffect(ctx, w, h, type, frame, motion && motion.glitch ? 0.3 : 0);
    drawVignette(ctx, w, h, frame);
    drawLetterbox(ctx, w, h);
    drawChapterText(ctx, w, h, frame, type);
    drawDialogue(ctx, w, h, frame);
    drawProgress(ctx, w, h);
    drawSkipButton(ctx, w, h);

    const fade = Math.min(1, frameElapsed / FADE_TIME, (duration - frameElapsed) / FADE_TIME);
    if (fade < 1) {
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - Math.max(0, fade)).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
    return true;
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

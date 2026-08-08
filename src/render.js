/* 渲染:低分辨率离屏画布画场景(地形剔除 + 画家算法深度排序),像素化放大到主画布。
 * M4:标题屏/胜负结算/波次警报。精修:滚轮与双指缩放、探索式小地图(默认全黑)、
 * 士兵跑动帧(素材存在时)、矿车满载造型切换。 */
(function (RS) {
  'use strict';

  const render = RS.render = {
    init, frame, scene: null, sctx: null, fps: 0,
    worldToClient, clientToWorld, paletteHit, prodHit, unitActionHit, buildingActionHit, titleHit, titleLogoHit,
    fieldGuideHit, guideTerminalHit, endHit, minimapHit, tutorialHit, powerStatus, fireModeHit,
    paletteRects: [], prodRects: [], unitActionRect: null, buildingActionRect: null, titleRects: [],
    fireModeRect: null,
    deepMineGuideSpots: [],
    tutorialPanelRect: null, tutorialActionRect: null, tutorialSkipRect: null,
    endActionRect: null, titleLogoRect: null, fieldGuideRects: [],
  };
  let main, mctx, W = 0, H = 0, W2 = 0, H2 = 0, fpsEma = 60, lastS = 0;
  const smokes = [];
  let smokeTimer = 0;
  let deepMineGuideUnit = null, deepMineGuideAt = -1, deepMineGuideCache = [];

  const PALETTE_TYPES = ['power', 'refinery', 'barracks', 'factory', 'turret'];
  const MM = { size: 160, x: 0, y: 44, scale: 1 }; // 小地图布局
  // 本文件多个函数已有局部变量 t(地块/教学对象),翻译函数改用别名 tStr/tfStr
  const tStr = RS.i18n.t;
  const tfStr = RS.i18n.tf;

  function init(canvas) {
    main = canvas;
    mctx = main.getContext('2d');
    render.scene = document.createElement('canvas');
    render.sctx = render.scene.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function effS() { return RS.config.RENDER_SCALE / (RS.camera.zoom || 1); }

  function resize() {
    // 不乘 devicePixelRatio 是有意取舍:像素风低分辨率离屏 + 合成器放大,高清屏保持颗粒感且省性能
    W = main.width = window.innerWidth;
    H = main.height = window.innerHeight;
    const s = effS();
    W2 = render.scene.width = Math.max(2, Math.floor(W * s));
    H2 = render.scene.height = Math.max(2, Math.floor(H * s));
  }

  function worldToClient(wx, wy) {
    const s = effS();
    const p = RS.iso.toScreen(wx, wy);
    return { x: (p.x - RS.camera.x) / s + W / 2, y: (p.y - RS.camera.y) / s + H / 2 };
  }
  function clientToWorld(cx, cy) {
    const s = effS();
    return RS.iso.toWorld((cx - W / 2) * s + RS.camera.x, (cy - H / 2) * s + RS.camera.y);
  }

  // 迷雾判定:seen = 历史探索过;vis = 当前视野内(迷雾数据未就绪时全可见)
  function seenAt(wx, wy) {
    const V = RS.map.visited;
    if (!V) return true;
    const t = RS.iso.tileOf(wx, wy);
    return t.i >= 0 && t.j >= 0 && t.i < RS.config.MAP_W && t.j < RS.config.MAP_H && V[t.j * RS.config.MAP_W + t.i] === 1;
  }
  function visAt(wx, wy) {
    const N = RS.map.visible;
    if (!N) return true;
    const t = RS.iso.tileOf(wx, wy);
    return t.i >= 0 && t.j >= 0 && t.i < RS.config.MAP_W && t.j < RS.config.MAP_H && N[t.j * RS.config.MAP_W + t.i] === 1;
  }

  function hash(a, b) { let h = (a * 374761393 + b * 668265263) ^ 0x5bf03635; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

  function diaPath(x2, sx, sy) {
    x2.beginPath();
    x2.moveTo(sx, sy - 16); x2.lineTo(sx + 32, sy); x2.lineTo(sx, sy + 16); x2.lineTo(sx - 32, sy);
    x2.closePath();
  }

  function drawGround(sx, sy, t, i, j) {
    const S = RS.sprites.tiles;
    const x2 = render.sctx;
    const V = RS.map.visited, N = RS.map.visible;
    const seen = !V || V[j * RS.config.MAP_W + i]; // 历史探索过
    const vis = !N || N[j * RS.config.MAP_W + i];  // 当前在视野内
    if (t.ore > 0 && seen) { // 未探索矿区/特殊物不画造型(否则骸骨等大贴图伸出迷雾黑格)
      const sp = t.sp && RS.sprites.props && RS.sprites.props[t.sp];
      if (sp) { // 特殊物(骸骨/晶簇)有专属造型
        x2.drawImage(sp.canvas, sx - sp.ax, sy - sp.ay);
      } else {
        const level = t.ore > 200 ? 2 : t.ore > 100 ? 1 : 0;
        const s = S.ore[level];
        x2.drawImage(s.canvas, sx - s.ax, sy - s.ay);
      }
      if (vis) for (let k = 0; k < 2; k++) {
        const h1 = hash(i * 7 + k * 13, j * 11);
        const phase = (RS.game.time * 1.4 + h1 * 6) % 2.6;
        if (phase < 0.35) {
          const px = sx + (hash(i * 3 + k, j * 5) - 0.5) * 34;
          const py = sy - 4 + (hash(i * 13 + k, j * 7) - 0.5) * 12;
          x2.globalAlpha = 1 - phase / 0.35;
          x2.fillStyle = '#e6f7ff';
          const r = 1 + (k === 0 ? 1 : 0);
          x2.fillRect(px - r, py, r * 2 + 1, 1);
          x2.fillRect(px, py - r, 1, r * 2 + 1);
          x2.globalAlpha = 1;
        }
      }
    } else {
      const s = S.sand[t.v];
      x2.drawImage(s.canvas, sx - s.ax, sy - s.ay);
      if (t.d > 0 && seen) {
        const d = RS.sprites.decor[(t.d - 1) % RS.sprites.decor.length];
        x2.drawImage(d.canvas, sx - d.ax, sy - d.ay);
      }
    }
    // 战争迷雾:未探索 = 黑屏;探索过但不在视野 = 压暗
    if (!seen) { x2.fillStyle = '#050302'; diaPath(x2, sx, sy); x2.fill(); }
    else if (!vis) { x2.fillStyle = 'rgba(5,3,2,0.5)'; diaPath(x2, sx, sy); x2.fill(); }
  }

  function frame(dtReal) {
    const sNow = effS();
    if (sNow !== lastS) { lastS = sNow; resize(); } // 缩放变化 → 重算离屏尺寸

    fpsEma += (1 / Math.max(dtReal, 1e-4) - fpsEma) * 0.05;
    render.fps = Math.round(fpsEma);

    const cam = RS.camera, x2 = render.sctx;
    x2.setTransform(1, 0, 0, 1, 0, 0);
    x2.fillStyle = '#2a160e';
    x2.fillRect(0, 0, W2, H2);
    x2.translate(Math.round(W2 / 2 - cam.x), Math.round(H2 / 2 - cam.y));

    const vx0 = cam.x - W2 / 2 - 80, vx1 = cam.x + W2 / 2 + 80;
    const vy0 = cam.y - H2 / 2 - 80, vy1 = cam.y + H2 / 2 + 80;

    // 地形
    const MW = RS.config.MAP_W, MH = RS.config.MAP_H;
    const p = { x: 0, y: 0 };
    for (let j = 0; j < MH; j++) {
      for (let i = 0; i < MW; i++) {
        RS.iso.toScreen(i + 0.5, j + 0.5, p);
        if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
        drawGround(p.x, p.y, RS.map.tiles[j][i], i, j);
      }
    }
    drawDeepMineGuide(x2);

    // 实体:岩石 + 建筑 + 单位,按 (x+y) 画家算法排序
    const ents = [];
    // 战痕(弹坑/焦痕,画在实体之下)
    for (const sc of (RS.game.scars || [])) {
      if (!seenAt(sc.x, sc.y)) continue;
      RS.iso.toScreen(sc.x, sc.y, p);
      const a = 0.5 * (1 - sc.t / sc.dur);
      if (RS.sprites.scars) {
        const si = RS.sprites.scars[sc.v % RS.sprites.scars.length];
        const w = si.canvas.width * sc.r / 1.6, h = si.canvas.height * sc.r / 1.6;
        x2.globalAlpha = Math.min(1, a * 2);
        x2.drawImage(si.canvas, p.x - w / 2, p.y - h / 2, w, h);
        x2.globalAlpha = 1;
      } else {
        x2.fillStyle = 'rgba(30,16,10,' + a.toFixed(3) + ')';
        x2.beginPath();
        x2.ellipse(p.x, p.y, sc.r * 14, sc.r * 7, 0, 0, Math.PI * 2);
        x2.fill();
      }
    }
    for (const r of RS.map.rockTiles) {
      if (!seenAt(r.i + 0.5, r.j + 0.5)) continue; // 岩石也在迷雾下
      RS.iso.toScreen(r.i + 0.5, r.j + 0.5, p);
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      ents.push({ key: r.i + r.j + 1, kind: 'rock', sx: p.x, sy: p.y, v: RS.map.tiles[r.j][r.i].v });
    }
    for (const b of RS.game.buildings) {
      if (b.owner === 'enemy' && !seenAt(b.cx, b.cy)) continue; // 敌方建筑:探索过才显形
      RS.iso.toScreen(b.cx, b.cy, p);
      if (p.x < vx0 - 120 || p.x > vx1 + 120 || p.y < vy0 - 200 || p.y > vy1 + 80) continue; // 视口剔除(建筑精灵向上延伸,上边距留足)
      ents.push({ key: b.cx + b.cy, kind: 'building', sx: p.x, sy: p.y, b });
    }
    for (const d of (RS.game.derelicts || [])) {
      if (!seenAt(d.x, d.y) && !(d.isRelic && d.revealed)) continue; // 坠毁无人机:探索过才显形;遗迹明牌后恒可见
      RS.iso.toScreen(d.x, d.y, p);
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue; // 视口剔除
      ents.push({ key: d.x + d.y + 0.5, kind: 'derelict', sx: p.x, sy: p.y, d });
    }
    const terminal = RS.game.guideTerminal;
    if (terminal && seenAt(terminal.x, terminal.y)) {
      RS.iso.toScreen(terminal.x, terminal.y, p);
      if (p.x >= vx0 && p.x <= vx1 && p.y >= vy0 - 80 && p.y <= vy1)
        ents.push({ key: terminal.x + terminal.y + 0.25, kind: 'guideTerminal', sx: p.x, sy: p.y, terminal });
    }
    for (const u of RS.game.units) {
      if (u.owner === 'enemy' && !visAt(u.x, u.y)) continue; // 敌方单位:视野内才可见
      RS.iso.toScreen(u.x, u.y, p);
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 - 60 || p.y > vy1) continue; // 视口剔除(血条/炮管向上延伸)
      ents.push({ key: u.x + u.y, kind: 'unit', sx: p.x, sy: p.y, u });
    }
    ents.sort((a, b) => a.key - b.key);

    const hov = computeHover();

    for (const e of ents) {
      if (e.kind === 'rock') {
        const s = RS.sprites.rock[e.v % RS.sprites.rock.length];
        x2.drawImage(s.canvas, e.sx - s.ax, e.sy - s.ay);
      } else if (e.kind === 'building') {
        const bset = (e.b.owner === 'enemy' && RS.sprites.enemy && RS.sprites.enemy.buildings[e.b.type])
          ? RS.sprites.enemy.buildings : RS.sprites.buildings;
        const s = bset[e.b.type];
        if (e.b.done) {
          if (e.b.type === 'turret') drawTurretAim(x2, e.b, s, e.sx, e.sy);
          else x2.drawImage(s.canvas, e.sx - s.ax, e.sy - s.ay);
          if (e.b.owner !== 'enemy') drawBuildingFx(x2, s, e.sx, e.sy);
          if (e.b.repairFxT > 0) drawRepairFx(x2, e.sx, e.sy - 18);
          else if (e.b.selfRepairFxT > 0) drawRepairFx(x2, e.sx, e.sy - 18, '#4fc3f7');
        } else {
          const ratio = e.b.def.buildTime ? e.b.progress / e.b.def.buildTime : 1;
          x2.globalAlpha = 0.35 + 0.45 * ratio;
          x2.drawImage(s.canvas, e.sx - s.ax, e.sy - s.ay);
          x2.globalAlpha = 1;
          const bw = 44, bx = e.sx - bw / 2, by = e.sy - s.ay - 8;
          x2.fillStyle = '#33383d'; x2.fillRect(bx, by, bw, 5);
          x2.fillStyle = '#5ad06e'; x2.fillRect(bx, by, bw * ratio, 5);
          x2.strokeStyle = 'rgba(0,0,0,0.5)'; x2.lineWidth = 1;
          x2.strokeRect(bx + 0.5, by + 0.5, bw - 1, 4);
        }
        if (e.b.hp < e.b.maxHp) drawHpBar(x2, e.sx, e.sy - s.ay - 4, 36, e.b.hp / e.b.maxHp);
        if (e.b.type === 'deepMine') {
          if (!e.b.deepPowered) {
            x2.fillStyle = 'rgba(224,76,58,0.78)';
            x2.fillRect(e.sx - 10, e.sy - 46, 20, 3);
          } else if (e.b.incomeFxT > 0) {
            x2.globalAlpha = Math.min(1, e.b.incomeFxT * 1.8);
            x2.fillStyle = '#7dff9a';
            x2.font = 'bold 11px monospace';
            x2.fillText('+$' + (e.b.deepPayout || 0), e.sx - 12, e.sy - 52 - (1 - e.b.incomeFxT) * 8);
            x2.globalAlpha = 1;
          }
        }
        if (hov.building === e.b) drawFootprintOutline(x2, e.b, 'rgba(255,255,255,0.55)');
        if (RS.game.buildingSel === e.b) drawFootprintOutline(x2, e.b, 'rgba(46,127,217,0.95)');
      } else if (e.kind === 'derelict') {
        if (e.d.isRelic && RS.sprites.relic) { // 遗迹:中立残骸 + 双方修理进度条
          const s = RS.sprites.relic;
          x2.drawImage(s.canvas, e.sx - s.ax, e.sy - s.ay);
          const need = RS.config.storm.repairSeconds;
          if (e.d.pools.player > 0) drawHpBar(x2, e.sx, e.sy - 30, 30, Math.min(1, e.d.pools.player / need));
          if (e.d.pools.enemy > 0) drawHpBar(x2, e.sx, e.sy - 36, 30, Math.min(1, e.d.pools.enemy / need));
        } else {
          const s = RS.sprites.props && RS.sprites.props.drone;
          if (s) x2.drawImage(s.canvas, e.sx - s.ax, e.sy - s.ay);
          if (e.d.hp > 0) drawHpBar(x2, e.sx, e.sy - 28, 24, e.d.hp / e.d.maxHp);
        }
      } else if (e.kind === 'guideTerminal') {
        const s = RS.sprites.guideTerminal;
        if (s) x2.drawImage(s.canvas, e.sx - s.ax, e.sy - s.ay);
        if (hov.guideTerminal) {
          const pulse = 0.65 + Math.sin(RS.game.time * 5) * 0.2;
          x2.strokeStyle = 'rgba(79,195,247,' + pulse.toFixed(2) + ')';
          x2.lineWidth = 2;
          x2.beginPath(); x2.ellipse(e.sx, e.sy + 2, 22, 10, 0, 0, Math.PI * 2); x2.stroke();
        }
      } else {
        drawUnit(x2, e.u, e.sx, e.sy);
        if (hov.unit === e.u && !RS.game.selection.has(e.u)) {
          x2.strokeStyle = 'rgba(255,255,255,0.7)';
          x2.lineWidth = 1;
          x2.beginPath();
          x2.ellipse(e.sx, e.sy + 4, 12, 6, 0, 0, Math.PI * 2);
          x2.stroke();
        }
      }
    }

    // 弹道(迷雾规则:只画当前可见区域内的)
    const mw2 = RS.config.MAP_W;
    const fogVis = (wx, wy) => RS.map.visible && RS.map.visible[Math.floor(wy) * mw2 + Math.floor(wx)];
    for (const pr of RS.combat.projectiles) {
      const k = Math.min(1, pr.t / pr.dur);
      const wx = pr.x + (pr.tx - pr.x) * k, wy = pr.y + (pr.ty - pr.y) * k;
      if (!fogVis(wx, wy)) continue;
      RS.iso.toScreen(wx, wy, p);
      if (pr.kind === 'flame') {
        const from = RS.iso.toScreen(pr.x, pr.y);
        const wobble = Math.sin((pr.t + pr.x + pr.y) * 38) * 2;
        x2.lineCap = 'round';
        x2.strokeStyle = 'rgba(224,76,58,0.48)';
        x2.lineWidth = 7;
        x2.beginPath(); x2.moveTo(from.x, from.y - 7); x2.lineTo(p.x, p.y - 7 + wobble); x2.stroke();
        x2.strokeStyle = 'rgba(255,210,90,0.92)';
        x2.lineWidth = 3;
        x2.beginPath(); x2.moveTo(from.x, from.y - 7); x2.lineTo(p.x, p.y - 7 + wobble); x2.stroke();
        continue;
      }
      x2.fillStyle = { bullet: '#ffd27d', shell: '#2b2f33', rocket: '#f5a623', arty: '#e04c3a', flame: '#ff8c3a' }[pr.kind] || '#fff';
      const r = pr.kind === 'bullet' ? 1.5 : pr.kind === 'arty' ? 3 : 2.5;
      x2.beginPath(); x2.arc(p.x, p.y - 6, r, 0, Math.PI * 2); x2.fill();
    }

    // 爆炸(同迷雾规则;有 AI 序列帧用序列帧,否则程序化圆环)
    for (const ex of RS.combat.explosions) {
      if (!fogVis(ex.x, ex.y)) continue;
      const k = ex.t / ex.dur;
      RS.iso.toScreen(ex.x, ex.y, p);
      const frames = ex.r > 30 ? RS.sprites.bigExplosion : RS.sprites.explosion;
      if (frames) {
        const img = frames[Math.min(frames.length - 1, Math.floor(k * frames.length))];
        const w = ex.r * 2.6, h = ex.r * 2.6;
        x2.globalAlpha = Math.max(0, 1 - k * 0.7);
        x2.drawImage(img, p.x - w / 2, p.y - h / 2 - 6, w, h);
        x2.globalAlpha = 1;
        continue;
      }
      x2.globalAlpha = Math.max(0, 1 - k);
      if (k < 0.3) {
        x2.fillStyle = '#ffd27d';
        x2.beginPath(); x2.arc(p.x, p.y - 6, ex.r * (0.3 + k), 0, Math.PI * 2); x2.fill();
      }
      x2.strokeStyle = '#e04c3a';
      x2.lineWidth = 3;
      x2.beginPath(); x2.arc(p.x, p.y - 6, ex.r * k, 0, Math.PI * 2); x2.stroke();
      x2.globalAlpha = 1;
    }

    // 指令落点标记(攻击=红,移动=绿)
    for (const mk of RS.game.markers) {
      const age = RS.game.time - mk.t;
      const a = Math.max(0, 1 - age / 0.8);
      RS.iso.toScreen(mk.x, mk.y, p);
      x2.globalAlpha = a;
      x2.strokeStyle = mk.kind === 'attack' ? '#e04c3a' : '#7dff9a';
      x2.lineWidth = 2;
      x2.beginPath();
      x2.ellipse(p.x, p.y, 6 + age * 26, 3 + age * 13, 0, 0, Math.PI * 2);
      x2.stroke();
      x2.beginPath();
      x2.moveTo(p.x - 6, p.y); x2.lineTo(p.x + 6, p.y);
      x2.moveTo(p.x, p.y - 4); x2.lineTo(p.x, p.y + 4);
      x2.stroke();
      x2.globalAlpha = 1;
    }

    drawRally(x2);
    drawGhost(x2);
    updateSmoke(dtReal, x2);

    // 放大输出
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.imageSmoothingEnabled = false;
    mctx.clearRect(0, 0, W, H);
    mctx.drawImage(render.scene, 0, 0, W2, H2, 0, 0, W, H);

    drawDragBox();
    drawHud(hov);
    drawSelectionPanel();
    drawBuildingPanel();
    drawPalette();
    drawProductionPanel();
    drawMinimap();
    drawTutorial();

    if (RS.campaign && RS.campaign.active) RS.campaign.draw(mctx, W, H);
    else if (RS.game.state === 'title') drawTitle();
    else if (RS.game.state === 'won' || RS.game.state === 'lost') drawEnd();
    if (RS.game.guideOpen) drawFieldGuide();
  }

  function drawHpBar(x2, sx, sy, w, ratio) {
    x2.fillStyle = 'rgba(0,0,0,0.55)';
    x2.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 5);
    x2.fillStyle = ratio > 0.6 ? '#5ad06e' : ratio > 0.3 ? '#f5a623' : '#e04c3a';
    x2.fillRect(sx - w / 2, sy, w * Math.max(0, ratio), 3);
  }

  // ---------- 集结点 ----------
  function drawRally(x2) {
    const bs = RS.game.buildingSel;
    if (!bs || !bs.rally) return;
    const a = RS.iso.toScreen(bs.cx, bs.cy), c = RS.iso.toScreen(bs.rally.x, bs.rally.y);
    x2.strokeStyle = 'rgba(125,255,154,0.55)';
    x2.lineWidth = 2;
    x2.setLineDash([6, 5]);
    x2.beginPath(); x2.moveTo(a.x, a.y); x2.lineTo(c.x, c.y); x2.stroke();
    x2.setLineDash([]);
    x2.strokeStyle = '#7dff9a';
    x2.beginPath(); x2.moveTo(c.x, c.y); x2.lineTo(c.x, c.y - 16); x2.stroke();
    x2.fillStyle = '#7dff9a';
    x2.beginPath(); x2.moveTo(c.x, c.y - 16); x2.lineTo(c.x + 12, c.y - 12); x2.lineTo(c.x, c.y - 8); x2.closePath(); x2.fill();
  }

  // 深层钻探车选中提示：已探索且真正可展开的位置，以绿色 2×2 地面框显示。
  function drawDeepMineGuide(x2) {
    render.deepMineGuideSpots = [];
    const selected = [...RS.game.selection];
    if (selected.length !== 1 || selected[0].owner !== 'player' ||
      selected[0].kind !== 'drillRig' || selected[0].hp <= 0) {
      deepMineGuideUnit = null;
      deepMineGuideCache = [];
      return;
    }
    if (deepMineGuideUnit !== selected[0] || RS.game.time >= deepMineGuideAt) {
      deepMineGuideUnit = selected[0];
      deepMineGuideAt = RS.game.time + 0.35;
      deepMineGuideCache = RS.game.deepMineSites('player', true, selected[0]);
    }
    const sites = deepMineGuideCache;
    render.deepMineGuideSpots = sites;
    const pulse = 0.32 + (Math.sin(RS.game.time * 4) + 1) * 0.08;
    const p = { x: 0, y: 0 };
    x2.save();
    x2.font = 'bold 11px monospace';
    x2.textAlign = 'center';
    x2.textBaseline = 'bottom';
    for (const site of sites) {
      x2.fillStyle = 'rgba(55,255,116,' + pulse.toFixed(2) + ')';
      for (let y = site.j; y < site.j + site.m; y++)
        for (let x = site.i; x < site.i + site.n; x++) {
          RS.iso.toScreen(x + 0.5, y + 0.5, p);
          diaPath(x2, p.x, p.y);
          x2.fill();
        }
      drawFootprintOutline(x2, site, 'rgba(125,255,154,0.98)');
      RS.iso.toScreen(site.cx, site.cy, p);
      x2.fillStyle = '#b8ffca';
      x2.fillText(tfStr('可展开  +${p}/分', { p: site.perMinute }), p.x, p.y - 20);
    }
    x2.restore();
  }

  // ---------- 幽灵放置预览 ----------
  function drawGhost(x2) {
    const type = RS.input.buildMode;
    if (!type || !RS.input.mouse.inside) return;
    const def = RS.config.buildings[type];
    const m = RS.input.mouse;
    const w = clientToWorld(m.x, m.y);
    const t = RS.iso.tileOf(w.x, w.y);
    const i = t.i - Math.floor(def.n / 2), j = t.j - Math.floor(def.m / 2);
    const ok = RS.game.canPlace(type, i, j) && RS.game.money >= def.cost;
    const p = { x: 0, y: 0 };
    x2.globalAlpha = 0.3;
    x2.fillStyle = ok ? '#7dff9a' : '#e04c3a';
    for (let y = j; y < j + def.m; y++) for (let x = i; x < i + def.n; x++) {
      RS.iso.toScreen(x + 0.5, y + 0.5, p);
      x2.beginPath();
      x2.moveTo(p.x, p.y - 16); x2.lineTo(p.x + 32, p.y); x2.lineTo(p.x, p.y + 16); x2.lineTo(p.x - 32, p.y);
      x2.closePath(); x2.fill();
    }
    x2.globalAlpha = 1;
    const s = RS.sprites.buildings[type];
    RS.iso.toScreen(i + def.n / 2, j + def.m / 2, p);
    x2.globalAlpha = 0.55;
    if (s) x2.drawImage(s.canvas, p.x - s.ax, p.y - s.ay); // 素材缺失时只画占地预览,不崩
    x2.globalAlpha = 1;
  }

  // ---------- 建筑动态 ----------
  function drawBuildingFx(x2, s, sx, sy) {
    if (s.beacon && (RS.game.time % 1.4) < 0.7) {
      const bx = sx + s.beacon.dx, by = sy + s.beacon.dy;
      x2.fillStyle = 'rgba(245,166,35,0.35)';
      x2.beginPath(); x2.arc(bx, by, 6, 0, Math.PI * 2); x2.fill();
      x2.fillStyle = '#ffd27d';
      x2.beginPath(); x2.arc(bx, by, 2.5, 0, Math.PI * 2); x2.fill();
    }
    if (s.radar) {
      const ang = RS.game.time * 1.6;
      x2.strokeStyle = 'rgba(125,255,154,0.85)';
      x2.lineWidth = 1.5;
      x2.beginPath();
      x2.moveTo(sx + s.radar.dx, sy + s.radar.dy);
      x2.lineTo(sx + s.radar.dx + Math.cos(ang) * 12, sy + s.radar.dy + Math.sin(ang) * 6);
      x2.stroke();
    }
  }

  // ---------- 烟雾粒子 ----------
  function updateSmoke(dt, x2) {
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smokeTimer = 0.35;
      for (const b of RS.game.buildings) {
        if (b.type !== 'refinery' || !b.done || b.owner !== 'player') continue;
        const spr = RS.sprites.buildings[b.type];
        if (!spr || !spr.smoke) continue;
        const off = spr.smoke[Math.floor(Math.random() * spr.smoke.length)];
        const sp = RS.iso.toScreen(b.cx, b.cy);
        smokes.push({ x: sp.x + off.dx, y: sp.y + off.dy, r: 3, life: 1.6, max: 1.6 });
        if (smokes.length > 60) smokes.shift();
      }
    }
    for (let k = smokes.length - 1; k >= 0; k--) {
      const s = smokes[k];
      s.y -= 14 * dt; s.r += 5 * dt; s.life -= dt;
      if (s.life <= 0) { smokes.splice(k, 1); continue; }
      x2.fillStyle = 'rgba(190,190,195,' + (0.3 * s.life / s.max).toFixed(3) + ')';
      x2.beginPath(); x2.arc(s.x, s.y, s.r, 0, Math.PI * 2); x2.fill();
    }
  }

  function drawFootprintOutline(x2, b, color) {
    const c1 = RS.iso.toScreen(b.i, b.j), c2 = RS.iso.toScreen(b.i + b.n, b.j);
    const c3 = RS.iso.toScreen(b.i + b.n, b.j + b.m), c4 = RS.iso.toScreen(b.i, b.j + b.m);
    x2.strokeStyle = color; x2.lineWidth = 2;
    x2.beginPath();
    x2.moveTo(c1.x, c1.y); x2.lineTo(c2.x, c2.y); x2.lineTo(c3.x, c3.y); x2.lineTo(c4.x, c4.y);
    x2.closePath(); x2.stroke();
  }

  // 炮塔渲染:45°等距素材不能像俯视图那样整张自由旋转，否则炮尾会在上下方向“竖起来”。
  // 正常路径使用完整 fr/br 等距方向帧；分层底座只在方向帧缺失时作静态兼容兜底。
  function drawTurretAim(x2, b, fallback, sx, sy) {
    const pivotY = sy - 32; // 与 96px 底座中央转盘的屏幕高度对齐
    const faction = b.owner === 'enemy' ? 'enemy' : 'player';
    const aim = b.aim === undefined ? 0 : b.aim;
    const dir = b.aimDir !== undefined ? b.aimDir : RS.iso.dir8(Math.cos(aim), Math.sin(aim));
    const set = RS.sprites.turretAim && RS.sprites.turretAim[faction];
    const base = RS.sprites.turretBase && RS.sprites.turretBase[faction];
    if (set && set[dir]) {
      const s2 = set[dir];
      x2.drawImage(s2.canvas, sx - s2.ax, sy - s2.ay);
    } else if (base) {
      x2.drawImage(base.canvas, sx - base.ax, sy - base.ay);
      // 分层素材不再旋转：缺少完整方向帧时用矢量炮管指示瞄准方向，避免破坏等距透视。
      const p2 = RS.iso.toScreen(b.cx + Math.cos(aim) * 1.3, b.cy + Math.sin(aim) * 1.3);
      x2.strokeStyle = '#20242a';
      x2.lineWidth = 3;
      x2.beginPath();
      x2.moveTo(sx, pivotY);
      x2.lineTo(p2.x, p2.y - 32);
      x2.stroke();
    } else {
      x2.drawImage(fallback.canvas, sx - fallback.ax, sy - fallback.ay);
    }
    if (b.muzzleT > 0) {
      const mp = RS.iso.toScreen(b.cx + Math.cos(aim) * 1.35, b.cy + Math.sin(aim) * 1.35);
      x2.globalAlpha = Math.min(1, b.muzzleT / 0.08);
      x2.fillStyle = '#ffd27d';
      x2.beginPath();
      x2.arc(mp.x, mp.y - 32, 4 + b.muzzleT * 20, 0, Math.PI * 2);
      x2.fill();
      x2.globalAlpha = 1;
    }
  }

  function drawRepairFx(x2, sx, sy, color) {
    x2.globalAlpha = 0.65 + 0.35 * Math.sin(RS.game.time * 18);
    x2.strokeStyle = color || '#7dff9a';
    x2.lineWidth = 2;
    x2.beginPath(); x2.arc(sx, sy, 7, 0, Math.PI * 2); x2.stroke();
    x2.beginPath();
    x2.moveTo(sx - 4, sy); x2.lineTo(sx + 4, sy);
    x2.moveTo(sx, sy - 4); x2.lineTo(sx, sy + 4);
    x2.stroke();
    x2.globalAlpha = 1;
  }

  function drawUnit(x2, u, sx, sy) {
    const isInf = u.kind === 'infantry' || u.kind === 'rocket';
    const isAir = !!RS.units.TYPES[u.kind].air;
    if (isInf) {
      x2.fillStyle = 'rgba(20,8,4,0.3)';
      x2.beginPath(); x2.ellipse(sx, sy + 4, 8, 4, 0, 0, Math.PI * 2); x2.fill();
    } else {
      const sh = RS.sprites.shadow;
      x2.drawImage(sh.canvas, sx - sh.ax, sy - sh.ay + 6);
    }
    if (RS.game.selection.has(u)) {
      x2.strokeStyle = '#7dff9a';
      x2.lineWidth = 2;
      x2.beginPath();
      x2.ellipse(sx, sy + 4, isInf ? 10 : 18, isInf ? 5 : 9, 0, 0, Math.PI * 2);
      x2.stroke();
    }
    const isEnemy = u.owner === 'enemy' && RS.sprites.enemy;
    const uset = isEnemy ? RS.sprites.enemy.units : RS.sprites.units;
    let idx = u.dir;
    if (u.kind === 'harvester' && u.load > RS.config.harvester.capacity / 2 && uset.harvester && uset.harvester.length > 8) idx += 8;
    // 士兵跑动帧:移动中按相位切帧 + 身体起伏摆动(单帧也有"一二一"感)
    const walkSet = isEnemy ? RS.sprites.enemy.unitsWalk : RS.sprites.unitsWalk;
    let spr, sway = 0, walkLift = 0;
    if (isInf && u.path && u.path.length && walkSet && walkSet[u.kind]) {
      const ph = RS.game.time * 7;
      spr = walkSet[u.kind][Math.floor(ph) % 3][idx];
      sway = Math.sin(ph * 2.1) * 1.2;
      walkLift = Math.abs(Math.sin(ph * 2.1)) * 1.6;
    } else {
      spr = ((uset[u.kind] || RS.sprites.units[u.kind]) || [])[idx]; // 缺敌方精灵退回我方,再缺走色块
    }
    const bob = u.state === 'harvest' ? Math.round(Math.sin(RS.game.time * 18) * 1.5) : 0;
    const airLift = isAir ? 18 + Math.sin(RS.game.time * 5 + u.x) * 2 : 0;
    if (spr) x2.drawImage(spr.canvas, sx - spr.ax + sway, sy - spr.ay + bob - walkLift - airLift);
    else { // 终极兜底:色块(任何素材缺失都不让主循环崩)
      x2.fillStyle = u.owner === 'enemy' ? '#e07a3a' : '#6ab7e0';
      x2.fillRect(sx - 7, sy - 14 - airLift, 14, 14);
    }
    // 采矿火花(钻头碎屑,14Hz 闪烁)
    if (u.state === 'harvest') {
      const ph = Math.floor(RS.game.time * 14);
      for (let k = 0; k < 3; k++) {
        const hx = sx + (((ph * 7 + k * 13) % 9) - 4);
        const hy = sy - 6 - ((ph * 5 + k * 7) % 7);
        x2.fillStyle = k % 2 ? '#ffd27d' : '#e6f7ff';
        x2.fillRect(hx, hy, 2, 2);
      }
    }
    // 卸矿闪光(青色脉冲)
    if (u.state === 'unload') {
      x2.globalAlpha = 0.5 + 0.5 * Math.sin(RS.game.time * 12);
      x2.fillStyle = '#4fc3f7';
      x2.fillRect(sx - 3, sy - 20, 6, 3);
      x2.globalAlpha = 1;
    }
    // 维修光束
    if (u.kind === 'repair' && u.repTarget) {
      const tx = u.repTarget.cx !== undefined ? u.repTarget.cx : u.repTarget.x;
      const ty = u.repTarget.cy !== undefined ? u.repTarget.cy : u.repTarget.y;
      const lift = u.repTarget.cx !== undefined ? 18 : 8;
      const tp = RS.iso.toScreen(tx, ty);
      x2.strokeStyle = 'rgba(125,255,154,0.88)';
      x2.lineWidth = 2.5;
      x2.beginPath(); x2.moveTo(sx, sy - 12); x2.lineTo(tp.x, tp.y - lift); x2.stroke();
    }
    if (u.repairFxT > 0) drawRepairFx(x2, sx, sy - 14);
    if (u.hp < u.maxHp)
      drawHpBar(x2, sx, sy - (isAir ? 52 : (isInf ? 26 : 30)), 22, u.hp / u.maxHp);
  }

  // ---------- 悬停 ----------
  function computeHover() {
    const m = RS.input.mouse;
    const out = { unit: null, building: null, name: null };
    if (RS.game.guideOpen) { main.style.cursor = 'default'; return out; }
    if (RS.input.buildMode) { main.style.cursor = 'crosshair'; return out; }
    if (!m.inside || RS.input.selectBox || RS.input.dragging) { main.style.cursor = 'default'; return out; }
    const mw = RS.config.MAP_W;
    const visAt = (wx, wy) => !!(RS.map.visible && RS.map.visible[Math.floor(wy) * mw + Math.floor(wx)]);   // 当前可见
    const seenAt = (wx, wy) => !!(RS.map.visited && RS.map.visited[Math.floor(wy) * mw + Math.floor(wx)]); // 探索过
    const w = clientToWorld(m.x, m.y);
    out.unit = RS.game.pickUnitAt(w.x, w.y);
    // 迷雾防窥:敌情只有视野内才报;建筑/残骸要探索过才报
    if (out.unit && out.unit.owner === 'enemy' && !visAt(out.unit.x, out.unit.y)) out.unit = null;
    out.building = out.unit ? null : RS.game.pickBuildingAt(w.x, w.y);
    if (out.building && out.building.owner === 'enemy' && !seenAt(out.building.cx, out.building.cy)) out.building = null;
    if (!out.unit && !out.building) {
      for (const d of (RS.game.derelicts || []))
        if (Math.hypot(d.x - w.x, d.y - w.y) < 0.9 && seenAt(d.x, d.y)) { out.derelict = d; break; }
    }
    const terminal = RS.game.guideTerminal;
    if (!out.unit && !out.building && !out.derelict && terminal &&
      Math.hypot(terminal.x - w.x, terminal.y - w.y) < 1.0 &&
      seenAt(terminal.x, terminal.y)) out.guideTerminal = terminal;
    if (out.unit) out.name = (out.unit.owner === 'enemy' ? tStr('敌方·') : '') + tStr(RS.units.TYPES[out.unit.kind].name);
    else if (out.building) out.name = (out.building.owner === 'enemy' ? tStr('敌方·') : '') + tStr(RS.config.buildings[out.building.type].name);
    else if (out.derelict) out.name = out.derelict.isRelic ? tStr('遗迹：破损的远古机甲（维修车修复后激活）') : tStr('坠毁无人机（仅维修车可修复为战斗无人机）');
    else if (out.guideTerminal) out.name = tStr('废弃战地档案终端 · 左键查看图鉴');
    main.style.cursor = (out.unit || out.building || out.derelict || out.guideTerminal) ? 'pointer' : 'default';
    return out;
  }

  function guideTerminalHit(cx, cy) {
    const terminal = RS.game.guideTerminal;
    if (!terminal || RS.game.state !== 'playing' || RS.game.guideOpen ||
      !seenAt(terminal.x, terminal.y)) return false;
    const w = clientToWorld(cx, cy);
    return Math.hypot(terminal.x - w.x, terminal.y - w.y) < 1.0;
  }

  function drawDragBox() {
    const b = RS.input.selectBox;
    if (!b) return;
    mctx.strokeStyle = '#7dff9a';
    mctx.lineWidth = 1;
    mctx.setLineDash([4, 3]);
    mctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    mctx.setLineDash([]);
  }

  // ---------- HUD ----------
  function drawMoneyIcon(x, y) {
    mctx.fillStyle = '#4fc3f7';
    mctx.beginPath(); mctx.moveTo(x + 6, y); mctx.lineTo(x + 11, y + 5); mctx.lineTo(x + 9, y + 12); mctx.lineTo(x + 3, y + 12); mctx.lineTo(x + 1, y + 5); mctx.closePath(); mctx.fill();
    mctx.fillStyle = '#e6f7ff';
    mctx.beginPath(); mctx.moveTo(x + 6, y); mctx.lineTo(x + 11, y + 5); mctx.lineTo(x + 6, y + 7); mctx.closePath(); mctx.fill();
  }

  function powerStatus(owner) {
    const supply = RS.game.powerSupply(owner);
    const used = RS.game.powerUsed(owner);
    const balance = supply - used;
    const low = balance < 0;
    return {
      supply, used, balance, low,
      label: low ? tfStr('电力 供{s} 用{u} 缺{d}', { s: supply, u: used, d: -balance })
        : tfStr('电力 供{s} 用{u} 余{b}', { s: supply, u: used, b: balance }),
      detail: low ? tStr('电力不足：施工/生产速度 -50% · 防御炮塔停摆 · 深层开采站停产 · 请建太阳能电站')
        : tStr('电网正常；缺电时施工/生产速度 -50%，防御炮塔停摆，深层开采站停产'),
    };
  }

  function drawHud(hov) {
    // 沙暴加剧:全屏漂移沙雾(AI 沙雾纹理优先,否则程序化沙条)
    if (RS.game.suddenDeath) {
      if (RS.sprites.sandOverlay) {
        const img = RS.sprites.sandOverlay;
        const ox = -((RS.game.time * 30) % img.width), oy = -((RS.game.time * 9) % img.height);
        mctx.globalAlpha = 0.22;
        for (let ty = oy; ty < H; ty += img.height)
          for (let tx = ox; tx < W; tx += img.width) mctx.drawImage(img, tx, ty);
        mctx.globalAlpha = 1;
      } else {
        const tt = RS.game.time * 60;
        mctx.fillStyle = 'rgba(180,100,60,0.06)';
        mctx.fillRect(0, 0, W, H);
        for (let k = 0; k < 24; k++) {
          const dx = ((k * 137 + tt * (1 + (k % 3) * 0.4)) % (W + 120)) - 60;
          const dy = (k * 89 + tt * 0.35) % (H + 40) - 20;
          mctx.fillStyle = 'rgba(216,138,90,0.10)';
          mctx.fillRect(dx, dy, 46 + (k % 4) * 22, 2);
        }
      }
    }
    const compact = W < 640;
    mctx.font = (compact ? 12 : 16) + 'px monospace';
    mctx.textBaseline = 'top';
    mctx.fillStyle = 'rgba(20,10,6,0.72)';
    mctx.fillRect(0, 0, W, 34);
    mctx.fillStyle = '#2e7fd9';
    mctx.fillRect(0, 33, W, 2);
    drawMoneyIcon(10, 9);
    mctx.fillStyle = '#ffd27d';
    mctx.fillText(tfStr('资金 {m}', { m: RS.game.money }), 28, 9);
    const ps = powerStatus();
    const powerX = compact ? 112 : 164;
    mctx.fillStyle = ps.low ? 'rgba(224,76,58,0.48)' : 'rgba(46,127,217,0.34)';
    mctx.fillRect(powerX - 6, 4, compact ? 132 : 174, 26);
    mctx.fillStyle = ps.low ? '#fff0c2' : '#bdeaff';
    mctx.fillText(ps.label, powerX, 9);
    mctx.fillStyle = '#9fd8ef';
    const sel = RS.game.selection.size;
    mctx.fillText(sel ? tfStr('已选 {n} 个单位', { n: sel }) : (RS.game.buildingSel ? tfStr('已选建筑:{name}', { name: tStr(RS.config.buildings[RS.game.buildingSel.type].name) }) : tStr('未选中单位')), compact ? 250 : 350, 9);
    if (!compact) {
      mctx.fillStyle = '#c98a6a';
      const title = tStr('《红色风暴》') + ' · ' + render.fps + ' fps';
      mctx.fillText(title, W - mctx.measureText(title).width - 14, 9);
    }

    let alertY = 44;
    if (ps.low && RS.game.state === 'playing') {
      const msg = compact ? tStr('!! 缺电：施工/生产 -50% · 炮塔停摆 · 建太阳能电站')
        : '!! ' + ps.detail + ' !!';
      mctx.font = 'bold ' + (compact ? 14 : 17) + 'px monospace';
      const tw = mctx.measureText(msg).width;
      mctx.fillStyle = ((RS.game.time * 2) % 2 < 1) ? 'rgba(128,20,14,0.88)' : 'rgba(83,18,15,0.88)';
      mctx.fillRect(W / 2 - tw / 2 - 12, alertY - 5, tw + 24, 28);
      mctx.fillStyle = '#fff0c2';
      mctx.fillText(msg, W / 2 - tw / 2, alertY);
      alertY += 34;
    }
    if (RS.game.waveWarn && RS.game.time - RS.game.waveWarn < 5) {
      mctx.font = 'bold 20px monospace';
      mctx.fillStyle = ((RS.game.time * 2) % 2 < 1) ? '#e04c3a' : '#ffd27d';
      const warn = tStr('!! 警告:敌方部队正在逼近 !!');
      mctx.fillText(warn, W / 2 - mctx.measureText(warn).width / 2, alertY);
      alertY += 26;
      mctx.font = '16px monospace';
    }
    if (RS.game.suddenDeath && RS.game.state === 'playing') {
      mctx.font = 'bold 16px monospace';
      mctx.fillStyle = '#e04c3a';
      const sd = tStr('沙暴加剧:建筑受到双倍伤害!');
      mctx.fillText(sd, W / 2 - mctx.measureText(sd).width / 2, alertY);
      alertY += 26;
      mctx.font = '16px monospace';
    }
    if (RS.game.hasRefP === false && RS.game.state === 'playing') { // 精炼厂全灭:经济脑死亡必须显性化
      mctx.font = 'bold 18px monospace';
      mctx.fillStyle = ((RS.game.time * 2) % 2 < 1) ? '#e04c3a' : '#ffd27d';
      const nr = tStr('!! 警告:精炼厂全灭,经济中断 !!');
      mctx.fillText(nr, W / 2 - mctx.measureText(nr).width / 2, alertY);
      mctx.font = '16px monospace';
    }
    if (RS.game.notice && RS.game.notice.until > RS.game.time) {
      mctx.font = 'bold 15px monospace';
      const msg = tStr(RS.game.notice.text);
      const tw = mctx.measureText(msg).width;
      mctx.fillStyle = 'rgba(83,18,15,0.9)';
      mctx.fillRect(W / 2 - tw / 2 - 10, alertY - 4, tw + 20, 25);
      mctx.fillStyle = '#fff0c2';
      mctx.fillText(msg, W / 2 - tw / 2, alertY);
    }

    if (hov.name) {
      const m = RS.input.mouse;
      const tw = mctx.measureText(hov.name).width + 16;
      mctx.fillStyle = 'rgba(20,10,6,0.85)';
      mctx.fillRect(m.x + 14, m.y + 12, tw, 24);
      mctx.strokeStyle = '#2e7fd9'; mctx.lineWidth = 1;
      mctx.strokeRect(m.x + 14.5, m.y + 12.5, tw - 1, 23);
      mctx.fillStyle = '#e8f2f8';
      mctx.fillText(hov.name, m.x + 22, m.y + 16);
    }

    mctx.fillStyle = 'rgba(20,10,6,0.6)';
    mctx.fillRect(0, H - 26, W, 26);
    mctx.fillStyle = '#d8b8a0';
    mctx.fillText(compact
      ? tStr('点按选择/指令 · 长按=右键 · 双指缩放 · P暂停 M静音')
      : tStr('左Alt+1步兵 · 左Alt+2战车 · 左键点选/框选 · 右键指令 · Z+左键攻击移动 · 滚轮缩放 · WASD/中键移镜头 · P暂停 M静音 H停火'), 14, H - 21);

    // 暂停覆盖层
    if (RS.game.paused) {
      mctx.fillStyle = 'rgba(10,6,4,0.55)';
      mctx.fillRect(0, 0, W, H);
      mctx.textAlign = 'center';
      mctx.font = 'bold 40px monospace';
      mctx.fillStyle = '#ffd27d';
      mctx.fillText(tStr('已 暂 停'), W / 2, H / 2 - 24);
      mctx.font = '16px monospace';
      mctx.fillStyle = '#e8f2f8';
      mctx.fillText(tStr('按 P 或点击左键继续'), W / 2, H / 2 + 16);
      mctx.textAlign = 'left';
    }
  }

  // ---------- 选中单位信息面板 ----------
  function drawSelectionPanel() {
    const sel = [...RS.game.selection];
    render.unitActionRect = null;
    render.fireModeRect = null;
    if (!sel.length) return;
    const drill = sel.length === 1 && sel[0].kind === 'drillRig';
    const fighters = sel.filter(u => RS.units.TYPES[u.kind].dmg);
    const panelH = drill ? 112 : (fighters.length ? 110 : 76), panelW = 250, px = 10, py = H - 26 - panelH - 8;
    mctx.fillStyle = 'rgba(20,10,6,0.78)';
    mctx.fillRect(px, py, panelW, panelH);
    mctx.strokeStyle = '#2e7fd9'; mctx.lineWidth = 1;
    mctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);
    mctx.textBaseline = 'top';

    if (sel.length === 1) {
      const u = sel[0];
      const spr = RS.sprites.units[u.kind] && RS.sprites.units[u.kind][0];
      if (spr) { // 素材缺失:跳过图标,文字信息照显
        mctx.imageSmoothingEnabled = false;
        mctx.drawImage(spr.canvas, px + 8, py + 12, spr.canvas.width, spr.canvas.height);
      }
      mctx.font = '15px monospace';
      mctx.fillStyle = '#e8f2f8';
      mctx.fillText(tStr(RS.units.TYPES[u.kind].name), px + 86, py + 10);
      mctx.fillStyle = '#33383d'; mctx.fillRect(px + 86, py + 34, 150, 8);
      mctx.fillStyle = '#5ad06e'; mctx.fillRect(px + 86, py + 34, 150 * (u.hp / u.maxHp), 8);
      mctx.fillStyle = '#9fd8ef'; mctx.font = '12px monospace';
      mctx.fillText(Math.ceil(u.hp) + ' / ' + u.maxHp + (u.repairFxT > 0 ? tStr(' · 维修中') : ''), px + 86, py + 46);
      if (u.kind === 'harvester') mctx.fillText(u.waitingForScout
        ? tStr('等待侦察：没有已探索矿脉')
        : tfStr('载矿 {load} / {cap}', { load: Math.round(u.load), cap: RS.config.harvester.capacity }), px + 86, py + 60);
      else if (u.kind === 'drillRig') {
        const status = RS.game.deepMineStatus(u);
        mctx.fillStyle = status.valid ? '#7dff9a' : '#ffd27d';
        mctx.fillText(tStr(status.reason), px + 86, py + 60);
        const r = { x: px + 8, y: py + 78, w: panelW - 16, h: 26 };
        render.unitActionRect = r;
        mctx.fillStyle = status.valid ? 'rgba(46,127,217,0.42)' : 'rgba(70,55,45,0.72)';
        mctx.fillRect(r.x, r.y, r.w, r.h);
        mctx.strokeStyle = status.valid ? '#7dff9a' : '#8a7568';
        mctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        mctx.fillStyle = status.valid ? '#fff0c2' : '#a99488';
        mctx.fillText(status.valid ? tStr('展开为深层开采站') : tStr('驶入地图绿色采空区后可展开'), r.x + 10, r.y + 6);
      } else if (RS.units.TYPES[u.kind].role) mctx.fillText(tStr(RS.units.TYPES[u.kind].role), px + 86, py + 60);
    } else {
      const groups = {};
      for (const u of sel) groups[u.kind] = (groups[u.kind] || 0) + 1;
      let gx = px + 10;
      mctx.font = '13px monospace';
      for (const kind of Object.keys(groups)) {
        const spr = RS.sprites.units[kind] && RS.sprites.units[kind][0];
        if (spr) { // 素材缺失:跳过图标
          mctx.imageSmoothingEnabled = false;
          mctx.drawImage(spr.canvas, gx, py + 10, spr.canvas.width, spr.canvas.height);
        }
        mctx.fillStyle = '#e8f2f8';
        mctx.fillText('×' + groups[kind], gx + 6, py + 56);
        gx += 62;
      }
    }

    // 开火模式切换(选中含作战单位时显示;H 键同效):停火 = 只打点名目标
    if (!drill && fighters.length) {
      const hold = fighters.every(u => u.holdFire);
      const r = { x: px + 8, y: py + 78, w: panelW - 16, h: 26 };
      render.fireModeRect = r;
      mctx.fillStyle = hold ? 'rgba(148,62,42,0.55)' : 'rgba(46,127,217,0.42)';
      mctx.fillRect(r.x, r.y, r.w, r.h);
      mctx.strokeStyle = hold ? '#ff9a6a' : '#8fc7f5';
      mctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      mctx.fillStyle = hold ? '#ffd2b8' : '#eaf6ff';
      mctx.fillText(hold ? tStr('开火模式:停火（H）') : tStr('开火模式:自由（H）'), r.x + 10, r.y + 6);
    }
  }

  function fireModeHit(cx, cy) {
    const r = render.fireModeRect;
    return !!(r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
  }

  function unitActionHit(cx, cy) {
    const r = render.unitActionRect;
    return !!(r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
  }

  // ---------- 选中建筑信息与回收 ----------
  function drawBuildingPanel() {
    const b = RS.game.buildingSel;
    render.buildingActionRect = null;
    if (!b) return;
    const deep = b.type === 'deepMine' && b.done;
    const px = 10, py = RS.game.tutorial ? 184 : 44, panelW = 272, panelH = deep ? 112 : 92;
    mctx.fillStyle = 'rgba(20,10,6,0.84)';
    mctx.fillRect(px, py, panelW, panelH);
    mctx.strokeStyle = '#2e7fd9'; mctx.lineWidth = 1;
    mctx.strokeRect(px + 0.5, py + 0.5, panelW - 1, panelH - 1);
    mctx.textBaseline = 'top';
    mctx.font = '14px monospace';
    mctx.fillStyle = '#e8f2f8';
    mctx.fillText(tfStr('{name} · 占地 {n}×{m} 格', { name: tStr(b.def.name), n: b.n, m: b.m }), px + 10, py + 9);
    mctx.font = '12px monospace';
    mctx.fillStyle = '#9fd8ef';
    if (b.done) {
      mctx.fillText(tfStr('耐久 {hp} / {max}', { hp: Math.ceil(b.hp), max: b.maxHp }), px + 10, py + 30);
      if (b.type === 'turret' && RS.game.lowPower(b.owner)) {
        mctx.fillStyle = '#e04c3a';
        mctx.fillText(tStr('缺电停摆·请建电站'), px + 130, py + 30);
        mctx.fillStyle = '#9fd8ef';
      }
      if (deep) {
        const info = RS.game.deepMineInfo(b);
        const low = RS.game.lowPower(b.owner);
        mctx.fillStyle = low ? '#e04c3a' : '#7dff9a';
        mctx.fillText(low
          ? tStr('缺电停产 · 当前收入 $0/分')
          : tfStr('深钻 {tier}级 · 采空{d}格 · +${p}/分', { tier: info.tier, d: info.depleted, p: info.perMinute }),
        px + 10, py + 49);
      }
    } else {
      const ratio = Math.min(1, b.progress / b.def.buildTime);
      mctx.fillText(tfStr('施工进度 {pct}%', { pct: Math.floor(ratio * 100) }), px + 10, py + 30);
      mctx.fillStyle = '#33383d'; mctx.fillRect(px + 118, py + 32, 140, 6);
      mctx.fillStyle = '#5ad06e'; mctx.fillRect(px + 118, py + 32, 140 * ratio, 6);
    }
    if (b.type === 'cc') {
      mctx.fillStyle = '#8a7568';
      mctx.fillText(tStr('不可回收 · 维修车无法维修'), px + 10, py + 50);
      const wait = Math.max(0, b.def.selfRepairDelay - (RS.game.time - b.lastDamageT));
      const repairState = b.hp >= b.maxHp ? tStr('核心自修：耐久已满')
        : wait > 0 ? tfStr('核心自修：脱战 {s} 秒后启动', { s: Math.ceil(wait) })
          : tfStr('核心自修中：+{r} / 秒', { r: b.def.selfRepairRate });
      mctx.fillStyle = b.selfRepairFxT > 0 ? '#4fc3f7' : '#9fd8ef';
      mctx.fillText(repairState, px + 10, py + 68);
      return;
    }
    const value = RS.game.recycleValue(b);
    const r = { x: px + 9, y: py + (deep ? 71 : 51), w: panelW - 18, h: 31 };
    render.buildingActionRect = r;
    mctx.fillStyle = b.done ? 'rgba(224,76,58,0.28)' : 'rgba(46,127,217,0.32)';
    mctx.fillRect(r.x, r.y, r.w, r.h);
    mctx.strokeStyle = b.done ? '#e04c3a' : '#7dff9a';
    mctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    mctx.fillStyle = '#fff0c2';
    const keepsBonus = b.done && b.bonusHarvester && b.bonusHarvester.hp > 0 &&
      RS.game.units.includes(b.bonusHarvester);
    const label = !b.done ? tStr('取消施工（全额）')
      : keepsBonus ? tStr('回收厂体60%·矿车保留') : tStr('回收建筑（60%）');
    mctx.fillText(label + '  +$' + value, r.x + 8, r.y + 8);
  }

  function buildingActionHit(cx, cy) {
    const r = render.buildingActionRect;
    return !!(r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
  }

  // ---------- 右侧建造栏(位于小地图下方;窄屏缩小/横屏双列) ----------
  function drawPalette() {
    const short = H < 450;
    const cols = short ? 2 : 1;
    const colW = W < 520 ? 118 : 150, itemH = H < 560 ? 44 : 60;
    const rows = Math.ceil(PALETTE_TYPES.length / cols);
    const mmBottom = 44 + MM.size * (RS.config.MAP_H / RS.config.MAP_W);
    const x0 = W - colW * cols - 10, y0 = mmBottom + 10;
    mctx.fillStyle = 'rgba(20,10,6,0.78)';
    mctx.fillRect(x0 - 6, y0 - 6, colW * cols + 12, rows * itemH + 30);
    mctx.strokeStyle = '#2e7fd9'; mctx.lineWidth = 1;
    mctx.strokeRect(x0 - 5.5, y0 - 5.5, colW * cols + 11, rows * itemH + 29);
    mctx.font = (itemH < 50 ? '11px' : '13px') + ' monospace'; mctx.textBaseline = 'top';
    mctx.fillStyle = '#9fd8ef';
    mctx.fillText(tStr('建造'), x0 + 4, y0 - 2);

    render.paletteRects = [];
    const cur = RS.game.buildings.find(b => b.owner === 'player' && !b.done);
    PALETTE_TYPES.forEach((type, idx) => {
      const def = RS.config.buildings[type];
      const x = x0 + (idx % cols) * colW, y = y0 + 16 + Math.floor(idx / cols) * itemH;
      const r = { type, x, y, w: colW, h: itemH - 6 };
      render.paletteRects.push(r);
      const afford = RS.game.money >= def.cost;
      const selected = RS.input.buildMode === type;
      const busyThis = cur && cur.type === type;
      mctx.fillStyle = selected ? 'rgba(46,127,217,0.35)' : 'rgba(255,255,255,0.05)';
      mctx.fillRect(r.x, r.y, r.w, r.h);
      if (selected) { mctx.strokeStyle = '#7dff9a'; mctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1); }
      const s = RS.sprites.buildings[type];
      const ih = itemH < 50 ? 22 : 34;
      mctx.imageSmoothingEnabled = false;
      mctx.globalAlpha = afford ? 1 : 0.4;
      if (s) {
        const iw = s.canvas.width * (ih / s.canvas.height);
        mctx.drawImage(s.canvas, r.x + 4, r.y + (r.h - ih) / 2, iw, ih);
      } else { // 素材缺失:占位色块,面板不崩
        mctx.fillStyle = '#2e7fd9';
        mctx.fillRect(r.x + 4, r.y + (r.h - ih) / 2, ih, ih);
      }
      mctx.globalAlpha = 1;
      const tx = r.x + (itemH < 50 ? 34 : 48);
      mctx.fillStyle = afford ? '#e8f2f8' : '#8a7568';
      mctx.fillText(tStr(def.name) + ' ' + def.n + '×' + def.m, tx, r.y + 4);
      mctx.fillStyle = afford ? '#ffd27d' : '#8a7568';
      const powerText = def.power > 0 ? tfStr(' · +{p}电', { p: def.power }) : tfStr(' · 耗{p}电', { p: -def.power });
      mctx.fillText('$' + def.cost + powerText, tx, r.y + (itemH < 50 ? 18 : 24));
      if (busyThis) {
        const ratio = cur.progress / cur.def.buildTime;
        mctx.fillStyle = '#33383d'; mctx.fillRect(tx, r.y + r.h - 8, r.w - tx + r.x - 8, 5);
        mctx.fillStyle = '#5ad06e'; mctx.fillRect(tx, r.y + r.h - 8, (r.w - tx + r.x - 8) * ratio, 5);
      } else if (cur) {
        mctx.fillStyle = 'rgba(20,10,6,0.45)';
        mctx.fillRect(r.x, r.y, r.w, r.h);
      }
    });
  }

  function paletteHit(cx, cy) {
    for (const r of render.paletteRects)
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r.type;
    return null;
  }

  // ---------- 底部生产面板 ----------
  function drawProductionPanel() {
    const bs = RS.game.buildingSel;
    render.prodRects = [];
    if (!bs || !bs.done || !bs.def.produces) return;
    const kinds = bs.def.produces;
    // 七项工厂菜单在窄窗口必须主动换行；108px 可完整容纳“深层钻探车 $900”。
    const itemW = 108, itemH = 64;
    const cols = Math.min(kinds.length, Math.max(2, Math.floor((W - 24) / itemW)));
    const rows = Math.ceil(kinds.length / cols);
    const panelW = cols * itemW;
    const x0 = (W - panelW) / 2, y0 = H - 26 - rows * itemH - 8;
    mctx.fillStyle = 'rgba(20,10,6,0.78)';
    mctx.fillRect(x0 - 6, y0 - 6, panelW + 12, rows * itemH + 12);
    mctx.strokeStyle = '#2e7fd9'; mctx.lineWidth = 1;
    mctx.strokeRect(x0 - 5.5, y0 - 5.5, panelW + 11, rows * itemH + 11);
    mctx.font = '12px monospace'; mctx.textBaseline = 'top';

    kinds.forEach((kind, idx) => {
      const def = RS.units.TYPES[kind];
      const r = {
        kind,
        x: x0 + (idx % cols) * itemW,
        y: y0 + Math.floor(idx / cols) * itemH,
        w: itemW - 6,
        h: itemH,
      };
      render.prodRects.push(r);
      const afford = RS.game.money >= def.cost;
      const qCount = bs.queue.filter(k => k === kind).length;
      mctx.fillStyle = 'rgba(255,255,255,0.05)';
      mctx.fillRect(r.x, r.y, r.w, r.h);
      const spr = RS.sprites.units[kind] && RS.sprites.units[kind][0];
      const ih = 26;
      mctx.imageSmoothingEnabled = false;
      mctx.globalAlpha = afford ? 1 : 0.4;
      if (spr) {
        const iw = spr.canvas.width * (ih / spr.canvas.height);
        mctx.drawImage(spr.canvas, r.x + (r.w - iw) / 2, r.y + 4, iw, ih);
      } else { // 素材缺失:占位色块,面板不崩
        mctx.fillStyle = '#2e7fd9';
        mctx.fillRect(r.x + (r.w - ih) / 2, r.y + 4, ih, ih);
      }
      mctx.globalAlpha = 1;
      mctx.fillStyle = afford ? '#e8f2f8' : '#8a7568';
      mctx.fillText(tStr(def.name) + ' $' + def.cost, r.x + 6, r.y + 34);
      if (qCount) {
        mctx.fillStyle = '#2e7fd9';
        mctx.fillRect(r.x + r.w - 20, r.y + 2, 18, 14);
        mctx.fillStyle = '#fff';
        mctx.fillText('×' + qCount, r.x + r.w - 18, r.y + 4);
      }
      if (bs.queue[0] === kind) {
        const ratio = bs.prodProgress / def.buildTime;
        mctx.fillStyle = '#33383d'; mctx.fillRect(r.x + 6, r.y + 50, r.w - 12, 6);
        mctx.fillStyle = '#5ad06e'; mctx.fillRect(r.x + 6, r.y + 50, (r.w - 12) * ratio, 6);
      }
    });
  }

  function prodHit(cx, cy) {
    for (const r of render.prodRects)
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r.kind;
    return null;
  }

  // ---------- 小地图(探索式:未探索全黑;地形层离屏缓存,visited 修订号变化才重画) ----------
  let mmCache = null, mmRev = -1;
  function drawMinimap() {
    const mw = RS.config.MAP_W, mh = RS.config.MAP_H;
    MM.size = Math.min(160, Math.floor(W * 0.28), H < 450 ? 110 : 160); // 窄屏/横屏缩小
    const size = MM.size, sh = size * (mh / mw), s = size / mw;
    const x0 = W - size - 10, y0 = 44;
    MM.x = x0; MM.y = y0; MM.scale = s;
    if (!mmCache) { mmCache = document.createElement('canvas'); mmCache.width = mw; mmCache.height = mh; }
    const rev = RS.map.visitedRev || 0;
    if (rev !== mmRev) { // 每 0.5s 探索刷新一次,而非每帧 16384 次 fillRect
      mmRev = rev;
      const c = mmCache.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, mw, mh);
      const V = RS.map.visited;
      if (V) {
        for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
          if (!V[j * mw + i]) continue;
          const t = RS.map.tiles[j][i];
          c.fillStyle = t.rock ? '#3d2f26' : t.ore > 0 ? '#2b7fb8' : '#6b4a34';
          c.fillRect(i, j, 1, 1);
        }
      }
    }
    mctx.fillStyle = '#000';
    mctx.fillRect(x0, y0, size, sh);
    const smooth0 = mctx.imageSmoothingEnabled;
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(mmCache, x0, y0, size, sh);
    mctx.imageSmoothingEnabled = smooth0;
    const V = RS.map.visited;
    const stormOn = RS.game.storm && RS.game.storm.active;
    if (V && !stormOn) {
      for (const b of RS.game.buildings) {
        if (b.destroyed) continue;
        if (b.owner === 'enemy' && !V[Math.floor(b.cy) * mw + Math.floor(b.cx)]) continue;
        mctx.fillStyle = b.owner === 'player' ? '#2e7fd9' : '#e04c3a';
        mctx.fillRect(x0 + b.i * s, y0 + b.j * s, b.n * s, b.m * s);
      }
      for (const u of RS.game.units) {
        if (u.owner === 'enemy' && !(RS.map.visible && RS.map.visible[Math.floor(u.y) * mw + Math.floor(u.x)])) continue; // 小地图敌情只在视野内可见
        mctx.fillStyle = u.owner === 'player' ? '#7dff9a' : '#ff6a4d';
        mctx.fillRect(x0 + u.x * s - 1, y0 + u.y * s - 1, 2, 2);
      }
      for (const d of (RS.game.derelicts || [])) {
        if (!V[Math.floor(d.y) * mw + Math.floor(d.x)] && !(d.isRelic && d.revealed)) continue; // 坠毁无人机(已探索区域);遗迹明牌后小地图也标出
        mctx.fillStyle = d.isRelic ? '#f7e26b' : '#f5a623';
        mctx.fillRect(x0 + d.x * s - 1.5, y0 + d.y * s - 1.5, 3, 3);
      }
    }
    if (stormOn) { // 沙暴:小地图整幅沙雾遮蔽(攻击警报与主视野标记保留作玩家对等感官)
      if (RS.sprites.sandOverlay) mctx.drawImage(RS.sprites.sandOverlay, x0, y0, size, sh);
      else { mctx.fillStyle = 'rgba(150,90,50,0.78)'; mctx.fillRect(x0, y0, size, sh); }
      mctx.fillStyle = '#fff0c2';
      mctx.font = '11px monospace';
      mctx.fillText(tStr('沙暴'), x0 + 6, y0 + 6);
    }
    // 视野框:等距投影下屏幕矩形是世界里的平行四边形,按四角连线画
    const c0 = clientToWorld(0, 0), c1 = clientToWorld(W, 0), c2 = clientToWorld(W, H), c3 = clientToWorld(0, H);
    mctx.strokeStyle = 'rgba(255,255,255,0.65)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.moveTo(x0 + c0.x * s, y0 + c0.y * s);
    mctx.lineTo(x0 + c1.x * s, y0 + c1.y * s);
    mctx.lineTo(x0 + c2.x * s, y0 + c2.y * s);
    mctx.lineTo(x0 + c3.x * s, y0 + c3.y * s);
    mctx.closePath();
    mctx.stroke();
    mctx.strokeStyle = '#2e7fd9';
    mctx.strokeRect(x0 - 1.5, y0 - 1.5, size + 3, sh + 3);
  }

  function minimapHit(cx, cy) {
    if (!MM.x) return null;
    const sh = MM.size * (RS.config.MAP_H / RS.config.MAP_W);
    if (cx >= MM.x && cx <= MM.x + MM.size && cy >= MM.y && cy <= MM.y + sh)
      return { x: (cx - MM.x) / MM.scale, y: (cy - MM.y) / MM.scale };
    return null;
  }

  // ---------- 可操作的新手教学 ----------
  const TUTORIAL_STEPS = [
    {
      title: '欢迎来到《红色风暴》',
      lines: ['目标：采矿、建厂、生产部队，最终摧毁敌方指挥中心。', '这套教学会检查你的实际操作，也可以随时跳过。'],
    },
    { title: '1. 选择部队', lines: ['左键点击一名我方士兵，或拖框选择多名单位。'] },
    { title: '2. 下达移动命令', lines: ['选中部队后，在地图空地点击右键。', '中键拖动 / WASD 移镜头，滚轮缩放视野。'] },
    { title: '3. 建立电力', lines: ['在右侧建造栏选择“太阳能电站”，放在基地附近。', '缺电时施工和生产减半，防御炮塔会停摆。'] },
    { title: '4. 建造兵营', lines: ['建造兵营并等待完工。放置预览中的菱形就是实际占地。'] },
    { title: '5. 生产第一名新兵', lines: ['选中兵营，点击“步兵”加入生产队列。'] },
    { title: '6. 侦察后再采矿', lines: ['让部队驶入黑色未探索区域，扩大已知地图。', '矿车只会自动寻找已探索矿脉，不再隔着黑雾开天眼。'] },
    {
      title: '基础教学完成',
      lines: ['左Alt+1/2 快速召集；Z+左键为攻击移动。坠毁无人机只能用维修车回收。', '矿区大量采空后，可生产深层钻探车；驶入枯竭矿区按 D 展开。', '教学将在 4 秒后自动关闭，也可随时点击右上角关闭。'],
    },
  ];

  function drawTutorial() {
    render.tutorialActionRect = null;
    render.tutorialSkipRect = null;
    render.tutorialPanelRect = null;
    const t = RS.game.tutorial;
    if (!t || RS.game.state !== 'playing') return;
    const step = TUTORIAL_STEPS[Math.min(t.step, TUTORIAL_STEPS.length - 1)];
    const w = Math.min(470, W - 20), h = 130, x = 10, y = 44;
    render.tutorialPanelRect = { x, y, w, h };
    mctx.fillStyle = 'rgba(20,10,6,0.94)';
    mctx.fillRect(x, y, w, h);
    mctx.strokeStyle = '#ffd27d';
    mctx.lineWidth = 2;
    mctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    mctx.textBaseline = 'top';
    mctx.font = 'bold 15px monospace';
    mctx.fillStyle = '#ffd27d';
    mctx.fillText(tfStr('新手教学 {n}/7 · {title}', { n: Math.min(t.step, 7), title: tStr(step.title) }), x + 12, y + 10);
    mctx.font = '13px monospace';
    mctx.fillStyle = '#e8f2f8';
    step.lines.forEach((line, idx) => mctx.fillText(tStr(line), x + 12, y + 38 + idx * 20));

    const action = { x: x + 12, y: y + h - 35, w: 116, h: 25 };
    render.tutorialActionRect = action;
    mctx.fillStyle = 'rgba(46,127,217,0.46)';
    mctx.fillRect(action.x, action.y, action.w, action.h);
    mctx.strokeStyle = '#7dff9a';
    mctx.strokeRect(action.x + 0.5, action.y + 0.5, action.w - 1, action.h - 1);
    mctx.fillStyle = '#fff0c2';
    const actionText = t.step === 0 ? tStr('开始教学') : t.step >= 7 ? tStr('完成并关闭') : tStr('跳过本步');
    mctx.fillText(actionText, action.x + 10, action.y + 5);

    const skip = { x: x + w - 94, y: y + 8, w: 82, h: 23 };
    render.tutorialSkipRect = skip;
    mctx.fillStyle = 'rgba(224,76,58,0.24)';
    mctx.fillRect(skip.x, skip.y, skip.w, skip.h);
    mctx.fillStyle = '#d8b8a0';
    mctx.fillText(tStr('关闭教学'), skip.x + 8, skip.y + 4);
  }

  function tutorialHit(cx, cy) {
    const s = render.tutorialSkipRect;
    if (s && cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h) return 'skip';
    const a = render.tutorialActionRect;
    if (a && cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) return 'next';
    const p = render.tutorialPanelRect;
    if (p && cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h) return 'panel';
    return null;
  }

  // ---------- 标题屏:AI 封面(有素材时)+ 宽松排版 ----------
  function drawTitle() {
    const big = H >= 700;
    if (RS.sprites.titleBg) {
      // AI 封面铺满(像素化放大),压暗保证文字可读
      const img = RS.sprites.titleBg;
      const scale = Math.max(W / img.width, H / img.height);
      mctx.imageSmoothingEnabled = false;
      mctx.drawImage(img, (W - img.width * scale) / 2, (H - img.height * scale) / 2, img.width * scale, img.height * scale);
      mctx.fillStyle = 'rgba(15,6,4,0.38)';
      mctx.fillRect(0, 0, W, H);
    } else {
      mctx.fillStyle = 'rgba(15,6,4,0.82)';
      mctx.fillRect(0, 0, W, H);
      const cx0 = W / 2, cy0 = H * 0.28, R = Math.min(W, H) * 0.15;
      const g = mctx.createRadialGradient(cx0 - R * 0.35, cy0 - R * 0.35, R * 0.15, cx0, cy0, R);
      g.addColorStop(0, '#d87a4e'); g.addColorStop(0.55, '#b85c38'); g.addColorStop(1, '#5d2a1a');
      mctx.fillStyle = g;
      mctx.beginPath(); mctx.arc(cx0, cy0, R, 0, Math.PI * 2); mctx.fill();
      mctx.fillStyle = 'rgba(111,54,35,0.7)';
      for (const [dx, dy, r] of [[-0.3, 0.1, 0.14], [0.25, -0.2, 0.1], [0.1, 0.35, 0.08]]) {
        mctx.beginPath(); mctx.arc(cx0 + dx * R, cy0 + dy * R, r * R, 0, Math.PI * 2); mctx.fill();
      }
      mctx.strokeStyle = 'rgba(216,138,90,0.5)';
      mctx.lineWidth = Math.max(2, R * 0.05);
      mctx.beginPath(); mctx.arc(cx0, cy0, R * 0.72, Math.PI * 0.15, Math.PI * 0.45); mctx.stroke();
      mctx.beginPath(); mctx.arc(cx0, cy0, R * 0.52, Math.PI * 0.6, Math.PI * 0.9); mctx.stroke();
    }

    const cx = W / 2;
    const narrow = W < 700;
    const titleSize = Math.round(Math.max(30, Math.min(big ? 76 : 56, W * 0.13, H * 0.2)));
    const titleY = H * (H < 500 ? 0.30 : 0.40);
    mctx.textAlign = 'center';
    mctx.shadowColor = 'rgba(255,90,60,0.75)';
    mctx.shadowBlur = 20;
    mctx.font = 'bold ' + titleSize + 'px monospace';
    mctx.fillStyle = '#ff5a3c';
    mctx.fillText(tStr('红色风暴'), cx, titleY);
    const titleW = mctx.measureText(tStr('红色风暴')).width;
    render.titleLogoRect = {
      x: cx - titleW / 2 - 14, y: titleY - 8,
      w: titleW + 28, h: titleSize + 16,
    };
    mctx.shadowBlur = 0;
    const subGap = Math.max(44, titleSize * 0.9);
    mctx.font = Math.round(Math.min(big ? 28 : 22, W * 0.055)) + 'px monospace';
    mctx.fillStyle = '#ffd27d';
    mctx.fillText(tStr('献 给 Simon'), cx, titleY + subGap);
    mctx.font = Math.round(Math.min(15, W * 0.035)) + 'px monospace';
    mctx.fillStyle = '#e8c9b0';
    mctx.fillText(tStr('一款即时战略小游戏'), cx, titleY + subGap + 42);

    render.titleRects = [];
    const audioReady = !RS.audio || !RS.audio.isUnlocked || RS.audio.isUnlocked();
    if (!audioReady) {
      const pw = Math.min(300, W - 60), ph = 58, py = H * 0.66;
      mctx.fillStyle = 'rgba(20,12,8,0.78)';
      mctx.fillRect(cx - pw / 2, py, pw, ph);
      mctx.strokeStyle = '#ffd27d';
      mctx.lineWidth = 2;
      mctx.strokeRect(cx - pw / 2 + 1, py + 1, pw - 2, ph - 2);
      mctx.textBaseline = 'middle';
      mctx.font = '17px monospace';
      mctx.fillStyle = '#fff0c2';
      mctx.fillText(tStr('点击开启声音'), cx, py + ph / 2);
      mctx.font = '13px monospace';
      mctx.fillStyle = 'rgba(216,184,160,0.78)';
      if (!(H < 420)) mctx.fillText(tStr('浏览器需要一次点击才能播放封面音乐'), cx, H - 40);
      mctx.textAlign = 'left';
      mctx.textBaseline = 'top';
      return;
    }

    const labels = [['easy', '简单 · 轻松推'], ['normal', '普通 · 有来有回'], ['hard', '困难 · 钢铁洪峰']];
    const bw = Math.min(220, W - 60), bh = 54, gap = 30;
    const y0 = narrow ? Math.min(H * 0.56, titleY + subGap + 70) : H * 0.64;
    mctx.textBaseline = 'middle';
    const m = RS.input.mouse;
    const cbw = Math.min(340, W - 50), cbh = 48;
    const cbx = cx - cbw / 2, cby = Math.max(18, titleY - titleSize - 82);
    render.titleRects.push({ key: 'campaign', x: cbx, y: cby, w: cbw, h: cbh });
    const chov = m.x >= cbx && m.x <= cbx + cbw && m.y >= cby && m.y <= cby + cbh;
    mctx.fillStyle = chov ? 'rgba(224,76,58,0.68)' : 'rgba(20,12,8,0.82)';
    mctx.fillRect(cbx, cby, cbw, cbh);
    mctx.strokeStyle = chov ? '#ffd27d' : '#e04c3a';
    mctx.lineWidth = 2;
    mctx.strokeRect(cbx + 1, cby + 1, cbw - 2, cbh - 2);
    mctx.fillStyle = '#fff0c2';
    mctx.font = 'bold 17px monospace';
    mctx.fillText(tStr('剧情模式 · 三章战役'), cx, cby + cbh / 2);
    labels.forEach(([key, label], idx) => {
      const bx = narrow ? cx - bw / 2 : cx - (bw * 3 + gap * 2) / 2 + idx * (bw + gap);
      const by = narrow ? y0 + idx * (bh + 14) : y0;
      render.titleRects.push({ key, x: bx, y: by, w: bw, h: bh });
      const hov = m.x >= bx && m.x <= bx + bw && m.y >= by && m.y <= by + bh;
      mctx.fillStyle = hov ? 'rgba(224,76,58,0.55)' : 'rgba(20,12,8,0.72)';
      mctx.fillRect(bx, by, bw, bh);
      mctx.strokeStyle = hov ? '#ffd27d' : '#2e7fd9';
      mctx.lineWidth = 2;
      mctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
      mctx.fillStyle = '#e8f2f8';
      mctx.font = '17px monospace';
      mctx.fillText(tStr(label), bx + bw / 2, by + bh / 2);
    });
    const tbw = Math.min(320, W - 60), tbh = 46;
    const tbx = cx - tbw / 2, tby = narrow ? y0 - 60 : y0 + bh + 18;
    render.titleRects.push({ key: 'tutorial', x: tbx, y: tby, w: tbw, h: tbh });
    const thov = m.x >= tbx && m.x <= tbx + tbw && m.y >= tby && m.y <= tby + tbh;
    mctx.fillStyle = thov ? 'rgba(46,127,217,0.62)' : 'rgba(20,12,8,0.8)';
    mctx.fillRect(tbx, tby, tbw, tbh);
    mctx.strokeStyle = thov ? '#7dff9a' : '#ffd27d';
    mctx.strokeRect(tbx + 1, tby + 1, tbw - 2, tbh - 2);
    mctx.fillStyle = '#fff0c2';
    mctx.font = '16px monospace';
    mctx.fillText(tStr('第一次玩？进入新手教学'), cx, tby + tbh / 2);
    // 沙暴模式开关(2026-07-25):随机沙暴 + 遗迹机甲争夺;默认关
    const sbw = Math.min(320, W - 60), sbh = 40;
    const sbx = cx - sbw / 2, sby = tby + tbh + 12;
    render.titleRects.push({ key: 'storm-toggle', x: sbx, y: sby, w: sbw, h: sbh });
    const shov = m.x >= sbx && m.x <= sbx + sbw && m.y >= sby && m.y <= sby + sbh;
    mctx.fillStyle = shov ? 'rgba(150,90,50,0.7)' : 'rgba(20,12,8,0.72)';
    mctx.fillRect(sbx, sby, sbw, sbh);
    mctx.strokeStyle = RS.game.stormWanted ? '#ffd27d' : '#6b4a34';
    mctx.lineWidth = 2;
    mctx.strokeRect(sbx + 1, sby + 1, sbw - 2, sbh - 2);
    mctx.fillStyle = RS.game.stormWanted ? '#fff0c2' : 'rgba(216,184,160,0.75)';
    mctx.font = '15px monospace';
    mctx.fillText(tfStr('沙暴模式：{onoff} · 随机沙暴与遗迹争夺', { onoff: RS.game.stormWanted ? tStr('开') : tStr('关') }), cx, sby + sbh / 2);
    mctx.font = '13px monospace';
    mctx.fillStyle = 'rgba(216,184,160,0.75)';
    if (!(H < 420)) mctx.fillText(tStr('采矿 · 建厂 · 侦察 · 作战        选择难度或先完成教学'), cx, H - 40);
    mctx.textAlign = 'left';
    mctx.textBaseline = 'top';
  }

  function titleHit(cx, cy) {
    for (const r of render.titleRects)
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r.key;
    return null;
  }

  function titleLogoHit(cx, cy) {
    const r = render.titleLogoRect;
    return !!(r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
  }

  // ---------- 彩蛋：赤曜战地图鉴 ----------
  function drawGuideImage(img, x, y, w, h, shade) {
    if (!img) return;
    const scale = Math.max(w / img.width, h / img.height);
    mctx.save();
    mctx.beginPath(); mctx.rect(x, y, w, h); mctx.clip();
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(img, x + (w - img.width * scale) / 2, y + (h - img.height * scale) / 2,
      img.width * scale, img.height * scale);
    if (shade) {
      mctx.fillStyle = 'rgba(10,5,4,' + shade + ')';
      mctx.fillRect(x, y, w, h);
    }
    mctx.restore();
  }

  function guideFit(text, x, y, maxW, color, font, align) {
    mctx.font = font || '14px monospace';
    mctx.fillStyle = color || '#e8f2f8';
    mctx.textAlign = align || 'left';
    let out = text;
    while (out.length > 2 && mctx.measureText(out).width > maxW) out = out.slice(0, -1);
    if (out !== text) out = out.slice(0, -1) + '…';
    mctx.fillText(out, x, y);
  }

  function guideButton(action, x, y, w, h, label, active, disabled) {
    const m = RS.input.mouse;
    const hov = !disabled && m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
    mctx.fillStyle = active ? 'rgba(224,76,58,0.66)'
      : hov ? 'rgba(46,127,217,0.62)' : 'rgba(20,12,8,0.82)';
    mctx.fillRect(x, y, w, h);
    mctx.strokeStyle = disabled ? 'rgba(100,86,76,0.45)' : active ? '#ffd27d' : '#2e7fd9';
    mctx.lineWidth = 1;
    mctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    mctx.textAlign = 'center';
    mctx.textBaseline = 'middle';
    mctx.font = '13px monospace';
    mctx.fillStyle = disabled ? '#79685c' : '#fff0c2';
    mctx.fillText(label, x + w / 2, y + h / 2);
    if (!disabled) render.fieldGuideRects.push({ action, x, y, w, h });
  }

  function guideUnitRole(kind) {
    return {
      infantry: '廉价反步兵', rocket: '反载具 · 对空', lightTank: '高速突击',
      heavyTank: '正面装甲核心', artillery: '超远程攻城', flametank: '近程范围反步兵',
      repair: '维修车辆 / 建筑', harvester: '采矿经济',
      drillRig: '绿色采空区展开经济', drone: '经济空袭 · 无人机互攻', mech: '遗迹决战 · 可对空',
    }[kind] || '';
  }

  function drawGuideIntro(x, y, w, h) {
    const img = RS.sprites.fieldGuide && RS.sprites.fieldGuide.archive;
    drawGuideImage(img, x, y, w, h, 0.24);
    const boxH = Math.min(180, h * 0.38);
    mctx.fillStyle = 'rgba(16,9,6,0.87)';
    mctx.fillRect(x + 18, y + h - boxH - 18, w - 36, boxH);
    mctx.strokeStyle = 'rgba(255,210,125,0.8)';
    mctx.strokeRect(x + 19, y + h - boxH - 17, w - 38, boxH - 2);
    mctx.textAlign = 'left'; mctx.textBaseline = 'top';
    guideFit(tStr('赤曜战地档案'), x + 38, y + h - boxH + 2, w - 76, '#ff6b4a', 'bold 28px monospace');
    guideFit(tStr('敌我单位 · 建筑参数 · 战场资源 · 克制关系'), x + 38, y + h - boxH + 45,
      w - 76, '#ffd27d', '16px monospace');
    guideFit(tStr('同型单位基础数值完全一致。差异来自指挥、侦察与阵营美术。'), x + 38,
      y + h - boxH + 75, w - 76, '#e8f2f8', '14px monospace');
    guideFit(tStr('隐藏入口：标题名连续点击 5 次；或在地图远角找到废弃档案终端。'), x + 38,
      y + h - boxH + 103, w - 76, '#9fd8ef', '14px monospace');
  }

  function drawGuideUnits(x, y, w, h) {
    const bannerH = h < 500 ? 76 : 112;
    const art = RS.sprites.fieldGuide && RS.sprites.fieldGuide.factions;
    drawGuideImage(art, x, y, w, bannerH, 0.42);
    mctx.textAlign = 'left'; mctx.textBaseline = 'top';
    guideFit(tStr('兵种识别 · 敌我同型单位共用下列数值'), x + 16, y + 14, w - 32,
      '#fff0c2', 'bold 17px monospace');

    const kinds = RS.fieldGuide.unitOrder;
    const cols = w < 700 ? 2 : 3;
    const rows = Math.ceil(kinds.length / cols);
    const gap = 8, gy = y + bannerH + 8;
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = Math.max(58, (h - bannerH - 8 - gap * (rows - 1)) / rows);
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k], u = RS.units.TYPES[kind];
      const cx = x + (k % cols) * (cw + gap), cy = gy + Math.floor(k / cols) * (ch + gap);
      mctx.fillStyle = 'rgba(20,12,8,0.92)'; mctx.fillRect(cx, cy, cw, ch);
      mctx.strokeStyle = kind === 'drone' ? '#4fc3f7' : '#6c5142';
      mctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
      const spr = RS.sprites.units[kind] && RS.sprites.units[kind][0];
      const iconW = Math.min(76, cw * 0.30), iconH = ch - 12;
      if (spr) {
        const sc = Math.min(iconW / spr.canvas.width, iconH / spr.canvas.height, 2.2);
        mctx.imageSmoothingEnabled = false;
        mctx.drawImage(spr.canvas, cx + 6 + (iconW - spr.canvas.width * sc) / 2,
          cy + (ch - spr.canvas.height * sc) / 2, spr.canvas.width * sc, spr.canvas.height * sc);
      }
      const tx = cx + iconW + 12, tw = cw - iconW - 18;
      guideFit(tStr(u.name), tx, cy + 9, tw, '#ffd27d', 'bold 15px monospace');
      const cost = u.cost ? '$' + u.cost : tStr('残骸修复');
      guideFit(cost + tfStr('  HP {hp}  速 {sp}', { hp: u.hp, sp: u.speed }), tx, cy + 31, tw,
        '#e8f2f8', '12px monospace');
      const weapon = u.dmg ? tfStr('伤 {dmg}  射程 {range}', { dmg: u.dmg, range: (u.minRange ? u.minRange + '–' : '') + u.range })
        : kind === 'repair' ? tfStr('维修范围 {r}', { r: u.repairRange })
          : kind === 'harvester' ? tStr('载矿 300')
            : kind === 'drillRig' ? tStr('选中后显示绿色展开区') : tStr('无武器');
      guideFit(weapon, tx, cy + 50, tw, '#9fd8ef', '12px monospace');
      if (ch >= 86) guideFit(tStr(guideUnitRole(kind)), tx, cy + 69, tw, '#c98a6a', '12px monospace');
    }
  }

  function drawGuideBuildings(x, y, w, h) {
    const kinds = RS.fieldGuide.buildingOrder;
    const cols = w < 680 ? 2 : 3, rows = Math.ceil(kinds.length / cols), gap = 10;
    const cw = (w - gap * (cols - 1)) / cols, ch = (h - gap * (rows - 1)) / rows;
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[k], b = RS.config.buildings[kind];
      const cx = x + (k % cols) * (cw + gap), cy = y + Math.floor(k / cols) * (ch + gap);
      mctx.fillStyle = 'rgba(20,12,8,0.93)'; mctx.fillRect(cx, cy, cw, ch);
      mctx.strokeStyle = kind === 'turret' ? '#e04c3a' : '#6c5142';
      mctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
      const spr = RS.sprites.buildings[kind];
      const imageH = Math.max(56, ch * 0.52);
      if (spr) {
        const sc = Math.min((cw - 20) / spr.canvas.width, (imageH - 8) / spr.canvas.height, 1.35);
        mctx.imageSmoothingEnabled = false;
        mctx.drawImage(spr.canvas, cx + (cw - spr.canvas.width * sc) / 2, cy + 6,
          spr.canvas.width * sc, spr.canvas.height * sc);
      }
      const ty = cy + imageH;
      guideFit(tStr(b.name), cx + 12, ty, cw - 24, '#ffd27d', 'bold 16px monospace');
      guideFit((kind === 'cc' ? tStr('初始核心') : '$' + b.cost) + tfStr('  HP {hp}  占地 {n}×{m}', { hp: b.hp, n: b.n, m: b.m }),
        cx + 12, ty + 24, cw - 24, '#e8f2f8', '12px monospace');
      const power = b.power > 0 ? tfStr('供电 +{p}', { p: b.power }) : tfStr('耗电 {p}', { p: -b.power });
      const role = {
        cc: '被摧毁即败 · 脱战自修', power: '维持生产与炮塔运转',
        refinery: '卸矿 · 完工赠送矿车', barracks: '生产步兵 / 火箭兵',
        factory: '生产全部地面载具', turret: '自动转向 · 可对空',
        deepMine: '采空越多收入越高 · 缺电停产',
      }[kind];
      guideFit(power + ' · ' + tStr(role), cx + 12, ty + 44, cw - 24, '#9fd8ef', '12px monospace');
    }
  }

  function drawGuideBattlefield(x, y, w, h) {
    const narrow = w < 700;
    const art = RS.sprites.fieldGuide && RS.sprites.fieldGuide.salvage;
    const imageW = narrow ? w : w * 0.56, imageH = narrow ? h * 0.45 : h;
    drawGuideImage(art, x, y, imageW, imageH, 0.20);
    mctx.fillStyle = 'rgba(16,9,6,0.86)';
    mctx.fillRect(x + 14, y + imageH - 76, imageW - 28, 62);
    guideFit(tStr('坠毁无人机：每图 3–5 架'), x + 28, y + imageH - 65, imageW - 56,
      '#ffd27d', 'bold 16px monospace');
    guideFit(tStr('维修车以 15 / 秒修复，约 10 秒转化为战斗无人机。'), x + 28,
      y + imageH - 39, imageW - 56, '#e8f2f8', '13px monospace');

    const tx = narrow ? x : x + imageW + 12, ty = narrow ? y + imageH + 10 : y;
    const tw = narrow ? w : w - imageW - 12, th = narrow ? h - imageH - 10 : h;
    mctx.fillStyle = 'rgba(20,12,8,0.94)'; mctx.fillRect(tx, ty, tw, th);
    mctx.strokeStyle = '#6c5142'; mctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
    guideFit(tStr('战场资源与环境'), tx + 16, ty + 14, tw - 32, '#ff6b4a', 'bold 18px monospace');
    const lines = [
      ['主矿', '300 / 格；基地附近约 14700'],
      ['中立矿', '180 / 格；两处争夺区'],
      ['骸骨', '300 资源；采空后恢复通行'],
      ['巨型晶簇', '1000 资源；高价值目标'],
      ['战争迷雾', '只有当前视野内敌人可被攻击'],
      ['沙暴', '25 分钟建筑承伤翻倍'],
      ['终局', '30 分钟后 CC 每秒损失 8 HP'],
    ];
    let yy = ty + 52;
    for (const [name, desc] of lines) {
      guideFit(tStr(name), tx + 16, yy, Math.min(90, tw * 0.28), '#ffd27d', '13px monospace');
      guideFit(tStr(desc), tx + Math.min(108, tw * 0.32), yy, tw - Math.min(124, tw * 0.34),
        '#e8f2f8', '12px monospace');
      yy += Math.max(24, (th - 66) / lines.length);
    }
  }

  function drawGuideTactics(x, y, w, h) {
    const art = RS.sprites.fieldGuide && RS.sprites.fieldGuide.factions;
    drawGuideImage(art, x, y, w, h, 0.72);
    const gap = 12, leftW = (w - gap) * 0.46, rightW = w - gap - leftW;
    const lx = x, rx = x + leftW + gap;
    mctx.fillStyle = 'rgba(20,12,8,0.91)'; mctx.fillRect(lx, y, leftW, h);
    mctx.fillRect(rx, y, rightW, h);
    mctx.strokeStyle = '#6c5142'; mctx.strokeRect(lx + 0.5, y + 0.5, leftW - 1, h - 1);
    mctx.strokeRect(rx + 0.5, y + 0.5, rightW - 1, h - 1);
    guideFit(tStr('克制关系'), lx + 16, y + 16, leftW - 32, '#ff6b4a', 'bold 18px monospace');
    let yy = y + 54;
    for (const [target, answer] of RS.fieldGuide.counters) {
      guideFit(tStr(target), lx + 16, yy, leftW * 0.40, '#ffd27d', '13px monospace');
      guideFit('→ ' + tStr(answer), lx + leftW * 0.42, yy, leftW * 0.54, '#e8f2f8', '12px monospace');
      yy += Math.max(32, h * 0.10);
    }
    guideFit(tStr('电力不足：生产减半，炮塔与深层开采站完全停摆。'), lx + 16, y + h - 62,
      leftW - 32, '#9fd8ef', '12px monospace');
    guideFit(tStr('成品建筑回收 60%；施工中取消全额退款。'), lx + 16, y + h - 38,
      leftW - 32, '#9fd8ef', '12px monospace');

    guideFit(tStr('终局勋章'), rx + 16, y + 16, rightW - 32, '#ff6b4a', 'bold 18px monospace');
    yy = y + 54;
    for (const [badge, condition] of RS.fieldGuide.achievements) {
      guideFit(tStr(badge), rx + 16, yy, rightW * 0.34, '#ffd27d', '13px monospace');
      guideFit(tStr(condition), rx + rightW * 0.36, yy, rightW * 0.60, '#e8f2f8', '12px monospace');
      yy += Math.max(28, (h - 80) / RS.fieldGuide.achievements.length);
    }
  }

  function drawFieldGuide() {
    const guide = RS.fieldGuide;
    const page = Math.max(0, Math.min(guide.pageCount - 1, RS.game.guidePage || 0));
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = 'rgba(6,3,2,0.93)'; mctx.fillRect(0, 0, W, H);
    const pw = Math.min(1120, W - 20), ph = Math.min(680, H - 16);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    mctx.fillStyle = '#140c08'; mctx.fillRect(px, py, pw, ph);
    mctx.strokeStyle = '#b85c38'; mctx.lineWidth = 2;
    mctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    mctx.fillStyle = '#24130d'; mctx.fillRect(px + 2, py + 2, pw - 4, 52);
    mctx.textAlign = 'left'; mctx.textBaseline = 'top';
    guideFit(tStr(guide.title), px + 18, py + 13, pw * 0.48, '#ff6b4a', 'bold 22px monospace');
    guideFit(tStr(guide.subtitle), px + pw - 58, py + 18, pw * 0.43, '#c98a6a', '12px monospace', 'right');

    render.fieldGuideRects = [];
    guideButton('close', px + pw - 43, py + 11, 30, 30, '×', false, false);
    const contentX = px + 14, contentY = py + 64, contentW = pw - 28, contentH = ph - 124;
    if (page === 0) drawGuideIntro(contentX, contentY, contentW, contentH);
    else if (page === 1) drawGuideUnits(contentX, contentY, contentW, contentH);
    else if (page === 2) drawGuideBuildings(contentX, contentY, contentW, contentH);
    else if (page === 3) drawGuideBattlefield(contentX, contentY, contentW, contentH);
    else drawGuideTactics(contentX, contentY, contentW, contentH);

    const fy = py + ph - 48;
    guideButton('prev', px + 14, fy, 72, 34, tStr('‹ 上页'), false, page === 0);
    guideButton('next', px + pw - 86, fy, 72, 34, tStr('下页 ›'), false, page === guide.pageCount - 1);
    const labels = ['总览', '兵种', '建筑', '战场', '克制'];
    const tabW = Math.min(88, (pw - 190) / labels.length), tabsW = tabW * labels.length;
    const tabsX = px + (pw - tabsW) / 2;
    for (let i = 0; i < labels.length; i++)
      guideButton('page:' + i, tabsX + i * tabW, fy, tabW - 4, 34, tStr(labels[i]), i === page, false);
    mctx.textAlign = 'left'; mctx.textBaseline = 'top';
    const action = fieldGuideHit(RS.input.mouse.x, RS.input.mouse.y);
    main.style.cursor = action ? 'pointer' : 'default';
  }

  function fieldGuideHit(cx, cy) {
    for (const r of render.fieldGuideRects)
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r.action;
    return null;
  }

  // ---------- 胜负结算 ----------
  function drawEnd() {
    const won = RS.game.state === 'won';
    const s = RS.game.stats || {};
    mctx.fillStyle = won ? 'rgba(10,28,18,0.9)' : 'rgba(34,8,7,0.92)';
    mctx.fillRect(0, 0, W, H);
    const pw = Math.min(760, W - 40), ph = Math.min(520, H - 32);
    const px = (W - pw) / 2, py = (H - ph) / 2;
    mctx.fillStyle = 'rgba(20,12,8,0.9)';
    mctx.fillRect(px, py, pw, ph);
    mctx.strokeStyle = won ? '#7dff9a' : '#e04c3a';
    mctx.lineWidth = 2;
    mctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

    mctx.textAlign = 'center';
    mctx.textBaseline = 'top';
    mctx.font = 'bold 44px monospace';
    mctx.fillStyle = won ? '#7dff9a' : '#e04c3a';
    mctx.fillText(won ? tStr('胜 利 !') : tStr('基地陷落'), W / 2, py + 24);
    const mins = Math.floor(RS.game.time / 60), secs = Math.floor(RS.game.time % 60);
    const diff = { easy: '简单', normal: '普通', hard: '困难' }[RS.game.difficulty] || '普通';
    mctx.font = '15px monospace';
    mctx.fillStyle = '#e8f2f8';
    mctx.fillText(tfStr('{result} · {diff} · 用时 {m} 分 {s} 秒', {
      result: won ? tStr('敌方基地已被摧毁') : tStr('指挥中心失守'),
      diff: tStr(diff), m: mins, s: secs,
    }), W / 2, py + 78);

    const rows = [
      ['击毁敌军', s.unitsKilled || 0, '我军损失', s.unitsLost || 0],
      ['摧毁建筑', s.buildingsDestroyed || 0, '建筑损失', s.buildingsLost || 0],
      ['生产单位', s.unitsProduced || 0, '采集资源', '$' + (s.resourcesMined || 0)],
    ];
    const gridY = py + 118, colW = (pw - 80) / 2;
    mctx.textAlign = 'left';
    rows.forEach((row, r) => {
      for (let c = 0; c < 2; c++) {
        const x = px + 40 + c * colW, y = gridY + r * 48;
        mctx.fillStyle = 'rgba(46,127,217,0.13)';
        mctx.fillRect(x, y, colW - 14, 38);
        mctx.fillStyle = '#b8cbd8';
        mctx.font = '14px monospace';
        mctx.fillText(tStr(row[c * 2]), x + 12, y + 11);
        mctx.fillStyle = '#fff0c2';
        mctx.font = 'bold 20px monospace';
        mctx.textAlign = 'right';
        mctx.fillText(String(row[c * 2 + 1]), x + colW - 28, y + 8);
        mctx.textAlign = 'left';
      }
    });
    mctx.fillStyle = '#d8b8a0';
    mctx.font = '14px monospace';
    mctx.fillText(tfStr('经济  采矿 ${mined}  深钻 ${drill}  · 余额最高 ${peak} / 最低 ${low}', {
      mined: s.resourcesMined || 0, drill: s.passiveIncome || 0,
      peak: s.moneyPeak || 0, low: s.moneyLow || 0,
    }), px + 40, gridY + 154);

    mctx.fillStyle = '#ffd27d';
    mctx.font = 'bold 16px monospace';
    mctx.fillText(tStr('本局成就'), px + 40, gridY + 190);
    const badges = s.achievements || [];
    mctx.font = '14px monospace';
    if (badges.length) {
      let bx = px + 40;
      for (const badge of badges) {
        const label = tStr(badge);
        const bw = Math.max(104, label.length * 18 + 24);
        mctx.fillStyle = 'rgba(224,76,58,0.24)';
        mctx.fillRect(bx, gridY + 218, bw, 32);
        mctx.strokeStyle = '#ffd27d';
        mctx.strokeRect(bx, gridY + 218, bw, 32);
        mctx.fillStyle = '#fff0c2';
        mctx.fillText('◆ ' + label, bx + 10, gridY + 226);
        bx += bw + 12;
      }
    } else {
      mctx.fillStyle = '#9e8f83';
      mctx.fillText(tStr('尚未解锁成就，再战一局试试。'), px + 40, gridY + 226);
    }

    const bw = 220, bh = 44, bx = W / 2 - bw / 2, by = py + ph - 62;
    render.endActionRect = { x: bx, y: by, w: bw, h: bh };
    const m = RS.input.mouse;
    const hov = m.x >= bx && m.x <= bx + bw && m.y >= by && m.y <= by + bh;
    mctx.fillStyle = hov ? 'rgba(224,76,58,0.58)' : 'rgba(46,127,217,0.35)';
    mctx.fillRect(bx, by, bw, bh);
    mctx.strokeStyle = hov ? '#ffd27d' : '#2e7fd9';
    mctx.strokeRect(bx, by, bw, bh);
    mctx.fillStyle = '#e8f2f8';
    mctx.font = '16px monospace';
    mctx.textAlign = 'center';
    mctx.fillText(tStr('返回标题'), W / 2, by + 12);
    mctx.textAlign = 'left';
    mctx.textBaseline = 'top';
  }

  function endHit(cx, cy) {
    const r = render.endActionRect;
    return !!(r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

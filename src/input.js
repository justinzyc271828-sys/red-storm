/* 输入:Pointer Events 统一鼠标与触摸。
 * 鼠标:左键 点选/框选;双击选同类;右键 智能指令;Z+左键 攻击移动;
 *      滚轮缩放;中键/边缘/WASD/方向键 移镜头。
 * 触屏:单指拖动=移镜头;双指捏合=缩放(结束后剩指续拖);点按=选择/智能指令
 *      (点到自己人=选择,点到空地且有选中=移动,点敌=攻击);长按=右键(攻击/集结点);
 *      建造栏/小地图/生产面板点按同样生效。
 * 左Alt+1=全选步兵与火箭兵,左Alt+2=全选作战载具;P=暂停,M=静音,Esc=取消/清选;
 * 切到其他标签页时自动暂停,返回后自动继续;普通窗口失焦只清按键状态。 */
(function (RS) {
  'use strict';

  const input = RS.input = {
    keys: new Set(),
    mouse: { x: 0, y: 0, inside: false, pointerType: 'mouse' },
    dragging: false,
    selectBox: null,
    buildMode: null,
    amMode: false,
    init,
  };

  let lastX = 0, lastY = 0, dragId = null;
  let selStart = null, selId = null;
  let touchStart = null;
  let lastClick = { time: 0, unit: null };
  const pointers = new Map();   // 双指捏合追踪
  let pinchDist = 0;
  let lastGroupKey = '', lastGroupAt = 0;
  let visibilityPaused = false;
  let titleSecretClicks = 0, titleSecretAt = 0;

  function fieldGuideAction(action) {
    if (!action) return;
    if (action === 'close') RS.game.closeFieldGuide();
    else if (action === 'prev') RS.game.setFieldGuidePage(RS.game.guidePage - 1);
    else if (action === 'next') RS.game.setFieldGuidePage(RS.game.guidePage + 1);
    else if (action.startsWith('page:')) RS.game.setFieldGuidePage(Number(action.slice(5)));
  }

  function applyZoom(factor, anchorX, anchorY) {
    const cfg = RS.config.camera;
    const cx = Number.isFinite(anchorX) ? anchorX : window.innerWidth / 2;
    const cy = Number.isFinite(anchorY) ? anchorY : window.innerHeight / 2;
    const before = RS.render && RS.render.clientToWorld ? RS.render.clientToWorld(cx, cy) : null;
    const next = Math.max(cfg.minZoom, Math.min(cfg.maxZoom, RS.camera.zoom * factor));
    if (next === RS.camera.zoom) return;
    RS.camera.zoom = next;
    if (before) {
      const p = RS.iso.toScreen(before.x, before.y);
      const s = RS.config.RENDER_SCALE / next;
      RS.camera.x = p.x - (cx - window.innerWidth / 2) * s;
      RS.camera.y = p.y - (cy - window.innerHeight / 2) * s;
    }
  }

  function quickSelect(group, e) {
    const hit = RS.game.selectUnitGroup(group, e.shiftKey);
    if (!hit.length) return;
    const now = performance.now();
    if (lastGroupKey === group && now - lastGroupAt < 450) {
      const x = hit.reduce((sum, u) => sum + u.x, 0) / hit.length;
      const y = hit.reduce((sum, u) => sum + u.y, 0) / hit.length;
      RS.camera.centerOnWorld(x, y);
    }
    lastGroupKey = group;
    lastGroupAt = now;
  }

  function deploySelectedDrillRig() {
    const sel = [...RS.game.selection];
    if (sel.length !== 1 || sel[0].kind !== 'drillRig') return false;
    RS.game.deployDrillRig(sel[0]);
    return true;
  }

  function init(canvas) {
    window.addEventListener('keydown', e => {
      if (RS.game.guideOpen) {
        if (e.code === 'Escape') fieldGuideAction('close');
        else if (e.code === 'ArrowLeft' || e.code === 'PageUp')
          fieldGuideAction('prev');
        else if (e.code === 'ArrowRight' || e.code === 'PageDown' || e.code === 'Space')
          fieldGuideAction('next');
        if (['Escape', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Space'].includes(e.code))
          e.preventDefault();
        return;
      }
      input.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
      const leftAlt = input.keys.has('AltLeft');
      const group = leftAlt && e.code === 'Digit1' ? 'infantry'
        : leftAlt && e.code === 'Digit2' ? 'vehicle' : null;
      if (group && RS.game.state === 'playing') {
        e.preventDefault();
        if (!e.repeat) quickSelect(group, e);
      }
      if (e.code === 'KeyZ' && !e.repeat && RS.game.state === 'playing') input.amMode = true; // Z + 左键 = 攻击移动
      if (e.code === 'KeyD' && !e.repeat && RS.game.state === 'playing') {
        if (deploySelectedDrillRig()) e.preventDefault();
      }
      if (e.code === 'KeyP' && !e.repeat && RS.game.state === 'playing') {
        RS.game.paused = !RS.game.paused; // P = 暂停/继续
        visibilityPaused = false;
      }
      if (e.code === 'KeyM' && !e.repeat && RS.audio.toggleMute) RS.audio.toggleMute(); // M = 静音
      if (e.code === 'KeyH' && !e.repeat && RS.game.state === 'playing') RS.game.toggleHoldFire(); // H = 停火/自由开火
      if (e.code === 'Escape') {
        if (input.amMode) input.amMode = false;
        else if (input.buildMode) input.buildMode = null;
        else if (RS.game.buildingSel) RS.game.clearBuildingSel();
        else RS.game.clearSelection();
      }
    });
    window.addEventListener('keyup', e => input.keys.delete(e.code));
    window.addEventListener('blur', () => {
      input.keys.clear();
    });
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        input.keys.clear();
        if (document.hidden) {
          if (RS.game.state === 'playing' && !RS.game.paused) {
            RS.game.paused = true;
            visibilityPaused = true;
          }
        } else if (visibilityPaused && RS.game.state === 'playing') {
          RS.game.paused = false;
          visibilityPaused = false;
        }
      });
    }
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (RS.game.guideOpen) return;
      if (e.deltaY === 0) return; // 横向滚动不缩放
      const modeScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const delta = Math.max(-240, Math.min(240, e.deltaY * modeScale));
      applyZoom(Math.exp(-delta * RS.config.camera.wheelRate), e.clientX, e.clientY);
    }, { passive: false });

    canvas.addEventListener('pointerdown', e => {
      const firstAudioGesture = RS.audio.unlock();
      input.mouse.pointerType = e.pointerType;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        touchStart = null; // 双指接管,取消单指拖动判定
      }

      // 剧情简报/过场/结局覆盖层优先消费点击；战斗阶段仍走正常 RTS 输入。
      if (RS.campaign && RS.campaign.capturesInput && RS.campaign.capturesInput()) {
        if (e.button === 0) RS.campaign.handleAction(RS.campaign.hit(e.clientX, e.clientY));
        return;
      }

      // 图鉴覆盖层优先消费全部点击；只认明确的翻页/关闭控件。
      if (RS.game.guideOpen) {
        if (e.button === 0) fieldGuideAction(RS.render.fieldGuideHit(e.clientX, e.clientY));
        return;
      }
      // 标题屏:选难度开局
      if (RS.game.state === 'title') {
        const now = performance.now();
        if (e.button === 0 && RS.render.titleLogoHit(e.clientX, e.clientY)) {
          if (now - titleSecretAt > 1200) titleSecretClicks = 0;
          titleSecretAt = now;
          titleSecretClicks++;
          if (titleSecretClicks >= 5) {
            titleSecretClicks = 0;
            RS.game.openFieldGuide('title');
          }
          return;
        }
        titleSecretClicks = 0;
        if (firstAudioGesture) return; // 第一次点击留在封面,让标题曲真正开始
        const d = RS.render.titleHit(e.clientX, e.clientY);
        if (d === 'campaign') {
          if (RS.campaign && RS.campaign.open) RS.campaign.open();
          return;
        }
        if (d === 'storm-toggle') { RS.game.stormWanted = !RS.game.stormWanted; return; } // 沙暴模式开关:只切换不开局
        if (d) RS.game.startGame(d, { storm: !!RS.game.stormWanted });
        return;
      }
      // 结算屏:只认明确按钮，避免玩家阅读战报时任意点击误重载。
      if (RS.game.state === 'won' || RS.game.state === 'lost') {
        if (e.button === 0 && RS.render.endHit(e.clientX, e.clientY) &&
          typeof location !== 'undefined') location.reload();
        return;
      }
      // 手动暂停中仅左键继续;右键不改变暂停状态,避免误恢复并吞掉一次指令。
      if (RS.game.paused) {
        if (e.button === 0) RS.game.paused = false;
        return;
      }
      const tutorialAction = RS.render.tutorialHit(e.clientX, e.clientY);
      if (tutorialAction) {
        if (e.button === 0 && tutorialAction !== 'panel')
          RS.game.tutorialAction(tutorialAction);
        return;
      }
      if (e.pointerType === 'touch') {
        if (pointers.size === 1) {
          touchStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false, longFired: false };
          lastX = e.clientX; lastY = e.clientY;
          canvas.setPointerCapture(e.pointerId);
        }
        e.preventDefault();
        return;
      }
      if (e.button === 1) {
        input.dragging = true; dragId = e.pointerId;
        lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button === 0) {
        if (RS.render.fireModeHit(e.clientX, e.clientY)) {
          RS.game.toggleHoldFire();
          return;
        }
        if (RS.render.unitActionHit(e.clientX, e.clientY)) {
          deploySelectedDrillRig();
          return;
        }
        if (RS.render.buildingActionHit(e.clientX, e.clientY)) {
          RS.game.recycleBuilding(RS.game.buildingSel);
          return;
        }
        // 小地图:点击跳转镜头
        const mm = RS.render.minimapHit(e.clientX, e.clientY);
        if (mm) { RS.camera.centerOnWorld(mm.x, mm.y); return; }
        if (RS.game.buildingSel) {
          const pk = RS.render.prodHit(e.clientX, e.clientY);
          if (pk) { RS.game.enqueueUnit(RS.game.buildingSel, pk); return; }
        }
        const hit = RS.render.paletteHit(e.clientX, e.clientY);
        if (hit) { input.buildMode = input.buildMode === hit ? null : hit; return; }
        if (input.buildMode) {
          const w = RS.render.clientToWorld(e.clientX, e.clientY);
          const t = RS.iso.tileOf(w.x, w.y);
          const def = RS.config.buildings[input.buildMode];
          const i = t.i - Math.floor(def.n / 2), j = t.j - Math.floor(def.m / 2);
          if (RS.game.startConstruction(input.buildMode, i, j)) input.buildMode = null;
          return;
        }
        // 攻击移动模式(Z 键 + 左键落点)
        if (input.amMode) {
          input.amMode = false;
          const fighters = [...RS.game.selection].filter(u => RS.units.TYPES[u.kind].dmg);
          if (fighters.length) {
            const w = RS.render.clientToWorld(e.clientX, e.clientY);
            if (RS.game.recordMainAttack) RS.game.recordMainAttack(fighters, w.x, w.y);
            RS.combat.attackMoveGroup(fighters, w.x, w.y);
            RS.game.markers.push({ x: w.x, y: w.y, t: RS.game.time, kind: 'attack' });
          }
          return;
        }
        if (RS.render.guideTerminalHit(e.clientX, e.clientY)) {
          RS.game.openFieldGuide('terminal');
          return;
        }
        selStart = { x: e.clientX, y: e.clientY };
        selId = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 2) {
        if (input.selectBox) { input.selectBox = null; selStart = null; return; } // 框选进行中右键 = 取消框选
        if (input.buildMode) { input.buildMode = null; return; }
        // 右键不穿透 UI(小地图/建造栏上的右键只是误触,不下达指令)
        if (RS.render.minimapHit(e.clientX, e.clientY) || RS.render.paletteHit(e.clientX, e.clientY) ||
            RS.render.unitActionHit(e.clientX, e.clientY) || RS.render.fireModeHit(e.clientX, e.clientY) ||
            RS.render.buildingActionHit(e.clientX, e.clientY) ||
            RS.render.tutorialHit(e.clientX, e.clientY)) return;
        const w = RS.render.clientToWorld(e.clientX, e.clientY);
        if (RS.game.buildingSel) {
          const pk = RS.render.prodHit(e.clientX, e.clientY);
          if (pk) { RS.game.cancelLastUnit(RS.game.buildingSel); return; }
          RS.game.buildingSel.rally = { x: w.x, y: w.y };
          RS.game.markers.push({ x: w.x, y: w.y, t: RS.game.time });
          return;
        }
        if (RS.game.commandAttack(w.x, w.y)) return;
        RS.game.commandSmart(w.x, w.y);
      }
    });

    canvas.addEventListener('pointermove', e => {
      input.mouse.x = e.clientX; input.mouse.y = e.clientY;
      input.mouse.inside = true;
      input.mouse.pointerType = e.pointerType;
      const k = RS.config.RENDER_SCALE / (RS.camera.zoom || 1); // 1 客户端像素 = k 场景像素(随缩放换算,越近越不"滑")

      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // 双指捏合缩放
      if (pointers.size === 2 && pinchDist > 0) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0) applyZoom(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchDist = d;
        return;
      }

      if (e.pointerType === 'touch' && touchStart && e.pointerId === touchStart.id) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        if (Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y) > 10) touchStart.moved = true;
        if (touchStart.moved) {
          RS.camera.x -= dx * k; RS.camera.y -= dy * k;
        } else if (!touchStart.longFired && performance.now() - touchStart.t > 500) {
          touchStart.longFired = true; // 长按 = 右键(攻击/集结点)
          longPress(e.clientX, e.clientY);
        }
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      if (input.dragging && e.pointerId === dragId) {
        RS.camera.x -= (e.clientX - lastX) * k;
        RS.camera.y -= (e.clientY - lastY) * k;
        lastX = e.clientX; lastY = e.clientY;
        return;
      }
      if (selStart && e.pointerId === selId) {
        if (Math.hypot(e.clientX - selStart.x, e.clientY - selStart.y) > 6)
          input.selectBox = { x0: selStart.x, y0: selStart.y, x1: e.clientX, y1: e.clientY };
        else
          input.selectBox = null;
      }
    });

    canvas.addEventListener('pointerup', e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      // 捏合结束:剩下的那根手指接管镜头拖动(不中断)
      if (pointers.size === 1 && e.pointerType === 'touch') {
        const [rest] = [...pointers.entries()];
        touchStart = { x: rest[1].x, y: rest[1].y, t: performance.now(), id: rest[0], moved: true, longFired: true };
        lastX = rest[1].x; lastY = rest[1].y;
      }
      if (e.pointerType === 'touch' && touchStart && e.pointerId === touchStart.id) {
        const quick = performance.now() - touchStart.t < 500;
        if (!touchStart.moved && !touchStart.longFired && quick) tapRoute(e.clientX, e.clientY);
        touchStart = null;
        return;
      }
      if (input.dragging && e.pointerId === dragId) { input.dragging = false; dragId = null; return; }
      if (selStart && e.pointerId === selId) {
        if (input.selectBox) boxSelect(e.shiftKey);
        else clickSelect(e.clientX, e.clientY, e.shiftKey);
        input.selectBox = null;
        selStart = null; selId = null;
      }
    });

    canvas.addEventListener('pointercancel', e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      input.dragging = false; input.selectBox = null; selStart = null; touchStart = null;
    });
    canvas.addEventListener('pointerleave', () => { input.mouse.inside = false; });
  }

  // 触屏点按:与左键同一命中链;点到自己人=选择,点到别处且有选中=智能指令
  function tapRoute(cx, cy) {
    if (RS.render.fireModeHit(cx, cy)) {
      RS.game.toggleHoldFire();
      return;
    }
    if (RS.render.unitActionHit(cx, cy)) {
      deploySelectedDrillRig();
      return;
    }
    if (RS.render.buildingActionHit(cx, cy)) {
      RS.game.recycleBuilding(RS.game.buildingSel);
      return;
    }
    const mm = RS.render.minimapHit(cx, cy);
    if (mm) { RS.camera.centerOnWorld(mm.x, mm.y); return; }
    if (RS.game.buildingSel) {
      const pk = RS.render.prodHit(cx, cy);
      if (pk) { RS.game.enqueueUnit(RS.game.buildingSel, pk); return; }
    }
    const hit = RS.render.paletteHit(cx, cy);
    if (hit) { input.buildMode = input.buildMode === hit ? null : hit; return; }
    const w = RS.render.clientToWorld(cx, cy);
    if (input.buildMode) {
      const t = RS.iso.tileOf(w.x, w.y);
      const def = RS.config.buildings[input.buildMode];
      const i = t.i - Math.floor(def.n / 2), j = t.j - Math.floor(def.m / 2);
      if (RS.game.startConstruction(input.buildMode, i, j)) input.buildMode = null;
      return;
    }
    if (RS.render.guideTerminalHit(cx, cy)) {
      RS.game.openFieldGuide('terminal');
      return;
    }
    const u = pickUnit(w.x, w.y);
    if (u && u.owner === 'player') { clickSelect(cx, cy, false); return; }
    const b = RS.game.pickBuildingAt(w.x, w.y);
    if (b && b.owner === 'player') { clickSelect(cx, cy, false); return; }
    if (RS.game.selection.size) {
      if (!RS.game.commandAttack(w.x, w.y)) RS.game.commandSmart(w.x, w.y);
      return;
    }
    clickSelect(cx, cy, false);
  }

  // 长按 = 右键:选中建筑设集结点,否则攻击/智能指令
  function longPress(cx, cy) {
    const w = RS.render.clientToWorld(cx, cy);
    if (RS.game.buildingSel) {
      RS.game.buildingSel.rally = { x: w.x, y: w.y };
      RS.game.markers.push({ x: w.x, y: w.y, t: RS.game.time });
      return;
    }
    if (!RS.game.commandAttack(w.x, w.y)) RS.game.commandSmart(w.x, w.y);
  }

  function pickUnit(wx, wy) {
    let best = null, bd = 0.7;
    for (const u of RS.game.units) {
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  function clickSelect(cx, cy, shift) {
    const w = RS.render.clientToWorld(cx, cy);
    const u = pickUnit(w.x, w.y);
    const now = performance.now();

    if (u && u.owner === 'player' && lastClick.unit === u && now - lastClick.time < 350) {
      const same = RS.game.units.filter(v => v.owner === 'player' && v.kind === u.kind && Math.hypot(v.x - u.x, v.y - u.y) < 15);
      RS.game.addSelect(same);
      lastClick = { time: 0, unit: null };
      return;
    }
    lastClick = { time: now, unit: u };

    if (u && u.owner === 'player') {
      if (shift) RS.game.addSelect([u]);
      else RS.game.selectOnly([u]);
      return;
    }
    const b = RS.game.pickBuildingAt(w.x, w.y);
    if (b && b.owner === 'player') { RS.game.selectBuilding(b); return; }
    if (!shift) {
      RS.game.clearSelection();
      RS.game.clearBuildingSel();
    }
  }

  function boxSelect(shift) {
    const b = input.selectBox;
    const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
    const y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
    const hit = RS.game.units.filter(u => {
      if (u.owner !== 'player') return false;
      const c = RS.render.worldToClient(u.x, u.y);
      return c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1;
    });
    if (shift) RS.game.addSelect(hit);
    else RS.game.selectOnly(hit);
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

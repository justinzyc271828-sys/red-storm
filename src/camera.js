/* 镜头:场景像素坐标下的视野中心,支持 WASD/方向键/边缘滚屏/拖拽,带边界钳制(由地图尺寸推算)。
 * 攻击移动在 Z 键(input.js),与 WASD 无冲突。 */
(function (RS) {
  'use strict';

  const cam = RS.camera = {
    x: 0, y: 0, zoom: RS.config.camera.defaultZoom || 1,
    update, centerOnWorld,
  };

  function centerOnWorld(wx, wy) {
    const p = RS.iso.toScreen(wx, wy);
    cam.x = p.x; cam.y = p.y;
  }

  function clamp() {
    const HW = RS.config.TILE_W / 2, HH = RS.config.TILE_H / 2;
    const mx = RS.config.MAP_W * HW + 200;
    const my1 = (RS.config.MAP_W + RS.config.MAP_H) * HH + 400;
    cam.x = Math.max(-mx, Math.min(mx, cam.x));
    cam.y = Math.max(-300, Math.min(my1, cam.y));
  }

  function update(dt) {
    const cfg = RS.config.camera, keys = RS.input.keys, m = RS.input.mouse;
    let dx = 0, dy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
    const zoomScale = 1 / (cam.zoom || 1); // 各缩放档保持相近的屏幕平移速度
    cam.x += dx * cfg.keySpeed * dt * zoomScale;
    cam.y += dy * cfg.keySpeed * dt * zoomScale;
    // 边缘滚屏(仅鼠标、且不在拖拽时)
    if (m.inside && !RS.input.dragging && m.pointerType === 'mouse') {
      const w = window.innerWidth, h = window.innerHeight, e = cfg.edgeSize;
      if (m.x < e) cam.x -= cfg.edgeSpeed * dt * zoomScale;
      if (m.x > w - e) cam.x += cfg.edgeSpeed * dt * zoomScale;
      if (m.y < e) cam.y -= cfg.edgeSpeed * dt * zoomScale;
      if (m.y > h - e) cam.y += cfg.edgeSpeed * dt * zoomScale;
    }
    clamp();
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

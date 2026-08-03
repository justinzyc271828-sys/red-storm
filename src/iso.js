/* 等距投影:世界坐标(格,浮点)↔ 场景屏幕坐标(像素)
 * 2:1 菱形(dimmetric)。逻辑层全部是正方形网格,只有渲染与点选用这套变换。 */
(function (RS) {
  'use strict';

  const TW = RS.config.TILE_W, TH = RS.config.TILE_H;
  const HW = TW / 2, HH = TH / 2;

  RS.iso = {
    toScreen(wx, wy, out) {
      out = out || {};
      out.x = (wx - wy) * HW;
      out.y = (wx + wy) * HH;
      return out;
    },
    toWorld(sx, sy, out) {
      out = out || {};
      out.x = (sx / HW + sy / HH) / 2;
      out.y = (sy / HH - sx / HW) / 2;
      return out;
    },
    tileOf(wx, wy) {
      return { i: Math.floor(wx), j: Math.floor(wy) };
    },
    // 世界运动方向(弧度)→ 精灵 8 朝向索引(0=+x 世界,逆时针? 顺时针按屏幕)
    dir8(dx, dy) {
      const ang = Math.atan2(dy, dx);
      return ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    },
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

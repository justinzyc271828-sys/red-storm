/* 敌方阵营美术:优先使用真正的敌方独立素材(art/enemy/*),
 * 缺失的品类退回"蓝色 → 铁灰橙"换色兜底。跑动帧同步处理。 */
(function (RS) {
  'use strict';

  function tintCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    let img;
    try { img = x.getImageData(0, 0, c.width, c.height); } catch (e) { return src; }
    if (!img || !img.data || !img.data.length) return src;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (b > r + 25 && b > g + 5) {
        const l = (r + g + b) / 3;
        d[i] = Math.min(255, Math.round(l * 1.5 + 22));
        d[i + 1] = Math.round(l * 0.78);
        d[i + 2] = Math.round(l * 0.42);
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  function mirrored(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.translate(img.width, 0); x.scale(-1, 1);
    x.drawImage(img, 0, 0);
    return c;
  }

  const DIR8MAP = [0, 0, 2, 2, 3, 1, 1, 0]; // 与 sprites.js 相同的世界 8 向映射
  function isoAnchor(img) { return { canvas: img, ax: img.width / 2, ay: img.height - 3 }; }
  function isoUnitDirs(fr, br) {
    const dirs = [isoAnchor(fr), isoAnchor(br), isoAnchor(mirrored(fr)), isoAnchor(mirrored(br))];
    return DIR8MAP.map(i => dirs[i]);
  }
  function isoBuildingAnchor(img, drop) {
    return { canvas: img, ax: img.width / 2, ay: img.height - drop };
  }
  function isoBuildingDirs(fr, br, drop) {
    const dirs = [
      isoBuildingAnchor(fr, drop), isoBuildingAnchor(br, drop),
      isoBuildingAnchor(mirrored(fr), drop), isoBuildingAnchor(mirrored(br), drop),
    ];
    return DIR8MAP.map(i => dirs[i]);
  }
  function loadImage(uri) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = uri;
    });
  }

  const UNIT_FILES = {
    harvester: 'harvester', infantry: 'infantry', rocket: 'rocket',
    'light-tank': 'lightTank', 'heavy-tank': 'heavyTank', artillery: 'artillery',
    mech: 'mech', // 遗迹战甲敌方版(enemy-mech-fr/br,缺失自动换色兜底)
  };
  const BUILDING_DROP = {
    cc: 48, power: 32, refinery: 40, barracks: 32, factory: 48, turret: 32, deepMine: 32,
  };

  function tintUnits(dirs) { return dirs.map(s => ({ canvas: tintCanvas(s.canvas), ax: s.ax, ay: s.ay })); }

  function init() {
    const S = RS.sprites;
    S.enemy = { units: {}, buildings: {} };
    const art = RS.artData || {};
    const names = Object.keys(art).filter(n => n.startsWith('enemy-'));
    const IM = {};
    return Promise.all(names.map(n => loadImage(art[n]).then(img => { IM[n] = img; }).catch(() => {})))
      .then(() => {
        // 单位:敌方独立等距图优先(br 缺省时用 fr 代),否则换色
        for (const file of Object.keys(UNIT_FILES)) {
          const kind = UNIT_FILES[file];
          if (!S.units[kind]) continue;
          const fr = IM['enemy-' + file + '-fr'], br = IM['enemy-' + file + '-br'] || fr;
          S.enemy.units[kind] = fr ? isoUnitDirs(fr, br) : tintUnits(S.units[kind]);
        }
        // 其余兵种(喷火/维修等):一律换色兜底,保证渲染永不缺精灵
        for (const kind of Object.keys(S.units))
          if (!S.enemy.units[kind] && S.units[kind]) S.enemy.units[kind] = tintUnits(S.units[kind]);
        // 炮塔转向素材(敌方):有独立素材用独立素材,没有就用我方换色
        if (IM['enemy-turret-aim-fr'] || (S.turretAim && S.turretAim.player)) {
          S.turretAim = S.turretAim || {};
          const fr = IM['enemy-turret-aim-fr'], br = IM['enemy-turret-aim-br'] || fr;
          S.turretAim.enemy = fr ? isoBuildingDirs(fr, br, 32)
            : S.turretAim.player.map(s => ({ canvas: tintCanvas(s.canvas), ax: s.ax, ay: s.ay }));
        }
        // 敌方炮管组件(第十轮)
        if (IM['enemy-turret-top'] || (S.turretTop && S.turretTop.player)) {
          S.turretTop = S.turretTop || {};
          S.turretTop.enemy = IM['enemy-turret-top'] || tintCanvas(S.turretTop.player);
        }
        // 敌方固定底座:独立素材优先,缺失时由我方底座换色兜底
        if (IM['enemy-turret-base'] || (S.turretBase && S.turretBase.player)) {
          S.turretBase = S.turretBase || {};
          const img = IM['enemy-turret-base'] || tintCanvas(S.turretBase.player.canvas);
          S.turretBase.enemy = { canvas: img, ax: img.width / 2, ay: img.height - 32 };
        }
        // 建筑:敌方独立图优先,否则换色
        for (const type of Object.keys(S.buildings)) {
          if (IM['enemy-' + type]) {
            const img = IM['enemy-' + type];
            S.enemy.buildings[type] = {
              canvas: img, ax: img.width / 2,
              ay: img.height - (BUILDING_DROP[type] || 32),
            };
          } else {
            S.enemy.buildings[type] = Object.assign({}, S.buildings[type], { canvas: tintCanvas(S.buildings[type].canvas) });
          }
        }
        // 跑动帧(换色即可)
        if (S.unitsWalk) {
          S.enemy.unitsWalk = {};
          for (const kind of Object.keys(S.unitsWalk))
            S.enemy.unitsWalk[kind] = S.unitsWalk[kind].map(tintUnits);
        }
      });
  }

  RS.enemyArt = { init };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

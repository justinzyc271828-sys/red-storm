/* 地图随机化测试:多种子布局合法性 + 经典布局兼容。
 * 运行:node test/map-test.js */
'use strict';
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');

const RS = globalThis.RS;
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

// 1. 经典布局(默认种子 1337)保持兼容
RS.map.gen();
check('经典玩家基地', RS.map.playerBase.i === 30 && RS.map.playerBase.j === 98);
check('经典主矿', RS.map.oreAt(22, 92) > 0);

// 2. 多随机种子:布局合法
let oreNearOk = true, clearOk = true, distOk = true, specialOk = true, noDecorOk = true, droneCountOk = true;
for (const seed of [42, 777, 2024, 555, 99999]) {
  RS.map.gen(seed);
  const PB = RS.map.playerBase, AB = RS.map.aiBase;
  const dist = Math.hypot(PB.i - AB.i, PB.j - AB.j);
  if (dist < 80) distOk = false;
  // 主矿在基地 10 格内
  const oreNear = (b) => {
    for (const t of RS.map.oreTiles) if (Math.hypot(t.i - b.i, t.j - b.j) < 10) return true;
    return false;
  };
  if (!oreNear(PB) || !oreNear(AB)) oreNearOk = false;
  // 基地落点无阻挡
  if (RS.map.isBlocked(PB.i, PB.j + 2) || RS.map.isBlocked(AB.i - 2, AB.j - 2)) clearOk = false;
  // 特殊物:骸骨/晶簇带矿,且存在时挡路
  const droneCount = RS.map.specials.filter(s => s.type === 'drone').length;
  if (droneCount < 3 || droneCount > 5) droneCountOk = false;
  for (const s of RS.map.specials) {
    if ((s.type === 'bone' || s.type === 'bigcrystal') && RS.map.oreAt(s.i, s.j) <= 0) specialOk = false;
    if (!RS.map.isBlocked(s.i, s.j)) specialOk = false;
  }
  // 基地/中立矿净空区:无装饰(挡路树会卡死出生点)
  const W = RS.config.MAP_W, H = RS.config.MAP_H;
  const zones = [[PB.i, PB.j, 15], [AB.i, AB.j, 15],
    [RS.map.neutralOres[0].i, RS.map.neutralOres[0].j, 9], [RS.map.neutralOres[1].i, RS.map.neutralOres[1].j, 9]];
  for (const [zx, zy, zr] of zones)
    for (let j = Math.max(0, zy - zr); j <= Math.min(H - 1, zy + zr); j++)
      for (let i = Math.max(0, zx - zr); i <= Math.min(W - 1, zx + zr); i++)
        if (Math.abs(i - zx) + Math.abs(j - zy) < zr && RS.map.tiles[j][i].d !== 0) noDecorOk = false;
}
check('双方基地间距 ≥ 80', distOk);
check('双方主矿贴近基地', oreNearOk);
check('基地落点无阻挡', clearOk);
check('骸骨/晶簇均可采集', specialOk);
check('每张地图生成 3–5 架坠毁无人机', droneCountOk);
check('基地/矿点净空区无装饰', noDecorOk);

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

/* 战地图鉴回归：清单完整、地图终端合法、标题/游戏中打开与暂停恢复语义。 */
'use strict';

globalThis.RS = {};
require('../src/config.js');
require('../src/iso.js');
require('../src/map.js');
require('../src/units.js');
require('../src/field-guide.js');
require('../src/game.js');

const RS = globalThis.RS;
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name + (detail ? '  (' + detail + ')' : ''));
  else { failures++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}

RS.gameSeed = 1337;
RS.game.init();

const unitKeys = Object.keys(RS.units.TYPES).sort();
const guideUnits = [...RS.fieldGuide.unitOrder].sort();
check('图鉴覆盖全部兵种且无重复',
  guideUnits.length === new Set(guideUnits).size &&
  JSON.stringify(guideUnits) === JSON.stringify(unitKeys));

const buildingKeys = Object.keys(RS.config.buildings).sort();
const guideBuildings = [...RS.fieldGuide.buildingOrder].sort();
check('图鉴覆盖全部建筑且无重复',
  guideBuildings.length === new Set(guideBuildings).size &&
  JSON.stringify(guideBuildings) === JSON.stringify(buildingKeys));

const terminal = RS.game.guideTerminal;
const ti = terminal && Math.floor(terminal.x), tj = terminal && Math.floor(terminal.y);
check('每局生成一个地图远角档案终端', !!terminal);
check('档案终端落在合法可通行空地',
  !!terminal && RS.map.inBounds(ti, tj) && !RS.map.isBlocked(ti, tj) &&
  RS.map.oreAt(ti, tj) === 0);
check('档案终端远离双方基地',
  !!terminal &&
  Math.hypot(terminal.x - RS.map.playerBase.i, terminal.y - RS.map.playerBase.j) >= 18 &&
  Math.hypot(terminal.x - RS.map.aiBase.i, terminal.y - RS.map.aiBase.j) >= 18);

RS.game.state = 'title';
RS.game.paused = false;
check('标题页可打开图鉴', RS.game.openFieldGuide('title') && RS.game.guideOpen);
check('标题页图鉴不伪造暂停状态', RS.game.paused === false);
RS.game.setFieldGuidePage(99);
check('图鉴页码上限受控', RS.game.guidePage === RS.fieldGuide.pageCount - 1);
RS.game.setFieldGuidePage(-3);
check('图鉴页码下限受控', RS.game.guidePage === 0);
check('标题页可关闭图鉴', RS.game.closeFieldGuide() && !RS.game.guideOpen);

RS.game.state = 'playing';
RS.game.paused = false;
RS.game.openFieldGuide('terminal');
check('游戏中打开图鉴会冻结战局', RS.game.guideOpen && RS.game.paused);
RS.game.closeFieldGuide();
check('关闭图鉴恢复原本未暂停的战局', !RS.game.guideOpen && !RS.game.paused);

RS.game.paused = true;
RS.game.openFieldGuide('terminal');
RS.game.closeFieldGuide();
check('原本已暂停的战局关闭图鉴后仍暂停', RS.game.paused);

console.log(failures === 0 ? '\n全部通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);

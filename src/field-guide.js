/* 赤曜战地图鉴：运行时页面顺序与说明文字。
 * 完整数值图鉴保存在 docs/图鉴/红色风暴-战地图鉴.md；这里保留适合游戏内阅读的短版。 */
(function (RS) {
  'use strict';

  RS.fieldGuide = {
    title: '赤曜战地档案',
    subtitle: 'RS-FIELD-04 · 双方同型单位基础数值完全一致',
    pageCount: 5,
    unitOrder: [
      'infantry', 'rocket', 'lightTank', 'heavyTank', 'artillery',
      'flametank', 'repair', 'harvester', 'drillRig', 'drone', 'mech',
    ],
    buildingOrder: ['cc', 'power', 'refinery', 'barracks', 'factory', 'turret', 'deepMine'],
    counters: [
      ['密集步兵', '喷火战车 / 自行火炮'],
      ['重型装甲', '火箭兵 / 火炮集火'],
      ['防御炮塔', '火炮 + 前方观察手'],
      ['自行火炮', '轻坦 / 战斗无人机'],
      ['战斗无人机', '火箭兵 / 防御炮塔 / 遗迹战甲 / 无人机'],
      ['深层开采站', '无人机袭扰 / 切断电力'],
    ],
    achievements: [
      ['战场清道夫', '击毁 10 个敌方单位'],
      ['攻城先锋', '摧毁 3 座敌方建筑'],
      ['零损突击', '击毁 5 个单位且零损失'],
      ['矿业大亨', '累计采集 5000 资源'],
      ['钢铁洪流', '生产 20 个单位'],
      ['速战速决', '15 分钟内获胜'],
      ['不屈防线', '失败时坚持 15 分钟'],
    ],
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

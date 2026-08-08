/* 全局配置与数据表 —— 数值来源:docs/M0-设计稿.md */
(function (RS) {
  'use strict';

  RS.config = {
    TILE_W: 64,          // 菱形瓦片宽(场景像素)
    TILE_H: 32,          // 菱形瓦片高
    MAP_W: 128,
    MAP_H: 128,
    RENDER_SCALE: 0.5,   // 场景按 0.5 离屏渲染,再放大 2 倍输出(像素颗粒感)
    SIM_STEP: 1 / 30,    // 固定逻辑步长(秒)

    startMoney: 1000,

    harvester: {
      speed: 2.2,        // 格/秒
      capacity: 300,     // 满载矿石量
      harvestRate: 60,   // 每秒采集量(满载需 5 秒)
      unloadTime: 1.0,   // 卸矿耗时(秒)
      hp: 300,
    },

    ore: {
      mainPerTile: 400,    // 主矿每格储量(2026-07-26 由 300 提升:悬崖从 ~5-6 分钟推回 ~8-10 分钟,Justin 裁决)
      neutralPerTile: 250, // 中立矿每格储量(81 格 ≈ 20000,2026-07-25 起升值:让中场扩张值得打——真人侧激励,bot 矩阵无感)
    },

    // 深层经济不按时间解锁：先把地表矿格采空，钻探车才能在枯竭矿区展开。
    deepEconomy: {
      deployRadius: 5,
      deployMinDepleted: 12,
      tierDepleted: [12, 20, 32],
      tierPayout: [10, 15, 20], // 每 incomeTick 秒结算一次
      incomeTick: 5,
      maxPerOwner: 2,
      minSpacing: 14,           // 同一片矿区只能容纳一座深层开采站
    },

    camera: {
      defaultZoom: 0.85,  // 开局略微拉远,先看清基地周边
      minZoom: 0.42,      // 可继续拉远到战略视野
      maxZoom: 2.2,
      wheelRate: 0.0013,  // 按滚轮 delta 连续缩放,兼容触控板的小幅滚动
      keySpeed: 700,     // 键盘平移速度(场景像素/秒)
      edgeSize: 24,      // 边缘滚屏触发区(屏幕像素)
      edgeSpeed: 700,
    },

    // 建筑数据表(docs/M0-设计稿.md 第 5 节);power 正=供电 负=耗电
    // 血量经自对弈调平:降低约 30%,让坚决的进攻能拆动基地
    buildings: {
      cc:       {
        name: '指挥中心', cost: 0, power: 20, hp: 1800, buildTime: 0, n: 3, m: 3,
        selfRepairRate: 2, selfRepairDelay: 10,
      },
      power:    { name: '太阳能电站', cost: 300, power: 50,  hp: 380,  buildTime: 6,  n: 2, m: 2 },
      refinery: { name: '精炼厂',     cost: 600, power: -15, hp: 500,  buildTime: 8,  n: 3, m: 2, givesHarvester: true },
      barracks: { name: '兵营',       cost: 400, power: -10, hp: 350,  buildTime: 8,  n: 2, m: 2, produces: ['infantry', 'rocket'] },
      factory:  { name: '战车工厂',   cost: 800, power: -20, hp: 650,  buildTime: 12, n: 3, m: 3, produces: ['lightTank', 'heavyTank', 'artillery', 'flametank', 'repair', 'harvester', 'drillRig'] },
      turret:   {
        name: '防御炮塔', cost: 500, power: -15, hp: 450, buildTime: 8, n: 2, m: 2,
        // 炮塔武器统一放在配置层:先转向瞄准,进入容差角后才允许开火。
        weapon: {
          dmg: 18, range: 6, rof: 0.95, vsVehicle: 1, vsAir: 1.4,
          canHitAir: true, proj: 'shell',
          turnRate: 7, aimTolerance: 0.14, scanInterval: 0.12,
        },
      }, // 真实占地 2×2,与圆形底座视觉一致;火炮仍可在射程外克制
      deepMine: {
        name: '深层开采站', cost: 900, power: -35, hp: 360, buildTime: 0, n: 2, m: 2,
        deployedOnly: true,
      },
    },
    buildRadius: 8,      // 新建筑距已有建筑的最大距离(格)
    buildingRecycleRatio: 0.6, // 成品建筑回收 60%;施工中取消全额退款
    lowPowerFactor: 0.5, // 电力不足时建造/生产速度倍率

    // 战斗通用(单位数值在 units.js TYPES;索敌/还击/追击规则在 combat.js)
    combat: {
      assistRadius: 7,   // 单位遇袭时的协防半径(格)
      defendRadius: 12,  // 建筑遇袭时的基地协防半径(格;仍限武器射程 2.5 倍,只动员够得着的)
    },

    // 沙暴模式(可选,2026-07-25 设计 v3):随机时刻大沙暴压制视野并吹出遗迹,
    // 统一替代 25/30 分钟闹钟;关模式时以下全部不生效。
    storm: {
      triggerMin: 900, triggerMax: 1380, // T ∈ [15,23] 分钟(种子随机)
      warnLead: 60,            // 预警提前量(秒)
      waveDelayBuffer: 45,     // T±45s 内在途波次延迟 60s(双方对等预移动窗)
      waveDelay: 60,
      visionUnit: 3, visionBuilding: 5, visionDrone: 5, // 沙暴视野钳制
      bleedDelay: 300,         // T 起建筑双倍伤;T+300s 起 CC 流血(替代 1500/1800)
      relicMinBaseDist: 25, relicOreClearance: 4, // 遗迹:距双方基地 25 格;不压矿点(4 格内无矿即可)
      relicPathDiff: 0.15, relicPathDiffMax: 0.25,   // 双方 A* 路长差上限(不足则放宽)
      relicRevealDelay: 90,    // T+90s 遗迹全图明牌
      repairSeconds: 120,      // 单方修理池所需修理·秒(1 辆 120s,2 辆 60s)
      repairDecayDelay: 30, repairDecayRate: 0.01,     // 中断 30s 后每秒衰减 1%
      mechNoFireBuildings: 90, // 激活后 90s 不可对建筑开火
      oreVisitedParity: false, // 雾中对等审计第 4 项:实测 AI 矿车周期性断矿发呆(受损 >10%),按协议回退记档
    },
  };

  // 可复现随机流:game.init 播种,AI/战斗共用(bot-match 同种子可复现)
  let _rs = 1;
  RS.srand = seed => { _rs = (seed >>> 0) || 1; };
  RS.rnd = () => { _rs = (_rs * 1664525 + 1013904223) >>> 0; return _rs / 4294967296; };

  // Node 测试兜底:浏览器由 index.html 显式加载 i18n.js;Node 测试只 require
  // 各模块,若尚无 RS.i18n 则自动带上,保证 t() 在测试环境可用(默认 zh)。
  if (!RS.i18n && typeof require !== 'undefined') {
    try { require('./i18n.js'); } catch (_) { /* 浏览器无 require,忽略 */ }
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

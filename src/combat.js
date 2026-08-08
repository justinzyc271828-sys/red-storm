/* 战斗引擎(DOM 无关,可 Node 仿真):索敌/开火/弹道/伤害/克制/溅射/死亡、
 * 防御炮塔(缺电停摆)、还击、攻击指令、攻击移动(attackMove:边推进边交战)。
 * 追击规则:玩家明确攻击指令(aggro='cmd')永不脱战;自动还击才有脱战距离。
 * 移动职责:attackMove 与 aggro 追击的移动都在这里(game.update 跳过这两类,
 * 绝不双移动);不可达目标限频重寻,连续失败放弃而不是每帧全图 A*。 */
(function (RS) {
  'use strict';

  const combat = RS.combat = {
    projectiles: [],
    explosions: [],
    update, attackCommand, attackMoveGroup, destroyBuilding, canAttackTarget,
  };

  const SCAN = 0.3;
  const PROJ_SPEED = { bullet: 26, shell: 12, rocket: 11, arty: 9, flame: 18 };
  const TURRET = RS.config.buildings.turret.weapon;

  function sfx(n) { if (RS.audio) RS.audio.sfx(n); }
  function isBuilding(t) { return t.cx !== undefined; }
  function isAir(t) {
    return !isBuilding(t) && !!(RS.units.TYPES[t.kind] && RS.units.TYPES[t.kind].air);
  }
  function canWeaponTarget(w, target) {
    return !!target && (!isAir(target) || !!w.canHitAir);
  }
  function canAttackTarget(u, target) {
    const w = u && RS.units.TYPES[u.kind];
    return !!(w && w.dmg && canWeaponTarget(w, target));
  }
  function alive(t) { return t && t.hp > 0 && !t.destroyed; }
  function posOf(t) { return isBuilding(t) ? { x: t.cx, y: t.cy } : { x: t.x, y: t.y }; }
  function visibleToOwner(owner, target) {
    if (!target) return true;
    const p = posOf(target);
    // AI 的情报层本来就使用与玩家对等的 车辆7/步兵6/建筑9 视野；
    // 战斗层读取双方各自的 0.5 秒视野缓存，既公平也避免逐目标三重扫描。
    const V = owner === 'player' ? RS.map.visible : RS.map.enemyVisible;
    if (!V) return true;
    const i = Math.floor(p.x), j = Math.floor(p.y);
    return i >= 0 && j >= 0 && i < RS.config.MAP_W && j < RS.config.MAP_H &&
      V[j * RS.config.MAP_W + i] === 1;
  }

  function distToTarget(u, t) {
    if (!isBuilding(t)) return Math.hypot(t.x - u.x, t.y - u.y);
    const dx = Math.max(t.i - u.x, 0, u.x - (t.i + t.n));
    const dy = Math.max(t.j - u.y, 0, u.y - (t.j + t.m));
    return Math.hypot(dx, dy);
  }

  function acquire(x, y, range, owner, minRange, weapon) {
    let best = null, bd = range;
    for (const v of RS.game.units) {
      if (v.owner === owner || v.hp <= 0 || !visibleToOwner(owner, v) ||
        !canWeaponTarget(weapon || {}, v)) continue;
      const d = Math.hypot(v.x - x, v.y - y);
      if (d <= bd && !(minRange && d < minRange)) { bd = d; best = v; }
    }
    return best;
  }

  // 无人机采用离散任务优先级，避免近处诱饵把它从经济袭扰目标上拽走：
  // 深层开采/精炼/电站 > 矿车 > 普通坦克/步兵/敌方无人机 > 普通建筑 >
  // 会对空的火箭兵/遗迹战甲。最后一档仍可自卫，但不会主动迎着防空火力换血。
  function droneTargetScore(target, distance) {
    let tier;
    if (isBuilding(target)) {
      tier = ({ deepMine: 0, refinery: 0, power: 0.1, factory: 2 }[target.type]);
      if (tier === undefined) tier = 2.5;
    } else if (target.kind === 'harvester') {
      tier = 0.5;
    } else if (target.kind === 'drillRig') {
      tier = 0.6;
    } else if (target.kind === 'rocket' || target.kind === 'mech') {
      tier = 4;
    } else if (target.kind === 'repair') {
      tier = 2;
    } else if (target.kind === 'drone') {
      tier = 1.2;
    } else if (target.kind === 'infantry' || target.vehicle) {
      tier = 1;
    } else {
      tier = 2;
    }
    return tier * 1000 + distance * (0.6 + 0.4 * (target.hp / target.maxHp));
  }

  // 加权索敌:常规单位按距离 ÷ 克制倍率、残血优先；无人机按上面的袭扰任务分层。
  function pickTarget(u, w) {
    let best = null, bs = Infinity;
    for (const v of RS.game.units) {
      if (v.owner === u.owner || v.hp <= 0 || !visibleToOwner(u.owner, v) ||
        !canWeaponTarget(w, v)) continue;
      const d = Math.hypot(v.x - u.x, v.y - u.y);
      if (d > w.range || (w.minRange && d < w.minRange)) continue;
      const mult = isAir(v) ? (w.vsAir || 1)
        : v.vehicle ? (w.vsVehicle || 1) : (w.vsInfantry || 1);
      const score = u.kind === 'drone'
        ? droneTargetScore(v, d)
        : d / mult * (0.6 + 0.4 * (v.hp / v.maxHp));
      if (score < bs) { bs = score; best = v; }
    }
    for (const b of RS.game.buildings) {
      if (b.owner === u.owner || b.destroyed || !visibleToOwner(u.owner, b)) continue;
      if (u.noFireBuildingsUntil && RS.game.time < u.noFireBuildingsUntil) continue; // 遗迹战甲:激活后 90s 禁对建筑开火
      const d = distToTarget(u, b);
      if (d > w.range || (w.minRange && d < w.minRange)) continue;
      const score = u.kind === 'drone'
        ? droneTargetScore(b, d)
        : d / (w.vsBuilding || 1) * (0.6 + 0.4 * (b.hp / b.maxHp));
      if (score < bs) { bs = score; best = b; }
    }
    return best;
  }

  function fire(shooter, sx, sy, w, target) {
    const tp = posOf(target);
    const dist = Math.hypot(tp.x - sx, tp.y - sy);
    combat.projectiles.push({
      x: sx, y: sy, tx: tp.x, ty: tp.y,
      t: 0, dur: Math.max(0.05, dist / PROJ_SPEED[w.proj]),
      dmg: w.dmg, splash: w.splash || 0, vsVehicle: w.vsVehicle || 1,
      vsBuilding: w.vsBuilding || 1, vsInfantry: w.vsInfantry || 1,
      vsAir: w.vsAir || 1, canHitAir: !!w.canHitAir,
      victim: target, shooter, owner: shooter.owner, kind: w.proj,
    });
    if (!isBuilding(shooter)) shooter.dir = RS.iso.dir8(tp.x - sx, tp.y - sy);
    sfx('shot_' + w.proj);
  }

  function applyDamage(target, rawDmg, vsVehicle, attacker, vsBuilding, vsInfantry, vsAir, creditAttacker) {
    if (isBuilding(target) && RS.game.suddenDeath) rawDmg *= 2; // 沙暴加剧
    const mult = isBuilding(target) ? (vsBuilding || 1)
      : isAir(target) ? (vsAir || 1)
        : (target.vehicle ? vsVehicle : (vsInfantry || 1));
    target.hp -= rawDmg * mult;
    target.lastDamageT = RS.game.time;
    if (!isBuilding(target) && target.hp > 0 && attacker && !isBuilding(attacker) && attacker.hp > 0) {
      const w = RS.units.TYPES[target.kind];
      if (w.dmg && !target.holdFire && !target.target && canWeaponTarget(w, attacker) &&
        visibleToOwner(target.owner, attacker)) {
        target.target = attacker; target.aggro = true;
      }
    }
    // 协防:附近闲置友军看到同伴被打 → 一起上。单位遇袭限 7 格;建筑遇袭动员范围
    // 扩到 defendRadius(12 格,基地另一头也醒来);两种都限武器射程 2.5 倍——只动员
    // 够得着的,避免守军全员离位追击远征军(24 格不限射程实测 normal 1/9 破带,已回退)。
    // 停火单位(holdFire)不参与协防。
    if (attacker && !isBuilding(attacker) && attacker.hp > 0) {
      const tp2 = posOf(target);
      const assistR = isBuilding(target) ? RS.config.combat.defendRadius : RS.config.combat.assistRadius;
      for (const u of RS.game.units) {
        if (u.owner !== target.owner || u === target || u.hp <= 0) continue;
        const w2 = RS.units.TYPES[u.kind];
        if (!w2.dmg || u.holdFire || !canWeaponTarget(w2, attacker) || u.target || u.attackMove || u.path) continue;
        if (Math.hypot(u.x - tp2.x, u.y - tp2.y) > assistR) continue;
        if (visibleToOwner(u.owner, attacker) &&
          Math.hypot(attacker.x - u.x, attacker.y - u.y) <= w2.range * 2.5) {
          u.target = attacker; u.aggro = true;
        }
      }
    }
    // 遇袭警报(只对玩家):建筑/矿车被打 → 警报音 + 战场标记
    if (target.owner === 'player' && RS.game.state === 'playing') {
      RS.game.enemyContactUntil = Math.max(RS.game.enemyContactUntil || 0, RS.game.time + 8);
      if (isBuilding(target) || target.kind === 'harvester') {
        RS.game.markers.push({ x: posOf(target).x, y: posOf(target).y, t: RS.game.time, kind: 'attack' });
        sfx('warn');
      }
    }
    if (target.hp <= 0) {
      target.hp = 0;
      const credited = creditAttacker || attacker;
      if (isBuilding(target)) destroyBuilding(target, credited);
      else killUnit(target, credited);
    }
  }

  function killUnit(u, attacker) {
    RS.game.recordUnitDestroyed(u, attacker);
    combat.explosions.push({ x: u.x, y: u.y, t: 0, dur: 0.55, r: u.vehicle ? 24 : 14 });
    addScar(u.x, u.y, u.vehicle ? 1.3 : 0.8, 90); // 战痕:残骸烧蚀地面
    RS.game.selection.delete(u);
    if (u.kind === 'harvester') RS.game.releaseClaims(u); // 矿格认领随车死亡释放,不挂死引用
  }

  // 战痕:爆炸烧蚀地面,随时间淡出(渲染层有 AI 焦痕贴图就用,否则程序化)
  function addScar(x, y, r, dur) {
    const G = RS.game;
    if (!G.scars) G.scars = [];
    G.scars.push({ x, y, r, t: 0, dur, v: G.scars.length % 2 });
    if (G.scars.length > 150) G.scars.shift();
  }

  function destroyBuilding(b, attacker) {
    if (b.destroyed) return;
    RS.game.recordBuildingDestroyed(b, attacker);
    b.destroyed = true;
    RS.game.refundQueue(b); // 队列全额退款:被毁不蒸发生产资金(与手动取消同约定)
    for (let y = b.j; y < b.j + b.m; y++)
      for (let x = b.i; x < b.i + b.n; x++) RS.map.setBlocked(x, y, false);
    combat.explosions.push({ x: b.cx, y: b.cy, t: 0, dur: 0.9, r: 44 });
    addScar(b.cx, b.cy, Math.max(b.n, b.m) * 1.2, 300); // 建筑废墟烧蚀更持久
    if (RS.game.buildingSel === b) RS.game.clearBuildingSel();
    sfx('bigExplosion');
  }

  function attackCommand(units, target) {
    let assigned = 0;
    for (const u of units) {
      if (!canAttackTarget(u, target)) continue;
      // 清旧编队速度与旧攻击移动:混编途中改攻击令,快车不被旧最慢速拖住,
      // 也不捡起几分钟前的旧 attackMove 目的地"自己跑了"
      u.target = target; u.aggro = 'cmd'; u.path = null; u.dest = null; u.groupSpeed = null; u.attackMove = null;
      assigned++;
    }
    return assigned;
  }

  // 群体攻击移动:编队落点(不再全挤一个坐标)+ 速度分档同速(快/慢两群各自取最慢,
  // 快车能前出,慢车不脱节);发令前清掉旧路径/旧目标/AI 侧标志(hunt/retreat),
  // 防止旧集结路径吞掉新命令、猎杀标志劫持改派
  function attackMoveGroup(units, x, y) {
    const targets = RS.units.formationTargets(units, x, y);
    const FAST = 2.2;
    const fast = units.filter(u => u.speed >= FAST), slow = units.filter(u => u.speed < FAST);
    const fSp = fast.length > 1 ? Math.min(...fast.map(u => u.speed)) : null;
    const sSp = slow.length > 1 ? Math.min(...slow.map(u => u.speed)) : null;
    units.forEach((u, k) => {
      u.attackMove = { x: targets[k].x, y: targets[k].y };
      u.groupSpeed = u.speed >= FAST ? fSp : sSp;
      u.path = null; u.dest = null; u.target = null; u.aggro = false;
      u.hunt = null; u.retreat = false; u.amT = 0; u.amFails = 0;
    });
  }

  function updateProjectiles(dt) {
    const G = RS.game;
    for (let k = combat.projectiles.length - 1; k >= 0; k--) {
      const p = combat.projectiles[k];
      p.t += dt;
      if (p.t < p.dur) continue;
      combat.projectiles.splice(k, 1);
      const v = p.victim;
      let directHit = false;
      if (alive(v) && Math.hypot(posOf(v).x - p.tx, posOf(v).y - p.ty) < 1.0) {
        applyDamage(v, p.dmg, p.vsVehicle, p.shooter, p.vsBuilding, p.vsInfantry, p.vsAir);
        directHit = true;
      }
      if (p.splash) {
        for (const u2 of G.units) {
          // 主目标若已躲开直击但仍在爆区内,也应吃到溅射;否则慢速火炮会对
          // 所有移动单位稳定打出 0 伤害。直击命中时仍避免对同一目标重复结算。
          if ((u2 === v && directHit) || u2 === p.shooter || u2.hp <= 0) continue;
          if (u2.owner === p.owner) continue; // 溅射不伤友军
          if (isAir(u2) && !p.canHitAir) continue;
          const d = Math.hypot(u2.x - p.tx, u2.y - p.ty);
          if (d <= p.splash)
            applyDamage(u2, p.dmg * 0.6, p.vsVehicle, null,
              p.vsBuilding, p.vsInfantry, p.vsAir, p.shooter);
        }
        for (const b of G.buildings) {
          if (b.destroyed || b.owner === p.owner) continue;
          const d = Math.hypot(b.cx - p.tx, b.cy - p.ty);
          if (d <= p.splash) applyDamage(b, p.dmg * 0.6, 1, null,
            p.vsBuilding, undefined, undefined, p.shooter);
        }
      }
      combat.explosions.push({ x: p.tx, y: p.ty, t: 0, dur: 0.45, r: p.splash ? 26 : 12 });
      // 轻武器/喷火保留短促命中声;炮弹、火箭与火炮才使用重型爆炸成品音效。
      sfx(p.kind === 'shell' || p.kind === 'rocket' || p.kind === 'arty' ? 'explosion' : 'impact');
    }
    for (let i = G.units.length - 1; i >= 0; i--) if (G.units[i].hp <= 0) G.units.splice(i, 1);
    for (let i = G.buildings.length - 1; i >= 0; i--) if (G.buildings[i].destroyed) G.buildings.splice(i, 1);
  }

  function update(dt) {
    const G = RS.game;

    for (const u of G.units) {
      const w = RS.units.TYPES[u.kind];
      if (!w.dmg) continue;
      u.cool = Math.max(0, (u.cool || 0) - dt);
      u.scanT = (u.scanT === undefined ? (RS.rnd ? RS.rnd() : Math.random()) * SCAN : u.scanT) - dt;
      if (u.target && !alive(u.target)) { u.target = null; u.aggro = false; u.path = null; u.dest = null; }
      if (u.target && !canWeaponTarget(w, u.target)) {
        u.target = null; u.aggro = false; u.path = null; u.dest = null;
      }
      if (u.target && !visibleToOwner(u.owner, u.target)) {
        u.target = null; u.aggro = false; u.path = null; u.dest = null;
      }

      // 攻击移动:只在武器射程内接战(就地开火,绝不追击),保持队形持续推进
      if (!u.target && u.attackMove) {
        const e = pickTarget(u, w);
        if (e) { u.target = e; u.aggro = false; }
      }
      if (!u.target && u.scanT <= 0) {
        u.scanT = SCAN;
        // 站岗索敌:克制加权的射程内目标(RA 式就地开火);停火单位不自动索敌
        if (!u.holdFire) u.target = pickTarget(u, w);
      }

      if (!u.target) {
        if (u.attackMove) {
          if (!u.path || !u.path.length) {
            // 限频重寻(0.5s),连续 8 次不可达放弃推进(龟缩死角不再每帧全图 A*)
            u.amT = (u.amT || 0) - dt;
            if (u.amT <= 0) {
              u.amT = 0.5;
              if (RS.units.setPath(u, u.attackMove.x, u.attackMove.y)) u.amFails = 0;
              else {
                u.amFails = (u.amFails || 0) + 1;
                if (u.amFails > 8) { u.attackMove = null; u.groupSpeed = null; u.amFails = 0; continue; }
              }
            }
          }
          if (u.path && u.path.length && RS.units.moveAlongPath(u, dt)) { u.attackMove = null; u.groupSpeed = null; u.amFails = 0; u.post = { x: u.x, y: u.y }; }
        }
        continue;
      }

      const tp = posOf(u.target);
      const d = distToTarget(u, u.target);
      const inRange = d <= w.range && !(w.minRange && d < w.minRange);
      if (inRange) {
        u.path = null;
        if (u.cool <= 0) { fire(u, u.x, u.y, w, u.target); u.cool = 1 / w.rof; }
      } else if (u.aggro) {
        if (u.aggro !== 'cmd' && d > w.range * 3) {
          u.target = null; u.aggro = false; u.dest = null;
          // 哨兵返岗:被钓鱼离岗的自动走回哨位(有 post 记忆)
          if (!u.attackMove && u.post && Math.hypot(u.x - u.post.x, u.y - u.post.y) > 6) RS.units.setPath(u, u.post.x, u.post.y);
          continue;
        }
        if (w.minRange && d < w.minRange) { u.target = null; u.aggro = false; u.path = null; continue; } // 贴脸打不了,不空追
        u.repathT = (u.repathT || 0) - dt;
        if (!u.path && u.repathT <= 0) {
          u.repathT = 0.6;
          if (RS.units.setPath(u, tp.x, tp.y)) u.chaseFails = 0;
          else { // 连续不可达放弃追击(兑现"失败放弃,不每帧全图 A*"),哨兵顺带回岗
            u.chaseFails = (u.chaseFails || 0) + 1;
            if (u.chaseFails > 8) {
              u.chaseFails = 0; u.target = null; u.aggro = false;
              if (!u.attackMove && u.post && Math.hypot(u.x - u.post.x, u.y - u.post.y) > 6) RS.units.setPath(u, u.post.x, u.post.y);
              continue;
            }
          }
        }
        if (u.path) RS.units.moveAlongPath(u, dt);
      } else {
        u.target = null;
      }
    }

    // 防御炮塔:定期索敌 → 持续跟踪转向 → 进入瞄准容差后开火。
    // 谁缺电谁停摆;目标死亡或出射程立即放手,不会越图狙杀。
    for (const b of G.buildings) {
      if (b.type !== 'turret' || !b.done || b.destroyed) continue;
      b.muzzleT = Math.max(0, (b.muzzleT || 0) - dt);
      if (G.lowPower(b.owner)) continue;
      b.cool = Math.max(0, (b.cool || 0) - dt);
      b.scanT = Math.max(0, (b.scanT || 0) - dt);
      if (b.target && (!alive(b.target) || !visibleToOwner(b.owner, b.target) ||
        Math.hypot(b.target.x - b.cx, b.target.y - b.cy) > TURRET.range)) b.target = null;
      if (!b.target && b.scanT <= 0) {
        b.target = acquire(b.cx, b.cy, TURRET.range, b.owner, 0, TURRET);
        b.scanT = TURRET.scanInterval || SCAN;
      }
      if (b.target) {
        const want = Math.atan2(b.target.y - b.cy, b.target.x - b.cx);
        let dA = want - b.aim;
        while (dA > Math.PI) dA -= Math.PI * 2;
        while (dA < -Math.PI) dA += Math.PI * 2;
        const turn = TURRET.turnRate * dt; // 默认转向速度 ~286°/s
        b.aim += Math.abs(dA) <= turn ? dA : Math.sign(dA) * turn;
        b.aimDir = RS.iso.dir8(Math.cos(b.aim), Math.sin(b.aim));
        const remaining = Math.max(0, Math.abs(dA) - turn);
        if (remaining <= TURRET.aimTolerance && b.cool <= 0) {
          const mx = b.cx + Math.cos(b.aim) * 0.9;
          const my = b.cy + Math.sin(b.aim) * 0.9;
          fire(b, mx, my, TURRET, b.target);
          b.cool = 1 / TURRET.rof;
          b.muzzleT = 0.12;
        }
      }
    }

    updateProjectiles(dt);

    for (let k = combat.explosions.length - 1; k >= 0; k--) {
      combat.explosions[k].t += dt;
      if (combat.explosions[k].t >= combat.explosions[k].dur) combat.explosions.splice(k, 1);
    }
  }
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

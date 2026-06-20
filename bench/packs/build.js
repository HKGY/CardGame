'use strict';
/* 建造包（build）策略模块 ——
 * 核心机制：建筑 game.buildings（上限 5），每回合开始 _buildingsTick 自动触发：
 *   arrowtower → 对当前目标造 (4×L + 工坊bonus) 的 _dealRaw 伤害
 *   rampart    → 玩家获得 (4×L + 工坊bonus) 格挡
 *   furnace    → 玩家获得 (1×L + 工坊bonus) 力量
 *   workshop   → 使其它建筑每次触发 +L（加法 bonus）
 * 拆解（demolish）：拆最早建筑、立即触发 3×L 次
 * 减益：工伤(hpLoss 每次自伤3)、坍塌(摧毁建筑)、沉降(全体-L)
 *
 * 通用 V 盲区：buildings 跨回合持久，V 完全看不见，AI 几乎不建造。
 *
 * 设计要点：
 *   1. battle 钩子给建筑「未来产出」的折现价值，让 AI 愿意建造。
 *   2. 量级控制：不能让 AI 为建造牺牲攻击（会 STUCK），building bonus 需远小于直接攻击价值。
 *   3. gem 钩子：建造宝石有引擎价值，但混有 hazard(hpLoss) 的宝石要额外惩罚
 *      （因为每次出牌都自伤 3HP，平均 3 次/场 = 9HP 损失，远超引擎收益）。
 *   4. 工伤(hazard/hpLoss)、坍塌(collapse)、沉降(subside)需合理定价。
 */
const value = require('../value');

// 工坊总加成
function _workshopBonus(buildings) {
  return buildings.filter(b => b.kind === 'workshop').reduce((s, b) => s + (b.power || 0), 0);
}

// 粗估剩余回合数（min 1，max 6）
function _estTurnsLeft(g) {
  const alive = g.aliveEnemies();
  if (!alive.length) return 0;
  let ehp = 0; for (const e of alive) ehp += e.hp;
  // 箭塔伤害纳入计算
  const wb = _workshopBonus(g.buildings || []);
  let towerDmg = 0;
  for (const b of (g.buildings || [])) {
    if (b.kind === 'arrowtower') towerDmg += (b.power || 0) + wb;
  }
  const str = g.player.statuses.strength || 0;
  const perTurn = Math.max(8, 8 + str * 2 + towerDmg * 0.5);
  return Math.min(6, Math.max(1, Math.ceil(ehp / perTurn)));
}

value.registerPack('build', {
  battle(CG, g) {
    const buildings = g.buildings;
    if (!buildings || !buildings.length) return 0;
    const turnsLeft = _estTurnsLeft(g);
    if (turnsLeft <= 0) return 0;

    const wb = _workshopBonus(buildings);
    let v = 0;

    for (const b of buildings) {
      const effectivePower = (b.kind === 'workshop') ? b.power : ((b.power || 0) + wb);

      if (b.kind === 'arrowtower') {
        // 箭塔每回合 _dealRaw effectivePower（穿格挡直接扣血）
        // 1 点伤害价值 1.5（通用 -ehp×1.5）× 剩余回合 × 0.45 折现
        v += effectivePower * 1.5 * turnsLeft * 0.45;
      } else if (b.kind === 'rampart') {
        // 路障每回合给格挡。格挡有价值但容易过守导致 STUCK，保守估值（防止 AI 龟）。
        v += effectivePower * turnsLeft * 0.2;
      } else if (b.kind === 'furnace') {
        // 熔炉每回合叠力量（乘法雪球）。已叠的力量在 V 里已有 strength×6，
        // 这里只估「未来还没叠的层」的价值。
        // 每新叠 1 层力量约值 3（下一回合）到更少（远期），取 2.5×futureTurns
        const futureTurns = Math.max(0, turnsLeft - 1);
        v += effectivePower * futureTurns * 2.5;
      } else if (b.kind === 'workshop') {
        // 工坊与其它建筑配合才有价值
        const others = buildings.filter(x => x.kind !== 'workshop');
        if (others.length > 0) {
          v += b.power * others.length * turnsLeft * 0.35;
        }
        // 无其它建筑时几乎无价值
      }
    }

    // 前 3 回合建造价值稍高（后续触发次数多）
    if (g.turn <= 3) v *= 1.2;

    return v;
  },

  gem(CG, gem) {
    let v = 0;
    let hasBuild = false;
    let hasHpLoss = false;
    let hasCollapse = false;
    let hasSubside = false;

    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.build) hasBuild = true;
      if (d.hpLoss && d.debuff) hasHpLoss = true;
      if (d.collapse) hasCollapse = true;
      if (d.subside) hasSubside = true;
    }

    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      if (d.build) {
        // 建造宝石是引擎件，通用 score=4 低估了每回合触发的持续价值。
        // 但若同颗宝石带有 hpLoss(hazard)，建造收益需要被摊销到自伤代价上。
        let bonus;
        switch (d.build) {
          case 'arrowtower': bonus = 4 * a.level; break;   // 每回合伤害
          case 'rampart':    bonus = 2 * a.level; break;   // 每回合格挡（保守）
          case 'furnace':    bonus = 5 * a.level; break;   // 每回合力量（乘法）
          case 'workshop':   bonus = 2 * a.level; break;   // 放大器
          default:           bonus = 2 * a.level;
        }
        // 若同颗宝石还有 hazard(hpLoss)：完全取消建造加成（净效果：自伤 > 引擎收益）
        // hazard=每次出牌自伤 3HP；平均出 3 次 = 9HP 自伤（≈ 0.75 条命），不值
        if (hasHpLoss) bonus = 0;
        v += bonus;
      }

      if (d.demolish) {
        // 拆解：一次性爆发，需有建筑才有价值
        v += 2 * a.level;
      }

      // 减益加重惩罚（覆盖通用 score×debuff=×1.3）
      if (d.collapse) {
        // 坍塌=摧毁己方建筑，核心引擎被摧毁，代价极大
        v -= 4 * a.level;
      }
      if (d.subside) {
        // 沉降=全体建筑效果削弱，长期损失
        v -= 2 * a.level;
      }
      // hazard(工伤)：每次出牌自伤 3HP，每场平均出牌 3 次 = 9HP 自伤。
      // 通用 score=-3×1.3=-3.9 严重低估——额外追加惩罚使混入建造宝石后不被安装。
      if (d.hpLoss && d.debuff) v -= 3 * a.level;
    }

    // 若宝石同时有坍塌/沉降 + 建造：额外大幅惩罚（会自毁引擎）
    if (hasBuild && (hasCollapse || hasSubside)) {
      v -= 6;  // 自毁引擎宝石：基本不装
    }

    return v;
  },

  install(CG, gem, card) {
    let b = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      // 建造宝石装攻击卡略优先（早出早建造，且 strike 更频繁打出）
      if (d.build && card.base === 'strike') b += 0.05;
      if (d.demolish && card.base === 'strike') b += 0.07;
    }
    return b;
  },
});

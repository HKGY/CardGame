'use strict';
/* 强化包（enhance）策略模块 —— M3 模式：通过 value.registerPack 注入估值钩子。
 *
 * 机制要点（全部是「本场永久」，战斗结束即清零，不跨场）：
 *   - temper(锤炼)：每次打出本牌 growth+L → 反复打同一张牌雪球。
 *   - whet(磨砺)：打出后随机手牌 growth+L → 扩散成长到其他牌。
 *   - awaken(觉醒)：累计打出 3 次后 growth+5L → 需积累 3 次，高爆发。
 *   - quench(淬火)：随机手牌永久降费 1 → 提高出牌效率，复利。
 *   - resonance(共鸣)：数值 + 本牌已镶嵌宝石数 × L → 鼓励宝石堆在一张卡上。
 *   - overforge(过锻)：growth≥6 时打出后碎裂 → 双刃剑，与 temper 组合有风险。
 *   - anneal(退火)：随机手牌 growth-L → 破坏成长积累。
 *   - stress(应力)：失血 → 通用 V 已能感知。
 *
 * 通用 V 的盲点：
 *   ① 只看当前 cardStats().value（已含 growth），看不到「下回合这张牌更强」的潜力。
 *   ② 不知道 awaken 需 3 次才爆发，不会追打 plays<3 的觉醒牌。
 *   ③ 已降费的牌（costDown）的复利效果（以后每回合都能多打一张）通用 V 低估。
 *   ④ resonance 宝石集中装同一张卡比分散更有收益。
 *
 * 标度：1 点价值 ≈ 0.083 血 ≈ 0.67 敌血；「值半条命的铺垫」≈ +6。
 *   本模块单次最多加分约 15~25，量级合理。
 */
const value = require('../value');

// 从一张卡的所有宝石孔位中，统计某个词条字段的总量
function sumAffix(CG, card, field) {
  let total = 0;
  for (const socket of (card.sockets || [])) {
    for (const a of (socket.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (d && d[field]) total += d[field] * a.level;
    }
  }
  return total;
}

// 判断一张卡是否装了某类强化词条（用 field 名判断）
function hasEnhanceAffix(CG, card) {
  for (const socket of (card.sockets || [])) {
    for (const a of (socket.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (d && (d.temper || d.awaken || d.quench || d.whet || d.resonance)) return true;
    }
  }
  return false;
}

value.registerPack('enhance', {
  /**
   * 局面附加分：奖励已积累的成长状态与近期可触发的觉醒潜力。
   * 在每步出牌搜索的克隆局面上调用（只读）。
   */
  battle(CG, g) {
    let v = 0;
    const allCards = [...g.hand, ...g.drawPile, ...g.discardPile];

    for (const card of allCards) {
      const growth = card.growth || 0;
      const plays = card.plays || 0;
      const awakened = card.awakened || false;
      const costDown = card.costDown || 0;

      // ① 已积累的 growth：是「已投资」的回报，加分让 AI 倾向继续打已有成长的牌。
      //    每点 growth 价值约 0.67 点敌血；×1.5 略加权（反复打同一张牌强）。
      if (growth > 0) {
        v += growth * 1.0;
      }

      // ② 觉醒（awaken）进度奖励：
      //    还没觉醒且有 awaken 词条 → 按已打次数给折扣价值（越接近触发越值钱）。
      //    如果成功触发了 awakened=true，growth 已经加进去了，① 会体现。
      if (!awakened) {
        const awakenN = sumAffix(CG, card, 'awaken');
        if (awakenN > 0 && plays > 0) {
          // plays=1 → 33% 折扣，plays=2 → 66% 折扣；每次 +5×L 的期望收益
          v += (plays / 3) * 5 * awakenN * 0.7;
        }
      }

      // ③ 已降费（quench 效果）的牌：每降 1 费 = 后续每回合潜在多出 1 张牌的机会。
      //    约值 2-3 点（一个能量 ≈ 0.5~1 张牌 ≈ 1~2 点伤害/格挡）。
      if (costDown > 0) {
        v += costDown * 2.0;
      }
    }

    // ④ 锤炼（temper）潜力：手牌中有 temper 词条的牌，越早打越多轮复利。
    //    只在早回合（turn<=4）给小额奖励，避免过度压倒生存。
    if (g.turn <= 4) {
      for (const card of g.hand) {
        const temperN = sumAffix(CG, card, 'temper');
        if (temperN > 0) {
          v += temperN * 1.2;   // 鼓励早打 temper 牌以启动雪球
        }
        const awakenN = sumAffix(CG, card, 'awaken');
        const plays = card.plays || 0;
        if (awakenN > 0 && plays < 3 && !card.awakened) {
          v += awakenN * 1.5;   // 早回合追打觉醒牌加成
        }
      }
    }

    return v;
  },

  /**
   * 宝石价值附加分：给延迟收益类词条（temper/awaken/quench）额外权重，
   * 补偿通用 gemValueGeneric 只看 score 字段、看不到复利潜力的问题。
   */
  gem(CG, gem, ctx) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      // temper：雪球引擎核心，每场战斗内增量价值随打出次数线性增长
      if (d.temper) {
        v += 2.0 * a.level;
      }

      // awaken：累计 3 次爆发，峰值很高（+5×L per trigger）
      if (d.awaken) {
        v += 2.5 * a.level;
      }

      // quench：每场战斗降费，复利效应可观
      if (d.quench) {
        v += 2.0 * a.level;
      }

      // resonance：随宝石数增长；给小额额外加权（通用 score=3 已是基础）
      if (d.resonance) {
        const run = ctx && ctx.run;
        const maxSockets = run ? Math.max(0, ...run.deck.map(c => (c.sockets || []).length)) : 0;
        // maxSockets=1 → +0.5，maxSockets=2 → +1.0，不超过 1.5
        v += d.resonance * a.level * Math.min(maxSockets * 0.5, 1.5);
      }

      // whet：扩散成长，收益分散但稳定
      if (d.whet) {
        v += 1.5 * a.level;
      }

      // overforge：风险随成长积累，适度加重 debuff 扣分
      if (d.overforge) {
        v -= 2.0;
      }

      // anneal：破坏已有成长，强化包内格外有害
      if (d.anneal) {
        v -= 2.0 * a.level;
      }
    }
    return v;
  },

  /**
   * 安装契合度附加分：
   *   - resonance 宝石装在已有多颗宝石的卡上收益最大（安装后自身也+1宝石）。
   *   - temper/awaken 装在基础数值高的攻击卡上 ROI 最好。
   *   - overforge 避免装在有 temper 词条的卡（会快速碎裂）。
   */
  install(CG, gem, card, ctx) {
    let bonus = 0;
    const socketsFilled = (card.sockets || []).filter(s => s.uid).length;

    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      // resonance：每额外宝石 +L，但安装本身才是首颗宝石时收益最低。
      // 用绝对加分而非乘子，避免 installFit 把分数翻倍。
      // (socketsFilled+1) 是安装后该卡的宝石数，每宝石贡献 resonance_level 点。
      // 标度：1 宝石 + resonance:2 ≈ 2 点，2 宝石 ≈ 4 点；加分不应超过 3 以防过热。
      if (d.resonance) {
        bonus += Math.min(socketsFilled * d.resonance * a.level * 0.2, 1.5);
      }

      // temper/awaken：攻击卡上回报最高（成长加在大数值上）
      if ((d.temper || d.awaken) && card.base === 'strike') {
        bonus += 0.2 * a.level;
      }

      // overforge：若卡上已有 temper，成长会快速到 6 导致碎裂
      if (d.overforge) {
        const hasTemper = (card.sockets || []).some(s =>
          (s.affixes || []).some(af => {
            const afd = CG.AFFIXES[af.id];
            return afd && afd.temper;
          })
        );
        if (hasTemper) {
          bonus -= 1.5;   // 碎裂风险，降低安装意愿
        }
      }
    }
    return bonus;
  },
});

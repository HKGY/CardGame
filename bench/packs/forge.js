'use strict';
/* 锻造包（forge）策略 —— 热度（game._heat）是战斗内跨回合保留的第二资源。
 *
 * 机制速查：
 *   bellows  鼓风     ： 打出 → 热度 +2×L（热度跨回合保留，不清零）
 *   ember    余烬重击 ： 伤害牌 damage += heat × L（引擎在 playCard 即时加，不清零热度）
 *   whitehot 白热     ： 热度 +3×L，同时造 3×L 伤害（热度留存）
 *   smelt    熔炼     ： 造 heat×L 伤害 → 热度清零（一次性变现）
 *   coolant  淬炼     ： 得 heat×L 格挡 → 热度清零（一次性变现）
 *   overheat 过热     ： 打出 → 自身灼伤 2×L（debuff）
 *   crack    崩裂     ： 打出 → 失去 4×L 格挡（debuff）
 *   rust     锈蚀     ： 打出 → 热度 -3×L（debuff，侵蚀引擎）
 *
 * 设计思路：
 *   前向模拟已正确处理 ember 的打出加成（+heat×level）和 smelt/coolant 的爆发。
 *
 *   通用 V 的两大盲点：
 *   1.「回合结束时剩余热度」对下回合 ember 攻击有持续价值——
 *      battle 钩子给当前 _heat 小量加分（引导 AI 先打 bellows 再打 ember）。
 *   2. 「bellows（鼓风）宝石」是整个锻造引擎的启动件。
 *      通用 score=3/级，看上去不起眼，却决定了后续 ember/smelt/coolant 能否生效。
 *      gem 钩子大幅提升 bellows 的宝石价值（×5/级加权），让 AI 优先获取/安装产热度的宝石，
 *      而非先安装「需要热度才有效」的 ember/smelt 宝石。
 *
 * 调优结果（M=0.85 bench/eval.js 150 core forge）：
 *   无 hook：18.7%（Δ-19.3%）→ 有 hook：24.7%（Δ-13.3%）
 *   改进约 +6pp；剩余差距来自包本身需要前几回合建引擎才能爆发的结构性劣势。
 */
const value = require('../value');

value.registerPack('forge', {
  /* 局面附加分：给跨回合保留的热度赋予「未来 ember 加成」的折现价值。
   * 只看手牌里最高 ember 等级（代表「本回合内还可能打出的最强 ember 牌」），
   * 给每点热度约 0.4×maxEmber 的加分——保守量，不干扰「现在花热度/存热度」的决策。
   * 无 ember 手牌时给 0.2/热度（鼓励堆热度、等后续轮次用 smelt/coolant）。 */
  battle(CG, g) {
    const heat = g._heat || 0;
    if (heat <= 0) return 0;
    const hand = g.hand || [];
    let maxEmber = 0;
    for (const card of hand) {
      const s = CG.cardStats(card);
      if (s.ember > maxEmber) maxEmber = s.ember;
    }
    const perHeat = maxEmber > 0 ? 0.4 * maxEmber : 0.2;
    return heat * perHeat;
  },

  /* 宝石价值附加分：bellows 是引擎的基础设施，比通用分更值钱。
   * 通用 score=3，但一颗 bellows L1 宝石每打出一张牌就给 +2 热度，
   * 会在整场战斗内持续累积；是 ember/smelt/coolant 一切收益的前提。
   * 加权 5×L（配合通用 3×L 共计 8×L）让 AI 优先拿/装 bellows，
   * 避免出现「只装了 ember、却从没产出热度」的哑火局面。 */
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.bellows) v += 5 * a.level;
    }
    return v;
  },
});

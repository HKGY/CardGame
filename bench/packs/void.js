'use strict';
/* 虚无包（void）策略 —— M3 模式：用 value.registerPack 注入估值钩子。
 *
 * 核心机制：
 *   - emptymind（空明）：出牌后手牌越少伤害/格挡越高（+max(0,5-手牌数)×L），空手时最强（+5L）
 *   - voidecho（虚空回响）：出牌后手牌为空则伤害/格挡×2，空手才触发
 *   - hollow（空虚减益）：出牌后手牌非空则伤害/格挡减半
 *   - devote（舍身）：失去3L血→对敌造6L伤，即时伤害与自伤均被引擎正确结算
 *   - annihilate（湮灭）：放逐抽牌堆顶2L张→按放逐数×3造伤
 *   - offer（献祭）：本场最大生命-3L（下限1）→力量+2L，以最大血换永久增伤
 *   - erode（蚀骨）：本场最大生命-2L（下限1），纯代价减益
 *   - banish（放逐惩罚）：随机放逐L张手牌
 *
 * 通用 V 的盲区与补丁策略：
 *
 *   盲区1：emptymind/voidecho 的收益依赖「打出后手牌为空」这一时序条件。
 *   通用 V 对出牌顺序无感知——同一张 emptymind 牌，手里有 0 张其他牌时打出价值很高，
 *   但手里有 5 张其他牌时打出价值很低；V 无法区分这两种情况。
 *   battle 钩子补丁：当手里持有 emptymind/voidecho/hollow 牌时，对「手牌少」的局面加正向分；
 *   由于前向搜索在每步克隆上打牌并重算 V，「先清手牌」的路径在中间步骤得到更高分，
 *   从而引导 AI 先打其他牌清空手再出 emptymind/voidecho。
 *
 *   盲区2：offer 以 maxHp 换力量，V 对 maxHp 永久减少无感（只看当前 hp/projHp）。
 *   battle 钩子补丁：maxHp 极低时（<30）轻微惩罚，防止无限叠 offer/devote 最终无血可吃。
 *
 * 注意：STUCK 问题（AI 大量叠 dexterity 后无法击杀残血敌人）主要来自通用 V 对格挡溢出的
 * 过度奖励，不是虚无包特有问题。虚无包的 dexterity 累积（如 devote 高 dex 组合）让此问题
 * 显现。尝试过 battle 钩子额外惩罚残血敌人、激励收尾，但此思路导致更多 STUCK（AI 为
 * 击杀残血而冒险送命）。结论：保守地只做「空手塑形 + gem/install 优先级」是更稳的做法。
 */
const value = require('../value');

value.registerPack('void', {
  battle(CG, g) {
    let v = 0;
    const hand = g.hand;
    const p = g.player;

    // === 空手时序塑形：手里有 emptymind/voidecho/hollow 牌时 ===
    // 给「手牌少」的局面正向加分，引导前向搜索优先清空手牌路径。
    let hasEmptyMind = false, hasVoidEcho = false, hasHollow = false;
    if (hand && hand.length) {
      for (const card of hand) {
        const s = CG.cardStats(card);
        if (s.emptyMind > 0) hasEmptyMind = true;
        if (s.voidEcho > 0) hasVoidEcho = true;
        if (s.hollow > 0) hasHollow = true;
      }
    }

    // 手牌≤3时正向塑形（1张→+6, 2张→+4, 3张→+2）
    if ((hasEmptyMind || hasVoidEcho) && hand && hand.length <= 3) {
      v += (4 - hand.length) * 2;
    }

    // hollow 减益（非空手打出减半）：同上，鼓励先清手牌
    if (hasHollow && hand && hand.length <= 3) {
      v += (4 - hand.length) * 1.5;
    }

    // === offer/erode 的 maxHp 代价感知 ===
    // V 对 maxHp 无感，轻微惩罚极低 maxHp，防止 AI 过度自损
    if (p.maxHp > 0 && p.maxHp < 30) {
      v -= (30 - p.maxHp) * 0.4;
    }

    return v;
  },

  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      // emptymind（空明）：空手机制核心引擎件，空手时 +5L 伤/格挡，通用 score=4，上调
      if (d.emptyMind) v += 2.0 * a.level;

      // voidecho（虚空回响）：空手时数值翻倍，通用 score=5，上调
      if (d.voidEcho) v += 2.5 * a.level;

      // offer（献祭）：以 maxHp 换力量，中期偏强，轻微上调
      if (d.offer) v += 1.0 * a.level;

      // hollow（空虚减益）：非空手减半，操作要求高，通用 score=-3×1.3=-3.9，加重
      if (d.hollow) v -= 1.5 * a.level;

      // erode（蚀骨）：纯 maxHp 代价，通用 score=-3×1.3=-3.9，加重
      if (d.erode) v -= 1.5 * a.level;

      // banish（放逐惩罚）：破坏手牌构成，通用 score=-4×1.3=-5.2，加重
      if (d.banish) v -= 2.0 * a.level;
    }
    return v;
  },

  install(CG, gem, card) {
    let bonus = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      // emptymind/voidecho 装到攻击牌：攻击牌通常是最后打出的（先防御再攻击），
      // 更容易在接近空手时触发
      if ((d.emptyMind || d.voidEcho) && card.base === 'strike') bonus += 0.2;
      if ((d.emptyMind || d.voidEcho) && card.base === 'defend') bonus -= 0.1;

      // hollow 减益装到防御牌更糟（防御牌先打，手里还有攻击牌，必触发减半）
      if (d.hollow && card.base === 'defend') bonus -= 0.15;

      // offer/devote 装到攻击牌略好（攻击牌更常打，触发时机更多）
      if ((d.offer || d.devote) && card.base === 'strike') bonus += 0.1;
    }
    return bonus;
  },
});

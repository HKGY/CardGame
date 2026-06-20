'use strict';
/* 消耗包（exhaust）策略模块
 *
 * 核心问题（baseline=43.3%）：
 *   ① onfire（着火）自伤不计入 V 的 projHp（playerIncomingDamage 只算敌人攻击），
 *      AI 无视灼伤堆积，把自己烧死。
 *   ② ashes（灰烬）潜力被低估：exhaustPile 越大伤害越高，但 V 不知道这个铺垫价值。
 *   ③ 燃烧选牌（burn pick）通用策略烧的是最差牌，应优先烧 dross/渣滓或无效果废牌，
 *      不应烧有 nirvana/undying 的牌（除非故意触发）。
 *   ④ 重生选牌（reborn pick）通用策略已挑最好的牌，但应优先捞 nirvana/undying/ashes 牌。
 *   ⑤ detonate（爆燃）消耗全手牌，可能留空手无法收杀 → STUCK；gem 钩子要强化惩罚。
 *   ⑥ nightmare（噩梦）塞满渣滓 → 一回合都在打 1 费废牌耗能量；battle 钩子要惩罚渣滓手牌。
 *
 * 估值标度参考：1 价值 ≈ 0.083 玩家血；projHp*12 → 1hp=12；敌人血×1.5
 */
const value = require('../value');

/** 快速计算某张牌的「消耗包价值」（用于 pick 排序）*/
function exhaustWorth(CG, card) {
  if (!card) return 0;
  const s = CG.cardStats(card);
  let w = s.value + (s.effects ? s.effects.length : 0);
  if (s.nirvana) w += 10;    // 被消耗时再发动一次 → 极有价值
  if (s.undying) w += 7;     // 被消耗时生成副本 → 持续资源
  if (s.ashes > 0) w += 4;   // ashes 牌捞回后仍能用 exhaustPile 加成
  if (s.reborn > 0) w += 2;  // 能再捞牌也有价值
  if (card.base === 'dross') w = -10; // 渣滓：最劣，优先烧掉
  return w;
}

/** 检查 g.hand 里有多少 ashes 牌（决定是否值得奖励 exhaustPile 大小）*/
function countHandAshes(CG, g) {
  let n = 0;
  for (const c of g.hand) { const s = CG.cardStats(c); if (s.ashes > 0) n++; }
  return n;
}

/** 检查 g.hand 里渣滓牌数量 */
function countDross(g) {
  let n = 0;
  for (const c of g.hand) { if (c.base === 'dross') n++; }
  return n;
}

value.registerPack('exhaust', {
  /**
   * battle 钩子：修正 V 看不到的长期/隐性价值。
   * 调用时在克隆上执行，只读，纯函数。
   */
  battle(CG, g) {
    let v = 0;
    const p = g.player;
    const burn = p.statuses.burn || 0;

    // ── ① onfire 灼伤：V 的 projHp 只算敌人攻击伤害，不含回合结束的灼伤
    //    灼伤 n 层：本回合末结算 n 点（可被格挡），再 -1 层；后续也会结算
    //    格挡可以抵消灼伤：如果已有大量格挡，灼伤伤害为 0
    //    net_burn = max(0, burn - block)：当前格挡已在 projHp 里计算（抵消敌人攻击）
    //    这里需要单独评估剩余灼伤：若 block > 敌人攻击 damage，多余格挡能挡灼伤
    //    简化处理：直接对 burn 层数惩罚，力度稍大确保 AI 不忽视
    if (burn > 0) {
      // 基础惩罚：burn 层数 × 9（约 0.75 hp/层）
      v -= burn * 9;
      // 高层灼伤（≥4）额外惩罚：短期内就能致命
      if (burn >= 4) v -= (burn - 3) * 10;
    }

    // ── ② ashes 潜力：手里有 ashes 牌时，exhaustPile 大小代表即时伤害加成
    //    exhaustPile 每张 ≈ 手里 ashes 牌数 × L 点额外伤害；这里给个铺垫价值
    const ashesCards = countHandAshes(CG, g);
    if (ashesCards > 0 && g.exhaustPile.length > 0) {
      // 每张 exhaustPile 牌 × ashes 牌数 × 小系数（引擎已结算直接伤害，这里奖励铺垫）
      v += g.exhaustPile.length * ashesCards * 1.5;
    }
    // 即使没有 ashes 牌在手，大 exhaustPile 也是「曾经投入」的标志
    // 给小额奖励防止 AI 过度担心消耗堆增长
    v += Math.min(g.exhaustPile.length, 8) * 0.4;

    // ── ③ nirvana/undying 在消耗堆中的价值
    //    nirvana 已触发，不再有价值（已经在 exhaustPile）
    //    undying 已生成副本进手牌，自身 exhaustPile 也没额外价值
    //    → 不加分（已经计入了即时效果）

    // ── ④ nightmare 后的渣滓惩罚
    //    渣滓：1费、无效果、消耗。手里多张 dross = 浪费能量/手牌数
    const drossCount = countDross(g);
    if (drossCount > 0) {
      // 每张渣滓 ≈ 浪费 1 能量机会；惩罚力度：~4（小于 1hp 等价的 12，不夸大）
      v -= drossCount * 5;
      // 渣滓超过 3 张时额外惩罚（手几乎全是废牌）
      if (drossCount >= 3) v -= (drossCount - 2) * 6;
    }

    // ── ⑤ 手里有 nirvana 牌时，"消耗它"会触发效果 → 略加价值意识
    //    （鼓励 AI 保留 burning 来主动触发 nirvana，而非随便过牌）
    let nirCount = 0, undyingCount = 0;
    for (const c of g.hand) {
      const s = CG.cardStats(c);
      if (s.nirvana) nirCount++;
      if (s.undying) undyingCount++;
    }
    // 手里有 nirvana/undying 的牌 = 一种潜在资源（可以通过 burning 主动消耗获益）
    v += nirCount * 1.5 + undyingCount * 1.0;

    return v;
  },

  /**
   * gem 钩子：调整各词条的经济价值，让 AI 优先选对的宝石。
   */
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (!d) continue;
      const L = a.level;

      // 增益额外加权
      // nirvana/undying 是 boolean 效果（cardStats 里 true/false，实际效果 L1=L2=L3）
      // gemValueGeneric 按 score*L 给分，会高估 L3 宝石（L3 nirvana generic=15，但效果等同 L1=5）
      // 这里用「负修正」：减去多余的等级溢价，同时加上真实效果价值
      // 最终目标：nirvana L1 ≈ +5 补正，nirvana L3 ≈ +5 补正（不因级别高多得）
      // 实现：v += flatBonus - (L-1)*score 消除等级溢价，再 + flatBonus
      //   等效于：genericBonus 修正后 = score（固定），再加 flatBonus
      //   即：v += flatBonus - (L-1)*d.score  （d.score 正数）
      if (d.nirvana) v += 5 - (L - 1) * d.score;  // 涅槃：等价 genericV 固定为 score(=5)，+5 加成
      if (d.undying) v += 4 - (L - 1) * d.score;  // 不坏：等价 genericV 固定为 score(=5)，+4 加成
      if (d.ashes)      v += 2 * L;   // 灰烬：真实随等级叠加（ashesN += L）
      if (d.reborn)     v += 1 * L;   // 重生：可捞回 nirvana/undying 牌
      if (d.burnSelect) v += 0.5 * L; // 燃烧：略加权（主动触发 nirvana 等协同）

      // 减益额外惩罚（加在 gemValueGeneric 的负分之上）
      // onfire（着火）selfBurn=2：每次出牌给自己叠 2L 层灼伤（可被格挡抵消）
      //   - 中等惩罚：battle 钩子会让 AI 在灼伤高时优先叠格挡
      // detonate（爆燃）burnAll：消耗全部手牌；与 nirvana 手牌协同时反而有利
      //   - 中等惩罚：允许 nirvanaL2+ 宝石来承载此词条
      // nightmare（噩梦）：填满渣滓，没有协同上限——纯损耗，惩罚最重
      if (d.burnAll)    v -= 10 * L;  // 爆燃：消耗全手牌 → STUCK 风险，强惩罚
      if (d.selfBurn)   v -= 7 * L;   // 着火：自伤积累（selfBurn=2，battle 钩子补完）
      if (d.nightmare)  v -= 7 * L;   // 噩梦：填满渣滓，严重干扰（纯损耗，最高惩罚）
    }
    return v;
  },

  /**
   * install 钩子：把 nirvana/undying/ashes 装到攻击向卡获得额外加分。
   * 逻辑：消耗时效果再触发/副本生成，攻击卡触发时价值更高。
   */
  install(CG, gem, card) {
    let bonus = 0;
    // card.type is not set on deck cards—use BASE_CARDS[card.base].type for lookup
    const baseInfo = CG.BASE_CARDS[card.base];
    const isAttack = baseInfo && baseInfo.type === 'attack';
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (!d) continue;
      // nirvana/ashes 装攻击卡：消耗时再打一次伤害 → 更有价值
      if ((d.nirvana || d.ashes) && isAttack) bonus += 0.15 * a.level;
      // undying 装任何卡：副本都有价值，微弱倾向攻击卡
      if (d.undying && isAttack) bonus += 0.08 * a.level;
      // 危险减益装任何卡都惩罚
      if (d.burnAll || d.nightmare) bonus -= 0.3 * a.level;
      if (d.selfBurn) bonus -= 0.15 * a.level;
    }
    return bonus;
  },

  /**
   * pick 钩子：覆盖燃烧（burn）和重生（reborn）的选牌策略。
   *
   * burn：从手牌里消耗 1 张
   *   → 优先消耗渣滓（dross）→ 再消耗低价值废牌
   *   → 尽量保留 nirvana/undying 高价值牌（除非没有更好的选择）
   *   → 特殊情况：手里有 nirvana 牌时，可以主动消耗它触发效果（如果敌人血低）
   *
   * reborn：从消耗堆捞回 1 张
   *   → 优先捞 nirvana > undying > ashes > 其他高价值牌
   *   → 不捞渣滓（1 费废牌，宁可留在消耗堆给 ashes）
   */
  pick(CG, g, type) {
    if (type === 'burn') {
      const hand = g.hand;
      if (!hand.length) return null; // 手空，跳过

      // 渣滓优先消耗（已经没用，而且 exhaust 后加 exhaustPile 给 ashes 用）
      const dross = hand.filter(c => c.base === 'dross');
      if (dross.length > 0) {
        // 选最后一张 dross（避免影响其他 pick 顺序）
        return dross[dross.length - 1].uid;
      }

      // 没有渣滓，排序选最低价值的牌
      // 排序原则：exhaustWorth 最小的牌最先被烧
      const sorted = hand.slice().sort((a, b) => exhaustWorth(CG, a) - exhaustWorth(CG, b));
      const worst = sorted[0];

      // 如果最差牌有 nirvana，消耗它可以白嫖一次效果
      // 这时候主动烧 nirvana 是合理的（效果会再触发一次）
      // 但我们需要判断：烧掉这张牌之后还能打过关卡吗？
      // 简化：如果 nirvana 是最差的牌（其他牌都更值钱），就烧掉它触发效果
      const worstStats = CG.cardStats(worst);
      if (worstStats.nirvana && sorted.length > 1) {
        // 如果消耗堆里已经有很多牌（引擎运转中），可以积极消耗 nirvana
        if (g.exhaustPile.length >= 3) {
          return worst.uid; // 主动触发涅槃
        }
        // 否则优先保留 nirvana，找下一个最差的
        const nextWorst = sorted[1];
        if (nextWorst) return nextWorst.uid;
      }

      return worst.uid;
    }

    if (type === 'reborn') {
      const pile = g.exhaustPile;
      if (!pile.length) return null; // 消耗堆空，跳过（引擎应该已过滤，防御性判断）

      // 不捞渣滓（留在消耗堆给 ashes 用）
      const nonDross = pile.filter(c => c.base !== 'dross');
      const pool = nonDross.length > 0 ? nonDross : pile;

      // 按消耗包价值排序，捞最高价值的牌
      const sorted = pool.slice().sort((a, b) => exhaustWorth(CG, b) - exhaustWorth(CG, a));
      return sorted[0].uid;
    }

    return undefined; // 其他类型用通用策略
  },
});

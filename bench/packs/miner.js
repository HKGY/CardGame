'use strict';
/* 矿工包（miner）策略模块 —— 深度 _depth 是战斗内跨回合保留的第二资源（类似电力/灰烬）。
 *
 * 核心盲区：
 *   通用 V 看不到 game._depth 的累积价值。深度的意义完全来自「消耗途径」：
 *   - 寻脉(prospect)：每打出一张有 prospect 的牌，伤害 +（深度 × 等级）
 *   - 采石(quarry)：每打出一张有 quarry 的牌，格挡 +（深度 × 等级）
 *   引擎在克隆上 playCard 时会正确结算这些加成（前向搜索自动捕获「本回合」的价值），
 *   但「本回合末剩余的深度留到下回合的价值」不在 V 里，AI 会低估攒深度的收益。
 *
 *   负面词条 barren/disaster 会破坏累积的深度——当有消耗途径时，它们的成本远高于通用估值。
 *
 * 钩子设计：
 *
 *   battle(CG, g)：
 *     当手牌/牌组有 prospect 或 quarry 消耗途径时，给当前深度加权。
 *     加权量：depth × consumerLevel × 0.5（参考：每点深度×1 级寻脉=+1 伤害/牌，
 *     后续约 3 张牌 ≈ +3 伤，对应约 3×1.5×0.3 ≈ 1.35 价值/点深度；
 *     乘以消耗等级和牌数后取保守 0.5 避免压过保命）。
 *     手牌有途径时也追加（搜索会选择出牌顺序，但对「先挖后打」的跨步收益仍有盲区）。
 *     无消耗途径时：mine/blast 本回合给格挡（无跑图时）已被引擎结算；额外价值为 0。
 *
 *   gem(CG, gem, ctx)：
 *     - mine/blast（攒深度）：有消耗途径时上调价值（它们是引擎件）；无途径下调（华而不实）
 *     - prospect（深度→伤害）：与 mine/blast 协同，加成固定正价值
 *     - quarry（深度→格挡）：同 prospect
 *     - richvein（掘宝石）：bench 克隆中 game.run 的 gems 不写回真实背包，即时无收益；
 *       但通用 score=5 已合理；在有跑图上下文时轻微加权
 *     - cavein（自伤）：score=-3 是合理定价；不额外调整
 *     - barren/disaster（损毁深度）：有消耗途径时额外惩罚
 *
 *   install(CG, gem, card)：
 *     - prospect（伤害+深度）：baseAffinity 不识别它，安装到 strike 要加契合分
 *     - quarry（格挡+深度）：安装到 defend 要加契合分
 *     - mine/blast（攒深度）：无所谓攻/守基底，但要装到「会被打出」的牌上；不偏置
 */
const value = require('../value');

// ---- 辅助：扫描一组牌里所有宝石词条（返回各词条 id→最大等级）----
function scanAffixes(cards, ids) {
  const out = {};
  for (const c of cards) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (!ids || ids.includes(a.id)) {
          out[a.id] = Math.max(out[a.id] || 0, a.level);
        }
      }
    }
  }
  return out;
}

// 扫描整副牌（手牌+抽牌堆+弃牌堆）里 prospect/quarry 的最大等级（=消耗途径强度）
function consumerLevel(g) {
  const piles = [g.hand, g.drawPile, g.discardPile];
  let maxProspect = 0, maxQuarry = 0;
  for (const pile of piles) {
    const found = scanAffixes(pile, ['prospect', 'quarry']);
    maxProspect = Math.max(maxProspect, found.prospect || 0);
    maxQuarry   = Math.max(maxQuarry,   found.quarry   || 0);
  }
  return { maxProspect, maxQuarry };
}

// 判断手牌是否有可消耗深度的途径（立即可用）
function handHasConsumer(g) {
  const found = scanAffixes(g.hand, ['prospect', 'quarry']);
  return (found.prospect || 0) > 0 || (found.quarry || 0) > 0;
}

value.registerPack('miner', {

  // ---- 局面附加分 ----
  battle(CG, g) {
    const depth = g._depth || 0;
    if (depth <= 0) return 0;

    const { maxProspect, maxQuarry } = consumerLevel(g);
    const totalConsumer = maxProspect + maxQuarry;
    if (totalConsumer <= 0) return 0;

    // 估算：本回合末剩余深度在后续回合的价值。
    // 每点深度 × consumer等级 × 0.5 价值/点（保守）。
    // 手牌有消耗途径时降权（搜索已在即时模拟里结算，加太多会重复计）；
    // 仅牌组有消耗途径（跨回合）时全权加。
    const hasImmediate = handHasConsumer(g);
    const multiplier = hasImmediate ? 0.2 : 0.45;

    let v = depth * totalConsumer * multiplier;

    // 越早建立深度优势复利越大
    if (g.turn <= 3) v *= 1.3;
    else if (g.turn <= 6) v *= 1.1;

    // HP 极低时：深度价值大打折扣（先活着再挖矿）
    const hp = g.player.hp || 0;
    const maxHp = g.player.maxHp || 1;
    if (hp < maxHp * 0.3) v *= 0.3;
    else if (hp < maxHp * 0.5) v *= 0.6;

    // 避免过大（参考：produce 的 prodGrow 给 9，这里应小于生命价值量级）
    return Math.min(v, 20);
  },

  // ---- 宝石附加价值 ----
  gem(CG, gem, ctx) {
    let v = 0;
    const run  = ctx && ctx.run;
    const packs = ctx && ctx.packs;

    // 判断当前牌组（run 可访问时）是否已有消耗途径
    // 在 run 不可访问时（bench 早期）按「有途径」估值（矿工包本身会出 prospect/quarry）
    let hasConsumer = true;
    if (run && run.deck) {
      const found = scanAffixes(run.deck, ['prospect', 'quarry']);
      hasConsumer = (found.prospect || 0) > 0 || (found.quarry || 0) > 0;
    }

    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      if (d.mine) {
        // mine：每次打出给深度 +2n；是攒深度的主力
        // 有消耗途径：额外上调（引擎件）；无途径：无额外奖励（不想堆无用深度）
        if (hasConsumer) v += 2 * a.level;
        // 无消耗途径时：不额外加分（通用 score=4 够了）
      }
      if (d.blast) {
        // blast：一次性大量深度 +5n；适合有消耗途径的爆发回合
        if (hasConsumer) v += 2.5 * a.level;
      }
      if (d.prospect) {
        // prospect：深度→伤害，与 mine/blast 协同，核心消耗件
        v += 2 * a.level;
      }
      if (d.quarry) {
        // quarry：深度→格挡，核心消耗件
        v += 1.5 * a.level;
      }
      if (d.richvein) {
        // 掘宝石：只在有跑图时有意义，bench 里 run 可见时小幅加权
        if (run) v += 2;
      }
      if (d.cavein) {
        // 塌方：每次打出 -3n HP，score=-3 但 HP权重12；打出一次-3HP=-36价值，
        // 但 score=-3×1.3=-3.9，远低估。额外加重惩罚。
        v -= 2.5 * a.level;
      }
      if (d.barren) {
        // 贫矿：深度 -3n；有消耗途径时额外惩罚（破坏积累的价值）
        if (hasConsumer) v -= 2 * a.level;
        else v -= 0.5 * a.level;
      }
      if (d.disaster) {
        // 矿难：深度减半；比贫矿更可怕（深度高时损失大）
        if (hasConsumer) v -= 4;
        else v -= 1;
      }
    }
    return v;
  },

  // ---- 安装契合度 ----
  install(CG, gem, card) {
    let b = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      if (d.prospect) {
        // 寻脉→伤害：必须装在攻击牌上才能发挥（damageOnly 让它只加 damage effects）
        // baseAffinity 不识别 prospect，所以这里手动加契合
        if (card.base === 'strike') b += 0.2;
        else if (card.base === 'defend') b -= 0.1;  // 防御牌无伤害 effect，装了没用
      }
      if (d.quarry) {
        // 采石→格挡：装在防御牌上效益更高（防御牌本来就有 block effect）
        if (card.base === 'defend') b += 0.15;
        else if (card.base === 'strike') b -= 0.05;
      }
      // mine/blast：纯深度积累，不依赖牌的攻/守性质；不偏置
    }
    return b;
  },
});

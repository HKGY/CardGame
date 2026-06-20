'use strict';
/* 电力包（elec）策略模块 —— M3 模式：通过 value.registerPack 注入估值钩子。
 *
 * 核心问题：
 *   通用 V 给电力 ×0.6/点，但在有 overclock/arc 消耗途径时，存量电力代表未来爆发
 *   的预付款，边际价值远高于 0.6。搜索已正确评估「本回合打出 overclock/arc」的
 *   即时收益；gap 在「本回合末剩余电力跨回合保留的价值」——
 *   比如本回合打了 generate（+4 电力）但 overclock 在牌组里尚未抽到，
 *   4 点电力留到下回合才能发挥；通用 V 给的 4×0.6=2.4 可能低估了它。
 *
 * 设计结论（经反复实验）：
 *   - battle 钩子：当手牌无即时 overclock/arc 但牌组有时，轻微提升存量电力价值。
 *     「手牌有途径」时不加权（搜索已处理即时收益，加权反而干扰）。
 *   - gem/install 钩子：实验表明会引入新的损失（干扰宝石选取优先级），不启用。
 *
 * 标度依据（README）：
 *   1 点电力追加 0.7（总 0.6+0.7=1.3）≈ 0.11 点血量；
 *   早期回合再 ×1.5，相当于「本局价值折现」加权。
 */
const value = require('../value');

// ---- 辅助：当前手牌是否有能即时消耗电力的 overclock/arc 牌 ----
function handHasOverclockOrArc(g) {
  for (const c of g.hand) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (a.id === 'overclock' || a.id === 'arc') return true;
      }
    }
  }
  return false;
}

// ---- 辅助：牌组（含手牌/抽/弃堆）是否有 overclock/arc（跨回合使用途径）----
function deckHasConsumer(g) {
  const piles = [g.hand, g.drawPile, g.discardPile];
  for (const pile of piles) {
    for (const c of pile) {
      for (const sock of (c.sockets || [])) {
        for (const a of (sock.affixes || [])) {
          if (a.id === 'overclock' || a.id === 'arc') return true;
        }
      }
    }
  }
  return false;
}

value.registerPack('elec', {
  // ---- 局面附加分 ----
  // 通用 V 已给 power×0.6。
  // 追加场景：手牌本回合无法立即消耗电力，但牌组有 overclock/arc（下回合能用）。
  // 「手牌有途径」时返回 0：搜索会自行选择最优出牌序，无需额外引导。
  battle(CG, g) {
    const power = g.player.power || 0;
    if (power <= 0) return 0;
    // 手牌有即时消耗途径：搜索自动结算，不干预
    if (handHasOverclockOrArc(g)) return 0;
    // 牌组有跨回合消耗途径：轻微提升存量电力价值
    if (deckHasConsumer(g)) {
      const base = power * 0.7;
      // 越早囤积复利越大（turn ≤ 3 是早期铺垫阶段）
      const earlyBonus = g.turn <= 3 ? base * 0.5 : 0;
      return base + earlyBonus;
    }
    // 无消耗途径：通用 0.6 覆盖，不加也不减
    return 0;
  },
});

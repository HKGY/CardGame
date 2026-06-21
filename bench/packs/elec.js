'use strict';
/* 电力包（elec）策略 —— v3 原子模型重写。
 *
 * v3 里电力包 = 价值原子 `power`（打出获得电力，跨回合存）。消耗途径不再是旧的 overclock/arc，
 * 而是「条件代价 `curPower` → 数值」的分子（curPower_damage / curPower_block …：用当前电力放大本牌数值）。
 * 通用 V 已给电力 1.0/点；但当牌库里有 curPower 消耗牌时，存量电力是「未来爆发的预付款」，
 * 边际价值更高 —— 这里在「有消耗途径」时给存量电力再加权，鼓励先攒电、再在高电时打 curPower 牌。
 * （旧版找 overclock/arc 词条，v3 已删 → 那是死代码；此处对齐 v3 的 curPower 条件分子。）
 */
const value = require('../value');

function deckHasPowerConsumer(CG, g) {
  for (const pile of [g.hand, g.drawPile, g.discardPile]) {
    for (const c of (pile || [])) {
      for (const sk of (c.sockets || [])) {
        for (const a of (sk.affixes || [])) {
          const d = CG.AFFIXES[a.id];
          if (d && d.condBonus && d.condBonus.qty === 'curPower') return true;
        }
      }
    }
  }
  return false;
}

value.registerPack('elec', {
  battle(CG, g) {
    const power = g.player.power || 0;
    if (power <= 0) return 0;
    if (!deckHasPowerConsumer(CG, g)) return 0;        // 无消耗途径：通用 1.0/点 已覆盖，不额外加
    const base = power * 0.6;                           // 存量电力（待兑现的爆发）追加价值
    return base + (g.turn <= 3 ? base * 0.5 : 0);       // 越早攒越值（复利折现）
  },
});

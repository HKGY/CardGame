'use strict';
/* 生产包（produce）参考策略 —— M3 模式样例：用 value.registerPack 注入估值钩子。
 * 生产是「复利引擎」：每回合开始被动产出（耕作抽牌 / 蓄能格挡 / 复利自增）。
 * 通用 V 只看眼前，会低估「投资引擎」的长期收益、并把歉收/养护当纯负担回避。
 * 这里：①battle 给引擎层数加未来价值，鼓励早回合铺引擎；②gem 给复利/养护重定价。
 */
const value = require('../value');

value.registerPack('produce', {
  battle(CG, g) {
    const s = g.player.statuses; let v = 0;
    v += (s.prodBlock || 0) * 3.5;                 // 每回合白嫖格挡：长期续航
    v += (s.prodDraw || 0) * 7;                    // 每回合多抽：手牌优势很值
    v += (s.prodGrow || 0) * 9;                    // 复利：滚雪球，最值钱
    if (g.turn <= 4) v += ((s.prodBlock || 0) + (s.prodDraw || 0) + (s.prodGrow || 0)) * 2;  // 越早铺越值
    v -= (s.prodSkip || 0) * 3 + (s.prodUpkeep || 0) * 4;   // 歉收/养护：长期负担
    return v;
  },
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.selfStatus === 'prodGrow') v += 4 * a.level;     // 复利额外加权（雪球核心）
      if (d.selfStatus === 'prodDraw') v += 2 * a.level;
      if (d.selfStatus === 'prodUpkeep') v -= 4 * a.level;   // 每回合扣能，长期很痛
      if (d.stagnate) v -= 3 * a.level;                      // 滞产：直接削引擎
    }
    return v;
  },
});

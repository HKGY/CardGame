'use strict';
/* 节奏包（tempo）v3.2 策略 —— 价值原子 = draw / draw_next / energy / energy_next。
 *
 * v3 重组后旧的回响(freeNext)/风怒(windfury)词条已不在 tempo（gem 对它们的定价是死代码）。
 * 现节奏＝抽牌 + 能量（含下回合时点变体）。即时抽/能由 rollout 真实展开、核心 V 自动捕捉；
 * draw_next/energy_next 入 _next 队列，核心 V 已折现估值。这里只补：
 *   · battle：本回合还能免费打出的张数 freeCards（其它来源可能仍产生），V 完全没计。
 *   · gem：抽牌/能量＝牌权·节奏，早抽更值（构筑层，V 不参与抽卡）。
 */
const value = require('../value');
value.registerPack('tempo', {
  battle(CG, g) {
    return (g.freeCards || 0) * 1.5;             // 回响/免费行动：本回合潜在出牌
  },
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d || !d.value) continue;
      const atom = d.value.atom;
      if (atom === 'energy' || atom === 'energy_next') v += 1.0 * (a.level || 1);   // 能量：多打牌、节奏核心
      else if (atom === 'draw' || atom === 'draw_next') v += 0.8 * (a.level || 1);  // 抽牌：手牌优势
    }
    return v;
  },
});

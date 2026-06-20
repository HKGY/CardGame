'use strict';
/* 节奏包（tempo）轻量钩子 —— 通用 V 故意不奖励囤牌/囤能（防消极），但「回响待打张数 freeCards」
 * 是已承诺的免费行动、V 完全没计；补上它。其余（多抽多能变现）交给多步 rollout 搜索发现。 */
const value = require('../value');
value.registerPack('tempo', {
  battle(CG, g) {
    return (g.freeCards || 0) * 1.5;              // 回响：本回合还能免费打出的张数＝潜在行动
  },
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.freeNext) v += 1.5 * a.level;          // 回响
      if (d.windfury) v += 1 * a.level;            // 风怒：回手再打
    }
    return v;
  },
});

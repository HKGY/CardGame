'use strict';
/* 强攻包（power）轻量钩子 —— 纯进攻，通用估值已较准；只把「伤害倍增器」更明确地导向打击牌。 */
const value = require('../value');
value.registerPack('power', {
  install(CG, gem, card) {
    let b = 0;
    for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (!d) continue;
      if ((d.hits || d.pierce || d.combo || d.valuePct) && card.base === 'strike') b += 0.15;   // 多重/穿刺/连击/过载→打击
    }
    return b;
  },
});

'use strict';
/* 死守包（bastion）轻量钩子 —— 主要补「重甲(keepBlock)使格挡跨回合保留」这一通用 V 盲区。 */
const value = require('../value');
value.registerPack('bastion', {
  battle(CG, g) {
    // 通用 V 只把溢出格挡算 0.2/点；开了重甲后格挡不清空＝跨回合资源，价值高得多。
    return g._keepBlock ? (g.player.block || 0) * 0.45 : 0;
  },
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.keepBlock) v += 3 * a.level;          // 重甲：整套体系的开关
      if (d.shieldBash) v += 1.5 * a.level;       // 盾击：把格挡变伤害
    }
    return v;
  },
  install(CG, gem, card) {
    let b = 0;
    for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (!d) continue;
      if ((d.shieldBash || d.lastStand) && card.base === 'strike') b += 0.15;   // 盾击/死战要打人
      if ((d.keepBlock || d.brace) && card.base === 'defend') b += 0.1;
    }
    return b;
  },
});

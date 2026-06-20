'use strict';
/* 生机包（vitality）轻量钩子 —— 已是最强档；只对「吸血/荆棘」这类续航·反伤词条做轻微定价补偿。 */
const value = require('../value');
value.registerPack('vitality', {
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.lifesteal) v += 1.5 * a.level;                  // 吸血：攻击即续航，V 只在结算时见到
      if (d.selfStatus === 'thorns') v += 1 * a.level;      // 荆棘：受击反伤
    }
    return v;
  },
});

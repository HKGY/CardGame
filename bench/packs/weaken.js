'use strict';
/* 弱化包（weaken）轻量钩子 —— 沉默/冰冻的「省下一整轮敌人伤害」很难被即时 V 体现，补一点。 */
const value = require('../value');
value.registerPack('weaken', {
  battle(CG, g) {
    let v = 0;
    for (const e of g.aliveEnemies()) if (e.statuses.frozen) v += 3;   // 冰冻＝跳过一次行动，额外加权
    return v;
  },
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.silence) v += 2 * a.level;                                 // 沉默：永久削敌力量，V 难提前体现
      if (d.apply && d.apply.frozen) v += 1.5 * a.level;
    }
    return v;
  },
});

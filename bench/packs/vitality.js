'use strict';
/* 生机包（vitality）v3.2 策略 —— 价值原子 = heal / strength / strength_next / dexterity / dexterity_next。
 *
 * v3 重组后：吸血(lifesteal)已移入放大包、荆棘(thorns)移入死守包（旧 vitality.js 对它们定价已是死代码）。
 * 现生机＝治疗 + 力量/敏捷（含下回合时点变体）。核心 V 已估力量(×6)/敏捷(×4)板面与 _next 队列，
 * 治疗是即时的（搜索/V 自动捕捉）→ 这里只补构筑层：力量/敏捷是「每回合复利」的乘区/防区，早抽更值。
 */
const value = require('../value');
value.registerPack('vitality', {
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d || !d.value) continue;
      const atom = d.value.atom;
      if (atom === 'strength' || atom === 'strength_next') v += 1.0 * (a.level || 1);   // 力量：每回合复利，单局 V 低估
      else if (atom === 'dexterity' || atom === 'dexterity_next') v += 0.6 * (a.level || 1);
    }
    return v;
  },
});

'use strict';
/* 放大包（amplify）v3 策略钩子 —— 价值原子 = `strength` / `tempStr`，外加签名词条 `potent`（翻倍）。
 *
 * potent（强效，签名 `play_mult`）：本牌伤害/格挡/治疗 ×(1+等级)，在 playCard 即时结算 →
 * 搜索/rollout 会自动评估翻倍后的局面，故 V 本身已基本够。**但有一处 V 表达不出的策略**：
 * 同一张 potent 牌，**乘在多大的基础数值上**决定它值不值得现在打——翻倍的收益 = 本牌基础数值 ×L。
 * 当 potent 牌恰好本身基础伤害/格挡也高时，「现在打它」是连招峰值；rollout 单步评估能看到翻倍结果，
 * 但在能量紧张、需要排序「先打哪张」时容易把它和普通牌等同看待 → 这里给一记正偏好把大牌优先打出。
 *
 * 钩子宜轻（generic 估值已基本够）：
 *   - playPolicy：potent 且本牌基础数值大 → 强偏好（把翻倍乘在大牌上）；数值小则不急（返回 0）。
 *   - gem：strength（乘区）/ potent（翻倍）给正向边际；其余连招（amppain/ampgain/polarize）交给 generic + 搜索。
 */
const value = require('../value');

value.registerPack('amplify', {
  // 把翻倍乘在大牌上：potent 牌且本身基础数值高 → 现在打它（连招峰值）。
  playPolicy(CG, g, card, s) {
    if (!s.potent) return 0;
    const base = s.value || 0;                 // 本牌基础伤害/格挡/治疗（翻倍乘的就是它）
    if (base < 10) return 0;                    // 乘在小牌上收益有限：不急（让搜索按即时 V 自行决定）
    // 翻倍净增 ≈ base×L 点数值；给约 1/3 作偏好，并封顶在「不盖过致命/救命」的区间。
    return Math.min(30, Math.round(base * (s.potent || 1) / 3));
  },
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      const atom = d.value && d.value.atom;
      if (atom === 'strength') v += 1 * a.level;     // 乘区：每回合复利，单局 V 低估
      if (d.potent)            v += 1.5 * a.level;    // 翻倍：装在大牌上爆发力强（generic score=5 已偏保守）
    }
    return v;
  },
});

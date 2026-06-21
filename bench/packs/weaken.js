'use strict';
/* 弱化包（weaken）v3 策略钩子 —— 演示「V 刻画不了的策略 → 必须 per-pack 钩子」。
 *
 * v3 弱化＝纯敌方减益原子（易伤/虚弱/脆弱/中毒/敌失力量/敏捷），本身**不产生伤害**。
 * 实测病根：rollout 在融合局里把牌组堆满减益却没有伤害去「兑现」（易伤放大的是你的伤害；
 * 虚弱/敌失力量是保命）→ 打不死 → 输。而这是个**牌组构筑**问题：
 *   ——V 只评估单个战斗局面、从不参与「抽哪颗宝石」，所以这条策略 V 在原理上就够不到。
 *
 * 钩子（构筑层）：按「当前牌组 减益 vs 伤害 的倾向」给减益宝石**边际定价**：
 *   减益还不够多 → 小幅鼓励（减益确实有用：保命 + 放大）；
 *   减益已远多于伤害 → 边际递减/转负（再堆就是全减益空架子）→ AI 转去抽伤害 → 牌组均衡 → 打得死。
 * 另：冰冻＝跳过一次敌人行动，省下一整轮伤害，V 难提前体现 → battle 轻量补一点。
 */
const value = require('../value');

const DEBUFF_RES = new Set(['vulnerable', 'weak', 'frail', 'poison', 'enemyLoseStr', 'enemyLoseDex', 'enemyLoseStrTemp', 'enemyLoseDexTemp']);

// 统计一副牌组的「伤害 vs 减益」倾向（按宝石价值原子）。
function deckTendency(CG, run) {
  let dmg = 0, deb = 0;
  for (const c of (run.deck || [])) for (const g of (c.sockets || [])) for (const a of (g.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d || !d.value) continue;
    const r = d.value.res;
    if (r === 'damage' || (d.condBonus && d.condBonus.vtype === 'damage') || r === 'mult' || r === 'execute' || r === 'lifesteal') dmg += a.level;
    else if (DEBUFF_RES.has(r)) deb += a.level;
  }
  return { dmg, deb };
}
function gemDebuffWeight(CG, gem) {
  let w = 0;
  for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (d && d.value && DEBUFF_RES.has(d.value.res)) w += a.level; }
  return w;
}

value.registerPack('weaken', {
  // 构筑层：按牌组均衡度给减益宝石边际定价（V 看不到牌组构成）。
  gem(CG, gem, ctx) {
    const run = ctx && ctx.run; if (!run) return 0;
    const isDeb = gemDebuffWeight(CG, gem); if (!isDeb) return 0;
    const { dmg, deb } = deckTendency(CG, run);
    const excess = deb - dmg;                          // 减益相对伤害的「过剩量」
    return (excess <= 1 ? 1.5 : -1.5 * (excess - 1)) * isDeb;
  },
  // 战斗层：冰冻＝白赚一整轮免伤，V 难提前体现。
  battle(CG, g) {
    let v = 0;
    for (const e of g.aliveEnemies()) if (e.statuses.frozen) v += 4;
    return v;
  },
});

'use strict';
/* 强攻包（power）v3 策略钩子 —— 价值原子 = `damage`，直球伤害，通用 V 已能估。
 *
 * V 看不到的唯一一类：**抢杀/集火收尾**。V 只评估「打完后的局面」，对「同样一笔伤害，
 * 打残血敌（杀掉）远胜过砸满血敌」这件事其实已部分体现（杀掉=少一个伤害源 -8 + 濒死 -10），
 * 但 rollout 的 topK 预筛是按**即时 V**排序的，常把伤害分散评估、让收尾牌排不进 topK，
 * 或在多目标时不优先把「能斩的那张」导向残血敌 → 留半血拖局（STUCK 的常见病根）。
 *
 * 钩子（playPolicy）：当场上存在「本牌一击可解决」的残血敌时，给伤害/斩杀牌正偏好，
 * 把伤害**导向收尾**而非浪费在满血敌上。注意：playPolicy 收不到目标（只给 card+s），
 * 故按「是否存在可被本牌收掉的残血敌」判断，标度保持在「不盖过致命/救命」的区间。
 */
const value = require('../value');

// 本牌的预估单发伤害（仅作收尾判定的粗估；多重命中按总伤算，斩杀牌另判）。
function estDamage(s) {
  if (!s) return 0;
  let d = (s.value || 0) * (s.hits || 1);
  if (!d && s.effects) for (const e of s.effects) if (e.type === 'damage') d += (e.value || 0) * (e.hits || 1);
  // 多段(multi)/连击(multiHit)：本牌伤害多打几次，收尾判定按总伤估。
  if (s.multiHit) d *= (1 + s.multiHit);
  return d;   // 注：调度(_next/_every)伤害是延迟的、不计入「本回合一击收尾」判定
}
// 本牌带斩杀效果吗（v3 的斩杀只走 effects:{type:'execute'}，cardStats **不**透出 s.execute 字段）。
function hasExecute(s) {
  return (s.effects || []).some(e => e.type === 'execute');
}
// 本牌算不算「伤害牌」（含条件缩放伤害 / 斩杀 / 穿刺）。
function isDamageCard(s) {
  return s.kind === 'damage' || s.pierce || hasExecute(s) || s.multi || s.multiHit || s.combo ||
    (s.condBonus || []).some(c => /^damage/.test(c.atom || '')) ||   // v3.2：condBonus 用 atom（含 damage_next/_every）
    (s.effects || []).some(e => e.type === 'damage');                // 即时/召唤物伤害（调度伤害不计入「本回合收尾」）
}

value.registerPack('power', {
  // 收尾：手里这张伤害牌能解决某个残血敌时 → 正偏好（focus，避免把伤害砸满血敌）。
  playPolicy(CG, g, card, s) {
    if (!isDamageCard(s)) return 0;
    const alive = g.aliveEnemies();
    if (!alive.length) return 0;
    const est = estDamage(s);
    let killable = false, lowHp = false;
    for (const e of alive) {
      const low = e.hp <= e.maxHp * 0.2;
      if (low) lowHp = true;
      if (e.hp <= est || low) killable = true;       // 本牌可一击带走 / 已是残血
    }
    if (!killable) return 0;
    if (hasExecute(s) && lowHp) return 22;            // 斩杀牌遇残血敌：强收尾（残血时斩杀伤害爆发，V 难提前体现）
    return 12;                                        // 普通伤害牌收尾：中等偏好（导向击杀、缩短拖局）
  },
});

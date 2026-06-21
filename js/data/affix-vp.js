window.CG = window.CG || {};

/* ===========================================================================
 *  词条价值模型（资源置换 v2）—— 见 DESIGN-resource-exchange.md
 * ===========================================================================
 *  每条词条 = 一笔交易：付出「代价(cost)」→ 获得「价值(value)」，软目标 VP(value) ≤ VP(cost)。
 *  本文件给资源定价（CG.VALUES）并按 def.cost / def.value 直接算 VP，
 *  供单测断言价值排序 / 基础卡平衡，并用 CG.affixVPReport() 暴露越界项。
 *  软约束：越界只打印、不报错；最终由 bench/ 模拟实测校准。
 *
 *  价值排序铁律（用户拍板）：治疗 > 格挡 > 伤害；虚弱(防御性) > 易伤/脆弱(进攻性)。
 * ========================================================================= */
(function (CG) {
  const V = {
    // 主资源
    damage: 1.0, block: 1.2, heal: 1.5, draw: 2.5, energy: 6.0,
    hp: 0.5, gold: 0.25, power: 1.0, maxhp: 1.0,
    // 增益状态（每层）
    strength: 4.0, tempStr: 1.5, dexterity: 3.0,
    // 敌方减益（每层）：虚弱(防御性) > 易伤/脆弱(进攻性)
    vulnerable: 1.5, weak: 2.0, frail: 1.5, poison: 1.5, burn: 1.3, frozen: 4.0,
    // 其它价值（近似）
    element: 2.0, lifesteal: 6.0, mult: 6.0, execute: 6.0, conjure: 4.0,
    food: 2.0, summon: 3.0, building: 5.0, produce: 5.0, depth: 0.8, heat: 0.8,
  };
  CG.VALUES = V;

  // 条件/机会类代价的「机会预算」≈ 1 能量/级（不扣真资源，但价值受此封顶）
  const COND_BUDGET = 6.0;

  function resVP(res, amt, level) {
    const per = V[res] != null ? V[res] : 0;
    return per * (amt == null ? 1 : amt) * (level || 1);
  }

  /* CG.affixVP(id, level) → { id, level, gain, cost, rate, condCost, note } */
  CG.affixVP = function (id, level) {
    const a = CG.AFFIXES[id];
    if (!a) return null;
    const L = level || 1;
    const v = a.value || {}, c = a.cost || {};
    const round = x => Math.round(x * 100) / 100;
    // 价值 VP：条件类价值往往无 amt（随条件量），用机会预算 ×L 估
    let gain = v.amt != null ? resVP(v.res, v.amt, L) : COND_BUDGET * L;
    if (v.res === 'mult') gain = V.mult * L;
    if (v.res === 'lifesteal') gain = V.lifesteal * (v.amt || 0.3) * L;
    // 代价 VP：真资源 ×L；条件类记机会预算（不随等级）
    const condCost = !!c.cond;
    const cost = condCost ? COND_BUDGET : resVP(c.res, c.amt, L);
    return { id, level: L, gain: round(gain), cost: round(cost), condCost,
             rate: cost > 0 ? round(gain / cost) : null, note: CG.affixCostText(id, L) + ' → ' + CG.affixValueText(id, L) };
  };

  // 全表报告：自含真资源兑换按汇率降序（条件类不计汇率）。
  CG.affixVPReport = function (level) {
    const rows = CG.AFFIX_ORDER.map(id => CG.affixVP(id, level || 1));
    const real = rows.filter(r => r.rate != null && !r.condCost).sort((x, y) => y.rate - x.rate);
    return { rows, exchanges: real, violations: real.filter(r => r.rate > 1.0001) };
  };
})(window.CG);

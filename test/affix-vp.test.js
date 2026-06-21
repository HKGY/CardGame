'use strict';
/* 词条价值模型（资源置换）—— js/data/affix-vp.js
 * 硬断言「价值排序铁律」与「基础卡平衡不变式」；越界汇率仅打印（软目标）。 */
const test = require('node:test');
const assert = require('node:assert');
const CG = require('./harness');

test('价值排序铁律：治疗 > 格挡 > 伤害', () => {
  const V = CG.VALUES;
  assert.ok(V.heal > V.block, `治疗(${V.heal}) 应 > 格挡(${V.block})`);
  assert.ok(V.block > V.damage, `格挡(${V.block}) 应 > 伤害(${V.damage})`);
});

test('敌方减益对称同价：虚弱 = 易伤 = 脆弱', () => {
  const V = CG.VALUES;
  assert.strictEqual(V.weak, V.vulnerable);
  assert.strictEqual(V.frail, V.vulnerable);
});

test('基础卡平衡不变式：5格挡 = 6伤害 = 1能量 = 6VP', () => {
  const V = CG.VALUES;
  assert.strictEqual(5 * V.block, V.energy);
  assert.strictEqual(6 * V.damage, V.energy);
  assert.strictEqual(5 * V.block, 6 * V.damage);
});

test('全词条覆盖：每条都有有限 VP 估值', () => {
  for (const id of CG.AFFIX_ORDER) {
    for (const L of [1, 2, 3]) {
      const r = CG.affixVP(id, L);
      assert.ok(r, `${id} 缺少 VP 估值`);
      assert.ok(Number.isFinite(r.gain), `${id} L${L} gain 非有限: ${r.gain}`);
      assert.ok(Number.isFinite(r.cost), `${id} L${L} cost 非有限: ${r.cost}`);
    }
  }
});

test('真资源兑换不越界：价值 VP ≤ 代价 VP（回归守卫）', () => {
  for (const L of [1, 2, 3]) {
    const rep = CG.affixVPReport(L);
    const lines = rep.violations.map(r => `  ⚠ ${r.id} gain=${r.gain} cost=${r.cost} rate=${r.rate} — ${r.note}`);
    if (lines.length) console.log(`\n[资源置换] L${L} 越界：\n${lines.join('\n')}`);
    assert.strictEqual(rep.violations.length, 0, `L${L} 有 ${rep.violations.length} 条真资源兑换越界（价值 > 代价）`);
  }
});

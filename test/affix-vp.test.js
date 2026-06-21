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

test('价值排序：防御性减益 > 进攻性减益（虚弱 > 易伤/脆弱）', () => {
  const V = CG.VALUES;
  assert.ok(V.weak > V.vulnerable, `虚弱(${V.weak}) 应 > 易伤(${V.vulnerable})`);
  assert.ok(V.weak > V.frail, `虚弱(${V.weak}) 应 > 脆弱(${V.frail})`);
});

test('基础卡平衡不变式：5格挡 = 6伤害 = 1能量 = 6VP', () => {
  const V = CG.VALUES;
  assert.strictEqual(5 * V.block, V.energy);
  assert.strictEqual(6 * V.damage, V.energy);
  assert.strictEqual(5 * V.block, 6 * V.damage);
});

test('生命作为支付资源带风险溢价（< 伤害单价）', () => {
  assert.ok(CG.VALUES.hp < CG.VALUES.damage);
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

test('自含真资源兑换越界项（软目标，仅打印不失败）', () => {
  const rep = CG.affixVPReport(1);
  const lines = rep.violations.map(r => `  ⚠ ${r.id} gain=${r.gain} cost=${r.cost} rate=${r.rate} — ${r.note}`);
  console.log('\n[资源置换] 真资源兑换汇率 > 1（待 bench 校准）：');
  console.log(lines.length ? lines.join('\n') : '  （无）');
  assert.ok(Array.isArray(rep.violations));
});

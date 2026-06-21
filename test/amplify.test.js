'use strict';
/* 放大包（amplify）：翻倍——本牌数值×、本回合增益/减益翻倍、临时力量、当前力量翻倍。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');
const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('放大包存在且词条齐全', () => {
  assert.ok(CG.PACKS.amplify && CG.PACKS.amplify.name === '放大包');
  ['potent', 'amppain', 'ampgain', 'boon', 'polarize'].forEach(id => { assert.ok(CG.PACKS.amplify.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
});

test('强效：本牌数值 ×(1+等级)', () => {
  const b = CG.makeBattle(); const hp = b.enemies[0].hp;
  b.hand = [gemCard('strike', [{ id: 'potent', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp - 18);            // 打击 6 ×3
});

test('倍损：本回合施加给敌人的减益翻倍', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('defend', ['amppain']), gemCard('strike', ['suppress'])];
  b.playCard(b.hand[0].uid); assert.equal(b._ampDebuff, 1);
  b.playCard(b.hand.find(c => c.base === 'strike').uid);
  assert.equal(b.enemies[0].statuses.vulnerable, 2);  // 易伤 1 → 翻倍 2
});

test('倍益：本回合获得的增益翻倍', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('defend', ['ampgain']), gemCard('strike', [{ id: 'brace', level: 1 }])];
  b.playCard(b.hand[0].uid);
  b.playCard(b.hand.find(c => c.base === 'strike').uid);
  assert.equal(b.player.statuses.strength, 2);        // 严阵 +1 → 翻倍 2
});

test('激赏：临时力量（回合末清除）；极化：当前力量翻倍', () => {
  let b = CG.makeBattle();
  b.hand = [gemCard('strike', [{ id: 'boon', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.strength, 2); assert.equal(b._tempStrength, 2);   // 1×2 临时
  b = CG.makeBattle(); b.player.statuses.strength = 3;
  b.hand = [gemCard('strike', ['polarize'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.strength, 6);        // 3 → 翻倍 6
});

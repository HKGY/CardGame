'use strict';
/* 律动包（flow）：条件触发 & 能量博弈 & 活力。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');
const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('律动包存在且词条齐全', () => {
  assert.ok(CG.PACKS.flow && CG.PACKS.flow.name === '律动包');
  ['vigor', 'innate', 'inspire', 'allin', 'surplus'].forEach(id => { assert.ok(CG.PACKS.flow.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
});

test('活力：下一张牌 +3×等级（不加给本张）', () => {
  const b = CG.makeBattle(); b.player.energy = 5;
  b.hand = [gemCard('defend', ['vigor']), gemCard('strike', ['draw'])];   // 第二张随便带个增益占位
  b.playCard(b.hand[0].uid);                          // 活力卡：_vigor=3
  assert.equal(b._vigor, 3);
  const hp = b.enemies[0].hp;
  b.playCard(b.hand.find(c => c.base === 'strike').uid);
  assert.equal(b.enemies[0].hp, hp - 9);             // 打击 6 + 活力 3
  assert.equal(b._vigor, 0);                         // 用掉
});

test('固有：必出现在开局手牌', () => {
  const deck = [...CG.makeDeck(Array.from({ length: 10 }, () => ['strike'])), gemCard('defend', ['innate'])];
  const b = CG.makeBattle({ deck });
  assert.ok(b.hand.some(c => CG.cardStats(c).innate));
});

test('灵感：本回合每抽到一张牌 +格挡', () => {
  const b = CG.makeBattle(); b.player.block = 0;
  b.hand = [gemCard('strike', [{ id: 'inspire', level: 2 }])];
  b.drawPile = [CG.makeCard('strike'), CG.makeCard('strike')];
  b.playCard(b.hand[0].uid);                          // _inspire=2
  b.drawCards(2);
  assert.equal(b.player.block, 4);                   // 2 张 × 2
});

test('全力：能量恰好归零时 ×2；余裕：能量充裕则免费', () => {
  let b = CG.makeBattle(); b.player.energy = 1;
  let hp = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['allin'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp - 12);            // 打击 6 ×2（打出后能量 0）
  b = CG.makeBattle(); b.player.energy = 4;
  b.hand = [gemCard('strike', ['surplus'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.energy, 4);                  // 充裕→免费
});

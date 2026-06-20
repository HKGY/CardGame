'use strict';
/* 弃牌包（discard）：主动丢弃换收益 + 弃牌堆回收。forget→clutch、waste→loseEnergy、leak 复用。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');
const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('弃牌包存在且词条齐全', () => {
  assert.ok(CG.PACKS.discard && CG.PACKS.discard.name === '弃牌包');
  ['toss', 'sift', 'reclaim', 'dumpster', 'madness'].forEach(id => { assert.ok(CG.PACKS.discard.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['forget', 'waste', 'leak'].forEach(id => { assert.ok(CG.PACKS.discard.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
});

test('抛掷：弃 1 张并造伤；倾倒：数值 +本回合弃牌数', () => {
  let b = CG.makeBattle();
  b.hand = [gemCard('strike', ['toss']), CG.makeCard('defend')];
  const hp = b.enemies[0].hp; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp - 12);            // 打击 6 + 抛掷 6
  assert.ok(b.discardPile.some(c => c.base === 'defend'));   // 被弃
  b = CG.makeBattle(); b._discardedThisTurn = 3;
  const hp2 = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['dumpster'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp2 - 9);            // 6 + 已弃 3
});

test('整理：弃 2 抽 2；疯狂：弃光手牌·每张+1力量', () => {
  let b = CG.makeBattle();
  b.hand = [gemCard('strike', ['sift']), CG.makeCard('defend'), CG.makeCard('defend')];
  b.playCard(b.hand[0].uid);
  assert.equal(b._discardedThisTurn, 2); assert.equal(b.hand.length, 2);   // 弃2抽2
  b = CG.makeBattle();
  b.hand = [gemCard('strike', ['madness']), CG.makeCard('defend'), CG.makeCard('defend')];
  b.playCard(b.hand[0].uid);
  assert.equal(b.hand.length, 0); assert.equal(b.player.statuses.strength, 2);
});

test('拾遗：从弃牌堆取回指定 1 张', () => {
  const b = CG.makeBattle();
  const lost = CG.makeCard('strike'); b.discardPile = [lost];
  b.hand = [gemCard('strike', ['reclaim'])]; b.playCard(b.hand[0].uid);
  assert.ok(b.pick && b.pick.type === 'reclaim');
  b.pickResolve(lost.uid);
  assert.ok(b.hand.some(c => c.uid === lost.uid));
  assert.ok(!b.discardPile.some(c => c.uid === lost.uid));
});

test('负面：健忘随机弃牌 / 浪费扣能', () => {
  let b = CG.makeBattle();
  b.hand = [gemCard('strike', ['forget']), CG.makeCard('defend')];
  b.playCard(b.hand[0].uid);
  assert.ok(b.discardPile.some(c => c.base === 'defend'));   // 健忘(clutch)弃 1
  b = CG.makeBattle(); b.player.energy = 3;
  b.hand = [gemCard('strike', ['waste'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.energy, 1);                  // -1(打击) -1(浪费)
});

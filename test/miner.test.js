'use strict';
/* 矿工包（miner）：挖矿攒「深度」(_depth)，深度换伤害/格挡，掘出金币/宝石。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('矿工包存在且词条齐全', () => {
  assert.ok(CG.PACKS.miner && CG.PACKS.miner.name === '矿工包');
  ['mine', 'blast', 'prospect', 'quarry', 'richvein'].forEach(id => { assert.ok(CG.PACKS.miner.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['cavein', 'barren', 'disaster'].forEach(id => { assert.ok(CG.PACKS.miner.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
});

test('开采：深度 +2×等级，每跨 5 深度掘出金币', () => {
  const b = CG.makeBattle({ run: { gold: 0, gems: [] } });
  b.hand = [gemCard('strike', [{ id: 'mine', level: 3 }])];   // 深度 +6
  b.playCard(b.hand[0].uid);
  assert.equal(b._depth, 6);
  assert.equal(b.run.gold, 8);                        // 跨过 5 一次 → +8 金币
});

test('寻脉：伤害 +深度；采石：格挡 +深度', () => {
  let b = CG.makeBattle(); b._depth = 10;
  const hp0 = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['prospect'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp0 - 16);            // 打击 6 + 深度 10
  b = CG.makeBattle(); b._depth = 8;
  b.hand = [gemCard('defend', ['quarry'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.block, 13);                   // 防御 5 + 深度 8
});

test('爆破 +5×等级深度；富矿掘出随机宝石进背包', () => {
  let b = CG.makeBattle({ run: { gold: 0, gems: [] } });
  b.hand = [gemCard('strike', ['blast'])]; b.playCard(b.hand[0].uid);
  assert.equal(b._depth, 5);
  b = CG.makeBattle({ run: { gold: 0, gems: [] } });
  b.hand = [gemCard('strike', [{ id: 'richvein', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(b.run.gems.length, 2);                 // 掘出 2 颗宝石
});

test('塌方自伤 / 贫矿减深度 / 矿难深度减半', () => {
  let b = CG.makeBattle(); b.player.hp = 20;
  b.hand = [gemCard('strike', ['cavein'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.hp, 17);                      // -3
  b = CG.makeBattle(); b._depth = 10;
  b.hand = [gemCard('strike', ['barren'])]; b.playCard(b.hand[0].uid);
  assert.equal(b._depth, 7);                          // -3
  b = CG.makeBattle(); b._depth = 11;
  b.hand = [gemCard('strike', ['disaster'])]; b.playCard(b.hand[0].uid);
  assert.equal(b._depth, 5);                          // floor(11/2)
});

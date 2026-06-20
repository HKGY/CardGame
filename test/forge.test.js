'use strict';
/* 锻造包（forge）：攒「热度」(_heat)，高热爆发；熔炼/淬炼一次性烧光热度。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('锻造包存在且词条齐全', () => {
  assert.ok(CG.PACKS.forge && CG.PACKS.forge.name === '锻造包');
  ['bellows', 'ember', 'smelt', 'coolant', 'whitehot'].forEach(id => { assert.ok(CG.PACKS.forge.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['overheat', 'crack', 'rust'].forEach(id => { assert.ok(CG.PACKS.forge.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
});

test('鼓风攒热度 +2×等级；余烬重击伤害 +热度', () => {
  let b = CG.makeBattle();
  b.hand = [gemCard('strike', [{ id: 'bellows', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(b._heat, 4);                           // +2×2
  b = CG.makeBattle(); b._heat = 5;
  const hp0 = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['ember'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp0 - 11);            // 打击 6 + 热度 5
});

test('熔炼：造（热度×等级）伤害后清零；淬炼：换等量格挡后清零', () => {
  let b = CG.makeBattle(); b._heat = 7;
  const hp0 = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['smelt'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp0 - 13);            // 打击 6 + 熔炼 7
  assert.equal(b._heat, 0);
  b = CG.makeBattle(); b._heat = 6;
  b.hand = [gemCard('defend', ['coolant'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.block, 11);                   // 防御 5 + 热度 6
  assert.equal(b._heat, 0);
});

test('过热→灼伤 / 崩裂扣格挡 / 锈蚀扣热度', () => {
  let b = CG.makeBattle();
  b.hand = [gemCard('strike', ['overheat'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.burn, 2);            // 灼伤 2
  b = CG.makeBattle(); b.player.block = 10;
  b.hand = [gemCard('strike', ['crack'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.block, 6);                    // -4
  b = CG.makeBattle(); b._heat = 10;
  b.hand = [gemCard('strike', ['rust'])]; b.playCard(b.hand[0].uid);
  assert.equal(b._heat, 7);                           // -3
});

test('资源跨回合保留、愚者重开清零', () => {
  const b = CG.makeBattle();
  b._heat = 5; b._depth = 8;
  b.endTurn(); b.runEnemyTurn();                      // 进入下一回合
  assert.equal(b._heat, 5); assert.equal(b._depth, 8);   // 战斗内保留
  b.restart();
  assert.equal(b._heat, 0); assert.equal(b._depth, 0);   // 重开清零
});

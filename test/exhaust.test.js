'use strict';
/* 消耗包：灰烬/燃烧/涅槃/不坏/重生 + 爆燃/着火(灼伤)/噩梦(渣滓) 的纯逻辑（引擎层）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => ({ id: a, level: 1 })))]);

test('消耗包存在且词条齐全', () => {
  assert.ok(CG.PACKS.exhaust);
  ['ashes', 'burning', 'nirvana', 'undying', 'reborn'].forEach(id => { assert.ok(CG.PACKS.exhaust.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['detonate', 'onfire', 'nightmare'].forEach(id => { assert.ok(CG.PACKS.exhaust.debuffs.includes(id)); assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].debuff); });
});

test('灰烬：本牌数值 +（(消耗堆牌数 + 8) × 等级）', () => {
  const b = CG.makeBattle({ deck: CG.makeDeck(Array.from({ length: 10 }, () => ['strike'])) });
  b.exhaustPile = [CG.makeCard('strike'), CG.makeCard('strike'), CG.makeCard('strike')];   // 已消耗 3 张
  const card = gemCard('strike', ['ashes']);
  b.hand = [card];
  const hp0 = b.enemies[0].hp;
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp0 - 17);                      // 打击 6 + 灰烬(1×(3+8)=11) = 17
});

test('燃烧：打出后选择并消耗 1 张手牌', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['burning']);
  const victim = CG.makeCard('defend');
  b.hand = [card, victim];
  b.playCard(card.uid);
  assert.ok(b.pick && b.pick.type === 'burn', '应进入燃烧选牌');
  b.pickResolve(victim.uid);
  assert.ok(!b.pick);
  assert.ok(b.exhaustPile.some(c => c.uid === victim.uid), '被选中的牌进消耗堆');
  assert.ok(!b.hand.some(c => c.uid === victim.uid));
});

test('涅槃：这张牌被消耗时再打出 1 次（配合销毁 = 打两次）', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['nirvana', 'destroy']);
  b.hand = [card];
  const hp0 = b.enemies[0].hp;
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp0 - 12);                      // 打出一次 6 + 被消耗时涅槃再 6
  assert.ok(b.exhaustPile.some(c => c.uid === card.uid));
});

test('不坏：这张牌被消耗时生成 1 张相同副本（新 uid，保留词条）', () => {
  const b = CG.makeBattle();
  const card = gemCard('defend', ['undying', 'destroy']);
  b.hand = [card];
  b.playCard(card.uid);
  assert.ok(b.exhaustPile.some(c => c.uid === card.uid), '原牌被消耗');
  assert.equal(b.hand.length, 1, '生成 1 张副本进手牌');
  const copy = b.hand[0];
  assert.notEqual(copy.uid, card.uid, '副本是新 uid');
  assert.ok(CG.cardStats(copy).undying, '副本保留不坏');
});

test('重生：把消耗堆指定 1 张牌加入手牌', () => {
  const b = CG.makeBattle();
  const lost = CG.makeCard('strike');
  b.exhaustPile = [lost];
  const card = gemCard('strike', ['reborn']);
  b.hand = [card];
  b.playCard(card.uid);
  assert.ok(b.pick && b.pick.type === 'reborn');
  b.pickResolve(lost.uid);
  assert.ok(b.hand.some(c => c.uid === lost.uid), '取回手牌');
  assert.ok(!b.exhaustPile.some(c => c.uid === lost.uid), '离开消耗堆');
});

test('爆燃：打出后消耗其余所有手牌', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['detonate']);
  const a = CG.makeCard('defend'), c2 = CG.makeCard('defend');
  b.hand = [card, a, c2];
  b.playCard(card.uid);
  assert.equal(b.hand.length, 0, '手牌清空');
  assert.ok(b.exhaustPile.some(x => x.uid === a.uid) && b.exhaustPile.some(x => x.uid === c2.uid));
});

test('着火→灼伤：每回合受伤、可被格挡、逐回合 -1', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', ['onfire'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.burn, 1);                      // 着火 → 灼伤 1
  b.player.maxHp = 50; b.player.hp = 20; b.player.block = 0;
  b.endTurn();
  assert.equal(b.player.hp, 19);                               // 灼伤 1、无格挡
  assert.ok(!b.player.statuses.burn);                          // 逐回合 -1 → 清空

  const b2 = CG.makeBattle();
  b2.player.maxHp = 50; b2.player.hp = 20; b2.player.block = 5; b2.player.statuses.burn = 3;
  b2.endTurn();
  assert.equal(b2.player.hp, 20);                              // 灼伤 3 被 5 格挡吸收
});

test('噩梦：用渣滓塞满手牌（上限 10）；渣滓 1 费、打出即消耗、无效果', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', ['nightmare'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.hand.length, 10);
  assert.ok(b.hand.every(c => c.base === 'dross'));
  const ds = CG.cardStats(b.hand[0]);
  assert.equal(ds.cost, 1); assert.equal(ds.exhaust, true); assert.equal(ds.effects.length, 0);
});

test('涅槃/不坏随等级：被消耗时打出 N 次 / 生成 N 副本', () => {
  const b = CG.makeBattle();
  const card = CG.makeCard('strike', 2, [CG.makeGem([{ id: 'nirvana', level: 2 }, { id: 'destroy', level: 1 }])]);
  b.hand = [card];
  const hp0 = b.enemies[0].hp;
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp0 - 18);                     // 打出 6 + 涅槃 2 次各 6
  const b2 = CG.makeBattle();
  const c2 = CG.makeCard('defend', 2, [CG.makeGem([{ id: 'undying', level: 2 }, { id: 'destroy', level: 1 }])]);
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.hand.length, 2, '不坏 2 级生成 2 张副本');
});

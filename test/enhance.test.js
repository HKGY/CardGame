'use strict';
/* 强化包：锤炼/磨砺/觉醒/淬火/共鸣 + 过锻/退火/应力 的纯逻辑（卡牌实例本场永久成长）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

// 造一张单宝石卡：gemCard('strike', ['temper']) 或 gemCard('strike', [{id:'temper',level:2}])
const gemCard = (base, affixes, limit) =>
  CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);
// 造一张多宝石卡：每个 entry 是一颗宝石的词条数组
const multiGemCard = (base, gems, limit) =>
  CG.makeCard(base, limit || gems.length, gems.map(g => CG.makeGem(g.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))));

test('强化包存在；不与已有「强攻包(power)」冲突', () => {
  assert.ok(CG.PACKS.enhance && CG.PACKS.enhance.name === '强化包');
  assert.equal(CG.PACKS.enhance.icon, '✨');
  assert.equal(CG.PACKS.power.name, '强攻包');                 // 旧 power 包未被覆盖
  ['temper', 'whet', 'awaken', 'quench', 'resonance'].forEach(id => {
    assert.ok(CG.PACKS.enhance.buffs.includes(id), `${id} 应在强化包增益`);
    assert.ok(CG.AFFIXES[id] && !CG.AFFIXES[id].debuff, `${id} 应为增益`);
  });
  ['overforge', 'anneal', 'stress'].forEach(id => {
    assert.ok(CG.PACKS.enhance.debuffs.includes(id), `${id} 应在强化包减益`);
    assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].debuff, `${id} 应为减益`);
  });
});

test('锤炼：打出后本牌成长永久 +L，再次取数数值更高', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', [{ id: 'temper', level: 2 }]);   // L2：每次打出 +2
  const v0 = CG.cardStats(card).value;                            // 6（打击基础）
  assert.equal(card.growth || 0, 0);
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(card.growth, 2, '打出后成长 +2');
  const v1 = CG.cardStats(card).value;
  assert.equal(v1, v0 + 2, '成长叠进数值');
  // 再次打出继续累积（同一实例，进弃牌堆后仍保留成长）
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(card.growth, 4);
  assert.equal(CG.cardStats(card).value, v0 + 4);
});

test('磨砺：随机一张手牌成长 +2×L（出牌后只剩目标牌 → 必中它）', () => {
  const b = CG.makeBattle();
  const whet = gemCard('strike', [{ id: 'whet', level: 2 }]);
  const target = CG.makeCard('defend');                          // 唯一的另一张手牌
  b.hand = [whet, target];
  b.playCard(whet.uid);                                          // 打出后手牌仅剩 target
  assert.equal(target.growth, 4, '另一张手牌成长 +2×2=4');
  assert.equal((whet.growth || 0), 0, '磨砺牌自身不长（升的是别人）');
});

test('觉醒：累计打出 2 次后跳变 +8×L（仅一次）', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', [{ id: 'awaken', level: 1 }]);
  const v0 = CG.cardStats(card).value;
  b.hand = [card]; b.playCard(card.uid);                        // 第 1 次：未觉醒
  assert.equal(card.plays, 1);
  assert.ok(!card.awakened, '第一次未觉醒');
  assert.equal(CG.cardStats(card).value, v0, '未觉醒时数值不变');
  b.hand = [card]; b.playCard(card.uid);                        // 第 2 次 → 觉醒
  assert.equal(card.plays, 2);
  assert.equal(card.awakened, true);
  assert.equal(card.growth, 8, '觉醒 +8×1');
  assert.equal(CG.cardStats(card).value, v0 + 8);
  b.hand = [card]; b.playCard(card.uid);                        // 第 3 次：不再二次觉醒
  assert.equal(card.plays, 3);
  assert.equal(card.growth, 8, '觉醒只触发一次');
});

test('淬火：随机一张手牌耗能永久 -1', () => {
  const b = CG.makeBattle();
  const quench = gemCard('strike', ['quench']);
  const target = CG.makeCard('defend');                          // 耗能 1
  assert.equal(CG.cardStats(target).cost, 1);
  b.hand = [quench, target];
  b.playCard(quench.uid);                                       // 打出后只剩 target
  assert.equal(target.costDown, 1);
  assert.equal(CG.cardStats(target).cost, 0, '降费后耗能下限 0');
});

test('共鸣：本牌数值额外 +（已镶宝石数 × L）', () => {
  // 单宝石（socketCount=1）：6 + 1×1 = 7
  const one = gemCard('strike', [{ id: 'resonance', level: 1 }]);
  assert.equal(CG.cardStats(one).value, 7);
  // 两宝石（socketCount=2）：6 + 2×1 = 8（suppress 不改数值，只施加易伤）
  const two = multiGemCard('strike', [['resonance'], ['suppress']]);
  assert.equal(CG.cardStats(two).value, 8, '镶嵌越多、共鸣加成越高');
});

test('过锻：成长 ≥6 时本牌打出后碎裂（exhaust）', () => {
  const card = gemCard('strike', ['overforge']);
  assert.equal(CG.cardStats(card).exhaust, false, '成长不足时不碎裂');
  card.growth = 6;                                              // 模拟已积累成长
  assert.equal(CG.cardStats(card).exhaust, true, '成长≥6 → 碎裂');
  // 实战：成长≥6 的过锻牌打出后进消耗堆而非弃牌堆
  const b = CG.makeBattle();
  const c2 = gemCard('strike', ['overforge']);
  c2.growth = 6;
  b.hand = [c2];
  const dlen = b.discardPile.length, elen = b.exhaustPile.length;
  b.playCard(c2.uid);
  assert.equal(b.discardPile.length, dlen, '未进弃牌堆');
  assert.equal(b.exhaustPile.length, elen + 1, '进了消耗堆');
});

test('退火：随机一张手牌成长 -L（不低于 0）', () => {
  const b = CG.makeBattle();
  const anneal = gemCard('strike', [{ id: 'anneal', level: 1 }]);  // L1 → -2
  const target = CG.makeCard('defend');
  target.growth = 5;
  b.hand = [anneal, target];
  b.playCard(anneal.uid);                                       // 打出后只剩 target
  assert.equal(target.growth, 3, '5 - 2 = 3');
  // 夹到 0：成长不足以被减完时归 0、不为负
  const b2 = CG.makeBattle();
  const a2 = gemCard('strike', [{ id: 'anneal', level: 1 }]);
  const t2 = CG.makeCard('defend');
  t2.growth = 1;
  b2.hand = [a2, t2];
  b2.playCard(a2.uid);
  assert.equal(t2.growth, 0, '不为负');
});

test('应力：打出后失去 2×L 生命（复用 loseHp）', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', [{ id: 'stress', level: 2 }]);   // L2 → 失去 4 HP
  const hp0 = b.player.hp;
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.player.hp, hp0 - 4, '应力自伤 2×L');
});

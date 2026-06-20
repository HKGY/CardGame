'use strict';
/* 市场包（econ）：金币当战斗资源——投资/进账/贸易/暴富/雇佣 + 赋税/通胀/赌债。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('市场包存在；与厨艺词条 market（给调味料）不冲突', () => {
  assert.ok(CG.PACKS.econ && CG.PACKS.econ.name === '市场包');
  ['invest', 'income', 'trade', 'windfall', 'hire'].forEach(id => { assert.ok(CG.PACKS.econ.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['tax', 'inflation', 'debt'].forEach(id => { assert.ok(CG.PACKS.econ.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
  assert.equal(CG.AFFIXES.market.give, 'season');   // 同名 affix `market` 仍是厨艺「给调味料」，与市场包(id econ)无关
});

test('进账 +6 / 赋税 -4 / 通胀 ×0.8 改变 run.gold', () => {
  let b = CG.makeBattle({ run: { gold: 100, gems: [] } });
  b.hand = [gemCard('strike', ['income'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.run.gold, 106);
  b = CG.makeBattle({ run: { gold: 100, gems: [] } });
  b.hand = [gemCard('strike', ['tax'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.run.gold, 96);
  b = CG.makeBattle({ run: { gold: 100, gems: [] } });
  b.hand = [gemCard('strike', ['inflation'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.run.gold, 80);
});

test('投资：花 5 金币造 10 伤害；雇佣：花 5 金币 +1 力量', () => {
  let b = CG.makeBattle({ run: { gold: 100, gems: [] } });
  let hp0 = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['invest'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.run.gold, 95);
  assert.equal(b.enemies[0].hp, hp0 - 16);            // 打击 6 + 投资 10
  b = CG.makeBattle({ run: { gold: 100, gems: [] } });
  b.hand = [gemCard('strike', ['hire'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.run.gold, 95); assert.equal(b.player.statuses.strength, 1);
});

test('暴富：数值 +（当前金币 ÷10）；贸易：抽牌 + 金币', () => {
  const b = CG.makeBattle({ run: { gold: 100, gems: [] } });
  const hp0 = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['windfall'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp0 - 16);            // 6 + 100/10
  const t = CG.makeBattle({ run: { gold: 0, gems: [] } });
  const hb = t.hand.length;
  t.hand.push(gemCard('strike', ['trade'])); t.playCard(t.hand[t.hand.length - 1].uid);
  assert.equal(t.run.gold, 4);                        // 贸易 +4
  assert.equal(t.hand.length, hb + 1);                // 原手牌 + 抽 1 - 打出 1 = +1（净）... 见下
});

test('赌债：金币不足时改为失血抵债', () => {
  const b = CG.makeBattle({ run: { gold: 1, gems: [] } });
  b.player.hp = 30;
  b.hand = [gemCard('strike', ['debt'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.run.gold, 0);
  assert.equal(b.player.hp, 27);                      // 失 3 血抵债
});

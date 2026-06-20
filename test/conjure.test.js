'use strict';
/* 术士包（conjure）：凭空造牌/复制/灵视/牌库强化。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');
const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('术士包存在且词条齐全；飞刀基底', () => {
  assert.ok(CG.PACKS.conjure && CG.PACKS.conjure.name === '术士包');
  ['conjure', 'daggers', 'duplicate', 'foresight', 'mindblast'].forEach(id => { assert.ok(CG.PACKS.conjure.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  const sh = CG.cardStats(CG.makeFoodCard('shiv'));
  assert.equal(sh.cost, 0); assert.equal(sh.exhaust, true); assert.equal(sh.effects[0].value, 4);
});

test('演卡印基础牌；飞刀生成 3 张；谵妄塞渣滓', () => {
  let b = CG.makeBattle(); b.hand = [gemCard('strike', ['conjure'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.hand.filter(c => c.base === 'strike' || c.base === 'defend').length, 2);   // 印 1+1
  b = CG.makeBattle(); b.hand = [gemCard('strike', ['daggers'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.hand.filter(c => c.base === 'shiv').length, 3);
  b = CG.makeBattle(); b.hand = [gemCard('strike', [{ id: 'clutter', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(b.hand.filter(c => c.base === 'dross').length, 2);
});

test('复制：手牌多一张同名副本（新 uid）', () => {
  const b = CG.makeBattle();
  const tag = CG.makeCard('defend');
  b.hand = [gemCard('strike', ['duplicate']), tag];
  b.playCard(b.hand[0].uid);                          // 打出复制牌（剩 tag），复制 tag
  const defs = b.hand.filter(c => c.base === 'defend');
  assert.equal(defs.length, 2);
});

test('灵视：免费打出抽牌堆顶（敌人掉血、顶牌进弃牌堆）', () => {
  const b = CG.makeBattle({ deck: CG.makeDeck(Array.from({ length: 10 }, () => ['strike'])) });
  b.drawPile = [CG.makeCard('strike')];              // 顶是打击 6
  b.hand = [gemCard('strike', ['foresight'])];
  const hp = b.enemies[0].hp; b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp - 12);            // 本牌打击 6 + 灵视打出顶牌 6
  assert.equal(b.drawPile.length, 0);
});

test('心灵震慑：牌库攻击牌永久 +伤害（复用 growth）', () => {
  const b = CG.makeBattle();
  const atk = CG.makeCard('strike'), def = CG.makeCard('defend');
  b.drawPile = [atk, def];
  b.hand = [gemCard('strike', [{ id: 'mindblast', level: 2 }])];
  b.playCard(b.hand[0].uid);
  assert.equal(atk.growth, 2);                        // 攻击牌 +2
  assert.equal(def.growth || 0, 0);                  // 防御不受影响
  assert.equal(CG.cardStats(atk).value, 8);          // 打击 6 + 2
});

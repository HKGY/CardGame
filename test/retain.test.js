'use strict';
/* 留置包：保留/蓄势/蓄力一击/屯牌/待发 + 沉重/滞涩/手滑(clutch) 的纯逻辑（引擎层）。
 * 实例字段：inst.heldTurns（在手回合数）、inst.heldBonus（蓄势永久加成）、inst.holdCost（净改费，可正可负）。
 * 推进回合用 b.endTurn(); b.runEnemyTurn();（注意 retain 的牌跨回合留在手里）。
 * 跨 vm realm：断言用 .length / 逐值，避免 deepEqual。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

// 造一张「单宝石、若干词条」的卡（默认 strike，base 6 伤害）
const gemCard = (base, affixes, limit) =>
  CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);
const inHand = (b, uid) => b.hand.some(c => c.uid === uid);
const inDiscard = (b, uid) => b.discardPile.some(c => c.uid === uid);
const findCard = (b, uid) => b.hand.find(c => c.uid === uid);

test('留置包存在；词条齐全且增益/减益归类正确', () => {
  assert.ok(CG.PACKS.retain && CG.PACKS.retain.name === '留置包');
  assert.equal(CG.PACKS.retain.icon, '🤲');
  ['keep', 'chargeup', 'heldstrike', 'hoard', 'primed'].forEach(id => {
    assert.ok(CG.PACKS.retain.buffs.includes(id), id + ' 应在留置包增益');
    assert.ok(CG.AFFIXES[id], id + ' 未定义');
    assert.equal(CG.isDebuff(id), false, id + ' 不应是减益');
  });
  ['heavyhold', 'sluggish', 'clutch'].forEach(id => {
    assert.ok(CG.PACKS.retain.debuffs.includes(id), id + ' 应在留置包减益');
    assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].debuff, id + ' 应是减益');
  });
});

test('cardStats：留置包系数/标志正确透出', () => {
  assert.equal(CG.cardStats(gemCard('strike', ['keep'])).retain, true);
  assert.equal(CG.cardStats(gemCard('strike', ['heavyhold'])).retain, true);   // 沉重也强制保留
  assert.equal(CG.cardStats(gemCard('strike', [{ id: 'chargeup', level: 2 }])).chargeUp, 2);
  assert.equal(CG.cardStats(gemCard('strike', [{ id: 'heldstrike', level: 3 }])).heldStrike, 3);
  assert.equal(CG.cardStats(gemCard('strike', [{ id: 'hoard', level: 2 }])).hoard, 2);
  assert.equal(CG.cardStats(gemCard('strike', [{ id: 'primed', level: 2 }])).primed, 2);
  assert.equal(CG.cardStats(gemCard('strike', [{ id: 'sluggish', level: 2 }])).sluggish, 2);
  // 食材卡（foodStats）默认补 0/false，无 inst 字段也安全
  const fs = CG.foodStats({ uid: 1, base: 'tomato' });
  assert.equal(fs.retain, false);
  assert.equal(fs.heldStrike, 0); assert.equal(fs.hoard, 0);
  assert.equal(fs.chargeUp, 0); assert.equal(fs.primed, 0); assert.equal(fs.sluggish, 0);
});

test('cardStats：heldBonus 增值、holdCost 改费（含降费夹 0）', () => {
  // 蓄势加成走 inst.heldBonus
  const c = gemCard('strike', ['chargeup']);
  c.heldBonus = 3;
  assert.equal(CG.cardStats(c).value, 9);               // 6 + 3
  // holdCost 涨费
  const up = gemCard('strike', ['sluggish']);
  up.holdCost = 2;
  assert.equal(CG.cardStats(up).cost, 3);               // 1 + 2
  // holdCost 降费（可负），夹到 0
  const down = gemCard('strike', ['primed']);
  down.holdCost = -5;
  assert.equal(CG.cardStats(down).cost, 0);             // max(0, 1 - 5)
});

test('保留(keep)：endTurn 后留在手；非保留牌进弃牌堆', () => {
  const b = CG.makeBattle();
  const keepCard = gemCard('strike', ['keep']);
  const plain = CG.makeCard('defend');
  b.hand = [keepCard, plain];
  b.endTurn();
  assert.ok(inHand(b, keepCard.uid), 'keep 牌应保留在手');
  assert.ok(!inHand(b, plain.uid), '非保留牌应离开手');
  assert.ok(inDiscard(b, plain.uid), '非保留牌进弃牌堆');
});

test('沉重(heavyhold)：强制保留在手（减益也算 retain）', () => {
  const b = CG.makeBattle();
  const heavy = gemCard('strike', ['heavyhold']);
  b.hand = [heavy];
  b.endTurn();
  assert.ok(inHand(b, heavy.uid), '沉重牌强制留在手里');
  assert.ok(!inDiscard(b, heavy.uid));
});

test('蓄势(chargeup)：每留 1 回合 heldBonus 增长，数值随之变高', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['chargeup']);
  b.hand = [card];
  assert.equal(card.heldBonus || 0, 0);
  assert.equal(CG.cardStats(card).value, 6);            // 初始 = 基底
  b.endTurn(); b.runEnemyTurn();                        // 过 1 个回合（牌保留、heldTurns/heldBonus +1）
  const c1 = findCard(b, card.uid);
  assert.ok(c1, '蓄势牌应仍在手');
  assert.equal(c1.heldTurns, 1);
  assert.equal(c1.heldBonus, 1);
  assert.equal(CG.cardStats(c1).value, 7);              // 6 + 1
  b.endTurn(); b.runEnemyTurn();                        // 再过 1 个回合
  const c2 = findCard(b, card.uid);
  assert.equal(c2.heldBonus, 2);
  assert.equal(CG.cardStats(c2).value, 8);              // 6 + 2
});

test('蓄力一击(heldstrike)：伤害随在手回合数增加', () => {
  // 直接设 heldTurns，确定性验证加成公式：+ heldTurns × 2 × 等级
  const b = CG.makeBattle();
  const c0 = gemCard('strike', ['heldstrike']);
  c0.heldTurns = 0;
  b.hand = [c0];
  let hp = b.enemies[0].hp;
  b.playCard(c0.uid);
  assert.equal(b.enemies[0].hp, hp - 6, '在手 0 回合 = 纯基底 6');

  const b2 = CG.makeBattle();
  const c3 = gemCard('strike', ['heldstrike']);
  c3.heldTurns = 3;
  b2.hand = [c3];
  hp = b2.enemies[0].hp;
  b2.playCard(c3.uid);
  assert.equal(b2.enemies[0].hp, hp - 12, '在手 3 回合 = 6 + 3×2×1');

  const b3 = CG.makeBattle();
  const c2 = gemCard('strike', [{ id: 'heldstrike', level: 2 }]);
  c2.heldTurns = 2;
  b3.hand = [c2];
  hp = b3.enemies[0].hp;
  b3.playCard(c2.uid);
  assert.equal(b3.enemies[0].hp, hp - 14, '2 级·在手 2 回合 = 6 + 2×2×2');
});

test('屯牌(hoard)：伤害随出牌后手牌数增加', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['hoard']);
  const a = CG.makeCard('defend'), c2 = CG.makeCard('defend');
  b.hand = [card, a, c2];                               // 打出后手牌剩 2 张
  const hp = b.enemies[0].hp;
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp - 8, '6 + (出牌后手牌 2 × 等级 1)');

  // 手牌只剩自己时：出牌后手牌 0 → 无加成
  const b2 = CG.makeBattle();
  const solo = gemCard('strike', ['hoard']);
  b2.hand = [solo];
  const hp2 = b2.enemies[0].hp;
  b2.playCard(solo.uid);
  assert.equal(b2.enemies[0].hp, hp2 - 6, '独自一张 = 纯基底 6');
});

test('待发(primed)：每留 1 回合本牌降费', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['primed']);          // primed 自带 retain
  b.hand = [card];
  assert.equal(CG.cardStats(card).cost, 1);            // 初始 1 费
  b.endTurn(); b.runEnemyTurn();
  const c1 = findCard(b, card.uid);
  assert.ok(c1, '待发牌应保留在手');
  assert.equal(c1.holdCost, -1);
  assert.equal(CG.cardStats(c1).cost, 0);              // max(0, 1 - 1)
});

test('滞涩(sluggish)：每留 1 回合本牌涨费（配 keep 保留以验证攒费）', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['keep', 'sluggish']);   // keep 保证留在手，sluggish 攒费
  b.hand = [card];
  assert.equal(CG.cardStats(card).cost, 1);            // 初始 1 费
  b.endTurn(); b.runEnemyTurn();
  const c1 = findCard(b, card.uid);
  assert.ok(c1, '保留在手');
  assert.equal(c1.holdCost, 1);
  assert.equal(CG.cardStats(c1).cost, 2);              // 1 + 1
  b.endTurn(); b.runEnemyTurn();
  const c2 = findCard(b, card.uid);
  assert.equal(c2.holdCost, 2);
  assert.equal(CG.cardStats(c2).cost, 3);              // 1 + 2
});

test('手滑(clutch)：打出后随机弃 N 张手牌', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['clutch']);          // 1 级：弃 1 张
  const a = CG.makeCard('defend'), c2 = CG.makeCard('defend'), c3 = CG.makeCard('defend');
  b.hand = [card, a, c2, c3];                           // 打出 clutch 后手牌剩 3 张，再随机弃 1
  b.playCard(card.uid);
  assert.equal(b.hand.length, 2, 'clutch 牌出掉 + 随机弃 1 → 手牌从 4 变 2');

  // 2 级：弃 2 张
  const b2 = CG.makeBattle();
  const card2 = gemCard('strike', [{ id: 'clutch', level: 2 }]);
  const x = CG.makeCard('defend'), y = CG.makeCard('defend'), z = CG.makeCard('defend');
  b2.hand = [card2, x, y, z];
  b2.playCard(card2.uid);
  assert.equal(b2.hand.length, 1, '2 级随机弃 2 → 手牌从 4 变 1');

  // 手牌不够弃：弃光为止、不报错
  const b3 = CG.makeBattle();
  const only = gemCard('strike', [{ id: 'clutch', level: 3 }]);
  b3.hand = [only];
  b3.playCard(only.uid);
  assert.equal(b3.hand.length, 0);
});

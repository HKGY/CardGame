'use strict';
/* 宝石 / 卡牌（法杖）数据逻辑：cardStats 聚合、镶嵌/卸下、宝石生成、价格、初始牌组。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const buffsOf = g => g.affixes.filter(a => !CG.isDebuff(a.id));
const dbfsOf  = g => g.affixes.filter(a => CG.isDebuff(a.id));
const eff = (s, type) => s.effects.find(e => e.type === type);

test('makeGem / makeCard 结构正确', () => {
  const gem = CG.makeGem([{ id: 'multi', level: 1 }]);
  assert.ok(gem.uid > 0);
  assert.equal(gem.affixes.length, 1);

  const card = CG.makeCard('strike', 2, [gem]);
  assert.equal(card.base, 'strike');
  assert.equal(card.limit, 2);
  assert.equal(card.sockets.length, 1);
  assert.equal(CG.cardEmptySockets(card), 1);
  // makeCard 深拷贝宝石（新 uid，互不影响）
  assert.notEqual(card.sockets[0].uid, gem.uid);

  // limit 至少容纳传入的宝石数
  const c2 = CG.makeCard('strike', 1, [CG.makeGem([{ id: 'multi', level: 1 }]), CG.makeGem([{ id: 'overload', level: 1 }])]);
  assert.equal(c2.limit, 2);
});

test('cardStats：空法杖 = 纯基底数值', () => {
  const s = CG.cardStats(CG.makeCard('strike', 2, []));
  assert.equal(s.value, 6);
  assert.equal(s.cost, 1);
  assert.equal(s.hits, 1);
  assert.equal(s.emptySockets, 2);
  assert.equal(s.name, '打击◇◇');
  assert.equal(eff(s, 'damage').value, 6);

  const d = CG.cardStats(CG.makeCard('defend', 1, []));
  assert.equal(d.value, 5);
  assert.equal(eff(d, 'block').value, 5);
});

test('cardStats：宝石词条聚合到卡', () => {
  // 多重 → +1 次攻击
  let s = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'multi', level: 1 }])]));
  assert.equal(s.hits, 2);
  assert.equal(s.name, '打击(多重)');

  // 过载 → 数值 +100%
  s = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'overload', level: 1 }])]));
  assert.equal(s.value, 12);

  // 笨重（减益）→ 耗能 +1
  s = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'cumbersome', level: 1 }])]));
  assert.equal(s.cost, 2);

  // 压制 → 给敌人易伤
  s = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'suppress', level: 2 }])]));
  assert.equal(eff(s, 'vulnerable').value, 2);
});

test('cardStats：多颗宝石分组显示 + 空孔 ◇', () => {
  const card = CG.makeCard('strike', 3, [
    CG.makeGem([{ id: 'multi', level: 1 }]),
    CG.makeGem([{ id: 'overload', level: 1 }, { id: 'cumbersome', level: 1 }]),
  ]);
  const s = CG.cardStats(card);
  assert.equal(s.name, '打击(多重)(过载+笨重)◇');   // 两组宝石 + 一个空孔
  assert.equal(s.gemViews.length, 2);
  assert.equal(s.cost, 2);                            // 笨重 +1
  assert.equal(s.hits, 2);                            // 多重 +1
  assert.equal(s.value, 12);                          // 过载 ×2
});

test('准备(prepare)：本回合力量 +等级（任意基底，走 tempStrength）', () => {
  const onStrike = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'prepare', level: 2 }])]));
  assert.equal(eff(onStrike, 'tempStrength').value, 2);
  assert.equal(eff(onStrike, 'strength'), undefined);   // 不再永久加力量

  const onDefend = CG.cardStats(CG.makeCard('defend', 1, [CG.makeGem([{ id: 'prepare', level: 2 }])]));
  assert.equal(eff(onDefend, 'tempStrength').value, 2); // 防御也给力量（不再分敏捷）
  assert.equal(eff(onDefend, 'dexterity'), undefined);
});

test('installGem 受孔位限制', () => {
  const card = CG.makeCard('strike', 1, []);
  assert.equal(CG.installGem(card, CG.makeGem([{ id: 'multi', level: 1 }])), true);
  assert.equal(CG.cardEmptySockets(card), 0);
  assert.equal(CG.installGem(card, CG.makeGem([{ id: 'overload', level: 1 }])), false);  // 满孔
  assert.equal(card.sockets.length, 1);
});

test('uninstallGem 取出宝石并随机附带一个减益', () => {
  const card = CG.makeCard('strike', 1, [CG.makeGem([{ id: 'multi', level: 1 }])]);
  const before = card.sockets[0].affixes.length;
  assert.equal(CG.gemHasDebuff(card.sockets[0]), false);
  const gem = CG.uninstallGem(card, 0);
  assert.equal(card.sockets.length, 0);
  assert.equal(gem.affixes.length, before + 1);     // 多了一个 debuff
  assert.equal(CG.gemHasDebuff(gem), true);
});

test('gemAddRandomDebuff / gemRemoveOneDebuff', () => {
  const gem = CG.makeGem([{ id: 'multi', level: 1 }]);
  CG.gemAddRandomDebuff(gem);
  assert.equal(dbfsOf(gem).length, 1);
  CG.gemRemoveOneDebuff(gem);
  assert.equal(dbfsOf(gem).length, 0);
  assert.equal(buffsOf(gem).length, 1);             // 增益保留
});

test('recutGem 保持增益/减益数量不变', () => {
  const gem = CG.makeGem([{ id: 'overload', level: 3 }, { id: 'cumbersome', level: 1 }]);
  CG.recutGem(gem);
  assert.equal(buffsOf(gem).length, 1);
  assert.equal(dbfsOf(gem).length, 1);
});

test('addSocket 递增 limit，封顶 MAX_SOCKETS', () => {
  const card = CG.makeCard('strike', 1, []);
  for (let i = 0; i < 10; i++) CG.addSocket(card);
  assert.equal(card.limit, CG.MAX_SOCKETS);
});

test('rollGem：小宝石 = 1 增益0减益；大宝石 = 强增益+减益', () => {
  for (let i = 0; i < 40; i++) {
    const small = CG.rollGem({ big: false, tier: 'monster' });
    assert.equal(buffsOf(small).length, 1);
    assert.equal(dbfsOf(small).length, 0);

    const big = CG.rollGem({ big: true, tier: 'monster' });
    assert.ok(buffsOf(big).length >= 1);
    assert.ok(dbfsOf(big).length >= 1);

    const boss = CG.rollGem({ tier: 'boss' });       // 首领恒为大宝石
    assert.ok(buffsOf(boss).length >= 1);
    assert.ok(dbfsOf(boss).length >= 1);
  }
});

test('gemPrice / cardPrice 为正且随强度上升', () => {
  const small = CG.gemPrice(CG.makeGem([{ id: 'multi', level: 1 }]));
  const strong = CG.gemPrice(CG.makeGem([{ id: 'overload', level: 3 }]));
  assert.ok(small > 0 && strong > small);

  const wand1 = CG.cardPrice(CG.makeCard('strike', 1, []));
  const wand3 = CG.cardPrice(CG.makeCard('strike', 3, []));
  assert.ok(wand1 > 0 && wand3 > wand1);             // 孔越多越贵
});

test('buildDeck：各职业 10 张，战士预镶 2 颗', () => {
  assert.equal(CG.buildDeck('warrior').length, 10);
  assert.equal(CG.buildDeck('shield').length, 10);
  assert.equal(CG.buildDeck('priest').length, 10);
  assert.equal(CG.buildDeck('warrior').filter(c => c.sockets.length).length, 2);
});

test('cloneCard 深拷贝（改副本不影响原卡）', () => {
  const card = CG.makeCard('strike', 2, [CG.makeGem([{ id: 'multi', level: 1 }])]);
  const copy = CG.cloneCard(card);
  copy.sockets[0].affixes[0].level = 99;
  assert.equal(card.sockets[0].affixes[0].level, 1);  // 原卡未被改动
});

test('gemName 显示格式：增益(减益)', () => {
  assert.equal(CG.gemName(CG.makeGem([{ id: 'multi', level: 1 }])), '多重');
  assert.equal(CG.gemName(CG.makeGem([{ id: 'overload', level: 2 }, { id: 'cumbersome', level: 1 }])), '更过载(笨重)');
});

test('回春：cardStats 产出 heal = 2×等级', () => {
  const s = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'recover', level: 3 }])]));
  assert.equal(eff(s, 'heal').value, 6);   // 2×3
});

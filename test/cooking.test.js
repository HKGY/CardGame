'use strict';
/* 厨艺包：食材/餐点/调味料/厨具/腐坏卡的纯逻辑 —— foodStats、菜谱 buildMeal、做菜流程、give 词条、腐坏回合结算、卡包。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const eff = (s, type) => s.effects.find(e => e.type === type);

test('厨艺包存在且词条齐全', () => {
  assert.ok(CG.PACKS.cook, '应有厨艺包');
  ['farm', 'ranch', 'market', 'kitchen'].forEach(id => { assert.ok(CG.PACKS.cook.buffs.includes(id)); assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].give); });
  ['rot', 'spoil', 'mold'].forEach(id => { assert.ok(CG.PACKS.cook.debuffs.includes(id)); assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].debuff && CG.AFFIXES[id].give); });
  // 从厨艺包 roll 出的小宝石只含 give 增益
  for (let i = 0; i < 20; i++) CG.rollGem({ pack: 'cook', tier: 'monster', big: false }).affixes
    .forEach(a => assert.ok(['farm', 'ranch', 'market', 'kitchen'].includes(a.id), '小厨艺宝石应只含 give 增益'));
});

test('foodStats：素菜/荤菜/调味料/厨具/腐坏 的固定效果', () => {
  assert.equal(CG.cardStats(CG.makeFoodCard('tomato')).kind, 'veg');
  const meat = CG.cardStats(CG.makeFoodCard('beef'));
  assert.equal(meat.kind, 'meat'); assert.equal(eff(meat, 'heal').value, 3);           // 牛肉回复3
  assert.equal(CG.cardStats(CG.makeFoodCard('salt')).noPlay, true);                    // 调味料不能单独吃
  const cleaver = CG.cardStats(CG.makeFoodCard('cleaver'));
  assert.equal(eff(cleaver, 'damage').value, 5);                                       // 菜刀攻击5
  assert.equal(eff(CG.cardStats(CG.makeFoodCard('wok')), 'block').value, 4);           // 铁锅防御4
  const stove = CG.cardStats(CG.makeFoodCard('stove'));
  assert.equal(stove.element, 'fire'); assert.equal(stove.elementLevel, 2);            // 火炉附火2
  assert.equal(CG.cardStats(CG.makeFoodCard('spoiled_rice')).noPlay, true);            // 腐坏不能打出
});

test('菜谱 buildMeal：素菜单做=回复其等级；素菜炖荤菜=等级相乘×2 + 矩阵效果；调味料修正', () => {
  let m = CG.buildMeal('tomato', null, null);
  assert.equal(eff(m, 'heal').value, 1);                                   // 清炒番茄 = 回复1
  m = CG.buildMeal('carrot', 'beef', null);                                // 牛肉×胡萝卜 → 回响, 3×3×2=18
  assert.equal(m.effects[0].type, 'freeNext'); assert.equal(m.effects[0].value, 18);
  m = CG.buildMeal('potato', 'chicken', null);                            // 鸡肉×土豆 → 壁垒(block), 2×2×2=8
  assert.equal(m.effects[0].type, 'block'); assert.equal(m.effects[0].value, 8);
  m = CG.buildMeal('tomato', 'fish', 'salt');                             // 鱼肉×番茄→回复 1×1×2=2，盐(过载)×2=4
  assert.equal(eff(m, 'heal').value, 4);
  m = CG.buildMeal('carrot', 'fish', 'soy');                              // 鱼肉×胡萝卜→荆棘 1×3×2=6（滋养只加治疗，这里不变）
  assert.equal(m.effects[0].type, 'selfStatus'); assert.equal(m.effects[0].status, 'thorns'); assert.equal(m.effects[0].value, 6);
  m = CG.buildMeal('potato', 'beef', 'pepper');                           // 牛肉×土豆→明亮 2×3×2=12，胡椒=重复2次
  assert.equal(m.effects[0].type, 'energy'); assert.equal(m.effects[0].value, 12); assert.equal(m.repeatTimes, 2);
});

test('做菜流程：打出素菜→选荤菜→选调味料→餐点进手牌；原料被消耗；打出餐点生效', () => {
  const b = CG.makeBattle();
  b.hand = [CG.makeFoodCard('tomato'), CG.makeFoodCard('fish'), CG.makeFoodCard('salt')];
  const [veg, fish, salt] = b.hand;
  b.playCard(veg.uid);
  assert.ok(b.craft && b.craft.step === 'meat', '应进入做菜·选荤菜');
  b.craftChoose(fish.uid);
  assert.equal(b.craft.step, 'season', '推进到选调味料');
  b.craftChoose(salt.uid);
  assert.ok(!b.craft, '做菜结束');
  const meal = b.hand.find(c => c.base === 'meal');
  assert.ok(meal, '餐点进手牌');
  assert.equal(b.hand.filter(c => ['tomato', 'fish', 'salt'].includes(c.base)).length, 0, '原料已消耗');
  assert.equal(b.exhaustPile.filter(c => ['tomato', 'fish', 'salt'].includes(c.base)).length, 3);
  // 鱼肉×番茄→回复 2，盐×2 = 4；打出餐点回血 4 并消耗
  const s = CG.cardStats(meal);
  assert.equal(s.cost, 0); assert.equal(s.exhaust, true);
  assert.equal(eff(s, 'heal').value, 4);
  b.player.maxHp = 50; b.player.hp = 10;
  b.playCard(meal.uid);
  assert.equal(b.player.hp, 14);
  assert.ok(b.exhaustPile.some(c => c.base === 'meal'), '餐点打出后消耗');
});

test('做菜可跳过荤菜与调味料：只放素菜=清炒回复', () => {
  const b = CG.makeBattle();
  b.hand = [CG.makeFoodCard('potato')];
  const veg = b.hand[0];
  b.playCard(veg.uid);
  b.craftChoose(null);   // 跳过荤菜
  b.craftChoose(null);   // 跳过调味料
  const meal = b.hand.find(c => c.base === 'meal');
  assert.ok(meal);
  assert.equal(eff(CG.cardStats(meal), 'heal').value, 2);   // 清炒土豆 = 回复2
});

test('give 词条：打出带「农场」的卡获得随机素菜（数量=等级）', () => {
  const b = CG.makeBattle();
  const card = CG.makeCard('strike', 1, [CG.makeGem([{ id: 'farm', level: 2 }])]);
  b.hand = [card];
  const s = CG.cardStats(card);
  assert.ok(eff(s, 'give') && eff(s, 'give').what === 'veg' && eff(s, 'give').value === 2);
  b.playCard(card.uid);
  const vegs = b.hand.filter(c => { const bd = CG.BASE_CARDS[c.base]; return bd && bd.food === 'veg'; });
  assert.equal(vegs.length, 2, '农场2 → 2 张随机素菜');
});

test('腐坏卡：回合结束自伤/减益后消耗', () => {
  let b = CG.makeBattle();
  b.hand = [CG.makeFoodCard('spoiled_rice')]; b.player.hp = 20;
  b.endTurn();
  assert.equal(b.player.hp, 18); assert.ok(b.exhaustPile.some(c => c.base === 'spoiled_rice'));

  b = CG.makeBattle();
  b.hand = [CG.makeFoodCard('rotten_veg')];
  b.endTurn();
  assert.equal(b.player.statuses.vulnerable, 2);   // 烂菜 → 易伤2
});

test('调味料 / 腐坏卡不能直接打出', () => {
  const b = CG.makeBattle();
  b.hand = [CG.makeFoodCard('salt')];
  const before = b.hand.length;
  b.playCard(b.hand[0].uid);
  assert.equal(b.hand.length, before, '盐不能打出，留在手牌');
  assert.ok(!b.craft);
});

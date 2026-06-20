'use strict';
/* 死守包：重甲/盾击/严阵/死战(+复用壁垒) + 龟缩/负重(+复用笨重) 的纯逻辑（数据 + 引擎层）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('死守包存在且词条齐全（含复用 bulwark / cumbersome）', () => {
  assert.ok(CG.PACKS.bastion && CG.PACKS.bastion.name === '死守包');
  ['bulwark', 'barricade', 'shieldbash', 'brace', 'laststand'].forEach(id => {
    assert.ok(CG.PACKS.bastion.buffs.includes(id), id + ' 应在死守包增益');
    assert.ok(CG.AFFIXES[id], id + ' 未定义');
    assert.equal(CG.isDebuff(id), false, id + ' 不应是减益');
  });
  ['cower', 'burden', 'cumbersome'].forEach(id => {
    assert.ok(CG.PACKS.bastion.debuffs.includes(id), id + ' 应在死守包减益');
    assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].debuff, id + ' 应是减益');
  });
});

test('重甲：打出后 _keepBlock=true，_startPlayerTurn 不清空格挡', () => {
  const b = CG.makeBattle();
  // 普通情况：未打重甲 → 回合开始清格挡
  b.player.block = 10;
  b._startPlayerTurn();
  assert.equal(b.player.block, 0, '默认回合开始清格挡');

  const b2 = CG.makeBattle();
  b2.hand = [gemCard('strike', ['barricade'])];
  b2.playCard(b2.hand[0].uid);
  assert.equal(b2._keepBlock, true, '打出重甲后置 _keepBlock');
  b2.player.block = 12;                       // 手动设格挡再触发下一个玩家回合
  b2._startPlayerTurn();
  assert.equal(b2.player.block, 12, '重甲后回合开始保留格挡');
});

test('盾击：伤害 = 基础 +（当前格挡 × 等级）', () => {
  const b = CG.makeBattle();
  b.player.block = 8;
  const card = gemCard('strike', ['shieldbash']);             // 1 级：+格挡×1
  const hp0 = b.enemies[0].hp;
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp0 - 14);                    // 打击 6 + 格挡 8

  const b2 = CG.makeBattle();
  b2.player.block = 5;
  const c2 = gemCard('strike', [{ id: 'shieldbash', level: 2 }]);   // 2 级：+格挡×2
  const h0 = b2.enemies[0].hp;
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.enemies[0].hp, h0 - 16);                    // 6 + 5×2
});

test('死战：残血时本牌伤害 +floor(已损失比例 × 10 × 等级)', () => {
  const b = CG.makeBattle();
  b.player.maxHp = 60; b.player.hp = 6;                       // 损失 90%
  const card = gemCard('strike', ['laststand']);
  const hp0 = b.enemies[0].hp;
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp0 - 15);                    // 6 + floor(0.9×10×1)=9

  const b2 = CG.makeBattle();                                 // 满血 → 无加成
  b2.player.maxHp = 60; b2.player.hp = 60;
  const c2 = gemCard('strike', ['laststand']);
  const h0 = b2.enemies[0].hp;
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.enemies[0].hp, h0 - 6);                     // 满血只有基础 6
});

test('严阵：获得格挡 4×等级 + 力量 等级', () => {
  const b = CG.makeBattle();
  b.player.block = 0;
  const card = gemCard('strike', [{ id: 'brace', level: 2 }]);
  const hp0 = b.enemies[0].hp;
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.player.block, 8, '格挡 4×2');
  assert.equal(b.player.statuses.strength, 2, '力量 +2');
  assert.equal(b.enemies[0].hp, hp0 - 6, '基础伤害先于严阵力量结算，仍为 6');
});

test('龟缩：打出后失去 等级 点能量', () => {
  const b = CG.makeBattle();
  b.player.energy = 5;
  const card = gemCard('strike', ['cower']);
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.player.energy, 3);                           // 5 - 1(打击耗能) - 1(龟缩) = 3
});

test('负重：打出后失去 2×等级 点格挡（不为负）', () => {
  const b = CG.makeBattle();
  b.player.block = 5;
  const card = gemCard('strike', ['burden']);
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.player.block, 3);                            // 5 - 2 = 3

  const b2 = CG.makeBattle();
  b2.player.block = 1;
  b2.hand = [gemCard('strike', ['burden'])];
  b2.playCard(b2.hand[0].uid);
  assert.equal(b2.player.block, 0, '不为负');
});

test('cardStats / foodStats 透出 shieldBash / lastStand（食材默认 0）', () => {
  const s = CG.cardStats(gemCard('strike', [{ id: 'shieldbash', level: 3 }]));
  assert.equal(s.shieldBash, 3);
  const s2 = CG.cardStats(gemCard('strike', [{ id: 'laststand', level: 2 }]));
  assert.equal(s2.lastStand, 2);
  const food = CG.foodStats(CG.makeFoodCard('tomato'));       // 食材：默认 0，避免 playCard 读 undefined
  assert.equal(food.shieldBash, 0);
  assert.equal(food.lastStand, 0);
});

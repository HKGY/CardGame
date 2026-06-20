'use strict';
/* 电力包：发电/改造(超频)/电弧/放电/充电 + 感电/麻痹/漏电 的纯逻辑（引擎层）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('电力包存在；不与已有「强攻包(power)」冲突', () => {
  assert.ok(CG.PACKS.elec && CG.PACKS.elec.name === '电力包');
  assert.equal(CG.PACKS.power.name, '强攻包');                  // 旧 power 包未被覆盖
  ['generate', 'overclock', 'arc', 'discharge', 'charge'].forEach(id => { assert.ok(CG.PACKS.elec.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['shock', 'paralyze', 'drain'].forEach(id => { assert.ok(CG.PACKS.elec.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
});

test('发电：获得电力；电力战斗内跨回合保留', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', ['generate'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.power, 2);                             // 发电2
  b.endTurn(); b.runEnemyTurn();                              // 进入下一回合
  assert.equal(b.player.power, 2);                            // 电力不随回合清零（能量才回满）
});

test('改造(超频)：改用电力付费(耗能×N)、数值×N、能量不变；电力不足打不出', () => {
  const b = CG.makeBattle();
  b.player.power = 5; b.player.energy = 3;
  const card = gemCard('strike', ['overclock']);               // 1 级：耗 1 电力、数值×1
  const hp0 = b.enemies[0].hp;
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.player.power, 4);                            // 5-1
  assert.equal(b.player.energy, 3);                          // 能量不变
  assert.equal(b.enemies[0].hp, hp0 - 6);

  const b2 = CG.makeBattle();
  b2.player.power = 5;
  const c2 = gemCard('strike', [{ id: 'overclock', level: 2 }]);  // 2 级：耗 2 电力、数值×2
  const h0 = b2.enemies[0].hp;
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.player.power, 3);                           // 5 - 1×2
  assert.equal(b2.enemies[0].hp, h0 - 12);                    // 6×2

  const b3 = CG.makeBattle();
  b3.player.power = 0;
  b3.hand = [gemCard('strike', ['overclock'])];
  const len = b3.hand.length;
  b3.playCard(b3.hand[0].uid);
  assert.equal(b3.hand.length, len);                         // 电力不足 → 未打出
});

test('电弧：数值额外 +（当前电力 × 等级），且不消耗电力', () => {
  const b = CG.makeBattle();
  b.player.power = 4;
  const card = gemCard('strike', ['arc']);
  const hp0 = b.enemies[0].hp;
  b.hand = [card];
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp0 - 10);                    // 6 + 电力4
  assert.equal(b.player.power, 4);                           // 电弧不耗电力
});

test('放电：给敌人附 2 层雷（元素）', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', ['discharge'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].statuses.thunder, 2);
});

test('充电：消耗电力换等量能量', () => {
  const b = CG.makeBattle();
  b.player.power = 3; b.player.energy = 3;
  b.hand = [gemCard('strike', ['charge'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.power, 2);                           // 3-1
  assert.equal(b.player.energy, 3);                         // -1(打击耗能) +1(充电) = 3
});

test('感电：给自己附 2 层雷（自身元素光环）', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', ['shock'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.thunder, 2);
});

test('麻痹：本回合最左 3 张无法打出，下回合解除', () => {
  const b = CG.makeBattle();
  const card = gemCard('strike', ['paralyze']);
  const a = CG.makeCard('strike'), c2 = CG.makeCard('strike'), c3 = CG.makeCard('strike'), c4 = CG.makeCard('strike');
  b.hand = [card, a, c2, c3, c4];
  b.playCard(card.uid);                                      // 打出麻痹牌本身（此刻 _paralyze 仍为 0）
  assert.equal(b._paralyze, 3);
  const len = b.hand.length;                                 // 现手牌 [a,c2,c3,c4]
  b.playCard(a.uid);                                         // a 在 idx0 < 3 → 锁住
  assert.equal(b.hand.length, len, '最左牌被麻痹，打不出');
  b.playCard(c4.uid);                                        // c4 在 idx3 → 可打
  assert.equal(b.hand.length, len - 1);
  b.endTurn(); b.runEnemyTurn();
  assert.equal(b._paralyze, 0, '下回合解除麻痹');
});

test('漏电：失去电力', () => {
  const b = CG.makeBattle();
  b.player.power = 3;
  b.hand = [gemCard('strike', ['drain'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.power, 2);
});

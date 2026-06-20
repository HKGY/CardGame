'use strict';
/* 生产包：耕作/蓄能/复利/丰收/灌溉 + 歉收/养护/滞产 的纯逻辑（引擎层）。
 * 核心＝每回合开始的被动产出引擎（_startPlayerTurn 里的「生产 tick」）。
 * 用 b.endTurn(); b.runEnemyTurn(); 推进到下一回合后断言产出。
 * 跨 vm realm：断言用 .length / 逐值，避免 deepEqual。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);
// 推进到下一个玩家回合（敌人不打死自己即可）
function nextTurn(b) { b.endTurn(); b.runEnemyTurn(); }
// 给抽牌堆塞够牌（手动覆写 b.hand 会丢弃原本抽到的 5 张，使 drawPile 偏少；测多抽时先补足）
function refillDraw(b, n) { b.drawPile = Array.from({ length: n }, () => CG.cloneCard(CG.makeCard('strike'))); }

test('生产包存在；不与已有包冲突，词条齐全', () => {
  assert.ok(CG.PACKS.produce && CG.PACKS.produce.name === '生产包');
  assert.equal(CG.PACKS.produce.icon, '🌾');
  ['farming', 'stockpile', 'compound', 'harvest', 'irrigate'].forEach(id => { assert.ok(CG.PACKS.produce.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); assert.ok(!CG.AFFIXES[id].debuff); });
  ['cropfail', 'upkeep', 'stagnate'].forEach(id => { assert.ok(CG.PACKS.produce.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
  // 旧包未被覆盖
  assert.equal(CG.PACKS.elec.name, '电力包');
  // 选包权重三档都含 produce
  ['monster', 'elite', 'boss'].forEach(t => assert.ok(CG.CONFIG.packW[t].some(p => p[0] === 'produce')));
});

test('耕作：施加 prodDraw，常驻；每回合开始额外抽牌', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', [{ id: 'farming', level: 2 }])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.prodDraw, 2);                 // selfStatus 施加（等级 2）
  // 推进到下一回合：抽 5（CARDS_PER_TURN）+ 2（耕作）
  refillDraw(b, 9); b.discardPile = []; b.exhaustPile = [];    // 备足抽牌堆（覆写 hand 会丢掉首回合抽到的牌）
  nextTurn(b);
  assert.equal(b.player.statuses.prodDraw, 2);                 // 常驻不衰减
  assert.equal(b.hand.length, 7);                             // 5 + 2
  // 再过一回合仍然多抽（验证常驻）
  refillDraw(b, 9); b.discardPile = [];
  nextTurn(b);
  assert.equal(b.player.statuses.prodDraw, 2);
  assert.equal(b.hand.length, 7);
});

test('蓄能：施加 prodBlock；每回合开始 +格挡（先清零再产出）', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('defend', [{ id: 'stockpile', level: 2 }])];
  b.playCard(b.hand[0].uid);                                   // 打防御(5格挡) + 施加 prodBlock 2
  assert.equal(b.player.statuses.prodBlock, 2);
  nextTurn(b);
  assert.equal(b.player.block, 2);                            // 回合开始格挡清零 → 仅产出 2
  assert.equal(b.player.statuses.prodBlock, 2);              // 常驻
  nextTurn(b);
  assert.equal(b.player.block, 2);                            // 每回合稳定 +2（无复利）
});

test('复利：prodGrow 让蓄能逐回合自增', () => {
  const b = CG.makeBattle();
  b.player.statuses.prodBlock = 2;                            // 起手蓄能 2
  b.hand = [gemCard('strike', [{ id: 'compound', level: 1 }])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.prodGrow, 1);
  nextTurn(b);                                                // 蓄能 2→3，产出 3 格挡
  assert.equal(b.player.statuses.prodBlock, 3);
  assert.equal(b.player.block, 3);
  nextTurn(b);                                                // 蓄能 3→4，产出 4 格挡
  assert.equal(b.player.statuses.prodBlock, 4);
  assert.equal(b.player.block, 4);
});

test('丰收：当前产出层数总和 ×等级 → 立即格挡', () => {
  const b = CG.makeBattle();
  b.player.statuses.prodDraw = 1;
  b.player.statuses.prodBlock = 2;
  b.player.statuses.prodGrow = 3;                             // 总和 = 6
  b.player.block = 0;
  b.hand = [gemCard('strike', [{ id: 'harvest', level: 2 }])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.block, 12);                          // 6 × 2
  // 产出层数本身不被丰收消耗
  assert.equal(b.player.statuses.prodDraw, 1);
  assert.equal(b.player.statuses.prodBlock, 2);
  assert.equal(b.player.statuses.prodGrow, 3);
});

test('灌溉：立即结算等级次「每回合产出」（按蓄能加格挡、按耕作抽牌）', () => {
  const b = CG.makeBattle();
  b.player.statuses.prodBlock = 3;
  b.player.statuses.prodDraw = 1;
  b.player.block = 0;
  b.discardPile = []; b.exhaustPile = [];
  b.hand = [gemCard('strike', [{ id: 'irrigate', level: 2 }])];
  const before = b.hand.length;                               // 1（仅灌溉牌）
  b.playCard(b.hand[0].uid);                                  // 打出后手牌移除灌溉牌，再抽 2×1=2 张
  assert.equal(b.player.block, 6);                           // 2 次 × 蓄能3
  assert.equal(b.hand.length, before - 1 + 2);               // 移除1张 + 灌溉抽 2 张
});

test('歉收：prodSkip 攒下来，每回合开始跳过一次产出', () => {
  const b = CG.makeBattle();
  b.player.statuses.prodBlock = 5;                            // 有蓄能可产出
  b.hand = [gemCard('strike', [{ id: 'cropfail', level: 2 }])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.prodSkip, 2);
  nextTurn(b);                                                // 第 1 次：跳过产出，prodSkip 2→1
  assert.equal(b.player.statuses.prodSkip, 1);
  assert.equal(b.player.block, 0, '本回合产出被跳过');
  assert.equal(b.player.statuses.prodBlock, 5, '蓄能仍在');
  nextTurn(b);                                                // 第 2 次：再跳过，prodSkip 1→删
  assert.equal(b.player.statuses.prodSkip, undefined);
  assert.equal(b.player.block, 0);
  nextTurn(b);                                                // 攒的歉收耗尽 → 恢复产出
  assert.equal(b.player.block, 5);
});

test('养护：prodUpkeep 每回合开始扣能量（夹 0）', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', [{ id: 'upkeep', level: 2 }])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.prodUpkeep, 2);
  nextTurn(b);
  assert.equal(b.player.energy, b.player.maxEnergy - 2);     // 回满后被养护扣 2
  assert.equal(b.player.statuses.prodUpkeep, 2);            // 常驻

  // 夹 0：养护超过能量也不为负
  const b2 = CG.makeBattle();
  b2.player.statuses.prodUpkeep = 99;
  nextTurn(b2);
  assert.equal(b2.player.energy, 0);
});

test('滞产：蓄能/耕作各 -等级（夹 0、为 0 删）', () => {
  const b = CG.makeBattle();
  b.player.statuses.prodBlock = 3;
  b.player.statuses.prodDraw = 1;
  b.hand = [gemCard('strike', [{ id: 'stagnate', level: 1 }])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.statuses.prodBlock, 2);             // 3-1
  assert.equal(b.player.statuses.prodDraw, undefined);      // 1-1=0 → 删除

  // 没有蓄能/耕作时打出滞产：安全无副作用
  const b2 = CG.makeBattle();
  b2.hand = [gemCard('strike', [{ id: 'stagnate', level: 2 }])];
  b2.playCard(b2.hand[0].uid);
  assert.equal(b2.player.statuses.prodBlock, undefined);
  assert.equal(b2.player.statuses.prodDraw, undefined);
});

test('prod* 状态不进 _tickStatuses 衰减列表（常驻）', () => {
  const b = CG.makeBattle();
  Object.assign(b.player.statuses, { prodDraw: 2, prodBlock: 2, prodGrow: 1, prodUpkeep: 1 });
  b._tickStatuses(b.player);                                  // 直接走衰减：prod* 不应改变（prodGrow 会在产出 tick 改 prodBlock，但 tick 这里不跑）
  assert.equal(b.player.statuses.prodDraw, 2);
  assert.equal(b.player.statuses.prodGrow, 1);
  assert.equal(b.player.statuses.prodUpkeep, 1);
});

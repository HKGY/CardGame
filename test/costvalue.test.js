'use strict';
/* 词条 v3「代价-价值」原子+分子模型 —— affixes.js（原子生成）/ cards.js cardStats / game.js playCard */
const test = require('node:test');
const assert = require('node:assert');
const CG = require('./harness');

const spell = (...gems) => CG.makeCard('spell', Math.max(1, gems.length), gems.map(g => CG.makeGem(g)));
const stat = c => CG.cardStats(c);
const D = CG.STRIKE, B = CG.GUARD;   // energy_damage / energy_block

test('原子生成：真资源代价 × 全部价值都存在', () => {
  assert.ok(CG.AFFIXES['energy_damage'] && CG.AFFIXES['hp_damage'] && CG.AFFIXES['gold_block'] && CG.AFFIXES['discard_heal']);
  assert.ok(CG.AFFIXES['curBlock_damage'] && CG.AFFIXES['depth_block']);   // 条件 × 数值价值
});

test('空法术基底：0 效果、费 1', () => {
  const s = stat(CG.makeCard('spell', 1, []));
  assert.strictEqual(s.value, 0);
  assert.strictEqual(s.cost, 1);
  assert.strictEqual(s.effects.length, 0);
});

test('首石＝攻击6/格挡5，复现打击/防御', () => {
  const strike = stat(spell([{ id: D, level: 1 }]));
  assert.strictEqual(strike.kind, 'damage');
  assert.strictEqual(strike.value, 6);
  assert.strictEqual(strike.cost, 1);
  const guard = stat(spell([{ id: B, level: 1 }]));
  assert.strictEqual(guard.kind, 'block');
  assert.strictEqual(guard.value, 5);
});

test('等级 ×L：价值翻倍、首石代价不变', () => {
  assert.strictEqual(stat(spell([{ id: D, level: 2 }])).value, 12);
  assert.strictEqual(stat(spell([{ id: D, level: 3 }])).value, 18);
  assert.strictEqual(stat(spell([{ id: D, level: 3 }])).cost, 1);
});

test('首石免代价、第二颗起付能量代价', () => {
  assert.strictEqual(stat(spell([{ id: D, level: 1 }])).cost, 1);
  const two = stat(spell([{ id: D, level: 1 }], [{ id: D, level: 1 }]));
  assert.strictEqual(two.cost, 2);
  assert.strictEqual(two.value, 12);
});

test('生命代价：首石免血、非首石扣 3 血（hp 2VP→3血）', () => {
  const first = stat(spell([{ id: 'hp_damage', level: 1 }]));
  assert.strictEqual(first.value, 6);
  assert.ok(!first.effects.some(e => e.type === 'loseHp'));
  const second = stat(spell([{ id: D, level: 1 }], [{ id: 'hp_damage', level: 1 }]));
  assert.ok(second.effects.some(e => e.type === 'loseHp' && e.value === 3));
});

test('条件代价：当前格挡→伤害（生成 0 伤效果 + condBonus）', () => {
  const s = stat(spell([{ id: 'curBlock_damage', level: 1 }]));
  assert.strictEqual(s.kind, 'damage');
  assert.ok(s.effects.some(e => e.type === 'damage'));
  assert.ok(s.condBonus.some(c => c.qty === 'curBlock' && c.vtype === 'damage'));
});

test('展示文字：代价 / 价值', () => {
  assert.strictEqual(CG.affixCostText(D, 1), '+1 费');
  assert.strictEqual(CG.affixValueText(D, 1), '伤害 6');
  assert.strictEqual(CG.affixValueText(D, 2), '伤害 12');
  assert.strictEqual(CG.affixCostText('curBlock_damage', 1), '当前格挡');
  assert.strictEqual(CG.affixCostText('hp_damage', 2), '失 6 血');
});

test('代价均摊：同种代价只付最高的一个', () => {
  // [首石] + strike(+1费) + strike L2(+2费) → 费 = 基底1 + max(1,2) = 3
  const s = stat(spell([{ id: D, level: 1 }], [{ id: D, level: 1 }], [{ id: D, level: 2 }]));
  assert.strictEqual(s.cost, 3);
  // [首石] + hp_damage(3血) + hp_block L2(6血) → 失血 = max(3,6) = 6
  const h = stat(spell([{ id: D, level: 1 }], [{ id: 'hp_damage', level: 1 }], [{ id: 'hp_block', level: 2 }]));
  assert.ok(h.effects.some(e => e.type === 'loseHp' && e.value === 6));
});

test('宝石只含 1 个词条（rollGem）', () => {
  for (let i = 0; i < 20; i++) assert.strictEqual(CG.rollGem({ tier: 'boss' }).affixes.length, 1);
});

// ===== 战斗集成 =====
function battle(card) {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.hand = [card]; g.playCard(card.uid);
  return g;
}

test('战斗：打击对敌 6 伤害', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  const hp0 = g.enemy.hp; g.player.energy = 9;
  const c = spell([{ id: D, level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 6);
});

test('战斗：格挡 +5', () => {
  assert.strictEqual(battle(spell([{ id: B, level: 1 }])).player.block, 5);
});

test('战斗：易伤价值→敌人获得易伤', () => {
  const g = battle(spell([{ id: 'energy_vulnerable', level: 1 }]));
  assert.ok((g.enemy.statuses.vulnerable || 0) >= 1);
});

test('战斗：条件「当前格挡→伤害」按当前格挡造伤', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.player.block = 7;
  const hp0 = g.enemy.hp;
  const c = spell([{ id: 'curBlock_damage', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 7);   // 伤害 = 当前格挡 7 × 1
});

// ===== 完整性 =====
test('每个包的价值原子都在 VALUE_ATOMS / 组合存在于 AFFIXES', () => {
  for (const pid of CG.PACK_IDS) {
    for (const id of CG.PACKS[pid].affixes) assert.ok(CG.AFFIXES[id], `${pid} 含不存在词条 ${id}`);
  }
});

test('buildDeck 各职业产出 10 张可解析法术', () => {
  for (const cls of CG.CLASS_IDS) {
    const deck = CG.buildDeck(cls);
    assert.strictEqual(deck.length, 10);
    deck.forEach(c => assert.ok(Number.isFinite(stat(c).cost)));
  }
});

'use strict';
/* 词条 v2「代价-价值」模型 —— 见 DESIGN-resource-exchange.md / affixes.js / cards.js cardStats */
const test = require('node:test');
const assert = require('node:assert');
const CG = require('./harness');

const spell = (...gems) => CG.makeCard('spell', Math.max(1, gems.length), gems.map(g => CG.makeGem(g)));
const stat = c => CG.cardStats(c);

test('空法术基底：0 效果、费 1', () => {
  const s = stat(CG.makeCard('spell', 1, []));
  assert.strictEqual(s.value, 0);
  assert.strictEqual(s.cost, 1);
  assert.strictEqual(s.effects.length, 0);
});

test('首石＝攻击6/格挡5，复现打击/防御', () => {
  const strike = stat(spell([{ id: 'strike', level: 1 }]));
  assert.strictEqual(strike.kind, 'damage');
  assert.strictEqual(strike.value, 6);
  assert.strictEqual(strike.cost, 1);
  const guard = stat(spell([{ id: 'guard', level: 1 }]));
  assert.strictEqual(guard.kind, 'block');
  assert.strictEqual(guard.value, 5);
  assert.strictEqual(guard.cost, 1);
});

test('等级 ×L：价值翻倍、首石代价不变', () => {
  assert.strictEqual(stat(spell([{ id: 'strike', level: 2 }])).value, 12);
  assert.strictEqual(stat(spell([{ id: 'strike', level: 3 }])).value, 18);
  assert.strictEqual(stat(spell([{ id: 'strike', level: 3 }])).cost, 1);   // 首石免代价
});

test('首石免代价、第二颗起付能量代价', () => {
  const one = stat(spell([{ id: 'strike', level: 1 }]));
  assert.strictEqual(one.cost, 1, '单颗＝基底费 1');
  const two = stat(spell([{ id: 'strike', level: 1 }], [{ id: 'strike', level: 1 }]));
  assert.strictEqual(two.cost, 2, '第二颗 +1 能量');
  assert.strictEqual(two.value, 12);
});

test('首石免代价对「生命代价」生效；非首石才扣血', () => {
  const first = stat(spell([{ id: 'o_devote', level: 1 }]));   // 首石：免代价 → 纯 6 伤
  assert.strictEqual(first.value, 6);
  assert.ok(!first.effects.some(e => e.type === 'loseHp'), '首石不应扣血');
  const second = stat(spell([{ id: 'strike', level: 1 }], [{ id: 'o_devote', level: 1 }]));
  assert.ok(second.effects.some(e => e.type === 'loseHp' && e.value === 2), '第二颗才扣血 2');
  assert.strictEqual(second.cost, 1, '生命代价不加能量费');
});

test('条件型价值：当前格挡→伤害（生成 0 伤效果供 playCard 加成）', () => {
  const s = stat(spell([{ id: 'b_bash', level: 1 }]));
  assert.strictEqual(s.kind, 'damage');
  assert.ok(s.effects.some(e => e.type === 'damage'));
  assert.strictEqual(s.shieldBash, 1);
});

test('多颗宝石叠多种价值：伤害 + 格挡同存', () => {
  const s = stat(spell([{ id: 'strike', level: 1 }], [{ id: 'guard', level: 1 }]));
  assert.ok(s.effects.some(e => e.type === 'damage' && e.value === 6));
  assert.ok(s.effects.some(e => e.type === 'block' && e.value === 5));
});

test('展示文字：代价 / 价值 两栏', () => {
  assert.strictEqual(CG.affixCostText('strike', 1), '+1 费');
  assert.strictEqual(CG.affixValueText('strike', 1), '伤害 6');
  assert.strictEqual(CG.affixValueText('strike', 2), '伤害 12');
  assert.strictEqual(CG.affixCostText('b_bash', 1), '当前格挡');   // 条件类只写名字
  assert.strictEqual(CG.affixCostText('o_devote', 2), '生命 4');
});

// ===== 战斗集成（真实 Game 管线）=====
function battle(card) {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: 'strike', level: 1 }]]]]) });
  g.player.energy = 9;
  g.hand = [card];
  g.playCard(card.uid);
  return g;
}

test('战斗：打击法术对敌造成 6 伤害', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: 'strike', level: 1 }]]]]) });
  const hp0 = g.enemy.hp;
  g.player.energy = 9; const c = spell([{ id: 'strike', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 6);
});

test('战斗：格挡法术给玩家 5 格挡', () => {
  const g = battle(spell([{ id: 'guard', level: 1 }]));
  assert.strictEqual(g.player.block, 5);
});

test('战斗：弱化→敌人获得易伤', () => {
  const g = battle(spell([{ id: 'w_vuln', level: 1 }]));
  assert.ok((g.enemy.statuses.vulnerable || 0) >= 2);
});

test('战斗：第二颗舍身扣 2 生命', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: 'strike', level: 1 }]]]]) });
  const hp0 = g.player.hp;
  g.player.energy = 9;
  const c = spell([{ id: 'strike', level: 1 }], [{ id: 'o_devote', level: 1 }]);
  g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.player.hp, hp0 - 2);
});

// ===== 数据完整性 =====
test('每个包的签名词条都存在于 AFFIXES', () => {
  for (const pid of CG.PACK_IDS) {
    for (const id of CG.PACKS[pid].affixes) assert.ok(CG.AFFIXES[id], `${pid} 引用了不存在的词条 ${id}`);
  }
});

test('buildDeck 各职业产出 10 张可解析法术', () => {
  for (const cls of CG.CLASS_IDS) {
    const deck = CG.buildDeck(cls);
    assert.strictEqual(deck.length, 10);
    deck.forEach(c => assert.ok(Number.isFinite(stat(c).cost)));
  }
});

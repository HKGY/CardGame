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
  assert.ok(CG.AFFIXES['curBlock_damage'] && CG.AFFIXES['curPower_block']);   // 条件 × 数值价值
  assert.ok(!CG.AFFIXES['depth_block'] && !CG.AFFIXES['heat_damage'] && !CG.AFFIXES['kills_damage'] && !CG.AFFIXES['heldTurns_block']);   // 已删的弃用条件代价
  assert.ok(CG.PACKS.basic.affixes.includes('curBlock_damage'));   // 条件词条注入基础包
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

test('等级规则 1换1 / 2换2 / 3换2（价值 1,2,2；代价 1,2,1）', () => {
  // 价值倍率：L1=6、L2=12、L3=12
  assert.strictEqual(stat(spell([{ id: D, level: 1 }])).value, 6);
  assert.strictEqual(stat(spell([{ id: D, level: 2 }])).value, 12);
  assert.strictEqual(stat(spell([{ id: D, level: 3 }])).value, 12);
  // 代价倍率（非首石才付）：L2 +2 费、L3 +1 费（→ L3 = L2 的价值、L1 的代价）
  const L2 = stat(spell([{ id: D, level: 1 }], [{ id: D, level: 2 }]));
  assert.strictEqual(L2.cost, 3);   // 基底1 + L2 代价2
  const L3 = stat(spell([{ id: D, level: 1 }], [{ id: D, level: 3 }]));
  assert.strictEqual(L3.cost, 2);   // 基底1 + L3 代价1
  assert.ok(L3.effects.some(e => e.type === 'damage' && e.value === 18));   // 首石6 + L3价值12
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

// ===== 新条件原子（借鉴 StS 遗物）=====
test('门条件 首回合→伤害：仅首回合给 1 能量等值(6)', () => {
  assert.ok(CG.AFFIXES.firstTurn_damage && CG.AFFIXES.hurt_block && CG.AFFIXES.noBlock_damage);
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; const hp0 = g.enemy.hp;
  const c = spell([{ id: 'firstTurn_damage', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 6);   // 首回合(turn 1)达成 → 定额 6
});

test('量条件 回合数→伤害：随回合数增长', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; const hp0 = g.enemy.hp;
  const c = spell([{ id: 'turnNum_damage', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 1);   // 第 1 回合 → 1
});

test('遗物·代价→价值：棱镜核心 敌人开局 +1 力量', () => {
  const g = CG.makeBattle({ relics: ['prismcore'], deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  assert.ok((g.enemy.statuses.strength || 0) >= 1);
});

// ===== 自身减益代价（参考 StS Berserk）=====
test('自身减益代价：自易伤→伤害；首石免、非首石才上自易伤', () => {
  assert.ok(CG.AFFIXES.selfVuln_damage && CG.AFFIXES.selfWeak_block && CG.AFFIXES.selfFrail_heal);
  const first = stat(spell([{ id: 'selfVuln_damage', level: 1 }]));   // 首石免代价
  assert.strictEqual(first.value, 6);
  assert.ok(!first.effects.some(e => e.type === 'selfStatus'));
  const second = stat(spell([{ id: D, level: 1 }], [{ id: 'selfVuln_damage', level: 1 }]));
  assert.ok(second.effects.some(e => e.type === 'selfStatus' && e.status === 'vulnerable' && e.value === 3));
});

test('自残→每回合能量引擎（公平定价 selfVuln_produce_energy，取代旧 berserk 签名）', () => {
  // 递归价值 = 一次性 ×2：每回合+1能量=12VP → 自易伤代价 ceil(12/2)=6 层（破坏衡、非净正签名）
  assert.strictEqual(CG.affixCostText('selfVuln_produce_energy', 1), '自易伤 6');
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'selfVuln_produce_energy', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.player.statuses.vulnerable, 6);   // 自易伤代价（首石免，第二颗付）
  assert.strictEqual(g.player.statuses.prodEnergy, 1);
  g._startPlayerTurn();
  assert.strictEqual(g.player.energy, g.player.maxEnergy + 1);   // 下回合 = 满能量 + prodEnergy 1
});

test('扣力量代价：失力量→伤害（首石免、非首石才扣力量，可为负）', () => {
  assert.ok(CG.AFFIXES.loseStr_damage && CG.AFFIXES.loseDex_block);
  const first = stat(spell([{ id: 'loseStr_damage', level: 1 }]));
  assert.ok(!first.effects.some(e => e.type === 'strength'));   // 首石免代价
  const second = stat(spell([{ id: D, level: 1 }], [{ id: 'loseStr_damage', level: 1 }]));
  assert.ok(second.effects.some(e => e.type === 'strength' && e.value === -2));   // 失 2 力量
});

test('自身减益体系：myDebuff 把自己背的减益层数回收成伤害', () => {
  assert.ok(CG.AFFIXES.myDebuff_damage);
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.applyStatus(g.player, 'vulnerable', 4);   // 只上易伤(不减自身输出)
  const hp0 = g.enemy.hp;
  const c = spell([{ id: 'myDebuff_damage', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 4);   // 4 层自身减益 → 4 伤害
});

test('敌失力量/敏捷：永久减；临时版量翻倍且下回合复原', () => {
  assert.strictEqual(CG.affixValueText('energy_enemyLoseStr', 1), '敌失力量 2');
  assert.strictEqual(CG.affixValueText('energy_enemyLoseStrTemp', 1), '敌临时失力量 4');   // 临时＝永久 ×2
  assert.strictEqual(CG.affixValueText('energy_enemyLoseDex', 1), '敌失敏捷 2');           // 力量/敏捷对称：与敌失力量同量
  assert.strictEqual(CG.affixValueText('energy_enemyLoseDexTemp', 1), '敌临时失敏捷 4');
  // 永久：敌力量 -2
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.applyStatus(g.enemy, 'strength', 5);
  const c = spell([{ id: 'energy_enemyLoseStr', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.statuses.strength, 3);
  // 临时：敌敏捷 -4，到你下个回合复原
  const g2 = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g2.player.energy = 9; g2.applyStatus(g2.enemy, 'dexterity', 10);
  const c2 = spell([{ id: 'energy_enemyLoseDexTemp', level: 1 }]); g2.hand = [c2]; g2.playCard(c2.uid);
  assert.strictEqual(g2.enemy.statuses.dexterity, 6);
  g2._startPlayerTurn();
  assert.strictEqual(g2.enemy.statuses.dexterity, 10);   // 复原
});

test('弃牌代价：玩家自选丢弃，且在造牌之前生效', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const played = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'discard_conjure', level: 1 }]);   // 首石strike(免) + 弃牌→造牌
  const cA = spell([{ id: CG.STRIKE, level: 1 }]), cB = spell([{ id: CG.GUARD, level: 1 }]), cC = spell([{ id: CG.STRIKE, level: 1 }]);
  g.hand = [played, cA, cB, cC];
  assert.strictEqual(CG.cardStats(played).discardCost, 2);   // 弃 2 张
  g.playCard(played.uid);
  assert.ok(g.pick && g.pick.type === 'discardCost');         // 进入自选丢弃
  assert.strictEqual(g.hand.length, 3);                       // 造牌尚未发生（仍是 cA,cB,cC）
  g.pickResolve(cA.uid);                                      // 自选丢 cA
  assert.ok(g.pick && g.pick.type === 'discardCost');         // 还要再弃 1
  g.pickResolve(cB.uid);                                      // 自选丢 cB → 结算 resolve
  assert.ok(!g.pick);
  assert.ok(g.discardPile.some(c => c.uid === cA.uid) && g.discardPile.some(c => c.uid === cB.uid));   // 弃的是自选的两张
  assert.ok(g.hand.some(c => c.uid === cC.uid));             // cC 未被弃（证明非随机）
  assert.ok(g.hand.length >= 3);                             // 造牌在弃牌之后发生（cC + 2 张新造）
});

// ===== 塔罗（生成式·消耗品轨道）=====
test('塔罗生成式：价值原子牌存在且即时投放', () => {
  assert.ok(CG.TAROT.t_damage && CG.TAROT.t_block && CG.TAROT.t_energy && CG.TAROT.t_strength);
  // t_damage：即时对当前敌人造 12 伤（~2 能量）
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  const hp0 = g.enemy.hp;
  CG.TAROT.t_damage.apply(null, g, null);
  assert.strictEqual(g.enemy.hp, hp0 - 12);
  // t_block：即时 +10 格挡
  const g2 = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  CG.TAROT.t_block.apply(null, g2, null);
  assert.strictEqual(g2.player.block, 10);
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

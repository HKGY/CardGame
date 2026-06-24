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
  assert.ok(CG.AFFIXES['curBlock_damage'] && CG.AFFIXES['enemyDebuff_block']);   // 条件 × 数值价值（curPower 已改为消耗电力代价）
  assert.ok(!CG.AFFIXES['depth_block'] && !CG.AFFIXES['heat_damage'] && !CG.AFFIXES['kills_damage'] && !CG.AFFIXES['heldTurns_block']);   // 已删的弃用条件代价
  assert.ok(CG.PACKS.block.affixes.includes('curBlock_block'));   // v3.12 条件代价归入其同主题包（壁垒包：当前格挡×格挡）
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

test('生命代价：首石免血、非首石扣 2 血（hp 3VP → 6伤害=2血）', () => {
  const first = stat(spell([{ id: 'hp_damage', level: 1 }]));
  assert.strictEqual(first.value, 6);
  assert.ok(!first.effects.some(e => e.type === 'loseHp'));
  const second = stat(spell([{ id: D, level: 1 }], [{ id: 'hp_damage', level: 1 }]));
  assert.ok(second.effects.some(e => e.type === 'loseHp' && e.value === 2));   // v3.14 hp 3VP：6 伤害 = ⌈6/3⌉ = 2 血
});

test('条件代价：当前格挡→伤害（cardStats 出 condBonus，值由 playCard 按当前量结算）', () => {
  const s = stat(spell([{ id: 'curBlock_damage', level: 1 }]));
  assert.ok(s.condBonus.some(c => c.qty === 'curBlock' && c.atom === 'damage'));
  assert.strictEqual(s.kind, 'skill');   // 价值不在 cardStats 预置；实际伤害打出时按当前格挡动态结算（见战斗用例）
});

test('展示文字：代价 / 价值', () => {
  assert.strictEqual(CG.affixCostText(D, 1), '+1 费');
  assert.strictEqual(CG.affixValueText(D, 1), '对敌人造成 6 点伤害');   // damage 默认形态(本回合)＝裸值名「伤害」
  assert.strictEqual(CG.affixValueText(D, 2), '对敌人造成 12 点伤害');
  assert.strictEqual(CG.affixCostText('curBlock_damage', 1), '当前格挡');
  assert.strictEqual(CG.affixCostText('hp_damage', 2), '失 4 血');   // v3.14 hp 3VP：12 伤害 = 4 血
});

test('代价均摊：同种代价只付最高的一个', () => {
  // [首石] + strike(+1费) + strike L2(+2费) → 费 = 基底1 + max(1,2) = 3
  const s = stat(spell([{ id: D, level: 1 }], [{ id: D, level: 1 }], [{ id: D, level: 2 }]));
  assert.strictEqual(s.cost, 3);
  // [首石] + hp_damage(2血) + hp_block L2(4血) → 失血 = max(2,4) = 4（v3.14 hp 3VP）
  const h = stat(spell([{ id: D, level: 1 }], [{ id: 'hp_damage', level: 1 }], [{ id: 'hp_block', level: 2 }]));
  assert.ok(h.effects.some(e => e.type === 'loseHp' && e.value === 4));
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
  assert.strictEqual(g.enemy.hp, hp0 - 3);   // 整数分数：0.6≈3/5 → 每有 5 点格挡获得 3 → floor(7/5)×3 = 3
});

test('条件 VP → 整数「每有 X 点 A，获得 Y 点 B」（显示与判定都整数）', () => {
  // curBlock(0.6) × 伤害(1.0)：0.6 = 3/5 → 每有 5 点当前格挡，获得 3 点伤害（伤害默认形态＝裸名）
  assert.strictEqual(CG.affixValueText('curBlock_damage', 1), '每有 5 点当前格挡，对敌人造成 3 点伤害');
  assert.strictEqual(CG.affixValueText('curBlock_damage', 2), '每有 5 点当前格挡，对敌人造成 6 点伤害');   // 等级缩放 Y
  // turnNum(1.0) × 每回合中毒(VP 3.0)：1/3 → 每有 3 回合，获得 1 点每回合中毒（非默认形态带前缀；不再 ×0.33）
  assert.strictEqual(CG.affixValueText('turnNum_poison_every', 1), '每过 3 个回合，每回合使敌人获得 1 点中毒');
  // 判定整数：8 格挡 → floor(8/5)×3 = 3（按 5 一档）
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.player.block = 8; const hp0 = g.enemy.hp;
  const c = spell([{ id: 'curBlock_damage', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 3);
});

// ===== 条件原子（VP 模型 + 门型）=====
test('门条件 这张牌第一次打出→伤害：达成给 1 能量等值(6)', () => {
  assert.ok(CG.AFFIXES.firstPlay_damage && CG.AFFIXES.hurt_block && CG.AFFIXES.noBlock_damage);
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; const hp0 = g.enemy.hp;
  const c = spell([{ id: 'firstPlay_damage', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.hp, hp0 - 6);   // 第一次打出达成 → 定额 floor(6/1.0)=6
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
  assert.ok(second.effects.some(e => e.type === 'selfStatus' && e.status === 'vulnerable' && e.value === 3));   // selfVuln 2VP：6 伤害 = 3 层
});

test('自残→每回合能量引擎（公平定价 selfVuln_produce_energy，取代旧 berserk 签名）', () => {
  // 递归价值 = 一次性 ×2：每回合+1能量=12VP → 自易伤代价 ceil(12/2)=6 层（selfVuln 2VP）
  assert.strictEqual(CG.affixCostText('selfVuln_produce_energy', 1), '自易伤 6');
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'selfVuln_produce_energy', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.player.statuses.vulnerable, 6);   // 自易伤代价（首石免，第二颗付；selfVuln 2VP = 6 层）
  assert.strictEqual(g._everyTurn.length, 1);            // v3.1：每回合能量＝调度到 _everyTurn（不再 prodEnergy 状态）
  assert.strictEqual(g._everyTurn[0].type, 'energy');
  g._startPlayerTurn();
  assert.strictEqual(g.player.energy, g.player.maxEnergy + 1);   // 下回合 = 满能量 + 每回合 +1 能量
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

test('敌失力量/敏捷：每回合(永久)减；本回合(临时)版量翻倍且下回合复原', () => {
  assert.strictEqual(CG.affixValueText('energy_enemyLoseStrTemp', 1), '使敌人失去 4 点力量');         // v3.14 默认形态＝本回合(临时)、裸名、永久×2
  assert.strictEqual(CG.affixValueText('energy_enemyLoseStr', 1), '每回合使敌人失去 2 点力量');       // 每回合(永久)＝非默认、带前缀
  assert.strictEqual(CG.affixValueText('energy_enemyLoseDexTemp', 1), '使敌人失去 4 点敏捷');         // 力量/敏捷对称
  assert.strictEqual(CG.affixValueText('energy_enemyLoseDex', 1), '每回合使敌人失去 2 点敏捷');
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
  assert.ok(g.hand.length >= 2);                             // 造牌在弃牌之后发生（cC + 1 张新造的带宝石牌）
  const conjured = g.hand.find(c => c.conjuredTurn === g.turn);
  assert.ok(conjured && conjured.sockets.length >= 1);       // 新造牌带随机宝石、本回合 0 费
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

// ===== v3.1：原子「最大个数 maxCount」+ 逐级生成（LV1/LV2/LV3）=====
// 跨 vm realm：数组用 .join(',') 比较、对象逐键比较（见 CLAUDE.md，勿用 deepEqual）
const lv = id => CG.AFFIXES[id].levels.join(',');

test('每词条带 levels（实际存在的等级集合）+ costByLv（每级真实代价）', () => {
  const d = CG.AFFIXES['energy_damage'];
  assert.strictEqual(d.levels.join(','), '1,2,3');
  assert.strictEqual(d.costByLv[1], 1); assert.strictEqual(d.costByLv[2], 2); assert.strictEqual(d.costByLv[3], 1);   // L3＝廉价档（= L1 代价）
});

test('maxCount=1 食材给牌恒 LV1；每回合产出已通用化、随等级缩放', () => {
  assert.strictEqual(lv('energy_food_veg'), '1');         // 给牌固定 1 张
  assert.strictEqual(lv('energy_food_veg_every'), '1');   // 每回合给牌也 1 张/回合
  assert.strictEqual(lv('energy_produce_draw'), '1,2,3'); // 耕作=每回合抽牌（即 draw 的每回合版）
  assert.strictEqual(lv('energy_produce_block'), '1,2,3');// 每回合格挡
  assert.strictEqual(lv('energy_produce_energy'), '1,2,3');// 引擎=每回合能量
  assert.strictEqual(CG.AFFIXES['energy_produce_block'].value.amt, 2);   // 每回合格挡 LV1 = +2/回合
});

test('元素 maxCount=2：LV1 附 1 层 / LV2 附 2 层（与旧 elementBase×lvVal 一致）', () => {
  assert.strictEqual(lv('energy_fire'), '1,2,3');
  assert.strictEqual(CG.affixValueText('energy_fire', 1), '给敌人附 1 层火');
  assert.strictEqual(CG.affixValueText('energy_fire', 2), '给敌人附 2 层火');
  assert.strictEqual(CG.affixValueText('energy_fire', 3), '给敌人附 2 层火');   // L3＝廉价档（同 L2 价值）
  const s = stat(spell([{ id: 'energy_fire', level: 2 }]));
  assert.strictEqual(s.elementLevel, 2);   // 附 2 层
});

test('门型条件 → 只有 LV1+LV3（无 LV2）；量型条件 → LV1/2/3', () => {
  assert.strictEqual(lv('firstPlay_damage'), '1,3');
  assert.strictEqual(lv('noBlock_block'), '1,3');
  assert.strictEqual(lv('curBlock_damage'), '1,2,3');
  assert.strictEqual(CG.affixValueText('firstPlay_damage', 1), '这张牌本场首次打出时，对敌人造成 6 点伤害');
  assert.strictEqual(CG.affixValueText('firstPlay_damage', 3), '这张牌本场首次打出时，对敌人造成 12 点伤害');
});

test('时点修饰器：每回合伤害回合开始造伤、下回合格挡下个回合一次性给', () => {
  // 每回合伤害：打出后调度进 _everyTurn，每个回合开始结算
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: 'energy_damage_every', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g._everyTurn.length, 1);
  const hp0 = g.enemy.hp; g._startPlayerTurn();
  assert.strictEqual(g.enemy.hp, hp0 - 3);   // 每回合伤害 val1=floor(6/2)=3 → 每回合 -3
  const hp1 = g.enemy.hp; g._startPlayerTurn();
  assert.strictEqual(g.enemy.hp, hp1 - 3);   // 常驻：再下回合再 -3
  // 下回合格挡：打出本回合不给，下个回合开始 +10、且仅一次
  const g2 = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g2.player.energy = 9;
  const c2 = spell([{ id: 'energy_block_next', level: 1 }]); g2.hand = [c2]; g2.playCard(c2.uid);
  assert.strictEqual(g2.player.block, 0);          // 本回合不给
  assert.strictEqual(g2._nextTurn.length, 1);
  g2._startPlayerTurn();
  assert.strictEqual(g2.player.block, 10);         // 下回合 +10（下回合格挡 val1=floor(6/0.6)=10）
  g2._startPlayerTurn();
  assert.strictEqual(g2.player.block, 0);          // 一次性：再下回合不再加
});

test('时点修饰器·持续型：下回合力量(蓄力)＝下个回合的临时力量', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: 'energy_strength_next', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.player.statuses.strength || 0, 0);   // 本回合不加
  g._startPlayerTurn();
  assert.strictEqual(g.player.statuses.strength || 0, 8);   // 下回合临时 +8（蓄力 val1=floor(6/0.75)=8）
});

test('吸血改以 1% 为单位：LV1 50% / LV2 100%（maxCount 100）', () => {
  const a = CG.AFFIXES['energy_lifesteal'];
  assert.strictEqual(a.levels.join(','), '1,2,3');
  assert.strictEqual(a.value.amt, 50);
  assert.strictEqual(CG.affixValueText('energy_lifesteal', 1), '吸血 50%');
  assert.strictEqual(CG.affixValueText('energy_lifesteal', 2), '吸血 100%');
  // 战斗：12 伤害、LV1 吸血 50% → 回 6 血
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.player.hp = 20; const hp0 = g.player.hp;
  const c = spell([{ id: CG.STRIKE, level: 2 }], [{ id: 'energy_lifesteal', level: 1 }]);   // 首石12伤 + 吸血50%
  g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.player.hp - hp0, 6);
});

test('翻倍 maxCount=2：×2 / ×3（不再更高）', () => {
  assert.strictEqual(lv('energy_mult'), '1,2,3');
  assert.strictEqual(CG.affixValueText('energy_mult', 1), '本牌伤害/格挡/治疗 ×2');
  assert.strictEqual(CG.affixValueText('energy_mult', 2), '本牌伤害/格挡/治疗 ×3');
});

test('costByLv 每级精确（ceil 逐级算，非 L1×倍率）：失血换抽 L2 = 4 血（v3.14 hp 3VP）', () => {
  assert.strictEqual(CG.affixCostText('hp_draw', 1), '失 2 血');   // ⌈2·2.5/3⌉=2
  assert.strictEqual(CG.affixCostText('hp_draw', 2), '失 4 血');   // ⌈4·2.5/3⌉=4
  assert.strictEqual(CG.affixCostText('hp_draw', 3), '失 2 血');   // L3 廉价档
});

test('clampAffixLevel：把等级夹到该词条实际存在的等级', () => {
  assert.strictEqual(CG.clampAffixLevel('energy_food_veg', 3), 1);    // 食材只有 LV1
  assert.strictEqual(CG.clampAffixLevel('firstPlay_damage', 2), 1);   // 门型无 LV2 → 就近向下到 1
  assert.strictEqual(CG.clampAffixLevel('energy_damage', 3), 3);      // 普通词条 LV3 保留
});

test('rollGem 等级只取该词条实际存在的等级', () => {
  assert.strictEqual(CG.affixLevels('energy_food_veg').join(','), '1');   // 食材真资源词条 maxCount=1 → 恒 LV1
  for (let i = 0; i < 80; i++) {
    for (const pk of ['cook', 'elements', 'power', 'vuln']) {
      const g = CG.rollGem({ tier: 'boss', pack: pk });
      const a = g.affixes[0];
      assert.ok(CG.affixLevels(a.id).includes(a.level), `${pk} 产出非法等级 ${a.id}@${a.level}`);
    }
  }
});

test('主题隔离：未选主题的价值（含其条件型词条）抽不到', () => {
  const valTheme = {};   // 价值原子 → 其所属主题（PACKS[p].values）
  CG.PACK_IDS.forEach(p => p !== 'fusion' && (CG.PACKS[p].values || []).forEach(v => { if (!valTheme[v]) valTheme[v] = p; }));
  new CG.Run('warrior', { packs: ['basic', 'power'] });   // 仅伤害/连击系
  const sel = new Set(['basic', 'power']);
  for (let i = 0; i < 2000; i++) {
    const a = CG.AFFIXES[CG.rollGem({ tier: 'elite' }).affixes[0].id];
    const vt = valTheme[a.value.atom];
    assert.ok(!vt || sel.has(vt), `抽到未选主题 ${vt} 的价值 ${a.value.atom}（词条 ${a.value.sub}）`);
  }
  CG.setActivePacks(null);   // 复原全局态，避免影响后续用例
});

// ===== v3.1：去掉「条件代价只配 伤害/格挡/治疗」的限制 =====
test('条件配对：量型 × 全部48时点变体+治疗；门型(true/false) × 每一个价值', () => {
  // 量型(curBlock/enemyDebuff…)：48 时点变体（含每回合/下回合、电力、食材）+ 治疗 都成词条
  assert.ok(CG.AFFIXES['curBlock_damage_every'] && CG.AFFIXES['curBlock_damage_next'] && CG.AFFIXES['curBlock_power'] && CG.AFFIXES['curBlock_food_veg'] && CG.AFFIXES['curBlock_heal'] && CG.AFFIXES['enemyDebuff_strength']);
  // 量型不配「无时点·非数值」价值（召唤/元素/翻倍）
  assert.ok(CG.AFFIXES['curBlock_summon'] && CG.AFFIXES['curBlock_conjure'] && CG.AFFIXES['curBlock_thorns']);   // 召唤/造牌/荆棘 现为时点基值 → 量型也配
  assert.ok(!CG.AFFIXES['curBlock_fire'] && !CG.AFFIXES['curBlock_mult'] && !CG.AFFIXES['curBlock_multi']);       // 元素/翻倍/多重 仍无时点非数值、量型不配
  // 门型(firstPlay/hurt/noBlock)：每一个价值都成词条（含召唤/元素/翻倍/连击/每回合…）
  assert.ok(CG.AFFIXES['firstPlay_summon'] && CG.AFFIXES['firstPlay_fire'] && CG.AFFIXES['firstPlay_mult'] && CG.AFFIXES['firstPlay_combo'] && CG.AFFIXES['firstPlay_damage_every'] && CG.AFFIXES['hurt_summon'] && CG.AFFIXES['noBlock_conjure']);
});

test('条件 × 每回合变体：当前格挡→每回合伤害（打出快照格挡，之后每回合结算）', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.player.block = 10;
  const c = spell([{ id: 'curBlock_damage_every', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g._everyTurn.length, 1);
  const hp = g.enemy.hp; g._startPlayerTurn();
  assert.strictEqual(hp - g.enemy.hp, 3);   // floor(10 × 0.6/2.0 × 1) = 3，每回合
});

test('门型 × 非数值价值：第一次打出→召唤 / 附元素', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: 'firstPlay_summon', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.ok(g.skeleton && g.skeleton.maxHp >= 1);   // 达成 → 召唤骷髅单位
  const g2 = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g2.player.energy = 9;
  const c2 = spell([{ id: 'firstPlay_fire', level: 1 }]); g2.hand = [c2]; g2.playCard(c2.uid);
  assert.strictEqual(g2._auraOf(g2.enemy), 'fire');   // 达成 → 给敌人附火
});

test('条件 VP 公式·状态实战：当前格挡 → 易伤 = floor(格挡 × 0.6/1.5)', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9; g.player.block = 5;
  const c = spell([{ id: 'curBlock_vulnerable', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.enemy.statuses.vulnerable || 0, 2);   // floor(5 × 0.6/1.5) = floor(2) = 2
});

test('门条件 × 力量：第一次打出达成 → +力量定额', () => {
  assert.strictEqual(lv('firstPlay_strength'), '1,3');
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: 'firstPlay_strength', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.player.statuses.strength || 0, 2);   // floor(6/3) = 2 永久力量
});

// ===== 新词条：自中毒代价 / 荆棘 / 删建筑 =====
test('自中毒 selfPoison 已删除', () => {
  assert.ok(!CG.AFFIXES['selfPoison_damage'] && !CG.COST_REAL['selfPoison'] && CG.VALUES['selfPoison'] == null);
});

test('荆棘重构(#16-17；v3.14 默认本回合)：荆棘(默认/临时,1VP) / 每回合荆棘(永久,2VP)', () => {
  assert.strictEqual(CG.affixValueText('energy_tempThorns', 1), '获得 6 点荆棘');       // v3.14 默认=本回合(临时)、裸名、1VP→val6
  assert.strictEqual(CG.affixValueText('energy_thorns', 1), '每回合获得 3 点荆棘');     // 每回合(永久)＝非默认、带前缀、2VP→val3
  assert.ok(!CG.AFFIXES['energy_thorns_every']);                               // every 档 id 即裸 'thorns'，无 thorns_every
  // 永久荆棘：受击反伤、跨回合保留
  let g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  g.hand = [spell([{ id: 'energy_thorns', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.player.statuses.thorns, 3);
  const ehp = g.enemy.hp; g.dealAttackDamage(g.enemy, g.player, 4); assert.strictEqual(ehp - g.enemy.hp, 3);   // 反伤 3
  g.endTurn(); assert.strictEqual(g.player.statuses.thorns, 3);                // 永久：回合末仍在
  // 本回合荆棘：临时、回合末移除
  g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  g.hand = [spell([{ id: 'energy_tempThorns', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.player.statuses.thorns, 6);
  g.endTurn(); assert.ok(!g.player.statuses.thorns);                           // 临时：回合末移除
});

test('造牌重做：生成带随机 n 宝石的本场牌、本回合 0 费；有本/下/每回合三档', () => {
  assert.strictEqual(lv('energy_conjure'), '1,2,3');
  assert.strictEqual(CG.affixValueText('energy_conjure', 1), '生成 1 张带 1 颗随机宝石的牌（本回合 0 费）');
  assert.ok(CG.AFFIXES['energy_conjure_next'] && CG.AFFIXES['energy_conjure_every']);
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: 'energy_conjure', level: 2 }]); g.hand = [c]; g.playCard(c.uid);   // L2 → 2 颗宝石
  const made = g.hand[g.hand.length - 1];
  assert.strictEqual(made.sockets.length, 2);          // 随机 2 颗宝石
  assert.strictEqual(made.conjuredTurn, g.turn);       // 本回合 0 费标记（playCard 据此免费）
});

test('多重：消耗全部能量、整张牌打出「能量」次（耗费显示 X）', () => {
  assert.strictEqual(lv('energy_multi'), '1');         // maxCount 1：单一档
  assert.strictEqual(CG.affixValueText('energy_multi', 1), '消耗全部能量，整张牌打出等同能量的次数');
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 3; const hp = g.enemy.hp;
  const c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_multi', level: 1 }]);   // 首石6伤 + 多重
  g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(hp - g.enemy.hp, 18);             // 6 × 3 能量 = 18
  assert.strictEqual(g.player.energy, 0);              // 全部能量被消耗
});

test('删建筑：building 价值原子与建造包均移除', () => {
  assert.ok(!CG.AFFIXES['energy_building'] && !CG.VALUE_ATOMS['building']);
  assert.ok(!CG.PACKS['build'] && !CG.PACK_IDS.includes('build'));
});

test('召唤重做：单骷髅单位（创建 / +血量上限）；时点基值 1.5VP', () => {
  assert.strictEqual(CG.affixValueText('energy_summon', 1), '召唤骷髅或使其血量上限增加 4');   // val1=floor(6/1.5)=4
  assert.strictEqual(lv('energy_summon'), '1,2,3');
  assert.ok(CG.AFFIXES['energy_summon_next'] && CG.AFFIXES['energy_summon_every']);
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  g.hand = [spell([{ id: 'energy_summon', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.skeleton.maxHp, 4); assert.strictEqual(g.skeleton.hp, 4);   // 创建 4 血上限
  g.player.energy = 9;
  g.hand = [spell([{ id: 'energy_summon', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.skeleton.maxHp, 8); assert.strictEqual(g.skeleton.hp, 8);   // 已存在 → +4 血量上限
});

test('召唤物修饰词：自身向价值改投骷髅、量×2（VP 减半）；无骷髅则跳过', () => {
  // 量翻倍：召唤物伤害=12(玩家6)、召唤物格挡=10(玩家5)、召唤物力量=4(玩家2)、召唤物治疗=8(玩家4)
  assert.strictEqual(CG.affixValueText('energy_damage_m', 1), '召唤物对敌人造成 12 点伤害');
  assert.strictEqual(CG.affixValueText('energy_block_m', 1), '召唤物获得 10 点格挡');
  assert.strictEqual(CG.affixValueText('energy_strength_m', 1), '召唤物每回合获得 4 点力量');   // v3.14 召唤物力量＝永久(every)档 _m，带每回合前缀
  assert.strictEqual(CG.affixValueText('energy_heal_m', 1), '召唤物回复 4 点生命');   // v3.14 heal 3VP → heal_m 1.5VP → val 4
  // 只配自身向价值：能量/造牌/多重/敌减益 没有 _m 变体
  assert.ok(!CG.AFFIXES['energy_energy_m'] && !CG.AFFIXES['energy_conjure_m'] && !CG.AFFIXES['energy_vulnerable_m'] && !CG.AFFIXES['energy_poison_m']);
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 30; g.skeleton = { hp: 6, maxHp: 6, block: 0, statuses: {} };
  // 召唤物格挡 → 骷髅 +10 block（非玩家）
  g.hand = [spell([{ id: 'energy_block_m', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.skeleton.block, 10); assert.strictEqual(g.player.block, 0);
  // 召唤物伤害 → 骷髅攻击敌人 12
  const hp = g.enemy.hp;
  g.hand = [spell([{ id: 'energy_damage_m', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(hp - g.enemy.hp, 12);
  // 召唤物力量 → 骷髅永久 +4 力量（立即）
  g.hand = [spell([{ id: 'energy_strength_m', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.skeleton.statuses.strength, 4);
  // 无骷髅 → 召唤物效果跳过、不报错、不落到玩家
  g.skeleton = null; g.player.block = 0;
  g.hand = [spell([{ id: 'energy_block_m', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.player.block, 0);
});

test('召唤物替玩家抵挡：召唤物格挡→玩家格挡→召唤物血→玩家血', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.skeleton = { hp: 5, maxHp: 5, block: 3, statuses: {} }; g.player.block = 2;
  const php = g.player.hp;
  g.dealAttackDamage(g.enemy, g.player, 12);   // 12 = 骷髅格挡 3 + 玩家格挡 2 + 骷髅血 5 + 玩家血 2
  assert.strictEqual(g.skeleton, null);        // 骷髅血耗尽 → 被击碎（可重召）
  assert.strictEqual(g.player.block, 0);
  assert.strictEqual(php - g.player.hp, 2);    // 玩家只掉 2 血
});

// ===== 代价时点（#2）=====
test('代价时点：每回合(递归·量减半) / 下回合(延迟·量加倍) / 本回合；能量·弃牌不时点化', () => {
  assert.strictEqual(CG.affixCostText('hp_damage', 1), '失 2 血');          // v3.14 hp 3VP
  assert.strictEqual(CG.affixCostText('hpV_damage', 1), '每回合失 1 血');   // 递归：代价VP×2=6 → ⌈6/6⌉=1
  assert.strictEqual(CG.affixCostText('hpN_damage', 1), '下回合失 4 血');   // 延迟：代价VP×0.5=1.5 → ⌈6/1.5⌉=4
  assert.ok(!CG.AFFIXES['energyV_damage'] && !CG.AFFIXES['discardV_damage'] && !CG.AFFIXES['loseStrV_damage']);   // 能量/弃牌/失力量 不时点化
  assert.ok(CG.AFFIXES['selfWeakV_block'] && CG.AFFIXES['goldN_heal'] && CG.AFFIXES['selfVulnV_damage']);          // 生命/金币/自减益 可时点化
});

test('代价时点·每回合：价值当回合即得、代价调度到 _everyTurn 反复付', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'hpV_damage', level: 1 }]);   // 首石strike(免) + 每回合失血→伤害
  const hp0 = g.player.hp, ehp = g.enemy.hp;
  g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(ehp - g.enemy.hp, 12);          // 价值即得：strike 6 + 该词条伤害 6
  assert.strictEqual(hp0 - g.player.hp, 0);          // 代价当回合不付
  assert.strictEqual(g._everyTurn.length, 1);        // 调度到 _everyTurn
  g._startPlayerTurn(); assert.strictEqual(hp0 - g.player.hp, 1);   // 下回合开始：每回合失 1 血
  g._startPlayerTurn(); assert.strictEqual(hp0 - g.player.hp, 2);   // 再下回合：再失 1 血（递归）
});

test('代价时点·下回合：延迟一次付（自易伤代价 → 下回合上自身易伤）', () => {
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'selfVulnN_damage', level: 1 }]);   // 首石 + 下回合自易伤→伤害
  g.hand = [c]; g.playCard(c.uid);
  assert.ok(!g.player.statuses.vulnerable);          // 当回合不付代价
  assert.strictEqual(g._nextTurn.length, 1);
  g._startPlayerTurn(); assert.ok(g.player.statuses.vulnerable > 0);   // 下回合开始：上自身易伤
  const p = g.player.statuses.vulnerable;
  g._startPlayerTurn(); assert.ok((g.player.statuses.vulnerable || 0) <= p);   // 仅一次（_nextTurn 结算后清空，不再叠加）
});

// ===== v3.6 新批 28 项 =====
const bt = (n) => CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]), enemies: n });
const pg = (g, gems) => { g.player.energy = 30; const c = CG.makeCard('spell', Math.max(1, gems.length), gems.map(x => CG.makeGem(x))); g.hand = [c]; g.playCard(c.uid); return c; };

test('#2 复制到弃牌 / #4 弃牌回手 / #5 弃牌洗回库', () => {
  let g = bt(); pg(g, [[{ id: 'energy_copyDiscard', level: 1 }]]);
  assert.strictEqual(g.discardPile.length, 2);   // 本牌 + 1 复制
  g = bt(); g.discardPile = [spell([{ id: CG.STRIKE, level: 1 }]), spell([{ id: CG.STRIKE, level: 1 }])];
  pg(g, [[{ id: 'energy_recallDiscard', level: 1 }]]); assert.ok(g.hand.length >= 1);   // 回手 1 张
  g = bt(); g.discardPile = [spell([{ id: CG.STRIKE, level: 1 }]), spell([{ id: CG.STRIKE, level: 1 }]), spell([{ id: CG.STRIKE, level: 1 }])];
  const dp = g.drawPile.length; pg(g, [[{ id: 'energy_recycleDraw', level: 1 }]]); assert.strictEqual(g.drawPile.length - dp, 2);   // 洗回 2 张
});

test('#3 敌减益翻倍 ×(1+n) / #13 强化易伤 +25%n / #14 强化虚弱 +15%(不叠加)', () => {
  assert.strictEqual(lv('energy_debuffMult'), '1,2,3');   // maxCount 2 → ×2/×3
  let g = bt(); g.enemy.statuses.vulnerable = 2; g.enemy.statuses.weak = 3;
  pg(g, [[{ id: 'energy_debuffMult', level: 1 }]]); assert.strictEqual(g.enemy.statuses.vulnerable, 4); assert.strictEqual(g.enemy.statuses.weak, 6);
  g = bt(); g.enemy.statuses.vulnerable = 1; pg(g, [[{ id: 'energy_vulnAmp', level: 1 }]]);
  let eh = g.enemy.hp; g.dealAttackDamage(g.player, g.enemy, 8); assert.strictEqual(eh - g.enemy.hp, 14);   // 8×(1.5+0.25)=14
  g = bt(); g.enemy.statuses.weak = 1; pg(g, [[{ id: 'energy_weakAmp', level: 1 }]]);
  let ph = g.player.hp; g.dealAttackDamage(g.enemy, g.player, 10); assert.strictEqual(ph - g.player.hp, 6);   // 10×(0.75-0.15)=6
});

test('#6 镶随机宝石 / #7 命中全体 / #19 打出牌库顶', () => {
  let g = bt(); const sock = CG.makeCard('spell', 2, [CG.makeGem([{ id: CG.STRIKE, level: 1 }])]);
  g.player.energy = 30; const sr = spell([{ id: 'energy_socketRand', level: 1 }]); g.hand = [sr, sock]; g.playCard(sr.uid);
  assert.strictEqual(sock.sockets.length, 2);   // 空位被镶上随机宝石
  g = bt(2); const hp0 = g.enemies.map(e => e.hp);
  pg(g, [[{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_hitAll', level: 1 }]]); assert.ok(g.enemies.every((e, i) => e.hp < hp0[i]));   // 全体受伤
  g = bt(); g.drawPile.push(spell([{ id: CG.STRIKE, level: 1 }])); const eh = g.enemy.hp;
  pg(g, [[{ id: 'energy_playTopDraw', level: 1 }]]); assert.ok(eh - g.enemy.hp > 0);   // 打出牌库顶 strike
});

test('#10 本场伤害成长 / #11 本场格挡成长 / #11a 本场能耗降低', () => {
  let g = bt(); let c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_growDmg', level: 1 }]); g.player.energy = 30; g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(c.growth, 6); assert.ok(CG.cardStats(c).value >= 12);   // 打出后本场伤害 +6
  g = bt(); c = spell([{ id: CG.GUARD, level: 1 }], [{ id: 'energy_growBlk', level: 1 }]); g.player.energy = 30; g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(c.blockGrowth, 6);
  g = bt(); c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_selfCostDown', level: 1 }]); g.player.energy = 30; g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(c.costDown, 1);
});

test('#12 后续免费 / #20 后续打两次 / #21 格挡跨回合保留', () => {
  let g = bt(); g.player.energy = 30; const fc = spell([{ id: 'energy_freeNext', level: 1 }]); g.hand = [fc]; g.playCard(fc.uid);
  assert.ok(g.freeCards >= 1);   // 下一张免费
  g = bt(); g.player.energy = 30; const pt = spell([{ id: 'energy_playTwice', level: 1 }]); g.hand = [pt]; g.playCard(pt.uid);
  const eh = g.enemy.hp; const atk = spell([{ id: CG.STRIKE, level: 1 }]); g.hand = [atk]; g.player.energy = 30; g.playCard(atk.uid);
  assert.strictEqual(eh - g.enemy.hp, 12);   // strike 6 打两次
  g = bt(); pg(g, [[{ id: 'energy_keepBlockFull', level: 1 }]]); g.player.block = 12; g._startPlayerTurn(); assert.strictEqual(g.player.block, 12);   // 跨回合保留
});

test('#22-26 兵械：匕首/甲片 生成与强化', () => {
  let g = bt(); pg(g, [[{ id: 'energy_makeDagger', level: 1 }]]);
  const dg = g.hand.find(c => c.base === 'dagger'); assert.ok(dg); assert.strictEqual(CG.cardStats(dg).value, 4);
  g.player.energy = 30; const up = spell([{ id: 'energy_daggerUp', level: 1 }]); g.hand.push(up); g.playCard(up.uid);
  assert.strictEqual(CG.cardStats(g.hand.find(c => c.base === 'dagger')).value, 8);   // +4 强化
  g = bt(); pg(g, [[{ id: 'energy_makeScrap', level: 1 }]]);
  const sc = g.hand.find(c => c.base === 'scrap'); assert.ok(sc); assert.strictEqual(CG.cardStats(sc).value, 3);
});

test('#27 免疫下n次伤害 / #28 本回合伤害降为1', () => {
  let g = bt(); pg(g, [[{ id: 'energy_immune', level: 1 }]]); const ph = g.player.hp;
  g.dealAttackDamage(g.enemy, g.player, 10); assert.strictEqual(ph - g.player.hp, 0); assert.strictEqual(g._immuneHits, 0);
  g = bt(); pg(g, [[{ id: 'energy_dmgCap1', level: 1 }]]); const ph2 = g.player.hp;
  g.dealAttackDamage(g.enemy, g.player, 10); assert.strictEqual(ph2 - g.player.hp, 1);
});

test('#1/#8/#9/#18 新条件', () => {
  assert.ok(CG.AFFIXES['enemyVuln_damage'] && CG.AFFIXES['enemyWeak_damage'] && CG.AFFIXES['enemyFrail_damage'] && CG.AFFIXES['enemyPoison_damage']);   // #1 按减益类型拆成多门
  assert.ok(CG.AFFIXES['lostHpTurn_damage'] && CG.AFFIXES['exhaustedTurn_damage'] && CG.AFFIXES['hpLossCount_damage'] && !CG.AFFIXES['enemyDebuffed_damage']);
  // #1 敌人易伤时（gate）
  let g = bt(); g.enemy.statuses.vulnerable = 1; let eh = g.enemy.hp; pg(g, [[{ id: 'enemyVuln_damage', level: 1 }]]); assert.ok(eh - g.enemy.hp > 0);
  g = bt(); eh = g.enemy.hp; pg(g, [[{ id: 'enemyVuln_damage', level: 1 }]]); assert.strictEqual(eh - g.enemy.hp, 0);   // 无易伤 → 0
  // #8 本回合失去过生命（gate）+ #18 计数
  g = bt(); g.dealAttackDamage(g.enemy, g.player, 5); assert.ok(g._lostHpThisTurn); assert.strictEqual(g._hpLossCount, 1);
  eh = g.enemy.hp; pg(g, [[{ id: 'lostHpTurn_damage', level: 1 }]]); assert.ok(eh - g.enemy.hp > 0);
  // #9 本回合消耗过牌（gate）：打出一张消耗牌后达成
  g = bt(); g.player.energy = 30; const d = CG.makeFoodCard('dagger'); g.hand = [d]; g.playCard(d.uid); assert.ok(g._exhaustedThisTurn);
});

test('#15 消耗手牌代价（pick 型，类弃牌代价）', () => {
  assert.ok(CG.AFFIXES['exhaustCard_damage']);
  const g = bt(); g.player.energy = 30;
  const ec = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'exhaustCard_damage', level: 1 }]);
  const filler = spell([{ id: CG.STRIKE, level: 1 }]);
  g.hand = [ec, filler]; g.playCard(ec.uid);
  assert.ok(g.pick && g.pick.type === 'exhaustCost');   // 进入消耗代价选牌
  g.pickResolve(filler.uid);
  assert.ok(g.exhaustPile.some(c => c.uid === filler.uid)); assert.ok(!g.pick);   // filler 被消耗、结算继续
});

// ===== v3.7（29-37 + 修订）=====
test('#14 强化虚弱 maxCount=1（只有 LV1）/ #1 敌减益门拆成多门', () => {
  assert.strictEqual(lv('energy_weakAmp'), '1');
  assert.ok(CG.AFFIXES['enemyVuln_damage'] && CG.AFFIXES['enemyWeak_damage'] && CG.AFFIXES['enemyFrail_damage'] && CG.AFFIXES['enemyPoison_damage'] && !CG.AFFIXES['enemyDebuffed_damage']);
});

test('#29 消耗电力代价（原「当前电力」条件改为代价）', () => {
  assert.ok(CG.AFFIXES['losePower_damage'] && !CG.AFFIXES['curPower_damage']);
  assert.strictEqual(CG.affixCostText('losePower_damage', 1), '消耗 6 电力');
  const g = bt(); g.player.power = 5;
  pg(g, [[{ id: CG.STRIKE, level: 1 }], [{ id: 'losePower_damage', level: 1 }]]);
  assert.strictEqual(g.player.power, 0);   // 消耗电力（有多少扣多少）
});

test('#31 生成渣滓代价 / #30 渣滓牌(1费消耗)', () => {
  assert.ok(CG.AFFIXES['makeDross_damage']);
  assert.ok(CG.BASE_CARDS.dross && CG.BASE_CARDS.dross.cost === 1);
  const g = bt(); pg(g, [[{ id: CG.STRIKE, level: 1 }], [{ id: 'makeDross_damage', level: 1 }]]);
  assert.strictEqual(g.hand.filter(c => c.base === 'dross').length, 1);
});

test('#32/#33/#36 终末之剑：锻造创造/+伤害、招架+格挡，2费保留', () => {
  let g = bt(); pg(g, [[{ id: 'energy_forge', level: 1 }]]);
  let es = g.hand.find(c => c.base === 'endsword'); assert.ok(es);
  let s = CG.cardStats(es); assert.strictEqual(s.value, 16); assert.strictEqual(s.cost, 2); assert.strictEqual(s.retain, true);   // v3.13 锻造 +6：10+6
  g.player.energy = 30; const f2 = spell([{ id: 'energy_forge', level: 1 }]); g.hand.push(f2); g.playCard(f2.uid);
  assert.strictEqual(CG.cardStats(g.hand.find(c => c.base === 'endsword')).value, 22);   // 再 +6
  assert.strictEqual(g.hand.filter(c => c.base === 'endsword').length, 1);   // 仍只 1 把（已存在则不再创造）
  g.player.energy = 30; const pa = spell([{ id: 'energy_parry', level: 1 }]); g.hand.push(pa); g.playCard(pa.uid);
  assert.ok(CG.cardStats(g.hand.find(c => c.base === 'endsword')).effects.some(e => e.type === 'block' && e.value === 6));   // 招架 +6 格挡
});

test('#32a 保留：回合结束不丢弃', () => {
  const g = bt(); const rc = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_retain', level: 1 }]);
  assert.strictEqual(CG.cardStats(rc).retain, true);
  g.hand = [rc]; g.endTurn(); assert.ok(g.hand.some(c => c.uid === rc.uid));
});

test('#34 本回合打出牌数（量型）/ #35 活力（下一张伤害牌+n，非伤害牌不消耗）', () => {
  assert.strictEqual(CG.affixValueText('playedThisTurn_damage', 1), '本回合每打出 1 张牌，对敌人造成 2 点伤害');
  let g = bt(); g.player.energy = 30;
  g.hand = [spell([{ id: CG.STRIKE, level: 1 }])]; g.playCard(g.hand[0].uid);
  g.hand = [spell([{ id: CG.STRIKE, level: 1 }])]; g.player.energy = 30; g.playCard(g.hand[0].uid);
  const eh = g.enemy.hp; g.hand = [spell([{ id: 'playedThisTurn_damage', level: 1 }])]; g.player.energy = 30; g.playCard(g.hand[0].uid);
  assert.strictEqual(eh - g.enemy.hp, 4);   // 已打 2 张 → 2×2 = 4
  // 活力
  g = bt(); g.player.energy = 30; g.hand = [spell([{ id: 'energy_vigor', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g._vigor, 6);
  g.hand = [spell([{ id: CG.GUARD, level: 1 }])]; g.player.energy = 30; g.playCard(g.hand[0].uid); assert.strictEqual(g._vigor, 6);   // 防御牌不消耗
  const eh2 = g.enemy.hp; g.hand = [spell([{ id: CG.STRIKE, level: 1 }])]; g.player.energy = 30; g.playCard(g.hand[0].uid);
  assert.strictEqual(eh2 - g.enemy.hp, 12); assert.strictEqual(g._vigor, 0);   // strike6 + 活力6
});

test('#37 许愿：从抽牌堆选择一张加入手牌（pick）', () => {
  assert.ok(CG.AFFIXES['energy_wish']);
  const g = bt(); const top = spell([{ id: CG.STRIKE, level: 1 }]); g.drawPile.push(top);
  pg(g, [[{ id: 'energy_wish', level: 1 }]]);
  assert.ok(g.pick && g.pick.type === 'wish');
  g.pickResolve(top.uid);
  assert.ok(g.hand.some(c => c.uid === top.uid) && !g.drawPile.some(c => c.uid === top.uid));
});

// ===== v3.8（38-51）=====
const EB = 'energy_produce_block';   // 每回合格挡 buff 分子（produce_block 值=2）

test('#38/#39 洞悉牌(0费抽2消耗) + 生成洞悉到抽牌堆', () => {
  assert.ok(CG.BASE_CARDS.peek && CG.BASE_CARDS.peek.cost === 0);
  assert.deepStrictEqual(CG.cardStats(CG.makeFoodCard('peek')).effects.map(e => e.type + e.value).join(','), 'draw2');
  const g = bt(); pg(g, [[{ id: 'energy_makePeek', level: 1 }]]);
  assert.strictEqual(g.drawPile.filter(c => c.base === 'peek').length, 2);   // 3VP→val2
});

test('#40 虚无代价：回合末仍在手则消耗', () => {
  const eth = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'ethereal_damage', level: 1 }]);
  assert.strictEqual(CG.cardStats(eth).ethereal, true);
  const g = bt(); g.hand = [eth]; g.endTurn();
  assert.ok(!g.hand.some(c => c.uid === eth.uid) && g.exhaustPile.some(c => c.uid === eth.uid));
});

test('#41 咒言：层数 > 敌生命 → 敌回合末死亡', () => {
  assert.strictEqual(CG.affixValueText('energy_curse', 1), '使敌人获得 10 点咒言');   // 0.6VP→10
  const g = bt(); g.enemy.hp = 8; pg(g, [[{ id: 'energy_curse', level: 1 }]]);
  assert.strictEqual(g.enemy.statuses.curse, 10);
  g.endTurn(); g.runEnemyTurn(); assert.ok(!g.enemy.alive);   // 咒言10 > 8血 → 回合末死
});

test('#42 召唤物血量代价 / #44 追加咒言 / #51 伤害转格挡', () => {
  let g = bt(); g.skeleton = { hp: 6, maxHp: 6, block: 0, statuses: {} };
  pg(g, [[{ id: CG.STRIKE, level: 1 }], [{ id: 'minionHp_damage', level: 1 }]]);
  assert.strictEqual(g.skeleton.hp, 2);   // 消耗 4 召唤物血
  g = bt(); pg(g, [[{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_curseStrike', level: 1 }]]);
  assert.strictEqual(g.enemy.statuses.curse, 6);   // 追加＝伤害6 的咒言
  g = bt(); pg(g, [[{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_dmgToBlock', level: 1 }]]);
  assert.strictEqual(g.player.block, 6);   // 获得＝伤害6 的格挡
});

test('#43/#49 量型条件：打出匕首/甲片/洞悉次数、生成卡牌数', () => {
  assert.ok(CG.AFFIXES['daggerPlayed_damage'] && CG.AFFIXES['scrapPlayed_block'] && CG.AFFIXES['peekPlayed_draw'] && CG.AFFIXES['cardsMade_damage']);
  let g = bt(); g.player.energy = 30; const d = CG.makeFoodCard('dagger'); g.hand = [d]; g.playCard(d.uid);
  assert.strictEqual(g._basePlays.dagger, 1);
  g = bt(); pg(g, [[{ id: 'energy_makePeek', level: 1 }]]); assert.strictEqual(g._cardsMade, 2);   // 生成 2 张洞悉
});

const KINDS = ['energy_produce_block', 'energy_produce_draw', 'energy_produce_energy', 'energy_damage_every'];   // 4 种不同的每回合增益
const playEvery = (g, id) => { g.player.energy = 30; g.hand = [spell([{ id, level: 1 }])]; g.playCard(g.hand[0].uid); };
const everyKinds = g => g._everyTurn.length;   // 上限按「全部每回合效果（增益+代价）」的条数算

test('#45 每回合增益上限(默认3)：打第4种(不同种)时最旧立即结算两次并失去 / #46 扩容', () => {
  let g = bt(); g.player.block = 0;
  KINDS.slice(0, 3).forEach(id => playEvery(g, id));   // 3 种不同
  assert.strictEqual(everyKinds(g), 3);
  const before = g.player.block;
  playEvery(g, KINDS[3]);                               // 第 4 种 → 淘汰最旧(每回合格挡2)、结算两次
  assert.strictEqual(everyKinds(g), 3);                 // 仍 3 种
  assert.strictEqual(g.player.block - before, 4);       // 每回合格挡 2 ×2 = +4
  // 扩容 +1 → cap 4 → 4 种都在
  g = bt(); playEvery(g, 'energy_expandEvery');
  assert.strictEqual(g._everyCap, 4);
  KINDS.forEach(id => playEvery(g, id));
  assert.strictEqual(everyKinds(g), 4);
});

test('多个「每回合X」合并为一条（收益与代价都合并）', () => {
  // 收益：打 3 次每回合格挡 → 合并成 1 条（不占 3 个名额）
  let g = bt(); for (let i = 0; i < 3; i++) playEvery(g, EB);
  const merged = g._everyTurn.filter(e => e.type === 'block' && !e.minion);
  assert.strictEqual(merged.length, 1); assert.strictEqual(merged[0].value, 6);   // 2×3 合并
  assert.strictEqual(everyKinds(g), 1);   // 只算 1 种 → 不触发上限
  // 代价：打 2 次「每回合失血」→ 合并成 1 条
  g = bt(); g.player.energy = 30;
  for (let i = 0; i < 2; i++) { const c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'hpV_damage', level: 1 }]); g.hand = [c]; g.player.energy = 30; g.playCard(c.uid); }
  const losses = g._everyTurn.filter(e => e.type === 'loseHp');
  assert.strictEqual(losses.length, 1); assert.strictEqual(losses[0].value, 2);   // v3.14 每回合失 1 血 ×2 合并 = 2
});

test('每回合上限也约束「减益/代价类」（修复其一直累加）', () => {
  const g = bt(); g.enemy.hp = 999; g.enemy.maxHp = 999;
  // 5 种不同的「每回合代价」（失血/失金/自易伤/自虚弱/自脆弱），用 block 价值避免误杀敌人
  ['hpV_block', 'goldV_block', 'selfVulnV_block', 'selfWeakV_block', 'selfFrailV_block'].forEach(id => {
    g.player.energy = 30; const c = spell([{ id: CG.GUARD, level: 1 }], [{ id, level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  });
  assert.strictEqual(g._everyTurn.length, 3);   // 代价类也只保留最新 3 种（不再一直累加）
});

test('#47 收割(n次) / #50 爆破(4n次并失去)', () => {
  let g = bt(); g.player.energy = 30; g.hand = [spell([{ id: EB, level: 1 }])]; g.playCard(g.hand[0].uid);
  let b = g.player.block; g.player.energy = 30; g.hand = [spell([{ id: 'energy_harvestEvery', level: 2 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.player.block - b, 4);   // 收割 2 次 × 每回合格挡2
  g = bt(); g.player.energy = 30; g.hand = [spell([{ id: EB, level: 1 }])]; g.playCard(g.hand[0].uid);
  b = g.player.block; g.player.energy = 30; g.hand = [spell([{ id: 'energy_detonateEvery', level: 1 }])]; g.playCard(g.hand[0].uid);
  assert.strictEqual(g.player.block - b, 8);   // 爆破 4 次 × 2
  assert.strictEqual(g._everyTurn.filter(e => !g._isEveryCost(e)).length, 0);   // 增益失去
});

test('#48 回收：消耗手牌中所有非初始牌、抽等量', () => {
  const g = bt();
  const ini = spell([{ id: CG.STRIKE, level: 1 }]); ini._initial = true;
  const made = CG.makeFoodCard('dagger');   // 非初始（生成牌）
  g.drawPile.push(spell([{ id: CG.STRIKE, level: 1 }])); g.drawPile.forEach(c => c._initial = true);
  const rc = spell([{ id: 'energy_recycle', level: 1 }]); rc._initial = true;
  g.hand = [ini, made, rc]; g.player.energy = 30; g.playCard(rc.uid);
  assert.ok(g.exhaustPile.some(c => c.base === 'dagger'));   // 非初始牌被消耗
  assert.ok(g.hand.some(c => c.uid === ini.uid));            // 初始牌保留
  assert.ok(!g.hand.some(c => c.base === 'dagger'));          // 生成牌已离手
});

// ===== v3.9 描述可读化 =====
test('词条描述改为自然中文（对齐用户示例）+ 卡名用简短 chip 形', () => {
  assert.strictEqual(CG.affixValueText('energy_makeDagger', 1), '生成 2 张匕首');
  assert.strictEqual(CG.affixValueText('curBlock_enemyLoseStrTemp', 1), '每有 5 点当前格挡，使敌人失去 2 点力量');   // 默认(本回合)敌失力量＝裸名无前缀
  assert.strictEqual(CG.affixValueText('daggerPlayed_frail', 1), '本场每打出 3 张匕首，使敌人获得 2 点脆弱');
  assert.strictEqual(CG.affixValueText('myDebuff_damage_next', 1), '自身每有 1 层减益，下回合对敌人造成 2 点伤害');
  assert.strictEqual(CG.affixValueText('enemyVuln_block', 1), '敌人处于易伤时，获得 5 点格挡');
  assert.strictEqual(CG.affixShort('energy_damage', 1), '伤害 6');
  assert.strictEqual(CG.affixShort('energy_makeDagger', 1), '生成匕首 2');
  assert.strictEqual(CG.affixShort('curBlock_damage', 1), '伤害*');
  for (const id of CG.AFFIX_ORDER) {
    const s = CG.affixValueText(id, 1);
    assert.ok(s && !/\{[nx]\}|undefined|NaN/.test(s), `${id} → "${s}"`);
  }
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

// ===== v3.12：按主题重分包（47 主题）+ 新价值/条件 + 交叉积融合 =====
test('v3.12 新价值/条件原子存在且文本自然', () => {
  ['energy_corpseBomb', 'energy_catalyze', 'energy_burn', 'energy_regen', 'energy_arc', 'energy_charge',
    'energy_nirvana', 'energy_undying', 'energy_temper', 'energy_duplicate', 'energy_mindblast',
    'poisonApplied_poison', 'lowHp_damage'].forEach(id => assert.ok(CG.AFFIXES[id], id + ' 应存在'));
  assert.strictEqual(CG.affixValueText('energy_catalyze', 1), '立即结算敌人身上的中毒 1 次');
  assert.strictEqual(CG.affixValueText('energy_burn', 1), '使敌人获得 4 点灼烧');
  assert.strictEqual(CG.affixValueText('poisonApplied_poison', 1), '本场每施加 1 次中毒，使敌人获得 2 点中毒');
});

test('v3.12 尸爆：被中毒杀死的敌人对其它敌人造成其最大生命的伤害', () => {
  const g = CG.makeBattle({ enemyIds: ['green_slime', 'green_slime'] });
  g._corpseBomb = 1; g.enemies[0].hp = 3; g.enemies[0].maxHp = 40; g.applyStatus(g.enemies[0], 'poison', 5);
  g.enemies[1].hp = 100; g.enemies[1].maxHp = 100;    // 留足血量以测得完整尸爆伤害
  const e1 = g.enemies[1].hp;
  g.endTurn(); g.runEnemyTurn();                       // 敌方回合：毒伤致死 enemy0 → 尸爆 40 给 enemy1
  assert.ok(g.enemies[0].hp <= 0, 'enemy0 应被毒杀');
  assert.strictEqual(e1 - g.enemies[1].hp, 40, 'enemy1 应吃到尸爆 = enemy0 最大生命 40');
});

test('v3.12 催发：立即结算中毒 N 次（毒伤 + 毒 -1）', () => {
  const g = bt(); g.enemy.hp = 200; g.enemy.maxHp = 200; g.applyStatus(g.enemy, 'poison', 10);
  const hp0 = g.enemy.hp; pg(g, [[{ id: 'energy_catalyze', level: 1 }]]);
  assert.strictEqual(hp0 - g.enemy.hp, 10, '结算 1 次 = 造成等同毒层(10)的伤害');
  assert.strictEqual(g.enemy.statuses.poison, 9, '结算后毒 -1');
});

test('v3.12 施加中毒次数：计数 + 条件缩放', () => {
  const g = bt(); g.enemy.hp = 300; g.enemy.maxHp = 300;
  pg(g, [[{ id: 'energy_poison', level: 1 }]]); pg(g, [[{ id: 'energy_poison', level: 1 }]]);
  assert.strictEqual(g._poisonApplied, 2, '施加 2 次中毒');
});

test('v3.12 灼烧 / 再生 价值', () => {
  let g = bt(); g.enemy.hp = 200; pg(g, [[{ id: 'energy_burn', level: 1 }]]);
  assert.strictEqual(g.enemy.statuses.burn, 4, '灼烧 4');
  g = bt(); g.player.hp = 40; pg(g, [[{ id: 'energy_regen', level: 1 }]]);
  assert.strictEqual(g.player.statuses.regen, 2, '再生 2');
});

test('v3.12 复活机制：电弧随电力增伤 / 涅槃被消耗时再发动', () => {
  let g = bt(); g.player.power = 5; g.enemy.hp = 200; g.enemy.maxHp = 200;
  const eh = g.enemy.hp; pg(g, [[{ id: CG.STRIKE, level: 1 }], [{ id: 'energy_arc', level: 1 }]]);
  assert.strictEqual(eh - g.enemy.hp, 11, '打击6 + 电弧(电力5×1) = 11');
  // 涅槃：虚无代价使其回合末从手牌消耗 → 再发动打击
  g = bt(); g.enemy.hp = 200; g.enemy.maxHp = 200;
  const card = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'ethereal_nirvana', level: 1 }]); g.hand = [card];
  const eh2 = g.enemy.hp; g.endTurn();
  assert.strictEqual(eh2 - g.enemy.hp, 6, '涅槃：被消耗时再发动一次打击');
  assert.ok(g.exhaustPile.some(c => c.uid === card.uid), '虚无牌已进消耗堆');
});

test('v3.12 交叉积融合：选定主题的「任意代价 × 任意价值」都能产出', () => {
  CG.setActivePacks(['blood', 'power']);            // 血液(失血/自减益代价) + 强攻(伤害价值)
  const f = CG.fusionPack();
  assert.ok(f.buffs.includes('hp_damage'), '失血换伤害（跨主题）应在融合池');
  assert.ok(f.buffs.includes('selfVuln_damage'), '自易伤换伤害应在融合池');
  assert.ok(f.buffs.includes('energy_damage'), '通用能量代价仍在');
  CG.setActivePacks(null);
});

test('v3.12 词条归主题：按 代价→条件→价值 优先级', () => {
  assert.strictEqual(CG.affixGroupOf('hp_damage'), 'blood');          // 失血代价 → 血液
  assert.strictEqual(CG.affixGroupOf('exhaustCard_nirvana'), 'ash');  // 消耗手牌代价 → 灰烬
  assert.strictEqual(CG.affixGroupOf('enemyPoison_poison'), 'poison');// 敌中毒条件 → 猛毒
  assert.strictEqual(CG.affixGroupOf('energy_corpseBomb'), 'poison'); // 价值尸爆 → 猛毒
  assert.strictEqual(CG.affixGroupOf('energy_combo'), 'combo');       // 价值连击 → 连击
  assert.ok(CG.PACK_IDS.length >= 40, '已拆成 ~47 个细分主题');
});

test('v3.12 每个价值/代价/条件原子都有归属主题（无孤儿）', () => {
  Object.keys(CG.VALUE_ATOMS).forEach(v => { const va = CG.VALUE_ATOMS[v]; if (CG.timingSiblings.has(v)) return; assert.ok(CG.valueHome[v], '价值原子 ' + v + ' 无归属'); });   // v3.14：所有「下/每回合」变体(含召唤物)不归包，由修饰词包提供（timingSiblings）
  Object.keys(CG.COST_REAL).forEach(c => assert.ok(c === 'energy' || CG.costHome[c], '代价原子 ' + c + ' 无归属'));
  Object.keys(CG.COST_COND).forEach(c => assert.ok(CG.condHome[c], '条件原子 ' + c + ' 无归属'));
});

// ===== v3.13：磷火/幻境/强化 + 时点化 =====
test('v3.13 磷火卡 + 生成磷火/洞悉强化/磷火强化/幻境', () => {
  // 磷火卡：0 费、+1 能量、保留、消耗
  let g = bt(); g.player.energy = 2; const w = CG.makeFoodCard('wisp'); g.hand = [w]; g.playCard(w.uid);
  assert.strictEqual(g.player.energy, 3); assert.ok(g.exhaustPile.some(c => c.uid === w.uid));
  const ws = CG.foodStats(CG.makeFoodCard('wisp')); assert.strictEqual(ws.retain, true); assert.strictEqual(ws.exhaust, true);
  // 生成磷火
  g = bt(); pg(g, [[{ id: 'energy_makeWisp', level: 1 }]]); assert.strictEqual(g.hand.filter(c => c.base === 'wisp').length, 1);
  // 洞悉强化 +1（洞悉抽 2→3）
  g = bt(); pg(g, [[{ id: 'energy_peekUp', level: 1 }]]); const pk = CG.makeFoodCard('peek'); pk._bonus = g._peekBonus; assert.strictEqual(CG.cardStats(pk).effects[0].value, 3);
  // 磷火强化 +0.5（2 级 → 磷火 +1 能量）
  g = bt(); pg(g, [[{ id: 'energy_wispUp', level: 1 }]]); pg(g, [[{ id: 'energy_wispUp', level: 1 }]]); const wp = CG.makeFoodCard('wisp'); wp._bonus = Math.floor(g._wispBonus); assert.strictEqual(CG.cardStats(wp).effects[0].value, 2);
  // 幻境：本回合生成的临时卡牌效果 +50%（向上取整）→ 匕首 4→6
  g = bt(); pg(g, [[{ id: 'energy_illusion', level: 1 }]]); CG.Effects.apply(g, { type: 'makeDagger', value: 1 }, g.player);
  assert.strictEqual(CG.cardStats(g.hand.find(c => c.base === 'dagger')).value, 6);
});

test('v3.13 锻造/招架 +6（1 能量校准）', () => {
  assert.strictEqual(CG.affixValueText('energy_forge', 1), '终末之剑伤害 +6（不论它在何处；没有则创造一张加入手牌）');
  assert.strictEqual(CG.affixValueText('energy_parry', 1), '终末之剑格挡 +6（不论它在何处）');
});

test('v3.13 指定原子已时点化（本/下/每回合变体存在且可结算）', () => {
  ['forge', 'parry', 'vigor', 'wish', 'curse', 'expandEvery', 'recallDiscard', 'recycleDraw', 'playTopDraw', 'socketRand', 'keepBlockFull', 'makeDagger', 'makeScrap', 'makePeek', 'makeWisp', 'illusion'].forEach(b => {
    assert.ok(CG.AFFIXES['energy_' + b + '_every'] && CG.AFFIXES['energy_' + b + '_next'], b + ' 应有 每回合/下回合 变体');
  });
  // 每回合生成匕首：打出后入 _everyTurn，回合开始重复结算
  const g = bt(); pg(g, [[{ id: 'energy_makeDagger_every', level: 1 }]]);
  assert.ok((g._everyTurn || []).some(e => e.type === 'makeDagger'));
});

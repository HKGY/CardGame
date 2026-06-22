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

test('条件代价：当前格挡→伤害（cardStats 出 condBonus，值由 playCard 按当前量结算）', () => {
  const s = stat(spell([{ id: 'curBlock_damage', level: 1 }]));
  assert.ok(s.condBonus.some(c => c.qty === 'curBlock' && c.atom === 'damage'));
  assert.strictEqual(s.kind, 'skill');   // 价值不在 cardStats 预置；实际伤害打出时按当前格挡动态结算（见战斗用例）
});

test('展示文字：代价 / 价值', () => {
  assert.strictEqual(CG.affixCostText(D, 1), '+1 费');
  assert.strictEqual(CG.affixValueText(D, 1), '打击 6');   // 本回合伤害＝「打击」
  assert.strictEqual(CG.affixValueText(D, 2), '打击 12');
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
  assert.strictEqual(g.enemy.hp, hp0 - 3);   // 整数分数：0.6≈3/5 → 每有 5 点格挡获得 3 → floor(7/5)×3 = 3
});

test('条件 VP → 整数「每有 X 点 A，获得 Y 点 B」（显示与判定都整数）', () => {
  // curBlock(0.6) × 伤害(1.0)：0.6 = 3/5 → 每有 5 点当前格挡，获得 3 点打击
  assert.strictEqual(CG.affixValueText('curBlock_damage', 1), '每有 5 点当前格挡，获得 3 点打击');
  assert.strictEqual(CG.affixValueText('curBlock_damage', 2), '每有 5 点当前格挡，获得 6 点打击');   // 等级缩放 Y
  // turnNum(1.0) × 瘟疫(每回合中毒, VP 3.0)：1/3 → 每有 3 回合，获得 1 点瘟疫（不再 ×0.33）
  assert.strictEqual(CG.affixValueText('turnNum_poison_every', 1), '每有 3 点回合数，获得 1 点瘟疫');
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
  assert.ok(second.effects.some(e => e.type === 'selfStatus' && e.status === 'vulnerable' && e.value === 3));
});

test('自残→每回合能量引擎（公平定价 selfVuln_produce_energy，取代旧 berserk 签名）', () => {
  // 递归价值 = 一次性 ×2：每回合+1能量=12VP → 自易伤代价 ceil(12/2)=6 层（破坏衡、非净正签名）
  assert.strictEqual(CG.affixCostText('selfVuln_produce_energy', 1), '自易伤 6');
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: CG.STRIKE, level: 1 }], [{ id: 'selfVuln_produce_energy', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g.player.statuses.vulnerable, 6);   // 自易伤代价（首石免，第二颗付）
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

test('敌失力量/敏捷：永久减（每回合 镇力/镇捷）；本回合临时版（慑力/钝化）量翻倍且下回合复原', () => {
  assert.strictEqual(CG.affixValueText('energy_enemyLoseStr', 1), '镇力 2');       // 每回合(永久)敌失力量
  assert.strictEqual(CG.affixValueText('energy_enemyLoseStrTemp', 1), '慑力 4');   // 本回合(临时)＝永久 ×2
  assert.strictEqual(CG.affixValueText('energy_enemyLoseDex', 1), '镇捷 2');       // 力量/敏捷对称
  assert.strictEqual(CG.affixValueText('energy_enemyLoseDexTemp', 1), '钝化 4');
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
  assert.strictEqual(lv('energy_produce_block'), '1,2,3');// 壁垒=每回合格挡
  assert.strictEqual(lv('energy_produce_energy'), '1,2,3');// 引擎=每回合能量
  assert.strictEqual(CG.AFFIXES['energy_produce_block'].value.amt, 2);   // 壁垒 LV1 = +2/回合
});

test('元素 maxCount=2：LV1 附 1 层 / LV2 附 2 层（与旧 elementBase×lvVal 一致）', () => {
  assert.strictEqual(lv('energy_fire'), '1,2,3');
  assert.strictEqual(CG.affixValueText('energy_fire', 1), '附火 1');
  assert.strictEqual(CG.affixValueText('energy_fire', 2), '附火 2');
  assert.strictEqual(CG.affixValueText('energy_fire', 3), '附火 2');   // L3＝廉价档（同 L2 价值）
  const s = stat(spell([{ id: 'energy_fire', level: 2 }]));
  assert.strictEqual(s.elementLevel, 2);   // 附 2 层
});

test('门型条件 → 只有 LV1+LV3（无 LV2）；量型条件 → LV1/2/3', () => {
  assert.strictEqual(lv('firstPlay_damage'), '1,3');
  assert.strictEqual(lv('noBlock_block'), '1,3');
  assert.strictEqual(lv('curBlock_damage'), '1,2,3');
  assert.strictEqual(CG.affixValueText('firstPlay_damage', 1), '打击 6（这张牌本场第一次打出时）');
  assert.strictEqual(CG.affixValueText('firstPlay_damage', 3), '打击 12（这张牌本场第一次打出时）');
});

test('时点修饰器：每回合(箭塔)回合开始造伤、下回合(备盾)下个回合一次性给格挡', () => {
  // 箭塔＝每回合伤害：打出后调度进 _everyTurn，每个回合开始结算
  const g = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g.player.energy = 9;
  const c = spell([{ id: 'energy_damage_every', level: 1 }]); g.hand = [c]; g.playCard(c.uid);
  assert.strictEqual(g._everyTurn.length, 1);
  const hp0 = g.enemy.hp; g._startPlayerTurn();
  assert.strictEqual(g.enemy.hp, hp0 - 3);   // 箭塔 val1=floor(6/2)=3 → 每回合 -3
  const hp1 = g.enemy.hp; g._startPlayerTurn();
  assert.strictEqual(g.enemy.hp, hp1 - 3);   // 常驻：再下回合再 -3
  // 备盾＝下回合格挡：打出本回合不给，下个回合开始 +10、且仅一次
  const g2 = CG.makeBattle({ deck: CG.makeDeck([['spell', [[{ id: CG.STRIKE, level: 1 }]]]]) });
  g2.player.energy = 9;
  const c2 = spell([{ id: 'energy_block_next', level: 1 }]); g2.hand = [c2]; g2.playCard(c2.uid);
  assert.strictEqual(g2.player.block, 0);          // 本回合不给
  assert.strictEqual(g2._nextTurn.length, 1);
  g2._startPlayerTurn();
  assert.strictEqual(g2.player.block, 10);         // 下回合 +10（备盾 val1=floor(6/0.6)=10）
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
  assert.strictEqual(CG.affixValueText('energy_mult', 1), '数值 ×2');
  assert.strictEqual(CG.affixValueText('energy_mult', 2), '数值 ×3');
});

test('costByLv 每级精确（ceil 逐级算，非 L1×倍率）：失血换抽 L2 = 5 血', () => {
  assert.strictEqual(CG.affixCostText('hp_draw', 1), '失 3 血');
  assert.strictEqual(CG.affixCostText('hp_draw', 2), '失 5 血');   // ⌈4·2.5/2⌉=5（旧的 3×2=6 偏贵）
  assert.strictEqual(CG.affixCostText('hp_draw', 3), '失 3 血');   // L3 廉价档
});

test('clampAffixLevel：把等级夹到该词条实际存在的等级', () => {
  assert.strictEqual(CG.clampAffixLevel('energy_food_veg', 3), 1);    // 食材只有 LV1
  assert.strictEqual(CG.clampAffixLevel('firstPlay_damage', 2), 1);   // 门型无 LV2 → 就近向下到 1
  assert.strictEqual(CG.clampAffixLevel('energy_damage', 3), 3);      // 普通词条 LV3 保留
});

test('rollGem 等级夹到该词条存在的等级（被 maxCount 卡死的包恒 LV1）', () => {
  for (let i = 0; i < 60; i++) {
    const food = CG.rollGem({ tier: 'boss', pack: 'cook' });        // 食材 maxCount=1：即便 boss tier 抬等级也只能 LV1
    assert.strictEqual(food.affixes[0].level, 1, '食材应恒 LV1');
    const any = CG.rollGem({ tier: 'boss', pack: 'elements' });     // 元素 [1,2,3]：等级合法即可
    assert.ok(CG.affixLevels(any.affixes[0].id).includes(any.affixes[0].level));
  }
});

// ===== v3.1：去掉「条件代价只配 伤害/格挡/治疗」的限制 =====
test('条件配对：量型 × 全部48时点变体+治疗；门型(true/false) × 每一个价值', () => {
  // 量型(curBlock/enemyDebuff…)：48 时点变体（含每回合/下回合、电力、食材）+ 治疗 都成词条
  assert.ok(CG.AFFIXES['curBlock_damage_every'] && CG.AFFIXES['curBlock_damage_next'] && CG.AFFIXES['curBlock_power'] && CG.AFFIXES['curBlock_food_veg'] && CG.AFFIXES['curBlock_heal'] && CG.AFFIXES['enemyDebuff_strength']);
  // 量型不配「无时点·非数值」价值（召唤/元素/翻倍）
  assert.ok(!CG.AFFIXES['curBlock_summon'] && !CG.AFFIXES['curBlock_fire'] && !CG.AFFIXES['curBlock_mult']);
  // 门型(firstPlay/hurt/noBlock)：每一个价值都成词条（含召唤/元素/翻倍/连击/每回合…）
  assert.ok(CG.AFFIXES['firstPlay_summon'] && CG.AFFIXES['firstPlay_fire'] && CG.AFFIXES['firstPlay_mult'] && CG.AFFIXES['firstPlay_combo'] && CG.AFFIXES['firstPlay_damage_every'] && CG.AFFIXES['hurt_building'] && CG.AFFIXES['noBlock_conjure']);
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
  assert.strictEqual((g.allies || []).length, 1);   // 达成 → 召唤一个召唤物
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

'use strict';
/* 战斗引擎（game.js）+ 效果处理器（effects.js）：出牌结算、状态、宝石词条在战斗中的作用。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

// affix = 单个词条 {id,level}；装成「一张打击，镶一颗含该词条的宝石」
const deckOf = (n, affix) => CG.makeDeck(Array.from({ length: n }, () => ['strike', affix ? [[affix]] : []]));

test('战斗初始化：玩家回合、抽 5、能量 3、敌人就位', () => {
  const b = CG.makeBattle();
  assert.equal(b.phase, 'player');
  assert.equal(b.hand.length, 5);
  assert.equal(b.player.energy, 3);
  assert.equal(b.enemies[0].hp, 28);   // 绿史莱姆 28，actScale=1
});

test('敌人强度 M：缩放敌人血量 / 伤害(dmgScale) / 力量；M=1 同原版', () => {
  const half = CG.makeBattle({ enemyM: 0.5 });
  assert.equal(half.enemies[0].hp, 14);                                                      // 28 × actScale.hp(1) × M(0.5)
  assert.equal(half.enemies[0].dmgScale, 0.5);                                               // sc.dmg(1) × M(0.5)
  assert.equal(half._scaleEff({ type: 'damage', value: 10 }, half.enemies[0]).value, 5);     // 伤害按 dmgScale
  assert.equal(half._scaleEff({ type: 'strength', value: 4 }, half.enemies[0]).value, 2);    // 力量按 M
  const full = CG.makeBattle({ enemyM: 1 });
  assert.equal(full.enemies[0].hp, 28);                                                      // M=1 与原版一致
  assert.equal(full._scaleEff({ type: 'strength', value: 4 }, full.enemies[0]).value, 4);    // M=1 不缩放力量
});

test('出牌：打击造成 6 伤害并消耗 1 能量、进弃牌堆', () => {
  const b = CG.makeBattle({ deck: deckOf(10) });
  const card = b.hand[0];
  const hp0 = b.enemies[0].hp;
  b.playCard(card.uid);
  assert.equal(b.enemies[0].hp, hp0 - 6);
  assert.equal(b.player.energy, 2);
  assert.equal(b.hand.length, 4);
  assert.equal(b.discardPile.length, 1);
});

test('出牌：防御获得 5 格挡', () => {
  const b = CG.makeBattle({ deck: CG.makeDeck(Array.from({ length: 10 }, () => ['defend'])) });
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.block, 5);
});

test('宝石词条在战斗中生效：淬毒 / 多重 / 过载', () => {
  let b = CG.makeBattle({ deck: deckOf(10, { id: 'poison', level: 1 }) });
  b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].statuses.poison, 1);

  b = CG.makeBattle({ deck: deckOf(10, { id: 'multi', level: 1 }) });
  let hp0 = b.enemies[0].hp;
  b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp0 - 12);   // 6 ×2

  b = CG.makeBattle({ deck: deckOf(10, { id: 'overload', level: 1 }) });
  hp0 = b.enemies[0].hp;
  b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp0 - 9);    // 6 ×(1+65%) = 9
});

test('易伤 / 虚弱 的伤害修正', () => {
  let b = CG.makeBattle();
  let e = b.enemies[0], hp0 = e.hp;
  b.applyStatus(e, 'vulnerable', 1);
  b.dealAttackDamage(b.player, e, 10);
  assert.equal(e.hp, hp0 - 15);              // ×1.5

  b = CG.makeBattle();
  e = b.enemies[0]; hp0 = e.hp;
  b.applyStatus(b.player, 'weak', 1);
  b.dealAttackDamage(b.player, e, 10);
  assert.equal(e.hp, hp0 - 7);               // floor(10×0.75)
});

test('敏捷增格挡 / 脆弱减格挡', () => {
  let b = CG.makeBattle();
  b.applyStatus(b.player, 'dexterity', 2);
  b.gainBlock(b.player, 5);
  assert.equal(b.player.block, 7);

  b = CG.makeBattle();
  b.applyStatus(b.player, 'frail', 1);
  b.gainBlock(b.player, 8);
  assert.equal(b.player.block, 6);           // floor(8×0.75)
});

test('穿刺：额外命中右侧相邻敌人', () => {
  const b = CG.makeBattle({ enemyIds: ['green_slime', 'green_slime'], deck: deckOf(10, { id: 'pierce', level: 1 }) });
  const [e0, e1] = b.enemies, h0 = e0.hp, h1 = e1.hp;
  b.setTarget(0);
  b.playCard(b.hand[0].uid);
  assert.equal(e0.hp, h0 - 6);
  assert.equal(e1.hp, h1 - 6);               // 穿刺命中相邻
});

test('风怒：本回合打出后回到手牌', () => {
  const b = CG.makeBattle({ deck: deckOf(10, { id: 'windfury', level: 1 }) });
  const card = b.hand[0];
  b.playCard(card.uid);
  assert.ok(b.hand.some(c => c.uid === card.uid));   // 回到手牌
  assert.equal(b.discardPile.length, 0);
});

test('销毁：打出后进消耗堆而非弃牌堆', () => {
  const b = CG.makeBattle({ deck: deckOf(10, { id: 'destroy', level: 1 }) });
  b.playCard(b.hand[0].uid);
  assert.equal(b.exhaustPile.length, 1);
  assert.equal(b.discardPile.length, 0);
});

test('能量不足无法出牌', () => {
  const b = CG.makeBattle({ deck: deckOf(10, { id: 'cumbersome', level: 3 }) });  // 耗能 1+3=4 > 3
  const hand0 = b.hand.length, energy0 = b.player.energy;
  b.playCard(b.hand[0].uid);
  assert.equal(b.hand.length, hand0);        // 未打出
  assert.equal(b.player.energy, energy0);
});

test('结束回合：计时状态 -1', () => {
  const b = CG.makeBattle();
  b.applyStatus(b.player, 'weak', 2);
  b.endTurn();
  assert.equal(b.player.statuses.weak, 1);
  assert.equal(b.phase, 'enemy');
});

test('整场战斗可推进到胜利（不抛错、玩家存活）', () => {
  const b = CG.makeBattle({ deck: deckOf(10), hp: 80, maxHp: 80 });
  let guard = 0;
  while (b.phase === 'player' && guard++ < 30) {
    let played = true;
    while (played && b.phase === 'player') {
      played = false;
      for (const c of [...b.hand]) {
        if (CG.cardStats(c).cost <= b.player.energy) { b.playCard(c.uid); played = true; break; }
      }
    }
    if (b.phase !== 'player') break;
    b.endTurn();
    b.runEnemyTurn();
  }
  assert.equal(b.phase, 'won');
  assert.ok(b.player.hp > 0);
});

test('调试：debugWin 直接杀光敌人并判胜', () => {
  const b = CG.makeBattle({ enemyIds: ['green_slime', 'jaw_worm'] });
  assert.equal(b.phase, 'player');
  b.debugWin();
  assert.equal(b.phase, 'won');
  assert.ok(b.enemies.every(e => e.hp <= 0 && !e.alive));
});

test('达摩克利斯遗物：卡牌数值翻倍', () => {
  const b = CG.makeBattle({ deck: deckOf(10), relics: ['damocles'], run: { flags: {}, relics: ['damocles'] } });
  const hp0 = b.enemies[0].hp;
  b.playCard(b.hand[0].uid);
  assert.equal(b.enemies[0].hp, hp0 - 12);   // 6 ×2
});

test('回响：打出后下一张牌免费（不扣能量），且可连锁', () => {
  const b = CG.makeBattle({ deck: deckOf(8, { id: 'echo', level: 1 }), hp: 80, maxHp: 80 });
  assert.equal(b.player.energy, 3);
  b.playCard(b.hand[0].uid);               // 第一张正常付费
  assert.equal(b.player.energy, 2);
  assert.equal(b.freeCards, 1);            // 获得 1 层回响
  b.playCard(b.hand[0].uid);               // 免费打出
  assert.equal(b.player.energy, 2);        // 能量未减
  b.playCard(b.hand[0].uid);               // 连锁仍免费
  assert.equal(b.player.energy, 2);

  const c = CG.makeBattle({ deck: deckOf(8), hp: 80, maxHp: 80 });   // 对照：无回响逐张扣能量
  c.playCard(c.hand[0].uid); c.playCard(c.hand[0].uid);
  assert.equal(c.player.energy, 1);
});

test('回响计数在回合开始清零', () => {
  const b = CG.makeBattle({ deck: deckOf(8, { id: 'echo', level: 1 }) });
  b.playCard(b.hand[0].uid);
  assert.equal(b.freeCards, 1);
  b.endTurn(); b.runEnemyTurn();
  assert.equal(b.freeCards, 0);
});

test('连击：本回合每多打出一张牌，后续打击伤害递增', () => {
  const b = CG.makeBattle({ deck: deckOf(8, { id: 'combo', level: 2 }) });
  const e = b.enemies[0], hp0 = e.hp;      // 28
  b.playCard(b.hand[0].uid);               // 第1张：此前 0 张 → 6
  assert.equal(e.hp, hp0 - 6);
  b.playCard(b.hand[0].uid);               // 第2张：此前 1 张 → 6 + 2
  assert.equal(e.hp, hp0 - 6 - 8);
  b.playCard(b.hand[0].uid);               // 第3张：此前 2 张 → 6 + 4
  assert.equal(e.hp, hp0 - 6 - 8 - 10);
});

test('壁垒：攻击牌打出后也获得格挡', () => {
  const b = CG.makeBattle({ deck: deckOf(8, { id: 'bulwark', level: 1 }) });
  assert.equal(b.player.block, 0);
  b.playCard(b.hand[0].uid);
  assert.equal(b.player.block, 1);         // 壁垒 1×1，攻击牌也生效
});

// 元素反应：用受控手牌（直接赋 b.hand）打出指定元素牌
const elemStrike = el => CG.makeCard('strike', 1, [CG.makeGem([{ id: el, level: 1 }])]);
function elemBattle() { const b = CG.makeBattle({ hp: 90, maxHp: 90 }); b.player.energy = 9; return b; }   // 绿史莱姆 28

test('元素·附着：命中给主目标挂元素，至多 1 种（再附会替换/反应）', () => {
  const b = elemBattle(), e = b.enemies[0];
  const f = elemStrike('flame'); b.hand = [f];
  b.playCard(f.uid);
  assert.equal(e.statuses.fire, 1);
  assert.equal(CG.ELEMENT_IDS.filter(id => e.statuses[id]).length, 1);   // 只有 1 种元素
});

test('元素·蒸发：水→火，火击伤害 ×2，并清空双方元素', () => {
  const b = elemBattle(), e = b.enemies[0], hp0 = e.hp;
  const w = elemStrike('aqua'), f = elemStrike('flame'); b.hand = [w, f];
  b.playCard(w.uid);
  assert.equal(e.hp, hp0 - 7);             // 水击 6 + 无反应附着穿透 1 = 7，附水
  assert.equal(e.statuses.water, 1);
  b.playCard(f.uid);                       // 火 onto 水 → 蒸发，火击 floor(6×2)=12
  assert.equal(e.hp, hp0 - 7 - 12);
  assert.ok(!e.statuses.water && !e.statuses.fire, '反应后清空双方');
});

test('元素·感电：雷→水 给敌人 5 层中毒（转化型）', () => {
  const b = elemBattle(), e = b.enemies[0];
  const v = elemStrike('volt'), w = elemStrike('aqua'); b.hand = [v, w];
  b.playCard(v.uid); b.playCard(w.uid);
  assert.equal(e.statuses.poison, 5);
  assert.ok(!e.statuses.thunder && !e.statuses.water);
});

test('元素·超载：火→雷 造成 20 点穿透伤害（无视格挡）', () => {
  const b = elemBattle(), e = b.enemies[0]; e.block = 100; const hp0 = e.hp;
  const f = elemStrike('flame'), v = elemStrike('volt'); b.hand = [f, v];
  b.playCard(f.uid);                       // 火击 6 被挡，但无反应附着穿透 1 无视格挡
  assert.equal(e.hp, hp0 - 1);
  b.playCard(v.uid);                       // 超载：雷击 6 仍被挡，但爆发 20 无视格挡
  assert.equal(e.hp, hp0 - 1 - 20);
  assert.ok(!e.statuses.fire && !e.statuses.thunder);
});

test('元素·放大型需本牌有伤害：无伤害的防御牌附水→不触发蒸发，仅替换火', () => {
  const b = elemBattle(), e = b.enemies[0];
  const f = elemStrike('flame');
  const wd = CG.makeCard('defend', 1, [CG.makeGem([{ id: 'aqua', level: 1 }])]);   // 防御牌附水（无伤害）
  b.hand = [f, wd];
  b.playCard(f.uid);                       // 火附着
  b.playCard(wd.uid);                      // 防御附水 onto 火：放大型不触发 → 替换为水
  assert.equal(e.statuses.water, 1);
  assert.ok(!e.statuses.fire);
});

// 元素层数（≤3）：消耗 min(prev,new) 级、效果发生这么多次、余量留存
const elemStrikeLv = (el, lv) => CG.makeCard('strike', 1, [CG.makeGem([{ id: el, level: lv }])]);

test('元素·多级附着：同元素叠加，封顶 3 层', () => {
  const b = elemBattle(), e = b.enemies[0];
  b.hand = [elemStrikeLv('flame', 1), elemStrikeLv('flame', 1), elemStrikeLv('flame', 2)];
  b.playCard(b.hand[0].uid); b.playCard(b.hand[0].uid);
  assert.equal(e.statuses.fire, 2);        // 1 + 1
  b.playCard(b.hand[0].uid);
  assert.equal(e.statuses.fire, 3);        // 2 + 2 → 封顶 3
});

test('元素·多级蒸发：水2→火3 消耗 2 级，伤害 ×2^2，余火 1 层', () => {
  const b = elemBattle(), e = b.enemies[0]; e.maxHp = 300; e.hp = 300; const hp0 = e.hp;
  const w = elemStrikeLv('aqua', 2), f = elemStrikeLv('flame', 3); b.hand = [w, f];
  b.playCard(w.uid);
  assert.equal(e.hp, hp0 - 8);             // 水击 6 + 无反应附着穿透 2 = 8
  assert.equal(e.statuses.water, 2);
  b.playCard(f.uid);                       // consumed=min(2,3)=2 → ×2^2=×4 → floor(6×4)=24
  assert.equal(e.hp, hp0 - 8 - 24);
  assert.equal(e.statuses.fire, 1);        // 余 3-2=1 层火
  assert.ok(!e.statuses.water);
});

test('元素·多级感电：雷3→水2 消耗 2 级，感电生效 2 次（中毒 10），余雷 1 层', () => {
  const b = elemBattle(), e = b.enemies[0];
  const v = elemStrikeLv('volt', 3), w = elemStrikeLv('aqua', 2); b.hand = [v, w];
  b.playCard(v.uid); b.playCard(w.uid);
  assert.equal(e.statuses.poison, 10);     // 5 × 2 次
  assert.equal(e.statuses.thunder, 1);     // 余 3-2=1 层雷
  assert.ok(!e.statuses.water);
});

test('元素·等量抵消：水2→火2 全消耗、双方清空，伤害 ×2^2', () => {
  const b = elemBattle(), e = b.enemies[0]; e.maxHp = 300; e.hp = 300; const hp0 = e.hp;
  const w = elemStrikeLv('aqua', 2), f = elemStrikeLv('flame', 2); b.hand = [w, f];
  b.playCard(w.uid); b.playCard(f.uid);    // 水击 6 + 附着穿透 2 = 8；火蒸发 consumed=2 → ×4 → 24
  assert.equal(e.hp, hp0 - 8 - 24);        // floor(6×4)=24
  assert.ok(!e.statuses.fire && !e.statuses.water);
});

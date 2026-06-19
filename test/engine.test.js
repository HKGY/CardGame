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
  assert.equal(b.enemies[0].hp, hp0 - 12);   // 6 ×(1+100%)
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

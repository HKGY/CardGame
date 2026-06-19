'use strict';
/* 跑图状态机（run.js）：初始状态、地图（无篝火 / Boss 前商店）、宝石背包、商店经济、事件、整局推进。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const newRun = (seed = 'unit-test') => { CG.RNG.seed(seed); return new CG.Run('warrior'); };
const allNodes = run => [].concat(...run.map);

test('新跑图初始状态', () => {
  const run = newRun();
  assert.equal(run.deck.length, 10);
  assert.equal(run.gems.length, 0);
  assert.equal(run.gold, CG.CONFIG.startGold);
  assert.equal(run.hp, run.maxHp);
  assert.equal(run.maxHp, CG.CONFIG.startHp);
  assert.equal(run.act, 1);
  assert.equal(run.phase, 'map');
});

test('地图：无篝火节点、Boss 前一行全为商店、末行为 Boss', () => {
  for (let i = 0; i < 8; i++) {
    const run = newRun('map-' + i);
    assert.equal(allNodes(run).some(n => n.type === 'rest'), false);   // 篝火已移除
    const bossRow = run.map[run.map.length - 1];
    assert.equal(bossRow.length, 1);
    assert.equal(bossRow[0].type, 'boss');
    const preBoss = run.map[run.map.length - 2];
    assert.ok(preBoss.every(n => n.type === 'shop'));                  // Boss 前必有商店
    assert.ok(run.map[0].every(n => n.type === 'monster'));            // 起始行为普通战斗
  }
});

test('安装免费：installGemInv 把背包宝石装进空孔', () => {
  const run = newRun();
  const gem = CG.makeGem([{ id: 'multi', level: 1 }]);
  run.gems.push(gem);
  const target = run.deck.find(c => CG.cardEmptySockets(c) > 0);
  const before = target.sockets.length;
  run.installGemInv(gem.uid, target.uid);
  assert.equal(run.gems.length, 0);
  assert.equal(target.sockets.length, before + 1);
});

test('加孔：buyAddSocket 花钱给卡 +1 孔', () => {
  const run = newRun();
  run.gold = 999;
  const card = run.deck[0];
  const lim0 = card.limit, gold0 = run.gold;
  run.buyAddSocket(card.uid);
  assert.equal(card.limit, lim0 + 1);
  assert.equal(run.gold, gold0 - run.socketPrice());
});

test('卸下宝石：花钱 + 宝石随机加 debuff，回到背包', () => {
  const run = newRun();
  run.gold = 999;
  const card = run.deck.find(c => c.sockets.length);     // 预镶嵌的卡
  const gem = card.sockets[0], affs0 = gem.affixes.length;
  const gold0 = run.gold;
  run.buyUninstall(card.uid, 0);
  assert.equal(card.sockets.length, 0);
  assert.equal(run.gems.length, 1);
  assert.equal(run.gems[0].affixes.length, affs0 + 1);   // 多了一个 debuff
  assert.equal(CG.gemHasDebuff(run.gems[0]), true);
  assert.ok(run.gold < gold0);
  assert.equal(run.uninstallCount, 1);
});

test('删卡：移除一张卡，宝石回收进背包（不加 debuff）', () => {
  const run = newRun();
  run.gold = 999;
  const card = run.deck.find(c => c.sockets.length);     // 带宝石（压制，无 debuff）
  const len0 = run.deck.length;
  run.buyRemove(card.uid);
  assert.equal(run.deck.length, len0 - 1);
  assert.equal(run.gems.length, 1);
  assert.equal(CG.gemHasDebuff(run.gems[0]), false);     // 回收不附带 debuff
});

test('商店：买宝石 / 买法杖', () => {
  const run = newRun();
  run.gold = 1000;
  run.pending = {
    gems: [{ gem: CG.makeGem([{ id: 'multi', level: 1 }]), price: 30, bought: false }],
    cards: [{ base: 'strike', limit: 2, gems: [], price: 40, bought: false }],
    tarot: [],
  };
  run.buyGem(0);
  assert.equal(run.gems.length, 1);
  assert.equal(run.gold, 970);

  const deck0 = run.deck.length;
  run.buyCard(0);
  assert.equal(run.deck.length, deck0 + 1);
  assert.equal(run.gold, 930);
  assert.equal(run.deck[run.deck.length - 1].limit, 2);
});

test('事件祭坛可用性判定', () => {
  const run = newRun();
  assert.equal(run.altarUsable('findgem'), true);                 // 恒可用
  assert.equal(run.altarUsable('bore'), true);                    // 有卡可加孔
  assert.equal(run.altarUsable('recut'), true);                   // 有预镶宝石
  assert.equal(run.altarUsable('setting'), false);                // 背包没宝石
  assert.equal(run.altarUsable('purify'), false);                 // 没有带 debuff 的宝石

  run.gems.push(CG.makeGem([{ id: 'multi', level: 1 }]));
  assert.equal(run.altarUsable('setting'), true);
  run.gems.push(CG.makeGem([{ id: 'multi', level: 1 }, { id: 'cumbersome', level: 1 }]));
  assert.equal(run.altarUsable('purify'), true);
});

test('遗物修正：幸运脚（宝石词条≥2）、Steam（商店半价）', () => {
  const run = newRun();
  assert.equal(run.forgeMinLevel(), 1);
  assert.equal(run.shopMult(), 1);
  run.addRelic('luckyfoot');
  run.addRelic('steam');
  assert.equal(run.forgeMinLevel(), 2);
  assert.equal(run.shopMult(), 0.5);
});

test('整局推进：自动获胜并跳过一切 → 通关', () => {
  const run = newRun('full-run');
  let guard = 0;
  while (run.phase !== 'victory' && run.phase !== 'dead' && guard++ < 3000) {
    switch (run.phase) {
      case 'map':    run.selectNode(run.available[0]); break;
      case 'battle': run.finishBattle(true, run.hp); break;
      case 'reward': run.chooseReward(null); break;
      case 'shop':   run.leaveShop(); break;
      case 'event':  run.leaveEvent(); break;
      default: guard = 1e9;
    }
  }
  assert.equal(run.phase, 'victory');
  assert.equal(run.act, CG.CONFIG.acts);
});

test('整局推进：领取奖励 + 镶嵌宝石（覆盖宝石/法杖两类奖励）', () => {
  const run = newRun('full-run-collect');
  let guard = 0, gotGem = false, gotCard = false;
  while (run.phase !== 'victory' && run.phase !== 'dead' && guard++ < 3000) {
    switch (run.phase) {
      case 'map': run.selectNode(run.available[0]); break;
      case 'battle': run.finishBattle(true, run.hp); break;
      case 'reward': {
        const p = run.pending;
        if (p.kind === 'gem') { gotGem = true; run.chooseReward(p.gems[0]); }
        else { gotCard = true; run.chooseReward(p.cards[0]); }
        // 顺手把背包宝石装进任意空孔（验证安装路径）
        const g = run.gems[0], slot = run.cardsWithEmptySocket()[0];
        if (g && slot) run.installGemInv(g.uid, slot.uid);
        break;
      }
      case 'shop': run.leaveShop(); break;
      case 'event': run.leaveEvent(); break;
      default: guard = 1e9;
    }
  }
  assert.equal(run.phase, 'victory');
  assert.ok(gotGem && gotCard, '应当同时遇到过宝石奖励与法杖奖励');
  assert.ok(run.deck.length >= 10);
});

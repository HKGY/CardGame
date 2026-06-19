'use strict';
/* 跑图状态机（run.js）：初始状态、地图（无篝火 / Boss 前商店）、宝石背包、商店经济、事件、整局推进。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const newRun = (seed = 'unit-test') => { CG.RNG.seed(seed); return new CG.Run('warrior'); };
const rooms = run => run.grid.rooms;
const byType = (run, t) => rooms(run).filter(r => r.type === t);

// 在地图上走一步：优先进可选房（精英/商店/祭坛）→ 必经小怪/首领 → 通路 → 出口（最后）。
// 保证每步都踩到一个未通过的格子（严格推进），并尽量覆盖可选房。
function step(run) {
  const a = run.available;
  const pick = a.find(r => !r.done && (r.type === 'elite' || r.type === 'shop' || r.type === 'event'))
            || a.find(r => !r.done && (r.type === 'monster' || r.type === 'boss'))
            || a.find(r => !r.done && r.type !== 'exit')
            || a.find(r => r.type === 'exit')
            || a[0];
  run.selectNode(pick);
}

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

test('棋盘格小层：入口/出口各一、两只必经小怪、精英/商店/祭坛各一、无篝火', () => {
  for (let i = 0; i < 8; i++) {
    const run = newRun('floor-' + i);
    assert.equal(run.act, 1);
    assert.equal(run.floor, 1);
    assert.equal(run.grid.type, 'normal');
    assert.equal(byType(run, 'rest').length, 0);          // 篝火已移除
    assert.equal(byType(run, 'entrance').length, 1);
    assert.equal(byType(run, 'exit').length, 1);
    assert.equal(byType(run, 'monster').length, 2);       // 两只挡路小怪
    assert.equal(byType(run, 'elite').length, 1);         // 可选精英
    assert.equal(byType(run, 'shop').length, 1);          // 可选商店
    assert.equal(byType(run, 'event').length, 1);         // 可选祭坛
    assert.equal(run.current, run.grid.entrance);         // 从入口出发
    assert.equal(run.current.done, true);
    assert.ok(run.available.length > 0);
  }
});

test('两只小怪是必经割点：堵住任一只则入口到出口断开；可选房可绕过', () => {
  const run = newRun('cut-test');
  const g = run.grid;
  const reach = blocked => {                              // 从入口 BFS，blocked 内的格子不可踏入
    const seen = new Set([g.entrance]), q = [g.entrance];
    while (q.length) {
      const c = q.shift();
      for (const n of g.rooms) {
        if (n === c || blocked.has(n) || seen.has(n)) continue;
        if (Math.abs(n.gx - c.gx) + Math.abs(n.gy - c.gy) === 1) { seen.add(n); q.push(n); }
      }
    }
    return seen;
  };
  assert.ok(reach(new Set()).has(g.exit));               // 正常可达出口
  for (const m of byType(run, 'monster')) assert.equal(reach(new Set([m])).has(g.exit), false);  // 堵小怪 → 断开
  const optional = g.rooms.filter(r => ['elite', 'shop', 'event'].includes(r.type));
  assert.ok(reach(new Set(optional)).has(g.exit));       // 可选房全堵住仍可达 → 它们可绕过
});

test('每第三小层为首领一本道：直线走廊、尽头首领、无其它房间', () => {
  const run = newRun('boss-floor');
  run.floor = run.maxFloors;                             // 跳到第 3 小层
  run._newFloor();
  const g = run.grid;
  assert.equal(g.type, 'boss');
  assert.equal(byType(run, 'boss').length, 1);
  ['monster', 'elite', 'shop', 'event', 'exit'].forEach(t => assert.equal(byType(run, t).length, 0));
  assert.equal(new Set(g.rooms.map(r => r.gy)).size, 1);              // 全在同一行（一本道）
  assert.equal(byType(run, 'path').length, g.rooms.length - 2);       // 除入口/首领外都是通路
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

test('整局推进：自动获胜并跳过一切 → 通关（3 区 × 3 小层）', () => {
  const run = newRun('full-run');
  let guard = 0;
  while (run.phase !== 'victory' && run.phase !== 'dead' && guard++ < 5000) {
    switch (run.phase) {
      case 'map':    step(run); break;
      case 'battle': run.finishBattle(true, run.hp); break;
      case 'reward': run.chooseReward(null); break;
      case 'shop':   run.leaveShop(); break;
      case 'event':  run.leaveEvent(); break;
      default: guard = 1e9;
    }
  }
  assert.equal(run.phase, 'victory');
  assert.equal(run.act, CG.CONFIG.acts);
  assert.equal(run.floor, run.maxFloors);
});

test('整局推进：领取奖励 + 镶嵌 + 逛可选房（覆盖宝石/法杖/商店/祭坛/精英）', () => {
  const run = newRun('full-run-collect');
  let guard = 0, gotGem = false, gotCard = false, sawShop = false, sawEvent = false, sawElite = false;
  while (run.phase !== 'victory' && run.phase !== 'dead' && guard++ < 5000) {
    switch (run.phase) {
      case 'map': step(run); break;
      case 'battle': if (run.pending.tier === 'elite') sawElite = true; run.finishBattle(true, run.hp); break;
      case 'reward': {
        const p = run.pending;
        if (p.kind === 'gem') { gotGem = true; run.chooseReward(p.gems[0]); }
        else { gotCard = true; run.chooseReward(p.cards[0]); }
        // 顺手把背包宝石装进任意空孔（验证安装路径）
        const g = run.gems[0], slot = run.cardsWithEmptySocket()[0];
        if (g && slot) run.installGemInv(g.uid, slot.uid);
        break;
      }
      case 'shop': sawShop = true; run.leaveShop(); break;
      case 'event': sawEvent = true; run.leaveEvent(); break;
      default: guard = 1e9;
    }
  }
  assert.equal(run.phase, 'victory');
  assert.ok(gotGem && gotCard, '应当同时遇到过宝石奖励与法杖奖励');
  assert.ok(sawShop && sawEvent && sawElite, '应当逛过可选的商店 / 祭坛 / 精英');
  assert.ok(run.deck.length >= 10);
});

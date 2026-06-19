'use strict';
/* 跑图状态机（run.js）：初始状态、地图（无篝火 / Boss 前商店）、宝石背包、商店经济、事件、整局推进。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const newRun = (seed = 'unit-test') => { CG.RNG.seed(seed); return new CG.Run('warrior'); };
const rooms = run => run.grid.rooms;
const byType = (run, t) => rooms(run).filter(r => r.type === t);

// 从当前房间 BFS 找最近的「符合 goalFilter」房间，返回通往它的第一步房间。
function bfsStep(run, goalFilter) {
  const g = run.grid, cur = run.current;
  const adj = r => g.rooms.filter(o => Math.abs(o.gx - r.gx) + Math.abs(o.gy - r.gy) === 1);
  const prev = new Map([[cur, null]]), q = [cur];
  let goal = null;
  while (q.length) { const c = q.shift(); if (c !== cur && goalFilter(c)) { goal = c; break; } for (const n of adj(c)) if (!prev.has(n)) { prev.set(n, c); q.push(n); } }
  if (!goal) return null;
  let s = goal; while (prev.get(s) !== cur) s = prev.get(s);
  return s;
}
const isContent = r => r.type === 'shop' || r.type === 'treasure' || r.type === 'curse' || r.type === 'elite' || r.type === 'boss' || (r.type === 'normal' && r.combat);
// 测试驱动：先清掉所有非首领内容房，再走空房，最后进首领（迈一步、严格推进）。
function mapStep(run) {
  const next = bfsStep(run, r => !r.done && isContent(r) && r.type !== 'boss')
            || bfsStep(run, r => !r.done)
            || run.available[0];
  run.selectNode(next);
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

test('以撒式布局：起点/首领/宝藏/商店/诅咒/小boss 各一，房间全连通', () => {
  for (let i = 0; i < 10; i++) {
    const run = newRun('isaac-' + i);
    const g = run.grid;
    assert.equal(g.type, 'isaac');
    assert.ok(g.rooms.length >= CG.CONFIG.map.minRooms);
    ['start', 'boss', 'treasure', 'shop', 'curse', 'elite'].forEach(t =>
      assert.equal(byType(run, t).length, 1, t + ' 应恰好 1 间'));
    assert.equal(byType(run, 'rest').length, 0);                       // 无篝火
    assert.equal(run.current, g.entrance);
    assert.equal(run.current.type, 'start');
    assert.equal(run.current.done, true);
    // 全连通：从起点 BFS 能到每个房间（相邻即有门）
    const adj = r => g.rooms.filter(o => Math.abs(o.gx - r.gx) + Math.abs(o.gy - r.gy) === 1);
    const seen = new Set([g.entrance]), q = [g.entrance];
    while (q.length) { const c = q.shift(); for (const n of adj(c)) if (!seen.has(n)) { seen.add(n); q.push(n); } }
    assert.equal(seen.size, g.rooms.length, '所有房间应从起点可达');
    // 树结构：相邻=门，边数 = 房间数-1（无环）
    let edges = 0; g.rooms.forEach(r => { if (g.rooms.some(o => o.gx === r.gx + 1 && o.gy === r.gy)) edges++; if (g.rooms.some(o => o.gx === r.gx && o.gy === r.gy + 1)) edges++; });
    assert.equal(edges, g.rooms.length - 1, '应为树（无环）');
    // 首领不与起点相邻
    assert.ok(Math.abs(g.boss.gx - g.entrance.gx) + Math.abs(g.boss.gy - g.entrance.gy) >= 2, '首领不应与起点相邻');
  }
});

test('普通房按概率藏敌：跨多层既有藏敌也有空房', () => {
  let combat = 0, empty = 0;
  for (let i = 0; i < 12; i++) {
    const run = newRun('enemy-' + i);
    byType(run, 'normal').forEach(r => (r.combat ? combat++ : empty++));
  }
  assert.ok(combat > 0 && empty > 0, '普通房应既有藏敌也有空房');
});

test('诅咒房进入耗血、给 2 遗物；宝藏房免费给 1 遗物', () => {
  const run = newRun('loot');
  const curse = byType(run, 'curse')[0];
  run.available = [curse];
  const hp0 = run.hp;
  run.selectNode(curse);
  assert.equal(run.phase, 'event');
  assert.equal(run.pending.kind, 'curse');
  assert.ok(run.hp < hp0);                                            // 进入耗血
  assert.equal(run.pending.hpPaid, hp0 - run.hp);
  assert.ok(run.pending.relics.length === 2 || run.pending.gold > 0); // 2 遗物（集齐则折金）
  run.leaveEvent();
  assert.equal(curse.done, true);

  const run2 = newRun('loot2');
  const t = byType(run2, 'treasure')[0];
  run2.available = [t];
  const hp1 = run2.hp, relics0 = run2.relics.length;
  run2.selectNode(t);
  assert.equal(run2.pending.kind, 'treasure');
  assert.equal(run2.hp, hp1);                                         // 宝藏房不耗血
  assert.ok(run2.relics.length === relics0 + 1 || run2.pending.gold > 0);
});

test('皇帝塔罗：直达本层首领并开战', () => {
  const run = newRun('emperor');
  run.gotoActBoss();
  assert.equal(run.phase, 'battle');
  assert.equal(run.pending.tier, 'boss');
  assert.equal(run.current.type, 'boss');
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

test('战斗奖励＝主题 booster pack：pending.pack 合法且每颗宝石词条都来自该包', () => {
  const run = newRun('pack-reward');
  run.pending = { tier: 'boss' };                 // 首领档必给宝石奖励（经济档由 pending.tier 决定）
  run.finishBattle(true, run.hp);
  assert.equal(run.phase, 'reward');
  assert.equal(run.pending.kind, 'gem');
  const pack = CG.PACKS[run.pending.pack];
  assert.ok(pack, '应记录合法的包 id');
  const inPack = id => pack.buffs.includes(id) || pack.debuffs.includes(id);
  assert.equal(run.pending.gems.length, CG.CONFIG.reward.count);
  run.pending.gems.forEach(g => g.affixes.forEach(a => assert.ok(inPack(a.id), `宝石词条 ${a.id} 不属于 ${run.pending.pack}`)));
});

test('商店宝石带 pack 标记，且词条来自该包', () => {
  const run = newRun('shop-pack');
  run._enterShop();
  assert.ok(run.pending.gems.length >= 1);
  run.pending.gems.forEach(it => {
    const pack = CG.PACKS[it.pack];
    assert.ok(pack, '商店宝石应记录合法包');
    const inPack = id => pack.buffs.includes(id) || pack.debuffs.includes(id);
    it.gem.affixes.forEach(a => assert.ok(inPack(a.id), `商店宝石词条 ${a.id} 不属于 ${it.pack}`));
  });
});

test('整局推进：清完每层并击败首领 → 通关（3 层）', () => {
  const run = newRun('full-run');
  let guard = 0;
  while (run.phase !== 'victory' && run.phase !== 'dead' && guard++ < 6000) {
    switch (run.phase) {
      case 'map':    mapStep(run); break;
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

test('整局推进：领奖励 + 镶嵌 + 逛遍房型（覆盖宝石/法杖/商店/宝藏/诅咒/小boss）', () => {
  const run = newRun('full-run-collect');
  let guard = 0, gotGem = false, gotCard = false, sawShop = false, sawTreasure = false, sawCurse = false, sawElite = false;
  while (run.phase !== 'victory' && run.phase !== 'dead' && guard++ < 6000) {
    switch (run.phase) {
      case 'map': mapStep(run); break;
      case 'battle': if (run.pending.tier === 'elite') sawElite = true; run.finishBattle(true, run.hp); break;
      case 'reward': {
        const p = run.pending;
        if (p.kind === 'gem') { gotGem = true; run.chooseReward(p.gems[0]); }
        else { gotCard = true; run.chooseReward(p.cards[0]); }
        const g = run.gems[0], slot = run.cardsWithEmptySocket()[0];
        if (g && slot) run.installGemInv(g.uid, slot.uid);     // 验证安装路径
        break;
      }
      case 'shop': sawShop = true; run.leaveShop(); break;
      case 'event':
        if (run.pending.kind === 'treasure') sawTreasure = true;
        if (run.pending.kind === 'curse') sawCurse = true;
        run.leaveEvent();
        break;
      default: guard = 1e9;
    }
  }
  assert.equal(run.phase, 'victory');
  assert.ok(gotGem && gotCard, '应当同时遇到过宝石奖励与法杖奖励');
  assert.ok(sawShop && sawTreasure && sawCurse && sawElite, '应当逛过商店 / 宝藏 / 诅咒 / 小boss');
  assert.ok(run.deck.length >= 10);
});

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
const isContent = r => r.type === 'shop' || r.type === 'treasure' || r.type === 'curse' || r.type === 'altar' || r.type === 'elite' || r.type === 'boss' || (r.type === 'normal' && r.combat);
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

test('以撒式布局：起点/首领各一，宝藏/商店/诅咒/小boss/祭坛 至少各一，房间全连通', () => {
  for (let i = 0; i < 10; i++) {
    const run = newRun('isaac-' + i);
    const g = run.grid;
    assert.equal(g.type, 'isaac');
    assert.ok(g.rooms.length >= CG.CONFIG.map.minRooms);
    assert.equal(byType(run, 'start').length, 1, '起点恰好 1');
    assert.equal(byType(run, 'boss').length, 1, '首领恰好 1');
    ['treasure', 'shop', 'curse', 'elite', 'altar'].forEach(t =>
      assert.ok(byType(run, t).length >= 1, t + ' 应至少 1 间'));
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

test('普通房按概率藏敌：跨多层既有藏敌也有空房；藏敌房一半明示一半隐藏', () => {
  let combat = 0, empty = 0, shown = 0, hidden = 0;
  for (let i = 0; i < 14; i++) {
    const run = newRun('enemy-' + i);
    byType(run, 'normal').forEach(r => {
      if (r.combat) { combat++; r.reveal ? shown++ : hidden++; } else empty++;
    });
  }
  assert.ok(combat > 0 && empty > 0, '普通房应既有藏敌也有空房');
  assert.ok(shown > 0 && hidden > 0, '藏敌房应有的明示(reveal)、有的隐藏');
});

test('诅咒房：耗血换 2 个随机商店货色（立即入手）；宝藏房免费给 1 遗物', () => {
  const run = newRun('loot');
  const curse = byType(run, 'curse')[0];
  run.available = [curse];
  const hp0 = run.hp, deck0 = run.deck.length, gems0 = run.gems.length, tarot0 = run.tarot.length, relics0 = run.relics.length;
  run.selectNode(curse);
  assert.equal(run.phase, 'event');
  assert.equal(run.pending.kind, 'curse');
  assert.ok(run.pending.hpPaid > 0);                                  // 记录了血代价（即"进入耗血"；遗物 onPickup 可能回血/加最大生命，故只验 hpPaid，不比 run.hp<hp0）
  assert.equal(run.pending.offers.length, 2);                        // 2 个商店货色
  run.pending.offers.forEach(o => assert.ok(['gem', 'card', 'tarot', 'relic', 'gold'].includes(o.type)));
  // 非金币的货色应已立即入手（背包/牌组/塔罗/遗物 合计净增 = 非金币个数）
  const nonGold = run.pending.offers.filter(o => o.type !== 'gold').length;
  const delta = (run.deck.length - deck0) + (run.gems.length - gems0) + (run.tarot.length - tarot0) + (run.relics.length - relics0);
  assert.equal(delta, nonGold);
  run.leaveEvent();
  assert.equal(curse.done, true);

  const run2 = newRun('loot2');
  const t = byType(run2, 'treasure')[0];
  run2.available = [t];
  const r0 = run2.relics.length;
  run2.selectNode(t);
  assert.equal(run2.pending.kind, 'treasure');
  assert.equal(run2.pending.hpPaid, undefined);                      // 宝藏房无血代价（遗物 onPickup 可能改血量，故不直接比 hp）
  assert.ok(run2.relics.length === r0 + 1 || run2.pending.gold > 0); // 给 1 件遗物（集齐则折金）
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
  const gem = CG.makeGem([{ id: 'energy_damage', level: 1 }]);
  run.gems.push(gem);
  const target = run.deck[0];
  CG.addSocket(target);                                   // v2 起手牌都是单孔满镶，先加一个空孔
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

test('卸下宝石：花钱，回到背包（v2 无独立减益，不再附 debuff）', () => {
  const run = newRun();
  run.gold = 999;
  const card = run.deck.find(c => c.sockets.length);     // 预镶嵌的卡
  const gold0 = run.gold;
  run.buyUninstall(card.uid, 0);
  assert.equal(card.sockets.length, 0);
  assert.equal(run.gems.length, 1);
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
    gems: [{ gem: CG.makeGem([{ id: 'energy_damage', level: 1 }]), price: 30, bought: false }],
    cards: [{ base: 'spell', limit: 2, gems: [], price: 40, bought: false }],
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
  assert.equal(run.altarUsable('purify'), true);                  // v3：起手宝石都带代价 → 可净化

  run.gems.push(CG.makeGem([{ id: 'energy_damage', level: 1 }]));
  CG.addSocket(run.deck[0]);                          // v2 起手牌满镶，先腾一个空孔
  assert.equal(run.altarUsable('setting'), true);
  // 净化掉所有带代价的宝石后，purify 不再可用
  run.allGems().forEach(x => CG.gemRemoveCost(x.gem));
  assert.equal(run.altarUsable('purify'), false);
});

test('净化：去掉宝石代价 → 打出时不再支付（商店 buyPurify）', () => {
  const run = newRun();
  run.gold = 999;
  const g2 = CG.makeGem([{ id: 'energy_damage', level: 1 }]);
  run.gems.push(g2);
  const before = run.purifyPrice();
  run.buyPurify(g2.uid);
  assert.equal(g2.purified, true);
  assert.ok(run.gold < 999 && run.purifyPrice() > before);   // 扣钱、逐次涨价
  // 净化后的宝石作非首石镶嵌：不付代价
  const card = CG.makeCard('spell', 2, [CG.makeGem([{ id: 'energy_damage', level: 1 }]), g2]);
  assert.equal(CG.cardStats(card).cost, 1);   // 首石免 + 第二颗已净化 → 仅基底 1
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

test('开局随机卡包(旅者)：基础包 + 按内容量(size)随机加主题直到达标；本局只在这几个里出包', () => {
  CG.RNG.seed('packs-run');
  const run = new CG.Run('traveler');   // 旅者 packs:null → 随机 rollRunPacks（其它职业用固定包组合）
  assert.ok(run.packs.length >= 2, '至少基础 + 几个主题');
  assert.equal(new Set(run.packs).size, run.packs.length, '不重复');
  assert.ok(run.packs.includes('basic'), '必含基础包');
  run.packs.forEach(id => assert.ok(CG.PACKS[id], '都是合法包 id'));
  const themed = CG.PACK_IDS.filter(id => id !== 'basic' && id !== 'fusion');
  // 累计 size（基础不计）应达到目标内容量（最后一个包跨过阈值）
  const themedSize = run.packs.filter(id => id !== 'basic').reduce((s, id) => s + CG.PACKS[id].size, 0);
  assert.ok(themedSize >= (CG.CONFIG.runPackSize || 24), '累计内容量达标');
  assert.ok(themed.some(id => !run.packs.includes(id)), '应排除掉部分主题');
  // 本局所有扩充包＝一个融合包：pickPack 恒返回 'fusion'，其词条池＝选定主题「代价×价值」全交叉积
  assert.equal(CG.pickPack('elite'), 'fusion');
  const f = CG.fusionPack();
  fusionFromThemes(run.packs, f);   // 校验：每个融合词条的 代价/条件 与 价值 都来自选定主题
});

test('职业系统：每职业一套合法包组合 + 初始牌组；旅者随机', () => {
  const ids = Object.keys(CG.CLASSES);
  assert.ok(ids.length >= 16, '至少 16 个职业');
  for (const id of ids) {
    const c = CG.CLASSES[id];
    // 包：旅者 packs:null（随机）；其余固定且都是合法 id、不含 fusion/修饰词包专属问题
    if (id !== 'traveler') { assert.ok(c.packs && c.packs.length, id + ' 应有固定包'); c.packs.forEach(p => assert.ok(CG.PACKS[p], id + ' 的包 ' + p + ' 合法')); }
    const packs = CG.classPacks(id);
    assert.ok(packs.includes('basic'), id + ' classPacks 必含 basic');
    // 牌组：长度 = deck 三数之和；元素都是合法卡
    const deck = CG.buildDeck(id);
    const d = c.deck || [5, 5, 0];
    assert.strictEqual(deck.length, d[0] + d[1] + (d[2] || 0), id + ' 牌组数对');
    deck.forEach(card => assert.ok(CG.cardStats(card), id + ' 牌组卡合法'));
  }
  // 选定职业 → Run 用其包组合（非随机）
  CG.RNG.seed('cls'); const r = new CG.Run('rogue');
  assert.deepStrictEqual(new Set(r.packs.filter(p => p !== 'basic')), new Set(CG.CLASSES.rogue.packs));
  CG.setActivePacks(null);
});

// 融合包＝选定主题 values(now)/costs/conds 并集的交叉积；选了修饰词包则按映射加入对应 下/每回合 变体。
function fusionFromThemes(packIds, f) {
  const valueSet = new Set(packIds.flatMap(id => CG.PACKS[id].values || []));
  packIds.filter(id => CG.PACKS[id].timingMod).forEach(id => { const t = CG.PACKS[id].timingMod; [...valueSet].forEach(nowId => { const v = CG.timingVariants[nowId] && CG.timingVariants[nowId][t]; if (v) valueSet.add(v); }); });
  const costSet = new Set(['energy', ...packIds.flatMap(id => CG.PACKS[id].costs || [])]);
  const condSet = new Set(packIds.flatMap(id => CG.PACKS[id].conds || []));
  f.buffs.concat(f.debuffs).forEach(id => {
    const a = CG.AFFIXES[id], c = a.cost;
    const okCost = c.cond ? condSet.has(c.res) : costSet.has(c.res);   // 代价时点变体(hpV_…)的 cost.res 仍是基底 'hp'
    assert.ok(okCost && valueSet.has(a.value.atom), id + ' 应来自选定主题');
  });
}

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

test('商店出售 booster pack：买下扣钱、滚出对应数量同主题宝石、挑 1 颗进背包', () => {
  const run = newRun('shop-booster');
  run.gold = 1000;
  run._enterShop();
  assert.ok(run.pending.packs && run.pending.packs.length >= 2, '商店应有 booster pack 货位（三选一 + 五选一）');
  const idx = run.pending.packs.findIndex(p => p.count === 5);
  assert.ok(idx >= 0, '应有五选一包');
  const it = run.pending.packs[idx], pack = CG.PACKS[it.pack];
  assert.ok(pack, '包应有合法主题');
  const gold0 = run.gold, bag0 = run.gems.length;
  run.buyPack(idx);
  assert.equal(run.gold, gold0 - it.price);              // 扣钱
  assert.equal(it.bought, true);
  assert.equal(it.rolled.length, it.count);              // 滚出 count 颗
  const inPack = id => pack.buffs.includes(id) || pack.debuffs.includes(id);
  it.rolled.forEach(g => g.affixes.forEach(a => assert.ok(inPack(a.id), `包内宝石词条 ${a.id} 不属于 ${it.pack}`)));
  const chosen = it.rolled[2];                            // 挑第 3 颗
  run.takePackGem(idx, chosen.uid);
  assert.equal(it.taken, true);
  assert.equal(run.gems.length, bag0 + 1);
  assert.equal(run.gems[run.gems.length - 1].uid, chosen.uid);
});

test('booster pack：钱不够买不了 / 取过不能再取 / 离开商店自动取走没挑的包', () => {
  const run = newRun('shop-booster2');
  run._enterShop();
  const it0 = run.pending.packs[0];
  run.gold = it0.price - 1;                               // 钱不够
  run.buyPack(0);
  assert.equal(it0.bought, false);
  run.gold = 1000;
  run.buyPack(0);
  const bag1 = run.gems.length;
  run.takePackGem(0, it0.rolled[0].uid);
  assert.equal(run.gems.length, bag1 + 1);
  run.takePackGem(0, it0.rolled[1].uid);                 // 已取过 → 无效
  assert.equal(run.gems.length, bag1 + 1);

  const it1 = run.pending.packs[1];                       // 买下但不挑
  run.gold = 1000;
  run.buyPack(1);
  const before = run.gems.length;
  run.leaveShop();                                        // 安全网：自动取走一颗
  assert.equal(it1.taken, true);
  assert.equal(run.gems.length, before + 1);
});

test('商店五选二：买下可挑 2 颗，挑满才算取完，重复/超额无效', () => {
  const run = newRun('shop-pick2');
  run.gold = 1000;
  run._enterShop();
  const idx = run.pending.packs.findIndex(p => p.pick === 2);
  assert.ok(idx >= 0, '应有五选二包');
  const it = run.pending.packs[idx], bag0 = run.gems.length;
  run.buyPack(idx);
  assert.equal(it.rolled.length, 5);
  run.takePackGem(idx, it.rolled[0].uid);
  assert.equal(it.taken, false);                          // 才取 1 颗，未挑满
  assert.equal(run.gems.length, bag0 + 1);
  run.takePackGem(idx, it.rolled[0].uid);                 // 同一颗不能重复取
  assert.equal(run.gems.length, bag0 + 1);
  run.takePackGem(idx, it.rolled[1].uid);                 // 取第 2 颗 → 挑满
  assert.equal(it.taken, true);
  assert.equal(run.gems.length, bag0 + 2);
  run.takePackGem(idx, it.rolled[2].uid);                 // 已满 → 无效
  assert.equal(run.gems.length, bag0 + 2);
});

test('五选二安全网：买了只挑 1 颗就离店 → 自动补满第 2 颗', () => {
  const run = newRun('shop-pick2b');
  run.gold = 1000;
  run._enterShop();
  const idx = run.pending.packs.findIndex(p => p.pick === 2);
  const it = run.pending.packs[idx];
  run.buyPack(idx);
  run.takePackGem(idx, it.rolled[0].uid);
  const before = run.gems.length;                         // 已取 1
  run.leaveShop();
  assert.equal(it.takenUids.length, 2);                   // 安全网补到 2
  assert.equal(run.gems.length, before + 1);
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

test('调试：debugAddGem 把自定义词条宝石加入背包（夹等级 1~3、滤非法、空则不加）', () => {
  const run = newRun('debug-gem');
  const n0 = run.gems.length;
  const gem = run.debugAddGem([{ id: 'energy_damage', level: 5 }, { id: 'energy_block', level: 1 }, { id: 'not_real', level: 2 }]);
  assert.ok(gem);
  assert.equal(run.gems.length, n0 + 1);
  assert.equal(run.gems[run.gems.length - 1], gem);
  assert.equal(gem.affixes.length, 2, '非法词条被过滤');
  assert.equal(gem.affixes.find(a => a.id === 'energy_damage').level, 3, '等级夹到 1~3');
  // 空 / 全非法 → 不加、返回 null
  assert.equal(run.debugAddGem([]), null);
  assert.equal(run.debugAddGem([{ id: 'nope' }]), null);
  assert.equal(run.gems.length, n0 + 1);
});

test('调试：Run 可手动指定本局卡包（opts.packs，滤非法；空则回退按量随机）', () => {
  CG.RNG.seed('debug-packs');
  const run = new CG.Run('warrior', { packs: ['poison', 'elements', 'bogus'] });
  assert.equal(run.packs.length, 2, '过滤掉非法 id');
  assert.ok(run.packs.includes('poison') && run.packs.includes('elements'));
  assert.equal(CG.pickPack('elite'), 'fusion');
  fusionFromThemes(run.packs, CG.fusionPack());   // 融合池只应来自指定主题（交叉积）
  // 空 / 全非法 → 回退按量随机（基础包 + 若干）
  const run2 = new CG.Run('warrior', { packs: ['bogus'] });
  assert.ok(run2.packs.length >= 2);
  assert.ok(run2.packs.includes('basic'));
});

test('v3.12 消耗品/遗物归入主题包：每个主题都有、标签合法、战斗内可结算', () => {
  const tPacks = new Set(CG.TAROT_IDS.map(id => CG.TAROT[id].pack));
  const rPacks = new Set(CG.RELIC_IDS.map(id => CG.RELICS[id].pack));
  CG.PACK_IDS.filter(p => p !== 'fusion' && !CG.PACKS[p].timingMod).forEach(p => {   // 修饰词包(每回合/下回合)无价值、不配塔罗/遗物
    assert.ok(tPacks.has(p), p + ' 主题缺塔罗');
    assert.ok(rPacks.has(p), p + ' 主题缺遗物');
  });
  CG.TAROT_IDS.forEach(id => assert.ok(CG.TAROT[id].pack === 'general' || CG.PACKS[CG.TAROT[id].pack], id + ' 塔罗标签非法'));
  CG.RELIC_IDS.forEach(id => assert.ok(CG.RELICS[id].pack === 'general' || CG.PACKS[CG.RELICS[id].pack], id + ' 遗物标签非法'));
  // 战斗内：每张塔罗 apply、每件遗物 battleStart/firstTurn/onTurnStart 钩子均不抛错
  const run = newRun('p2-fx');
  CG.TAROT_IDS.forEach(id => {
    const t = CG.TAROT[id]; if (t.where === 'map' || t.async) return;
    const b = CG.makeBattle({ enemyIds: ['green_slime', 'green_slime'] }); b.enemy.hp = 80; b.enemy.maxHp = 80; b.player.energy = 5;
    t.apply(run, b, { pickCard() {} });
  });
  CG.RELIC_IDS.forEach(id => {
    const r = CG.RELICS[id], b = CG.makeBattle({ enemyIds: ['green_slime', 'green_slime'] });
    b.enemy.hp = 80; b.enemy.maxHp = 80; b.player.power = 4;
    if (r.battleStart) r.battleStart(b);
    if (r.firstTurn) r.firstTurn(b);
    if (r.onTurnStart) r.onTurnStart(b);
  });
});

test('v3.12 掉落偏向本局主题：themed 池 ⊆ 选定主题 ∪ general', () => {
  const run = new CG.Run('warrior', { packs: ['poison', 'elements'] });
  run._themedTarotIds().forEach(id => { const p = CG.TAROT[id].pack; assert.ok(p === 'general' || run.packs.includes(p), id + ' 不应在 poison/elements 塔罗池'); });
  run._themedRelicPool(() => true).forEach(id => { const p = CG.RELICS[id].pack; assert.ok(p === 'general' || run.packs.includes(p), id + ' 不应在 poison/elements 遗物池'); });
  CG.setActivePacks(null);
});

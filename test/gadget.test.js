'use strict';
/* 奇巧包（随机/赌博）：掷骰/抛硬币/百宝箱/头奖/老虎机 + 哑火/无常/走火 的纯逻辑（引擎层）。
 *
 *  随机一律走 Math.random()（被 CG.RNG 接管）。测试里有两种确定化手法：
 *   1) 「种子 + 紧贴 playCard」：playCard 在到达本包 handler 前不消耗任何随机，故
 *      seed(...) 紧贴 playCard 时，handler 看到的就是该种子的「第一个随机数」→ 完全可复现。
 *      （宿主基底的 damage/block 效果先结算但都不掷随机；故选 defend/strike 当宿主即可隔离。）
 *   2) 「循环统计」：固定种子后多跑若干次，断言每个分支都出现 / 取值都落在区间。
 *  跨 vm realm：用 .length / 逐值比较，不用 deepEqual。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

// 造一张「基底 + 单颗含指定词条的宝石」的卡（affix 可写字符串=1级 或 {id,level}）
const gemCard = (base, affixes) =>
  CG.makeCard(base, affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);
// 大血量、能量充足的战斗，便于反复打出而不被耗能/击杀打断
function fresh() {
  const b = CG.makeBattle();
  b.enemies[0].maxHp = 5000; b.enemies[0].hp = 5000;
  b.player.maxHp = 5000; b.player.hp = 5000; b.player.energy = 99;
  return b;
}
// 紧贴打出：seed → 立刻 playCard（handler 的随机数 = 该种子第一个随机数，可复现）
function playSeeded(b, card, seed) { CG.RNG.seed(seed); b.playCard(card.uid); }

// ---------------------------------------------------------------------------
test('奇巧包存在且词条齐全；不与已有包冲突', () => {
  assert.ok(CG.PACKS.gadget && CG.PACKS.gadget.name === '奇巧包');
  assert.equal(CG.PACKS.gadget.icon, '🎲');
  assert.equal(CG.PACKS.gadget.color, '#c8a0e0');
  ['dice', 'coinflip', 'grabbag', 'jackpot', 'slots'].forEach(id => {
    assert.ok(CG.PACKS.gadget.buffs.includes(id), id + ' 应在奇巧包增益');
    assert.ok(CG.AFFIXES[id], id + ' 未定义');
    assert.equal(CG.isDebuff(id), false, id + ' 不应是减益');
  });
  ['misfire', 'fickle', 'backfire'].forEach(id => {
    assert.ok(CG.PACKS.gadget.debuffs.includes(id), id + ' 应在奇巧包减益');
    assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].debuff, id + ' 应是减益');
  });
  // 旧包未被覆盖
  assert.equal(CG.PACKS.power.name, '强攻包');
  assert.equal(CG.PACKS.elements.name, '元素包');
});

test('cardStats 把奇巧词条聚合成自包含 effect（仿 give/randbuff 的 push）', () => {
  const eff = (s, t) => s.effects.find(e => e.type === t);
  assert.equal(eff(CG.cardStats(gemCard('defend', [{ id: 'dice', level: 2 }])), 'dice').value, 2);
  assert.equal(eff(CG.cardStats(gemCard('defend', ['coinflip'])), 'coinflip').value, 1);
  assert.equal(eff(CG.cardStats(gemCard('defend', [{ id: 'grabbag', level: 3 }])), 'randbuff').value, 3);   // 百宝箱→复用 randbuff
  assert.equal(eff(CG.cardStats(gemCard('defend', ['jackpot'])), 'jackpot').value, 1);
  assert.equal(eff(CG.cardStats(gemCard('defend', ['slots'])), 'slots').value, 1);
  assert.equal(eff(CG.cardStats(gemCard('defend', [{ id: 'misfire', level: 2 }])), 'misfire').value, 2);
  assert.equal(eff(CG.cardStats(gemCard('defend', ['fickle'])), 'fickle').value, 1);
  assert.equal(eff(CG.cardStats(gemCard('defend', ['backfire'])), 'backfire').value, 1);
});

// ---- 掷骰：随机 L~6L 伤害 ----
test('掷骰：伤害落在 [L, 6L] 区间，且能取遍 1~6（L=1）', () => {
  CG.RNG.seed('dice-range');
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const b = fresh(); const c = gemCard('defend', ['dice']); b.hand = [c];   // defend：宿主只给玩家格挡，敌人 hp 差即骰伤
    const hp0 = b.enemies[0].hp; b.playCard(c.uid);
    const d = hp0 - b.enemies[0].hp;
    assert.ok(d >= 1 && d <= 6, '掷骰 L1 伤害应在 1~6，实得 ' + d);
    seen.add(d);
  }
  assert.equal(seen.size, 6, '300 次应取遍 1~6 六个点数');
  // L=2：区间 2~12
  CG.RNG.seed('dice-range2');
  for (let i = 0; i < 200; i++) {
    const b = fresh(); const c = gemCard('defend', [{ id: 'dice', level: 2 }]); b.hand = [c];
    const hp0 = b.enemies[0].hp; b.playCard(c.uid);
    const d = hp0 - b.enemies[0].hp;
    assert.ok(d >= 2 && d <= 12, '掷骰 L2 伤害应在 2~12，实得 ' + d);
  }
});

// ---- 抛硬币：50% 造成 8L，否则 0 ----
test('抛硬币：命中造成 8×等级，未命中 0（两个分支都覆盖）', () => {
  // 种子定点：命中
  let b = fresh(), c = gemCard('defend', ['coinflip']); b.hand = [c];
  let hp0 = b.enemies[0].hp; playSeeded(b, c, 't0');
  assert.equal(hp0 - b.enemies[0].hp, 8, 'coinflip 命中应 8 伤害');
  // 种子定点：未命中
  b = fresh(); c = gemCard('defend', ['coinflip']); b.hand = [c];
  hp0 = b.enemies[0].hp; playSeeded(b, c, 't2');
  assert.equal(hp0 - b.enemies[0].hp, 0, 'coinflip 未命中应 0 伤害');
  // 统计：两个分支都会出现，且每次伤害只可能是 0 或 8
  CG.RNG.seed('coin-stats');
  let hits = 0, miss = 0;
  for (let i = 0; i < 200; i++) {
    const bb = fresh(); const cc = gemCard('defend', ['coinflip']); bb.hand = [cc];
    const h0 = bb.enemies[0].hp; bb.playCard(cc.uid);
    const d = h0 - bb.enemies[0].hp;
    assert.ok(d === 0 || d === 8, 'coinflip 伤害只能是 0 或 8，实得 ' + d);
    if (d === 8) hits++; else miss++;
  }
  assert.ok(hits > 0 && miss > 0, '两个分支都应出现');
  // L=2：命中 16
  b = fresh(); c = gemCard('defend', [{ id: 'coinflip', level: 2 }]); b.hand = [c];
  hp0 = b.enemies[0].hp; playSeeded(b, c, 't0');
  assert.equal(hp0 - b.enemies[0].hp, 16, 'coinflip L2 命中应 16');
});

// ---- 百宝箱：复用随机增益（力量/敏捷）----
test('百宝箱：随机获得力量或敏捷 L 层（复用 randbuff，两种都能出）', () => {
  CG.RNG.seed('grabbag');
  const got = new Set();
  for (let i = 0; i < 80; i++) {
    const b = fresh(); const c = gemCard('defend', ['grabbag']); b.hand = [c];
    b.playCard(c.uid);
    ['strength', 'dexterity'].forEach(k => { if (b.player.statuses[k]) got.add(k); });
  }
  assert.ok(got.has('strength') && got.has('dexterity'), '力量与敏捷都应能获得');
  // L=3：一次给 3 层
  const b = fresh(); const c = gemCard('defend', [{ id: 'grabbag', level: 3 }]); b.hand = [c];
  CG.RNG.seed('grabbag-lv'); b.playCard(c.uid);
  const total = (b.player.statuses.strength || 0) + (b.player.statuses.dexterity || 0);
  assert.equal(total, 3, '百宝箱 L3 应给 3 层（力量或敏捷之一）');
});

// ---- 头奖：等概率三选一（伤害 / 格挡 / 抽 3）----
test('头奖：三分支（12L 伤害 / 12L 格挡 / 抽 3）各能命中', () => {
  // 宿主用 strike（基础伤害 6、不给格挡）以便分别隔离：
  //   伤害分支 enemyDelta = 6 + 12 = 18；格挡分支 player.block = 12；抽牌分支 drawPile -3
  // 伤害
  let b = fresh(); let c = gemCard('strike', ['jackpot']); b.hand = [c];
  let hp0 = b.enemies[0].hp; playSeeded(b, c, 't10');
  assert.equal(hp0 - b.enemies[0].hp, 18, '头奖·伤害分支应造成 6+12=18');
  assert.equal(b.player.block, 0);
  // 格挡
  b = fresh(); c = gemCard('strike', ['jackpot']); b.hand = [c];
  hp0 = b.enemies[0].hp; playSeeded(b, c, 't0');
  assert.equal(b.player.block, 12, '头奖·格挡分支应得 12 格挡');
  assert.equal(hp0 - b.enemies[0].hp, 6, '此分支只有打击的 6 点基础伤害');
  // 抽牌
  b = fresh(); c = gemCard('strike', ['jackpot']); b.hand = [c];
  const dp0 = b.drawPile.length; playSeeded(b, c, 't2');
  assert.equal(dp0 - b.drawPile.length, 3, '头奖·抽牌分支应抽 3 张');
  assert.equal(b.hand.length, 3, '抽到手牌 3 张（头奖牌已打出离手）');
  // L=2：伤害分支 6 + 24 = 30
  b = fresh(); c = gemCard('strike', [{ id: 'jackpot', level: 2 }]); b.hand = [c];
  hp0 = b.enemies[0].hp; playSeeded(b, c, 't10');
  assert.equal(hp0 - b.enemies[0].hp, 30, '头奖 L2·伤害分支应 6+24=30');
});

// ---- 老虎机：每第 3 次打出爆出 20L 伤害（伪随机保底，无 RNG）----
test('老虎机：第 3 次打出造成 20×等级 伤害并把计数清零（不依赖随机）', () => {
  const b = fresh();
  const play = lvl => {
    const c = gemCard('defend', [{ id: 'slots', level: lvl }]); b.hand = [c];
    const hp0 = b.enemies[0].hp; b.playCard(c.uid); return hp0 - b.enemies[0].hp;
  };
  assert.equal(play(1), 0); assert.equal(b._slots, 1);
  assert.equal(play(1), 0); assert.equal(b._slots, 2);
  assert.equal(play(1), 20, '第 3 次应爆出 20'); assert.equal(b._slots, 0, '随后清零');
  assert.equal(play(1), 0); assert.equal(b._slots, 1, '计数从头再来');
  // 等级影响数值：再连打两张到第 3 张（L=3 → 60）
  assert.equal(play(1), 0); assert.equal(b._slots, 2);
  assert.equal(play(3), 60, '第 3 次按本张等级 ×20'); assert.equal(b._slots, 0);
});

// ---- 哑火：25% 失去 3L 生命（直接扣 hp、过格挡）----
test('哑火：25% 概率失去 3×等级 生命（过格挡），否则无事', () => {
  // 种子定点：触发（defend 给 5 格挡，但哑火直接扣 hp 不被格挡）
  let b = fresh(); let c = gemCard('defend', ['misfire']); b.hand = [c];
  let hp0 = b.player.hp; playSeeded(b, c, 't17');
  assert.equal(hp0 - b.player.hp, 3, '哑火触发应失去 3 生命');
  assert.equal(b.player.block, 5, '哑火过格挡：格挡仍在（来自宿主防御）');
  // 种子定点：不触发
  b = fresh(); c = gemCard('defend', ['misfire']); b.hand = [c];
  hp0 = b.player.hp; playSeeded(b, c, 't0');
  assert.equal(hp0 - b.player.hp, 0, '哑火未触发应无损');
  // 统计：两个分支都出现，损失只可能是 0 或 3；触发约 1/4
  CG.RNG.seed('misfire-stats');
  let fire = 0;
  for (let i = 0; i < 400; i++) {
    const bb = fresh(); const cc = gemCard('defend', ['misfire']); bb.hand = [cc];
    const h0 = bb.player.hp; bb.playCard(cc.uid);
    const d = h0 - bb.player.hp;
    assert.ok(d === 0 || d === 3, '损失只能是 0 或 3，实得 ' + d);
    if (d === 3) fire++;
  }
  assert.ok(fire > 0 && fire < 400, '应有时触发、有时不触发');
  assert.ok(fire > 40 && fire < 180, '触发率应在 ~25% 量级，实测 ' + fire + '/400');
  // 致死会触发 _checkEnd → phase lost
  b = fresh(); b.player.hp = 2; c = gemCard('defend', ['misfire']); b.hand = [c];
  playSeeded(b, c, 't17');
  assert.equal(b.player.hp, 0);
  assert.equal(b.phase, 'lost', '哑火致死应结算为失败');
});

// ---- 无常：随机给玩家 易伤/虚弱/脆弱 之一 L 层 ----
test('无常：随机给玩家 易伤/虚弱/脆弱 之一 L 层（三种都能出）', () => {
  // 三个定点种子各命中一种
  let b = fresh(); let c = gemCard('defend', ['fickle']); b.hand = [c]; playSeeded(b, c, 't10');
  assert.equal(b.player.statuses.vulnerable, 1);
  b = fresh(); c = gemCard('defend', ['fickle']); b.hand = [c]; playSeeded(b, c, 't0');
  assert.equal(b.player.statuses.weak, 1);
  b = fresh(); c = gemCard('defend', ['fickle']); b.hand = [c]; playSeeded(b, c, 't2');
  assert.equal(b.player.statuses.frail, 1);
  // 统计：三种都会出现，且每次恰好施加一种
  CG.RNG.seed('fickle-stats');
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    const bb = fresh(); const cc = gemCard('defend', ['fickle']); bb.hand = [cc]; bb.playCard(cc.uid);
    const on = ['vulnerable', 'weak', 'frail'].filter(k => bb.player.statuses[k]);
    assert.equal(on.length, 1, '每次只施加一种减益');
    seen.add(on[0]);
  }
  assert.equal(seen.size, 3, '三种减益都应出现过');
  // L=2：给 2 层
  b = fresh(); c = gemCard('defend', [{ id: 'fickle', level: 2 }]); b.hand = [c]; playSeeded(b, c, 't0');
  assert.equal(b.player.statuses.weak, 2, '无常 L2 应给 2 层');
});

// ---- 走火：50% 对敌人、否则对自己造成 5L ----
test('走火：50% 误伤——命中敌人或自己造成 5×等级（两分支都覆盖）', () => {
  // 宿主用 strike（玩家无自带格挡），自伤分支才看得见：
  //   敌人分支 enemyDelta = 6(打击) + 5 = 11、玩家无损；自伤分支 玩家 -5
  let b = fresh(); let c = gemCard('strike', ['backfire']); b.hand = [c];
  let eh0 = b.enemies[0].hp, ph0 = b.player.hp; playSeeded(b, c, 't0');
  assert.equal(eh0 - b.enemies[0].hp, 11, '走火·敌人分支：打击6 + 走火5');
  assert.equal(ph0 - b.player.hp, 0, '此分支玩家无损');
  // 自伤分支
  b = fresh(); c = gemCard('strike', ['backfire']); b.hand = [c];
  eh0 = b.enemies[0].hp; ph0 = b.player.hp; playSeeded(b, c, 't2');
  assert.equal(ph0 - b.player.hp, 5, '走火·自伤分支：玩家失去 5');
  assert.equal(eh0 - b.enemies[0].hp, 6, '此分支敌人只挨打击的 6');
  // 统计：两分支都出现
  CG.RNG.seed('backfire-stats');
  let self = 0, foe = 0;
  for (let i = 0; i < 200; i++) {
    const bb = fresh(); const cc = gemCard('strike', ['backfire']); bb.hand = [cc];
    const p0 = bb.player.hp; bb.playCard(cc.uid);
    if (p0 - bb.player.hp === 5) self++; else foe++;
  }
  assert.ok(self > 0 && foe > 0, '走火两分支都应出现');
  // L=2 自伤分支：玩家 -10
  b = fresh(); c = gemCard('strike', [{ id: 'backfire', level: 2 }]); b.hand = [c];
  ph0 = b.player.hp; playSeeded(b, c, 't2');
  assert.equal(ph0 - b.player.hp, 10, '走火 L2·自伤应失去 10');
});

// ---- 走火自伤会被玩家格挡吸收（沿用 _dealRaw）----
test('走火·自伤经格挡吸收，并在致死时结算失败', () => {
  // 玩家有格挡时，走火自伤先吃格挡
  let b = fresh(); b.player.block = 4; let c = gemCard('strike', ['backfire']); b.hand = [c];
  let ph0 = b.player.hp; playSeeded(b, c, 't2');   // 自伤 5 - 格挡 4 = 1
  assert.equal(ph0 - b.player.hp, 1, '自伤 5 被 4 格挡吸收，净失 1');
  assert.equal(b.player.block, 0);
  // 致死 → phase lost
  b = fresh(); b.player.hp = 3; c = gemCard('strike', ['backfire']); b.hand = [c];
  playSeeded(b, c, 't2');
  assert.equal(b.player.hp, 0);
  assert.equal(b.phase, 'lost', '走火自伤致死应失败');
});

// ---- 包级别：rollGem 限定在奇巧包池、整体可归入奇巧包 ----
test('rollGem(gadget)：抽到的词条只来自奇巧包（大/小宝石都成立）', () => {
  const inPack = id => CG.PACKS.gadget.buffs.includes(id) || CG.PACKS.gadget.debuffs.includes(id);
  CG.RNG.seed('gadget-roll');
  for (let i = 0; i < 80; i++) {
    CG.rollGem({ pack: 'gadget', big: false, tier: 'monster' }).affixes.forEach(a => assert.ok(inPack(a.id), '小宝石漏出 ' + a.id));
    CG.rollGem({ pack: 'gadget', big: true, tier: 'boss' }).affixes.forEach(a => assert.ok(inPack(a.id), '大宝石漏出 ' + a.id));
  }
});

test('packW 三档都含 gadget；pickPack 仍只返回合法包', () => {
  ['monster', 'elite', 'boss'].forEach(t => {
    assert.ok(CG.CONFIG.packW[t].some(p => p[0] === 'gadget'), t + ' 档应含 gadget');
  });
  CG.RNG.seed('pickpack');
  for (let i = 0; i < 60; i++) ['monster', 'elite', 'boss'].forEach(t => assert.ok(CG.PACKS[CG.pickPack(t)], '选出非法包'));
});

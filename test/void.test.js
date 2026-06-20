'use strict';
/* 虚无包：空明/舍身/湮灭/虚空回响/献祭 + 蚀骨/放逐/空虚 的纯逻辑（引擎层）。
 * 核心＝稀缺/牺牲：手牌越空越强、用生命/最大生命/牌堆换爆发。maxHp 改动仅本场。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

// 单孔宝石卡：affixes 可写字符串或 {id,level}
const gemCard = (base, affixes, limit) =>
  CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);
const plain = base => CG.makeCard(base);   // 无宝石的占位牌（用来撑手牌数）

test('虚无包存在；不与已有包冲突；词条都挂得上', () => {
  assert.ok(CG.PACKS.void && CG.PACKS.void.name === '虚无包');
  assert.equal(CG.PACKS.void.icon, '🕳️');
  ['emptymind', 'devote', 'annihilate', 'voidecho', 'offer'].forEach(id => {
    assert.ok(CG.PACKS.void.buffs.includes(id), id + ' 应在 buffs');
    assert.ok(CG.AFFIXES[id] && !CG.AFFIXES[id].debuff, id + ' 应为增益');
  });
  ['erode', 'banish', 'hollow'].forEach(id => {
    assert.ok(CG.PACKS.void.debuffs.includes(id), id + ' 应在 debuffs');
    assert.ok(CG.AFFIXES[id] && CG.AFFIXES[id].debuff, id + ' 应为减益');
  });
  // 选包权重三档都收录了 void
  ['monster', 'elite', 'boss'].forEach(t => {
    assert.ok(CG.CONFIG.packW[t].some(p => p[0] === 'void'), t + ' 档 packW 应含 void');
  });
});

test('cardStats / foodStats：暴露 emptyMind/voidEcho/hollow 字段（食材默认 0）', () => {
  const s = CG.cardStats(gemCard('strike', ['emptymind']));
  assert.equal(s.emptyMind, 1);
  assert.equal(s.voidEcho, 0);
  assert.equal(s.hollow, 0);
  const f = CG.cardStats(CG.makeCard('tomato'));   // 食材走 foodStats
  assert.equal(f.emptyMind, 0);
  assert.equal(f.voidEcho, 0);
  assert.equal(f.hollow, 0);
});

test('空明：手牌越少伤害越高（+= max(0,5-出牌后手牌数) × 等级）', () => {
  // 出牌后手牌数 = this.hand.length - 1（本牌结算时仍在手里）
  // 只放空明牌 → handAfter=0 → +5；打击 6 → 11
  const b1 = CG.makeBattle();
  const c1 = gemCard('strike', ['emptymind']);
  b1.hand = [c1];
  const hp1 = b1.enemies[0].hp;
  b1.playCard(c1.uid);
  assert.equal(b1.enemies[0].hp, hp1 - 11);

  // 空明牌 + 2 张占位 → handAfter=2 → +3；打击 6 → 9
  const b2 = CG.makeBattle();
  const c2 = gemCard('strike', ['emptymind']);
  b2.hand = [c2, plain('strike'), plain('strike')];
  const hp2 = b2.enemies[0].hp;
  b2.playCard(c2.uid);
  assert.equal(b2.enemies[0].hp, hp2 - 9, '手牌更多 → 加成更少');

  // 手牌很满（≥6）→ max(0,5-5)=0，无加成；打击 6 → 6
  const b3 = CG.makeBattle();
  const c3 = gemCard('strike', ['emptymind']);
  b3.hand = [c3, plain('strike'), plain('strike'), plain('strike'), plain('strike'), plain('strike')];
  const hp3 = b3.enemies[0].hp;
  b3.playCard(c3.uid);
  assert.equal(b3.enemies[0].hp, hp3 - 6, '手牌满 → 无加成（夹 0）');

  // 等级 2：handAfter=0 → +max(0,5)×2=10；打击 6 → 16
  const b4 = CG.makeBattle();
  const c4 = gemCard('strike', [{ id: 'emptymind', level: 2 }]);
  b4.hand = [c4];
  const hp4 = b4.enemies[0].hp;
  b4.playCard(c4.uid);
  assert.equal(b4.enemies[0].hp, hp4 - 16);
});

test('空明：也加格挡', () => {
  const b = CG.makeBattle();
  const c = gemCard('defend', ['emptymind']);   // 防御 5；handAfter=0 → +5 → 10
  b.hand = [c];
  b.playCard(c.uid);
  assert.equal(b.player.block, 10);
});

test('虚空回响：出牌后空手 → 本牌 damage&block ×2；非空手不触发', () => {
  // 空手（只一张）→ 打击 6×2=12
  const b1 = CG.makeBattle();
  const c1 = gemCard('strike', ['voidecho']);
  b1.hand = [c1];
  const hp1 = b1.enemies[0].hp;
  b1.playCard(c1.uid);
  assert.equal(b1.enemies[0].hp, hp1 - 12);

  // 出牌后还有牌 → 不翻倍 → 6
  const b2 = CG.makeBattle();
  const c2 = gemCard('strike', ['voidecho']);
  b2.hand = [c2, plain('strike')];
  const hp2 = b2.enemies[0].hp;
  b2.playCard(c2.uid);
  assert.equal(b2.enemies[0].hp, hp2 - 6, '非空手不翻倍');

  // 格挡也翻倍
  const b3 = CG.makeBattle();
  const c3 = gemCard('defend', ['voidecho']);
  b3.hand = [c3];
  b3.playCard(c3.uid);
  assert.equal(b3.player.block, 10);
});

test('空虚：出牌后手牌非空 → damage&block 减半（向下取整）；空手不减', () => {
  // 非空手 → 打击 floor(6×0.5)=3
  const b1 = CG.makeBattle();
  const c1 = gemCard('strike', ['hollow']);
  b1.hand = [c1, plain('strike')];
  const hp1 = b1.enemies[0].hp;
  b1.playCard(c1.uid);
  assert.equal(b1.enemies[0].hp, hp1 - 3);

  // 空手 → 不减 → 6
  const b2 = CG.makeBattle();
  const c2 = gemCard('strike', ['hollow']);
  b2.hand = [c2];
  const hp2 = b2.enemies[0].hp;
  b2.playCard(c2.uid);
  assert.equal(b2.enemies[0].hp, hp2 - 6, '空手不减半');

  // 格挡也减半：防御 5 → floor(2.5)=2
  const b3 = CG.makeBattle();
  const c3 = gemCard('defend', ['hollow']);
  b3.hand = [c3, plain('strike')];
  b3.playCard(c3.uid);
  assert.equal(b3.player.block, 2);
});

test('舍身：失去 3L 当前生命 + 对当前敌人造成 (3L)×2 伤害', () => {
  // 挂在防御上，避免打击自带伤害干扰；只有舍身造伤
  const b = CG.makeBattle();
  const c = gemCard('defend', ['devote']);   // L=1：失 3 血，造 6 伤
  const hp0 = b.player.hp, ehp0 = b.enemies[0].hp;
  b.hand = [c];
  b.playCard(c.uid);
  assert.equal(b.player.hp, hp0 - 3, '失去 3 当前生命');
  assert.equal(b.enemies[0].hp, ehp0 - 6, '对敌人造 6 伤害');

  // 等级 2：失 6 血、造 12 伤
  const b2 = CG.makeBattle();
  const c2 = gemCard('defend', [{ id: 'devote', level: 2 }]);
  const hp2 = b2.player.hp, ehp2 = b2.enemies[0].hp;
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.player.hp, hp2 - 6);
  assert.equal(b2.enemies[0].hp, ehp2 - 12);
});

test('湮灭：从抽牌堆顶放逐 2L 张到消耗堆，并按实际放逐数 ×3 造伤', () => {
  // 抽牌堆足量：L=1 放逐 2 张 → 造 6 伤
  const b = CG.makeBattle();
  b.drawPile = [plain('strike'), plain('strike'), plain('strike')];
  const exh0 = b.exhaustPile.length;
  const ehp0 = b.enemies[0].hp;
  const c = gemCard('defend', ['annihilate']);
  b.hand = [c];
  b.playCard(c.uid);
  assert.equal(b.exhaustPile.length, exh0 + 2, '放逐 2 张进消耗堆');
  assert.equal(b.drawPile.length, 1, '抽牌堆少 2 张');
  assert.equal(b.enemies[0].hp, ehp0 - 6, '2 张 → 造 6 伤');

  // 抽牌堆不足：只剩 1 张 → 只放逐 1 张 → 造 3 伤（按实际放逐数）
  const b2 = CG.makeBattle();
  b2.drawPile = [plain('strike')];
  const exh2 = b2.exhaustPile.length, ehp2 = b2.enemies[0].hp;
  const c2 = gemCard('defend', ['annihilate']);
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.exhaustPile.length, exh2 + 1);
  assert.equal(b2.drawPile.length, 0);
  assert.equal(b2.enemies[0].hp, ehp2 - 3, '只放逐 1 张 → 造 3 伤');
});

test('献祭：本场最大生命 -3L（下限 1）+ 获得 2L 力量', () => {
  const b = CG.makeBattle({ hp: 60, maxHp: 60 });
  const c = gemCard('defend', ['offer']);   // L=1：maxHp -3，力量 +2
  b.hand = [c];
  b.playCard(c.uid);
  assert.equal(b.player.maxHp, 57);
  assert.equal(b.player.statuses.strength, 2);

  // 当前生命高于新上限时被夹到上限
  const b2 = CG.makeBattle({ hp: 60, maxHp: 60 });
  const c2 = gemCard('defend', [{ id: 'offer', level: 3 }]);   // maxHp -9 → 51，力量 +6
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.player.maxHp, 51);
  assert.ok(b2.player.hp <= b2.player.maxHp, '当前生命不超过新上限');
  assert.equal(b2.player.statuses.strength, 6);
});

test('献祭：减最大生命仅作用于本场（不写回 run）', () => {
  // 用一个最小 run 桩验证不被改动
  const run = { overheal: 0, flags: {}, maxHp: 80 };
  const b = CG.makeBattle({ hp: 70, maxHp: 80, run });
  const c = gemCard('defend', ['offer']);
  b.hand = [c];
  b.playCard(c.uid);
  assert.equal(b.player.maxHp, 77, '本场 maxHp 改变');
  assert.equal(run.maxHp, 80, 'run 上的 maxHp 不变');
});

test('蚀骨：本场最大生命 -2L（下限 1），当前生命被夹到上限', () => {
  const b = CG.makeBattle({ hp: 60, maxHp: 60 });
  const c = gemCard('defend', ['erode']);   // L=1：maxHp -2
  b.hand = [c];
  b.playCard(c.uid);
  assert.equal(b.player.maxHp, 58);
  assert.ok(b.player.hp <= 58);

  // 下限 1：哪怕减成负也夹到 1
  const b2 = CG.makeBattle({ hp: 3, maxHp: 3 });
  const c2 = gemCard('defend', [{ id: 'erode', level: 3 }]);   // 想减 6
  b2.hand = [c2];
  b2.playCard(c2.uid);
  assert.equal(b2.player.maxHp, 1, '最大生命下限 1');
  assert.ok(b2.player.hp <= 1);
});

test('放逐代价：随机放逐 L 张手牌进消耗堆（含打出后剩余手牌）', () => {
  const b = CG.makeBattle();
  const c = gemCard('strike', ['banish']);   // L=1：放逐 1 张手牌
  b.hand = [c, plain('strike'), plain('strike'), plain('strike')];
  const exh0 = b.exhaustPile.length;
  b.playCard(c.uid);
  // 打出 banish 牌本身进弃牌堆；其效果再随机放逐 1 张「剩余手牌」
  assert.equal(b.hand.length, 2, '4 张：打出 1 张 + 放逐 1 张 → 剩 2 张');
  assert.equal(b.exhaustPile.length, exh0 + 1, '放逐 1 张进消耗堆');

  // 等级 2：放逐 2 张剩余手牌
  const b2 = CG.makeBattle();
  const c2 = gemCard('strike', [{ id: 'banish', level: 2 }]);
  b2.hand = [c2, plain('strike'), plain('strike'), plain('strike')];
  const e2 = b2.exhaustPile.length;
  b2.playCard(c2.uid);
  assert.equal(b2.hand.length, 1, '打出 1 张 + 放逐 2 张 → 剩 1 张');
  assert.equal(b2.exhaustPile.length, e2 + 2);

  // 手牌不够放逐：只剩它自己 → 打出后无牌可放逐，不报错
  const b3 = CG.makeBattle();
  const c3 = gemCard('strike', [{ id: 'banish', level: 2 }]);
  b3.hand = [c3];
  const e3 = b3.exhaustPile.length;
  b3.playCard(c3.uid);
  assert.equal(b3.hand.length, 0);
  assert.equal(b3.exhaustPile.length, e3, '没有多余手牌可放逐');
});

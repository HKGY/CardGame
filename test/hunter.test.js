'use strict';
/* 猎杀包（hunter）：处决/借敌人状态爆发/击杀回报。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');
const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('猎杀包存在且词条齐全', () => {
  assert.ok(CG.PACKS.hunter && CG.PACKS.hunter.name === '猎杀包');
  ['execute', 'prey', 'exploit', 'insight', 'reaping'].forEach(id => { assert.ok(CG.PACKS.hunter.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
});

test('处决：残血敌人直接斩杀', () => {
  const b = CG.makeBattle(); const e = b.enemies[0]; e.hp = 2;   // ≤ 10% of 28
  b.hand = [gemCard('defend', ['execute'])]; b.playCard(b.hand[0].uid);
  assert.ok(!e.alive || e.hp === 0);
});

test('猎物：伤害 +目标减益层数；洞察：敌意图攻击时翻倍', () => {
  let b = CG.makeBattle(); let e = b.enemies[0];
  e.maxHp = 100; e.hp = 100;                          // 拔高血量，避免被秒杀（断言精确伤害）
  e.statuses.weak = 2; e.statuses.frail = 1;          // 3 层（不放大玩家伤害）
  let hp = e.hp; b.hand = [gemCard('strike', [{ id: 'prey', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(e.hp, hp - 36);                        // 打击 6 + 猎物(3 层 × 5×等级2 = 30)
  b = CG.makeBattle(); e = b.enemies[0];
  e.intent = { name: '撞', intent: 'attack', effects: [{ type: 'damage', value: 7 }] };
  hp = e.hp; b.hand = [gemCard('strike', ['insight'])]; b.playCard(b.hand[0].uid);
  assert.equal(e.hp, hp - 12);                        // 打击 6 ×2（敌意图攻击）
});

test('弱点爆破：消耗目标减益、按层造伤', () => {
  const b = CG.makeBattle(); const e = b.enemies[0];
  e.maxHp = 100; e.hp = 100;                          // 拔高血量，避免被秒杀（断言精确伤害）
  e.statuses.weak = 2; e.statuses.poison = 1;         // 3 层
  const hp = e.hp; b.hand = [gemCard('defend', ['exploit'])]; b.playCard(b.hand[0].uid);
  assert.equal(e.hp, hp - 36);                        // 3 层 × 12×等级1
  assert.ok(!e.statuses.weak && !e.statuses.poison);
});

test('收割：击杀敌人给永久力量', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', [{ id: 'reaping', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(b._reaping, 6);                        // 3×等级
  b.enemies[0].hp = 0; b._checkEnd();                 // 击杀 → +6 力量
  assert.equal(b.player.statuses.strength, 6);
});

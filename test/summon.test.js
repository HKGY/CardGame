'use strict';
/* 召唤包（summon）：己方召唤物 game.allies——有血量、回合末攻击、可被打、嘲讽吸火力。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('召唤包存在且词条齐全', () => {
  assert.ok(CG.PACKS.summon && CG.PACKS.summon.name === '召唤包');
  ['skeleton', 'swarm', 'totem', 'command', 'guardian'].forEach(id => { assert.ok(CG.PACKS.summon.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['toll', 'culling', 'discord'].forEach(id => { assert.ok(CG.PACKS.summon.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
});

test('唤骷髅：召出 6血/4攻 随从，回合末攻击敌人', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', ['skeleton'])];
  b.playCard(b.hand[0].uid);
  assert.equal(b.allies.length, 1);
  assert.equal(b.allies[0].hp, 6); assert.equal(b.allies[0].atk, 4);
  const hp = b.enemies[0].hp;                 // 已含打击的 6 点
  b.endTurn();
  assert.equal(b.enemies[0].hp, hp - 4);      // 回合末召唤物 +4 伤害
});

test('群召召 3 个小灵；图腾每回合给格挡', () => {
  let b = CG.makeBattle();
  b.hand = [gemCard('strike', [{ id: 'swarm', level: 2 }])]; b.playCard(b.hand[0].uid);
  assert.equal(b.allies.length, 3); assert.equal(b.allies[0].atk, 4);   // 2×等级
  b = CG.makeBattle();
  b.hand = [gemCard('strike', ['totem'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.allies[0].giveBlock, 3); assert.equal(b.allies[0].atk, 0);
  b.player.block = 0; b.endTurn();
  assert.equal(b.player.block, 3);            // 图腾回合末给 3 格挡
});

test('守护灵嘲讽：敌人伤害重定向到它，玩家不受伤', () => {
  const b = CG.makeBattle();
  b.allies = [{ name: '守护灵', icon: '🛡️', hp: 20, maxHp: 20, atk: 0, taunt: true, giveBlock: 0 }];
  b.enemies[0].intent = { name: '测试一击', effects: [{ type: 'damage', value: 7 }] };
  b.phase = 'enemy';
  const php = b.player.hp;
  b.runEnemyTurn();
  assert.equal(b.player.hp, php);             // 玩家未受伤
  assert.equal(b.allies[0].hp, 13);           // 守护灵 20-7
});

test('召唤物死亡即移除；督战 +攻并立即攻击', () => {
  let b = CG.makeBattle();
  b.allies = [{ name: '守护灵', icon: '🛡️', hp: 5, maxHp: 5, atk: 0, taunt: true, giveBlock: 0 }];
  b.enemies[0].intent = { name: '重击', effects: [{ type: 'damage', value: 9 }] };
  b.phase = 'enemy'; b.runEnemyTurn();
  assert.equal(b.allies.length, 0);           // 血尽消失

  b = CG.makeBattle();
  b.allies = [{ name: '骷髅', icon: '💀', hp: 6, maxHp: 6, atk: 4, taunt: false, giveBlock: 0 }];
  const hp = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['command'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.allies[0].atk, 5);           // +1 攻
  assert.equal(b.enemies[0].hp, hp - 11);     // 打击 6 + 立即攻击 5
});

test('负面：索命自伤 / 折损消灭召唤物 / 内讧扣血', () => {
  let b = CG.makeBattle(); b.player.hp = 30;
  b.hand = [gemCard('strike', ['toll'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.player.hp, 27);              // 自伤 3
  b = CG.makeBattle();
  b.allies = [{ hp: 5, maxHp: 5, atk: 1, name: 'a', icon: 'x' }, { hp: 5, maxHp: 5, atk: 1, name: 'b', icon: 'y' }];
  b.hand = [gemCard('strike', ['culling'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.allies.length, 1);           // 折损消灭 1 个
  b = CG.makeBattle();
  b.allies = [{ hp: 5, maxHp: 5, atk: 1, name: 'a', icon: 'x' }, { hp: 1, maxHp: 1, atk: 1, name: 'b', icon: 'y' }];
  b.hand = [gemCard('strike', ['discord'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.allies.length, 1); assert.equal(b.allies[0].hp, 3);   // 各 -2，b 死亡移除
});

test('召唤物跨回合存活、愚者重开清空', () => {
  const b = CG.makeBattle();
  b.allies = [{ name: '骷髅', icon: '💀', hp: 6, maxHp: 6, atk: 4, taunt: false, giveBlock: 0 }];
  b.endTurn(); b.runEnemyTurn();
  assert.equal(b.allies.length, 1);           // 跨回合还在
  b.restart();
  assert.equal(b.allies.length, 0);           // 重开清空
});

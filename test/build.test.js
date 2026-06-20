'use strict';
/* 建造包（build）：在槽位摆「建筑」game.buildings，每回合开始触发；工坊增幅、拆解一次兑现。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const gemCard = (base, affixes, limit) => CG.makeCard(base, limit || affixes.length, [CG.makeGem(affixes.map(a => (typeof a === 'string' ? { id: a, level: 1 } : a)))]);

test('建造包存在且词条齐全', () => {
  assert.ok(CG.PACKS.build && CG.PACKS.build.name === '建造包');
  ['arrowtower', 'rampart', 'furnace', 'workshop', 'demolish'].forEach(id => { assert.ok(CG.PACKS.build.buffs.includes(id)); assert.ok(CG.AFFIXES[id]); });
  ['hazard', 'collapse', 'subside'].forEach(id => { assert.ok(CG.PACKS.build.debuffs.includes(id)); assert.ok(CG.AFFIXES[id].debuff); });
});

test('箭塔/路障/熔炉：回合开始触发', () => {
  let b = CG.makeBattle(); b.buildings = [{ kind: 'arrowtower', name: '箭塔', icon: '🏹', power: 4 }]; b.enemies[0].block = 0;
  const hp = b.enemies[0].hp; b._buildingsTick(); assert.equal(b.enemies[0].hp, hp - 4);
  b = CG.makeBattle(); b.buildings = [{ kind: 'rampart', name: '路障', icon: '🧱', power: 4 }]; b.player.block = 0;
  b._buildingsTick(); assert.equal(b.player.block, 4);
  b = CG.makeBattle(); b.buildings = [{ kind: 'furnace', name: '熔炉', icon: '🔥', power: 2 }];
  b._buildingsTick(); assert.equal(b.player.statuses.strength, 2);
});

test('工坊增幅其它建筑每次触发', () => {
  const b = CG.makeBattle();
  b.buildings = [{ kind: 'arrowtower', name: '箭塔', icon: '🏹', power: 4 }, { kind: 'workshop', name: '工坊', icon: '🏭', power: 2 }];
  b.enemies[0].block = 0; const hp = b.enemies[0].hp;
  b._buildingsTick(); assert.equal(b.enemies[0].hp, hp - 6);   // 箭塔 4 + 工坊 2
});

test('打出即建造；路障回合开始给格挡（整链）', () => {
  const b = CG.makeBattle();
  b.hand = [gemCard('strike', ['rampart'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.buildings.length, 1); assert.equal(b.buildings[0].kind, 'rampart');
  b.endTurn(); b.runEnemyTurn();                              // 下个回合开始
  assert.equal(b.player.block, 4);                            // 回合初清零后路障补 4
});

test('拆解：拆掉最早一座建筑、立即结算 3×等级 次', () => {
  const b = CG.makeBattle();
  b.buildings = [{ kind: 'arrowtower', name: '箭塔', icon: '🏹', power: 4 }]; b.enemies[0].block = 0;
  const hp = b.enemies[0].hp;
  b.hand = [gemCard('strike', ['demolish'])]; b.playCard(b.hand[0].uid);
  assert.equal(b.buildings.length, 0);
  assert.equal(b.enemies[0].hp, hp - 18);                     // 打击 6 + 箭塔 4×3
});

test('负面：工伤自伤 / 坍塌摧毁 / 沉降减效', () => {
  let b = CG.makeBattle(); b.player.hp = 30;
  b.hand = [gemCard('strike', ['hazard'])]; b.playCard(b.hand[0].uid); assert.equal(b.player.hp, 27);
  b = CG.makeBattle(); b.buildings = [{ kind: 'rampart', power: 4, name: 'a', icon: 'x' }, { kind: 'rampart', power: 4, name: 'b', icon: 'y' }];
  b.hand = [gemCard('strike', ['collapse'])]; b.playCard(b.hand[0].uid); assert.equal(b.buildings.length, 1);
  b = CG.makeBattle(); b.buildings = [{ kind: 'rampart', power: 4, name: 'a', icon: 'x' }];
  b.hand = [gemCard('strike', ['subside'])]; b.playCard(b.hand[0].uid); assert.equal(b.buildings[0].power, 3);
});

test('建筑跨回合存活、愚者重开清空', () => {
  const b = CG.makeBattle();
  b.buildings = [{ kind: 'rampart', power: 4, name: 'a', icon: 'x' }];
  b.endTurn(); b.runEnemyTurn(); assert.equal(b.buildings.length, 1);
  b.restart(); assert.equal(b.buildings.length, 0);
});

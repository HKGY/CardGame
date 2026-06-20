'use strict';
/* 主题融合：开局选定的主题融合成「一个」融合包，本局所有扩充包都从这个并集池混合产出。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

test('buildFusionPack：增益/减益池 = 选定主题之并集', () => {
  CG.setActivePacks(['exhaust', 'elec', 'summon']);
  const f = CG.fusionPack();
  assert.ok(f && f.fusion && f.id === 'fusion');
  ['exhaust', 'elec', 'summon'].forEach(id => {
    CG.PACKS[id].buffs.forEach(b => assert.ok(f.buffs.includes(b), b + ' 应在融合增益池'));
    CG.PACKS[id].debuffs.forEach(d => assert.ok(f.debuffs.includes(d), d + ' 应在融合减益池'));
  });
  assert.equal(f.themes.length, 3);
  CG.setActivePacks(null);
  assert.equal(CG.fusionPack(), null, 'null → 清除融合包');
});

test('pickPack：本局恒返回融合包；不污染 PACK_IDS', () => {
  CG.setActivePacks(['cook', 'miner']);
  assert.equal(CG.pickPack('boss'), 'fusion');
  assert.ok(!CG.PACK_IDS.includes('fusion'), 'fusion 不应混进可选主题列表');
  CG.setActivePacks(null);
});

test('rollGem：不传 pack 时从融合并集抽，词条跨主题混合', () => {
  CG.setActivePacks(['exhaust', 'elec', 'summon']);
  const pool = new Set(['exhaust', 'elec', 'summon'].flatMap(id => CG.PACKS[id].buffs.concat(CG.PACKS[id].debuffs)));
  const themes = new Set();
  for (let i = 0; i < 300; i++) {
    const g = CG.rollGem({ tier: 'elite', big: true });
    g.affixes.forEach(a => { assert.ok(pool.has(a.id), a.id + ' 应在融合池内'); });
    const th = CG.gemTheme(g); if (th) themes.add(th.name);
  }
  assert.ok(themes.size >= 2, '多次抽取应混合到多个主题，实得：' + [...themes].join(','));
  CG.setActivePacks(null);
});

test('gemTheme：按首个增益归主题', () => {
  assert.equal(CG.gemTheme(CG.makeGem([{ id: 'ashes', level: 1 }])).name, '消耗包');
  assert.equal(CG.gemTheme(CG.makeGem([{ id: 'generate', level: 1 }])).name, '电力包');
});

test('rollRunPacks：默认 = 基础 + 3 随机主题（不含 fusion）', () => {
  const rp = CG.rollRunPacks();
  assert.equal(rp.length, 4);
  assert.ok(rp.includes('basic'));
  assert.ok(!rp.includes('fusion'));
});

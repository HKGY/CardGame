'use strict';
/* Booster pack（词条分类）+ 新词条（回响/壁垒/连击）的纯逻辑：包结构、覆盖、rollGem 限定在包池、cardStats 聚合。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const CG = require('./harness');

const eff = (s, type) => s.effects.find(e => e.type === type);
const affIds = gem => gem.affixes.map(a => a.id);
const inPack = (pack, id) => pack.buffs.includes(id) || pack.debuffs.includes(id);

test('PACKS 结构：buffs 全是增益、debuffs 全是减益，字段齐全', () => {
  assert.ok(CG.PACK_IDS.length >= 5);
  assert.ok(CG.PACKS.basic, '应有「基础包」');
  for (const id of CG.PACK_IDS) {
    const p = CG.PACKS[id];
    assert.ok(p.name && p.icon && p.color, `${id} 缺少展示字段`);
    assert.ok(p.buffs.length >= 4, `${id} 增益太少`);
    assert.ok(p.debuffs.length >= 2, `${id} 减益太少（首领可能抽 2 个减益）`);
    p.buffs.forEach(a => { assert.ok(CG.AFFIXES[a], `${id} 含未知词条 ${a}`); assert.equal(CG.isDebuff(a), false, `${id}.buffs 含减益 ${a}`); });
    p.debuffs.forEach(a => { assert.ok(CG.AFFIXES[a], `${id} 含未知词条 ${a}`); assert.equal(CG.isDebuff(a), true, `${id}.debuffs 含增益 ${a}`); });
  }
});

test('包覆盖：每个增益、每个减益都至少属于一个包', () => {
  const allB = new Set(), allD = new Set();
  CG.PACK_IDS.forEach(id => { CG.PACKS[id].buffs.forEach(a => allB.add(a)); CG.PACKS[id].debuffs.forEach(a => allD.add(a)); });
  CG.BUFF_ORDER.forEach(a => assert.ok(allB.has(a), `增益 ${a} 不在任何包内`));
  CG.DEBUFF_ORDER.forEach(a => assert.ok(allD.has(a), `减益 ${a} 不在任何包内`));
});

test('新词条已登记为增益：回响 / 壁垒 / 连击', () => {
  ['echo', 'bulwark', 'combo'].forEach(id => {
    assert.ok(CG.AFFIXES[id], `${id} 未定义`);
    assert.equal(CG.isDebuff(id), false);
    assert.ok(CG.BUFF_ORDER.includes(id), `${id} 不在 BUFF_ORDER`);
  });
});

test('rollGem(pack)：抽到的词条只来自该包池（大/小宝石都成立）', () => {
  for (const pid of CG.PACK_IDS) {
    const pack = CG.PACKS[pid];
    for (let i = 0; i < 60; i++) {
      const small = CG.rollGem({ pack: pid, big: false, tier: 'monster' });
      affIds(small).forEach(id => assert.ok(inPack(pack, id), `${pid} 小宝石漏出 ${id}`));
      const big = CG.rollGem({ pack: pid, big: true, tier: 'boss' });   // boss：可能双增益+双减益
      affIds(big).forEach(id => assert.ok(inPack(pack, id), `${pid} 大宝石漏出 ${id}`));
    }
  }
});

test('rollGem 不传 pack：自动选一个包，结构合法且词条都属于同一个包', () => {
  for (let i = 0; i < 80; i++) {
    const g = CG.rollGem({ tier: 'elite' });
    const ids = affIds(g);
    ids.forEach(id => assert.ok(CG.AFFIXES[id], `未知词条 ${id}`));
    const host = CG.PACK_IDS.find(pid => ids.every(id => inPack(CG.PACKS[pid], id)));
    assert.ok(host, '一颗宝石的词条应能整体归入某一个包：' + ids.join(','));
  }
});

test('pickPack：各档位都返回合法包 id；缺 tier 也能选', () => {
  ['monster', 'elite', 'boss'].forEach(t => {
    for (let i = 0; i < 30; i++) assert.ok(CG.PACKS[CG.pickPack(t)], `tier=${t} 选出非法包`);
  });
  assert.ok(CG.PACKS[CG.pickPack()], '无 tier 也应选出合法包');
});

test('回响：cardStats.freeNext == 等级', () => {
  assert.equal(CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'echo', level: 1 }])])).freeNext, 1);
  assert.equal(CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'echo', level: 3 }])])).freeNext, 3);
});

test('壁垒：任意基底都附加 4×等级 点格挡', () => {
  // 攻击牌：基底不带格挡 → 仅壁垒的格挡
  const onStrike = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'bulwark', level: 2 }])]));
  assert.equal(eff(onStrike, 'block').value, 8);     // 4×2
  assert.equal(onStrike.value, 6);                    // 伤害不受影响
  // 防御牌：基底 5 格挡 + 壁垒 4 → 首个效果(基底)5、再附加一个 block 4
  const onDefend = CG.cardStats(CG.makeCard('defend', 1, [CG.makeGem([{ id: 'bulwark', level: 1 }])]));
  const blocks = onDefend.effects.filter(e => e.type === 'block');
  assert.equal(blocks.reduce((s, e) => s + e.value, 0), 9);   // 5 + 4
});

test('连击：cardStats.combo == 等级（实际加成在打出时按已出牌数结算）', () => {
  assert.equal(CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'combo', level: 2 }])])).combo, 2);
});

test('recutGem 重铸后词条仍能整体归入某一个包，且增益/减益数量不变', () => {
  for (let i = 0; i < 40; i++) {
    const gem = CG.makeGem([{ id: 'overload', level: 3 }, { id: 'cumbersome', level: 1 }]);
    CG.recutGem(gem);
    const ids = affIds(gem);
    assert.equal(gem.affixes.filter(a => !CG.isDebuff(a.id)).length, 1);
    assert.equal(gem.affixes.filter(a => CG.isDebuff(a.id)).length, 1);
    const host = CG.PACK_IDS.find(pid => ids.every(id => inPack(CG.PACKS[pid], id)));
    assert.ok(host, '重铸结果应整体属于某个包：' + ids.join(','));
  }
});

test('元素：4 个附着词条、ELEMENTS 展示齐全、都收进元素包', () => {
  assert.equal(CG.ELEMENT_IDS.length, 4);
  CG.ELEMENT_IDS.forEach(id => { const e = CG.ELEMENTS[id]; assert.ok(e && e.name && e.icon && e.color, id + ' 展示字段缺失'); });
  const appliers = { flame: 'fire', aqua: 'water', volt: 'thunder', frost: 'ice' };
  Object.entries(appliers).forEach(([aff, el]) => {
    assert.ok(CG.AFFIXES[aff], aff + ' 未定义');
    assert.equal(CG.AFFIXES[aff].element, el);
    assert.equal(CG.isDebuff(aff), false);
    assert.ok(CG.PACKS.elements.buffs.includes(aff), aff + ' 应在元素包');
  });
  const s = CG.cardStats(CG.makeCard('strike', 1, [CG.makeGem([{ id: 'flame', level: 3 }])]));
  assert.equal(s.element, 'fire');
  assert.equal(s.elementLevel, 3);          // 附着层数 = 词条等级
});

test('词条分组（调试菜单）：每个词条恰好归入一个合法组、组有展示信息、划分覆盖全部词条', () => {
  const groups = CG.AFFIX_GROUP_ORDER;
  assert.ok(Array.isArray(groups) && groups.length >= 2, '应有分组顺序');
  CG.AFFIX_ORDER.forEach(id => {
    const g = CG.affixGroupOf(id);
    assert.ok(groups.includes(g), `${id} 归到非法组 ${g}`);
    const meta = CG.affixGroupMeta(g);
    assert.ok(meta && meta.name && meta.icon && meta.color, `${g} 缺展示信息`);
  });
  // 主题词条归到对应主题组
  assert.equal(CG.affixGroupOf('flame'), 'elements');
  assert.equal(CG.affixGroupOf('ashes'), 'exhaust');
  assert.equal(CG.affixGroupOf('farm'), 'cook');
  assert.equal(CG.affixGroupOf('multi'), 'power');
  // 分组是 AFFIX_ORDER 的一个划分：每个词条出现且仅出现在自己的组里，合计覆盖全部
  let total = 0;
  groups.forEach(g => { total += CG.AFFIX_ORDER.filter(id => CG.affixGroupOf(id) === g).length; });
  assert.equal(total, CG.AFFIX_ORDER.length, '分组应不重不漏地覆盖所有词条');
});

test('元素反应矩阵：4 元素两两都反应、对称、同元素不反应', () => {
  const ids = CG.ELEMENT_IDS;
  for (let i = 0; i < ids.length; i++) {
    assert.equal(CG.reactionFor(ids[i], ids[i]), null, '同元素不应反应');
    for (let j = i + 1; j < ids.length; j++) {
      const r1 = CG.reactionFor(ids[i], ids[j]), r2 = CG.reactionFor(ids[j], ids[i]);
      assert.ok(r1 && r1.name, `${ids[i]}×${ids[j]} 应有反应`);
      assert.equal(r1, r2, '反应应与顺序无关（对称）');
      assert.ok(r1.type === 'amplify' ? r1.amplify > 1 : typeof r1.apply === 'function', '反应需 amplify 或 apply');
    }
  }
});

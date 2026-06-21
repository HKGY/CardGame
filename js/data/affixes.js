window.CG = window.CG || {};

/* ===========================================================================
 *  词条 v3 —— 原子（代价种类 / 价值种类）+ 随机分子（词条）
 * ===========================================================================
 *  原子才是基本单位：
 *    · 代价原子（COST）：能量/生命/金币/弃牌（真资源）+ 条件原子（当前格挡/空手/深度…）。
 *    · 价值原子（VALUE）：伤害/格挡/治疗/抽牌/力量/易伤/元素/召唤/建筑/产出…
 *  每个原子默认「1 能量等值」：amount = round(6 / VP)（见 CG.VALUES）。
 *  一条「词条」= 随机填入的 (代价原子, 价值原子) 分子；几乎任意代价 × 任意价值都可组合。
 *    · 真资源代价 + 价值：价值取固定 amount；代价按 amount 扣（首石免代价、×L）。
 *    · 条件代价 + 数值价值：价值改为「条件当前量 × L」（动态）；条件本身不扣真资源。
 *  → 二者皆 6VP↔6VP 自动破坏衡（价值 ≤ 代价）。百科只列「所有代价种类 / 所有价值种类」。
 *  词条无名：卡面/百科只显示「代价」「价值」。引擎机制字段（dmg/apply/summon/condBonus…）
 *  由生成器按原子填好，cardStats/playCard 复用。
 * ========================================================================= */
(function (CG) {
  // —— 资源价值表（VP）；基准 1 能量 = 6 VP = 6 伤害 —— //
  const V = {
    // 价值原子（排序铁律：治疗 > 格挡 > 伤害；虚弱 > 易伤/脆弱）
    damage: 1.0, block: 1.2, heal: 1.5, draw: 2.5, energy: 6.0, power: 1.0,
    strength: 4.0, tempStr: 1.5,
    vulnerable: 1.5, weak: 2.0, frail: 1.5, poison: 1.5,
    fire: 2.0, water: 2.0, thunder: 2.0, ice: 2.0,
    food: 2.0, summon: 3.0, building: 5.0, produce: 5.0, conjure: 4.0,
    // 代价原子（可玩数字：生命 2VP→3血、金币 1VP→6金）
    hp: 2.0, gold: 1.0, discard: 3.0, maxhp: 1.0,
    // 条件/机会类代价记机会预算（不扣真资源）
    mult: 6.0, execute: 6.0, lifesteal: 6.0,
  };
  CG.VALUES = V;
  const amt = res => Math.max(1, Math.round(6 / (V[res] || 6)));   // 某资源「1 能量等值」的数量

  const COLOR = {
    damage: '#e89030', block: '#7fa8c8', heal: '#e89ab8', draw: '#efe9da', energy: '#f0c850', power: '#f0d850',
    strength: '#e0563a', tempStr: '#c8a0d8', vulnerable: '#e05550', weak: '#3fae62', frail: '#4a86e0', poison: '#8ab84a',
    fire: '#ff7a4a', water: '#4aa8ff', thunder: '#e8c84a', ice: '#8fe0ec',
    food: '#e0a45a', summon: '#b0b0e0', building: '#c0a060', produce: '#b6d36a', conjure: '#b59ad8',
    execute: '#b04050', mult: '#ff9fc0', lifesteal: '#cf4f6a',
  };

  /* —— 价值原子：mech(u)=按数量 u 产出引擎机制字段；numeric=可被条件代价动态缩放 —— */
  const VALUE_ATOMS = {
    damage: { name: '伤害', vpRes: 'damage', numeric: true, mech: u => ({ dmg: u }) },
    block:  { name: '格挡', vpRes: 'block', numeric: true, mech: u => ({ blk: u }) },
    heal:   { name: '治疗', vpRes: 'heal', numeric: true, mech: u => ({ heal: u }) },
    draw:   { name: '抽牌', vpRes: 'draw', mech: u => ({ draw: u }) },
    energy: { name: '能量', vpRes: 'energy', mech: u => ({ energy: u }) },
    power:  { name: '电力', vpRes: 'power', mech: u => ({ gainPower: u }) },
    strength: { name: '力量', vpRes: 'strength', mech: u => ({ addStr: u }) },
    tempStr:  { name: '临时力量', vpRes: 'tempStr', mech: u => ({ prepare: u }) },
    vulnerable: { name: '易伤', vpRes: 'vulnerable', mech: u => ({ apply: { vulnerable: u } }) },
    weak:   { name: '虚弱', vpRes: 'weak', mech: u => ({ apply: { weak: u } }) },
    frail:  { name: '脆弱', vpRes: 'frail', mech: u => ({ apply: { frail: u } }) },
    poison: { name: '中毒', vpRes: 'poison', mech: u => ({ apply: { poison: u } }) },
    fire:   { name: '附火', vpRes: 'fire', mech: u => ({ element: 'fire', elementBase: u }) },
    water:  { name: '附水', vpRes: 'water', mech: u => ({ element: 'water', elementBase: u }) },
    thunder:{ name: '附雷', vpRes: 'thunder', mech: u => ({ element: 'thunder', elementBase: u }) },
    ice:    { name: '附冰', vpRes: 'ice', mech: u => ({ element: 'ice', elementBase: u }) },
    food_veg:    { name: '素菜', vpRes: 'food', mech: () => ({ give: 'veg' }) },
    food_meat:   { name: '荤菜', vpRes: 'food', mech: () => ({ give: 'meat' }) },
    food_season: { name: '调料', vpRes: 'food', mech: () => ({ give: 'season' }) },
    food_ware:   { name: '厨具', vpRes: 'food', mech: () => ({ give: 'cookware' }) },
    summon:   { name: '召唤物', vpRes: 'summon', mech: () => ({ summon: 'skeleton' }) },
    building: { name: '建筑', vpRes: 'building', mech: () => ({ build: 'arrowtower' }) },
    produce_draw:  { name: '每回合抽牌', vpRes: 'produce', mech: () => ({ selfStatus: 'prodDraw', flat: 1 }) },
    produce_block: { name: '每回合格挡', vpRes: 'produce', mech: () => ({ selfStatus: 'prodBlock', flat: 1 }) },
    conjure:  { name: '造牌', vpRes: 'conjure', mech: () => ({ conjure: 1 }) },
  };
  // 价值原子的元素色：附元素用元素色，食材/产出用各自色
  const valColor = id => COLOR[(VALUE_ATOMS[id].vpRes)] || COLOR[id] || '#cdd2e2';

  /* —— 代价原子 —— */
  const COST_REAL = {            // 真资源：按 amount 扣、首石免、×L
    energy:  { name: '能量', fmt: n => `+${n} 费` },
    hp:      { name: '生命', fmt: n => `失 ${n} 血` },
    gold:    { name: '金币', fmt: n => `失 ${n} 金` },
    discard: { name: '弃牌', fmt: n => `弃 ${n} 张` },
  };
  // 条件原子：cond=true（不扣真资源）；qty=战斗中取「当前量」的键（playCard 求值）。
  const COST_COND = {
    curBlock:    { name: '当前格挡', qty: 'curBlock' },
    curPower:    { name: '当前电力', qty: 'curPower' },
    depth:       { name: '深度', qty: 'depth' },
    heat:        { name: '热度', qty: 'heat' },
    enemyDebuff: { name: '敌方减益', qty: 'enemyDebuff' },
    exhaustPile: { name: '消耗堆', qty: 'exhaustPile' },
    heldTurns:   { name: '在手回合', qty: 'heldTurns' },
    handSize:    { name: '手牌数', qty: 'handSize' },
    emptyHand:   { name: '空手程度', qty: 'emptyHand' },
    curGold:     { name: '当前金币', qty: 'curGold' },
    // —— 时点型条件（借鉴 StS 遗物：首回合/受伤/无格挡＝门(gate，达成则给 1 能量等值)；回合数/击杀数＝量(随之增长) ——
    firstTurn:   { name: '首回合', qty: 'firstTurn', gate: true },
    hurt:        { name: '本场已受伤', qty: 'hurt', gate: true },
    noBlock:     { name: '无格挡', qty: 'noBlock', gate: true },
    turnNum:     { name: '回合数', qty: 'turnNum' },
    kills:       { name: '本场击杀数', qty: 'kills' },
  };
  CG.COST_REAL = COST_REAL; CG.COST_COND = COST_COND; CG.VALUE_ATOMS = VALUE_ATOMS;
  CG.isCondCost = res => !!COST_COND[res];

  // —— 生成所有词条分子：真资源代价 × 全部价值；条件代价 × 数值价值（动态）；+ 少量特殊签名 —— //
  const A = {};
  const numericVals = Object.keys(VALUE_ATOMS).filter(v => VALUE_ATOMS[v].numeric);
  function mk(costId, valId, extra) {
    const va = VALUE_ATOMS[valId];
    const cond = !!COST_COND[costId];
    const u = amt(va.vpRes);
    const def = Object.assign({
      cost: cond ? { res: costId, cond: true } : { res: costId, amt: amt(costId === 'energy' ? 'energy' : (COST_REAL[costId] ? ({ energy: 'energy', hp: 'hp', gold: 'gold', discard: 'discard' }[costId]) : 'energy')) },
      value: { res: va.vpRes, sub: valId, atom: valId, amt: cond ? null : u },
      color: valColor(valId), score: 4,
    }, extra || {});
    if (cond) { def.condBonus = { qty: COST_COND[costId].qty, vtype: valId };   // 条件：动态缩放数值价值
      if (COST_COND[costId].gate) { def.condBonus.gate = true; def.condBonus.base = u; } }   // 门(gate)：达成则给 1 能量等值
    else Object.assign(def, va.mech(u));                                       // 真资源：固定产出机制
    A[costId + '_' + valId] = def;
    return def;
  }
  Object.keys(COST_REAL).forEach(cid => Object.keys(VALUE_ATOMS).forEach(vid => mk(cid, vid)));
  Object.keys(COST_COND).forEach(cid => numericVals.forEach(vid => mk(cid, vid)));
  // 特殊签名（条件 → 非数值价值）：
  A.lowHp_execute   = { cost: { res: 'lowHp', cond: true }, value: { res: 'execute', atom: 'execute' }, color: COLOR.execute, score: 5, execute: 1 };
  A.energyZero_mult = { cost: { res: 'energyZero', cond: true }, value: { res: 'mult', atom: 'mult' }, color: COLOR.mult, score: 4, allin: 1 };
  A.play_mult       = { cost: { res: 'play', cond: true }, value: { res: 'mult', atom: 'mult' }, color: COLOR.mult, score: 5, potent: 1 };
  A.hit_lifesteal   = { cost: { res: 'hit', cond: true }, value: { res: 'lifesteal', atom: 'lifesteal' }, color: COLOR.lifesteal, score: 4, lifesteal: 0.3 };

  CG.AFFIXES = A;
  CG.AFFIX_ORDER = Object.keys(A);
  CG.BUFF_ORDER = CG.AFFIX_ORDER.slice();
  CG.DEBUFF_ORDER = [];
  CG.isDebuff = () => false;

  // —— 便捷起手词条 id（buildDeck/测试用）—— //
  CG.STRIKE = 'energy_damage'; CG.GUARD = 'energy_block'; CG.HEAL = 'energy_heal';

  // —— 展示：代价 / 价值 两栏文字 —— //
  const condName = res => (COST_COND[res] || {}).name || ({ play: '打出', energyZero: '能量归零', lowHp: '敌残血', hit: '造成伤害' }[res]) || res;
  CG.affixCostText = function (id, level) {
    const a = A[id]; if (!a) return '';
    const c = a.cost;
    if (c.cond) return condName(c.res);
    return (COST_REAL[c.res] ? COST_REAL[c.res].fmt : n => `${c.res} ${n}`)((c.amt || 1) * (level || 1));
  };
  CG.affixValueText = function (id, level) {
    const a = A[id]; if (!a) return '';
    const v = a.value, L = level || 1;
    const nm = (VALUE_ATOMS[v.atom] || {}).name || ({ execute: '斩杀', mult: '翻倍', lifesteal: '吸血' }[v.atom]) || v.res;
    if (v.atom === 'mult') return `数值 ×${1 + L}`;
    if (v.atom === 'lifesteal') return `吸血 ${Math.round(0.3 * 100 * L)}%`;
    if (v.atom === 'execute') return `斩杀（敌残血）`;
    if (a.condBonus && a.condBonus.gate) return `${nm} ${(a.condBonus.base || 6) * L}（${condName(a.cost.res)}时）`;   // 门：达成则给定额
    if (v.amt == null) return `${nm}＝${condName(a.cost.res)}×${L}`;   // 量：随条件当前量
    return `${nm} ${v.amt * L}`;
  };
  CG.affixDisplayName = (id, level) => CG.affixValueText(id, level);

  /* === 元素 & 元素反应（保留）=== */
  CG.ELEMENT_IDS = ['fire', 'water', 'thunder', 'ice'];
  CG.ELEMENTS = {
    fire:    { name: '火', icon: '🔥', color: '#ff7a4a' },
    water:   { name: '水', icon: '💧', color: '#4aa8ff' },
    thunder: { name: '雷', icon: '⚡', color: '#e8c84a' },
    ice:     { name: '冰', icon: '❄️', color: '#8fe0ec' },
  };
  const RX = {
    'fire+water':    { name: '蒸发', icon: '💨', type: 'amplify', amplify: 2.0, desc: '本次攻击伤害 ×2' },
    'fire+ice':      { name: '融化', icon: '🫠', type: 'amplify', amplify: 2.0, desc: '本次攻击伤害 ×2' },
    'fire+thunder':  { name: '超载', icon: '💥', type: 'effect', desc: '立即造成 20 点穿透伤害（无视格挡）', apply: (g, s, t) => g._reactionBurst(t, 20) },
    'thunder+water': { name: '感电', icon: '⚡', type: 'effect', desc: '给敌人附加 5 层中毒', apply: (g, s, t) => g.applyStatus(t, 'poison', 5) },
    'ice+water':     { name: '冻结', icon: '🧊', type: 'effect', desc: '冰冻：跳过其下一次行动', apply: (g, s, t) => g.applyStatus(t, 'frozen', 1) },
    'ice+thunder':   { name: '超导', icon: '🔻', type: 'effect', desc: '给敌人施加 4 层易伤', apply: (g, s, t) => g.applyStatus(t, 'vulnerable', 4) },
  };
  CG.REACTIONS = RX;
  CG.reactionFor = (a, b) => RX[[a, b].sort().join('+')] || null;

  /* =========================================================================
   *  卡牌包 —— 主题＝一组「价值原子」（代价随机自由组合）。融合时取价值原子并集。
   * ========================================================================= */
  const P = (name, icon, color, desc, values) => ({ name, icon, color, desc, values });
  CG.PACKS = {
    basic:    P('基础包', '🎴', '#cdd2e2', '伤害 / 格挡（空法术两条基本式）。', ['damage', 'block']),
    power:    P('强攻包', '⚔️', '#e89030', '伤害与穿击。', ['damage']),
    weaken:   P('弱化包', '☠️', '#8ab84a', '敌方减益。', ['vulnerable', 'weak', 'frail', 'poison']),
    tempo:    P('节奏包', '🌀', '#4fb8ee', '抽牌 / 能量。', ['draw', 'energy']),
    vitality: P('生机包', '🌿', '#7fd6a0', '治疗 / 力量。', ['heal', 'strength']),
    elements: P('元素包', '⚗️', '#cf6fd0', '附火/水/雷/冰，叠加触发反应。', ['fire', 'water', 'thunder', 'ice']),
    cook:     P('厨艺包', '🍳', '#e0a45a', '食材（合成餐点）。', ['food_veg', 'food_meat', 'food_season', 'food_ware']),
    bastion:  P('死守包', '🛡️', '#7fa8c8', '格挡 / 临时力量。', ['block', 'tempStr']),
    elec:     P('电力包', '⚡', '#f0d040', '电力。', ['power']),
    produce:  P('生产包', '🌾', '#b6d36a', '每回合产出。', ['produce_draw', 'produce_block']),
    summon:   P('召唤包', '👻', '#b0b0e0', '召唤物。', ['summon']),
    build:    P('建造包', '🏗️', '#c0a060', '建筑。', ['building']),
    conjure:  P('术士包', '🎩', '#b59ad8', '造牌。', ['conjure']),
    amplify:  P('放大包', '✦', '#ff9fc0', '力量 / 临时力量。', ['strength', 'tempStr']),
  };
  // 兼容旧字段：把每个包展开成它的「真资源代价 × 主题价值」组合 id 列表（rollGem/fusion 读取）。
  Object.keys(CG.PACKS).forEach(k => {
    const p = CG.PACKS[k];
    p.affixes = []; Object.keys(COST_REAL).forEach(cid => p.values.forEach(vid => { if (A[cid + '_' + vid]) p.affixes.push(cid + '_' + vid); }));
    p.buffs = p.affixes.slice(); p.debuffs = [];
  });
  CG.PACK_IDS = Object.keys(CG.PACKS);

  /* === 词条分组（调试菜单/百科）=== */
  CG.AFFIX_GROUP_ORDER = CG.PACK_IDS.concat(['misc']);
  CG.affixGroupOf = function (id) {
    for (const pid of CG.PACK_IDS) { if (CG.PACKS[pid].affixes.includes(id)) return pid; }
    return 'misc';
  };
  CG.affixGroupMeta = function (key) {
    if (key === 'misc') return { name: '通用', icon: '🎴', color: '#cdd2e2' };
    const p = CG.PACKS[key];
    return p ? { name: p.name, icon: p.icon, color: p.color } : { name: key, icon: '•', color: '#cdd2e2' };
  };
})(window.CG);

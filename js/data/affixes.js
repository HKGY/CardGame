window.CG = window.CG || {};

/* ===========================================================================
 *  词条 v2 —— 统一「代价-价值」资源置换模型（见 DESIGN-resource-exchange.md 附录 B）
 * ===========================================================================
 *  每条词条 = 一笔交易：付出「代价(cost)」→ 获得「价值(value)」。不再有名字，
 *  卡面/百科只显示「代价」「价值」两栏。标准引擎机制字段（apply/shieldBash/summon…）
 *  仍挂在 def 上供 game.js/effects.js 复用——玩家看不到，只是实现管线。
 *
 *  规则：
 *   1) 等级 L(1/2/3)：value.amt ×L；cost.amt ×L 仅当代价是「真资源」。
 *      代价是「条件/机会」(cost.cond=true：当前格挡/空手/敌方减益/深度…) 时代价不随等级、只价值 ×L。
 *   2) 首石免代价：一张牌第一颗宝石无视其代价（卡牌占手本身就是代价）。在 cardStats 里按 socket 下标处理。
 *   3) 价值 ≤ 代价（VP 软目标，见 affix-vp.js）。基准 1 级 = 1 能量交易（≈6VP）。
 *
 *  代价 res：energy/hp/gold/discard/exhaust（真资源，×L）｜ 其余皆 cond（不随等级）：
 *     play(打出即可) curBlock curPower depth heat enemyDebuff lowHp emptyHand
 *     exhaustPile heldTurns self(每次打出本牌) energyZero hit(造成伤害)
 *  价值 res：damage block heal draw energy power strength tempStr
 *     vulnerable weak frail poison frozen element food summon building produce
 *     depth heat conjure execute mult lifesteal
 * ========================================================================= */
(function (CG) {
  // 资源展示元信息（代价/价值两栏文字）
  const RES = {
    energy:   { name: '能量', sign: '费' },
    hp:       { name: '生命' },
    gold:     { name: '金币' },
    discard:  { name: '弃牌' },
    exhaust:  { name: '消耗手牌' },
    play:     { name: '打出' },
    curBlock: { name: '当前格挡' },
    curPower: { name: '当前电力' },
    depth:    { name: '深度' },
    heat:     { name: '热度' },
    enemyDebuff: { name: '敌方减益' },
    lowHp:    { name: '敌残血' },
    emptyHand:{ name: '空手' },
    exhaustPile: { name: '消耗堆' },
    heldTurns:{ name: '在手回合' },
    self:     { name: '每次打出' },
    energyZero:{ name: '能量归零' },
    hit:      { name: '造成伤害' },
    damage:   { name: '伤害' },
    block:    { name: '格挡' },
    heal:     { name: '治疗' },
    draw:     { name: '抽牌' },
    power:    { name: '电力' },
    strength: { name: '力量' },
    tempStr:  { name: '临时力量' },
    vulnerable:{ name: '易伤' },
    weak:     { name: '虚弱' },
    frail:    { name: '脆弱' },
    poison:   { name: '中毒' },
    frozen:   { name: '冰冻' },
    element:  { name: '元素' },
    food:     { name: '食材' },
    summon:   { name: '召唤物' },
    building: { name: '建筑' },
    produce:  { name: '每回合产出' },
    conjure:  { name: '造牌' },
    execute:  { name: '斩杀' },
    mult:     { name: '翻倍' },
    lifesteal:{ name: '吸血' },
  };
  CG.RES = RES;

  // 代价是否「条件/机会」（不随等级、不扣真资源）
  const COND = new Set(['play', 'curBlock', 'curPower', 'depth', 'heat', 'enemyDebuff', 'lowHp', 'emptyHand', 'exhaustPile', 'heldTurns', 'self', 'energyZero', 'hit']);
  CG.isCondCost = res => COND.has(res);

  // 词条表：id → { cost:{res,amt}, value:{res,amt,sub}, color, score, ...mech }
  //  amt 省略＝1。mech 字段是引擎管线复用（见 cardStats / effects.js）。
  const C = (res, amt) => ({ res, amt: amt == null ? 1 : amt, cond: COND.has(res) });
  const A = {
    // —— 通用：空法术内置首石就是这两条 ——
    strike: { cost: C('energy', 1), value: { res: 'damage', amt: 6 }, color: '#e89030', score: 4, dmg: 6 },
    guard:  { cost: C('energy', 1), value: { res: 'block',  amt: 5 }, color: '#7fa8c8', score: 4, blk: 5 },

    // —— 弱化：打出→敌减益 ——
    w_vuln:   { cost: C('play'), value: { res: 'vulnerable', amt: 2 }, color: '#e05550', score: 3, apply: { vulnerable: 2 } },
    w_weak:   { cost: C('play'), value: { res: 'weak',  amt: 2 }, color: '#3fae62', score: 3, apply: { weak: 2 } },
    w_poison: { cost: C('play'), value: { res: 'poison', amt: 3 }, color: '#8ab84a', score: 4, apply: { poison: 3 } },

    // —— 节奏：能量↔牌权 ——
    t_draw:    { cost: C('energy', 1), value: { res: 'draw',   amt: 1 }, color: '#efe9da', score: 4, draw: 1 },
    t_recycle: { cost: C('discard', 1), value: { res: 'energy', amt: 1 }, color: '#bcd17a', score: 4, energy: 1, clutch: 1 },

    // —— 生机：攻→守 ——
    v_heal:  { cost: C('energy', 1), value: { res: 'heal', amt: 5 }, color: '#e89ab8', score: 3, heal: 5 },
    v_leech: { cost: C('hit'), value: { res: 'lifesteal', amt: 0.3 }, color: '#cf4f6a', score: 4, lifesteal: 0.3 },

    // —— 元素：打出→附元素（叠加触发反应）——
    e_fire:    { cost: C('play'), value: { res: 'element', sub: 'fire',    amt: 2 }, color: '#ff7a4a', score: 4, element: 'fire',    elementBase: 2 },
    e_water:   { cost: C('play'), value: { res: 'element', sub: 'water',   amt: 2 }, color: '#4aa8ff', score: 4, element: 'water',   elementBase: 2 },
    e_thunder: { cost: C('play'), value: { res: 'element', sub: 'thunder', amt: 2 }, color: '#e8c84a', score: 4, element: 'thunder', elementBase: 2 },
    e_ice:     { cost: C('play'), value: { res: 'element', sub: 'ice',     amt: 2 }, color: '#8fe0ec', score: 4, element: 'ice',     elementBase: 2 },

    // —— 厨艺：打出→食材（合成链不变）——
    k_veg:    { cost: C('play'), value: { res: 'food', sub: 'veg' },      color: '#8fbf5a', score: 3, give: 'veg' },
    k_meat:   { cost: C('play'), value: { res: 'food', sub: 'meat' },     color: '#d08a5a', score: 3, give: 'meat' },
    k_season: { cost: C('play'), value: { res: 'food', sub: 'season' },   color: '#c8b04a', score: 3, give: 'season' },
    k_ware:   { cost: C('play'), value: { res: 'food', sub: 'cookware' }, color: '#c87a8a', score: 3, give: 'cookware' },

    // —— 消耗：消耗堆(条件)→伤害 ——
    x_ashes: { cost: C('exhaustPile'), value: { res: 'damage' }, color: '#9aa0a8', score: 4, ashes: 1 },

    // —— 电力：能量→电力(存)；当前电力(条件)→伤害 ——
    p_gen: { cost: C('energy', 1), value: { res: 'power', amt: 5 }, color: '#f0d850', score: 3, gainPower: 5 },
    p_arc: { cost: C('curPower'),  value: { res: 'damage' },        color: '#f0e060', score: 4, arc: 1 },

    // —— 死守：能量→格挡；当前格挡(条件)→伤害 ——
    b_block: { cost: C('energy', 1), value: { res: 'block', amt: 6 }, color: '#9ab0c8', score: 4, blk: 6 },
    b_bash:  { cost: C('curBlock'),  value: { res: 'damage' },        color: '#c8a060', score: 4, shieldBash: 1 },

    // —— 生产：能量→每回合产出 ——
    g_draw:  { cost: C('energy', 1), value: { res: 'produce', sub: 'draw' },  color: '#9ad05a', score: 4, selfStatus: 'prodDraw',  flat: 1 },
    g_block: { cost: C('energy', 1), value: { res: 'produce', sub: 'block' }, color: '#b6d36a', score: 4, selfStatus: 'prodBlock', flat: 1 },

    // —— 留置：在手回合(条件)→伤害 ——
    r_held: { cost: C('heldTurns'), value: { res: 'damage' }, color: '#c8a0d8', score: 4, heldStrike: 1, retain: true },

    // —— 强化：每次打出(条件)→永久成长 ——
    n_temper: { cost: C('self'), value: { res: 'damage' }, color: '#e0b0e0', score: 5, temper: 1 },

    // —— 虚无：生命→伤害；空手(条件)→伤害 ——
    o_devote: { cost: C('hp', 2), value: { res: 'damage', amt: 6 }, color: '#b05a7a', score: 4, dmg: 6 },   // hp 代价由 cardStats 代价环结算
    o_empty:  { cost: C('emptyHand'), value: { res: 'damage' },      color: '#8a90b0', score: 4, emptyMind: 1 },

    // —— 奇巧：打出(风险)→随机伤害 ——
    d_dice: { cost: C('play'), value: { res: 'damage', sub: 'random' }, color: '#c8a0e0', score: 4, dice: 1 },

    // —— 市场：金币→伤害 ——
    m_invest: { cost: C('gold', 2), value: { res: 'damage' }, color: '#e8c84a', score: 4, invest: 1 },

    // —— 矿工：能量→深度；深度(条件)→伤害 ——
    i_dig:      { cost: C('energy', 1), value: { res: 'depth', amt: 2 }, color: '#b08a5a', score: 4, mine: 1 },
    i_prospect: { cost: C('depth'),     value: { res: 'damage' },        color: '#d0a060', score: 4, prospect: 1 },

    // —— 锻造：能量→热度；热度(条件,清空)→伤害 ——
    f_blow:  { cost: C('energy', 1), value: { res: 'heat', amt: 2 }, color: '#e08038', score: 3, bellows: 1 },
    f_smelt: { cost: C('heat'),      value: { res: 'damage' },        color: '#f06030', score: 5, smelt: 1 },

    // —— 召唤：能量→召唤物 ——
    s_skel: { cost: C('energy', 1), value: { res: 'summon', sub: 'skeleton' }, color: '#c8c8d0', score: 4, summon: 'skeleton' },

    // —— 建造：能量→建筑 ——
    c_tower: { cost: C('energy', 1), value: { res: 'building', sub: 'arrowtower' }, color: '#c0a060', score: 4, build: 'arrowtower' },

    // —— 弃牌：弃1张→伤害 ——
    y_toss: { cost: C('discard', 1), value: { res: 'damage', amt: 6 }, color: '#a89878', score: 4, dmg: 6 },   // 弃牌代价由 cardStats 代价环结算

    // —— 术士：能量→造牌 ——
    j_conjure: { cost: C('energy', 1), value: { res: 'conjure' }, color: '#b59ad8', score: 3, conjure: 1 },

    // —— 猎杀：敌方减益/残血(条件)→爆发 ——
    h_prey:    { cost: C('enemyDebuff'), value: { res: 'damage' },  color: '#c06050', score: 4, prey: 1 },
    h_execute: { cost: C('lowHp'),       value: { res: 'execute' }, color: '#b04050', score: 5, execute: 1 },

    // —— 律动：能量归零(条件)→翻倍 ——
    l_allin: { cost: C('energyZero'), value: { res: 'mult' }, color: '#e0a070', score: 4, allin: 1 },

    // —— 放大：打出(一次性)→翻倍 ——
    a_potent: { cost: C('play'), value: { res: 'mult' }, color: '#ff9fc0', score: 5, potent: 1 },
  };

  CG.AFFIXES = A;
  CG.AFFIX_ORDER = Object.keys(A);
  CG.BUFF_ORDER = CG.AFFIX_ORDER.slice();   // 无独立减益：代价侧即下行风险
  CG.DEBUFF_ORDER = [];
  CG.isDebuff = () => false;

  // —— 展示：代价 / 价值 两栏文字 —— //
  CG.affixCostText = function (id, level) {
    const a = A[id]; if (!a) return '';
    const c = a.cost, m = RES[c.res] || { name: c.res };
    if (c.cond) return m.name;                                  // 条件：只写名字
    const amt = (c.amt || 1) * (level || 1);
    if (c.res === 'energy') return `+${amt} 费`;
    if (c.res === 'discard') return `弃 ${amt} 张`;
    return `${m.name} ${amt}`;
  };
  CG.affixValueText = function (id, level) {
    const a = A[id]; if (!a) return '';
    const v = a.value, m = RES[v.res] || { name: v.res }, L = level || 1;
    const sub = v.sub ? '·' + v.sub : '';
    if (v.res === 'mult') return `数值 ×${1 + L}`;
    if (v.res === 'lifesteal') return `吸血 ${Math.round(v.amt * 100 * L)}%`;
    if (v.res === 'execute' || v.res === 'conjure' || v.res === 'food' || v.res === 'produce' || v.res === 'summon' || v.res === 'building')
      return m.name + sub;
    if (v.amt == null) return m.name + sub + `×${L}`;            // 条件类：随条件量 ×L
    return `${m.name} ${v.amt * L}${sub}`;
  };
  // 旧接口兼容（render/gemName 调用）：显示价值文字
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
   *  卡牌包 —— 缩水后每包＝其签名兑换（保留独特项，即使只剩一个）。
   *  融合时各包词条并集去重（见 cards.js buildFusionPack）。
   * ========================================================================= */
  CG.PACKS = {
    basic:    { name: '基础包', icon: '🎴', color: '#cdd2e2', desc: '能量→伤害 / 能量→格挡（空法术的两条基本式）。', affixes: ['strike', 'guard'] },
    power:    { name: '强攻包', icon: '⚔️', color: '#e89030', desc: '能量→伤害。', affixes: ['strike'] },
    weaken:   { name: '弱化包', icon: '☠️', color: '#8ab84a', desc: '打出→敌方减益。', affixes: ['w_vuln', 'w_weak', 'w_poison'] },
    tempo:    { name: '节奏包', icon: '🌀', color: '#4fb8ee', desc: '能量↔牌权。', affixes: ['t_draw', 't_recycle'] },
    vitality: { name: '生机包', icon: '🌿', color: '#7fd6a0', desc: '攻→治疗/续航。', affixes: ['v_heal', 'v_leech'] },
    elements: { name: '元素包', icon: '⚗️', color: '#cf6fd0', desc: '打出→附元素，叠加触发反应。', affixes: ['e_fire', 'e_water', 'e_thunder', 'e_ice'] },
    cook:     { name: '厨艺包', icon: '🍳', color: '#e0a45a', desc: '打出→食材，合成餐点。', affixes: ['k_veg', 'k_meat', 'k_season', 'k_ware'] },
    exhaust:  { name: '消耗包', icon: '🔥', color: '#d2603a', desc: '消耗堆(条件)→伤害。', affixes: ['x_ashes'] },
    elec:     { name: '电力包', icon: '⚡', color: '#f0d040', desc: '能量→电力(存)，当前电力→伤害。', affixes: ['p_gen', 'p_arc'] },
    bastion:  { name: '死守包', icon: '🛡️', color: '#7fa8c8', desc: '能量→格挡，当前格挡→伤害。', affixes: ['b_block', 'b_bash'] },
    produce:  { name: '生产包', icon: '🌾', color: '#b6d36a', desc: '能量→每回合产出。', affixes: ['g_draw', 'g_block'] },
    retain:   { name: '留置包', icon: '🤲', color: '#b0c0d8', desc: '在手回合(条件)→伤害。', affixes: ['r_held'] },
    enhance:  { name: '强化包', icon: '✨', color: '#e0b0e0', desc: '每次打出(条件)→永久成长。', affixes: ['n_temper'] },
    void:     { name: '虚无包', icon: '🕳️', color: '#6a6f8a', desc: '生命→伤害，空手→伤害。', affixes: ['o_devote', 'o_empty'] },
    gadget:   { name: '奇巧包', icon: '🎲', color: '#c8a0e0', desc: '打出(风险)→随机伤害。', affixes: ['d_dice'] },
    econ:     { name: '市场包', icon: '💰', color: '#e8c84a', desc: '金币→伤害。', affixes: ['m_invest'] },
    miner:    { name: '矿工包', icon: '⛏️', color: '#b08a5a', desc: '能量→深度，深度→伤害。', affixes: ['i_dig', 'i_prospect'] },
    forge:    { name: '锻造包', icon: '🔨', color: '#e86838', desc: '能量→热度，热度(清空)→伤害。', affixes: ['f_blow', 'f_smelt'] },
    summon:   { name: '召唤包', icon: '👻', color: '#b0b0e0', desc: '能量→召唤物。', affixes: ['s_skel'] },
    build:    { name: '建造包', icon: '🏗️', color: '#c0a060', desc: '能量→建筑。', affixes: ['c_tower'] },
    discard:  { name: '弃牌包', icon: '♻️', color: '#a89878', desc: '弃牌→伤害。', affixes: ['y_toss'] },
    conjure:  { name: '术士包', icon: '🎩', color: '#b59ad8', desc: '能量→造牌。', affixes: ['j_conjure'] },
    hunter:   { name: '猎杀包', icon: '🗡️', color: '#c06050', desc: '敌方减益/残血(条件)→爆发。', affixes: ['h_prey', 'h_execute'] },
    flow:     { name: '律动包', icon: '💫', color: '#d0c090', desc: '能量归零(条件)→翻倍。', affixes: ['l_allin'] },
    amplify:  { name: '放大包', icon: '✦', color: '#ff9fc0', desc: '打出(一次性)→翻倍。', affixes: ['a_potent'] },
  };
  // 兼容旧字段：buffs/debuffs（cards.js rollGem 等读取）；新模型 debuffs 恒空。
  Object.keys(CG.PACKS).forEach(k => { const p = CG.PACKS[k]; p.buffs = p.affixes.slice(); p.debuffs = []; });
  CG.PACK_IDS = Object.keys(CG.PACKS);

  /* === 词条分组（调试菜单/百科）：每个词条归其首个所属主题包 === */
  CG.AFFIX_GROUP_ORDER = ['power', 'weaken', 'tempo', 'vitality', 'elements', 'cook', 'exhaust', 'elec', 'bastion', 'produce', 'retain', 'enhance', 'void', 'gadget', 'econ', 'miner', 'forge', 'summon', 'build', 'discard', 'conjure', 'hunter', 'flow', 'amplify', 'misc'];
  CG.affixGroupOf = function (id) {
    for (const pid of CG.AFFIX_GROUP_ORDER) {
      if (pid === 'misc') break;
      const p = CG.PACKS[pid];
      if (p && p.affixes.includes(id)) return pid;
    }
    return 'misc';
  };
  CG.affixGroupMeta = function (key) {
    if (key === 'misc') return { name: '通用', icon: '🎴', color: '#cdd2e2' };
    const p = CG.PACKS[key];
    return p ? { name: p.name, icon: p.icon, color: p.color } : { name: key, icon: '•', color: '#cdd2e2' };
  };
})(window.CG);

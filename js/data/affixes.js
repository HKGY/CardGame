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
  //  带「本回合/下回合/每回合」时点的价值见 TURN_BASES：其三档 VP（本回合=基准、下回合=×0.5、每回合=×2）
  //  由生成器写入本表（如 V.damage=1 / V.damage_every=2 / V.damage_next=0.5；V.strength=3=每回合、V.tempStr=1.5=本回合）。
  //  此处只列「无时点」价值原子 + 全部代价原子。
  const V = {
    heal: 1.5,                                        // 治疗（排序铁律：治疗 > 格挡 > 伤害）
    fire: 6.0, water: 6.0, thunder: 6.0, ice: 6.0,    // 元素：1 层 = 6VP
    // summon(1.5)/conjure(6)/thorns(2) 改为时点基值（VP 见 TURN_BASES）；building 已删
    mult: 12.0, lifesteal: 0.12, combo: 6.0, multi: 12.0,   // 翻倍/多重=12VP；吸血 0.12/%(≤100)；连击 6VP
    // —— 代价原子 ——（可玩数字：生命 2VP→3血、金币 1VP→6金）
    hp: 2.0, gold: 1.0, discard: 3.0, maxhp: 1.0,
    selfVuln: 2.0, selfWeak: 2.0, selfFrail: 2.0,     // 自身减益代价（2VP/层）
    loseStr: 3.0, loseDex: 3.0,                       // 扣自身力量/敏捷（可为负，真代价）
  };
  CG.VALUES = V;

  const COLOR = {
    damage: '#e89030', block: '#7fa8c8', heal: '#e89ab8', draw: '#efe9da', energy: '#f0c850', power: '#f0d850',
    strength: '#e0563a', tempStr: '#c8a0d8', dexterity: '#4a86e0', tempDex: '#7fb0d8', vulnerable: '#e05550', weak: '#3fae62', frail: '#4a86e0', poison: '#8ab84a',
    fire: '#ff7a4a', water: '#4aa8ff', thunder: '#e8c84a', ice: '#8fe0ec',
    enemyLoseStr: '#3fae62', enemyLoseStrTemp: '#3fae62', enemyLoseDex: '#4a86e0', enemyLoseDexTemp: '#4a86e0',
    food: '#e0a45a', summon: '#b0b0e0', produce: '#b6d36a', conjure: '#b59ad8', thorns: '#5fae6a',
    mult: '#ff9fc0', lifesteal: '#cf4f6a', combo: '#e89030', multi: '#ff7fa0',
  };

  /* —— 价值原子 ——
   *  mech(u)=按数量 u 产出引擎机制字段；numeric=可被条件代价动态缩放（效果类型＝原子 id、值为可加量）。
   *  「无时点」原子在此手写；「本回合/下回合/每回合」时点原子由下方 TURN_BASES 生成器批量产出。
   */
  const VALUE_ATOMS = {
    heal:     { name: '治疗', vpRes: 'heal', numeric: true, color: COLOR.heal, mech: u => ({ heal: u }) },
    fire:     { name: '附火', vpRes: 'fire', maxCount: 2, color: COLOR.fire, mech: u => ({ element: 'fire', elementBase: u }) },
    water:    { name: '附水', vpRes: 'water', maxCount: 2, color: COLOR.water, mech: u => ({ element: 'water', elementBase: u }) },
    thunder:  { name: '附雷', vpRes: 'thunder', maxCount: 2, color: COLOR.thunder, mech: u => ({ element: 'thunder', elementBase: u }) },
    ice:      { name: '附冰', vpRes: 'ice', maxCount: 2, color: COLOR.ice, mech: u => ({ element: 'ice', elementBase: u }) },
    mult:     { name: '翻倍', vpRes: 'mult', maxCount: 2, color: COLOR.mult, mech: u => ({ potent: u }) },   // ×(1+L)：LV1 ×2、LV2/3 ×3
    lifesteal:{ name: '吸血', vpRes: 'lifesteal', maxCount: 100, color: COLOR.lifesteal, mech: u => ({ lifesteal: u }) },   // 以 1% 计：LV1 50%、LV2/3 100%
    combo:    { name: '连击', vpRes: 'combo', color: COLOR.combo, mech: u => ({ multiHit: u }) },
    multi:    { name: '多重', vpRes: 'multi', maxCount: 1, color: COLOR.multi, mech: u => ({ multi: u }) },   // 消耗全部能量、整张牌重复（次数=能量）；手牌耗能显示 X
  };

  /* —— 通用「本回合(now)/下回合(next)/每回合(every)」时点修饰器 ——
   *  每个基值 → 3 个独立命名的价值原子；VP：本回合=基准、下回合=×0.5、每回合=×2。
   *  · 即时型(sched)：本回合=立即结算；每回合=回合开始重复结算(game._everyTurn)；下回合=下个回合开始一次(game._nextTurn)。
   *  · 持续型(stat：力量/敏捷/敌失力量/敌失敏捷)：每回合=永久(一次性施加、持续生效)；本回合=本回合临时；下回合=下回合临时。
   *  numeric 标在「主版本」上（即时型主=本回合、持续型主=每回合），即条件代价能缩放的那一档。
   */
  const TURN_MUL = { now: 1.0, next: 0.5, every: 2.0 };
  const TURN_PREFIX = { now: '本回合', next: '下回合', every: '每回合' };   // 命名＝原值名 + 时点前缀（如 每回合格挡 / 本回合力量 / 下回合敏捷）
  const sched = (vp, eff, nowMech, ids, bname, opt) => Object.assign({ vp, kind: 'sched', eff, nowMech, ids, bname }, opt || {});
  const statB = (vp, nowMech, everyMech, nextEff, ids, bname, color) => ({ vp, kind: 'stat', nowMech, everyMech, nextEff, ids, bname, prim: 'every', color });
  const TURN_BASES = {
    damage:     sched(1.0, v => ({ type: 'damage', value: v, hits: 1 }), v => ({ dmg: v }), { now: 'damage', next: 'damage_next', every: 'damage_every' }, '伤害', { num: true, prim: 'now', color: COLOR.damage, minion: true }),
    block:      sched(1.2, v => ({ type: 'block', value: v }), v => ({ blk: v }), { now: 'block', next: 'block_next', every: 'produce_block' }, '格挡', { num: true, prim: 'now', color: COLOR.block, minion: true }),
    draw:       sched(2.5, v => ({ type: 'draw', value: v }), v => ({ draw: v }), { now: 'draw', next: 'draw_next', every: 'produce_draw' }, '抽牌', { num: true, prim: 'now', color: COLOR.draw }),
    energy:     sched(6.0, v => ({ type: 'energy', value: v }), v => ({ energy: v }), { now: 'energy', next: 'energy_next', every: 'produce_energy' }, '能量', { num: true, prim: 'now', color: COLOR.energy }),
    power:      sched(1.0, v => ({ type: 'gainPower', value: v }), v => ({ gainPower: v }), { now: 'power', next: 'power_next', every: 'power_every' }, '电力', { color: COLOR.power }),
    vulnerable: sched(1.5, v => ({ type: 'vulnerable', value: v }), v => ({ apply: { vulnerable: v } }), { now: 'vulnerable', next: 'vulnerable_next', every: 'vulnerable_every' }, '易伤', { num: true, prim: 'now', color: COLOR.vulnerable }),
    weak:       sched(1.5, v => ({ type: 'weak', value: v }), v => ({ apply: { weak: v } }), { now: 'weak', next: 'weak_next', every: 'weak_every' }, '虚弱', { num: true, prim: 'now', color: COLOR.weak }),
    frail:      sched(1.5, v => ({ type: 'frail', value: v }), v => ({ apply: { frail: v } }), { now: 'frail', next: 'frail_next', every: 'frail_every' }, '脆弱', { num: true, prim: 'now', color: COLOR.frail }),
    poison:     sched(1.5, v => ({ type: 'poison', value: v }), v => ({ apply: { poison: v } }), { now: 'poison', next: 'poison_next', every: 'poison_every' }, '中毒', { num: true, prim: 'now', color: COLOR.poison }),
    thorns:     sched(2.0, v => ({ type: 'thorns', value: v }), v => ({ thorns: v }), { now: 'thorns', next: 'thorns_next', every: 'thorns_every' }, '荆棘', { num: true, prim: 'now', color: COLOR.thorns, minion: true }),   // 受击反伤（自带反伤引擎）
    conjure:    sched(6.0, v => ({ type: 'conjure', value: v }), v => ({ conjure: v }), { now: 'conjure', next: 'conjure_next', every: 'conjure_every' }, '造牌', { num: true, prim: 'now', color: COLOR.conjure }),   // 造一张带随机 n 宝石的牌(本回合 0 费)
    summon:     sched(1.5, v => ({ type: 'summon', value: v }), v => ({ summon: v }), { now: 'summon', next: 'summon_next', every: 'summon_every' }, '召唤物', { num: true, prim: 'now', color: COLOR.summon }),   // 召唤/壮大单骷髅(血量上限 n)
    food_veg:   sched(2.0, v => ({ type: 'give', what: 'veg', value: v }), () => ({ give: 'veg' }), { now: 'food_veg', next: 'food_veg_next', every: 'food_veg_every' }, '素菜', { maxCount: 1, color: COLOR.food }),
    food_meat:  sched(2.0, v => ({ type: 'give', what: 'meat', value: v }), () => ({ give: 'meat' }), { now: 'food_meat', next: 'food_meat_next', every: 'food_meat_every' }, '荤菜', { maxCount: 1, color: COLOR.food }),
    food_season:sched(2.0, v => ({ type: 'give', what: 'season', value: v }), () => ({ give: 'season' }), { now: 'food_season', next: 'food_season_next', every: 'food_season_every' }, '调料', { maxCount: 1, color: COLOR.food }),
    strength:   statB(1.5, v => ({ prepare: v }), v => ({ addStr: v }), v => ({ type: 'tempStrength', value: v }), { now: 'tempStr', next: 'strength_next', every: 'strength' }, '力量', COLOR.strength),
    dexterity:  statB(1.5, v => ({ prepDex: v }), v => ({ addDex: v }), v => ({ type: 'tempDexterity', value: v }), { now: 'tempDex', next: 'dexterity_next', every: 'dexterity' }, '敏捷', COLOR.dexterity),
    enemyLoseStr: statB(1.5, v => ({ enemyStr: v, enemyTemp: true }), v => ({ enemyStr: v }), v => ({ type: 'enemyStat', key: 'strength', value: v, temp: true }), { now: 'enemyLoseStrTemp', next: 'enemyLoseStr_next', every: 'enemyLoseStr' }, '敌失力量', COLOR.enemyLoseStr),
    enemyLoseDex: statB(1.5, v => ({ enemyDex: v, enemyTemp: true }), v => ({ enemyDex: v }), v => ({ type: 'enemyStat', key: 'dexterity', value: v, temp: true }), { now: 'enemyLoseDexTemp', next: 'enemyLoseDex_next', every: 'enemyLoseDex' }, '敌失敏捷', COLOR.enemyLoseDex),
  };
  // 持续型(力量/敏捷)也可加召唤物修饰词：补一个标准 perm 效果 eff 供 minion 变体复用。
  TURN_BASES.strength.minion = true; TURN_BASES.strength.eff = v => ({ type: 'strength', value: v });
  TURN_BASES.dexterity.minion = true; TURN_BASES.dexterity.eff = v => ({ type: 'dexterity', value: v });
  // 生成 16 基值 ×3 时点 = 48 价值原子；带 minion 的基值另生成「召唤物X」变体（VP 减半→量×2、效果投给骷髅）。
  CG.TURN_BASES = TURN_BASES;
  Object.keys(TURN_BASES).forEach(base => {
    const b = TURN_BASES[base], prim = b.prim || 'now';   // 默认形态（即时型=本回合、持续型=每回合）：名字用裸值名、不带时点前缀
    ['now', 'next', 'every'].forEach(t => {
      const id = b.ids[t];
      V[id] = b.vp * TURN_MUL[t];
      const atom = { name: t === prim ? b.bname : TURN_PREFIX[t] + b.bname, vpRes: id, timing: t, turnBase: base, color: b.color || '#cdd2e2' };
      if (b.maxCount != null) atom.maxCount = b.maxCount;
      atom.numeric = true;   // 全部 48 个时点变体都可被条件代价缩放（量型）/承载（门型）
      if (b.kind === 'sched') atom.mech = t === 'now' ? b.nowMech : t === 'every' ? (v => ({ everyTurn: [b.eff(v)] })) : (v => ({ nextTurn: [b.eff(v)] }));
      else atom.mech = t === 'now' ? b.nowMech : t === 'every' ? b.everyMech : (v => ({ nextTurn: [b.nextEff(v)] }));
      VALUE_ATOMS[id] = atom;
      // 召唤物修饰变体：效果改投骷髅（minion:true）、VP 减半 → 同能量下量翻倍。
      //   即时型(sched)：全 3 时点（now 立即 / every·next 调度）；持续型(stat)：只默认档、永久即时投给骷髅。
      if (b.minion && (b.kind === 'sched' || t === prim)) {
        const mid = id + '_m';
        V[mid] = b.vp * TURN_MUL[t] / 2;
        const mEff = v => Object.assign({}, b.eff(v), { minion: true });
        const mMech = (b.kind === 'stat' || t === 'now') ? (v => ({ minionNow: mEff(v) }))
                    : t === 'every' ? (v => ({ everyTurn: [mEff(v)] }))
                    : (v => ({ nextTurn: [mEff(v)] }));
        VALUE_ATOMS[mid] = { name: '召唤物' + atom.name, vpRes: mid, timing: t, turnBase: base, color: b.color || '#cdd2e2', minion: true, mech: mMech };
      }
    });
  });
  // 治疗（无时点）的召唤物变体：召唤物治疗（治骷髅、量×2）。
  V.heal_m = (V.heal || 1.5) / 2;
  VALUE_ATOMS.heal_m = { name: '召唤物治疗', vpRes: 'heal_m', color: COLOR.heal, minion: true, mech: v => ({ minionNow: { type: 'heal', value: v, minion: true } }) };
  const valColor = id => (VALUE_ATOMS[id] && VALUE_ATOMS[id].color) || COLOR[id] || '#cdd2e2';

  /* —— 代价原子 —— */
  const COST_REAL = {            // 真资源：按 amount 扣、首石免、×L
    energy:  { name: '能量', fmt: n => `+${n} 费` },
    hp:      { name: '生命', fmt: n => `失 ${n} 血`, time: true },
    gold:    { name: '金币', fmt: n => `失 ${n} 金`, time: true },
    discard: { name: '弃牌', fmt: n => `弃 ${n} 张` },
    selfVuln:  { name: '自易伤', fmt: n => `自易伤 ${n}`, status: 'vulnerable', time: true },
    selfWeak:  { name: '自虚弱', fmt: n => `自虚弱 ${n}`, status: 'weak', time: true },
    selfFrail: { name: '自脆弱', fmt: n => `自脆弱 ${n}`, status: 'frail', time: true },
    loseStr:   { name: '失力量', fmt: n => `失 ${n} 力量` },
    loseDex:   { name: '失敏捷', fmt: n => `失 ${n} 敏捷` },
  };
  // 条件原子：cond=true（不扣真资源）；qty=战斗中取「当前量」的键（playCard 求值）；vp=每单位条件量的 VP。
  //  量型：价值量 = floor(条件当前量 × 条件VP/价值VP × 等级)（与普通资源同一套「代价→价值」换算）。
  //  门型(gate)：达成则按「条件VP=6（1 能量）」给定额价值 floor(6/价值VP × 等级)、否则为 0。
  //  在战斗内可保留不消耗的资源(格挡/电力)按 0.5 倍计；金币是局外资源、单价更低。
  const COST_COND = {
    curBlock:    { name: '当前格挡', qty: 'curBlock', vp: 0.6 },   // 格挡 1.2 ×0.5（不消耗）
    curPower:    { name: '当前电力', qty: 'curPower', vp: 0.5 },   // 电力 1.0 ×0.5
    enemyDebuff: { name: '敌方减益', qty: 'enemyDebuff', vp: 1.0 },// 平均减益 2.0 ×0.5
    exhaustPile: { name: '消耗堆', qty: 'exhaustPile', vp: 1.0 },
    handSize:    { name: '手牌数', qty: 'handSize', vp: 1.0 },
    emptyHand:   { name: '空手程度', qty: 'emptyHand', vp: 1.0 },  // 量 = 10 − 手牌数
    curGold:     { name: '当前金币', qty: 'curGold', vp: 0.06 },   // 局外资源、单价低（不按 0.5）
    turnNum:     { name: '回合数', qty: 'turnNum', vp: 1.0 },
    myDebuff:    { name: '自身减益层数', qty: 'myDebuff', vp: 1.0 },// 越惨越强：回收自己背的减益
    // —— 门型条件(gate，达成给 1 能量等值=6VP)：借鉴 StS 遗物 ——
    firstPlay:   { name: '这张牌本场第一次打出', qty: 'firstPlay', gate: true, vp: 6.0, maxCount: 1 },
    hurt:        { name: '本场已受伤', qty: 'hurt', gate: true, vp: 6.0, maxCount: 1 },
    noBlock:     { name: '无格挡', qty: 'noBlock', gate: true, vp: 6.0, maxCount: 1 },
  };
  CG.COST_REAL = COST_REAL; CG.COST_COND = COST_COND; CG.VALUE_ATOMS = VALUE_ATOMS;
  CG.isCondCost = res => !!COST_COND[res];

  // —— 生成所有词条分子 ——（每个代价/价值原子都带「最大个数 maxCount」上限，默认 ∞）
  //   真资源代价 × 全部价值（mkReal）：逐级生成 LV1/LV2/LV3（沿用「价值 1,2,2；代价 1,2,1」高效档）：
  //     val1 = clamp(⌊6 /价值VP⌋, 1, 价值max)；    cost1 = ⌈val1·价值VP /代价VP⌉
  //     val2 = clamp(⌊12/价值VP⌋, val1+1, 价值max)；cost2 = ⌈val2·价值VP /代价VP⌉
  //     · cost1 > 代价max → 不生成；val2 ≤ val1（被 maxCount 卡死）→ 只 LV1；否则 cost2 ≤ 代价max 才出 LV2、LV3 恒出。
  //     机制按 LV1 量(val1)烘焙、cardStats 用 lvVal 复现高等级；每级真实代价存 def.costByLv。
  //   条件代价 × 可缩放价值(mkCond)：条件资源亦有 VP，按同一套换算 → 倍率 mult = 条件VP/价值VP；
  //     打出时价值量 = floor(条件当前量 × mult × 等级)（门型：达成则当前量记 1、否则 0）。
  const A = {};
  const maxOf = m => (m != null ? m : Infinity);
  // 把小数倍率 x 近似成整数分数 [Y, X]（Y/X ≤ x、分母有界）→ 量型条件显示/判定成「每有 X 点条件，获得 Y 点价值」。
  function toFrac(x) {
    if (!(x > 0)) return [1, 1];
    const maxDenom = Math.max(Math.ceil(2 / x) + 1, 10);   // 够大以容纳小 x（如 0.06 需分母 ~17）
    let minDiff = Infinity, fy = 1, fx = 1;
    for (let d = 1; d <= maxDenom; d++) {
      const n = Math.floor(x * d + 1e-9);                  // 取 ≤ x 的下近似（保证价值 ≤ 代价）
      if (n < 1) continue;
      const diff = x - n / d;
      if (diff < minDiff - 1e-9) { minDiff = diff; fy = n; fx = d; }   // 误差最小者；同误差取最小分母（升序首达）
    }
    return [fy, fx];
  }
  const numericVals = Object.keys(VALUE_ATOMS).filter(v => VALUE_ATOMS[v].numeric);
  function mkReal(costId, valId, costT) {
    costT = costT || 'now';
    const va = VALUE_ATOMS[valId];
    const valVP = V[va.vpRes] || 6, valMax = maxOf(va.maxCount);
    // 代价时点：每回合＝递归负担(代价VP×2→每回合量减半)、下回合＝延迟(×0.5→量加倍)。价值不变(当回合即得)。
    const costVP = (V[costId] || 6) * (costT === 'now' ? 1 : TURN_MUL[costT]), costMax = maxOf(COST_REAL[costId].maxCount);
    const valAt  = budget => Math.min(valMax, Math.max(1, Math.floor(budget / valVP + 1e-9)));
    const costAt = vAmt   => Math.max(1, Math.ceil(vAmt * valVP / costVP - 1e-9));
    const val1 = valAt(6), cost1 = costAt(val1);
    if (cost1 > costMax) return;                       // 连 LV1 都越上限 → 不生成
    const val2raw = Math.min(valMax, Math.max(val1 + 1, Math.floor(12 / valVP + 1e-9)));
    const hi = val2raw > val1, val2 = hi ? val2raw : val1, cost2 = costAt(val2);
    const levels = [1];
    if (hi) { if (cost2 <= costMax) levels.push(2); levels.push(3); }
    const u = val1, suf = costT === 'every' ? 'V' : costT === 'next' ? 'N' : '';
    const def = {
      cost: { res: costId, amt: cost1, timing: costT === 'now' ? undefined : costT }, costByLv: { 1: cost1, 2: cost2, 3: cost1 },
      value: { res: va.vpRes, sub: valId, atom: valId, amt: u },
      color: valColor(valId), score: 4, levels,
    };
    Object.assign(def, va.mech(u));   // 按 LV1 量烘焙机制（含 everyTurn/nextTurn 调度数组）
    A[costId + suf + '_' + valId] = def;
  }
  function mkCond(costId, valId) {
    const va = VALUE_ATOMS[valId], cc = COST_COND[costId], gate = !!cc.gate;
    const valVP = V[va.vpRes] || 6, valMax = maxOf(va.maxCount);
    // 该价值能否升档（同 mkReal 的 hasHi）：被 maxCount 卡成单一量(如食材)→ 条件型也只 LV1（去掉等级不变效果的冗余档）
    const v1 = Math.min(valMax, Math.max(1, Math.floor(6 / valVP + 1e-9)));
    const hasHi = Math.min(valMax, Math.max(v1 + 1, Math.floor(12 / valVP + 1e-9))) > v1;
    const mult = (cc.vp != null ? cc.vp : 6) / valVP;   // 每单位条件量换得的价值量
    const condBonus = { qty: cc.qty, atom: valId, mult, gate };
    if (!gate) { const fr = toFrac(mult); condBonus.fy = fr[0]; condBonus.fx = fr[1]; }   // 量型：整数「每有 fx 点条件 → fy 点价值」（门型走定额 floor(mult×等级)）
    A[costId + '_' + valId] = {
      cost: { res: costId, cond: true }, costByLv: null,
      value: { res: va.vpRes, sub: valId, atom: valId, amt: null },
      color: valColor(valId), score: 4,
      levels: !hasHi ? [1] : (gate ? [1, 3] : [1, 2, 3]),   // 尊重价值 maxCount：不能升档则只 LV1；否则 门型[1,3](LV2≡LV3 去一)、量型[1,2,3]
      condBonus,   // 打出时按 condBonus 算 amount，再喂给该价值原子的 mech 应用/调度
    };
  }
  const allVals = Object.keys(VALUE_ATOMS);
  Object.keys(COST_REAL).forEach(cid => allVals.forEach(vid => {
    mkReal(cid, vid);                                                       // 本回合（即时付）
    if (COST_REAL[cid].time) { mkReal(cid, vid, 'next'); mkReal(cid, vid, 'every'); }   // 时点代价：下回合付 / 每回合付（递归负担）
  }));
  // 量型条件 × 数值价值（48 时点变体 + 治疗）；门型条件(true/false) × 全部价值（达成则按 1 能量预算给该价值）
  Object.keys(COST_COND).forEach(cid => (COST_COND[cid].gate ? allVals : numericVals).forEach(vid => mkCond(cid, vid)));

  // 等级规则：1级 1换1、2级 2换2、3级 1换2（3 级是高效"稀有"档：价值×2、代价×1 → 汇率 2）。
  CG.lvVal  = L => Math.min(2, L || 1);     // 价值倍率：1,2,2
  CG.lvCost = L => ((L || 1) > 2 ? 1 : (L || 1));   // 代价倍率：1,2,1

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
    const n = a.costByLv ? (a.costByLv[level] != null ? a.costByLv[level] : a.costByLv[1]) : (c.amt || 1) * CG.lvCost(level);
    const prefix = c.timing === 'every' ? '每回合' : c.timing === 'next' ? '下回合' : '';   // 代价时点
    return prefix + (COST_REAL[c.res] ? COST_REAL[c.res].fmt : m => `${c.res} ${m}`)(n);
  };
  CG.affixValueText = function (id, level) {
    const a = A[id]; if (!a) return '';
    const v = a.value, vL = CG.lvVal(level);
    const nm = (VALUE_ATOMS[v.atom] || {}).name || ({ mult: '翻倍', lifesteal: '吸血' }[v.atom]) || v.res;
    if (a.condBonus) {                                  // 条件代价：倍率 = 条件VP/价值VP（先于 combo/mult/lifesteal 特例，因其作条件价值时 v.amt 为 null）
      const cb = a.condBonus;
      if (cb.gate) return `${nm} ${Math.floor((cb.mult || 1) * vL + 1e-9)}（${condName(a.cost.res)}时）`;   // 门：达成给定额
      return `每有 ${cb.fx} 点${condName(a.cost.res)}，获得 ${(cb.fy || 0) * vL} 点${nm}`;        // 量：整数「每 X 点 A → Y 点 B」
    }
    if (v.atom === 'combo') return '攻击命中 +' + vL + ' 次';
    if (v.atom === 'mult') return `数值 ×${1 + vL}`;
    if (v.atom === 'lifesteal') return '吸血 ' + (v.amt * vL) + '%';
    return `${nm} ${v.amt * vL}`;
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
    power:    P('强攻包', '⚔️', '#e89030', '伤害（本/下/每回合三档）/ 连击。', ['damage', 'damage_next', 'damage_every', 'combo']),
    weaken:   P('弱化包', '☠️', '#8ab84a', '敌方减益（易伤/虚弱/脆弱/中毒 + 敌失力量·敏捷；各带本/下/每回合）。', ['vulnerable', 'vulnerable_next', 'vulnerable_every', 'weak', 'weak_next', 'weak_every', 'frail', 'frail_next', 'frail_every', 'poison', 'poison_next', 'poison_every', 'enemyLoseStr', 'enemyLoseStrTemp', 'enemyLoseStr_next', 'enemyLoseDex', 'enemyLoseDexTemp', 'enemyLoseDex_next']),
    tempo:    P('节奏包', '🌀', '#4fb8ee', '抽牌 / 能量（本回合 / 下回合）。', ['draw', 'draw_next', 'energy', 'energy_next']),
    vitality: P('生机包', '🌿', '#7fd6a0', '治疗 / 力量 / 敏捷（力量·敏捷含下回合版）。', ['heal', 'strength', 'strength_next', 'dexterity', 'dexterity_next']),
    elements: P('元素包', '⚗️', '#cf6fd0', '附火/水/雷/冰，叠加触发反应。', ['fire', 'water', 'thunder', 'ice']),
    cook:     P('厨艺包', '🍳', '#e0a45a', '食材（本/下/每回合三档）。', ['food_veg', 'food_veg_next', 'food_veg_every', 'food_meat', 'food_meat_next', 'food_meat_every', 'food_season', 'food_season_next', 'food_season_every']),
    bastion:  P('死守包', '🛡️', '#7fa8c8', '格挡（本/下回合）/ 本回合力量·敏捷 / 荆棘（受击反伤）。', ['block', 'block_next', 'tempStr', 'tempDex', 'thorns', 'thorns_next', 'thorns_every']),
    elec:     P('电力包', '⚡', '#f0d040', '电力（本/下/每回合三档）。', ['power', 'power_next', 'power_every']),
    produce:  P('生产包', '🌾', '#b6d36a', '每回合产出（格挡 / 抽牌 / 能量）。', ['produce_draw', 'produce_block', 'produce_energy']),
    summon:   P('召唤包', '👻', '#b0b0e0', '召唤物 + 召唤物修饰词（攻/防/增益投给骷髅、量×2）。', ['summon', 'summon_next', 'summon_every',
      'damage_m', 'damage_next_m', 'damage_every_m', 'block_m', 'block_next_m', 'produce_block_m', 'thorns_m', 'thorns_next_m', 'thorns_every_m', 'strength_m', 'dexterity_m', 'heal_m']),
    conjure:  P('术士包', '🎩', '#b59ad8', '造牌（本/下/每回合）。', ['conjure', 'conjure_next', 'conjure_every']),
    amplify:  P('放大包', '✦', '#ff9fc0', '翻倍 / 吸血 / 多重（放大本牌）。', ['mult', 'lifesteal', 'multi']),
  };
  // 兼容旧字段：把每个包展开成「(真资源代价 ∪ 条件代价) × 主题价值」组合 id 列表（rollGem/fusion 读取）。
  //   条件代价词条按其「价值」归入对应主题（而非一股脑塞进基础包）→ 不选某主题就抽不到其价值（含其条件型）＝主题隔离。
  const COST_ALL = Object.keys(COST_REAL).concat(Object.keys(COST_COND));
  Object.keys(CG.PACKS).forEach(k => {
    const p = CG.PACKS[k];
    p.affixes = [];
    COST_ALL.forEach(cid => p.values.forEach(vid => {
      if (A[cid + '_' + vid]) p.affixes.push(cid + '_' + vid);
      if (COST_REAL[cid] && COST_REAL[cid].time) ['V', 'N'].forEach(suf => { if (A[cid + suf + '_' + vid]) p.affixes.push(cid + suf + '_' + vid); });   // 代价时点变体（每回合 V / 下回合 N）
    }));
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

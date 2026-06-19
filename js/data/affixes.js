window.CG = window.CG || {};

/* ===========================================================================
 *  词条 —— 分「增益(buff)」与「减益(debuff)」两类，各带分数(score)衡量强弱。
 * ===========================================================================
 *  buff 分数为正、debuff 分数为负；分数越大/越小越强、生成越稀有。
 *  词条被打包进「宝石」（见 cards.js）：宝石镶进卡牌孔位后，其词条对该卡生效。
 *  机制字段（每级 ×等级 L）：
 *    value/valuePct/hits/repeat/windfury/energy/draw/prepare
 *    apply{status:每级层数}  给敌人施加状态
 *    selfStatus / sapStr / sapDex / leak  自身减益
 *    silence 移除并削减敌人力量    exhaust 打出后销毁
 *  desc(level, base)  精简卡面文字；long(level, base) 百科详解（可选）。
 * ===========================================================================
 */
(function (CG) {
  const BUFFS = {
    suppress:   { name: '压制', color: '#e05550', score: 2, apply: { vulnerable: 1 }, desc: n => `易伤 ${n}` },
    neutralize: { name: '中和', color: '#3fae62', score: 2, apply: { weak: 1 },       desc: n => `虚弱 ${n}` },
    shatter:    { name: '破碎', color: '#4a86e0', score: 2, apply: { frail: 1 },      desc: n => `脆弱 ${n}` },
    prepare:    { name: '准备', color: '#3ad0d0', score: 3, prepare: 1, desc: (n, base) => base === 'defend' ? `敏捷 +${n}` : `力量 +${n}` },
    draw:       { name: '抽取', color: '#efe9da', score: 3, draw: 1,    desc: n => `抽 ${n} 张` },
    multi:      { name: '多重', color: '#e89030', score: 4, hits: 1,    desc: n => `+${n} 次攻击` },
    windfury:   { name: '风怒', color: '#b06fd6', score: 4, windfury: 1, desc: n => `回手 ${n} 次`, long: n => `打出后回到手牌（每回合最多 ${n} 次）` },
    overload:   { name: '过载', color: '#4fb8ee', score: 5, valuePct: 100, desc: n => `数值 +${100 * n}%` },
    repeat:     { name: '重复', color: '#ee82b8', score: 5, repeat: 1,  desc: n => `打出 ${1 + n} 次` },
    bright:     { name: '明亮', color: '#f0c850', score: 6, energy: 1,  desc: n => `+${n} 能量` },
    // —— 借鉴《炉石传说》《宝可梦》——
    lifesteal:  { name: '吸血', color: '#cf4f6a', score: 5, lifesteal: 0.5, damageOnly: true, desc: n => `吸血 ${50 * n}%`, long: n => `对敌人造成伤害的 ${50 * n}% 转化为治疗` },
    poison:     { name: '淬毒', color: '#8ab84a', score: 4, apply: { poison: 1 },  desc: n => `中毒 ${n}`, long: n => `给敌人 ${n} 层中毒（每回合受等量伤害，逐回合 -1）` },
    freeze:     { name: '冰封', color: '#6cc6e0', score: 3, apply: { frozen: 1 },  desc: () => `冰冻 1 回合`, long: () => `冰冻敌人跳过其下一次行动（每场战斗仅第一次打出生效）` },
    silence:    { name: '沉默', color: '#aab0c4', score: 4, silence: 1,            desc: n => `力量归零 -${n}`, long: n => `移除敌人当前力量，并使其力量 -${n}（永久）` },
    recover:    { name: '回春', color: '#e89ab8', score: 3, heal: 4,    desc: n => `回复 ${4 * n}` },
    thrift:     { name: '速记', color: '#bcd17a', score: 5, cost: -1,   desc: n => `耗能 -${n}` },
    pierce:     { name: '穿刺', color: '#e0a83a', score: 4, pierce: 1, damageOnly: true, desc: n => `穿刺 ${n}`, long: n => `攻击额外命中右侧相邻的 ${n} 个敌人` },
    regen:      { name: '再生', color: '#7fd6a0', score: 3, selfStatus: 'regen',  desc: n => `再生 ${n}`,  long: n => `每回合开始回复 ${n} 点生命（逐回合 -1）` },
    barbs:      { name: '荆棘', color: '#c98a5a', score: 3, selfStatus: 'thorns', desc: n => `荆棘 ${n}`,  long: n => `本场战斗中，受到攻击时反弹 ${n} 点伤害` },
    // —— 新增（booster pack 主题词条）——
    echo:       { name: '回响', color: '#58c8d8', score: 5, freeNext: 1, desc: n => `下一张免费 ×${n}`, long: n => `打出后，本回合接下来 ${n} 张牌耗能为 0（可连锁）` },
    bulwark:    { name: '壁垒', color: '#7fa8c8', score: 3, block: 4,     desc: n => `格挡 +${4 * n}`,   long: n => `打出时额外获得 ${4 * n} 点格挡（任意卡均生效）` },
    combo:      { name: '连击', color: '#e0563a', score: 4, combo: 1, damageOnly: true, desc: n => `连击 +${n}`, long: n => `本回合你每打出过一张牌，本牌伤害 +${n}（打出顺序越靠后越强）` },
    // —— 元素附着（元素包）：命中时给敌人附一种元素；与已有元素叠加触发反应 ——
    flame:      { name: '附火', color: '#ff7a4a', score: 4, element: 'fire',    desc: n => `附火 ${n} 层`, long: n => `命中给敌人附 ${n} 层🔥（至多 3）；与水/冰→蒸发/融化（本击每消耗 1 层 ×1.5），与雷→超载` },
    aqua:       { name: '附水', color: '#4aa8ff', score: 4, element: 'water',   desc: n => `附水 ${n} 层`, long: n => `命中给敌人附 ${n} 层💧（至多 3）；与火→蒸发，与雷→感电，与冰→冻结` },
    volt:       { name: '附雷', color: '#e8c84a', score: 4, element: 'thunder', desc: n => `附雷 ${n} 层`, long: n => `命中给敌人附 ${n} 层⚡（至多 3）；与火→超载，与水→感电，与冰→超导` },
    frost:      { name: '附冰', color: '#8fe0ec', score: 4, element: 'ice',     desc: n => `附冰 ${n} 层`, long: n => `命中给敌人附 ${n} 层❄️（至多 3）；与火→融化，与水→冻结，与雷→超导` },
  };

  const DEBUFFS = {
    blunt:  { name: '钝化', color: '#8a8f9e', score: -2, debuff: true, value: -2,       desc: n => `数值 -${2 * n}` },
    expose: { name: '破绽', color: '#b5616a', score: -2, debuff: true, selfStatus: 'vulnerable', desc: n => `自身易伤 ${n}` },
    feeble: { name: '乏力', color: '#6f9a78', score: -2, debuff: true, selfStatus: 'weak',       desc: n => `自身虚弱 ${n}` },
    decay:  { name: '朽盾', color: '#7a7f9a', score: -2, debuff: true, selfStatus: 'frail',      desc: n => `自身脆弱 ${n}` },
    coward: { name: '怯懦', color: '#a0763c', score: -3, debuff: true, sapStr: 1,      desc: n => `失去 ${n} 力量` },
    clumsy: { name: '笨拙', color: '#5f86a4', score: -3, debuff: true, sapDex: 1,      desc: n => `失去 ${n} 敏捷` },
    leak:   { name: '漏能', color: '#9a6ab0', score: -4, debuff: true, leak: 1,        desc: n => `能量 -${n}` },
    cumbersome: { name: '笨重', color: '#9a8a6a', score: -3, debuff: true, cost: 1,        desc: n => `耗能 +${n}` },
    recoil:     { name: '反噬', color: '#b5616a', score: -3, debuff: true, hpLoss: 2,      desc: n => `失去 ${2 * n} HP` },
    destroy:    { name: '销毁', color: '#c75450', score: -4, debuff: true, exhaust: 1,     desc: () => `打出后销毁`, long: () => `打出后本场战斗移除（进入消耗堆）` },
  };

  CG.AFFIXES = Object.assign({}, BUFFS, DEBUFFS);
  CG.BUFF_ORDER = Object.keys(BUFFS);
  CG.DEBUFF_ORDER = Object.keys(DEBUFFS);
  CG.AFFIX_ORDER = CG.BUFF_ORDER.concat(CG.DEBUFF_ORDER);

  CG.isDebuff = id => !!(CG.AFFIXES[id] && CG.AFFIXES[id].debuff);
  CG.affixDisplayName = (id, level) => (level === 2 ? '更' : level === 3 ? '最' : '') + CG.AFFIXES[id].name;

  /* =========================================================================
   *  元素 & 元素反应 —— 敌人身上最多挂 1 种元素，层数 1~3（一种状态，不随回合衰减）。
   *  附着层数 = 元素词条等级。再附一种元素时（game.js 的 playCard 结算）：
   *    异元素：消耗 min(已有层, 新附层) 级，反应「发生这么多次」，余量留在层数较多的一方；
   *    同元素：叠加（封顶 3）；当前 4 元素两两都反应，故异元素必触发反应、不会单纯替换。
   *    放大型(amplify)：本次攻击伤害 ×amplify^消耗层数（沿用力量塔罗/连击的伤害重建写法）。
   *    转化型(effect)：apply(game, source, target) 按消耗层数调用多次（复用中毒/冰冻/易伤/穿透爆发）。
   * ========================================================================= */
  CG.ELEMENT_IDS = ['fire', 'water', 'thunder', 'ice'];
  CG.ELEMENTS = {
    fire:    { name: '火', icon: '🔥', color: '#ff7a4a' },
    water:   { name: '水', icon: '💧', color: '#4aa8ff' },
    thunder: { name: '雷', icon: '⚡', color: '#e8c84a' },
    ice:     { name: '冰', icon: '❄️', color: '#8fe0ec' },
  };
  const RX = {
    'fire+water':    { name: '蒸发', icon: '💨', type: 'amplify', amplify: 1.5, desc: '本次攻击伤害 ×1.5' },
    'fire+ice':      { name: '融化', icon: '🫠', type: 'amplify', amplify: 1.5, desc: '本次攻击伤害 ×1.5' },
    'fire+thunder':  { name: '超载', icon: '💥', type: 'effect', desc: '立即造成 10 点穿透伤害（无视格挡）', apply: (g, s, t) => g._reactionBurst(t, 10) },
    'thunder+water': { name: '感电', icon: '⚡', type: 'effect', desc: '给敌人附加 3 层中毒', apply: (g, s, t) => g.applyStatus(t, 'poison', 3) },
    'ice+water':     { name: '冻结', icon: '🧊', type: 'effect', desc: '冰冻：跳过其下一次行动', apply: (g, s, t) => g.applyStatus(t, 'frozen', 1) },
    'ice+thunder':   { name: '超导', icon: '🔻', type: 'effect', desc: '给敌人施加 2 层易伤', apply: (g, s, t) => g.applyStatus(t, 'vulnerable', 2) },
  };
  CG.REACTIONS = RX;
  CG.reactionFor = (a, b) => RX[[a, b].sort().join('+')] || null;

  /* =========================================================================
   *  Booster Pack —— 把词条按玩法主题分包；战斗后开到的是「一个主题包」，
   *  包内宝石的词条只来自该包（buffs 为主题增益池，debuffs 为大宝石的减益池）。
   *  商店 / 祭坛 / 遗物 等其它产宝石处也按包生成（rollGem 不传 pack 时自动选包）。
   *  「基础包」做通用兜底，故与各主题包有意重叠；选包权重见 config.js 的 packW。
   *  增益全部被覆盖、每个减益也至少进一个包（见 packs.test.js 的覆盖断言）。
   * ========================================================================= */
  CG.PACKS = {
    basic:    { name: '基础包', icon: '🎴', color: '#cdd2e2', desc: '常见、通用，正负混合的入门包。',
                buffs: ['suppress', 'neutralize', 'shatter', 'prepare', 'draw', 'recover', 'regen'],
                debuffs: ['blunt', 'cumbersome', 'expose', 'feeble', 'decay', 'destroy'] },
    power:    { name: '强攻包', icon: '⚔️', color: '#e89030', desc: '提升伤害与打击次数。',
                buffs: ['multi', 'overload', 'repeat', 'pierce', 'prepare', 'combo'],
                debuffs: ['blunt', 'recoil', 'coward', 'cumbersome', 'destroy'] },
    curse:    { name: '诅咒包', icon: '☠️', color: '#8ab84a', desc: '削弱与控制敌人。',
                buffs: ['suppress', 'neutralize', 'shatter', 'poison', 'freeze', 'silence'],
                debuffs: ['expose', 'feeble', 'decay', 'clumsy'] },
    tempo:    { name: '节奏包', icon: '🌀', color: '#4fb8ee', desc: '抽牌 / 能量 / 费用。',
                buffs: ['draw', 'bright', 'thrift', 'windfury', 'echo'],
                debuffs: ['leak', 'cumbersome'] },
    vitality: { name: '生机包', icon: '🌿', color: '#7fd6a0', desc: '治疗 / 续航 / 反伤。',
                buffs: ['lifesteal', 'recover', 'regen', 'barbs', 'bulwark'],
                debuffs: ['recoil', 'expose', 'feeble'] },
    elements: { name: '元素包', icon: '⚗️', color: '#cf6fd0', desc: '附火/水/雷/冰，叠加触发蒸发/融化/超载/感电/冻结/超导（连招型，建议在商店「五选二」凑齐两种）。',
                buffs: ['flame', 'aqua', 'volt', 'frost'],
                debuffs: ['blunt', 'recoil', 'cumbersome'] },
  };
  CG.PACK_IDS = Object.keys(CG.PACKS);
})(window.CG);

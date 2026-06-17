window.CG = window.CG || {};

/* ===========================================================================
 *  词条 —— 分「增益(buff)」与「减益(debuff)」两类，各带分数(score)衡量强弱。
 * ===========================================================================
 *  buff 分数为正、debuff 分数为负；分数越大/越小越强、生成越稀有。
 *  每次锻造 = 一个随机等级的 buff + 一个 1 级的 debuff。
 *  机制字段（每级 ×等级 L）：
 *    value/valuePct/hits/repeat/windfury/energy/draw/forge/erode/prepare
 *    apply{status:每级层数}  给敌人施加状态
 *    selfStatus / sapStr / sapDex / leak  自身减益
 *  desc(level, base) 卡面文字（已按等级算好）。
 * ===========================================================================
 */
(function (CG) {
  const BUFFS = {
    suppress:   { name: '压制', color: '#e05550', score: 2, apply: { vulnerable: 1 }, desc: n => `附加 ${n} 层易伤` },
    neutralize: { name: '中和', color: '#3fae62', score: 2, apply: { weak: 1 },       desc: n => `附加 ${n} 层虚弱` },
    shatter:    { name: '破碎', color: '#4a86e0', score: 2, apply: { frail: 1 },      desc: n => `施加 ${n} 层脆弱` },
    prepare:    { name: '准备', color: '#3ad0d0', score: 3, prepare: 1, desc: (n, base) => base === 'defend' ? `获得 ${n} 层敏捷` : `获得 ${n} 层力量` },
    draw:       { name: '抽取', color: '#efe9da', score: 3, draw: 1,    desc: n => `抽 ${n} 张牌` },
    multi:      { name: '多重', color: '#e89030', score: 4, hits: 1,    desc: n => `攻击次数 +${n}` },
    windfury:   { name: '风怒', color: '#b06fd6', score: 4, windfury: 1, desc: n => `打出后回到手牌（每回合 ${n} 次）` },
    forge:      { name: '锻造', color: '#f2d23a', score: 4, forge: 1,   desc: n => `随机锻造手中 ${n} 张牌（限本场）` },
    overload:   { name: '过载', color: '#4fb8ee', score: 5, valuePct: 100, desc: n => `数值 +${100 * n}%` },
    repeat:     { name: '重复', color: '#ee82b8', score: 5, repeat: 1,  desc: n => `整张卡打出 ${1 + n} 次` },
    bright:     { name: '明亮', color: '#f0c850', score: 6, energy: 1,  desc: n => `回复 ${n} 点能量` },
    // —— 借鉴《炉石传说》《宝可梦》——
    lifesteal:  { name: '吸血', color: '#cf4f6a', score: 5, lifesteal: 0.5, desc: n => `对敌人造成伤害的 ${50 * n}% 转化为治疗` },
    poison:     { name: '淬毒', color: '#8ab84a', score: 4, apply: { poison: 1 },  desc: n => `给敌人 ${n} 层中毒（每回合受等量伤害）` },
    freeze:     { name: '冰封', color: '#6cc6e0', score: 5, apply: { frozen: 1 },  desc: n => `冰冻敌人 ${n} 回合（跳过其行动）` },
    leech:      { name: '寄生', color: '#5fae6a', score: 4, apply: { leech: 1 },   desc: n => `给敌人 ${n} 层寄生（每回合受伤并为你回血）` },
    silence:    { name: '沉默', color: '#aab0c4', score: 3, silence: 1, desc: () => `移除敌人的力量` },
    recover:    { name: '回春', color: '#e89ab8', score: 3, heal: 4,    desc: n => `回复 ${4 * n} 点生命` },
    thrift:     { name: '速记', color: '#bcd17a', score: 5, cost: -1,   desc: n => `耗能 -${n}` },
  };

  const DEBUFFS = {
    blunt:  { name: '钝化', color: '#8a8f9e', score: -2, debuff: true, value: -2,       desc: n => `数值 -${2 * n}` },
    expose: { name: '破绽', color: '#b5616a', score: -2, debuff: true, selfStatus: 'vulnerable', desc: n => `自身获得 ${n} 层易伤` },
    feeble: { name: '乏力', color: '#6f9a78', score: -2, debuff: true, selfStatus: 'weak',       desc: n => `自身获得 ${n} 层虚弱` },
    decay:  { name: '朽盾', color: '#7a7f9a', score: -2, debuff: true, selfStatus: 'frail',      desc: n => `自身获得 ${n} 层脆弱` },
    coward: { name: '怯懦', color: '#a0763c', score: -3, debuff: true, sapStr: 1,      desc: n => `失去 ${n} 层力量` },
    clumsy: { name: '笨拙', color: '#5f86a4', score: -3, debuff: true, sapDex: 1,      desc: n => `失去 ${n} 层敏捷` },
    leak:   { name: '漏能', color: '#9a6ab0', score: -4, debuff: true, leak: 1,        desc: n => `失去 ${n} 点能量` },
    erode:  { name: '侵蚀', color: '#b06a8a', score: -4, debuff: true, erode: 1,       desc: n => `随机降级手中 ${n} 张牌` },
    overdraft:  { name: '透支', color: '#5a8fb0', score: -3, debuff: true, nextEnergy: -1, desc: n => `下回合能量 -${n}` },
    cumbersome: { name: '笨重', color: '#9a8a6a', score: -3, debuff: true, cost: 1,        desc: n => `耗能 +${n}` },
    recoil:     { name: '反噬', color: '#b5616a', score: -3, debuff: true, hpLoss: 2,      desc: n => `失去 ${2 * n} 点生命` },
  };

  CG.AFFIXES = Object.assign({}, BUFFS, DEBUFFS);
  CG.BUFF_ORDER = Object.keys(BUFFS);
  CG.DEBUFF_ORDER = Object.keys(DEBUFFS);
  CG.AFFIX_ORDER = CG.BUFF_ORDER.concat(CG.DEBUFF_ORDER);

  CG.isDebuff = id => !!(CG.AFFIXES[id] && CG.AFFIXES[id].debuff);
  CG.affixDisplayName = (id, level) => (level === 2 ? '更' : level === 3 ? '最' : '') + CG.AFFIXES[id].name;
})(window.CG);

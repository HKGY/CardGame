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
})(window.CG);

window.CG = window.CG || {};

/* ===========================================================================
 *  词条（前缀）数据 —— 加在「打击 / 防御」前面，构成多样卡牌。
 * ===========================================================================
 *  每个词条 1~3 级；2/3 级名字前加「更/最」，且所有数值 ×级数（×1/×2/×3）。
 *  机制字段（每级生效一份，会乘以等级 L）：
 *    cost        耗能增减            value      固定数值增减
 *    valuePct    数值百分比加成(%)    hits       效果次数 +N
 *    repeat      额外打出次数        windfury   本回合可回手次数
 *    energy      立刻回复能量        nextEnergy 下回合能量增减（负=惩罚）
 *    hpLoss      失去生命            apply      给对方施加的状态 {vulnerable/weak/frail:每级层数}
 *  color：词条名与其效果文字在卡面上的颜色（可改）。
 *  desc(level)：卡面上显示的效果文字（数值已按等级算好）。
 * ===========================================================================
 */
(function (CG) {
  CG.AFFIXES = {
    suppress:   { name: '压制', color: '#e05550', apply: { vulnerable: 1 },
                  desc: n => `附加 ${n} 层易伤` },
    neutralize: { name: '中和', color: '#3fae62', apply: { weak: 1 },
                  desc: n => `附加 ${n} 层虚弱` },
    shatter:    { name: '破碎', color: '#4a86e0', apply: { frail: 1 },
                  desc: n => `施加 ${n} 层脆弱` },
    swift:      { name: '迅捷', color: '#e6e9f0', cost: -1, value: -3,
                  desc: n => `耗能 -${n}，数值 -${3 * n}` },
    multi:      { name: '多重', color: '#e89030', hits: 1, cost: 1,
                  desc: n => `次数 +${n}，耗能 +${n}` },
    windfury:   { name: '风怒', color: '#b06fd6', windfury: 1,
                  desc: n => `打出后回到手牌（每回合 ${n} 次）` },
    overload:   { name: '过载', color: '#4fb8ee', nextEnergy: -1, valuePct: 50,
                  desc: n => `下回合能量 -${n}，数值 +${50 * n}%` },
    corrupt:    { name: '腐化', color: '#bd8550', hpLoss: 2, valuePct: 50,
                  desc: n => `失去 ${2 * n} 点生命，数值 +${50 * n}%` },
    repeat:     { name: '重复', color: '#ee82b8', cost: 1, repeat: 1,
                  desc: n => `耗能 +${n}，打出 ${1 + n} 次` },
    bright:     { name: '明亮', color: '#f0c850', energy: 1,
                  desc: n => `回复 ${n} 点能量` },
  };

  // 词条加入卡牌的先后（生成/升级时用作候选池）
  CG.AFFIX_ORDER = ['suppress', 'neutralize', 'shatter', 'swift', 'multi',
                    'windfury', 'overload', 'corrupt', 'repeat', 'bright'];

  // 显示名：2 级加「更」，3 级加「最」
  CG.affixDisplayName = (id, level) => (level === 2 ? '更' : level === 3 ? '最' : '') + CG.AFFIXES[id].name;
})(window.CG);

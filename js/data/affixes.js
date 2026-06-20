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
    nourish: { name: '滋养', color: '#e8b0c0', score: 3, selfStatus: 'nourish', desc: n => `滋养 ${n}`, long: n => `本场战斗治疗效率 +${50 * n}%（每层 +50%，不衰减）` },
    // —— 厨艺包：打出后获得 1 张对应食材卡（食材本身已分 1~3 级，故不按词条等级翻倍；仅本场进手牌）——
    farm:    { name: '农场', color: '#8fbf5a', score: 3, give: 'veg',      desc: () => `获得随机素菜`, long: () => `打出后获得 1 张随机「素菜」卡（番茄/土豆/胡萝卜）` },
    ranch:   { name: '牧场', color: '#d08a5a', score: 3, give: 'meat',     desc: () => `获得随机荤菜`, long: () => `打出后获得 1 张随机「荤菜」卡（鱼/鸡/牛肉）` },
    market:  { name: '市场', color: '#c8b04a', score: 3, give: 'season',   desc: () => `获得随机调味料`, long: () => `打出后获得 1 张随机「调味料」卡（盐/酱油/胡椒）` },
    kitchen: { name: '厨房', color: '#c87a8a', score: 3, give: 'cookware', desc: () => `获得随机厨具`, long: () => `打出后获得 1 张随机「厨具」卡（菜刀/铁锅/火炉，0 费武器）` },
    // —— 消耗包：围绕「消耗(exhaust)」做文章 ——
    ashes:   { name: '灰烬', color: '#9aa0a8', score: 4, ashes: 1,      desc: n => `+已消耗数 ×${n}`, long: n => `本牌数值额外 +（消耗堆牌数 × ${n}）` },
    burning: { name: '燃烧', color: '#e87838', score: 3, burnSelect: 1, desc: () => `消耗 1 张手牌`,   long: () => `打出后：选择并消耗 1 张手牌` },
    nirvana: { name: '涅槃', color: '#c79ae0', score: 5, nirvana: 1,    desc: () => `被消耗时打出 1 次`, long: () => `这张牌被消耗时，自动打出 1 次（再结算一遍其效果）` },
    undying: { name: '不坏', color: '#c2c6d6', score: 5, undying: 1,    desc: () => `被消耗时生成副本`, long: () => `这张牌被消耗时，生成 1 张相同副本进手牌` },
    reborn:  { name: '重生', color: '#7fd0a0', score: 4, reborn: 1,     desc: () => `从消耗堆取回 1 张`, long: () => `打出后：把消耗堆里指定的 1 张牌加入手牌` },
    // —— 电力包：用「电力」代替能量（电力战斗内跨回合保留，显示在能量下方）——
    generate:  { name: '发电', color: '#f0d850', score: 3, gainPower: 2, desc: n => `获得电力 ${2 * n}`, long: n => `打出后获得 ${2 * n} 点电力（战斗内跨回合保留）` },
    overclock: { name: '改造', color: '#e0a040', score: 5, overclock: 1, desc: n => `电力付费·数值 ×${n}`, long: n => `本牌改为消耗电力（＝耗能 ×${n}）而非能量，且数值 ×${n}` },
    arc:       { name: '电弧', color: '#f0e060', score: 4, arc: 1,       desc: n => `+当前电力 ×${n}`, long: n => `本牌数值额外 +（当前电力 × ${n}）` },
    discharge: { name: '放电', color: '#e8c84a', score: 4, element: 'thunder', elementBase: 2, desc: n => `附雷 ${2 * n}`, long: n => `命中给敌人附 ${2 * n} 层⚡（叠加触发元素反应）` },
    charge:    { name: '充电', color: '#f0e8a0', score: 3, charge: 1,    desc: n => `电力→能量 ×${n}`, long: n => `打出后消耗至多 ${n} 点电力，转化为等量能量` },
    // === 死守包 ===（把「格挡」当核心资源：保留它、用它打人、残血加伤；bulwark 壁垒复用现有词条）
    barricade: { name: '重甲', color: '#9ab0c8', score: 5, keepBlock: 1, desc: () => '格挡回合末保留', long: () => '打出后，本场战斗格挡在回合结束时不再清空（持续累积）' },
    shieldbash:{ name: '盾击', color: '#c8a060', score: 4, shieldBash: 1, damageOnly: true, desc: n => `伤害+当前格挡×${n}`, long: n => `本牌伤害额外 +（当前格挡 × ${n}）` },
    brace:     { name: '严阵', color: '#7fb0a8', score: 4, brace: 1, desc: n => `格挡 ${4 * n} + 力量 ${n}`, long: n => `打出后获得 ${4 * n} 点格挡，并永久 +${n} 力量` },
    laststand: { name: '死战', color: '#d08070', score: 4, lastStand: 1, damageOnly: true, desc: n => `残血加伤×${n}`, long: n => `本牌伤害额外 +（已损失生命比例 × 10 × ${n}）` },
    // === 生产包 ===（复利引擎：每回合开始被动产出；产出层数常驻不衰减）
    farming:   { name: '耕作', color: '#9ad05a', score: 4, selfStatus: 'prodDraw',  desc: n => `每回合多抽 ${n}`,   long: n => `获得 ${n} 层「耕作」：此后每回合开始额外抽 ${n} 张（常驻、可叠加）` },
    stockpile: { name: '蓄能', color: '#b6d36a', score: 4, selfStatus: 'prodBlock', desc: n => `每回合格挡 +${n}`, long: n => `获得 ${n} 层「蓄能」：此后每回合开始获得 ${n} 点格挡（常驻、可叠加）` },
    compound:  { name: '复利', color: '#d0e078', score: 5, selfStatus: 'prodGrow',  desc: n => `蓄能逐回合 +${n}`, long: n => `获得 ${n} 层「复利」：此后每回合开始你的「蓄能」自增 ${n}（越拖越强）` },
    harvest:   { name: '丰收', color: '#cfe05a', score: 4, harvest: 1,  desc: n => `产出层 ×${n}→格挡`,  long: n => `打出后：把当前耕作/蓄能/复利的层数总和 ×${n} 化为格挡` },
    irrigate:  { name: '灌溉', color: '#a0d870', score: 4, irrigate: 1, desc: n => `立即产出 ${n} 次`,    long: n => `打出后：立即结算 ${n} 次「每回合产出」（按当前蓄能加格挡、按耕作抽牌）` },
    // === 留置包 ===（留牌养牌：牌可保留在手、随停留回合数/手牌数成长）
    keep:       { name: '保留', color: '#b0c0d8', score: 3, retain: true,             desc: () => `保留（不弃手）`, long: () => `回合结束不被弃掉，保留在手` },
    chargeup:   { name: '蓄势', color: '#9fb6d8', score: 4, retain: true, chargeUp: 1, desc: n => `每留 1 回合数值 +${n}`, long: n => `保留在手；每经过 1 个回合数值 +${n}（永久蓄积）` },
    heldstrike: { name: '蓄力一击', color: '#c8a0d8', score: 4, heldStrike: 1,         desc: n => `+在手回合 ×${2 * n}`, long: n => `本牌伤害额外 +（在手回合数 × ${2 * n}）` },
    hoard:      { name: '屯牌', color: '#a0c8c0', score: 4, hoard: 1,                  desc: n => `+出牌后手牌数 ×${n}`, long: n => `本牌数值额外 +（打出后手牌数 × ${n}）` },
    primed:     { name: '待发', color: '#a8c0d0', score: 4, retain: true, primed: 1,   desc: n => `每留 1 回合 -${n} 费`, long: n => `保留在手；每经过 1 个回合本牌耗能 -${n}（越攒越便宜）` },
    // —— 强化包：卡牌实例「本场永久成长」（成长/降费/觉醒计数挂在战斗克隆实例上，不写回牌组）——
    temper:    { name: '锤炼', color: '#e0b0e0', score: 5, temper: 1,    desc: n => `打出后本牌永久 +${n}`, long: n => `本牌每被打出 1 次，其数值永久 +${n}（仅本场战斗）` },
    whet:      { name: '磨砺', color: '#d8a8e0', score: 3, whet: 1,      desc: n => `随机一张手牌 +${n}`, long: n => `打出后随机一张手牌数值永久 +${n}（仅本场战斗）` },
    awaken:    { name: '觉醒', color: '#caa0e8', score: 4, awaken: 1,    desc: n => `打出 3 次后 +${5 * n}`, long: n => `本牌累计被打出 3 次后觉醒：数值永久 +${5 * n}（仅一次，仅本场）` },
    quench:    { name: '淬火', color: '#e0a8d0', score: 4, quench: 1,    desc: () => `随机一张手牌永久降费`, long: () => `打出后随机一张手牌耗能永久 -1（仅本场战斗）` },
    resonance: { name: '共鸣', color: '#d0b0e0', score: 3, resonance: 1, desc: n => `每镶嵌宝石 +${n}`, long: n => `本牌数值额外 +（本牌已镶嵌宝石数 × ${n}）` },
    // === 虚无包 ===（牺牲与空：手牌越空、献祭越多越强）
    emptymind: { name: '空明', color: '#8a90b0', score: 4, emptyMind: 1, desc: n => `空手时数值 +${5 * n}`, long: n => `本牌数值额外 +（max(0, 5 − 出牌后手牌数) × ${n}）：手里牌越少加得越多` },
    devote:    { name: '舍身', color: '#b05a7a', score: 4, devote: 1,    desc: n => `失 ${3 * n} 血·造 ${6 * n} 伤`, long: n => `失去 ${3 * n} 点当前生命，对当前敌人造成 ${6 * n} 点伤害` },
    annihilate:{ name: '湮灭', color: '#6a5a8a', score: 4, annihilate: 1, desc: n => `放逐牌堆 ${2 * n} 张·造伤`, long: n => `从抽牌堆顶放逐 ${2 * n} 张牌，对当前敌人造成（实际放逐数 × 3）点伤害` },
    voidecho:  { name: '虚空回响', color: '#7a6fb0', score: 5, voidEcho: 1, desc: () => `空手时数值翻倍`, long: () => `若出牌后手牌为空，本牌伤害与格挡 ×2` },
    offer:     { name: '献祭', color: '#a05fb0', score: 5, offer: 1,     desc: n => `减最大生命 ${3 * n}·力量 +${2 * n}`, long: n => `本场最大生命 −${3 * n}（下限 1），并获得 ${2 * n} 点力量` },
    // === 奇巧包 ===（随机/赌博：高方差的骰子/硬币/抽奖；效果自包含、用固定随机种子可断言）
    dice:     { name: '掷骰', color: '#c8a0e0', score: 4, dice: 1,     desc: n => `随机 ${n}~${6 * n} 伤害`, long: n => `掷 ${n} 颗骰子：对当前目标造成 ${n}~${6 * n} 点伤害（每颗 1~6）` },
    coinflip: { name: '抛硬币', color: '#d0b0e8', score: 3, coin: 1,    desc: n => `50% 造成 ${8 * n} 伤害`, long: n => `抛硬币：50% 概率造成 ${8 * n} 点伤害，否则毫无效果` },
    grabbag:  { name: '百宝箱', color: '#b890d8', score: 3, randbuff: 1, desc: n => `获得 ${n} 层随机增益`, long: n => `打出后随机获得 ${n} 层力量或敏捷` },
    jackpot:  { name: '头奖', color: '#d8b0f0', score: 5, jackpot: 1,   desc: n => `三选一：${12 * n} 伤害/格挡/抽3`, long: n => `等概率三选一：造成 ${12 * n} 点伤害 / 获得 ${12 * n} 点格挡 / 抽 3 张` },
    slots:    { name: '老虎机', color: '#c0a0e0', score: 5, slots: 1,   desc: n => `每 3 次打出爆出 ${20 * n} 伤害`, long: n => `本场战斗中，每打出第 3 张含「老虎机」的牌，造成 ${20 * n} 点伤害（计数器随后归零）` },
    // === 市场包：金币当战斗资源（花钱换强度 / 打牌生金；金币＝跑图通用货币 run.gold）===
    invest:   { name: '投资', color: '#e8c84a', score: 4, invest: 1, damageOnly: true, desc: n => `花金币换伤害×${n}`, long: n => `打出后花至多 ${5 * n} 金币，对当前敌人造成（花掉金币 ×2）点伤害` },
    income:   { name: '进账', color: '#d8b84a', score: 3, income: 1, desc: n => `获得金币 ${6 * n}`, long: n => `打出后获得 ${6 * n} 金币` },
    trade:    { name: '贸易', color: '#c8d86a', score: 3, trade: 1,  desc: n => `抽1·金币 ${4 * n}`, long: n => `打出后抽 1 张牌并获得 ${4 * n} 金币` },
    windfall: { name: '暴富', color: '#f0e070', score: 4, windfall: 1, desc: n => `+当前金币/10 ×${n}`, long: n => `本牌数值额外 +（当前金币 ÷10 × ${n}）` },
    hire:     { name: '雇佣', color: '#e0c068', score: 4, hire: 1,   desc: n => `花 ${5 * n} 金币·力量 ${n}`, long: n => `打出后花 ${5 * n} 金币（足够则）永久 +${n} 力量` },
    // === 矿工包：挖矿攒「深度」(本场)，深度换伤害/格挡，越挖越掘出金币/宝石 ===
    mine:     { name: '开采', color: '#b08a5a', score: 4, mine: 1,   desc: n => `深度 +${2 * n}`, long: n => `深度 +${2 * n}；每跨过 5 深度掘出一份产出（有跑图则得金币，否则得格挡）` },
    blast:    { name: '爆破', color: '#c87a4a', score: 4, blast: 1,  desc: n => `深度 +${5 * n}`, long: n => `深度 +${5 * n}（一次性猛挖）` },
    prospect: { name: '寻脉', color: '#d0a060', score: 4, prospect: 1, damageOnly: true, desc: n => `伤害+深度×${n}`, long: n => `本牌伤害额外 +（当前深度 × ${n}）` },
    quarry:   { name: '采石', color: '#a89070', score: 4, quarry: 1, desc: n => `格挡+深度×${n}`, long: n => `本牌格挡额外 +（当前深度 × ${n}）` },
    richvein: { name: '富矿', color: '#e0c040', score: 5, richvein: 1, desc: () => `掘出 1 颗随机宝石`, long: () => `打出后向背包掘出 1 颗随机宝石（需在跑图中；不随等级翻倍）` },
    // === 锻造包：攒「热度」(本场)，高热爆发——熔炼/淬炼一次性烧掉热度 ===
    bellows:  { name: '鼓风', color: '#e08038', score: 3, bellows: 1, desc: n => `热度 +${2 * n}`, long: n => `热度 +${2 * n}` },
    ember:    { name: '余烬重击', color: '#e86838', score: 4, ember: 1, damageOnly: true, desc: n => `伤害+热度×${n}`, long: n => `本牌伤害额外 +（当前热度 × ${n}）` },
    smelt:    { name: '熔炼', color: '#f06030', score: 5, smelt: 1,  desc: n => `烧光热度·造等量×${n}`, long: n => `对当前敌人造成（当前热度 × ${n}）点伤害，随后热度清零` },
    coolant:  { name: '淬炼', color: '#d09850', score: 4, coolant: 1, desc: n => `烧光热度·换等量×${n}格挡`, long: n => `获得（当前热度 × ${n}）点格挡，随后热度清零` },
    whitehot: { name: '白热', color: '#f0a040', score: 4, whitehot: 1, desc: n => `热度 +${3 * n}·伤害 ${3 * n}`, long: n => `热度 +${3 * n}，并对当前敌人造成 ${3 * n} 点伤害` },
    // === 召唤包：己方召唤物（有血量、回合末替你攻击、可被敌人攻击、嘲讽可吸引火力）===
    skeleton: { name: '唤骷髅', color: '#c8c8d0', score: 4, summon: 'skeleton', desc: n => `召唤 ${6 * n}血/${4 * n}攻 骷髅`, long: n => `召唤一个 ${6 * n} 血、${4 * n} 攻的骷髅，每回合末攻击当前敌人` },
    swarm:    { name: '群召', color: '#b0c0e0', score: 4, summon: 'swarm', desc: n => `召唤 3 个 ${2 * n}攻小灵`, long: n => `召唤 3 个 2 血、${2 * n} 攻的小灵` },
    totem:    { name: '立图腾', color: '#9ac0a0', score: 4, summon: 'totem', desc: n => `召唤图腾·每回合+${3 * n}格挡`, long: n => `召唤一个 ${8 * n} 血的图腾：不攻击，每回合末给你 ${3 * n} 点格挡` },
    command:  { name: '督战', color: '#e0a060', score: 5, command: 1, desc: n => `召唤物 +${n}攻并立即攻击`, long: n => `你所有召唤物攻击力 +${n}，并立即发动一次攻击` },
    guardian: { name: '守护灵', color: '#8ab0d0', score: 5, summon: 'guardian', desc: n => `召唤 ${15 * n}血 嘲讽`, long: n => `召唤一个 ${15 * n} 血、${2 * n} 攻、带「嘲讽」的守护灵（敌人优先攻击它）` },
    // === 建造包：在有限槽位摆放「建筑」(game.buildings)，每回合开始自动触发；工坊增幅、拆解一次兑现 ===
    arrowtower: { name: '箭塔', color: '#c0a060', score: 4, build: 'arrowtower', desc: n => `建造·每回合打 ${4 * n}`, long: n => `建造箭塔：每回合开始对随机敌人造成 ${4 * n}（受工坊增幅）` },
    rampart:    { name: '路障', color: '#8aa0b8', score: 4, build: 'rampart', desc: n => `建造·每回合 +${4 * n} 格挡`, long: n => `建造路障：每回合开始获得 ${4 * n} 点格挡（受工坊增幅）` },
    furnace:    { name: '熔炉', color: '#d08850', score: 4, build: 'furnace', desc: n => `建造·每回合 +${n} 力量`, long: n => `建造熔炉：每回合开始 +${n} 力量（受工坊增幅）` },
    workshop:   { name: '工坊', color: '#b0a878', score: 5, build: 'workshop', desc: n => `建造·增幅其它建筑 +${n}`, long: n => `建造工坊：每座工坊使你其它建筑每次触发效果 +${n}` },
    demolish:   { name: '拆解', color: '#c8b060', score: 4, demolish: 1, desc: n => `拆 1 建筑·结算 ${3 * n} 次`, long: n => `拆掉你最早的一座建筑，立即结算它 ${3 * n} 次效果` },
    // === 弃牌包：主动丢弃换收益 + 从弃牌堆回收（弃牌进弃牌堆、会洗回，区别于消耗的永久移除）===
    toss:     { name: '抛掷', color: '#a89878', score: 4, toss: 1, damageOnly: true, desc: n => `弃1张·造 ${6 * n}`, long: n => `打出后随机丢弃 1 张手牌，对当前敌人造成 ${6 * n} 点伤害` },
    sift:     { name: '整理', color: '#9aa890', score: 3, sift: 1, desc: () => `弃 2 抽 2`, long: () => `打出后随机丢弃 2 张手牌，再抽 2 张` },
    reclaim:  { name: '拾遗', color: '#a0b0a8', score: 4, reclaim: 1, desc: () => `从弃牌堆取回 1 张`, long: () => `打出后：把弃牌堆里指定的 1 张牌加入手牌` },
    dumpster: { name: '倾倒', color: '#b0a070', score: 4, dumpster: 1, desc: n => `+本回合弃牌数×${n}`, long: n => `本牌数值额外 +（本回合已丢弃的牌数 × ${n}）` },
    madness:  { name: '疯狂', color: '#c89060', score: 4, madness: 1, desc: () => `弃光手牌·每张+1力量`, long: () => `打出后丢弃其余所有手牌，每丢 1 张永久 +1 力量` },
    // === 术士包：凭空造牌/复制/灵视/牌库强化（区别于节奏的「抽既有牌」）===
    conjure:   { name: '演卡', color: '#b59ad8', score: 3, conjure: 1, desc: n => `临时印 ${1 + n} 张基础牌`, long: n => `打出后临时印 ${1 + n} 张随机「打击/防御」进手牌（仅本场）` },
    daggers:   { name: '飞刀', color: '#c8b0e0', score: 4, daggers: 1, desc: () => `生成 3 张飞刀`, long: () => `生成 3 张「飞刀」(0 费·造 4·打出即消耗)进手牌` },
    duplicate: { name: '复制', color: '#a0a0e0', score: 4, duplicate: 1, desc: () => `复制一张手牌`, long: () => `复制手牌中随机 1 张（副本进手牌·本场）` },
    foresight: { name: '灵视', color: '#9ac0e0', score: 4, foresight: 1, desc: () => `免费打出牌堆顶`, long: () => `立即免费打出抽牌堆顶的 1 张牌` },
    mindblast: { name: '心灵震慑', color: '#c79ae0', score: 5, mindblast: 1, desc: n => `牌库攻击牌 +${n}`, long: n => `本场永久：牌库(抽/弃/手)里所有攻击牌伤害 +${n}` },
    // === 猎杀包：借敌人虚弱爆发/处决/击杀回报（区别于强攻裸数值、弱化上 debuff）===
    execute: { name: '处决', color: '#b04050', score: 5, execute: 1, desc: n => `敌≤${10 * n}% 斩杀`, long: n => `若当前敌人生命 ≤ 最大生命的 ${10 * n}%，直接斩杀` },
    prey:    { name: '猎物', color: '#c06050', score: 4, prey: 1, damageOnly: true, desc: n => `伤害+敌减益×${n}`, long: n => `本牌伤害额外 +（目标减益层数总和 × ${n}）` },
    exploit: { name: '弱点爆破', color: '#d05040', score: 4, exploit: 1, desc: n => `引爆敌减益·每层 ${4 * n}`, long: n => `消耗目标全部减益，每消耗 1 层对其造成 ${4 * n} 伤害` },
    insight: { name: '洞察', color: '#a07060', score: 4, insight: 1, damageOnly: true, desc: n => `敌意图攻击时×${1 + n}`, long: n => `若敌人本回合意图为攻击，本牌伤害 ×${1 + n}` },
    reaping: { name: '收割', color: '#c08040', score: 5, reaping: 1, desc: n => `每击杀+${n}力量`, long: n => `本场战斗每击杀 1 个敌人，永久 +${n} 力量` },
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
    // —— 厨艺包·腐坏：打出后获得一张腐坏卡（不能打出、回合结束自伤）——
    rot:   { name: '腐败', color: '#7a7a4a', score: -3, debuff: true, give: 'spoiled_rice', desc: () => `获得馊饭`, long: () => `打出后获得「馊饭」（不能打出，回合结束失去 2 生命）` },
    spoil: { name: '变质', color: '#8a6a4a', score: -3, debuff: true, give: 'stinky_meat', desc: () => `获得臭肉`, long: () => `打出后获得「臭肉」（不能打出，回合结束自身虚弱 2）` },
    mold:  { name: '发霉', color: '#6a8a5a', score: -3, debuff: true, give: 'rotten_veg', desc: () => `获得烂菜`, long: () => `打出后获得「烂菜」（不能打出，回合结束自身易伤 2）` },
    // —— 消耗包·负面 ——
    detonate: { name: '爆燃', color: '#c75450', score: -4, debuff: true, burnAll: 1,   desc: () => `消耗其余手牌`, long: () => `打出后消耗你其余所有手牌` },
    onfire:   { name: '着火', color: '#e0703a', score: -3, debuff: true, selfBurn: 2,  desc: n => `自身灼伤 ${2 * n}`, long: n => `打出后给自己上 ${2 * n} 层「灼伤」（每回合受等量伤害、逐回合 -1，但可被格挡）` },
    nightmare:{ name: '噩梦', color: '#6a5a8a', score: -4, debuff: true, nightmare: 1, desc: () => `渣滓塞满手牌`, long: () => `打出后用「渣滓」(1 费·打出即消耗) 塞满你的手牌（上限 10 张）` },
    // —— 电力包·负面 ——
    shock:    { name: '感电', color: '#c8b84a', score: -2, debuff: true, selfThunder: 2, desc: n => `自身附雷 ${2 * n}`, long: n => `打出后给自己附 ${2 * n} 层⚡（为「会给玩家附元素的敌人」埋雷；当前无即时副作用）` },
    paralyze: { name: '麻痹', color: '#8a8a5a', score: -4, debuff: true, paralyze: 3,   desc: n => `锁住左 ${3 * n} 张`, long: n => `本回合你手牌最左侧 ${3 * n} 张无法打出` },
    drain:    { name: '漏电', color: '#9a8a4a', score: -2, debuff: true, losePower: 1,  desc: n => `失去电力 ${n}`, long: n => `打出后失去 ${n} 点电力` },
    // === 死守包·负面 ===（cumbersome 笨重复用现有词条）
    cower:  { name: '龟缩', color: '#7a8a9a', score: -3, debuff: true, loseEnergy: 1, desc: n => `能量 -${n}`,        long: n => `打出后立即失去 ${n} 点能量` },
    burden: { name: '负重', color: '#8a8a7a', score: -3, debuff: true, loseBlock: 2,  desc: n => `失去 ${2 * n} 格挡`, long: n => `打出后失去 ${2 * n} 点格挡` },
    // === 生产包·负面 ===
    cropfail: { name: '歉收', color: '#8a8a4a', score: -3, debuff: true, selfStatus: 'prodSkip',   desc: n => `跳过 ${n} 次产出`, long: n => `攒下 ${n} 次「歉收」：之后每个回合开始跳过一次被动产出，直到耗尽` },
    upkeep:   { name: '养护', color: '#9a7a4a', score: -3, debuff: true, selfStatus: 'prodUpkeep', desc: n => `每回合能量 -${n}`, long: n => `获得 ${n} 层「养护」：此后每回合开始失去 ${n} 点能量（常驻）` },
    stagnate: { name: '滞产', color: '#7a8a5a', score: -3, debuff: true, stagnate: 1, desc: n => `蓄能/耕作各 -${n}`, long: n => `打出后：你的「蓄能」与「耕作」各 -${n}（夹 0）` },
    // === 留置包·负面 ===
    heavyhold: { name: '沉重', color: '#8a8f9e', score: -2, debuff: true, retain: true,    desc: () => `强制保留（堵手）`, long: () => `回合结束不被弃掉，强制留在手里却无任何收益` },
    sluggish:  { name: '滞涩', color: '#9a8a6a', score: -3, debuff: true, sluggish: 1,     desc: n => `每留 1 回合 +${n} 费`, long: n => `保留在手时，每经过 1 个回合本牌耗能 +${n}（越攒越贵）` },
    clutch:    { name: '手滑', color: '#a0763c', score: -3, debuff: true, clutch: 1,       desc: n => `随机弃 ${n} 张手牌`, long: n => `打出后随机弃掉 ${n} 张手牌` },
    // —— 强化包·负面 ——
    overforge: { name: '过锻', color: '#a05a9a', score: -3, debuff: true, overforge: 1,  desc: () => `成长≥6 则碎裂`, long: () => `若本牌已积累的成长 ≥6，本牌打出后碎裂（进入消耗堆）` },
    anneal:    { name: '退火', color: '#8a6a9a', score: -3, debuff: true, anneal: 2,      desc: n => `随机手牌成长 -${2 * n}`, long: n => `打出后随机一张手牌的成长 -${2 * n}（不低于 0）` },
    stress:    { name: '应力', color: '#9a5a7a', score: -3, debuff: true, hpLoss: 2,      desc: n => `失去 ${2 * n} HP`, long: n => `打出后失去 ${2 * n} 点生命（复用反噬式自伤）` },
    // === 虚无包·负面 ===
    erode:  { name: '蚀骨', color: '#7a6a8a', score: -3, debuff: true, erode: 1,  desc: n => `减最大生命 ${2 * n}`, long: n => `打出后本场最大生命 −${2 * n}（下限 1）` },
    banish: { name: '放逐代价', color: '#6a5a7a', score: -4, debuff: true, banish: 1, desc: n => `随机放逐 ${n} 张手牌`, long: n => `打出后随机放逐 ${n} 张手牌（进入消耗堆）` },
    hollow: { name: '空虚', color: '#8a7a9a', score: -3, debuff: true, hollow: 1,  desc: () => `非空手时数值减半`, long: () => `若出牌后手牌非空，本牌伤害与格挡减半（向下取整）` },
    // === 奇巧包 ===（赌博的代价：自伤 / 随机减益 / 走火）
    misfire:  { name: '哑火', color: '#b5616a', score: -3, debuff: true, misfire: 1,  desc: n => `25% 失去 ${3 * n} HP`, long: n => `打出后 25% 概率炸膛：失去 ${3 * n} 点生命` },
    fickle:   { name: '无常', color: '#9a6ab0', score: -3, debuff: true, fickle: 1,   desc: n => `随机自身减益 ${n}`, long: n => `打出后随机获得 ${n} 层易伤 / 虚弱 / 脆弱之一` },
    backfire: { name: '走火', color: '#c08a4a', score: -3, debuff: true, backfire: 1, desc: n => `50% 误伤自己 ${5 * n}`, long: n => `打出后 50% 对敌人、否则对自己造成 ${5 * n} 点伤害` },
    // === 市场包·负面 ===
    tax:       { name: '赋税', color: '#9a8a4a', score: -3, debuff: true, tax: 4, desc: n => `失去金币 ${4 * n}`, long: n => `打出后失去 ${4 * n} 金币` },
    inflation: { name: '通胀', color: '#8a7a5a', score: -3, debuff: true, inflation: 1, desc: () => `失去 20% 金币`, long: () => `打出后失去当前金币的 20%（向下取整）` },
    debt:      { name: '赌债', color: '#7a6a4a', score: -3, debuff: true, debt: 3, desc: n => `失 ${3 * n} 金币/血`, long: n => `打出后失去 ${3 * n} 金币；不足则改为失去等量生命抵债` },
    // === 矿工包·负面 ===
    cavein:    { name: '塌方', color: '#7a6a5a', score: -3, debuff: true, cavein: 1, desc: n => `自伤 ${3 * n}`, long: n => `打出后失去 ${3 * n} 点生命（矿洞塌方）` },
    barren:    { name: '贫矿', color: '#8a8a6a', score: -3, debuff: true, barren: 1, desc: n => `深度 -${3 * n}`, long: n => `打出后深度 -${3 * n}（夹 0）` },
    disaster:  { name: '矿难', color: '#6a5a4a', score: -4, debuff: true, disaster: 1, desc: () => `深度减半`, long: () => `打出后当前深度减半（向下取整）` },
    // === 锻造包·负面 ===
    overheat:  { name: '过热', color: '#d05a30', score: -3, debuff: true, overheat: 2, desc: n => `自身灼伤 ${2 * n}`, long: n => `打出后给自己上 ${2 * n} 层灼伤（每回合受伤、可被格挡）` },
    crack:     { name: '崩裂', color: '#9a6a5a', score: -3, debuff: true, crack: 4, desc: n => `失去 ${4 * n} 格挡`, long: n => `打出后失去 ${4 * n} 点格挡` },
    rust:      { name: '锈蚀', color: '#8a7a6a', score: -2, debuff: true, rust: 3, desc: n => `热度 -${3 * n}`, long: n => `打出后热度 -${3 * n}（夹 0）` },
    // === 召唤包·负面 ===
    toll:    { name: '索命', color: '#9a5a6a', score: -3, debuff: true, hpLoss: 3, desc: n => `召唤代价：自伤 ${3 * n}`, long: n => `打出后失去 ${3 * n} 点生命（召唤的代价；复用反噬式自伤）` },
    culling: { name: '折损', color: '#7a6a7a', score: -4, debuff: true, culling: 1, desc: n => `消灭你 ${n} 个召唤物`, long: n => `打出后随机消灭你 ${n} 个召唤物` },
    discord: { name: '内讧', color: '#8a6a5a', score: -3, debuff: true, discord: 2, desc: n => `召唤物各 -${2 * n} 血`, long: n => `打出后你所有召唤物各失去 ${2 * n} 点生命` },
    // === 建造包·负面 ===
    hazard:   { name: '工伤', color: '#9a6a5a', score: -3, debuff: true, hpLoss: 3, desc: n => `自伤 ${3 * n}`, long: n => `打出后失去 ${3 * n} 点生命（施工事故；复用反噬式自伤）` },
    collapse: { name: '坍塌', color: '#7a6a5a', score: -4, debuff: true, collapse: 1, desc: n => `摧毁你 ${n} 座建筑`, long: n => `打出后随机摧毁你 ${n} 座建筑` },
    subside:  { name: '沉降', color: '#8a7a6a', score: -2, debuff: true, subside: 1, desc: n => `建筑效果各 -${n}`, long: n => `打出后你所有建筑的每次触发效果 -${n}（夹 0）` },
    // === 弃牌包·负面（复用 clutch / loseEnergy / leak 机制）===
    forget:  { name: '健忘', color: '#7a7a6a', score: -3, debuff: true, clutch: 1,     desc: n => `随机弃 ${n} 张手牌`, long: n => `打出后随机丢弃 ${n} 张手牌` },
    waste:   { name: '浪费', color: '#8a7a5a', score: -2, debuff: true, loseEnergy: 1, desc: n => `能量 -${n}`, long: n => `打出后失去 ${n} 点能量` },
    // === 术士包·负面（clutter 塞渣滓；recoil/cumbersome 复用）===
    clutter: { name: '谵妄', color: '#8a7a9a', score: -3, debuff: true, clutter: 1, desc: n => `获得 ${n} 张渣滓`, long: n => `打出后向手牌塞 ${n} 张「渣滓」(1 费·打出即消耗)` },
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
    weaken:   { name: '弱化包', icon: '☠️', color: '#8ab84a', desc: '削弱与控制敌人。',
                buffs: ['suppress', 'neutralize', 'shatter', 'poison', 'freeze', 'silence'],
                debuffs: ['expose', 'feeble', 'decay', 'clumsy'] },
    tempo:    { name: '节奏包', icon: '🌀', color: '#4fb8ee', desc: '抽牌 / 能量 / 费用。',
                buffs: ['draw', 'bright', 'thrift', 'windfury', 'echo'],
                debuffs: ['leak', 'cumbersome'] },
    vitality: { name: '生机包', icon: '🌿', color: '#7fd6a0', desc: '治疗 / 续航 / 反伤。',
                buffs: ['lifesteal', 'recover', 'regen', 'barbs', 'bulwark', 'nourish'],
                debuffs: ['recoil', 'expose', 'feeble'] },
    elements: { name: '元素包', icon: '⚗️', color: '#cf6fd0', desc: '附火/水/雷/冰，叠加触发蒸发/融化/超载/感电/冻结/超导（连招型，建议在商店「五选二」凑齐两种）。',
                buffs: ['flame', 'aqua', 'volt', 'frost'],
                debuffs: ['blunt', 'recoil', 'cumbersome'] },
    cook:     { name: '厨艺包', icon: '🍳', color: '#e0a45a', desc: '做菜流派：打出素菜→选荤菜/调料做成「餐点」(0费消耗)；大宝石附带腐坏减益。',
                buffs: ['farm', 'ranch', 'market', 'kitchen'],
                debuffs: ['rot', 'spoil', 'mold'] },
    exhaust:  { name: '消耗包', icon: '🔥', color: '#d2603a', desc: '玩「消耗」：灰烬随消耗堆变强、燃烧/重生操纵牌堆、涅槃/不坏让被消耗的牌再生；大宝石附带爆燃/着火/噩梦。',
                buffs: ['ashes', 'burning', 'nirvana', 'undying', 'reborn'],
                debuffs: ['detonate', 'onfire', 'nightmare'] },
    elec:     { name: '电力包', icon: '⚡', color: '#f0d040', desc: '用「电力」代替能量：发电攒电、改造超频、电弧/放电；大宝石附带感电/麻痹/漏电。',
                buffs: ['generate', 'overclock', 'arc', 'discharge', 'charge'],
                debuffs: ['shock', 'paralyze', 'drain'] },
    // === 死守包 ===
    bastion:  { name: '死守包', icon: '🛡️', color: '#7fa8c8', desc: '格挡即进攻：保留格挡、以盾为矛、残血爆发。',
                buffs: ['bulwark', 'barricade', 'shieldbash', 'brace', 'laststand'],
                debuffs: ['cower', 'burden', 'cumbersome'] },
    // === 生产包 ===
    produce:  { name: '生产包', icon: '🌾', color: '#b6d36a', desc: '复利引擎：每回合被动产出，越拖越强。',
                buffs: ['farming', 'stockpile', 'compound', 'harvest', 'irrigate'],
                debuffs: ['cropfail', 'upkeep', 'stagnate'] },
    // === 留置包 ===
    retain:   { name: '留置包', icon: '🤲', color: '#b0c0d8', desc: '留牌养牌：握得越久越强。',
                buffs: ['keep', 'chargeup', 'heldstrike', 'hoard', 'primed'],
                debuffs: ['heavyhold', 'sluggish', 'clutch'] },
    enhance:  { name: '强化包', icon: '✨', color: '#e0b0e0', desc: '永久成长：打得越多越强（本场）。',
                buffs: ['temper', 'whet', 'awaken', 'quench', 'resonance'],
                debuffs: ['overforge', 'anneal', 'stress'] },
    // === 虚无包 ===
    void:     { name: '虚无包', icon: '🕳️', color: '#6a6f8a', desc: '牺牲与空：手牌越空、献祭越多越强。',
                buffs: ['emptymind', 'devote', 'annihilate', 'voidecho', 'offer'],
                debuffs: ['erode', 'banish', 'hollow'] },
    // === 奇巧包 ===
    gadget:   { name: '奇巧包', icon: '🎲', color: '#c8a0e0', desc: '随机/赌博：高方差的骰子、硬币、抽奖。',
                buffs: ['dice', 'coinflip', 'grabbag', 'jackpot', 'slots'],
                debuffs: ['misfire', 'fickle', 'backfire'] },
    econ:     { name: '市场包', icon: '💰', color: '#e8c84a', desc: '金币当战斗资源：投资/雇佣花钱换强度，进账/贸易/暴富靠钱滚钱。',
                buffs: ['invest', 'income', 'trade', 'windfall', 'hire'],
                debuffs: ['tax', 'inflation', 'debt'] },
    miner:    { name: '矿工包', icon: '⛏️', color: '#b08a5a', desc: '挖矿攒深度：深度换伤害/格挡，越挖越掘出金币与宝石。',
                buffs: ['mine', 'blast', 'prospect', 'quarry', 'richvein'],
                debuffs: ['cavein', 'barren', 'disaster'] },
    forge:    { name: '锻造包', icon: '🔨', color: '#e86838', desc: '攒热度搏爆发：高热的余烬重击、熔炼/淬炼一次性烧光热度。',
                buffs: ['bellows', 'ember', 'smelt', 'coolant', 'whitehot'],
                debuffs: ['overheat', 'crack', 'rust'] },
    summon:   { name: '召唤包', icon: '👻', color: '#b0b0e0', desc: '召唤有血量的随从替你作战：骷髅/群召/图腾/守护灵（嘲讽），督战增援。',
                buffs: ['skeleton', 'swarm', 'totem', 'command', 'guardian'],
                debuffs: ['toll', 'culling', 'discord'] },
    build:    { name: '建造包', icon: '🏗️', color: '#c0a060', desc: '在有限槽位摆放建筑，每回合开始自动触发；工坊增幅、拆解一次兑现。',
                buffs: ['arrowtower', 'rampart', 'furnace', 'workshop', 'demolish'],
                debuffs: ['hazard', 'collapse', 'subside'] },
    discard:  { name: '弃牌包', icon: '♻️', color: '#a89878', desc: '主动丢弃换即时收益、按弃牌数爆发、从弃牌堆回收（弃牌会洗回，区别于消耗）。',
                buffs: ['toss', 'sift', 'reclaim', 'dumpster', 'madness'],
                debuffs: ['forget', 'waste', 'leak'] },
    conjure:  { name: '术士包', icon: '🎩', color: '#b59ad8', desc: '凭空造牌/复制/灵视，心灵震慑强化牌库（区别于节奏的抽既有牌）。',
                buffs: ['conjure', 'daggers', 'duplicate', 'foresight', 'mindblast'],
                debuffs: ['clutter', 'recoil', 'cumbersome'] },
    hunter:   { name: '猎杀包', icon: '🗡️', color: '#c06050', desc: '借敌人虚弱爆发：处决残血、引爆减益、洞察意图、击杀给永久回报。',
                buffs: ['execute', 'prey', 'exploit', 'insight', 'reaping'],
                debuffs: ['recoil', 'expose', 'coward'] },
  };
  CG.PACK_IDS = Object.keys(CG.PACKS);

  /* =========================================================================
   *  词条分组 —— 给「调试菜单·自定义宝石」按主题归类，便于查找。
   *  每个词条恰好归入一组：取它所属的「第一个主题包」（强攻→诅咒→…→消耗）；
   *  当前所有词条都被某主题包收录，故「通用(misc)」组实际为空（仅作未来兜底）。
   *  纯展示用，不影响生成 / 选包。
   * ========================================================================= */
  CG.AFFIX_GROUP_ORDER = ['power', 'weaken', 'tempo', 'vitality', 'elements', 'cook', 'exhaust', 'elec', 'bastion', 'produce', 'retain', 'enhance', 'void', 'gadget', 'econ', 'miner', 'forge', 'summon', 'build', 'discard', 'conjure', 'hunter', 'misc'];
  CG.affixGroupOf = function (id) {
    for (const pid of CG.AFFIX_GROUP_ORDER) {
      if (pid === 'misc') break;
      const p = CG.PACKS[pid];
      if (p && (p.buffs.includes(id) || p.debuffs.includes(id))) return pid;
    }
    return 'misc';
  };
  CG.affixGroupMeta = function (key) {
    if (key === 'misc') return { name: '通用', icon: '🎴', color: '#cdd2e2' };
    const p = CG.PACKS[key];
    return p ? { name: p.name, icon: p.icon, color: p.color } : { name: key, icon: '•', color: '#cdd2e2' };
  };
})(window.CG);

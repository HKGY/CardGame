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
    heal: 3.0,                                        // v3.14 治疗改 3VP（2 治疗/能量）
    fire: 6.0, water: 6.0, thunder: 6.0, ice: 6.0,    // 元素：1 层 = 6VP
    // summon(1.5)/conjure(6)/thorns(2) 改为时点基值（VP 见 TURN_BASES）；building 已删
    mult: 12.0, lifesteal: 0.12, combo: 6.0, multi: 12.0,   // 翻倍/多重=12VP；吸血 0.12/%(≤100)；连击 6VP
    // —— 新批价值原子（v3.6）——
    copyDiscard: 6.0, recallDiscard: 6.0, recycleDraw: 3.0, playTopDraw: 6.0, socketRand: 6.0,   // 牌/堆操控
    debuffMult: 12.0, hitAll: 6.0, vulnAmp: 6.0, weakAmp: 6.0,                                    // 敌减益放大 / 命中全体
    growDmg: 1.0, growBlk: 1.0, selfCostDown: 6.0, freeNext: 6.0, playTwice: 6.0, keepBlockFull: 12.0,   // 本牌/后续修饰
    makeDagger: 3.0, makeScrap: 3.0, daggerUp: 6.0, scrapUp: 6.0,                                 // 兵械（匕首/甲片）
    immune: 12.0, dmgCap1: 18.0,                                                                  // 防御
    retain: 3.0, forge: 1.0, vigor: 1.0, parry: 1.0, wish: 12.0,                                  // v3.7：保留/锻造(终末之剑)/活力/招架/许愿
    makePeek: 3.0, curse: 0.6, curseStrike: 6.0, dmgToBlock: 6.0, foresight: 2.0, transform: 6.0, mimicry: 6.0,   // v3.8：生成灵魂/灾厄/追加灾厄/伤害转格挡；v3.15 预见/变化/模仿
    enterRage: 6.0, enterSerenity: 6.0, maxim: 3.0,                                               // v3.15 僧侣·姿态：进入愤怒/宁静、箴言
    expandEvery: 6.0, harvestEvery: 6.0, detonateEvery: 6.0, recycle: 6.0,                        // v3.8：每回合机制(扩容/收割/爆破) + 回收
    corpseBomb: 6.0, catalyze: 12.0,                                                              // v3.12 猛毒包：尸爆(被毒杀→AoE最大生命)/催发(立即结算中毒)
    burn: 1.5, regen: 3.0,                                                                        // v3.12 新价值：灼烧(灰烬包,过血量DoT)/再生(生机包,回合开始回血)
    makeWisp: 6.0, illusion: 6.0, peekUp: 6.0, wispUp: 6.0,                                        // v3.13 生成磷火/幻境(临时牌+50%)/灵魂强化(+1)/磷火强化(+0.5)
    arc: 6.0, charge: 6.0, nirvana: 6.0, undying: 6.0, temper: 6.0, duplicate: 6.0, mindblast: 6.0,   // v3.12 复活既有引擎机制为价值原子：电弧/充电(电力)、涅槃/不坏(灰烬)、锤炼(机巧)、复制/心灵震慑(术士)
    // —— 代价原子 ——（v3.14：失血 hp 3VP；自易伤·虚弱·脆弱 仍 2VP）
    hp: 3.0, gold: 1.0, discard: 3.0, maxhp: 1.0, exhaustCard: 6.0, losePower: 1.0, makeDross: 6.0, ethereal: 3.0, minionHp: 1.5,   // ethereal＝虚无(回合末未打出则消耗)；minionHp＝消耗召唤物血量
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

  /* —— 人类可读描述模板（v3.9）——
   *  VALUE_TMPL：每个「价值基值/非时点原子」的**裸句子**（用 {n} 占位数量；系统自动拼「下回合/每回合」「召唤物」前缀）。
   *  COND_TMPL：条件前半句（量型 q 用 {x}；门型 gate 是「…时」整句）。完整条件句＝前半句 + 「，」+ 价值句。
   *  amount→显示数：多数为 v.amt×等级；少数有显示倍率（dmul，见 VALUE_ATOMS）：daggerUp×4 / scrapUp×3 / vulnAmp×25(%) / weakAmp×15(%) / detonateEvery×4；mult 显示 ×(1+量)。*/
  const VALUE_TMPL = {
    damage: '对敌人造成 {n} 点伤害', block: '获得 {n} 点格挡', draw: '抽 {n} 张牌', energy: '获得 {n} 点能量', power: '获得 {n} 点电力',
    vulnerable: '使敌人获得 {n} 点易伤', weak: '使敌人获得 {n} 点虚弱', frail: '使敌人获得 {n} 点脆弱', poison: '使敌人获得 {n} 点中毒',
    thorns: '获得 {n} 点荆棘', conjure: '生成 1 张带 {n} 颗随机宝石的牌（本回合 0 费）', summon: '召唤骷髅或使其血量上限增加 {n}',
    strength: '获得 {n} 点力量', dexterity: '获得 {n} 点敏捷', enemyLoseStr: '使敌人失去 {n} 点力量', enemyLoseDex: '使敌人失去 {n} 点敏捷',
    food_veg: '生成 {n} 张草药', food_meat: '生成 {n} 张兽血',
    heal: '回复 {n} 点生命', fire: '给敌人附 {n} 层火', water: '给敌人附 {n} 层水', thunder: '给敌人附 {n} 层雷', ice: '给敌人附 {n} 层冰',
    mult: '本牌伤害/格挡/治疗 ×{n}', lifesteal: '吸血 {n}%', combo: '本牌攻击额外命中 {n} 次', multi: '消耗全部能量，整张牌打出等同能量的次数',
    copyDiscard: '将这张牌复制 {n} 份到弃牌堆', recallDiscard: '将弃牌堆中 {n} 张牌加入手牌', recycleDraw: '将弃牌堆中 {n} 张牌洗回抽牌堆',
    playTopDraw: '打出抽牌堆顶 {n} 张牌', socketRand: '为 {n} 张有空位的手牌镶嵌随机宝石',
    debuffMult: '使敌人所有减益层数 ×{n}', hitAll: '命中所有敌人',
    vulnAmp: '本场敌方易伤受到的伤害额外 +{n}%', weakAmp: '本场敌方虚弱减少的攻击额外 +{n}%',
    growDmg: '打出后本场这张牌伤害 +{n}', growBlk: '打出后本场这张牌格挡 +{n}', selfCostDown: '打出后本场这张牌能耗 -{n}',
    freeNext: '接下来 {n} 张牌免费打出', playTwice: '接下来 {n} 张牌打出两次', keepBlockFull: '格挡跨回合保留',
    makeDagger: '生成 {n} 张匕首', makeScrap: '生成 {n} 张甲片', daggerUp: '本场匕首伤害 +{n}', scrapUp: '本场甲片格挡 +{n}',
    immune: '免疫接下来 {n} 次伤害', dmgCap1: '本回合受到的伤害降为 1', retain: '这张牌回合结束时不丢弃',
    forge: '终末之剑伤害 +{n}（不论它在何处；没有则创造一张加入手牌）', vigor: '使下一张造成伤害的牌攻击 +{n}', parry: '终末之剑格挡 +{n}（不论它在何处）',
    wish: '从抽牌堆中选择 {n} 张牌加入手牌', makePeek: '生成 {n} 张灵魂到抽牌堆', foresight: '预见：看抽牌堆顶 {n} 张，任选丢入弃牌堆',
    transform: '变化：将 {n} 张手牌变成同结构的随机新牌（不消耗）', mimicry: '将 {n} 张手牌变化为随机「模仿打击/防御/重击」',
    enterRage: '进入「愤怒」姿态（造成/受到的伤害翻倍）', enterSerenity: '进入「宁静」姿态（离开时获得 2 能量）', maxim: '获得 {n} 层箴言（满 10 层进入「神格」）',
    curse: '使敌人获得 {n} 点灾厄', curseStrike: '追加等同本牌伤害 ×{n} 的灾厄给敌人', dmgToBlock: '获得等同本牌伤害 ×{n} 的格挡',
    expandEvery: '每回合增益上限 +{n}', harvestEvery: '立即获得 {n} 次现有每回合增益', detonateEvery: '立即结算现有每回合增益 {n} 次后失去它们', recycle: '消耗手牌中所有非初始牌，并抽取等量的牌',
    corpseBomb: '被中毒杀死的敌人，对其他敌人造成等同其最大生命值的伤害', catalyze: '立即结算敌人身上的中毒 {n} 次',
    burn: '使敌人获得 {n} 点灼烧', regen: '获得 {n} 点再生', nirvana: '这张牌被消耗时，其效果再发动 {n} 次', undying: '这张牌被消耗时，生成 {n} 张副本加入手牌',
    arc: '打出时本牌数值额外 +（当前电力 ×{n}）', charge: '消耗至多 {n} 点电力，转化为等量能量', temper: '打出后本场这张牌数值永久 +{n}', duplicate: '复制 {n} 张随机手牌', mindblast: '牌库中所有攻击牌的伤害永久 +{n}',
    makeWisp: '生成 {n} 张磷火', illusion: '本回合内生成的临时卡牌效果提升 50%（叠加 {n} 次）', peekUp: '本场灵魂抽牌 +{n}', wispUp: '本场磷火能量 +{n}',
  };
  const COND_TMPL = {
    curBlock: { q: '每有 {x} 点当前格挡' }, enemyDebuff: { q: '敌方每有 {x} 层减益' }, exhaustPile: { q: '消耗堆每有 {x} 张牌' },
    handSize: { q: '手牌每有 {x} 张' }, emptyHand: { q: '手牌每空出 {x} 张' }, curGold: { q: '每持有 {x} 点金币' }, turnNum: { q: '每过 {x} 个回合' },
    myDebuff: { q: '自身每有 {x} 层减益' }, hpLossCount: { q: '本场每失去 {x} 次生命' }, playedThisTurn: { q: '本回合每打出 {x} 张牌' },
    daggerPlayed: { q: '本场每打出 {x} 张匕首' }, scrapPlayed: { q: '本场每打出 {x} 张甲片' }, peekPlayed: { q: '本场每打出 {x} 张灵魂' }, cardsMade: { q: '本场每生成 {x} 张牌' }, poisonApplied: { q: '本场每施加 {x} 次中毒' },
    firstPlay: { gate: '这张牌本场首次打出时' }, hurt: { gate: '本场已受过伤时' }, noBlock: { gate: '没有格挡时' },
    enemyVuln: { gate: '敌人处于易伤时' }, enemyWeak: { gate: '敌人处于虚弱时' }, enemyFrail: { gate: '敌人处于脆弱时' }, enemyPoison: { gate: '敌人处于中毒时' },
    lostHpTurn: { gate: '本回合失去过生命时' }, exhaustedTurn: { gate: '本回合消耗过牌时' }, foresightTurn: { gate: '本回合预见过时' }, inStance: { gate: '身处愤怒/宁静时' },
  };
  CG.VALUE_TMPL = VALUE_TMPL; CG.COND_TMPL = COND_TMPL;

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
    // —— 新批价值原子（v3.6）——（牌/堆操控、敌减益放大、本牌/后续修饰、兵械、防御）
    copyDiscard:  { name: '复制到弃牌', vpRes: 'copyDiscard', mech: u => ({ copyToDiscard: u }) },        // #2 复制这张牌 n 次到弃牌堆
    recallDiscard:{ name: '弃牌回手', vpRes: 'recallDiscard', mech: u => ({ recallDiscard: u }) },        // #4 弃牌区 n 张 → 手牌
    recycleDraw:  { name: '弃牌洗回库', vpRes: 'recycleDraw', mech: u => ({ recycleDraw: u }) },          // #5 弃牌区 n 张 → 洗回抽牌堆
    playTopDraw:  { name: '打出牌库顶', vpRes: 'playTopDraw', mech: u => ({ playTopDraw: u }) },          // #19 打出抽牌堆顶 n 张
    socketRand:   { name: '镶随机宝石', vpRes: 'socketRand', mech: u => ({ socketRand: u }) },            // #6 给 n 张有空位手牌镶随机宝石(本场)
    debuffMult:   { name: '敌减益翻倍', vpRes: 'debuffMult', maxCount: 2, mech: u => ({ debuffMult: u }) },// #3 敌人所有减益层数 ×(1+n)
    hitAll:       { name: '命中全体', vpRes: 'hitAll', maxCount: 1, mech: u => ({ aoe: u }) },            // #7 这张牌命中所有敌人
    vulnAmp:      { name: '强化易伤', vpRes: 'vulnAmp', dmul: 25, mech: u => ({ vulnAmp: u }) },           // #13 敌易伤受伤额外 +25%×n（本场）
    weakAmp:      { name: '强化虚弱', vpRes: 'weakAmp', maxCount: 1, dmul: 15, mech: u => ({ weakAmp: u }) },// #14 敌虚弱减攻额外 +15%（本场、不叠加）
    growDmg:      { name: '本场伤害成长', vpRes: 'growDmg', mech: u => ({ growDmg: u }) },                // #10 打出后本场该牌伤害 +n
    growBlk:      { name: '本场格挡成长', vpRes: 'growBlk', mech: u => ({ growBlk: u }) },                // #11 打出后本场该牌格挡 +n
    selfCostDown: { name: '本场能耗降低', vpRes: 'selfCostDown', mech: u => ({ selfCostDown: u }) },      // #11a 打出后本场该牌能耗 −n
    freeNext:     { name: '后续免费', vpRes: 'freeNext', mech: u => ({ freeNext: u }) },                  // #12 下 n 张牌免费打出
    playTwice:    { name: '后续打两次', vpRes: 'playTwice', mech: u => ({ playTwice: u }) },              // #20 下 n 张牌打出两次
    keepBlockFull:{ name: '格挡保留', vpRes: 'keepBlockFull', maxCount: 1, mech: u => ({ keepBlockFull: u }) },// #21 格挡跨回合保留(本场)
    makeDagger:   { name: '生成匕首', vpRes: 'makeDagger', mech: u => ({ makeDagger: u }) },              // #23 生成 n 张匕首
    makeScrap:    { name: '生成甲片', vpRes: 'makeScrap', mech: u => ({ makeScrap: u }) },                // #24 生成 n 张甲片
    daggerUp:     { name: '匕首强化', vpRes: 'daggerUp', dmul: 4, mech: u => ({ daggerUp: u }) },          // #25 匕首伤害 +4×n（本场）
    scrapUp:      { name: '甲片强化', vpRes: 'scrapUp', dmul: 3, mech: u => ({ scrapUp: u }) },            // #26 甲片格挡 +3×n（本场）
    immune:       { name: '免疫伤害', vpRes: 'immune', mech: u => ({ immune: u }) },                      // #27 免疫下 n 次伤害
    dmgCap1:      { name: '伤害降为1', vpRes: 'dmgCap1', maxCount: 1, mech: u => ({ dmgCap1: u }) },       // #28 本回合受到伤害降为 1
    // —— v3.7 ——
    retain:       { name: '保留', vpRes: 'retain', maxCount: 1, mech: u => ({ retain: u }) },             // #32a 回合结束不丢弃
    forge:        { name: '锻造', vpRes: 'forge', maxCount: 1, mech: u => ({ forge: u }) },               // #33 终末之剑伤害 +1(不论何处)；无则创造
    vigor:        { name: '活力', vpRes: 'vigor', mech: u => ({ vigor: u }) },                            // #35 下一张造成伤害的牌 +n 攻击
    parry:        { name: '招架', vpRes: 'parry', maxCount: 1, mech: u => ({ parry: u }) },               // #36 终末之剑 +1 格挡(不论何处)
    wish:         { name: '许愿', vpRes: 'wish', mech: u => ({ wish: u }) },                              // #37 从抽牌堆选择 n 张加入手牌
    // —— v3.8 ——
    makePeek:     { name: '生成灵魂', vpRes: 'makePeek', mech: u => ({ makePeek: u }) },                  // #39 生成 n 张灵魂到抽牌堆
    curse:        { name: '灾厄', vpRes: 'curse', mech: u => ({ apply: { curse: u } }) },                 // #41 灾厄：层数 > 敌人生命则其回合末死亡
    curseStrike:  { name: '追加灾厄', vpRes: 'curseStrike', mech: u => ({ curseStrike: u }) },            // #44 追加＝伤害×n 的灾厄
    dmgToBlock:   { name: '伤害转格挡', vpRes: 'dmgToBlock', mech: u => ({ dmgToBlock: u }) },            // #51 获得＝伤害×n 的格挡
    expandEvery:  { name: '扩容', vpRes: 'expandEvery', mech: u => ({ expandEvery: u }) },                // #46 每回合增益上限 +n
    harvestEvery: { name: '收割', vpRes: 'harvestEvery', mech: u => ({ harvestEvery: u }) },              // #47 立即获得 n 次现有每回合增益
    detonateEvery:{ name: '爆破', vpRes: 'detonateEvery', dmul: 4, mech: u => ({ detonateEvery: u }) },    // #50 立即获得 4n 次现有每回合增益并失去（显示数 ×4）
    recycle:      { name: '回收', vpRes: 'recycle', maxCount: 1, mech: u => ({ recycle: u }) },           // #48 消耗手牌中所有非初始牌，抽等量
    // —— v3.12 猛毒包 ——
    corpseBomb:   { name: '尸爆', vpRes: 'corpseBomb', maxCount: 1, color: COLOR.poison, mech: u => ({ corpseBomb: u }) },   // 被中毒杀死的敌人对其他敌人造成等同其最大生命的伤害
    catalyze:     { name: '催发', vpRes: 'catalyze', color: COLOR.poison, mech: u => ({ catalyze: u }) },                    // 立即结算敌人的中毒 n 次
    // —— v3.12 灰烬包：灼烧（过格挡式 DoT）+ 复活既有「被消耗时」机制 ——
    burn:         { name: '灼烧', vpRes: 'burn', numeric: true, color: COLOR.fire, mech: u => ({ apply: { burn: u } }) },     // 给敌人施加 n 层灼烧（回合结束受伤、可被格挡）
    nirvana:      { name: '涅槃', vpRes: 'nirvana', color: COLOR.fire, mech: u => ({ nirvana: u }) },                         // 被消耗时此牌效果再发动 n 次
    undying:      { name: '不坏', vpRes: 'undying', color: COLOR.fire, mech: u => ({ undying: u }) },                         // 被消耗时生成 n 张副本进手牌
    // —— v3.12 生机包：再生 ——
    regen:        { name: '再生', vpRes: 'regen', numeric: true, color: COLOR.heal, mech: u => ({ regen: u }) },             // 获得 n 层再生（每回合开始回血、逐回合 -1）
    // —— v3.12 电力包：电弧 / 充电 ——
    arc:          { name: '电弧', vpRes: 'arc', maxCount: 2, color: COLOR.power, mech: u => ({ arc: u }) },                   // 本牌数值额外 +（当前电力 × n）
    charge:       { name: '充电', vpRes: 'charge', color: COLOR.power, mech: u => ({ charge: u }) },                          // 消耗至多 n 电力，转化为等量能量
    // —— v3.12 强化包：锤炼；术士包：复制 / 心灵震慑 ——
    temper:       { name: '锤炼', vpRes: 'temper', color: '#c8a86a', mech: u => ({ temper: u }) },                           // 打出后本牌数值永久 +n（本场）
    duplicate:    { name: '复制', vpRes: 'duplicate', color: COLOR.conjure, mech: u => ({ duplicate: u }) },                 // 复制 n 张随机手牌
    mindblast:    { name: '心灵震慑', vpRes: 'mindblast', maxCount: 1, color: COLOR.conjure, mech: u => ({ mindblast: u }) },  // 牌库中所有攻击牌伤害永久 +n
    // —— v3.13 强化型（非时点；按 1能量=灵魂强化1=磷火强化0.5 校准）——
    peekUp:       { name: '灵魂强化', vpRes: 'peekUp', color: COLOR.conjure, mech: u => ({ peekUp: u }) },                    // 本场灵魂抽牌 +n
    wispUp:       { name: '磷火强化', vpRes: 'wispUp', dmul: 0.5, color: COLOR.power, mech: u => ({ wispUp: u }) },           // 本场磷火能量 +0.5×n
    foresight:    { name: '预见', vpRes: 'foresight', color: COLOR.conjure, mech: u => ({ foresight: u }) },                 // v3.15 占卜：看牌库顶 n 张，任选丢入弃牌堆
    transform:    { name: '变化', vpRes: 'transform', color: COLOR.conjure, mech: u => ({ transform: u }) },                // v3.15 幻惑：手牌变成同结构随机新牌
    mimicry:      { name: '变化为模仿', vpRes: 'mimicry', color: COLOR.conjure, mech: u => ({ mimicry: u }) },              // v3.15 幻惑：手牌变成模仿打击/防御/重击
    enterRage:    { name: '进入愤怒', vpRes: 'enterRage', maxCount: 1, color: COLOR.power, mech: () => ({ enterRage: 1 }) },        // v3.15 僧侣·姿态
    enterSerenity:{ name: '进入宁静', vpRes: 'enterSerenity', maxCount: 1, color: COLOR.block, mech: () => ({ enterSerenity: 1 }) },
    maxim:        { name: '箴言', vpRes: 'maxim', color: COLOR.strength, mech: u => ({ maxim: u }) },
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
  const statB = (vp, nowMech, everyMech, nextEff, ids, bname, color) => ({ vp, kind: 'stat', nowMech, everyMech, nextEff, ids, bname, prim: 'now', color });   // v3.14 持续型也默认「本回合」（裸名＝本回合档；下/每回合带前缀）
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
    thorns:     statB(1.0, v => ({ tempThorns: v }), v => ({ addThorns: v }), v => ({ type: 'tempThorns', value: v }), { now: 'tempThorns', next: 'thorns_next', every: 'thorns' }, '荆棘', COLOR.thorns),   // 荆棘(every默认,2VP,永久) / 本回合荆棘(now,1VP,临时) / 下回合荆棘(next)；不再每回合递增
    conjure:    sched(6.0, v => ({ type: 'conjure', value: v }), v => ({ conjure: v }), { now: 'conjure', next: 'conjure_next', every: 'conjure_every' }, '造牌', { num: true, prim: 'now', color: COLOR.conjure }),   // 造一张带随机 n 宝石的牌(本回合 0 费)
    summon:     sched(1.5, v => ({ type: 'summon', value: v }), v => ({ summon: v }), { now: 'summon', next: 'summon_next', every: 'summon_every' }, '召唤物', { num: true, prim: 'now', color: COLOR.summon }),   // 召唤/壮大单骷髅(血量上限 n)
    food_veg:   sched(2.0, v => ({ type: 'give', what: 'veg', value: v }), () => ({ give: 'veg' }), { now: 'food_veg', next: 'food_veg_next', every: 'food_veg_every' }, '草药', { maxCount: 1, color: COLOR.food }),
    food_meat:  sched(2.0, v => ({ type: 'give', what: 'meat', value: v }), () => ({ give: 'meat' }), { now: 'food_meat', next: 'food_meat_next', every: 'food_meat_every' }, '兽血', { maxCount: 1, color: COLOR.food }),
    strength:   statB(1.5, v => ({ prepare: v }), v => ({ addStr: v }), v => ({ type: 'tempStrength', value: v }), { now: 'tempStr', next: 'strength_next', every: 'strength' }, '力量', COLOR.strength),
    dexterity:  statB(1.5, v => ({ prepDex: v }), v => ({ addDex: v }), v => ({ type: 'tempDexterity', value: v }), { now: 'tempDex', next: 'dexterity_next', every: 'dexterity' }, '敏捷', COLOR.dexterity),
    enemyLoseStr: statB(1.5, v => ({ enemyStr: v, enemyTemp: true }), v => ({ enemyStr: v }), v => ({ type: 'enemyStat', key: 'strength', value: v, temp: true }), { now: 'enemyLoseStrTemp', next: 'enemyLoseStr_next', every: 'enemyLoseStr' }, '敌失力量', COLOR.enemyLoseStr),
    enemyLoseDex: statB(1.5, v => ({ enemyDex: v, enemyTemp: true }), v => ({ enemyDex: v }), v => ({ type: 'enemyStat', key: 'dexterity', value: v, temp: true }), { now: 'enemyLoseDexTemp', next: 'enemyLoseDex_next', every: 'enemyLoseDex' }, '敌失敏捷', COLOR.enemyLoseDex),
    // —— v3.13 时点化的「操作 / 生成 / 强化」价值（本/下/每回合三档；这些原子原本无时点，现并入此生成器，覆盖上面手写的同名原子）——
    recallDiscard: sched(6,   v => ({ type: 'recallDiscard', value: v }), v => ({ recallDiscard: v }), { now: 'recallDiscard', next: 'recallDiscard_next', every: 'recallDiscard_every' }, '弃牌回手', { prim: 'now', color: COLOR.draw }),
    recycleDraw:   sched(3,   v => ({ type: 'recycleDraw', value: v }),   v => ({ recycleDraw: v }),   { now: 'recycleDraw', next: 'recycleDraw_next', every: 'recycleDraw_every' }, '弃牌洗回库', { prim: 'now', color: COLOR.draw }),
    playTopDraw:   sched(6,   v => ({ type: 'playFromDraw', value: v }),  v => ({ playTopDraw: v }),    { now: 'playTopDraw', next: 'playTopDraw_next', every: 'playTopDraw_every' }, '打出牌库顶', { prim: 'now', color: COLOR.draw }),
    socketRand:    sched(6,   v => ({ type: 'socketRandom', value: v }),  v => ({ socketRand: v }),     { now: 'socketRand', next: 'socketRand_next', every: 'socketRand_every' }, '镶随机宝石', { prim: 'now', color: COLOR.conjure }),
    keepBlockFull: sched(12,  v => ({ type: 'keepBlockFull', value: v }), v => ({ keepBlockFull: v }),  { now: 'keepBlockFull', next: 'keepBlockFull_next', every: 'keepBlockFull_every' }, '格挡保留', { prim: 'now', maxCount: 1, color: COLOR.block }),
    makeDagger:    sched(3,   v => ({ type: 'makeDagger', value: v }),    v => ({ makeDagger: v }),     { now: 'makeDagger', next: 'makeDagger_next', every: 'makeDagger_every' }, '生成匕首', { prim: 'now', color: '#c0a878' }),
    makeScrap:     sched(3,   v => ({ type: 'makeScrap', value: v }),     v => ({ makeScrap: v }),      { now: 'makeScrap', next: 'makeScrap_next', every: 'makeScrap_every' }, '生成甲片', { prim: 'now', color: '#a8b0c0' }),
    makePeek:      sched(3,   v => ({ type: 'makePeek', value: v }),      v => ({ makePeek: v }),       { now: 'makePeek', next: 'makePeek_next', every: 'makePeek_every' }, '生成灵魂', { prim: 'now', color: COLOR.conjure }),
    makeWisp:      sched(6,   v => ({ type: 'makeWisp', value: v }),      v => ({ makeWisp: v }),       { now: 'makeWisp', next: 'makeWisp_next', every: 'makeWisp_every' }, '生成磷火', { prim: 'now', color: COLOR.power }),
    illusion:      sched(6,   v => ({ type: 'illusion', value: v }),      v => ({ illusion: v }),       { now: 'illusion', next: 'illusion_next', every: 'illusion_every' }, '幻境', { prim: 'now', color: COLOR.conjure }),
    forge:         sched(1,   v => ({ type: 'forge', value: v }),        v => ({ forge: v }),          { now: 'forge', next: 'forge_next', every: 'forge_every' }, '锻造', { prim: 'now', maxCount: 6, color: '#d0c060' }),
    parry:         sched(1,   v => ({ type: 'parry', value: v }),        v => ({ parry: v }),          { now: 'parry', next: 'parry_next', every: 'parry_every' }, '招架', { prim: 'now', maxCount: 6, color: '#d0c060' }),
    vigor:         sched(1,   v => ({ type: 'vigor', value: v }),        v => ({ vigor: v }),          { now: 'vigor', next: 'vigor_next', every: 'vigor_every' }, '活力', { prim: 'now', color: COLOR.damage }),
    wish:          sched(12,  v => ({ type: 'wish', value: v }),         v => ({ wish: v }),           { now: 'wish', next: 'wish_next', every: 'wish_every' }, '许愿', { prim: 'now', color: COLOR.conjure }),
    curse:         sched(0.6, v => ({ type: 'curse', value: v }),        v => ({ apply: { curse: v } }), { now: 'curse', next: 'curse_next', every: 'curse_every' }, '灾厄', { prim: 'now', color: COLOR.poison }),
    expandEvery:   sched(6,   v => ({ type: 'expandEvery', value: v }),  v => ({ expandEvery: v }),    { now: 'expandEvery', next: 'expandEvery_next', every: 'expandEvery_every' }, '扩容', { prim: 'now', color: '#b6d36a' }),
  };
  // 持续型(力量/敏捷)也可加召唤物修饰词：补一个标准 perm 效果 eff 供 minion 变体复用。
  TURN_BASES.strength.minion = true; TURN_BASES.strength.eff = v => ({ type: 'strength', value: v });
  TURN_BASES.dexterity.minion = true; TURN_BASES.dexterity.eff = v => ({ type: 'dexterity', value: v });
  TURN_BASES.thorns.minion = true; TURN_BASES.thorns.eff = v => ({ type: 'thorns', value: v });   // 召唤物荆棘＝永久投给骷髅
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
      //   即时型(sched)：全 3 时点（now 立即 / every·next 调度）；持续型(stat)：只「永久」档(every)即时投给骷髅（裸 id 如 strength_m）。
      if (b.minion && (b.kind === 'sched' || t === 'every')) {
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
  // v3.9：给每个价值原子绑定人类可读模板 `tmpl`（时点变体＝时点前缀+基值模板；召唤物变体加「召唤物」；非时点原子直接取 VALUE_TMPL）。
  Object.keys(VALUE_ATOMS).forEach(id => {
    const va = VALUE_ATOMS[id];
    if (va.turnBase) {
      const b = TURN_BASES[va.turnBase], prim = b.prim || 'now';
      const base = VALUE_TMPL[va.turnBase] || (b.bname + ' {n}');
      va.tmpl = (va.minion ? '召唤物' : '') + (va.timing === prim ? '' : TURN_PREFIX[va.timing]) + base;
    } else if (id === 'heal_m') {
      va.tmpl = '召唤物' + (VALUE_TMPL.heal || '治疗 {n}');
    } else {
      va.tmpl = VALUE_TMPL[id] || (va.name + ' {n}');
    }
  });
  const valColor = id => (VALUE_ATOMS[id] && VALUE_ATOMS[id].color) || COLOR[id] || '#cdd2e2';
  // v3.14 时点变体映射：now 变体 id → { next, every } 变体 id（供「每回合/下回合」修饰词包展开）。按 (turnBase, minion) 分组。
  CG.timingVariants = {};
  CG.timingSiblings = new Set();   // 所有「有 now 兄弟」的 下/每回合 变体 id（含召唤物）；价值包剥离它们、size 计入它们
  (function () {
    const groups = {};
    Object.keys(VALUE_ATOMS).forEach(id => { const a = VALUE_ATOMS[id]; if (!a.turnBase) return; const key = a.turnBase + (a.minion ? '#m' : ''); (groups[key] = groups[key] || {})[a.timing] = id; });
    Object.keys(groups).forEach(k => { const g = groups[k]; if (g.now) { CG.timingVariants[g.now] = { next: g.next, every: g.every }; if (g.next) CG.timingSiblings.add(g.next); if (g.every) CG.timingSiblings.add(g.every); } });
  })();

  /* —— 代价原子 —— */
  const COST_REAL = {            // 真资源：按 amount 扣、首石免、×L
    energy:  { name: '能量', fmt: n => `+${n} 费` },
    hp:      { name: '生命', fmt: n => `失 ${n} 血`, time: true },
    gold:    { name: '金币', fmt: n => `失 ${n} 金`, time: true },
    discard: { name: '弃牌', fmt: n => `弃 ${n} 张` },
    exhaustCard: { name: '消耗手牌', fmt: n => `选择消耗 ${n} 张`, pick: true },   // #15 选择并消耗 n 张手牌（pick 型，类 discard）
    losePower: { name: '消耗电力', fmt: n => `消耗 ${n} 电力` },   // #29 消耗 n 电力（原「当前电力」条件改为此代价）
    makeDross: { name: '生成渣滓', fmt: n => `生成 ${n} 渣滓` },   // #31 生成 n 张渣滓（clutter）
    ethereal:  { name: '虚无', fmt: () => `虚无` },                // #40 虚无：回合结束时若仍在手牌则消耗（量级只作 VP 配平、不显示）
    minionHp:  { name: '召唤物血量', fmt: n => `消耗召唤物 ${n} 血` },   // #42 消耗召唤物 n 血量
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
    enemyDebuff: { name: '敌方减益', qty: 'enemyDebuff', vp: 1.0 },// 平均减益 2.0 ×0.5
    exhaustPile: { name: '消耗堆', qty: 'exhaustPile', vp: 1.0 },
    handSize:    { name: '手牌数', qty: 'handSize', vp: 1.0 },
    emptyHand:   { name: '空手程度', qty: 'emptyHand', vp: 1.0 },  // 量 = 10 − 手牌数
    curGold:     { name: '当前金币', qty: 'curGold', vp: 0.06 },   // 局外资源、单价低（不按 0.5）
    turnNum:     { name: '回合数', qty: 'turnNum', vp: 1.0 },
    myDebuff:    { name: '自身减益层数', qty: 'myDebuff', vp: 1.0 },// 越惨越强：回收自己背的减益
    hpLossCount: { name: '本场失去生命次数', qty: 'hpLossCount', vp: 2.0 },   // #18 量型：本场战斗中失去生命 n 次
    playedThisTurn: { name: '本回合打出牌数', qty: 'playedThisTurn', vp: 2.0 },   // #34 量型：本回合已打出牌数
    daggerPlayed: { name: '本场打出匕首数', qty: 'daggerPlayed', vp: 1.0 },   // #43 量型：本场打出匕首/甲片/灵魂 次数
    scrapPlayed:  { name: '本场打出甲片数', qty: 'scrapPlayed', vp: 1.0 },
    peekPlayed:   { name: '本场打出灵魂数', qty: 'peekPlayed', vp: 1.0 },
    cardsMade:    { name: '本场生成卡牌数', qty: 'cardsMade', vp: 1.0 },       // #49 量型：本场战斗生成卡牌数
    poisonApplied:{ name: '本场施加中毒次数', qty: 'poisonApplied', vp: 3.0 },  // v3.12 量型：本场战斗施加中毒的次数
    // —— 门型条件(gate，达成给 1 能量等值=6VP)：借鉴 StS 遗物 ——
    firstPlay:   { name: '这张牌本场第一次打出', qty: 'firstPlay', gate: true, vp: 6.0, maxCount: 1 },
    hurt:        { name: '本场已受伤', qty: 'hurt', gate: true, vp: 6.0, maxCount: 1 },
    noBlock:     { name: '无格挡', qty: 'noBlock', gate: true, vp: 6.0, maxCount: 1 },
    enemyVuln:   { name: '敌人易伤时', qty: 'enemyVuln', gate: true, vp: 6.0, maxCount: 1 },   // #1 拆成按减益类型的多个门
    enemyWeak:   { name: '敌人虚弱时', qty: 'enemyWeak', gate: true, vp: 6.0, maxCount: 1 },
    enemyFrail:  { name: '敌人脆弱时', qty: 'enemyFrail', gate: true, vp: 6.0, maxCount: 1 },
    enemyPoison: { name: '敌人中毒时', qty: 'enemyPoison', gate: true, vp: 6.0, maxCount: 1 },
    lostHpTurn:  { name: '本回合失去过生命', qty: 'lostHpTurn', gate: true, vp: 6.0, maxCount: 1 },     // #8
    exhaustedTurn:{ name: '本回合消耗过牌', qty: 'exhaustedTurn', gate: true, vp: 6.0, maxCount: 1 },   // #9
    lowHp:       { name: '残血(生命低于一半)', qty: 'lowHp', gate: true, vp: 6.0, maxCount: 1 },        // v3.12 血液包：生命低于一半时
    foresightTurn:{ name: '本回合预见过', qty: 'foresightTurn', gate: true, vp: 6.0, maxCount: 1 },     // v3.15 占卜·预见包
    inStance:    { name: '身处愤怒/宁静', qty: 'inStance', gate: true, vp: 6.0, maxCount: 1 },           // v3.15 僧侣·姿态包
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
    // 该价值能否升档（同 mkReal 的 hasHi）：被 maxCount 卡成单一量(如药材)→ 条件型也只 LV1（去掉等级不变效果的冗余档）
    const v1 = Math.min(valMax, Math.max(1, Math.floor(6 / valVP + 1e-9)));
    const hasHi = Math.min(valMax, Math.max(v1 + 1, Math.floor(12 / valVP + 1e-9))) > v1;
    const mult = (cc.vp != null ? cc.vp : 6) / valVP;   // 每单位条件量换得的价值量
    if (gate && mult < 1) return;   // 门型：条件VP < 价值VP → floor(mult×等级)=0 的退化词条（如「每回合选择 0 张」），不生成（要么 ≥1、要么不生成）
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
  // 价值句：把某价值原子在数量 n 下渲染成自然短句（含 mult 的 ×(1+n) 与 dmul 显示倍率）。
  const valPhrase = (atomId, n) => {
    const va = VALUE_ATOMS[atomId] || {};
    if (atomId === 'mult') n = 1 + n;            // 翻倍：显示 ×(1+量)
    else if (va.dmul) n = n * va.dmul;           // 显示倍率（daggerUp×4 / vulnAmp×25% / detonate×4 …）
    const t = va.tmpl || ((va.name || atomId) + ' {n}');
    return t.split('{n}').join(n);
  };
  CG.valPhrase = valPhrase;
  CG.affixValueText = function (id, level) {
    const a = A[id]; if (!a) return '';
    const v = a.value, vL = CG.lvVal(level);
    if (a.condBonus) {                                  // 条件代价：前半句(条件) + 「，」 + 价值句
      const cb = a.condBonus, ct = COND_TMPL[cb.qty] || {};
      if (cb.gate) {                                     // 门：达成则给定额价值
        const head = ct.gate || `${condName(a.cost.res)}时`;
        return `${head}，${valPhrase(cb.atom, Math.floor((cb.mult || 1) * vL + 1e-9))}`;
      }
      const head = (ct.q || `每有 {x} 点${condName(a.cost.res)}`).split('{x}').join(cb.fx);   // 量：每有 X 点条件 → 价值
      return `${head}，${valPhrase(cb.atom, (cb.fy || 0) * vL)}`;
    }
    return valPhrase(v.atom, (v.amt || 0) * vL);
  };
  CG.affixDisplayName = (id, level) => CG.affixValueText(id, level);
  // 简短形（卡名宝石 chip 用，避免长句撑破卡面）：价值原子名 + 数量；条件＝价值名+「*」。完整自然句见 affixValueText。
  // 价值原子的「裸名」：去掉 本/下/每回合 时点前缀（时点改用卡面 加粗=每回合 / 斜体=下回合 表示），保留「召唤物」前缀。
  CG.bareName = function (atom) {
    const va = VALUE_ATOMS[atom] || {};
    if (va.turnBase) return (va.minion ? '召唤物' : '') + (TURN_BASES[va.turnBase].bname || va.name || atom);
    return va.name || atom;
  };
  // 时点：返回价值原子的 now/next/every（供卡面样式）。
  CG.affixTiming = function (id) { const a = A[id]; if (!a) return 'now'; const atom = a.condBonus ? a.condBonus.atom : (a.value && a.value.atom); const va = VALUE_ATOMS[atom] || {}; return va.timing || 'now'; };
  // 价值原子 + 数量 → 简短文字（裸名 + 数值，特殊原子单独格式）。
  function shortOf(atom, n) {
    if (atom === 'mult') return `数值×${1 + n}`;
    if (atom === 'lifesteal') return `吸血${n}%`;
    if (atom === 'combo') return `连击+${n}`;
    if (atom === 'multi') return '多重';
    const va = VALUE_ATOMS[atom] || {}; if (va.dmul) n *= va.dmul;
    return `${CG.bareName(atom)} ${n}`;
  }
  CG.affixShort = function (id, level) {
    const a = A[id]; if (!a) return '';
    const vL = CG.lvVal(level);
    // 条件代价：量型(每有 X 条件)用「裸名 *」；门型(true/false 达成)用「裸名 + 数值」(定额 ⌊mult×等级⌋)。
    if (a.condBonus) { const cb = a.condBonus; return cb.gate ? shortOf(cb.atom, Math.floor((cb.mult || 1) * vL + 1e-9)) : (CG.bareName(cb.atom) + '*'); }
    return shortOf(a.value.atom, (a.value.amt || 0) * vL);
  };

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
  /* =========================================================================
   *  卡牌包（主题）—— v3.12「自洽主题」模型：每个主题各自携带一组
   *    · values：该主题授予的「价值原子」
   *    · costs ：该主题专属的「真资源代价」（energy 是所有主题通用、不必列）
   *    · conds ：该主题专属的「条件代价」
   *  单主题可出的词条 = (energy ∪ costs) × values  ∪  conds × values（自洽：代价/条件与价值同主题）。
   *  本局把选定主题「融合」时＝取各主题 values/costs/conds 的并集后做**全交叉积**
   *    →「任意(选中代价) × 任意(选中价值)」（如 选了血液+强攻 → 失血换大伤害）。主题只决定「池子里有哪些原子」。
   *  这样：不选某主题，就不会出现它的代价/条件/价值（精准、不臃肿）；选了就能自由组合。
   * ========================================================================= */
  const P = (name, icon, color, desc, values, costs, conds) => ({ name, icon, color, desc, values, costs: costs || [], conds: conds || [] });
  CG.PACKS = {
    // ===== 进攻 =====
    basic:    P('基础包', '🎴', '#cdd2e2', '伤害 / 格挡（空法术两条基本式）。', ['damage', 'block'], [], ['firstPlay']),
    power:    P('强攻包', '⚔️', '#e89030', '纯伤害（本/下/每回合三档）。', ['damage', 'damage_next', 'damage_every'], [], ['noBlock']),
    combo:    P('连击包', '🌟', '#e8a838', '连击：本牌攻击额外命中数次。', ['combo']),
    assault:  P('强袭包', '💥', '#e87038', '命中全体 + 活力（本/下/每回合，给下一张伤害牌加成）。', ['hitAll', 'vigor', 'vigor_next', 'vigor_every']),
    amplify:  P('放大包', '✦', '#ff9fc0', '翻倍 / 多重（成倍放大本牌）。', ['mult', 'multi']),
    // ===== 减益（按状态拆细）=====
    vuln:     P('易伤包', '🎯', '#e05550', '易伤（本/下/每回合）+ 强化易伤。', ['vulnerable', 'vulnerable_next', 'vulnerable_every', 'vulnAmp'], [], ['enemyVuln']),
    weak:     P('虚弱包', '💧', '#3fae62', '虚弱（本/下/每回合）+ 强化虚弱。', ['weak', 'weak_next', 'weak_every', 'weakAmp'], [], ['enemyWeak']),
    frail:    P('脆弱包', '🧨', '#5a78c0', '脆弱（本/下/每回合）。', ['frail', 'frail_next', 'frail_every'], [], ['enemyFrail']),
    poison:   P('猛毒包', '☠️', '#8ab84a', '中毒（本/下/每回合）+ 尸爆 + 催发。', ['poison', 'poison_next', 'poison_every', 'corpseBomb', 'catalyze'], [], ['enemyPoison', 'poisonApplied']),
    burn:     P('灼烧包', '🔥', '#ff7a4a', '灼烧（回合结束受伤、可被格挡）。', ['burn']),
    curse:    P('灾厄包', '🪦', '#7a6a9a', '灾厄（本/下/每回合）/ 追加灾厄（层数高于敌生命则其回合末死亡）。', ['curse', 'curse_next', 'curse_every', 'curseStrike']),
    sapstr:   P('夺力包', '🔻', '#5fae8a', '削弱敌人力量（永久/本回合/下回合）。', ['enemyLoseStr', 'enemyLoseStrTemp', 'enemyLoseStr_next']),
    sapdex:   P('夺敏包', '🔽', '#5a86c0', '削弱敌人敏捷（永久/本回合/下回合）。', ['enemyLoseDex', 'enemyLoseDexTemp', 'enemyLoseDex_next']),
    spread:   P('扩散包', '🦠', '#9ab84a', '敌方所有减益层数翻倍。', ['debuffMult'], [], ['enemyDebuff']),
    // ===== 防御 =====
    block:    P('壁垒包', '🛡️', '#7fa8c8', '格挡（本回合 / 下回合）。', ['block', 'block_next'], [], ['curBlock']),
    ward:     P('持盾包', '🔰', '#6f98c0', '格挡跨回合保留（本/下/每回合）+ 伤害转格挡。', ['keepBlockFull', 'keepBlockFull_next', 'keepBlockFull_every', 'dmgToBlock']),
    thorns:   P('荆棘包', '🌵', '#5fae6a', '荆棘反伤（本/下/每回合）。', ['tempThorns', 'thorns_next', 'thorns']),
    immune:   P('免疫包', '✨', '#cfd2e2', '免疫数次伤害 / 本回合伤害降为1。', ['immune', 'dmgCap1']),
    // ===== 增益 =====
    strength: P('力量包', '💪', '#e0563a', '力量（本回合 / 下回合 / 永久）。', ['tempStr', 'strength_next', 'strength']),
    dexterity:P('敏捷包', '🤸', '#4a86e0', '敏捷（本回合 / 下回合 / 永久）。', ['tempDex', 'dexterity_next', 'dexterity']),
    vitality: P('生机包', '🌿', '#7fd6a0', '治疗 / 再生。', ['heal', 'regen']),
    // ===== 节奏 / 牌库 =====
    draw:     P('抽牌包', '🃏', '#efe9da', '抽牌（本回合 / 下回合）。', ['draw', 'draw_next'], ['discard'], ['handSize']),
    energy:   P('能量包', '⚡', '#f0c850', '能量（本回合 / 下回合）。', ['energy', 'energy_next']),
    flow:     P('律动包', '🎟️', '#4fb8ee', '后续免费 / 后续打两次。', ['freeNext', 'playTwice'], [], ['playedThisTurn']),
    conjure:  P('造牌包', '🎩', '#b59ad8', '造牌（本/下/每回合，带随机宝石）。', ['conjure', 'conjure_next', 'conjure_every'], [], ['cardsMade']),
    divine:   P('许愿包', '🌠', '#a78ad0', '许愿：从抽牌堆挑牌进手（本/下/每回合）。', ['wish', 'wish_next', 'wish_every']),
    soul:     P('灵魂包', '🔮', '#9a7ad0', '生成灵魂(0费抽2消耗) + 灵魂强化。', ['makePeek', 'makePeek_next', 'makePeek_every', 'peekUp'], [], ['peekPlayed']),
    foresight:P('预见包', '👁️', '#8a9ad8', '预见：看抽牌堆顶 n 张，任选丢入弃牌堆。', ['foresight'], [], ['foresightTurn']),
    transform:P('变化包', '🎭', '#c08ad0', '变化：手牌变成同结构随机新牌 / 变成模仿打击·防御·重击。', ['transform', 'mimicry']),
    stance:   P('姿态包', '🧘', '#e0a040', '进入愤怒(伤害翻倍)/宁静(离开+2能量) + 箴言(满10进神格)。', ['enterRage', 'enterSerenity', 'maxim'], [], ['inStance']),
    sorcery:  P('术法包', '🪄', '#c59ad8', '复制手牌 / 心灵震慑 / 复制到弃牌。', ['duplicate', 'mindblast', 'copyDiscard']),
    pile:     P('牌术包', '📚', '#8fbcd0', '弃牌回手 / 洗回库 / 打出牌库顶 / 镶随机宝石（本/下/每回合）。', ['recallDiscard', 'recallDiscard_next', 'recallDiscard_every', 'recycleDraw', 'recycleDraw_next', 'recycleDraw_every', 'playTopDraw', 'playTopDraw_next', 'playTopDraw_every', 'socketRand', 'socketRand_next', 'socketRand_every']),
    enhance:  P('强化包', '📈', '#c8a86a', '本牌成长（伤害/格挡/降费/锤炼）。', ['growDmg', 'growBlk', 'selfCostDown', 'temper'], ['gold'], ['emptyHand', 'curGold']),
    hold:     P('持留包', '📌', '#c8b89a', '保留（回合末不弃）+ 回收（消耗非初始牌并抽等量）。', ['retain', 'recycle']),
    // ===== 资源 / 引擎 =====
    elec:     P('电力包', '🔌', '#f0d040', '电力（本/下/每回合）+ 电弧（随电力增伤）/ 充电（电力换能量）。', ['power', 'power_next', 'power_every', 'arc', 'charge'], ['losePower']),
    cycle:    P('轮回包', '🔄', '#9ec85a', '每回合机制：扩容上限 / 收割 / 爆破（配合「每回合」修饰词更强）。', ['expandEvery', 'harvestEvery', 'detonateEvery'], [], ['turnNum']),
    blood:    P('血液包', '🩸', '#c0394a', '以生命/自身减益/属性为代价，换伤害·治疗·吸血；越惨越强。', ['damage', 'heal', 'lifesteal'], ['hp', 'selfVuln', 'selfWeak', 'selfFrail', 'loseStr', 'loseDex'], ['myDebuff', 'hpLossCount', 'lostHpTurn', 'hurt', 'lowHp']),
    ash:      P('灰烬包', '♨️', '#d86a4a', '消耗：涅槃/不坏（被消耗时再发动/留副本）+ 以消耗手牌/虚无/渣滓为代价。', ['nirvana', 'undying'], ['exhaustCard', 'ethereal', 'makeDross'], ['exhaustPile', 'exhaustedTurn']),
    // ===== 造物 / 药材 / 元素 =====
    summon:   P('召唤包', '👻', '#b0b0e0', '召唤骷髅 + 召唤物修饰词（攻/防/增益投给骷髅、量×2）。', ['summon', 'summon_next', 'summon_every',
      'damage_m', 'damage_next_m', 'damage_every_m', 'block_m', 'block_next_m', 'produce_block_m', 'thorns_m', 'strength_m', 'dexterity_m', 'heal_m'], ['minionHp']),
    dagger:   P('匕首包', '🔪', '#c0a878', '生成（本/下/每回合）/ 强化匕首。', ['makeDagger', 'makeDagger_next', 'makeDagger_every', 'daggerUp'], [], ['daggerPlayed']),
    scrap:    P('甲片包', '🛡️', '#a8b0c0', '生成（本/下/每回合）/ 强化甲片。', ['makeScrap', 'makeScrap_next', 'makeScrap_every', 'scrapUp'], [], ['scrapPlayed']),
    endsword: P('终末之剑包', '🗡️', '#d0c060', '锻造（增伤）/ 招架（增格挡，本/下/每回合），刷新终末之剑。', ['forge', 'forge_next', 'forge_every', 'parry', 'parry_next', 'parry_every']),
    wisp:     P('磷火包', '🟢', '#9ee0a0', '生成磷火(0费得能量保留消耗，本/下/每回合) + 磷火强化 + 幻境(本回合临时牌效果+50%)。', ['makeWisp', 'makeWisp_next', 'makeWisp_every', 'wispUp', 'illusion', 'illusion_next', 'illusion_every']),
    // 魔药：草药+兽血合一（炼药需荤+素配合，拆开无法成菜）
    cook:     P('魔药包', '⚗️', '#b07ad0', '药材（草药 / 兽血）：草药+兽血做成药剂。', ['food_veg', 'food_veg_next', 'food_veg_every', 'food_meat', 'food_meat_next', 'food_meat_every']),
    // 元素：火/水/雷/冰合一（反应需 ≥2 种元素，拆开无法触发反应）
    elements: P('元素包', '⚗️', '#cf6fd0', '附火/水/雷/冰，叠加触发元素反应。', ['fire', 'water', 'thunder', 'ice']),
    // ===== 时点修饰词包（v3.14）=====：自身不带价值；选了它，本局其它已选主题的价值才获得对应「下回合/每回合」变体。
    nextMod:  Object.assign(P('下回合包', '⏭️', '#8fb0d8', '修饰词：本局其它已选主题的价值额外获得「下回合」变体（下个回合开始结算一次）。', []), { timingMod: 'next' }),
    everyMod: Object.assign(P('每回合包', '🔁', '#9ec85a', '修饰词：本局其它已选主题的价值额外获得「每回合」变体（每回合开始重复结算）。', []), { timingMod: 'every' }),
  };
  // 由 (values, costs, conds) 交叉积出可 roll 的词条 id 列表：(energy ∪ costs) × values ∪ conds × values；energy 为通用代价。
  //   time 型代价(生命/金币/自减益…)另含「每回合 V / 下回合 N」变体。供单主题(p.affixes) 与 融合包(buildFusionPack) 共用。
  CG.buildPackAffixes = function (values, costs, conds) {
    const out = [], realCosts = ['energy'].concat(costs || []);
    (values || []).forEach(vid => {
      realCosts.forEach(cid => {
        if (A[cid + '_' + vid]) out.push(cid + '_' + vid);
        if (COST_REAL[cid] && COST_REAL[cid].time) ['V', 'N'].forEach(suf => { if (A[cid + suf + '_' + vid]) out.push(cid + suf + '_' + vid); });   // 代价时点变体
      });
      (conds || []).forEach(cid => { if (A[cid + '_' + vid]) out.push(cid + '_' + vid); });
    });
    return Array.from(new Set(out));   // 去重
  };
  Object.keys(CG.PACKS).forEach(k => {
    const p = CG.PACKS[k];
    // v3.14：剥离所有「有 now 兄弟」的 下/每回合 变体（含召唤物 _m）——它们改由「下回合包/每回合包」修饰词提供；保留 now/非时点/无 now 兄弟者。
    if (!p.timingMod) p.values = (p.values || []).filter(v => !CG.timingSiblings.has(v));
    p.affixes = CG.buildPackAffixes(p.values, p.costs, p.conds);
    p.buffs = p.affixes.slice(); p.debuffs = [];
    // 包「大小」＝价值「含时点变体」的个数：每个价值计 now + (有下回合?+1) + (有每回合?+1)。基础/修饰词包不计入选包预算。
    p.size = (p.values || []).reduce((s, v) => { const t = CG.timingVariants[v]; return s + 1 + (t && t.next ? 1 : 0) + (t && t.every ? 1 : 0); }, 0);
  });
  CG.PACK_IDS = Object.keys(CG.PACKS);

  // —— 原子归主题（用于 gemTheme 显示 / 调试分组 / 百科）——：每个 价值/代价/条件 原子记录其首个所属主题。
  CG.valueHome = {}; CG.costHome = {}; CG.condHome = {};
  CG.PACK_IDS.forEach(pid => {
    const p = CG.PACKS[pid];
    (p.values || []).forEach(v => { if (!CG.valueHome[v]) CG.valueHome[v] = pid; });
    (p.costs || []).forEach(c => { if (!CG.costHome[c]) CG.costHome[c] = pid; });
    (p.conds || []).forEach(c => { if (!CG.condHome[c]) CG.condHome[c] = pid; });
  });

  /* === 词条分组（调试菜单/百科）=== */
  CG.AFFIX_GROUP_ORDER = CG.PACK_IDS.concat(['misc']);
  // 一条词条(分子)的主题＝按「专属代价 → 专属条件 → 价值」优先级归属（energy 通用、不决定主题）。
  CG.affixGroupOf = function (id) {
    const a = A[id]; if (!a) return 'misc';
    const c = a.cost || {};
    if (c.cond && CG.condHome[c.res]) return CG.condHome[c.res];                         // 条件代价：按条件归主题
    if (!c.cond && c.res && c.res !== 'energy' && CG.costHome[c.res]) return CG.costHome[c.res];   // 真资源代价(非能量)：按代价归主题
    const atom = a.value && a.value.atom;
    return (atom && CG.valueHome[atom]) || 'misc';
  };
  CG.affixGroupMeta = function (key) {
    if (key === 'misc' || key === 'general') return { name: '通用', icon: '🎴', color: '#cdd2e2' };
    const p = CG.PACKS[key];
    return p ? { name: p.name, icon: p.icon, color: p.color } : { name: key, icon: '•', color: '#cdd2e2' };
  };
  CG.packLabel = key => { const m = CG.affixGroupMeta(key); return m.icon + ' ' + m.name; };   // 消耗品/遗物主题标签
})(window.CG);

window.CG = window.CG || {};

/* ===========================================================================
 *  卡牌（法杖）+ 宝石（效果载体）—— 借鉴《Noita》法杖系统。
 * ===========================================================================
 *  效果不再绑定在卡牌上，而是绑定在「宝石」上；宝石可镶嵌进卡牌的孔位，也可卸下。
 *
 *  宝石实例 = { uid, affixes:[{id,level}] }      —— 若干增益(buff) + 若干减益(debuff)
 *    实践中：要么「小增益」（1 个低分 buff），要么「大增益 + debuff」（强 buff + 减益）。
 *  卡牌实例 = { uid, base, sockets:[gem|...], limit }
 *    base   = 基底（打击/防御…）决定基础数值与贴图。
 *    sockets= 已镶嵌的宝石（紧凑数组，长度 ≤ limit）。
 *    limit  = 孔位总数（空孔 = limit - sockets.length）。
 *
 *  cardStats(inst, opts) 把基底与所有宝石里的词条聚合成当前数值/效果/卡名。
 *  宝石获取：战斗奖励 / 商店 / 事件；安装免费；卸下花钱并随机附带一个 debuff。
 * ===========================================================================
 */
(function (CG) {
  let _uid = 0;
  CG.nextUid = () => ++_uid;

  CG.BASE_CARDS = {
    // v2：唯一基底＝空法术（法杖）。无攻防之分、本身 0 效果，效果全来自镶嵌的宝石「价值」。
    spell:      { name: '法术', cost: 1, base: 0 },

    // ===== 厨艺包·食材卡（不走宝石聚合，cardStats 转交 foodStats；仅本场战斗、进手牌）=====
    tomato:  { name: '番茄',   cost: 0, type: 'skill',  food: 'veg',  level: 1, icon: '🍅' },
    potato:  { name: '土豆',   cost: 0, type: 'skill',  food: 'veg',  level: 2, icon: '🥔' },
    carrot:  { name: '胡萝卜', cost: 0, type: 'skill',  food: 'veg',  level: 3, icon: '🥕' },
    fish:    { name: '鱼肉',   cost: 0, type: 'skill',  food: 'meat', level: 1, icon: '🐟' },
    chicken: { name: '鸡肉',   cost: 0, type: 'skill',  food: 'meat', level: 2, icon: '🍗' },
    beef:    { name: '牛肉',   cost: 0, type: 'skill',  food: 'meat', level: 3, icon: '🥩' },
    salt:    { name: '盐',     cost: 0, type: 'skill',  food: 'season', season: 'salt',   icon: '🧂' },
    soy:     { name: '酱油',   cost: 0, type: 'skill',  food: 'season', season: 'soy',    icon: '🍶' },
    pepper:  { name: '胡椒',   cost: 0, type: 'skill',  food: 'season', season: 'pepper', icon: '🌶️' },
    cleaver: { name: '菜刀',   cost: 0, type: 'attack', kind: 'cookware', cook: 'cleaver', icon: '🔪' },
    wok:     { name: '铁锅',   cost: 0, type: 'skill',  kind: 'cookware', cook: 'wok',     icon: '🍳' },
    stove:   { name: '火炉',   cost: 0, type: 'attack', kind: 'cookware', cook: 'stove',   icon: '🔥' },
    spoiled_rice: { name: '馊饭', cost: 0, type: 'skill', kind: 'spoiled', spoiled: 'selfdmg', icon: '🍚' },
    stinky_meat:  { name: '臭肉', cost: 0, type: 'skill', kind: 'spoiled', spoiled: 'weak',    icon: '🥓' },
    rotten_veg:   { name: '烂菜', cost: 0, type: 'skill', kind: 'spoiled', spoiled: 'vuln',    icon: '🥬' },
    meal:    { name: '餐点',   cost: 0, type: 'skill',  kind: 'meal', icon: '🍲' },               // 动态：effects 挂在实例 .meal 上
    dross:   { name: '渣滓',   cost: 1, type: 'skill',  kind: 'dross', icon: '🗑️' },              // 消耗包·噩梦塞入：1 费、打出无效果、打出即消耗
    shiv:    { name: '飞刀',   cost: 0, type: 'attack', kind: 'shiv',  icon: '🗡️' },              // 术士包·生成：0 费、造 4 伤害、打出即消耗
  };
  // 食材分类（随机生成用）
  CG.FOODS_BY_CAT = { veg: ['tomato', 'potato', 'carrot'], meat: ['fish', 'chicken', 'beef'], season: ['salt', 'soy', 'pepper'], cookware: ['cleaver', 'wok', 'stove'] };
  CG.isFood = base => { const b = CG.BASE_CARDS[base]; return !!(b && (b.food || b.kind === 'cookware' || b.kind === 'spoiled' || b.kind === 'meal' || b.kind === 'dross' || b.kind === 'shiv')); };

  const MAX_SOCKETS = 5;                 // 单卡孔位上限（加孔/拓孔不超过此值）
  CG.MAX_SOCKETS = MAX_SOCKETS;

  // ---------- 构造 ----------
  CG.makeGem = (affixes = []) =>
    ({ uid: CG.nextUid(), affixes: affixes.map(a => ({ id: a.id, level: a.level })) });
  CG.cloneGem = g => { const n = CG.makeGem(g.affixes); if (g.purified) n.purified = true; return n; };   // 复制宝石（新 uid，保留净化）
  // 净化：去掉一颗宝石的代价（打出时不再支付其代价；条件类代价本无真资源消耗，标记亦无害）。
  CG.gemRemoveCost = gem => { if (gem) gem.purified = true; return !!gem; };
  CG.gemHasCost = gem => !gem.purified && (gem.affixes || []).some(a => { const d = CG.AFFIXES[a.id]; return d && d.cost && !d.cost.cond; });

  // makeCard(base, limit, gems[])：gems 会被深拷贝进新卡（各得新 uid）
  CG.makeCard = (base, limit = 1, gems = []) =>
    ({ uid: CG.nextUid(), base,
       sockets: (gems || []).map(CG.cloneGem),
       limit: Math.max(limit, (gems || []).length) });
  CG.cloneCard = c =>                          // 跑图层深拷贝（保留 uid，用于战斗副本）
    ({ uid: c.uid, base: c.base, limit: c.limit,
       sockets: (c.sockets || []).map(g => { const n = { uid: g.uid, affixes: g.affixes.map(a => ({ id: a.id, level: a.level })) }; if (g.purified) n.purified = true; return n; }) });

  CG.cardEmptySockets = c => Math.max(0, (c.limit || 0) - (c.sockets || []).length);
  CG.gemHasDebuff = g => (g.affixes || []).some(a => CG.isDebuff(a.id));

  // 宝石显示名：增益名 + (减益名)。用于日志/列表标题。
  CG.gemName = function (gem) {
    const bs = (gem.affixes || []).filter(a => !CG.isDebuff(a.id));
    const ds = (gem.affixes || []).filter(a => CG.isDebuff(a.id));
    const nm = bs.map(a => CG.affixDisplayName(a.id, a.level)).join('+');
    return (nm || '空') + (ds.length ? '(' + ds.map(a => CG.affixDisplayName(a.id, a.level)).join('+') + ')' : '');
  };
  CG.gemPrimaryColor = function (gem) {        // 取分数最高的增益颜色作宝石主色
    const bs = (gem.affixes || []).filter(a => !CG.isDebuff(a.id));
    if (!bs.length) return '#9aa0b5';
    bs.sort((a, b) => CG.AFFIXES[b.id].score - CG.AFFIXES[a.id].score);
    return CG.AFFIXES[bs[0].id].color;
  };

  // ---------- 取数 ----------
  CG.cardStats = function (inst, opts) {
    const valueMult = (opts && opts.valueMult) || 1;
    const b = CG.BASE_CARDS[inst.base];
    if (CG.isFood(inst.base)) return CG.foodStats(inst);   // 厨艺食材：固定效果卡，不走宝石聚合
    const order = id => CG.AFFIX_ORDER.indexOf(id);
    const resolve = a => { const def = CG.AFFIXES[a.id]; return { id: a.id, level: a.level, def, debuff: false, name: CG.affixValueText(a.id, a.level), cost: CG.affixCostText(a.id, a.level), color: def.color, desc: CG.affixValueText(a.id, a.level) }; };
    const bySort = (x, y) => order(x.id) - order(y.id);
    const sockets = inst.sockets || [];

    // 每个孔位（宝石）单独分组，供卡面分组显示「(增益+减益)」
    const gemViews = sockets.map(g => {
      const list = (g.affixes || []).map(resolve);
      return { buffs: list.filter(a => !a.debuff).sort(bySort), debuffs: list.filter(a => a.debuff).sort(bySort), purified: !!g.purified };
    });
    const all = sockets.flatMap(g => (g.affixes || []).map(resolve));
    const buffs = all.filter(a => !a.debuff).sort(bySort);
    const debuffs = all.filter(a => a.debuff).sort(bySort);

    let valFlat = 0, valPct = 0, hitsD = 0, repeatX = 0, windfury = 0, energy = 0,
        drawN = 0, prepare = 0, sapStr = 0, sapDex = 0, score = 0,
        costD = 0, nextE = 0, hpLoss = 0, healAmt = 0, lifesteal = 0, silenceLv = 0, pierceN = 0, exhaust = false,
        blockFlat = 0, freeNextN = 0, comboN = 0,
        dmgPool = 0, blkPool = 0, addStrN = 0, goldCostN = 0,   // v3：伤害/格挡来自宝石价值；力量价值；金币代价
        enemyStrN = 0, enemyStrTempN = 0, enemyDexN = 0, enemyDexTempN = 0;
    let addDexN = 0, prepDexN = 0;   // 敏捷价值/临时敏捷价值（与力量对称）   // 敌失力量/敏捷（永久/临时）
    const condBonusList = [];   // v3：条件代价 → 动态缩放数值价值（playCard 结算）
    let elementId = null, elementLevel = 0;                  // 元素附着（火/水/雷/冰）+ 附着层数（=词条等级，多个取最后一个）
    const statuses = {}, selfStatuses = {}, gives = {};      // gives：厨艺包「打出后给某类食材卡」（每个 give 词条给 1 张，食材本身已有等级，不按词条等级翻倍）
    all.forEach(({ def: d }) => { if (d.give) gives[d.give] = (gives[d.give] || 0) + 1; });
    let ashesN = 0, burnSelN = 0, rebornN = 0, selfBurnN = 0, nirvanaN = 0, undyingN = 0, burnAll = false, nightmare = false;  // 消耗包
    let gainPowerN = 0, overclockN = 0, arcN = 0, chargeN = 0, losePowerN = 0, selfThunderN = 0, paralyzeN = 0;   // 电力包
    // === 死守包 ===
    let shieldBashN = 0, lastStandN = 0, keepBlockN = 0, braceN = 0, loseEnergyN = 0, loseBlockN = 0;
    let harvestN = 0, irrigateN = 0, stagnateN = 0;   // === 生产包 ===（push 型词条；farming/stockpile/compound/cropfail/upkeep 走 selfStatus 自动结算）
    // === 留置包 ===
    let retain = false, heldStrikeN = 0, hoardN = 0, chargeUpN = 0, primedN = 0, sluggishN = 0, clutchN = 0;
    // === 强化包 ===（temper/awaken 透传给 playCard；resonance/overforge 在本函数内结算；growth/costDown 是 inst 上的本场永久字段）
    let temperN = 0, awakenN = 0, resonanceN = 0, overforge = false, whetN = 0, quenchN = 0, annealN = 0;
    let emptyMindN = 0, voidEchoN = 0, hollowN = 0;   // === 虚无包 ===（playCard 结算）
    let devoteN = 0, annihilateN = 0, offerN = 0, erodeN = 0, banishN = 0;   // === 虚无包 ===（effects 处理器结算）
    let randbuffN = 0, diceN = 0, coinN = 0, jackpotN = 0, slotsN = 0, misfireN = 0, fickleN = 0, backfireN = 0;   // 奇巧包（随机/赌博）
    let investN = 0, incomeN = 0, tradeN = 0, windfallN = 0, hireN = 0, taxN = 0, inflationN = 0, debtN = 0;       // 市场包（金币）
    let mineN = 0, blastN = 0, prospectN = 0, quarryN = 0, richveinN = 0, caveinN = 0, barrenN = 0, disasterN = 0;  // 矿工包（深度）
    let bellowsN = 0, emberN = 0, smeltN = 0, coolantN = 0, whitehotN = 0, overheatN = 0, crackN = 0, rustN = 0;   // 锻造包（热度）
    const summonList = []; let commandN = 0, cullingN = 0, discordN = 0;   // 召唤包（toll 复用 hpLoss）
    const buildList = []; let demolishN = 0, collapseN = 0, subsideN = 0;  // 建造包（hazard 复用 hpLoss）
    let tossN = 0, siftN = 0, madnessN = 0, reclaimN = 0, dumpsterN = 0;   // 弃牌包（forget→clutch、waste→loseEnergy 复用）
    let conjureN = 0, daggersN = 0, duplicateN = 0, foresightN = 0, mindblastN = 0, clutterN = 0;   // 术士包
    let preyN = 0, exploitN = 0, insightN = 0, reapingN = 0;   // 猎杀包（prey/insight 是 playCard 加成）
    let vigorN = 0, innateN = 0, inspireN = 0, allinN = 0, surplusN = 0, rewindN = 0;   // 律动包（innate/allin/surplus 由 game/playCard 读取）
    let potentN = 0, amppainN = 0, ampgainN = 0, boonN = 0, polarizeN = 0;   // 放大包（potent 是 playCard 加成）
    all.forEach(({ def: d, level: rawL }) => {
      const L = CG.lvVal(rawL);   // 价值倍率：1级×1、2级×2、3级×2（本循环内的 *L 全是价值侧）
      score += (d.score || 0) * L;
      // 注：v2 里 d.value / d.cost 是「代价-价值」描述对象，不再是旧的数值机制字段（已删）。
      if (d.valuePct)  valPct  += d.valuePct * L;
      if (d.hits)      hitsD   += d.hits * L;
      if (d.repeat)    repeatX += d.repeat * L;
      if (d.windfury)  windfury += d.windfury * L;
      if (d.energy)    energy  += d.energy * L;       // 明亮
      if (d.leak)      energy  -= d.leak * L;         // 漏能
      if (d.draw)      drawN   += d.draw * L;
      if (d.prepare)   prepare += d.prepare * L;
      if (d.sapStr)    sapStr  += d.sapStr * L;
      if (d.sapDex)    sapDex  += d.sapDex * L;
      // 能量代价改由「首石免代价」环按 def.cost.res 结算（见下方 socket 代价环）
      if (d.nextEnergy) nextE  += d.nextEnergy * L;   // 透支
      if (d.hpLoss)    hpLoss  += d.hpLoss * L;        // 反噬
      if (d.heal)      healAmt += d.heal * L;          // 回春
      if (d.lifesteal) lifesteal += d.lifesteal * L;   // 吸血
      if (d.silence)   silenceLv = L;                  // 沉默：按等级削减敌人力量
      if (d.pierce)    pierceN  += d.pierce * L;        // 穿刺：额外命中右侧敌人
      if (d.block)     blockFlat += d.block * L;        // 壁垒：附加格挡
      if (d.dmg)       dmgPool += d.dmg * L;            // v2 价值·伤害（strike 等）
      if (d.blk)       blkPool += d.blk * L;            // v2 价值·格挡（guard 等）
      if (d.addStr)    addStrN += d.addStr * L;         // v3 价值·力量
      if (d.addDex)    addDexN += d.addDex * L;
      if (d.prepDex)   prepDexN += d.prepDex * L;
      if (d.enemyStr) { if (d.enemyTemp) enemyStrTempN += d.enemyStr * L; else enemyStrN += d.enemyStr * L; }   // 敌失力量
      if (d.enemyDex) { if (d.enemyTemp) enemyDexTempN += d.enemyDex * L; else enemyDexN += d.enemyDex * L; }   // 敌失敏捷
      if (d.condBonus) condBonusList.push({ qty: d.condBonus.qty, vtype: d.condBonus.vtype, gate: d.condBonus.gate, base: d.condBonus.base, level: L });   // v3 条件代价
      if (d.freeNext)  freeNextN += d.freeNext * L;     // 回响：后续若干张牌免费
      if (d.combo)     comboN   += d.combo * L;         // 连击：每张已出牌追加伤害
      if (d.element) { elementId = d.element; elementLevel = (d.elementBase || 1) * L; }   // 元素附着：附 (base×L) 层（放电=2×L）
      if (d.gainPower) gainPowerN += d.gainPower * L;   // 发电
      if (d.overclock) overclockN += d.overclock * L;   // 改造：超频倍数（消耗电力、数值 ×N）
      if (d.arc)       arcN    += d.arc * L;            // 电弧：数值随电力增长（playCard 结算）
      if (d.charge)    chargeN += d.charge * L;         // 充电：电力→能量
      if (d.losePower) losePowerN += d.losePower * L;   // 漏电
      if (d.selfThunder) selfThunderN += d.selfThunder * L;  // 感电：自身附雷
      if (d.paralyze)  paralyzeN += d.paralyze * L;     // 麻痹：锁住最左 N 张
      // === 死守包 ===
      if (d.shieldBash) shieldBashN += d.shieldBash * L;   // 盾击：伤害随当前格挡增长（在 playCard 结算）
      if (d.lastStand)  lastStandN  += d.lastStand * L;    // 死战：伤害随已损失生命增长（在 playCard 结算）
      if (d.keepBlock)  keepBlockN  += d.keepBlock * L;    // 重甲：格挡回合末保留
      if (d.brace)      braceN     += d.brace * L;         // 严阵：格挡 4×L + 力量 L
      if (d.loseEnergy) loseEnergyN += d.loseEnergy * L;   // 龟缩：失去能量
      if (d.loseBlock)  loseBlockN  += d.loseBlock * L;    // 负重：失去格挡
      // === 生产包 ===
      if (d.harvest)   harvestN  += 1;                   // 丰收：产出层数总和 ×1 → 格挡（无视等级）
      if (d.irrigate)  irrigateN += 1;                   // 灌溉：立即结算 1 次产出（无视等级）
      if (d.stagnate)  stagnateN += Math.min(2, d.stagnate * L);   // 滞产：蓄能/耕作各 -（至多 2）
      // === 留置包 ===
      if (d.retain)     retain = true;                  // 保留：回合结束不弃手
      if (d.heldStrike) heldStrikeN += d.heldStrike * L;  // 蓄力一击：伤害随在手回合数增长（playCard 结算）
      if (d.hoard)      hoardN += d.hoard * L;          // 屯牌：数值随出牌后手牌数增长（playCard 结算）
      if (d.chargeUp)   chargeUpN += d.chargeUp * L;    // 蓄势：每回合在手时 heldBonus += L（_startPlayerTurn）
      if (d.primed)     primedN += d.primed * L;        // 待发：每回合在手时 holdCost -= L（_startPlayerTurn）
      if (d.sluggish)   sluggishN += d.sluggish * L;    // 滞涩：每回合在手时 holdCost += L（_startPlayerTurn）
      if (d.clutch)     clutchN += d.clutch * L;        // 手滑：打出后随机弃 N 张手牌
      if (d.temper)    temperN += d.temper * L;          // 锤炼：打出后本牌成长 +L（在 playCard 结算）
      if (d.awaken)    awakenN += d.awaken * L;          // 觉醒：打出 3 次后跳变 +5×L（在 playCard 结算）
      if (d.resonance) resonanceN += d.resonance * L;    // 共鸣：数值 +（已镶宝石数 × L）
      if (d.overforge) overforge = true;                 // 过锻：成长 ≥6 时碎裂（exhaust）
      if (d.whet)      whetN   += d.whet * L;             // 磨砺：随机一张手牌成长 +L（交给 effects.whet）
      if (d.quench)    quenchN += d.quench;              // 淬火：随机一张手牌永久降费（push 一个 quench 效果）
      if (d.anneal)    annealN += d.anneal * L;           // 退火：随机一张手牌成长 -L
      // === 虚无包 ===
      if (d.emptyMind) emptyMindN += d.emptyMind * L;   // 空明：空手时数值增长（playCard 结算）
      if (d.voidEcho)  voidEchoN  += d.voidEcho * L;    // 虚空回响：空手时数值翻倍（playCard 结算）
      if (d.hollow)    hollowN    += d.hollow * L;       // 空虚：非空手时数值减半（playCard 结算）
      if (d.devote)    devoteN    += d.devote * L;       // 舍身：失血 + 造伤
      if (d.annihilate) annihilateN += d.annihilate * L; // 湮灭：放逐牌堆顶 + 造伤
      if (d.offer)     offerN     += d.offer * L;        // 献祭：减最大生命 + 加力量
      if (d.erode)     erodeN     += d.erode * L;        // 蚀骨：减最大生命
      if (d.banish)    banishN    += d.banish * L;       // 放逐代价：随机放逐手牌
      if (d.ashes)     ashesN  += d.ashes * L;          // 灰烬：数值随消耗堆增长（在 playCard 结算）
      if (d.burnSelect) burnSelN += d.burnSelect * L;   // 燃烧：消耗 N 张手牌（交互）
      if (d.reborn)    rebornN += d.reborn * L;         // 重生：从消耗堆取回 N 张（交互）
      if (d.selfBurn)  selfBurnN += d.selfBurn * L;     // 着火：给自己上灼伤
      if (d.nirvana)   nirvanaN += d.nirvana * L;       // 涅槃：被消耗时打出 N 次
      if (d.undying)   undyingN += d.undying * L;       // 不坏：被消耗时生成 N 副本
      if (d.burnAll)   burnAll = true;                  // 爆燃：消耗其余手牌
      if (d.nightmare) nightmare = true;                // 噩梦：渣滓塞满手牌
      // —— 奇巧包（随机/赌博）——
      if (d.randbuff) randbuffN += d.randbuff * L;     // 百宝箱：随机增益
      if (d.dice)     diceN    += d.dice * L;          // 掷骰：随机伤害
      if (d.coin)     coinN    += d.coin * L;          // 抛硬币：50% 伤害
      if (d.jackpot)  jackpotN += d.jackpot * L;       // 头奖：三选一
      if (d.slots)    slotsN   += d.slots * L;         // 老虎机：每 3 次爆出
      if (d.misfire)  misfireN += d.misfire * L;       // 哑火：25% 自伤
      if (d.fickle)   fickleN  += d.fickle * L;        // 无常：随机自身减益
      if (d.backfire) backfireN += d.backfire * L;     // 走火：50% 误伤
      // —— 市场包 ——
      if (d.invest) investN += d.invest * L; if (d.income) incomeN += d.income * L; if (d.trade) tradeN += d.trade * L; if (d.windfall) windfallN += d.windfall * L; if (d.hire) hireN += d.hire * L;
      if (d.tax) taxN += d.tax * L; if (d.inflation) inflationN += d.inflation * L; if (d.debt) debtN += d.debt * L;
      // —— 矿工包 ——
      if (d.mine) mineN += d.mine * L; if (d.blast) blastN += d.blast * L; if (d.prospect) prospectN += d.prospect * L; if (d.quarry) quarryN += d.quarry * L; if (d.richvein) richveinN += d.richvein * L;
      if (d.cavein) caveinN += d.cavein * L; if (d.barren) barrenN += d.barren * L; if (d.disaster) disasterN += d.disaster * L;
      // —— 锻造包 ——
      if (d.bellows) bellowsN += d.bellows * L; if (d.ember) emberN += d.ember * L; if (d.smelt) smeltN += d.smelt * L; if (d.coolant) coolantN += d.coolant * L; if (d.whitehot) whitehotN += d.whitehot * L;
      if (d.overheat) overheatN += d.overheat * L; if (d.crack) crackN += d.crack * L; if (d.rust) rustN += d.rust * L;
      // —— 召唤包 ——
      if (d.summon) summonList.push({ what: d.summon, level: L });
      if (d.command) commandN += d.command * L; if (d.culling) cullingN += d.culling * L; if (d.discord) discordN += d.discord * L;
      // —— 建造包 ——
      if (d.build) buildList.push({ what: d.build, level: L });
      if (d.demolish) demolishN += d.demolish * L; if (d.collapse) collapseN += d.collapse * L; if (d.subside) subsideN += d.subside * L;
      // —— 弃牌包 ——
      if (d.toss) tossN += d.toss * L; if (d.sift) siftN += d.sift * L; if (d.madness) madnessN += d.madness * L; if (d.reclaim) reclaimN += d.reclaim * L; if (d.dumpster) dumpsterN += d.dumpster * L;
      // —— 术士包 ——
      if (d.conjure) conjureN += d.conjure * L; if (d.daggers) daggersN += d.daggers * L; if (d.duplicate) duplicateN += d.duplicate * L; if (d.foresight) foresightN += d.foresight * L; if (d.mindblast) mindblastN += d.mindblast * L; if (d.clutter) clutterN += d.clutter * L;
      // —— 猎杀包 ——
      if (d.prey) preyN += d.prey * L; if (d.exploit) exploitN += d.exploit * L; if (d.insight) insightN += d.insight * L; if (d.reaping) reapingN += d.reaping * L;
      // —— 律动包 ——
      if (d.vigor) vigorN += d.vigor * L; if (d.innate) innateN += d.innate * L; if (d.inspire) inspireN += d.inspire * L; if (d.allin) allinN += d.allin * L; if (d.surplus) surplusN += d.surplus * L; if (d.rewind) rewindN += d.rewind * L;
      // —— 放大包 ——
      if (d.potent) potentN += d.potent * L; if (d.amppain) amppainN += d.amppain * L; if (d.ampgain) ampgainN += d.ampgain * L; if (d.boon) boonN += d.boon * L; if (d.polarize) polarizeN += d.polarize * L;
      if (d.exhaust)   exhaust = true;                 // 销毁：打出后移除
      if (d.apply) for (const k in d.apply) statuses[k] = (statuses[k] || 0) + d.apply[k] * L;
      if (d.selfStatus) selfStatuses[d.selfStatus] = (selfStatuses[d.selfStatus] || 0) + (d.flat != null ? d.flat : (d.cap != null ? Math.min(d.cap, L) : L));   // flat=无视等级固定值（生产正面）/ cap=封顶（生产负面）
    });
    if (statuses.frozen) statuses.frozen = 1;        // 冰封不随等级叠加：固定跳过 1 次行动

    // === v2 首石免代价 ===：第一颗宝石(socket 0)无视其代价；第二颗起按真资源代价（能量/生命/弃牌）扣。
    //   条件类代价(curBlock/emptyHand…)无真资源消耗，不在此扣（其约束体现在 playCard 求值）。
    // 代价均摊：若多颗宝石代价「种类」相同，只付其中最高的一个（同种不叠付）。
    const costMax = {};
    (sockets || []).forEach((g, si) => {
      if (si === 0 || g.purified) return;            // 首石免代价；净化过的宝石免代价
      (g.affixes || []).forEach(a => {
        const def = CG.AFFIXES[a.id]; if (!def || !def.cost || def.cost.cond) return;
        const amount = (def.cost.amt || 1) * CG.lvCost(a.level);   // 代价倍率：1级×1、2级×2、3级×1
        costMax[def.cost.res] = Math.max(costMax[def.cost.res] || 0, amount);
      });
    });
    costD     += costMax.energy  || 0;
    hpLoss    += costMax.hp      || 0;
    goldCostN += costMax.gold    || 0;
    clutchN   += costMax.discard || 0;

    const socketCount = sockets.length;
    const cost = Math.max(0, (b.cost || 0) + costD + (inst.holdCost || 0) - (inst.costDown || 0));
    // v2：伤害/格挡来自宝石价值池（+ 强化成长）。base.base 恒 0。
    const dmgVal = Math.max(0, (dmgPool + valFlat + (inst.growth || 0) + (inst.heldBonus || 0)) * valueMult);
    const blkVal = Math.max(0, (blkPool + blockFlat) * valueMult);
    if (overforge && (inst.growth || 0) >= 6) exhaust = true;
    const hits = 1 + hitsD;
    const limit = inst.limit == null ? sockets.length : inst.limit;
    const emptySockets = Math.max(0, limit - sockets.length);

    // v3 条件代价：动态缩放某数值价值 → 保证对应类型的效果存在，供 playCard 填量。
    const condDmg = condBonusList.some(c => c.vtype === 'damage');
    const condBlk = condBonusList.some(c => c.vtype === 'block');
    const condHeal = condBonusList.some(c => c.vtype === 'heal');
    const kind = (dmgVal > 0 || condDmg) ? 'damage' : (blkVal > 0 || condBlk) ? 'block' : (healAmt > 0 || condHeal) ? 'heal' : 'skill';
    const value = dmgVal || blkVal || healAmt || 0;

    // 结算效果
    const effects = [];
    if (dmgVal > 0 || condDmg) effects.push({ type: 'damage', value: dmgVal, hits });
    if (blkVal > 0 || condBlk) effects.push({ type: 'block', value: blkVal });
    for (const k in statuses) effects.push({ type: k, value: statuses[k] });               // 给敌人
    for (const k in selfStatuses) effects.push({ type: 'selfStatus', status: k, value: selfStatuses[k] });
    if (energy)  effects.push({ type: 'energy', value: energy });
    if (drawN)   effects.push({ type: 'draw', value: drawN });
    if (healAmt || condHeal) effects.push({ type: 'heal', value: healAmt });
    if (hpLoss)  effects.push({ type: 'loseHp', value: hpLoss });
    if (goldCostN) effects.push({ type: 'loseGold', value: goldCostN });   // v3 金币代价
    if (silenceLv) effects.push({ type: 'silence', value: silenceLv });
    const strDelta = addStrN - sapStr - (costMax.loseStr || 0);   // v3 力量价值 - 减力量 - 失力量代价
    sapDex += (costMax.loseDex || 0);                  // 失敏捷代价（并入 dexDelta）
    const dexDelta = addDexN - sapDex;                 // 敏捷价值 - 减敏捷 - 失敏捷代价                          // 笨拙：永久 -敏捷
    if (strDelta) effects.push({ type: 'strength', value: strDelta });
    if (dexDelta) effects.push({ type: 'dexterity', value: dexDelta });
    if (prepare) effects.push({ type: 'tempStrength', value: prepare });   // 准备：本回合力量 +n（回合末移除）
    if (prepDexN) effects.push({ type: 'tempDexterity', value: prepDexN });   // 临时敏捷（回合末移除）
    for (const w in gives) effects.push({ type: 'give', what: w, value: gives[w] });   // 厨艺：打出后给食材卡
    if (selfBurnN) effects.push({ type: 'selfStatus', status: 'burn', value: selfBurnN });   // 着火：自身灼伤
    // v3 自身减益代价（首石免/同种均摊已在 costMax 处理）：打出时给自己上易伤/虚弱/脆弱。
    if (costMax.selfVuln)  effects.push({ type: 'selfStatus', status: 'vulnerable', value: costMax.selfVuln });
    if (costMax.selfWeak)  effects.push({ type: 'selfStatus', status: 'weak', value: costMax.selfWeak });
    if (costMax.selfFrail) effects.push({ type: 'selfStatus', status: 'frail', value: costMax.selfFrail });
    if (enemyStrN)     effects.push({ type: 'enemyStat', key: 'strength', value: enemyStrN });           // 敌失力量（永久）
    if (enemyStrTempN) effects.push({ type: 'enemyStat', key: 'strength', value: enemyStrTempN, temp: true });
    if (enemyDexN)     effects.push({ type: 'enemyStat', key: 'dexterity', value: enemyDexN });
    if (enemyDexTempN) effects.push({ type: 'enemyStat', key: 'dexterity', value: enemyDexTempN, temp: true });
    if (burnAll)   effects.push({ type: 'exhaustHand' });                                     // 爆燃：消耗其余手牌
    if (nightmare) effects.push({ type: 'nightmare' });                                       // 噩梦：渣滓塞满手牌
    if (gainPowerN) effects.push({ type: 'gainPower', value: gainPowerN });                   // 发电
    if (chargeN)    effects.push({ type: 'charge', value: chargeN });                         // 充电：电力→能量
    if (losePowerN) effects.push({ type: 'losePower', value: losePowerN });                   // 漏电
    if (selfThunderN) effects.push({ type: 'selfElement', element: 'thunder', value: selfThunderN });   // 感电：自身附雷
    if (paralyzeN) effects.push({ type: 'paralyze', value: paralyzeN });                      // 麻痹
    // === 死守包 ===
    if (keepBlockN)  effects.push({ type: 'keepBlock', value: keepBlockN });                  // 重甲：接下来 N 回合格挡不清空
    if (braceN)    { effects.push({ type: 'block', value: braceN }); effects.push({ type: 'tempStrength', value: braceN }); }   // 严阵：格挡 + 本回合力量
    if (loseEnergyN) effects.push({ type: 'loseEnergy', value: loseEnergyN });                // 龟缩：失去能量
    if (loseBlockN)  effects.push({ type: 'loseBlock', value: loseBlockN });                  // 负重：失去格挡
    // === 生产包 ===
    if (harvestN)  effects.push({ type: 'harvest', value: harvestN });                        // 丰收：产出层总和 ×L → 格挡
    if (irrigateN) effects.push({ type: 'irrigate', value: irrigateN });                      // 灌溉：立即产出 L 次
    if (stagnateN) effects.push({ type: 'stagnate', value: stagnateN });                      // 滞产：蓄能/耕作各 -L
    // 弃牌代价改为「自选丢弃」：不 push 随机 clutch；由 playCard 在结算其它效果(含造牌)前逐张提示玩家选弃。
    if (whetN)   effects.push({ type: 'whet', value: whetN });                                // 磨砺：随机手牌成长 +N
    if (quenchN) effects.push({ type: 'quench', value: quenchN });                            // 淬火：随机手牌永久降费
    if (annealN) effects.push({ type: 'anneal', value: annealN });                            // 退火：随机手牌成长 -N
    // === 虚无包 ===
    if (devoteN)     effects.push({ type: 'devote', value: devoteN });                        // 舍身
    if (annihilateN) effects.push({ type: 'annihilate', value: annihilateN });                // 湮灭
    if (offerN)      effects.push({ type: 'offer', value: offerN });                          // 献祭
    if (erodeN)      effects.push({ type: 'erode', value: erodeN });                          // 蚀骨
    if (banishN)     effects.push({ type: 'banish', value: banishN });                        // 放逐代价
    // === 奇巧包 ===（每个词条 push 一个自包含的随机效果，结算时用 CG.RNG → 固定种子可断言）
    if (randbuffN) effects.push({ type: 'randbuff', value: randbuffN });   // 百宝箱：复用祈祷的随机增益
    if (diceN)     effects.push({ type: 'dice', value: diceN });
    if (coinN)     effects.push({ type: 'coinflip', value: coinN });
    if (jackpotN)  effects.push({ type: 'jackpot', value: jackpotN });
    if (slotsN)    effects.push({ type: 'slots', value: slotsN });
    if (misfireN)  effects.push({ type: 'misfire', value: misfireN });
    if (fickleN)   effects.push({ type: 'fickle', value: fickleN });
    if (backfireN) effects.push({ type: 'backfire', value: backfireN });
    // === 市场包 ===（windfall 是 playCard 加成、不在此 push）
    if (investN) effects.push({ type: 'invest', value: investN });
    if (incomeN) effects.push({ type: 'income', value: incomeN });
    if (tradeN)  effects.push({ type: 'trade', value: tradeN });
    if (hireN)   effects.push({ type: 'hire', value: hireN });
    if (taxN)    effects.push({ type: 'tax', value: taxN });
    if (inflationN) effects.push({ type: 'inflation', value: inflationN });
    if (debtN)   effects.push({ type: 'debt', value: debtN });
    // === 矿工包 ===（prospect/quarry 是 playCard 加成、不在此 push）
    if (mineN)   effects.push({ type: 'mine', value: mineN });
    if (blastN)  effects.push({ type: 'blast', value: blastN });
    if (richveinN) effects.push({ type: 'richvein', value: richveinN });
    if (caveinN) effects.push({ type: 'cavein', value: caveinN });
    if (barrenN) effects.push({ type: 'barren', value: barrenN });
    if (disasterN) effects.push({ type: 'disaster', value: disasterN });
    // === 锻造包 ===（ember 是 playCard 加成、不在此 push）
    if (bellowsN) effects.push({ type: 'bellows', value: bellowsN });
    if (smeltN)   effects.push({ type: 'smelt', value: smeltN });
    if (coolantN) effects.push({ type: 'coolant', value: coolantN });
    if (whitehotN) effects.push({ type: 'whitehot', value: whitehotN });
    if (overheatN) effects.push({ type: 'overheat', value: overheatN });
    if (crackN)   effects.push({ type: 'crack', value: crackN });
    if (rustN)    effects.push({ type: 'rust', value: rustN });
    // === 召唤包 ===
    summonList.forEach(s => effects.push({ type: 'summon', what: s.what, value: s.level }));
    if (commandN) effects.push({ type: 'command', value: commandN });
    if (cullingN) effects.push({ type: 'culling', value: cullingN });
    if (discordN) effects.push({ type: 'discord', value: discordN });
    // === 建造包 ===
    buildList.forEach(s => effects.push({ type: 'build', what: s.what, value: s.level }));
    if (demolishN) effects.push({ type: 'demolish', value: demolishN });
    if (collapseN) effects.push({ type: 'collapse', value: collapseN });
    if (subsideN)  effects.push({ type: 'subside', value: subsideN });
    // === 弃牌包 ===（reclaim 走选牌队列、dumpster 是 playCard 加成、forget→clutch、waste→loseEnergy）
    if (tossN)    effects.push({ type: 'toss', value: tossN });
    if (siftN)    effects.push({ type: 'sift', value: siftN });
    if (madnessN) effects.push({ type: 'madness', value: madnessN });
    // === 术士包 ===
    if (conjureN)   effects.push({ type: 'conjure', value: conjureN });
    if (daggersN)   effects.push({ type: 'daggers', value: daggersN });
    if (duplicateN) effects.push({ type: 'duplicate', value: duplicateN });
    if (foresightN) effects.push({ type: 'foresight', value: foresightN });
    if (mindblastN) effects.push({ type: 'mindblast', value: mindblastN });
    if (clutterN)   effects.push({ type: 'clutter', value: clutterN });
    // === 猎杀包 ===（prey/insight 是 playCard 加成、不在此 push）
    if (exploitN) effects.push({ type: 'exploit', value: exploitN });
    if (reapingN) effects.push({ type: 'reaping', value: reapingN });
    // === 律动包 ===（innate/allin/surplus 是 game/playCard 读取、不在此 push）
    if (vigorN)   effects.push({ type: 'vigor', value: vigorN });
    if (inspireN) effects.push({ type: 'inspire', value: inspireN });
    if (rewindN)  effects.push({ type: 'rewind', value: rewindN });
    // === 放大包 ===（potent 是 playCard 加成、不在此 push）
    if (amppainN)  effects.push({ type: 'amppain', value: amppainN });
    if (ampgainN)  effects.push({ type: 'ampgain', value: ampgainN });
    if (boonN)     effects.push({ type: 'boon', value: boonN });
    if (polarizeN) effects.push({ type: 'polarize', value: polarizeN });

    const baseText = ({
      damage:   `造成 ${value} 点伤害` + (hits > 1 ? ` ×${hits}` : '') + '。',
      block:    `获得 ${value} 点格挡。`,
      heal:     `回复 ${value} 点生命。`,
    }[kind] || '');

    // 卡名：法术 + 各宝石「价值」文字 + 空孔 ◇
    const gemText = gemViews.map(g => '(' + g.buffs.concat(g.debuffs).map(a => a.name).join('+') + ')').join('');
    const name = (b.name || '法术') + gemText + '◇'.repeat(emptySockets);

    return {
      base: inst.base, baseName: b.name, cost, type: 'spell', kind, limit, emptySockets, score,
      value, hits, effects, buffs, debuffs, gemViews, baseText, condBonus: condBonusList,
      repeatTimes: 1 + repeatX,
      windfury, lifesteal, exhaust, pierce: pierceN,
      freeNext: freeNextN, combo: comboN, element: elementId, elementLevel,
      ashes: ashesN, burnSelect: burnSelN, reborn: rebornN, nirvana: nirvanaN, undying: undyingN,   // 消耗包
      overclock: overclockN, arc: arcN,                                          // 电力包（playCard 用）
      shieldBash: shieldBashN, lastStand: lastStandN,                            // 死守包（playCard 用）
      retain, heldStrike: heldStrikeN, hoard: hoardN, chargeUp: chargeUpN, primed: primedN, sluggish: sluggishN,   // === 留置包 ===
      temper: temperN, awaken: awakenN,                                          // 强化包（playCard 用）
      emptyMind: emptyMindN, voidEcho: voidEchoN, hollow: hollowN,               // === 虚无包 ===（playCard 用）
      windfall: windfallN, prospect: prospectN, quarry: quarryN, ember: emberN,  // 市场/矿工/锻造（playCard 用）
      reclaim: reclaimN, dumpster: dumpsterN, discardCost: clutchN,                                     // 弃牌包（reclaim 选牌队列、dumpster playCard 加成）
      prey: preyN, insight: insightN,                                             // 猎杀包（playCard 加成）
      innate: innateN, allin: allinN, surplus: surplusN,                          // 律动包（innate=开局抽序、allin/surplus=playCard）
      potent: potentN,                                                            // 放大包（playCard 加成）
      nextEnergyPenalty: -nextE,
      name,
    };
  };

  // ===========================================================================
  //  厨艺包：食材 / 餐点 / 菜谱
  // ===========================================================================
  const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
  CG.randomFood = cat => rnd(CG.FOODS_BY_CAT[cat] || ['tomato']);
  // 食材卡实例（无孔位）；meal 把动态效果挂在 .meal 上
  CG.makeFoodCard = (base, meal) => { const c = { uid: CG.nextUid(), base }; if (base === 'meal') c.meal = meal || { effects: [], name: '餐点', desc: '', repeatTimes: 1 }; return c; };

  // 菜谱矩阵：荤菜 × 素菜 → 效果种类（数值 = 素菜等级 × 荤菜等级 × 2）
  CG.RECIPE = {
    fish:    { tomato: 'heal',     potato: 'regen',  carrot: 'thorns' },
    chicken: { tomato: 'strength', potato: 'block',  carrot: 'dexterity' },
    beef:    { tomato: 'draw',     potato: 'energy', carrot: 'echo' },
  };
  const RECIPE_LABEL = { heal: '回复', regen: '再生', thorns: '荆棘', strength: '力量', block: '壁垒', dexterity: '敏捷', draw: '抽取', energy: '明亮', echo: '回响' };
  function recipeEffect(kind, value) {
    switch (kind) {
      case 'heal':      return { type: 'heal', value };
      case 'regen':     return { type: 'selfStatus', status: 'regen', value };
      case 'thorns':    return { type: 'selfStatus', status: 'thorns', value };
      case 'strength':  return { type: 'strength', value };
      case 'block':     return { type: 'block', value };
      case 'dexterity': return { type: 'dexterity', value };
      case 'draw':      return { type: 'draw', value };
      case 'energy':    return { type: 'energy', value };
      case 'echo':      return { type: 'freeNext', value };
      default:          return { type: 'heal', value };
    }
  }
  // 做菜：素菜(必填) + 荤菜(可选) + 调味料(可选) → 餐点 spec { effects, repeatTimes, name, desc, value }
  CG.buildMeal = function (vegBase, meatBase, seasonBase) {
    const veg = CG.BASE_CARDS[vegBase];
    let kind, label, value, name;
    if (meatBase) {
      const meat = CG.BASE_CARDS[meatBase];
      kind = (CG.RECIPE[meatBase] && CG.RECIPE[meatBase][vegBase]) || 'heal';
      label = RECIPE_LABEL[kind];
      value = veg.level * meat.level * 4;                 // 高级原料数值相乘 ×4
      name = `${veg.name}炖${meat.name}`;
    } else {
      kind = 'heal'; label = '回复'; value = veg.level * 2;   // 只放素菜 = 清炒，回复其等级 ×2
      name = `清炒${veg.name}`;
    }
    let repeatTimes = 1, tag = '', nourish = 0;
    if (seasonBase) {
      const s = CG.BASE_CARDS[seasonBase].season;
      if (s === 'salt')   { value *= 2;          tag = '·盐(过载)'; }     // 过载：数值 +100%
      else if (s === 'soy')   { nourish = 1;     tag = '·酱油(滋养)'; }   // 滋养：餐点获得滋养1（治疗效率 +50%，本场持续）
      else if (s === 'pepper') { repeatTimes = 2; tag = '·胡椒(重复)'; }  // 重复：结算 2 次
    }
    const effects = [];
    if (nourish) effects.push({ type: 'selfStatus', status: 'nourish', value: nourish });   // 放主效果之前 → 本餐治疗也享受 +50%
    effects.push(recipeEffect(kind, value));
    const times = repeatTimes > 1 ? ` ×${repeatTimes}` : '';
    const desc = `${nourish ? '滋养 1，' : ''}${label} ${value}${times}（餐点·0费消耗）`;
    return { effects, repeatTimes, value, name: name + tag, desc };
  };

  // 食材卡的「固定」stats（替代 cardStats 的宝石聚合）。返回与 cardStats 同结构的对象。
  CG.foodStats = function (inst) {
    const b = CG.BASE_CARDS[inst.base];
    const s = {
      base: inst.base, baseName: b.name, cost: b.cost || 0, type: b.type, kind: b.kind || 'food',
      value: 0, hits: 1, effects: [], buffs: [], debuffs: [], gemViews: [], limit: 0, emptySockets: 0, score: 0,
      repeatTimes: 1, windfury: 0, lifesteal: 0, exhaust: false, pierce: 0, freeNext: 0, combo: 0,
      element: null, elementLevel: 0, ashes: 0, burnSelect: 0, reborn: 0, nirvana: 0, undying: 0,
      overclock: 0, arc: 0, shieldBash: 0, lastStand: 0, temper: 0, awaken: 0,
      retain: false, heldStrike: 0, hoard: 0, chargeUp: 0, primed: 0, sluggish: 0,   // === 留置/强化包 ===
      emptyMind: 0, voidEcho: 0, hollow: 0,   // === 虚无包 ===
      windfall: 0, prospect: 0, quarry: 0, ember: 0,   // 市场/矿工/锻造（playCard 加成默认）
      reclaim: 0, dumpster: 0,                          // 弃牌包默认
      prey: 0, insight: 0,                              // 猎杀包默认
      innate: 0, allin: 0, surplus: 0,                  // 律动包默认
      potent: 0,                                        // 放大包默认
      nextEnergyPenalty: 0, noPlay: false, food: b.food || null, icon: b.icon || '',
      name: b.name, baseText: '',
    };
    if (b.food === 'veg')  { s.kind = 'veg';  s.value = b.level; s.baseText = `做菜：打出后选荤菜/调料做成餐点（不选则＝回复 ${b.level}）`; }
    else if (b.food === 'meat') { s.kind = 'meat'; s.value = b.level; s.effects = [{ type: 'heal', value: b.level }]; s.baseText = `吃下回复 ${b.level} 生命（做菜时可当荤菜）`; }
    else if (b.food === 'season') { s.kind = 'season'; s.noPlay = true; const m = { salt: '过载1', soy: '滋养1', pepper: '重复1' }; s.baseText = `调味料·不能单独吃；做菜时让餐点获得「${m[b.season]}」`; }
    else if (b.kind === 'cookware') {
      if (b.cook === 'cleaver') { s.type = 'attack'; s.value = 10; s.effects = [{ type: 'damage', value: 10 }]; s.baseText = '造成 10 点伤害（厨具·可当武器）'; }
      else if (b.cook === 'wok') { s.value = 8; s.effects = [{ type: 'block', value: 8 }]; s.baseText = '获得 8 点格挡（厨具·可当武器）'; }
      else if (b.cook === 'stove') { s.type = 'attack'; s.element = 'fire'; s.elementLevel = 3; s.baseText = '给敌人附火 3 层（厨具·可当武器）'; }
    } else if (b.kind === 'spoiled') {
      s.noPlay = true;
      const m = { selfdmg: '回合结束失去 2 生命', weak: '回合结束自身虚弱 2', vuln: '回合结束自身易伤 2' };
      s.baseText = `腐坏·不能打出；${m[b.spoiled]}`;
    } else if (b.kind === 'meal') {
      const meal = inst.meal || { effects: [], name: '餐点', desc: '', repeatTimes: 1 };
      s.exhaust = true; s.effects = meal.effects || []; s.repeatTimes = meal.repeatTimes || 1;
      s.value = meal.value || 0; s.name = s.baseName = meal.name || '餐点'; s.baseText = meal.desc || '';
    } else if (b.kind === 'dross') {
      s.exhaust = true; s.baseText = '渣滓：打出无任何效果，打出即消耗（噩梦塞入）';
    } else if (b.kind === 'shiv') {
      s.type = 'attack'; s.value = 4; s.exhaust = true; s.effects = [{ type: 'damage', value: 4 }]; s.baseText = '飞刀：造成 4 点伤害，打出即消耗';
    }
    return s;
  };

  // ---------- 随机词条 / 宝石生成 ----------
  function weightedPick(pairs) {
    const t = pairs.reduce((s, p) => s + p[1], 0);
    let r = Math.random() * t;
    for (const [v, w] of pairs) if ((r -= w) < 0) return v;
    return pairs[pairs.length - 1][0];
  }
  CG.rollAffixLevel = () => weightedPick((CG.CONFIG && CG.CONFIG.upgradeLevelWeights) || [[1, 4], [2, 3], [3, 2]]);

  // strong=true 偏向高分（强力）增益；否则偏向低分（朴素）增益。pool 为候选词条 id 列表。
  function pickBuffId(pool, owned, strong) {
    const p = pool.filter(id => !owned.has(id))
      .map(id => [id, strong ? Math.max(1, CG.AFFIXES[id].score) : Math.max(1, 8 - CG.AFFIXES[id].score)]);
    return p.length ? weightedPick(p) : null;
  }
  function pickDebuffId(pool, owned) {              // 严重 debuff 更稀有（score 越负越稀有）
    const p = pool.filter(id => !owned.has(id)).map(id => [id, Math.max(1, 6 + CG.AFFIXES[id].score)]);
    return p.length ? weightedPick(p) : null;
  }

  // 本局选定的「主题」集合（null = 全部）。开局由 Run 设定：默认基础主题 + 3 个随机主题，可在开始菜单自选。
  // 选定后把这些主题「融合」成唯一的一个 `CG.PACKS.fusion`：本局所有扩充包都＝这个融合包（主题混合）。
  let _activePacks = null;
  CG.setActivePacks = function (ids) { _activePacks = (ids && ids.length) ? ids.slice() : null; CG.buildFusionPack(_activePacks); };
  CG.getActivePacks = function () { return _activePacks; };
  // 把选定的主题融合成「一个」融合包：增益池 = 各主题增益之并集，减益池同理。每颗宝石都从这个并集里抽 → 主题混合。
  CG.buildFusionPack = function (ids) {
    if (!ids || !ids.length) { if (CG.PACKS) delete CG.PACKS.fusion; return null; }
    const buffs = [], debuffs = [];
    ids.forEach(id => { const p = CG.PACKS && CG.PACKS[id]; if (!p || p.fusion) return; (p.buffs || []).forEach(b => buffs.push(b)); (p.debuffs || []).forEach(d => debuffs.push(d)); });
    const names = ids.map(id => (CG.PACKS[id] || {}).name).filter(Boolean);
    CG.PACKS.fusion = { id: 'fusion', fusion: true, name: '融合包', icon: '🌀', color: '#b59ad8', themes: ids.slice(), buffs, debuffs, desc: '本局融合主题：' + names.join('、') };
    return CG.PACKS.fusion;
  };
  CG.fusionPack = function () { return (CG.PACKS && CG.PACKS.fusion) || null; };
  // 一颗宝石属于哪个「主题」（按其首个增益所在的主题分组）——用于在融合奖励里标注每颗宝石的取向。
  CG.gemTheme = function (gem) {
    const af = (gem && gem.affixes) || [];
    const a = af.find(x => !CG.isDebuff(x.id)) || af[0];
    if (!a) return null;
    const key = CG.affixGroupOf ? CG.affixGroupOf(a.id) : null;
    return (key && CG.PACKS && CG.PACKS[key]) || null;
  };
  // 开局默认主题：恒含「基础」+ 从其它主题里随机 4 个（玩家可在开始菜单改选任意主题，全部融合）。
  CG.rollRunPacks = function () {
    const themed = (CG.PACK_IDS || []).filter(id => id !== 'basic' && id !== 'fusion');
    for (let i = themed.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [themed[i], themed[j]] = [themed[j], themed[i]]; }
    return ['basic'].concat(themed.slice(0, 4));
  };
  // 选包：本局有融合包时恒返回它（所有扩充包都＝融合包）；否则（无 run/单测）按权重在全部主题里兜底选一个。
  CG.pickPack = function (tier) {
    if (CG.PACKS && CG.PACKS.fusion) return 'fusion';
    let w = (CG.CONFIG && CG.CONFIG.packW && tier && CG.CONFIG.packW[tier]) || null;
    if (w) w = w.filter(p => p[0] !== 'basic' && (!_activePacks || _activePacks.includes(p[0])));   // 基础包无增益、不作单独产石源（融合时只贡献减益）
    if (w && w.length) return weightedPick(w);
    const ids = (_activePacks || ((CG.PACKS && Object.keys(CG.PACKS)) || [])).filter(id => id !== 'basic' && id !== 'fusion');
    return ids.length ? ids[Math.floor(Math.random() * ids.length)] : 'power';
  };
  // 把「包 id / 包对象 / 空」解析成一个含 {buffs, debuffs} 的包对象（空则按 tier 自动选包）。
  function resolvePack(packOrId, tier) {
    let p = typeof packOrId === 'string' ? (CG.PACKS && CG.PACKS[packOrId]) : packOrId;
    if (!p && CG.PACKS) p = CG.PACKS[CG.pickPack(tier)];
    return p || { buffs: CG.BUFF_ORDER, debuffs: CG.DEBUFF_ORDER };
  }

  // 生成一颗宝石。opts: { tier:'monster'|'elite'|'boss', big:bool, minLevel:int, level:int, pack:id|obj }
  //   小宝石 = 1 个朴素增益；大宝石 = 强增益(可多个) + 减益。
  //   词条只从 pack 的增益/减益池里抽；不传 pack 时按 tier 自动选一个包（“所有产宝石处都按包”）。
  CG.rollGem = function (opts) {
    opts = opts || {};
    const tier = opts.tier || 'monster';
    const pack = resolvePack(opts.pack, tier);
    const buffPool = pack.buffs;
    const gcfg = (CG.CONFIG && CG.CONFIG.gem) || {};
    const lvW = (gcfg.levelW && gcfg.levelW[tier]) || [[1, 6], [2, 3], [3, 1]];
    // v3：宝石 = 1 个词条（一颗分子）。tier 只影响等级权重（big 不再加词条，只抬等级下限）。
    const big = opts.big != null ? opts.big : Math.random() < ((gcfg.bigChance && gcfg.bigChance[tier]) || 0.35);
    let L = opts.level || weightedPick(lvW);
    if (big && L < 2) L = 2;
    if (opts.minLevel && L < opts.minLevel) L = opts.minLevel;
    const id = pickBuffId(buffPool, new Set(), big) || buffPool[0] || CG.BUFF_ORDER[0];
    return CG.makeGem([{ id, level: L }]);
  };

  // 卸下宝石时随机附带一个 debuff（已满则不再加）。这是「降级惩罚」，从全部减益池抽（不限包）。
  CG.gemAddRandomDebuff = function (gem) {
    const owned = new Set((gem.affixes || []).filter(a => CG.isDebuff(a.id)).map(a => a.id));
    const id = pickDebuffId(CG.DEBUFF_ORDER, owned);
    if (id) gem.affixes.push({ id, level: 1 });
    return id;
  };
  // 净化：移除宝石的一个减益（优先移除最严重的）
  CG.gemRemoveOneDebuff = function (gem) {
    const idx = (gem.affixes || []).map((a, i) => [a, i]).filter(([a]) => CG.isDebuff(a.id))
      .sort((x, y) => CG.AFFIXES[x[0].id].score - CG.AFFIXES[y[0].id].score)[0];
    if (idx) gem.affixes.splice(idx[1], 1);
    return !!idx;
  };
  // 重铸：增益/减益数量不变，全部重掷（自动选一个包，重掷出的词条都来自该包）。
  CG.recutGem = function (gem) {
    const B = (gem.affixes || []).filter(a => !CG.isDebuff(a.id)).length;
    const D = (gem.affixes || []).length - B;
    const pack = resolvePack(null, null);
    const ob = new Set(), od = new Set(), out = [];
    for (let i = 0; i < B; i++) { const id = pickBuffId(pack.buffs, ob, i === 0); if (!id) break; ob.add(id); out.push({ id, level: CG.rollAffixLevel() }); }
    for (let i = 0; i < D; i++) { const id = pickDebuffId(pack.debuffs, od); if (!id) break; od.add(id); out.push({ id, level: 1 }); }
    gem.affixes = out.length ? out : gem.affixes;
  };

  // ---------- 镶嵌 / 卸下 ----------
  CG.installGem = function (card, gem) {                   // 装入一个空孔（成功返回 true）
    if (CG.cardEmptySockets(card) <= 0) return false;
    card.sockets = card.sockets || [];
    card.sockets.push(gem);
    return true;
  };
  CG.uninstallGem = function (card, socketIdx) {           // 卸下：取出宝石、随机加一个 debuff、返回该宝石
    const gem = (card.sockets || [])[socketIdx];
    if (!gem) return null;
    card.sockets.splice(socketIdx, 1);
    CG.gemAddRandomDebuff(gem);
    return gem;
  };
  CG.addSocket = function (card) { if ((card.limit || 0) < MAX_SOCKETS) { card.limit = (card.limit || 0) + 1; return true; } return false; };

  // ---------- 价格 ----------
  // 宝石售价：增益等级越高越贵，减益少量降价（下限 12）
  CG.gemPrice = function (gem) {
    const bl = (gem.affixes || []).filter(a => !CG.isDebuff(a.id)).reduce((s, a) => s + a.level, 0);
    const dn = (gem.affixes || []).filter(a => CG.isDebuff(a.id)).length;
    return Math.max(12, 18 + 16 * bl - 8 * dn);
  };
  // 卡牌（法杖）售价：按孔位数计（空法杖也值钱，孔越多越贵）
  CG.cardPrice = card => 24 + 22 * Math.max(1, (card.limit || 1) - 1) +
    14 * (card.sockets || []).reduce((s, g) => s + g.affixes.filter(a => !CG.isDebuff(a.id)).reduce((t, a) => t + a.level, 0), 0);

  // ---------- 职业 / 初始牌组 ----------
  CG.CLASS_IDS = ['warrior', 'shield', 'priest'];
  CG.CLASSES = {
    warrior: { name: '战士', icon: '⚔️', desc: '5 攻击法术 + 5 格挡法术；攻守均衡。', shopCard: 'spell' },
    shield:  { name: '盾兵', icon: '🛡️', desc: '4 攻击 + 6 格挡法术；侧重防守。', shopCard: 'spell' },
    priest:  { name: '牧师', icon: '✚',  desc: '4 攻击 + 4 格挡 + 2 治疗法术；续航流。', shopCard: 'spell' },
  };
  // 按职业构建初始牌组：每张卡＝空法术 + 一颗「无代价首石」+ 1 个空孔（可镶第二颗，付代价/均摊）。
  CG.buildDeck = function (cls) {
    const gemmed = valId => CG.makeCard('spell', 2, [CG.makeGem([{ id: valId, level: 1 }])]);
    const rep = (valId, n) => Array.from({ length: n }, () => gemmed(valId));
    if (cls === 'shield') return [...rep(CG.STRIKE, 4), ...rep(CG.GUARD, 6)];
    if (cls === 'priest') return [...rep(CG.STRIKE, 4), ...rep(CG.GUARD, 4), ...rep(CG.HEAL, 2)];
    return [...rep(CG.STRIKE, 5), ...rep(CG.GUARD, 5)];   // warrior（默认）
  };
})(window.CG);

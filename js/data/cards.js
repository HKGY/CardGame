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
    spoiled_rice: { name: '馊饭', cost: 0, type: 'skill', kind: 'spoiled', spoiled: 'selfdmg', icon: '🍚' },
    stinky_meat:  { name: '臭肉', cost: 0, type: 'skill', kind: 'spoiled', spoiled: 'weak',    icon: '🥓' },
    rotten_veg:   { name: '烂菜', cost: 0, type: 'skill', kind: 'spoiled', spoiled: 'vuln',    icon: '🥬' },
    meal:    { name: '餐点',   cost: 0, type: 'skill',  kind: 'meal', icon: '🍲' },               // 动态：effects 挂在实例 .meal 上
    dross:   { name: '渣滓',   cost: 1, type: 'skill',  kind: 'dross', icon: '🗑️' },              // 消耗包·噩梦塞入：1 费、打出无效果、打出即消耗
    shiv:    { name: '飞刀',   cost: 0, type: 'attack', kind: 'shiv',  icon: '🗡️' },              // 术士包·生成：0 费、造 4 伤害、打出即消耗
    dagger:  { name: '匕首',   cost: 0, type: 'attack', kind: 'dagger', icon: '🔪' },             // 兵械包：0 费、造 4(+强化)伤害、打出即消耗
    scrap:   { name: '甲片',   cost: 0, type: 'skill',  kind: 'scrap',  icon: '🛡️' },             // 兵械包：0 费、获得 3(+强化)格挡、打出即消耗
    endsword:{ name: '终末之剑', cost: 2, type: 'attack', kind: 'endsword', icon: '⚔️' },          // 兵械包·锻造创造：2 费、造 10(+锻造)伤害(+招架格挡)、保留
    peek:    { name: '洞悉',   cost: 0, type: 'skill',  kind: 'peek',  icon: '🔮' },               // 机巧包：0 费、抽 2 张、打出即消耗
    wisp:    { name: '磷火',   cost: 0, type: 'skill',  kind: 'wisp',  icon: '🟢' },               // 0 费、获得 1(+强化)能量、保留、打出即消耗
  };
  // 食材分类（随机生成用）
  CG.FOODS_BY_CAT = { veg: ['tomato', 'potato', 'carrot'], meat: ['fish', 'chicken', 'beef'], season: ['salt', 'soy', 'pepper'] };
  CG.isFood = base => { const b = CG.BASE_CARDS[base]; return !!(b && (b.food || b.kind === 'spoiled' || b.kind === 'meal' || b.kind === 'dross' || b.kind === 'shiv' || b.kind === 'dagger' || b.kind === 'scrap' || b.kind === 'endsword' || b.kind === 'peek' || b.kind === 'wisp')); };

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
  // 宝石等级图标：1/2/3 级用三个不同 emoji 直观区分（取宝石内词条最高等级）。
  CG.GEM_LEVEL_ICONS = { 1: '🔹', 2: '🔷', 3: '💠' };
  CG.gemLevel = function (gem) { const lv = (gem.affixes || []).map(a => a.level || 1); return lv.length ? Math.max.apply(null, lv) : 1; };
  CG.gemLevelIcon = function (gem) { return CG.GEM_LEVEL_ICONS[Math.min(3, Math.max(1, CG.gemLevel(gem)))] || '💎'; };

  // ---------- 取数 ----------
  CG.cardStats = function (inst, opts) {
    const valueMult = (opts && opts.valueMult) || 1;
    const b = CG.BASE_CARDS[inst.base];
    if (CG.isFood(inst.base)) return CG.foodStats(inst);   // 厨艺食材：固定效果卡，不走宝石聚合
    const order = id => CG.AFFIX_ORDER.indexOf(id);
    const resolve = a => { const def = CG.AFFIXES[a.id]; return { id: a.id, level: a.level, def, debuff: false, name: CG.affixShort(a.id, a.level), cost: CG.affixCostText(a.id, a.level), color: def.color, desc: CG.affixValueText(a.id, a.level) }; };   // name=短形(卡名chip)、desc=自然句
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
    const everyTurnList = [], nextTurnList = [], minionNowList = [];   // v3.1 时点：每回合/下回合 调度；minionNow=本回合召唤物效果（投给骷髅）
    let elementId = null, elementLevel = 0;                  // 元素附着（火/水/雷/冰）+ 附着层数（=词条等级，多个取最后一个）
    const statuses = {}, selfStatuses = {}, gives = {};      // gives：厨艺包「打出后给某类食材卡」（每个 give 词条给 1 张，食材本身已有等级，不按词条等级翻倍）
    all.forEach(({ def: d }) => { if (d.give) gives[d.give] = (gives[d.give] || 0) + 1; });
    let nirvanaN = 0, undyingN = 0;   // 灰烬包：涅槃/不坏（被消耗时再发动/留副本）
    let gainPowerN = 0, arcN = 0, chargeN = 0, losePowerN = 0;   // 电力 / 电弧包
    let retain = false, clutchN = 0;   // 持留包·保留 / 弃牌代价计数（clutchN += costMax.discard）
    let temperN = 0;     // 强化包：锤炼（打出后本牌成长，playCard 结算）
    let summonN = 0;     // 召唤包：骷髅血量上限增量
    let conjureN = 0, duplicateN = 0, mindblastN = 0;   // 造牌 / 术法包
    let vigorN = 0;      // 强袭包：活力（下一张造成伤害的牌加成）
    let multiHitN = 0;   // 连击包：每层 +1 次攻击命中
    let multiN = 0;      // 放大包·多重：消耗全部能量、整张牌重复（次数=能量）
    let potentN = 0;     // 放大包：翻倍（potent 是 playCard 加成）
    // 新批价值字段（v3.6）：累加（按等级），再统一拆成效果/卡级字段
    const NB = {};
    const NB_EFF = { recallDiscard: 'recallDiscard', recycleDraw: 'recycleDraw', playTopDraw: 'playFromDraw', socketRand: 'socketRandom', debuffMult: 'debuffMult', vulnAmp: 'vulnAmp', weakAmp: 'weakAmp', makeDagger: 'makeDagger', makeScrap: 'makeScrap', daggerUp: 'daggerUp', scrapUp: 'scrapUp', immune: 'immune', keepBlockFull: 'keepBlockFull', dmgCap1: 'dmgCap1', tempThorns: 'tempThorns', addThorns: 'thorns', forge: 'forge', parry: 'parry', makePeek: 'makePeek', expandEvery: 'expandEvery', harvestEvery: 'harvestEvery', detonateEvery: 'detonateEvery', recycle: 'recycle', corpseBomb: 'corpseBomb', catalyze: 'catalyze', regen: 'regen', makeWisp: 'makeWisp', illusion: 'illusion', peekUp: 'peekUp', wispUp: 'wispUp' };   // 注：vigor 走既有 vigorN 路径；v3.12 尸爆/催发/再生；v3.13 磷火/幻境/洞悉强化/磷火强化
    const NB_FIELD = ['copyToDiscard', 'growDmg', 'growBlk', 'selfCostDown', 'aoe', 'playTwice', 'wish', 'curseStrike', 'dmgToBlock'];
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
      if (d.condBonus) condBonusList.push({ qty: d.condBonus.qty, atom: d.condBonus.atom, gate: d.condBonus.gate, mult: d.condBonus.mult, fy: d.condBonus.fy, fx: d.condBonus.fx, level: L });   // v3 条件代价（量型走 fy/fx 整数分数；门型走 mult 定额）
      if (d.everyTurn) d.everyTurn.forEach(e => everyTurnList.push(Object.assign({}, e, { value: (e.value || 0) * L })));   // 每回合：按等级缩放后调度
      if (d.nextTurn)  d.nextTurn.forEach(e => nextTurnList.push(Object.assign({}, e, { value: (e.value || 0) * L })));     // 下回合：同上
      if (d.minionNow) minionNowList.push(Object.assign({}, d.minionNow, { value: (d.minionNow.value || 0) * L }));         // 召唤物·本回合：投给骷髅的效果（minion:true）
      if (d.freeNext)  freeNextN += d.freeNext * L;     // 回响：后续若干张牌免费
      if (d.combo)     comboN   += d.combo * L;         // 连击：每张已出牌追加伤害
      if (d.element) { elementId = d.element; elementLevel = (d.elementBase || 1) * L; }   // 元素附着：附 (base×L) 层（放电=2×L）
      if (d.gainPower) gainPowerN += d.gainPower * L;   // 发电
      if (d.arc)       arcN    += d.arc * L;            // 电弧：数值随电力增长（playCard 结算）
      if (d.charge)    chargeN += d.charge * L;         // 充电：电力→能量
      if (d.losePower) losePowerN += d.losePower * L;   // 漏电（消耗电力代价）
      if (d.retain)    retain = true;                   // 保留：回合结束不弃手
      if (d.temper)    temperN += d.temper * L;         // 锤炼：打出后本牌成长 +L（playCard 结算）
      if (d.nirvana)   nirvanaN += d.nirvana * L;       // 涅槃：被消耗时再发动 N 次
      if (d.undying)   undyingN += d.undying * L;       // 不坏：被消耗时生成 N 副本
      if (d.summon) summonN += d.summon * L;   // 召唤：骷髅血量上限增量
      if (d.conjure) conjureN += d.conjure * L; if (d.duplicate) duplicateN += d.duplicate * L; if (d.mindblast) mindblastN += d.mindblast * L;   // 术士/术法
      if (d.vigor) vigorN += d.vigor * L;   // 活力（强袭包）
      if (d.multiHit) multiHitN += d.multiHit * L;   // 连击：每层 +1 次攻击命中
      for (const k in NB_EFF) if (d[k]) NB[k] = (NB[k] || 0) + d[k] * L;   // 新批：效果型字段
      for (const k of NB_FIELD) if (d[k]) NB[k] = (NB[k] || 0) + d[k] * L; // 新批：卡级字段
      if (d.multi)    multiN += d.multi;   // 多重为标志位（maxCount 1、不随等级）
      if (d.potent) potentN += d.potent * L;   // 放大：翻倍（playCard 加成）
      if (d.exhaust)   exhaust = true;                 // 销毁：打出后移除
      if (d.apply) for (const k in d.apply) statuses[k] = (statuses[k] || 0) + d.apply[k] * L;
      if (d.selfStatus) selfStatuses[d.selfStatus] = (selfStatuses[d.selfStatus] || 0) + (d.flat != null ? d.flat : (d.cap != null ? Math.min(d.cap, L) : L));   // flat=无视等级固定值（生产正面）/ cap=封顶（生产负面）
    });
    if (statuses.frozen) statuses.frozen = 1;        // 冰封不随等级叠加：固定跳过 1 次行动

    // === v2 首石免代价 ===：第一颗宝石(socket 0)无视其代价；第二颗起按真资源代价（能量/生命/弃牌）扣。
    //   条件类代价(curBlock/emptyHand…)无真资源消耗，不在此扣（其约束体现在 playCard 求值）。
    // 代价均摊：若多颗宝石代价「种类」相同，只付其中最高的一个（同种不叠付）。
    const costMax = {};
    // 代价时点（#2）：每回合/下回合 代价 → 调度成「自损」效果（价值仍当回合即得）。
    const costLossEff = (res, amt) => {
      if (res === 'hp') return { type: 'loseHp', value: amt };
      if (res === 'gold') return { type: 'loseGold', value: amt };
      const st = { selfVuln: 'vulnerable', selfWeak: 'weak', selfFrail: 'frail' }[res];
      return st ? { type: 'selfStatus', status: st, value: amt } : null;
    };
    (sockets || []).forEach((g, si) => {
      if (si === 0 || g.purified) return;            // 首石免代价；净化过的宝石免代价
      (g.affixes || []).forEach(a => {
        const def = CG.AFFIXES[a.id]; if (!def || !def.cost || def.cost.cond) return;
        // v3.1：每级实际代价来自 def.costByLv（L3 是 L1 代价的高效档）；老路径兜底
        const amount = def.costByLv ? (def.costByLv[a.level] != null ? def.costByLv[a.level] : def.costByLv[1]) : (def.cost.amt || 1) * CG.lvCost(a.level);
        const tm = def.cost.timing;
        if (tm === 'every' || tm === 'next') {       // 代价时点：调度到 每回合/下回合（不进 costMax 即时付）
          const e = costLossEff(def.cost.res, amount);
          if (e) (tm === 'every' ? everyTurnList : nextTurnList).push(e);
        } else costMax[def.cost.res] = Math.max(costMax[def.cost.res] || 0, amount);
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
    const blkVal = Math.max(0, (blkPool + blockFlat + (inst.blockGrowth || 0)) * valueMult);   // #11 本场格挡成长
    const hits = 1 + hitsD;
    const limit = inst.limit == null ? sockets.length : inst.limit;
    const emptySockets = Math.max(0, limit - sockets.length);

    // v3.2 条件代价：价值在 playCard 按「当前条件量」动态结算（喂给价值原子的 mech）→ cardStats 不预置其效果。
    const kind = dmgVal > 0 ? 'damage' : blkVal > 0 ? 'block' : healAmt > 0 ? 'heal' : 'skill';
    const value = dmgVal || blkVal || healAmt || 0;

    // 结算效果
    const effects = [];
    if (dmgVal > 0) effects.push({ type: 'damage', value: dmgVal, hits });
    if (blkVal > 0) effects.push({ type: 'block', value: blkVal });
    for (const k in statuses) effects.push({ type: k, value: statuses[k] });               // 给敌人
    for (const k in selfStatuses) effects.push({ type: 'selfStatus', status: k, value: selfStatuses[k] });
    if (energy)  effects.push({ type: 'energy', value: energy });
    if (drawN)   effects.push({ type: 'draw', value: drawN });
    if (healAmt) effects.push({ type: 'heal', value: healAmt });
    if (hpLoss)  effects.push({ type: 'loseHp', value: hpLoss });
    if (goldCostN) effects.push({ type: 'loseGold', value: goldCostN });   // v3 金币代价
    if (costMax.losePower) effects.push({ type: 'losePower', value: costMax.losePower });   // #29 消耗电力代价
    if (costMax.makeDross) effects.push({ type: 'clutter', value: costMax.makeDross });     // #31 生成渣滓代价
    if (costMax.minionHp) effects.push({ type: 'loseMinionHp', value: costMax.minionHp });  // #42 消耗召唤物血量代价
    if (silenceLv) effects.push({ type: 'silence', value: silenceLv });
    const strDelta = addStrN - sapStr - (costMax.loseStr || 0);   // v3 力量价值 - 减力量 - 失力量代价
    sapDex += (costMax.loseDex || 0);                  // 失敏捷代价（并入 dexDelta）
    const dexDelta = addDexN - sapDex;                 // 敏捷价值 - 减敏捷 - 失敏捷代价                          // 笨拙：永久 -敏捷
    if (strDelta) effects.push({ type: 'strength', value: strDelta });
    if (dexDelta) effects.push({ type: 'dexterity', value: dexDelta });
    if (prepare) effects.push({ type: 'tempStrength', value: prepare });   // 准备：本回合力量 +n（回合末移除）
    if (prepDexN) effects.push({ type: 'tempDexterity', value: prepDexN });   // 临时敏捷（回合末移除）
    for (const w in gives) effects.push({ type: 'give', what: w, value: gives[w] });   // 厨艺：打出后给食材卡
    // v3 自身减益代价（首石免/同种均摊已在 costMax 处理）：打出时给自己上易伤/虚弱/脆弱。
    if (costMax.selfVuln)  effects.push({ type: 'selfStatus', status: 'vulnerable', value: costMax.selfVuln });
    if (costMax.selfWeak)  effects.push({ type: 'selfStatus', status: 'weak', value: costMax.selfWeak });
    if (costMax.selfFrail) effects.push({ type: 'selfStatus', status: 'frail', value: costMax.selfFrail });
    for (const k in NB_EFF) if (NB[k]) effects.push({ type: NB_EFF[k], value: NB[k] });   // 新批：效果型字段 → 效果（thorns/tempThorns/immune/debuffMult/兵械/尸爆/催发/再生…）
    if (enemyStrN)     effects.push({ type: 'enemyStat', key: 'strength', value: enemyStrN });           // 敌失力量（永久）
    if (enemyStrTempN) effects.push({ type: 'enemyStat', key: 'strength', value: enemyStrTempN, temp: true });
    if (enemyDexN)     effects.push({ type: 'enemyStat', key: 'dexterity', value: enemyDexN });
    if (enemyDexTempN) effects.push({ type: 'enemyStat', key: 'dexterity', value: enemyDexTempN, temp: true });
    if (gainPowerN) effects.push({ type: 'gainPower', value: gainPowerN });                   // 发电（电力包）
    if (chargeN)    effects.push({ type: 'charge', value: chargeN });                         // 充电：电力→能量（电弧包）
    if (summonN)    effects.push({ type: 'summon', value: summonN });                         // 召唤：创建/+骷髅血量上限
    if (conjureN)   effects.push({ type: 'conjure', value: conjureN });                       // 造牌
    if (duplicateN) effects.push({ type: 'duplicate', value: duplicateN });                   // 复制随机手牌
    if (mindblastN) effects.push({ type: 'mindblast', value: mindblastN });                   // 心灵震慑：牌库攻击牌永久 +伤害
    if (vigorN)     effects.push({ type: 'vigor', value: vigorN });                           // 活力（强袭包）
    // v3.1 时点修饰器（真资源代价的 每回合/下回合 价值）：包成调度效果（playCard→effects 推入 game._everyTurn/_nextTurn，_startPlayerTurn 结算）
    everyTurnList.forEach(e => effects.push({ type: 'scheduleEvery', eff: e }));
    nextTurnList.forEach(e => effects.push({ type: 'scheduleNext', eff: e }));
    minionNowList.forEach(e => effects.push(e));   // 召唤物·本回合：带 minion:true，playCard 以骷髅为 source 结算

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
      nirvana: nirvanaN, undying: undyingN, arc: arcN,                            // 灰烬包(涅槃/不坏) / 电弧（playCard 用）
      retain, temper: temperN,                                                    // 持留包·保留 / 强化包·锤炼（playCard 用）
      discardCost: clutchN, exhaustCost: costMax.exhaustCard || 0,               // 弃牌代价 + #15 消耗手牌代价（pick 型）
      potent: potentN, multiHit: multiHitN, multi: multiN,                        // 放大包(potent/多重)+强攻包(连击 multiHit) playCard 加成
      copyToDiscard: NB.copyToDiscard || 0, growDmg: NB.growDmg || 0, growBlk: NB.growBlk || 0, selfCostDown: NB.selfCostDown || 0, aoe: NB.aoe || 0, playTwice: NB.playTwice || 0, wish: NB.wish || 0,   // 新批卡级字段（playCard 用）
      curseStrike: NB.curseStrike || 0, dmgToBlock: NB.dmgToBlock || 0, ethereal: !!costMax.ethereal,   // v3.8：追加咒言/伤害转格挡（playCard）+ 虚无(endTurn 消耗)
      nextEnergyPenalty: -nextE,
      name,
    };
  };

  // v3.2 条件代价结算：把某价值原子在「数量 amount」下的产出拆成 now/every/next 效果 + 卡级修饰（potent/lifesteal/multiHit/element）。
  //   直接复用该价值原子自己的 mech(amount)，故 本回合/下回合/每回合 与所有价值类型自动一致；playCard 的 condBonus 环调用它。
  CG.valueEffects = function (atom, amount, level) {
    const va = CG.VALUE_ATOMS[atom], out = { now: [], every: [], next: [] };
    if (!va || !va.mech || !(amount > 0)) return out;
    if (va.maxCount != null) amount = Math.min(va.maxCount, amount);   // 尊重价值 maxCount 上限（元素≤2 层、吸血≤100%、食材≤1）
    const f = va.mech(amount), L = level || 1;
    if (f.dmg)       out.now.push({ type: 'damage', value: f.dmg, hits: 1 });
    if (f.blk)       out.now.push({ type: 'block', value: f.blk });
    if (f.heal)      out.now.push({ type: 'heal', value: f.heal });
    if (f.draw)      out.now.push({ type: 'draw', value: f.draw });
    if (f.energy)    out.now.push({ type: 'energy', value: f.energy });
    if (f.gainPower) out.now.push({ type: 'gainPower', value: f.gainPower });
    if (f.addStr)    out.now.push({ type: 'strength', value: f.addStr });
    if (f.prepare)   out.now.push({ type: 'tempStrength', value: f.prepare });
    if (f.addDex)    out.now.push({ type: 'dexterity', value: f.addDex });
    if (f.prepDex)   out.now.push({ type: 'tempDexterity', value: f.prepDex });
    if (f.apply)     for (const k in f.apply) out.now.push({ type: k, value: f.apply[k] });
    // 新批价值字段（v3.6）：条件 × 这些价值时，按同一映射拆成效果 / 卡级字段（与 cardStats 一致）
    const NBE = { recallDiscard: 'recallDiscard', recycleDraw: 'recycleDraw', playTopDraw: 'playFromDraw', socketRand: 'socketRandom', debuffMult: 'debuffMult', vulnAmp: 'vulnAmp', weakAmp: 'weakAmp', makeDagger: 'makeDagger', makeScrap: 'makeScrap', daggerUp: 'daggerUp', scrapUp: 'scrapUp', immune: 'immune', keepBlockFull: 'keepBlockFull', dmgCap1: 'dmgCap1', tempThorns: 'tempThorns', addThorns: 'thorns', forge: 'forge', vigor: 'vigor', parry: 'parry', makePeek: 'makePeek', expandEvery: 'expandEvery', harvestEvery: 'harvestEvery', detonateEvery: 'detonateEvery', recycle: 'recycle', corpseBomb: 'corpseBomb', catalyze: 'catalyze', regen: 'regen', makeWisp: 'makeWisp', illusion: 'illusion', peekUp: 'peekUp', wispUp: 'wispUp' };
    for (const k in NBE) if (f[k]) out.now.push({ type: NBE[k], value: f[k] });
    for (const k of ['copyToDiscard', 'growDmg', 'growBlk', 'selfCostDown', 'aoe', 'playTwice', 'wish', 'curseStrike', 'dmgToBlock']) if (f[k]) out[k] = (out[k] || 0) + f[k];
    if (f.enemyStr)  out.now.push({ type: 'enemyStat', key: 'strength', value: f.enemyStr, temp: !!f.enemyTemp });
    if (f.enemyDex)  out.now.push({ type: 'enemyStat', key: 'dexterity', value: f.enemyDex, temp: !!f.enemyTemp });
    if (f.give)      out.now.push({ type: 'give', what: f.give, value: 1 });
    if (f.summon)    out.now.push({ type: 'summon', value: f.summon });   // 召唤：血量上限增量
    if (f.conjure)   out.now.push({ type: 'conjure', value: f.conjure });
    if (f.everyTurn) out.every = f.everyTurn.slice();   // 每回合变体：mech 已产出待调度效果
    if (f.nextTurn)  out.next = f.nextTurn.slice();     // 下回合变体
    if (f.potent)    out.potent = f.potent;             // 卡级修饰（合并进 s，由 playCard 应用到本牌其它价值）
    if (f.lifesteal) out.lifesteal = f.lifesteal;
    if (f.multiHit)  out.multiHit = f.multiHit;
    if (f.multi)     out.multi = f.multi;
    if (f.element)   { out.element = f.element; out.elementLevel = f.elementBase; }
    return out;
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
    const mult = inst._mult || 1;   // 幻境：本回合生成的临时卡牌效果 ×(1+50%n)（向上取整）
    const s = {
      base: inst.base, baseName: b.name, cost: b.cost || 0, type: b.type, kind: b.kind || 'food',
      value: 0, hits: 1, effects: [], buffs: [], debuffs: [], gemViews: [], limit: 0, emptySockets: 0, score: 0,
      repeatTimes: 1, windfury: 0, lifesteal: 0, exhaust: false, pierce: 0, freeNext: 0, combo: 0,
      element: null, elementLevel: 0, ashes: 0, burnSelect: 0, reborn: 0, nirvana: 0, undying: 0,
      arc: 0, temper: 0, retain: false,   // 电弧 / 锤炼 / 保留（食材卡默认值）
      potent: 0, multiHit: 0,                           // 放大/连击默认
      nextEnergyPenalty: 0, noPlay: false, food: b.food || null, icon: b.icon || '',
      name: b.name, baseText: '',
    };
    if (b.food === 'veg')  { s.kind = 'veg';  s.value = b.level; s.baseText = `做菜：打出后选荤菜/调料做成餐点（不选则＝回复 ${b.level}）`; }
    else if (b.food === 'meat') { s.kind = 'meat'; s.value = b.level; s.effects = [{ type: 'heal', value: b.level }]; s.baseText = `吃下回复 ${b.level} 生命（做菜时可当荤菜）`; }
    else if (b.food === 'season') { s.kind = 'season'; s.noPlay = true; const m = { salt: '过载1', soy: '滋养1', pepper: '重复1' }; s.baseText = `调味料·不能单独吃；做菜时让餐点获得「${m[b.season]}」`; }
    if (b.kind === 'spoiled') {
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
      const dmg = Math.ceil(4 * mult);
      s.type = 'attack'; s.value = dmg; s.exhaust = true; s.effects = [{ type: 'damage', value: dmg }]; s.baseText = `飞刀：造成 ${dmg} 点伤害，打出即消耗`;
    } else if (b.kind === 'dagger') {
      const dmg = Math.ceil((4 + (inst._bonus || 0)) * mult);   // 兵械·匕首：基础 4 + 本场强化(_bonus 由 daggerUp 刷新) ×幻境
      s.type = 'attack'; s.kind = 'damage'; s.value = dmg; s.exhaust = true; s.effects = [{ type: 'damage', value: dmg }]; s.baseText = `匕首：造成 ${dmg} 点伤害，打出即消耗`;
    } else if (b.kind === 'scrap') {
      const blk = Math.ceil((3 + (inst._bonus || 0)) * mult);   // 兵械·甲片：基础 3 + 本场强化 ×幻境
      s.type = 'skill'; s.kind = 'block'; s.value = blk; s.exhaust = true; s.effects = [{ type: 'block', value: blk }]; s.baseText = `甲片：获得 ${blk} 点格挡，打出即消耗`;
    } else if (b.kind === 'endsword') {
      const dmg = 10 + (inst._bonus || 0), blk = (inst._blk || 0);   // 兵械·终末之剑：10 + 锻造；招架给 _blk 格挡；2 费、保留、不消耗
      s.type = 'attack'; s.kind = 'damage'; s.cost = 2; s.value = dmg; s.retain = true;
      s.effects = [{ type: 'damage', value: dmg }].concat(blk > 0 ? [{ type: 'block', value: blk }] : []);
      s.baseText = `终末之剑：造成 ${dmg} 点伤害${blk > 0 ? `、获得 ${blk} 格挡` : ''}，保留`;
    } else if (b.kind === 'peek') {
      const d = Math.ceil((2 + (inst._bonus || 0)) * mult);   // 洞悉：基础抽 2 + peekUp 强化 ×幻境
      s.type = 'skill'; s.kind = 'skill'; s.exhaust = true; s.effects = [{ type: 'draw', value: d }]; s.baseText = `洞悉：抽 ${d} 张牌，打出即消耗`;
    } else if (b.kind === 'wisp') {
      const e = Math.ceil((1 + (inst._bonus || 0)) * mult);   // 磷火：基础 +1 能量 + wispUp 强化(floor(_wispBonus)) ×幻境；保留 + 消耗
      s.type = 'skill'; s.kind = 'skill'; s.retain = true; s.exhaust = true; s.value = e; s.effects = [{ type: 'energy', value: e }]; s.baseText = `磷火：获得 ${e} 点能量，保留，打出即消耗`;
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

  // v3.1：把等级 L 夹到某词条「实际存在的等级」集合内（不存在则就近向下、再不行取最小可用）。
  function snapLevel(L, avail) {
    if (!avail || !avail.length) return L;
    if (avail.includes(L)) return L;
    const below = avail.filter(x => x <= L);
    return below.length ? Math.max.apply(null, below) : Math.min.apply(null, avail);
  }
  CG.affixLevels = id => (CG.AFFIXES[id] && CG.AFFIXES[id].levels) || [1, 2, 3];
  CG.clampAffixLevel = (id, L) => snapLevel(Math.max(1, Math.min(3, L || 1)), CG.affixLevels(id));

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
    // 取各选定「价值主题」的 values(只 now)/costs/conds 并集；「下回合/每回合」是修饰词包(timingMod)、单列。
    const valueSet = new Set(), costSet = new Set(), condSet = new Set(), mods = [];
    ids.forEach(id => { const p = CG.PACKS && CG.PACKS[id]; if (!p || p.fusion) return; if (p.timingMod) { mods.push(p.timingMod); return; } (p.values || []).forEach(v => valueSet.add(v)); (p.costs || []).forEach(c => costSet.add(c)); (p.conds || []).forEach(c => condSet.add(c)); });
    // 时点修饰词：选了「每回合/下回合」包，才把已选 now 价值的对应时点变体加入池子（仅对存在该变体的价值）。
    const allValues = new Set(valueSet), tv = CG.timingVariants || {};
    mods.forEach(t => valueSet.forEach(nowId => { const variant = tv[nowId] && tv[nowId][t]; if (variant && CG.VALUE_ATOMS[variant]) allValues.add(variant); }));
    const buffs = CG.buildPackAffixes ? CG.buildPackAffixes([...allValues], [...costSet], [...condSet]) : [];
    const names = ids.map(id => (CG.PACKS[id] || {}).name).filter(Boolean);
    CG.PACKS.fusion = { id: 'fusion', fusion: true, name: '融合包', icon: '🌀', color: '#b59ad8', themes: ids.slice(), values: [...allValues], costs: [...costSet], conds: [...condSet], mods: mods.slice(), buffs, debuffs: [], desc: '本局融合主题：' + names.join('、') };
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
  // 开局默认主题：恒含「基础」(size 不计) + 随机加主题，直到累计 size(价值原子个数) 达 runPackSize(≈旧「4 个包」内容量)。
  //   包有大有小，故按「内容量」选而非固定个数 → 抽到大包就少几个、抽到小包就多几个，本局总内容量稳定。
  CG.rollRunPacks = function () {
    const themed = (CG.PACK_IDS || []).filter(id => id !== 'basic' && id !== 'fusion');
    for (let i = themed.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [themed[i], themed[j]] = [themed[j], themed[i]]; }
    const target = (CG.CONFIG && CG.CONFIG.runPackSize) || 24;
    const out = ['basic']; let sz = 0;
    for (const id of themed) { if (sz >= target) break; out.push(id); sz += ((CG.PACKS[id] && CG.PACKS[id].size) || 1); }
    return out.length > 1 ? out : ['basic'].concat(themed.slice(0, 4));   // 兜底：至少给几个
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
    const id = pickBuffId(buffPool, new Set(), big) || buffPool[0] || CG.BUFF_ORDER[0];
    // v3.1：等级只能取该词条「实际存在的等级」（元素/产出等被 maxCount 卡成只剩 LV1）
    const avail = CG.affixLevels(id);
    let L = opts.level;
    if (!L) { const w = lvW.filter(p => avail.includes(p[0])); L = w.length ? weightedPick(w) : avail[avail.length - 1]; }
    if (big) { const himin = avail.filter(lv => lv >= 2)[0]; if (himin && L < himin) L = himin; }   // 大宝石抬等级（若有高等级）
    if (opts.minLevel) L = Math.max(L, opts.minLevel);
    L = snapLevel(L, avail);
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
    for (let i = 0; i < B; i++) { const id = pickBuffId(pack.buffs, ob, i === 0); if (!id) break; ob.add(id); out.push({ id, level: CG.clampAffixLevel(id, CG.rollAffixLevel()) }); }
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

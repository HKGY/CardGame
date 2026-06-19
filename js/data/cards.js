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
    strike:     { name: '打击', cost: 1, type: 'attack', kind: 'damage',   base: 6 },
    defend:     { name: '防御', cost: 1, type: 'skill',  kind: 'block',    base: 5 },
    shieldbash: { name: '盾击', cost: 1, type: 'attack', kind: 'damage',   base: 3, block: 2 },  // 盾兵专属：造成伤害并获得格挡
    heal:       { name: '治疗', cost: 1, type: 'skill',  kind: 'heal',     base: 2 },             // 牧师：回复生命
    pray:       { name: '祈祷', cost: 1, type: 'power',  kind: 'randbuff', base: 1 },             // 牧师：获得随机增益
  };

  const MAX_SOCKETS = 5;                 // 单卡孔位上限（加孔/拓孔不超过此值）
  CG.MAX_SOCKETS = MAX_SOCKETS;

  // ---------- 构造 ----------
  CG.makeGem = (affixes = []) =>
    ({ uid: CG.nextUid(), affixes: affixes.map(a => ({ id: a.id, level: a.level })) });
  CG.cloneGem = g => CG.makeGem(g.affixes);   // 复制宝石（新 uid）

  // makeCard(base, limit, gems[])：gems 会被深拷贝进新卡（各得新 uid）
  CG.makeCard = (base, limit = 1, gems = []) =>
    ({ uid: CG.nextUid(), base,
       sockets: (gems || []).map(CG.cloneGem),
       limit: Math.max(limit, (gems || []).length) });
  CG.cloneCard = c =>                          // 跑图层深拷贝（保留 uid，用于战斗副本）
    ({ uid: c.uid, base: c.base, limit: c.limit,
       sockets: (c.sockets || []).map(g => ({ uid: g.uid, affixes: g.affixes.map(a => ({ id: a.id, level: a.level })) })) });

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
    const order = id => CG.AFFIX_ORDER.indexOf(id);
    const resolve = a => { const def = CG.AFFIXES[a.id]; return { id: a.id, level: a.level, def, debuff: !!def.debuff, name: CG.affixDisplayName(a.id, a.level), color: def.color, desc: def.desc(a.level, inst.base) }; };
    const bySort = (x, y) => order(x.id) - order(y.id);
    const sockets = inst.sockets || [];

    // 每个孔位（宝石）单独分组，供卡面分组显示「(增益+减益)」
    const gemViews = sockets.map(g => {
      const list = (g.affixes || []).map(resolve);
      return { buffs: list.filter(a => !a.debuff).sort(bySort), debuffs: list.filter(a => a.debuff).sort(bySort) };
    });
    const all = sockets.flatMap(g => (g.affixes || []).map(resolve));
    const buffs = all.filter(a => !a.debuff).sort(bySort);
    const debuffs = all.filter(a => a.debuff).sort(bySort);

    let valFlat = 0, valPct = 0, hitsD = 0, repeatX = 0, windfury = 0, energy = 0,
        drawN = 0, prepare = 0, sapStr = 0, sapDex = 0, score = 0,
        costD = 0, nextE = 0, hpLoss = 0, healAmt = 0, lifesteal = 0, silenceLv = 0, pierceN = 0, exhaust = false,
        blockFlat = 0, freeNextN = 0, comboN = 0;
    let elementId = null;                                    // 元素附着（火/水/雷/冰），多个取最后一个
    const statuses = {}, selfStatuses = {};
    all.forEach(({ def: d, level: L }) => {
      score += (d.score || 0) * L;
      if (d.value)     valFlat += d.value * L;
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
      if (d.cost)      costD   += d.cost * L;         // 速记 / 笨重
      if (d.nextEnergy) nextE  += d.nextEnergy * L;   // 透支
      if (d.hpLoss)    hpLoss  += d.hpLoss * L;        // 反噬
      if (d.heal)      healAmt += d.heal * L;          // 回春
      if (d.lifesteal) lifesteal += d.lifesteal * L;   // 吸血
      if (d.silence)   silenceLv = L;                  // 沉默：按等级削减敌人力量
      if (d.pierce)    pierceN  += d.pierce * L;        // 穿刺：额外命中右侧敌人
      if (d.block)     blockFlat += d.block * L;        // 壁垒：附加格挡
      if (d.freeNext)  freeNextN += d.freeNext * L;     // 回响：后续若干张牌免费
      if (d.combo)     comboN   += d.combo * L;         // 连击：每张已出牌追加伤害
      if (d.element)   elementId = d.element;           // 元素附着：命中时给敌人附该元素
      if (d.exhaust)   exhaust = true;                 // 销毁：打出后移除
      if (d.apply) for (const k in d.apply) statuses[k] = (statuses[k] || 0) + d.apply[k] * L;
      if (d.selfStatus) selfStatuses[d.selfStatus] = (selfStatuses[d.selfStatus] || 0) + L;
    });
    if (statuses.frozen) statuses.frozen = 1;        // 冰封不随等级叠加：固定跳过 1 次行动

    const cost = Math.max(0, b.cost + costD);
    const value = Math.max(0, Math.floor((b.base + valFlat) * (1 + valPct / 100)) * valueMult);
    const hits = 1 + hitsD;
    const limit = inst.limit == null ? sockets.length : inst.limit;
    const emptySockets = Math.max(0, limit - sockets.length);

    // 结算效果
    const KIND_TYPE = { damage: 'damage', block: 'block', heal: 'heal', randbuff: 'randbuff' };
    const effects = [{ type: KIND_TYPE[b.kind] || 'block', value, hits }];
    const flatBlock = (b.block || 0) + blockFlat;                   // 盾击固定格挡 + 壁垒附加格挡
    if (flatBlock > 0) effects.push({ type: 'block', value: flatBlock });
    for (const k in statuses) effects.push({ type: k, value: statuses[k] });               // 给敌人
    for (const k in selfStatuses) effects.push({ type: 'selfStatus', status: k, value: selfStatuses[k] });
    if (energy)  effects.push({ type: 'energy', value: energy });
    if (drawN)   effects.push({ type: 'draw', value: drawN });
    if (healAmt) effects.push({ type: 'heal', value: healAmt });
    if (hpLoss)  effects.push({ type: 'loseHp', value: hpLoss });
    if (silenceLv) effects.push({ type: 'silence', value: silenceLv });
    const strDelta = (inst.base === 'strike' ? prepare : 0) - sapStr;
    const dexDelta = (inst.base === 'defend' ? prepare : 0) - sapDex;
    if (strDelta) effects.push({ type: 'strength', value: strDelta });
    if (dexDelta) effects.push({ type: 'dexterity', value: dexDelta });

    const baseText = ({
      damage:   `造成 ${value} 点伤害`,
      block:    `获得 ${value} 点格挡`,
      heal:     `回复 ${value} 点生命`,
      randbuff: `获得 ${value} 层随机增益`,
    }[b.kind] || `获得 ${value} 点格挡`) + (hits > 1 ? ` ×${hits}` : '') + (b.block ? `，获得 ${b.block} 点格挡` : '') + '。';

    // 卡名：基底 + 各宝石分组 (增益+减益) + 空孔 ◇
    const gemText = gemViews.map(g => '(' + g.buffs.concat(g.debuffs).map(a => a.name).join('+') + ')').join('');
    const name = b.name + gemText + '◇'.repeat(emptySockets);

    return {
      base: inst.base, baseName: b.name, cost, type: b.type, kind: b.kind, limit, emptySockets, score,
      value, hits, effects, buffs, debuffs, gemViews, baseText,
      repeatTimes: 1 + repeatX,
      windfury, lifesteal, exhaust, pierce: pierceN,
      freeNext: freeNextN, combo: comboN, element: elementId,
      nextEnergyPenalty: -nextE,
      name,
    };
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

  // 按层数权重选一个 booster pack（缺 tier / 缺权重则在全部包里均匀选）。返回包 id。
  CG.pickPack = function (tier) {
    const w = (CG.CONFIG && CG.CONFIG.packW && tier && CG.CONFIG.packW[tier]) || null;
    if (w && w.length) return weightedPick(w);
    const ids = (CG.PACKS && Object.keys(CG.PACKS)) || [];
    return ids.length ? ids[Math.floor(Math.random() * ids.length)] : 'basic';
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
    const buffPool = pack.buffs, debuffPool = pack.debuffs;
    const gcfg = (CG.CONFIG && CG.CONFIG.gem) || {};
    const lvW = (gcfg.levelW && gcfg.levelW[tier]) || [[1, 6], [2, 3], [3, 1]];
    const big = opts.big != null ? opts.big : Math.random() < ((gcfg.bigChance && gcfg.bigChance[tier]) || 0.35);
    const lvl = () => { let L = opts.level || weightedPick(lvW); if (opts.minLevel && L < opts.minLevel) L = opts.minLevel; return L; };
    const ownedB = new Set(), ownedD = new Set(), affixes = [];
    if (!big) {                                      // 小宝石：1 个朴素增益（最多 2 级）
      const id = pickBuffId(buffPool, ownedB, false);
      if (id) affixes.push({ id, level: Math.min(2, lvl()) });
    } else {                                         // 大宝石：强增益 + 减益（首领可双增益/双减益）
      const nB = tier === 'boss' ? 2 : 1;
      for (let i = 0; i < nB; i++) { const id = pickBuffId(buffPool, ownedB, true); if (!id) break; ownedB.add(id); affixes.push({ id, level: lvl() }); }
      const nD = tier === 'boss' && Math.random() < 0.5 ? 2 : 1;
      for (let i = 0; i < nD; i++) { const id = pickDebuffId(debuffPool, ownedD); if (!id) break; ownedD.add(id); affixes.push({ id, level: 1 }); }
    }
    if (!affixes.length) affixes.push({ id: buffPool[0] || CG.BUFF_ORDER[0], level: 1 });
    return CG.makeGem(affixes);
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
    warrior: { name: '战士', icon: '⚔️', desc: '5 打击 + 5 防御，各预镶嵌一颗小宝石；攻守均衡。', shopCard: 'defend' },
    shield:  { name: '盾兵', icon: '🛡️', desc: '4 打击 + 4 防御 + 2 盾击（造成 3 伤害并获得 2 格挡）。', shopCard: 'shieldbash' },
    priest:  { name: '牧师', icon: '✚',  desc: '3 打击 + 3 防御 + 2 治疗 + 2 祈祷。', shopCard: 'pray' },
  };
  // 按职业构建初始牌组：每张卡 1 个孔；少量预镶嵌小宝石作早期手感
  CG.buildDeck = function (cls) {
    const blank = base => CG.makeCard(base, 1, []);
    const gemmed = (base, buffId) => CG.makeCard(base, 1, [CG.makeGem([{ id: buffId, level: 1 }])]);
    const rep = (base, n) => Array.from({ length: n }, () => blank(base));
    if (cls === 'shield') return [...rep('strike', 4), ...rep('defend', 4), ...rep('shieldbash', 2)];
    if (cls === 'priest') return [...rep('strike', 3), ...rep('defend', 3), ...rep('heal', 2), ...rep('pray', 2)];
    // warrior（默认）：5 打击 + 5 防御；其中各一张预镶小宝石（压制 / 准备）
    return [gemmed('strike', 'suppress'), ...rep('strike', 4), gemmed('defend', 'prepare'), ...rep('defend', 4)];
  };
})(window.CG);

window.CG = window.CG || {};

/* ===========================================================================
 *  卡牌 —— 「打击/防御」基底 + 增益(buff)与减益(debuff)词条。
 * ===========================================================================
 *  卡牌实例 = { uid, base, affixes:[{id,level}], limit }
 *    limit = 锻造上限（可拥有的 buff 数）。卡名后以 +X 显示。
 *  锻造一次 = 加 1 个随机等级 buff + 1 个 1 级 debuff（交互式时二选一）。
 *  cardStats(inst, opts) 把基底与所有词条聚合成当前数值/效果/卡名/分数。
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

  CG.makeCard = (base, affixes = [], limit) =>
    ({ uid: CG.nextUid(), base, affixes: affixes.map(a => ({ id: a.id, level: a.level })),
       limit: limit == null ? Math.max(1, affixes.filter(a => !CG.isDebuff(a.id)).length) : limit });

  // ---------- 取数 ----------
  CG.cardStats = function (inst, opts) {
    const valueMult = (opts && opts.valueMult) || 1;
    const b = CG.BASE_CARDS[inst.base];
    const order = id => CG.AFFIX_ORDER.indexOf(id);
    const resolve = a => { const def = CG.AFFIXES[a.id]; return { id: a.id, level: a.level, def, name: CG.affixDisplayName(a.id, a.level), color: def.color, desc: def.desc(a.level, inst.base) }; };
    const all = (inst.affixes || []).map(resolve);
    const buffs = all.filter(a => !a.def.debuff).sort((x, y) => order(x.id) - order(y.id));
    const debuffs = all.filter(a => a.def.debuff).sort((x, y) => order(x.id) - order(y.id));

    let valFlat = 0, valPct = 0, hitsD = 0, repeatX = 0, windfury = 0, energy = 0,
        drawN = 0, forge = 0, erode = 0, prepare = 0, sapStr = 0, sapDex = 0, score = 0,
        costD = 0, nextE = 0, hpLoss = 0, healAmt = 0, lifesteal = 0, silenceLv = 0, pierceN = 0, exhaust = false;
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
      if (d.forge)     forge   += d.forge * L;
      if (d.erode)     erode   += d.erode * L;
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
      if (d.exhaust)   exhaust = true;                 // 销毁：打出后移除
      if (d.apply) for (const k in d.apply) statuses[k] = (statuses[k] || 0) + d.apply[k] * L;
      if (d.selfStatus) selfStatuses[d.selfStatus] = (selfStatuses[d.selfStatus] || 0) + L;
    });
    if (statuses.frozen) statuses.frozen = 1;        // 冰封不随等级叠加：固定跳过 1 次行动

    const cost = Math.max(0, b.cost + costD);
    const value = Math.max(0, Math.floor((b.base + valFlat) * (1 + valPct / 100)) * valueMult);
    const hits = 1 + hitsD;
    const limit = inst.limit == null ? Math.max(1, buffs.length) : inst.limit;

    // 结算效果
    const KIND_TYPE = { damage: 'damage', block: 'block', heal: 'heal', randbuff: 'randbuff' };
    const effects = [{ type: KIND_TYPE[b.kind] || 'block', value, hits }];
    if (b.block) effects.push({ type: 'block', value: b.block });   // 盾击：附带固定格挡
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

    return {
      base: inst.base, baseName: b.name, cost, type: b.type, kind: b.kind, limit, score,
      value, hits, effects, buffs, debuffs, baseText,
      repeatTimes: 1 + repeatX,
      windfury, lifesteal, exhaust, pierce: pierceN,
      nextEnergyPenalty: -nextE,
      forgeCount: forge,
      erodeCount: erode,
      name: buffs.map(a => a.name).join('') + b.name + (debuffs.length ? '(' + debuffs.map(a => a.name).join('') + ')' : '') + '+' + limit,
    };
  };

  // ---------- 锻造 ----------
  function weightedPick(pairs) {
    const t = pairs.reduce((s, p) => s + p[1], 0);
    let r = Math.random() * t;
    for (const [v, w] of pairs) if ((r -= w) < 0) return v;
    return pairs[pairs.length - 1][0];
  }
  CG.rollAffixLevel = () => weightedPick((CG.CONFIG && CG.CONFIG.upgradeLevelWeights) || [[1, 4], [2, 3], [3, 2]]);

  function rollBuff(owned, base) {                 // 强力 buff 更稀有；防御牌排除「仅攻击」词条
    const pool = CG.BUFF_ORDER
      .filter(id => !owned.has(id) && !(base === 'defend' && CG.AFFIXES[id].damageOnly))
      .map(id => [id, Math.max(1, 8 - CG.AFFIXES[id].score)]);
    return pool.length ? weightedPick(pool) : null;
  }
  function rollDebuff(owned) {                      // 严重 debuff 更稀有
    const pool = CG.DEBUFF_ORDER.filter(id => !owned.has(id)).map(id => [id, Math.max(1, 6 + CG.AFFIXES[id].score)]);
    return pool.length ? weightedPick(pool) : null;
  }
  CG.rollBuffId = (ownedArr, base) => rollBuff(new Set(ownedArr || []), base);   // 给掉落卡生成用
  CG.rollDebuffId = ownedArr => rollDebuff(new Set(ownedArr || []));             // 奖励卡附带 debuff 用

  CG.buffCount = inst => (inst.affixes || []).filter(a => !CG.isDebuff(a.id)).length;
  CG.canForge = inst => CG.buffCount(inst) < (inst.limit == null ? Math.max(1, CG.buffCount(inst)) : inst.limit);

  // 生成一次锻造方案 { buff:{id,level}, debuff?:{id,level:1} }（达到上限返回 null）
  CG.rollForge = function (inst, opts) {
    if (!CG.canForge(inst)) return null;
    const ownedB = new Set((inst.affixes || []).filter(a => !CG.isDebuff(a.id)).map(a => a.id));
    const ownedD = new Set((inst.affixes || []).filter(a => CG.isDebuff(a.id)).map(a => a.id));
    const buffId = rollBuff(ownedB, inst.base);
    if (!buffId) return null;
    let level = (opts && opts.level) || CG.rollAffixLevel();
    if (opts && opts.minLevel && level < opts.minLevel) level = opts.minLevel;   // 幸运脚
    const out = { buff: { id: buffId, level } };
    const debuffId = rollDebuff(ownedD);
    if (debuffId) out.debuff = { id: debuffId, level: 1 };
    return out;
  };
  // 交互式：二选一（两个方案 buff 不同）
  CG.forgeChoices = function (inst, opts) {
    const a = CG.rollForge(inst, opts);
    if (!a) return null;
    let b = CG.rollForge(inst, opts), tries = 0;
    while (b && b.buff.id === a.buff.id && tries++ < 10) b = CG.rollForge(inst, opts);
    return [a, b].filter(Boolean);
  };
  CG.applyForge = function (inst, opt) {
    if (!opt) return;
    inst.affixes = inst.affixes || [];
    inst.affixes.push({ id: opt.buff.id, level: opt.buff.level });
    if (opt.debuff) inst.affixes.push({ id: opt.debuff.id, level: opt.debuff.level });
  };
  // 非交互（临时/批量）：直接随机锻造一次
  CG.upgradeInstance = function (inst, opts) { CG.applyForge(inst, CG.rollForge(inst, opts)); };

  // 重铸：buff/debuff 数量不变，全部重掷
  CG.reforgeInstance = function (inst) {
    const B = CG.buffCount(inst);
    const D = (inst.affixes || []).length - B;
    inst.affixes = [];
    const ob = new Set(), od = new Set();
    for (let i = 0; i < B; i++) { const id = rollBuff(ob, inst.base); if (!id) break; ob.add(id); inst.affixes.push({ id, level: CG.rollAffixLevel() }); }
    for (let i = 0; i < D; i++) { const id = rollDebuff(od); if (!id) break; od.add(id); inst.affixes.push({ id, level: 1 }); }
  };

  // 售价：基础 20 + 每点 buff 等级 14（debuff 不计入）
  CG.cardPrice = card => 20 + 14 * (card.affixes || []).filter(a => !CG.isDebuff(a.id)).reduce((s, a) => s + a.level, 0);

  // 初始牌组：5 打击 + 5 防御（锻造上限 1）
  CG.STARTER_DECK = ['strike', 'strike', 'strike', 'strike', 'strike',
                     'defend', 'defend', 'defend', 'defend', 'defend'];

  // ---------- 职业 / 初始牌组 ----------
  CG.CLASS_IDS = ['warrior', 'shield', 'priest'];
  CG.CLASSES = {
    warrior: { name: '战士', icon: '⚔️', desc: '5 打击 + 5 防御，各有一张附带随机增益；攻守均衡。', shopCard: 'defend' },
    shield:  { name: '盾兵', icon: '🛡️', desc: '4 打击 + 4 防御 + 2 盾击（造成 3 伤害并获得 2 格挡）。', shopCard: 'shieldbash' },
    priest:  { name: '牧师', icon: '✚',  desc: '3 打击 + 3 防御 + 2 治疗（回复 2）+ 2 祈祷（获得随机增益）。', shopCard: 'pray' },
  };
  // 按职业构建初始牌组（所有初始牌锻造上限 +1）
  CG.buildDeck = function (cls) {
    const mk = (base, affixes) => CG.makeCard(base, affixes || [], 1);
    const rb = base => { const id = CG.rollBuffId([], base); return id ? [{ id, level: 1 }] : []; };
    const rep = (base, n) => Array.from({ length: n }, () => mk(base));
    if (cls === 'shield') return [...rep('strike', 4), ...rep('defend', 4), ...rep('shieldbash', 2)];
    if (cls === 'priest') return [...rep('strike', 3), ...rep('defend', 3), ...rep('heal', 2), ...rep('pray', 2)];
    // warrior（默认）：5 打击 + 5 防御，各一张带随机增益
    return [mk('strike', rb('strike')), ...rep('strike', 4), mk('defend', rb('defend')), ...rep('defend', 4)];
  };
})(window.CG);

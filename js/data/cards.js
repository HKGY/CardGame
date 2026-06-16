window.CG = window.CG || {};

/* ===========================================================================
 *  卡牌 —— 两种基底卡「打击 / 防御」+ 若干词条（见 js/data/affixes.js）。
 * ===========================================================================
 *  卡牌实例 = { uid, base: 'strike'|'defend', affixes: [{ id, level }] }
 *  cardStats(inst) 把基底与所有词条聚合成一张卡当前的：
 *    名称(含更/最前缀)、耗能、数值、次数、结算效果、以及特殊行为标记。
 * ===========================================================================
 */
(function (CG) {
  let _uid = 0;
  CG.nextUid = () => ++_uid;

  CG.BASE_CARDS = {
    strike: { name: '打击', cost: 1, type: 'attack', kind: 'damage', base: 6 },
    defend: { name: '防御', cost: 1, type: 'skill',  kind: 'block',  base: 5 },
  };

  CG.makeCard = (base, affixes = []) =>
    ({ uid: CG.nextUid(), base, affixes: affixes.map(a => ({ id: a.id, level: a.level })) });

  CG.cardStats = function (inst) {
    const b = CG.BASE_CARDS[inst.base];
    const affixes = (inst.affixes || []).map(a => {
      const def = CG.AFFIXES[a.id];
      return { id: a.id, level: a.level, name: CG.affixDisplayName(a.id, a.level), color: def.color, desc: def.desc(a.level, inst.base), def };
    });

    // 聚合词条机制（每个字段 ×等级）
    let costD = 0, valFlat = 0, valPct = 0, hitsD = 0, repeatX = 0, windfury = 0,
        energy = 0, nextE = 0, hpLoss = 0, drawN = 0, forge = 0, prepare = 0;
    const statuses = {};
    affixes.forEach(({ def: d, level: L }) => {
      if (d.cost)       costD   += d.cost * L;
      if (d.value)      valFlat += d.value * L;
      if (d.valuePct)   valPct  += d.valuePct * L;
      if (d.hits)       hitsD   += d.hits * L;
      if (d.repeat)     repeatX += d.repeat * L;
      if (d.windfury)   windfury += d.windfury * L;
      if (d.energy)     energy  += d.energy * L;
      if (d.nextEnergy) nextE   += d.nextEnergy * L;
      if (d.hpLoss)     hpLoss  += d.hpLoss * L;
      if (d.draw)       drawN   += d.draw * L;
      if (d.forge)      forge   += d.forge * L;
      if (d.prepare)    prepare += d.prepare * L;
      if (d.apply) for (const k in d.apply) statuses[k] = (statuses[k] || 0) + d.apply[k] * L;
    });

    const cost = Math.max(0, b.cost + costD);
    const value = Math.max(0, Math.floor((b.base + valFlat) * (1 + valPct / 100)));
    const hits = 1 + hitsD;

    // 结算效果列表（复用效果系统；准备：打击→力量、防御→敏捷，加给自己）
    const effects = [{ type: b.kind === 'damage' ? 'damage' : 'block', value, hits }];
    for (const k in statuses) effects.push({ type: k, value: statuses[k] });
    if (energy)  effects.push({ type: 'energy', value: energy });
    if (hpLoss)  effects.push({ type: 'loseHp', value: hpLoss });
    if (drawN)   effects.push({ type: 'draw', value: drawN });
    if (prepare) effects.push({ type: inst.base === 'defend' ? 'dexterity' : 'strength', value: prepare });

    const name = affixes.map(a => a.name).join('') + b.name;
    const baseText = (b.kind === 'damage' ? `造成 ${value} 点伤害` : `获得 ${value} 点格挡`) + (hits > 1 ? ` ×${hits}` : '') + '。';

    return {
      base: inst.base, baseName: b.name, name, cost, type: b.type, kind: b.kind,
      value, hits, effects, affixes, baseText,
      repeatTimes: 1 + repeatX,          // 重复：整组效果结算次数
      windfury,                          // 风怒：本回合可回手次数
      nextEnergyPenalty: -nextE,         // 过载：下回合能量惩罚（正数）
      forgeCount: forge,                 // 锻造：随机升级手中 N 张牌
    };
  };

  // 升级一张卡：加一个新词条，或给已有词条升一级（≤3 词条、每条≤3 级）。
  // Run 的升级与「锻造」词条共用。
  CG.upgradeInstance = function (inst) {
    inst.affixes = inst.affixes || [];
    const rpick = arr => arr[Math.floor(Math.random() * arr.length)];
    const owned = new Set(inst.affixes.map(a => a.id));
    const pool = CG.AFFIX_ORDER.filter(id => !owned.has(id));
    const levelable = inst.affixes.filter(a => a.level < 3);
    const canAdd = inst.affixes.length < 3 && pool.length > 0;
    if (canAdd && (levelable.length === 0 || Math.random() < 0.6)) inst.affixes.push({ id: rpick(pool), level: 1 });
    else if (levelable.length > 0) rpick(levelable).level += 1;
    else if (canAdd) inst.affixes.push({ id: rpick(pool), level: 1 });
  };

  // 一张卡的售价：基础 40 + 每点词条等级 25
  CG.cardPrice = card => 40 + 25 * (card.affixes || []).reduce((s, a) => s + a.level, 0);

  // 初始牌组：5 打击 + 5 防御（无词条）
  CG.STARTER_DECK = ['strike', 'strike', 'strike', 'strike', 'strike',
                     'defend', 'defend', 'defend', 'defend', 'defend'];
})(window.CG);

window.CG = window.CG || {};

/* ===========================================================================
 *  塔罗牌（消耗品）—— 生成式：第三条「价值投放轨道」（见 DESIGN-resource-exchange.md 附录 E）
 * ===========================================================================
 *  与宝石/遗物共用同一套「价值原子」，只换「代价轨道」：
 *    宝石＝每次打出付资源/条件；遗物＝获取/常驻；塔罗＝消耗一个「消耗品栏」、即时一次性、无能量/条件代价。
 *  量级旋钮：塔罗 ≈ 2 能量（StS 药水均值）＝ `round(12 / VP)`（宝石是 6）。
 *  v3.12：每张塔罗都带 `pack`（所属主题）；47 个细分主题各配套塔罗，分不出来的归 `general`(通用)。
 *  字段：name, icon, where('battle'|'map'|'any'), pack, desc, async?, apply(run, battle, ui)
 * ========================================================================= */
(function (CG) {
  const heal = (run, battle, n) => { if (battle) battle.heal(n); else run.gainHp(n); };

  // 价值原子 → 即时塔罗。n＝~2 能量等值；act 即时投放（战斗给玩家/敌人，地图给跑图资源）。
  const T = [
    { id: 'damage', name: '烈焰', icon: '🔥', where: 'battle', pack: 'power', n: 12, desc: n => `对当前敌人造成 ${n} 点伤害`, act: (r, b, n) => { if (b.enemy && b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, n); } },
    { id: 'aoe',    name: '爆轰', icon: '💥', where: 'battle', pack: 'assault', n: 8,  desc: n => `对所有人造成 ${n} 点伤害`, act: (r, b, n) => b.damageAll(n) },
    { id: 'block',  name: '磐石', icon: '🛡️', where: 'battle', pack: 'block', n: 10, desc: n => `获得 ${n} 点格挡`, act: (r, b, n) => b.gainBlock(b.player, n) },
    { id: 'energy', name: '能量', icon: '⚡', where: 'battle', pack: 'energy', n: 2,  desc: n => `获得 ${n} 点能量`, act: (r, b, n) => { b.player.energy += n; } },
    { id: 'draw',   name: '迅捷', icon: '🌀', where: 'battle', pack: 'draw', n: 3,  desc: n => `抽 ${n} 张牌`, act: (r, b, n) => b.drawCards(n) },
    { id: 'strength', name: '力量', icon: '💪', where: 'battle', pack: 'strength', n: 3, desc: n => `获得 ${n} 层力量`, act: (r, b, n) => b.applyStatus(b.player, 'strength', n) },
    { id: 'dexterity', name: '敏捷', icon: '🤸', where: 'battle', pack: 'dexterity', n: 4, desc: n => `获得 ${n} 层敏捷`, act: (r, b, n) => b.applyStatus(b.player, 'dexterity', n) },
    { id: 'flex',   name: '狂乱', icon: '😤', where: 'battle', pack: 'strength', n: 8,  desc: n => `本回合 +${n} 力量（回合末失去）`, act: (r, b, n) => b.addTempStrength(n) },
    { id: 'speed',  name: '迅疾', icon: '💨', where: 'battle', pack: 'dexterity', n: 8,  desc: n => `本回合 +${n} 敏捷（回合末失去）`, act: (r, b, n) => b.addTempDexterity(n) },
    { id: 'vulnerable', name: '破绽', icon: '🎯', where: 'battle', pack: 'vuln', n: 8, desc: n => `对当前敌人施加 ${n} 层易伤`, act: (r, b, n) => { if (b.enemy) b.applyStatus(b.enemy, 'vulnerable', n); } },
    { id: 'weak',   name: '疲软', icon: '💧', where: 'battle', pack: 'weak', n: 6,  desc: n => `对当前敌人施加 ${n} 层虚弱`, act: (r, b, n) => { if (b.enemy) b.applyStatus(b.enemy, 'weak', n); } },
    { id: 'poison', name: '剧毒', icon: '🧪', where: 'battle', pack: 'poison', n: 8,  desc: n => `对当前敌人施加 ${n} 层中毒`, act: (r, b, n) => { if (b.enemy) b.applyStatus(b.enemy, 'poison', n); } },
    { id: 'regen',  name: '再生', icon: '💚', where: 'battle', pack: 'vitality', n: 6,  desc: n => `获得 ${n} 层再生`, act: (r, b, n) => b.applyStatus(b.player, 'regen', n) },
    { id: 'heal',   name: '治疗', icon: '❤️', where: 'any', pack: 'vitality', n: 8,    desc: n => `回复 ${n} 点生命`, act: (r, b, n) => heal(r, b, n) },
    { id: 'gold',   name: '财富', icon: '💰', where: 'any', pack: 'general', n: 40,   desc: n => `获得 ${n} 金币`, act: (r, b, n) => { r.gold += n; } },
    { id: 'maxhp',  name: '活力', icon: '🍐', where: 'any', pack: 'general', n: 6,    desc: n => `最大生命 +${n}`, act: (r, b, n) => { r.maxHp += n; r.hp += n; } },
  ];

  const TAROT = {};
  T.forEach(t => { TAROT['t_' + t.id] = { name: t.name, icon: t.icon, where: t.where, pack: t.pack, atom: t.id, desc: t.desc(t.n), apply: (run, battle, ui) => t.act(run, battle, t.n) }; });

  // —— 保留的特色工具牌（不入价值原子模型；玩法独特、归通用包）——
  Object.assign(TAROT, {
    fool:      { name: '愚者', icon: '🃏', where: 'battle', pack: 'general', desc: '重新开始本场战斗（不回血、不退道具）', apply: (run, battle) => battle.restart() },
    magician:  { name: '魔术师', icon: '🎩', where: 'battle', pack: 'pile', async: true, desc: '从抽牌堆选一张牌加入手牌', apply: (run, battle, ui) => ui.pickCard(battle.drawPile, uid => battle.drawToHand(uid)) },
    potent:    { name: '强效药剂', icon: '✨', where: 'battle', pack: 'amplify', desc: '下一张牌造成 3 倍伤害', apply: (run, battle) => { battle.nextCardDmgMult = 3; } },
    emperor:   { name: '皇帝', icon: '🏛️', where: 'map', pack: 'general', desc: '直接传送到本层 Boss', apply: (run) => run.gotoActBoss() },
    moon:      { name: '月亮', icon: '🌕', where: 'map', pack: 'general', desc: '传送到地图上的随机房间', apply: (run) => run.teleportRandom() },
    priestess: { name: '女祭司', icon: '🌙', where: 'any', pack: 'general', desc: '下一个非 Boss 敌人最大生命 -25%', apply: (run) => { run.flags.enemyHpDown = 0.25; } },
    wheel:     { name: '命运之轮', icon: '🎡', where: 'any', pack: 'general', desc: '用随机塔罗填满消耗栏', apply: (run) => run.fillTarot() },
    star:      { name: '群星', icon: '⭐', where: 'any', pack: 'general', desc: '下次战斗胜利额外获得一颗宝石', apply: (run) => { run.flags.rewardBonusGem = true; } },
  });

  // —— v3.12：为其余主题各配一张塔罗 ——
  // 通用 act：把一个「价值原子」按给定量级即时投放到战斗（复用 valueEffects → 本回合/每回合/下回合 效果）。
  const atomAct = (atom, n) => (run, battle) => {
    if (!battle) return;
    const ve = CG.valueEffects(atom, n, 1), tgt = battle.currentTarget ? battle.currentTarget() : battle.enemy;
    (ve.now || []).forEach(e => CG.Effects.apply(battle, e, battle.player, tgt));
    (ve.every || []).forEach(e => battle._addEveryTurn(e));
    (ve.next || []).forEach(e => battle._addNextTurn(e));
  };
  const setAura = el => (run, battle) => { if (battle && battle.enemy) { const cur = battle._auraOf(battle.enemy) === el ? (battle.enemy.statuses[el] || 0) : 0; battle._setAura(battle.enemy, el, Math.min(1, cur + 1)); } };
  // [pack, id, name, icon, descText, act]（皆 where:'battle'）
  const PT = [
    ['basic',    'glint',    '微光',   '🎴', '对敌人造成 12 点伤害', atomAct('damage', 12)],
    ['combo',    'flurry',   '乱舞',   '🌟', '对敌人造成 6 点伤害，共 3 次', (r, b) => { if (b.enemy) for (let i = 0; i < 3 && b.enemy.hp > 0; i++) b.dealAttackDamage(b.player, b.enemy, 6); }],
    ['frail',    'shatter',  '碎甲',   '🧨', '对敌人施加 8 层脆弱', atomAct('frail', 8)],
    ['burn',     'cinder',   '余烬',   '🔥', '对敌人施加 8 层灼烧', atomAct('burn', 8)],
    ['curse',    'hex',      '诅咒',   '🪦', '对敌人施加 10 层灾厄', atomAct('curse', 10)],
    ['sapstr',   'enfeeble', '弱攻',   '🔻', '使敌人失去 4 点力量', atomAct('enemyLoseStr', 4)],
    ['sapdex',   'cripple',  '迟滞',   '🔽', '使敌人失去 4 点敏捷', atomAct('enemyLoseDex', 4)],
    ['spread',   'plague',   '瘟疫',   '🦠', '使敌人当前所有减益层数翻倍', atomAct('debuffMult', 1)],
    ['ward',     'aegis',    '壁障',   '🔰', '本场战斗格挡跨回合保留', atomAct('keepBlockFull', 1)],
    ['thorns',   'bramble',  '尖刺',   '🌵', '获得 8 点荆棘', atomAct('thorns', 8)],
    ['immune',   'bulwark',  '铜墙',   '✨', '免疫接下来 2 次伤害', atomAct('immune', 2)],
    ['flow',     'cadence',  '流转',   '🎟️', '接下来 2 张牌免费打出', (r, b) => { if (b) b.freeCards = (b.freeCards || 0) + 2; }],
    ['conjure',  'creation', '造物',   '🎩', '生成 2 张带随机宝石的牌（本回合 0 费）', atomAct('conjure', 2)],
    ['divine',   'foresee',  '预见',   '🌠', '生成 2 张灵魂到抽牌堆', atomAct('makePeek', 2)],
    ['sorcery',  'mirror',   '镜像',   '🪄', '复制 1 张随机手牌', (r, b) => { if (b) CG.Effects.apply(b, { type: 'duplicate', value: 1 }, b.player); }],
    ['pile',     'salvage',  '打捞',   '📚', '将弃牌堆中 2 张牌加入手牌', atomAct('recallDiscard', 2)],
    ['enhance',  'whetstone','磨石',   '📈', '使一张随机手牌本场永久 +3 数值', (r, b) => { if (b) CG.Effects.apply(b, { type: 'whet', value: 3 }, b.player); }],
    ['hold',     'recall',   '回收',   '📌', '消耗手牌中所有非初始牌并抽取等量', atomAct('recycle', 1)],
    ['elec',     'dynamo',   '发电',   '🔌', '获得 6 点电力', atomAct('power', 6)],
    ['elec',     'surge',    '涌流',   '⚡', '获得 4 点电力', atomAct('power', 4)],
    ['wisp',     'wisplight','鬼焰',   '🟢', '生成 2 张磷火（0 费得能量、保留、消耗）', atomAct('makeWisp', 2)],
    ['cycle',    'sow',      '播种',   '🌾', '获得「每回合 +4 格挡」', atomAct('produce_block', 2)],
    ['cycle',    'reap',     '丰收',   '🔄', '立即结算一次现有每回合增益', atomAct('harvestEvery', 1)],
    ['blood',    'sacrifice','血祭',   '🩸', '失去 8 生命，对敌人造成 24 点伤害', (r, b) => { if (!b) return; b.player.hp = Math.max(1, b.player.hp - 8); if (b._countHpLoss) b._countHpLoss(); if (b.enemy && b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, 24); }],
    ['ash',      'pyre',     '焚尽',   '♨️', '消耗整手牌，每张对敌人造成 4 点伤害', (r, b) => { if (!b) return; const snap = b.hand.slice(); b.hand = []; snap.forEach(c => b._exhaustCard(c)); if (b.enemy && b.enemy.hp > 0) for (let i = 0; i < snap.length; i++) b.dealAttackDamage(b.player, b.enemy, 4); }],
    ['summon',   'raise',    '唤骨',   '👻', '召唤一具骷髅（血量上限 8）', atomAct('summon', 8)],
    ['dagger',   'whetblade','砺刃',   '🔪', '生成 3 张匕首', atomAct('makeDagger', 3)],
    ['scrap',    'plating',  '镀甲',   '🛡️', '生成 3 张甲片', atomAct('makeScrap', 3)],
    ['endsword', 'temper',   '淬锋',   '🗡️', '终末之剑伤害 +3（无则创造一张加入手牌）', atomAct('forge', 3)],
    ['cook',     'sprout',   '采蔬',   '🥬', '生成 1 张草药', atomAct('food_veg', 1)],
    ['cook',     'hunt',     '狩猎',   '🍖', '生成 1 张兽血', atomAct('food_meat', 1)],
    ['cook',     'spice',    '调味',   '🧂', '生成 1 张调料', atomAct('food_season', 1)],
    ['elements', 'ignite',   '火种',   '🔥', '给敌人附 1 层火（叠加可触发反应）', setAura('fire')],
    ['elements', 'douse',    '水沫',   '💧', '给敌人附 1 层水（叠加可触发反应）', setAura('water')],
    ['elements', 'jolt',     '电荷',   '🌩️', '给敌人附 1 层雷（叠加可触发反应）', setAura('thunder')],
    ['elements', 'rime',     '霜花',   '❄️', '给敌人附 1 层冰（叠加可触发反应）', setAura('ice')],
  ];
  PT.forEach(([pack, id, name, icon, desc, act]) => { TAROT['t_' + id] = { name, icon, where: 'battle', pack, desc, apply: act }; });

  CG.TAROT = TAROT;
  CG.TAROT_IDS = Object.keys(TAROT);
  // 某主题集合下「契合」的塔罗 id（掉落偏向用）；general 始终契合。
  CG.tarotsForThemes = function (themes) {
    const set = new Set(themes || []);
    return CG.TAROT_IDS.filter(id => { const p = TAROT[id].pack; return p === 'general' || set.has(p); });
  };
})(window.CG);

window.CG = window.CG || {};

/* ===========================================================================
 *  遗物（被动）—— 也套「代价-价值」资源交换模型（见 DESIGN-resource-exchange.md 附录 D）
 * ===========================================================================
 *  与宝石的区别：遗物多为「净正」——代价在「获取时」一次性付掉（占一个遗物位/一次奖励），
 *  之后永久或每场兑现价值。三种形态：
 *    ① 纯价值（获取代价已付）：开局/每回合直接给一个价值。
 *    ② 条件 → 价值：达成条件才兑现（= 我们的条件原子搬到「永久/每场」尺度）。
 *    ③ 代价 → 价值（boss 遗物式）：背一个「永久负面」换一个「永久价值」（尤其 +能量）。
 *  钩子：onPickup(run) / battleStart(b) / firstTurn(b) / onTurnStart(b)
 *  字段：turnEnergy turnDraw blockTurn regenTurn turnDamage attackBonus attackMult
 *        flatReduce thorns goldOnHit maxEnergyBonus tarotSlot afterGold shopHalf
 *        noTarot guaranteedTarot forgeMin cardMult / damocles·insurance·laststand 引擎按 id 特判
 * ========================================================================= */
(function (CG) {
  CG.RELICS = {
    // ========== ① 纯价值（代价＝获取时的遗物位/奖励）==========
    spear:        { name: '尖矛', icon: '🗡️', desc: '【价值】开局 +1 力量', battleStart: b => b.applyStatus(b.player, 'strength', 1) },
    greenstone:   { name: '青石', icon: '🟢', desc: '【价值】开局 +1 敏捷', battleStart: b => b.applyStatus(b.player, 'dexterity', 1) },
    thorncrown:   { name: '荆棘之冠', icon: '🌿', desc: '【价值】开局 +3 荆棘', battleStart: b => b.applyStatus(b.player, 'thorns', 3) },
    iron_bar:     { name: '铁棒', icon: '🦴', desc: '【价值】每回合 +3 格挡', blockTurn: 3 },
    regen_lump:   { name: '再生肿块', icon: '💗', desc: '【价值】每回合 +2 治疗', regenTurn: 2 },
    polydactyly:  { name: '多指畸形', icon: '🖐️', desc: '【价值】每回合多抽 1 张', turnDraw: 1 },
    little_steven:{ name: '小斯蒂文', icon: '🧒', desc: '【价值】每回合对敌造成 3 伤害', turnDamage: 3 },
    battery:      { name: '电池', icon: '🔋', desc: '【价值】最大能量 +1', maxEnergyBonus: 1 },
    belly_button: { name: '肚脐', icon: '🌀', desc: '【价值】消耗品栏 +1', tarotSlot: 1 },
    dinner:       { name: '晚餐', icon: '🍖', desc: '【价值】最大生命 +5，并立即回满', onPickup: r => { r.maxHp += 5; r.hp = r.maxHp; } },
    magic_shroom: { name: '魔法蘑菇', icon: '🍄', desc: '【价值】最大生命 +5；开局 +2 力量', onPickup: r => { r.maxHp += 5; r.hp += 5; }, battleStart: b => b.applyStatus(b.player, 'strength', 2) },
    feather_boot: { name: '羽靴', icon: '🪶', desc: '【价值】最大生命 +5；开局 +2 敏捷', onPickup: r => { r.maxHp += 5; r.hp += 5; }, battleStart: b => b.applyStatus(b.player, 'dexterity', 2) },

    // ========== ② 条件 → 价值 ==========
    babylon:      { name: '巴比伦之妓', icon: '👹', desc: '【残血(开局生命<半) → 价值】+3 力量', battleStart: b => { if (b.player.hp < b.player.maxHp / 2) b.applyStatus(b.player, 'strength', 3); } },
    eternal_heart:{ name: '永恒之心', icon: '💟', desc: '【满血 → 价值】每回合 +8 格挡（否则 +4）', blockTurn: b => b.player.hp >= b.player.maxHp ? 8 : 4 },
    moms_knife:   { name: '妈妈的刀', icon: '🔪', desc: '【无格挡 → 价值】攻击伤害 +4', attackBonus: b => b.player.block === 0 ? 4 : 0 },
    deaths_touch: { name: '死神之触', icon: '🩻', desc: '【敌无格挡 → 价值】伤害 +3', attackBonus: (b, ctx) => (ctx && ctx.target && ctx.target.block === 0) ? 3 : 0 },
    brother_bobby:{ name: '兄弟鲍比', icon: '👶', desc: '【回合数 → 价值】每回合对敌造成「2+回合数」伤害', onTurnStart: b => { if (b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, 2 + b.turn); } },
    penny:        { name: '吞下的硬币', icon: '🪙', desc: '【受伤 → 价值】每次受伤 +2 金币', goldOnHit: 2 },
    thorns_hat:   { name: '荆棘头盔', icon: '🌵', desc: '【被攻击 → 价值】反弹 3 伤害', thorns: 3 },
    scholar:      { name: '学者之书', icon: '📖', desc: '【首回合 → 价值】额外抽 2 张', firstTurn: b => b.drawCards(2) },
    lantern:      { name: '灯笼', icon: '🏮', desc: '【首回合 → 价值】+1 能量', firstTurn: b => { b.player.energy += 1; } },
    thickshield:  { name: '厚盾', icon: '🛡️', desc: '【首回合 → 价值】+10 格挡', firstTurn: b => b.gainBlock(b.player, 10) },

    // ========== ③ 代价 → 价值（永久负面换永久价值；boss 遗物式）==========
    the_pact:     { name: '契约', icon: '✒️', desc: '【代价】最大生命 -8 →【价值】开局 +3 力量', onPickup: r => { r.maxHp = Math.max(1, r.maxHp - 8); if (r.hp > r.maxHp) r.hp = r.maxHp; }, battleStart: b => b.applyStatus(b.player, 'strength', 3) },
    cancer:       { name: '癌症', icon: '🦀', desc: '【代价】每回合 -2 生命 →【价值】+1 能量、+1 抽', turnEnergy: 1, turnDraw: 1, onTurnStart: b => { b.player.hp = Math.max(1, b.player.hp - 2); } },
    atheist:      { name: '无神论者', icon: '🚫', desc: '【代价】无法获得塔罗 →【价值】每回合 +1 能量', turnEnergy: 1, noTarot: true },
    slot:         { name: '老虎机', icon: '🎰', desc: '【代价】每回合 -6 金币 →【价值】+1 能量', onTurnStart: b => { if (b.run) b.run.gold = Math.max(0, b.run.gold - 6); b.player.energy += 1; } },
    warbanner:    { name: '燃血战旗', icon: '🚩', desc: '【代价】每回合 -2 生命 →【价值】+2 力量', onTurnStart: b => { b.player.hp = Math.max(1, b.player.hp - 2); b.applyStatus(b.player, 'strength', 2); } },
    windbanner:   { name: '疾风战旗', icon: '🏳️', desc: '【代价】每回合 -2 生命 →【价值】+2 敏捷', onTurnStart: b => { b.player.hp = Math.max(1, b.player.hp - 2); b.applyStatus(b.player, 'dexterity', 2); } },
    sac_dagger:   { name: '献祭匕首', icon: '🔱', desc: '【代价】每回合 -2 生命 →【价值】对敌造成 7 伤害', onTurnStart: b => { if (b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, 7); b.player.hp = Math.max(1, b.player.hp - 2); } },
    damocles:     { name: '达摩克利斯之剑', icon: '⚔️', desc: '【代价】一旦受伤立刻变 1 HP 并永久失效 →【价值】所有卡牌数值翻倍', cardMult: 2 },
    prismcore:    { name: '棱镜核心', icon: '🔆', desc: '【代价】敌人开局各 +1 力量 →【价值】每回合 +1 能量', turnEnergy: 1, battleStart: b => b.aliveEnemies().forEach(e => b.applyStatus(e, 'strength', 1)) },
    soulforge:    { name: '灵魂熔炉', icon: '🔥', desc: '【代价】最大生命 -12 →【价值】每回合 +1 能量', turnEnergy: 1, onPickup: r => { r.maxHp = Math.max(1, r.maxHp - 12); if (r.hp > r.maxHp) r.hp = r.maxHp; } },

    // ========== 防御 / 续航 / 复活（代价＝获取）==========
    wafer:        { name: '薄饼', icon: '🧇', desc: '【价值】受到的伤害 -2', flatReduce: 2 },
    holy_mantle:  { name: '圣盾披风', icon: '🪬', desc: '【价值】免疫本场第一次受到的伤害', holyMantle: true },
    insurance:    { name: '人寿保险', icon: '📋', desc: '【价值】可过量治疗；生命低于一半时自动释放储存的过量治疗', overheal: true },
    laststand:    { name: '回光返照密法', icon: '🕯️', desc: '【价值】致死的回合不死、续一回合；该回合击败敌人则以 1 HP 复活（每场一次）', preventDeath: true },
    oneup:        { name: '1up!', icon: '🍀', desc: '【价值】本场致死时满血复活（每场一次）', fullRevive: true },

    // ========== 经济 / 元（代价＝获取）==========
    steam:        { name: 'Steam 促销', icon: '🏷️', desc: '【价值】商店所有价格减半', shopHalf: true },
    piggy:        { name: '存钱罐', icon: '🐷', desc: '【价值】每场战斗后 +15 金币', afterGold: 15 },
    cardbox:      { name: '牌盒', icon: '🎴', desc: '【价值】每场战斗后必掉塔罗', guaranteedTarot: true },
    luckyfoot:    { name: '幸运脚', icon: '🦶', desc: '【价值】你获得/重铸的宝石增益总是 ≥2 级', forgeMin: 2 },
    tulip:        { name: '白色郁金香', icon: '🌷', desc: '【价值】下一个首领额外掉落 2 个遗物', onPickup: r => { r.flags.bonusBossRelics = (r.flags.bonusBossRelics || 0) + 2; } },
    birthcert:    { name: '出生证明', icon: '📜', desc: '【价值】获得一张 3 孔法杖，预镶一颗强力宝石', onPickup: r => { r.deck.push(CG.makeCard('spell', 3, [CG.rollGem({ tier: 'elite', big: true, minLevel: 2 })])); } },
  };

  // —— v3.12：给既有遗物打主题标签（其余/纯元遗物归 general 通用）——
  const RELIC_PACK = {
    spear: 'strength', greenstone: 'dexterity', thorncrown: 'thorns', iron_bar: 'block', regen_lump: 'vitality',
    polydactyly: 'draw', little_steven: 'power', battery: 'energy', magic_shroom: 'strength', feather_boot: 'dexterity',
    babylon: 'blood', eternal_heart: 'block', moms_knife: 'power', deaths_touch: 'power', brother_bobby: 'power',
    penny: 'blood', thorns_hat: 'thorns', scholar: 'draw', lantern: 'energy', thickshield: 'block',
    the_pact: 'blood', cancer: 'blood', warbanner: 'blood', windbanner: 'blood', sac_dagger: 'blood', soulforge: 'blood',
    damocles: 'amplify', wafer: 'immune', holy_mantle: 'immune', insurance: 'vitality',
  };
  Object.keys(RELIC_PACK).forEach(id => { if (CG.RELICS[id]) CG.RELICS[id].pack = RELIC_PACK[id]; });

  // —— v3.12：为其余主题各配套遗物 ——
  // 通用：每回合/触发时把一个「价值原子」即时投放到战斗。
  const atomTurn = (atom, n) => b => {
    const ve = CG.valueEffects(atom, n, 1), t = b.currentTarget ? b.currentTarget() : b.enemy;
    (ve.now || []).forEach(e => CG.Effects.apply(b, e, b.player, t));
    (ve.every || []).forEach(e => b._addEveryTurn(e));
    (ve.next || []).forEach(e => b._addNextTurn(e));
  };
  const fx = (type, value) => b => CG.Effects.apply(b, { type, value }, b.player, b.currentTarget ? b.currentTarget() : b.enemy);
  Object.assign(CG.RELICS, {
    // 进攻
    glint_charm: { name: '微光符', icon: '🎴', pack: 'basic', desc: '【价值】开局 +5 格挡，并对敌人造成 5 点伤害', battleStart: b => { b.gainBlock(b.player, 5); if (b.enemy && b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, 5); } },
    combo_glove: { name: '连击手套', icon: '🥊', pack: 'combo', desc: '【价值】每回合开始：对敌人造成 3 点伤害 ×2', onTurnStart: b => { for (let i = 0; i < 2; i++) if (b.enemy && b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, 3); } },
    war_horn: { name: '战争号角', icon: '📯', pack: 'assault', desc: '【价值】每回合开始：对所有敌人造成 3 点伤害', onTurnStart: b => b.damageAll(3) },
    prism_lens: { name: '棱镜透镜', icon: '🔆', pack: 'amplify', desc: '【价值】每回合开始：下一张牌造成双倍伤害', onTurnStart: b => { b.nextCardDmgMult = Math.max(b.nextCardDmgMult || 1, 2); } },
    // 减益（每回合施加）
    spite_doll: { name: '怨灵娃娃', icon: '🎯', pack: 'vuln', desc: '【价值】每回合开始：对敌人施加 2 层易伤', onTurnStart: atomTurn('vulnerable', 2) },
    sap_totem: { name: '颓力图腾', icon: '💧', pack: 'weak', desc: '【价值】每回合开始：对敌人施加 2 层虚弱', onTurnStart: atomTurn('weak', 2) },
    brittle_seal: { name: '脆裂封印', icon: '🧨', pack: 'frail', desc: '【价值】每回合开始：对敌人施加 2 层脆弱', onTurnStart: atomTurn('frail', 2) },
    venom_fang: { name: '毒牙', icon: '☠️', pack: 'poison', desc: '【价值】每回合开始：对敌人施加 2 层中毒', onTurnStart: atomTurn('poison', 2) },
    ember_brand: { name: '烙印', icon: '🔥', pack: 'burn', desc: '【价值】每回合开始：对敌人施加 2 层灼烧', onTurnStart: atomTurn('burn', 2) },
    grave_bell: { name: '丧钟', icon: '🪦', pack: 'curse', desc: '【价值】每回合开始：对敌人施加 3 层灾厄', onTurnStart: atomTurn('curse', 3) },
    yoke: { name: '重轭', icon: '🔻', pack: 'sapstr', desc: '【价值】每回合开始：使敌人失去 1 点力量', onTurnStart: atomTurn('enemyLoseStr', 1) },
    tar_pit: { name: '沥青坑', icon: '🔽', pack: 'sapdex', desc: '【价值】每回合开始：使敌人失去 1 点敏捷', onTurnStart: atomTurn('enemyLoseDex', 1) },
    contagion: { name: '疫源', icon: '🦠', pack: 'spread', desc: '【价值】开局：对敌人各施加 3 层易伤 / 虚弱 / 脆弱', battleStart: b => { if (b.enemy) ['vulnerable', 'weak', 'frail'].forEach(k => b.applyStatus(b.enemy, k, 3)); } },
    // 防御
    aegis_core: { name: '壁障核心', icon: '🔰', pack: 'ward', desc: '【价值】本场战斗格挡跨回合保留', battleStart: b => { b._blockRetain = true; } },
    barrier_rune: { name: '屏障符文', icon: '✨', pack: 'immune', desc: '【价值】每场战斗免疫第一次受到的伤害', battleStart: b => { b._immuneHits = (b._immuneHits || 0) + 1; } },
    // 节奏 / 牌库
    free_ticket: { name: '免费票', icon: '🎟️', pack: 'flow', desc: '【价值】每回合开始：接下来 1 张牌免费打出', onTurnStart: b => { b.freeCards = (b.freeCards || 0) + 1; } },
    top_hat: { name: '高礼帽', icon: '🎩', pack: 'conjure', desc: '【价值】首回合：生成 1 张带随机宝石的牌', firstTurn: fx('conjure', 1) },
    crystal_ball: { name: '水晶球', icon: '🌠', pack: 'divine', desc: '【价值】首回合：生成 2 张灵魂到抽牌堆', firstTurn: fx('makePeek', 2) },
    twin_mirror: { name: '双子镜', icon: '🪄', pack: 'sorcery', desc: '【价值】首回合：复制 1 张随机手牌', firstTurn: fx('duplicate', 1) },
    dumpster_key: { name: '废料钥匙', icon: '📚', pack: 'pile', desc: '【价值】每回合开始：从弃牌堆取回 1 张牌', onTurnStart: b => { if (b.discardPile.length && b.hand.length < 10) b.hand.push(b.discardPile.pop()); } },
    grindstone: { name: '砂轮', icon: '📈', pack: 'enhance', desc: '【价值】开局：牌库所有攻击牌伤害永久 +1', battleStart: fx('mindblast', 1) },
    pack_rat: { name: '囤积鼠', icon: '📌', pack: 'hold', desc: '【价值】每回合开始：手牌每有一张，+1 格挡', onTurnStart: b => b.gainBlock(b.player, b.hand.length) },
    // 资源 / 引擎
    capacitor: { name: '电容', icon: '🔌', pack: 'elec', desc: '【价值】每回合开始：+2 电力', onTurnStart: b => { b.player.power = (b.player.power || 0) + 2; } },
    wisp_lantern: { name: '磷火灯', icon: '🟢', pack: 'wisp', desc: '【价值】首回合：生成 2 张磷火', firstTurn: fx('makeWisp', 2) },
    tesla_coil: { name: '特斯拉线圈', icon: '⚡', pack: 'elec', desc: '【价值】每回合开始：获得等同当前电力一半的格挡', onTurnStart: b => b.gainBlock(b.player, Math.floor((b.player.power || 0) / 2)) },
    seed_pouch: { name: '种子袋', icon: '🌾', pack: 'cycle', desc: '【价值】每回合开始：+2 格挡并抽 1 张', onTurnStart: b => { b.gainBlock(b.player, 2); b.drawCards(1); } },
    karma_wheel: { name: '业轮', icon: '🔄', pack: 'cycle', desc: '【价值】每回合开始：现有每回合增益额外结算 1 次', onTurnStart: b => { if (b._everyTurn && b._everyTurn.length) b._resolveEveryBuffs(1, false); } },
    ash_urn: { name: '骨灰瓮', icon: '♨️', pack: 'ash', desc: '【价值】每回合开始：获得等同消耗堆牌数的格挡（至多 20）', onTurnStart: b => b.gainBlock(b.player, Math.min(20, b.exhaustPile.length)) },
    // 造物 / 药材 / 元素
    bone_charm: { name: '骨符', icon: '👻', pack: 'summon', desc: '【价值】开局：召唤一具骷髅（血量上限 6）', battleStart: fx('summon', 6) },
    knife_belt: { name: '飞刀带', icon: '🔪', pack: 'dagger', desc: '【价值】首回合：生成 2 张匕首', firstTurn: fx('makeDagger', 2) },
    scrap_box: { name: '甲片盒', icon: '🛡️', pack: 'scrap', desc: '【价值】首回合：生成 2 张甲片', firstTurn: fx('makeScrap', 2) },
    broken_hilt: { name: '残柄', icon: '🗡️', pack: 'endsword', desc: '【价值】开局：锻造出一柄终末之剑', battleStart: fx('forge', 1) },
    veg_basket: { name: '菜篮', icon: '🥬', pack: 'cook', desc: '【价值】首回合：获得 1 张草药', firstTurn: b => { if (b.giveFoodCard) b.giveFoodCard('veg', 1); } },
    meat_hook: { name: '肉钩', icon: '🍖', pack: 'cook', desc: '【价值】首回合：获得 1 张兽血', firstTurn: b => { if (b.giveFoodCard) b.giveFoodCard('meat', 1); } },
    fire_opal: { name: '火蛋白石', icon: '🔥', pack: 'elements', desc: '【价值】开局：给敌人附 1 层火', battleStart: b => { if (b.enemy) b._setAura(b.enemy, 'fire', 1); } },
    water_pearl: { name: '水之珠', icon: '💧', pack: 'elements', desc: '【价值】开局：给敌人附 1 层水', battleStart: b => { if (b.enemy) b._setAura(b.enemy, 'water', 1); } },
    storm_shard: { name: '风暴碎片', icon: '🌩️', pack: 'elements', desc: '【价值】开局：给敌人附 1 层雷', battleStart: b => { if (b.enemy) b._setAura(b.enemy, 'thunder', 1); } },
    frost_gem: { name: '霜晶', icon: '❄️', pack: 'elements', desc: '【价值】开局：给敌人附 1 层冰', battleStart: b => { if (b.enemy) b._setAura(b.enemy, 'ice', 1); } },
  });
  // 其余未打标签的遗物（肚脐/晚餐/无神论者/老虎机/棱镜核心/回光返照/1up/Steam/存钱罐/牌盒/幸运脚/郁金香/出生证明 等元/经济/复活类）归 general。
  Object.keys(CG.RELICS).forEach(id => { if (!CG.RELICS[id].pack) CG.RELICS[id].pack = 'general'; });

  CG.RELIC_IDS = Object.keys(CG.RELICS);
  // 某主题集合下「契合」的遗物 id（掉落偏向用）；general 始终契合。
  CG.relicsForThemes = function (themes) {
    const set = new Set(themes || []);
    return CG.RELIC_IDS.filter(id => { const p = CG.RELICS[id].pack; return p === 'general' || set.has(p); });
  };
})(window.CG);

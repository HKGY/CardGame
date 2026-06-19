window.CG = window.CG || {};

/* ===========================================================================
 *  遗物（被动）—— 精英掉 1、首领掉 2、商店卖 2；不可重复获得同一个。
 * ===========================================================================
 *  钩子（可选）：
 *    onPickup(run)        获得时立即触发
 *    battleStart(battle)  每场战斗开始
 *    firstTurn(battle)    第一回合
 *    onTurnStart(battle)  每个玩家回合开始（battle.run 可拿到 Run）
 *  字段（可选，被引擎读取）：
 *    turnEnergy/turnDraw  每回合额外能量/抽牌
 *    afterGold            每场战斗后额外金币    guaranteedTarot 战后必掉塔罗
 *    shopHalf             商店半价              noTarot 不能获得塔罗
 *    forgeMin             生成/重铸宝石的最低增益等级
 *  达摩克利斯 / 回光返照 / 人寿保险 三个机制较深，由引擎按 id 特判。
 * ===========================================================================
 */
(function (CG) {
  CG.RELICS = {
    spear:       { name: '尖矛', icon: '🗡️', desc: '战斗开始时获得 1 力量',
                   battleStart: b => b.applyStatus(b.player, 'strength', 1) },
    greenstone:  { name: '青石', icon: '🟢', desc: '战斗开始时获得 1 敏捷',
                   battleStart: b => b.applyStatus(b.player, 'dexterity', 1) },
    thickshield: { name: '厚盾', icon: '🛡️', desc: '第一回合获得 10 格挡',
                   firstTurn: b => b.gainBlock(b.player, 10) },
    lantern:     { name: '灯笼', icon: '🏮', desc: '第一回合获得 1 能量',
                   firstTurn: b => { b.player.energy += 1; } },
    banana:      { name: '香蕉', icon: '🍌', desc: '最大生命 +6',
                   onPickup: r => { r.maxHp += 6; r.hp += 6; } },
    donut:       { name: '甜甜圈', icon: '🍩', desc: '立即回满生命',
                   onPickup: r => { r.hp = r.maxHp; } },
    damocles:    { name: '达摩克利斯之剑', icon: '⚔️', desc: '所有卡牌数值翻倍；但一旦受到伤害立刻变为 1 HP 并永久失效', cardMult: 2 },
    cardbox:     { name: '牌盒', icon: '🎴', desc: '每场战斗后必定掉落塔罗牌', guaranteedTarot: true },
    steam:       { name: 'Steam 促销', icon: '🏷️', desc: '商店所有价格减半', shopHalf: true },
    laststand:   { name: '回光返照密法', icon: '🕯️', desc: '被敌人攻击致死的回合不死、可再续一回合；若该回合击败敌人则以 1 HP 复活（每场一次）', preventDeath: true },
    tulip:       { name: '白色郁金香', icon: '🌷', desc: '下一个首领额外掉落 2 个遗物',
                   onPickup: r => { r.flags.bonusBossRelics = (r.flags.bonusBossRelics || 0) + 2; } },
    birthcert:   { name: '出生证明', icon: '📜', desc: '获得一张 3 孔法杖，已预镶一颗强力宝石',
                   onPickup: r => { r.deck.push(CG.makeCard(Math.random() < 0.5 ? 'strike' : 'defend', 3, [CG.rollGem({ tier: 'elite', big: true, minLevel: 2 })])); } },
    fusion:      { name: '核融合炉', icon: '⚛️', desc: '重铸你所有宝石（背包与已镶嵌的）的全部词条',
                   onPickup: r => { r.allGems().forEach(x => CG.recutGem(x.gem)); } },
    piggy:       { name: '存钱罐', icon: '🐷', desc: '每场战斗后额外获得 15 金币', afterGold: 15 },
    insurance:   { name: '人寿保险', icon: '📋', desc: '可过量治疗；当生命低于一半时自动释放储存的过量治疗', overheal: true },
    cancer:      { name: '癌症', icon: '🦀', desc: '每回合多抽 1 张、多 1 能量；但每回合开始失去 2 生命', turnEnergy: 1, turnDraw: 1,
                   onTurnStart: b => { b.player.hp = Math.max(1, b.player.hp - 2); } },
    atheist:     { name: '无神论者', icon: '🚫', desc: '每回合多 1 能量；但无法获得塔罗牌', turnEnergy: 1, noTarot: true },
    luckyfoot:   { name: '幸运脚', icon: '🦶', desc: '你获得 / 重铸的宝石增益总是 ≥2 级', forgeMin: 2 },
    slot:        { name: '老虎机', icon: '🎰', desc: '每回合开始失去 6 金币、获得 1 能量',
                   onTurnStart: b => { if (b.run) b.run.gold = Math.max(0, b.run.gold - 6); b.player.energy += 1; } },

    // ===== 以撒风格的大量遗物 =====
    // —— 攻击 ——
    sad_onion:   { name: '悲伤洋葱', icon: '🧅', desc: '你的每次攻击伤害 +1', attackBonus: 1 },
    deaths_touch:{ name: '死神之触', icon: '🩻', desc: '攻击无格挡的敌人时伤害 +3', attackBonus: (b, ctx) => (ctx && ctx.target && ctx.target.block === 0) ? 3 : 0 },
    moms_knife:  { name: '妈妈的刀', icon: '🔪', desc: '你没有格挡时，攻击伤害 +4', attackBonus: b => b.player.block === 0 ? 4 : 0 },
    crickets:    { name: '蟋蟀之头', icon: '🦗', desc: '你的攻击伤害 +25%', attackMult: 1.25 },
    polyphemus:  { name: '独眼巨人', icon: '🦠', desc: '攻击生命过半的敌人时伤害 +60%', attackMult: (b, ctx) => (ctx && ctx.target && ctx.target.hp > ctx.target.maxHp / 2) ? 1.6 : 1 },
    magic_shroom:{ name: '魔法蘑菇', icon: '🍄', desc: '最大生命 +5；战斗开始获得 2 力量',
                   onPickup: r => { r.maxHp += 5; r.hp += 5; }, battleStart: b => b.applyStatus(b.player, 'strength', 2) },
    // —— 家族（每回合开始攻击敌人）——
    little_steven:{ name: '小斯蒂文', icon: '🧒', desc: '每回合开始对敌人造成 3 点伤害', turnDamage: 3 },
    brother_bobby:{ name: '兄弟鲍比', icon: '👶', desc: '每回合开始对敌人造成「2+回合数」点伤害（越拖越强）',
                   onTurnStart: b => { if (b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, 2 + b.turn); } },
    sac_dagger:  { name: '献祭匕首', icon: '🔱', desc: '每回合开始对敌人造成 7 点伤害，但自身失去 2 HP',
                   onTurnStart: b => { if (b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, 7); b.player.hp = Math.max(1, b.player.hp - 2); } },
    // —— 防御 / 续航 ——
    wafer:       { name: '薄饼', icon: '🧇', desc: '你受到的伤害减少 2', flatReduce: 2 },
    holy_mantle: { name: '圣盾披风', icon: '🪬', desc: '每场战斗免疫第一次受到的伤害', holyMantle: true },
    thorns_hat:  { name: '荆棘头盔', icon: '🌵', desc: '敌人攻击你时，它受到 3 点伤害', thorns: 3 },
    iron_bar:    { name: '铁棒', icon: '🦴', desc: '每回合开始获得 3 格挡', blockTurn: 3 },
    eternal_heart:{ name: '永恒之心', icon: '💟', desc: '每回合开始获得 4 格挡；若你满血则获得 8', blockTurn: b => b.player.hp >= b.player.maxHp ? 8 : 4 },
    regen_lump:  { name: '再生肿块', icon: '💗', desc: '每回合开始回复 2 点生命', regenTurn: 2 },
    blood_bag:   { name: '血袋', icon: '🩸', desc: '最大生命 +10，并立即回满',
                   onPickup: r => { r.maxHp += 10; r.hp = r.maxHp; } },
    breakfast:   { name: '早餐', icon: '🍳', desc: '最大生命 +8', onPickup: r => { r.maxHp += 8; r.hp += 8; } },
    dinner:      { name: '晚餐', icon: '🍖', desc: '最大生命 +5，并立即回满生命', onPickup: r => { r.maxHp += 5; r.hp = r.maxHp; } },
    // —— 能量 / 经济 / 消耗 ——
    battery:     { name: '电池', icon: '🔋', desc: '最大能量 +1', maxEnergyBonus: 1 },
    a_dollar:    { name: '一美元', icon: '💵', desc: '立即获得 100 金币', onPickup: r => { r.gold += 100; } },
    swallowed_penny:{ name: '吞下的硬币', icon: '🪙', desc: '每次受到伤害获得 2 金币', goldOnHit: 2 },
    belly_button:{ name: '肚脐', icon: '🌀', desc: '消耗品栏 +1', tarotSlot: 1 },
    polydactyly: { name: '多指畸形', icon: '🖐️', desc: '每回合多抽 1 张牌', turnDraw: 1 },
    // —— 增益（战斗开始）——
    the_halo:    { name: '光环', icon: '😇', desc: '最大生命 +4；战斗开始获得 1 力量与 1 敏捷',
                   onPickup: r => { r.maxHp += 4; r.hp += 4; }, battleStart: b => { b.applyStatus(b.player, 'strength', 1); b.applyStatus(b.player, 'dexterity', 1); } },
    stigmata:    { name: '圣痕', icon: '✝️', desc: '最大生命 +3；战斗开始获得 1 力量',
                   onPickup: r => { r.maxHp += 3; r.hp += 3; }, battleStart: b => b.applyStatus(b.player, 'strength', 1) },
    // —— 风险 / 复活 ——
    oneup:       { name: '1up!', icon: '🍀', desc: '本场战斗致死时满血复活（每场一次）', fullRevive: true },
    the_pact:    { name: '契约', icon: '✒️', desc: '战斗开始获得 3 力量；但最大生命 -8',
                   onPickup: r => { r.maxHp = Math.max(1, r.maxHp - 8); if (r.hp > r.maxHp) r.hp = r.maxHp; }, battleStart: b => b.applyStatus(b.player, 'strength', 3) },
    whore_babylon:{ name: '巴比伦之妓', icon: '👹', desc: '若战斗开始时生命低于一半，则获得 3 力量',
                   battleStart: b => { if (b.player.hp < b.player.maxHp / 2) b.applyStatus(b.player, 'strength', 3); } },
    warbanner:   { name: '燃血战旗', icon: '🚩', desc: '每回合开始失去 2 生命，但获得 2 力量',
                   onTurnStart: b => { b.player.hp = Math.max(1, b.player.hp - 2); b.applyStatus(b.player, 'strength', 2); } },
    scholar:     { name: '学者之书', icon: '📖', desc: '第一回合额外抽 2 张牌',
                   firstTurn: b => b.drawCards(2) },
    thorncrown:  { name: '荆棘之冠', icon: '🌿', desc: '每场战斗开始获得 3 层荆棘（受击反伤）',
                   battleStart: b => b.applyStatus(b.player, 'thorns', 3) },
    gamblersdie: { name: '赌徒骰', icon: '🎲', desc: '每回合开始有 50% 概率获得 1 点能量',
                   onTurnStart: b => { if (Math.random() < 0.5) b.player.energy += 1; } },
  };

  CG.RELIC_IDS = Object.keys(CG.RELICS);
})(window.CG);

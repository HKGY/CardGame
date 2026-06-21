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

  CG.RELIC_IDS = Object.keys(CG.RELICS);
})(window.CG);

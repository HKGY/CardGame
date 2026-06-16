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
 *    shopHalf             商店半价              noRest 不能休息   noTarot 不能获得塔罗
 *    forgeMin             锻造出的词条最低等级
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
    birthcert:   { name: '出生证明', icon: '📜', desc: '获得一张 10 锻造上限、带 3 个随机词条的卡',
                   onPickup: r => { const c = CG.makeCard(Math.random() < 0.5 ? 'strike' : 'defend', [], 10); for (let i = 0; i < 3; i++) CG.upgradeInstance(c); r.deck.push(c); } },
    fusion:      { name: '核融合炉', icon: '⚛️', desc: '重铸你所有卡牌，并各锻造一次',
                   onPickup: r => { r.deck.forEach(c => { CG.reforgeInstance(c); CG.upgradeInstance(c, { minLevel: r.forgeMinLevel() }); }); } },
    piggy:       { name: '存钱罐', icon: '🐷', desc: '每场战斗后额外获得 15 金币', afterGold: 15 },
    insurance:   { name: '人寿保险', icon: '📋', desc: '可过量治疗；当生命低于一半时自动释放储存的过量治疗', overheal: true },
    cancer:      { name: '癌症', icon: '🦀', desc: '每回合多抽 1 张、多 1 能量；但无法在休息处休息', turnEnergy: 1, turnDraw: 1, noRest: true },
    atheist:     { name: '无神论者', icon: '🚫', desc: '每回合多 1 能量；但无法获得塔罗牌', turnEnergy: 1, noTarot: true },
    luckyfoot:   { name: '幸运脚', icon: '🦶', desc: '你锻造出的词条总是升级过的（≥2 级）', forgeMin: 2 },
    slot:        { name: '老虎机', icon: '🎰', desc: '每回合开始失去 6 金币、获得 1 能量',
                   onTurnStart: b => { if (b.run) b.run.gold = Math.max(0, b.run.gold - 6); b.player.energy += 1; } },
  };

  CG.RELIC_IDS = Object.keys(CG.RELICS);
})(window.CG);

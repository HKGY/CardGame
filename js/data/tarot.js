window.CG = window.CG || {};

/* ===========================================================================
 *  塔罗牌（消耗品）—— 取代药水。放在消耗栏，按情境（战斗 / 地图）使用一次。
 * ===========================================================================
 *  字段：name, icon, where('battle'|'map'|'any'), desc, async?(需二次选择), apply(run, battle, ui)
 *  约定：apply 只改状态；渲染由控制器负责。debuff 给敌人、buff 给自己。
 *    where='battle' 仅战斗中可用；'map' 仅地图上可用；'any' 两处皆可。
 *  ui：{ pickCard(cards, cb), choose(options, cb) } 用于「魔术师 / 太阳」的二次选择。
 * ===========================================================================
 */
(function (CG) {
  const heal = (run, battle, n) => { if (battle) battle.heal(n); else run.gainHp(n); };  // 经治疗入口（人寿保险可过量）

  CG.TAROT = {
    fool:       { name: '愚者', icon: '🃏', where: 'battle', desc: '重新开始本场战斗（不回血、不退还已用道具）',
                  apply: (run, battle) => battle.restart() },
    magician:   { name: '魔术师', icon: '🎩', where: 'battle', async: true, desc: '从抽牌堆选一张牌加入手牌',
                  apply: (run, battle, ui) => ui.pickCard(battle.drawPile, uid => battle.drawToHand(uid)) },
    priestess:  { name: '女祭司', icon: '🌙', where: 'any', desc: '下一个非 Boss 敌人最大生命 -25%',
                  apply: (run) => { run.flags.enemyHpDown = 0.25; } },
    empress:    { name: '女皇', icon: '🌺', where: 'battle', desc: '获得 3 层力量',
                  apply: (run, battle) => battle.applyStatus(battle.player, 'strength', 3) },
    emperor:    { name: '皇帝', icon: '🏛️', where: 'map', desc: '直接传送到本层 Boss',
                  apply: (run) => run.gotoActBoss() },
    hierophant: { name: '教皇', icon: '⛪', where: 'battle', desc: '获得 10 格挡',
                  apply: (run, battle) => battle.gainBlock(battle.player, 10) },
    lovers:     { name: '恋人', icon: '💕', where: 'any', desc: '回复 10 点生命',
                  apply: (run, battle) => heal(run, battle, 10) },
    chariot:    { name: '战车', icon: '🏇', where: 'battle', desc: '本回合获得 6 层力量',
                  apply: (run, battle) => battle.addTempStrength(6) },
    justice:    { name: '正义', icon: '⚖️', where: 'any', desc: '获得 20 金币、2 格挡、回复 2 生命',
                  apply: (run, battle) => { run.gold += 20; heal(run, battle, 2); if (battle) battle.gainBlock(battle.player, 2); } },
    hermit:     { name: '隐士', icon: '🏮', where: 'any', desc: '下一个商店的第一张卡免费',
                  apply: (run) => { run.flags.freeShopCard = true; } },
    wheel:      { name: '命运之轮', icon: '🎡', where: 'any', desc: '用随机塔罗牌填满消耗栏',
                  apply: (run) => run.fillTarot() },
    strength:   { name: '力量', icon: '💪', where: 'battle', desc: '下一张牌造成 3 倍伤害',
                  apply: (run, battle) => { battle.nextCardDmgMult = 3; } },
    hanged:     { name: '倒吊人', icon: '🙃', where: 'any', desc: '下次选路线可无视连线、任选下层房间',
                  apply: (run) => run.freeRoute() },
    death:      { name: '死亡', icon: '☠️', where: 'battle', desc: '所有人受到 20 点伤害',
                  apply: (run, battle) => battle.damageAll(20) },
    temperance: { name: '节制', icon: '🍷', where: 'any', desc: '获得等同于已失去生命的金币',
                  apply: (run, battle) => { const cur = battle ? battle.player.hp : run.hp; run.gold += Math.max(0, run.maxHp - cur); } },
    star:       { name: '群星', icon: '⭐', where: 'any', desc: '下次战斗胜利额外获得一颗宝石',
                  apply: (run) => { run.flags.rewardBonusGem = true; } },
    moon:       { name: '月亮', icon: '🌕', where: 'map', desc: '传送到地图上的随机房间',
                  apply: (run) => run.teleportRandom() },
    sun:        { name: '太阳', icon: '☀️', where: 'any', async: true, desc: '4 力量 / 4 敏捷 / 40 金币（三选一）',
                  apply: (run, battle, ui) => ui.choose([
                    { label: '4 力量', value: 'str', enabled: !!battle },
                    { label: '4 敏捷', value: 'dex', enabled: !!battle },
                    { label: '40 金币', value: 'gold', enabled: true },
                  ], v => {
                    if (v === 'str') battle.applyStatus(battle.player, 'strength', 4);
                    else if (v === 'dex') battle.applyStatus(battle.player, 'dexterity', 4);
                    else run.gold += 40;
                  }) },
    judgement:  { name: '审判', icon: '📯', where: 'battle', desc: '获得 2 能量并抽 2 张牌',
                  apply: (run, battle) => { battle.player.energy += 2; battle.drawCards(2); } },
    world:      { name: '世界', icon: '🌍', where: 'any', desc: '下次卡牌奖励变为随机宝石事件',
                  apply: (run) => { run.flags.rewardAsAltar = true; } },

    // —— 逆位塔罗：发挥与正位相反方向的效果（参考《以撒的结合》逆位牌） ——
    rev_empress:    { name: '女皇·逆', icon: '🔻', where: 'battle', desc: '获得 3 层敏捷（攻转守）',
                      apply: (run, battle) => battle.applyStatus(battle.player, 'dexterity', 3) },
    rev_death:      { name: '死亡·逆', icon: '🔻', where: 'any', desc: '回复 18 点生命（伤转愈）',
                      apply: (run, battle) => heal(run, battle, 18) },
    rev_lovers:     { name: '恋人·逆', icon: '🔻', where: 'any', desc: '失去 6 点生命，换取 30 金币',
                      apply: (run, battle) => { if (battle) battle.player.hp = Math.max(1, battle.player.hp - 6); else run.hp = Math.max(1, run.hp - 6); run.gold += 30; } },
    rev_temperance: { name: '节制·逆', icon: '🔻', where: 'any', desc: '花费 20 金币，回复 10 点生命',
                      apply: (run, battle) => { if (run.gold >= 20) { run.gold -= 20; heal(run, battle, 10); } } },
  };

  CG.TAROT_IDS = Object.keys(CG.TAROT);
})(window.CG);

window.CG = window.CG || {};

/* ===========================================================================
 *  塔罗牌（消耗品）—— 生成式：第三条「价值投放轨道」（见 DESIGN-resource-exchange.md 附录 E）
 * ===========================================================================
 *  与宝石/遗物共用同一套「价值原子」，只换「代价轨道」：
 *    宝石＝每次打出付资源/条件；遗物＝获取/常驻；塔罗＝消耗一个「消耗品栏」、即时一次性、无能量/条件代价。
 *  量级旋钮：塔罗 ≈ 2 能量（StS 药水均值）＝ `round(12 / VP)`（宝石是 6）。
 *  大部分塔罗由价值原子生成（id `t_<atom>`）；另保留少量「不入原子模型」的特色工具牌。
 *  字段：name, icon, where('battle'|'map'|'any'), desc, async?, apply(run, battle, ui)
 * ========================================================================= */
(function (CG) {
  const heal = (run, battle, n) => { if (battle) battle.heal(n); else run.gainHp(n); };

  // 价值原子 → 即时塔罗。n＝~2 能量等值；act 即时投放（战斗给玩家/敌人，地图给跑图资源）。
  const T = [
    { id: 'damage', name: '烈焰', icon: '🔥', where: 'battle', n: 12, desc: n => `对当前敌人造成 ${n} 点伤害`, act: (r, b, n) => { if (b.enemy && b.enemy.hp > 0) b.dealAttackDamage(b.player, b.enemy, n); } },
    { id: 'aoe',    name: '爆轰', icon: '💥', where: 'battle', n: 8,  desc: n => `对所有人造成 ${n} 点伤害`, act: (r, b, n) => b.damageAll(n) },
    { id: 'block',  name: '磐石', icon: '🛡️', where: 'battle', n: 10, desc: n => `获得 ${n} 点格挡`, act: (r, b, n) => b.gainBlock(b.player, n) },
    { id: 'energy', name: '能量', icon: '⚡', where: 'battle', n: 2,  desc: n => `获得 ${n} 点能量`, act: (r, b, n) => { b.player.energy += n; } },
    { id: 'draw',   name: '迅捷', icon: '🌀', where: 'battle', n: 3,  desc: n => `抽 ${n} 张牌`, act: (r, b, n) => b.drawCards(n) },
    { id: 'strength', name: '力量', icon: '💪', where: 'battle', n: 3, desc: n => `获得 ${n} 层力量`, act: (r, b, n) => b.applyStatus(b.player, 'strength', n) },
    { id: 'dexterity', name: '敏捷', icon: '🤸', where: 'battle', n: 4, desc: n => `获得 ${n} 层敏捷`, act: (r, b, n) => b.applyStatus(b.player, 'dexterity', n) },
    { id: 'flex',   name: '狂乱', icon: '😤', where: 'battle', n: 8,  desc: n => `本回合 +${n} 力量（回合末失去）`, act: (r, b, n) => b.addTempStrength(n) },
    { id: 'vulnerable', name: '破绽', icon: '🎯', where: 'battle', n: 8, desc: n => `对当前敌人施加 ${n} 层易伤`, act: (r, b, n) => { if (b.enemy) b.applyStatus(b.enemy, 'vulnerable', n); } },
    { id: 'weak',   name: '疲软', icon: '💧', where: 'battle', n: 6,  desc: n => `对当前敌人施加 ${n} 层虚弱`, act: (r, b, n) => { if (b.enemy) b.applyStatus(b.enemy, 'weak', n); } },
    { id: 'poison', name: '剧毒', icon: '🧪', where: 'battle', n: 8,  desc: n => `对当前敌人施加 ${n} 层中毒`, act: (r, b, n) => { if (b.enemy) b.applyStatus(b.enemy, 'poison', n); } },
    { id: 'regen',  name: '再生', icon: '💚', where: 'battle', n: 6,  desc: n => `获得 ${n} 层再生`, act: (r, b, n) => b.applyStatus(b.player, 'regen', n) },
    { id: 'heal',   name: '治疗', icon: '❤️', where: 'any', n: 8,    desc: n => `回复 ${n} 点生命`, act: (r, b, n) => heal(r, b, n) },
    { id: 'gold',   name: '财富', icon: '💰', where: 'any', n: 40,   desc: n => `获得 ${n} 金币`, act: (r, b, n) => { r.gold += n; } },
    { id: 'maxhp',  name: '活力', icon: '🍐', where: 'any', n: 6,    desc: n => `最大生命 +${n}`, act: (r, b, n) => { r.maxHp += n; r.hp += n; } },
  ];

  const TAROT = {};
  T.forEach(t => { TAROT['t_' + t.id] = { name: t.name, icon: t.icon, where: t.where, atom: t.id, desc: t.desc(t.n), apply: (run, battle, ui) => t.act(run, battle, t.n) }; });

  // —— 保留的特色工具牌（不入价值原子模型；玩法独特、StS 也有此类如 Entropic Brew/Bottled Potential）——
  Object.assign(TAROT, {
    fool:      { name: '愚者', icon: '🃏', where: 'battle', desc: '重新开始本场战斗（不回血、不退道具）', apply: (run, battle) => battle.restart() },
    magician:  { name: '魔术师', icon: '🎩', where: 'battle', async: true, desc: '从抽牌堆选一张牌加入手牌', apply: (run, battle, ui) => ui.pickCard(battle.drawPile, uid => battle.drawToHand(uid)) },
    potent:    { name: '强效药剂', icon: '✨', where: 'battle', desc: '下一张牌造成 3 倍伤害', apply: (run, battle) => { battle.nextCardDmgMult = 3; } },
    emperor:   { name: '皇帝', icon: '🏛️', where: 'map', desc: '直接传送到本层 Boss', apply: (run) => run.gotoActBoss() },
    moon:      { name: '月亮', icon: '🌕', where: 'map', desc: '传送到地图上的随机房间', apply: (run) => run.teleportRandom() },
    priestess: { name: '女祭司', icon: '🌙', where: 'any', desc: '下一个非 Boss 敌人最大生命 -25%', apply: (run) => { run.flags.enemyHpDown = 0.25; } },
    wheel:     { name: '命运之轮', icon: '🎡', where: 'any', desc: '用随机塔罗填满消耗栏', apply: (run) => run.fillTarot() },
    star:      { name: '群星', icon: '⭐', where: 'any', desc: '下次战斗胜利额外获得一颗宝石', apply: (run) => { run.flags.rewardBonusGem = true; } },
  });

  CG.TAROT = TAROT;
  CG.TAROT_IDS = Object.keys(TAROT);
})(window.CG);

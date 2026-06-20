window.CG = window.CG || {};

/* ===========================================================================
 *  效果处理器 —— 卡牌和敌人招式里 effects 的“type”在这里被翻译成具体行为。
 * ===========================================================================
 *  每个处理器签名：fn(game, effect, source, target)
 *     source = 施放者（玩家或敌人）
 *     target = 对方
 *  这样玩家卡和敌人招式能共用同一套效果：
 *     damage -> 打 target；block/strength -> 加给 source；vulnerable/weak -> 给 target。
 *
 *  想加新效果，例如“荆棘”：
 *     CG.Effects.register('thorns', (game, eff, source) => {
 *       game.applyStatus(source, 'thorns', eff.value);
 *     });
 * ===========================================================================
 */
(function (CG) {
  const handlers = {
    damage(game, eff, source, target) {
      const hits = eff.hits || 1;
      for (let i = 0; i < hits; i++) game.dealAttackDamage(source, target, eff.value);
    },
    block(game, eff, source) {
      const hits = eff.hits || 1;
      for (let i = 0; i < hits; i++) game.gainBlock(source, eff.value);
    },
    draw(game, eff) {
      game.drawCards(eff.value);
    },
    energy(game, eff, source) {
      source.energy += eff.value;             // 明亮：回复能量
    },
    heal(game, eff, source) {
      if (source === game.player) game.heal(eff.value);            // 玩家：走 game.heal（动画 / 人寿保险）
      else source.hp = Math.min(source.maxHp, source.hp + eff.value);
    },
    randbuff(game, eff, source) {                                  // 祈祷：随机获得一种增益
      const pool = ['strength', 'dexterity'];
      game.applyStatus(source, pool[Math.floor(Math.random() * pool.length)], eff.value);
    },
    loseHp(game, eff, source) {
      source.hp = Math.max(0, source.hp - eff.value);  // 腐化：直接失去生命（不经格挡）
    },
    strength(game, eff, source) {
      game.applyStatus(source, 'strength', eff.value);
    },
    dexterity(game, eff, source) {
      game.applyStatus(source, 'dexterity', eff.value);
    },
    vulnerable(game, eff, source, target) {
      game.applyStatus(target, 'vulnerable', eff.value);
    },
    weak(game, eff, source, target) {
      game.applyStatus(target, 'weak', eff.value);
    },
    frail(game, eff, source, target) {
      game.applyStatus(target, 'frail', eff.value);   // 破碎：目标获得的格挡 -25%
    },
    selfStatus(game, eff, source) {
      game.applyStatus(source, eff.status, eff.value); // 减益词条：给自己施加易伤/虚弱/脆弱
    },
    poison(game, eff, source, target) { game.applyStatus(target, 'poison', eff.value); },   // 淬毒：每回合受伤
    frozen(game, eff, source, target) {                                  // 冰封：每场战斗仅首次生效
      if (game._frozeUsed) return;
      game._frozeUsed = true;
      game.applyStatus(target, 'frozen', eff.value);
    },
    leech(game, eff, source, target)  { game.applyStatus(target, 'leech', eff.value); },    // 寄生（保留引擎支持）
    silence(game, eff, source, target) {                                 // 沉默：移除当前力量并按等级削减
      if (target.statuses.strength) delete target.statuses.strength;
      game.applyStatus(target, 'strength', -eff.value);
    },
    give(game, eff)     { if (game.giveFoodCard) game.giveFoodCard(eff.what, eff.value); },   // 厨艺：打出后获得食材卡
    freeNext(game, eff) { game.freeCards = (game.freeCards || 0) + eff.value; },              // 回响：接下来若干张牌免费
    exhaustHand(game)   { if (game.exhaustAllHand) game.exhaustAllHand(); },                  // 爆燃：消耗其余手牌
    nightmare(game)     { if (game.fillNightmare) game.fillNightmare(); },                    // 噩梦：渣滓塞满手牌
    // —— 电力包 ——
    gainPower(game, eff) { game.player.power = (game.player.power || 0) + eff.value; },        // 发电
    charge(game, eff)    { const n = Math.min(game.player.power || 0, eff.value); game.player.power -= n; game.player.energy += n; },   // 充电：电力→能量
    losePower(game, eff) { game.player.power = Math.max(0, (game.player.power || 0) - eff.value); },   // 漏电
    selfElement(game, eff) {                                                                  // 感电：给自己附元素（复用敌人光环逻辑）
      const p = game.player, cur = (game._auraOf(p) === eff.element) ? (p.statuses[eff.element] || 0) : 0;
      game._setAura(p, eff.element, cur + eff.value);
    },
    paralyze(game, eff)  { game._paralyze = Math.max(game._paralyze || 0, eff.value); },       // 麻痹：锁住最左 N 张
    // === 死守包 ===
    keepBlock(game)      { game._keepBlock = true; },                                          // 重甲：本场格挡回合末不清空
    loseEnergy(game, eff){ game.player.energy = Math.max(0, game.player.energy - eff.value); }, // 龟缩：失去能量
    loseBlock(game, eff) { game.player.block = Math.max(0, game.player.block - eff.value); },   // 负重：失去格挡
    // === 生产包 ===
    harvest(game, eff) {                                                                       // 丰收：当前产出层数总和 ×value → 格挡
      const st = game.player.statuses;
      const total = (st.prodDraw || 0) + (st.prodBlock || 0) + (st.prodGrow || 0);
      game.gainBlock(game.player, total * eff.value);
    },
    irrigate(game, eff) {                                                                      // 灌溉：立即结算 value 次「每回合产出」
      const st = game.player.statuses;
      for (let i = 0; i < eff.value; i++) {
        if (st.prodBlock) game.gainBlock(game.player, st.prodBlock);
        if (st.prodDraw) game.drawCards(st.prodDraw);
      }
    },
    stagnate(game, eff) {                                                                      // 滞产：蓄能/耕作各 -value（夹 0、为 0 删）
      const st = game.player.statuses;
      ['prodBlock', 'prodDraw'].forEach(k => {
        if (!st[k]) return;
        st[k] = Math.max(0, st[k] - eff.value);
        if (st[k] <= 0) delete st[k];
      });
    },
    // === 留置包 ===
    clutch(game, eff) {                                                                         // 手滑：随机弃 N 张手牌（弃进弃牌堆）
      for (let i = 0; i < eff.value && game.hand.length; i++) {
        const j = Math.floor(Math.random() * game.hand.length);
        game.discardPile.push(game.hand.splice(j, 1)[0]);
      }
    },
  };

  CG.Effects = {
    apply(game, eff, source, target) {
      const fn = handlers[eff.type];
      if (!fn) { console.warn('未知效果类型：', eff.type); return; }
      fn(game, eff, source, target);
    },
    register(type, fn) { handlers[type] = fn; },
  };
})(window.CG);

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
      else {                                                       // 召唤物等其它单位：直接回血 + 治疗动画
        const before = source.hp;
        source.hp = Math.min(source.maxHp, source.hp + eff.value);
        const healed = source.hp - before;
        if (healed > 0) game._fire('heal', { side: game._sideOf(source), ei: -1, amount: healed });
      }
    },
    loseHp(game, eff, source) {
      const u = source || game.player;
      const before = u.hp;
      u.hp = Math.max(0, u.hp - eff.value);  // 腐化/代价：直接失去生命（不经格挡）
      if (u === game.player && u.hp < before) game._countHpLoss();   // #8/#18 计入失去生命
    },
    strength(game, eff, source) {
      game.applyStatus(source, 'strength', eff.value);
    },
    tempStrength(game, eff, source) {                  // 准备/严阵：本回合力量（回合末由 endTurn 移除）
      if (source === game.player) game.addTempStrength(eff.value);
      else game.applyStatus(source, 'strength', eff.value);
    },
    tempDexterity(game, eff, source) {                 // 本回合敏捷（回合末移除，与临时力量对称）
      if (source === game.player) game.addTempDexterity(eff.value);
      else game.applyStatus(source, 'dexterity', eff.value);
    },
    dexterity(game, eff, source) {
      game.applyStatus(source, 'dexterity', eff.value);
    },
    thorns(game, eff, source) {                        // 荆棘：受击反伤（_dealRaw 里已结算反弹）
      game.applyStatus(source, 'thorns', eff.value);
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
    enemyStat(game, eff, source, target) {            // 敌人失去力量/敏捷（可为负）；temp=本回合临时(下个玩家回合复原)
      if (!target) return;
      game.applyStatus(target, eff.key, -eff.value);
      if (eff.temp) (game._tempRevert = game._tempRevert || []).push({ target, key: eff.key, amount: eff.value });
    },
    selfStatus(game, eff, source) {
      game.applyStatus(source, eff.status, eff.value); // 减益词条：给自己施加易伤/虚弱/脆弱
    },
    poison(game, eff, source, target) { game.applyStatus(target, 'poison', eff.value); },   // 淬毒：每回合受伤
    burn(game, eff, source, target) { game.applyStatus(target || game.enemy, 'burn', eff.value); },   // 灼烧：回合结束受伤（可被格挡）
    regen(game, eff, source) { game.applyStatus(source || game.player, 'regen', eff.value); },          // 再生：每回合开始回血、逐回合 -1
    // —— v3.12 猛毒包：尸爆 / 催发 ——
    corpseBomb(game, eff) { game._corpseBomb = (game._corpseBomb || 0) + eff.value; },                  // 尸爆开关：被毒杀的敌人 AoE 其最大生命（×层）
    catalyze(game, eff, source, target) {                                                               // 催发：立即结算敌人中毒 n 次（每次造毒伤 + 毒 -1，可触发尸爆）
      const t = target || game.enemy;
      for (let i = 0; i < eff.value; i++) {
        if (!t || t.hp <= 0 || !(t.statuses.poison > 0)) break;
        game._dotDamage(t, t.statuses.poison, false);
        game._corpseBombCheck(t);
        if (t.statuses.poison > 0) { t.statuses.poison -= 1; if (t.statuses.poison <= 0) delete t.statuses.poison; }
      }
      game._checkEnd();
    },
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
    give(game, eff)     { if (game.giveFoodCard) game.giveFoodCard(eff.what, eff.value); },   // 厨艺：打出后获得药材卡
    freeNext(game, eff) { game.freeCards = (game.freeCards || 0) + eff.value; },              // 回响：接下来若干张牌免费
    // —— 时点修饰器（本回合/下回合/每回合）——
    scheduleEvery(game, eff) { game._addEveryTurn(eff.eff); },     // 每回合：经 _addEveryTurn（增益受「最多 N 种」上限约束）
    scheduleNext(game, eff)  { game._addNextTurn(eff.eff); },     // 下回合：经 _addNextTurn（同种合并）
    exhaustHand(game)   { if (game.exhaustAllHand) game.exhaustAllHand(); },                  // 爆燃：消耗其余手牌
    nightmare(game)     { if (game.fillNightmare) game.fillNightmare(); },                    // 噩梦：渣滓塞满手牌
    // —— 电力包 ——
    gainPower(game, eff) { game.player.power = (game.player.power || 0) + eff.value; },        // 发电
    charge(game, eff)    { const n = Math.min(game.player.power || 0, eff.value); game.player.power -= n; game.player.energy += n; },   // 充电：电力→能量
    losePower(game, eff) { game.player.power = Math.max(0, (game.player.power || 0) - eff.value); },   // 漏电
    // —— 强化包（随机一张手牌的本场永久成长；whet 供 磨石塔罗/砂轮遗物复用）——
    whet(game, eff)   { const c = randHand(game); if (c) c.growth = (c.growth || 0) + eff.value; },                       // 磨砺：随机手牌成长 +N
    loseGold(game, eff) { if (game.run) game.run.gold = Math.max(0, (game.run.gold || 0) - eff.value); },             // v3 金币代价（首石免）
    // === 召唤包 ===（单骷髅「类玩家单位」）
    summon(game, eff, source) {   // 召唤：无骷髅→新建(血量上限 n)；有→ +血量上限 n（并回血 n）
      const n = Math.max(1, eff.value), sk = game.skeleton;
      if (sk && sk.hp > 0) { sk.maxHp += n; sk.hp += n; }
      else game.skeleton = { hp: n, maxHp: n, block: 0, statuses: {} };
    },
    // === 术士包 ===（造牌/复制/牌库强化；clutter 塞渣滓）
    conjure(game, eff) {                                                            // 造牌：生成一张带随机 n 颗宝石的本场卡牌（本回合 0 费）
      const n = Math.max(1, eff.value), gems = [];
      for (let i = 0; i < n; i++) gems.push(CG.rollGem({ tier: 'monster' }));
      const card = CG.makeCard('spell', n, gems);
      card.conjuredTurn = game.turn;                                                // playCard 据此本回合免费
      game._addToHand(card);
    },
    duplicate(game) { if (game.hand.length) { const c = game.hand[Math.floor(Math.random() * game.hand.length)]; game._addToHand(CG.makeCard(c.base, c.limit, c.sockets || [])); } },   // 复制随机手牌
    mindblast(game, eff) { [...game.drawPile, ...game.discardPile, ...game.hand].forEach(c => { const b = CG.BASE_CARDS[c.base]; if (b && b.type === 'attack') c.growth = (c.growth || 0) + eff.value; }); },   // 心灵震慑：牌库攻击牌永久+伤害（复用 growth）
    clutter(game, eff) { for (let i = 0; i < eff.value; i++) game._addToHand(CG.makeFoodCard('dross')); },                          // 谵妄：塞渣滓
    // === 新批价值效果（v3.6）===
    recallDiscard(game, eff) { for (let i = 0; i < eff.value && game.discardPile.length; i++) game._addToHand(game.discardPile.pop()); },   // #4 弃牌区 n 张 → 手牌
    recycleDraw(game, eff) { for (let i = 0; i < eff.value && game.discardPile.length; i++) { const j = Math.floor(Math.random() * game.discardPile.length); const c = game.discardPile.splice(j, 1)[0]; game.drawPile.splice(Math.floor(Math.random() * (game.drawPile.length + 1)), 0, c); } },   // #5 弃牌区 n 张 → 随机洗回抽牌堆
    playFromDraw(game, eff) { for (let i = 0; i < eff.value && game.drawPile.length; i++) { const c = game.drawPile.pop(); game._applyCardEffects(c); game.discardPile.push(c); } },   // #19 打出抽牌堆顶 n 张（免费）
    socketRandom(game, eff) { let n = eff.value; for (const c of game.hand) { if (n <= 0) break; if (CG.isFood(c.base)) continue; const st = CG.cardStats(c); if (st.emptySockets > 0) { c.sockets = (c.sockets || []).concat(CG.rollGem({ tier: 'monster' })); n--; } } },   // #6 给 n 张有空位手牌镶随机宝石(本场)
    debuffMult(game, eff, source, target) { const t = target || game.enemy; if (!t) return; const f = 1 + eff.value; ['vulnerable', 'weak', 'frail', 'poison', 'burn'].forEach(k => { if (t.statuses[k]) t.statuses[k] = Math.floor(t.statuses[k] * f); }); },   // #3 敌人所有减益层数 ×(1+n)
    immune(game, eff) { game._immuneHits = (game._immuneHits || 0) + eff.value; },                  // #27 免疫下 n 次伤害
    vulnAmp(game, eff) { game._vulnAmp = (game._vulnAmp || 0) + eff.value; },                       // #13 敌易伤受伤额外 +25%×n（本场）
    weakAmp(game, eff) { game._weakAmp = true; },                                                   // #14 敌虚弱减攻额外 +15%（本场、不叠加）
    keepBlockFull(game, eff) { game._blockRetain = true; },                                         // #21 格挡跨回合保留（本场）
    dmgCap1(game, eff) { game._dmgCap1 = true; },                                                   // #28 本回合受到伤害降为 1
    tempThorns(game, eff, source) { const u = source || game.player; game.applyStatus(u, 'thorns', eff.value); if (u === game.player) game._tempThorns = (game._tempThorns || 0) + eff.value; },   // 本回合荆棘（回合末移除）
    makeDagger(game, eff) { for (let i = 0; i < eff.value; i++) { const c = CG.makeFoodCard('dagger'); c._bonus = game._daggerBonus || 0; game._stampIllusion(c); game._cardsMade = (game._cardsMade || 0) + 1; game._addToHand(c); } },   // #23 生成 n 张匕首（带当前强化）
    makeScrap(game, eff) { for (let i = 0; i < eff.value; i++) { const c = CG.makeFoodCard('scrap'); c._bonus = game._scrapBonus || 0; game._stampIllusion(c); game._cardsMade = (game._cardsMade || 0) + 1; game._addToHand(c); } },     // #24 生成 n 张甲片
    makeWisp(game, eff) { for (let i = 0; i < eff.value; i++) { const c = CG.makeFoodCard('wisp'); c._bonus = Math.floor(game._wispBonus || 0); game._stampIllusion(c); game._cardsMade = (game._cardsMade || 0) + 1; game._addToHand(c); } },   // v3.13 生成 n 张磷火（带强化/幻境）
    illusion(game, eff) { game._illusion = (game._illusion || 0) + 0.5 * eff.value; },   // v3.13 幻境：本回合生成的临时卡牌效果 +50%×n（回合末清）
    peekUp(game, eff) { game._peekBonus = (game._peekBonus || 0) + eff.value; game._refreshWeapon('peek', game._peekBonus); },   // v3.13 灵魂强化：本场灵魂抽牌 +n
    wispUp(game, eff) { game._wispBonus = (game._wispBonus || 0) + 0.5 * eff.value; game._refreshWeapon('wisp', Math.floor(game._wispBonus)); },   // v3.13 磷火强化：本场磷火能量 +0.5n（floor）
    wish(game, eff) { game._pickQueue = game._pickQueue || []; for (let i = 0; i < eff.value; i++) game._pickQueue.push('wish'); if (game._nextPick) game._nextPick(); },   // v3.13 许愿（调度版）：从抽牌堆挑 n 张进手
    foresight(game, eff) { game._pendingForesight = (game._pendingForesight || 0) + eff.value; game._foresightThisTurn = true; },   // v3.15 占卜·预见：标记待预见（playCard 在 pick 队列重置后再起预见，避免被清空）；塔罗/遗物走 _startForesight 直起
    transform(game, eff) { game._pendingTransform = (game._pendingTransform || 0) + eff.value; },   // v3.15 幻惑·变化：标记待变化（同上，playCard 队列重置后再入队）
    mimicry(game, eff) { game._pendingMimicry = (game._pendingMimicry || 0) + eff.value; },         // v3.15 幻惑·变化为模仿
    daggerUp(game, eff) { game._daggerBonus = (game._daggerBonus || 0) + 4 * eff.value; game._refreshWeapon('dagger', game._daggerBonus); },   // #25 匕首伤害 +4×n（本场，刷新所有匕首）
    scrapUp(game, eff) { game._scrapBonus = (game._scrapBonus || 0) + 3 * eff.value; game._refreshWeapon('scrap', game._scrapBonus); },        // #26 甲片格挡 +3×n（本场）
    forge(game, eff) {   // #33 锻造：终末之剑伤害 +n（不论何处）；若各堆均无则创造一张进手牌
      game._endswordDmg = (game._endswordDmg || 0) + eff.value; game._refreshEndsword();
      const exists = [...game.hand, ...game.drawPile, ...game.discardPile, ...game.exhaustPile].some(c => c.base === 'endsword');
      if (!exists) { const c = CG.makeFoodCard('endsword'); c._bonus = game._endswordDmg; c._blk = game._endswordBlk || 0; game._addToHand(c); }
    },
    parry(game, eff) { game._endswordBlk = (game._endswordBlk || 0) + eff.value; game._refreshEndsword(); },   // #36 招架：终末之剑 +n 格挡（不论何处）
    // === v3.8 ===
    curse(game, eff, source, target) { game.applyStatus(target || game.enemy, 'curse', eff.value); },   // #41 灾厄：层数 > 敌人生命则其回合末死亡
    makePeek(game, eff) { for (let i = 0; i < eff.value; i++) { const c = CG.makeFoodCard('peek'); c._bonus = game._peekBonus || 0; game._stampIllusion(c); game._cardsMade = (game._cardsMade || 0) + 1; game.drawPile.splice(Math.floor(Math.random() * (game.drawPile.length + 1)), 0, c); } },   // #39 生成 n 张灵魂到抽牌堆（带强化/幻境）
    loseMinionHp(game, eff) { const sk = game.skeleton; if (sk) { sk.hp = Math.max(0, sk.hp - eff.value); if (sk.hp <= 0) game.skeleton = null; } },   // #42 消耗召唤物血量代价
    expandEvery(game, eff) { game._everyCap = (game._everyCap || 3) + eff.value; },   // #46 扩容：每回合增益上限 +n
    harvestEvery(game, eff) { game._resolveEveryBuffs(eff.value, false); },           // #47 收割：立即获得 n 次现有每回合增益
    detonateEvery(game, eff) { game._resolveEveryBuffs(4 * eff.value, true); },       // #50 爆破：立即获得 4n 次并失去
    recycle(game, eff) { const made = game.hand.filter(c => !c._initial); game.hand = game.hand.filter(c => c._initial); made.forEach(c => game._exhaustCard(c)); game.drawCards(made.length); },   // #48 回收：消耗手牌中非初始牌、抽等量
    // === 活力（强袭包）===
    vigor(game, eff) { game._vigor = (game._vigor || 0) + eff.value; },   // #35 活力：下一张造成伤害的牌 +n 攻击（playCard 消耗）
  };
  function randHand(game) { const h = game.hand || []; return h.length ? h[Math.floor(Math.random() * h.length)] : null; }

  CG.Effects = {
    apply(game, eff, source, target) {
      const fn = handlers[eff.type];
      if (!fn) { console.warn('未知效果类型：', eff.type); return; }
      fn(game, eff, source, target);
    },
    register(type, fn) { handlers[type] = fn; },
  };
})(window.CG);

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
    randbuff(game, eff, source) {                                  // 祈祷：随机获得一种增益
      const pool = ['strength', 'dexterity'];
      game.applyStatus(source, pool[Math.floor(Math.random() * pool.length)], eff.value);
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
    give(game, eff)     { if (game.giveFoodCard) game.giveFoodCard(eff.what, eff.value); },   // 厨艺：打出后获得食材卡
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
    selfElement(game, eff) {                                                                  // 感电：给自己附元素（复用敌人光环逻辑）
      const p = game.player, cur = (game._auraOf(p) === eff.element) ? (p.statuses[eff.element] || 0) : 0;
      game._setAura(p, eff.element, cur + eff.value);
    },
    paralyze(game, eff)  { game._paralyze = Math.max(game._paralyze || 0, eff.value); },       // 麻痹：锁住最左 N 张
    // === 死守包 ===
    keepBlock(game, eff) { game._keepBlock = Math.max(game._keepBlock || 0, eff.value || 1); },  // 重甲：接下来 N 回合格挡不清空（计数器）
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
    // —— 强化包（随机一张手牌的本场永久成长/降费；handler 内直接改实例字段）——
    whet(game, eff)   { const c = randHand(game); if (c) c.growth = (c.growth || 0) + eff.value; },                       // 磨砺：随机手牌成长 +N
    quench(game, eff) { const c = randHand(game); if (c) c.costDown = (c.costDown || 0) + 1; },                           // 淬火：随机手牌永久降费 -1（eff.value 仅记等级）
    anneal(game, eff) { const c = randHand(game); if (c) c.growth = Math.max(0, (c.growth || 0) - eff.value); },          // 退火：随机手牌成长 -N（不低于 0）
    // === 虚无包 ===（eff.value = 词条等级 L；maxHp 改动仅本场，不写回 run）
    devote(game, eff, source, target) {                                                       // 舍身：失 2L 当前生命，对当前敌人造 6L 伤害
      game.player.hp = Math.max(0, game.player.hp - 2 * eff.value);
      game._checkEnd();
      if (target && target.hp > 0) game.dealAttackDamage(source, target, 6 * eff.value);
    },
    annihilate(game, eff, source, target) {                                                   // 湮灭：从抽牌堆顶放逐 L 张，对当前敌人造 (放逐数)×5 伤害
      let n = 0;
      for (let i = 0; i < eff.value && game.drawPile.length > 0; i++) { game.exhaustPile.push(game.drawPile.pop()); n++; }
      if (n > 0 && target && target.hp > 0) game.dealAttackDamage(source, target, n * 5);
    },
    offer(game, eff) {                                                                          // 献祭：本场最大生命 -3L（下限 1），获得 2L 力量
      game.player.maxHp = Math.max(1, game.player.maxHp - 3 * eff.value);
      game.player.hp = Math.min(game.player.hp, game.player.maxHp);
      game.applyStatus(game.player, 'strength', 2 * eff.value);
    },
    erode(game, eff) {                                                                          // 蚀骨：本场最大生命 -L（下限 1）
      game.player.maxHp = Math.max(1, game.player.maxHp - eff.value);
      game.player.hp = Math.min(game.player.hp, game.player.maxHp);
    },
    banish(game, eff) {                                                                         // 放逐代价：随机放逐 L 张手牌到消耗堆
      for (let i = 0; i < eff.value && game.hand.length > 0; i++) {
        const idx = Math.floor(Math.random() * game.hand.length);
        game.exhaustPile.push(game.hand.splice(idx, 1)[0]);
      }
    },
    // === 奇巧包 ===（随机/赌博：随机源一律走 Math.random()→被 CG.RNG 接管，固定种子可断言）
    dice(game, eff, source, target) {                                    // 掷骰：每级掷 1 颗 1~6，合计伤害
      const roll = Math.floor(Math.random() * 6) + 1;                    // 1~6
      game.dealAttackDamage(source, target, roll * eff.value);
    },
    coinflip(game, eff, source, target) {                                // 抛硬币：50% 造成 8×等级 伤害，否则无效
      if (Math.random() < 0.5) game.dealAttackDamage(source, target, 8 * eff.value);
    },
    jackpot(game, eff, source, target) {                                 // 头奖：等概率三选一（伤害 / 格挡 / 抽牌）
      const r = Math.floor(Math.random() * 3);
      if (r === 0) game.dealAttackDamage(source, target, 10 * eff.value);
      else if (r === 1) game.gainBlock(source, 10 * eff.value);
      else game.drawCards(3);
    },
    slots(game, eff, source, target) {                                   // 老虎机：每打出第 3 张爆出 20×等级 伤害（伪随机保底）
      game._slots = (game._slots || 0) + 1;
      if (game._slots >= 3) { game._slots = 0; game.dealAttackDamage(source, target, 16 * eff.value); }
    },
    misfire(game, eff) {                                                  // 哑火：25% 炸膛，玩家直接失去 3×等级 生命（过格挡）
      if (Math.random() < 0.25) {
        game.player.hp = Math.max(0, game.player.hp - 3 * eff.value);
        game._checkEnd();
      }
    },
    fickle(game, eff) {                                                   // 无常：随机给玩家一种减益 eff.value 层
      const pool = ['vulnerable', 'weak', 'frail'];
      game.applyStatus(game.player, pool[Math.floor(Math.random() * pool.length)], eff.value);
    },
    backfire(game, eff, source, target) {                                // 走火：50% 对敌人、否则对自己造成 5×等级 伤害
      const n = 5 * eff.value;
      if (Math.random() < 0.5) game.dealAttackDamage(source, target, n);
      else {
        const eh = game.player.hp, eb = game.player.block;
        game._dealRaw(game.player, n);
        game._fire('damage', { side: 'player', ei: game._idxOf(game.player), hpLoss: eh - game.player.hp, blocked: Math.min(eb, n) });
        game._checkEnd();
      }
    },
    // === 市场包 ===（金币＝run.gold；无跑图时金币操作安全跳过）
    invest(game, eff, source, target) { const r = game.run; if (!r) return; const spend = Math.min(r.gold || 0, 2 * eff.value); if (spend > 0) { r.gold -= spend; if (target && target.hp > 0) game.dealAttackDamage(source, target, spend); } },   // 投资：花至多 2L 金币·造等量(×1)伤害
    loseGold(game, eff) { if (game.run) game.run.gold = Math.max(0, (game.run.gold || 0) - eff.value); },             // v3 金币代价（首石免）
    income(game, eff) { if (game.run) game.run.gold = (game.run.gold || 0) + 3 * eff.value; },                       // 进账
    trade(game, eff)  { game.drawCards(1); if (game.run) game.run.gold = (game.run.gold || 0) + 2 * eff.value; },    // 贸易
    hire(game, eff)   { const r = game.run; if (r && (r.gold || 0) >= 5 * eff.value) { r.gold -= 5 * eff.value; game.applyStatus(game.player, 'strength', eff.value); } },  // 雇佣
    tax(game, eff)    { if (game.run) game.run.gold = Math.max(0, (game.run.gold || 0) - eff.value); },              // 赋税（eff.value 已含 ×4）
    inflation(game)   { if (game.run) game.run.gold = Math.floor((game.run.gold || 0) * 0.8); },                     // 通胀
    debt(game, eff)   { const r = game.run, amt = eff.value; if (r && (r.gold || 0) >= amt) { r.gold -= amt; } else { if (r) r.gold = 0; game.player.hp = Math.max(0, game.player.hp - amt); game._checkEnd(); } },  // 赌债（eff.value 已含 ×3）
    // === 矿工包 ===（深度＝game._depth；每跨 5 深度掘出产出：有跑图给金币、否则给格挡）
    mine(game, eff)   { const old = game._depth || 0; game._depth = old + 2 * eff.value; const y = Math.floor(game._depth / 5) - Math.floor(old / 5); for (let i = 0; i < y; i++) { if (game.run) game.run.gold = (game.run.gold || 0) + 8; else game.gainBlock(game.player, 4); } },
    blast(game, eff)  { game._depth = (game._depth || 0) + 5 * eff.value; },                                         // 爆破
    richvein(game, eff) { if (game.run && game.run.gems) game.run.gems.push(CG.rollGem({ tier: 'elite' })); },  // 富矿：掘出 1 颗随机宝石进背包（平衡：不随等级翻倍，宝石＝最高价值资源，避免每回合刷出指数级宝石）
    cavein(game, eff) { game.player.hp = Math.max(0, game.player.hp - 3 * eff.value); game._checkEnd(); },           // 塌方
    barren(game, eff) { game._depth = Math.max(0, (game._depth || 0) - 3 * eff.value); },                            // 贫矿
    disaster(game)    { game._depth = Math.floor((game._depth || 0) / 2); },                                         // 矿难
    // === 锻造包 ===（热度＝game._heat；熔炼/淬炼一次性烧光热度）
    bellows(game, eff)  { game._heat = (game._heat || 0) + 2 * eff.value; },                                         // 鼓风
    smelt(game, eff, source, target) { const h = game._heat || 0; if (h > 0 && target && target.hp > 0) game.dealAttackDamage(source, target, h * eff.value); game._heat = 0; },  // 熔炼
    coolant(game, eff)  { const h = game._heat || 0; if (h > 0) game.gainBlock(game.player, h * eff.value); game._heat = 0; },  // 淬炼
    whitehot(game, eff, source, target) { game._heat = (game._heat || 0) + 3 * eff.value; if (target && target.hp > 0) game.dealAttackDamage(source, target, 3 * eff.value); },  // 白热
    overheat(game, eff) { game.applyStatus(game.player, 'burn', eff.value); },                                       // 过热（eff.value 已含 ×2）
    crack(game, eff)    { game.player.block = Math.max(0, game.player.block - eff.value); },                         // 崩裂（eff.value 已含 ×4）
    rust(game, eff)     { game._heat = Math.max(0, (game._heat || 0) - eff.value); },                                // 锈蚀（eff.value 已含 ×3）
    // === 召唤包 ===（己方召唤物 game.allies；toll 复用 loseHp）
    summon(game, eff, source) {   // 召唤：单骷髅「类玩家单位」。无骷髅→新建(血量上限 n)；有→ +血量上限 n（并回血 n）
      const n = Math.max(1, eff.value), sk = game.skeleton;
      if (sk && sk.hp > 0) { sk.maxHp += n; sk.hp += n; }
      else game.skeleton = { hp: n, maxHp: n, block: 0, statuses: {} };
    },
    command(game, eff) { const A = game.allies || []; if (!A.length) return; const a = A[Math.floor(Math.random() * A.length)]; a.atk += eff.value; const t = game.currentTarget && game.currentTarget(); if (a.atk > 0 && t && t.hp > 0) { const before = t.hp, bb = t.block; game._dealRaw(t, a.atk); game._fire('damage', { side: 'enemy', ei: game._idxOf(t), hpLoss: before - t.hp, blocked: Math.min(bb, a.atk) }); } },   // 督战：随机一个召唤物 +攻并立即由它单独攻击一次（不再让全体多攻一轮）
    culling(game, eff) { const A = game.allies || []; for (let i = 0; i < eff.value && A.length; i++) A.splice(Math.floor(Math.random() * A.length), 1); },  // 折损
    discord(game, eff) { (game.allies || []).forEach(a => { a.hp -= eff.value; }); if (game._reapAllies) game._reapAllies(); },   // 内讧
    // === 建造包 ===（建筑 game.buildings；每回合开始由 _buildingsTick 触发）
    build(game, eff) {
      const L = eff.value, B = (game.buildings = game.buildings || []);
      const pow = ({ arrowtower: 2 * L, rampart: 2 * L, furnace: 1, workshop: 1 })[eff.what] || L;
      const meta = ({ arrowtower: ['箭塔', '🏹'], rampart: ['路障', '🧱'], furnace: ['熔炉', '🔥'], workshop: ['工坊', '🏭'] })[eff.what] || ['建筑', '🏗️'];
      if (B.length < 5) B.push({ kind: eff.what, name: meta[0], icon: meta[1], power: pow });   // 槽位上限 5
    },
    demolish(game, eff) { const B = game.buildings || []; if (!B.length) return; const b = B.shift(); for (let i = 0; i < eff.value; i++) game._fireBuilding(b); },   // 拆解：拆最早的一座、立即结算 L 次
    collapse(game, eff) { const B = game.buildings || []; for (let i = 0; i < eff.value && B.length; i++) B.splice(Math.floor(Math.random() * B.length), 1); },   // 坍塌
    subside(game, eff)  { (game.buildings || []).forEach(b => { b.power = Math.max(0, b.power - eff.value); }); },   // 沉降
    // === 弃牌包 ===（reclaim 走选牌队列；forget→clutch、waste→loseEnergy 复用）
    toss(game, eff, source, target) { game._discardRandom(1); if (target && target.hp > 0) game.dealAttackDamage(source, target, 6 * eff.value); },   // 抛掷
    sift(game) { game._discardRandom(2); game.drawCards(2); },                                       // 整理：弃 2 抽 2
    madness(game) { const n = game.hand.length; game._discardRandom(n); if (n > 0) game.applyStatus(game.player, 'strength', n); },   // 疯狂：弃光手牌·每张+1力量
    // === 术士包 ===（造牌/复制/灵视/牌库强化；clutter 塞渣滓）
    conjure(game, eff) {                                                            // 造牌：生成一张带随机 n 颗宝石的本场卡牌（本回合 0 费）
      const n = Math.max(1, eff.value), gems = [];
      for (let i = 0; i < n; i++) gems.push(CG.rollGem({ tier: 'monster' }));
      const card = CG.makeCard('spell', n, gems);
      card.conjuredTurn = game.turn;                                                // playCard 据此本回合免费
      game._addToHand(card);
    },
    daggers(game) { for (let i = 0; i < 3; i++) game._addToHand(CG.makeFoodCard('shiv')); },                                       // 飞刀×3
    duplicate(game) { if (game.hand.length) { const c = game.hand[Math.floor(Math.random() * game.hand.length)]; game._addToHand(CG.makeCard(c.base, c.limit, c.sockets || [])); } },   // 复制随机手牌
    foresight(game) { if (game.drawPile.length) { const c = game.drawPile.pop(); game._applyCardEffects(c); game.discardPile.push(c); } },   // 灵视：免费打出牌堆顶
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
    makeDagger(game, eff) { for (let i = 0; i < eff.value; i++) { const c = CG.makeFoodCard('dagger'); c._bonus = game._daggerBonus || 0; game._addToHand(c); } },   // #23 生成 n 张匕首（带当前强化）
    makeScrap(game, eff) { for (let i = 0; i < eff.value; i++) { const c = CG.makeFoodCard('scrap'); c._bonus = game._scrapBonus || 0; game._addToHand(c); } },     // #24 生成 n 张甲片
    daggerUp(game, eff) { game._daggerBonus = (game._daggerBonus || 0) + 4 * eff.value; game._refreshWeapon('dagger', game._daggerBonus); },   // #25 匕首伤害 +4×n（本场，刷新所有匕首）
    scrapUp(game, eff) { game._scrapBonus = (game._scrapBonus || 0) + 3 * eff.value; game._refreshWeapon('scrap', game._scrapBonus); },        // #26 甲片格挡 +3×n（本场）
    forge(game, eff) {   // #33 锻造：终末之剑伤害 +n（不论何处）；若各堆均无则创造一张进手牌
      game._endswordDmg = (game._endswordDmg || 0) + eff.value; game._refreshEndsword();
      const exists = [...game.hand, ...game.drawPile, ...game.discardPile, ...game.exhaustPile].some(c => c.base === 'endsword');
      if (!exists) { const c = CG.makeFoodCard('endsword'); c._bonus = game._endswordDmg; c._blk = game._endswordBlk || 0; game._addToHand(c); }
    },
    parry(game, eff) { game._endswordBlk = (game._endswordBlk || 0) + eff.value; game._refreshEndsword(); },   // #36 招架：终末之剑 +n 格挡（不论何处）
    // === v3.8 ===
    curse(game, eff, source, target) { game.applyStatus(target || game.enemy, 'curse', eff.value); },   // #41 咒言：层数 > 敌人生命则其回合末死亡
    makePeek(game, eff) { for (let i = 0; i < eff.value; i++) { const c = CG.makeFoodCard('peek'); game._cardsMade = (game._cardsMade || 0) + 1; game.drawPile.splice(Math.floor(Math.random() * (game.drawPile.length + 1)), 0, c); } },   // #39 生成 n 张洞悉到抽牌堆
    loseMinionHp(game, eff) { const sk = game.skeleton; if (sk) { sk.hp = Math.max(0, sk.hp - eff.value); if (sk.hp <= 0) game.skeleton = null; } },   // #42 消耗召唤物血量代价
    expandEvery(game, eff) { game._everyCap = (game._everyCap || 3) + eff.value; },   // #46 扩容：每回合增益上限 +n
    harvestEvery(game, eff) { game._resolveEveryBuffs(eff.value, false); },           // #47 收割：立即获得 n 次现有每回合增益
    detonateEvery(game, eff) { game._resolveEveryBuffs(4 * eff.value, true); },       // #50 爆破：立即获得 4n 次并失去
    recycle(game, eff) { const made = game.hand.filter(c => !c._initial); game.hand = game.hand.filter(c => c._initial); made.forEach(c => game._exhaustCard(c)); game.drawCards(made.length); },   // #48 回收：消耗手牌中非初始牌、抽等量
    // === 猎杀包 ===（处决/引爆减益/收割；prey/insight 是 playCard 加成）
    exploit(game, eff, source, target) { if (!target) return; const layers = game._enemyDebuffLayers(target); ['vulnerable', 'weak', 'frail', 'poison', 'burn'].forEach(k => delete target.statuses[k]); if (layers > 0 && target.hp > 0) game.dealAttackDamage(source, target, layers * 12 * eff.value); },
    reaping(game, eff) { game._reaping = (game._reaping || 0) + 3 * eff.value; },
    // === 律动包 ===（活力滚到下一张、灵感本回合抽牌给盾；innate/allin/surplus 在 cardStats/playCard/_startBattle 处理）
    vigor(game, eff) { game._vigor = (game._vigor || 0) + eff.value; },   // #35 活力：下一张造成伤害的牌 +n 攻击（playCard 消耗）
    inspire(game, eff) { game._inspire = (game._inspire || 0) + 3 * eff.value; },
    rewind(game) { game._rewindSnap = game._snapshot(); },   // 回溯：拍下完整战斗快照，下回合开始时回滚

    // === 放大包 ===（potent 是 playCard 加成；boon 复用 addTempStrength；倍损/倍益设本回合翻倍标志）
    amppain(game, eff) { game._ampDebuff = (game._ampDebuff || 0) + eff.value; },
    ampgain(game, eff) { game._ampBuff = (game._ampBuff || 0) + eff.value; },
    boon(game, eff) { game.addTempStrength(eff.value); },
    polarize(game) { const s = game.player.statuses.strength || 0; if (s > 0) game.applyStatus(game.player, 'strength', s); },
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

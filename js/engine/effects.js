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
    // —— 强化包（随机一张手牌的本场永久成长/降费；handler 内直接改实例字段）——
    whet(game, eff)   { const c = randHand(game); if (c) c.growth = (c.growth || 0) + eff.value; },                       // 磨砺：随机手牌成长 +N
    quench(game, eff) { const c = randHand(game); if (c) c.costDown = (c.costDown || 0) + 1; },                           // 淬火：随机手牌永久降费 -1（eff.value 仅记等级）
    anneal(game, eff) { const c = randHand(game); if (c) c.growth = Math.max(0, (c.growth || 0) - eff.value); },          // 退火：随机手牌成长 -N（不低于 0）
    // === 虚无包 ===（eff.value = 词条等级 L；maxHp 改动仅本场，不写回 run）
    devote(game, eff, source, target) {                                                       // 舍身：失 3L 当前生命，对当前敌人造 (3L)×2 伤害
      const cost = 3 * eff.value;
      game.player.hp = Math.max(0, game.player.hp - cost);
      game._checkEnd();
      if (target && target.hp > 0) game.dealAttackDamage(source, target, cost * 2);
    },
    annihilate(game, eff, source, target) {                                                   // 湮灭：从抽牌堆顶放逐 2L 张，对当前敌人造 (放逐数)×3 伤害
      let n = 0;
      for (let i = 0; i < 2 * eff.value && game.drawPile.length > 0; i++) { game.exhaustPile.push(game.drawPile.pop()); n++; }
      if (n > 0 && target && target.hp > 0) game.dealAttackDamage(source, target, n * 3);
    },
    offer(game, eff) {                                                                          // 献祭：本场最大生命 -3L（下限 1），获得 2L 力量
      game.player.maxHp = Math.max(1, game.player.maxHp - 3 * eff.value);
      game.player.hp = Math.min(game.player.hp, game.player.maxHp);
      game.applyStatus(game.player, 'strength', 2 * eff.value);
    },
    erode(game, eff) {                                                                          // 蚀骨：本场最大生命 -2L（下限 1）
      game.player.maxHp = Math.max(1, game.player.maxHp - 2 * eff.value);
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
      if (r === 0) game.dealAttackDamage(source, target, 12 * eff.value);
      else if (r === 1) game.gainBlock(source, 12 * eff.value);
      else game.drawCards(3);
    },
    slots(game, eff, source, target) {                                   // 老虎机：每打出第 3 张爆出 20×等级 伤害（伪随机保底）
      game._slots = (game._slots || 0) + 1;
      if (game._slots >= 3) { game._slots = 0; game.dealAttackDamage(source, target, 20 * eff.value); }
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
    invest(game, eff, source, target) { const r = game.run; if (!r) return; const spend = Math.min(r.gold || 0, 5 * eff.value); if (spend > 0) { r.gold -= spend; if (target && target.hp > 0) game.dealAttackDamage(source, target, spend * 2); } },
    income(game, eff) { if (game.run) game.run.gold = (game.run.gold || 0) + 6 * eff.value; },                       // 进账
    trade(game, eff)  { game.drawCards(1); if (game.run) game.run.gold = (game.run.gold || 0) + 4 * eff.value; },    // 贸易
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
    summon(game, eff) {
      const L = eff.value, A = (game.allies = game.allies || []);
      const mk = (name, icon, hp, atk, opts) => Object.assign({ name, icon, hp, maxHp: hp, atk, taunt: false, giveBlock: 0 }, opts || {});
      const add = a => { if (A.length < 6) A.push(a); };   // 召唤物上限 6
      if (eff.what === 'skeleton') add(mk('骷髅', '💀', 6 * L, 4 * L));
      else if (eff.what === 'guardian') add(mk('守护灵', '🛡️', 15 * L, 2 * L, { taunt: true }));
      else if (eff.what === 'totem') add(mk('图腾', '🗿', 8 * L, 0, { giveBlock: 3 * L }));
      else if (eff.what === 'swarm') for (let i = 0; i < 3; i++) add(mk('小灵', '👻', 2, 2 * L));
    },
    command(game, eff) { (game.allies || []).forEach(a => { a.atk += eff.value; }); if (game._allyAttack) game._allyAttack(); },   // 督战：全体 +攻并立即攻击
    culling(game, eff) { const A = game.allies || []; for (let i = 0; i < eff.value && A.length; i++) A.splice(Math.floor(Math.random() * A.length), 1); },  // 折损
    discord(game, eff) { (game.allies || []).forEach(a => { a.hp -= eff.value; }); if (game._reapAllies) game._reapAllies(); },   // 内讧
    // === 建造包 ===（建筑 game.buildings；每回合开始由 _buildingsTick 触发）
    build(game, eff) {
      const L = eff.value, B = (game.buildings = game.buildings || []);
      const pow = ({ arrowtower: 4 * L, rampart: 4 * L, furnace: 1 * L, workshop: 1 * L })[eff.what] || L;
      const meta = ({ arrowtower: ['箭塔', '🏹'], rampart: ['路障', '🧱'], furnace: ['熔炉', '🔥'], workshop: ['工坊', '🏭'] })[eff.what] || ['建筑', '🏗️'];
      if (B.length < 5) B.push({ kind: eff.what, name: meta[0], icon: meta[1], power: pow });   // 槽位上限 5
    },
    demolish(game, eff) { const B = game.buildings || []; if (!B.length) return; const b = B.shift(); for (let i = 0; i < 3 * eff.value; i++) game._fireBuilding(b); },   // 拆解：拆最早的一座、立即结算 3×L 次
    collapse(game, eff) { const B = game.buildings || []; for (let i = 0; i < eff.value && B.length; i++) B.splice(Math.floor(Math.random() * B.length), 1); },   // 坍塌
    subside(game, eff)  { (game.buildings || []).forEach(b => { b.power = Math.max(0, b.power - eff.value); }); },   // 沉降
    // === 弃牌包 ===（reclaim 走选牌队列；forget→clutch、waste→loseEnergy 复用）
    toss(game, eff, source, target) { game._discardRandom(1); if (target && target.hp > 0) game.dealAttackDamage(source, target, 6 * eff.value); },   // 抛掷
    sift(game) { game._discardRandom(2); game.drawCards(2); },                                       // 整理：弃 2 抽 2
    madness(game) { const n = game.hand.length; game._discardRandom(n); if (n > 0) game.applyStatus(game.player, 'strength', n); },   // 疯狂：弃光手牌·每张+1力量
    // === 术士包 ===（造牌/复制/灵视/牌库强化；clutter 塞渣滓）
    conjure(game, eff) { for (let i = 0; i < 1 + eff.value; i++) game._addToHand(CG.makeCard(Math.random() < 0.5 ? 'strike' : 'defend')); },   // 演卡
    daggers(game) { for (let i = 0; i < 3; i++) game._addToHand(CG.makeFoodCard('shiv')); },                                       // 飞刀×3
    duplicate(game) { if (game.hand.length) { const c = game.hand[Math.floor(Math.random() * game.hand.length)]; game._addToHand(CG.makeCard(c.base, c.limit, c.sockets || [])); } },   // 复制随机手牌
    foresight(game) { if (game.drawPile.length) { const c = game.drawPile.pop(); game._applyCardEffects(c); game.discardPile.push(c); } },   // 灵视：免费打出牌堆顶
    mindblast(game, eff) { [...game.drawPile, ...game.discardPile, ...game.hand].forEach(c => { const b = CG.BASE_CARDS[c.base]; if (b && b.type === 'attack') c.growth = (c.growth || 0) + eff.value; }); },   // 心灵震慑：牌库攻击牌永久+伤害（复用 growth）
    clutter(game, eff) { for (let i = 0; i < eff.value; i++) game._addToHand(CG.makeFoodCard('dross')); },                          // 谵妄：塞渣滓
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

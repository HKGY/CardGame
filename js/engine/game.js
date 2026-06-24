window.CG = window.CG || {};

/* ===========================================================================
 *  战斗引擎 —— 类“杀戮尖塔”的单场战斗循环。
 * ===========================================================================
 *  回合结构：
 *    玩家回合开始：格挡清零 -> 能量回满 -> 抽 5 张
 *    玩家出牌：消耗能量，按 effects 结算，进弃牌堆（exhaust 卡进消耗堆）
 *    结束回合：弃掉手牌 -> 玩家减益层数 -1
 *    敌人回合：敌人格挡清零 -> 执行意图 -> 敌人减益层数 -1 -> 决定下个意图
 *    抽牌堆空了会把弃牌堆洗回来。
 *
 *  纯逻辑、与界面解耦：状态变化通过 onChange 回调通知界面。
 * ===========================================================================
 */
(function (CG) {
  const HAND_LIMIT = 10;     // 手牌上限
  const START_ENERGY = 3;    // 每回合能量
  const CARDS_PER_TURN = 5;  // 每回合抽牌数

  // 克隆一张卡（连宝石）——战斗用副本，洗牌不影响跑图原牌组
  const cloneCard = c => CG.cloneCard(c);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 默认敌人 AI：随机选招，但不会连续用同一招 3 次
  function defaultEnemyAI(moves, history) {
    const last = history[history.length - 1];
    const last2 = history[history.length - 2];
    let pool = moves;
    if (last && last === last2) {
      pool = moves.filter(m => m.name !== last);
      if (pool.length === 0) pool = moves;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  class Game {
    // opts: { enemyId, deck, hp, maxHp } —— 由 Run 提供，战斗承接跑图中的牌组与血量
    constructor(opts) {
      this.listeners = [];       // 状态变化（整体刷新界面）
      this.eventListeners = [];  // 战斗事件（驱动精灵动画：attack / damage / gainblock）
      this.log = [];
      this._startBattle(opts);
    }

    onChange(fn) { this.listeners.push(fn); return this; }
    _emit() { this.listeners.forEach(fn => fn(this)); }

    onEvent(fn) { this.eventListeners.push(fn); return this; }
    _fire(type, payload) { this.eventListeners.forEach(fn => fn(type, payload)); }
    _sideOf(entity) { return entity === this.player ? 'player' : entity === this.skeleton ? 'skeleton' : 'enemy'; }   // 'skeleton' 仅用于 _fire 动画路由
    _idxOf(entity) { return this.enemies.indexOf(entity); }
    aliveEnemies() { return this.enemies.filter(e => e.alive && e.hp > 0); }
    currentTarget() {
      let e = this.enemies[this.target];
      if (!e || !e.alive || e.hp <= 0) { e = this.aliveEnemies()[0] || this.enemies[this.target] || this.enemies[0]; this.target = Math.max(0, this.enemies.indexOf(e)); }
      return e;
    }
    _randomEnemy() { const a = this.aliveEnemies(); return a.length ? a[Math.floor(Math.random() * a.length)] : this.currentTarget(); }   // 下/每回合对敌效果：随机一个存活敌人
    setTarget(i) { const e = this.enemies[i]; if (e && e.alive && e.hp > 0) { this.target = i; this.enemy = e; this._emit(); } }
    _refreshTarget() { this.enemy = this.currentTarget(); }
    _makeEnemy(id, sc, hpMult) {
      const def = CG.ENEMIES[id];
      const m = this.enemyM || 1;                          // 难度倍率：缩放敌人血量/伤害/格挡/力量（默认 1＝原版）
      const ehp = Math.round(def.maxHp * sc.hp * m * (hpMult || 1));
      return { def, name: def.name, maxHp: ehp, hp: ehp, block: 0, statuses: {}, history: [], intent: null, dmgScale: sc.dmg * m, alive: true };
    }

    // 数值膨胀：把敌人招式的伤害/格挡按层数倍率放大；难度倍率 M 另外缩放敌方 力量/敏捷
    _scaleEff(eff, enemy) {
      const sc = (enemy || this.enemy).dmgScale || 1;
      if (sc !== 1 && (eff.type === 'damage' || eff.type === 'block'))
        return Object.assign({}, eff, { value: Math.round(eff.value * sc) });
      const m = this.enemyM || 1;
      if (m !== 1 && (eff.type === 'strength' || eff.type === 'dexterity'))
        return Object.assign({}, eff, { value: Math.round(eff.value * m) });
      return eff;
    }

    // ---- 塔罗牌在战斗中触发的效果 ----
    addTempStrength(n) { this.applyStatus(this.player, 'strength', n); this._tempStrength = (this._tempStrength || 0) + n; this._emit(); }
    addTempDexterity(n) { this.applyStatus(this.player, 'dexterity', n); this._tempDex = (this._tempDex || 0) + n; this._emit(); }   // 临时敏捷（回合末移除，与临时力量对称）

    damageAll(n) {                              // 死亡塔罗：所有人受到 n 点伤害（过格挡）
      [...this.aliveEnemies(), this.player].forEach(t => {
        const beforeHp = t.hp, beforeBlock = t.block;
        this._dealRaw(t, n);
        this._fire('damage', { side: this._sideOf(t), ei: this._idxOf(t), hpLoss: beforeHp - t.hp, blocked: Math.min(beforeBlock, n) });
      });
      this._checkEnd();
      this._emit();
    }

    drawToHand(uid) {                           // 魔术师：从抽牌堆取一张到手牌
      const i = this.drawPile.findIndex(c => c.uid === uid);
      if (i < 0 || this.hand.length >= HAND_LIMIT) return;
      this.hand.push(this.drawPile.splice(i, 1)[0]);
      this._emit();
    }

    restart() {                                 // 愚者：重开本场（保留当前血量，不退道具）
      this.enemies.forEach(e => { e.hp = e.maxHp; e.block = 0; e.statuses = {}; e.history = []; e.intent = null; e.alive = true; });
      this.target = 0; this.enemy = this.enemies[0];
      this.player.block = 0; this.player.statuses = {}; this.player.power = 0;
      this._keepBlock = 0;                       // 死守包·重甲：愚者重开时重置（剩余保留回合数）
      this.skeleton = null;                     // 召唤：单骷髅「类玩家单位」（hp/maxHp/block/statuses；替玩家挡伤、靠召唤物词条出手）
      this._immuneHits = 0; this._vulnAmp = 0; this._weakAmp = false; this._blockRetain = false; this._daggerBonus = 0; this._scrapBonus = 0; this._playTwice = 0; this._hpLossCount = 0; this._lostHpThisTurn = false; this._exhaustedThisTurn = false; this._dmgCap1 = false; this._tempThorns = 0; this._endswordDmg = 0; this._endswordBlk = 0; this._everyCap = 3; this._cardsMade = 0; this._basePlays = {}; this._poisonApplied = 0; this._corpseBomb = 0; this._peekBonus = 0; this._wispBonus = 0; this._illusion = 0;   // v3.6/3.7/3.8/3.12/3.13 新批战斗态
      this._everyTurn = []; this._nextTurn = []; // 时点修饰器：每回合/下回合 待结算效果
      this._reaping = 0;                         // 猎杀：愚者重开时清空收割
      this._hurtThisCombat = false; this._killsThisCombat = 0;   // 时点条件：本场是否受过伤 / 击杀数
      this._tempRevert = [];   // 临时减益(敌临时失力量/敏捷)：到你下个回合开始复原
      this._vigor = 0; this._inspire = 0;        // 律动：活力(下一张加成,跨回合保留)/灵感(本回合抽牌给格挡)
      this._ampDebuff = 0; this._ampBuff = 0;    // 放大：本回合 倍损/倍益（applyStatus 翻倍）
      this._rewindSnap = null;                   // 律动·回溯：待恢复的战斗快照
      this.nextEnergyPenalty = 0; this.nextCardDmgMult = 1; this._tempStrength = 0; this._tempDex = 0;
      this.drawPile = shuffle(this._deck.map(cloneCard)); this.drawPile.forEach(c => c._initial = true);   // 标记初始牌（#48 回收据此区分生成牌）
      this.hand = []; this.discardPile = []; this.exhaustPile = [];
      this.turn = 0; this.phase = 'player';
      this.addLog('重新开始了战斗。');
      this.enemies.forEach(e => this._chooseEnemyIntent(e));
      this._startPlayerTurn();
    }
    addLog(msg) { this.log.push(msg); if (this.log.length > 60) this.log.shift(); }

    // 调试：直接赢得本场战斗（杀光所有敌人并触发结算）
    debugWin() {
      if (this.phase !== 'player' && this.phase !== 'enemy') return;
      this.enemies.forEach(e => { e.hp = 0; });
      this.addLog('（调试）直接赢得战斗。');
      this._checkEnd();      // 全部敌人阵亡 -> phase 'won'
      this._emit();          // 通知界面：上层据 phase==='won' 走战斗结束流程
    }

    _startBattle({ enemyIds, tier, deck, hp, maxHp, tarot, actScale, hpMult, enemyM, relics, run }) {
      const sc = actScale || { hp: 1, dmg: 1 };
      this.enemyM = enemyM || 1;               // 敌人难度倍率（缩放血量/伤害/格挡/力量；默认 1＝原版，开始菜单默认 0.7）
      this.tier = tier || 'normal';
      this.tarot = tarot || [];                // 与 Run 共享的消耗品栏（同一数组引用）
      this.relics = relics || [];              // 与 Run 共享的遗物（引用）
      this.run = run || null;                  // 反向引用 Run（老虎机/人寿保险等需要）
      this._deck = deck;                       // 原始牌组引用（愚者重开时重新克隆）
      this.nextCardDmgMult = 1;                // 力量塔罗
      this._tempStrength = 0;                  // 战车（本回合力量） this._tempDex = 0;
      this.freeCards = 0;                      // 回响：可免费打出的张数
      this._playedThisTurn = 0;                // 连击：本回合已打出牌数
      this._keepBlock = 0;                      // 死守包·重甲：剩余「格挡不清空」回合数（打出重甲后 = 等级 N）
      this.skeleton = null;                    // 召唤包：单骷髅单位（替玩家挡伤、靠召唤物词条出手）
      this._immuneHits = 0; this._vulnAmp = 0; this._weakAmp = false; this._blockRetain = false; this._daggerBonus = 0; this._scrapBonus = 0; this._playTwice = 0; this._hpLossCount = 0; this._lostHpThisTurn = false; this._exhaustedThisTurn = false; this._dmgCap1 = false; this._tempThorns = 0; this._endswordDmg = 0; this._endswordBlk = 0; this._everyCap = 3; this._cardsMade = 0; this._basePlays = {}; this._poisonApplied = 0; this._corpseBomb = 0; this._peekBonus = 0; this._wispBonus = 0; this._illusion = 0;   // v3.6/3.7/3.8/3.12/3.13 新批战斗态
      this._everyTurn = []; this._nextTurn = []; // 时点修饰器：每回合(常驻重复)/下回合(一次性) 待结算效果
      this._reaping = 0;                        // 猎杀包·收割：本场每击杀 +力量（打出收割后累加）
      this._hurtThisCombat = false; this._killsThisCombat = 0;   // 时点条件：本场是否受过伤 / 击杀数
      this._tempRevert = [];   // 临时减益(敌临时失力量/敏捷)：到你下个回合开始复原
      this._vigor = 0; this._inspire = 0;       // 律动包：活力(下一张牌加成)/灵感(本回合抽牌给格挡)
      this._ampDebuff = 0; this._ampBuff = 0;   // 放大包：本回合 倍损/倍益
      this._rewindSnap = null;                  // 律动·回溯：待恢复的战斗快照
      this._laststandUsed = false;             // 回光返照：本场一次
      this._holyUsed = false;                  // 圣盾披风：本场一次
      this._oneupUsed = false;                 // 1up：本场一次
      const maxEnergy = START_ENERGY + this.relics.reduce((s, id) => s + (CG.RELICS[id].maxEnergyBonus || 0), 0);  // 电池
      this.player = {
        name: '你', maxHp, hp, block: 0,
        energy: maxEnergy, maxEnergy, power: 0, statuses: {},   // 电力：战斗内跨回合保留（不随回合回满）
      };
      this.enemies = (enemyIds || []).map(id => this._makeEnemy(id, sc, hpMult));   // 数值膨胀 + 女祭司减血
      this.target = 0;
      this.enemy = this.enemies[0];            // this.enemy 始终指向「当前目标」，兼容遗物/塔罗
      this._computeCardMult();                 // 达摩克利斯
      this.drawPile = shuffle(deck.map(cloneCard)); this.drawPile.forEach(c => c._initial = true);  // 克隆副本：洗牌不影响原牌组；标记初始牌(#48)
      this.drawPile.sort((a, b) => (CG.cardStats(a).innate ? 1 : 0) - (CG.cardStats(b).innate ? 1 : 0));   // 律动·固有：带固有的牌排到末尾＝开局首抽
      this.hand = [];
      this.discardPile = [];
      this.exhaustPile = [];
      this.turn = 0;
      this.phase = 'player'; // 'player' | 'enemy' | 'won' | 'lost'
      this.addLog(`遭遇了 ${this.enemies.map(e => e.name).join('、')}！`);
      this.relics.forEach(id => { const r = CG.RELICS[id]; if (r.battleStart) r.battleStart(this); });  // 尖矛/青石…
      this.enemies.forEach(e => this._chooseEnemyIntent(e));
      this._startPlayerTurn();
    }
    _computeCardMult() {
      this.cardValueMult = (this.relics.includes('damocles') && !(this.run && this.run.flags.damoclesBroken)) ? 2 : 1;
    }

    // ---------- 回合流程 ----------
    _startPlayerTurn() {
      this.turn += 1;
      this.phase = 'player';
      if (this._tempRevert && this._tempRevert.length) { this._tempRevert.forEach(d => { if (d.target) this.applyStatus(d.target, d.key, d.amount); }); this._tempRevert = []; }   // 复原上回合的临时减益（敌临时失力量/敏捷）

      if (this._rewindSnap) { this._restore(this._rewindSnap); this._rewindSnap = null; this.addLog('回溯：时间倒流，敌人这一回合被抹去。'); }   // 律动·回溯：回滚到打出回溯时的双方状态
      if (this._blockRetain) { /* #21 格挡跨回合保留：不清空 */ }
      else if (this._keepBlock > 0) { this._keepBlock--; this.player.block = Math.floor((this.player.block || 0) * 0.5); } else this.player.block = 0;   // 死守包·重甲：接下来 N 回合格挡减半保留（计数器；不再无限累积）
      if (this.skeleton && !this._blockRetain) this.skeleton.block = 0;   // 召唤物格挡每回合开始清空（同玩家；格挡保留时一并保留）
      let energyBonus = 0, drawBonus = 0;          // 癌症/无神论者：每回合额外能量/抽牌
      this.relics.forEach(id => { const r = CG.RELICS[id]; energyBonus += r.turnEnergy || 0; drawBonus += r.turnDraw || 0; });
      this.player.energy = Math.max(0, this.player.maxEnergy - (this.nextEnergyPenalty || 0)) + energyBonus;
      this.nextEnergyPenalty = 0;
      this._turnPlays = {};                       // 风怒：本回合各卡已打出次数
      this.freeCards = 0;                          // 回响：本回合可免费打出的张数
      this._playedThisTurn = 0;                    // 连击：本回合已打出牌数
      this._paralyze = 0;                          // 麻痹：本回合锁住最左侧 N 张手牌（电力不在此列，跨回合保留）
      this._discardedThisTurn = 0;                 // 弃牌包·倾倒：本回合已丢弃牌数
      this._inspire = 0;                           // 律动·灵感：每回合重置（活力 _vigor 不在此重置＝跨回合保留）
      this._ampDebuff = 0; this._ampBuff = 0;      // 放大·倍损/倍益：每回合重置（「本回合」效果）
      this._lostHpThisTurn = false; this._exhaustedThisTurn = false; this._dmgCap1 = false; this._illusion = 0;   // v3.6/3.13 本回合型：每回合重置（幻境是本回合效果）
      if (this.turn === 1) this.relics.forEach(id => { const r = CG.RELICS[id]; if (r.firstTurn) r.firstTurn(this); });  // 厚盾/灯笼
      this.relics.forEach(id => {
        const r = CG.RELICS[id];
        if (r.onTurnStart) r.onTurnStart(this);          // 老虎机 / 兄弟鲍比 / 献祭匕首
        const bt = typeof r.blockTurn === 'function' ? r.blockTurn(this) : r.blockTurn;
        if (bt) this.gainBlock(this.player, bt);                          // 永恒之心/铁棒
        if (r.regenTurn) this.heal(r.regenTurn);                          // 再生肿块
        if (r.turnDamage) { const t = this.currentTarget(); if (t && t.hp > 0) this.dealAttackDamage(this.player, t, r.turnDamage); } // 小斯蒂文
      });
      this._checkEnd();
      if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
      if (this.player.statuses.regen) this.heal(this.player.statuses.regen);   // 再生：回合开始回血
      // === 留置包 ===：抽新牌「之前」，对上回合保留下来的在手牌养牌——
      //   在手回合数 +1；再按各自词条蓄势(数值)/待发(降费)/滞涩(涨费)。drawCards 自带 HAND_LIMIT，保留的牌占位、超限会少抽。
      for (const c of this.hand) {
        c.heldTurns = (c.heldTurns || 0) + 1;
        const s = CG.cardStats(c);
        if (s.chargeUp)  c.heldBonus = (c.heldBonus || 0) + s.chargeUp;   // 蓄势：永久加成 += L
        if (s.primed)    c.holdCost  = (c.holdCost  || 0) - s.primed;     // 待发：越攒越便宜
        if (s.sluggish)  c.holdCost  = (c.holdCost  || 0) + s.sluggish;   // 滞涩：越攒越贵
      }
      this.drawCards(CARDS_PER_TURN + drawBonus);
      // === 时点修饰器：每回合(常驻重复) + 下回合(一次性) ===（统一在此结算；对敌效果改为随机敌人）
      const _src = e => (e.minion ? this.skeleton : this.player);   // 召唤物效果以骷髅为 source
      (this._everyTurn || []).forEach(e => { if (!(e.minion && !this.skeleton)) CG.Effects.apply(this, e, _src(e), this._randomEnemy()); });   // 每回合：重复结算、跨回合保留（对敌取随机敌人）
      if (this._nextTurn && this._nextTurn.length) { const q = this._nextTurn; this._nextTurn = []; q.forEach(e => { if (!(e.minion && !this.skeleton)) CG.Effects.apply(this, e, _src(e), this._randomEnemy()); }); }   // 下回合：结算一次后清空（对敌取随机敌人）
      this._checkEnd();                          // 时点效果可能终结战斗
      this._emit();
    }

    // 玩家点“结束回合”：先收尾，敌人行动由 runEnemyTurn 触发（界面可加延迟做演出）
    endTurn() {
      if (this.phase !== 'player') return;
      if (this.craft || this.pick) return;                             // 做菜 / 选牌中不能结束回合
      if (this._tempStrength) { this.applyStatus(this.player, 'strength', -this._tempStrength); this._tempStrength = 0; } // 战车：回合末移除临时力量
      if (this._tempDex) { this.applyStatus(this.player, "dexterity", -this._tempDex); this._tempDex = 0; }   // 回合末移除临时敏捷
      if (this._tempThorns) { this.applyStatus(this.player, 'thorns', -this._tempThorns); this._tempThorns = 0; }   // 本回合荆棘：回合末移除
      if (this.player.statuses.burn) this._dealBurn(this.player, this.player.statuses.burn);   // 灼伤：回合结束受伤（可被本回合格挡吸收）
      // 腐坏卡：先从手牌取出并消耗（一次性，不再清在手里），其结算放到 _tickStatuses 之后，
      // 使易伤/虚弱在接下来的敌方回合保持满层（否则会被本回合的状态衰减立刻 -1）。
      const spoiled = [];
      for (const c of this.hand.slice()) {
        const b = CG.BASE_CARDS[c.base];
        if (!b || b.kind !== 'spoiled') continue;
        spoiled.push(b.spoiled);
        const i = this.hand.findIndex(x => x.uid === c.uid); if (i >= 0) this.exhaustPile.push(this.hand.splice(i, 1)[0]);
      }
      // === 留置包 ===：保留(retain)的牌不进弃牌堆，留在手里跨回合（沉重 heavyhold 也算 retain）。
      const kept = [];
      for (const c of this.hand) { const cs = CG.cardStats(c); if (cs.ethereal) this._exhaustCard(c); else if (cs.retain) kept.push(c); else this.discardPile.push(c); }   // #40 虚无：回合末仍在手则消耗；否则保留/弃牌
      this.hand = kept;
      this._tickStatuses(this.player);
      spoiled.forEach(kind => {
        if (kind === 'selfdmg') { this.player.hp = Math.max(0, this.player.hp - 2); this.addLog('馊饭：失去 2 生命。'); }
        else if (kind === 'weak') { this.applyStatus(this.player, 'weak', 2); this.addLog('臭肉：自身虚弱 2。'); }
        else if (kind === 'vuln') { this.applyStatus(this.player, 'vulnerable', 2); this.addLog('烂菜：自身易伤 2。'); }
      });
      this._checkEnd();                                                // 召唤物不再回合末自动攻击（靠召唤物词条出手）
      if (this.phase === 'lost' || this.phase === 'won') { this._emit(); return; }   // 腐坏卡可能致死
      this.phase = 'enemy';
      this._emit();
    }

    runEnemyTurn() {
      if (this.phase !== 'enemy') return;
      for (const e of this.enemies) {                                    // 每个存活敌人依次行动
        if (!e.alive || e.hp <= 0) continue;
        e.block = 0;
        if (e.statuses.poison) { this._dotDamage(e, e.statuses.poison, false); this._corpseBombCheck(e); }   // 中毒：持续伤害（毒死则尸爆）
        if (e.statuses.burn) this._dealBurn(e, e.statuses.burn);                // 灼伤：可被格挡（敌人此时无格挡）
        if (e.statuses.leech) this._dotDamage(e, e.statuses.leech, true);      // 寄生：持续伤害 + 回血
        this._checkEnd();
        if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
        if (e.hp <= 0) continue;                                        // 持续伤害致死则不再行动
        if (e.statuses.frozen > 0) {                                    // 冰封：跳过行动
          e.statuses.frozen -= 1;
          if (e.statuses.frozen <= 0) delete e.statuses.frozen;
          this.addLog(`${e.name} 被冰冻，无法行动。`);
        } else if (e.intent) {
          const move = e.intent;
          this.addLog(`${e.name} 使用了 ${move.name}。`);
          (move.effects || []).forEach(eff => {
            const se = this._scaleEff(eff, e);
            CG.Effects.apply(this, se, e, this.player);   // 伤害类经 dealAttackDamage 自动走「召唤物→玩家」抵挡顺序
          });
        }
        this._tickStatuses(e);
        if (e.alive && e.hp > 0 && (e.statuses.curse || 0) > e.hp) {   // #41 咒言：回合结束时层数 > 生命 → 立刻死亡
          const lost = e.hp; e.hp = 0; this.addLog(`${e.name} 被咒言吞噬！`);
          this._fire('damage', { side: 'enemy', ei: this._idxOf(e), hpLoss: lost, blocked: 0 });
        }
        this._checkEnd();
        if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
      }
      this.enemies.forEach(e => { if (e.alive && e.hp > 0) this._chooseEnemyIntent(e); });
      this._startPlayerTurn();
    }
    _dotDamage(enemy, n, lifesteal) {           // 对某敌人造成 n 点持续伤害（无视格挡）
      const before = enemy.hp;
      enemy.hp = Math.max(0, enemy.hp - n);
      const lost = before - enemy.hp;
      if (lost > 0) { this._fire('damage', { side: 'enemy', ei: this._idxOf(enemy), hpLoss: lost, blocked: 0 }); if (lifesteal) this.heal(lost); }
    }
    // v3.12 尸爆：被中毒杀死的敌人对其他存活敌人造成 (其最大生命 × 尸爆层数) 的伤害（仅在毒伤致死的调用处检查）
    _corpseBombCheck(enemy) {
      if (!(enemy.hp <= 0) || !(this._corpseBomb > 0)) return;
      const dmg = enemy.maxHp * this._corpseBomb;
      this.aliveEnemies().forEach(o => {
        if (o === enemy || o.hp <= 0) return;
        const bh = o.hp, bb = o.block; this._dealRaw(o, dmg);
        this._fire('damage', { side: 'enemy', ei: this._idxOf(o), hpLoss: bh - o.hp, blocked: Math.min(bb, dmg) });
      });
      this.addLog(`尸爆！${enemy.name} 的尸体炸裂，对其他敌人造成 ${dmg} 点伤害。`);
    }

    // ---------- 玩家操作 ----------
    playCard(uid) {
      if (this.phase !== 'player') return;
      if (this.craft || this.pick) return;                             // 做菜 / 选牌中：先完成
      const idx = this.hand.findIndex(c => c.uid === uid);
      if (idx === -1) return;
      const card = this.hand[idx];
      let s = CG.cardStats(card, { valueMult: this.cardValueMult });   // 达摩克利斯翻倍
      if (s.noPlay) { this.addLog(`${s.name} 不能直接打出。`); this._emit(); return; }   // 调味料 / 腐坏卡
      if (s.kind === 'veg') return this._startCraft(card);             // 素菜 → 进入做菜
      if (idx < (this._paralyze || 0)) { this.addLog(`麻痹：最左 ${this._paralyze} 张牌本回合无法打出。`); this._emit(); return; }
      // 资源：改造(超频)→改用电力付费(耗能×N)、数值×N；否则走能量(回响可免费)
      const oc = s.overclock || 0;
      const free = oc ? false : (this.freeCards || 0) > 0;             // 回响：本张免费打出（超频时不适用）
      let payCost = oc ? 0 : (free ? 0 : s.cost);
      if (card.conjuredTurn === this.turn) payCost = 0;               // 术士·造牌：本回合 0 费
      const payPower = oc ? s.cost * oc : 0;
      if (oc && payPower > (this.player.power || 0)) { this.addLog('电力不足。'); this._emit(); return; }
      if (!oc && !s.multi && payCost > this.player.energy) { this.addLog('能量不足。'); this._emit(); return; }   // 多重：耗费=全部能量，恒可打出
      if (oc > 0) s = Object.assign({}, s, { effects: s.effects.map(e => (e.type === 'damage' || e.type === 'block' || e.type === 'heal') ? Object.assign({}, e, { value: e.value * oc }) : e) });

      // 力量塔罗：下一张攻击牌造成 N 倍伤害（用后清除）
      if (this.nextCardDmgMult > 1 && s.kind === 'damage') {
        s = Object.assign({}, s, { effects: s.effects.map(e => e.type === 'damage' ? Object.assign({}, e, { value: e.value * this.nextCardDmgMult }) : e) });
        this.nextCardDmgMult = 1;
      }
      // v3 条件代价：动态缩放数值价值——价值量 =（条件当前量 × 等级），加到对应类型的效果上。
      if (s.condBonus && s.condBonus.length) {
        const handAfter = this.hand.length - 1, t = this.enemy;
        const qtyOf = q => {
          switch (q) {
            case 'curBlock':    return this.player.block || 0;
            case 'enemyDebuff': return t ? this._enemyDebuffLayers(t) : 0;
            case 'exhaustPile': return this.exhaustPile.length;
            case 'handSize':    return Math.max(0, handAfter);
            case 'emptyHand':   return Math.max(0, 10 - handAfter);   // 空手程度 = 10 − 手牌数
            case 'curGold':     return this.run ? (this.run.gold || 0) : 0;   // 原始金币量（单价 vp 0.06）
            case 'turnNum':     return this.turn || 0;
            case 'myDebuff':    return ['vulnerable', 'weak', 'frail'].reduce((s, k) => s + (this.player.statuses[k] || 0), 0);   // 自身减益体系：回收自己背的减益
            case 'hpLossCount': return this._hpLossCount || 0;   // #18 本场失去生命次数
            case 'playedThisTurn': return this._playedThisTurn || 0;   // #34 本回合已打出牌数
            case 'daggerPlayed': return (this._basePlays && this._basePlays.dagger) || 0;   // #43 本场打出匕首/甲片/洞悉 次数
            case 'scrapPlayed':  return (this._basePlays && this._basePlays.scrap) || 0;
            case 'peekPlayed':   return (this._basePlays && this._basePlays.peek) || 0;
            case 'cardsMade':    return this._cardsMade || 0;          // #49 本场生成卡牌数
            case 'poisonApplied': return this._poisonApplied || 0;     // v3.12 本场施加中毒次数
            default:            return 0;
          }
        };
        s.condBonus.forEach(cb => {
          // 门型：达成（或免代价 free＝首石/净化）则给定额 floor(mult×等级)；量型：整数「每有 fx 点条件 → fy 点价值」= floor(条件量/fx) × fy × 等级
          const amount = cb.gate
            ? ((cb.free || this._gateMet(cb.qty, card)) ? Math.floor((cb.mult || 1) * (cb.level || 1) + 1e-9) : 0)
            : Math.floor(qtyOf(cb.qty) / (cb.fx || 1)) * (cb.fy || 0) * (cb.level || 1);
          if (amount <= 0) return;
          const ve = CG.valueEffects(cb.atom, amount, cb.level);   // 喂给该价值原子的 mech → 本回合/下回合/每回合 + 卡级修饰
          if (ve.now.length)  s = Object.assign({}, s, { effects: s.effects.concat(ve.now) });
          ve.every.forEach(e => this._addEveryTurn(e));   // 经上限约束
          ve.next.forEach(e => this._addNextTurn(e));   // 同种下回合合并
          if (ve.potent)    s = Object.assign({}, s, { potent: (s.potent || 0) + ve.potent });
          if (ve.lifesteal) s = Object.assign({}, s, { lifesteal: (s.lifesteal || 0) + ve.lifesteal });
          if (ve.multiHit)  s = Object.assign({}, s, { multiHit: (s.multiHit || 0) + ve.multiHit });
          if (ve.multi)     s = Object.assign({}, s, { multi: (s.multi || 0) + ve.multi });
          if (ve.element)   s = Object.assign({}, s, { element: ve.element, elementLevel: ve.elementLevel });
          ['copyToDiscard', 'growDmg', 'growBlk', 'selfCostDown', 'aoe', 'playTwice'].forEach(k => { if (ve[k]) s = Object.assign({}, s, { [k]: (s[k] || 0) + ve[k] }); });   // v3.6 卡级字段（条件路径）
        });
      }
      // 电弧：本牌数值额外 +（当前电力 × 等级）
      if (s.arc > 0) {
        const bonus = s.arc * (this.player.power || 0);
        if (bonus > 0) s = Object.assign({}, s, { effects: s.effects.map(e => (e.type === 'damage' || e.type === 'block' || e.type === 'heal') ? Object.assign({}, e, { value: e.value + bonus }) : e) });
      }
      // 活力(#35)：下一张「造成伤害」的牌攻击 +n（持有到打出伤害牌才消耗；非伤害牌不消耗）
      if (this._vigor > 0 && s.effects.some(e => e.type === 'damage')) {
        const bonus = this._vigor; this._vigor = 0;
        s = Object.assign({}, s, { effects: s.effects.map(e => e.type === 'damage' ? Object.assign({}, e, { value: e.value + bonus }) : e) });
      }
      // 放大·强效：本牌伤害/格挡/治疗 ×(1+等级)
      if (s.potent > 0) {
        const m = 1 + s.potent;
        s = Object.assign({}, s, { effects: s.effects.map(e => (e.type === 'damage' || e.type === 'block' || e.type === 'heal') ? Object.assign({}, e, { value: e.value * m }) : e) });
      }
      // 元素反应：本牌附元素时，按主目标当前元素与层数定反应（消耗 min(prev,new) 级、效果发生这么多次、余量留存）
      // 元素（新模型：敌人至多 1 种 1 层。附 elemLv 层＝逐层「反应或取代」；放大型反应先乘本牌伤害 ×amplify）
      const elem = s.element, elemLv = s.elementLevel || 0;
      let reaction = null;
      if (elem && elemLv > 0) {
        const aura = this._auraOf(this.currentTarget());
        if (aura && aura !== elem) {
          const rx = CG.reactionFor(aura, elem);
          if (rx && (rx.type !== 'amplify' || s.kind === 'damage')) reaction = rx;   // 放大型需本牌确实造成伤害
        }
        if (reaction && reaction.type === 'amplify') {
          s = Object.assign({}, s, { effects: s.effects.map(e => e.type === 'damage' ? Object.assign({}, e, { value: Math.floor(e.value * reaction.amplify) }) : e) });
        }
      }

      // 多重：消耗全部剩余能量，整张牌打出「能量」次（手牌耗费显示 X）。在所有加成/条件结算后定。
      if (s.multi > 0 && !oc) { payCost = this.player.energy || 0; s = Object.assign({}, s, { repeatTimes: Math.max(1, payCost) }); }
      if (oc > 0) this.player.power -= payPower;                       // 改造：扣电力
      else { if (free) this.freeCards -= 1; this.player.energy -= payCost; }   // 否则扣能量（回响免费）
      this.hand.splice(idx, 1);
      this.addLog(`你打出了 ${s.name}${oc ? `（耗电力 ${payPower}）` : ''}。`);

      // #20 下n张牌打两次：消耗一层 _playTwice（授予该层的牌自身不算「下一张」，授予在 resolve 结算后才 +）
      const dbl = (this._playTwice || 0) > 0; if (dbl) this._playTwice -= 1;
      // 弃牌代价＝自选丢弃，且须在结算其它效果（尤其造牌）之前完成：把后续结算包成 resolve()，先选弃、再 resolve。
      const resolve = () => {
      const target = this.currentTarget();
      const enemyHpBefore = target.hp;
      // 穿刺：额外命中当前目标右侧的若干存活敌人（仅伤害类效果）；#7 命中全体：额外命中除主目标外所有存活敌人
      const pierce = s.pierce || 0;
      const extra = s.aoe ? this.enemies.filter(e => e !== target && e.alive && e.hp > 0)
                  : (pierce > 0 ? this.enemies.slice(this.target + 1).filter(e => e.alive && e.hp > 0).slice(0, pierce) : []);
      // 召唤物修饰：eff.minion 的效果以骷髅为 source（无骷髅则跳过）
      const srcOf = eff => (eff.minion ? this.skeleton : this.player);
      // 重复：整组效果结算 repeatTimes 次（#20 下n张牌打两次：本牌被 dbl 时效果再翻一倍）
      for (let r = 0; r < s.repeatTimes * (dbl ? 2 : 1); r++) {
        (s.effects || []).forEach(eff => {
          if (eff.minion && !this.skeleton) return;
          CG.Effects.apply(this, eff, srcOf(eff), target);
          if (eff.type === 'damage') extra.forEach(t => { if (t.hp > 0) CG.Effects.apply(this, eff, srcOf(eff), t); });
        });
        if (this.player.hp <= 0 || this.aliveEnemies().length === 0) break;
      }
      // 强攻包·连击：本牌「伤害」效果额外命中 multiHit 次（仅伤害，不重复格挡/治疗/状态）
      for (let k = 0; k < (s.multiHit || 0) && this.aliveEnemies().length > 0; k++) {
        (s.effects || []).forEach(eff => {
          if (eff.type !== 'damage' || (eff.minion && !this.skeleton)) return;
          CG.Effects.apply(this, eff, srcOf(eff), target);
          extra.forEach(t => { if (t.hp > 0) CG.Effects.apply(this, eff, srcOf(eff), t); });
        });
      }
      // 吸血：按对主目标造成的伤害回血（含连击多段）
      if (s.lifesteal > 0) { const dealt = enemyHpBefore - target.hp; if (dealt > 0) this.heal(Math.floor(dealt * s.lifesteal / 100)); }   // 吸血以 1% 计
      if (s.curseStrike > 0 && target.hp > 0) { const dealt = enemyHpBefore - target.hp; if (dealt > 0) this.applyStatus(target, 'curse', dealt * s.curseStrike); }   // #44 追加＝伤害×n 的咒言
      if (s.dmgToBlock > 0) { const dealt = enemyHpBefore - target.hp; if (dealt > 0) this.gainBlock(this.player, dealt * s.dmgToBlock); }   // #51 获得＝伤害×n 的格挡
      // 元素结算（新模型：敌人至多 1 种 1 层）：有反应→消耗敌方元素并触发一次；附两层(elemLv≥2)则反应后再附 1 层新的；无反应→取代为本元素 1 层。
      if (elem && elemLv > 0) {
        if (reaction) {
          if (reaction.type === 'effect' && reaction.apply) reaction.apply(this, this.player, target);   // 转化型反应触发一次
          this._clearAura(target);
          if (elemLv >= 2) this._setAura(target, elem, 1);          // 附着两层：先反应、再附一层新的
          this.addLog(`元素反应·${reaction.name}！`);
        } else {
          this._setAura(target, elem, 1);                           // 无反应：取代/设为本元素 1 层
        }
      }
      // 透支：累计下回合能量惩罚
      if (s.nextEnergyPenalty) this.nextEnergyPenalty = (this.nextEnergyPenalty || 0) + s.nextEnergyPenalty;
      // 回响：打出后使本回合接下来若干张牌免费；连击：本回合打出牌计数 +1
      if (s.freeNext) this.freeCards = (this.freeCards || 0) + s.freeNext;
      this._playedThisTurn = (this._playedThisTurn || 0) + 1;
      this._basePlays = this._basePlays || {}; this._basePlays[card.base] = (this._basePlays[card.base] || 0) + 1;   // #43 按基底计本场打出次数（匕首/甲片/洞悉）

      // === 强化包 / v3.6 本牌成长 ===（成长挂在被打出的 card 实例上＝本场永久）
      if (s.temper > 0) card.growth = (card.growth || 0) + s.temper;     // 锤炼：本牌数值永久 +L
      if (s.growDmg) card.growth = (card.growth || 0) + s.growDmg;       // #10 本场伤害成长
      if (s.growBlk) card.blockGrowth = (card.blockGrowth || 0) + s.growBlk;   // #11 本场格挡成长
      if (s.selfCostDown) card.costDown = (card.costDown || 0) + s.selfCostDown;   // #11a 本场能耗降低
      if (s.copyToDiscard) for (let i = 0; i < s.copyToDiscard; i++) this.discardPile.push(CG.makeCard(card.base, card.limit, card.sockets || []));   // #2 复制到弃牌堆
      if (s.playTwice) this._playTwice = (this._playTwice || 0) + s.playTwice;   // #20 之后 n 张牌打两次
      card.plays = (card.plays || 0) + 1;                                 // 本场该实例打出次数（门型条件 firstPlay / 觉醒共用；在 condBonus 求值之后才 +1）
      if (s.awaken > 0 && card.plays >= 2 && !card.awakened) { card.growth = (card.growth || 0) + 8 * s.awaken; card.awakened = true; this.addLog(`觉醒：${s.name} 数值大幅提升！`); }   // 觉醒：累计打出 2 次后跳变

      // 风怒：本回合前 N 次打出后回到手牌（销毁优先，不回手）
      let returned = false;
      if (!s.exhaust && s.windfury > 0 && this.player.hp > 0 && this.aliveEnemies().length > 0 && this.hand.length < HAND_LIMIT) {
        this._turnPlays = this._turnPlays || {};
        const cnt = (this._turnPlays[card.uid] || 0) + 1;
        this._turnPlays[card.uid] = cnt;
        if (cnt <= s.windfury) { this.hand.push(card); returned = true; }
      }
      if (!returned) { if (s.exhaust) this._exhaustCard(card); else this.discardPile.push(card); }  // 销毁→消耗堆（触发涅槃/不坏）

      this._checkEnd();
      if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
      // 消耗包·交互：燃烧（消耗 N 张手牌）/ 重生（从消耗堆取回 N 张）→ 排队逐个选
      this._pickQueue = [];
      for (let i = 0; i < (s.burnSelect || 0); i++) this._pickQueue.push('burn');
      for (let i = 0; i < (s.reborn || 0); i++) this._pickQueue.push('reborn');
      for (let i = 0; i < (s.reclaim || 0); i++) this._pickQueue.push('reclaim');   // 弃牌包·拾遗
      for (let i = 0; i < (s.wish || 0); i++) this._pickQueue.push('wish');         // #37 许愿：从抽牌堆挑牌进手
      this._nextPick();
      };   // resolve()
      // 代价链：先弃牌代价（自选丢弃）→ 再消耗代价（#15 自选消耗）→ resolve
      const afterDiscard = () => { if (s.exhaustCost > 0) this._beginExhaustCost(s.exhaustCost, resolve); else resolve(); };
      if (s.discardCost > 0) this._beginDiscardCost(s.discardCost, afterDiscard);
      else afterDiscard();
    }
    // 弃牌代价：逐张让玩家自选丢弃，全部选完（或手牌空/跳过）后执行 cont（即 resolve）。
    _beginDiscardCost(n, cont) { this._discardLeft = n; this._afterDiscard = cont; this._promptDiscard(); }
    _promptDiscard() {
      if (!this._discardLeft || this._discardLeft <= 0 || !this.hand.length) {
        const cont = this._afterDiscard; this._afterDiscard = null; this.pick = null;
        if (cont) cont(); else this._emit();
        return;
      }
      this.pick = { type: 'discardCost', title: `弃牌代价：选择要丢弃的牌（剩 ${this._discardLeft}）`, noSkip: true };   // 代价：不允许跳过
      this._emit();
    }
    // #15 消耗代价：逐张让玩家自选消耗（进消耗堆），全部选完后执行 cont。
    _beginExhaustCost(n, cont) { this._exhaustLeft = n; this._afterExhaust = cont; this._promptExhaust(); }
    _promptExhaust() {
      if (!this._exhaustLeft || this._exhaustLeft <= 0 || !this.hand.length) {
        const cont = this._afterExhaust; this._afterExhaust = null; this.pick = null;
        if (cont) cont(); else this._emit();
        return;
      }
      this.pick = { type: 'exhaustCost', title: `消耗代价：选择要消耗的牌（剩 ${this._exhaustLeft}）`, noSkip: true };   // 代价：不允许跳过
      this._emit();
    }

    // ---------- 厨艺：做菜 ----------
    // 打出素菜 → 进入做菜：先选荤菜(可跳过)，再选调味料(可跳过)，做成「餐点」进手牌。
    _startCraft(vegCard) {
      this.craft = { vegUid: vegCard.uid, step: 'meat', meatUid: null, seasonUid: null };
      this.addLog('开始做菜：选择荤菜（可跳过）。');
      this._emit();
    }
    craftCandidates() {                          // 给 UI：当前步可选的手牌
      if (!this.craft) return [];
      const cat = this.craft.step === 'meat' ? 'meat' : 'season';
      return this.hand.filter(c => { const b = CG.BASE_CARDS[c.base]; return b && b.food === cat; });
    }
    craftChoose(uid) {                           // uid=null 跳过本步；选中则记录并推进
      if (!this.craft) return;
      const cat = this.craft.step === 'meat' ? 'meat' : 'season';
      if (uid != null) {
        const c = this.hand.find(x => x.uid === uid);
        if (!c || CG.BASE_CARDS[c.base].food !== cat) return;          // 非法选择：忽略
        if (this.craft.step === 'meat') this.craft.meatUid = uid; else this.craft.seasonUid = uid;
      }
      if (this.craft.step === 'meat') { this.craft.step = 'season'; this.addLog('选择调味料（可跳过）。'); this._emit(); return; }
      this._finishCraft();
    }
    craftCancel() { this.craft = null; this.addLog('取消了做菜。'); this._emit(); }   // 放回素菜，不消耗
    _finishCraft() {
      const cr = this.craft; this.craft = null;
      const veg = this.hand.find(c => c.uid === cr.vegUid);
      const meat = cr.meatUid != null ? this.hand.find(c => c.uid === cr.meatUid) : null;
      const season = cr.seasonUid != null ? this.hand.find(c => c.uid === cr.seasonUid) : null;
      const vegBase = veg ? veg.base : 'tomato';
      [cr.vegUid, cr.meatUid, cr.seasonUid].forEach(u => {            // 消耗原料：移出手牌 → 消耗堆
        if (u == null) return;
        const i = this.hand.findIndex(c => c.uid === u);
        if (i >= 0) this.exhaustPile.push(this.hand.splice(i, 1)[0]);
      });
      const spec = CG.buildMeal(vegBase, meat ? meat.base : null, season ? season.base : null);
      const mealCard = CG.makeFoodCard('meal', spec);
      if (this.hand.length < HAND_LIMIT) this.hand.push(mealCard); else this.discardPile.push(mealCard);
      this.addLog(`做好了「${spec.name}」。`);
      this._playedThisTurn = (this._playedThisTurn || 0) + 1;
      this._emit();
    }
    giveFoodCard(what, count) {                   // 获得食材卡（进手牌；满则进弃牌堆）
      count = count || 1;
      for (let k = 0; k < count; k++) {
        const base = (what === 'veg' || what === 'meat' || what === 'season') ? CG.randomFood(what) : what;
        const c = CG.makeFoodCard(base);
        if (this.hand.length < HAND_LIMIT) this.hand.push(c); else this.discardPile.push(c);
      }
    }

    // ---------- 消耗包：被消耗钩子 / 爆燃·噩梦 / 交互选牌 ----------
    _exhaustCard(card) {                          // 把卡送进消耗堆，先触发涅槃/不坏（_inExhaust 防递归）
      this._exhaustedThisTurn = true;             // #9 本回合消耗过牌
      if (!this._inExhaust) {
        const s = CG.cardStats(card);
        if (s.nirvana) { this._inExhaust = true; for (let i = 0; i < s.nirvana; i++) this._applyCardEffects(card, s); this._inExhaust = false; this.addLog(`涅槃：${s.name} 被消耗时再次发动 ${s.nirvana} 次。`); }
        if (s.undying) { for (let i = 0; i < s.undying && this.hand.length < HAND_LIMIT; i++) this.hand.push(CG.makeCard(card.base, card.limit, card.sockets || [])); this.addLog(`不坏：${s.name} 留下 ${s.undying} 张副本。`); }
      }
      this.exhaustPile.push(card);
    }
    _applyCardEffects(card, s) {                  // 仅结算一张牌的效果（不计费/不消耗/不触发交互）——涅槃用
      s = s || CG.cardStats(card, { valueMult: this.cardValueMult });
      const target = this.currentTarget();
      for (let r = 0; r < (s.repeatTimes || 1); r++) (s.effects || []).forEach(eff => CG.Effects.apply(this, eff, this.player, target));
      this._checkEnd();
    }
    exhaustAllHand() {                            // 爆燃：消耗其余所有手牌（不坏/涅槃产物保留在新手牌）
      const snap = this.hand.slice(); this.hand = [];
      snap.forEach(c => this._exhaustCard(c));
    }
    fillNightmare() { while (this.hand.length < HAND_LIMIT) this.hand.push(CG.makeFoodCard('dross')); }   // 噩梦：渣滓塞满手牌
    _nextPick() {                                 // 处理 _pickQueue 的下一个交互选牌；无候选则跳过；队列空则收尾
      while (this._pickQueue && this._pickQueue.length) {
        const t = this._pickQueue.shift();
        const cands = t === 'burn' ? this.hand : t === 'reclaim' ? this.discardPile : t === 'wish' ? this.drawPile : this.exhaustPile;
        if (!cands.length) continue;
        const titles = { burn: '燃烧：选择并消耗 1 张手牌', reborn: '重生：从消耗堆取回 1 张', reclaim: '拾遗：从弃牌堆取回 1 张', wish: '许愿：从抽牌堆选择 1 张加入手牌' };
        this.pick = { type: t, title: titles[t], noSkip: t === 'burn' };   // 燃烧＝消耗手牌，不允许跳过
        this._emit();
        return;
      }
      this.pick = null;
      this._checkEnd();
      this._emit();
    }
    pickResolve(uid) {                            // UI 回调：uid=null 跳过本次
      if (!this.pick) return;
      if (this.pick.noSkip && uid == null) return;   // 丢弃/消耗手牌：不允许跳过（必须选一张）
      const t = this.pick.type;
      if (t === 'discardCost') {                  // 弃牌代价：自选丢弃一张 → 计数 -1 → 继续提示 / 结算
        if (uid != null) { const i = this.hand.findIndex(c => c.uid === uid); if (i >= 0) { const c = this.hand.splice(i, 1)[0]; this._discard(c); this.addLog(`弃牌代价：丢弃了 ${CG.cardStats(c).name}。`); } }
        this._discardLeft = (this._discardLeft || 1) - 1;
        this._promptDiscard();
        return;
      }
      if (t === 'exhaustCost') {                  // #15 消耗代价：自选消耗一张 → 计数 -1 → 继续 / 结算
        if (uid != null) { const i = this.hand.findIndex(c => c.uid === uid); if (i >= 0) { const c = this.hand.splice(i, 1)[0]; this.addLog(`消耗代价：消耗了 ${CG.cardStats(c).name}。`); this._exhaustCard(c); } }
        this._exhaustLeft = (this._exhaustLeft || 1) - 1;
        this._promptExhaust();
        return;
      }
      if (uid != null) {
        if (t === 'burn') { const i = this.hand.findIndex(c => c.uid === uid); if (i >= 0) { const c = this.hand.splice(i, 1)[0]; this.addLog(`燃烧：消耗了 ${CG.cardStats(c).name}。`); this._exhaustCard(c); } }
        else if (t === 'reclaim') { const i = this.discardPile.findIndex(c => c.uid === uid); if (i >= 0 && this.hand.length < HAND_LIMIT) { this.hand.push(this.discardPile.splice(i, 1)[0]); this.addLog('拾遗：从弃牌堆取回 1 张。'); } }
        else if (t === 'wish') { const i = this.drawPile.findIndex(c => c.uid === uid); if (i >= 0 && this.hand.length < HAND_LIMIT) { this.hand.push(this.drawPile.splice(i, 1)[0]); this.addLog('许愿：从抽牌堆取得 1 张。'); } }   // #37
        else { const i = this.exhaustPile.findIndex(c => c.uid === uid); if (i >= 0 && this.hand.length < HAND_LIMIT) { this.hand.push(this.exhaustPile.splice(i, 1)[0]); this.addLog('重生：从消耗堆取回 1 张。'); } }
      }
      this.pick = null;
      this._nextPick();
    }
    _dealBurn(target, n) {                        // 灼伤：每回合受 n 点伤害，但可被格挡
      const eh = target.hp, eb = target.block;
      this._dealRaw(target, n);
      this._fire('damage', { side: this._sideOf(target), ei: this._idxOf(target), hpLoss: eh - target.hp, blocked: Math.min(eb, n) });
    }

    // ---------- 战斗原语 ----------
    drawCards(n) {
      for (let i = 0; i < n; i++) {
        if (this.hand.length >= HAND_LIMIT) break;
        if (this.drawPile.length === 0) {
          if (this.discardPile.length === 0) break;       // 真的没牌可抽了
          this.drawPile = shuffle(this.discardPile);
          this.discardPile = [];
          this.addLog('弃牌堆已洗入抽牌堆。');
        }
        this.hand.push(this.drawPile.pop());
        if (this._inspire > 0) this.gainBlock(this.player, this._inspire);   // 律动·灵感：本回合每抽到一张牌 +格挡
      }
    }
    _discard(card) { this.discardPile.push(card); this._discardedThisTurn = (this._discardedThisTurn || 0) + 1; }   // 弃牌包：丢 1 张并计数
    _refreshWeapon(base, bonus) { [...this.hand, ...this.drawPile, ...this.discardPile, ...this.exhaustPile].forEach(c => { if (c.base === base) c._bonus = bonus; }); }   // 兵械：强化时刷新所有该类临时牌的本场加成
    _stampIllusion(card) { if (this._illusion > 0 && card) card._mult = (card._mult || 1) * (1 + this._illusion); return card; }   // v3.13 幻境：本回合生成的临时卡牌效果 ×(1+50%n)
    _refreshEndsword() { [...this.hand, ...this.drawPile, ...this.discardPile, ...this.exhaustPile].forEach(c => { if (c.base === 'endsword') { c._bonus = this._endswordDmg || 0; c._blk = this._endswordBlk || 0; } }); }   // 终末之剑：刷新所有处的伤害(锻造)/格挡(招架)加成
    // #45 每回合增益上限：增益类每回合效果最多 _everyCap 种；超出时把最旧的一种立即结算两次(本回合)并移除。代价类(失血等)不计入、不淘汰。
    _isEveryCost(eff) { return ['loseHp', 'loseGold', 'selfStatus', 'losePower', 'clutter', 'loseMinionHp'].includes(eff.type); }
    _everySrc(eff) { return (eff.minion && this.skeleton) ? this.skeleton : this.player; }
    // 同种判定：同效果类型 + 同状态/键 + 同目标(召唤物)＝「一种」，多个合并成一条（代价与收益都合并）。
    _gateMet(q, card) {   // 门型条件是否满足（card 供 firstPlay 判定）；供 playCard 结算与卡面「条件未满足变暗」复用
      const t = this.enemy;
      switch (q) {
        case 'firstPlay':     return ((card && card.plays) || 0) === 0;            // 这张牌本场第一次打出（plays 结算后才 +1）
        case 'hurt':          return !!this._hurtThisCombat;
        case 'noBlock':       return (this.player.block || 0) === 0;
        case 'enemyVuln':     return !!(t && t.statuses.vulnerable > 0);
        case 'enemyWeak':     return !!(t && t.statuses.weak > 0);
        case 'enemyFrail':    return !!(t && t.statuses.frail > 0);
        case 'enemyPoison':   return !!(t && t.statuses.poison > 0);
        case 'lostHpTurn':    return !!this._lostHpThisTurn;
        case 'exhaustedTurn': return !!this._exhaustedThisTurn;
        case 'lowHp':         return this.player.hp * 2 < this.player.maxHp;
        default:              return false;
      }
    }
    _everyKey(eff) { return eff.type + (eff.status ? ':' + eff.status : '') + (eff.key ? ':' + eff.key : '') + (eff.minion ? ':m' : ''); }
    _addEveryTurn(eff) {
      this._everyTurn = this._everyTurn || [];
      const k = this._everyKey(eff);
      const ex = this._everyTurn.find(e => this._everyKey(e) === k);
      if (ex) { ex.value = (ex.value || 0) + (eff.value || 0); return; }   // 合并同种「每回合」（不占新名额，代价与收益都合并）
      const ne = Object.assign({}, eff);                                    // 存副本，避免别名被外部修改
      const cap = this._everyCap || 3;
      while (this._everyTurn.length >= cap) {   // 每回合效果（增益+代价）合计最多 cap 种；超出→最旧的一种立即结算两次后失去
        const old = this._everyTurn.shift();
        if (!(old.minion && !this.skeleton)) for (let j = 0; j < 2; j++) CG.Effects.apply(this, old, this._everySrc(old), this.currentTarget());
        this.addLog('每回合效果已满：最旧的一种立即结算两次并失去。');
      }
      this._everyTurn.push(ne);
    }
    _addNextTurn(eff) {   // 下回合：同种也合并成一条
      this._nextTurn = this._nextTurn || [];
      const k = this._everyKey(eff);
      const ex = this._nextTurn.find(e => this._everyKey(e) === k);
      if (ex) { ex.value = (ex.value || 0) + (eff.value || 0); return; }
      this._nextTurn.push(Object.assign({}, eff));
    }
    _resolveEveryBuffs(times, remove) {   // 收割(#47)/爆破(#50)：现有「增益类」每回合效果立即结算 times 次；remove=true 随后失去
      (this._everyTurn || []).filter(e => !this._isEveryCost(e)).forEach(e => { for (let k = 0; k < times; k++) CG.Effects.apply(this, e, this._everySrc(e), this.currentTarget()); });
      if (remove) this._everyTurn = (this._everyTurn || []).filter(e => this._isEveryCost(e));
    }
    _addToHand(card) { if (this.hand.length < HAND_LIMIT) this.hand.push(card); else this.discardPile.push(card); }   // 术士包等：造牌进手（满则进弃牌堆）
    _enemyDebuffLayers(e) { return ['vulnerable', 'weak', 'frail', 'poison', 'burn', 'curse'].reduce((s, k) => s + (e.statuses[k] || 0), 0); }   // 猎杀包：目标减益层数总和（含咒言）
    // 律动·回溯：拍下/恢复一份「完整战斗快照」（双方生命/格挡/电力/状态，元素光环亦在 statuses 内）
    _snapshot() {
      return {
        hp: this.player.hp, block: this.player.block, power: this.player.power || 0,
        statuses: Object.assign({}, this.player.statuses),
        enemies: this.enemies.map(e => ({ hp: e.hp, block: e.block, alive: e.alive, statuses: Object.assign({}, e.statuses) })),
      };
    }
    _restore(s) {
      this.player.hp = s.hp; this.player.block = s.block; this.player.power = s.power;
      this.player.statuses = Object.assign({}, s.statuses);
      s.enemies.forEach((es, i) => { const e = this.enemies[i]; if (!e) return; e.hp = es.hp; e.block = es.block; e.alive = es.alive; e.statuses = Object.assign({}, es.statuses); });
      this._refreshTarget();
    }
    _discardRandom(n) { for (let i = 0; i < n && this.hand.length; i++) this._discard(this.hand.splice(Math.floor(Math.random() * this.hand.length), 1)[0]); }

    // 遗物字段可为数字或 (game, ctx)=>数字 的条件函数（用于区分相似遗物的触发前提）
    _relicSum(field, ctx) { return this.relics.reduce((s, id) => { const v = CG.RELICS[id][field]; return s + (typeof v === 'function' ? (v(this, ctx) || 0) : (v || 0)); }, 0); }
    _relicMult(field, ctx) { return this.relics.reduce((m, id) => { const v = CG.RELICS[id][field]; return m * (typeof v === 'function' ? (v(this, ctx) || 1) : (v || 1)); }, 1); }

    // 计算并结算一次攻击伤害（含力量 / 虚弱 / 易伤 / 遗物修正），并抛出动画事件
    dealAttackDamage(source, target, base) {
      let dmg = base + (source.statuses.strength || 0);
      if (source === this.player) {                                 // 玩家攻击：洋葱/蟋蟀等（含条件前提）
        const ctx = { source, target };
        dmg += this._relicSum('attackBonus', ctx);
        const m = this._relicMult('attackMult', ctx);
        if (m !== 1) dmg = Math.floor(dmg * m);
      }
      if (source.statuses.weak) dmg = Math.floor(dmg * (0.75 - (this._weakAmp && source !== this.player ? 0.15 : 0)));   // 虚弱：-25%（强化虚弱：敌方虚弱额外 -15%）
      if (target.statuses.vulnerable) dmg = Math.floor(dmg * (1.5 + (target !== this.player ? 0.25 * (this._vulnAmp || 0) : 0)));   // 易伤：+50%（强化易伤：敌方易伤额外 +25%×n）
      if (dmg < 0) dmg = 0;
      if (target === this.player) {                                 // 玩家受击：薄饼/圣盾/免疫/伤害降为1
        dmg = Math.max(0, dmg - this._relicSum('flatReduce'));
        if (dmg > 0 && this.relics.some(id => CG.RELICS[id].holyMantle) && !this._holyUsed) { dmg = 0; this._holyUsed = true; this.addLog('圣盾披风挡下一击！'); }
        if (dmg > 0 && this._immuneHits > 0) { dmg = 0; this._immuneHits--; this.addLog('免疫了这次伤害！'); }   // #27 免疫下 n 次伤害
        if (this._dmgCap1 && dmg > 1) dmg = 1;                       // #28 本回合受到伤害降为 1
      }

      this._fire('attack', { side: this._sideOf(source), ei: this._idxOf(source) });
      const beforeHp = target.hp, beforeBlock = target.block;
      if (target === this.player && source !== this.player && this.skeleton && this.skeleton.hp > 0) {
        this._absorbToPlayer(dmg);   // 召唤物替玩家抵挡（自带骷髅/玩家的受击动画）
      } else {
        this._dealRaw(target, dmg);
        this._fire('damage', { side: this._sideOf(target), ei: this._idxOf(target), hpLoss: beforeHp - target.hp, blocked: Math.min(beforeBlock, dmg) });
      }

      if (target === this.player && source !== this.player) {       // 荆棘：攻击你的敌人受反伤（玩家 + 召唤物的荆棘）
        const th = this._relicSum('thorns') + (this.player.statuses.thorns || 0) + ((this.skeleton && this.skeleton.statuses.thorns) || 0);
        if (th > 0 && source.hp > 0) { const eh = source.hp, eb = source.block; this._dealRaw(source, th); this._fire('damage', { side: 'enemy', ei: this._idxOf(source), hpLoss: eh - source.hp, blocked: Math.min(eb, th) }); }
      }
    }
    // 召唤物替玩家抵挡：召唤物格挡 → 玩家格挡 → 召唤物血 → 玩家血（分别播骷髅/玩家受击动画）
    _absorbToPlayer(dmg) {
      const sk = this.skeleton; let rem = dmg;
      const skBlk0 = sk ? (sk.block || 0) : 0, skHp0 = sk ? sk.hp : 0, pBlk0 = this.player.block || 0, pHp0 = this.player.hp;
      if (sk) { const a = Math.min(sk.block || 0, rem); sk.block -= a; rem -= a; }
      const pb = Math.min(this.player.block || 0, rem); this.player.block -= pb; rem -= pb;
      if (sk && rem > 0) { const a = Math.min(sk.hp, rem); sk.hp -= a; rem -= a; if (sk.hp <= 0) { this.skeleton = null; this.addLog('召唤物被击碎。'); } }
      if (rem > 0) this.player.hp = Math.max(0, this.player.hp - rem);
      if (sk) { const skLoss = skHp0 - sk.hp, skBlk = skBlk0 - (sk.block || 0); if (skLoss > 0 || skBlk > 0) this._fire('damage', { side: 'skeleton', ei: -1, hpLoss: skLoss, blocked: skBlk }); }
      const pLoss = pHp0 - this.player.hp, pBlk = pBlk0 - (this.player.block || 0);
      if (pLoss > 0) { this._hurtThisCombat = true; this._playerDamaged(); this._countHpLoss(); }   // 漏到玩家的伤害也算「受伤/失去生命」
      if (pLoss > 0 || pBlk > 0) this._fire('damage', { side: 'player', ei: -1, hpLoss: pLoss, blocked: pBlk });
    }

    _dealRaw(target, dmg) {
      if (target.block > 0) {
        const absorbed = Math.min(target.block, dmg);
        target.block -= absorbed;
        dmg -= absorbed;
      }
      if (dmg > 0) {
        target.hp = Math.max(0, target.hp - dmg);
        if (target === this.player) { this._hurtThisCombat = true; this._playerDamaged(); this._countHpLoss(); }
      }
    }
    _countHpLoss() { this._hpLossCount = (this._hpLossCount || 0) + 1; this._lostHpThisTurn = true; }   // #8/#18：失去生命 计数 / 本回合标志
    _playerDamaged() {
      // 达摩克利斯：受伤即变 1 HP 并永久失效
      if (this.relics.includes('damocles') && this.run && !this.run.flags.damoclesBroken) {
        this.player.hp = 1;
        this.run.flags.damoclesBroken = true;
        this._computeCardMult();
      }
      // 人寿保险：生命低于一半时释放储存的过量治疗
      if (this.run && this.relics.includes('insurance') && this.player.hp < this.player.maxHp / 2 && this.run.overheal > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.run.overheal);
        this.run.overheal = 0;
      }
      // 吞下的硬币：受伤获得金币
      const g = this._relicSum('goldOnHit');
      if (g > 0 && this.run) this.run.gold += g;
      // 通用受击钩子
      this.relics.forEach(id => { const r = CG.RELICS[id]; if (r.onPlayerDamaged) r.onPlayerDamaged(this); });
    }
    heal(n) {                                   // 战斗内治疗（滋养：每层 +50% 治疗效率；人寿保险可过量储存）
      const nour = this.player.statuses.nourish || 0;
      if (nour > 0 && n > 0) n = Math.floor(n * (1 + 0.25 * nour));
      const before = this.player.hp;
      if (this.run && this.relics.includes('insurance')) {
        this.player.hp += n;
        if (this.player.hp > this.player.maxHp) { this.run.overheal += this.player.hp - this.player.maxHp; this.player.hp = this.player.maxHp; }
      } else this.player.hp = Math.min(this.player.maxHp, this.player.hp + n);
      const healed = this.player.hp - before;
      if (healed > 0) this._fire('heal', { side: 'player', amount: healed });   // 治疗动画
      this._emit();
    }

    gainBlock(target, amount) {
      let b = amount + (target.statuses.dexterity || 0);                 // 敏捷：格挡 +X
      if (target.statuses.frail) b = Math.floor(b * 0.75);              // 脆弱：获得格挡 -25%
      b = Math.max(0, b);
      target.block += b;
      if (b > 0) this._fire('gainblock', { side: this._sideOf(target), ei: this._idxOf(target), amount: b });
    }

    applyStatus(target, key, amount) {
      if (amount > 0) {   // 放大包：本回合翻倍施加的减益(给敌)/增益(给己)
        if (this._ampDebuff > 0 && target !== this.player && ['vulnerable', 'weak', 'frail', 'poison', 'burn'].includes(key)) amount *= 2;
        if (this._ampBuff > 0 && target === this.player && ['strength', 'dexterity', 'regen', 'thorns', 'nourish'].includes(key)) amount *= 2;
      }
      if (key === 'poison' && amount > 0 && target !== this.player) this._poisonApplied = (this._poisonApplied || 0) + 1;   // v3.12 本场施加中毒「次数」（每次施加 +1，与层数无关）
      target.statuses[key] = (target.statuses[key] || 0) + amount;
      if (key === 'frozen' && target.statuses[key] > 1) target.statuses[key] = 1;   // 冰封最多 1 层
      if (target.statuses[key] === 0) delete target.statuses[key];
    }

    // ---------- 元素附着 / 反应 ----------（元素＝一种状态，至多 1 种、不随回合衰减）
    _auraOf(target) { return CG.ELEMENT_IDS.find(id => target.statuses[id] > 0) || null; }
    _setAura(target, el, level) { CG.ELEMENT_IDS.forEach(id => delete target.statuses[id]); target.statuses[el] = Math.min(1, Math.max(1, level || 1)); }
    _clearAura(target) { CG.ELEMENT_IDS.forEach(id => delete target.statuses[id]); }
    _reactionBurst(target, n) {                          // 超载：无视格挡的即时穿透伤害（带动画事件）
      const before = target.hp; target.hp = Math.max(0, target.hp - n);
      const lost = before - target.hp;
      if (lost > 0) this._fire('damage', { side: 'enemy', ei: this._idxOf(target), hpLoss: lost, blocked: 0 });
    }

    // 计时类减益每回合结束 -1（力量 / 敏捷是永久的，不在此列）
    _tickStatuses(entity) {     // 非负数状态每回合 -1（力量/敏捷可为负，不衰减；滋养/荆棘本场常驻，不在此列）
      ['vulnerable', 'weak', 'frail', 'poison', 'burn', 'leech', 'regen'].forEach(s => {
        if (entity.statuses[s] > 0) {
          entity.statuses[s] -= 1;
          if (entity.statuses[s] <= 0) delete entity.statuses[s];
        }
      });
    }

    _checkEnd() {
      this.enemies.forEach(e => { if (e.alive && e.hp <= 0) { e.alive = false; e.block = 0; this._killsThisCombat = (this._killsThisCombat || 0) + 1; this.addLog(`${e.name} 被击败了。`); if (this._reaping) this.applyStatus(this.player, 'strength', this._reaping); } });   // 猎杀·收割：击杀给永久力量
      this._refreshTarget();
      if (this.aliveEnemies().length === 0) { this.phase = 'won'; this.addLog('胜利！'); return; }
      if (this.player.hp <= 0) {
        if (this.relics.some(id => CG.RELICS[id].fullRevive) && !this._oneupUsed) {  // 1up：满血复活
          this._oneupUsed = true;
          this.player.hp = this.player.maxHp;
          this.addLog('1up！满血复活。');
          return;
        }
        if (this.relics.includes('laststand') && !this._laststandUsed) {   // 回光返照：本场一次免死
          this._laststandUsed = true;
          this.player.hp = 1;
          this.addLog('回光返照！你以 1 HP 撑住。');
          return;
        }
        this.phase = 'lost'; this.addLog('你倒下了……');
      }
    }

    _chooseEnemyIntent(enemy) {
      const e = enemy || this.enemy;
      const move = typeof e.def.chooseMove === 'function'
        ? e.def.chooseMove(this, e.history)
        : defaultEnemyAI(e.def.moves, e.history);
      e.intent = move;
      e.history.push(move.name);
    }

    // 给界面用：把当前敌人意图换算成显示信息（已计入力量 / 虚弱 / 易伤）
    intentPreview(enemy) {
      const e = enemy || this.enemy;
      const move = e.intent;
      if (!move) return null;
      const info = { intent: move.intent, name: move.name };
      const sc = e.dmgScale || 1;
      const dmg = (move.effects || []).find(x => x.type === 'damage');
      if (dmg) {
        let v = Math.round(dmg.value * sc) + (e.statuses.strength || 0);
        if (e.statuses.weak) v = Math.floor(v * 0.75);
        if (this.player.statuses.vulnerable) v = Math.floor(v * 1.5);
        info.damage = Math.max(0, v);
        info.hits = dmg.hits || 1;
      }
      const blk = (move.effects || []).find(x => x.type === 'block');
      if (blk) {
        let bl = Math.round(blk.value * sc) + (e.statuses.dexterity || 0);
        if (e.statuses.frail) bl = Math.floor(bl * 0.75);
        info.block = bl;
      }
      return info;
    }

    // 给界面用：本回合（敌人下一次行动）预计对玩家造成的净伤害（已计入格挡 / 减伤 / 圣盾 / 冰冻）
    playerIncomingDamage() {                                    // 所有存活敌人本回合预计净伤害合计
      let raw = 0;
      for (const e of this.aliveEnemies()) {
        if (e.statuses.frozen) continue;                        // 该敌人将被冰冻跳过
        const p = this.intentPreview(e);
        if (!p || p.damage == null) continue;
        const perHit = Math.max(0, p.damage - this._relicSum('flatReduce'));   // 薄饼：每段 -2
        raw += perHit * (p.hits || 1);
      }
      return Math.max(0, raw - this.player.block);
    }
  }

  CG.Game = Game;
  CG.defaultEnemyAI = defaultEnemyAI;
})(window.CG);

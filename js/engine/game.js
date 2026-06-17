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

  // 克隆一张卡（连词条）——战斗用副本，锻造/洗牌都不影响跑图原牌组
  function cloneCard(c) {
    return { uid: c.uid, base: c.base, limit: c.limit, affixes: (c.affixes || []).map(a => ({ id: a.id, level: a.level })) };
  }

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
    _sideOf(entity) { return entity === this.player ? 'player' : 'enemy'; }

    // 数值膨胀：把敌人招式的伤害/格挡按层数倍率放大
    _scaleEff(eff) {
      const sc = this.enemy.dmgScale || 1;
      return (sc !== 1 && (eff.type === 'damage' || eff.type === 'block'))
        ? Object.assign({}, eff, { value: Math.round(eff.value * sc) }) : eff;
    }

    // ---- 塔罗牌在战斗中触发的效果 ----
    addTempStrength(n) { this.applyStatus(this.player, 'strength', n); this._tempStrength = (this._tempStrength || 0) + n; this._emit(); }

    damageAll(n) {                              // 死亡：所有人受到 n 点伤害（过格挡）
      [this.enemy, this.player].forEach(t => {
        const beforeHp = t.hp, beforeBlock = t.block;
        this._dealRaw(t, n);
        this._fire('damage', { side: this._sideOf(t), hpLoss: beforeHp - t.hp, blocked: Math.min(beforeBlock, n) });
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
      const e = this.enemy;
      e.hp = e.maxHp; e.block = 0; e.statuses = {}; e.history = []; e.intent = null;
      this.player.block = 0; this.player.statuses = {};
      this.nextEnergyPenalty = 0; this.nextCardDmgMult = 1; this._tempStrength = 0;
      this.drawPile = shuffle(this._deck.map(cloneCard));
      this.hand = []; this.discardPile = []; this.exhaustPile = [];
      this.turn = 0; this.phase = 'player';
      this.addLog('重新开始了战斗。');
      this._chooseEnemyIntent();
      this._startPlayerTurn();
    }
    addLog(msg) { this.log.push(msg); if (this.log.length > 60) this.log.shift(); }

    _startBattle({ enemyId, deck, hp, maxHp, tarot, actScale, hpMult, relics, run }) {
      const def = CG.ENEMIES[enemyId];
      const sc = actScale || { hp: 1, dmg: 1 };
      this.tarot = tarot || [];                // 与 Run 共享的消耗品栏（同一数组引用）
      this.relics = relics || [];              // 与 Run 共享的遗物（引用）
      this.run = run || null;                  // 反向引用 Run（老虎机/人寿保险等需要）
      this._deck = deck;                       // 原始牌组引用（愚者重开时重新克隆）
      this.nextCardDmgMult = 1;                // 力量塔罗
      this._tempStrength = 0;                  // 战车（本回合力量）
      this._laststandUsed = false;             // 回光返照：本场一次
      this._holyUsed = false;                  // 圣盾披风：本场一次
      this._oneupUsed = false;                 // 1up：本场一次
      this.forgeMinLevel = run ? run.forgeMinLevel() : 1;  // 幸运脚
      const maxEnergy = START_ENERGY + this.relics.reduce((s, id) => s + (CG.RELICS[id].maxEnergyBonus || 0), 0);  // 电池
      this.player = {
        name: '你', maxHp, hp, block: 0,
        energy: maxEnergy, maxEnergy, statuses: {},
      };
      const ehp = Math.round(def.maxHp * sc.hp * (hpMult || 1));   // 数值膨胀 + 女祭司减血
      this.enemy = {
        def, name: def.name, maxHp: ehp, hp: ehp, block: 0,
        statuses: {}, history: [], intent: null, dmgScale: sc.dmg,
      };
      this._computeCardMult();                 // 达摩克利斯
      this.drawPile = shuffle(deck.map(cloneCard));  // 克隆副本：洗牌/锻造不影响原牌组
      this.hand = [];
      this.discardPile = [];
      this.exhaustPile = [];
      this.turn = 0;
      this.phase = 'player'; // 'player' | 'enemy' | 'won' | 'lost'
      this.addLog(`遭遇了 ${this.enemy.name}！`);
      this.relics.forEach(id => { const r = CG.RELICS[id]; if (r.battleStart) r.battleStart(this); });  // 尖矛/青石…
      this._chooseEnemyIntent();
      this._startPlayerTurn();
    }
    _computeCardMult() {
      this.cardValueMult = (this.relics.includes('damocles') && !(this.run && this.run.flags.damoclesBroken)) ? 2 : 1;
    }

    // ---------- 回合流程 ----------
    _startPlayerTurn() {
      this.turn += 1;
      this.phase = 'player';
      this.player.block = 0;
      let energyBonus = 0, drawBonus = 0;          // 癌症/无神论者：每回合额外能量/抽牌
      this.relics.forEach(id => { const r = CG.RELICS[id]; energyBonus += r.turnEnergy || 0; drawBonus += r.turnDraw || 0; });
      this.player.energy = Math.max(0, this.player.maxEnergy - (this.nextEnergyPenalty || 0)) + energyBonus;
      this.nextEnergyPenalty = 0;
      this._turnPlays = {};                       // 风怒：本回合各卡已打出次数
      if (this.turn === 1) this.relics.forEach(id => { const r = CG.RELICS[id]; if (r.firstTurn) r.firstTurn(this); });  // 厚盾/灯笼
      this.relics.forEach(id => {
        const r = CG.RELICS[id];
        if (r.onTurnStart) r.onTurnStart(this);          // 老虎机 / 兄弟鲍比 / 献祭匕首
        const bt = typeof r.blockTurn === 'function' ? r.blockTurn(this) : r.blockTurn;
        if (bt) this.gainBlock(this.player, bt);                          // 永恒之心/铁棒
        if (r.regenTurn) this.heal(r.regenTurn);                          // 再生肿块
        if (r.turnDamage && this.enemy.hp > 0) this.dealAttackDamage(this.player, this.enemy, r.turnDamage); // 小斯蒂文
      });
      this._checkEnd();
      if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
      this.drawCards(CARDS_PER_TURN + drawBonus);
      this._emit();
    }

    // 玩家点“结束回合”：先收尾，敌人行动由 runEnemyTurn 触发（界面可加延迟做演出）
    endTurn() {
      if (this.phase !== 'player') return;
      if (this._tempStrength) { this.applyStatus(this.player, 'strength', -this._tempStrength); this._tempStrength = 0; } // 战车：回合末移除临时力量
      this.discardPile.push(...this.hand);
      this.hand = [];
      this._tickStatuses(this.player);
      this.phase = 'enemy';
      this._emit();
    }

    runEnemyTurn() {
      if (this.phase !== 'enemy') return;
      const e = this.enemy;
      e.block = 0;
      if (e.statuses.poison) this._dotDamage(e.statuses.poison, false);   // 中毒：持续伤害
      if (e.statuses.leech) this._dotDamage(e.statuses.leech, true);      // 寄生：持续伤害 + 回血
      this._checkEnd();
      if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
      if (e.statuses.frozen > 0) {                                        // 冰封：跳过行动
        e.statuses.frozen -= 1;
        if (e.statuses.frozen <= 0) delete e.statuses.frozen;
        this.addLog(`${e.name} 被冰冻，无法行动。`);
      } else {
        const move = e.intent;
        this.addLog(`${e.name} 使用了 ${move.name}。`);
        (move.effects || []).forEach(eff => CG.Effects.apply(this, this._scaleEff(eff), e, this.player));
      }
      this._tickStatuses(e);
      this._checkEnd();
      if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
      this._chooseEnemyIntent();
      this._startPlayerTurn();
    }
    _dotDamage(n, lifesteal) {                  // 对敌人造成 n 点持续伤害（无视格挡）
      const before = this.enemy.hp;
      this.enemy.hp = Math.max(0, this.enemy.hp - n);
      const lost = before - this.enemy.hp;
      if (lost > 0) { this._fire('damage', { side: 'enemy', hpLoss: lost, blocked: 0 }); if (lifesteal) this.heal(lost); }
    }

    // ---------- 玩家操作 ----------
    playCard(uid) {
      if (this.phase !== 'player') return;
      const idx = this.hand.findIndex(c => c.uid === uid);
      if (idx === -1) return;
      const card = this.hand[idx];
      let s = CG.cardStats(card, { valueMult: this.cardValueMult });   // 达摩克利斯翻倍
      if (s.cost > this.player.energy) { this.addLog('能量不足。'); this._emit(); return; }

      // 力量塔罗：下一张攻击牌造成 N 倍伤害（用后清除）
      if (this.nextCardDmgMult > 1 && s.kind === 'damage') {
        s = Object.assign({}, s, { effects: s.effects.map(e => e.type === 'damage' ? Object.assign({}, e, { value: e.value * this.nextCardDmgMult }) : e) });
        this.nextCardDmgMult = 1;
      }

      this.player.energy -= s.cost;
      this.hand.splice(idx, 1);
      this.addLog(`你打出了 ${s.name}。`);

      const enemyHpBefore = this.enemy.hp;
      // 重复：整组效果结算 repeatTimes 次
      for (let r = 0; r < s.repeatTimes; r++) {
        (s.effects || []).forEach(eff => CG.Effects.apply(this, eff, this.player, this.enemy));
        if (this.player.hp <= 0 || this.enemy.hp <= 0) break;
      }
      // 吸血：按对敌人造成的伤害回血
      if (s.lifesteal > 0) { const dealt = enemyHpBefore - this.enemy.hp; if (dealt > 0) this.heal(Math.floor(dealt * s.lifesteal)); }
      // 透支：累计下回合能量惩罚
      if (s.nextEnergyPenalty) this.nextEnergyPenalty = (this.nextEnergyPenalty || 0) + s.nextEnergyPenalty;

      // 锻造：随机锻造手中若干张牌（作用于本场克隆副本，加 buff+debuff）
      if (s.forgeCount) {
        const pool = [...this.hand];
        for (let i = 0; i < s.forgeCount && pool.length; i++)
          CG.upgradeInstance(pool.splice(Math.floor(Math.random() * pool.length), 1)[0], { minLevel: this.forgeMinLevel });
      }
      // 侵蚀：随机降级手中若干张牌（移除一个随机词条）
      if (s.erodeCount) {
        for (let i = 0; i < s.erodeCount; i++) {
          const pool = this.hand.filter(c => (c.affixes || []).length);
          if (!pool.length) break;
          const c = pool[Math.floor(Math.random() * pool.length)];
          c.affixes.splice(Math.floor(Math.random() * c.affixes.length), 1);
        }
      }

      // 风怒：本回合前 N 次打出后回到手牌（销毁优先，不回手）
      let returned = false;
      if (!s.exhaust && s.windfury > 0 && this.player.hp > 0 && this.enemy.hp > 0 && this.hand.length < HAND_LIMIT) {
        this._turnPlays = this._turnPlays || {};
        const cnt = (this._turnPlays[card.uid] || 0) + 1;
        this._turnPlays[card.uid] = cnt;
        if (cnt <= s.windfury) { this.hand.push(card); returned = true; }
      }
      if (!returned) { if (s.exhaust) this.exhaustPile.push(card); else this.discardPile.push(card); }  // 销毁→消耗堆

      this._checkEnd();
      this._emit();
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
      }
    }

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
      if (source.statuses.weak) dmg = Math.floor(dmg * 0.75);       // 虚弱：造成伤害 -25%
      if (target.statuses.vulnerable) dmg = Math.floor(dmg * 1.5);  // 易伤：受到伤害 +50%
      if (dmg < 0) dmg = 0;
      if (target === this.player) {                                 // 玩家受击：薄饼/圣盾
        dmg = Math.max(0, dmg - this._relicSum('flatReduce'));
        if (dmg > 0 && this.relics.some(id => CG.RELICS[id].holyMantle) && !this._holyUsed) { dmg = 0; this._holyUsed = true; this.addLog('圣盾披风挡下一击！'); }
      }

      this._fire('attack', { side: this._sideOf(source) });
      const beforeHp = target.hp, beforeBlock = target.block;
      this._dealRaw(target, dmg);
      this._fire('damage', { side: this._sideOf(target), hpLoss: beforeHp - target.hp, blocked: Math.min(beforeBlock, dmg) });

      if (target === this.player) {                                 // 荆棘：敌人攻击你后反伤
        const th = this._relicSum('thorns');
        if (th > 0 && this.enemy.hp > 0) { const eh = this.enemy.hp, eb = this.enemy.block; this._dealRaw(this.enemy, th); this._fire('damage', { side: 'enemy', hpLoss: eh - this.enemy.hp, blocked: Math.min(eb, th) }); }
      }
    }

    _dealRaw(target, dmg) {
      if (target.block > 0) {
        const absorbed = Math.min(target.block, dmg);
        target.block -= absorbed;
        dmg -= absorbed;
      }
      if (dmg > 0) {
        target.hp = Math.max(0, target.hp - dmg);
        if (target === this.player) this._playerDamaged();
      }
    }
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
    heal(n) {                                   // 战斗内治疗（人寿保险可过量储存）
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
      if (b > 0) this._fire('gainblock', { side: this._sideOf(target), amount: b });
    }

    applyStatus(target, key, amount) {
      target.statuses[key] = (target.statuses[key] || 0) + amount;
      if (key === 'frozen' && target.statuses[key] > 1) target.statuses[key] = 1;   // 冰封最多 1 层
      if (target.statuses[key] === 0) delete target.statuses[key];
    }

    // 计时类减益每回合结束 -1（力量 / 敏捷是永久的，不在此列）
    _tickStatuses(entity) {     // 非负数状态每回合 -1（力量/敏捷可为负，不衰减）
      ['vulnerable', 'weak', 'frail', 'poison', 'leech'].forEach(s => {
        if (entity.statuses[s] > 0) {
          entity.statuses[s] -= 1;
          if (entity.statuses[s] <= 0) delete entity.statuses[s];
        }
      });
    }

    _checkEnd() {
      if (this.enemy.hp <= 0) { this.phase = 'won'; this.addLog('胜利！'); return; }
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

    _chooseEnemyIntent() {
      const e = this.enemy;
      const move = typeof e.def.chooseMove === 'function'
        ? e.def.chooseMove(this, e.history)
        : defaultEnemyAI(e.def.moves, e.history);
      e.intent = move;
      e.history.push(move.name);
    }

    // 给界面用：把当前敌人意图换算成显示信息（已计入力量 / 虚弱 / 易伤）
    intentPreview() {
      const move = this.enemy.intent;
      if (!move) return null;
      const info = { intent: move.intent, name: move.name };
      const sc = this.enemy.dmgScale || 1;
      const dmg = (move.effects || []).find(e => e.type === 'damage');
      if (dmg) {
        let v = Math.round(dmg.value * sc) + (this.enemy.statuses.strength || 0);
        if (this.enemy.statuses.weak) v = Math.floor(v * 0.75);
        if (this.player.statuses.vulnerable) v = Math.floor(v * 1.5);
        info.damage = Math.max(0, v);
        info.hits = dmg.hits || 1;
      }
      const blk = (move.effects || []).find(e => e.type === 'block');
      if (blk) {
        let bl = Math.round(blk.value * sc) + (this.enemy.statuses.dexterity || 0);
        if (this.enemy.statuses.frail) bl = Math.floor(bl * 0.75);
        info.block = bl;
      }
      return info;
    }

    // 给界面用：本回合（敌人下一次行动）预计对玩家造成的净伤害（已计入格挡 / 减伤 / 圣盾 / 冰冻）
    playerIncomingDamage() {
      if (this.enemy.statuses.frozen) return 0;                 // 敌人将被冰冻跳过
      const p = this.intentPreview();
      if (!p || p.damage == null) return 0;
      const perHit = Math.max(0, p.damage - this._relicSum('flatReduce'));   // 薄饼：每段 -2
      let raw = perHit * (p.hits || 1);
      if (raw > 0 && this.relics.some(id => CG.RELICS[id].holyMantle) && !this._holyUsed) raw -= perHit;  // 圣盾挡首段
      return Math.max(0, raw - this.player.block);
    }
  }

  CG.Game = Game;
  CG.defaultEnemyAI = defaultEnemyAI;
})(window.CG);

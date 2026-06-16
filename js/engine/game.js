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
  const START_HP = 75;       // 玩家初始 / 最大生命
  const START_ENERGY = 3;    // 每回合能量
  const CARDS_PER_TURN = 5;  // 每回合抽牌数

  let uidCounter = 0;        // 给每张牌实例一个唯一 id，方便界面定位

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
    constructor(enemyId) {
      this.listeners = [];
      this.log = [];
      this._startBattle(enemyId);
    }

    onChange(fn) { this.listeners.push(fn); return this; }
    _emit() { this.listeners.forEach(fn => fn(this)); }
    addLog(msg) { this.log.push(msg); if (this.log.length > 60) this.log.shift(); }

    _startBattle(enemyId) {
      const def = CG.ENEMIES[enemyId];
      this.player = {
        name: '你', maxHp: START_HP, hp: START_HP, block: 0,
        energy: START_ENERGY, maxEnergy: START_ENERGY, statuses: {},
      };
      this.enemy = {
        def, name: def.name, maxHp: def.maxHp, hp: def.maxHp, block: 0,
        statuses: {}, history: [], intent: null,
      };
      this.drawPile = shuffle(CG.STARTER_DECK.map(id => ({ uid: ++uidCounter, defId: id })));
      this.hand = [];
      this.discardPile = [];
      this.exhaustPile = [];
      this.turn = 0;
      this.phase = 'player'; // 'player' | 'enemy' | 'won' | 'lost'
      this.addLog(`遭遇了 ${this.enemy.name}！`);
      this._chooseEnemyIntent();
      this._startPlayerTurn();
    }

    // ---------- 回合流程 ----------
    _startPlayerTurn() {
      this.turn += 1;
      this.phase = 'player';
      this.player.block = 0;
      this.player.energy = this.player.maxEnergy;
      this.drawCards(CARDS_PER_TURN);
      this._emit();
    }

    // 玩家点“结束回合”：先收尾，敌人行动由 runEnemyTurn 触发（界面可加延迟做演出）
    endTurn() {
      if (this.phase !== 'player') return;
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
      const move = e.intent;
      this.addLog(`${e.name} 使用了 ${move.name}。`);
      (move.effects || []).forEach(eff => CG.Effects.apply(this, eff, e, this.player));
      this._tickStatuses(e);
      this._checkEnd();
      if (this.phase === 'won' || this.phase === 'lost') { this._emit(); return; }
      this._chooseEnemyIntent();
      this._startPlayerTurn();
    }

    // ---------- 玩家操作 ----------
    playCard(uid) {
      if (this.phase !== 'player') return;
      const idx = this.hand.findIndex(c => c.uid === uid);
      if (idx === -1) return;
      const def = CG.CARDS[this.hand[idx].defId];
      if (def.cost > this.player.energy) { this.addLog('能量不足。'); this._emit(); return; }

      this.player.energy -= def.cost;
      const [card] = this.hand.splice(idx, 1);
      this.addLog(`你打出了 ${def.name}。`);
      (def.effects || []).forEach(eff => CG.Effects.apply(this, eff, this.player, this.enemy));
      (def.exhaust ? this.exhaustPile : this.discardPile).push(card);

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

    // 计算并结算一次攻击伤害（含力量 / 虚弱 / 易伤修正）
    dealAttackDamage(source, target, base) {
      let dmg = base + (source.statuses.strength || 0);
      if (source.statuses.weak) dmg = Math.floor(dmg * 0.75);       // 虚弱：造成伤害 -25%
      if (target.statuses.vulnerable) dmg = Math.floor(dmg * 1.5);  // 易伤：受到伤害 +50%
      if (dmg < 0) dmg = 0;
      this._dealRaw(target, dmg);
    }

    _dealRaw(target, dmg) {
      if (target.block > 0) {
        const absorbed = Math.min(target.block, dmg);
        target.block -= absorbed;
        dmg -= absorbed;
      }
      if (dmg > 0) target.hp = Math.max(0, target.hp - dmg);
    }

    gainBlock(target, amount) {
      const b = Math.max(0, amount + (target.statuses.dexterity || 0)); // 敏捷：格挡 +X
      target.block += b;
    }

    applyStatus(target, key, amount) {
      target.statuses[key] = (target.statuses[key] || 0) + amount;
      if (target.statuses[key] === 0) delete target.statuses[key];
    }

    // 计时类减益每回合结束 -1（力量 / 敏捷是永久的，不在此列）
    _tickStatuses(entity) {
      ['vulnerable', 'weak', 'frail'].forEach(s => {
        if (entity.statuses[s] > 0) {
          entity.statuses[s] -= 1;
          if (entity.statuses[s] <= 0) delete entity.statuses[s];
        }
      });
    }

    _checkEnd() {
      if (this.enemy.hp <= 0) { this.phase = 'won'; this.addLog('胜利！'); }
      else if (this.player.hp <= 0) { this.phase = 'lost'; this.addLog('你倒下了……'); }
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
      const dmg = (move.effects || []).find(e => e.type === 'damage');
      if (dmg) {
        let v = dmg.value + (this.enemy.statuses.strength || 0);
        if (this.enemy.statuses.weak) v = Math.floor(v * 0.75);
        if (this.player.statuses.vulnerable) v = Math.floor(v * 1.5);
        info.damage = Math.max(0, v);
        info.hits = dmg.hits || 1;
      }
      const blk = (move.effects || []).find(e => e.type === 'block');
      if (blk) info.block = blk.value + (this.enemy.statuses.dexterity || 0);
      return info;
    }
  }

  CG.Game = Game;
  CG.defaultEnemyAI = defaultEnemyAI;
})(window.CG);

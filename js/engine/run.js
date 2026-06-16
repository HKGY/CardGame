window.CG = window.CG || {};

/* ===========================================================================
 *  Run —— 一次“爬塔”的持久状态：血量 / 金币 / 牌组 / 地图与进度。
 * ===========================================================================
 *  战斗 Game 由 Run 提供 { deck, hp, maxHp } 实例化，结束后调用 finishBattle 回收结果。
 *  地图是分行的分支图：每个节点有 type 和指向下一行若干节点的 next[]。
 *  phase: 'map' | 'battle' | 'reward' | 'shop' | 'rest' | 'dead' | 'victory'
 * ===========================================================================
 */
(function (CG) {
  const C = () => CG.CONFIG;
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));  // 闭区间随机整数
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  function weighted(pairs) {                                          // [[值, 权重], ...]
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = Math.random() * total;
    for (const [v, w] of pairs) if ((r -= w) < 0) return v;
    return pairs[pairs.length - 1][0];
  }

  // ---------- 地图生成 ----------
  function pickNodeType(r, contentRows) {
    if (r === 0) return 'monster';                 // 起始行：普通战斗
    if (r === contentRows - 1) return 'rest';      // Boss 前固定休息
    const opts = [['monster', 5], ['shop', 2], ['rest', 2]];
    if (r >= 2) opts.push(['elite', 2]);
    return weighted(opts);
  }
  function connectRows(a, b) {
    a.forEach((node, i) => {
      const center = a.length === 1 ? Math.floor((b.length - 1) / 2)
                                    : Math.round(i / (a.length - 1) * (b.length - 1));
      const set = new Set([center]);
      if (center + 1 < b.length && Math.random() < 0.5) set.add(center + 1);
      if (center - 1 >= 0 && Math.random() < 0.35) set.add(center - 1);
      node.next = [...set].sort((x, y) => x - y);
    });
    b.forEach((_, j) => {                          // 保证每个下层节点都有入边
      if (!a.some(n => n.next.includes(j))) {
        const ai = a.length === 1 ? 0 : Math.round(j / (b.length - 1) * (a.length - 1));
        a[ai].next = [...new Set([...a[ai].next, j])].sort((x, y) => x - y);
      }
    });
  }
  function generateMap() {
    const rowsN = C().map.rows;
    const rows = [];
    for (let r = 0; r < rowsN; r++) {
      const w = ri(C().map.minWidth, C().map.maxWidth);
      const nodes = [];
      for (let i = 0; i < w; i++) nodes.push({ row: r, idx: i, type: pickNodeType(r, rowsN), next: [], done: false });
      rows.push(nodes);
    }
    rows.push([{ row: rowsN, idx: 0, type: 'boss', next: [], done: false }]);  // Boss 行
    for (let r = 0; r < rows.length - 1; r++) connectRows(rows[r], rows[r + 1]);
    return rows;
  }

  // ---------- 奖励 / 商店 ----------
  function rollGold(tier) { const [lo, hi] = C().gold[tier]; return ri(lo, hi); }
  function rollRewardCards(tier) {
    const out = [];
    for (let i = 0; i < C().reward.count; i++)
      out.push({ base: pick(['strike', 'defend']), upgrade: weighted(C().reward.upgradeWeights[tier]) });
    return out;
  }
  function rollShopStock() {
    const cards = [];
    for (let i = 0; i < C().shop.cardCount; i++) {
      const base = pick(['strike', 'defend']);
      const upgrade = weighted([[0, 5], [1, 3], [2, 2]]);
      cards.push({ base, upgrade, price: CG.cardPrice(upgrade), bought: false });
    }
    return { cards };
  }

  class Run {
    constructor() {
      this.listeners = [];
      this.maxHp = C().startHp;
      this.hp = this.maxHp;
      this.gold = 0;
      this.deck = CG.STARTER_DECK.map(b => CG.makeCard(b));
      this.map = generateMap();
      this.current = null;
      this.available = this.map[0].slice();   // 起点：第 0 行任选其一
      this.pending = null;                     // 暂存：本场战斗信息 / 奖励 / 商店货架
      this.phase = 'map';
    }

    onChange(fn) { this.listeners.push(fn); return this; }
    _emit() { this.listeners.forEach(fn => fn(this)); }
    isAvailable(node) { return this.available.includes(node); }

    // 玩家在地图上选择一个节点进入
    selectNode(node) {
      if (!this.isAvailable(node)) return;
      this.current = node;
      if (node.type === 'monster' || node.type === 'elite' || node.type === 'boss') {
        const pool = CG.ENEMY_POOLS[node.type === 'monster' ? 'normal' : node.type];
        this.pending = { tier: node.type, enemyId: pick(pool) };
        this.phase = 'battle';
      } else if (node.type === 'shop') {
        this.pending = rollShopStock();
        this.phase = 'shop';
      } else if (node.type === 'rest') {
        this.pending = null;
        this.phase = 'rest';
      }
      this._emit();
    }

    // 战斗结束回收：win + 剩余血量
    finishBattle(win, remainingHp) {
      this.hp = Math.max(0, remainingHp);
      if (!win || this.hp <= 0) { this.phase = 'dead'; this._emit(); return; }
      const tier = this.current.type;                    // monster | elite | boss
      const gold = rollGold(tier);
      this.gold += gold;
      this.pending = { gold, cards: rollRewardCards(tier) };
      this.phase = 'reward';
      this._emit();
    }

    chooseReward(spec) {                                  // spec=null 表示跳过
      if (spec) this.deck.push(CG.makeCard(spec.base, spec.upgrade));
      this.pending = null;
      this._advance();
    }

    // ---- 休息点 ----
    restHeal() {
      this.hp = Math.min(this.maxHp, this.hp + Math.ceil(this.maxHp * C().rest.healPct));
      this._advance();
    }
    restUpgrade(uid) { this._upgrade(uid); this._advance(); }

    // ---- 商店 ----
    buyCard(i) {
      const it = this.pending.cards[i];
      if (!it || it.bought || this.gold < it.price) return;
      this.gold -= it.price;
      it.bought = true;
      this.deck.push(CG.makeCard(it.base, it.upgrade));
      this._emit();
    }
    buyUpgrade(uid) {
      if (this.gold < C().shop.upgradePrice) return;
      this.gold -= C().shop.upgradePrice;
      this._upgrade(uid);
      this._emit();
    }
    buyHeal() {
      if (this.gold < C().shop.healPrice || this.hp >= this.maxHp) return;
      this.gold -= C().shop.healPrice;
      this.hp = Math.min(this.maxHp, this.hp + Math.ceil(this.maxHp * C().shop.healPct));
      this._emit();
    }
    leaveShop() { this.pending = null; this._advance(); }

    _upgrade(uid) { const c = this.deck.find(c => c.uid === uid); if (c) c.upgrade = (c.upgrade || 0) + 1; }

    // 结算当前节点，前进到下一行（Boss 节点 -> 通关）
    _advance() {
      const node = this.current;
      node.done = true;
      if (node.type === 'boss') { this.phase = 'victory'; this._emit(); return; }
      const nextRow = this.map[node.row + 1];
      this.available = node.next.map(i => nextRow[i]);
      this.phase = 'map';
      this._emit();
    }
  }

  CG.Run = Run;
})(window.CG);

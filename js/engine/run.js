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
  // 连接相邻两行：生成「单调阶梯」式连边——每个上层节点连到一段连续的下层节点，
  // 区间起点随索引单调不减且首尾相接（共享末端=汇合 / +1=分叉）。由此保证：
  //   1) 永不交叉：上层 i<k ⟹ i 的所有目标 ≤ k 的所有目标；
  //   2) 全覆盖 + 每个上层节点都有出边、每个下层节点都有入边；
  //   3) 只连邻近的下层节点（分支宽度≈2），不会出现横跨很远的长连线。
  function connectRows(a, b) {
    const m = a.length, n = b.length;
    for (const node of a) node.next = [];
    let L = 0;                                     // 当前上层节点的区间起点（单调不减）
    for (let i = 0; i < m; i++) {
      const after = m - 1 - i;                     // 之后还剩多少个上层节点
      let R;
      if (i === m - 1) {
        R = n - 1;                                 // 最后一个收尾，保证覆盖到末端
      } else {
        const hi = Math.min(L + 1, n - 1);                       // 分支宽度≤2，避免长连线
        let lo = Math.max(L, (n - 1) - (after + 1) * 2);         // 别推进太慢，保证后续可达末端
        lo = Math.min(lo, hi);
        R = lo + Math.floor(Math.random() * (hi - lo + 1));
      }
      if (R < L) R = L;
      if (R > n - 1) R = n - 1;
      for (let j = L; j <= R; j++) a[i].next.push(j);
      if (i < m - 1) L = (R < n - 1 && Math.random() < 0.5) ? R + 1 : R;  // 分叉 或 共享末端(汇合)
    }
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

  // 按强度生成一张带词条的卡（{base, affixes:[{id,level}]}）
  function rollCard(tier) {
    const cfg = C().affix[tier];
    const count = weighted(cfg.count);
    const pool = [...CG.AFFIX_ORDER];
    const affixes = [];
    for (let i = 0; i < count && pool.length; i++) {
      const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      affixes.push({ id, level: 1 + Math.floor(Math.random() * cfg.maxLevel) });
    }
    return { base: pick(['strike', 'defend']), affixes };
  }
  function rollRewardCards(tier) {
    const out = [];
    for (let i = 0; i < C().reward.count; i++) out.push(rollCard(tier));
    return out;
  }
  function rollShopStock() {
    const cards = [];
    for (let i = 0; i < C().shop.cardCount; i++) {
      const c = rollCard(pick(['monster', 'monster', 'elite']));   // 商店以普通货为主，偶有精英货
      cards.push({ base: c.base, affixes: c.affixes, price: CG.cardPrice(c), bought: false });
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
      if (spec) this.deck.push(CG.makeCard(spec.base, spec.affixes));
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
      this.deck.push(CG.makeCard(it.base, it.affixes));
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

    // 升级一张卡：加一个新词条，或给已有词条升一级（每卡最多 3 词条、每词条最多 3 级）
    _upgrade(uid) {
      const c = this.deck.find(c => c.uid === uid);
      if (!c) return;
      c.affixes = c.affixes || [];
      const owned = new Set(c.affixes.map(a => a.id));
      const pool = CG.AFFIX_ORDER.filter(id => !owned.has(id));
      const levelable = c.affixes.filter(a => a.level < 3);
      const canAdd = c.affixes.length < 3 && pool.length > 0;
      if (canAdd && (levelable.length === 0 || Math.random() < 0.6)) {
        c.affixes.push({ id: pick(pool), level: 1 });
      } else if (levelable.length > 0) {
        pick(levelable).level += 1;
      } else if (canAdd) {
        c.affixes.push({ id: pick(pool), level: 1 });
      }
    }

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

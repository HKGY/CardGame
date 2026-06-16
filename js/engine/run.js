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

  // 事件祭坛
  CG.ALTARS = {
    upgrade: { name: '升级祭坛', icon: '⬆️', desc: '为一张牌加上一个随机词条（随机等级）。' },
    forge:   { name: '锻造祭坛', icon: '🔨', desc: '为一张牌加上一个【3 级】随机词条。' },
    copy:    { name: '复制祭坛', icon: '🪞', desc: '复制一张牌，副本加入牌组。' },
    remove:  { name: '删牌祭坛', icon: '🗑️', desc: '从牌组中移除一张牌。' },
    reforge: { name: '重铸祭坛', icon: '♻️', desc: '重铸一张牌的全部词条（数量不变，重新随机）。' },
  };
  CG.ALTAR_IDS = ['upgrade', 'forge', 'copy', 'remove', 'reforge'];

  // ---------- 地图生成 ----------
  function pickNodeType(r, contentRows) {
    if (r === 0) return 'monster';                 // 起始行：普通战斗
    if (r === contentRows - 1) return 'rest';      // Boss 前固定休息
    const opts = [['monster', 5], ['shop', 2], ['rest', 2], ['event', 3]];
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
  function rollGold(tier, act) { const [lo, hi] = C().gold[tier]; return Math.round(ri(lo, hi) * (C().goldMult[act] || 1)); }

  // 按强度生成一张带词条的卡（{base, affixes:[{id,level}]}）。保证至少 1 个词条。
  function rollCard(tier) {
    const cfg = C().affix[tier];
    const count = Math.max(1, weighted(cfg.count));
    const pool = [...CG.AFFIX_ORDER];
    const affixes = [];
    for (let i = 0; i < count && pool.length; i++) {
      const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      affixes.push({ id, level: weighted(cfg.levelW) });
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
    const tarot = [];
    for (let i = 0; i < C().shop.tarotCount; i++)
      tarot.push({ id: pick(CG.TAROT_IDS), price: C().shop.tarotPrice, bought: false });
    return { cards, tarot };
  }

  class Run {
    constructor() {
      this.listeners = [];
      this.maxHp = C().startHp;
      this.hp = this.maxHp;
      this.gold = C().startGold;
      this.act = 1;
      this.maxActs = C().acts;
      this.deck = CG.STARTER_DECK.map(b => CG.makeCard(b));
      this.tarot = [];                         // 消耗品栏（塔罗牌）
      this.flags = {};                         // 各种延迟生效的塔罗效果旗标
      this.removeCount = 0;                    // 商店删牌次数（涨价用）
      this.current = null;
      this.pending = null;                     // 暂存：本场战斗信息 / 奖励 / 商店货架
      this.phase = 'map';
      this._newMap();
    }

    _newMap() {
      this.map = generateMap();
      this.current = null;
      this.available = this.map[0].slice();    // 起点：第 0 行任选其一
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
        if (this.flags.freeShopCard && this.pending.cards[0]) {   // 隐士：首张卡免费
          this.pending.cards[0].price = 0;
          this.flags.freeShopCard = false;
        }
        this.phase = 'shop';
      } else if (node.type === 'rest') {
        this.pending = null;
        this.phase = 'rest';
      } else if (node.type === 'event') {
        this.pending = { altar: pick(CG.ALTAR_IDS) };   // 随机一种祭坛
        this.phase = 'event';
      }
      this._emit();
    }

    // 事件祭坛：对选中的牌应用效果，然后离开
    useAltar(uid) {
      const id = this.pending && this.pending.altar;
      const card = this.deck.find(c => c.uid === uid);
      if (id === 'remove') {
        if (this.deck.length > 1) this.deck = this.deck.filter(c => c.uid !== uid);
      } else if (card) {
        if (id === 'upgrade') CG.upgradeInstance(card);
        else if (id === 'forge') CG.upgradeInstance(card, { level: 3 });
        else if (id === 'copy') this.deck.push(CG.makeCard(card.base, card.affixes));
        else if (id === 'reforge') CG.reforgeInstance(card);
      }
      this._advance();
    }
    leaveEvent() { this._advance(); }

    // 战斗结束回收：win + 剩余血量
    finishBattle(win, remainingHp) {
      this.hp = Math.max(0, remainingHp);
      if (!win || this.hp <= 0) { this.phase = 'dead'; this._emit(); return; }
      const tier = this.current.type;                    // monster | elite | boss
      if (tier === 'boss') this.hp = this.maxHp;          // 每场 Boss 战后回满
      const gold = rollGold(tier, this.act);
      this.gold += gold;
      // 世界：本次卡牌奖励替换为随机祭坛
      if (this.flags.rewardAsAltar) {
        this.flags.rewardAsAltar = false;
        this.pending = { altar: pick(CG.ALTAR_IDS) };
        this.phase = 'event';
        this._emit();
        return;
      }
      const cards = rollRewardCards(tier);
      // 群星：本次奖励每张多一条词条
      if (this.flags.rewardAffixBoost) { this.flags.rewardAffixBoost = false; cards.forEach(c => CG.upgradeInstance(c)); }
      this.pending = { gold, cards, tarot: null, tarotTaken: false };
      // 概率掉落塔罗牌
      if (Math.random() < (C().tarot.chance[tier] || 0)) this.pending.tarot = pick(CG.TAROT_IDS);
      this.phase = 'reward';
      this._emit();
    }

    chooseReward(spec) {                                  // spec=null 表示跳过
      if (spec) this.deck.push(CG.makeCard(spec.base, spec.affixes));
      this.pending = null;
      this._advance();
    }

    takeTarot() {                                         // 把奖励塔罗收入消耗品栏
      const p = this.pending;
      if (!p || !p.tarot || p.tarotTaken || this.tarot.length >= C().tarot.slots) return;
      this.tarot.push(p.tarot);
      p.tarotTaken = true;
      this._emit();
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
    buyTarot(i) {                                         // 商店买塔罗牌
      const it = this.pending.tarot[i];
      if (!it || it.bought || this.gold < it.price || this.tarot.length >= C().tarot.slots) return;
      this.gold -= it.price;
      it.bought = true;
      this.tarot.push(it.id);
      this._emit();
    }
    removePrice() { return C().shop.removeBase + C().shop.removeStep * (this.removeCount || 0); }
    buyRemove(uid) {                                      // 商店删牌，价格逐次永久提高
      if (this.gold < this.removePrice() || this.deck.length <= 1) return;
      this.gold -= this.removePrice();
      this.removeCount = (this.removeCount || 0) + 1;
      this.deck = this.deck.filter(c => c.uid !== uid);
      this._emit();
    }
    leaveShop() { this.pending = null; this._advance(); }

    // ---- 塔罗牌触发的跑图效果 ----
    fillTarot() { while (this.tarot.length < C().tarot.slots) this.tarot.push(pick(CG.TAROT_IDS)); }
    gotoActBoss() {                                       // 皇帝：传送到本层 Boss
      this.current = this.map[this.map.length - 1][0];
      this.pending = { tier: 'boss', enemyId: pick(CG.ENEMY_POOLS.boss) };
      this.phase = 'battle';
      this._emit();
    }
    teleportRandom() {                                    // 月亮：传送到随机（非 Boss）房间
      const all = [].concat(...this.map).filter(n => !n.done && n.type !== 'boss' && n !== this.current);
      if (!all.length) return;
      const node = all[Math.floor(Math.random() * all.length)];
      this.available = [node];
      this.selectNode(node);
    }
    freeRoute() {                                         // 倒吊人：无视连线任选下层
      if (this.phase === 'map' && this.available.length) {
        const row = this.available[0].row;
        this.available = this.map[row].filter(n => !n.done);
      } else this.flags.freeRoute = true;
    }

    _upgrade(uid) { const c = this.deck.find(c => c.uid === uid); if (c) CG.upgradeInstance(c); }

    // 结算当前节点，前进到下一行（Boss 节点 -> 通关）
    _advance() {
      const node = this.current;
      node.done = true;
      if (node.type === 'boss') {                        // 通关 Boss：进入下一层，或全部通关
        if (this.act < this.maxActs) { this.act++; this._newMap(); this.phase = 'map'; this._emit(); return; }
        this.phase = 'victory'; this._emit(); return;
      }
      const nextRow = this.map[node.row + 1];
      this.available = this.flags.freeRoute ? nextRow.slice() : node.next.map(i => nextRow[i]);
      this.flags.freeRoute = false;
      this.phase = 'map';
      this._emit();
    }
  }

  CG.Run = Run;
})(window.CG);

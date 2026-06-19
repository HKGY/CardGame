window.CG = window.CG || {};

/* ===========================================================================
 *  Run —— 一次“爬塔”的持久状态：血量 / 金币 / 牌组 / 宝石背包 / 地图与进度。
 * ===========================================================================
 *  战斗 Game 由 Run 提供 { deck, hp, maxHp } 实例化，结束后调用 finishBattle 回收结果。
 *  地图是分行的分支图：每个节点有 type 和指向下一行若干节点的 next[]。
 *  已去掉篝火（休息）：商店出现更频繁、且 Boss 前一行恒为商店，并承担回血/打理宝石职能。
 *  phase: 'map' | 'battle' | 'reward' | 'shop' | 'event' | 'dead' | 'victory'
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
  function pickEnemy(tier, act) {                                     // 按当前层筛选敌人池
    const pool = CG.ENEMY_POOLS[tier].filter(id => (CG.ENEMIES[id].acts || [1, 2, 3]).includes(act));
    return pick(pool.length ? pool : CG.ENEMY_POOLS[tier]);
  }
  function pickEncounter(tier, act) {                                 // 一场战斗的敌人组（数量按 encounter 权重）
    const w = (C().encounter && C().encounter[tier] && C().encounter[tier][act]) || [[1, 1]];
    const n = Math.max(1, weighted(w));
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(pickEnemy(tier, act));
    return ids;
  }

  // 事件祭坛 —— 全部围绕宝石系统
  CG.ALTARS = {
    setting: { name: '镶嵌祭坛', icon: '💠', desc: '把背包里的一颗宝石免费镶嵌进一张卡的空孔。' },
    purify:  { name: '净化祭坛', icon: '🧼', desc: '移除一颗宝石上的一个减益词条。' },
    bore:    { name: '拓孔祭坛', icon: '🔩', desc: '为一张卡增加一个孔位（上限 5）。' },
    findgem: { name: '寻宝祭坛', icon: '🔍', desc: '获得一颗随机宝石（放入背包）。' },
    recut:   { name: '重铸祭坛', icon: '♻️', desc: '重掷一颗宝石的全部词条（数量不变）。' },
  };
  CG.ALTAR_IDS = ['setting', 'purify', 'bore', 'findgem', 'recut'];

  // ---------- 地图生成（《以撒的结合》式房间布局）----------
  //  和以撒一样：从中心起点出发，随机往四邻扩展房间（新房间最多只贴 1 个已有房间，
  //  避免连成块/环 → 得到一棵带许多死路的房间树）。死路用来安放特殊房：
  //   首领房👑（最远死路，清掉即下一层）、宝藏房🎁（送遗物）、诅咒房🩸（耗血进入换更多遗物）、
  //   商店🛒、小boss房👹（精英）。其余为普通房（按概率藏敌人）。相邻房间即有门相连。
  let _rid = 0;
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  const ADJ = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function genIsaacFloor(act) {
    const m = C().map, W = m.gridW, H = m.gridH;
    const target = ri(m.rooms[0], m.rooms[1]);
    const key = (x, y) => x + ',' + y;
    const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    let cells, rooms;
    for (let attempt = 0; attempt < 40; attempt++) {     // 失败重试，直到房间数达标
      cells = {}; rooms = [];
      const add = (x, y, type) => { const r = { id: _rid++, gx: x, gy: y, type, done: false, combat: false }; cells[key(x, y)] = r; rooms.push(r); return r; };
      const filled = (x, y) => ADJ.reduce((n, d) => n + (cells[key(x + d[0], y + d[1])] ? 1 : 0), 0);
      add(W >> 1, H >> 1, 'start');                       // 起点居中
      let guard = 0;
      while (rooms.length < target && guard++ < 800) {
        const base = rooms[Math.floor(Math.random() * rooms.length)];
        const spot = shuffle(ADJ.map(d => [base.gx + d[0], base.gy + d[1]]))
          .find(([x, y]) => inb(x, y) && !cells[key(x, y)] && filled(x, y) <= 1);
        if (spot) add(spot[0], spot[1], 'normal');
      }
      if (rooms.length >= m.minRooms) break;
    }
    const start = rooms[0];
    // BFS 距离（用于把首领放在最远死路）
    const dist = new Map([[start, 0]]); const q = [start];
    const nb = r => rooms.filter(o => Math.abs(o.gx - r.gx) + Math.abs(o.gy - r.gy) === 1);
    while (q.length) { const c = q.shift(); for (const n of nb(c)) if (!dist.has(n)) { dist.set(n, dist.get(c) + 1); q.push(n); } }
    const others = rooms.filter(r => r !== start);
    const deadEnds = others.filter(r => nb(r).length === 1).sort((a, b) => dist.get(b) - dist.get(a));
    const rest = others.filter(r => nb(r).length > 1);
    const queue = deadEnds.concat(shuffle(rest));         // 优先占用死路，不够再用通路房
    const assign = type => { const r = queue.shift(); if (r) r.type = type; return r; };
    const boss = assign('boss');                          // 最远死路 = 首领
    ['treasure', 'shop', 'curse', 'elite'].forEach(assign);
    // 其余普通房：按概率藏敌人
    rooms.forEach(r => { if (r.type === 'normal') r.combat = Math.random() < m.normalEnemyChance; });
    // 裁掉空白边框 → 紧凑棋盘
    const xs = rooms.map(r => r.gx), ys = rooms.map(r => r.gy);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    rooms.forEach(r => { r.gx -= minX; r.gy -= minY; });
    const cols = Math.max(...rooms.map(r => r.gx)) + 1, rows = Math.max(...rooms.map(r => r.gy)) + 1;
    return { type: 'isaac', cols, rows, rooms, entrance: start, boss };
  }

  // ---------- 奖励 / 商店 ----------
  function rollGold(tier, act) { const [lo, hi] = C().gold[tier]; return Math.round(ri(lo, hi) * (C().goldMult[act] || 1)); }

  // 一张空法杖奖励（真实卡对象，价值在于孔位）：按档位决定孔位数
  function rollCardReward(tier) {
    const base = pick(['strike', 'defend']);
    const limit = Math.max(1, weighted((C().cardLimitW && C().cardLimitW[tier]) || [[1, 1]]));
    return CG.makeCard(base, limit, []);
  }
  // 商店货架：宝石 + 法杖 + 塔罗
  function rollShopStock(mult, run) {
    mult = mult || 1;
    const gems = [];
    for (let i = 0; i < C().shop.gemCount; i++) {
      const g = CG.rollGem({ tier: i === C().shop.gemCount - 1 ? 'elite' : 'monster', minLevel: run.forgeMinLevel() });
      gems.push({ gem: g, price: Math.floor(CG.gemPrice(g) * mult), bought: false });
    }
    const cards = [];
    for (let i = 0; i < C().shop.cardCount; i++) {
      const base = pick(['strike', 'defend']);
      const limit = i === 0 ? 1 : weighted([[2, 3], [3, 2]]);     // 一张单孔 + 一张多孔法杖
      const probe = CG.makeCard(base, limit, []);
      cards.push({ base, limit, gems: [], price: Math.floor(CG.cardPrice(probe) * mult), bought: false });
    }
    const tarot = [];
    for (let i = 0; i < C().shop.tarotCount; i++)
      tarot.push({ id: pick(CG.TAROT_IDS), price: Math.floor(C().shop.tarotPrice * mult), bought: false });
    return { gems, cards, tarot };
  }

  class Run {
    constructor(cls) {
      this.listeners = [];
      this.cls = CG.CLASSES[cls] ? cls : 'warrior';
      this.maxHp = C().startHp;
      this.hp = this.maxHp;
      this.gold = C().startGold;
      this.act = 1;                            // 当前层（决定敌人池 / 数值膨胀 / 场景 / 进度）
      this.maxActs = C().acts;
      this.tarot = [];                         // 消耗品栏（塔罗牌）
      this.gems = [];                          // 宝石背包（未镶嵌）
      this.relics = [];                        // 遗物
      this.overheal = 0;                       // 人寿保险的过量治疗池
      this.flags = {};                         // 各种延迟生效的旗标
      this.removeCount = 0;                    // 商店删牌次数（涨价用）
      this.uninstallCount = 0;                 // 商店卸宝石次数（涨价用）
      this.current = null;
      this.pending = null;                     // 暂存：本场战斗信息 / 奖励 / 商店货架
      this.phase = 'map';
      this._newFloor();                        // 先生成地图：同种子下地图最先确定，不受职业牌组随机影响
      this.deck = CG.buildDeck(this.cls);      // 按职业构建初始牌组
    }

    // 生成当前层的以撒式房间布局；玩家从起点出发。
    _newFloor() {
      this.grid = genIsaacFloor(this.act);
      this.current = this.grid.entrance;
      this.current.done = true;                // 玩家从起点出发
      this.flags.freeRoute = false;            // 倒吊人的「无视门路」不跨层延续
      this._recomputeAvailable();
    }
    // 当前房间有门相连（正交相邻）的房间；含已清房间以便折返。
    _neighbors(room) {
      return this.grid.rooms.filter(r => r !== room && Math.abs(r.gx - room.gx) + Math.abs(r.gy - room.gy) === 1);
    }
    _recomputeAvailable() {
      if (this.flags.freeRoute) { this.flags.freeRoute = false; this.available = this.grid.rooms.filter(r => r !== this.current && !r.done); }
      else this.available = this._neighbors(this.current);
    }
    roomById(id) { return this.grid.rooms.find(r => r.id === id) || null; }

    onChange(fn) { this.listeners.push(fn); return this; }
    _emit() { this.listeners.forEach(fn => fn(this)); }
    isAvailable(node) { return this.available.includes(node); }

    // ---- 遗物 ----
    hasRelic(id) { return this.relics.includes(id); }
    addRelic(id) {
      if (this.hasRelic(id)) return false;
      this.relics.push(id);
      if (CG.RELICS[id].onPickup) CG.RELICS[id].onPickup(this);
      return true;
    }
    _dropRelics(n) {                            // 掉落 n 个未拥有的遗物
      const out = [], pool = CG.RELIC_IDS.filter(id => !this.hasRelic(id));
      for (let i = 0; i < n && pool.length; i++) {
        const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        this.addRelic(id); out.push(id);
      }
      return out;
    }
    forgeMinLevel() { return this.relics.some(id => CG.RELICS[id].forgeMin >= 2) ? 2 : 1; }   // 幸运脚：宝石词条最低 2 级
    canGainTarot() { return !this.relics.some(id => CG.RELICS[id].noTarot); }                  // 无神论者
    shopMult() { return this.relics.some(id => CG.RELICS[id].shopHalf) ? 0.5 : 1; }            // Steam 促销
    tarotSlots() { return C().tarot.slots + this.relics.reduce((s, id) => s + (CG.RELICS[id].tarotSlot || 0), 0); }  // 肚脐：消耗品栏 +1
    healCost() { return Math.floor(C().shop.healPrice * this.shopMult()); }
    gainHp(n) {                                 // 治疗入口；人寿保险可过量储存
      if (this.relics.some(id => CG.RELICS[id].overheal)) {
        this.hp += n;
        if (this.hp > this.maxHp) { this.overheal += this.hp - this.maxHp; this.hp = this.maxHp; }
      } else this.hp = Math.min(this.maxHp, this.hp + n);
    }

    // ---- 宝石背包 / 镶嵌（安装免费） ----
    allGems() {                                 // 全部宝石（背包 + 已镶嵌），带位置信息
      const out = this.gems.map(g => ({ gem: g, uid: g.uid, loc: 'inv', label: '背包' }));
      this.deck.forEach(c => (c.sockets || []).forEach((g, si) =>
        out.push({ gem: g, uid: g.uid, loc: 'card', card: c, idx: si, label: CG.BASE_CARDS[c.base].name })));
      return out;
    }
    findGem(uid) { return this.allGems().find(x => x.uid === uid) || null; }
    cardsWithEmptySocket() { return this.deck.filter(c => CG.cardEmptySockets(c) > 0); }
    _doInstall(gemUid, cardUid) {
      const gi = this.gems.findIndex(g => g.uid === gemUid);
      const card = this.deck.find(c => c.uid === cardUid);
      if (gi < 0 || !card || CG.cardEmptySockets(card) <= 0) return false;
      CG.installGem(card, this.gems.splice(gi, 1)[0]);
      return true;
    }
    installGemInv(gemUid, cardUid) { if (this._doInstall(gemUid, cardUid)) this._emit(); }   // 工作台：免费、留在原界面

    // 玩家走进一个相邻房间（WASD / 点击）：未清的内容房 → 触发；其余（起点/空房/已清）→ 走过去。
    selectNode(node) {
      if (!this.isAvailable(node)) return;
      this.current = node;
      const t = node.type;
      if (!node.done) {
        if (t === 'boss' || t === 'elite' || (t === 'normal' && node.combat)) return this._enterBattle(t);
        if (t === 'shop')     return this._enterShop();
        if (t === 'treasure') return this._enterTreasure();
        if (t === 'curse')    return this._enterCurse();
      }
      node.done = true;                        // 起点 / 空房 / 折返已清房：仅移动
      this._recomputeAvailable();
      this._emit();
    }
    _enterBattle(roomType) {
      const tier = roomType === 'normal' ? 'monster' : roomType;   // 经济/奖励档（config 用 monster/elite/boss）
      this.pending = { tier, enemyIds: pickEncounter(roomType, this.act) };  // 敌人池档用房间类型(normal/elite/boss)
      this.phase = 'battle';
      this._emit();
    }
    _curseCost() { return Math.max(C().curse.minHpCost, Math.floor(this.maxHp * C().curse.hpCostPct)); }
    // 宝藏房：免费得 1 件遗物（集齐则折算金币）。
    _enterTreasure() {
      const got = this._dropRelics(1), gold = got.length ? 0 : 60;
      if (gold) this.gold += gold;
      this.pending = { kind: 'treasure', relics: got, gold };
      this.phase = 'event';
      this._emit();
    }
    // 诅咒房：进入即耗血，换取 2 件遗物（集齐则折算金币）。
    _enterCurse() {
      const before = this.hp;
      this.hp = Math.max(1, this.hp - this._curseCost());
      const got = this._dropRelics(2), gold = got.length ? 0 : 110;
      if (gold) this.gold += gold;
      this.pending = { kind: 'curse', relics: got, hpPaid: before - this.hp, gold };
      this.phase = 'event';
      this._emit();
    }
    _enterShop() {
      this.pending = rollShopStock(this.shopMult(), this);
      const avail = CG.RELIC_IDS.filter(id => !this.hasRelic(id));   // 商店遗物（未拥有）
      this.pending.relics = [];
      for (let i = 0; i < C().relic.shopCount && avail.length; i++) {
        const id = avail.splice(Math.floor(Math.random() * avail.length), 1)[0];
        this.pending.relics.push({ id, price: Math.floor(C().relic.shopPrice * this.shopMult()), bought: false });
      }
      if (this.flags.freeShopCard && this.pending.gems[0]) {   // 隐士：首件商品免费（改作首颗宝石）
        this.pending.gems[0].price = 0;
        this.flags.freeShopCard = false;
      }
      this.phase = 'shop';
      this._emit();
    }
    // ---- 事件祭坛（宝石操作；现仅由「世界」塔罗触发，地图不再生成祭坛房）----
    altarUsable(id) {
      if (id === 'findgem') return true;
      if (id === 'setting') return this.gems.length > 0 && this.cardsWithEmptySocket().length > 0;
      if (id === 'purify')  return this.allGems().some(x => CG.gemHasDebuff(x.gem));
      if (id === 'bore')    return this.deck.some(c => (c.limit || 0) < CG.MAX_SOCKETS);
      if (id === 'recut')   return this.allGems().length > 0;
      return true;
    }
    altarInstall(gemUid, cardUid) { this._doInstall(gemUid, cardUid); this._advance(); }
    altarPurify(gemUid)  { const f = this.findGem(gemUid); if (f) CG.gemRemoveOneDebuff(f.gem); this._advance(); }
    altarBore(cardUid)   { const c = this.deck.find(x => x.uid === cardUid); if (c) CG.addSocket(c); this._advance(); }
    altarFindGem()       { this.gems.push(CG.rollGem({ tier: 'monster', minLevel: this.forgeMinLevel() })); this._advance(); }
    altarRecut(gemUid)   { const f = this.findGem(gemUid); if (f) CG.recutGem(f.gem); this._advance(); }
    leaveEvent() { this._advance(); }

    // 战斗结束回收：win + 剩余血量
    finishBattle(win, remainingHp) {
      this.hp = Math.max(0, remainingHp);
      if (!win || this.hp <= 0) { this.phase = 'dead'; this._emit(); return; }
      const tier = (this.pending && this.pending.tier) || 'monster';   // 经济档：monster | elite | boss
      if (tier === 'boss') this.hp = this.maxHp;          // 每场 Boss 战后回满
      // 金币（含存钱罐）
      let earned = rollGold(tier, this.act);
      this.relics.forEach(id => { if (CG.RELICS[id].afterGold) earned += CG.RELICS[id].afterGold; });
      this.gold += earned;
      // 遗物掉落：精英 1、首领 2(+白色郁金香)
      let dropped = [];
      if (tier === 'elite') dropped = this._dropRelics(C().relic.elite);
      else if (tier === 'boss') { dropped = this._dropRelics(C().relic.boss + (this.flags.bonusBossRelics || 0)); this.flags.bonusBossRelics = 0; }
      // 塔罗掉落：无神论者不掉、牌盒必掉
      let tarotId = null;
      if (this.canGainTarot()) {
        const guaranteed = this.relics.some(id => CG.RELICS[id].guaranteedTarot);
        if (guaranteed || Math.random() < (C().tarot.chance[tier] || 0)) tarotId = pick(CG.TAROT_IDS);
      }
      // 群星：本次额外获得一颗宝石（进背包）
      if (this.flags.rewardBonusGem) { this.flags.rewardBonusGem = false; this.gems.push(CG.rollGem({ tier: tier === 'monster' ? 'monster' : tier, minLevel: this.forgeMinLevel() })); }
      // 世界：卡牌奖励替换为随机宝石事件（金币/遗物照常）
      if (this.flags.rewardAsAltar) {
        this.flags.rewardAsAltar = false;
        const valid = CG.ALTAR_IDS.filter(id => this.altarUsable(id));
        this.pending = { altar: pick(valid.length ? valid : ['findgem']), relics: dropped };
        this.phase = 'event'; this._emit(); return;
      }
      // 奖励：宝石（三选一进背包）或 空法杖（三选一进牌组）
      const gemTier = tier === 'monster' ? 'monster' : tier;
      const gemReward = tier === 'boss' || Math.random() < (C().rewardGemChance[tier] || 0.65);
      const gems = gemReward ? Array.from({ length: C().reward.count }, () => CG.rollGem({ tier: gemTier, minLevel: this.forgeMinLevel() })) : null;
      const cards = gemReward ? null : Array.from({ length: C().reward.count }, () => rollCardReward(tier));
      this.pending = { kind: gemReward ? 'gem' : 'card', gold: earned, gems, cards, tarot: tarotId, tarotTaken: false, relics: dropped };
      this.phase = 'reward';
      this._emit();
    }

    chooseReward(spec) {                                  // spec=null 表示跳过
      if (spec) {
        if (spec.base) this.deck.push(spec);   // 法杖（真实卡对象）
        else this.gems.push(spec);             // 宝石
      }
      this.pending = null;
      this._advance();
    }

    takeTarot() {                                         // 把奖励塔罗收入消耗品栏
      const p = this.pending;
      if (!p || !p.tarot || p.tarotTaken || this.tarot.length >= this.tarotSlots()) return;
      this.tarot.push(p.tarot);
      p.tarotTaken = true;
      this._emit();
    }

    // ---- 商店（一切皆需花钱；安装免费走工作台）----
    buyGem(i) {
      const it = this.pending.gems[i];
      if (!it || it.bought || this.gold < it.price) return;
      this.gold -= it.price; it.bought = true; this.gems.push(it.gem); this._emit();
    }
    buyCard(i) {
      const it = this.pending.cards[i];
      if (!it || it.bought || this.gold < it.price) return;
      this.gold -= it.price; it.bought = true; this.deck.push(CG.makeCard(it.base, it.limit, it.gems || [])); this._emit();
    }
    buyTarot(i) {
      if (!this.canGainTarot()) return;
      const it = this.pending.tarot[i];
      if (!it || it.bought || this.gold < it.price || this.tarot.length >= this.tarotSlots()) return;
      this.gold -= it.price; it.bought = true; this.tarot.push(it.id); this._emit();
    }
    buyRelic(i) {
      const it = this.pending.relics[i];
      if (!it || it.bought || this.gold < it.price || this.hasRelic(it.id)) return;
      this.gold -= it.price; it.bought = true; this.addRelic(it.id); this._emit();
    }
    // 商店服务：治疗（每店一次）
    svcUsed(k) { return !!(this.pending && this.pending.usedSvc && this.pending.usedSvc[k]); }
    _markSvc(k) { if (this.pending) { this.pending.usedSvc = this.pending.usedSvc || {}; this.pending.usedSvc[k] = true; } }
    buyHeal() {
      const price = this.healCost();
      if (this.svcUsed('heal') || this.gold < price || this.hp >= this.maxHp) return;
      this.gold -= price; this.gainHp(Math.ceil(this.maxHp * C().shop.healPct)); this._markSvc('heal'); this._emit();
    }
    // 删卡：可重复、价格逐次永久提高
    removePrice() { return Math.floor((C().shop.removeBase + C().shop.removeStep * (this.removeCount || 0)) * this.shopMult()); }
    buyRemove(uid) {
      if (this.gold < this.removePrice() || this.deck.length <= 1) return;
      this.gold -= this.removePrice();
      this.removeCount = (this.removeCount || 0) + 1;
      const card = this.deck.find(c => c.uid === uid);
      if (card) (card.sockets || []).forEach(g => this.gems.push(g));   // 拆下的宝石不浪费：回收进背包（无 debuff）
      this.deck = this.deck.filter(c => c.uid !== uid);
      this._emit();
    }
    // 卸下宝石：花钱 + 该宝石随机加一个 debuff（可重复、逐次涨价）
    uninstallPrice() { return Math.floor((C().shop.uninstallBase + C().shop.uninstallStep * (this.uninstallCount || 0)) * this.shopMult()); }
    buyUninstall(cardUid, idx) {
      const card = this.deck.find(c => c.uid === cardUid);
      if (this.gold < this.uninstallPrice() || !card || !(card.sockets || [])[idx]) return;
      this.gold -= this.uninstallPrice();
      this.uninstallCount = (this.uninstallCount || 0) + 1;
      this.gems.push(CG.uninstallGem(card, idx));     // 取出宝石并随机加 debuff
      this._emit();
    }
    // 加孔：给一张卡 +1 孔位（每次定价）
    socketPrice() { return Math.floor(C().shop.socketPrice * this.shopMult()); }
    buyAddSocket(uid) {
      const card = this.deck.find(c => c.uid === uid);
      if (this.gold < this.socketPrice() || !card || (card.limit || 0) >= CG.MAX_SOCKETS) return;
      this.gold -= this.socketPrice(); CG.addSocket(card); this._emit();
    }
    leaveShop() { this.pending = null; this._advance(); }

    // ---- 塔罗牌触发的跑图效果 ----
    fillTarot() { if (!this.canGainTarot()) return; while (this.tarot.length < this.tarotSlots()) this.tarot.push(pick(CG.TAROT_IDS)); }
    gainGem(opts) { this.gems.push(CG.rollGem(opts || { tier: 'elite', minLevel: this.forgeMinLevel() })); }   // 节制·逆等可调用
    gotoActBoss() {                                       // 皇帝：直达本层首领并开战
      const boss = this.grid.rooms.find(r => r.type === 'boss');
      if (!boss) return;
      this.current = boss;
      this._enterBattle('boss');
    }
    teleportRandom() {                                    // 月亮：传送到本层一个随机未清的内容房间并触发
      const isContent = r => r.type === 'shop' || r.type === 'treasure' || r.type === 'curse' || r.type === 'elite' || (r.type === 'normal' && r.combat);
      const all = this.grid.rooms.filter(n => !n.done && n !== this.current && isContent(n));
      if (!all.length) return;
      const node = all[Math.floor(Math.random() * all.length)];
      this.available = [node];
      this.selectNode(node);
    }
    freeRoute() {                                         // 倒吊人：无视门路，本层任选未清房间
      this.flags.freeRoute = true;
      if (this.phase === 'map') { this._recomputeAvailable(); this._emit(); }
    }

    // 结算当前房间内容（战斗胜利 / 逛完商店 / 取完宝藏 / 用完祭坛）后，回到地图。
    _advance() {
      const room = this.current;
      room.done = true;
      if (room.type === 'boss') return this._nextAct();   // 首领 -> 下一层 / 通关
      this._recomputeAvailable();
      this.phase = 'map';
      this._emit();
    }
    // 击败首领：进入下一层（act+1，重新生成布局），或全部通关。
    _nextAct() {
      if (this.act < this.maxActs) { this.act++; this._newFloor(); this.phase = 'map'; this._emit(); return; }
      this.phase = 'victory'; this._emit();
    }
  }

  CG.Run = Run;
})(window.CG);

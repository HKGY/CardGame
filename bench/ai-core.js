'use strict';
/* ===========================================================================
 *  搜索型智能核心 AI（M2）—— 用引擎本身前向模拟候选出牌，按 value.V 打分择优。
 * ===========================================================================
 *  战斗：每步克隆战斗、在克隆上真实 playCard（+自动结算做菜/选牌），用 V 评分，
 *        回滚随机后选最佳；无提升则结束回合（含「不变差就过牌」的周转）。
 *  经济：宝石按 value.gemValue × installFit 安装 / 取舍；商店按性价比花钱。
 *  扩展：各包策略经 value.registerPack 注入；未注册的包自动走通用估值。
 *  make(CG, rng)：rng 来自 loader（可快照），用于模拟时回滚随机流。
 * ========================================================================= */
const value = require('./value');

// ---------- 战斗状态克隆（仅深拷可变部分，静态引用共享）----------
function cloneAffixes(a) { return (a || []).map(x => ({ id: x.id, level: x.level })); }
function cloneCard(c) {
  const n = {}; for (const k in c) n[k] = c[k];                 // uid/base/limit + 瞬态(growth/plays/heldTurns/heldBonus/holdCost/costDown/awakened)
  n.sockets = (c.sockets || []).map(g => ({ uid: g.uid, affixes: cloneAffixes(g.affixes) }));
  if (c.meal) n.meal = { effects: (c.meal.effects || []).map(e => Object.assign({}, e)), repeatTimes: c.meal.repeatTimes, value: c.meal.value, name: c.meal.name, desc: c.meal.desc };
  return n;
}
function cloneEntity(e) {
  const n = {}; for (const k in e) n[k] = e[k];                 // def/name/maxHp/dmgScale/intent/alive/hp/block/energy/maxEnergy/power
  n.statuses = Object.assign({}, e.statuses);
  if (e.history) n.history = e.history.slice();
  return n;
}
function cloneGame(CG, g) {
  const c = Object.create(CG.Game.prototype);
  for (const k in g) c[k] = g[k];                              // 标量 + 共享引用(relics/_deck/tier/tarot...)
  c.listeners = []; c.eventListeners = []; c.log = (g.log || []).slice();
  c.player = cloneEntity(g.player);
  c.enemies = g.enemies.map(cloneEntity);
  c.enemy = c.enemies[g.target] || c.enemies[0] || g.enemy;
  c.hand = g.hand.map(cloneCard);
  c.drawPile = g.drawPile.map(cloneCard);
  c.discardPile = g.discardPile.map(cloneCard);
  c.exhaustPile = g.exhaustPile.map(cloneCard);
  if (g.allies) c.allies = g.allies.map(a => Object.assign({}, a));         // 召唤包：召唤物（可变）必须深拷，否则搜索克隆会污染真实战斗
  if (g.buildings) c.buildings = g.buildings.map(b => Object.assign({}, b)); // 建造包：建筑同理
  c._turnPlays = Object.assign({}, g._turnPlays);
  c._pickQueue = (g._pickQueue || []).slice();
  c.pick = g.pick ? Object.assign({}, g.pick) : null;
  c.craft = g.craft ? Object.assign({}, g.craft) : null;
  c.run = g.run ? { gold: g.run.gold, overheal: g.run.overheal, flags: Object.assign({}, g.run.flags), relics: g.run.relics } : null;
  return c;
}

function make(CG, rng, opts) {
  opts = opts || {};
  const SEARCH = opts.search || 'rollout';      // 'rollout'=多步（默认）| 'greedy'=单步（对照）
  const LOOK = opts.lookahead != null ? opts.lookahead : ((typeof process !== 'undefined' && process.env.LOOKAHEAD != null) ? +process.env.LOOKAHEAD : 0);   // 两回合前瞻折现权重：实测净负（过奖延迟态）→ 默认关，保留可调
  let TELE = null, PACKS = null;
  const EPS = 0.4;

  // ---- 做菜 / 选牌策略（克隆评估与真实结算共用；各包可覆盖）----
  function doCraftOn(g) {
    for (const h of value.hooksFor(PACKS)) if (h.craft) {
      const sel = h.craft(CG, g);
      if (sel) { g.craftChoose(sel.meatUid != null ? sel.meatUid : null); g.craftChoose(sel.seasonUid != null ? sel.seasonUid : null); return; }
    }
    let cands = g.craftCandidates();                            // 荤菜：取最高级
    const meat = cands.length ? cands.slice().sort((a, b) => (CG.BASE_CARDS[b.base].level || 0) - (CG.BASE_CARDS[a.base].level || 0))[0] : null;
    g.craftChoose(meat ? meat.uid : null);
    cands = g.craftCandidates();                                // 调料：盐 > 胡椒 > 酱油
    const rank = { salt: 3, pepper: 2, soy: 1 };
    const sea = cands.length ? cands.slice().sort((a, b) => (rank[CG.BASE_CARDS[b.base].season] || 0) - (rank[CG.BASE_CARDS[a.base].season] || 0))[0] : null;
    g.craftChoose(sea ? sea.uid : null);
  }
  function cardWorth(c) { const s = CG.cardStats(c); let w = s.value + (s.effects ? s.effects.length : 0); if (s.nirvana) w += 8; if (s.undying) w += 6; return w; }
  function doPickOn(g) {
    const t = g.pick.type;
    for (const h of value.hooksFor(PACKS)) if (h.pick) { const uid = h.pick(CG, g, t); if (uid !== undefined) { g.pickResolve(uid); return; } }
    if (t === 'burn') { const c = g.hand.slice().sort((a, b) => cardWorth(a) - cardWorth(b))[0]; g.pickResolve(c ? c.uid : null); }
    else { const c = g.exhaustPile.slice().sort((a, b) => cardWorth(b) - cardWorth(a))[0]; g.pickResolve(c ? c.uid : null); }
  }
  function resolvePrompts(g) { let n = 0; while ((g.craft || g.pick) && n++ < 10) { if (g.craft) doCraftOn(g); else doPickOn(g); } }

  // 一张「跑图牌组里的牌」的价值（删牌瘦组用）：原始产出折半 + 各宝石价值。起手强牌 ≈7 > 阈值不会被删。
  function cardDeckWorth(c) {
    const s = CG.cardStats(c); let w = (s.value || 0) * 0.5;
    for (const g of (c.sockets || [])) w += value.gemValue(CG, g, { run: null, packs: PACKS });
    return w;
  }
  // ---- 塔罗（消耗品）使用：审计改进①——原 bench 只收集从不使用 → 现按 ΔV 阈值在战斗/地图打出 ----
  const tarotUI = { pickCard: (cards, cb) => cb(cards && cards[0] ? cards[0].uid : null), choose: (opts, cb) => cb(0) };
  function applyTarotEffect(run, game, id) { const t = CG.TAROT[id]; if (!t) return false; try { t.apply(run, game, tarotUI); return true; } catch (e) { return false; } }
  function consumeTarot(run, id) { const i = run.tarot ? run.tarot.indexOf(id) : -1; if (i >= 0) run.tarot.splice(i, 1); }
  function tryBattleTarots(game, run) {
    if (!run || !run.tarot || !run.tarot.length) return;
    let guard = 0, acted = true;
    while (acted && guard++ < 8) {
      acted = false;
      const Vnow = value.V(CG, game, PACKS);
      let bestId = null, bestV = Vnow + 25; const seen = {};   // 阈值：明显改善才用（别浪费一次性消耗品）
      for (const id of run.tarot) {
        if (seen[id]) continue; seen[id] = 1;
        const t = CG.TAROT[id]; if (!t || t.async || (t.where !== 'battle' && t.where !== 'any')) continue;
        const r0 = rng.get(); const sim = cloneGame(CG, game);
        applyTarotEffect(sim.run || run, sim, id);
        const v = value.V(CG, sim, PACKS); rng.set(r0);
        if (v > bestV) { bestV = v; bestId = id; }
      }
      if (bestId) { const r0 = rng.get(); applyTarotEffect(run, game, bestId); rng.set(r0); consumeTarot(run, bestId); acted = true; if (TELE) TELE.tarot = (TELE.tarot || 0) + 1; }
    }
  }
  function tryMapTarots(run) {
    if (!run.tarot || !run.tarot.length) return;
    for (const id of run.tarot.slice()) {
      const ok = (id === 't_maxhp' || id === 't_gold' || id === 'star') || (id === 't_heal' && run.hp < run.maxHp * 0.7);
      if (ok && applyTarotEffect(run, null, id)) { consumeTarot(run, id); if (TELE) TELE.tarot = (TELE.tarot || 0) + 1; }
    }
  }
  // 审计改进④——两回合前瞻：把「打完本回合 + 敌人回合」后的局面也计入评分（奖励产出/铺场/再生等延迟收益）。
  function lookahead(sim) {
    const r0 = rng.get(); const c = cloneGame(CG, sim);
    try { if (c.phase === 'player') { c.endTurn(); if (c.phase === 'enemy') c.runEnemyTurn(); } } catch (e) {}
    const v = value.V(CG, c, PACKS); rng.set(r0); return v;
  }

  // ---- 出牌可行性 ----
  function isPlayable(game, c, idx, s) {
    if (s.noPlay) return false;
    if (idx < (game._paralyze || 0)) return false;
    const oc = s.overclock || 0;
    if (oc) return (game.player.power || 0) >= s.cost * oc;
    return ((game.freeCards || 0) > 0 ? 0 : s.cost) <= game.player.energy;
  }

  // ---- 候选枚举：返回本手可打的 [{uid,target,cantrip}]（伤害类牌枚举至多 3 个目标）----
  function candidates(game) {
    const aliveIdx = game.enemies.map((e, i) => (e.alive && e.hp > 0) ? i : -1).filter(i => i >= 0);
    const out = [];
    game.hand.forEach((c, idx) => {
      const s = CG.cardStats(c, { valueMult: game.cardValueMult });
      if (!isPlayable(game, c, idx, s)) return;
      const hitsEnemy = s.kind === 'damage' || s.pierce || s.element || s.execute || s.devote || s.annihilate ||
        s.dice || s.coin || s.jackpot || s.slots || s.backfire || (s.effects || []).some(e => e.type === 'damage' || e.type === 'poison' || e.type === 'vulnerable' || e.type === 'weak' || e.type === 'frail' || e.type === 'enemyStat' || e.type === 'silence');
      const targets = hitsEnemy ? aliveIdx.slice(0, 3) : [(game.target >= 0 ? game.target : (aliveIdx[0] != null ? aliveIdx[0] : 0))];
      const cantrip = s.cost === 0 || s.freeNext > 0 || (s.effects || []).some(e => e.type === 'draw' || e.type === 'energy' || e.type === 'gainPower');
      // 审计改进②——「铺垫型」标记：条件代价/元素/造牌/召唤/建筑/产出/抽能 等即时分可能为负的连招启动牌。
      const setup = !!((s.condBonus && s.condBonus.length) || s.element || s.gainPower || s.conjure ||
        (s.effects || []).some(e => e.type === 'draw' || e.type === 'energy' || e.type === 'summon' || e.type === 'build' || e.type === 'gainPower' || (e.type === 'selfStatus' && /^prod/.test(e.status || ''))));
      for (const t of targets) out.push({ uid: c.uid, target: t, cantrip, setup });
    });
    return out;
  }
  // 在克隆上模拟打出 (uid,target) 并结算做菜/选牌浮层，返回 { sim, v=局面分 }。调用方负责 RNG 存还。
  function evalPlay(game, uid, target, packs) {
    const sim = cloneGame(CG, game);
    if (target >= 0 && sim.enemies[target] && sim.enemies[target].alive) { sim.target = target; sim.enemy = sim.enemies[target]; }
    sim.playCard(uid);
    resolvePrompts(sim);
    return { sim, v: value.V(CG, sim, packs) };
  }
  // 从候选里挑「打出后局面分最高」的单手（含不变差的周转牌）。不管 RNG。
  // 某候选牌的「按包出牌偏好」加分（playPolicy 钩子；无策略包时零成本跳过）。
  const POL = (typeof process !== 'undefined' && process.env.POL != null) ? +process.env.POL : 0;   // playPolicy 全局缩放：实测「手写覆盖搜索回合内选牌」单调净负 → 默认关；保留钩子与可调以便后续研究
  function polBonus(game, c, packs) {
    if (!value.hasPolicy(packs) || POL === 0) return 0;
    const card = game.hand.find(h => h.uid === c.uid);
    return card ? POL * value.playPolicyBonus(CG, game, card, CG.cardStats(card), packs) : 0;
  }
  function pickByImmediate(game, packs) {
    const Vnow = value.V(CG, game, packs);
    let best = null, bestV = Vnow + EPS, bestC = null, bestCV = Vnow - EPS;
    for (const c of candidates(game)) {
      const { v: v0 } = evalPlay(game, c.uid, c.target, packs);
      const v = v0 + polBonus(game, c, packs);             // 叠加按包出牌偏好
      if (v > bestV) { bestV = v; best = c; }
      else if (c.cantrip && v0 >= Vnow - EPS && v > bestCV) { bestCV = v; bestC = c; }
    }
    return best || bestC;
  }
  // 1-ply 贪心选手（SEARCH='greedy' 用）：即时分最优。
  function greedyBest(game, packs) {
    const r0 = rng.get();
    const best = pickByImmediate(game, packs);
    rng.set(r0);
    return best;
  }
  // 把（克隆的）game 这一回合用 1-ply 贪心打完，就地操作，返回回合末局面分（rollout 的 rollout 部分）。
  function greedyFinish(game, packs) {
    let steps = 0;
    while (game.phase === 'player' && steps++ < 40) {
      if (game.craft || game.pick) { resolvePrompts(game); continue; }
      const pick = pickByImmediate(game, packs);
      if (!pick) break;
      if (pick.target >= 0 && game.enemies[pick.target] && game.enemies[pick.target].alive) game.setTarget(pick.target);
      game.playCard(pick.uid);
    }
    return value.V(CG, game, packs);
  }
  // 多步搜索（rollout）：即时分预筛 topK 首手，各做「打出 + 贪心打完本回合」，按回合末局面分取最优首手。
  // 这样能发现「先打一张眼前无收益的铺垫牌，再爆发」这类单步贪心看不到的连招。
  function rolloutChoose(game, packs) {
    const r0 = rng.get();
    const Vnow = value.V(CG, game, packs);
    const scored = candidates(game).map(c => { const { v } = evalPlay(game, c.uid, c.target, packs); return { c, iv: v + polBonus(game, c, packs) }; });
    scored.sort((a, b) => b.iv - a.iv);
    // 审计改进②——不按即时分预剪枝：top-K ∪ 所有「铺垫型」候选（上限 9）一起 rollout，避免连招启动牌被剪掉。
    const K = Math.min(4, scored.length);
    const chosen = scored.slice(0, K);
    for (let i = K; i < scored.length && chosen.length < 9; i++) if (scored[i].c.setup) chosen.push(scored[i]);
    let best = null, bestScore = -Infinity, anyGood = false;
    for (const s of chosen) {
      const c = s.c;
      const sim = cloneGame(CG, game);
      if (c.target >= 0 && sim.enemies[c.target] && sim.enemies[c.target].alive) { sim.target = c.target; sim.enemy = sim.enemies[c.target]; }
      sim.playCard(c.uid); resolvePrompts(sim);
      const endV = greedyFinish(sim, packs);                 // 本回合打完
      if (endV > Vnow + EPS) anyGood = true;
      const score = endV + LOOK * lookahead(sim) + polBonus(game, c, packs);   // 两回合前瞻(折现 LOOK) + 按包出牌偏好
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!anyGood) best = null;                                // 没有任何出牌改善本回合 → 结束回合（下方周转兜底）
    if (!best) for (const s of scored) if (s.c.cantrip && s.iv >= Vnow - EPS) { best = s.c; break; }   // 周转兜底
    rng.set(r0);
    return best;
  }

  function takeTurn(game, run) {
    const packs = run.packs;
    let steps = 0, cantrips = 0;
    tryBattleTarots(game, run);                          // 审计改进①——开局先看是否该用塔罗（铺场/抢杀/救命）
    while (game.phase === 'player') {
      if (game.craft || game.pick) { resolvePrompts(game); continue; }
      if (steps++ > 80) break;
      const best = SEARCH === 'greedy' ? greedyBest(game, packs) : rolloutChoose(game, packs);
      if (!best) {                                       // 无牌可打前再给塔罗一次机会（收尾补伤 / 救命 / 回能再打）
        const before = run && run.tarot ? run.tarot.length : 0;
        tryBattleTarots(game, run);
        if (run && run.tarot && run.tarot.length < before) continue;
        break;
      }
      if (best.cantrip && ++cantrips > 16) break;
      if (best.target >= 0 && game.enemies[best.target] && game.enemies[best.target].alive) game.setTarget(best.target);
      game.playCard(best.uid);
      if (TELE) TELE.plays++;
    }
  }

  // ---- 宝石安装（免费）：按 装上收益 = gemValue × installFit 贪心 ----
  function installAll(run) {
    let guard = 0;
    while (guard++ < 40) {
      const slots = run.deck.filter(c => CG.cardEmptySockets(c) > 0);
      if (!slots.length) break;
      let bg = null, bc = null, bs = 0;
      for (const g of run.gems) {
        const gv = value.gemValue(CG, g, { run, packs: PACKS });
        if (gv <= 0) continue;
        for (const c of slots) { const sc = gv * value.installFit(CG, g, c, { run, packs: PACKS }); if (sc > bs) { bs = sc; bg = g; bc = c; } }
      }
      if (!bg) break;
      run.installGemInv(bg.uid, bc.uid);
      if (TELE) TELE.installs++;
    }
  }

  // ---- 地图：先就近清掉本层内容房，再走向首领 ----
  const adj = (a, b) => Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) === 1;
  function dist(run, from, to) {
    if (from === to) return 0;
    const seen = new Set([from]), q = [[from, 0]];
    while (q.length) { const [r, d] = q.shift(); for (const n of run.grid.rooms) { if (seen.has(n) || !adj(r, n)) continue; if (n === to) return d + 1; seen.add(n); q.push([n, d + 1]); } }
    return Infinity;
  }
  const isContent = r => r.type === 'elite' || r.type === 'shop' || r.type === 'treasure' || r.type === 'altar' || r.type === 'curse' || (r.type === 'normal' && r.combat);
  function enterable(run, r) {
    if (r.type === 'curse') return run.hp - run._curseCost() > Math.max(10, run.maxHp * 0.25);
    if (r.type === 'elite') return run.hp > run.maxHp * 0.42;
    return true;
  }
  function map(run) {
    tryMapTarots(run);                                   // 审计改进①——地图上用「任意」型塔罗（治疗/加血/金币/群星）
    const a = run.available;
    if (!a.length) { run.phase = 'dead'; return; }
    const targets = run.grid.rooms.filter(r => !r.done && r !== run.current && r.type !== 'boss' && isContent(r) && enterable(run, r));
    let node;
    if (targets.length) {
      targets.sort((x, y) => dist(run, run.current, x) - dist(run, run.current, y));
      const t = targets[0];
      node = a.slice().sort((x, y) => dist(run, x, t) - dist(run, y, t))[0];
    } else {
      const boss = run.grid.boss;
      node = a.slice().sort((x, y) => dist(run, x, boss) - dist(run, y, boss))[0];
    }
    run.selectNode(node);
  }

  // ---- 奖励 / 商店 / 事件 ----
  function reward(run) {
    const p = run.pending;
    if (p.tarot && run.canGainTarot() && run.tarot.length < run.tarotSlots()) run.takeTarot();
    if (p.kind === 'gem') {
      const best = p.gems.slice().sort((a, b) => value.bestInstallScore(CG, b, run, PACKS) - value.bestInstallScore(CG, a, run, PACKS))[0];
      run.chooseReward(best || null);
    } else if (p.kind === 'card') {
      const surplus = run.gems.filter(g => value.gemValue(CG, g, { run, packs: PACKS }) > 0).length;
      const empty = run.deck.reduce((s, c) => s + CG.cardEmptySockets(c), 0);
      const want = surplus > empty || run.deck.length < 11;
      run.chooseReward(want ? p.cards.slice().sort((a, b) => (b.limit || 1) - (a.limit || 1))[0] : null);
    } else run.chooseReward(null);
    installAll(run);
  }
  function pickFromPack(run, i) {
    let guard = 0;
    while (guard++ < 6) {
      const it = run.pending.packs[i];
      if (!it || it.taken || !it.rolled) break;
      const taken = it.takenUids || [];
      const avail = it.rolled.filter(g => !taken.includes(g.uid));
      if (!avail.length) break;
      const best = avail.slice().sort((a, b) => value.bestInstallScore(CG, b, run, PACKS) - value.bestInstallScore(CG, a, run, PACKS))[0];
      run.takePackGem(i, best.uid);
    }
  }
  function shop(run) {
    const p = run.pending, reserve = 20;
    if (run.hp < run.maxHp * 0.45 && !run.svcUsed('heal') && run.gold >= run.healCost() + reserve) run.buyHeal();
    (p.gems || []).map((it, i) => ({ i, it, score: value.bestInstallScore(CG, it.gem, run, PACKS) }))
      .filter(x => !x.it.bought && x.score > 2)
      .sort((a, b) => (b.score / b.it.price) - (a.score / a.it.price))
      .forEach(x => { if (run.gold - x.it.price >= reserve) run.buyGem(x.i); });
    (p.packs || []).forEach((it, i) => { if (!it.bought && run.gold - it.price >= reserve + 10) { run.buyPack(i); pickFromPack(run, i); } });
    (p.relics || []).forEach((it, i) => { if (!it.bought && !run.hasRelic(it.id) && run.gold - it.price >= reserve) run.buyRelic(i); });
    let safety = 0;
    while (safety++ < 3) {
      const surplus = run.gems.filter(g => value.gemValue(CG, g, { run, packs: PACKS }) > 0).length;
      const empty = run.deck.reduce((s, c) => s + CG.cardEmptySockets(c), 0);
      if (surplus > empty && run.gold - run.socketPrice() >= reserve && run.deck.some(c => (c.limit || 0) < CG.MAX_SOCKETS)) {
        run.buyAddSocket(run.deck.find(c => (c.limit || 0) < CG.MAX_SOCKETS).uid);
      } else break;
    }
    // 审计改进③——删牌瘦组：牌组偏大时删掉最弱的牌（提升抽牌一致性；起手强牌 ≈7 > 阈值不会被删）。
    let dg = 0;
    while (dg++ < 3 && run.deck.length > 11 && run.removePrice && run.gold - run.removePrice() >= reserve) {
      const worst = run.deck.slice().sort((a, b) => cardDeckWorth(a) - cardDeckWorth(b))[0];
      if (!worst || cardDeckWorth(worst) > 6) break;     // 没有明显废牌就停
      run.buyRemove(worst.uid);
    }
    installAll(run);
    run.leaveShop();
  }
  function event(run) {
    const p = run.pending;
    if (p.altar) {
      const id = p.altar;
      if (id === 'findgem') run.altarFindGem();
      else if (id === 'setting' && run.gems.length && run.cardsWithEmptySocket().length) {
        const g = run.gems.slice().sort((a, b) => value.bestInstallScore(CG, b, run, PACKS) - value.bestInstallScore(CG, a, run, PACKS))[0];
        run.altarInstall(g.uid, run.cardsWithEmptySocket()[0].uid);
      } else if (id === 'bore') { const c = run.deck.find(c => (c.limit || 0) < CG.MAX_SOCKETS); c ? run.altarBore(c.uid) : run.leaveEvent(); }
      else if (id === 'purify') { const f = run.allGems().find(x => CG.gemHasDebuff(x.gem)); f ? run.altarPurify(f.uid) : run.leaveEvent(); }
      else if (id === 'recut') { const f = run.allGems().slice().sort((a, b) => value.gemValue(CG, a.gem, { run, packs: PACKS }) - value.gemValue(CG, b.gem, { run, packs: PACKS }))[0]; f ? run.altarRecut(f.uid) : run.leaveEvent(); }
      else run.leaveEvent();
    } else run.leaveEvent();
    installAll(run);
  }

  function onRun(run, tele) { TELE = tele; PACKS = run.packs; }
  return { onRun, map, takeTurn, reward, shop, event, _cloneGame: g => cloneGame(CG, g) };
}

module.exports = { make, cloneGame };

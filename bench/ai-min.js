'use strict';
/* ===========================================================================
 *  最小可用 AI（里程碑 1）—— 仅为打通 host 编排：合法地走完整局，所有包走通用兜底。
 * ===========================================================================
 *  策略很朴素（后续被 ai/ 下的搜索型核心 + 各包策略模块取代）：
 *    战斗：每步选「价值最高的可打牌」打出，没牌可打就结束回合；目标取最低血敌人。
 *    宝石：按词条分数装进匹配基底的空孔（攻向→打击，守向→防御）。
 *    地图：先就近清掉本层内容房，再走向首领。
 *    奖励/商店/事件：拿正分宝石 / 多孔法杖 / 有益祭坛，钱多再买。
 * ===========================================================================
 */
function gemScore(CG, gem) {
  return (gem.affixes || []).reduce((s, a) => s + (CG.AFFIXES[a.id] && CG.AFFIXES[a.id].score || 0) * a.level, 0);
}
// 宝石倾向的基底：带攻击向词条→打击；带格挡向词条→防御；否则 null（随便）。
function baseAffinity(CG, gem) {
  let atk = 0, def = 0;
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d) continue;
    if (d.value && d.value < 0) continue;
    if (d.hits || d.combo || d.pierce || d.valuePct || d.shieldBash || d.lastStand || d.element || d.lifesteal || d.dice || d.coin || d.jackpot || d.slots || d.arc) atk += a.level;
    if (d.block || d.keepBlock || d.brace || d.selfStatus === 'thorns' || d.selfStatus === 'prodBlock') def += a.level;
  }
  return atk > def ? 'strike' : def > atk ? 'defend' : null;
}

function make(CG) {
  let TELE = null;
  const A = CG.AFFIXES;

  // ---- 宝石安装（免费）：把背包里正分宝石尽量装进匹配基底的空孔 ----
  function installAll(run) {
    let guard = 0;
    while (guard++ < 40) {
      const slots = run.deck.filter(c => CG.cardEmptySockets(c) > 0);
      if (!slots.length) break;
      const gem = run.gems.slice().sort((a, b) => gemScore(CG, b) - gemScore(CG, a)).find(g => gemScore(CG, g) > 0);
      if (!gem) break;
      const want = baseAffinity(CG, gem);
      const card = (want && slots.find(c => c.base === want)) || slots[0];
      run.installGemInv(gem.uid, card.uid);
      if (TELE) TELE.installs++;
    }
  }

  // ---- 战斗 ----
  function isPlayable(game, c, idx, s) {
    if (s.noPlay) return false;
    if (idx < (game._paralyze || 0)) return false;
    const oc = s.overclock || 0;
    if (oc) return (game.player.power || 0) >= s.cost * oc;
    const free = (game.freeCards || 0) > 0;
    return (free ? 0 : s.cost) <= game.player.energy;
  }
  function chooseTarget(game) {
    let bi = -1, bh = Infinity;
    game.enemies.forEach((e, i) => { if (e.alive && e.hp > 0 && e.hp < bh) { bh = e.hp; bi = i; } });
    return bi;
  }
  function choosePlayUid(game) {
    let best = null, bv = -Infinity;
    game.hand.forEach((c, idx) => {
      const s = CG.cardStats(c, { valueMult: game.cardValueMult });
      if (!isPlayable(game, c, idx, s)) return;
      let v = s.value + (s.kind === 'damage' ? 1.5 : 0) + (s.effects ? s.effects.length : 0) * 0.2;
      if (s.kind === 'veg') v += 0.5;                      // 做菜：愿意打出素菜
      if (v > bv) { bv = v; best = c.uid; }
    });
    return best;
  }
  function takeTurn(game) {
    let plays = 0;
    while (game.phase === 'player') {
      if (game.craft) { game.craftChoose(null); continue; }     // 朴素餐点（跳过荤菜/调料）
      if (game.pick) { game.pickResolve(null); continue; }       // 燃烧/重生：暂不选
      if (plays++ > 40) break;
      const ti = chooseTarget(game); if (ti >= 0) game.setTarget(ti);
      const uid = choosePlayUid(game);
      if (uid == null) break;
      game.playCard(uid);
      if (TELE) TELE.plays++;
    }
  }

  // ---- 地图（树形，逐格移动）----
  function adj(run, a, b) { return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy) === 1; }
  function dist(run, from, to) {                            // 房间树上的 BFS 距离
    if (from === to) return 0;
    const seen = new Set([from]), q = [[from, 0]];
    while (q.length) {
      const [r, d] = q.shift();
      for (const n of run.grid.rooms) {
        if (seen.has(n) || !adj(run, r, n)) continue;
        if (n === to) return d + 1;
        seen.add(n); q.push([n, d + 1]);
      }
    }
    return Infinity;
  }
  const isContent = r => r.type === 'elite' || r.type === 'shop' || r.type === 'treasure' || r.type === 'altar'
    || r.type === 'curse' || (r.type === 'normal' && r.combat);
  function enterable(run, r) {
    if (r.type === 'curse') return run.hp - run._curseCost() > Math.max(10, run.maxHp * 0.25);
    if (r.type === 'elite') return run.hp > run.maxHp * 0.45;     // 残血不硬刚精英
    return true;
  }
  function map(run) {
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
      const best = p.gems.map((g, i) => [i, gemScore(CG, g)]).sort((x, y) => y[1] - x[1])[0];
      run.chooseReward(best && best[1] > 0 ? p.gems[best[0]] : (best ? p.gems[best[0]] : null));
    } else if (p.kind === 'card') {
      const want = run.gems.length > 0 || run.deck.length < 12;
      run.chooseReward(want ? p.cards.slice().sort((x, y) => (y.limit || 1) - (x.limit || 1))[0] : null);
    } else {
      run.chooseReward(null);
    }
    installAll(run);
  }
  function shop(run) {
    const p = run.pending;
    if (run.hp < run.maxHp * 0.4 && !run.svcUsed('heal') && run.gold >= run.healCost()) run.buyHeal();
    (p.gems || []).forEach((it, i) => {
      if (!it.bought && gemScore(CG, it.gem) > 0 && run.gold - it.price > 25) run.buyGem(i);
    });
    installAll(run);
    run.leaveShop();
  }
  function event(run) {
    const p = run.pending;
    if (p.altar) {
      const id = p.altar;
      if (id === 'findgem') run.altarFindGem();
      else if (id === 'setting' && run.gems.length && run.cardsWithEmptySocket().length) {
        const g = run.gems.slice().sort((a, b) => gemScore(CG, b) - gemScore(CG, a))[0];
        const c = run.cardsWithEmptySocket()[0];
        run.altarInstall(g.uid, c.uid);
      } else if (id === 'bore') {
        const c = run.deck.find(c => (c.limit || 0) < CG.MAX_SOCKETS);
        c ? run.altarBore(c.uid) : run.leaveEvent();
      } else if (id === 'purify') {
        const f = run.allGems().find(x => CG.gemHasDebuff(x.gem));
        f ? run.altarPurify(f.uid) : run.leaveEvent();
      } else if (id === 'recut') {
        const f = run.allGems().sort((a, b) => gemScore(CG, a.gem) - gemScore(CG, b.gem))[0];
        f ? run.altarRecut(f.uid) : run.leaveEvent();
      } else run.leaveEvent();
    } else {
      run.leaveEvent();                                   // 宝藏 / 诅咒：已自动发放
    }
    installAll(run);
  }

  function onRun(run, tele) { TELE = tele; }
  return { onRun, map, takeTurn, reward, shop, event };
}

module.exports = { make, gemScore, baseAffinity };

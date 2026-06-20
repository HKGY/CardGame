'use strict';
/* ===========================================================================
 *  离线对局主循环 —— 复刻 main.js 的 Run/Game 编排，但用 AI 替代人做所有决策。
 * ===========================================================================
 *  playRun(CG, rng, ai, opts) 跑完整一局，返回结果 + 遥测。
 *  ai 接口（全部由 AI 实现；缺省的兜底在本文件里）：
 *    onRun(run, tele)         一局开始（可存引用）
 *    map(run)                 地图阶段：执行一次 selectNode（host 循环直到离开地图）
 *    takeTurn(game, run)      战斗·我方回合：出牌 / 选目标 / 做菜 / 选牌 / 用塔罗；不负责 endTurn
 *    reward(run) / shop(run) / event(run)   一次性完成该屏并离开
 * ===========================================================================
 */
function playRun(CG, rng, ai, opts) {
  opts = opts || {};
  rng.seed(opts.seed != null ? opts.seed : 'SEED');
  const run = new CG.Run(opts.cls || 'warrior', { packs: opts.packs });
  run.seed = opts.seed;
  const tele = {
    turns: 0, battles: 0, installs: 0, plays: 0,
    dmgDealt: 0, dmgTaken: 0, stuck: false, deathRoom: null, deathAct: null,
  };
  if (ai.onRun) ai.onRun(run, tele);

  let guard = 0;
  while (run.phase !== 'dead' && run.phase !== 'victory') {
    if (++guard > 6000) { tele.stuck = true; break; }
    switch (run.phase) {
      case 'map':    ai.map(run); break;
      case 'battle': playBattle(CG, ai, run, tele); break;
      case 'reward': ai.reward(run); break;
      case 'shop':   ai.shop(run); break;
      case 'event':  ai.event(run); break;
      default:       run.phase = 'dead';
    }
  }

  return {
    win: run.phase === 'victory',
    act: run.act, gold: run.gold,
    deckSize: run.deck.length, relics: run.relics.slice(),
    gemsInDeck: run.deck.reduce((s, c) => s + (c.sockets || []).length, 0),
    packs: run.packs.slice(), seed: opts.seed, tele,
  };
}

function playBattle(CG, ai, run, tele) {
  let hpMult = 1;
  if (run.flags.enemyHpDown && run.current.type !== 'boss') {
    hpMult = 1 - run.flags.enemyHpDown;
    run.flags.enemyHpDown = 0;
  }
  const game = new CG.Game({
    enemyIds: run.pending.enemyIds, tier: run.pending.tier,
    deck: run.deck, hp: run.hp, maxHp: run.maxHp,
    tarot: run.tarot, relics: run.relics, run,
    actScale: CG.CONFIG.actScale[run.act], hpMult,
  });
  tele.battles++;
  const hpStart = game.player.hp;

  let g = 0, lastEhp = Infinity, stall = 0;
  while (game.phase === 'player' || game.phase === 'enemy') {
    if (++g > 700) { tele.stuck = true; break; }
    if (game.phase === 'player') {
      ai.takeTurn(game, run, tele);
      // 兜底：AI 若留下做菜 / 选牌浮层未处理，跳过它们，确保能结束回合
      let safety = 0;
      while (game.phase === 'player' && (game.craft || game.pick) && safety++ < 20) {
        if (game.craft) game.craftChoose(null);
        else if (game.pick) game.pickResolve(null);
      }
      if (game.phase === 'player') game.endTurn();
    }
    if (game.phase === 'enemy') game.runEnemyTurn();
    const ehp = game.aliveEnemies().reduce((s, e) => s + e.hp, 0);   // 无进展熔断：50 回合敌血没掉 → 判对峙(算负)
    if (ehp < lastEhp) { lastEhp = ehp; stall = 0; } else if (++stall > 60) { tele.stuck = true; break; }
  }

  tele.turns += game.turn;
  tele.dmgTaken += Math.max(0, hpStart - game.player.hp);
  const win = game.phase === 'won';
  if (!win) { tele.deathRoom = run.current ? run.current.type : null; tele.deathAct = run.act; }
  run.finishBattle(win, game.player.hp);
}

module.exports = { playRun, playBattle };

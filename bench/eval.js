'use strict';
/* ===========================================================================
 *  实验运行器（M4）—— 配对 seed 跨包集评测，输出胜率 + Wilson 区间 + 诊断。
 * ===========================================================================
 *  用法：node bench/eval.js [N] [ai=core|min] [onlyPack]
 *    N        每个包集的局数（配对 seed：同 i 跨包集用同一地图/遭遇）
 *    ai       core（搜索型，默认）| min（朴素，对照 AI 强弱）
 *    onlyPack 只测某个包（调试用）
 *  以 {basic} 为基线，逐个测 {basic, P}；Δ = 该包相对基线的胜率提升（同 seed 配对）。
 *  诊断列（区分「弱包 vs 弱 AI」）：avgAct 推进层数、gems/deck 实装宝石、avgTurns。
 * ========================================================================= */
const { build } = require('./loader');
const { playRun } = require('./host');

const { CG, rng } = build();
require('./packs');                                   // 注册各包策略钩子（require 即注册）
const HP = +process.env.HP || null;                   // 难度旋钮：HP=45 node bench/eval.js … → 降低初始血
if (HP) CG.CONFIG.startHp = HP;
const M = +process.env.M || null;                     // 敌人倍率：M=2.5 node bench/eval.js … → 放大敌人全数值
if (M) require('./difficulty').setM(CG, M);
const N = +process.argv[2] || 30;
const AI_KIND = process.argv[3] || 'core';
const ONLY = process.argv[4] || null;
const aiMod = AI_KIND === 'min' ? require('./ai-min') : require('./ai-core');
const makeAI = () => aiMod.make(CG, rng, { search: process.env.SEARCH || 'rollout' });

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

function evalSet(packs) {
  let win = 0, acts = 0, turns = 0, gems = 0, stuck = 0, taken = 0;
  const wins = [];
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const r = playRun(CG, rng, makeAI(), { seed: 'S' + i, packs });
    wins[i] = r.win ? 1 : 0;
    if (r.win) win++;
    acts += r.act; turns += r.tele.turns; gems += r.gemsInDeck;
    if (r.tele.stuck) stuck++;
    taken += r.tele.dmgTaken;
  }
  const [lo, hi] = wilson(win, N);
  return { packs, win, N, rate: win / N, lo, hi, avgAct: acts / N, avgTurns: turns / N, gems: gems / N, stuck, dmgTaken: taken / N, wins, ms: Date.now() - t0 };
}

function pct(x) { return (100 * x).toFixed(1).padStart(5); }
function row(label, r, base) {
  let delta = '';
  if (base) {
    const d = r.rate - base.rate;
    // 配对翻转计数（同 seed 下 P 赢而基线输 / 反之）
    let up = 0, down = 0;
    for (let i = 0; i < r.N; i++) { if (r.wins[i] && !base.wins[i]) up++; else if (!r.wins[i] && base.wins[i]) down++; }
    delta = `Δ${(d >= 0 ? '+' : '') + pct(d)}%  (+${up}/-${down})`;
  }
  console.log(
    label.padEnd(16),
    'win ' + pct(r.rate) + '%  [' + pct(r.lo) + ',' + pct(r.hi) + ']',
    delta.padEnd(22),
    'act ' + r.avgAct.toFixed(2),
    'turns ' + r.avgTurns.toFixed(1),
    'gems ' + r.gems.toFixed(1),
    'dmg ' + r.dmgTaken.toFixed(0),
    r.stuck ? ('STUCK ' + r.stuck) : '',
    '(' + r.ms + 'ms)'
  );
}

console.log(`=== 包评测 · AI=${AI_KIND} · 每组 ${N} 局（配对 seed）===`);
const base = evalSet(['basic']);
row('basic(baseline)', base, null);
const packs = CG.PACK_IDS.filter(p => p !== 'basic' && (!ONLY || p === ONLY));
const results = [];
for (const p of packs) { const r = evalSet(['basic', p]); r.id = p; results.push(r); row('basic+' + p, r, base); }

// 按相对基线 Δ 排序的小结
results.sort((a, b) => (b.rate - a.rate));
console.log('\n--- 按胜率排序 ---');
for (const r of results) console.log(('basic+' + r.id).padEnd(16), pct(r.rate) + '%', 'Δ' + (r.rate - base.rate >= 0 ? '+' : '') + pct(r.rate - base.rate) + '%');

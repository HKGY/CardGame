'use strict';
/* ===========================================================================
 *  蒙特卡洛包评测 —— 按真实游玩方式随机 4 包（基础包恒含 + 3 随机增强包），跑 N 局，
 *  对每个包统计「所有包含该包的 run 的胜率」。多 worker 并行。
 * ===========================================================================
 *  用法：node bench/montecarlo.js [N=10000] [M=倍率] [workers=16]
 *    M 不传则用 env M，再不传默认 1（应先用 calibrate 定 M）。
 *  基础包出现在每一局 → 其胜率即总体胜率。各增强包约出现在 3/14 的局里（~N×0.214 样本）。
 * ========================================================================= */
const { build } = require('./loader');
const { runParallel, wilson } = require('./parallel');

const { CG } = build();

(async () => {
  const N = +process.argv[2] || 10000;
  const M = +process.argv[3] || +process.env.M || 1;
  const W = +process.argv[4] || 16;
  const SEARCH = process.env.SEARCH || 'rollout';
  console.log(`蒙特卡洛：${N} 局 · 真实随机 4 包（基础包 + 3 随机增强）· 敌人倍率 M=${M} · ${W} 线程 · AI=${SEARCH}`);
  const t0 = Date.now();
  const { agg, totRuns, totWins, actSum } = await runParallel({ N, M, packs: null, workers: W, search: SEARCH });
  const overall = totWins / totRuns;
  console.log(`总体胜率 ${(100 * overall).toFixed(2)}%（=基础包，恒在每局）  avgAct ${(actSum / totRuns).toFixed(2)}  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const order = CG.PACK_IDS.filter(p => agg[p]);
  const rows = order.map(p => {
    const a = agg[p], rate = a.wins / a.runs, [lo, hi] = wilson(a.wins, a.runs);
    return { p, runs: a.runs, rate, lo, hi };
  }).sort((x, y) => y.rate - x.rate);

  console.log('包'.padEnd(10), '局数'.padStart(6), '  胜率', '   95%CI', '         Δ vs 总体');
  for (const r of rows) {
    const d = r.rate - overall;
    console.log(
      r.p.padEnd(10),
      String(r.runs).padStart(6),
      (100 * r.rate).toFixed(2).padStart(7) + '%',
      ('[' + (100 * r.lo).toFixed(1) + ',' + (100 * r.hi).toFixed(1) + ']').padStart(15),
      ('  ' + (d >= 0 ? '+' : '') + (100 * d).toFixed(2) + '%').padStart(10),
    );
  }
})();

'use strict';
/* 并行编排 —— 把 N 局拆给 W 个 worker_threads 跑，聚合返回。 */
const { Worker } = require('worker_threads');
const path = require('node:path');

function runParallel({ N, M, packs, workers, search }) {
  workers = workers || 16;
  M = M || 1;
  search = search || 'rollout';
  return new Promise((resolve, reject) => {
    const per = Math.ceil(N / workers);
    const agg = {};
    let totRuns = 0, totWins = 0, actSum = 0, pending = 0;
    const prefix = (packs ? packs.join('+') : 'MC') + '#M' + M + '#';
    for (let w = 0; w < workers; w++) {
      const start = w * per;
      if (start >= N) break;
      const count = Math.min(per, N - start);
      pending++;
      const wk = new Worker(path.join(__dirname, 'mc-worker.js'), {
        workerData: { start, count, M, packs: packs || null, seedPrefix: prefix, search },
      });
      wk.on('message', msg => {
        totRuns += msg.totRuns; totWins += msg.totWins; actSum += msg.actSum;
        for (const p in msg.agg) { const a = agg[p] || (agg[p] = { runs: 0, wins: 0 }); a.runs += msg.agg[p].runs; a.wins += msg.agg[p].wins; }
        wk.terminate();
        if (--pending === 0) resolve({ agg, totRuns, totWins, actSum });
      });
      wk.on('error', reject);
    }
    if (pending === 0) resolve({ agg: {}, totRuns: 0, totWins: 0, actSum: 0 });
  });
}

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

module.exports = { runParallel, wilson };

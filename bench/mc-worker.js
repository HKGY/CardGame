'use strict';
/* 蒙特卡洛 worker —— 每个 worker 自建一份 CG（vm 上下文，互不干扰），跑一段 seed 区间。
 * workerData: { start, count, M, packs:(数组|null), seedPrefix }
 *   packs=null → Run 自行 rollRunPacks()（真实随机：基础包 + 3 个随机增强包）。
 * 回传按包聚合的 {runs,wins} + 总计，减少 IPC。
 */
const { workerData, parentPort } = require('worker_threads');
const { build } = require('./loader');
const { playRun } = require('./host');
const diff = require('./difficulty');

const { CG, rng } = build();
require('./packs');                       // 注册各包策略钩子
diff.setM(CG, workerData.M);
const aiMod = require('./ai-core');

const agg = {};
let totRuns = 0, totWins = 0, actSum = 0;
for (let i = 0; i < workerData.count; i++) {
  const idx = workerData.start + i;
  const r = playRun(CG, rng, aiMod.make(CG, rng, { search: workerData.search || 'rollout' }), { seed: workerData.seedPrefix + idx, packs: workerData.packs || undefined });
  totRuns++; if (r.win) totWins++; actSum += r.act;
  for (const p of r.packs) { const a = agg[p] || (agg[p] = { runs: 0, wins: 0 }); a.runs++; if (r.win) a.wins++; }
}
parentPort.postMessage({ agg, totRuns, totWins, actSum });

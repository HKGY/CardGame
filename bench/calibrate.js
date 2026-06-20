'use strict';
/* 校准敌人倍率 M —— 用「{basic} 单包」胜率作难度锚，扫描 M 找到使基础包胜率落在 30-50% 的档。
 * 用法：node bench/calibrate.js [Ms逗号分隔] [每档局数N] [workers]
 *   例：node bench/calibrate.js 1,1.5,2,2.5,3,3.5,4 800 16
 */
const { runParallel } = require('./parallel');

(async () => {
  const Ms = (process.argv[2] || '1,1.5,2,2.5,3,3.5,4').split(',').map(Number);
  const N = +process.argv[3] || 800;
  const W = +process.argv[4] || 16;
  const SEARCH = process.env.SEARCH || 'rollout';
  console.log(`校准敌人倍率 M —— {basic} 单包，每档 ${N} 局，${W} 线程，AI=${SEARCH}（目标：基础包胜率 30-50%）\n`);
  for (const M of Ms) {
    const t0 = Date.now();
    const { totRuns, totWins, actSum } = await runParallel({ N, M, packs: ['basic'], workers: W, search: SEARCH });
    const rate = 100 * totWins / totRuns;
    const flag = rate >= 30 && rate <= 50 ? '  ← 命中目标' : '';
    console.log(`M=${String(M).padEnd(4)}  基础包胜率 ${rate.toFixed(1).padStart(5)}%   avgAct ${(actSum / totRuns).toFixed(2)}   (${Date.now() - t0}ms)${flag}`);
  }
})();

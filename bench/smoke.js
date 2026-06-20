'use strict';
/* 里程碑 1 冒烟：跑完整局确认 host 编排正确，并给出各包的初步胜率信号。
 * 用法：node bench/smoke.js [每组局数N]
 * 同一 seed 跨包共用（配对比较：同地图同遭遇，降低方差）。
 */
const { build } = require('./loader');
const { playRun } = require('./host');
const aiMin = require('./ai-min');

const { CG, rng } = build();
const N = +process.argv[2] || 40;

function evalSet(packs, label) {
  let win = 0, acts = 0, stuck = 0, gems = 0, t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const r = playRun(CG, rng, aiMin.make(CG), { seed: String(i), packs });
    if (r.win) win++;
    acts += r.act; gems += r.gemsInDeck;
    if (r.tele.stuck) stuck++;
  }
  const ms = Date.now() - t0;
  console.log(
    label.padEnd(16),
    'win ' + (100 * win / N).toFixed(1).padStart(5) + '%',
    'avgAct ' + (acts / N).toFixed(2),
    'gems/deck ' + (gems / N).toFixed(1),
    stuck ? ('STUCK ' + stuck) : '',
    '(' + ms + 'ms)'
  );
}

console.log('=== 冒烟评测：每组 ' + N + ' 局（配对 seed），最小 AI / 包走兜底 ===');
evalSet(['basic'], 'basic');
for (const p of CG.PACK_IDS.filter(x => x !== 'basic')) evalSet(['basic', p], 'basic+' + p);

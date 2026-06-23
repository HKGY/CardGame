'use strict';
/* 生产包（produce）v3.2 策略 —— 时点模型重写。
 *
 * v3.2：旧「player.statuses.prod*（prodBlock/prodDraw/prodGrow…）回合开始结算」机制已全删（死代码）。
 *   现生产包 = 3 个「每回合(_every)」价值原子：produce_block / produce_draw / produce_energy
 *   （cardStats 输出 scheduleEvery 效果 → game._everyTurn，每个玩家回合开始重复结算）。
 *
 * 与核心 V 的分工：核心 bench/value.js 的 V 现已估 game._everyTurn 队列（循环引擎现值，ENGINE_MULT），
 *   故「已铺的每回合产出」battle 无需补、否则双重计。V 看不到的是构筑层：「投资引擎越早抽越值」
 *   （前期入手能多攒好几轮产出）—— 这里只在 gem 钩子做早抽溢价。
 */
const value = require('../value');

// 一颗宝石里「每回合产出」原子的等级（按价值原子识别 produce_block/draw/energy）。
function gemProduceLevel(CG, gem) {
  let blk = 0, draw = 0, energy = 0;
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d || !d.value) continue;
    const atom = d.value.atom;
    if (atom === 'produce_block')  blk += (a.level || 1);
    else if (atom === 'produce_draw') draw += (a.level || 1);
    else if (atom === 'produce_energy') energy += (a.level || 1);
  }
  return { blk, draw, energy };
}

value.registerPack('produce', {
  // 构筑层：每回合产出＝复利引擎，越早入手越值（多攒几轮）；能量引擎(produce_energy)最强。
  gem(CG, gem) {
    const { blk, draw, energy } = gemProduceLevel(CG, gem);
    if (!blk && !draw && !energy) return 0;
    // 早抽溢价：能量引擎(滚雪球核心) > 抽牌(手牌优势) > 格挡(续航)。
    return energy * 2.5 + draw * 1.5 + blk * 0.8;
  },
});

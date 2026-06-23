'use strict';
/* 术士包（conjure）v3 策略 —— 原子模型重写。
 *
 * v3 术士＝唯一价值原子 `conjure`（`d.conjure`）：打出带它的牌后，临时印 (1+level) 张随机基础
 * 法术（攻/防，各带 1 颗 1 级宝石）进手牌，仅本场。引擎 effect：conjure → _addToHand×(1+value)，
 * 手牌满(HAND_LIMIT=10)则进弃牌堆＝白印。旧版的 daggers/mindblast/duplicate/foresight/clutter
 * 在 v3 已删 → 那是死代码，本文件按 v3 只对 `conjure` 建模。
 *
 * 通用 V 的盲点：V 只看「打完后的局面」（血量/状态/敌血…），**牌的张数本身不计分**。
 *   - rollout 会真实展开「打 conjure 牌 → 印出新牌 → 这回合接着打它们」，故**本回合内**能用上的
 *     conjure 产出，搜索已经能看到、无需 battle 补偿（补了反而双重计数 → AI 囤牌）。
 *   - 真正看不到的是「牌权/续航」的**期权**与**跨回合**价值：多出来的牌是后续回合的出牌机会
 *     （滚雪球）。这类只能在 gem（构筑：该不该留这颗造牌宝石）与 playPolicy（早造早用、别在
 *     手牌快满时造而溢出弃牌堆）里表达。
 *
 * 标度（README）：1 V ≈ 0.083 玩家血 ≈ 0.67 敌血；「值半条命的铺垫」≈ +6；宝石基准 score×level。
 *   conjure 通用价值已是 score(4)×level；本文件的 gem 只做小幅边际修正，battle 期权分封顶很小，
 *   以免 AI 为囤牌而消极不打牌（与项目「V 故意不奖励囤牌防消极」一致）。
 */
const value = require('../value');

// 一张牌是否「造牌牌」（含 conjure 原子），及其 conjure 总层数。
function conjureLevel(CG, card) {
  let n = 0;
  for (const sk of (card.sockets || [])) for (const a of (sk.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d) continue;
    if (d.conjure) n += d.conjure * (a.level || 1);                       // 本回合造牌(d.conjure)
    else if (d.value && /^conjure/.test(d.value.atom || '')) n += (a.level || 1);   // v3.2：conjure_next/_every（调度造牌）
  }
  return n;
}

value.registerPack('conjure', {
  // battle：给「手里尚未打出的造牌牌」一点点期权分——它代表后续能多打的牌（牌权/续航）。
  // 注意只给「手牌还有空间接住产出」的部分：手牌越满，造出的牌越会溢出弃牌堆 → 期权越廉价。
  // 量级刻意很小（每张造牌牌 ≤ ~2 期权分），避免与 rollout 的本回合展开双重计数、也避免 AI 囤牌。
  battle(CG, g) {
    const hand = g.hand || [];
    const room = Math.max(0, 10 - hand.length);        // HAND_LIMIT=10：手里还能接住几张
    if (room <= 0) return 0;                            // 手牌已满：造出全溢出弃牌堆，无期权价值
    let opt = 0;
    for (const c of hand) {
      const cl = conjureLevel(CG, c); if (!cl) continue;
      const produced = 1 + cl;                          // 打出后印出的牌数
      const usable = Math.min(produced, room);          // 真正接得住的张数
      opt += usable;
    }
    // 每张「能接住的产出」≈ 0.8 期权分（一次后续出牌机会，远低于一张直接产出牌的即时分），整体封顶。
    return Math.min(opt * 0.8, 5);
  },

  // gem：造牌＝牌权/续航，通用已按 score=4 计；这里仅做小幅边际加成（造牌随回合滚雪球、价值略高于
  // 同分一次性效果），等级越高一次造越多 → 略超线性。
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d || !d.conjure) continue;
      const L = a.level || 1;
      v += 1.2 * L + (L >= 2 ? 0.5 : 0);                // 边际加成：造牌的续航溢价；高等级一次多造，略加权
    }
    return v;
  },

  // playPolicy：早造早用、滚雪球——回合早、手牌不满时偏好打造牌牌（产出能在本回合及后续被用上）；
  // 手牌快满时压后（造出的牌会溢出弃牌堆＝浪费）。强度中等，仅在确有 conjure 牌时生效。
  playPolicy(CG, g, card, s) {
    const cl = conjureLevel(CG, card); if (!cl) return 0;
    const room = Math.max(0, 10 - g.hand.length);
    const produced = 1 + cl;
    if (room <= 1) return -8;                           // 手牌将满：造出几乎全溢出弃牌堆 → 强烈压后
    if (room < produced) return -3;                     // 接不全：部分溢出 → 轻度压后
    // 手牌有充裕空间：早造早滚雪球（越早，产出能服务越多回合）。
    return g.turn <= 2 ? 12 : (g.turn <= 4 ? 7 : 3);
  },
});

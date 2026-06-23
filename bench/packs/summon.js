'use strict';
/* 召唤包（summon）策略 —— v3.4 单骷髅模型重写。
 *
 * v3.4：旧「多召唤物 game.allies 数组」已改为**单骷髅 game.skeleton**（{hp,maxHp,block,statuses} 或 null，
 *   「类玩家单位」）。召唤价值原子 `summon`（d.summon）= 召出/壮大骷髅（血量上限 n）；骷髅**不自动攻击**，
 *   其攻击/格挡/治疗/荆棘来自「召唤物修饰」词条 `_m`（damage_m/block_m/thorns_m/strength_m/…，效果改投骷髅）。
 *   骷髅替玩家挡刀（召唤物格挡→玩家格挡→召唤物血→玩家血）。
 *
 * 与核心 V 的分工（避免双重计）：
 *   · 核心 bench/value.js 的 V 现已估「骷髅板面（血肉护盾 + 自身增益）」(skeletonValue) + 「被调度的 _m
 *     效果（_every/_next 队列里 minion:true 的项）」(queueValue)。
 *   · 故本钩子**不再**重复估骷髅板面，只补 V 看不到的两类：
 *     - 构筑层(gem)：召唤/_m 宝石的「越早抽越值」边际定价（V 不参与抽卡）。
 *     - 出牌层(playPolicy)：早铺早赚（骷髅在场越久、后续 _m 攻击/挡刀回合越多）。
 */
const value = require('../value');

// 一颗宝石含多少「召唤(summon)」等级、多少「召唤物修饰(_m)」等级。
function gemSummonMinion(CG, gem) {
  let summonLv = 0, minionLv = 0;
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d) continue;
    if (d.summon) summonLv += (a.level || 1);
    if (d.value && d.value.atom && /_m$/.test(d.value.atom)) minionLv += (a.level || 1);
    else if (d.minion) minionLv += (a.level || 1);   // 兜底（部分 _m 原子带 minion 标记）
  }
  return { summonLv, minionLv };
}

value.registerPack('summon', {
  // ---- 局面附加分 ----
  // 核心 V 已估骷髅板面 + 调度的 _m 效果，这里只补 V 提前体现不了的「早铺复利溢价」。
  battle(CG, g) {
    const sk = g.skeleton;
    if (!sk || sk.hp <= 0) return 0;
    // 早回合骷髅在场：后续可承担更多回合的挡刀 / _m 攻击 → 复利溢价（封顶，别为护骷髅弃防御）。
    if (g.turn <= 3) return Math.min((sk.maxHp || sk.hp) * 0.4, 10);
    return 0;
  },

  // ---- 宝石价值附加分（构筑层）----
  // 召唤/_m 宝石「越早抽越值」：骷髅在场越久收益越多；但牌组已有很多召唤/修饰来源时边际递减。
  gem(CG, gem, ctx) {
    const { summonLv, minionLv } = gemSummonMinion(CG, gem);
    if (!summonLv && !minionLv) return 0;

    // 统计牌组已有的召唤来源 + 修饰来源等级。
    let deckSummon = 0, deckMinion = 0;
    const run = ctx && ctx.run;
    for (const c of ((run && run.deck) || [])) for (const sk of (c.sockets || [])) for (const a of (sk.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.summon) deckSummon += (a.level || 1);
      if ((d.value && d.value.atom && /_m$/.test(d.value.atom)) || d.minion) deckMinion += (a.level || 1);
    }
    let v = 0;
    // 召唤来源：先得有骷髅这个「载体」（没载体 _m 全废）→ 牌组无召唤时第一颗召唤格外值钱。
    if (summonLv) {
      const per = deckSummon <= 0 ? 2.5 : deckSummon <= 3 ? 1.0 : -0.6;
      v += summonLv * per;
    }
    // _m 修饰：需有骷髅载体才发挥；牌组有召唤来源时更值（凑成「召唤+修饰」体系）。
    if (minionLv) {
      const per = deckSummon > 0 ? (deckMinion <= 4 ? 1.5 : 0.4) : 0.3;   // 无召唤载体时几乎是空头支票
      v += minionLv * per;
    }
    return v;
  },

  // ---- 回合内选牌（playPolicy）----
  // 早铺早赚：回合早 / 场上无骷髅时，优先打召唤牌（让骷髅多承担几轮挡刀 + _m 攻击）。
  playPolicy(CG, g, card, s) {
    const summons = (s.effects || []).filter(e => e.type === 'summon');
    if (!summons.length) return 0;
    const sk = g.skeleton;
    const onBoard = !!(sk && sk.hp > 0);
    let b = 0;
    if (g.turn <= 2) b += 12;                              // 极早铺场：未来兑现回合最多
    else if (g.turn <= 4) b += 6;
    if (!onBoard) b += 6;                                  // 场上无骷髅 → 急需召唤载体（否则 _m 全废）
    return b;
  },
});

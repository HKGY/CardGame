'use strict';
/* 弃牌包（discard）策略模块 —— M3 模式
 * 机制：
 *   toss     打出→弃1张+造伤（feeds dumpster + discardPile for reclaim）
 *   sift     打出→弃2抽2（card cycling + feeds dumpster）
 *   reclaim  打出→交互从弃牌堆取回1张（pick 钩子修复：默认回退会查 exhaustPile 而非 discardPile）
 *   dumpster 打出→本牌数值 +（本回合已弃牌数 × 等级）→「先弃后打」序列
 *   madness  打出→弃光手牌·每张 +1 力量（爆发清场）
 *   forget   健忘（clutch：随机弃）/ waste 浪费（loseEnergy）/ leak 漏能
 *
 * 主要 AI 缺口（已修复）：
 *   ① reclaim pick：doPickOn 的 else 分支错误地从 exhaustPile 选牌（为 reborn 设计），
 *      reclaim 应从 discardPile 选最有价值的牌。→ pick 钩子覆盖。
 *
 * 说明：
 *   - 搜索 + 引擎已经自动发现「先弃后打 dumpster」序列（_discardedThisTurn 在克隆里正确更新）
 *   - battle 钩子只补充 V 完全看不见的长期价值，不干扰即时收益评估
 *   - install 钩子引导 toss/dumpster/madness 装到攻击卡（它们有造伤或力量增益），
 *     reclaim/sift 中性（适合任何卡）
 */
const value = require('../value');

// 估算弃牌堆中一张牌的价值（用于 reclaim 选牌）
function reclaimWorth(CG, c) {
  try {
    const s = CG.cardStats(c);
    let w = (s.value || 0);
    // 带 dumpster 的牌从弃牌堆取回后还能再配合本回合已弃数爆发
    for (const sock of (c.sockets || [])) {
      for (const af of (sock.affixes || [])) {
        if (af.id === 'dumpster') w += 5 * af.level;
        if (af.id === 'madness')  w += 3 * af.level;
        if (af.id === 'toss')     w += 2 * af.level;
      }
    }
    if (s.nirvana) w += 8;
    if (s.undying) w += 6;
    return w;
  } catch (e) { return 0; }
}

value.registerPack('discard', {
  // ---- 局面附加分 ----
  // 弃牌包的即时收益（toss造伤、sift过牌、dumpster加数值）引擎已自动结算，V 能看到。
  // madness 的力量增益 V 也能看到（strength*6）。
  // 这里只补充 V 看不到的：弃牌堆积累对 reclaim 的潜在价值。
  battle(CG, g) {
    let v = 0;
    // 弃牌堆有牌时，手里有 reclaim 词条的牌有额外潜力
    const dpSize = g.discardPile ? g.discardPile.length : 0;
    if (dpSize > 0) {
      let reclaimCount = 0;
      for (const c of g.hand) {
        for (const sock of (c.sockets || [])) {
          for (const af of (sock.affixes || [])) {
            if (af.id === 'reclaim') reclaimCount++;
          }
        }
      }
      // 弃牌堆有好牌可取回 → 轻微加分（避免过度出牌导致弃牌堆被洗空）
      if (reclaimCount > 0) v += Math.min(dpSize, 5) * 0.8;
    }
    return v;
  },

  // ---- 宝石价值附加分 ----
  // 注意：泛用分已含 score×level；这里只加「包内协同」的上下文加权。
  // dumpster 的价值依赖本回合弃牌数，不保证每次都有贡献，不宜过高加权。
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      if (!CG.AFFIXES[a.id]) continue;
      if (a.id === 'toss')     v += 1 * a.level;   // 弃1造伤 + 喂 dumpster：协同核心（适度）
      if (a.id === 'sift')     v += 0.5 * a.level; // 弃2抽2：过牌 + 喂 dumpster（适度）
      if (a.id === 'dumpster') v += 1 * a.level;   // 爆发核心，但依赖弃牌数，不过高
      if (a.id === 'reclaim')  v += 1.5 * a.level; // 取回高价值牌（pick 钩子修复后有实际效果）
      if (a.id === 'madness')  v += 0.5 * a.level; // 爆发清场，有风险
      if (a.id === 'forget')   v -= 2 * a.level;   // 随机弃牌：不可控（通用已有惩罚）
      if (a.id === 'waste')    v -= 1.5 * a.level; // 失去能量（通用已有惩罚）
      if (a.id === 'leak')     v -= 2 * a.level;   // 能量-N：持续亏损（通用已有惩罚）
    }
    return v;
  },

  // ---- 安装契合度 ----
  // toss/dumpster/madness 都有伤害/力量成分，应装到攻击卡上
  // reclaim/sift 中性，不额外引导
  install(CG, gem, card) {
    let bonus = 0;
    const base = CG.BASE_CARDS[card.base];
    const isAttack = base && (base.type === 'attack' || base.kind === 'attack');
    for (const a of (gem.affixes || [])) {
      if (!CG.AFFIXES[a.id]) continue;
      if ((a.id === 'toss' || a.id === 'dumpster' || a.id === 'madness') && isAttack) {
        bonus += 0.15 * a.level;  // 伤害/力量词条偏好攻击卡
      }
    }
    return bonus;
  },

  // ---- reclaim 选牌：从 discardPile 选最有价值的牌 ----
  // 修复缺口：doPickOn 的通用 else 分支错误地查 exhaustPile（为 reborn 设计），
  // reclaim 应查 discardPile。
  pick(CG, g, type) {
    if (type !== 'reclaim') return undefined;  // 其他类型交给通用处理
    const pile = g.discardPile;
    if (!pile || !pile.length) return null;    // 弃牌堆空：跳过
    let best = null, bestW = -Infinity;
    for (const c of pile) {
      const w = reclaimWorth(CG, c);
      if (w > bestW) { bestW = w; best = c; }
    }
    return best ? best.uid : null;
  },
});

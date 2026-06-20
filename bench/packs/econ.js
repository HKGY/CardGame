'use strict';
/* 市场包（econ）策略模块 —— value.registerPack 注入估值钩子。
 *
 * 机制要点：
 *   invest  (投资)  : 花至多 5×L 金币 → 造成 花出金币×2 点伤害。金币=0 则无效。
 *   income  (进账)  : +6×L 金币（纯积累）
 *   trade   (贸易)  : 抽 1 牌 + +4×L 金币
 *   windfall(暴富)  : 本牌数值 +（当前金币÷10 × L）= 持金越高、收益越强
 *   hire    (雇佣)  : 花 5×L 金币 → 获 L 力量（力量×6=永久强化）
 *   tax     (赋税)  : 失去 4×L 金币（减益）
 *   inflation(通胀) : 失去 20% 金币（减益）
 *   debt    (赌债)  : 失去 3×L 金币；不足则等量失血（减益，极危险）
 *
 * 核心建模问题：
 *   invest 每花 1 金 = 2 点伤害 = +3V（引擎已算）。金币 meta 价值约 0.8V/金。
 *   对 V 来说 invest 仍是净赚，必须在宝石选择阶段阻止 AI 取 invest 宝石。
 *   debt 与 invest 配合会导致「gold→0 → 失血」的死亡螺旋，需强力惩罚。
 *
 * 经过 150 局校准：
 *   - windfall / income / trade 宝石价值高 → AI 优先取 ✓
 *   - invest / debt 宝石被强惩后 AI 不取 ✓
 *   - battle hook 的 0.8/金使 hire/invest 后 V 下降，已合理 ✓
 *   - 关键：debt 惩罚需要足够强，使含 windfall+debt 的混合宝石仍为负 ✓
 */

const value = require('../value');

value.registerPack('econ', {
  // ── 局面附加分 ────────────────────────────────────────────────
  battle(CG, g) {
    if (!g.run) return 0;
    const gold = g.run.gold || 0;
    let v = 0;

    // 金币 meta 价值（0.8V/金）：代表真实购买力（宝石/治疗/升孔）
    // 使 invest/hire 耗金后 V 明显下降，AI 保守使用
    v += gold * 0.8;

    // windfall 预期收益：持金时未打出 windfall 的期望价值
    // 检测手牌和牌库中最高 windfall 等级
    let windfallLevel = 0;
    for (const c of g.hand) {
      const s = CG.cardStats(c);
      if (s.windfall > windfallLevel) windfallLevel = s.windfall;
    }
    if (!windfallLevel) {
      for (const c of g.drawPile) {
        const s = CG.cardStats(c);
        if (s.windfall > windfallLevel) { windfallLevel = s.windfall; break; }
      }
    }
    if (windfallLevel > 0 && gold >= 10) {
      // windfall L 每 10 金贡献 L 伤/格挡；期望折扣 0.5；价值 ≈ L×1.5V/10金
      // 给 0.75/10金 × L 的预期激励
      v += Math.floor(gold / 10) * windfallLevel * 0.75;
    }

    return v;
  },

  // ── 宝石价值附加分 ────────────────────────────────────────────
  gem(CG, gem, ctx) {
    let v = 0;

    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (!d) continue;

      if (d.windfall) {
        // 核心飞轮：持 60 金时 L1 每次打出 +6 伤，期望 4 次/战斗 = +24 V/战斗
        // 通用已给 4L，再加 6L（期望战斗收益折算）
        v += 6 * a.level;
      }
      if (d.income) {
        // income 是 windfall 燃料：+6L 金 × 0.8 meta = 4.8L V
        // 通用已给 3L，再加 2L（稍作额外激励）
        v += 2 * a.level;
      }
      if (d.trade) {
        // trade：抽1（≈3V）+ 4L金 × 0.8 = 3.2L meta V
        // 通用已给 3L，再加 2L
        v += 2 * a.level;
      }
      if (d.hire) {
        // hire 花 5L 换 L 力量（净 +2L V，高 ROI）
        // 通用已给 4L，再加 1L
        v += 1 * a.level;
      }
      if (d.invest) {
        // invest 耗金破坏 windfall 飞轮 + meta 损失；宝石选择阶段阻止
        // 通用给 +4L，扣 10L → 净 -6L（AI 坚决不取 invest 宝石）
        v -= 10 * a.level;
      }
      // 减益强惩罚
      if (d.tax) {
        // 赋税扣 4L 金 × 0.8 meta = 3.2L V 损失；通用给 -3L×1.3=-3.9L，扣 2L
        v -= 2 * a.level;
      }
      if (d.inflation) {
        // 通胀 -20%：平均 80 金 × 20% = 16 金 × 0.8 = 12.8V 损失；扣 8
        v -= 8;
      }
      if (d.debt) {
        // 赌债极度危险：扣金 + 失血；windfall 积累的金就是债的靶子
        // 通用给 -3L×1.3=-3.9L，再扣 9L → 净 -13L（坚决拒绝含 debt 的宝石）
        v -= 9 * a.level;
      }
    }
    return v;
  },

  // ── 安装契合度附加分 ──────────────────────────────────────────
  install(CG, gem, card, ctx) {
    let bonus = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (!d) continue;

      // windfall 必须装攻击/防御卡才有效果（需要 damage/block effects）
      if (d.windfall) {
        if (card.base === 'strike') bonus += 0.3 * a.level;
        else if (card.base === 'defend') bonus += 0.1 * a.level;
        else bonus -= 0.3 * a.level;  // 其他卡无 effect 可放大，强惩罚
      }
      // income/trade 哪里打出都有效，轻微偏好攻击卡（打出频率高）
      if ((d.income || d.trade) && card.base === 'strike') {
        bonus += 0.1 * a.level;
      }
      // hire 放攻击卡（力量×6对攻击最有意义）
      if (d.hire && card.base === 'strike') {
        bonus += 0.15 * a.level;
      }
    }
    return bonus;
  },
});

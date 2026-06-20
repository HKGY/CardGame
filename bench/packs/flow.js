'use strict';
/* 律动包（flow）策略模块 —— value.registerPack 注入估值钩子。
 *
 * ============== 机制概述 ==============
 *
 * flow 包增益：vigor/innate/inspire/allin/surplus/rewind；减益：cumbersome/leak/recoil。
 *
 *   vigor  (活力)  — 打出后：_vigor 存量跨回合保留，下一张牌 flat 加成 +3×n。
 *   innate (固有)  — 开局必在手牌（引擎自动处理，排牌组末尾首抽）。
 *   inspire(灵感)  — 本回合每抽一张牌 +n 格挡（本回合重置，引擎正确结算）。
 *   allin  (全力)  — 打出后能量恰好=0，本牌数值 ×(1+n)（引擎 playCard 结算）。
 *   surplus(余裕)  — 当前能量 ≥ max(2,5-n) 时本牌免费（引擎 playCard 结算）。
 *   rewind (回溯)  — 打出后拍下快照，下回合开始回滚（整个敌方回合被抹掉）。
 *
 * ============== 通用 V 的缺口分析 ==============
 *
 * 1. vigor 存量（_vigor）
 *    _vigor 跨回合保留，通用 V 不计这笔"欠账"。实验表明给 _vigor 存量加 battle 加权
 *    会产生「积攒而不消费」的悖论：rollout 结束评分时消耗 _vigor 让 V 下降，AI 偏好
 *    保留存量而不把效果发挥出来，净效果为负。故 battle 钩子不给 _vigor 加权。
 *    vigor 在同回合内的 chain 价值（vigor 牌 → 下一张牌加成）由 rollout 自动发现。
 *
 * 2. rewind（回溯）跨回合免伤 ← 主要缺口
 *    打出 rewind 后 g._rewindSnap 非 null；下回合开始回滚，等效于完全免一轮敌方伤害。
 *    AI 的 rollout 只在当前回合前瞻，完全看不到这笔跨回合价值。
 *    battle 钩子：_rewindSnap 存在时 +（基础值 + incoming 折现），给 AI「打出回溯后
 *    局面变好」的信号，鼓励它主动打出回溯牌。
 *    gem 钩子：rewind 宝石 +5/级（约等于 1 条命的 41%），引导 AI 优先购入/安装。
 *
 * 3. allin（全力）
 *    rollout 已能发现「恰好清空能量时乘倍」的即时收益。
 *    gem 层轻微加权（+0.5/级）鼓励 AI 购入 allin 宝石，稳定发力。
 *
 * 4. inspire/innate/surplus
 *    inspire/surplus 的即时收益 rollout 已覆盖；innate 引擎自动保证。
 *    实验表明在这三者上加权均引入负效果，不启用。
 *
 * ============== 实验历程 ==============
 *
 *   空钩子基线：                          27.5%（−6.3% vs basic 33.8%）
 *   只加 battle vigor（_vigor*0.9）：     25.0%（vigor 权重有害：积攒悖论）
 *   battle rewind（5+incoming*1.2,20）：  26.3%（方向正确但 gem 未配合）
 *   +gem rewind 5.0/级：                 36.3%（Δ+2.5%，80 局）
 *   +gem allin 0.5/级：                  38.8%（Δ+5.0%，80 局）
 *   150 局复测：                          40.0%（Δ+2.0%，稳定正向）
 *
 * ============== 残余 AI 局限 ==============
 *
 *   vigor 跨回合存量：受搜索架构限制无法被 battle 钩子正确激励（积攒悖论）。
 *   rewind 精确价值：用当前意图估 incoming，敌人实际下回合意图可能变化。
 *   整体胜率仍低于纯 basic（flow 本身减益 cumbersome/leak/recoil 削弱能量/血量），
 *   Δ+2% 属于 AI 已大幅改善后的真实水平。
 */

const value = require('../value');

value.registerPack('flow', {
  // ======================================================
  // battle 钩子：回溯快照的跨回合免伤价值（AI 单回合搜索看不到）
  // ======================================================
  battle(CG, g) {
    if (!g._rewindSnap) return 0;
    // 打出回溯后：下回合开始把敌方这一轮完全抹掉。
    // 价值 = 预计 incoming 伤害被免；+5 代表「快照本身的承诺价值」。
    // 上限 20 防止 AI 因保护快照而停止进攻（太高会导致 AI 停手保守）。
    const incoming = g.playerIncomingDamage();
    return Math.min(5 + incoming * 1.2, 20);
  },

  // ======================================================
  // gem 钩子：rewind 宝石补偿跨回合 AI 盲区；allin 轻微引导
  // ======================================================
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.rewind) v += 5.0 * a.level;  // 回溯：跨回合免伤，AI 完全看不到，给较高溢价
      if (d.allin)  v += 0.5 * a.level;  // 全力：搜索已覆盖即时收益，轻微鼓励购入
    }
    return v;
  },
});

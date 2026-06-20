'use strict';
/* 猎杀包（hunter）策略 ——「协同型」包：借敌人身上的减益层数爆发。
 *
 * 机制速览：
 *   execute  —— 敌 HP ≤ maxHP×10%×等级 时斩杀（消除「最后一击」磨损）
 *   prey     —— 打出时伤害 +（目标减益层数总和 × 等级）（damageOnly）
 *   exploit  —— 消耗目标全部减益，每层 4×等级 伤害（清空后不再影响 prey/exploit 自身）
 *   insight  —— 敌意图含 attack 时本牌伤害 ×(1+等级)（damageOnly）
 *   reaping  —— 打出后 game._reaping += 等级；之后每击杀 → 给玩家 +_reaping 力量（跨回合）
 *
 * 通用 V 的盲点：
 *   1. prey/exploit 的收益随「敌人减益层数」放大；AI 若不知道先铺减益再引爆，
 *      会乱序打牌（先用 exploit 清空再 prey，反而减益为 0）。
 *      → battle 钩子：手里有 prey/exploit 且目标有减益时给轻微塑形分，
 *        鼓励 AI 维持/先铺后打而非立即清空。
 *   2. _reaping 是「今后每次击杀给永久力量」，V 对此完全无感。
 *      → battle 钩子：按 _reaping × 剩余可击杀敌数 × 力量单价 补估值。
 *   3. reaping 宝石的标分（score=5）仅反映「打出一次」效果，长期雪球没体现。
 *      → gem 钩子给 reaping 加权；exploit 爆发量被低估时也顺便加权。
 *
 * 估值标度（README）：1 点 ≈ 0.083 HP ≈ 0.67 敌 HP；勿给几百分压过生存本能。
 */
const value = require('../value');

// ── 辅助：统计目标（或所有存活敌人中最大层数的那个）的减益层数 ──────────────────
// 与 game._enemyDebuffLayers 一致：vulnerable/weak/frail/poison/burn
const DEBUFF_KEYS = ['vulnerable', 'weak', 'frail', 'poison', 'burn'];

function enemyDebuffLayers(e) {
  return DEBUFF_KEYS.reduce((s, k) => s + (e.statuses[k] || 0), 0);
}

// ── 辅助：判断宝石词条 id 是否为某个 hunter 增益 ────────────────────────────────
function hasAffix(gem, id) {
  return (gem.affixes || []).some(a => a.id === id);
}

function affixLevel(gem, id) {
  let total = 0;
  for (const a of (gem.affixes || [])) if (a.id === id) total += a.level;
  return total;
}

// ── 辅助：手牌里是否有带 prey 或 exploit 的牌（只做轻量检查）───────────────────
function handHasExploit(CG, g) {
  for (const c of (g.hand || [])) {
    const s = CG.cardStats(c);
    if ((s.exploit || 0) > 0 || (s.prey || 0) > 0) return true;
  }
  return false;
}

value.registerPack('hunter', {
  // ── battle 钩子：补上 V 看不到的「协同持久价值」 ──────────────────────────────
  battle(CG, g) {
    let v = 0;
    const alive = g.aliveEnemies();
    if (!alive.length) return 0;

    // ① reaping 持久价值
    //    _reaping = 当前每击杀给的力量；之后还能打死 alive.length 个敌人。
    //    力量每点在通用 V 里值 6（×6 系数），但这里是「之后」的力量所以打折：×3。
    //    上限：别超过几十，免得完全压制生存评估。
    const reaping = g._reaping || 0;
    if (reaping > 0) {
      // 还剩 N 个敌人可被击杀（当前 + 后续房，但这里只能看战斗内的存活数）
      // 乘 3 = 粗略折现的力量价值（1 力量×3 < 6，因为力量在此战可能用不满）
      const killsLeft = alive.length;
      v += reaping * killsLeft * 3;
      // 后续房还能用这些力量（跨战斗），给额外小加成
      v += reaping * 2;
    }

    // ② prey/exploit 与目标减益的协同塑形分
    //    当手里有 prey/exploit 且当前目标（或任意存活敌人）有减益时，
    //    给少量分数表示「局面对 hunter 有利，维持减益有价值」。
    //    注意：exploit 会消耗减益，所以这里只给塑形，不直接估算伤害（引擎已做）。
    if (handHasExploit(CG, g)) {
      // 找减益层最多的存活敌人
      let maxLayers = 0;
      for (const e of alive) {
        const layers = enemyDebuffLayers(e);
        if (layers > maxLayers) maxLayers = layers;
      }
      if (maxLayers > 0) {
        // 每层减益对 hunter 多大价值：exploit 每层打 4 伤、prey 每层多 1 伤（含等级）
        // 这里只给「引导维持」的塑形分，真正伤害引擎会评估
        // 轻量：每层 +0.8，上限约 +6（1 条命=12），别过重
        v += Math.min(maxLayers * 0.8, 6);
      }
    }

    // ③ execute 的残血消除价值
    //    当某个敌人 HP 很低（≤15% maxHP），execute 宝石能一刀斩杀，省下后续回合伤害。
    //    V 里 near-dead（hp≤12）已给 +10，此处补「execute 让斩杀阈值更宽」的塑形。
    //    只在手牌里有 execute 牌时加分。
    let handHasExecute = false;
    for (const c of (g.hand || [])) { if ((CG.cardStats(c).execute || 0) > 0) { handHasExecute = true; break; } }
    if (handHasExecute) {
      for (const e of alive) {
        const ratio = e.hp / e.maxHp;
        if (ratio <= 0.2 && ratio > 0) {
          // 敌人在「快死但 V 未满分」区间（12 < hp ≤ 20% maxHP）
          v += 3;
        }
      }
    }

    return v;
  },

  // ── gem 钩子：重定价被低估的 hunter 词条 ──────────────────────────────────────
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (!d) continue;

      // reaping（score=5）：长期雪球——每击杀+力量，在多敌人战/精英/boss 战高度值钱
      // 但只在还没有 _reaping 积累时值 extra；此处给静态加权（与 battle 钩子互补）
      if (d.reaping) v += 4 * a.level;             // 比 score 多约 4×L（雪球核心）

      // exploit（score=4）：消耗全部减益×4×等级 → 高层数时爆发极大，低估
      // 给中等加成鼓励持有，实际伤害已由引擎评估
      if (d.exploit) v += 2 * a.level;

      // execute（score=5）：消除「磨最后一滴血」的回合损耗，实战很省事
      // 通用 score 已有 5，这里只给小加权
      if (d.execute) v += 1.5 * a.level;

      // prey（score=4）：和 exploit 协同用，但 damageOnly → 装错牌上完全浪费
      // 本身价值受减益层数影响，变化较大；此处轻微加权
      if (d.prey) v += 1 * a.level;

      // hunter 包的减益词条：expose(自身易伤) / coward(失力量) 本来是惩罚，
      // 不额外加权（它们的负分已在通用 gemValue 里体现；额外惩罚会让 AI 过于保守导致宝石过少）
    }
    return v;
  },

  // ── install 钩子：引导 prey/exploit/insight/execute 装到攻击牌 ─────────────────
  install(CG, gem, card) {
    // 检查宝石是否含 hunter 的 damageOnly 词条（prey/insight）或 exploit
    const hasPrey    = affixLevel(gem, 'prey')    > 0;
    const hasExploit = affixLevel(gem, 'exploit') > 0;
    const hasInsight = affixLevel(gem, 'insight') > 0;
    const hasExec    = affixLevel(gem, 'execute') > 0;
    const hasReaping = affixLevel(gem, 'reaping') > 0;

    const isAttackGem = hasPrey || hasExploit || hasInsight || hasExec;
    const isAnyHunter = isAttackGem || hasReaping;

    if (!isAnyHunter) return 0;

    // prey/insight 是 damageOnly：装在防御牌上完全没效果 → 大幅降分
    if ((hasPrey || hasInsight) && card.base === 'defend') return -0.35;

    // exploit/execute 需要打出才触发，装在攻击牌更容易打出 → 小加分
    if ((hasExploit || hasExec) && card.base === 'strike') return 0.1;

    // reaping 装哪都行（打出时触发），无特殊引导
    return 0;
  },
});

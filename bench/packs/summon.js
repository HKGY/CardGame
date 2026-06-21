'use strict';
/* 召唤包（summon）策略 —— v3 原子模型重写。
 *
 * v3 召唤 = 价值原子 `summon`（固定召出骷髅：2×L 血 / L 攻；回合末 _allyAttack() 自动打当前敌人）。
 * game.allies[] 跨回合保留（上限 6）。v3 已无 swarm/totem/guardian/command/culling/discord 词条
 *   （那些是 v2 机制、现表里不存在）→ 召唤宝石产出的恒是「纯攻击型骷髅」(taunt=false, giveBlock=0)；
 *   本钩子仍对 taunt/giveBlock 留守卫，以兼容引擎里别处来的此类召唤物。
 *
 * —— 关于「与核心 V 双重计」——
 * 任务设定假设核心 value.js 的 V 已给 allies 估值（atk×4+giveBlock×3+hp×…）。但实测当前 bench/value.js
 * 的 V（projHp/ehp/状态…）**完全没有 allies 项**（`value.V.toString()` 不含 `allies`/`giveBlock`，
 * 见下 CORE_VALUES_ALLIES 探测；git 历史里 `taunt?0.8` 公式从未存在）。
 * 故现状下：核心 V 对召唤物一无所知 → 若本钩子只补「嘲讽挡刀 + 早铺溢价」，骷髅的实际攻击/格挡产出会
 * 完全无人估值 → AI 永不铺场、召唤包形同废包。
 * 解法：本 battle 钩子按「核心 V 是否已估 allies」自适应——
 *   · 核心 V 未估（当前真实情况）→ 本钩子**独家**给出整副板面价值（攻击产出 + 格挡产出 + 嘲讽 + 早铺）。
 *   · 核心 V 已估（任务假设 / 将来若加上）→ 自动降级为**只补 V 没覆盖的**（嘲讽挡刀折现 + 早回合复利溢价），
 *     绝不重复加 atk/block/hp 板面。
 * 这样两种世界都正确、且零手动双重计。
 */
const value = require('../value');

// 探测核心 V 是否已经给 allies 板面估值（非递归：读 V 源码字符串，模块加载时算一次）。
const CORE_VALUES_ALLIES = (() => {
  try { return /\.allies\b/.test(value.V.toString()); } catch (e) { return false; }
})();

value.registerPack('summon', {
  // ---- 局面附加分 ----
  battle(CG, g) {
    const allies = (g.allies || []).filter(a => a && a.hp > 0);
    if (!allies.length) return 0;

    // 敌方本回合（下次行动）打来的单批伤害总量 —— 嘲讽召唤物能替你吃掉「一次」攻击。
    let incomingBatch = 0;
    for (const e of g.aliveEnemies()) {
      const p = g.intentPreview ? g.intentPreview(e) : null;
      if (p && p.damage != null) incomingBatch += p.damage * (p.hits || 1);
    }

    let v = 0;
    let board = 0;            // 整副板面价值（攻击产出 + 格挡产出 + 残值）—— 仅在核心 V 未估时由本钩子给出
    let hasTaunt = false;

    for (const a of allies) {
      // 期望寿命折现：HP 越低越像消耗品（折算其后续回合的持续产出能兑现多少）。
      const hpRatio = a.maxHp > 0 ? Math.min(1, a.hp / a.maxHp) : 1;
      const survive = a.hp <= 2 ? 0.45 : a.hp <= 6 ? 0.72 : 0.1 + hpRatio * 0.9;

      // 攻击产出：每回合末 atk × 1.5（消敌血价值）；以 survive 折算未来若干回合的兑现。
      if (a.atk > 0) board += a.atk * 1.5 * survive;
      // 格挡产出（图腾类，v3 召唤一般为 0）：溢出格挡 ~0.25/点，再按 survive 折现。
      if (a.giveBlock > 0) board += a.giveBlock * 0.25 * survive;

      // 嘲讽：只第一个有效（多个嘲讽重叠收益边际无意义）。挡住一次攻击 ≈ 省下这批伤害。
      // 此项 V 永远没覆盖（projHp 不含「下回合伤害会被召唤物吃掉」），故无论 CORE_VALUES_ALLIES 都补。
      if (a.taunt && !hasTaunt) {
        hasTaunt = true;
        const absorb = Math.min(incomingBatch, 22);             // 单次吸收上限，防爆分
        v += Math.min(15, absorb * survive * 0.9);              // 折算成 VP，封顶 15（别压过保命权重）
      }
    }

    if (!CORE_VALUES_ALLIES) {
      // 核心 V 未估 allies（当前真实情况）：本钩子独家给整副板面价值。
      // 折现系数 ~2.5 ≈ 未来 2~3 回合持续产出的现值（太高会为保召唤物放弃防御）。
      v += board * 2.5;
    }
    // 早回合铺场溢价（未来收益回合更多 → 复利）：这是 V 提前体现不了的，两种世界都补。
    if (g.turn <= 3 && board > 0) v += board * 0.5;

    return v;
  },

  // ---- 宝石价值附加分（构筑层）----
  // 召唤宝石「越早抽越值」：板面随回合复利，前期入手能多攒好几轮产出；
  // 但牌组已堆很多召唤来源时边际递减（上限 6 个召唤物、督战/集火早就够用）。
  gem(CG, gem, ctx) {
    let summonLv = 0;
    for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (d && d.summon) summonLv += a.level; }
    if (!summonLv) return 0;

    // 统计牌组已有的召唤来源等级（越多 → 这颗边际越低）。
    let deckSummon = 0;
    const run = ctx && ctx.run;
    for (const c of ((run && run.deck) || [])) for (const sk of (c.sockets || [])) for (const a of (sk.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (d && d.summon) deckSummon += a.level;
    }
    // 早抽溢价：牌组召唤来源稀少 → +2/级；已铺很多 → 边际递减、过量转负（避免无脑全召唤）。
    const per = deckSummon <= 2 ? 2.0 : deckSummon <= 5 ? 0.8 : -0.8;
    return summonLv * per;
  },

  // ---- 回合内选牌（playPolicy）----
  // 早铺早赚：回合早 / 场上召唤物少时，优先打召唤牌（让骷髅多吃几轮 _allyAttack）。
  playPolicy(CG, g, card, s) {
    const summons = (s.effects || []).filter(e => e.type === 'summon');
    if (!summons.length) return 0;
    const onBoard = (g.allies || []).filter(a => a && a.hp > 0).length;
    if (onBoard >= 6) return -4;                          // 已满员：召唤被浪费，别再打
    let b = 0;
    if (g.turn <= 2) b += 14;                             // 极早铺场：未来兑现回合最多
    else if (g.turn <= 4) b += 7;
    if (onBoard <= 1) b += 6;                             // 场上空/稀 → 急需铺场
    return b;
  },
});

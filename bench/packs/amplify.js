'use strict';
/* 放大包（amplify）策略模块 —— M3 模式：通过 value.registerPack 注入估值钩子。
 *
 * 机制概要：
 *   potent（强效）：本牌伤害/格挡/治疗 ×(1+等级)，playCard 即时翻倍——搜索自动评估。
 *   amppain（倍损）：置本回合 _ampDebuff 旗，同回合施加的 vulnerable/weak/frail/poison/burn ×2。
 *   ampgain（倍益）：置本回合 _ampBuff 旗，同回合获得的 strength/dexterity/regen/thorns/nourish ×2。
 *   boon（激赏）：给临时力量 2×等级，本回合末清除。
 *   polarize（极化）：当前力量翻倍。无力量时无效。
 *
 * 核心 gap 与设计思路：
 *   1. amppain/ampgain 是「先开旗、再出目标牌」的同回合序列，rollout topK=4 可能漏掉；
 *      battle 钩子补：旗已立且手有目标牌时→给正分；手有 amppain+减益牌共存时→小塑形分。
 *   2. polarize 无力量时废牌，gem 钩子：无力量来源→减分（避免装），有来源→加分。
 *   3. amppain/ampgain gem 本身的价值依赖搭配，gem 钩子检测 run.deck。
 *   4. 避免调用 CG.cardStats（太慢）；改用直接遍历 sockets.affixes 检测词条 id。
 *
 * 标度（README）：1点力量≈6分，1点血≈12分。
 */
const value = require('../value');

// ---- 辅助：词条 id 是否对应「施加减益给敌人」（被 amppain 翻倍的减益）----
// 这些 affix 含 apply:{vulnerable/weak/frail/poison/burn} 字段
const ENEMY_DEBUFF_AFFIXES = new Set(['suppress', 'neutralize', 'shatter', 'poison', 'freeze']);
// 注：freeze 对应 apply:{frozen}，frozen 不在 amppain 列表里，但留着不影响（小误判可接受）
// 精确列表：suppress→vulnerable, neutralize→weak, shatter→frail, poison→poison
// burn 词条（灼伤 exhaust 包）来自 selfBurn，不适用
// 实际上 amppain 翻倍：vulnerable/weak/frail/poison/burn；我们检测 apply 含这些 key 的词条
const AMP_DEBUFF_IDS = new Set(['suppress', 'neutralize', 'shatter', 'poison']);

// 辅助：词条 id 是否对应「给自身增益」（被 ampgain 翻倍的增益）
// ampgain 翻倍：strength/dexterity/regen/thorns/nourish（通过 selfStatus 字段）
// boon 自己是 addTempStrength（内部走 applyStatus strength），也算
const AMP_GAIN_SELF_IDS = new Set(['boon']); // 直接词条 id
// selfStatus 类需要配合 CG.AFFIXES 检测，但为了性能先用静态集合：
// 典型词条：vitality(生机包) selfStatus:regen, thorns, nourish; power 包/strength 词条
// 在 gem 钩子里（只用 run.deck 遍历）我们直接检测 id。
// 在 battle 钩子里（用 g.hand 遍历）我们需要识别任意含 selfStatus:strength/... 的词条
// 方案：battle 钩子里懒加载 CG.AFFIXES 检测（CG 作为参数传入，可以直接查）

// 辅助：手牌中是否有可被 amppain 翻倍的减益牌（遍历 sockets 直接检测词条 id）
function handHasAmpDebuffTarget(CG, g) {
  for (const c of g.hand) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (AMP_DEBUFF_IDS.has(a.id)) return true;
        // 也检测任何含 apply.vulnerable/weak/frail/poison/burn 的词条
        const d = CG.AFFIXES[a.id];
        if (d && d.apply) {
          for (const k in d.apply) {
            if (k === 'vulnerable' || k === 'weak' || k === 'frail' || k === 'poison' || k === 'burn') return true;
          }
        }
      }
    }
  }
  return false;
}

// 辅助：手牌中是否有可被 ampgain 翻倍的增益牌（selfStatus:strength/dexterity/regen/thorns/nourish 或 boon）
function handHasAmpGainTarget(CG, g) {
  for (const c of g.hand) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (a.id === 'boon') return true;
        const d = CG.AFFIXES[a.id];
        if (d && d.selfStatus) {
          const ss = d.selfStatus;
          if (ss === 'strength' || ss === 'dexterity' || ss === 'regen' || ss === 'thorns' || ss === 'nourish') return true;
        }
      }
    }
  }
  return false;
}

// 辅助：手牌中是否有 amppain 效果的牌
function handHasAmppain(g) {
  for (const c of g.hand) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (a.id === 'amppain') return true;
      }
    }
  }
  return false;
}

// 辅助：手牌中是否有 ampgain 效果的牌
function handHasAmpgain(g) {
  for (const c of g.hand) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (a.id === 'ampgain') return true;
      }
    }
  }
  return false;
}

// 辅助：手牌/抽牌堆/弃牌堆中是否有某词条 id（用于 battle 的 polarize 检测）
function deckHasAffixId(g, id) {
  const piles = [g.hand, g.drawPile, g.discardPile];
  for (const pile of piles) {
    for (const c of pile) {
      for (const sock of (c.sockets || [])) {
        for (const a of (sock.affixes || [])) {
          if (a.id === id) return true;
        }
      }
    }
  }
  return false;
}

// 辅助：run.deck 是否有施加减益给敌人的词条（amppain 的搭配条件）
function runDeckHasEnemyDebuff(CG, run) {
  if (!run || !run.deck) return false;
  for (const c of run.deck) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (AMP_DEBUFF_IDS.has(a.id)) return true;
        const d = CG.AFFIXES[a.id];
        if (d && d.apply) {
          for (const k in d.apply) {
            if (k === 'vulnerable' || k === 'weak' || k === 'frail' || k === 'poison' || k === 'burn') return true;
          }
        }
      }
    }
  }
  return false;
}

// 辅助：run.deck 是否有自身增益词条（ampgain 的搭配条件）
function runDeckHasSelfBuff(CG, run) {
  if (!run || !run.deck) return false;
  for (const c of run.deck) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (a.id === 'boon') return true;
        const d = CG.AFFIXES[a.id];
        if (d && d.selfStatus) {
          const ss = d.selfStatus;
          if (ss === 'strength' || ss === 'dexterity' || ss === 'regen' || ss === 'thorns' || ss === 'nourish') return true;
        }
      }
    }
  }
  return false;
}

// 辅助：run.deck 是否有力量来源（polarize 的前提）
function runDeckHasStrengthSource(run) {
  if (!run || !run.deck) return false;
  for (const c of run.deck) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (a.id === 'boon') return true;
        // 其他 selfStatus:strength 的词条（目前主要是 boon）
      }
    }
  }
  return false;
}

// 辅助：run.deck 是否含指定词条 id
function runDeckHasAffixId(run, id) {
  if (!run || !run.deck) return false;
  for (const c of run.deck) {
    for (const sock of (c.sockets || [])) {
      for (const a of (sock.affixes || [])) {
        if (a.id === id) return true;
      }
    }
  }
  return false;
}

// 辅助：gem 中的总 cumbersome 等级（增加打出费用）
function totalCumbersome(gem) {
  let n = 0;
  for (const a of (gem.affixes || [])) { if (a.id === 'cumbersome') n += a.level; }
  return n;
}
// 辅助：gem 中的总 blunt 等级（减少数值）
function totalBlunt(gem) {
  let n = 0;
  for (const a of (gem.affixes || [])) { if (a.id === 'blunt') n += a.level; }
  return n;
}

value.registerPack('amplify', {
  // ---- 局面附加分 ----
  battle(CG, g) {
    let v = 0;
    const str = g.player.statuses.strength || 0;

    // ① 倍损旗已立，手里还有可受益的减益牌 → 本回合处于翻倍窗口
    if ((g._ampDebuff || 0) > 0 && handHasAmpDebuffTarget(CG, g)) {
      // 减益价值翻倍：约 1.5层 × 2.5分 extra = +3.75
      v += 4;
    }

    // ① 倍益旗已立，手里还有可受益的增益牌
    if ((g._ampBuff || 0) > 0 && handHasAmpGainTarget(CG, g)) {
      // 力量增益翻倍：约 2层 × 6分 extra = +12 → 保守给 5
      v += 5;
    }

    // ② 手里同时有 amppain + 减益牌（尚未打出 amppain），给小的序列塑形分
    //    让 rollout 更倾向把 amppain 列入 topK 候选（先开旗再出减益）
    if (handHasAmppain(g) && handHasAmpDebuffTarget(CG, g)) {
      v += 2;
    }

    // ② 手里同时有 ampgain + 增益牌
    if (handHasAmpgain(g) && handHasAmpGainTarget(CG, g)) {
      v += 2.5;
    }

    // ③ polarize 潜力：有力量且牌组有 polarize（搜索 rollout 应能找到序列，这里轻微提示）
    if (str >= 2 && deckHasAffixId(g, 'polarize')) {
      // 打出 polarize 净增 str×6 分；这里给约 1/3 作为「还没打出时的潜力分」
      v += Math.min(str * 2, 6);
    }

    return v;
  },

  // ---- 宝石价值附加分 ----
  gem(CG, gem, ctx) {
    const run = ctx && ctx.run;
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (!d) continue;

      if (a.id === 'polarize') {
        // polarize 完全依赖有力量来源（boon/selfStatus:strength）
        // 也考虑本 gem 自身是否有 boon（同一颗宝石中 polarize+boon 组合）
        const gemHasBoon = (gem.affixes || []).some(x => x.id === 'boon');
        const hasSource = gemHasBoon || runDeckHasStrengthSource(run);
        if (!hasSource) {
          // 无来源：当前效果不佳，但 boon 是高频词条（12%），可能很快出现。
          // 给小正值让 AI 保留到背包，等有了 boon 再发挥价值；但不安装（不加大正值）。
          // base score=4*L → 给轻微负校正（不要彻底拒绝纯 polarize gem）
          v -= 2 * a.level;   // 轻微惩罚（从8降到4-6），让AI保留但不优先
        } else {
          v += 3 * a.level;   // 有来源：极化潜力高
        }
      }

      if (a.id === 'amppain') {
        // 倍损依赖牌组有减益目标（或本 gem 自身含减益词条）
        const gemHasDebuff = (gem.affixes || []).some(x => {
          const d2 = CG.AFFIXES[x.id]; return d2 && d2.apply && Object.keys(d2.apply).some(k => ['vulnerable','weak','frail','poison','burn'].includes(k));
        });
        const hasDebuff = gemHasDebuff || runDeckHasEnemyDebuff(CG, run);
        if (!hasDebuff) {
          v -= 3 * a.level;   // 无减益来源：倍损没目标
        } else {
          v += 2 * a.level;   // 有减益来源：翻倍很值
        }
      }

      if (a.id === 'ampgain') {
        // 倍益依赖牌组有增益目标（或本 gem 自身含增益词条）
        const gemHasGain = (gem.affixes || []).some(x => {
          if (x.id === 'boon') return true;
          const d2 = CG.AFFIXES[x.id]; return d2 && d2.selfStatus && ['strength','dexterity','regen','thorns','nourish'].includes(d2.selfStatus);
        });
        const hasGain = gemHasGain || runDeckHasSelfBuff(CG, run);
        if (!hasGain) {
          v -= 2 * a.level;   // 无增益来源
        } else {
          v += 2 * a.level;   // 有增益来源
        }
      }

      // boon 的连招加成：
      // ① boon + polarize：先给力量后翻倍（boon×N → polarize → str×2）
      if (a.id === 'boon' && runDeckHasAffixId(run, 'polarize')) {
        v += 2 * a.level;  // polarize 把力量翻倍：boon 价值显著提升
      }
      // ② ampgain + boon：倍益旗立后打出 boon → 临时力量翻倍（4N 而非 2N）
      if (a.id === 'boon' && runDeckHasAffixId(run, 'ampgain')) {
        v += 1.5 * a.level;  // 临时力量翻倍
      }

      // potent 独立有效，通用 score=5 已合理
    }

    return v;
  },

  // ---- 安装契合度 ----
  install(CG, gem, card) {
    let b = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (!d) continue;
      // potent：本牌数值翻倍，装在主攻/主守牌上收益最大
      if (a.id === 'potent') {
        if (card.base === 'strike' || card.base === 'defend') b += 0.2;
      }
      // boon/polarize：力量来源，优先装在打击牌
      if (a.id === 'boon' || a.id === 'polarize') {
        if (card.base === 'strike') b += 0.1;
      }
      // ---- 惩罚：amplify 减益词条装在错误基底上 ----
      // cumbersome（费用+1）：装在 defend 上极坏（防御回合总费用有限）；装在 strike 上也坏
      if (a.id === 'cumbersome') {
        if (card.base === 'defend') b -= 0.5;   // 严重惩罚（防御费用更宝贵）
        else b -= 0.2;
      }
      // blunt（数值-2×N）：装在 defend 上减少格挡，装在 strike 上减少伤害——都很坏
      if (a.id === 'blunt') {
        if (card.base === 'defend') b -= 0.4;   // 减格挡：防御目的落空
        else if (card.base === 'strike') b -= 0.3; // 减伤：进攻效率下降
      }
      // recoil（失去HP）：装在任何牌上都要小心；但不特别偏向某基底
      // amppain/ampgain：优先装在低费（1费）的牌上以最大化利用能量窗口
      if ((a.id === 'amppain' || a.id === 'ampgain') && card.base === 'strike') b += 0.05;
    }
    return b;
  },
});

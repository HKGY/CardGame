'use strict';
/* 死守包（bastion）v3 策略钩子 —— 旧版的 keepBlock/shieldBash 词条在 v3 已全删（是死代码），此处重写。
 *
 * v3 死守＝3 个价值原子：
 *   · block（格挡）          —— 攒护盾。
 *   · tempStr（临时力量）    —— 本回合加伤。
 *   · 条件分子 curBlock_damage（当前格挡 → 伤害，即旧「盾击」）—— 把当前格挡换算成伤害。
 * 玩法：**攒格挡 → 用 curBlock 牌把（溢出的）格挡转成伤害**。
 *
 * 通用 V 盲区（→ 必须 per-pack 钩子）：
 *   · V 只把溢出格挡算 0.2/点（重甲产出局视角，偏低）。但牌组里若有 curBlock 转化牌，
 *     当前 player.block（尤其溢出部分）是「待击发的弹药」，边际价值高得多。→ battle 补。
 *   · 「既要格挡产出、又要转化牌」是个**牌组构筑均衡**问题，V 从不参与抽卡。→ gem 补。
 *   · 「现在该攒盾还是该转伤害」是回合内的出牌时序，V 看不到。→ playPolicy 补。
 */
const value = require('../value');

// 一颗宝石里：是否含 curBlock 转化牌词条 / 格挡产出词条（按价值原子识别）。
function gemHas(CG, gem) {
  let conv = 0, blk = 0;                                // conv=转化等级, blk=格挡产出等级
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d) continue;
    if (d.condBonus && d.condBonus.qty === 'curBlock') conv += (a.level || 1);   // 转化牌（含→伤害/格挡/治疗）
    else if (d.value && d.value.res === 'block') blk += (a.level || 1);          // 纯格挡产出
  }
  return { conv, blk };
}

// 扫一副牌（手牌/抽牌/弃牌 或 run.deck）里 curBlock 转化牌、格挡产出的总量。
function scanDeck(CG, cards) {
  let conv = 0, blk = 0;
  for (const c of (cards || [])) for (const sk of (c.sockets || [])) for (const a of (sk.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d) continue;
    if (d.condBonus && d.condBonus.qty === 'curBlock') conv += (a.level || 1);
    else if (d.value && d.value.res === 'block') blk += (a.level || 1);
  }
  return { conv, blk };
}

// 当前战斗的牌（手牌+抽牌+弃牌）里有没有 curBlock 转化牌（弹药有没有出口）。
function battleHasConverter(CG, g) {
  for (const pile of [g.hand, g.drawPile, g.discardPile]) {
    for (const c of (pile || [])) for (const sk of (c.sockets || [])) for (const a of (sk.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (d && d.condBonus && d.condBonus.qty === 'curBlock') return true;
    }
  }
  return false;
}
// 一张候选牌（cardStats 输出）是不是 curBlock 转化牌。
function isConverterCard(s) { return !!(s && s.condBonus && s.condBonus.some(c => c.qty === 'curBlock')); }
// 一张候选牌是不是「格挡产出」牌（打出后涨 block，用来攒弹药；非转化牌）。
function isBlockGainCard(s) {
  if (!s || isConverterCard(s)) return false;
  if (s.kind === 'block') return true;
  return (s.effects || []).some(e => e.type === 'block' && (e.value || 0) > 0);
}

value.registerPack('bastion', {
  // 构筑层：要「格挡产出」与「curBlock 转化牌」两半都有；给缺的那半更高价值。
  gem(CG, gem, ctx) {
    const { conv, blk } = gemHas(CG, gem);
    if (!conv && !blk) return 0;                       // 与本包无关
    const run = ctx && ctx.run;
    let deckConv = 0, deckBlk = 0;
    if (run && run.deck) { const t = scanDeck(CG, run.deck); deckConv = t.conv; deckBlk = t.blk; }

    let v = 0;
    // 转化牌：没有它格挡只能挨打。牌组里转化牌越缺，越想要（缺出口）。
    if (conv) v += conv * (deckConv === 0 ? 2.5 : 1.0);
    // 格挡产出：是转化牌的「弹药」。已有转化牌却格挡来源不足 → 它更值钱（缺弹药）。
    if (blk) {
      const ammoShort = deckConv > 0 && deckBlk < deckConv * 2;   // 有出口但弹药偏少
      v += blk * (ammoShort ? 2.0 : 0.8);
    }
    return v;
  },

  // 战斗层：有转化牌时，当前格挡（尤其溢出部分）是「待击发的弹药」，通用 V 只给 0.2/点（偏低）。
  battle(CG, g) {
    if (!battleHasConverter(CG, g)) return 0;          // 没出口：通用 0.2/点已够，不额外加
    const block = g.player.block || 0; if (block <= 0) return 0;
    const incoming = (typeof g.playerIncomingDamage === 'function') ? g.playerIncomingDamage() : 0;
    const overflow = Math.max(0, block - incoming);    // 挡完伤害后还剩的＝可安全转伤害的弹药
    // 通用 V 已给 overflow×0.2；这里再追加 ~0.4/点（合计约 0.6/点，仍远小于保命 12/点血）。
    return overflow * 0.4;
  },

  // 出牌层：弹药满了就该击发、弹药空了就先攒。
  playPolicy(CG, g, card, s) {
    const hasConverterInHand = (g.hand || []).some(h => {
      const hs = CG.cardStats(h); return isConverterCard(hs);
    });
    const block = g.player.block || 0;
    const incoming = (typeof g.playerIncomingDamage === 'function') ? g.playerIncomingDamage() : 0;
    const overflow = Math.max(0, block - incoming);

    if (isConverterCard(s)) {
      // 手里这张就是转化牌：格挡越高、可转的弹药越多 → 越该现在打（把溢出格挡兑现成伤害）。
      // 偏好随溢出格挡线性增长并封顶（避免压过致命/救命牌）。
      if (overflow >= 6) return Math.min(8 + overflow * 1.2, 36);   // 弹药充足：强偏好击发
      if (block <= 3) return -10;                                    // 几乎没盾就打转化＝空炮 → 压后
      return 0;
    }
    if (hasConverterInHand && isBlockGainCard(s)) {
      // 手里攥着转化牌、但弹药（格挡）还不够 → 偏好先打「格挡产出」牌攒弹药。
      if (overflow < 6) return 12;                     // 弱~中偏好：先攒盾，下张再转化
      return 0;                                          // 弹药已够，不再催着攒
    }
    return 0;
  },
});

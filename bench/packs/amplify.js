'use strict';
/* 放大包（amplify）v3 策略钩子 —— 价值原子 = `mult`(翻倍/potent) / `lifesteal`(吸血) / `multi`(多段)。
 *
 * 三者都是「乘在本牌伤害上」的放大器，单独无意义、装在大伤害牌上才爆发：
 *   · mult（强效/potent）：本牌伤害/格挡/治疗 ×(1+等级)，playCard 即时结算（s.potent）。
 *   · lifesteal（吸血）：按对主目标造成伤害的 N% 回血（s.lifesteal，以 1% 计）。
 *   · multi（多段）：打出时耗尽全部能量、整张牌重复「能量」次（s.multi=1，maxCount 1）。
 *
 * 与核心 V 的分工：翻倍/吸血/多段的「打出后」结果（更高伤害、回血、多段总伤）已被搜索/rollout
 *   真实展开、核心 V 自动捕捉，故 battle 无需补。V 表达不出的两类用钩子补：
 *   · 构筑层(gem)：放大器越多越没用（需要「大牌底座」去乘）→ 边际定价。
 *   · 出牌层(playPolicy)：把翻倍/多段乘在「本牌基础数值大」的那张上（连招峰值），逐手贪心易忽略。
 */
const value = require('../value');

// 一颗宝石里放大器（mult/lifesteal/multi）的总等级。
function gemAmpLevel(CG, gem) {
  let n = 0;
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d) continue;
    const atom = d.value && d.value.atom;
    if (atom === 'mult' || atom === 'lifesteal' || atom === 'multi') n += (a.level || 1);
  }
  return n;
}
// 牌组里「大伤害底座」的数量（放大器要乘的对象）：含 damage 价值原子的卡片数。
function deckDamageCards(CG, run) {
  let n = 0;
  for (const c of ((run && run.deck) || [])) {
    let hasDmg = false;
    for (const sk of (c.sockets || [])) for (const a of (sk.affixes || [])) {
      const d = CG.AFFIXES[a.id];
      if (d && d.value && d.value.atom === 'damage') { hasDmg = true; break; }
    }
    if (hasDmg) n++;
  }
  return n;
}

value.registerPack('amplify', {
  // 把放大乘在大牌上：potent / multi 牌且本身基础数值高 → 现在打它（连招峰值）。
  playPolicy(CG, g, card, s) {
    const amp = s.potent || s.multi || 0;
    if (!amp) return 0;
    // 本牌基础伤害（翻倍/多段乘的就是它）。
    let base = s.value || 0;
    if (!base) for (const e of (s.effects || [])) if (e.type === 'damage') base += (e.value || 0) * (e.hits || 1);
    if (base < 10) return 0;                          // 乘在小牌上收益有限：不急（让搜索按即时 V 自行决定）
    return Math.min(30, Math.round(base * amp / 3));  // 翻倍净增 ≈ base×amp 点；给约 1/3 作偏好，封顶
  },
  // 构筑层：放大器需要「大伤害底座」去乘；牌组缺底座时多余的放大器是空头。
  gem(CG, gem, ctx) {
    const ampLv = gemAmpLevel(CG, gem);
    if (!ampLv) return 0;
    const run = ctx && ctx.run;
    const dmgCards = deckDamageCards(CG, run);
    // 有底座可乘 → 放大器值钱（每级 ~1.5）；底座很少 → 边际递减（无处可乘）。
    const per = dmgCards >= 3 ? 1.5 : dmgCards >= 1 ? 0.8 : 0.2;
    return ampLv * per;
  },
});

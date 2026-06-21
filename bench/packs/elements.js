'use strict';
/* 元素包（elements）v3 策略钩子 ——「连招型」包，最需要 per-pack 策略。
 *
 * v3 元素原子：附火/水/雷/冰（fire/water/thunder/ice），打出带该宝石的攻击牌时给当前目标附 (base×L) 层
 * 元素光环（敌人身上至多 1 种、上限 3）。**单一元素几乎无收益**（无反应时只有附着层数的微小穿透）；
 * 真正的爆发来自「凑两种异元素、轮流命中触发反应」：
 *   蒸发/融化(fire×water / fire×ice) → 本牌伤害 ×2；超载(fire×thunder) → 20 穿透；
 *   感电(thunder×water) → 5 毒；冻结(ice×water) → 跳过一次行动；超导(ice×thunder) → 4 易伤。
 *
 * V 的盲区（→ 必须钩子）：
 *   ① 反应的「铺垫顺序」：要先附 A、再用异元素 B 命中。搜索逐手贪心可能在「只附了 A、当回合 V 不升」时
 *      就放弃 → 错过下一手的爆发。playPolicy 在「目标已有可反应光环、且本牌是能反应的异元素」时强偏好它。
 *   ② 构筑：拿 3 颗同元素永远凑不出反应。gem 钩子奖励「能与牌组已有元素反应的异元素」、惩罚三拼同元素；
 *      install 钩子把不同元素分散到不同的卡（cardStats 取最后一个 element，同卡多元素会互相覆盖）。
 *
 * 边界：反应的即时收益（毒/冻/易伤/×2 伤害）落地后已被核心 V 自动捕捉，故 battle 钩子只做**很轻**的
 * 塑形（鼓励「手里有异元素牌去打已有光环的敌人」这一态势），量级压在「半条命≈6VP」以下，不盖过 V。
 */
const value = require('../value');

// 元素反应对：哪两个元素能发生反应（4 元素两两皆可反应）。
const REACT_PAIRS = [
  ['fire', 'water'], ['fire', 'ice'], ['fire', 'thunder'],
  ['thunder', 'water'], ['ice', 'water'], ['ice', 'thunder'],
];
function reactsWith(el) {
  const out = [];
  for (const [a, b] of REACT_PAIRS) { if (a === el) out.push(b); else if (b === el) out.push(a); }
  return out;
}

// 从一颗宝石的词条里取元素 id（取最后一个 element 词条，与 cardStats 行为一致）。
function gemElement(CG, gem) {
  let el = null;
  for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (d && d.element) el = d.element; }
  return el;
}
// 取一张卡（其孔位宝石聚合后）的元素 id。
function cardElement(CG, card) {
  let el = null;
  for (const g of (card.sockets || [])) { const e = gemElement(CG, g); if (e) el = e; }
  return el;
}

// 统计 deck 已装元素（按卡聚合后的元素，每张卡贡献其最终元素 1 次）+ 背包未装宝石（半权重）。
// 返回 Map<element, count>。
function deckElements(CG, run) {
  const m = new Map();
  for (const card of (run.deck || [])) {
    const el = cardElement(CG, card);
    if (el) m.set(el, (m.get(el) || 0) + 1);
  }
  for (const g of (run.gems || [])) {
    const el = gemElement(CG, g);
    if (el) m.set(el, (m.get(el) || 0) + 0.5);
  }
  return m;
}

value.registerPack('elements', {
  // ---------- 构筑层：奖励「能与已有元素反应的异元素」，惩罚三拼同元素 ----------
  gem(CG, gem, ctx) {
    const el = gemElement(CG, gem);
    const run = ctx && ctx.run;
    if (!el || !run) return 0;

    const m = deckElements(CG, run);
    const distinct = m.size;
    const sameCount = m.get(el) || 0;
    let reactingPartners = 0;
    for (const p of reactsWith(el)) if (m.has(p)) reactingPartners++;

    let bonus;
    if (distinct === 0) {
      bonus = 3;                                   // 第一颗元素：建立体系，中等奖励
    } else if (reactingPartners > 0) {
      bonus = 5 + reactingPartners * 2;            // 能凑反应的异元素：核心奖励（反应路径越多越灵活）
    } else {
      bonus = 1;                                   // 4 元素两两皆反应，此分支基本不触发；保守给点
    }
    // 同元素堆叠递减：已有 2 颗同元素时第三颗几乎是浪费（凑不出新反应）。
    if (sameCount >= 2) bonus -= (sameCount - 1) * 2.5;

    return bonus;
  },

  // ---------- 安装层：把元素宝石分散装到不同的卡（便于两种元素分别命中触发反应）----------
  install(CG, gem, card, ctx) {
    const el = gemElement(CG, gem);
    if (!el) return 0;
    const cardEl = cardElement(CG, card);
    if (!cardEl) return 0.12;                       // 空卡：装上去好（新增一个元素命中源）
    if (cardEl === el) return 0.04;                 // 同卡同元素：叠层有意义（反应消耗更多层）但不增多样性
    return -0.4;                                    // 同卡异元素：cardStats 取最后一个 → 覆盖丢元素，强避
  },

  // ---------- 战斗层（很轻）：手里有异元素牌、且敌人已有可反应光环 → 鼓励顺序触发 ----------
  battle(CG, g) {
    const alive = g.aliveEnemies();
    if (!alive.length) return 0;
    let v = 0;
    for (const e of alive) {
      const aura = CG.ELEMENT_IDS.find(id => (e.statuses[id] || 0) > 0);
      if (!aura) continue;
      const partners = reactsWith(aura);
      for (const c of g.hand) {
        const s = CG.cardStats(c, { valueMult: g.cardValueMult });
        if (s.element && partners.includes(s.element)) { v += 2 + (e.statuses[aura] || 0) * 0.5; break; }
      }
    }
    return v;                                       // 量级压在半条命(≈6)以下
  },

  // ---------- 出牌偏好（关键）：目标已有可反应光环 + 本牌是能反应的异元素 → 强偏好立即触发 ----------
  //   反应的爆发收益当回合的 V 看得到，但「先铺 A 再 B」的顺序，逐手贪心/有限 rollout 可能错过铺垫 →
  //   在「可立即触发」这一手上直接强加分，确保 AI 不会拖延、把已有光环兑现成反应。
  playPolicy(CG, g, card, s) {
    if (!s.element) return 0;
    const myEl = s.element;
    const alive = g.aliveEnemies();
    if (!alive.length) return 0;

    // 候选枚举会为每个存活敌人各开一个目标，故扫描所有存活敌人：只要存在「本牌异元素能与其光环反应」的敌人就强偏好。
    let best = 0;
    for (const e of alive) {
      const aura = CG.ELEMENT_IDS.find(id => (e.statuses[id] || 0) > 0);
      if (!aura || aura === myEl) continue;
      const rx = CG.reactionFor(aura, myEl);
      if (!rx) continue;
      const auraLv = e.statuses[aura] || 0;
      // 反应类型分档（与 RX 的强度对齐）：放大(×2 伤害)/超载(20 穿透) 最值得，转化型其次。
      //   · 放大型(蒸发/融化)只在本牌确实造成伤害时生效（game.js: rx.type!=='amplify'||kind==='damage'）→ 纯附元素 skill 牌不偏好。
      //   · 转化型(超载/感电/冻结/超导)的 apply 与本牌是否造伤害无关，纯附元素牌也能触发。
      let pref = 0;
      if (rx.type === 'amplify') { if (s.kind === 'damage') pref = 30; }   // 否则无效，pref 留 0
      else if (rx.name === '超载') pref = 28;                               // 20 穿透：高
      else pref = 20;                                                       // 感电/冻结/超导：可观
      // 仅在确有反应价值(pref>0)时，按光环层数（被消耗次数）略加成；封顶避免盖过致命/救命牌。
      if (pref > 0) pref += Math.min(2, auraLv) * 4;
      if (pref > best) best = pref;
    }
    return best;     // 0 或 ~20~38：落在「强偏好 15~40」区间
  },
});

'use strict';
/* 元素包（elements）策略 ——「连招型」包：附火/水/雷/冰，两种异元素轮流命中触发反应。
 *
 * 核心问题：通用 gemValue 对 flame/aqua/volt/frost 一视同仁（score 都是 4），
 * AI 可能拿了 3 颗 flame，永远凑不出异元素对，反应白给。
 *
 * 本模块两个方向：
 * 1. gem/install 钩子——宝石经济层：
 *    - 统计 deck 中已安装的元素种类（按攻击牌上的已装元素），给「能与已有元素发生反应的异元素」加分，
 *      引导 AI 凑出「至少两种异元素对」。
 *    - 奖励「多样性」：已有 1 种元素时给异元素加分；已有 2+ 种时削减第三种新元素的加分（避免三拼）。
 *    - install 钩子：把元素宝石引导装到攻击牌（strike base）而非防御牌。
 * 2. battle 钩子——战斗局面层（轻量）：
 *    - 当某敌人已有元素光环时，给「手里有异元素牌」的状态加塑形分，鼓励顺序触发反应。
 *    - 不要过重，反应的即时收益（poison/frozen/damage/vuln）已被 V 自动捕捉。
 */
const value = require('../value');

// 元素之间的反应对：哪两个元素能发生反应
const REACT_PAIRS = [
  ['fire', 'water'],    // 蒸发
  ['fire', 'ice'],      // 融化
  ['fire', 'thunder'],  // 超载
  ['thunder', 'water'], // 感电
  ['ice', 'water'],     // 冻结
  ['ice', 'thunder'],   // 超导
];

// 给定一个元素，返回能与它发生反应的其它元素列表
function reactsWith(el) {
  const out = [];
  for (const [a, b] of REACT_PAIRS) {
    if (a === el) out.push(b);
    else if (b === el) out.push(a);
  }
  return out;
}

// 从一颗宝石的词条里提取元素 id（取最后一个 element 词条，与 cardStats 行为一致）
function gemElement(CG, gem) {
  let el = null;
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id];
    if (d && d.element) el = d.element;
  }
  return el;
}

// 统计 deck 中已安装在攻击牌（strike base）上的元素种类及各种元素的牌数
// 同时也把背包里（已有但未安装）的元素宝石计进去（权重×0.5，因为还没发挥效果）
// 返回 Map<element, count>（count 可带小数表示未装的）
function deckAttackElements(CG, run) {
  const elMap = new Map();
  // 已装在攻击牌上的元素（全权重）
  for (const card of (run.deck || [])) {
    if (card.base !== 'strike') continue;
    for (const g of (card.sockets || [])) {
      const el = gemElement(CG, g);
      if (el) elMap.set(el, (elMap.get(el) || 0) + 1);
    }
  }
  // 背包里还没装的元素宝石（半权重，因为还没产生价值）
  for (const g of (run.gems || [])) {
    const el = gemElement(CG, g);
    if (el) elMap.set(el, (elMap.get(el) || 0) + 0.5);
  }
  return elMap;
}

value.registerPack('elements', {
  // ---------- battle 钩子：轻量塑形，鼓励触发手里异元素对已有光环的敌人 ----------
  battle(CG, g) {
    const alive = g.aliveEnemies();
    if (!alive.length) return 0;
    let v = 0;

    // 检查手牌是否有带异元素的牌
    for (const e of alive) {
      // 找该敌人的当前元素光环
      const aura = CG.ELEMENT_IDS.find(id => (e.statuses[id] || 0) > 0);
      if (!aura) continue;
      const partners = reactsWith(aura);
      const auraLevel = e.statuses[aura] || 0;

      // 手里有能与该光环反应的异元素牌？给轻微加分
      for (const c of g.hand) {
        const s = CG.cardStats(c);
        if (s.element && partners.includes(s.element)) {
          // 根据光环层数给加分：层数越高，反应越值得（蒸发/融化×1.5^层）
          // 轻量分：2~4 分，别超过「半条命≈6」
          v += 2 + auraLevel * 0.5;
          break; // 每个敌人只计一次
        }
      }
    }
    return v;
  },

  // ---------- gem 钩子：宝石经济层——奖励「元素多样性」，惩罚「同元素堆叠」 ----------
  gem(CG, gem, ctx) {
    const el = gemElement(CG, gem);
    if (!el || !ctx || !ctx.run) return 0;

    const elMap = deckAttackElements(CG, ctx.run);
    const distinctElements = elMap.size;
    const partners = reactsWith(el);

    // 已有几个与该宝石能发生反应的异元素
    let reactingPartners = 0;
    for (const p of partners) {
      if (elMap.has(p)) reactingPartners++;
    }

    // 该元素自身已有几颗安装在攻击牌上
    const sameCount = elMap.get(el) || 0;

    let bonus = 0;

    if (distinctElements === 0) {
      // 牌组里还没有任何元素：第一颗元素宝石有中等奖励，鼓励尽快建立元素体系
      bonus += 3;
    } else if (reactingPartners > 0) {
      // 有能与当前已有元素发生反应的伙伴元素 → 这颗宝石能凑齐连招！大奖励
      // 已有的反应对越多，奖励越高（多种反应路径更灵活）
      bonus += 5 + reactingPartners * 3;
      // 如果已有多颗同元素了，再加同元素的价值递减
      if (sameCount >= 2) bonus -= (sameCount - 1) * 2;
    } else if (distinctElements >= 2) {
      // 已有 2 种元素且该元素与它们都不反应（理论上 4 元素两两都反应，此分支应很少触发）
      // 或者：deck 里只有同一种元素，这颗是第三个同元素 → 轻微惩罚
      if (sameCount >= 2) bonus -= 3;
      else bonus += 1; // 还是第一颗，给小奖励保持多样性
    } else {
      // distinctElements === 1 且该元素与已有元素不反应（理论不可能，所有元素两两都反应）
      // 保险：给小加分
      bonus += 2;
    }

    // 同元素过多则递减：3 颗同元素在攻击牌上基本是浪费
    if (sameCount >= 3) bonus -= 4;

    return bonus;
  },

  // ---------- install 钩子：引导把元素宝石装在攻击牌（strike），不要装防御牌 ----------
  install(CG, gem, card, ctx) {
    const el = gemElement(CG, gem);
    if (!el) return 0;

    // 元素词条只在命中敌人时触发，装到防御牌（defend base）完全浪费
    if (card.base === 'defend') return -0.4;  // 大幅降低安装契合（0.8 → 0.4，近乎不装）

    if (card.base === 'strike') {
      // 检查这张攻击牌上已有的元素
      const cardEl = (function () {
        let e = null;
        for (const g of (card.sockets || [])) {
          const eg = gemElement(CG, g);
          if (eg) e = eg;
        }
        return e;
      })();

      if (!cardEl) {
        // 牌上没有元素，装上去很好
        return 0.15;
      } else if (cardEl === el) {
        // 同张牌已有同元素：cardStats 会取最后一个，所以叠 level 有意义但不新增元素多样性
        // 给轻微奖励（提升单次附着层数有助于后续反应消耗更多层）
        return 0.05;
      } else {
        // 同张牌已有不同元素：cardStats 只取最后一个！装了等于覆盖，会丢失原元素
        // 强惩罚，避免 AI 把不同元素装同一张牌（两元素应装不同的攻击牌）
        return -0.35;
      }
    }
    return 0;
  },
});

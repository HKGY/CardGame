'use strict';
/* 厨艺包（cook）v3 策略 —— 核心是 craft 钩子：做菜＝序列决策（选荤菜+调料），V 刻画不了。
 *
 * v3 价值原子＝食材给予词条 `d.give`∈{veg,meat,season,cookware}（食材本身已分 1~3 级）。
 * 机制回顾：
 *   打出素菜 → _startCraft → craft 钩子返回 {meatUid, seasonUid}（null=跳过该步）
 *   菜谱矩阵 CG.RECIPE[meat][veg] → 效果种类；数值 = veg.level × meat.level × 4（只素菜＝×2 清炒回复）
 *   调料：盐(salt)=数值×2(过载) / 酱油(soy)=附滋养(治疗+50%，本场持续) / 胡椒(pepper)=结算 2 次
 *   荤×素→效果种类：fish=回复/再生/荆棘、chicken=力量/格挡/敏捷、beef=抽牌/能量/回响
 *
 * 关键设计决策：
 *   对 V() 有「直接影响」的效果（block/heal/strength/dexterity/regen/thorns/draw）
 *   与「间接影响」效果（echo/energy）分别标度：
 *   - 直接效果：吃下餐点后 V 立即提升，AI 必然选择打这张餐点 → 用 V 直接增量估分
 *   - 间接效果（echo=freeNext/energy）：吃下后 V 无变化，AI 靠「0费通路」打，
 *     效果是「释放后续出牌」；实际价值 ≈ min(echo_value, 剩余手牌数) × 均牌值，
 *     比直接效果要低得多
 *
 * battle 钩子：已生效 nourish 加分 + 手里凑出「成套食材(素+荤)」时给点潜在做菜价值
 * gem 钩子：按 d.give 给食材宝石定价（荤＞素≈调料＞厨具；牌组已有素菜来源时荤/调料更值）
 * playPolicy 钩子：手里有素菜且有荤菜可配 → 偏好打素菜（触发做菜链、变现成强餐点）
 */
const value = require('../value');

// 直接影响 V 的效果：每单位效果值换算成 V 增量
// 参考 V() 函数：projHp*12、strength×6、dexterity×4、regen×2、poison×2.5 等
const DIRECT_V_PER_UNIT = {
  heal:       8.0,    // 1 HP → projHp+1 → +12V；折半因可能超上限或low效 → 8V/unit
  regen:      2.5,    // 每层约+2V(V里计)+回合治疗约0.5V → 2.5V/unit
  thorns:     0.8,    // 每层约+2V(V里计)，但荆棘触发率低 → 0.8V/unit
  strength:   6.0,    // 每层直接+6V（V里打价）
  block:      9.0,    // 1格挡 → incoming-1 → projHp+1 → +12V；略折半因超额格挡 → 9V/unit
  dexterity:  4.0,    // 每层直接+4V（V里打价）
  draw:       7.0,    // 每张抽牌约+7V
};

// 间接影响 V 的效果：只在之后的出牌阶段体现；有效价值有限
// echo: 吃下后 V 无变化，value = freeCards，实际有效上限 ≈ 手牌数（约4-5张）× 均牌价(~5V)
// energy: 吃下后 V 无变化，额外能量允许多打牌，每点能量 ≈ 0.6 张牌 × 5V ≈ 3V/point
const INDIRECT_V_PER_UNIT = {
  echo:       1.5,    // 有效 freeCards 受手牌限制；1 echo unit ≈ 1.5V 期望
  energy:     3.0,    // 1 energy point ≈ 3V（允许多打0.6张牌）
};

// 依据当前局势，给某效果种类打「情境乘数」
function situationMult(kind, g) {
  const p = g.player;
  const incoming = g.playerIncomingDamage ? g.playerIncomingDamage() : 0;
  const projHp = p.hp - incoming;
  const hpRatio = p.hp / (p.maxHp || 1);
  const projRatio = projHp / (p.maxHp || 1);

  const alive = g.aliveEnemies ? g.aliveEnemies() : g.enemies.filter(e => e.alive && e.hp > 0);
  let ehp = 0; for (const e of alive) ehp += e.hp;

  const veryLow       = projHp <= 0 || hpRatio < 0.25;
  const underPressure = !veryLow && projRatio < 0.35;
  const enemyLow      = alive.length > 0 && ehp < alive.length * 18;
  const earlyGame     = g.turn <= 3;

  if (veryLow) {
    // 快死：治疗/格挡/回收极度优先；进攻大幅降权
    if (kind === 'heal')       return 2.5;
    if (kind === 'regen')      return 2.0;
    if (kind === 'block')      return 2.2;
    if (kind === 'dexterity')  return 1.5;
    if (kind === 'strength')   return 0.5;
    if (kind === 'echo')       return 0.2;   // 快死时echo几乎没价值
    if (kind === 'energy')     return 0.4;
    if (kind === 'draw')       return 0.6;
    if (kind === 'thorns')     return 0.7;
    return 1.0;
  }
  if (underPressure) {
    // 承压：偏防御
    if (kind === 'heal')       return 1.8;
    if (kind === 'regen')      return 1.6;
    if (kind === 'block')      return 1.6;
    if (kind === 'dexterity')  return 1.3;
    if (kind === 'strength')   return 0.8;
    if (kind === 'echo')       return 0.6;
    if (kind === 'energy')     return 0.8;
    if (kind === 'draw')       return 1.0;
    if (kind === 'thorns')     return 0.9;
    return 1.0;
  }
  if (enemyLow) {
    // 敌人快死：爆发收尾
    if (kind === 'strength')   return 1.8;
    if (kind === 'echo')       return 1.4;
    if (kind === 'energy')     return 1.4;
    if (kind === 'draw')       return 1.3;
    if (kind === 'heal')       return 0.5;
    if (kind === 'regen')      return 0.4;
    if (kind === 'block')      return 0.7;
    if (kind === 'thorns')     return 0.3;
    return 1.0;
  }
  if (earlyGame) {
    // 早期：铺长期 buff 更值
    if (kind === 'dexterity')  return 1.5;
    if (kind === 'strength')   return 1.4;
    if (kind === 'regen')      return 1.4;
    if (kind === 'draw')       return 1.3;
    if (kind === 'energy')     return 1.2;
    if (kind === 'echo')       return 1.2;
    return 1.0;
  }
  // 中期正常：strength/block/dexterity 最直接
  return 1.0;
}

// 给(veg, meatBase, seasonBase)组合打一个综合估分
function scoreCombination(CG, vegBase, meatBase, seasonBase, g) {
  const spec = CG.buildMeal(vegBase, meatBase, seasonBase);

  // 确定效果种类
  let kind;
  if (meatBase) {
    kind = (CG.RECIPE[meatBase] && CG.RECIPE[meatBase][vegBase]) || 'heal';
  } else {
    kind = 'heal';  // 清炒素菜 → heal veg.level
  }

  const mult = situationMult(kind, g);
  const vPerUnit = DIRECT_V_PER_UNIT[kind] || INDIRECT_V_PER_UNIT[kind] || 1.0;

  // 酱油特殊：附 nourish(1)，再结算 heal/regen —— nourish 使治疗量 ×1.5
  // 对 heal/regen：酱油额外 +50% 效果值（nourish 激活，本场持续有效）
  let nourBonus = 0;
  if (seasonBase) {
    const b = CG.BASE_CARDS[seasonBase];
    if (b && b.season === 'soy' && (kind === 'heal' || kind === 'regen')) {
      nourBonus = spec.value * 0.5 * vPerUnit * mult;
    }
  }

  // echo: 有效价值受手牌上限约束（最多 HAND_LIMIT 张，通常 3-5 张可打）
  // 不直接 cap，但用低 vPerUnit (1.5) 反映这个限制
  const rawScore = spec.value * spec.repeatTimes * vPerUnit * mult + nourBonus;
  return rawScore;
}

// 牌组里「能产出某类食材」的 give 词条数（跨所有牌的所有宝石）——用于 gem 钩子的合成链判断。
function deckGiveCounts(CG, run) {
  const cnt = { veg: 0, meat: 0, season: 0, cookware: 0 };
  for (const c of (run.deck || [])) for (const g of (c.sockets || [])) for (const a of (g.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (d && d.give && cnt[d.give] != null) cnt[d.give] += a.level;
  }
  return cnt;
}

value.registerPack('cook', {
  // battle：已生效 nourish 状态价值 + 手里凑出「成套食材(素+荤)」的潜在做菜价值。
  // 成套时下一步就能做出数值翻倍的强餐点；rollout 打素菜会真实展开做菜、V 能看到，但「这回合还没轮到」
  // 时给一点点期权分，鼓励保留并尽快变现（封顶，避免 AI 为了囤食材而消极不打牌）。
  battle(CG, g) {
    const s = g.player.statuses;
    let v = (s.nourish || 0) * 1.5;
    const has = cat => g.hand.some(c => { const b = CG.BASE_CARDS[c.base]; return b && b.food === cat; });
    if (has('veg') && has('meat')) v += 2;             // 成套(素+荤)：能做强餐点，轻度期权分
    return v;
  },

  // gem：按 d.give 给食材宝石定价。荤菜(数值倍增器)＞素菜≈调料＞厨具；
  // 牌组已有「素菜来源」时，荤菜/调料更值（凑齐合成链才有用，孤立的荤/调料做不成菜）。
  gem(CG, gem, ctx) {
    const run = ctx && ctx.run;
    const have = run ? deckGiveCounts(CG, run) : null;
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d || !d.give) continue;
      const L = a.level;
      if (d.give === 'veg')      v += 1.0 * L;          // 素菜＝做菜链的「触发器」，独立可用(可清炒/被配)
      else if (d.give === 'meat') {                     // 荤菜＝数值倍增器，最值钱；但需配素菜才生效
        v += 1.6 * L;
        if (have && have.veg > 0) v += 0.6 * L;         // 牌组已有素菜来源 → 荤菜能凑成链，更值
      } else if (d.give === 'season') {                 // 调料＝菜谱增幅(盐/酱油/胡椒)，需有可做的菜
        v += 0.9 * L;
        if (have && have.veg > 0) v += 0.4 * L;
      } else if (d.give === 'cookware') v += 0.8 * L;   // 厨具＝0 费小武器(刀/锅/炉)，稳但平庸
    }
    return v;
  },

  // craft：核心！按局势选最优 (meatUid, seasonUid)。
  // 被 doCraftOn 调用时 g.craft.step='meat'、g.craft.vegUid 已设好；做菜分两步，但选 meat 后
  // step 会推进到 'season'，故这里直接从手牌枚举两类候选（与 craftCandidates 同口径：按 food 分类）。
  craft(CG, g) {
    if (!g.craft) return null;

    const vegCard = g.hand.find(c => c.uid === g.craft.vegUid);
    if (!vegCard) return null;
    const vegBase = vegCard.base;

    // 收集可选的荤菜和调料（按 food 分类，与 game.craftCandidates 一致；荤菜数值乘子越高越好）
    const meats   = g.hand.filter(c => { const b = CG.BASE_CARDS[c.base]; return b && b.food === 'meat'; });
    const seasons = g.hand.filter(c => { const b = CG.BASE_CARDS[c.base]; return b && b.food === 'season'; });

    // 候选列表：null = 跳过该步
    const meatOptions   = [null].concat(meats);
    const seasonOptions = [null].concat(seasons);

    let bestScore = -Infinity;
    let bestMeatUid   = null;
    let bestSeasonUid = null;

    for (const meat of meatOptions) {
      for (const season of seasonOptions) {
        const meatBase   = meat   ? meat.base   : null;
        const seasonBase = season ? season.base : null;

        const score = scoreCombination(CG, vegBase, meatBase, seasonBase, g);

        if (score > bestScore) {
          bestScore     = score;
          bestMeatUid   = meat   ? meat.uid   : null;
          bestSeasonUid = season ? season.uid : null;
        }
      }
    }

    return { meatUid: bestMeatUid, seasonUid: bestSeasonUid };
  },

  // playPolicy：手里有素菜 + 有荤菜可配 → 偏好打素菜，触发做菜链（素菜单吃只回 1~3 血，
  // 配上荤菜+调料能做出数值翻几倍的强餐点）。鼓励 AI 走「打素菜→做菜→吃餐点」的变现路径，
  // 而非把素菜当成 1~3 血的清炒草草打掉。仅当本牌确为素菜、且场上有荤菜时加分。
  playPolicy(CG, g, card, s) {
    if (s.kind !== 'veg') return 0;
    const hasMeat = g.hand.some(c => { const b = CG.BASE_CARDS[c.base]; return b && b.food === 'meat'; });
    if (!hasMeat) return 0;                         // 没荤菜＝只能清炒，不必催着打
    // 越缺能量越别急着打（做菜本身免费，但餐点是 0 费消耗、随时能吃）；中等强度偏好。
    return g.player.energy > 0 ? 12 : 4;
  },
});

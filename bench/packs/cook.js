'use strict';
/* 厨艺包（cook）策略 —— 核心是 craft 钩子，按当前局势选最优菜谱与调料。
 *
 * 机制回顾：
 *   打出素菜 → _startCraft → craft 钩子返回 {meatUid, seasonUid}（null=跳过）
 *   菜谱矩阵 CG.RECIPE[meat][veg] → 效果种类；数值 = veg.level × meat.level × 2
 *   调料：盐(salt)=数值×2 / 酱油(soy)=附滋养(治疗+50%) / 胡椒(pepper)=结算2次
 *
 * 关键设计决策：
 *   对 V() 有「直接影响」的效果（block/heal/strength/dexterity/regen/thorns/draw）
 *   与「间接影响」效果（echo/energy）分别标度：
 *   - 直接效果：吃下餐点后 V 立即提升，AI 必然选择打这张餐点 → 用 V 直接增量估分
 *   - 间接效果（echo=freeNext/energy）：吃下后 V 无变化，AI 靠「0费通路」打，
 *     效果是「释放后续出牌」；实际价值 ≈ min(echo_value, 剩余手牌数) × 均牌值，
 *     比直接效果要低得多
 *
 * battle 钩子：只加已生效的 nourish 状态价值，不对食材在手加分
 * gem 钩子：轻度加权 farm/ranch/market/kitchen，加重腐坏惩罚
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

value.registerPack('cook', {
  // battle：只加已生效的 nourish 状态价值（不对食材在手加分，避免 AI 倾向于不打牌）
  battle(CG, g) {
    const s = g.player.statuses;
    return (s.nourish || 0) * 1.5;
  },

  // gem：给 cook 包增益词条轻度加权，对腐坏减益加重惩罚
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      if (d.give === 'veg')       v += 1.0 * a.level;
      if (d.give === 'meat')      v += 1.5 * a.level;   // 荤菜是数值倍增器，最值钱
      if (d.give === 'season')    v += 1.0 * a.level;
      if (d.give === 'cookware')  v += 0.8 * a.level;
      // 腐坏减益：污染手牌且回合末惩罚，比通用估值更重
      if (d.give === 'spoiled_rice' || d.give === 'stinky_meat' || d.give === 'rotten_veg') {
        v -= 2.5 * a.level;
      }
    }
    return v;
  },

  // craft：核心！按局势选最优 (meatUid, seasonUid)。
  // 被 doCraftOn 调用时 g.craft.step='meat', g.craft.vegUid 已设好。
  craft(CG, g) {
    if (!g.craft) return null;

    const vegCard = g.hand.find(c => c.uid === g.craft.vegUid);
    if (!vegCard) return null;
    const vegBase = vegCard.base;

    // 收集可选的荤菜和调料
    const meats   = g.hand.filter(c => { const b = CG.BASE_CARDS[c.base]; return b && b.food === 'meat'; });
    const seasons  = g.hand.filter(c => { const b = CG.BASE_CARDS[c.base]; return b && b.food === 'season'; });

    // 候选列表：null = 跳过
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
});

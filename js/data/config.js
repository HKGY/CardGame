window.CG = window.CG || {};

/* ===========================================================================
 *  进度 / 经济参数 —— 平衡数值集中在这里，方便调整。
 * ===========================================================================
 */
CG.CONFIG = {
  startHp: 75,
  startGold: 99,
  acts: 3,                       // 总层数

  // 数值膨胀：第 2/3 层敌人生命与伤害的倍率
  actScale: { 1: { hp: 1, dmg: 1 }, 2: { hp: 1.6, dmg: 1.4 }, 3: { hp: 2.3, dmg: 1.85 } },
  goldMult: { 1: 1, 2: 1.5, 3: 2 },   // 后层金币也更多

  // 地图：rows = Boss 之前的“内容行”数量；最后会再自动补一行 Boss。
  map: { rows: 6, minWidth: 2, maxWidth: 4 },

  gold: { monster: [12, 22], elite: [28, 42], boss: [60, 90] },
  reward: { count: 3 },

  // 药水：消耗品栏位数 + 战斗胜利掉落概率（按敌人强度）
  potion: { slots: 3, chance: { monster: 0.35, elite: 0.55, boss: 0.7 } },

  // 升级 / 升级祭坛 给的随机词条等级权重
  upgradeLevelWeights: [[1, 4], [2, 3], [3, 2]],

  // 各档敌人掉落/出售卡所带词条：数量权重 + 等级权重。
  // 都至少 1 个词条；精英/首领明显更强、与小怪区分度更大。
  affix: {
    monster: { count: [[1, 7], [2, 3]],         levelW: [[1, 6], [2, 3], [3, 1]] },
    elite:   { count: [[2, 6], [3, 4]],         levelW: [[1, 2], [2, 4], [3, 4]] },
    boss:    { count: [[3, 8], [2, 2]],         levelW: [[1, 1], [2, 3], [3, 6]] },
  },

  rest: { healPct: 0.30 },
  shop: { cardCount: 4, upgradePrice: 50, healPrice: 25, healPct: 0.25 },
};

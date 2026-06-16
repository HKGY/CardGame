window.CG = window.CG || {};

/* ===========================================================================
 *  进度 / 经济参数 —— 平衡数值集中在这里，方便调整。
 * ===========================================================================
 */
CG.CONFIG = {
  startHp: 75,

  // 地图：rows = Boss 之前的“内容行”数量；最后会再自动补一行 Boss。
  map: { rows: 6, minWidth: 2, maxWidth: 4 },

  // 战斗金币奖励区间 [最小, 最大]
  gold: { monster: [12, 22], elite: [28, 42], boss: [60, 90] },

  // 卡牌奖励：每次给 count 张候选；不同强度敌人给的升级等级权重不同 [[等级, 权重], ...]
  reward: {
    count: 3,
    upgradeWeights: {
      monster: [[0, 7], [1, 2], [2, 1]],
      elite:   [[1, 5], [2, 3], [3, 1]],
      boss:    [[2, 5], [3, 3], [4, 1]],
    },
  },

  // 休息点：回血百分比
  rest: { healPct: 0.30 },

  // 商店
  shop: { cardCount: 4, upgradePrice: 75, healPrice: 30, healPct: 0.25 },
};

// 商店里卡牌的售价（随升级等级递增）
CG.cardPrice = upgrade => 45 + 30 * upgrade;

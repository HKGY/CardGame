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

  reward: { count: 3 },          // 每次战斗给几张候选卡

  // 不同强度敌人掉落/出售的卡所带词条：词条数量权重 [[数量, 权重], ...] 与最高等级
  affix: {
    monster: { count: [[0, 4], [1, 5], [2, 1]], maxLevel: 1 },
    elite:   { count: [[1, 4], [2, 3]],         maxLevel: 2 },
    boss:    { count: [[2, 4], [3, 2]],         maxLevel: 3 },
  },

  rest: { healPct: 0.30 },       // 休息点回血百分比

  shop: { cardCount: 4, upgradePrice: 75, healPrice: 30, healPct: 0.25 },
};

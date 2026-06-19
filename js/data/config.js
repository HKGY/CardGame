window.CG = window.CG || {};

/* ===========================================================================
 *  进度 / 经济参数 —— 平衡数值集中在这里，方便调整。
 * ===========================================================================
 */
CG.CONFIG = {
  startHp: 75,
  startGold: 99,
  acts: 3,                       // 总层数

  // 数值膨胀放缓：后层改以「更多敌人」提升难度（见 encounter）
  actScale: { 1: { hp: 1, dmg: 1 }, 2: { hp: 1.2, dmg: 1.12 }, 3: { hp: 1.4, dmg: 1.25 } },
  goldMult: { 1: 1, 2: 1.4, 3: 1.8 },   // 后层金币也更多
  // 每场战斗的敌人数量权重 [数量, 权重]：普通最多 4 / 精英最多 2 / 首领恒 1；越高层越可能成群
  encounter: {
    normal: { 1: [[1, 4], [2, 3]], 2: [[1, 2], [2, 4], [3, 2]], 3: [[2, 4], [3, 3], [4, 2]] },
    elite:  { 1: [[1, 1]], 2: [[1, 2], [2, 1]], 3: [[1, 1], [2, 2]] },
    boss:   { 1: [[1, 1]], 2: [[1, 1]], 3: [[1, 1]] },
  },

  // 地图：每层一张《以撒的结合》式房间布局（BFS 泛洪生成，见 run.js genIsaacFloor）。
  // 目标房间数 = ri(0,2) + roomsBase + round(act × roomsPerAct)，封顶 maxRooms、不足 minRooms 则重生成。
  // 死路安放特殊房（首领/宝藏/商店/诅咒/小boss），其余普通房按 normalEnemyChance 藏敌人。
  map: { gridW: 11, gridH: 9, roomsBase: 5, roomsPerAct: 2.5, maxRooms: 15, minRooms: 7, normalEnemyChance: 0.7 },
  // 诅咒房：进入耗血 = max(minHpCost, 最大生命 × hpCostPct)
  curse: { hpCostPct: 0.12, minHpCost: 8 },

  gold: { monster: [14, 24], elite: [30, 46], boss: [64, 96] },   // 经济略上调（一切都要花钱）
  reward: { count: 3 },
  // 战斗奖励是「宝石」还是「空卡/多孔法杖」的概率（首领恒给宝石）
  rewardGemChance: { monster: 0.65, elite: 0.6, boss: 1 },

  // 宝石生成：bigChance = 出「强增益+减益」大宝石的概率；levelW = 增益等级权重
  gem: {
    bigChance: { monster: 0.35, elite: 0.6, boss: 1 },
    levelW: {
      monster: [[1, 6], [2, 3], [3, 1]],
      elite:   [[1, 2], [2, 4], [3, 4]],
      boss:    [[1, 1], [2, 3], [3, 6]],
    },
  },
  // Booster pack 选包权重 [包id, 权重]：普通层偏「基础包」，精英/首领偏主题包（更聚焦）。
  packW: {
    monster: [['basic', 6], ['power', 2], ['curse', 2], ['tempo', 2], ['vitality', 2]],
    elite:   [['basic', 2], ['power', 3], ['curse', 3], ['tempo', 3], ['vitality', 3]],
    boss:    [['basic', 1], ['power', 3], ['curse', 3], ['tempo', 3], ['vitality', 3]],
  },
  // 卡牌奖励 / 商店法杖的孔位数权重（空法杖的价值在于孔位）
  cardLimitW: { monster: [[1, 3], [2, 4], [3, 2]], elite: [[2, 4], [3, 4]], boss: [[2, 2], [3, 5], [4, 3]] },

  // 塔罗牌（消耗品）：栏位数 + 战斗胜利掉落概率（按敌人强度）
  tarot: { slots: 3, chance: { monster: 0.35, elite: 0.55, boss: 0.7 } },

  // 遗物：精英/首领掉落数、商店出售数与单价
  relic: { elite: 1, boss: 2, shopCount: 2, shopPrice: 150 },

  // 升级祭坛 / 宝石重铸用的随机词条等级权重
  upgradeLevelWeights: [[1, 4], [2, 3], [3, 2]],

  // 商店（已合并篝火；一切皆需花钱）
  shop: {
    gemCount: 3,            // 出售宝石数
    cardCount: 2,           // 出售法杖（空卡/多孔）数
    tarotCount: 2, tarotPrice: 45,
    healPrice: 25, healPct: 0.30,
    removeBase: 45, removeStep: 25,        // 删卡：每买一次，下次永久 +25
    uninstallBase: 30, uninstallStep: 18,  // 卸下宝石：每次永久 +18（且宝石随机加 debuff）
    socketPrice: 65,                        // 给一张卡 +1 孔位
  },
};

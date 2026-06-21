window.CG = window.CG || {};

/* ===========================================================================
 *  进度 / 经济参数 —— 平衡数值集中在这里，方便调整。
 * ===========================================================================
 */
CG.CONFIG = {
  startHp: 75,
  startGold: 99,
  acts: 3,                       // 总层数

  // 敌人数值膨胀（大幅加强：20 卡包后玩家很强，敌人血量/伤害随层数大幅放大）。
  // actScale 同时乘敌人 maxHp 与招式的 damage/block（见 _makeEnemy / _scaleEff）。
  actScale: { 1: { hp: 1.6, dmg: 1.5 }, 2: { hp: 2.6, dmg: 2.2 }, 3: { hp: 4.0, dmg: 3.0 } },
  // 难度：敌人每项数值（血量/伤害/格挡/力量/敏捷）整体 ×M；开始菜单可自选，越低越易。
  difficulty: { options: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], default: 0.7 },
  goldMult: { 1: 1, 2: 1.4, 3: 1.8 },   // 后层金币也更多
  // 每场战斗的敌人数量权重 [数量, 权重]：普通最多 4 / 精英最多 2 / 首领恒 1；越高层越可能成群
  encounter: {
    normal: { 1: [[1, 4], [2, 3]], 2: [[1, 2], [2, 4], [3, 2]], 3: [[2, 4], [3, 3], [4, 2]] },
    elite:  { 1: [[1, 1]], 2: [[1, 2], [2, 1]], 3: [[1, 1], [2, 2]] },
    boss:   { 1: [[1, 1]], 2: [[1, 1]], 3: [[1, 1]] },
  },

  // 地图：每层一张《以撒的结合》式房间布局（BFS 泛洪生成，见 run.js genIsaacFloor）。
  // 目标房间数 = ri(0,2) + roomsBase + round(act × roomsPerAct)，封顶 maxRooms、不足 minRooms 则重生成。
  // 死路安放特殊房：首领恒 1；宝藏/商店/诅咒/小boss/祭坛 各保底 1，extra 为「再多一个」的概率。
  // 其余普通房按 normalEnemyChance 藏敌（已调低）；藏敌房有 telegraphChance 概率在地图上明示（露出 ⚔️）。
  map: {
    gridW: 13, gridH: 11, roomsBase: 8, roomsPerAct: 3, maxRooms: 18, minRooms: 9,
    normalEnemyChance: 0.45, telegraphChance: 0.5,
    extra: { treasure: 0.4, shop: 0.4, elite: 0.4, altar: 0.4 },
  },
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
    monster: [['basic', 6], ['power', 2], ['weaken', 2], ['tempo', 2], ['vitality', 2], ['elements', 1], ['cook', 1], ['exhaust', 1], ['elec', 1], ['bastion', 1], ['produce', 1], ['retain', 1], ['enhance', 1], ['void', 1], ['gadget', 1], ['econ', 1], ['miner', 1], ['forge', 1], ['summon', 1], ['build', 1], ['discard', 1], ['conjure', 1], ['hunter', 1], ['flow', 1], ['amplify', 1]],
    elite:   [['basic', 2], ['power', 3], ['weaken', 3], ['tempo', 3], ['vitality', 3], ['elements', 2], ['cook', 2], ['exhaust', 2], ['elec', 2], ['bastion', 2], ['produce', 2], ['retain', 2], ['enhance', 2], ['void', 2], ['gadget', 2], ['econ', 2], ['miner', 2], ['forge', 2], ['summon', 2], ['build', 2], ['discard', 2], ['conjure', 2], ['hunter', 2], ['flow', 2], ['amplify', 2]],
    boss:    [['basic', 1], ['power', 3], ['weaken', 3], ['tempo', 3], ['vitality', 3], ['elements', 2], ['cook', 2], ['exhaust', 2], ['elec', 2], ['bastion', 2], ['produce', 2], ['retain', 2], ['enhance', 2], ['void', 2], ['gadget', 2], ['econ', 2], ['miner', 2], ['forge', 2], ['summon', 2], ['build', 2], ['discard', 2], ['conjure', 2], ['hunter', 2], ['flow', 2], ['amplify', 2]],
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
    uninstallBase: 30, uninstallStep: 18,  // 卸下宝石（仅商店）：每次永久 +18
    purifyBase: 40, purifyStep: 20,        // 净化：去掉一颗宝石的代价；每次永久 +20
    socketPrice: 65,                        // 给一张卡 +1 孔位
    // 出售 booster pack：买下后开启，从 count 颗同主题宝石里挑 1 颗进背包。
    // 五选一更贵：挑选余地更大 + 宝石档更高（tier 决定大宝石概率/等级）。
    packs: [
      { count: 3, pick: 1, tier: 'monster', price: 50 },
      { count: 5, pick: 1, tier: 'elite',   price: 110 },
      { count: 5, pick: 2, tier: 'elite',   price: 170 },  // 五选二：一次挑 2 颗，凑元素连招
    ],
  },
};

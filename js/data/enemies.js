window.CG = window.CG || {};

/* ===========================================================================
 *  敌人数据 —— 想新增 / 修改敌人，改这一个文件。
 * ===========================================================================
 *  每个敌人的字段：
 *    id     唯一标识
 *    name   显示名称
 *    maxHp  最大生命
 *    sprite 贴图名（对应 js/ui/sprites.js 里的 key；不写或找不到则用通用贴图）
 *    moves  招式列表，每个招式：
 *             name    名称
 *             intent  意图类型（决定头顶显示的图标）：
 *                     'attack' | 'attack_defend' | 'defend' | 'buff' | 'debuff'
 *             effects 复用卡牌那套效果系统（施放者 = 敌人，目标 = 玩家）
 *    chooseMove(game, history)  可选；自定义 AI，返回 moves 里的一个招式。
 *                               不写就用默认 AI（随机，且不会连用同一招 3 次）。
 * ===========================================================================
 */
CG.ENEMIES = {
  jaw_worm: {
    id: 'jaw_worm', name: '颚虫', maxHp: 44, sprite: 'worm',
    moves: [
      { name: '撕咬', intent: 'attack',
        effects: [{ type: 'damage', value: 11 }] },
      { name: '猛击', intent: 'attack_defend',
        effects: [{ type: 'damage', value: 7 }, { type: 'block', value: 5 }] },
      { name: '咆哮', intent: 'buff',
        effects: [{ type: 'strength', value: 3 }, { type: 'block', value: 6 }] },
    ],
    // 不写 chooseMove，使用默认随机 AI
  },

  cultist: {
    id: 'cultist', name: '邪教徒', maxHp: 48, sprite: 'cultist',
    moves: [
      { name: '仪式', intent: 'buff',
        effects: [{ type: 'strength', value: 3 }] },
      { name: '暗袭', intent: 'attack',
        effects: [{ type: 'damage', value: 6 }] },
    ],
    // 自定义 AI：第一回合念“仪式”叠力量，之后每回合“暗袭”——伤害随力量越来越高
    chooseMove(game, history) {
      if (history.length === 0) return this.moves.find(m => m.name === '仪式');
      return this.moves.find(m => m.name === '暗袭');
    },
  },
};

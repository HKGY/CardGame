window.CG = window.CG || {};

/* ===========================================================================
 *  敌人数据 —— 普通 / 精英 / 首领三档，由 ENEMY_POOLS 分组。
 * ===========================================================================
 *  字段：id, name, maxHp, sprite（见 js/ui/sprites.js）, moves[]
 *    move: { name, intent: 'attack'|'attack_defend'|'defend'|'buff'|'debuff', effects[] }
 *    chooseMove(game, history) 可选，自定义 AI；不写则默认随机(不连用同招 3 次)。
 *  效果系统与卡牌共用（source=敌人, target=玩家）。
 * ===========================================================================
 */
CG.ENEMIES = {
  // ---------- 普通 ----------
  jaw_worm: {
    id: 'jaw_worm', name: '颚虫', maxHp: 44, sprite: 'worm',
    moves: [
      { name: '撕咬', intent: 'attack', effects: [{ type: 'damage', value: 11 }] },
      { name: '猛击', intent: 'attack_defend', effects: [{ type: 'damage', value: 7 }, { type: 'block', value: 5 }] },
      { name: '咆哮', intent: 'buff', effects: [{ type: 'strength', value: 3 }, { type: 'block', value: 6 }] },
    ],
  },
  cultist: {
    id: 'cultist', name: '邪教徒', maxHp: 48, sprite: 'cultist',
    moves: [
      { name: '仪式', intent: 'buff', effects: [{ type: 'strength', value: 3 }] },
      { name: '暗袭', intent: 'attack', effects: [{ type: 'damage', value: 6 }] },
    ],
    chooseMove(game, history) {
      return history.length === 0 ? this.moves[0] : this.moves[1];
    },
  },
  spike_slime: {
    id: 'spike_slime', name: '尖刺史莱姆', maxHp: 40, sprite: 'spike',
    moves: [
      { name: '重砸', intent: 'attack', effects: [{ type: 'damage', value: 9 }] },
      { name: '腐蚀', intent: 'debuff', effects: [{ type: 'damage', value: 6 }, { type: 'weak', value: 1 }] },
    ],
  },

  // ---------- 精英 ----------
  gremlin_nob: {
    id: 'gremlin_nob', name: '格雷姆林头领', maxHp: 85, sprite: 'nob',
    moves: [
      { name: '怒吼', intent: 'buff', effects: [{ type: 'strength', value: 3 }] },
      { name: '鲁莽冲撞', intent: 'attack', effects: [{ type: 'damage', value: 14 }] },
      { name: '跺脚', intent: 'attack', effects: [{ type: 'damage', value: 8 }] },
    ],
    chooseMove(game, history) {
      if (history.length === 0) return this.moves[0];          // 先怒吼叠力量
      return Math.random() < 0.5 ? this.moves[1] : this.moves[2];
    },
  },
  sentry: {
    id: 'sentry', name: '哨卫', maxHp: 72, sprite: 'sentry',
    moves: [
      { name: '光束', intent: 'attack', effects: [{ type: 'damage', value: 9 }] },
      { name: '强化护盾', intent: 'defend', effects: [{ type: 'block', value: 12 }] },
    ],
  },

  // ---------- 首领 ----------
  the_guardian: {
    id: 'the_guardian', name: '守卫者', maxHp: 150, sprite: 'guardian',
    moves: [
      { name: '强力冲击', intent: 'attack', effects: [{ type: 'damage', value: 16 }] },
      { name: '龟壳防御', intent: 'defend', effects: [{ type: 'block', value: 20 }] },
      { name: '蓄力重砸', intent: 'attack', effects: [{ type: 'damage', value: 24 }] },
    ],
    chooseMove(game, history) {                                 // 固定循环
      const seq = ['强力冲击', '龟壳防御', '强力冲击', '蓄力重砸'];
      return this.moves.find(m => m.name === seq[history.length % seq.length]);
    },
  },
  slime_boss: {
    id: 'slime_boss', name: '史莱姆之王', maxHp: 140, sprite: 'slimeboss',
    moves: [
      { name: '蓄势', intent: 'buff', effects: [{ type: 'strength', value: 3 }] },
      { name: '黏液冲击', intent: 'attack', effects: [{ type: 'damage', value: 18 }] },
      { name: '双重拍击', intent: 'attack', effects: [{ type: 'damage', value: 8, hits: 2 }] },
    ],
    chooseMove(game, history) {
      const seq = ['蓄势', '黏液冲击', '双重拍击'];
      return this.moves.find(m => m.name === seq[history.length % seq.length]);
    },
  },
};

// 按强度分组，地图节点据此抽取敌人
CG.ENEMY_POOLS = {
  normal: ['jaw_worm', 'cultist', 'spike_slime'],
  elite:  ['gremlin_nob', 'sentry'],
  boss:   ['the_guardian', 'slime_boss'],
};

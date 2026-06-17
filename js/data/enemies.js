window.CG = window.CG || {};

/* ===========================================================================
 *  敌人数据 —— 普通 / 精英 / 首领三档，由 ENEMY_POOLS 分组。
 *  acts: 该敌人会出现在哪些层（不写则全层）。跑图按当前层筛选，增加多样性。
 * ===========================================================================
 *  move: { name, intent: 'attack'|'attack_defend'|'defend'|'buff'|'debuff', effects[] }
 *  chooseMove(game, history) 可选，自定义 AI；不写则默认随机(不连用同招 3 次)。
 * ===========================================================================
 */
CG.ENEMIES = {
  // ---------- 普通 ----------
  green_slime: {
    id: 'green_slime', name: '绿史莱姆', maxHp: 28, sprite: 'greenslime', acts: [1],
    moves: [
      { name: '撞击', intent: 'attack', effects: [{ type: 'damage', value: 7 }] },
      { name: '黏附', intent: 'debuff', effects: [{ type: 'damage', value: 4 }, { type: 'weak', value: 1 }] },
    ],
  },
  jaw_worm: {
    id: 'jaw_worm', name: '颚虫', maxHp: 44, sprite: 'worm', acts: [1, 2],
    moves: [
      { name: '撕咬', intent: 'attack', effects: [{ type: 'damage', value: 11 }] },
      { name: '猛击', intent: 'attack_defend', effects: [{ type: 'damage', value: 7 }, { type: 'block', value: 5 }] },
      { name: '咆哮', intent: 'buff', effects: [{ type: 'strength', value: 3 }, { type: 'block', value: 6 }] },
    ],
  },
  bat_swarm: {
    id: 'bat_swarm', name: '蝙蝠群', maxHp: 32, sprite: 'bat', acts: [1, 2],
    moves: [
      { name: '啃咬', intent: 'attack', effects: [{ type: 'damage', value: 4, hits: 2 }] },
      { name: '尖啸', intent: 'debuff', effects: [{ type: 'damage', value: 2 }, { type: 'weak', value: 1 }] },
    ],
  },
  spike_slime: {
    id: 'spike_slime', name: '尖刺史莱姆', maxHp: 40, sprite: 'spike', acts: [1, 2],
    moves: [
      { name: '重砸', intent: 'attack', effects: [{ type: 'damage', value: 9 }] },
      { name: '腐蚀', intent: 'debuff', effects: [{ type: 'damage', value: 6 }, { type: 'weak', value: 1 }] },
    ],
  },
  cultist: {
    id: 'cultist', name: '邪教徒', maxHp: 48, sprite: 'cultist', acts: [1, 2, 3],
    moves: [
      { name: '仪式', intent: 'buff', effects: [{ type: 'strength', value: 3 }] },
      { name: '暗袭', intent: 'attack', effects: [{ type: 'damage', value: 6 }] },
    ],
    chooseMove(game, history) { return history.length === 0 ? this.moves[0] : this.moves[1]; },
  },
  frost_wisp: {
    id: 'frost_wisp', name: '霜灵', maxHp: 46, sprite: 'frost', acts: [2, 3],
    moves: [
      { name: '寒霜', intent: 'debuff', effects: [{ type: 'damage', value: 9 }, { type: 'weak', value: 1 }] },
      { name: '冰盾', intent: 'defend', effects: [{ type: 'block', value: 10 }] },
    ],
  },

  // ---------- 精英 ----------
  gremlin_nob: {
    id: 'gremlin_nob', name: '格雷姆林头领', maxHp: 85, sprite: 'nob', acts: [1, 2],
    moves: [
      { name: '怒吼', intent: 'buff', effects: [{ type: 'strength', value: 3 }] },
      { name: '鲁莽冲撞', intent: 'attack', effects: [{ type: 'damage', value: 14 }] },
      { name: '跺脚', intent: 'attack', effects: [{ type: 'damage', value: 8 }] },
    ],
    chooseMove(game, history) {
      if (history.length === 0) return this.moves[0];
      return Math.random() < 0.5 ? this.moves[1] : this.moves[2];
    },
  },
  sentry: {
    id: 'sentry', name: '哨卫', maxHp: 72, sprite: 'sentry', acts: [1, 2, 3],
    moves: [
      { name: '光束', intent: 'attack', effects: [{ type: 'damage', value: 9 }] },
      { name: '强化护盾', intent: 'defend', effects: [{ type: 'block', value: 12 }] },
    ],
  },
  berserker: {
    id: 'berserker', name: '狂战士', maxHp: 98, sprite: 'berserker', acts: [2, 3],
    moves: [
      { name: '嗜血', intent: 'buff', effects: [{ type: 'strength', value: 2 }] },
      { name: '狂斩', intent: 'attack', effects: [{ type: 'damage', value: 15 }] },
      { name: '乱舞', intent: 'attack', effects: [{ type: 'damage', value: 5, hits: 3 }] },
    ],
    chooseMove(game, history) {
      if (history.length === 0) return this.moves[0];
      return Math.random() < 0.5 ? this.moves[1] : this.moves[2];
    },
  },

  // ---------- 首领 ----------
  the_guardian: {
    id: 'the_guardian', name: '守卫者', maxHp: 150, sprite: 'guardian', acts: [1, 2],
    moves: [
      { name: '强力冲击', intent: 'attack', effects: [{ type: 'damage', value: 16 }] },
      { name: '龟壳防御', intent: 'defend', effects: [{ type: 'block', value: 20 }] },
      { name: '蓄力重砸', intent: 'attack', effects: [{ type: 'damage', value: 24 }] },
    ],
    chooseMove(game, history) {
      const seq = ['强力冲击', '龟壳防御', '强力冲击', '蓄力重砸'];
      return this.moves.find(m => m.name === seq[history.length % seq.length]);
    },
  },
  slime_boss: {
    id: 'slime_boss', name: '史莱姆之王', maxHp: 140, sprite: 'slimeboss', acts: [1, 2, 3],
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
  chronolord: {
    id: 'chronolord', name: '时之主宰', maxHp: 155, sprite: 'chrono', acts: [3],
    moves: [
      { name: '岁月之刃', intent: 'attack', effects: [{ type: 'damage', value: 22 }] },
      { name: '加速', intent: 'buff', effects: [{ type: 'strength', value: 3 }, { type: 'block', value: 8 }] },
      { name: '时滞', intent: 'defend', effects: [{ type: 'block', value: 25 }] },
      { name: '双重时刻', intent: 'attack', effects: [{ type: 'damage', value: 10, hits: 2 }] },
    ],
    chooseMove(game, history) {
      const seq = ['岁月之刃', '加速', '双重时刻', '时滞'];
      return this.moves.find(m => m.name === seq[history.length % seq.length]);
    },
  },
};

// 按强度分组，地图节点据此抽取敌人（再按当前层 acts 过滤）
CG.ENEMY_POOLS = {
  normal: ['green_slime', 'jaw_worm', 'bat_swarm', 'spike_slime', 'cultist', 'frost_wisp'],
  elite:  ['gremlin_nob', 'sentry', 'berserker'],
  boss:   ['the_guardian', 'slime_boss', 'chronolord'],
};

window.CG = window.CG || {};

/* ===========================================================================
 *  卡牌数据 —— 想新增 / 修改卡牌，改这一个文件就够了。
 * ===========================================================================
 *  每张卡的字段：
 *    id      唯一标识（也用于组牌）
 *    name    显示名称
 *    cost    能量消耗
 *    type    'attack' | 'skill' | 'power'
 *    text    描述文字（仅显示用）
 *    exhaust 可选；true 表示打出后本场移除（进入消耗堆，而不是弃牌堆）
 *    effects 效果列表，按顺序结算。
 *
 *  effects 里每个对象的 type 决定行为，value/hits 等是参数。
 *  全部可用的效果类型见 js/engine/effects.js，常用的：
 *    { type: 'damage',     value: 6 }          造成 6 点伤害（加 hits:n 实现多段）
 *    { type: 'block',      value: 5 }          获得 5 点格挡
 *    { type: 'draw',       value: 1 }          抽 1 张牌
 *    { type: 'energy',     value: 1 }          获得 1 点能量
 *    { type: 'heal',       value: 4 }          回复 4 点生命
 *    { type: 'strength',   value: 2 }          自身获得 2 点力量
 *    { type: 'vulnerable', value: 2 }          给敌人施加 2 层易伤（受伤 +50%）
 *    { type: 'weak',       value: 1 }          给敌人施加 1 层虚弱（造成伤害 -25%）
 * ===========================================================================
 */
CG.CARDS = {
  strike: {
    id: 'strike', name: '打击', cost: 1, type: 'attack',
    text: '造成 6 点伤害。',
    effects: [{ type: 'damage', value: 6 }],
  },

  defend: {
    id: 'defend', name: '防御', cost: 1, type: 'skill',
    text: '获得 5 点格挡。',
    effects: [{ type: 'block', value: 5 }],
  },

  bash: {
    id: 'bash', name: '重击', cost: 2, type: 'attack',
    text: '造成 8 点伤害，施加 2 层易伤。',
    effects: [{ type: 'damage', value: 8 }, { type: 'vulnerable', value: 2 }],
  },

  pommel_strike: {
    id: 'pommel_strike', name: '柄击', cost: 1, type: 'attack',
    text: '造成 9 点伤害，抽 1 张牌。',
    effects: [{ type: 'damage', value: 9 }, { type: 'draw', value: 1 }],
  },

  // —— 以下不在初始牌组里，作为扩展示例。把 id 加进下面的 STARTER_DECK 即可使用 ——

  iron_wave: {
    id: 'iron_wave', name: '铁浪', cost: 1, type: 'attack',
    text: '造成 5 点伤害，获得 5 点格挡。',
    effects: [{ type: 'damage', value: 5 }, { type: 'block', value: 5 }],
  },

  twin_strike: {
    id: 'twin_strike', name: '双重打击', cost: 1, type: 'attack',
    text: '造成 2 次 5 点伤害。',
    effects: [{ type: 'damage', value: 5, hits: 2 }],
  },

  shrug_it_off: {
    id: 'shrug_it_off', name: '不屑一顾', cost: 1, type: 'skill',
    text: '获得 8 点格挡，抽 1 张牌。',
    effects: [{ type: 'block', value: 8 }, { type: 'draw', value: 1 }],
  },

  inflame: {
    id: 'inflame', name: '燃烧之血', cost: 1, type: 'power',
    text: '获得 2 点力量。',
    effects: [{ type: 'strength', value: 2 }],
  },

  weaken: {
    id: 'weaken', name: '震慑', cost: 0, type: 'skill',
    text: '给敌人施加 1 层虚弱。',
    effects: [{ type: 'weak', value: 1 }],
  },
};

/* ===========================================================================
 *  初始牌组 —— 一局战斗开局时拥有的牌。
 *  直接写卡牌 id，写几次就有几张。改这里即可调整牌组。
 * ===========================================================================
 */
CG.STARTER_DECK = [
  'strike', 'strike', 'strike', 'strike',
  'defend', 'defend', 'defend', 'defend',
  'bash',
  'pommel_strike',
];

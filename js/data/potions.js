window.CG = window.CG || {};

/* ===========================================================================
 *  药水（消耗品）—— 战斗中使用一次性消耗。
 * ===========================================================================
 *  约定：debuff 给敌人(side:'enemy')，buff 给自己(side:'self')。
 *  effect:
 *    { kind:'status', side:'enemy'|'self', status, value }   施加状态
 *    { kind:'draw', value }                                  抽牌
 *  想加新药水：往下面加一项即可（引擎按 effect.kind 处理）。
 * ===========================================================================
 */
(function (CG) {
  CG.POTIONS = {
    vuln:  { name: '易伤药水', color: '#e05550', icon: '🧪', desc: '敌人获得 3 层易伤', effect: { kind: 'status', side: 'enemy', status: 'vulnerable', value: 3 } },
    weak:  { name: '虚弱药水', color: '#3fae62', icon: '🧪', desc: '敌人获得 3 层虚弱', effect: { kind: 'status', side: 'enemy', status: 'weak', value: 3 } },
    frail: { name: '脆弱药水', color: '#4a86e0', icon: '🧪', desc: '敌人获得 3 层脆弱', effect: { kind: 'status', side: 'enemy', status: 'frail', value: 3 } },
    str:   { name: '力量药水', color: '#e8902a', icon: '⚗️', desc: '获得 2 层力量',     effect: { kind: 'status', side: 'self',  status: 'strength', value: 2 } },
    dex:   { name: '敏捷药水', color: '#46b3ec', icon: '⚗️', desc: '获得 2 层敏捷',     effect: { kind: 'status', side: 'self',  status: 'dexterity', value: 2 } },
    draw:  { name: '抽取药水', color: '#efe9da', icon: '📜', desc: '抽 3 张牌',          effect: { kind: 'draw', value: 3 } },
  };

  CG.POTION_IDS = ['vuln', 'weak', 'frail', 'str', 'dex', 'draw'];
})(window.CG);

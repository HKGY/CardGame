window.CG = window.CG || {};

/* ===========================================================================
 *  卡牌数据 —— 目前简化为「打击 / 防御」两种基底卡 + 升级次数。
 * ===========================================================================
 *  为了方便，其它所有卡暂时都视为这两张的升级版：
 *    一张卡实例 = { uid, base: 'strike'|'defend', upgrade: N }
 *    显示名写作 “打击+N”，每升级一次数值 +step(=3)。
 *      打击  : 6 伤害   打击+1: 9   打击+2: 12 …
 *      防御  : 5 格挡   防御+1: 8   防御+2: 11 …
 *
 *  想调整基础数值/步长，改 BASE_CARDS 即可；想加全新机制的卡，
 *  以后在 BASE_CARDS 里加一种 kind 并在 cardStats 里扩展。
 * ===========================================================================
 */
(function (CG) {
  let _uid = 0;
  CG.nextUid = () => ++_uid;

  CG.BASE_CARDS = {
    strike: { name: '打击', cost: 1, type: 'attack', kind: 'damage', base: 6, step: 3 },
    defend: { name: '防御', cost: 1, type: 'skill',  kind: 'block',  base: 5, step: 3 },
  };

  // 由卡牌实例({base, upgrade}) 计算出当前 名称 / 数值 / 效果
  CG.cardStats = function (inst) {
    const b = CG.BASE_CARDS[inst.base];
    const up = inst.upgrade || 0;
    const value = b.base + b.step * up;
    const name = b.name + (up > 0 ? '+' + up : '');
    const text = b.kind === 'damage' ? `造成 ${value} 点伤害。` : `获得 ${value} 点格挡。`;
    const effects = [{ type: b.kind === 'damage' ? 'damage' : 'block', value }];
    return { base: inst.base, upgrade: up, name, cost: b.cost, type: b.type, kind: b.kind, value, text, effects };
  };

  CG.makeCard = (base, upgrade = 0) => ({ uid: CG.nextUid(), base, upgrade });

  // 初始牌组：5 打击 + 5 防御
  CG.STARTER_DECK = ['strike', 'strike', 'strike', 'strike', 'strike',
                     'defend', 'defend', 'defend', 'defend', 'defend'];
})(window.CG);

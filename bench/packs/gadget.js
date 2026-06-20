'use strict';
/* 奇巧包（gadget）轻量钩子 —— 随机为主、通用搜索已能采样评估；只补「老虎机保底计数」这一隐藏状态。 */
const value = require('../value');
value.registerPack('gadget', {
  battle(CG, g) {
    return (g._slots || 0) * 2;        // 老虎机每第 3 张爆发；计数越接近 3，下一张老虎机牌越值
  },
});

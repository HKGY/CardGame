window.CG = window.CG || {};

/* ===========================================================================
 *  种子随机数 —— 用可重现的 PRNG 覆盖全局 Math.random。
 * ===========================================================================
 *  CG.RNG.seed(str)：把字符串哈希成种子并替换 Math.random，使其后所有随机
 *    （地图生成 / 掉落 / 洗牌 / 敌人 AI 等）都按该序列产生 —— 相同种子 = 相同结果。
 *  CG.RNG.randomSeed()：用原生随机生成一个 6 位种子串（留空开局时用）。
 * ===========================================================================
 */
(function (CG) {
  const nativeRandom = Math.random.bind(Math);   // 保留原生随机，用于生成默认种子

  function hashStr(str) {                         // FNV-1a -> 32 位无符号
    let h = 2166136261 >>> 0;
    str = String(str);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function mulberry32(seed) {                      // 小巧确定性 PRNG
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let curSeed = null;
  CG.RNG = {
    seed(str) { curSeed = String(str); Math.random = mulberry32(hashStr(curSeed)); return curSeed; },
    current() { return curSeed; },
    randomSeed() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let s = '';
      for (let i = 0; i < 6; i++) s += chars[Math.floor(nativeRandom() * chars.length)];
      return s;
    },
  };
})(window.CG);

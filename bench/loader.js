'use strict';
/* ===========================================================================
 *  离线评测加载器 —— 把 window.CG 纯逻辑模块装进 vm 上下文（同 test/harness.js），
 *  并额外注入「可快照的随机源」：前向搜索时需要保存 / 恢复 RNG 状态。
 * ===========================================================================
 *  返回 { CG, ctx, rng }：
 *    rng.seed(str)  把字符串哈希成种子并重置随机流（覆盖上下文里的 Math.random）。
 *    rng.get()/set(v)  读取 / 写回随机流状态（用于评估候选出牌时回滚随机）。
 *  注意：游戏代码全部跑在 vm 上下文里，用的是 ctx.Math.random；我们在加载完成后
 *  用一个状态可读写的 mulberry32 接管它，从而能在外层 Node 里快照 / 恢复。
 * ===========================================================================
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const FILES = [
  'js/util/rng.js',
  'js/data/cards.js',
  'js/data/affixes.js',
  'js/data/tarot.js',
  'js/data/relics.js',
  'js/data/config.js',
  'js/data/enemies.js',
  'js/engine/effects.js',
  'js/engine/game.js',
  'js/engine/run.js',
];

function hashStr(str) {                       // FNV-1a -> 32 位（与 rng.js 同算法）
  let h = 2166136261 >>> 0;
  str = String(str);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function build() {
  const ctx = vm.createContext({ console });
  ctx.window = ctx;
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

  // 注入 bench RNG（mulberry32，状态 s 可读写）并接管 ctx.Math.random。
  // 必须在游戏文件加载之后执行，以覆盖 rng.js 里安装的那个闭包随机源。
  vm.runInContext(`(function () {
    let s = 1;
    globalThis.__rng = {
      set(v) { s = v >>> 0; },
      get() { return s; },
      next() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), 1 | t);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
    };
    Math.random = globalThis.__rng.next;
  })();`, ctx);

  const benchRng = ctx.__rng;
  const rng = {
    seed(str) { benchRng.set(hashStr(str)); return str; },
    get() { return benchRng.get(); },
    set(v) { benchRng.set(v); },
  };

  return { CG: ctx.CG, ctx, rng };
}

module.exports = { build, hashStr };

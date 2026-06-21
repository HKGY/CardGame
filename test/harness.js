'use strict';
/* ===========================================================================
 *  测试用加载器 —— 在 Node 里加载浏览器风格的 window.CG 纯逻辑模块。
 * ===========================================================================
 *  游戏源码用 `window.CG = window.CG || {}` + IIFE 的全局模式，本身不依赖打包器。
 *  这里建一个 vm 上下文，让它的「全局对象」同时充当 window：
 *    ctx.window = ctx  =>  window.CG、裸 CG（config.js / enemies.js 用）都指向 ctx.CG。
 *  只加载 data/ 与 engine/（纯逻辑，不碰 DOM）；ui/ 需浏览器环境，不在单测范围。
 *  加载顺序严格对齐 index.html。
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
  'js/data/affix-vp.js',
  'js/data/tarot.js',
  'js/data/relics.js',
  'js/data/config.js',
  'js/data/enemies.js',
  'js/engine/effects.js',
  'js/engine/game.js',
  'js/engine/run.js',
];

const ctx = vm.createContext({ console });   // vm 上下文：内置 Math/Object/Array/JSON…，补上 console
ctx.window = ctx;                            // 让 window === 全局对象

for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}

const CG = ctx.CG;

// 便捷构造：一副指定基底/宝石的牌（用于战斗测试）
//   entries 项：[base, gemAffixes[][], limit?]，gemAffixes 形如 [[{id,level}], ...]
CG.makeDeck = entries => entries.map(([base, gemAffixes, limit]) =>
  CG.makeCard(base, limit || (gemAffixes ? gemAffixes.length : 1) || 1,
    (gemAffixes || []).map(affs => CG.makeGem(affs))));

// 便捷构造：一个最小可战斗的 Game（不依赖 Run / DOM）
CG.makeBattle = (opts = {}) => new CG.Game({
  enemyIds: opts.enemyIds || ['green_slime'],
  tier: opts.tier || 'normal',
  deck: opts.deck || CG.makeDeck(Array.from({ length: 10 }, () => ['spell', [[{ id: CG.STRIKE, level: 1 }]]])),
  hp: opts.hp || 60, maxHp: opts.maxHp || 60,
  tarot: [], relics: opts.relics || [], run: opts.run || null,
  actScale: opts.actScale || { hp: 1, dmg: 1 }, hpMult: opts.hpMult || 1, enemyM: opts.enemyM,
});

module.exports = CG;

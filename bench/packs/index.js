'use strict';
/* 各包策略模块汇总入口 —— 自动 require 本目录下所有 *.js（index 除外），require 即注册。
 * 新增一个包策略只需在 bench/packs/ 下放一个 <id>.js（调用 value.registerPack），无需改本文件
 * （故多 agent 并行实现各包时不会写同一文件、无冲突）。某个文件加载报错只跳过它、不拖垮其余。
 */
const fs = require('node:fs');
const path = require('node:path');
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.js') || f === 'index.js') continue;
  try { require(path.join(__dirname, f)); }
  catch (e) { console.error('[packs] 加载失败 ' + f + '：' + e.message); }
}

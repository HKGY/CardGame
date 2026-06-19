# CLAUDE.md

残响之塔（Echoing Spire）—— 纯前端卡牌爬塔，借鉴《Noita》的**法杖/宝石系统**。
纯 HTML + 原生 JS，**无构建步骤、无任何图片/音频外部素材**。玩法细节见 `README.md`。

> **本文件即本项目的「记忆」。** 所有需要跨会话记住的偏好 / 约定 / 事实都写在这里，
> **不使用单独的 memory 系统、也不依赖它**。每当出现新的持久事实或用户偏好，更新本文件即可。

## 提交前必须全部测试通过（硬性要求）

- **任何 commit 之前必须先跑 `npm test`，全部用例全绿（当前 39 例）才允许提交。** 红 / 跳过都不许提交。
- 改了 `js/data/` 或 `js/engine/`（纯逻辑）→ **同步增改 `test/` 用例** 再跑测试，不要让覆盖率退化。
- 改了 UI（`js/ui/*`、`css/`、`index.html`）→ 单测覆盖不到：**在浏览器打开 `index.html` 人工自测**，并在回复里说明已人工验证了什么。
- 如实报告：测试失败就贴输出；某部分没验证就明说。**不得谎报“通过”。**

## Commit / 分支规范

- **只在用户明确要求时**才 commit；push 同样由用户掌控，别擅自 push。
- 在默认分支（`main`）上做**大改动先开分支**再提交；小修按用户指示。
- 提交信息用**中文摘要行**（跟随本仓库历史风格，无 `feat:`/`fix:` 之类前缀），例：
  `法杖/宝石系统重做 + 单元测试`。较大改动：摘要行 + 空行 + `-` 要点列表。
- **每条 commit 信息结尾必须带**（单独一行）：

  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

## 环境

- 本机**有网络**，可用 `pacman` 装包；**已装 Node（pacman，v26+）与 npm**，`npm test` 直接可用。
- 本仓库**无浏览器/无 headless**（除非另装）；故 UI 层只能靠浏览器人工自测，单测只覆盖纯逻辑层。

## 测试怎么跑

- `npm test`（= `node --test test/*.test.js`），Node 内置 runner，**无第三方依赖**，不产生 `node_modules`。
- `test/harness.js` 用 `vm` 上下文把浏览器风格的 `window.CG` 模块（`data/` + `engine/`，纯逻辑）加载进来（`window` 即全局对象）。UI 层依赖 DOM，**不在单测范围**。
- 注意跨 vm realm：断言数组/对象**用 `.length` 或逐值比较**，别用 `deepEqual`（原型不同会判不等）。

## 架构要点（动代码前先懂）

- **全局模式**：每个文件 `window.CG = window.CG || {}` + IIFE，成员挂到 `window.CG`；按 `index.html` 的 `<script>` 顺序加载，无打包器。`config.js`/`enemies.js` 用裸 `CG`（= 全局），其余用 IIFE 参数 `CG`。
- **分层**：`data/`（数据）、`engine/`（纯逻辑，不碰 DOM）、`ui/`（碰 DOM）。`Run`（跑图持久态，run.js）与 `Game`（单场战斗，game.js）分离，靠 `onChange` 回调刷新界面。
- **无外部素材，别再引入 png/mp3**：立绘/卡面=内联 SVG（`sprites.js`/`render.js`），场景背景=纯 CSS 渐变（`background.js` + `css` 里的 `.scene-*`），音效=Web Audio 即时合成（`audio.js`），背景音乐已停用（`music.js` 为空壳接口）。
- **宝石/法杖**：效果绑定在「宝石」上，宝石镶进「卡牌(法杖)」的孔位；`cardStats()` 聚合一张卡所有孔位里的词条 → 数值/效果/卡名。安装免费，卸下花钱且随机加一个 debuff。
- **改了任何 `js/` 或 `css/` → 必须把 `index.html` 里对应的 `?v=NN` 版本号全部 +1**（无构建的静态站靠 query 串破浏览器缓存；当前 `v=46`）。

## 改内容 / 调平衡的位置

- 数值/经济：`js/data/config.js`　｜　词条：`js/data/affixes.js`　｜　宝石生成规则：`js/data/cards.js` 的 `rollGem`。
- 加敌人：`js/data/enemies.js` + `ENEMY_POOLS`；加敌人贴图：`js/ui/sprites.js`（一段 SVG，key 对应敌人 `sprite`）。
- 加新效果：`CG.Effects.register('type', (game, eff, source, target) => {…})`（`js/engine/effects.js`），卡与敌人招式共用。

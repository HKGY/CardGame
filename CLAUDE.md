# CLAUDE.md

残响之塔（Echoing Spire）—— 纯前端卡牌爬塔，借鉴《Noita》的**法杖/宝石系统**。
纯 HTML + 原生 JS，**无构建步骤、无任何图片/音频外部素材**。玩法细节见 `README.md`。

> **本文件即本项目的「记忆」。** 所有需要跨会话记住的偏好 / 约定 / 事实都写在这里，
> **不使用单独的 memory 系统、也不依赖它**。每当出现新的持久事实或用户偏好，更新本文件即可。

## 改动前：先通读全项目

- **同一个 session 内，做任何改动之前，必须已通读项目里的每一个文件**（不止要改的那个），先建立全局理解再下手。

## 提交前必须全部测试通过（硬性要求）

- **任何 commit 之前必须先跑 `npm test`，全部用例全绿（当前 75 例）才允许提交。** 红 / 跳过都不许提交。
- 改了 `js/data/` 或 `js/engine/`（纯逻辑）→ **同步增改 `test/` 用例** 再跑测试，不要让覆盖率退化。
- 改了 UI（`js/ui/*`、`css/`、`index.html`）→ 单测覆盖不到：**在浏览器打开 `index.html` 人工自测**，并在回复里说明已人工验证了什么。
- 如实报告：测试失败就贴输出；某部分没验证就明说。**不得谎报“通过”。**

## Commit / 分支规范

- **测试全绿后，agent 可自行 commit**（无需每次再征求同意）；但 **push 始终由用户掌控**，不要擅自 push。
- 在默认分支（`main`）上做**大改动先开分支**再提交；小修按用户指示。
- **合并分支一律用 rebase（GitHub 的 rebase and merge 方式）：把分支上的每个 commit 逐个按原样接到目标分支顶端，保留各 commit 独立、全部是单亲，不产生 merge commit（两个 parent）、也不把它们压成一个。** 本地操作用 `git rebase`（而非 `git merge`）；若处于 merge 状态请先 `git merge --abort` 改走 rebase。
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
- **地图＝《以撒的结合》式房间布局**：每层 `act`（1..maxActs，定敌人池/数值膨胀/场景）一张 `genIsaacFloor`（**BFS 泛洪**，参考 boristhebrave 的 gen.js）：居中起点出队、依次试四邻——未占用 && 该格相邻房 ≤1（防环→始终是树）&& 未达 maxRooms && 50% 门槛，才长新房入队；没长出子房的房＝「死路」。首领＝最后一个死路（最远）且不与起点相邻；**宝藏/商店/诅咒/小boss/祭坛 各保底 1（先占死路），再按 `map.extra` 概率追加同类**；房间数不足/首领贴脸→重生成（≤200 次，再不行 `genIsaacFallback`）。房间 `{id,gx,gy,type,done,combat,reveal}`，type ∈ `start|normal|elite|boss|shop|treasure|curse|altar`（**正交相邻即有门相连**＝可走）。普通房按 `normalEnemyChance`(已调低) 藏敌，藏敌房有 `telegraphChance` 概率 `reveal=true`（地图上露 ⚔️，**另一半隐藏不剧透**）。`selectNode`（点击 / **WASD**）走进相邻房：未清的 boss/elite/`normal&&combat`→开战，`shop`→商店，`treasure`→白送遗物，`curse`→`_enterCurse`（耗血换 **2 个随机商店货色**：宝石/法杖/塔罗/遗物，立即免费入手；`_grantCurseOffer`），`altar`→`_enterAltar`（宝石祭坛，复用事件屏），其余仅移动；首领清掉 `_nextAct` 进下一层/通关。`grid={type:'isaac',cols,rows,rooms,entrance,boss}`。地图自机贴图＝`sprites.js` 的 `hero_token`。
- **地图渲染**：核心 `buildMapGrid(run, mini)` 产网格 HTML（带战争迷雾），`showMap` 用它出交互大图、`renderMinimap` 出非交互略缩图。**房间格尺寸固定**（CSS `.map-grid --cell`，网格随房间数变大、不缩放；`.map-wrap` 可横向滚动）。**战争迷雾**：只渲染「去过的房间 + 其正交相邻房 + 当前 available」，其余画成 `void` 迷雾；门只画两端都已揭示的。特殊房可见即露图标，普通藏敌房按 `reveal` 决定露不露 ⚔️。
- **战斗界面左上角略缩地图**：`startBattle` 调 `CG.Screens.renderMinimap(run)` 填 `#battle-minimap`（`.map-grid.mini`：1fr 列 + `aspect-ratio` 缩进固定小盒、无图标只标当前位）。进战斗时只渲染一次（`render()` 不动它）。
- **进入战斗的演出**：地图→战斗时 `route` 先调 `CG.Screens.zoomMapToRoom`（镜头缩放放大到所在房间格、淡出），回调里 `startBattle` 再 `playBattleEntrance`（给 `#screen-battle` 加 `.entering` 触发 CSS `fly-*` 关键帧，控件从屏幕外飞入）。两者都尊重 `prefers-reduced-motion`。
- **无外部素材，别再引入 png/mp3**：立绘/卡面=内联 SVG（`sprites.js`/`render.js`），场景背景=纯 CSS 渐变（`background.js` + `css` 里的 `.scene-*`），音效=Web Audio 即时合成（`audio.js`），背景音乐已停用（`music.js` 为空壳接口）。
- **宝石/法杖**：效果绑定在「宝石」上，宝石镶进「卡牌(法杖)」的孔位；`cardStats()` 聚合一张卡所有孔位里的词条 → 数值/效果/卡名。安装免费，卸下花钱且随机加一个 debuff。
- **Booster pack（词条分类）**：词条按主题分进 `CG.PACKS`（`affixes.js`，5 包：基础/强攻/诅咒/节奏/生机）。`CG.rollGem` 接 `opts.pack` 把增益/减益限定在该包池内；**不传 pack 时按 tier 自动选包**（`CG.pickPack`，权重见 `config.js` 的 `packW`），故所有产宝石处（奖励/商店/祭坛/重铸/遗物）都按包生成。战斗奖励整包同一主题并存 `pending.pack`，奖励界面先展示未拆封的包再点开三选一。卸下惩罚 `gemAddRandomDebuff` 例外，仍从全部减益池抽。
- **商店出售 booster pack**：货架含三种包（`config.js` 的 `shop.packs` 定 `count/pick/tier/price`）：三选一、五选一、**五选二**（`pick:2`，凑元素连招用）。`run.buyPack(i)` 扣钱并 roll 出 `count` 颗同主题宝石存 `pending.packs[i].rolled`；`run.takePackGem(i,uid)` 挑宝石进背包，最多 `pick` 颗（记 `takenUids`，挑满置 `taken`）；`leaveShop` 安全网：买了没挑满的包自动按 `gemPrice` 补走剩余名额。UI 复用既有 picker（`openPackPicker`，挑一颗后若有名额自动续开），无新增 DOM。
- **元素 / 元素反应（元素包）**：4 元素 `CG.ELEMENTS`（火/水/雷/冰）+ 反应矩阵 `CG.REACTIONS`/`CG.reactionFor`（`affixes.js`）。元素＝敌人身上的一种状态，**至多 1 种、层数 1~3（值即层数）、不进 `_tickStatuses` 故不衰减**；附着词条 `flame/aqua/volt/frost`（`element` 字段，附着层数=词条等级）→ `cardStats().element` / `.elementLevel`。结算在 `game.js` 的 `playCard`：异元素消耗 `min(prev,new)` 级、反应「发生这么多次」、余量留在层数多的一方，同元素叠加封顶 3。放大型(蒸发/融化)按 `×amplify^消耗层数` 重建伤害、需本牌有伤害；转化型(超载/感电/冻结/超导)把 `apply` 调用「消耗层数」次（复用 `_reactionBurst`/中毒/冰冻/易伤）。`_auraOf/_setAura(el,level)/_clearAura` 管理唯一光环；徽标在 `render.js` 的 `STATUS_META`。
- **每局限定 4 个卡包**：开局 `Run` 调 `CG.rollRunPacks()`（`basic` 恒含 + 从增强包随机 3 个，其余本局不出）存入 `run.packs`，并 `CG.setActivePacks(run.packs)`；`pickPack` 之后只在这 4 个里选（含 `rollGem` 不传 pack 的自动选包），故本局所有产宝石处都受限。`setActivePacks(null)` 恢复全开。百科「卡包」页标注本局启用/未启用。（注：现共 6 包 = basic + 5 增强：power/curse/tempo/vitality/elements。）
- **改了任何 `js/` 或 `css/` → 必须把 `index.html` 里对应的 `?v=NN` 版本号全部 +1**（无构建的静态站靠 query 串破浏览器缓存；当前 `v=58`）。

## 改内容 / 调平衡的位置

- 数值/经济：`js/data/config.js`（`map.gridW/gridH/roomsBase/roomsPerAct/maxRooms/minRooms/normalEnemyChance/telegraphChance/extra`、`curse.hpCostPct`、`packW` 选包权重、`shop.packs` 商店包档位/价格）　｜　词条：`js/data/affixes.js`　｜　卡包分类：`affixes.js` 的 `CG.PACKS`　｜　宝石生成规则：`js/data/cards.js` 的 `rollGem` / `pickPack`。
- 地图布局：`js/engine/run.js` 的 `genIsaacFloor`；地图渲染 + WASD：`js/ui/screens.js` 的 `showMap` / `init` 里的 keydown（CSS `.map-grid`/`.map-cell`/`.map-doors`/`.map-hero`）；进战斗演出：`zoomMapToRoom` + `playBattleEntrance`（CSS `.entering` / `fly-*`）。
- 加敌人：`js/data/enemies.js` + `ENEMY_POOLS`；加敌人贴图：`js/ui/sprites.js`（一段 SVG，key 对应敌人 `sprite`）。
- 加新效果：`CG.Effects.register('type', (game, eff, source, target) => {…})`（`js/engine/effects.js`），卡与敌人招式共用。

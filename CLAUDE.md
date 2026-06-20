# CLAUDE.md

残响之塔（Echoing Spire）—— 纯前端卡牌爬塔，借鉴《Noita》的**法杖/宝石系统**。
纯 HTML + 原生 JS，**无构建步骤、无任何图片/音频外部素材**。玩法细节见 `README.md`。

> **本文件即本项目的「记忆」。** 所有需要跨会话记住的偏好 / 约定 / 事实都写在这里，
> **不使用单独的 memory 系统、也不依赖它**。每当出现新的持久事实或用户偏好，更新本文件即可。

## 改动前：先通读全项目

- **同一个 session 内，做任何改动之前，必须已通读项目里的每一个文件**（不止要改的那个），先建立全局理解再下手。

## 提交前必须全部测试通过（硬性要求）

- **任何 commit 之前必须先跑 `npm test`，全部用例全绿（当前 228 例）才允许提交。** 红 / 跳过都不许提交。
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
- **Booster pack（词条分类）**：词条按主题分进 `CG.PACKS`（`affixes.js`，最初 5 包：基础/强攻/弱化(id `weaken`)/节奏/生机）。`CG.rollGem` 接 `opts.pack` 把增益/减益限定在该包池内；**不传 pack 时按 tier 自动选包**（`CG.pickPack`，权重见 `config.js` 的 `packW`），故所有产宝石处（奖励/商店/祭坛/重铸/遗物）都按包生成。战斗奖励整包同一主题并存 `pending.pack`，奖励界面先展示未拆封的包再点开三选一。卸下惩罚 `gemAddRandomDebuff` 例外，仍从全部减益池抽。
- **商店出售 booster pack**：货架含三种包（`config.js` 的 `shop.packs` 定 `count/pick/tier/price`）：三选一、五选一、**五选二**（`pick:2`，凑元素连招用）。`run.buyPack(i)` 扣钱并 roll 出 `count` 颗同主题宝石存 `pending.packs[i].rolled`；`run.takePackGem(i,uid)` 挑宝石进背包，最多 `pick` 颗（记 `takenUids`，挑满置 `taken`）；`leaveShop` 安全网：买了没挑满的包自动按 `gemPrice` 补走剩余名额。UI 复用既有 picker（`openPackPicker`，挑一颗后若有名额自动续开），无新增 DOM。
- **元素 / 元素反应（元素包）**：4 元素 `CG.ELEMENTS`（火/水/雷/冰）+ 反应矩阵 `CG.REACTIONS`/`CG.reactionFor`（`affixes.js`）。元素＝敌人身上的一种状态，**至多 1 种、层数 1~3（值即层数）、不进 `_tickStatuses` 故不衰减**；附着词条 `flame/aqua/volt/frost`（`element` 字段，附着层数=词条等级）→ `cardStats().element` / `.elementLevel`。结算在 `game.js` 的 `playCard`：异元素消耗 `min(prev,new)` 级、反应「发生这么多次」、余量留在层数多的一方，同元素叠加封顶 3。放大型(蒸发/融化)按 `×amplify^消耗层数` 重建伤害、需本牌有伤害；转化型(超载/感电/冻结/超导)把 `apply` 调用「消耗层数」次（复用 `_reactionBurst`/中毒/冰冻/易伤）。`_auraOf/_setAura(el,level)/_clearAura` 管理唯一光环；徽标在 `render.js` 的 `STATUS_META`。
- **主题融合（每局把选定主题融成「一个」融合包）**：25 个包现在是「**主题**」。开局 `Run` 把 `run.packs`（默认 `CG.rollRunPacks()`＝`basic` + 随机 3 个主题；玩家可在开始菜单自选任意数量）传给 `CG.setActivePacks(run.packs)`，后者调 `CG.buildFusionPack(ids)` 造出唯一的 `CG.PACKS.fusion = {fusion:true, buffs:各主题增益并集, debuffs:各主题减益并集, themes:[...]}`。**`pickPack` 本局恒返回 `'fusion'`**，故战斗奖励/商店/祭坛/诅咒所有扩充包都＝这一个融合包，每颗宝石从并集池独立抽 → **主题混合**（一颗大宝石的增益/减益甚至可能来自不同主题）。`setActivePacks(null)` 删除 `CG.PACKS.fusion` 并回退「无 run」兜底（单测里 `rollGem({pack:'xxx'})` 显式指定主题仍直达该主题池）。`CG.gemTheme(gem)` 按首个增益的 `affixGroupOf` 归主题，用于奖励/商店里给每颗宝石标主题。`CG.PACK_IDS` 在 `affixes.js` 加载时即快照（25 主题，**不含 `fusion`**），故运行时往 `CG.PACKS` 加 `fusion` 不污染主题列表。（注：现共 25 主题 = basic + 24：…/discard(弃牌)/conjure(术士)/hunter(猎杀)/flow(律动)/amplify(放大)。**注意 `power` 是强攻、弱化 id 是 `weaken`、电力 id 是 `elec`、市场 id 是 `econ`(同名 affix `market` 是厨艺调味料、勿混)，地图「诅咒房」是房型 `curse`、与主题无关。**）**调试/自选**：`new Run(cls, opts)` 的 `opts.packs` 非空（滤非法 id）则用它当本局主题、否则回退 `rollRunPacks()`；开始菜单 `#menu-debug` 的主题开关默认填入 `rollRunPacks()`（基础+3 随机）、可任意增删（≥1 个才能开始），点开始经 `getSelectedPacks()` 传入。
- **厨艺包（cook）**：玩法迥异于其它「词条包」——它的增益 `farm/ranch/market/kitchen` 与减益 `rot/spoil/mold` 都带 `give` 字段：打出带该宝石的卡时，`cardStats` 产出 `{type:'give',what,value}` 效果，`effects.give` 调 `game.giveFoodCard` 把**食材卡**加进手牌（仅本场）。食材卡是 `BASE_CARDS` 里的特殊卡（`food`/`kind:cookware|spoiled|meal`），**不走宝石聚合**——`cardStats` 命中 `CG.isFood` 即转交 `CG.foodStats`。**做菜**：打出素菜→`game._startCraft`→`craftChoose(meatUid|null)`→`craftChoose(seasonUid|null)`→`CG.buildMeal`（菜谱矩阵 `CG.RECIPE`，值=素菜级×荤菜级×2；盐过载×2 / 酱油＝给餐点加 `滋养`(nourish) 状态(放主效果前，故本餐治疗也 +50%) / 胡椒重复2 次）做成 0 费消耗「餐点」卡进手牌。每个 give 词条只给 **1 张** 食材（食材本身已分 1~3 级，不按词条等级翻倍）。厨具（菜刀/铁锅/火炉）＝**0 费**武器。调味料/腐坏卡 `noPlay`；腐坏卡在 `endTurn` 的 `_tickStatuses` 之后结算自伤/虚弱/易伤再消耗。`滋养`：真词条（生机包 `nourish`，`selfStatus:'nourish'`），`game.heal` 按 `1+0.5×层` 放大、本场不衰减。UI：`render.js` 的 `renderCraft` 浮层 + `main.js` 的 `onCraftPick/onCraftCancel`。
- **消耗包（exhaust）**：玩「消耗」。增益 灰烬/燃烧/涅槃/不坏/重生、减益 爆燃/着火/噩梦。**灰烬** 在 `playCard` 里按 `exhaustPile.length × 等级` 加数值（同连击写法）。**所有进消耗堆都走 `game._exhaustCard`**：触发 `nirvana`(被消耗时 `_applyCardEffects` 再结算一遍，`_inExhaust` 防递归) 与 `undying`(用 `makeCard` 复制一张**新 uid**进手牌)。**燃烧/重生** 是交互选牌：`playCard` 末尾把 `'burn'`/`'reborn'` 压进 `_pickQueue`→`_nextPick` 设 `game.pick`→UI(`renderPrompt` 同一浮层)→`pickResolve(uid|null)`。**爆燃** `exhaustAllHand`、**噩梦** `fillNightmare`(渣滓 `dross` 塞满至 `HAND_LIMIT` 10) 走效果处理器。**灼伤(burn)**：新状态，像中毒但 `_dealBurn` 过格挡（可被挡）；玩家在 `endTurn` 结算、敌人在 `runEnemyTurn` 结算，均在 `_tickStatuses` 里 -1。`渣滓`：1 费/打出即消耗/无效果（`isFood`+`foodStats` 处理）。
- **电力包（elec，注意非 `power`）**：引入第二资源 **电力 `player.power`**（`_startBattle` 初始 0、`restart` 清 0、**`_startPlayerTurn` 不重置**＝战斗内跨回合保留；UI 在能量下方 `.power-line`）。增益 发电(`gainPower`)/改造(`overclock`)/电弧(`arc`)/放电(`discharge`=`element:'thunder',elementBase:2`)/充电(`charge`)；减益 感电(`shock`=`selfThunder`→`selfElement` 给玩家挂雷光环)/麻痹(`paralyze`)/漏电(`drain`=`losePower`)。**改造(超频)** 在 `playCard` 资源结算处：`oc=s.overclock` 时改扣电力 `s.cost×oc`(不足则打不出、能量不动)，并把 damage/block/heal `×oc`。**电弧** 同灰烬：`+player.power×等级`。**麻痹**：`_paralyze`(turn 标志，`_startPlayerTurn` 清零)，`playCard` 中 `idx < _paralyze` 的牌禁止打出；`handCardHTML` 据手牌下标禁用并加 `.paralyzed`。元素 `elementBase` 在 `cardStats`：`elementLevel=(elementBase||1)×L`。`cardStats` 透出 `overclock/arc`，`foodStats` 补 0 默认。
- **调试功能（两处）**：①**开始菜单·卡包开关**——`#menu-debug`（`index.html`）由 `screens.js` 的 `renderMenuDebug` 填每个包一个 `.pack-toggle`（默认全关，状态存模块级 `debugPacks` Set + 全选/清空/随机助手）；`#menu-start` 经 `syncMenuStart` 在选中 0 个时禁用（**至少开 1 个才能开始**），点击经 `H.onStart(getSelectedPacks())`→`chooseClassAndStart(packs)`→`newRun('warrior', seed, {packs})`。②**顶栏·自定义宝石**——`#debug-btn`（战斗时随顶栏隐藏）开 `#debug-modal`；`renderDebug` 按 `CG.affixGroupOf`（`affixes.js`：按主题包把每个词条恰好归一组，`AFFIX_GROUP_ORDER`/`affixGroupMeta` 取展示信息）分组列词条，每词条 1/2/3 选等级（点高亮等级移除）、`CG.UI.gemFace({affixes})` 实时预览，「加入背包」走 `H.onDebugAddGem`→`run.debugAddGem(affixes)`（夹 1~3、滤非法、`_emit` 刷新顶栏宝石数）。
- **A 组 6 包（复用现有引擎，多 agent 并行实现后合并）**：**死守(bastion)**＝以格挡为核心：重甲(`battle._keepBlock`，`_startPlayerTurn` 不清格挡)/盾击(`shieldBash`，playCard 伤害 +当前格挡)/死战(`lastStand` 残血加伤)/严阵(格挡+力量)/龟缩(`loseEnergy`)/负重(`loseBlock`)；复用 壁垒/笨重。**生产(produce)**＝回合开始被动产出：`player.statuses.prod*`(不进 `_tickStatuses`、在 `_startPlayerTurn` 末结算) 耕作(抽)/蓄能(格挡)/复利(蓄能自增)/丰收(兑现)/灌溉(立即)/歉收(prodSkip)/养护(扣能)/滞产。**留置(retain)**＝留牌养牌：`cardStats.retain` 使 `endTurn` 不弃该牌；`inst.heldTurns/heldBonus/holdCost` 在 `_startPlayerTurn` 抽牌前结算；蓄力一击/屯牌在 playCard 加成。**强化(enhance)**＝本场永久成长：`inst.growth/costDown/plays/awakened`(战斗克隆实例上、不写回牌组)，`cardStats` 把 growth/共鸣加进 value、costDown 减 cost、过锻 growth≥6 置 exhaust。**虚无(void)**＝牺牲/空：playCard 用 `handAfter=hand.length-1` 算 空明(+)/虚空回响(空手×2)/空虚(非空÷2)；舍身/湮灭/献祭/蚀骨/放逐 走 effects（`offer/erode` 改本场 `player.maxHp`）。**奇巧(gadget)**＝随机：dice/coinflip/jackpot/slots(`battle._slots` 伪随机保底)/misfire/fickle/backfire 走 effects（随机源 `Math.random` 被 `CG.RNG` 接管→固定种子可断言）；百宝箱复用 `randbuff`。**注**：cardStats 的 `value=`/`cost=` 行同时被 retain(heldBonus/holdCost)+enhance(growth/costDown/resonance) 修改；playCard 的加成块顺序＝先加法(连击/灰烬/电弧/盾击/死战/蓄力/屯牌/空明)后乘法(虚空回响/空虚)。
- **B 组 3 包（各引入一种战斗资源）**：**市场(econ)**＝金币当战斗资源（金币＝`run.gold`；handler 一律 `if(game.run)` 守卫，无跑图时跳过）：投资(花金币造伤)/进账/贸易/雇佣/暴富(playCard 数值 +金币÷10×等级)；负面 赋税/通胀(×0.8)/赌债(钱不足改失血)。**矿工(miner)**＝深度 `battle._depth`：开采(+深度、每跨 5 掘出金币/格挡)/爆破/寻脉(playCard 伤害+深度)/采石(playCard 格挡+深度)/富矿(向 `run.gems` 掘随机宝石)；负面 塌方/贫矿/矿难。**锻造(forge)**＝热度 `battle._heat`：鼓风/余烬重击(playCard 伤害+热度)/熔炼(造热度伤害后清零)/淬炼(换格挡后清零)/白热；负面 过热(复用 `burn` 灼伤)/崩裂/锈蚀。`_depth`/`_heat` 在 `_startBattle` 初始化、`restart` 清零、**`_startPlayerTurn` 不重置**（战斗内保留）；UI 在能量下方 `.power-line` 复用显示 💰/⛏️/🔥。playCard 资源加成块(windfall/prospect/quarry/ember)紧跟电弧、属「先加法」组。
- **召唤包（summon）**：引入**己方召唤物** `game.allies`（`_startBattle`/`restart` 初始化为 `[]`、跨回合保留）。每个 ally `{name,icon,hp,maxHp,atk,taunt,giveBlock}`，上限 6。**回合末** `endTurn` 调 `_allyAttack()`：图腾给格挡、其余 `_dealRaw(currentTarget, atk)` 攻击当前敌人。**嘲讽**：`runEnemyTurn` 里敌人**伤害类**效果若存在 `_tauntAlly()` 则 `_hitAlly()` 重定向到它（其它效果仍打玩家）。增益 唤骷髅(`summon:'skeleton'`)/群召(swarm,3 个)/立图腾(totem,只给格挡)/督战(`command`:全体+攻并立即 `_allyAttack`)/守护灵(guardian,taunt)；减益 索命(`toll`＝复用 `hpLoss`)/折损(`culling` 随机消灭)/内讧(`discord` 全体扣血)。召唤物死亡走 `_reapAllies()` 过滤。UI：`render.js` 的 `renderAllies` 动态生成 `#allies-bar`（只读）。
- **建造包（build）**：场上**建筑** `game.buildings`（`_startBattle`/`restart`=[]、跨回合保留、槽位上限 5）。每个 `{kind,name,icon,power}`。**回合开始** `_startPlayerTurn` 末调 `_buildingsTick()`：箭塔(`arrowtower`)对随机敌人造伤、路障(`rampart`)给格挡、熔炉(`furnace`)+力量；**工坊(`workshop`)** 经 `_workshopBonus()` 给其它建筑每次 `_fireBuilding` 加成。**拆解(`demolish`)** 拆最早一座、立即 `_fireBuilding` 它 `3×L` 次。减益 工伤(`hazard`＝复用 `hpLoss`)/坍塌(`collapse` 随机摧毁)/沉降(`subside` 全体 power-L)。`_fireBuilding(b,wb)` 既供回合开始也供拆解复用。UI：`render.js` 的 `renderBuildings` 动态生成 `#buildings-bar`（`.allies-bar.right`，只读）。**至此 20 包路线图全部完成。**
- **弃牌包（discard）**：主动丢弃换收益。`game._discard(card)`/`_discardRandom(n)` 把手牌进弃牌堆并累加 `_discardedThisTurn`（`_startPlayerTurn` 清零）。抛掷(toss 弃1造伤)/整理(sift 弃2抽2)/疯狂(madness 弃光手牌+力量) 走 effects；**倾倒(dumpster)** 是 playCard 加成；**拾遗(reclaim)** 复用选牌队列——`pick.type` 新增 `'reclaim'`(从 `discardPile` 取回；`_nextPick`/`pickResolve`/`renderPrompt` 三处已支持)。负面 健忘(复用`clutch`)/浪费(复用`loseEnergy`)/漏能(复用`leak`)。
- **术士包（conjure）**：凭空造牌/操纵牌库。`game._addToHand(card)`(满则进弃牌堆) 给 演卡(印打击/防御)/飞刀(印 3 张 `shiv` 基底=0费造4消耗)/复制(复制随机手牌)/谵妄(塞渣滓) 用；灵视(foresight)复用 `_applyCardEffects` 免费打出 `drawPile` 顶；**心灵震慑(mindblast)** 复用 `inst.growth`——给牌库里所有 `type==='attack'` 的牌实例 `growth += 等级`。新基底 `shiv` 走 `isFood`/`foodStats`(同 `dross`)。
- **猎杀包（hunter）**：借敌人状态爆发。处决(execute 残血斩杀)/弱点爆破(exploit 引爆 `_enemyDebuffLayers` 按层造伤)/收割(reaping→`_reaping` 累加) 走 effects；**收割的击杀钩子在 `_checkEnd`**：敌 alive→dead 时若 `_reaping>0` 给玩家 +力量。猎物(prey 伤害+目标减益层数)/洞察(insight 敌意图 `intent` 含 attack 则×) 是 playCard 加成。`_reaping` restart/_startBattle 清零（本场累加、不每回合清）。
- **律动包（flow）**：条件触发&能量博弈。活力(vigor→`_vigor` 跨回合、playCard 消耗给下一张+数值)/灵感(inspire→`_inspire` 本回合、`drawCards` 每抽一张给格挡) 走 effects；**固有(innate)** 由 `_startBattle` 把 `cardStats(c).innate` 的牌 sort 到 `drawPile` 末尾＝开局首抽；全力(allin 打出后能量=0则×)/余裕(surplus 能量≥阈值则 `payCost=0`) 在 playCard 资源处。`_vigor` 跨回合保留、`_inspire`/`_ampX` 每回合 `_startPlayerTurn` 清零。
- **回溯（rewind，律动第 6 个增益）**：`game._snapshot()`/`_restore(s)` 存取「完整战斗快照」(双方 hp/block/电力/statuses，元素光环在 statuses 内)。打出存 `_rewindSnap`；`_startPlayerTurn` 顶部若有快照则 `_restore` 并清空＝把敌人这一回合整体抹去。
- **放大包（amplify）**：翻倍。强效(potent 本牌伤害/格挡/治疗×(1+等级)) 是 playCard 加成；**倍损(amppain)/倍益(ampgain)** 设本回合标志 `_ampDebuff`/`_ampBuff`，在 `applyStatus` 里把给敌减益/给己增益的 `amount` ×2（每回合清）；激赏(boon)复用 `addTempStrength`(回合末清)、极化(polarize)把当前力量翻倍。
- **改了任何 `js/` 或 `css/` → 必须把 `index.html` 里对应的 `?v=NN` 版本号全部 +1**（无构建的静态站靠 query 串破浏览器缓存；当前 `v=78`）。

## 改内容 / 调平衡的位置

- 数值/经济：`js/data/config.js`（`map.gridW/gridH/roomsBase/roomsPerAct/maxRooms/minRooms/normalEnemyChance/telegraphChance/extra`、`curse.hpCostPct`、`packW` 选包权重、`shop.packs` 商店包档位/价格）　｜　词条：`js/data/affixes.js`　｜　卡包分类：`affixes.js` 的 `CG.PACKS`　｜　宝石生成规则：`js/data/cards.js` 的 `rollGem` / `pickPack`。
- **平衡：`score` 是稀有度/强度的核心杠杆**（`rollGem`）——小宝石主增益按 `8-score` 取（**score 越高越稀有**）、大宝石按 `score` 取（强词条更常被选中）、减益按 `6+score` 取（**越负越稀有**）。**统一评分尺**（动新词条/调平衡时照此对齐，别让某包整体偏离）：增益 2=琐碎 / 3=次要 / 4=扎实 / 5=强力(各包基石如 overclock/barricade/temper/command/nirvana/smelt/workshop…) / 6=顶级(仅 `bright` +能量)；减益 -2=轻微 / -3=中等 / -4=严重(越狠越该 -4、越稀有)。score 须落在 buff[2,6] / debuff[-4,-2] 内，否则权重公式失真。**避免「指数级永久资源」**：如富矿(richvein)只掘 **1 颗**宝石/次、不随等级翻倍（宝石＝最高价值资源，可重复打出 → 不能按等级放大）。深度的数值平衡仍需浏览器实战验证。
- 地图布局：`js/engine/run.js` 的 `genIsaacFloor`；地图渲染 + WASD：`js/ui/screens.js` 的 `showMap` / `init` 里的 keydown（CSS `.map-grid`/`.map-cell`/`.map-doors`/`.map-hero`）；进战斗演出：`zoomMapToRoom` + `playBattleEntrance`（CSS `.entering` / `fly-*`）。
- 加敌人：`js/data/enemies.js` + `ENEMY_POOLS`；加敌人贴图：`js/ui/sprites.js`（一段 SVG，key 对应敌人 `sprite`）。
- 加新效果：`CG.Effects.register('type', (game, eff, source, target) => {…})`（`js/engine/effects.js`），卡与敌人招式共用。

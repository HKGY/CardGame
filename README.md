# 卡牌爬塔 · Demo

一个类《杀戮尖塔（Slay the Spire）》的单人卡牌 Roguelite **基底**：在地图上连续闯关，
打普通怪 / 精英 / 首领，逛商店、休息升级，攒金币和牌组。纯 HTML + 原生 JS，无需构建。

## 运行

直接用浏览器打开 `index.html`。或起本地静态服务器：

```bash
cd cardgame && python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

## 玩法

- 在**地图**上点击发光节点前进：⚔️战斗　💀精英　🛒商店　🏕️休息　👑首领（首领前固定一个休息点）。
- **战斗**：每回合 3 能量、抽 5 张；看敌人头顶**意图**决定攻防；血量在整局中保留。
- 战斗胜利得**金币** + **三选一卡牌奖励**；精英 / 首领给更多金币、更高等级的卡。
- **休息点**：回血 或 升级一张卡。**商店**：花金币买卡 / 升级卡 / 治疗。
- 打败首领通关；血量归零失败。可随时点顶栏「🂠 牌库」查看当前牌组。

### 卡牌（已简化）

目前所有卡都视为「打击 / 防御」的升级版，写作 `打击+X`，每升级一次数值 **+3**：

| 卡 | 基础 | +1 | +2 |
|----|----|----|----|
| 打击（伤害） | 6 | 9 | 12 |
| 防御（格挡） | 5 | 8 | 11 |

## 目录结构

```
index.html              页面骨架（多个 .screen）+ 脚本加载顺序
css/style.css           样式
js/
├─ data/                ★ 改这里来调内容 / 数值
│  ├─ cards.js          基底卡 + cardStats（升级换算）+ 初始牌组
│  ├─ config.js         经济/进度参数：血量、金币区间、价格、地图行数、奖励权重
│  └─ enemies.js        普通/精英/首领敌人 + ENEMY_POOLS 分组
├─ engine/              纯逻辑，不碰 DOM
│  ├─ effects.js        效果处理器（damage/block/draw/strength/weak…，可扩展）
│  ├─ game.js           单场战斗状态机（由 Run 提供牌组与血量）
│  └─ run.js            一次爬塔：血量/金币/牌组/地图/商店/休息/奖励
└─ ui/
   ├─ sprites.js        角色贴图（内联 SVG）
   ├─ render.js         战斗界面 + 输入 + 精灵动画（导出 cardFace 复用卡面）
   └─ screens.js        地图/奖励/商店/休息/结算 各屏 + 顶栏 + 升级选牌
js/main.js              入口/控制器：按 run.phase 路由各屏，编排战斗
```

所有模块挂在全局 `window.CG`，按 `index.html` 的顺序加载。

## 怎么改

- **平衡数值**：`js/data/config.js`（起始血量、各档金币区间、商店价格、地图行数、奖励升级权重）。
- **卡牌基础值/步长**：`js/data/cards.js` 的 `BASE_CARDS`。
- **加敌人**：`js/data/enemies.js` 加一项并放进 `ENEMY_POOLS` 对应档位；招式复用效果系统，
  可选 `chooseMove(game, history)` 自定义 AI。
- **加敌人贴图**：`js/ui/sprites.js` 加一段 SVG（key 与敌人的 `sprite` 字段对应）。
- **加新效果**：`CG.Effects.register('thorns', (game, eff, source, target) => {...})`，卡牌与敌人招式都能用。

## 架构要点

- **Run（meta）与 Battle 分离**：`run.js` 持有跨战斗的持久状态；战斗 `game.js` 由 `new Game({deck, hp, maxHp, enemyId})`
  实例化，结束后 `run.finishBattle(win, hp)` 回收结果。引擎都不依赖 DOM，便于测试。
- **数据驱动**：卡牌/敌人/经济都是数据；地图与奖励由 `config.js` 的参数生成。
- **界面分屏**：`main.js` 按 `run.phase` 切换 `.screen`；战斗界面与跑图界面解耦，靠 `onChange` 回调刷新。

# 卡牌战斗 · Demo

一个类《杀戮尖塔（Slay the Spire）》单场战斗的卡牌游戏**基底**，纯 HTML + 原生 JS，无需任何构建工具。

## 运行

直接用浏览器打开 `index.html` 即可。

或起一个本地静态服务器（可选）：

```bash
cd cardgame
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000
```

## 玩法

- 每回合有 3 点能量，开局抽 5 张牌。
- 点击手牌打出（消耗能量）；攻击/格挡/抽牌等按卡牌效果结算。
- 留意敌人头顶的**意图**，决定进攻还是防御。
- 点「结束回合」后敌人行动，然后进入下一回合。
- 把敌人血量打到 0 获胜；自己血量归零失败。每局随机一个敌人。

## 目录结构

```
index.html            页面骨架 + 脚本加载顺序
css/style.css         样式
js/
├─ data/
│  ├─ cards.js        ★ 卡牌数据（改卡牌就改这里）
│  └─ enemies.js      ★ 敌人数据（改敌人就改这里）
├─ engine/
│  ├─ effects.js      效果处理器（可扩展新效果类型）
│  └─ game.js         战斗引擎 / 状态机（纯逻辑，与界面解耦）
├─ ui/
│  └─ render.js       界面渲染 + 输入转发
└─ main.js            入口 / 控制器
```

所有模块都挂在全局 `window.CG` 命名空间下，按 `index.html` 里的顺序加载。

## 怎么改卡牌 / 敌人

### 加一张新卡

在 `js/data/cards.js` 的 `CG.CARDS` 里加一项，再把它的 id 放进 `CG.STARTER_DECK`：

```js
cleave: {
  id: 'cleave', name: '横扫', cost: 1, type: 'attack',
  text: '造成 8 点伤害。',
  effects: [{ type: 'damage', value: 8 }],
},
```

一张卡的 `effects` 是按顺序结算的效果列表。内置效果类型：
`damage`（可加 `hits` 多段）、`block`、`draw`、`energy`、`heal`、
`strength`、`dexterity`、`vulnerable`、`weak`。

### 加一个新敌人

在 `js/data/enemies.js` 的 `CG.ENEMIES` 里加一项，写好 `moves`。
可选地实现 `chooseMove(game, history)` 自定义 AI；不写则用默认 AI
（随机出招、不会连用同一招 3 次）。

### 加一种新效果

在 `js/engine/effects.js` 里注册即可，卡牌和敌人招式都能用：

```js
CG.Effects.register('thorns', (game, eff, source) => {
  game.applyStatus(source, 'thorns', eff.value);
});
```

## 设计要点

- **数据与逻辑分离**：卡牌/敌人是纯数据，引擎不认识具体某张卡，只认识「效果」。
- **效果系统对称复用**：玩家卡和敌人招式共用同一套 `effects`
  （`source` 施放者、`target` 对方），所以同一个效果两边都能用。
- **引擎与界面解耦**：`game.js` 不碰 DOM，状态变化通过 `onChange` 回调通知界面，方便后续替换 UI 或写测试。

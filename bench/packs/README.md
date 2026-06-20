# 各包策略模块（bench/packs/）—— 实现契约

目标：为某个 booster pack 写一个 `bench/packs/<id>.js`，通过 `value.registerPack` 注入估值/经济钩子，
让搜索型核心 AI（`bench/ai-core.js`）**把这个包打出应有的强度**，并用 `bench/eval.js` 量到提升。

## 一句话原理

核心 AI 出牌靠**前向模拟**：克隆战斗 → 在克隆上用**真实引擎** `playCard` → 用 `value.V` 给局面打分 → 选最优。
因此**即时机制会被引擎自动正确结算**（元素反应、超频 overclock、连击 combo、灰烬 ashes、盾击、做菜出餐…
都不用你重写）。你要补的是通用 V **看不到的长期价值** 与 **宝石经济**：

- 常驻资源/铺垫的价值：电力囤积、生产层数、消耗堆大小、空手、留置在手回合、本场永久成长…
- 该留/该装哪些宝石、装到哪张卡（攻/守基底）。
- 做菜/燃烧/重生/目标 的策略覆盖（可选）。

## 钩子 API（都可选；缺省即回退通用值）

```js
const value = require('../value');
value.registerPack('<id>', {
  // 局面附加分：在 V 末尾加到总分（每步出牌搜索都会调用）。返回 number。
  battle(CG, g) { return 0; },
  // 宝石价值附加分：影响留取/购买/安装优先级。ctx = { run, packs }。返回 number。
  gem(CG, gem, ctx) { return 0; },
  // 安装契合度附加项：把 gem 装到 card 的额外加成（加到基础乘子上）。返回 number。
  install(CG, gem, card, ctx) { return 0; },
  // 做菜覆盖（cook）：返回 { meatUid, seasonUid }（uid 可为 null=跳过），或 null 用通用策略。
  craft(CG, g) { return null; },
  // 燃烧/重生选牌覆盖（exhaust）：type='burn'|'reborn'。返回 uid / null(跳过) / undefined(用通用)。
  pick(CG, g, type) { return undefined; },
});
```

`g` 是战斗对象（同 `CG.Game`）：`g.player.{hp,maxHp,block,energy,power,statuses}`、`g.enemies`、
`g.hand/drawPile/discardPile/exhaustPile`、`g.turn`、`g.aliveEnemies()`、`g.exhaustPile.length` 等。
注意 `battle(CG,g)` 会在**克隆**上被反复调用，**只读、纯函数、别改 g**。

## 估值标度（让你的加分量级对得上）

通用 V 关键项（`bench/value.js`）：
- `projHp * 12`（projHp = 当前血 − 预计挨打），生存最重；`projHp<=0` 再 `-6000`。
- 敌人总血 `-ehp * 1.5`；濒死敌人 `+10`；每个存活敌人 `-8`。
- 力量 `×6`/敏捷 `×4`/中毒 `×2.5`/易伤·虚弱 `×2`/冰冻 `+9`/电力 `×0.6`。

经验换算：**1 点价值 ≈ 0.083 点玩家血 ≈ 0.67 点敌人血**。所以「值半条命的铺垫」≈ +6 左右，
别动辄给几百分（会压过保命导致送死）。宝石价值参考：`affix.score×level`（buff 正、debuff 负×1.3）。

## 怎么测

```bash
node bench/eval.js 60 core <id>     # 跑 {basic} 基线 + {basic,<id>}，看该行 win% 与 Δ
```
- 目标：**抬高 `basic+<id>` 的胜率 / Δ**，且**不要出现 STUCK**（STUCK=对峙判负，多为 AI 不会收杀）。
- 同时跑 `node bench/eval.js 60 core`（全包）确认**没有把别的包/基线弄坏**（你的钩子只在该包出现时生效，理论上不会）。
- 收敛后用 `node bench/eval.js 120 core <id>` 复测稳定性。
- 也跑一遍 `node bench/eval.js 60 core <id>`（带 `HP=45` 前缀）看更高难度下是否仍有效。

## 约束

- 只新建你自己的 `bench/packs/<id>.js`；**不要改** `value.js / ai-core.js / host.js / loader.js / index.js`，
  也不要碰 `js/`（游戏代码）。bench 代码**无需 bump 版本号**。
- 钩子要**纯函数**（不依赖时间/不写状态/不调随机）。确保 `node -e "require('./bench/packs/<id>.js')"` 干净加载。
- 参考实现：`bench/packs/produce.js`（生产包，已把 62.5%→80%）。

## 提醒（来自项目方）

**胜率低不一定是包弱，也可能是 AI 没把它玩明白。** 你的任务是让 AI 把这个包**该有的强度发挥出来**——
不是去刷虚高的数字，而是消除「AI 不会玩」这个干扰项。如果你判断某机制 AI 确实难以利用、或包本身偏弱，
在最终报告里**如实说明**，并给出你观察到的证据（典型死法、被浪费的机制）。

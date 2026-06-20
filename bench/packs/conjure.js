'use strict';
/* 术士包（conjure）策略模块 —— M3 模式：通过 value.registerPack 注入估值钩子。
 *
 * 机制要点（凭空造牌/复制/灵视/牌库强化）：
 *   - conjure(演卡)：打出后临时印 (1+level) 张随机基础牌（打击/防御）进手牌（仅本场）。
 *   - daggers(飞刀)：印 3 张「飞刀」(0 费·造 4 伤·打出即消耗)进手牌，相当于 0 费打出 12 点伤害。
 *   - duplicate(复制)：复制随机手牌 1 张（副本进手牌，含原卡的全部宝石槽）。
 *   - foresight(灵视)：免费打出抽牌堆顶 1 张牌（不耗能量直接结算效果）。
 *   - mindblast(心灵震慑)：本场永久：手牌+抽牌堆+弃牌堆里所有攻击牌 growth += level。
 *   - clutter(谵妄)：打出后向手牌塞 level 张渣滓（1 费·无效果·打出即消耗），污染手牌。
 *
 * 通用 V 的盲点：
 *   ① mindblast 触发后，draw/discardPile 里攻击牌实例的 growth 已更新，但通用 V
 *     只看当前手牌的 cardStats——抽牌堆 / 弃牌堆里的 growth 要等打出时才体现。
 *   ② clutter 渣滓（1 费、什么都不做）占手牌槽位 + 浪费能量，通用 V 低估长期惩罚。
 *   ③ 演卡/飞刀/灵视造牌的即时价值（更多可打的牌）rollout 会自动感知，无需额外补偿。
 *
 * 标度参考（来自 README）：
 *   1 点价值 ≈ 0.083 血 ≈ 0.67 敌血；「值半条命的铺垫」≈ +6。
 *   本模块最大附加约 10~15，量级合理。
 */
const value = require('../value');

value.registerPack('conjure', {

  // ---- 局面附加分 ----
  // 主要补偿 mindblast 对 draw/discardPile 里攻击牌 growth 的延迟收益，
  // 以及 clutter 渣滓在手牌中的隐性损失。
  battle(CG, g) {
    let v = 0;

    // mindblast 延迟价值：draw/discardPile 里攻击牌已积累的 growth
    // 手牌里的 growth 已被 cardStats().value 体现，这里只补充看不到的部分。
    const drawGrowth = g.drawPile.reduce((s, c) => {
      const b = CG.BASE_CARDS[c.base];
      return (b && b.type === 'attack' && c.growth > 0) ? s + c.growth : s;
    }, 0);
    const discGrowth = g.discardPile.reduce((s, c) => {
      const b = CG.BASE_CARDS[c.base];
      return (b && b.type === 'attack' && c.growth > 0) ? s + c.growth : s;
    }, 0);

    // 抽牌堆的 growth 比弃牌堆更快兑现（不需等洗牌循环）
    v += drawGrowth * 0.9;
    v += discGrowth * 0.5;
    // 早回合铺 mindblast，其收益覆盖更多回合
    if (g.turn <= 3) v += (drawGrowth + discGrowth) * 0.4;

    // 渣滓污染惩罚：手牌中每张渣滓 = 占用槽位 + 若打出浪费 1 能量
    const dross = g.hand.filter(c => c.base === 'dross').length;
    v -= dross * 2.5;

    return v;
  },

  // ---- 宝石价值附加分 ----
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      if (d.mindblast) {
        // 心灵震慑：全牌库攻击牌永久 +level 成长，长期价值极高
        // 战士起手约 5 张打击，每 1 级 = 每场战斗至少 +5 总伤害，随回合数线性增长
        v += 4.5 * a.level;
      }
      if (d.daggers) {
        // 飞刀：打出即得 3 张 0 费飞刀（各造 4 点伤害），等效 0 能量 12 点伤害
        v += 3.0 * a.level;
      }
      if (d.conjure) {
        // 演卡：每回合多 (1+level) 张牌可打，增加出牌选项
        v += 2.0 * a.level;
      }
      if (d.foresight) {
        // 灵视：免费打出牌堆顶，节省能量同时推进牌组循环
        v += 2.5 * a.level;
      }
      if (d.duplicate) {
        // 复制：复制含宝石手牌（副本保留所有宝石孔），等效宝石投资翻倍
        v += 1.8 * a.level;
      }
      if (d.clutter) {
        // 谵妄：每次打出塞渣滓，长期来说每张渣滓 ≈ 1 能量浪费 + 槽位占用
        // 比基础 score=-3 更严重，再额外扣分
        v -= 2.5 * a.level;
      }
    }
    return v;
  },

  // ---- 安装契合度附加 ----
  // mindblast / daggers / foresight / conjure 装在攻击牌（strike/shieldbash）上效率更高：
  // 攻击牌通常打出频率高，且自带伤害值，与这些生成型/强化型词条协同更好。
  install(CG, gem, card) {
    let bonus = 0;
    const isAtk = card.base === 'strike' || card.base === 'shieldbash';

    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;

      if (d.mindblast && isAtk) {
        // mindblast 在攻击牌上：打攻击顺带触发，逻辑协同
        bonus += 0.25 * a.level;
      }
      if ((d.daggers || d.foresight) && isAtk) {
        // 飞刀/灵视在攻击牌上：攻击牌出牌频率高，触发更多
        bonus += 0.15 * a.level;
      }
      if (d.conjure && isAtk) {
        // 演卡在攻击牌上：打攻击顺带生成更多牌
        bonus += 0.1 * a.level;
      }
    }
    return bonus;
  },
});

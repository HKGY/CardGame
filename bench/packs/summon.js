'use strict';
/* 召唤包（summon）策略模块
 * 机制：game.allies 跨回合保留（上限 6），回合末 _allyAttack() 自动出力；嘲讽召唤物重定向敌人伤害。
 * 通用 V 对 allies 完全盲目——召唤物是「持久输出 + 持续格挡 + 挡刀盾」，V 看不到这些长期价值。
 * 修复策略：battle 钩子按 ATK/giveBlock/taunt/HP 给召唤物板面定价；gem/install 给召唤增益加权。
 *
 * 估值标度参考（value.js）：1 点价值 ≈ 0.083 玩家血 ≈ 0.67 敌血
 *   敌血 ehp × -1.5 → 消 1 敌血=+1.5；每回合 4 攻骷髅理论永久贡献 4×1.5=6/回合（折现保守）
 *   玩家血 projHp × 12 → 1 hp = 12 pts；图腾每回合 3 格挡约抵 1.5 pts 的生存压
 */
const value = require('../value');

value.registerPack('summon', {
  // ---- 局面附加分：核心是给召唤物板面定价 ----
  battle(CG, g) {
    const allies = g.allies;
    if (!allies || !allies.length) return 0;

    // 估算敌方每次攻击的基础伤害（用于嘲讽值换算：挡刀 ≈ 减少这么多伤害）
    // playerIncomingDamage() 已含格挡/减伤；用 rawIncoming 估算单次打击
    const alive = g.aliveEnemies();
    let rawIncoming = 0;
    for (const e of alive) {
      const p = g.intentPreview ? g.intentPreview(e) : null;
      if (p && p.damage != null) rawIncoming += p.damage * (p.hits || 1);
    }
    // 每次嘲讽吸收的期望伤害（平均到每回合来做折现）
    const tauntAbsorb = Math.min(rawIncoming, 20); // 上限防止爆分

    let v = 0;
    let totalAtk = 0, totalBlock = 0, hasTaunt = false;

    for (const a of allies) {
      if (a.hp <= 0) continue;

      // 存活权重：HP 越低越脆弱，期望寿命折现（hp < 4 基本是消耗品）
      const hpRatio = Math.min(1, a.hp / Math.max(1, a.maxHp));
      // 不是所有召唤物都有 maxHp 字段，做兜底
      const survivalFactor = a.hp <= 2 ? 0.4 : a.hp <= 6 ? 0.7 : hpRatio * 0.9 + 0.1;

      // 每回合末攻击出力：∑atk×1.5（敌血价值）× 存活折现 × 回合折现
      // 搜索只看一回合的 V 差，所以需要把「未来N回合的持续收益」折算为现在的附加分
      // 经验：2~3 回合折现系数约 2.5 比较合理（不能太高否则会为了保召唤物放弃防御）
      if (a.atk > 0) {
        const dps = a.atk * 1.5;          // 单次攻击的敌血价值
        totalAtk += dps * survivalFactor;
      }

      // 每回合末格挡产出（图腾）：相当于生存价值 giveBlock×0.2（溢出格挡 0.2/点，略低于 projHp 权重）
      if (a.giveBlock > 0) {
        totalBlock += a.giveBlock * 0.3 * survivalFactor;
      }

      // 嘲讽：这回合/未来几回合帮玩家挡刀（只统计第一个 taunt，多个嘲讽重叠意义不大）
      if (a.taunt && !hasTaunt) {
        hasTaunt = true;
        // 嘲讽价值 = 吸收伤害 × hp存活率 × 对玩家血的价值(×12/7 折算)
        // 理解：挡住 20 伤 ≈ 保住 20/12 HP 价值，但已被 projHp 项间接捕捉，所以这里只加「减少直接压」
        const tauntVal = tauntAbsorb * survivalFactor * 0.8; // 0.8 = 保守系数防止双重计数
        v += Math.min(tauntVal, 15); // 单个嘲讽上限 15，别超过保命权重
      }
    }

    // 折现系数 2.5：大约等价于「未来 2~3 回合的期望价值」
    const DISCOUNT = 2.5;
    v += totalAtk * DISCOUNT;
    v += totalBlock * DISCOUNT;

    // 早回合铺召唤物价值更高（未来收益更多）
    if (g.turn <= 3 && (totalAtk > 0 || totalBlock > 0)) {
      v += (totalAtk + totalBlock) * 0.5;
    }

    return v;
  },

  // ---- 宝石价值附加分 ----
  gem(CG, gem) {
    let v = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      // 召唤增益：提前加价，鼓励选取和持有
      if (d.summon === 'skeleton') v += 5 * a.level;   // 骷髅：4L攻 = 高输出，主力
      if (d.summon === 'swarm')    v += 4 * a.level;   // 群召：3 只 2L攻，爆发但脆
      if (d.summon === 'totem')    v += 4 * a.level;   // 图腾：稳定格挡，防御向
      if (d.summon === 'guardian') v += 5 * a.level;   // 守护灵：嘲讽+高HP，保命关键
      if (d.command)               v += 4 * a.level;   // 督战：召唤物越多越强，但无召唤物时只有伤害
      // 减益：内讧/折损会伤害己方召唤物，加重惩罚
      if (d.discord)               v -= 3 * a.level;   // 内讧：全体扣血，可能清场自己的召唤物
      if (d.culling)               v -= 4 * a.level;   // 折损：直接消灭随机召唤物，很差
      // toll(索命)已有 score=-3，通用公式够用；不额外加分
    }
    return v;
  },

  // ---- 安装契合度：召唤类宝石适合装在较高费、稳定出牌的卡上 ----
  install(CG, gem, card) {
    let bonus = 0;
    for (const a of (gem.affixes || [])) {
      const d = CG.AFFIXES[a.id]; if (!d) continue;
      // summon/command 宝石装在攻击卡或防御卡都 OK（早打出早有召唤物）
      // 基础卡更便宜 = 更早更频繁打出 = 召唤物上场更早
      if (d.summon || d.command) {
        // 装在 0-1 费的基础卡（基础法杖）上优先（频繁打）
        bonus += card.base === 'strike' ? 0.1 : card.base === 'defend' ? 0.05 : 0;
      }
    }
    return bonus;
  },
});

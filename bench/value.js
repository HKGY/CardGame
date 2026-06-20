'use strict';
/* ===========================================================================
 *  价值函数 + 各包策略注册制（M2 的扩展缝）。
 * ===========================================================================
 *  - V(CG, game, packs)：评估一个战斗局面的好坏（越大越好），供前向搜索打分。
 *  - 各包可注册钩子修正估值 / 宝石价值 / 安装契合度 / 目标·做菜·选牌策略；
 *    未注册的包一律回退到「通用固定值」——故新包即插即用、之后再针对性调优。
 *
 *  注册：registerPack('elec', { battle, gem, install, target, craft, pick })
 *    battle(CG, g) -> number          局面附加分（如电力囤积、空手、产出层…）
 *    gem(CG, gem, ctx) -> number      宝石价值附加分（如元素连招、引擎件）
 *    install(CG, gem, card, ctx)->num 安装到某卡的附加契合分
 *    target(CG, g, cand) -> idx|null  覆盖攻击目标
 *    craft(CG, g) -> {meatUid,seasonUid}|null   覆盖做菜选择
 *    pick(CG, g, type) -> uid|null    覆盖燃烧/重生选牌
 * ========================================================================= */
const HOOKS = {};
function registerPack(id, hooks) { HOOKS[id] = Object.assign(HOOKS[id] || {}, hooks); }
function hooksFor(packs) { return (packs || []).map(id => HOOKS[id]).filter(Boolean); }
function packsRegistered() { return Object.keys(HOOKS); }

// 宝石倾向基底：攻击向→strike，格挡向→defend，否则 null。
function baseAffinity(CG, gem) {
  let atk = 0, def = 0;
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d || (d.value && d.value < 0)) continue;
    if (d.hits || d.combo || d.pierce || d.valuePct || d.shieldBash || d.lastStand || d.element ||
        d.lifesteal || d.arc || d.dice || d.coin || d.jackpot || d.slots || d.silence || d.poison || d.apply) atk += a.level;
    if (d.block || d.keepBlock || d.brace || d.selfStatus === 'thorns' || d.selfStatus === 'prodBlock') def += a.level;
  }
  return atk > def ? 'strike' : def > atk ? 'defend' : null;
}

// ---- 战斗局面估值 ----
function V(CG, g, packs) {
  if (g.phase === 'won') return 1e6 + g.player.hp * 10;
  if (g.phase === 'lost') return -1e6;
  const p = g.player;
  const incoming = g.playerIncomingDamage();        // 已计入格挡/减伤/圣盾/冰冻
  const projHp = p.hp - incoming;                    // 敌人下回合行动后预计血量（≤ hp，天然封顶 maxHp）
  let v = 0;
  v += projHp * 12;                                  // 生存压倒一切（projHp 已被 hp 封顶，不会奖励超额格挡）
  if (projHp <= 0) v -= 6000;                        // 本回合后会死：强惩罚（绝不自杀/必防御）
  v += Math.max(0, p.block - incoming) * 0.2;        // 溢出格挡（重甲/产出局略有意义）

  const alive = g.aliveEnemies();
  let ehp = 0; for (const e of alive) ehp += e.hp;
  v -= ehp * 1.5;                                    // 推进击杀（略高于旧值，缩短对峙/拉锯）
  for (const e of alive) if (e.hp <= 12) v += 10;    // 收尾濒死敌人（避免留半血拖局）
  v -= alive.length * 8;                             // 少一个敌人=少一份伤害源

  v += (p.statuses.strength || 0) * 6 + (p.statuses.dexterity || 0) * 4;
  v += (p.statuses.regen || 0) * 2 + (p.statuses.thorns || 0) * 2 + (p.statuses.nourish || 0) * 3;
  for (const e of alive) {
    v += (e.statuses.poison || 0) * 2.5 + (e.statuses.burn || 0) * 2;   // 我方铺的持续伤害=未来收益
    v += (e.statuses.vulnerable || 0) * 2 + (e.statuses.weak || 0) * 2 + (e.statuses.frozen ? 9 : 0);
    v -= (e.statuses.strength || 0) * 5;             // 敌人变强=坏
    v -= (e.block || 0) * 0.15;                       // 敌人格挡=坏：鼓励凿穿护盾、破解「带盾残血」的对峙僵局
  }
  v += (p.power || 0) * 0.6;                          // 电力（elec 包会再加权）

  for (const h of hooksFor(packs)) if (h.battle) { const b = h.battle(CG, g); if (b) v += b; }
  return v;
}

// ---- 宝石价值（通用分 + 各包加成）；ctx 含 { run, packs } ----
function gemValueGeneric(CG, gem) {
  let v = 0;
  for (const a of (gem.affixes || [])) {
    const d = CG.AFFIXES[a.id]; if (!d) continue;
    v += (d.score || 0) * a.level * (d.debuff ? 1.3 : 1);   // 减益分本为负，×1.3 略加重
  }
  return v;
}
function gemValue(CG, gem, ctx) {
  let v = gemValueGeneric(CG, gem);
  for (const h of hooksFor(ctx && ctx.packs)) if (h.gem) { const b = h.gem(CG, gem, ctx); if (b) v += b; }
  return v;
}

// ---- 安装契合度（把 gem 装到 card 的相对收益乘子 + 各包加成）----
function installFit(CG, gem, card, ctx) {
  const aff = baseAffinity(CG, gem);
  let m = 1;
  if (aff && card.base === aff) m = 1.3;
  else if (aff && (card.base === 'strike' || card.base === 'defend')) m = 0.8;   // 装错向打折
  let bonus = 0;
  for (const h of hooksFor(ctx && ctx.packs)) if (h.install) { const b = h.install(CG, gem, card, ctx); if (b) bonus += b; }
  return m + bonus;
}

// 安装一颗宝石的最佳收益 = gemValue × 最优空孔契合（无空孔则按基础乘子估其潜在价值）
function bestInstallScore(CG, gem, run, packs) {
  const ctx = { run, packs };
  const gv = gemValue(CG, gem, ctx);
  const slots = run.deck.filter(c => CG.cardEmptySockets(c) > 0);
  if (!slots.length) return gv;                       // 暂无空孔：给个潜在价值（可日后买孔）
  let best = -Infinity;
  for (const c of slots) best = Math.max(best, gv * installFit(CG, gem, c, ctx));
  return best;
}

module.exports = {
  registerPack, hooksFor, packsRegistered,
  V, gemValue, gemValueGeneric, installFit, bestInstallScore, baseAffinity,
};

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

// 宝石的真资源代价种类（条件/净化 → null）；用于「代价均摊」契合判断。
function gemCostRes(CG, gem) {
  if (gem.purified) return null;
  for (const a of (gem.affixes || [])) { const d = CG.AFFIXES[a.id]; if (d && d.cost && !d.cost.cond) return d.cost.res; }
  return null;
}
function baseAffinity() { return null; }   // v3 已无攻防基底；保留空壳供兼容

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
    v += (e.statuses.vulnerable || 0) * 2 + (e.statuses.weak || 0) * 2 + (e.statuses.frail || 0) * 1.5 + (e.statuses.frozen ? 9 : 0);   // v3 补敌脆弱（减益降权实测反伤 weaken，故维持原权重）
    v -= (e.statuses.strength || 0) * 5;             // 敌力量（负＝敌失力量 → 自动加分）
    v -= (e.statuses.dexterity || 0) * 2;            // 敌敏捷（负＝敌失敏捷 → 加分；v3 弱化包原子，原 V 漏估）
    v -= (e.block || 0) * 0.15;                       // 敌人格挡=坏：鼓励凿穿护盾、破解「带盾残血」的对峙僵局
  }
  v += (p.power || 0) * 1.0;                          // 电力（v3 可跨回合存，~1VP/点；elec 钩子在有消耗途径时再加权）

  for (const h of hooksFor(packs)) if (h.battle) { try { const b = h.battle(CG, g); if (b) v += b; } catch (e) {} }
  return v;
}

// ---- 宝石价值（通用分 + 各包加成）；ctx 含 { run, packs } ----
function gemValueGeneric(CG, gem) {
  let v = 0;
  for (const a of (gem.affixes || [])) {
    const vp = CG.affixVP && CG.affixVP(a.id, a.level);
    if (!vp) { const d = CG.AFFIXES[a.id]; v += ((d && d.score) || 4) * (a.level || 1); continue; }   // 兜底
    if (vp.signature) v += vp.gain + 4;                          // 执行/翻倍/吸血/狂暴：净正强力
    else if (gem.purified || vp.condCost) v += vp.gain;          // 净化 / 条件代价：无真资源消耗
    else v += vp.gain - 0.35 * vp.cost;                          // 真资源代价：价值VP − 能量/血/金 clog
  }
  return v;
}
function gemValue(CG, gem, ctx) {
  let v = gemValueGeneric(CG, gem);
  for (const h of hooksFor(ctx && ctx.packs)) if (h.gem) { try { const b = h.gem(CG, gem, ctx); if (b) v += b; } catch (e) {} }
  return v;
}

// ---- 安装契合度（把 gem 装到 card 的相对收益乘子 + 各包加成）----
function installFit(CG, gem, card, ctx) {
  let m = 1;
  const cr = gemCostRes(CG, gem);
  if (cr && (card.sockets || []).some(g => gemCostRes(CG, g) === cr)) m = 1.3;   // 代价均摊：同种真资源代价只付最高一个
  let bonus = 0;
  for (const h of hooksFor(ctx && ctx.packs)) if (h.install) { try { const b = h.install(CG, gem, card, ctx); if (b) bonus += b; } catch (e) {} }
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

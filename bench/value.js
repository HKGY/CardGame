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

// ===========================================================================
//  v3.2/3.4 时点(_next/_every) + 召唤物(_m) 估值
// ---------------------------------------------------------------------------
//  病根：带 _next/_every 的牌 cardStats 输出 kind='skill'、value=0，效果被「调度」到
//  game._nextTurn / game._everyTurn（下回合一次性 / 每回合循环）。旧 V 只看打完本回合的
//  即时局面 → 这些延迟/循环价值全无人估，整批 _next/_every 牌被系统性低估。
//  这里把「被调度的单个效果」换算成 V 点（与 V 主体同标度：血≈12/点、力量×6…），
//  再按时点折现：每回合=循环引擎(~×ENGINE)、下回合=一次性延迟(×NEXT_DISC)。
// ===========================================================================
const ENGINE_MULT = 2.0;   // 每回合(循环引擎)：约 2~3 回合折现现值（与 produce_energy 的「每回合=一次性×2」定价一致；过高会为护引擎弃防御）
const NEXT_DISC   = 0.6;   // 下回合(一次性延迟)：折现到现在 ~0.6

// 一个「被调度/召唤物施放」的单效果换算成 V 点（正＝对我有利）。
// 与 V() 主体同标度：1 HP ≈ 12V（这里取折半 ~6，因延迟/不确定 + 不超上限）；伤害 ≈ 敌血 1.5/点；
// 力量×6、敏捷×4、易伤/虚弱×2、脆弱×1.5、中毒×2.5、荆棘×2、抽牌×3、能量×3、电力×1、格挡×2。
function schedEffValue(eff) {
  if (!eff) return 0;
  const v = eff.value || 0;
  switch (eff.type) {
    case 'damage':       return v * (eff.hits || 1) * 1.5;           // 推进击杀
    case 'block':        return v * 2.0;                            // 每回合护盾≈减伤
    case 'heal':         return v * 6.0;                            // 回血（折半，可能溢出）
    case 'draw':         return v * 3.0;
    case 'energy':       return v * 3.0;
    case 'gainPower':    return v * 1.0;
    case 'strength':     return v * 6.0;
    case 'tempStrength': return v * 3.0;                            // 临时力量：仅本/下回合
    case 'dexterity':    return v * 4.0;
    case 'tempDexterity':return v * 2.0;
    case 'vulnerable':   return v * 2.0;                            // 给敌减益（调度时 target=当前敌）
    case 'weak':         return v * 2.0;
    case 'frail':        return v * 1.5;
    case 'poison':       return v * 2.5;
    case 'thorns':       return v * 2.0;
    case 'enemyStat':    return Math.abs(v) * (eff.key === 'strength' ? 5 : 2);   // 敌失力量/敏捷（value 为负）
    case 'summon':       return v * 1.5;                            // 召唤物血量上限增量
    case 'conjure':      return v * 2.0;                            // 造牌：牌权期权
    case 'give':         return 2.0;                                // 食材：潜在做菜价值
    default:             return 0;
  }
}
// 召唤物效果（minion:true）改投骷髅：减益/伤害仍打敌人（同上），但格挡/治疗/力量/荆棘等是「给骷髅」的
//   板面续航，价值低于给玩家（骷髅是消耗品）→ 打 0.6 折。
function minionEffValue(eff) {
  const base = schedEffValue(eff);
  switch (eff.type) {
    case 'damage': case 'vulnerable': case 'weak': case 'frail':
    case 'poison': case 'enemyStat':
      return base;                  // 仍作用于敌人，全额
    default:
      return base * 0.6;            // 给骷髅的格挡/治疗/力量/荆棘/敏捷：消耗品续航，折扣
  }
}
// 一条调度队列(_everyTurn/_nextTurn)的总分；带 minion 的效果若无骷髅则跳过（与引擎一致）。
function queueValue(g, queue, perEffMult) {
  let v = 0;
  for (const eff of (queue || [])) {
    if (eff.minion && !(g.skeleton && g.skeleton.hp > 0)) continue;   // 无骷髅 → 该 minion 效果不结算
    v += (eff.minion ? minionEffValue(eff) : schedEffValue(eff)) * perEffMult;
  }
  return v;
}
// 召唤物(骷髅)板面价值：替玩家挡刀的「血肉护盾」+ 自带格挡/状态（力量/敏捷/荆棘助攻后续 _m 攻击）。
//   骷髅不自动攻击，其攻击来自 _m 伤害词条（已在调度队列/即时效果里计），故此处只估「存在本身」的防御/续航。
function skeletonValue(g) {
  const sk = g.skeleton;
  if (!sk || sk.hp <= 0) return 0;
  let v = 0;
  v += Math.min(sk.hp, sk.maxHp || sk.hp) * 4.0;        // 血肉护盾：每点 HP 可替玩家吃一点伤害（折现 ~4，低于玩家血 12）
  v += (sk.block || 0) * 1.5;                           // 当前格挡（替玩家挡刀）
  const st = sk.statuses || {};
  v += (st.strength || 0) * 4.0 + (st.dexterity || 0) * 2.0 + (st.thorns || 0) * 2.0;   // 骷髅增益助攻其 _m 攻击/反伤
  return v;
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
    v += (e.statuses.vulnerable || 0) * 2 + (e.statuses.weak || 0) * 2 + (e.statuses.frail || 0) * 1.5 + (e.statuses.frozen ? 9 : 0);   // v3 补敌脆弱（减益降权实测反伤 weaken，故维持原权重）
    v -= (e.statuses.strength || 0) * 5;             // 敌力量（负＝敌失力量 → 自动加分）
    v -= (e.statuses.dexterity || 0) * 2;            // 敌敏捷（负＝敌失敏捷 → 加分；v3 弱化包原子，原 V 漏估）
    v -= (e.block || 0) * 0.15;                       // 敌人格挡=坏：鼓励凿穿护盾、破解「带盾残血」的对峙僵局
  }
  v += (p.power || 0) * 1.0;                          // 电力（v3 可跨回合存，~1VP/点；elec 钩子在有消耗途径时再加权）

  // v3.2 时点调度：每回合(循环引擎) + 下回合(一次性延迟)；v3.4 召唤物板面。
  v += queueValue(g, g._everyTurn, ENGINE_MULT);     // 每回合：循环引擎现值
  v += queueValue(g, g._nextTurn, NEXT_DISC);        // 下回合：一次性延迟折现
  v += skeletonValue(g);                             // 骷髅板面（血肉护盾 + 自身增益助攻 _m）

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

// ---- 出牌偏好（playPolicy）：给某候选牌一个「按包策略」的加分，修正搜索的回合内选牌 ----
//   这是 battle/gem 钩子做不到的一类：V 只评估「打完后的局面」，无法表达「现在更该打哪张」的策略偏好
//   （如 weaken：减益够了就优先把能量导向伤害/集火击杀；bastion：盾高了就该转伤害）。
function hasPolicy(packs) { return hooksFor(packs).some(h => h.playPolicy); }
function playPolicyBonus(CG, g, card, s, packs) {
  let b = 0;
  for (const h of hooksFor(packs)) if (h.playPolicy) { try { const x = h.playPolicy(CG, g, card, s); if (x) b += x; } catch (e) {} }
  return b;
}

module.exports = {
  registerPack, hooksFor, packsRegistered, hasPolicy, playPolicyBonus,
  V, gemValue, gemValueGeneric, installFit, bestInstallScore, baseAffinity,
};

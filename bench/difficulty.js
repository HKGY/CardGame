'use strict';
/* ===========================================================================
 *  敌人强度倍率 M —— 把敌人的「每个数值」整体乘 M（血量 / 攻击 / 格挡 / 力量 / 敏捷）。
 * ===========================================================================
 *  实现（bench 内打补丁，不改 js/）：
 *    - 血量、攻击(damage)、格挡(block)：折进 CG.CONFIG.actScale（同时被 _scaleEff 与
 *      intentPreview 读取 → AI 对来袭伤害的估计与实际一致，不会“误判”）。
 *    - 力量(strength)/敏捷(dexterity) 的敌方 buff：包裹 _scaleEff 额外 ×M（落进 statuses，
 *      之后 intentPreview 读到的也是放大值 → 一致）。
 *  setM(CG, M) 可重复调用切换难度；M=1 即原版。
 * ========================================================================= */
function install(CG) {
  if (CG.__diffInstalled) return;
  CG.__diffInstalled = true;
  CG.__enemyM = 1;
  CG.__baseActScale = JSON.parse(JSON.stringify(CG.CONFIG.actScale));   // 备份原始膨胀表
  const orig = CG.Game.prototype._scaleEff;
  CG.Game.prototype._scaleEff = function (eff, enemy) {
    const m = CG.__enemyM || 1;
    if (m !== 1 && (eff.type === 'strength' || eff.type === 'dexterity'))
      eff = Object.assign({}, eff, { value: Math.round(eff.value * m) });   // 敌方力量/敏捷 buff ×M
    return orig.call(this, eff, enemy);                                     // 再叠加 act 膨胀（仅 damage/block）
  };
}
function setM(CG, M) {
  install(CG);
  CG.__enemyM = M;
  for (const act in CG.__baseActScale) {
    const b = CG.__baseActScale[act];
    CG.CONFIG.actScale[act] = { hp: b.hp * M, dmg: b.dmg * M };            // 血量 & 攻击/格挡 ×M
  }
}
module.exports = { install, setM };

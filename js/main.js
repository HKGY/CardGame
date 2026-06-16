window.CG = window.CG || {};

/* ===========================================================================
 *  入口 / 控制器 —— 创建战斗、连接引擎与界面、编排敌人回合的演出节奏。
 * ===========================================================================
 */
(function (CG) {
  let game = null;

  function newBattle() {
    const ids = Object.keys(CG.ENEMIES);
    const id = ids[Math.floor(Math.random() * ids.length)]; // 随机一个敌人，增加重玩性
    game = new CG.Game(id);
    game.onChange(g => CG.UI.render(g));   // 状态变化 -> 整体刷新
    game.onEvent(CG.UI.onEvent);           // 战斗事件 -> 精灵动画
    CG.UI.render(game);
  }

  function onEndTurn() {
    if (!game || game.phase !== 'player') return;
    game.endTurn();                       // 进入敌人阶段并刷新界面
    setTimeout(() => game.runEnemyTurn(), 750); // 停顿一下，让玩家看清敌人出招
  }

  function onPlayCard(uid) {
    if (game) game.playCard(uid);
  }

  window.addEventListener('DOMContentLoaded', () => {
    CG.UI.init({ onEndTurn, onPlayCard, onNewBattle: newBattle });
    newBattle();
  });
})(window.CG);

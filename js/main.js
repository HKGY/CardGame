window.CG = window.CG || {};

/* ===========================================================================
 *  入口 / 控制器 —— 创建 Run，按 run.phase 路由到对应界面；
 *  在地图与战斗之间编排：进入战斗节点时实例化 Game，结束后回收给 Run。
 * ===========================================================================
 */
(function (CG) {
  let run = null;
  let battle = null;

  // 按当前阶段切换界面
  function route() {
    CG.Screens.updateHeader(run, run.phase !== 'battle');
    switch (run.phase) {
      case 'battle':   return startBattle();
      case 'map':      return CG.Screens.showMap(run);
      case 'reward':   return CG.Screens.showReward(run);
      case 'shop':     return CG.Screens.showShop(run);
      case 'rest':     return CG.Screens.showRest(run);
      case 'dead':
      case 'victory':  return CG.Screens.showGameOver(run);
    }
  }

  function startBattle() {
    const { enemyId } = run.pending;
    battle = new CG.Game({ enemyId, deck: run.deck, hp: run.hp, maxHp: run.maxHp });
    battle.onChange(b => CG.UI.render(b));
    battle.onEvent(CG.UI.onEvent);

    let ended = false;                         // 战斗结束后停顿一下再回到跑图（让最后一击演出完）
    battle.onChange(b => {
      if (!ended && (b.phase === 'won' || b.phase === 'lost')) {
        ended = true;
        const win = b.phase === 'won', hp = b.player.hp;
        CG.Audio.play(win ? 'winSting' : 'defeat');
        setTimeout(() => run.finishBattle(win, hp), 1100);
      }
    });

    CG.Screens.showScreen('battle');
    CG.UI.render(battle);
  }

  function newRun() {
    run = new CG.Run();
    run.onChange(route);
    route();
  }

  // 战斗内操作转发到当前 battle（带敌人回合演出延迟）
  const battleHandlers = {
    onEndTurn() {
      if (battle && battle.phase === 'player') {
        battle.endTurn();
        setTimeout(() => battle.runEnemyTurn(), 750);
      }
    },
    onPlayCard(uid) { if (battle) battle.playCard(uid); },
  };

  // 静音开关（顶栏 + 战斗顶栏两个按钮共用一个状态）
  function setupMute() {
    const btns = [document.getElementById('mute-btn'), document.getElementById('mute-btn-2')].filter(Boolean);
    const sync = () => btns.forEach(b => (b.textContent = CG.Audio.isMuted() ? '🔇' : '🔊'));
    btns.forEach(b => b.addEventListener('click', () => { CG.Audio.toggle(); sync(); }));
    sync();
  }

  window.addEventListener('DOMContentLoaded', () => {
    setupMute();
    CG.UI.init(battleHandlers);
    CG.Screens.init({
      onSelectNode:   node => run.selectNode(node),
      onChooseReward: spec => run.chooseReward(spec),
      onRestHeal:     () => run.restHeal(),
      onRestUpgrade:  uid => run.restUpgrade(uid),
      onBuyCard:      i => run.buyCard(i),
      onBuyUpgrade:   uid => run.buyUpgrade(uid),
      onBuyHeal:      () => run.buyHeal(),
      onLeaveShop:    () => run.leaveShop(),
      onRestart:      () => newRun(),
      getRun:         () => run,
    });
    newRun();
  });
})(window.CG);

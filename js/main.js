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
      case 'event':    return CG.Screens.showEvent(run);
      case 'dead':
      case 'victory':  return CG.Screens.showGameOver(run);
    }
  }

  function startBattle() {
    const { enemyId } = run.pending;
    let hpMult = 1;
    if (run.flags.enemyHpDown && run.current.type !== 'boss') {     // 女祭司：下一个非Boss敌人减血
      hpMult = 1 - run.flags.enemyHpDown;
      run.flags.enemyHpDown = 0;
    }
    battle = new CG.Game({
      enemyId, deck: run.deck, hp: run.hp, maxHp: run.maxHp,
      tarot: run.tarot, relics: run.relics, run, actScale: CG.CONFIG.actScale[run.act], hpMult,
    });
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

  // 使用一张塔罗牌（战斗 / 地图通用）
  function useTarot(index) {
    if (!run) return;
    const id = run.tarot[index];
    if (id == null) return;
    const t = CG.TAROT[id];
    const inBattle = run.phase === 'battle' && battle && battle.phase === 'player';
    const onMap = run.phase === 'map';
    if (t.where === 'battle' && !inBattle) return;        // 情境不符则不可用
    if (t.where === 'map' && !onMap) return;
    if (t.where === 'any' && !inBattle && !onMap) return;

    const phaseBefore = run.phase;
    run.tarot.splice(index, 1);                            // 消耗

    const finish = () => {
      if (inBattle) { if (battle) CG.UI.render(battle); }
      else if (run.phase === phaseBefore) run._emit();     // 地图未跳转 → 刷新；已跳转则 run 自身已 route
    };
    const ui = {
      pickCard: (cards, cb) => CG.Screens.pickCardList('选择一张牌', cards, u => { cb(u); finish(); }),
      choose: (opts, cb) => CG.Screens.choose('三选一', opts, v => { cb(v); finish(); }),
    };
    t.apply(run, inBattle ? battle : null, ui);
    if (!t.async) finish();
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
    onUseTarot(i) { useTarot(i); },
  };

  // 静音开关（顶栏 + 战斗顶栏两个按钮共用一个状态）
  function setupMute() {
    const btns = [document.getElementById('mute-btn'), document.getElementById('mute-btn-2')].filter(Boolean);
    const sync = () => btns.forEach(b => (b.textContent = CG.Audio.isMuted() ? '🔇' : '🔊'));
    btns.forEach(b => b.addEventListener('click', () => { CG.Audio.toggle(); sync(); }));
    sync();
  }

  window.addEventListener('DOMContentLoaded', () => {
    CG.Background.init();
    setupMute();
    CG.UI.init(battleHandlers);
    CG.Screens.init({
      onStart:        () => newRun(),
      onSelectNode:   node => run.selectNode(node),
      onChooseReward: spec => run.chooseReward(spec),
      onTakeTarot:    () => run.takeTarot(),
      onUseTarot:     i => useTarot(i),
      onUseAltar:     (uid, opt) => run.useAltar(uid, opt),
      onLeaveEvent:   () => run.leaveEvent(),
      onRestHeal:     () => run.restHeal(),
      onRestUpgrade:  (uid, opt) => run.restUpgrade(uid, opt),
      onBuyCard:      i => run.buyCard(i),
      onBuyTarot:     i => run.buyTarot(i),
      onBuyRelic:     i => run.buyRelic(i),
      onBuyUpgrade:   (uid, opt) => run.buyUpgrade(uid, opt),
      onBuyRemove:    uid => run.buyRemove(uid),
      onBuyHeal:      () => run.buyHeal(),
      onLeaveShop:    () => run.leaveShop(),
      onRestart:      () => newRun(),
      getRun:         () => run,
    });
    CG.Screens.showMenu();          // 先进开始菜单，点「开始攀登」再创建跑图
  });
})(window.CG);

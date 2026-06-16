window.CG = window.CG || {};

/* ===========================================================================
 *  界面渲染 —— 把游戏状态画到 DOM 上，并把玩家的点击转发给控制器。
 *  纯展示，不含游戏规则；规则都在 engine 里。
 * ===========================================================================
 */
(function (CG) {
  let handlers = {};
  const $ = id => document.getElementById(id);

  const TYPE_LABEL = { attack: '攻击', skill: '技能', power: '能力' };
  const STATUS_META = {
    strength:   { label: '力量', cls: 'badge-buff' },
    dexterity:  { label: '敏捷', cls: 'badge-buff' },
    vulnerable: { label: '易伤', cls: 'badge-vuln' },
    weak:       { label: '虚弱', cls: 'badge-weak' },
  };

  function init(h) {
    handlers = h;
    $('end-turn').addEventListener('click', () => handlers.onEndTurn());
    $('new-battle').addEventListener('click', () => handlers.onNewBattle());
    $('overlay-btn').addEventListener('click', () => handlers.onNewBattle());
    // 事件委托：手牌容器只绑定一次
    $('hand').addEventListener('click', (ev) => {
      const card = ev.target.closest('.card');
      if (card && !card.classList.contains('disabled')) {
        handlers.onPlayCard(Number(card.dataset.uid));
      }
    });
  }

  function hpBar(cur, max) {
    const pct = Math.max(0, (cur / max) * 100);
    return `<div class="hpbar"><div class="hpfill" style="width:${pct}%"></div>` +
           `<span class="hptext">${cur} / ${max}</span></div>`;
  }

  function blockBadge(block) {
    return block > 0 ? `<span class="badge badge-block">🛡️ ${block}</span>` : '';
  }

  function statusBadges(statuses) {
    return Object.keys(statuses).map(k => {
      const meta = STATUS_META[k] || { label: k, cls: '' };
      return `<span class="badge ${meta.cls}">${meta.label} ${statuses[k]}</span>`;
    }).join('');
  }

  function intentHTML(game) {
    const p = game.intentPreview();
    if (!p) return '';
    const parts = [];
    if (p.damage != null) {
      parts.push(`<span class="intent-attack">⚔️ ${p.damage}${p.hits > 1 ? '×' + p.hits : ''}</span>`);
    }
    if (p.block != null) parts.push(`<span class="intent-block">🛡️ ${p.block}</span>`);
    if (parts.length === 0) parts.push(`<span class="intent-buff">✨</span>`);
    return `<div class="intent" title="${p.name}">意图：${parts.join(' ')}</div>`;
  }

  function cardHTML(game, inst) {
    const def = CG.CARDS[inst.defId];
    const affordable = game.phase === 'player' && def.cost <= game.player.energy;
    return `<div class="card type-${def.type} ${affordable ? '' : 'disabled'}" data-uid="${inst.uid}">
        <div class="card-cost">${def.cost}</div>
        <div class="card-name">${def.name}</div>
        <div class="card-type">${TYPE_LABEL[def.type] || def.type}</div>
        <div class="card-text">${def.text}</div>
      </div>`;
  }

  function render(game) {
    const p = game.player, e = game.enemy;

    $('enemy-area').innerHTML = `
      <div class="unit enemy">
        <div class="unit-top">
          <span class="unit-name">${e.name}</span>
          ${intentHTML(game)}
        </div>
        ${hpBar(e.hp, e.maxHp)}
        <div class="badges">${blockBadge(e.block)}${statusBadges(e.statuses)}</div>
      </div>`;

    $('player-status').innerHTML = `
      <div class="unit player">
        <div class="unit-top"><span class="unit-name">你</span>
          <span class="turn-tag">第 ${game.turn} 回合</span></div>
        ${hpBar(p.hp, p.maxHp)}
        <div class="badges">${blockBadge(p.block)}${statusBadges(p.statuses)}</div>
      </div>`;

    $('energy').innerHTML = `<span class="energy-orb">⚡</span> ${p.energy} / ${p.maxEnergy}`;
    $('draw-pile').innerHTML = `🂠 抽牌堆<br><b>${game.drawPile.length}</b>`;
    $('discard-pile').innerHTML = `🗑️ 弃牌堆<br><b>${game.discardPile.length}</b>`;
    $('hand').innerHTML = game.hand.map(c => cardHTML(game, c)).join('');

    $('end-turn').disabled = game.phase !== 'player';
    $('log').innerHTML = game.log.slice(-8).map(l => `<div>${l}</div>`).join('');

    const overlay = $('overlay');
    if (game.phase === 'won' || game.phase === 'lost') {
      $('overlay-title').textContent = game.phase === 'won' ? '🎉 胜利！' : '💀 战败';
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }

  CG.UI = { init, render };
})(window.CG);

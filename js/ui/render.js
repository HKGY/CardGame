window.CG = window.CG || {};

/* ===========================================================================
 *  界面渲染 + 输入 —— 把游戏状态画到 DOM，并把点击转发给控制器。
 *  - render()：每次状态变化整体刷新「会变的部分」（信息面板/手牌/牌堆…）。
 *  - onEvent()：响应引擎抛出的战斗事件，驱动精灵的攻击/受击/格挡动画。
 *    精灵所在的舞台不会被 render 重绘，所以动画不会被刷掉。
 * ===========================================================================
 */
(function (CG) {
  let handlers = {};
  let current = null;        // 当前对局（牌堆查看用）
  let busy = false;          // 出牌动画期间锁输入
  let enemySpriteId = null;  // 已绘制的敌人贴图 id（避免每帧重画精灵）
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
    $('player-sprite').innerHTML = CG.Sprites.get('knight');

    $('end-turn').addEventListener('click', () => { if (!busy) handlers.onEndTurn(); });
    $('new-battle').addEventListener('click', () => handlers.onNewBattle());
    $('overlay-btn').addEventListener('click', () => handlers.onNewBattle());

    // 牌堆查看
    $('view-deck').addEventListener('click', () => openPile('deck'));
    $('draw-pile').addEventListener('click', () => openPile('draw'));
    $('discard-pile').addEventListener('click', () => openPile('discard'));
    $('pile-close').addEventListener('click', closePile);
    $('pile-modal').addEventListener('click', e => { if (e.target.id === 'pile-modal') closePile(); });

    // 出牌：先播放卡牌上浮动画，再真正结算
    $('hand').addEventListener('click', ev => {
      const card = ev.target.closest('.card');
      if (!card || card.classList.contains('disabled') || busy) return;
      busy = true;
      const uid = Number(card.dataset.uid);
      card.classList.add('card-playing');
      setTimeout(() => { handlers.onPlayCard(uid); busy = false; }, 220);
    });
  }

  // ---------- 事件驱动的精灵动画 ----------
  function animate(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;            // 强制回流，使动画可重新触发
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  function floatNum(stage, text, kind) {
    if (!stage) return;
    const n = stage.querySelectorAll('.float-num').length; // 多段伤害时错开避免重叠
    const span = document.createElement('span');
    span.className = 'float-num ' + kind;
    span.textContent = text;
    span.style.marginLeft = (n * 26 - 13) + 'px';
    stage.appendChild(span);
    setTimeout(() => span.remove(), 900);
  }

  function onEvent(type, payload) {
    const sprite = $(payload.side + '-sprite');
    const stage = $(payload.side + '-stage');
    if (type === 'attack') {
      animate(sprite, 'attacking', 320);                 // 攻击：向对方突进
    } else if (type === 'damage') {
      if (payload.hpLoss > 0) {
        animate(sprite, 'hurt', 380);                    // 受击：抖动 + 红闪
        floatNum(stage, '-' + payload.hpLoss, 'dmg');
      } else if (payload.blocked > 0) {
        animate(sprite, 'guard', 400);                   // 被格挡：蓝闪
        floatNum(stage, '🛡️', 'guard');
      }
    } else if (type === 'gainblock') {
      animate(sprite, 'guard', 400);
      floatNum(stage, '+' + payload.amount + '🛡️', 'guard');
    }
  }

  // ---------- 牌堆查看 ----------
  function openPile(kind) {
    if (!current) return;
    const byName = (a, b) =>
      CG.CARDS[a.defId].name.localeCompare(CG.CARDS[b.defId].name, 'zh');
    let cards, title;
    if (kind === 'draw') {
      cards = [...current.drawPile].sort(byName);          // 排序以隐藏真实抽牌顺序
      title = '抽牌堆 · 顺序已隐藏';
    } else if (kind === 'discard') {
      cards = [...current.discardPile].reverse();          // 最近弃的在前
      title = '弃牌堆';
    } else {
      cards = [...current.drawPile, ...current.hand, ...current.discardPile, ...current.exhaustPile].sort(byName);
      title = '牌库 · 本场全部卡牌';
    }
    $('pile-title').textContent = `${title}（${cards.length} 张）`;
    $('pile-cards').innerHTML = cards.length
      ? cards.map(c => staticCardHTML(CG.CARDS[c.defId])).join('')
      : '<p class="empty-note">（空）</p>';
    $('pile-modal').classList.remove('hidden');
  }
  function closePile() { $('pile-modal').classList.add('hidden'); }

  // ---------- 卡牌 HTML ----------
  // 关键词上色：伤害 -> 红，格挡 -> 蓝
  function colorKeywords(t) {
    return t.replace(/伤害/g, '<span class="kw-dmg">伤害</span>')
            .replace(/格挡/g, '<span class="kw-block">格挡</span>');
  }
  function cardInner(def) {
    return `<div class="card-cost">${def.cost}</div>
      <div class="card-name">${def.name}</div>
      <div class="card-type">${TYPE_LABEL[def.type] || def.type}</div>
      <div class="card-text">${colorKeywords(def.text)}</div>`;
  }
  function handCardHTML(game, inst) {
    const def = CG.CARDS[inst.defId];
    const ok = game.phase === 'player' && def.cost <= game.player.energy;
    return `<div class="card type-${def.type} ${ok ? '' : 'disabled'}" data-uid="${inst.uid}">${cardInner(def)}</div>`;
  }
  function staticCardHTML(def) {
    return `<div class="card type-${def.type} static">${cardInner(def)}</div>`;
  }

  // ---------- 小组件 ----------
  function hpBar(cur, max) {
    const pct = Math.max(0, (cur / max) * 100);
    return `<div class="hpbar"><div class="hpfill" style="width:${pct}%"></div>` +
           `<span class="hptext">${cur} / ${max}</span></div>`;
  }
  function blockBadge(b) { return b > 0 ? `<span class="badge badge-block">🛡️ ${b}</span>` : ''; }
  function statusBadges(s) {
    return Object.keys(s).map(k => {
      const m = STATUS_META[k] || { label: k, cls: '' };
      return `<span class="badge ${m.cls}">${m.label} ${s[k]}</span>`;
    }).join('');
  }
  function intentHTML(game) {
    const p = game.intentPreview();
    if (!p) return '';
    const parts = [];
    if (p.damage != null) parts.push(`<span class="intent-attack">⚔️ ${p.damage}${p.hits > 1 ? '×' + p.hits : ''}</span>`);
    if (p.block != null) parts.push(`<span class="intent-block">🛡️ ${p.block}</span>`);
    if (!parts.length) parts.push('<span class="intent-buff">✨</span>');
    return `<div class="intent" title="${p.name}">意图 ${parts.join(' ')}</div>`;
  }

  // ---------- 主渲染 ----------
  function render(game) {
    current = game;
    const p = game.player, e = game.enemy;

    if (enemySpriteId !== e.def.id) {                 // 敌人换了才重画精灵
      $('enemy-sprite').innerHTML = CG.Sprites.get(e.def.sprite || 'blob');
      enemySpriteId = e.def.id;
    }

    $('enemy-info').innerHTML = `
      <div class="unit enemy">
        <div class="unit-top"><span class="unit-name">${e.name}</span>${intentHTML(game)}</div>
        ${hpBar(e.hp, e.maxHp)}
        <div class="badges">${blockBadge(e.block)}${statusBadges(e.statuses)}</div>
      </div>`;

    $('player-info').innerHTML = `
      <div class="unit player">
        <div class="unit-top"><span class="unit-name">你</span>
          <span class="turn-tag">第 ${game.turn} 回合</span></div>
        ${hpBar(p.hp, p.maxHp)}
        <div class="badges">${blockBadge(p.block)}${statusBadges(p.statuses)}</div>
      </div>`;

    $('energy').innerHTML = `<span class="energy-orb">⚡</span> ${p.energy} / ${p.maxEnergy}`;
    $('draw-pile').innerHTML = `🂠 抽牌堆 <b>${game.drawPile.length}</b><small>点击查看</small>`;
    $('discard-pile').innerHTML = `🗑️ 弃牌堆 <b>${game.discardPile.length}</b><small>点击查看</small>`;
    $('hand').innerHTML = game.hand.map(c => handCardHTML(game, c)).join('');

    $('end-turn').disabled = game.phase !== 'player';
    $('log').innerHTML = game.log.slice(-8).map(l => `<div>${l}</div>`).join('');

    const ov = $('overlay');
    if (game.phase === 'won' || game.phase === 'lost') {
      $('overlay-title').textContent = game.phase === 'won' ? '🎉 胜利！' : '💀 战败';
      ov.classList.remove('hidden');
    } else ov.classList.add('hidden');
  }

  CG.UI = { init, render, onEvent };
})(window.CG);

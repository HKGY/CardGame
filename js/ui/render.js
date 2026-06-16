window.CG = window.CG || {};

/* ===========================================================================
 *  战斗界面 + 输入 —— 把单场战斗状态画到 DOM，并把点击转发给控制器。
 *  - render(battle)：刷新会变的部分（信息面板 / 手牌 / 牌堆 / 日志）。
 *  - onEvent()：响应引擎事件，驱动精灵攻击/受击/格挡动画与飘字。
 *  战斗结束（won/lost）由上层 Run 流程接管，这里不再弹胜负框。
 *  另外导出 CG.UI.cardFace(inst) 供其它界面（奖励/商店/牌库）复用卡面。
 * ===========================================================================
 */
(function (CG) {
  let handlers = {};
  let current = null;
  let busy = false;
  let enemySpriteId = null;
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
    $('view-deck').addEventListener('click', () => openPile('deck'));
    $('draw-pile').addEventListener('click', () => openPile('draw'));
    $('discard-pile').addEventListener('click', () => openPile('discard'));
    $('pile-close').addEventListener('click', closePile);
    $('pile-modal').addEventListener('click', e => { if (e.target.id === 'pile-modal') closePile(); });

    $('hand').addEventListener('click', ev => {
      const card = ev.target.closest('.card');
      if (!card || card.classList.contains('disabled') || busy) return;
      busy = true;
      const uid = Number(card.dataset.uid);
      card.classList.add('card-playing');
      setTimeout(() => { handlers.onPlayCard(uid); busy = false; }, 220);
    });
  }

  // ---------- 精灵动画 ----------
  function animate(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }
  function floatNum(stage, text, kind) {
    if (!stage) return;
    const n = stage.querySelectorAll('.float-num').length;
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
      animate(sprite, 'attacking', 320);
    } else if (type === 'damage') {
      if (payload.hpLoss > 0) { animate(sprite, 'hurt', 380); floatNum(stage, '-' + payload.hpLoss, 'dmg'); }
      else if (payload.blocked > 0) { animate(sprite, 'guard', 400); floatNum(stage, '🛡️', 'guard'); }
    } else if (type === 'gainblock') {
      animate(sprite, 'guard', 400); floatNum(stage, '+' + payload.amount + '🛡️', 'guard');
    }
  }

  // ---------- 牌堆查看（战斗内：基于战斗的各牌堆） ----------
  function openPile(kind) {
    if (!current) return;
    const byName = (a, b) => CG.cardStats(a).name.localeCompare(CG.cardStats(b).name, 'zh');
    let cards, title;
    if (kind === 'draw') { cards = [...current.drawPile].sort(byName); title = '抽牌堆 · 顺序已隐藏'; }
    else if (kind === 'discard') { cards = [...current.discardPile].reverse(); title = '弃牌堆'; }
    else { cards = [...current.drawPile, ...current.hand, ...current.discardPile, ...current.exhaustPile].sort(byName); title = '本场牌库'; }
    $('pile-title').textContent = `${title}（${cards.length} 张）`;
    $('pile-cards').innerHTML = cards.length
      ? cards.map(c => cardFace(c)).join('')
      : '<p class="empty-note">（空）</p>';
    $('pile-modal').classList.remove('hidden');
  }
  function closePile() { $('pile-modal').classList.add('hidden'); }

  // ---------- 卡面 ----------
  function colorKeywords(t) {
    return t.replace(/伤害/g, '<span class="kw-dmg">伤害</span>')
            .replace(/格挡/g, '<span class="kw-block">格挡</span>');
  }
  function cardInner(s) {
    return `<div class="card-cost">${s.cost}</div>
      <div class="card-name">${s.name}</div>
      <div class="card-type">${TYPE_LABEL[s.type] || s.type}</div>
      <div class="card-text">${colorKeywords(s.text)}</div>`;
  }
  // 通用静态卡面，opts: { clickable, dim, data:{k:v} }
  function cardFace(inst, opts = {}) {
    const s = CG.cardStats(inst);
    const cls = ['card', 'type-' + s.type, opts.clickable ? 'clickable' : 'static', opts.dim ? 'disabled' : ''].join(' ');
    const data = opts.data ? Object.entries(opts.data).map(([k, v]) => `data-${k}="${v}"`).join(' ') : '';
    return `<div class="${cls}" ${data}>${cardInner(s)}</div>`;
  }
  function handCardHTML(game, inst) {
    const s = CG.cardStats(inst);
    const ok = game.phase === 'player' && s.cost <= game.player.energy;
    return `<div class="card type-${s.type} ${ok ? '' : 'disabled'}" data-uid="${inst.uid}">${cardInner(s)}</div>`;
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

    if (enemySpriteId !== e.def.id) {
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
  }

  CG.UI = Object.assign(CG.UI || {}, { init, render, onEvent, cardFace });
})(window.CG);

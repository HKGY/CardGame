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
    frail:      { label: '脆弱', cls: 'badge-vuln' },
    poison:     { label: '中毒', cls: 'badge-poison' },
    frozen:     { label: '冰冻', cls: 'badge-frozen' },
    leech:      { label: '寄生', cls: 'badge-poison' },
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
      CG.Audio.play('card');
      const uid = Number(card.dataset.uid);
      card.classList.add('card-playing');
      setTimeout(() => { handlers.onPlayCard(uid); busy = false; }, 220);
    });

    $('tarot-bar').addEventListener('click', ev => {
      const b = ev.target.closest('.tarot-btn');
      if (!b || b.disabled) return;
      CG.Audio.play('select');
      handlers.onUseTarot(Number(b.dataset.ti));
    });
  }

  // 塔罗消耗栏（战斗 / 地图通用）。context:'battle'|'map'；active:当前是否可操作
  function tarotBarHTML(list, context, active, slots) {
    slots = slots || (CG.CONFIG && CG.CONFIG.tarot.slots) || 3;
    list = list || [];
    const held = list.map((id, i) => {
      const t = CG.TAROT[id];
      const usable = active && (context === 'battle' ? t.where !== 'map' : t.where !== 'battle');
      return `<button class="tarot-btn" data-ti="${i}" title="${t.name}：${t.desc}"${usable ? '' : ' disabled'}>${t.icon} ${t.name}</button>`;
    }).join('');
    const empty = Math.max(0, slots - list.length);
    return `<span class="tarot-label">塔罗</span>${held}${'<span class="tarot-slot empty"></span>'.repeat(empty)}`;
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
  // 伤害事件入队逐个弹出（多段攻击不会一次冒出多个数字）；其它事件立即播放
  let fxQueue = [], fxTimer = null;
  function onEvent(type, payload) {
    if (type === 'damage') { fxQueue.push(payload); if (!fxTimer) drainFx(); }
    else playFx(type, payload);
  }
  function drainFx() {
    const payload = fxQueue.shift();
    if (!payload) { fxTimer = null; return; }
    playFx('damage', payload);
    fxTimer = setTimeout(drainFx, 230);
  }
  function playFx(type, payload) {
    const sprite = $(payload.side + '-sprite');
    const stage = $(payload.side + '-stage');
    if (type === 'attack') {
      animate(sprite, 'attacking', 320);
      CG.Audio.play('swing');
    } else if (type === 'damage') {
      if (payload.hpLoss > 0) { animate(sprite, 'hurt', 380); floatNum(stage, '-' + payload.hpLoss, 'dmg'); CG.Audio.play('hit', payload.side); }
      else if (payload.blocked > 0) { animate(sprite, 'guard', 400); floatNum(stage, '🛡️', 'guard'); CG.Audio.play('block'); }
    } else if (type === 'gainblock') {
      animate(sprite, 'guard', 400); floatNum(stage, '+' + payload.amount + '🛡️', 'guard'); CG.Audio.play('block');
    } else if (type === 'heal') {
      animate(sprite, 'healed', 520); floatNum(stage, '+' + payload.amount, 'heal'); CG.Audio.play('heal');
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
      ? cards.map(c => cardFace(c, { valueMult: current.cardValueMult })).join('')
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
    const span = a => `<span class="aff" style="color:${a.color}">${a.name}</span>`;
    const buffNames = s.buffs.map(span).join('');
    const dbf = s.debuffs.length ? `<span class="dbf-paren">(</span>${s.debuffs.map(span).join('')}<span class="dbf-paren">)</span>` : '';
    const name = buffNames + `<span class="base-name">${s.baseName}</span>` + dbf + `<span class="card-limit" title="锻造上限">+${s.limit}</span>`;
    const lines = s.buffs.concat(s.debuffs).map(a => `<div class="affix-line" style="color:${a.color}">${a.desc}</div>`).join('');
    return `<div class="card-cost">${s.cost}</div>
      <div class="card-name">${name}</div>
      <div class="card-type">${TYPE_LABEL[s.type] || s.type}</div>
      <div class="card-text">${colorKeywords(s.baseText)}${lines}</div>`;
  }
  function relicIcons(relics) {
    return (relics || []).map(id => { const r = CG.RELICS[id]; return `<span class="relic-icon" title="${r.name}：${r.desc}">${r.icon}</span>`; }).join('');
  }
  // 通用静态卡面，opts: { clickable, dim, data:{k:v}, valueMult }
  function cardFace(inst, opts = {}) {
    const s = CG.cardStats(inst, { valueMult: opts.valueMult });
    const cls = ['card', 'type-' + s.type, opts.clickable ? 'clickable' : 'static', opts.dim ? 'disabled' : ''].join(' ');
    const data = opts.data ? Object.entries(opts.data).map(([k, v]) => `data-${k}="${v}"`).join(' ') : '';
    return `<div class="${cls}" ${data}>${cardInner(s)}</div>`;
  }
  function handCardHTML(game, inst) {
    const s = CG.cardStats(inst, { valueMult: game.cardValueMult });
    const ok = game.phase === 'player' && s.cost <= game.player.energy;
    return `<div class="card type-${s.type} ${ok ? '' : 'disabled'}" data-uid="${inst.uid}">${cardInner(s)}</div>`;
  }

  // ---------- 小组件 ----------
  // 血条用稳定的 hpfill 元素 + rAF 改宽度，触发 CSS 过渡（血量增减都平滑滑动）
  let lastHp = {};
  function renderUnit(side, u, name, topRight, extraBadge) {
    const newPct = Math.max(0, (u.hp / u.maxHp) * 100);
    const oldPct = lastHp[side] == null ? newPct : lastHp[side];
    $(side + '-info').innerHTML =
      `<div class="unit ${side}">
        <div class="unit-top"><span class="unit-name">${name}</span>${topRight}</div>
        <div class="hpbar"><div class="hpfill" id="${side}-hpfill" style="width:${oldPct}%"></div><span class="hptext">${u.hp} / ${u.maxHp}</span></div>
        <div class="badges">${extraBadge || ''}${blockBadge(u.block)}${statusBadges(u.statuses)}</div>
      </div>`;
    const fill = $(side + '-hpfill');           // 强制回流提交旧宽度，再改新宽度 -> 必定触发过渡
    if (fill && fill.style) { void fill.offsetWidth; fill.style.width = newPct + '%'; }
    lastHp[side] = newPct;
  }
  function blockBadge(b) { return b > 0 ? `<span class="badge badge-block">🛡️ ${b}</span>` : ''; }
  function statusBadges(s) {
    return Object.keys(s).map(k => {
      const m = STATUS_META[k] || { label: k, cls: '' };
      return `<span class="badge ${m.cls}">${m.label} ${s[k]}</span>`;
    }).join('');
  }
  function intentHTML(game) {
    if (game.enemy.statuses.frozen) return `<div class="intent intent-buff">❄️ 冰冻 ${game.enemy.statuses.frozen}</div>`;
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
      lastHp = {};                       // 换敌人时重置血条动画基准，避免跨场跳动
    }

    const incoming = game.playerIncomingDamage();   // 本回合预计净伤害（随格挡实时变化）
    const incBadge = incoming > 0 ? `<span class="badge badge-incoming" title="本回合预计受到的净伤害（已计入格挡/减伤）">🩸 -${incoming}</span>` : '';
    renderUnit('enemy', e, e.name, intentHTML(game));
    renderUnit('player', p, '你', `<span class="turn-tag">第 ${game.turn} 回合</span>`, incBadge);

    $('tarot-bar').innerHTML = tarotBarHTML(game.tarot, 'battle', game.phase === 'player', game.run && game.run.tarotSlots());
    $('battle-relics').innerHTML = relicIcons(game.relics);
    $('energy').innerHTML = `<span class="energy-orb">⚡</span> ${p.energy} / ${p.maxEnergy}`;
    $('draw-pile').innerHTML = `🂠 抽牌堆 <b>${game.drawPile.length}</b><small>点击查看</small>`;
    $('discard-pile').innerHTML = `🗑️ 弃牌堆 <b>${game.discardPile.length}</b><small>点击查看</small>`;
    $('hand').innerHTML = game.hand.map(c => handCardHTML(game, c)).join('');

    $('end-turn').disabled = game.phase !== 'player';
    $('log').innerHTML = game.log.slice(-8).map(l => `<div>${l}</div>`).join('');
  }

  CG.UI = Object.assign(CG.UI || {}, { init, render, onEvent, cardFace, tarotBarHTML, relicIcons });
})(window.CG);

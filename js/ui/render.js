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
    regen:      { label: '再生', cls: 'badge-buff' },
    thorns:     { label: '荆棘', cls: 'badge-buff' },
    nourish:    { label: '滋养', cls: 'badge-buff' },
    burn:       { label: '灼伤', cls: 'badge-poison' },
    curse:      { label: '灾厄', cls: 'badge-poison' },
    fire:       { label: '🔥火', cls: 'badge-fire' },
    water:      { label: '💧水', cls: 'badge-water' },
    thunder:    { label: '⚡雷', cls: 'badge-thunder' },
    ice:        { label: '❄️冰', cls: 'badge-ice' },
    // === 生产包 ===（每回合开始被动产出；常驻不衰减）
    prodDraw:   { label: '耕作', cls: 'badge-buff' },
    prodBlock:  { label: '蓄能', cls: 'badge-buff' },
    prodGrow:   { label: '复利', cls: 'badge-buff' },
    prodSkip:   { label: '歉收', cls: 'badge-weak' },
    prodUpkeep: { label: '养护', cls: 'badge-weak' },
  };

  // ---------- 卡牌贴图（占据卡牌上半张） ----------
  const CARD_ART = {
    // v2 唯一基底＝空法术：法杖（顶端宝石孔，效果由镶嵌宝石决定）
    spell: `<svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" class="art">
      <g transform="rotate(36 50 30)">
        <rect x="46.5" y="14" width="7" height="42" rx="3.5" fill="#8a6a3a" stroke="#5e4424" stroke-width="1.4"/>
        <rect x="47.4" y="14" width="2" height="42" fill="#caa05a" opacity=".6"/>
        <circle cx="50" cy="12" r="10" fill="none" stroke="#caa24a" stroke-width="2.4"/>
        <circle cx="50" cy="12" r="6.6" fill="#b59ad8" stroke="#e8d8ff" stroke-width="1.6"/>
        <circle cx="47.6" cy="9.6" r="2.2" fill="#fff" opacity=".8"/>
      </g>
      <g stroke="#e8d8ff" stroke-width="2" opacity=".5" stroke-linecap="round">
        <line x1="74" y1="14" x2="80" y2="14"/><line x1="77" y1="11" x2="77" y2="17"/>
        <line x1="20" y1="44" x2="25" y2="44"/><line x1="22.5" y1="41.5" x2="22.5" y2="46.5"/></g>
    </svg>`,
    // 打击：斜挥的剑 + 红色斩击弧
    strike: `<svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" class="art">
      <path d="M8 50 Q50 2 96 20" stroke="#ff5a4e" stroke-width="6.5" fill="none" stroke-linecap="round" opacity=".92"/>
      <path d="M16 54 Q52 22 90 38" stroke="#ffe1b0" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".7"/>
      <g transform="translate(52 31) rotate(40)">
        <polygon points="-3,-27 3,-27 0,-33" fill="#eef3fb"/>
        <rect x="-3" y="-27" width="6" height="35" rx="2.5" fill="#cdd8ea"/>
        <rect x="-1.6" y="-27" width="1.6" height="35" fill="#ffffff" opacity=".55"/>
        <rect x="-11" y="6" width="22" height="5" rx="2.5" fill="#caa24a"/>
        <rect x="-2.6" y="11" width="5.2" height="13" rx="2" fill="#6e5326"/>
        <circle cx="0" cy="26" r="3.3" fill="#f0c040"/>
      </g>
    </svg>`,
    // 防御：带十字纹章的盾 + 高光
    defend: `<svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" class="art">
      <path d="M50 5 L83 15 V34 Q83 51 50 59 Q17 51 17 34 V15 Z" fill="#3a6ea5" stroke="#a8caee" stroke-width="2.6"/>
      <path d="M50 5 L83 15 V34 Q83 51 50 59 Z" fill="#2c557e"/>
      <path d="M50 11 L75 19 V33 Q75 46 50 53 Q25 46 25 33 V19 Z" fill="none" stroke="#bcd6f2" stroke-width="1.3" opacity=".55"/>
      <path d="M50 18 V45 M39 30 H61" stroke="#f0c040" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M30 15 L41 12" stroke="#ffffff" stroke-width="2.2" opacity=".5" stroke-linecap="round"/>
    </svg>`,
    heal: `<svg viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet" class="art">
      <circle cx="50" cy="64" r="44" fill="#2fa05a" opacity=".30"/><circle cx="50" cy="64" r="30" fill="#3fbf6e" opacity=".22"/>
      <rect x="40" y="30" width="20" height="68" rx="6" fill="#8af0b0" stroke="#2f8f50" stroke-width="3"/>
      <rect x="20" y="54" width="60" height="20" rx="6" fill="#8af0b0" stroke="#2f8f50" stroke-width="3"/>
      <circle cx="26" cy="106" r="3" fill="#bff5d2"/><circle cx="76" cy="100" r="2.5" fill="#bff5d2"/>
    </svg>`,
    pray: `<svg viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet" class="art">
      <g stroke="#f0d36a" stroke-width="3" opacity=".5" stroke-linecap="round">
        <line x1="50" y1="22" x2="50" y2="4"/><line x1="50" y1="22" x2="28" y2="9"/><line x1="50" y1="22" x2="72" y2="9"/><line x1="50" y1="22" x2="18" y2="26"/><line x1="50" y1="22" x2="82" y2="26"/></g>
      <polygon points="50,16 57,41 83,41 62,56 70,82 50,66 30,82 38,56 17,41 43,41" fill="#f3da72" stroke="#b8901e" stroke-width="2"/>
      <path d="M37 90 q13 -11 26 0 l-5 34 q-8 6 -16 0z" fill="#cfd6ea" stroke="#8a93b0" stroke-width="2"/>
    </svg>`,
  };
  const CARD_ART_FALLBACK = `<svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" class="art">
    <path d="M50 12 l7 18 19 1 -15 12 6 19 -17 -11 -17 11 6 -19 -15 -12 19 -1z" fill="#7a83a8" opacity=".85"/></svg>`;
  // 整卡贴图（AI 重绘的「外框 + 中央图案」一体图），按基底取
  function getArt(base) {
    if (CARD_ART[base]) return CARD_ART[base];
    const bd = CG.BASE_CARDS[base];                 // 厨艺药材：用 emoji 作卡图
    if (bd && bd.icon) return `<svg viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" class="art"><text x="50" y="49" font-size="44" text-anchor="middle">${bd.icon}</text></svg>`;
    return base === 'shieldbash' ? CARD_ART.defend : CARD_ART_FALLBACK;
  }
  CG.CardArt = { get: getArt };

  // ---------- 卡牌飞行动画（抽牌 / 弃牌 / 消耗 / 洗牌） ----------
  const REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let prevHand = [], prevLogLen = 0, prevPhase = null;
  function flashSprite(cls, ms) {            // 给主角精灵加一次性动画 class（入场）
    const ps = $('player-sprite'); if (!ps) return;
    ps.classList.remove(cls); void ps.offsetWidth; ps.classList.add(cls);
    setTimeout(() => ps && ps.classList.remove(cls), ms);
  }
  function showTurnBanner(text, enemy) {     // 回合切换横幅提示（我方 / 敌方回合）
    let el = $('turn-banner');
    if (!el) { el = document.createElement('div'); el.id = 'turn-banner'; document.body.appendChild(el); }
    el.textContent = text;
    el.className = 'turn-banner'; void el.offsetWidth;
    el.className = 'turn-banner show' + (enemy ? ' enemy' : '');
  }
  // 精英 / 首领战入场「标题卡」：tier 徽标 + 立绘 + 敌名，淡入定格后淡出（一次性）。
  // 仅 elite / boss 显示；返回是否显示了（显示时由 render 抑制本场首个「我方回合」横幅，避免重叠）。
  function showBattleTitle(game) {
    const tier = game.tier;
    if (tier !== 'elite' && tier !== 'boss') return false;
    const isBoss = tier === 'boss', tierCls = isBoss ? 'boss' : 'elite';
    let el = $('battle-title');
    if (!el) { el = document.createElement('div'); el.id = 'battle-title'; document.body.appendChild(el); }
    const enemies = game.enemies || [];
    const figs = enemies.map(e => `<span class="bt-fig">${CG.Sprites.get(e.def.sprite || 'blob')}</span>`).join('');
    const names = enemies.map(e => e.name).join(' · ');
    const label = isBoss ? '👑 首领 · BOSS' : '⚔ 精英 · ELITE';
    el.className = 'battle-title ' + tierCls;                 // 先复位，再 reflow + 加 show 以重启动画
    el.innerHTML = `<div class="bt-inner"><div class="bt-tier">${label}</div><div class="bt-portrait">${figs}</div><div class="bt-name">${names}</div></div>`;
    void el.offsetWidth;
    el.className = 'battle-title show ' + tierCls;
    return true;
  }
  // 首领入场·cut-in：拉警戒线「KEEP OUT」+ 立绘斜切板切入（取代标题卡）。返回 true（抑制首个回合横幅）。
  function showBossCutin(game) {
    const e = (game.enemies || [])[0];
    if (!e) return false;
    let el = $('boss-cutin');
    if (!el) { el = document.createElement('div'); el.id = 'boss-cutin'; document.body.appendChild(el); }
    const tape = '⚠ KEEP OUT '.repeat(16);
    const sprite = CG.Sprites.get(e.def.sprite || 'blob');
    el.className = 'boss-cutin';                              // 先复位
    el.innerHTML =
      `<div class="cutin-flash"></div>
       <div class="cutin-tape tape-1"><span class="tape-text">${tape}</span></div>
       <div class="cutin-tape tape-2"><span class="tape-text">${tape}</span></div>
       <div class="cutin-panel"><div class="cutin-fig">${sprite}</div></div>
       <div class="cutin-sub">⚠ 首领 · BOSS ⚠</div>
       <div class="cutin-name">${e.name}</div>`;
    void el.offsetWidth;
    el.className = 'boss-cutin show';
    return true;
  }
  // 入场演出分派：首领→cut-in；精英→标题卡；其余→无（返回是否展示了，用于抑制首个「我方回合」横幅）。
  function showBattleIntro(game) {
    if (game.tier === 'boss') return showBossCutin(game);
    if (game.tier === 'elite') return showBattleTitle(game);
    return false;
  }
  function rcen(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  function pileRect(id) { const el = $(id); return el ? el.getBoundingClientRect() : null; }

  function flyCardGhost(ghost, from, to, delay) {
    ghost.classList.add('fly-ghost'); ghost.classList.remove('disabled');
    ghost.style.left = from.left + 'px'; ghost.style.top = from.top + 'px';
    ghost.style.width = from.width + 'px'; ghost.style.height = from.height + 'px';
    document.body.appendChild(ghost);
    const a = rcen(from), b = rcen(to), dx = b.x - a.x, dy = b.y - a.y;
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(.34) rotate(20deg)`, opacity: .15 }
    ], { duration: 380, delay: delay || 0, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
    anim.onfinish = anim.oncancel = () => ghost.remove();
  }
  function dissolveGhost(ghost, from, delay) {       // 消耗（销毁）：原地上飘 + 发光溶解
    ghost.classList.add('fly-ghost'); ghost.classList.remove('disabled');
    ghost.style.left = from.left + 'px'; ghost.style.top = from.top + 'px';
    ghost.style.width = from.width + 'px'; ghost.style.height = from.height + 'px';
    document.body.appendChild(ghost);
    const anim = ghost.animate([
      { transform: 'translateY(0) scale(1) rotate(0deg)', opacity: 1, filter: 'brightness(1)' },
      { transform: 'translateY(-48px) scale(1.18) rotate(6deg)', opacity: 0, filter: 'brightness(2.4)' }
    ], { duration: 520, delay: delay || 0, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = anim.oncancel = () => ghost.remove();
  }
  function dealIn(el, from, delay) {                 // 抽牌 / 回手：从抽牌堆滑入
    const to = el.getBoundingClientRect(), a = rcen(from), b = rcen(to);
    el.animate([
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(.5) rotate(-14deg)`, opacity: 0 },
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 }
    ], { duration: 320, delay: delay || 0, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
  }
  function shuffleFx() {                              // 洗牌：几张牌背从弃牌堆弧线飞回抽牌堆
    const dr = pileRect('draw-pile'), di = pileRect('discard-pile');
    if (!dr || !di) return;
    const a = rcen(di), b = rcen(dr), dx = b.x - a.x, dy = b.y - a.y;
    for (let i = 0; i < 5; i++) {
      const g = document.createElement('div'); g.className = 'shuffle-ghost';
      g.style.left = (a.x - 23) + 'px'; g.style.top = (a.y - 32) + 'px';
      document.body.appendChild(g);
      const lift = -38 - i * 7;
      const anim = g.animate([
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 0 },
        { transform: `translate(${dx * .5}px, ${dy * .5 + lift}px) rotate(${i % 2 ? 22 : -22}deg) scale(1.05)`, opacity: 1, offset: .5 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(.85)`, opacity: 0 }
      ], { duration: 540, delay: i * 70, easing: 'ease-in-out', fill: 'forwards' });
      anim.onfinish = anim.oncancel = () => g.remove();
    }
  }
  function animateHand(game, handEl, prevUids, newUids, oldRects, oldNodes) {
    const discR = pileRect('discard-pile'), drawR = pileRect('draw-pile');
    prevUids.filter(u => newUids.indexOf(u) < 0).forEach((u, i) => {     // 移除：弃牌 / 消耗
      const from = oldRects[u], node = oldNodes[u]; if (!from || !node) return;
      const ghost = node.cloneNode(true);
      if ((game.exhaustPile || []).some(c => String(c.uid) === u)) dissolveGhost(ghost, from, i * 35);
      else if (discR) flyCardGhost(ghost, from, discR, i * 35);
    });
    if (drawR) newUids.filter(u => prevUids.indexOf(u) < 0).forEach((u, i) => {   // 新增：抽牌
      const el = handEl.querySelector('.card[data-uid="' + u + '"]'); if (el) dealIn(el, drawR, i * 70);
    });
  }

  function init(h) {
    handlers = h;
    $('player-sprite').innerHTML = CG.Sprites.get('knight');

    $('end-turn').addEventListener('click', () => { if (!busy) handlers.onEndTurn(); });
    const dbg = $('debug-win');   // 调试：直接赢得本场战斗
    if (dbg) dbg.addEventListener('click', () => { if (!busy && handlers.onDebugWin) handlers.onDebugWin(); });
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
      // 出牌后的「飞入弃牌堆 / 消耗」动画由 render 的手牌 diff 统一处理
      setTimeout(() => { handlers.onPlayCard(uid); busy = false; }, 60);
    });

    $('tarot-bar').addEventListener('click', ev => {
      const b = ev.target.closest('.tarot-btn');
      if (!b || b.disabled) return;
      CG.Audio.play('select');
      handlers.onUseTarot(Number(b.dataset.ti));
    });

    // 点击敌人 -> 设为当前攻击目标
    $('enemy-group').addEventListener('click', ev => {
      const est = ev.target.closest('.estage');
      if (!est || est.classList.contains('dead') || !current || !current.setTarget) return;
      CG.Audio.play('select');
      current.setTarget(Number(est.dataset.ei));
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
    let sprite, stage;
    if (payload.side === 'player') { sprite = $('player-sprite'); stage = $('player-stage'); }
    else if (payload.side === 'skeleton') { sprite = $('skeleton-sprite'); stage = $('skeleton-stage'); }   // 召唤物：与玩家同款受击/攻击/格挡/治疗动画
    else { sprite = $('enemy-sprite-' + payload.ei); stage = $('enemy-stage-' + payload.ei); }
    if (!sprite || !stage) return;
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
  // 时点样式：每回合＝下划线、下回合＝斜体、本回合＝常规。（卡名本就加粗，故每回合改用下划线区分）
  function timeStyle(txt, id) { const t = CG.affixTiming ? CG.affixTiming(id) : 'now'; return t === 'every' ? `<u>${txt}</u>` : t === 'next' ? `<i>${txt}</i>` : txt; }
  function cardInner(s, game, inst) {
    const span = a => `<span class="aff" style="color:${a.color}">${timeStyle(a.name, a.id)}</span>`;
    // 门型条件未满足 → 卡面对应条目变暗（仅战斗中、非免代价的门型）。免代价(首石/净化)＝门恒满足、不变暗。
    const gateDim = (a, gemFree) => {
      if (!game || !a || !game._gateMet) return false;
      const def = CG.AFFIXES[a.id], cb = def && def.condBonus;
      if (!cb || !cb.gate || gemFree) return false;
      return !game._gateMet(cb.qty, inst) ? ' gate-unmet' : '';
    };
    // 卡名：每颗宝石「代价 → 价值」；首石免代价（不加方括号）。时点用 下划线(每回合)/斜体(下回合) 表示。
    const gemChips = s.gemViews.map((g, i) => {
      const a = g.buffs.concat(g.debuffs)[0];
      if (!a) return '';
      const resFree = i === 0 || g.purified, dim = gateDim(a, !!g.purified);   // 首石/净化免「资源代价」；门型免除只看净化
      if (resFree) return `<span class="gem-chip first${dim}">${span(a)}</span>`;   // 首石/净化：免代价（不加方括号）
      return `<span class="gem-chip${dim}">(<span class="gem-cost">${a.cost}</span> → ${span(a)})</span>`;
    }).join('');
    const empties = '<span class="socket-empty" title="空孔位">◇</span>'.repeat(s.emptySockets);
    // 空法术法杖(base 'spell')卡名只显效果（去掉「法术」基名）；药材/临时牌仍用其固有名
    const name = `${s.base === 'spell' ? '' : `<span class="base-name">${s.baseName}</span>`}${gemChips}${empties}`;
    // 词条说明：按宝石分组（不同宝石用 ┃ 隔开），避免数量多时撑破卡面
    const descGroups = s.gemViews.map(g =>
      g.buffs.concat(g.debuffs).map(a => `<span class="affix-line${gateDim(a, !!g.purified)}" style="color:${a.color}">${a.desc}</span>`).join('<span class="affix-sep">·</span>')
    ).filter(Boolean).join('<span class="gem-sep"> ┃ </span>');
    const lines = descGroups ? `<div class="affix-lines">${descGroups}</div>` : '';
    // 标题在卡图「上方」，默认保留三行高度（短名也占三行、长名不撑破布局）。
    return `<div class="card-cost${s._free ? ' free' : ''}${s._power ? ' power' : ''}">${s._power ? '🔋' : ''}${s.cost}</div>
      <div class="card-name"><span class="cn-in">${name}</span></div>
      <div class="card-art">${CG.CardArt.get(s.base)}</div>
      <div class="card-body">
        <div class="card-text">${colorKeywords(s.baseText)}${lines}</div>
      </div>`;
  }
  // 宝石贴面（背包 / 商店 / 奖励 / 工作台 / 选择器复用）。
  // opts: { clickable, dim, selected, data:{k:v}, tagLabel }
  function gemFace(gem, opts = {}) {
    // v2：宝石＝代价→价值。标题用价值文字；说明分列「代价 / 价值」。
    const pure = !!gem.purified;
    const affs = (gem.affixes || []).map(a => { const d = CG.AFFIXES[a.id] || {}; return { id: a.id, val: CG.affixValueText(a.id, a.level), short: CG.affixShort(a.id, a.level), cost: CG.affixCostText(a.id, a.level), color: d.color || '#9aa0b5' }; });
    const ordered = affs;
    // 标题：代价 → 价值(简短)；时点用 加粗(每回合)/斜体(下回合) 表示。
    const title = ordered.map(a => `<span class="aff" style="color:${a.color}">${pure ? '' : `<span class="gem-cost">${a.cost}</span> → `}${timeStyle(a.short, a.id)}</span>`).join('<span class="aff-plus">+</span>') || '空宝石';
    const lines = ordered.map(a => `<span class="affix-line" style="color:${a.color}">${pure ? `<span class="cv-pure">[免代价]</span> ` : `<span class="cv-cost">${a.cost}</span> <span class="cv-arrow">→</span> `}<span class="cv-val">${a.val}</span></span>`).join('<span class="affix-sep">·</span>');
    const cls = ['gem', opts.clickable ? 'clickable' : 'static', opts.dim ? 'disabled' : '', opts.selected ? 'selected' : ''].join(' ');
    const data = opts.data ? Object.entries(opts.data).map(([k, v]) => `data-${k}="${v}"`).join(' ') : '';
    return `<div class="${cls}" ${data} style="--gem:${CG.gemPrimaryColor(gem)}">
      <div class="gem-orb" title="${CG.gemLevel(gem)} 级">${CG.gemLevelIcon(gem)}</div>
      <div class="gem-name">${title}</div>
      <div class="gem-text">${lines}</div>
      ${opts.tagLabel ? `<div class="gem-tag">${opts.tagLabel}</div>` : ''}
    </div>`;
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
  function handCardHTML(game, inst, idx) {
    let s = CG.cardStats(inst, { valueMult: game.cardValueMult });
    const oc = s.overclock || 0;                                // 改造：超频（电力付费、数值 ×N）
    const paralyzed = idx != null && idx < (game._paralyze || 0);   // 麻痹：最左 N 张锁住
    const blocked = !!(game.craft || game.pick) || paralyzed;
    let ok;
    if (oc) {
      const pc = s.cost * oc;
      ok = game.phase === 'player' && (game.player.power || 0) >= pc && !s.noPlay && !blocked;
      s = Object.assign({}, s, { cost: pc, _power: true });     // 卡面耗费显示为电力
    } else if (s.multi) {
      ok = game.phase === 'player' && !s.noPlay && !blocked;    // 多重：耗费＝全部能量、恒可打出，耗能显示 X
      s = Object.assign({}, s, { cost: 'X' });
    } else {
      const free = (game.freeCards || 0) > 0;
      const conjured = inst.conjuredTurn === game.turn;         // 术士·造牌：本回合 0 费
      const payCost = (free || conjured) ? 0 : s.cost;
      ok = game.phase === 'player' && payCost <= game.player.energy && !s.noPlay && !blocked;
      if (free || conjured) s = Object.assign({}, s, { cost: 0, _free: true });
    }
    return `<div class="card type-${s.type} ${ok ? '' : 'disabled'} ${paralyzed ? 'paralyzed' : ''}" data-uid="${inst.uid}">${cardInner(s, game, inst)}</div>`;
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
  // 待结算效果(每回合/下回合)的短标签 —— 让每个 pending buff 像「力量」一样明确显示
  const EFF_LABEL = {
    damage: v => `⚔️${v}`, block: v => `🛡️${v}`, draw: v => `抽${v}`, energy: v => `⚡${v}`, gainPower: v => `🔌${v}`,
    heal: v => `❤️${v}`, strength: v => `力量+${v}`, dexterity: v => `敏捷+${v}`, thorns: v => `荆棘${v}`,
    tempStrength: v => `力量+${v}`, tempDexterity: v => `敏捷+${v}`, tempThorns: v => `荆棘${v}`,
    vulnerable: v => `易伤${v}`, weak: v => `虚弱${v}`, frail: v => `脆弱${v}`, poison: v => `中毒${v}`, curse: v => `灾厄${v}`,
    loseHp: v => `失${v}血`, loseGold: v => `失${v}金`, losePower: v => `失${v}电`, clutter: v => `+${v}渣滓`,
    summon: v => `召唤${v}`, conjure: () => `造牌`, give: () => `药材`,
    // 效果类型 ≠ 价值原子 id 的两个，单列；其余「操作/生成」类经 effLabel 的 bareName 兜底取中文
    playFromDraw: v => `打出牌库顶${v > 1 ? ' ' + v : ''}`, socketRandom: v => `镶随机宝石${v > 1 ? ' ' + v : ''}`,
  };
  function effLabel(eff) {
    let s;
    if (EFF_LABEL[eff.type]) s = EFF_LABEL[eff.type](eff.value);
    else if (CG.VALUE_ATOMS && CG.VALUE_ATOMS[eff.type]) s = CG.bareName(eff.type) + (eff.value != null ? ' ' + eff.value : '');   // 价值原子型（许愿/磷火/锻造…）：用中文裸名
    else s = eff.type;
    if (eff.type === 'selfStatus') s = `自${(STATUS_META[eff.status] || {}).label || eff.status}${eff.value}`;
    if (eff.type === 'enemyStat') s = `敌${eff.key === 'dexterity' ? '敏捷' : '力量'}${eff.value}`;
    if (eff.minion) s = '召唤物' + s;
    return s;
  }
  function stanceBadge(game) {   // v3.15 僧侣·姿态 / 箴言 / 下回合死亡
    let h = '';
    if (game._stance) { const n = { rage: '😡愤怒', serenity: '🧘宁静', divinity: '✨神格' }[game._stance]; h += `<span class="badge badge-buff" title="姿态：同时只能一种">${n}</span>`; }
    if (game._maxim > 0) h += `<span class="badge badge-buff" title="箴言：满 10 进入神格">📜${game._maxim}</span>`;
    if (game._dieNextTurn) h += `<span class="badge badge-vuln" title="下回合开始时死亡">☠️下回合死亡</span>`;
    return h;
  }
  function scheduleBadges(game) {   // 每回合(常驻) + 下回合(一次性) 待结算效果 → 徽标
    let h = '';
    (game._everyTurn || []).forEach(e => { h += `<span class="badge badge-every" title="每回合开始结算">每回合 ${effLabel(e)}</span>`; });
    (game._nextTurn || []).forEach(e => { h += `<span class="badge badge-next" title="下回合开始结算一次">下回合 ${effLabel(e)}</span>`; });
    return h;
  }
  function intentHTML(game, e) {
    e = e || game.enemy;
    if (e.statuses.frozen) return `<div class="intent intent-buff">❄️ 冰冻 ${e.statuses.frozen}</div>`;
    const p = game.intentPreview(e);
    if (!p) return '';
    const parts = [];
    if (p.damage != null) parts.push(`<span class="intent-attack">⚔️ ${p.damage}${p.hits > 1 ? '×' + p.hits : ''}</span>`);
    if (p.block != null) parts.push(`<span class="intent-block">🛡️ ${p.block}</span>`);
    if (!parts.length) parts.push('<span class="intent-buff">✨</span>');
    return `<div class="intent" title="${p.name}">意图 ${parts.join(' ')}</div>`;
  }

  // 敌人组：精灵 DOM 持久（否则每帧重建会清掉正在播放的受击动画），每次只刷新头顶信息框 / 目标高亮
  function tierClass(t) { return t === 'boss' ? 'tier-boss' : (t === 'elite' ? 'tier-elite' : 'tier-normal'); }
  const HUMANOID = new Set(['cultist', 'berserker', 'nob', 'chrono']);   // 人型敌人 -> 接近主角大小
  let enemyBuilt = 0;
  function buildEnemies(game) {
    $('enemy-group').innerHTML = game.enemies.map((e, k) =>
      `<div class="estage" data-ei="${k}">
        <div class="einfo" id="enemy-info-${k}"></div>
        <div class="stage" id="enemy-stage-${k}"><div class="sprite" id="enemy-sprite-${k}">${CG.Sprites.get(e.def.sprite || 'blob')}</div></div>
      </div>`).join('');
    enemyBuilt = game.enemies.length;
  }
  function renderEnemies(game) {
    const eg = $('enemy-group');
    if (!eg) return;
    if (enemyBuilt !== game.enemies.length) buildEnemies(game);
    const tcls = tierClass(game.tier);
    const isBoss = game.tier === 'boss';        // 首领：血条 / 状态移到顶部居中条，立绘头顶只留意图
    game.enemies.forEach((e, k) => {
      const est = eg.children[k];
      if (!est) return;
      const dead = !e.alive || e.hp <= 0;
      const targeted = !dead && k === game.target;
      est.className = 'estage ' + tcls + (HUMANOID.has(e.def.sprite) ? ' humanoid' : '') + (targeted ? ' targeted' : '') + (dead ? ' dead' : '');
      if (isBoss) {
        $('enemy-info-' + k).innerHTML = dead ? '' : `<div class="einfo-intent">${intentHTML(game, e)}</div>`;
        return;
      }
      const key = 'enemy' + k, newPct = Math.max(0, (e.hp / e.maxHp) * 100);
      const oldPct = lastHp[key] == null ? newPct : lastHp[key];
      $('enemy-info-' + k).innerHTML =
        `<div class="unit enemy">
          <div class="unit-top"><span class="unit-name">${e.name}</span>${dead ? '' : intentHTML(game, e)}</div>
          <div class="hpbar"><div class="hpfill" id="${key}-hpfill" style="width:${oldPct}%"></div><span class="hptext">${Math.max(0, e.hp)} / ${e.maxHp}</span></div>
          <div class="badges">${blockBadge(e.block)}${statusBadges(e.statuses)}</div>
        </div>`;
      const fill = $(key + '-hpfill');
      if (fill && fill.style) { void fill.offsetWidth; fill.style.width = newPct + '%'; }
      lastHp[key] = newPct;
    });
    renderBossBar(game, isBoss);
  }

  // ---------- 首领·顶部居中血条（血条 + 状态搬到视图上方居中；动态创建、只读展示）----------
  function renderBossBar(game, isBoss) {
    let bar = $('boss-bar');
    if (!bar) {
      if (!isBoss) return;                       // 非首领战且尚未创建过 → 无需建
      bar = document.createElement('div');
      bar.id = 'boss-bar'; bar.className = 'boss-bar';
      const sb = $('screen-battle'), tb = sb && sb.querySelector('.battle-topbar');
      if (tb) tb.appendChild(bar); else if (sb) sb.appendChild(bar);   // 绝对定位悬浮在顶栏正上方居中（不占布局高度，视图不被撑高）
    }
    if (!isBoss) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    bar.classList.remove('hidden');
    bar.innerHTML = game.enemies.map((e, k) => {
      const dead = !e.alive || e.hp <= 0;
      const key = 'bossbar' + k, newPct = Math.max(0, (e.hp / e.maxHp) * 100);
      const oldPct = lastHp[key] == null ? newPct : lastHp[key];
      return `<div class="boss-unit${dead ? ' dead' : ''}">
          <div class="boss-name">👑 ${e.name}</div>
          <div class="hpbar boss-hpbar"><div class="hpfill" id="${key}-hpfill" style="width:${oldPct}%"></div><span class="hptext">${Math.max(0, e.hp)} / ${e.maxHp}</span></div>
          <div class="badges boss-badges">${blockBadge(e.block)}${statusBadges(e.statuses)}</div>
        </div>`;
    }).join('');
    game.enemies.forEach((e, k) => {              // 提交新宽度，触发血条平滑过渡（同敌人组写法）
      const key = 'bossbar' + k, newPct = Math.max(0, (e.hp / e.maxHp) * 100);
      const fill = $(key + '-hpfill');
      if (fill && fill.style) { void fill.offsetWidth; fill.style.width = newPct + '%'; }
      lastHp[key] = newPct;
    });
  }

  // ---------- 主渲染 ----------
  function render(game) {
    const freshGame = current !== game;        // 新一场战斗：重置手牌与血条动画基准
    current = game;
    let titleShown = false;                     // 精英/首领：本次是否展示了入场标题卡
    if (freshGame) {
      prevHand = []; prevLogLen = (game.log || []).length; lastHp = {}; enemyBuilt = 0; prevPhase = null;
      if (!REDUCE) flashSprite('enter', 600);
      titleShown = showBattleIntro(game);
    }
    const p = game.player;

    renderEnemies(game);

    const incoming = game.playerIncomingDamage();   // 本回合预计净伤害（随格挡实时变化）
    const incBadge = (incoming > 0 ? `<span class="badge badge-incoming" title="本回合预计受到的净伤害（已计入格挡/减伤）">🩸 -${incoming}</span>` : '') + scheduleBadges(game) + stanceBadge(game);
    renderUnit('player', p, '你', '', incBadge);

    $('tarot-bar').innerHTML = tarotBarHTML(game.tarot, 'battle', game.phase === 'player', game.run && game.run.tarotSlots());
    $('battle-relics').innerHTML = relicIcons(game.relics);
    const freeHint = (game.freeCards || 0) > 0 ? ` <small class="free-hint" title="回响：接下来 ${game.freeCards} 张牌免费打出">🔁${game.freeCards}</small>` : '';
    const powerLine = (p.power || 0) > 0 ? `<div class="power-line" title="电力：用于「改造」等卡，战斗内跨回合保留">🔋 电力 ${p.power}</div>` : '';
    const resBits = [];   // 金币（有跑图才显示）
    if (game.run) resBits.push(`💰 ${game.run.gold}`);
    const resLine = resBits.length ? `<div class="power-line" title="金币">${resBits.join('　')}</div>` : '';
    $('energy').innerHTML = `<span class="energy-orb">⚡</span> ${p.energy} / ${p.maxEnergy}${freeHint}${powerLine}${resLine}`;
    $('draw-pile').innerHTML = `🂠 抽牌堆 <b>${game.drawPile.length}</b><small>点击查看</small>`;
    $('discard-pile').innerHTML = `🗑️ 弃牌堆 <b>${game.discardPile.length}</b><small>点击查看</small>`;

    // 手牌：先记录旧卡位置，重绘后做抽/弃/消耗/洗牌动画
    const handEl = $('hand');
    const oldRects = {}, oldNodes = {};
    if (!REDUCE) handEl.querySelectorAll('.card').forEach(el => { const u = el.dataset.uid; oldRects[u] = el.getBoundingClientRect(); oldNodes[u] = el; });
    const newUids = game.hand.map(c => String(c.uid));
    handEl.innerHTML = game.hand.map((c, i) => handCardHTML(game, c, i)).join('');
    // 手牌拥挤（>7 张）：不换行，改为重叠（负边距，随张数加深），悬停时前置不被挡。
    const nHand = game.hand.length;
    handEl.classList.toggle('crowded', nHand > 7);
    handEl.style.setProperty('--ov', nHand > 7 ? (-Math.min(62, (nHand - 7) * 24)) + 'px' : '');
    const logs = game.log || [];
    if (!REDUCE) {
      if (logs.slice(prevLogLen).some(l => l.indexOf('洗入抽牌堆') >= 0)) shuffleFx();
      animateHand(game, handEl, prevHand, newUids, oldRects, oldNodes);
    }
    prevLogLen = logs.length;
    prevHand = newUids;

    const et = $('end-turn');
    et.textContent = '结束第 ' + game.turn + ' 回合';
    et.disabled = game.phase !== 'player';
    if (prevPhase !== game.phase && !titleShown) {                  // 回合切换提示（精英/首领入场以标题卡代替首个横幅）
      if (game.phase === 'player') showTurnBanner('我方回合', false);
      else if (game.phase === 'enemy') showTurnBanner('敌方回合', true);
    }
    prevPhase = game.phase;
    $('log').innerHTML = game.log.slice(-8).map(l => `<div>${l}</div>`).join('');
    renderPrompt(game);
    renderAllies(game);
  }

  // ---------- 召唤包：己方召唤物栏（动态创建，只读展示）----------
  // 召唤物：单骷髅，作为「类玩家单位」画在玩家右侧、体型稍小、其余渲染与玩家一致（立绘 + 血条信息框）
  function renderAllies(game) {
    const wrap = $('skeleton-combatant'); if (!wrap) return;
    const sk = game.skeleton;
    if (!sk || sk.hp <= 0) { wrap.classList.add('hidden'); return; }
    const spr = $('skeleton-sprite');
    if (spr && !spr.dataset.built) { spr.innerHTML = CG.Sprites.get('skeleton'); spr.dataset.built = '1'; }   // 立绘 DOM 持久（同敌人，避免清掉受击动画）
    const appearing = wrap.classList.contains('hidden');   // 从无到有（召唤/重召）→ 播入场动画
    renderUnit('skeleton', sk, '召唤物', '', '');   // 与玩家同款：名字 + 血条 + 格挡/状态徽标
    wrap.classList.remove('hidden');
    if (appearing && spr) animate(spr, 'enter', 560);
  }

  // ---------- 战斗内浮层：炼药选料（craft）/ 消耗包选牌（pick：燃烧 / 重生）----------
  function renderPrompt(game) {
    let ov = $('craft-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'craft-overlay'; ov.className = 'craft-overlay hidden';
      ov.addEventListener('click', ev => {
        const el = ev.target.closest('[data-craft],[data-pick]'); if (!el || !current) return;
        if (el.dataset.craft != null) {       // 炼药
          const v = el.dataset.craft;
          if (v === 'cancel') return handlers.onCraftCancel && handlers.onCraftCancel();
          if (v === 'skip')   return handlers.onCraftPick && handlers.onCraftPick(null);
          CG.Audio.play('card'); return handlers.onCraftPick && handlers.onCraftPick(Number(v));
        }
        const v = el.dataset.pick;            // 消耗包选牌
        if (v === 'skip') return handlers.onPickCard && handlers.onPickCard(null);
        CG.Audio.play('card'); handlers.onPickCard && handlers.onPickCard(Number(v));
      });
      $('screen-battle').appendChild(ov);
    }
    if (game.craft) {
      const title = '🍳 炼药 · 选择兽血（与草药同熬）';
      const cands = game.craftCandidates();
      const cards = cands.length
        ? cands.map(c => cardFace(c, { clickable: true, data: { craft: c.uid } })).join('')
        : '<p class="empty-note">手牌里没有可选的，点「跳过」。</p>';
      ov.innerHTML = `<div class="craft-box"><h3>${title}</h3><div class="craft-cards">${cards}</div>
        <div class="craft-actions"><button class="big-btn" data-craft="skip">跳过</button><button class="big-btn leave" data-craft="cancel">取消炼药</button></div></div>`;
      ov.classList.remove('hidden'); return;
    }
    if (game.pick) {
      const pool = (game.pick.type === 'burn' || game.pick.type === 'discardCost' || game.pick.type === 'exhaustCost' || game.pick.type === 'transform' || game.pick.type === 'mimicry') ? game.hand : game.pick.type === 'reclaim' ? game.discardPile : game.pick.type === 'wish' ? game.drawPile : game.pick.type === 'foresight' ? (game._foresightCands ? game._foresightCands() : []) : game.exhaustPile;
      const noSkip = !!game.pick.noSkip;   // 丢弃/消耗手牌：必须选一张、不给「跳过」
      const cards = pool.length
        ? pool.map(c => cardFace(c, { clickable: true, data: { pick: c.uid } })).join('')
        : `<p class="empty-note">没有可选的${noSkip ? '。' : '，点「跳过」。'}</p>`;
      ov.innerHTML = `<div class="craft-box"><h3>🔥 ${game.pick.title}</h3><div class="craft-cards">${cards}</div>
        ${noSkip ? '' : '<div class="craft-actions"><button class="big-btn leave" data-pick="skip">跳过</button></div>'}</div>`;
      ov.classList.remove('hidden'); return;
    }
    ov.classList.add('hidden'); ov.innerHTML = '';
  }

  CG.UI = Object.assign(CG.UI || {}, { init, render, onEvent, cardFace, gemFace, tarotBarHTML, relicIcons });
})(window.CG);

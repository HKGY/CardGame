window.CG = window.CG || {};

/* ===========================================================================
 *  跑图界面（地图 / 奖励 / 商店 / 休息 / 结算）+ 顶栏 + 升级选牌弹窗。
 *  通过 .screen.active 切换显示；卡面复用 CG.UI.cardFace。
 * ===========================================================================
 */
(function (CG) {
  const $ = id => document.getElementById(id);
  let H = {};                 // 控制器回调
  let pickerHandler = null;   // 当前选牌弹窗的回调
  let chooseState = null;     // 当前三选一弹窗状态

  const ICON  = { monster: '⚔️', elite: '💀', shop: '🛒', rest: '🏕️', boss: '👑', event: '🔮' };
  const LABEL = { monster: '战斗', elite: '精英', shop: '商店', rest: '休息', boss: '首领', event: '事件' };
  const SCREENS = ['map', 'battle', 'reward', 'shop', 'rest', 'event', 'gameover'];

  function init(handlers) {
    H = handlers;
    $('run-deck-btn').addEventListener('click', openDeckView);

    $('map-area').addEventListener('click', ev => {
      const el = ev.target.closest('.map-node');
      if (!el || !el.classList.contains('available')) return;
      CG.Audio.play('select');
      H.onSelectNode(H.getRun().map[+el.dataset.row][+el.dataset.idx]);
    });
    $('screen-reward').addEventListener('click', onRewardClick);
    $('screen-shop').addEventListener('click', onShopClick);
    $('screen-rest').addEventListener('click', onRestClick);
    $('screen-event').addEventListener('click', onEventClick);
    $('screen-gameover').addEventListener('click', onGameOverClick);

    $('picker-close').addEventListener('click', closePicker);
    $('picker-modal').addEventListener('click', e => { if (e.target.id === 'picker-modal') closePicker(); });
    $('picker-cards').addEventListener('click', ev => {
      const c = ev.target.closest('.card');
      if (c && c.dataset.uid && pickerHandler) { CG.Audio.play('upgrade'); const fn = pickerHandler; closePicker(); fn(+c.dataset.uid); }
    });

    // 地图上的塔罗栏
    $('map-tarot-bar').addEventListener('click', ev => {
      const b = ev.target.closest('.tarot-btn');
      if (b && !b.disabled) { CG.Audio.play('select'); H.onUseTarot(Number(b.dataset.ti)); }
    });
    // 三选一弹窗（太阳）
    $('choice-close').addEventListener('click', closeChoice);
    $('choice-modal').addEventListener('click', e => { if (e.target.id === 'choice-modal') closeChoice(); });
    $('choice-options').addEventListener('click', ev => {
      const b = ev.target.closest('[data-ci]');
      if (!b || b.disabled || !chooseState) return;
      const opt = chooseState.options[+b.dataset.ci], cb = chooseState.cb;
      closeChoice();
      cb(opt.value);
    });

    // 百科大全
    $('codex-btn').addEventListener('click', () => openCodex());
    $('codex-btn-2').addEventListener('click', () => openCodex());
    $('codex-close').addEventListener('click', () => $('codex-modal').classList.add('hidden'));
    $('codex-modal').addEventListener('click', e => { if (e.target.id === 'codex-modal') $('codex-modal').classList.add('hidden'); });
    CODEX_TABS.forEach(t => $('codex-tab-' + t).addEventListener('click', () => renderCodex(t)));
  }

  // ---------- 百科大全 ----------
  const CODEX_TABS = ['affix', 'tarot', 'enemy'];
  const WHERE_LABEL = { battle: '战斗', map: '地图', any: '通用' };
  const TIER_LABEL = { normal: '普通', elite: '精英', boss: '首领' };
  function enemyTier(id) { return CODEX_TIERS.find(t => CG.ENEMY_POOLS[t].includes(id)) || ''; }
  const CODEX_TIERS = ['normal', 'elite', 'boss'];
  function moveSummary(move) {
    const map = { damage: '⚔', block: '🛡', strength: '力量', weak: '虚弱', vulnerable: '易伤', frail: '脆弱' };
    return (move.effects || []).map(e =>
      `${map[e.type] || e.type} ${e.value}${e.hits > 1 ? '×' + e.hits : ''}`).join('，');
  }
  function openCodex(tab) { renderCodex(tab || 'affix'); $('codex-modal').classList.remove('hidden'); }
  function renderCodex(tab) {
    CODEX_TABS.forEach(t => $('codex-tab-' + t).classList.toggle('active', t === tab));
    let html = '';
    if (tab === 'affix') {
      html = '<p class="codex-note">2/3 级名字前加「更/最」，数值 ×2 / ×3。</p>' +
        CG.AFFIX_ORDER.map(id => {
          const a = CG.AFFIXES[id];
          return `<div class="codex-item"><span class="codex-name" style="color:${a.color}">${a.name}</span>` +
                 `<span class="codex-desc">${a.desc(1, 'strike')}</span></div>`;
        }).join('');
    } else if (tab === 'tarot') {
      html = CG.TAROT_IDS.map(id => {
        const t = CG.TAROT[id];
        return `<div class="codex-item"><span class="codex-name">${t.icon} ${t.name}</span>` +
               `<span class="codex-tag">${WHERE_LABEL[t.where]}</span><span class="codex-desc">${t.desc}</span></div>`;
      }).join('');
    } else {
      html = Object.keys(CG.ENEMIES).map(id => {
        const e = CG.ENEMIES[id];
        const moves = e.moves.map(m => `<div class="codex-move">${m.name}：${moveSummary(m)}</div>`).join('');
        return `<div class="codex-enemy"><div class="codex-enemy-head"><b>${e.name}</b>` +
               `<span class="codex-tag">${TIER_LABEL[enemyTier(id)]}</span><span class="codex-hp">❤ ${e.maxHp}</span></div>${moves}</div>`;
      }).join('');
    }
    $('codex-body').innerHTML = html;
  }

  function showScreen(id) { SCREENS.forEach(s => $('screen-' + s).classList.toggle('active', s === id)); }

  function updateHeader(run, show) {
    $('run-header').classList.toggle('hidden', !show);
    $('run-act').textContent = run.act;
    $('run-hp').textContent = `❤️ ${run.hp}/${run.maxHp}`;
    $('run-gold').textContent = `💰 ${run.gold}`;
    $('run-potions').innerHTML = tarotIcons(run);
  }
  function tarotIcons(run) {
    let s = '';
    for (let i = 0; i < CG.CONFIG.tarot.slots; i++) {
      const id = run.tarot[i], t = id && CG.TAROT[id];
      s += t ? `<span class="pot-icon" title="${t.name}：${t.desc}">${t.icon}</span>`
             : '<span class="pot-icon empty">·</span>';
    }
    return s;
  }

  // ---------- 地图 ----------
  function showMap(run) {
    showScreen('map');
    const rows = run.map, total = rows.length;
    const GAP = 84, TOP = 46, H_px = TOP * 2 + (total - 1) * GAP;
    const xOf = (r, i) => 100 * (i + 1) / (rows[r].length + 1);   // 0..100（百分比）
    const yOf = r => TOP + (total - 1 - r) * GAP;                 // 第 0 行在底部

    let edges = '';
    for (let r = 0; r < total - 1; r++)
      rows[r].forEach((node, i) => node.next.forEach(j => {
        edges += `<line x1="${xOf(r, i)}" y1="${yOf(r)}" x2="${xOf(r + 1, j)}" y2="${yOf(r + 1)}"/>`;
      }));

    let nodes = '';
    rows.forEach((row, r) => row.forEach((node, i) => {
      const avail = run.available.includes(node);
      const cls = ['map-node', node.type, node.done ? 'done' : '', avail ? 'available' : (node.done ? '' : 'locked')].join(' ');
      nodes += `<button class="${cls}" data-row="${r}" data-idx="${i}" title="${LABEL[node.type]}"
        style="left:${xOf(r, i)}%; top:${yOf(r)}px">${node.done ? '✓' : ICON[node.type]}</button>`;
    }));

    $('map-area').style.height = H_px + 'px';
    $('map-area').innerHTML =
      `<svg class="map-edges" viewBox="0 0 100 ${H_px}" preserveAspectRatio="none">${edges}</svg>` + nodes;
    $('map-tarot-bar').innerHTML = CG.UI.tarotBarHTML(run.tarot, 'map', true);
  }

  // ---------- 奖励 ----------
  function showReward(run) {
    showScreen('reward');
    CG.Audio.play('coin');
    const pend = run.pending;
    const cards = pend.cards.map((spec, i) => CG.UI.cardFace(spec, { clickable: true, data: { ridx: i } })).join('');
    let tarot = '';
    if (pend.tarot) {
      const t = CG.TAROT[pend.tarot];
      const full = run.tarot.length >= CG.CONFIG.tarot.slots;
      const label = pend.tarotTaken ? '✓ 已收入' : (full ? '消耗栏已满' : '收入消耗栏');
      tarot = `<div class="reward-potion">
        <span class="pot-name">${t.icon} ${t.name}</span>
        <span class="pot-desc">${t.desc}</span>
        <button class="buy-btn" data-act="take-tarot" ${(pend.tarotTaken || full) ? 'disabled' : ''}>${label}</button>
      </div>`;
    }
    $('screen-reward').innerHTML = `
      <div class="panel">
        <h2>战斗胜利</h2>
        <p class="reward-gold">获得金币 💰 ${pend.gold}</p>
        ${tarot}
        <p>选择一张卡加入牌组（或跳过）：</p>
        <div class="reward-cards">${cards}</div>
        <button class="big-btn" data-act="skip">跳过</button>
      </div>`;
  }
  function onRewardClick(ev) {
    if (ev.target.closest('[data-act="take-tarot"]')) { CG.Audio.play('coin'); return H.onTakeTarot(); }
    const card = ev.target.closest('.card');
    if (card && card.dataset.ridx != null) { CG.Audio.play('card'); return H.onChooseReward(H.getRun().pending.cards[+card.dataset.ridx]); }
    if (ev.target.closest('[data-act="skip"]')) { CG.Audio.play('select'); H.onChooseReward(null); }
  }

  // ---------- 商店 ----------
  function showShop(run) {
    showScreen('shop');
    const cfg = CG.CONFIG.shop;
    const cardItems = run.pending.cards.map((it, i) => `
      <div class="shop-item">
        ${CG.UI.cardFace(it, { dim: it.bought || run.gold < it.price })}
        <button class="buy-btn" data-buy="${i}" ${(it.bought || run.gold < it.price) ? 'disabled' : ''}>
          ${it.bought ? '已购买' : (it.price === 0 ? '免费' : '💰 ' + it.price)}
        </button>
      </div>`).join('');
    const tarotItems = (run.pending.tarot || []).map((it, i) => {
      const t = CG.TAROT[it.id];
      const dis = it.bought || run.gold < it.price || run.tarot.length >= CG.CONFIG.tarot.slots;
      return `<div class="shop-item shop-tarot" title="${t.desc}">
        <div class="shop-tarot-face"><span class="shop-tarot-icon">${t.icon}</span><b>${t.name}</b><small>${t.desc}</small></div>
        <button class="buy-btn" data-buytarot="${i}" ${dis ? 'disabled' : ''}>${it.bought ? '已购买' : '💰 ' + it.price}</button>
      </div>`;
    }).join('');
    const healAmt = Math.ceil(run.maxHp * cfg.healPct);
    const rmPrice = run.removePrice();
    $('screen-shop').innerHTML = `
      <div class="panel">
        <h2>🛒 商店　<span class="reward-gold">💰 ${run.gold}</span></h2>
        <div class="shop-cards">${cardItems}${tarotItems}</div>
        <div class="shop-services">
          <button class="big-btn" data-act="upgrade" ${run.gold < cfg.upgradePrice ? 'disabled' : ''}>升级一张卡（💰 ${cfg.upgradePrice}）</button>
          <button class="big-btn" data-act="remove" ${(run.gold < rmPrice || run.deck.length <= 1) ? 'disabled' : ''}>删除一张卡（💰 ${rmPrice}）</button>
          <button class="big-btn" data-act="heal" ${(run.gold < cfg.healPrice || run.hp >= run.maxHp) ? 'disabled' : ''}>治疗 +${healAmt}（💰 ${cfg.healPrice}）</button>
          <button class="big-btn leave" data-act="leave">离开</button>
        </div>
      </div>`;
  }
  function onShopClick(ev) {
    const buy = ev.target.closest('[data-buy]');
    if (buy && !buy.disabled) { CG.Audio.play('coin'); return H.onBuyCard(+buy.dataset.buy); }
    const bt = ev.target.closest('[data-buytarot]');
    if (bt && !bt.disabled) { CG.Audio.play('coin'); return H.onBuyTarot(+bt.dataset.buytarot); }
    const act = ev.target.closest('[data-act]');
    if (!act || act.disabled) return;
    if (act.dataset.act === 'upgrade') openPicker('选择要升级的卡', uid => H.onBuyUpgrade(uid));
    else if (act.dataset.act === 'remove') openPicker('选择要删除的卡', uid => H.onBuyRemove(uid));
    else if (act.dataset.act === 'heal') { CG.Audio.play('heal'); H.onBuyHeal(); }
    else if (act.dataset.act === 'leave') { CG.Audio.play('select'); H.onLeaveShop(); }
  }

  // ---------- 休息 ----------
  function showRest(run) {
    showScreen('rest');
    const heal = Math.ceil(run.maxHp * CG.CONFIG.rest.healPct);
    $('screen-rest').innerHTML = `
      <div class="panel center">
        <h2>🏕️ 休息点</h2>
        <p>选择一项行动：</p>
        <div class="rest-options">
          <button class="big-btn" data-act="heal">😴 休息<br><small>回复 ${heal} 点（当前 ${run.hp}/${run.maxHp}）</small></button>
          <button class="big-btn" data-act="upgrade">🔨 打磨<br><small>升级一张卡</small></button>
        </div>
      </div>`;
  }
  function onRestClick(ev) {
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'heal') { CG.Audio.play('heal'); H.onRestHeal(); }
    else if (act.dataset.act === 'upgrade') openPicker('选择要升级的卡', uid => H.onRestUpgrade(uid));
  }

  // ---------- 事件（祭坛） ----------
  function showEvent(run) {
    showScreen('event');
    const a = CG.ALTARS[run.pending.altar];
    $('screen-event').innerHTML = `
      <div class="panel center">
        <h2>${a.icon} ${a.name}</h2>
        <p class="altar-desc">${a.desc}</p>
        <div class="event-actions">
          <button class="big-btn" data-act="use">使用</button>
          <button class="big-btn leave" data-act="leave">离开</button>
        </div>
      </div>`;
  }
  function onEventClick(ev) {
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'use') {
      const a = CG.ALTARS[H.getRun().pending.altar];
      openPicker(a.name + '：选择一张牌', uid => H.onUseAltar(uid));
    } else if (act.dataset.act === 'leave') { CG.Audio.play('select'); H.onLeaveEvent(); }
  }

  // ---------- 结算 ----------
  function showGameOver(run) {
    showScreen('gameover');
    const win = run.phase === 'victory';
    if (win) CG.Audio.play('victory');   // 失败音在战斗结束时已播放
    $('screen-gameover').innerHTML = `
      <div class="panel center">
        <h2>${win ? '🎉 通关！' : '💀 你倒下了'}</h2>
        <p>${win ? '你击败了首领，登顶成功。' : '冒险到此为止。'}</p>
        <p>金币 💰 ${run.gold} ・ 牌组 ${run.deck.length} 张</p>
        <button class="big-btn" data-act="restart">再来一局</button>
      </div>`;
  }
  function onGameOverClick(ev) { if (ev.target.closest('[data-act="restart"]')) H.onRestart(); }

  // ---------- 选牌弹窗（升级用） ----------
  function openPicker(title, onPick, cards) {
    $('picker-title').textContent = title;
    $('picker-cards').innerHTML = (cards || H.getRun().deck).map(c => CG.UI.cardFace(c, { clickable: true, data: { uid: c.uid } })).join('');
    pickerHandler = onPick;
    $('picker-modal').classList.remove('hidden');
  }
  function closePicker() { $('picker-modal').classList.add('hidden'); pickerHandler = null; }
  function pickCardList(title, cards, cb) { openPicker(title, cb, cards); }   // 魔术师等：从指定牌堆选

  function choose(title, options, cb) {                                       // 太阳：三选一
    $('choice-title').textContent = title;
    $('choice-options').innerHTML = options.map((o, i) =>
      `<button class="big-btn" data-ci="${i}" ${o.enabled === false ? 'disabled' : ''}>${o.label}</button>`).join('');
    chooseState = { options, cb };
    $('choice-modal').classList.remove('hidden');
  }
  function closeChoice() { $('choice-modal').classList.add('hidden'); chooseState = null; }

  // ---------- 牌库查看（顶栏） ----------
  function openDeckView() {
    const run = H.getRun();
    const sorted = [...run.deck].sort((a, b) =>
      a.base === b.base
        ? ((a.affixes || []).length - (b.affixes || []).length
           || CG.cardStats(a).name.localeCompare(CG.cardStats(b).name, 'zh'))
        : (a.base < b.base ? -1 : 1));
    $('pile-title').textContent = `牌库（${run.deck.length} 张）`;
    $('pile-cards').innerHTML = sorted.map(c => CG.UI.cardFace(c)).join('');
    $('pile-modal').classList.remove('hidden');
  }

  CG.Screens = { init, showScreen, updateHeader, showMap, showReward, showShop, showRest, showEvent, showGameOver, pickCardList, choose, openCodex };
})(window.CG);

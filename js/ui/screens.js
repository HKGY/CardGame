window.CG = window.CG || {};

/* ===========================================================================
 *  跑图界面（地图 / 奖励 / 商店 / 事件 / 结算）+ 顶栏 + 宝石工作台 + 百科。
 *  通过 .screen.active 切换显示；卡面复用 CG.UI.cardFace、宝石面复用 CG.UI.gemFace。
 *  已去掉篝火（休息）：商店承担回血与宝石打理；事件全为宝石主题祭坛。
 * ===========================================================================
 */
(function (CG) {
  const $ = id => document.getElementById(id);
  let H = {};                 // 控制器回调
  let pickerHandler = null;   // 当前选择弹窗的回调（卡 / 宝石通用，回传 uid）
  let chooseState = null;     // 当前三选一弹窗状态
  let benchSel = null;        // 工作台：当前选中的背包宝石 uid

  // 以撒式房间类型 → 图标 / 名称（普通房不剧透是否有敌人；清空后统一显示 ✓）
  const ICON  = { start: '🚩', normal: '', elite: '👹', boss: '👑', shop: '🛒', treasure: '🎁', curse: '🩸' };
  const LABEL = { start: '起点', normal: '房间', elite: '小boss房', boss: '首领房', shop: '商店', treasure: '宝藏房', curse: '诅咒房' };
  const SCREENS = ['menu', 'map', 'battle', 'reward', 'shop', 'event', 'gameover'];
  const REDUCE = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function init(handlers) {
    H = handlers;
    $('run-deck-btn').addEventListener('click', openDeckView);
    $('bench-btn').addEventListener('click', () => openBench());

    $('map-area').addEventListener('click', ev => {
      const el = ev.target.closest('.map-cell.room');
      if (!el || !el.classList.contains('available')) return;
      CG.Audio.play('select');
      H.onSelectNode(H.getRun().roomById(+el.dataset.id));
    });
    // WASD / 方向键：朝该方向走进相邻房间（仅地图阶段、无弹窗、未在输入框时）
    const DIRS = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0] };
    document.addEventListener('keydown', ev => {
      const run = H.getRun();
      if (!run || run.phase !== 'map') return;
      if (document.querySelector('.modal:not(.hidden)')) return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;
      const dir = DIRS[ev.key.toLowerCase()];
      if (!dir) return;
      ev.preventDefault();
      const cur = run.current;
      const target = run.grid.rooms.find(r => r.gx === cur.gx + dir[0] && r.gy === cur.gy + dir[1]);
      if (target && run.available.includes(target)) { CG.Audio.play('select'); H.onSelectNode(target); }
    });
    $('screen-reward').addEventListener('click', onRewardClick);
    $('screen-shop').addEventListener('click', onShopClick);
    $('screen-event').addEventListener('click', onEventClick);
    $('screen-gameover').addEventListener('click', onGameOverClick);

    $('picker-close').addEventListener('click', closePicker);
    $('picker-modal').addEventListener('click', e => { if (e.target.id === 'picker-modal') closePicker(); });
    $('picker-cards').addEventListener('click', ev => {
      const c = ev.target.closest('.card[data-uid], .gem[data-uid]');
      if (c && c.dataset.uid && pickerHandler) { CG.Audio.play('upgrade'); const fn = pickerHandler; closePicker(); fn(+c.dataset.uid); }
    });

    // 工作台（宝石镶嵌，免费）
    $('bench-close').addEventListener('click', closeBench);
    $('bench-modal').addEventListener('click', e => { if (e.target.id === 'bench-modal') closeBench(); });
    $('bench-body').addEventListener('click', onBenchClick);

    // 地图上的塔罗栏
    $('map-tarot-bar').addEventListener('click', ev => {
      const b = ev.target.closest('.tarot-btn');
      if (b && !b.disabled) { CG.Audio.play('select'); H.onUseTarot(Number(b.dataset.ti)); }
    });
    // 三选一弹窗（太阳）
    $('choice-close').addEventListener('click', closeChoice);
    $('choice-modal').addEventListener('click', e => { if (e.target.id === 'choice-modal' && chooseState && chooseState.cancelable) closeChoice(); });
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

    // 开始菜单
    $('menu-start').addEventListener('click', () => H.onStart());
    $('menu-codex').addEventListener('click', () => openCodex());
  }

  function showMenu() { $('run-header').classList.add('hidden'); CG.Background.setScene('menu'); showScreen('menu'); }

  // ---------- 百科大全 ----------
  const CODEX_TABS = ['affix', 'tarot', 'relic', 'enemy'];
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
      const row = id => {
        const a = CG.AFFIXES[id];
        const detail = (a.long || a.desc)(1, 'strike');   // 百科显示详解（long），卡面用精简 desc
        return `<div class="codex-item"><span class="codex-name" style="color:${a.color}">${a.name}</span>` +
               `<span class="codex-tag">${a.score > 0 ? '+' + a.score : a.score}</span>` +
               `<span class="codex-desc">${detail}</span></div>`;
      };
      html = '<p class="codex-note">效果来自<b>宝石</b>：宝石带若干增益(buff)与减益(debuff)，镶进卡牌孔位生效。' +
        '一颗宝石要么是「小增益」，要么是「强增益+减益」。安装免费；卸下要花钱且宝石会随机多一个减益。' +
        '词条 1~3 级前加「更/最」、数值 ×2/×3。</p>' +
        '<div class="codex-sub">增益（正分）</div>' + (CG.BUFF_ORDER || []).map(row).join('') +
        '<div class="codex-sub">减益（负分）</div>' + (CG.DEBUFF_ORDER || []).map(row).join('');
    } else if (tab === 'tarot') {
      html = CG.TAROT_IDS.map(id => {
        const t = CG.TAROT[id];
        return `<div class="codex-item"><span class="codex-name">${t.icon} ${t.name}</span>` +
               `<span class="codex-tag">${WHERE_LABEL[t.where]}</span><span class="codex-desc">${t.desc}</span></div>`;
      }).join('');
    } else if (tab === 'relic') {
      html = CG.RELIC_IDS.map(id => {
        const r = CG.RELICS[id];
        return `<div class="codex-item"><span class="codex-name">${r.icon} ${r.name}</span><span class="codex-desc">${r.desc}</span></div>`;
      }).join('');
    } else {
      const entry = (sprite, name, tag, hp, body) =>
        `<div class="codex-enemy"><div class="codex-portrait">${CG.Sprites.get(sprite)}</div>` +
        `<div class="codex-enemy-info"><div class="codex-enemy-head"><b>${name}</b>` +
        `<span class="codex-tag">${tag}</span><span class="codex-hp">❤ ${hp}</span></div>${body}</div></div>`;
      const startHp = (CG.CONFIG && CG.CONFIG.startHp) || 75;
      const hero = entry('knight', '第一女骑士（你）', '主角', startHp,
        `<div class="codex-move">王国第一女骑士，为夺取古代遗物登上残响之塔。初始牌组：5 打击 + 5 防御（各预镶一颗小宝石）。</div>`);
      html = hero + Object.keys(CG.ENEMIES).map(id => {
        const e = CG.ENEMIES[id];
        const moves = e.moves.map(m => `<div class="codex-move">${m.name}：${moveSummary(m)}</div>`).join('');
        return entry(e.sprite || 'blob', e.name, TIER_LABEL[enemyTier(id)], e.maxHp, moves);
      }).join('');
    }
    $('codex-body').innerHTML = html;
  }

  function showScreen(id) { SCREENS.forEach(s => $('screen-' + s).classList.toggle('active', s === id)); }

  // 进入战斗：镜头缩放放大到指定房间格（缩放原点对准该格中心），结束后回调切到战斗界面。
  function zoomMapToRoom(id, cb) {
    const area = $('map-area');
    const cell = (area && id != null) ? area.querySelector(`.map-cell[data-id="${id}"]`) : null;
    let called = false, anim = null;
    const done = () => {
      if (called) return; called = true;
      if (anim) { try { anim.cancel(); } catch (e) {} }
      if (area) area.style.transformOrigin = '';
      cb();
    };
    if (!cell || REDUCE || !area.animate) { done(); return; }
    const ar = area.getBoundingClientRect(), cr = cell.getBoundingClientRect();
    const ox = ar.width ? ((cr.left + cr.width / 2 - ar.left) / ar.width) * 100 : 50;
    const oy = ar.height ? ((cr.top + cr.height / 2 - ar.top) / ar.height) * 100 : 50;
    area.style.transformOrigin = `${ox}% ${oy}%`;
    anim = area.animate(
      [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(3.4)', opacity: 0 }],
      { duration: 430, easing: 'cubic-bezier(.5,.05,.5,1)', fill: 'forwards' });
    anim.onfinish = done;
    setTimeout(done, 620);   // 安全兜底（动画异常也能进战斗）
  }
  // 战斗界面控件一次性「飞入」动画（加 class 触发 CSS keyframes，播完移除以免重复）。
  function playBattleEntrance() {
    if (REDUCE) return;
    const el = $('screen-battle');
    el.classList.remove('entering'); void el.offsetWidth; el.classList.add('entering');
    setTimeout(() => el.classList.remove('entering'), 950);
  }

  function updateHeader(run, show) {
    $('run-header').classList.toggle('hidden', !show);
    const seedEl = $('run-seed'); if (seedEl) seedEl.textContent = run.seed ? '🌱 ' + run.seed : '';
    $('run-act').textContent = run.act;                                     // 当前层（1..maxActs）
    $('run-hp').textContent = `❤️ ${run.hp}/${run.maxHp}`;
    $('run-gold').textContent = `💰 ${run.gold}`;
    $('bench-btn').innerHTML = `💎 宝石 <b>${run.gems.length}</b>`;
    $('run-potions').innerHTML = tarotIcons(run);
    $('run-relics').innerHTML = CG.UI.relicIcons(run.relics);
  }
  function tarotIcons(run) {
    let s = '';
    for (let i = 0; i < run.tarotSlots(); i++) {
      const id = run.tarot[i], t = id && CG.TAROT[id];
      s += t ? `<span class="pot-icon" title="${t.name}：${t.desc}">${t.icon}</span>`
             : '<span class="pot-icon empty">·</span>';
    }
    return s;
  }

  // ---------- 地图（《以撒的结合》式房间布局）----------
  const CLEARABLE = { normal: 1, elite: 1, shop: 1, treasure: 1, curse: 1 };   // 清空后显示 ✓ 的内容房
  function showMap(run) {
    showScreen('map');
    const g = run.grid;
    const sub = $('map-subtitle');
    if (sub) sub.innerHTML = `🗼 第 <b>${run.act}</b> / ${run.maxActs} 层　｜　WASD / 点击移动；🚩起点　👹小boss　🎁宝藏　🩸诅咒(耗血)　🛒商店　👑首领(通向下一层)`;

    const byXY = {};
    g.rooms.forEach(r => (byXY[r.gx + ',' + r.gy] = r));
    // 门（相邻房间之间的连线）：viewBox 与网格对齐，画在房间格之下，只在格间缝隙显形
    let doors = '';
    g.rooms.forEach(r => [[1, 0], [0, 1]].forEach(d => {
      if (byXY[(r.gx + d[0]) + ',' + (r.gy + d[1])])
        doors += `<line x1="${r.gx + 0.5}" y1="${r.gy + 0.5}" x2="${r.gx + d[0] + 0.5}" y2="${r.gy + d[1] + 0.5}"/>`;
    }));
    let cells = '';
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      const r = byXY[x + ',' + y];
      if (!r) { cells += `<div class="map-cell void"></div>`; continue; }
      const avail = run.available.includes(r), cur = r === run.current;
      const cls = ['map-cell', 'room', r.type, r.done ? 'done' : '', avail ? 'available' : '', cur ? 'current' : ''].join(' ').replace(/\s+/g, ' ').trim();
      const glyph = cur ? `<span class="map-hero">${CG.Sprites.get('hero_token')}</span>`
                        : ((r.done && CLEARABLE[r.type]) ? '✓' : ICON[r.type]);
      const title = r.type === 'curse' ? `${LABEL.curse}（进入耗 ${run._curseCost()} 生命）` : (LABEL[r.type] || '');
      cells += `<button class="${cls}" data-id="${r.id}" title="${title}"><span class="cell-glyph">${glyph}</span></button>`;
    }
    const area = $('map-area');
    area.style.setProperty('--cols', g.cols);
    area.style.setProperty('--rows', g.rows);
    area.innerHTML = `<svg class="map-doors" viewBox="0 0 ${g.cols} ${g.rows}" preserveAspectRatio="none">${doors}</svg>${cells}`;
    $('map-tarot-bar').innerHTML = CG.UI.tarotBarHTML(run.tarot, "map", true, run.tarotSlots());
  }

  // ---------- 奖励（宝石 或 空法杖，三选一） ----------
  function showReward(run) {
    showScreen('reward');
    CG.Audio.play('coin');
    const pend = run.pending;
    let picks, picksLabel;
    if (pend.kind === 'gem') {
      picks = pend.gems.map((g, i) => CG.UI.gemFace(g, { clickable: true, data: { ridx: i } })).join('');
      picksLabel = '选择一颗宝石放入背包（之后在 💎 工作台镶嵌；或跳过）：';
    } else {
      picks = pend.cards.map((spec, i) => CG.UI.cardFace(spec, { clickable: true, data: { ridx: i } })).join('');
      picksLabel = '选择一把法杖加入牌组（空孔可日后镶嵌宝石；或跳过）：';
    }
    let tarot = '';
    if (pend.tarot) {
      const t = CG.TAROT[pend.tarot];
      const full = run.tarot.length >= run.tarotSlots();
      const label = pend.tarotTaken ? '✓ 已收入' : (full ? '消耗栏已满' : '收入消耗栏');
      tarot = `<div class="reward-potion">
        <span class="pot-name">${t.icon} ${t.name}</span>
        <span class="pot-desc">${t.desc}</span>
        <button class="buy-btn" data-act="take-tarot" ${(pend.tarotTaken || full) ? 'disabled' : ''}>${label}</button>
      </div>`;
    }
    let relics = '';
    if (pend.relics && pend.relics.length) {
      relics = '<p class="reward-relics">获得遗物：' + pend.relics.map(id => {
        const r = CG.RELICS[id];
        return `<span class="relic-got" title="${r.desc}">${r.icon} ${r.name}</span>`;
      }).join('') + '</p>';
    }
    $('screen-reward').innerHTML = `
      <div class="panel">
        <h2>战斗胜利</h2>
        <p class="reward-gold">获得金币 💰 ${pend.gold}</p>
        ${relics}${tarot}
        <p>${picksLabel}</p>
        <div class="reward-cards">${picks}</div>
        <button class="big-btn" data-act="skip">跳过</button>
      </div>`;
  }
  function onRewardClick(ev) {
    if (ev.target.closest('[data-act="take-tarot"]')) { CG.Audio.play('coin'); return H.onTakeTarot(); }
    const pickEl = ev.target.closest('.card[data-ridx], .gem[data-ridx]');
    if (pickEl) {
      CG.Audio.play('card');
      const pend = H.getRun().pending, i = +pickEl.dataset.ridx;
      return H.onChooseReward(pend.kind === 'gem' ? pend.gems[i] : pend.cards[i]);
    }
    if (ev.target.closest('[data-act="skip"]')) { CG.Audio.play('select'); H.onChooseReward(null); }
  }

  // ---------- 商店（合并篝火；一切皆需花钱；安装走工作台） ----------
  function showShop(run) {
    showScreen('shop');
    const cfg = CG.CONFIG.shop;
    const gemItems = (run.pending.gems || []).map((it, i) => `
      <div class="shop-item">
        ${CG.UI.gemFace(it.gem, { dim: it.bought || run.gold < it.price })}
        <button class="buy-btn" data-buygem="${i}" ${(it.bought || run.gold < it.price) ? 'disabled' : ''}>
          ${it.bought ? '已购买' : (it.price === 0 ? '免费' : '💰 ' + it.price)}
        </button>
      </div>`).join('');
    const cardItems = (run.pending.cards || []).map((it, i) => {
      const probe = CG.makeCard(it.base, it.limit, it.gems || []);
      return `<div class="shop-item">
        ${CG.UI.cardFace(probe, { dim: it.bought || run.gold < it.price })}
        <button class="buy-btn" data-buycard="${i}" ${(it.bought || run.gold < it.price) ? 'disabled' : ''}>
          ${it.bought ? '已购买' : '💰 ' + it.price}
        </button>
      </div>`;
    }).join('');
    const tarotItems = (run.pending.tarot || []).map((it, i) => {
      const t = CG.TAROT[it.id];
      const dis = it.bought || run.gold < it.price || run.tarot.length >= run.tarotSlots();
      return `<div class="shop-item shop-tarot" title="${t.desc}">
        <div class="shop-tarot-face"><span class="shop-tarot-icon">${t.icon}</span><b>${t.name}</b><small>${t.desc}</small></div>
        <button class="buy-btn" data-buytarot="${i}" ${dis ? 'disabled' : ''}>${it.bought ? '已购买' : '💰 ' + it.price}</button>
      </div>`;
    }).join('');
    const relicItems = (run.pending.relics || []).map((it, i) => {
      const r = CG.RELICS[it.id];
      const dis = it.bought || run.gold < it.price || run.hasRelic(it.id);
      return `<div class="shop-item shop-tarot" title="${r.desc}">
        <div class="shop-tarot-face relic-card"><span class="shop-tarot-icon">${r.icon}</span><b>${r.name}</b><small>${r.desc}</small></div>
        <button class="buy-btn" data-buyrelic="${i}" ${dis ? 'disabled' : ''}>${it.bought ? '已购买' : '💰 ' + it.price}</button>
      </div>`;
    }).join('');
    const healAmt = Math.ceil(run.maxHp * cfg.healPct);
    const rmPrice = run.removePrice(), unPrice = run.uninstallPrice(), skPrice = run.socketPrice(), hlPrice = run.healCost();
    const hasSocketed = run.allGems().some(x => x.loc === 'card');
    const canSocket = run.deck.some(c => (c.limit || 0) < CG.MAX_SOCKETS);
    $('screen-shop').innerHTML = `
      <div class="panel">
        <h2>🛒 商店　<span class="reward-gold">💰 ${run.gold}</span>　<span class="shop-bench-hint">背包宝石 💎 ${run.gems.length}（点顶栏「宝石」免费镶嵌）</span></h2>
        <div class="shop-section-title">宝石</div>
        <div class="shop-cards">${gemItems || '<span class="empty-note">（售罄）</span>'}</div>
        <div class="shop-section-title">法杖（空孔卡）</div>
        <div class="shop-cards">${cardItems}</div>
        <div class="shop-section-title">塔罗 / 遗物</div>
        <div class="shop-cards">${tarotItems}${relicItems || ''}</div>
        <div class="shop-services">
          <button class="big-btn" data-act="bench">💎 镶嵌宝石（免费）</button>
          <button class="big-btn" data-act="uninstall" ${(run.gold < unPrice || !hasSocketed) ? 'disabled' : ''}>卸下宝石（💰 ${unPrice}）<br><small>宝石将随机多一个减益</small></button>
          <button class="big-btn" data-act="socket" ${(run.gold < skPrice || !canSocket) ? 'disabled' : ''}>给卡 +1 孔（💰 ${skPrice}）</button>
          <button class="big-btn" data-act="remove" ${(run.gold < rmPrice || run.deck.length <= 1) ? 'disabled' : ''}>删除一张卡（💰 ${rmPrice}）</button>
          <button class="big-btn" data-act="heal" ${(run.svcUsed('heal') || run.gold < hlPrice || run.hp >= run.maxHp) ? 'disabled' : ''}>${run.svcUsed('heal') ? '已治疗' : `治疗 +${healAmt}（💰 ${hlPrice}）`}</button>
          <button class="big-btn leave" data-act="leave">离开</button>
        </div>
      </div>`;
  }
  function onShopClick(ev) {
    const run = H.getRun();
    const bg = ev.target.closest('[data-buygem]');
    if (bg && !bg.disabled) { CG.Audio.play('coin'); return H.onBuyGem(+bg.dataset.buygem); }
    const bc = ev.target.closest('[data-buycard]');
    if (bc && !bc.disabled) { CG.Audio.play('coin'); return H.onBuyCard(+bc.dataset.buycard); }
    const bt = ev.target.closest('[data-buytarot]');
    if (bt && !bt.disabled) { CG.Audio.play('coin'); return H.onBuyTarot(+bt.dataset.buytarot); }
    const br = ev.target.closest('[data-buyrelic]');
    if (br && !br.disabled) { CG.Audio.play('coin'); return H.onBuyRelic(+br.dataset.buyrelic); }
    const act = ev.target.closest('[data-act]');
    if (!act || act.disabled) return;
    const a = act.dataset.act;
    if (a === 'bench') openBench();
    else if (a === 'uninstall') openUninstallPicker();
    else if (a === 'socket') openCardPicker('选择要 +1 孔的卡（💰 ' + run.socketPrice() + '）', run.deck.filter(c => (c.limit || 0) < CG.MAX_SOCKETS), uid => H.onBuyAddSocket(uid));
    else if (a === 'remove') openCardPicker('选择要删除的卡（💰 ' + run.removePrice() + '）', run.deck, uid => H.onBuyRemove(uid));
    else if (a === 'heal') { CG.Audio.play('heal'); H.onBuyHeal(); }
    else if (a === 'leave') { CG.Audio.play('select'); H.onLeaveShop(); }
  }
  // 卸下宝石：列出所有已镶嵌的宝石，选一颗（花钱 + 随机加 debuff）
  function openUninstallPicker() {
    const run = H.getRun();
    const socketed = run.allGems().filter(x => x.loc === 'card');
    openGemPicker(`卸下哪颗宝石？（💰 ${run.uninstallPrice()}，将随机多一个减益）`, socketed, uid => {
      const f = run.findGem(uid);
      if (f && f.loc === 'card') H.onBuyUninstall(f.card.uid, f.idx);
    });
  }

  // ---------- 事件（宝藏房 / 诅咒房 / 宝石祭坛） ----------
  function relicLootHTML(p) {
    if (p.relics && p.relics.length)
      return '<p class="reward-relics">' + p.relics.map(id => {
        const r = CG.RELICS[id];
        return `<span class="relic-got" title="${r.desc}">${r.icon} ${r.name}</span>`;
      }).join('') + '</p>';
    return `<p class="reward-gold">遗物已集齐，折算金币 💰 ${p.gold || 0}</p>`;
  }
  function showEvent(run) {
    showScreen('event');
    const p = run.pending;
    if (p.kind === 'treasure' || p.kind === 'curse') {
      const curse = p.kind === 'curse';
      $('screen-event').innerHTML = `
        <div class="panel center">
          <h2>${curse ? '🩸 诅咒房' : '🎁 宝藏房'}</h2>
          <p class="altar-desc">${curse ? `你以 ${p.hpPaid} 点生命为代价，撬开了诅咒之门——` : '房间中央的基座上摆着——'}</p>
          ${relicLootHTML(p)}
          <div class="event-actions"><button class="big-btn" data-act="leave">${curse ? '忍痛离开' : '收下并离开'}</button></div>
        </div>`;
      return;
    }
    const a = CG.ALTARS[p.altar];
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
    if (act.dataset.act === 'leave') { CG.Audio.play('select'); return H.onLeaveEvent(); }
    if (act.dataset.act !== 'use') return;
    const run = H.getRun(), id = run.pending.altar;
    if (id === 'findgem') { CG.Audio.play('upgrade'); return H.onAltarFindGem(); }
    if (id === 'setting') {
      openGemPicker('选择要镶嵌的宝石', run.gems.map(g => ({ gem: g, uid: g.uid })), gemUid =>
        openCardPicker('镶嵌到哪张卡？', run.cardsWithEmptySocket(), cardUid => H.onAltarInstall(gemUid, cardUid)));
    } else if (id === 'purify') {
      openGemPicker('净化哪颗宝石？（移除一个减益）', run.allGems().filter(x => CG.gemHasDebuff(x.gem)), uid => H.onAltarPurify(uid));
    } else if (id === 'bore') {
      openCardPicker('给哪张卡 +1 孔？', run.deck.filter(c => (c.limit || 0) < CG.MAX_SOCKETS), uid => H.onAltarBore(uid));
    } else if (id === 'recut') {
      openGemPicker('重铸哪颗宝石？', run.allGems(), uid => H.onAltarRecut(uid));
    }
  }

  // ---------- 结算 ----------
  function showGameOver(run) {
    showScreen('gameover');
    const win = run.phase === 'victory';
    if (win) CG.Audio.play('victory');   // 失败音在战斗结束时已播放
    $('screen-gameover').innerHTML = `
      <div class="panel center">
        <h2>${win ? '🗿 登顶……？' : '💤 两眼一黑'}</h2>
        <p>${win
          ? '塔顶矗立着一块古老的石碑，上面写着：「谢谢你扫荡了塔里的魔物，但是古代遗物在另一座高塔。」'
          : '你感到两眼一黑——原来是一场梦。'}</p>
        <p>金币 💰 ${run.gold} ・ 牌组 ${run.deck.length} 张 ・ 宝石 ${run.gems.length} 颗 ・ 遗物 ${run.relics.length} 个</p>
        <div class="rest-options">
          <button class="big-btn" data-act="restart">再来一局</button>
          <button class="big-btn" data-act="menu">主菜单</button>
        </div>
      </div>`;
  }
  function onGameOverClick(ev) {
    if (ev.target.closest('[data-act="restart"]')) H.onRestart();
    else if (ev.target.closest('[data-act="menu"]')) showMenu();
  }

  // ---------- 选择弹窗（卡 / 宝石通用） ----------
  function openPicker(title, onPick, html) {
    $('picker-title').textContent = title;
    $('picker-cards').innerHTML = html || '<p class="empty-note">（没有可选项）</p>';
    pickerHandler = onPick;
    $('picker-modal').classList.remove('hidden');
  }
  function openCardPicker(title, cards, onPick) {
    openPicker(title, onPick, (cards || []).map(c => CG.UI.cardFace(c, { clickable: true, data: { uid: c.uid } })).join(''));
  }
  // entries: 宝石对象数组，或 [{gem, uid, label}]（后者用于带位置标签）
  function openGemPicker(title, entries, onPick) {
    const html = (entries || []).map(e => {
      const gem = e.gem || e, uid = e.uid != null ? e.uid : gem.uid;
      return CG.UI.gemFace(gem, { clickable: true, data: { uid }, tagLabel: e.label });
    }).join('');
    openPicker(title, onPick, html);
  }
  function closePicker() { $('picker-modal').classList.add('hidden'); pickerHandler = null; }
  function pickCardList(title, cards, cb) { openCardPicker(title, cards, cb); }   // 魔术师等：从指定牌堆选

  function choose(title, options, cb, cancelable) {                           // 太阳：三选一
    cancelable = cancelable !== false;
    $('choice-title').textContent = title;
    $('choice-options').innerHTML = options.map((o, i) =>
      `<button class="big-btn" data-ci="${i}" ${o.enabled === false ? 'disabled' : ''}>${o.label}</button>`).join('');
    $('choice-close').style.display = cancelable ? '' : 'none';
    chooseState = { options, cb, cancelable };
    $('choice-modal').classList.remove('hidden');
  }
  function closeChoice() { $('choice-modal').classList.add('hidden'); chooseState = null; }

  // ---------- 宝石工作台（免费镶嵌） ----------
  function openBench() { if (!H.getRun()) return; benchSel = null; renderBench(); $('bench-modal').classList.remove('hidden'); }
  function closeBench() { $('bench-modal').classList.add('hidden'); benchSel = null; }
  function renderBench() {
    const run = H.getRun();
    const gems = run.gems;
    const gemHtml = gems.length
      ? gems.map(g => CG.UI.gemFace(g, { clickable: true, selected: g.uid === benchSel, data: { bgem: g.uid } })).join('')
      : '<p class="empty-note">背包里没有宝石。打怪、逛商店或事件可获得。</p>';
    const armed = benchSel != null;
    const deckHtml = run.deck.map(c => {
      const free = CG.cardEmptySockets(c) > 0;
      const can = armed && free;
      return CG.UI.cardFace(c, { clickable: can, dim: armed && !free, data: { bcard: c.uid } });
    }).join('');
    $('bench-body').innerHTML = `
      <div class="bench-hint">${armed ? '已选中一颗宝石 → 点下方有空孔(◇)的卡安装它。' : '点一颗背包宝石选中它，再点要镶嵌的卡。安装免费；卸下需到商店花钱。'}</div>
      <div class="bench-sub">宝石背包（${gems.length}）</div>
      <div class="bench-gems">${gemHtml}</div>
      <div class="bench-sub">你的卡牌（◇ = 空孔）</div>
      <div class="bench-cards">${deckHtml}</div>`;
  }
  function onBenchClick(ev) {
    const g = ev.target.closest('.gem[data-bgem]');
    if (g) { benchSel = benchSel === +g.dataset.bgem ? null : +g.dataset.bgem; CG.Audio.play('select'); return renderBench(); }
    const c = ev.target.closest('.card[data-bcard]');
    if (c && benchSel != null && c.classList.contains('clickable')) {
      CG.Audio.play('upgrade');
      H.onInstallGem(benchSel, +c.dataset.bcard);    // run 内部 _emit → 顶栏/地图刷新
      benchSel = null;
      renderBench();                                  // 刷新工作台自身
    }
  }

  // ---------- 牌库查看（顶栏） ----------
  function openDeckView() {
    const run = H.getRun();
    const sorted = [...run.deck].sort((a, b) =>
      a.base === b.base
        ? ((b.sockets || []).length - (a.sockets || []).length || CG.cardStats(b).limit - CG.cardStats(a).limit)
        : (a.base < b.base ? -1 : 1));
    $('pile-title').textContent = `牌库（${run.deck.length} 张）`;
    $('pile-cards').innerHTML = sorted.map(c => CG.UI.cardFace(c)).join('');
    $('pile-modal').classList.remove('hidden');
  }

  CG.Screens = { init, showScreen, updateHeader, showMap, showReward, showShop, showEvent, showGameOver, pickCardList, choose, openCodex, showMenu, zoomMapToRoom, playBattleEntrance };
})(window.CG);

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
  let packOpened = false;     // 奖励界面：当前 booster pack 是否已拆开（纯 UI 翻面，不进 run 状态）
  let lastRewardPending = null;

  // 以撒式房间类型 → 图标 / 名称（普通房不剧透是否有敌人；清空后统一显示 ✓）
  const ICON  = { start: '🚩', normal: '', combat: '⚔️', elite: '👹', boss: '👑', shop: '🛒', treasure: '🎁', curse: '🩸', altar: '🔮' };
  const LABEL = { start: '起点', normal: '房间', elite: '小boss房', boss: '首领房', shop: '商店', treasure: '宝藏房', curse: '诅咒房', altar: '祭坛' };
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
  const CODEX_TABS = ['affix', 'pack', 'tarot', 'relic', 'enemy'];
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
    } else if (tab === 'pack') {
      const names = ids => (ids || []).map(a => `<span style="color:${CG.AFFIXES[a].color}">${CG.AFFIXES[a].name}</span>`).join('、');
      const active = (H.getRun && H.getRun() && H.getRun().packs) || null;
      html = '<p class="codex-note">战斗胜利后开到一个「booster pack」，包内宝石的词条<b>只来自该包主题</b>；商店 / 祭坛等其它产出的宝石也按包生成。' +
        '一颗宝石仍是「小增益」或「强增益+减益」，只是取材被限定在包内（基础包做通用兜底，与各主题包有意重叠）。</p>' +
        (active ? `<p class="codex-note">本局启用：${active.map(id => CG.PACKS[id].icon + CG.PACKS[id].name).join(' / ')}（每局＝基础包 + 随机 3 个增强包，其余本局不出）。</p>` : '') +
        (CG.PACK_IDS || []).map(id => {
          const p = CG.PACKS[id], on = !active || active.includes(id);
          const tag = active ? (on ? ' <span style="color:#6dbb7a">· 本局启用</span>' : ' <span style="color:var(--muted)">· 本局未启用</span>') : '';
          return `<div class="codex-item" style="${on ? '' : 'opacity:.5'}"><span class="codex-name" style="color:${p.color}">${p.icon} ${p.name}${tag}</span>` +
                 `<span class="codex-desc">${p.desc}<br><b>增益：</b>${names(p.buffs)}<br><b>减益：</b>${names(p.debuffs)}</span></div>`;
        }).join('');
      // 元素反应矩阵（元素包专属）
      if (CG.REACTIONS) {
        const el = id => `<span style="color:${CG.ELEMENTS[id].color}">${CG.ELEMENTS[id].icon}${CG.ELEMENTS[id].name}</span>`;
        const rows = Object.keys(CG.REACTIONS).map(key => {
          const [a, b] = key.split('+'), r = CG.REACTIONS[key];
          return `<div class="codex-item"><span class="codex-name">${r.icon} ${r.name}</span>` +
                 `<span class="codex-desc">${el(a)} ＋ ${el(b)} → ${r.desc}</span></div>`;
        }).join('');
        html += '<div class="codex-sub">元素反应（元素包）</div>' +
          '<p class="codex-note">敌人身上至多挂 1 种元素、层数 1~3（不随回合衰减）；再附异元素＝消耗 min(双方层数) 级、反应发生这么多次、余量留存（放大型按消耗层数叠乘）。商店「五选二」可一次拿 2 颗凑连招。</p>' + rows;
      }
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
  const CLEARABLE = { normal: 1, elite: 1, shop: 1, treasure: 1, curse: 1, altar: 1 };   // 清空后显示 ✓ 的内容房
  const SPECIAL = { elite: 1, boss: 1, shop: 1, treasure: 1, curse: 1, altar: 1 };       // 可见即露图标的特殊房
  // 构建地图网格 HTML（含战争迷雾）。mini=true → 非交互的略缩版（div 格子、无图标，只标当前位）。
  // 战争迷雾：只渲染「去过的房间」+「其正交相邻房」+「当前可前往房」，其余画成迷雾(void)。
  function buildMapGrid(run, mini) {
    const g = run.grid;
    const byXY = {};
    g.rooms.forEach(r => (byXY[r.gx + ',' + r.gy] = r));
    const revealed = new Set();
    g.rooms.forEach(r => {
      if (!r.done) return;
      revealed.add(r);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => { const n = byXY[(r.gx + d[0]) + ',' + (r.gy + d[1])]; if (n) revealed.add(n); });
    });
    run.available.forEach(r => revealed.add(r));
    let doors = '';
    g.rooms.forEach(r => [[1, 0], [0, 1]].forEach(d => {
      const n = byXY[(r.gx + d[0]) + ',' + (r.gy + d[1])];
      if (n && revealed.has(r) && revealed.has(n))
        doors += `<line x1="${r.gx + 0.5}" y1="${r.gy + 0.5}" x2="${r.gx + d[0] + 0.5}" y2="${r.gy + d[1] + 0.5}"/>`;
    }));
    let cells = '';
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      const r = byXY[x + ',' + y];
      if (!r || !revealed.has(r)) { cells += `<div class="map-cell void"></div>`; continue; }   // 空地 / 未揭示 = 迷雾
      const avail = run.available.includes(r), cur = r === run.current;
      const cls = ['map-cell', 'room', r.type, r.done ? 'done' : '', (avail && !mini) ? 'available' : '', cur ? 'current' : ''].join(' ').replace(/\s+/g, ' ').trim();
      const hero = cur ? `<span class="map-hero">${CG.Sprites.get('hero_token')}</span>` : '';
      if (mini) { cells += `<div class="${cls}">${hero}</div>`; continue; }     // 略缩图：靠底色 + 当前位
      let glyph = hero;
      if (!cur) {
        if (r.done && CLEARABLE[r.type]) glyph = '✓';
        else if (SPECIAL[r.type]) glyph = ICON[r.type];                          // 特殊房：可见即露图标
        else if (r.type === 'normal') glyph = (r.combat && r.reveal) ? ICON.combat : '';  // 小怪房一半明示
        else glyph = ICON[r.type] || '';
      }
      const title = r.type === 'curse' ? `${LABEL.curse}（进入耗 ${run._curseCost()} 生命）` : (LABEL[r.type] || '');
      cells += `<button class="${cls}" data-id="${r.id}" title="${title}"><span class="cell-glyph">${glyph}</span></button>`;
    }
    return { doors, cells, cols: g.cols, rows: g.rows };
  }
  const gridSvg = m => `<svg class="map-doors" viewBox="0 0 ${m.cols} ${m.rows}" preserveAspectRatio="none">${m.doors}</svg>${m.cells}`;

  // 滚动地图视口，使「当前所在房间」处于正中（无可滚空间时浏览器自动夹取）。
  function centerMapOnPlayer() {
    const wrap = document.querySelector('.map-wrap'), area = $('map-area');
    const cell = area && area.querySelector('.map-cell.current');
    if (!wrap || !cell) return;
    const cx = area.offsetLeft + cell.offsetLeft + cell.offsetWidth / 2;
    const cy = area.offsetTop + cell.offsetTop + cell.offsetHeight / 2;
    wrap.scrollLeft = cx - wrap.clientWidth / 2;
    wrap.scrollTop = cy - wrap.clientHeight / 2;
  }
  function showMap(run) {
    showScreen('map');
    const sub = $('map-subtitle');
    if (sub) sub.innerHTML = `🗼 第 <b>${run.act}</b> / ${run.maxActs} 层　｜　WASD / 点击移动；🚩起点　⚔️小怪　👹小boss　🎁宝藏　🩸诅咒　🛒商店　🔮祭坛　👑首领`;
    const m = buildMapGrid(run, false);
    const area = $('map-area');
    area.style.setProperty('--cols', m.cols);
    area.style.setProperty('--rows', m.rows);
    area.innerHTML = gridSvg(m);
    centerMapOnPlayer();                          // 把玩家所在房间滚到视口正中（出生 / 每次移动跟随）
    $('map-tarot-bar').innerHTML = CG.UI.tarotBarHTML(run.tarot, "map", true, run.tarotSlots());
  }
  // 战斗界面左上角的略缩地图（非交互，进战斗时渲染一次）
  function renderMinimap(run) {
    const el = $('battle-minimap');
    if (!el) return;
    if (!run || !run.grid) { el.innerHTML = ''; return; }
    const m = buildMapGrid(run, true);
    el.innerHTML = `<div class="map-grid mini" style="--cols:${m.cols};--rows:${m.rows}">${gridSvg(m)}</div>`;
  }

  // ---------- 奖励（宝石＝主题 booster pack 三选一 / 或 空法杖三选一） ----------
  function showReward(run) {
    showScreen('reward');
    const pend = run.pending;
    if (lastRewardPending !== pend) { packOpened = false; lastRewardPending = pend; }   // 新一轮奖励：包重新封口
    CG.Audio.play('coin');

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

    let body;
    if (pend.kind === 'gem') {
      const pk = CG.PACKS && CG.PACKS[pend.pack];
      const color = pk ? pk.color : '#cdd2e2';
      if (!packOpened) {                                  // 先展示未拆封的包，点击撕开
        body = `<p>战斗掉落了一个 booster pack：</p>
          <div class="booster" style="--pk:${color}" data-act="open-pack" title="点击撕开">
            <div class="booster-icon">${pk ? pk.icon : '📦'}</div>
            <div class="booster-name">${pk ? pk.name : '宝石包'}</div>
            <div class="booster-sub">${pk ? pk.desc : ''}</div>
            <div class="booster-hint">✦ 点击撕开 ✦</div>
          </div>
          <button class="big-btn" data-act="skip">跳过</button>`;
      } else {                                            // 拆开后：主题三选一
        const picks = pend.gems.map((g, i) => CG.UI.gemFace(g, { clickable: true, data: { ridx: i } })).join('');
        body = `<p class="pack-open" style="--pk:${color}">${pk ? pk.icon + ' ' + pk.name : '宝石包'} · 三选一放入背包（之后在 💎 工作台镶嵌）</p>
          ${pk ? `<p class="altar-desc">${pk.desc}</p>` : ''}
          <div class="reward-cards">${picks}</div>
          <button class="big-btn" data-act="skip">跳过</button>`;
      }
    } else {
      const picks = pend.cards.map((spec, i) => CG.UI.cardFace(spec, { clickable: true, data: { ridx: i } })).join('');
      body = `<p>选择一把法杖加入牌组（空孔可日后镶嵌宝石；或跳过）：</p>
        <div class="reward-cards">${picks}</div>
        <button class="big-btn" data-act="skip">跳过</button>`;
    }

    $('screen-reward').innerHTML = `
      <div class="panel">
        <h2>战斗胜利</h2>
        <p class="reward-gold">获得金币 💰 ${pend.gold}</p>
        ${relics}${tarot}
        ${body}
      </div>`;
  }
  function onRewardClick(ev) {
    if (ev.target.closest('[data-act="open-pack"]')) { CG.Audio.play('upgrade'); packOpened = true; return showReward(H.getRun()); }
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
        ${CG.UI.gemFace(it.gem, { dim: it.bought || run.gold < it.price, tagLabel: (CG.PACKS[it.pack] && CG.PACKS[it.pack].icon + ' ' + CG.PACKS[it.pack].name) || '' })}
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
    const packItems = (run.pending.packs || []).map((it, i) => {
      const pk = CG.PACKS[it.pack], pick = it.pick || 1, got = (it.takenUids || []).length;
      const dis = it.taken || (!it.bought && run.gold < it.price);
      const btn = it.taken ? '✓ 已取' : (it.bought ? `开启选择（${got}/${pick}）` : '💰 ' + it.price);
      return `<div class="shop-item shop-tarot" title="${pk ? pk.desc : ''}">
        <div class="shop-tarot-face booster-tile" style="--pk:${pk ? pk.color : '#cdd2e2'}">
          <span class="shop-tarot-icon">${pk ? pk.icon : '📦'}</span><b>${pk ? pk.name : '宝石包'}</b>
          <small>${it.count} 选 ${pick} · 词条限定本主题</small>
        </div>
        <button class="buy-btn" data-buypack="${i}" ${dis ? 'disabled' : ''}>${btn}</button>
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
        <div class="shop-section-title">宝石包（booster pack · 开包挑 1 颗）</div>
        <div class="shop-cards">${packItems || '<span class="empty-note">（售罄）</span>'}</div>
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
    const bp = ev.target.closest('[data-buypack]');
    if (bp && !bp.disabled) {
      const i = +bp.dataset.buypack, it = run.pending.packs[i];
      if (!it.bought) { CG.Audio.play('coin'); H.onBuyPack(i); }   // 首次：扣钱滚出 N 颗
      return openPackPicker(i);                                    // 立即开启挑选（已购买则重开）
    }
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
  // 开启已购买的 booster pack：从滚出的宝石里挑（可挑 pick 颗，挑一颗后若还有名额自动续开）
  function openPackPicker(i) {
    const run = H.getRun(), it = run.pending.packs && run.pending.packs[i];
    if (!it || !it.rolled || it.taken) return;
    const pk = CG.PACKS[it.pack], pick = it.pick || 1, taken = it.takenUids || [];
    const avail = it.rolled.filter(g => !taken.includes(g.uid));
    const remain = pick - taken.length;
    openGemPicker(`${pk ? pk.icon + ' ' + pk.name : '宝石包'} · ${it.count} 选 ${pick}（还可取 ${remain}）`,
      avail.map(g => ({ gem: g, uid: g.uid })), uid => {
        H.onTakePackGem(i, uid);
        const it2 = (H.getRun().pending || {}).packs && H.getRun().pending.packs[i];
        if (it2 && !it2.taken) openPackPicker(i);     // 还有名额 → 续开挑下一颗
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
  // 诅咒房战利品：2 个随机「商店货色」（宝石 / 法杖 / 塔罗 / 遗物 / 兜底金币）
  function curseOffersHTML(offers) {
    return '<div class="reward-cards">' + (offers || []).map(o => {
      if (o.type === 'gem') { const pk = CG.PACKS[o.pack]; return CG.UI.gemFace(o.gem, { tagLabel: pk ? pk.icon + ' ' + pk.name : '' }); }
      if (o.type === 'card') return CG.UI.cardFace(o.card);
      if (o.type === 'tarot') { const t = CG.TAROT[o.id]; return `<div class="shop-tarot-face" title="${t.desc}"><span class="shop-tarot-icon">${t.icon}</span><b>${t.name}</b><small>${t.desc}</small></div>`; }
      if (o.type === 'relic') { const r = CG.RELICS[o.id]; return `<div class="shop-tarot-face relic-card" title="${r.desc}"><span class="shop-tarot-icon">${r.icon}</span><b>${r.name}</b><small>${r.desc}</small></div>`; }
      return `<div class="shop-tarot-face"><span class="shop-tarot-icon">💰</span><b>${o.gold} 金币</b></div>`;
    }).join('') + '</div>';
  }
  function showEvent(run) {
    showScreen('event');
    const p = run.pending;
    if (p.kind === 'treasure' || p.kind === 'curse') {
      const curse = p.kind === 'curse';
      const loot = curse ? curseOffersHTML(p.offers) : relicLootHTML(p);
      const desc = curse ? `你以 ${p.hpPaid} 点生命为代价撬开诅咒之门，换来两样商店货色——` : '房间中央的基座上摆着——';
      $('screen-event').innerHTML = `
        <div class="panel center">
          <h2>${curse ? '🩸 诅咒房' : '🎁 宝藏房'}</h2>
          <p class="altar-desc">${desc}</p>
          ${loot}
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

  CG.Screens = { init, showScreen, updateHeader, showMap, showReward, showShop, showEvent, showGameOver, pickCardList, choose, openCodex, showMenu, zoomMapToRoom, playBattleEntrance, renderMinimap };
})(window.CG);

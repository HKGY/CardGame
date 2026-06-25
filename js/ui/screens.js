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
  let prevHeroRoom = null;    // 上次渲染地图时玩家所在房间 id（用于移动滑动动画；离开地图屏时清空）
  let pendingMapRise = false; // 从开始菜单进入：让随后出现的地图自下而上滑入（衔接「画面上移」）
  let packOpened = false;     // 奖励界面：当前 booster pack 是否已拆开（纯 UI 翻面，不进 run 状态）
  let lastRewardPending = null;
  let debugPacks = new Set(); // 开始菜单：本局选定的主题（默认＝基础 + 3 随机，可自选；全部融合成一个融合包）
  let menuPacksInit = false;  // 首次渲染菜单时把默认主题填进去
  let selectedClass = 'warrior';   // 开始菜单·选定职业（决定初始牌组 + 主题包组合）
  let selectedM = null;       // 开始菜单·敌人难度倍率（首次渲染时取 config 默认 0.7）
  let debugGem = [];          // 调试菜单·自定义宝石：构建中的词条 [{id, level}]
  let debugCost = 'energy', debugValue = 'damage', debugLevel = 1;   // 自选组合：当前选中的 代价/价值/等级原子

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

    // 开始菜单（含调试卡包选择）
    $('menu-start').addEventListener('click', startGame);
    $('menu-codex').addEventListener('click', () => openCodex());
    $('menu-debug').addEventListener('click', onMenuDebugClick);

    // 调试菜单（自定义宝石 → 背包）
    $('debug-btn').addEventListener('click', openDebug);
    $('debug-close').addEventListener('click', closeDebug);
    $('debug-modal').addEventListener('click', e => { if (e.target.id === 'debug-modal') closeDebug(); });
    $('debug-body').addEventListener('click', onDebugClick);
  }

  // ---------- 开始菜单·调试：手动开关本局卡包 ----------
  function getSelectedPacks() { return (CG.PACK_IDS || []).filter(id => debugPacks.has(id)); }
  function diffDefault() { return (CG.CONFIG.difficulty && CG.CONFIG.difficulty.default) || 0.7; }
  function getSelectedM() { if (selectedM == null) selectedM = diffDefault(); return selectedM; }
  function syncMenuStart() { const b = $('menu-start'); if (b) b.disabled = debugPacks.size === 0; }
  function renderMenuDebug() {
    const box = $('menu-debug');
    if (!box) return;
    if (!menuPacksInit) { debugPacks = new Set(CG.classPacks(selectedClass)); menuPacksInit = true; }   // 默认：选定职业(战士)的包组合
    const classBtns = Object.keys(CG.CLASSES).map(id => {
      const c = CG.CLASSES[id];
      return `<button class="class-opt ${id === selectedClass ? 'on' : ''}" data-class="${id}" title="${c.desc}">${c.icon} ${c.name}</button>`;
    }).join('');
    const toggles = (CG.PACK_IDS || []).filter(id => id !== 'fusion').map(id => {
      const p = CG.PACKS[id];
      return `<button class="pack-toggle ${debugPacks.has(id) ? 'on' : ''}" data-pack="${id}" style="--pk:${p.color}" title="${p.desc}">${p.icon} ${p.name}</button>`;
    }).join('');
    const names = getSelectedPacks().map(id => CG.PACKS[id].name);
    const m = getSelectedM();
    const diffBtns = ((CG.CONFIG.difficulty && CG.CONFIG.difficulty.options) || [1])
      .map(v => `<button class="diff-opt ${v === m ? 'on' : ''}" data-diff="${v}">${(+v).toFixed(1)}</button>`).join('');
    box.innerHTML =
      `<div class="menu-debug-head">🎓 选择<b>职业</b>（决定初始牌组 + 本局主题包组合；可在下方微调主题）</div>
       <div class="menu-class-opts">${classBtns}</div>
       <div class="menu-debug-head">⚔️ <b>敌人强度</b> M（敌人血量/伤害/力量等 ×M，越低越易；默认 0.7）</div>
       <div class="menu-diff-opts">${diffBtns}</div>
       <div class="menu-debug-head">🎴 选择本局<b>主题</b>（选定的主题会融合成一个「融合包」，本局所有扩充包都从中混合产出）</div>
       <div class="menu-debug-packs">${toggles}</div>
       <div class="menu-debug-sub">已选 ${debugPacks.size} 个 → 🌀 融合包${names.length ? '：' + names.join(' · ') : '（至少选 1 个）'}</div>
       <div class="menu-debug-tools">
         <button data-dbg="all">全选</button>
         <button data-dbg="none">清空</button>
         <button data-dbg="random">🎲 基础 + 随机 3</button>
       </div>`;
    syncMenuStart();
  }
  function onMenuDebugClick(ev) {
    const ct = ev.target.closest('[data-class]');
    if (ct) { selectedClass = ct.dataset.class; debugPacks = new Set(CG.classPacks(selectedClass)); CG.Audio.play('select'); return renderMenuDebug(); }   // 选职业 → 填入其包组合
    const dt = ev.target.closest('[data-diff]');
    if (dt) { selectedM = +dt.dataset.diff; CG.Audio.play('select'); return renderMenuDebug(); }
    const t = ev.target.closest('[data-pack]');
    if (t) {
      const id = t.dataset.pack;
      if (debugPacks.has(id)) debugPacks.delete(id); else debugPacks.add(id);
      CG.Audio.play('select');
      return renderMenuDebug();
    }
    const tool = ev.target.closest('[data-dbg]');
    if (!tool) return;
    const a = tool.dataset.dbg;
    if (a === 'all') debugPacks = new Set(CG.PACK_IDS);
    else if (a === 'none') debugPacks = new Set();
    else if (a === 'random') debugPacks = new Set(CG.rollRunPacks());
    CG.Audio.play('select');
    renderMenuDebug();
  }

  // ---------- 调试菜单：构建一颗任意词条的宝石并加入背包 ----------
  function openDebug() { if (!H.getRun()) return; renderDebug(); $('debug-modal').classList.remove('hidden'); }
  function closeDebug() { $('debug-modal').classList.add('hidden'); }
  function renderDebug() {
    const run = H.getRun();
    if (!run) return;
    const preview = { affixes: debugGem };
    const composedId = (debugCost && debugValue) ? debugCost + '_' + debugValue : null;
    const composed = composedId && CG.AFFIXES[composedId];
    const availLv = composed ? CG.affixLevels(composedId) : [1, 2, 3];   // 该「代价×价值」实际存在的等级
    const effLv = composed ? CG.clampAffixLevel(composedId, debugLevel) : debugLevel;
    const atomBtn = (attr, id, name, on, dim) =>
      `<button class="dbg-atom ${on ? 'on' : ''}" ${attr}="${id}"${dim ? ' style="opacity:.35"' : ''}>${name}</button>`;
    const realCosts = Object.keys(CG.COST_REAL).map(id => atomBtn('data-dcost', id, CG.COST_REAL[id].name, debugCost === id)).join('');
    const condCosts = Object.keys(CG.COST_COND).map(id => atomBtn('data-dcost', id, CG.COST_COND[id].name, debugCost === id)).join('');
    // 价值原子：与当前代价组不成有效分子的 → 变暗提示（条件代价只配「数值/状态」类价值）
    const valBtns = Object.keys(CG.VALUE_ATOMS).map(id =>
      atomBtn('data-dvalue', id, CG.VALUE_ATOMS[id].name, debugValue === id, !CG.AFFIXES[debugCost + '_' + id])).join('');
    const lvlBtns = [1, 2, 3].map(n => `<button class="dbg-lvl ${effLv === n ? 'on' : ''}" data-dlevel="${n}"${availLv.includes(n) ? '' : ' disabled style="opacity:.35"'}>${n}</button>`).join('');
    const composedText = composed
      ? `<b style="color:${composed.color}">${CG.affixCostText(composedId, effLv)} → ${CG.affixValueText(composedId, effLv)}</b>`
      : (debugCost && debugValue ? '<span class="muted">该「代价 × 价值」不成词条（条件代价只配数值/状态类价值，不配 元素/召唤/建筑/产出/翻倍 等）</span>' : '<span class="muted">选一个代价 + 一个价值</span>');
    const full = debugGem.length >= 3;
    const chosen = debugGem.length
      ? debugGem.map(g => `<button class="dbg-chosen" data-rmaffix="${g.id}" title="点击移除" style="border-color:${CG.AFFIXES[g.id].color}">${CG.affixValueText(g.id, g.level)} <small>${CG.affixCostText(g.id, g.level)}·L${g.level}</small> ✕</button>`).join('')
      : '<span class="muted">（空——下面自选「代价×价值」添加词条）</span>';
    $('debug-body').innerHTML =
      `<div class="debug-build">
         <div class="debug-preview">${CG.UI.gemFace(preview)}</div>
         <div class="debug-build-side">
           <div class="bench-hint">自选「代价 × 价值 × 等级」组成词条，<b>＋添加</b>进这颗宝石（最多 3 条）。背包现有 💎 ${run.gems.length}，加入后可在顶栏工作台镶嵌。</div>
           <div class="debug-chosen-row">${chosen}</div>
           <div class="debug-actions">
             <button class="big-btn" data-debugact="add" ${debugGem.length ? '' : 'disabled'}>加入背包</button>
             <button class="big-btn leave" data-debugact="clear" ${debugGem.length ? '' : 'disabled'}>清空</button>
           </div>
         </div>
       </div>
       <div class="debug-compose">
         <div class="dbg-row"><span class="dbg-label">代价 · 真资源</span><div class="dbg-atoms">${realCosts}</div></div>
         <div class="dbg-row"><span class="dbg-label">代价 · 条件</span><div class="dbg-atoms">${condCosts}</div></div>
         <div class="dbg-row"><span class="dbg-label">价值</span><div class="dbg-atoms">${valBtns}</div></div>
         <div class="dbg-row"><span class="dbg-label">等级</span><div class="dbg-atoms">${lvlBtns}</div>
           <button class="big-btn dbg-addaffix" data-debugact="addaffix" ${composed && !full ? '' : 'disabled'}>＋ 添加这条词条</button></div>
         <div class="dbg-compose-preview">${full ? '<span class="muted">已满 3 条；先移除一条或加入背包</span>' : composedText}</div>
       </div>`;
  }
  function onDebugClick(ev) {
    const pick = (sel, fn) => { const el = ev.target.closest(sel); if (el) { fn(el); CG.Audio.play('select'); renderDebug(); return true; } return false; };
    if (pick('[data-dcost]', el => { debugCost = el.dataset.dcost; })) return;
    if (pick('[data-dvalue]', el => { debugValue = el.dataset.dvalue; })) return;
    if (pick('[data-dlevel]', el => { debugLevel = +el.dataset.dlevel; })) return;
    if (pick('[data-rmaffix]', el => { debugGem = debugGem.filter(x => x.id !== el.dataset.rmaffix); })) return;
    const act = ev.target.closest('[data-debugact]');
    if (!act || act.disabled) return;
    const a = act.dataset.debugact;
    if (a === 'addaffix') {
      const id = debugCost + '_' + debugValue;
      if (CG.AFFIXES[id] && debugGem.length < 3) {
        const lv = CG.clampAffixLevel(id, debugLevel);   // 夹到该词条实际存在的等级
        const ex = debugGem.find(x => x.id === id);
        if (ex) ex.level = lv; else debugGem.push({ id, level: lv });   // 同词条更新等级、否则新增
        CG.Audio.play('select');
      }
      return renderDebug();
    }
    if (a === 'add') { if (H.onDebugAddGem(debugGem)) { CG.Audio.play('upgrade'); debugGem = []; renderDebug(); } }
    else if (a === 'clear') { debugGem = []; CG.Audio.play('select'); renderDebug(); }
  }

  function showMenu() { $('run-header').classList.add('hidden'); $('screen-menu').classList.remove('menu-exit'); CG.Background.setScene('menu'); renderMenuDebug(); showScreen('menu'); }
  // 点「开始攀登」：菜单整体上滑淡出 → 在其后出现的地图自下而上滑入，衔接成「画面向上移动到地图」。
  function startGame() {
    const packs = getSelectedPacks();
    const m = getSelectedM();
    if (REDUCE) { H.onStart(packs, m, selectedClass); return; }
    const menu = $('screen-menu');
    menu.classList.add('menu-exit');
    pendingMapRise = true;
    setTimeout(() => { menu.classList.remove('menu-exit'); H.onStart(packs, m, selectedClass); }, 380);
  }

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
      // v3：词条＝随机组合的 (代价→价值) 分子。这里按「原子种类」分组列出，并写明大规则与对偶关系。
      const V = CG.VALUES || {}, AT = CG.VALUE_ATOMS || {}, A = CG.AFFIXES || {};
      const amt = res => Math.max(1, Math.floor(6 / (V[res] || 6) + 1e-6));   // 某资源「1 能量等值」数量（同生成器）
      const colorOf = atom => (A['energy_' + atom] || {}).color || '#9aa6c2';
      const chip = (label, color) => `<span class="atom" style="--c:${color || '#39405a'}">${label}</span>`;
      const row = chips => `<div class="atom-row">${chips.join('')}</div>`;
      const sub = t => `<div class="codex-sub">${t}</div>`;

      // —— 代价分组 —— //
      const realChip = id => { const c = CG.COST_REAL[id]; return c ? chip(c.fmt(amt(id)), '#c98a8a') : ''; };
      const condIds = Object.keys(CG.COST_COND || {});
      const gateIds = condIds.filter(id => CG.COST_COND[id].gate);
      const magIds = condIds.filter(id => !CG.COST_COND[id].gate);
      const condChip = id => chip(CG.COST_COND[id].name, '#7a86b0');

      // —— 价值分组：每个基值有 本回合/下回合/每回合 三版本（独立命名），按时点成行；另列无时点价值 —— //
      const valChip = atom => { const va = AT[atom]; if (!va) return ''; const m = A['energy_' + atom]; const n = (m && m.value && m.value.amt != null) ? m.value.amt : amt(va.vpRes); return chip(`${va.name} ${n}`, colorOf(atom)); };   // 用实际烘焙 LV1 量（已按 maxCount 夹）
      const TB = CG.TURN_BASES || {};
      const bases = Object.keys(TB);
      const timingRow = t => row(bases.map(b => valChip(TB[b].ids[t])).filter(Boolean));
      const nonTurn = Object.keys(AT).filter(id => !AT[id].turnBase && !['mult', 'lifesteal', 'combo'].includes(id));   // 无时点：治疗/元素/召唤/建筑/造牌
      // 放大本牌的特殊价值（作用于本牌其它价值）：翻倍/吸血→放大包，连击→强攻包
      const sig = [['翻倍 ×2（12VP）→放大包', '#ff9fc0'], ['吸血 50%/100%（→放大包）', '#cf4f6a'], ['连击 +1 命中（6VP）→强攻包', '#e89030']];

      const rules = `<div class="codex-rules"><b>大规则</b>（词条＝付出「代价」换「价值」，按 1 能量 = 6 价值点计）：
        <li>· <b>价值 ≤ 代价</b>：每笔交易不亏本；强度来自把"富余/会浪费的"换成"急需的"。</li>
        <li>· <b>首石免代价</b>：一张牌第一颗宝石只取价值；同种代价<b>均摊</b>（多颗只付最高）。</li>
        <li>· 等级 <b>1换1 / 2换2 / 3换2</b>（3 级 = 同价值、半代价的高效"稀有"档）。</li>
        <li>· <b>时点修饰器</b>：每个数值都有 <b>本回合 / 下回合 / 每回合</b> 三版本（各有独特名字）；VP <b>本回合=基准、下回合=半价、每回合=两倍</b>（每回合 2 回合回本、下回合延迟故便宜）。</li>
        <li>· <b>条件即代价</b>：条件资源也有 VP，价值 = 该条件当前量 × 条件VP/价值VP × 等级（门型：达成给定额）。</li></div>`;

      html = rules +
        sub('代价 · 真资源（随等级 ×L）') + row(['energy', 'hp', 'gold', 'discard'].map(realChip).filter(Boolean)) +
        sub('代价 · 自我牺牲（自残/扣属性，可被回收）') + row(['selfVuln', 'selfWeak', 'selfFrail', 'loseStr', 'loseDex'].map(realChip).filter(Boolean)) +
        sub('代价 · 条件 量型（价值 = 当前量 × 条件VP/价值VP × 等级）') + row(magIds.map(condChip)) +
        sub('代价 · 条件 门型（达成则给定额）') + row(gateIds.map(condChip)) +
        sub('价值 · 本回合（打出即时结算）') + timingRow('now') +
        sub('价值 · 下回合（下个回合开始结算一次）') + timingRow('next') +
        sub('价值 · 每回合（每个回合开始重复结算）') + timingRow('every') +
        sub('价值 · 无时点（治疗 / 元素 / 召唤 / 建筑 / 造牌）') + row(nonTurn.map(valChip).filter(Boolean)) +
        sub('放大本牌（翻倍/吸血→放大包、连击→强攻包；作用于本牌其它价值）') + row(sig.map(([l, c]) => chip(l, c)));
    } else if (tab === 'pack') {
      const names = vals => (vals || []).map(v => { const va = (CG.VALUE_ATOMS || {})[v] || {}; return `<span class="cx-aff">${va.name || v}</span>`; }).join('、');
      const active = (H.getRun && H.getRun() && H.getRun().packs) || null;
      const card = id => {
        const p = CG.PACKS[id], on = !active || active.includes(id);
        return `<div class="codex-pack${on ? '' : ' off'}">` +
          `<div class="codex-pack-head" style="color:${p.color}">${p.icon} ${p.name}${active && on ? ' <span class="cx-on">本局</span>' : ''}</div>` +
          `<div class="codex-desc">${p.desc}</div>` +
          `<div class="cx-affs"><b>价值</b> ${names(p.values)}</div></div>`;
      };
      html = '<p class="codex-note">每个词条属于一个<b>主题</b>；开局选定的主题<b>融合成一个「🌀 融合包」</b>，本局产出的宝石都从其混合池里抽。' +
        (active ? `当前融合 ${active.length} 个：${active.map(id => CG.PACKS[id].icon + CG.PACKS[id].name).join(' ')}` : '') + '</p>' +
        '<div class="codex-grid wide">' + (CG.PACK_IDS || []).filter(id => id !== 'fusion').map(card).join('') + '</div>';
      if (CG.REACTIONS) {
        const el = id => `<span style="color:${CG.ELEMENTS[id].color}">${CG.ELEMENTS[id].icon}${CG.ELEMENTS[id].name}</span>`;
        const rows = Object.keys(CG.REACTIONS).map(key => {
          const [a, b] = key.split('+'), r = CG.REACTIONS[key];
          return `<div class="codex-item"><span class="codex-name">${r.icon} ${r.name}</span><span class="codex-desc">${el(a)}＋${el(b)} → ${r.desc}</span></div>`;
        }).join('');
        html += '<div class="codex-grid"><div class="codex-sub">元素反应（⚗️ 元素·敌至多 1 种 1 层）</div><p class="codex-note" style="column-span:all">给敌人附元素：遇<b>不同</b>元素→触发反应（放大型令本牌伤害×2、转化型触发一次），遇<b>同/无</b>元素→取代为该元素 1 层；一颗宝石附<b>两层</b>(2、3级)＝先反应、再附 1 层新的。</p>' + rows + '</div>';
      }
    } else if (tab === 'tarot') {
      const byPack = (a, b) => (CG.TAROT[a].pack || '').localeCompare(CG.TAROT[b].pack || '');
      html = '<div class="codex-grid">' + CG.TAROT_IDS.slice().sort(byPack).map(id => {
        const t = CG.TAROT[id];
        return `<div class="codex-item"><span class="codex-name">${t.icon} ${t.name}</span>` +
               `<span class="codex-tag">${CG.packLabel ? CG.packLabel(t.pack) : (WHERE_LABEL[t.where] || '')}</span><span class="codex-desc">${t.desc}</span></div>`;
      }).join('') + '</div>';
    } else if (tab === 'relic') {
      const byPack = (a, b) => (CG.RELICS[a].pack || '').localeCompare(CG.RELICS[b].pack || '');
      html = '<div class="codex-grid">' + CG.RELIC_IDS.slice().sort(byPack).map(id => {
        const r = CG.RELICS[id];
        return `<div class="codex-item"><span class="codex-name">${r.icon} ${r.name}</span>` +
               `<span class="codex-tag">${CG.packLabel ? CG.packLabel(r.pack) : ''}</span><span class="codex-desc">${r.desc}</span></div>`;
      }).join('') + '</div>';
    } else {
      const entry = (sprite, name, tag, hp, body) =>
        `<div class="codex-enemy"><div class="codex-portrait">${CG.Sprites.get(sprite)}</div>` +
        `<div class="codex-enemy-info"><div class="codex-enemy-head"><b>${name}</b>` +
        `<span class="codex-tag">${tag}</span><span class="codex-hp">❤ ${hp}</span></div>${body}</div></div>`;
      const startHp = (CG.CONFIG && CG.CONFIG.startHp) || 75;
      const hero = entry('knight', '第一女骑士（你）', '主角', startHp, `<div class="codex-move">初始牌组：5 打击 + 5 防御（各预镶一颗小宝石）。</div>`);
      html = '<div class="codex-grid wide">' + hero + Object.keys(CG.ENEMIES).map(id => {
        const e = CG.ENEMIES[id];
        const moves = e.moves.map(m => `<div class="codex-move">${m.name}：${moveSummary(m)}</div>`).join('');
        return entry(e.sprite || 'blob', e.name, TIER_LABEL[enemyTier(id)], e.maxHp, moves);
      }).join('') + '</div>';
    }
    $('codex-body').innerHTML = html;
  }

  function showScreen(id) { if (id !== 'map') prevHeroRoom = null; SCREENS.forEach(s => $('screen-' + s).classList.toggle('active', s === id)); }

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
  // 计算让整张地图在视口内「完整可见、不出滚动条」的格子尺寸：按可用宽/高 ÷ 列/行 取较小者，封顶 92、保底 16。
  function fitMapCell(cols, rows) {
    const wrap = document.querySelector('.map-wrap');
    if (!wrap || !cols || !rows) return null;
    const gap = 5;
    const availW = wrap.clientWidth - 12;
    const availH = wrap.clientHeight - 20;            // 预留 .map-grid 的上下 margin
    if (availW <= 0 || availH <= 0) return null;
    const byW = (availW - gap * (cols - 1)) / cols;
    const byH = (availH - gap * (rows - 1)) / rows;
    return Math.max(16, Math.min(92, Math.floor(Math.min(byW, byH))));
  }
  // 玩家在相邻房间间直接移动（map→map）时，hero token 从旧房间滑到新房间。
  function animateHeroMove(run, area) {
    const curId = run.current && run.current.id;
    if (prevHeroRoom != null && prevHeroRoom !== curId && !REDUCE) {
      const hero = area.querySelector('.map-cell.current .map-hero');
      const prevCell = area.querySelector('.map-cell[data-id="' + prevHeroRoom + '"]');
      const curCell = area.querySelector('.map-cell.current');
      if (hero && prevCell && curCell && hero.animate) {
        const pr = prevCell.getBoundingClientRect(), cr = curCell.getBoundingClientRect();
        const dx = pr.left - cr.left, dy = pr.top - cr.top;
        if (dx || dy) hero.animate(
          [{ transform: `translate(${dx}px, ${dy}px)`, offset: 0 },
           { transform: 'translate(0, 0)', offset: 1 }],
          { duration: 240, easing: 'cubic-bezier(.34,.62,.3,1)' });
      }
    }
    prevHeroRoom = curId;
  }
  // 从房间返回地图：镜头从所在房间格「拉远」到整图（zoom out，与进入房间的拉近相反）。
  function playMapZoomOut(run, area) {
    const cell = (run.current && area) ? area.querySelector('.map-cell[data-id="' + run.current.id + '"]') : null;
    if (!area || !cell || !area.animate) return;
    const ar = area.getBoundingClientRect(), cr = cell.getBoundingClientRect();
    const ox = ar.width ? ((cr.left + cr.width / 2 - ar.left) / ar.width) * 100 : 50;
    const oy = ar.height ? ((cr.top + cr.height / 2 - ar.top) / ar.height) * 100 : 50;
    area.style.transformOrigin = `${ox}% ${oy}%`;
    const anim = area.animate(
      [{ transform: 'scale(3.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 430, easing: 'cubic-bezier(.5,.05,.5,1)', fill: 'backwards' });
    anim.onfinish = anim.oncancel = () => { area.style.transformOrigin = ''; };
  }
  function showMap(run, zoomOut) {
    showScreen('map');
    const sub = $('map-subtitle');
    if (sub) sub.innerHTML = `🗼 第 <b>${run.act}</b> / ${run.maxActs} 层　｜　WASD / 点击移动；🚩起点　⚔️小怪　👹小boss　🎁宝藏　🩸诅咒　🛒商店　🔮祭坛　👑首领`;
    const m = buildMapGrid(run, false);
    const area = $('map-area');
    area.style.setProperty('--cols', m.cols);
    area.style.setProperty('--rows', m.rows);
    const cell = fitMapCell(m.cols, m.rows);        // 自适应缩放：整张地图完整可见、不出滚动条
    if (cell) area.style.setProperty('--cell', cell + 'px'); else area.style.removeProperty('--cell');
    area.innerHTML = gridSvg(m);
    centerMapOnPlayer();                          // 自适应后通常无需滚动（兜底：保底格子仍超框时把玩家滚到正中）
    const curId = run.current && run.current.id;
    if (pendingMapRise) {                          // 从开始菜单进入：地图自下而上滑入
      pendingMapRise = false;
      const sm = $('screen-map');
      sm.classList.remove('map-rise'); void sm.offsetWidth; sm.classList.add('map-rise');
      setTimeout(() => sm.classList.remove('map-rise'), 600);
      prevHeroRoom = curId;
    } else if (zoomOut && !REDUCE) {               // 从房间返回地图：镜头拉远
      playMapZoomOut(run, area);
      prevHeroRoom = curId;
    } else {
      animateHeroMove(run, area);                  // 相邻房间移动：hero 滑动
    }
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
    const freshReward = lastRewardPending !== pend;                                     // 新一轮奖励（区别于开包/重渲染）
    if (freshReward) { packOpened = false; lastRewardPending = pend; }                  // 新一轮奖励：包重新封口
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
        const picks = pend.gems.map((g, i) => { const th = CG.gemTheme && CG.gemTheme(g); return CG.UI.gemFace(g, { clickable: true, data: { ridx: i }, tagLabel: th ? th.icon + ' ' + th.name : '' }); }).join('');
        body = `<p class="pack-open" style="--pk:${color}">${pk ? pk.icon + ' ' + pk.name : '宝石包'} · 三选一放入背包（每颗可能来自不同主题）</p>
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
    if (freshReward && !REDUCE) {                   // 新一轮奖励：面板从下往上淡入（开包/重渲染不重播）
      const sr = $('screen-reward');
      sr.classList.remove('reward-rise'); void sr.offsetWidth; sr.classList.add('reward-rise');
      setTimeout(() => sr.classList.remove('reward-rise'), 650);
    }
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
        ${CG.UI.gemFace(it.gem, { dim: it.bought || run.gold < it.price, tagLabel: (() => { const th = CG.gemTheme && CG.gemTheme(it.gem); return th ? th.icon + ' ' + th.name : ''; })() })}
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
    const rmPrice = run.removePrice(), unPrice = run.uninstallPrice(), skPrice = run.socketPrice(), hlPrice = run.healCost(), pfPrice = run.purifyPrice();
    const hasSocketed = run.allGems().some(x => x.loc === 'card');
    const hasCostGem = run.allGems().some(x => CG.gemHasCost(x.gem));
    const canSocket = run.deck.some(c => (c.limit || 0) < CG.MAX_SOCKETS);
    $('screen-shop').innerHTML = `
      <div class="panel shop-panel">
        <h2>🛒 商店　<span class="reward-gold">💰 ${run.gold}</span>　<span class="shop-bench-hint">背包宝石 💎 ${run.gems.length}（点顶栏「宝石」免费镶嵌）</span></h2>
        <div class="shop-grid">
          <div class="shop-group">
            <div class="shop-section-title">宝石</div>
            <div class="shop-cards">${gemItems || '<span class="empty-note">（售罄）</span>'}</div>
          </div>
          <div class="shop-group">
            <div class="shop-section-title">宝石包（开包挑 1 颗）</div>
            <div class="shop-cards">${packItems || '<span class="empty-note">（售罄）</span>'}</div>
          </div>
          <div class="shop-group">
            <div class="shop-section-title">法杖（空孔卡）</div>
            <div class="shop-cards">${cardItems}</div>
          </div>
          <div class="shop-group">
            <div class="shop-section-title">塔罗 / 遗物</div>
            <div class="shop-cards">${tarotItems}${relicItems || ''}</div>
          </div>
          <div class="shop-group shop-group-svc">
            <div class="shop-section-title">服务</div>
            <div class="shop-services">
              <button class="big-btn" data-act="bench">💎 镶嵌宝石（免费）</button>
              <button class="big-btn" data-act="uninstall" ${(run.gold < unPrice || !hasSocketed) ? 'disabled' : ''}>卸下宝石（💰 ${unPrice}）<br><small>取回背包</small></button>
              <button class="big-btn" data-act="purify" ${(run.gold < pfPrice || !hasCostGem) ? 'disabled' : ''}>🧼 净化宝石（💰 ${pfPrice}）<br><small>去掉它的代价</small></button>
              <button class="big-btn" data-act="socket" ${(run.gold < skPrice || !canSocket) ? 'disabled' : ''}>给卡 +1 孔（💰 ${skPrice}）</button>
              <button class="big-btn" data-act="remove" ${(run.gold < rmPrice || run.deck.length <= 1) ? 'disabled' : ''}>删除一张卡（💰 ${rmPrice}）</button>
              <button class="big-btn" data-act="heal" ${(run.svcUsed('heal') || run.gold < hlPrice || run.hp >= run.maxHp) ? 'disabled' : ''}>${run.svcUsed('heal') ? '已治疗' : `治疗 +${healAmt}（💰 ${hlPrice}）`}</button>
              <button class="big-btn leave" data-act="leave">离开</button>
            </div>
          </div>
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
    else if (a === 'purify') openGemPicker(`净化哪颗宝石？（💰 ${run.purifyPrice()}，去掉它的代价）`, run.allGems().filter(x => CG.gemHasCost(x.gem)), uid => { CG.Audio.play('coin'); H.onBuyPurify(uid); });
    else if (a === 'socket') openCardPicker('选择要 +1 孔的卡（💰 ' + run.socketPrice() + '）', run.deck.filter(c => (c.limit || 0) < CG.MAX_SOCKETS), uid => H.onBuyAddSocket(uid));
    else if (a === 'remove') openCardPicker('选择要删除的卡（💰 ' + run.removePrice() + '）', run.deck, uid => H.onBuyRemove(uid));
    else if (a === 'heal') { CG.Audio.play('heal'); H.onBuyHeal(); }
    else if (a === 'leave') { CG.Audio.play('select'); H.onLeaveShop(); }
  }
  // 卸下宝石：列出所有已镶嵌的宝石，选一颗（花钱 + 随机加 debuff）
  function openUninstallPicker() {
    const run = H.getRun();
    const socketed = run.allGems().filter(x => x.loc === 'card');
    openGemPicker(`卸下哪颗宝石？（💰 ${run.uninstallPrice()}，取回背包）`, socketed, uid => {
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
      avail.map(g => { const th = CG.gemTheme && CG.gemTheme(g); return { gem: g, uid: g.uid, label: th ? th.icon + ' ' + th.name : '' }; }), uid => {
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
      if (o.type === 'gem') { const th = CG.gemTheme && CG.gemTheme(o.gem); return CG.UI.gemFace(o.gem, { tagLabel: th ? th.icon + ' ' + th.name : '' }); }
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
      openGemPicker('净化哪颗宝石？（去掉它的代价）', run.allGems().filter(x => CG.gemHasCost(x.gem)), uid => H.onAltarPurify(uid));
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
    if (ev.target.closest('[data-act="restart"]')) { CG.Audio.play('select'); blinkTransition(() => H.onRestart()); }
    else if (ev.target.closest('[data-act="menu"]')) showMenu();
  }
  // 第一人称「眨眼」转场：先闭眼（上下眼睑合拢→全黑）→ 在黑屏下切到新一局 → 再睁眼。呼应结算的「两眼一黑，一场梦」。
  function blinkTransition(cb) {
    if (REDUCE) { if (cb) cb(); return; }
    let el = document.getElementById('blink-overlay');
    if (!el) { el = document.createElement('div'); el.id = 'blink-overlay'; document.body.appendChild(el); }
    el.style.pointerEvents = 'auto';               // 转场期间吃掉点击，避免重复触发
    // 椭圆视野：全黑遮罩中央挖一个椭圆透明孔，纵向半径 --eye-ry 从 200%(睁开/无黑) → 0%(闭合/全黑)
    const OPEN = 200, CLOSE_MS = 320, HOLD = 150, OPEN_MS = 380;
    const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);   // easeInOutQuad
    const setRy = v => el.style.setProperty('--eye-ry', v + '%');
    setRy(OPEN);
    let start = null, fired = false;
    const close = ts => {
      if (start == null) start = ts;
      const t = Math.min(1, (ts - start) / CLOSE_MS);
      setRy(OPEN * (1 - ease(t)));                  // 椭圆视野纵向收拢
      if (t < 1) return requestAnimationFrame(close);
      setRy(0);                                     // 完全闭眼（全黑）
      if (cb && !fired) { fired = true; cb(); }     // 黑屏下切到新一局
      setTimeout(() => { start = null; requestAnimationFrame(open); }, HOLD);
    };
    const open = ts => {
      if (start == null) start = ts;
      const t = Math.min(1, (ts - start) / OPEN_MS);
      setRy(OPEN * ease(t));                        // 椭圆视野重新张开
      if (t < 1) return requestAnimationFrame(open);
      setRy(OPEN);
      el.style.pointerEvents = 'none';
    };
    requestAnimationFrame(close);
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

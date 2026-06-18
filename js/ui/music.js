window.CG = window.CG || {};

/* ===========================================================================
 *  背景音乐 —— 按场景循环播放 mp3，切换时交叉淡入淡出。
 * ===========================================================================
 *  与音效共用静音状态（localStorage 'cg_muted'，由 CG.Audio 控制）。
 *  浏览器自动播放限制：首次用户手势后才开声（监听一次 pointerdown/keydown）。
 *  曲目↔场景映射集中在 TRACKS，需要换曲只改这里。
 * ===========================================================================
 */
(function (CG) {
  const BASE = 'assets/bgm/';
  const V = 'v26';
  const VOL = 0.42;          // 背景音乐音量（低于音效，作铺垫）
  const FADE = 900;          // 交叉淡变时长 ms

  // 场景 → 曲目（缺省/未知 → 静音，例如战败暂无 BGM）
  const TRACKS = {
    menu:    'Hymn_for_a_Forgotten_Throne.mp3',  // 主菜单：被遗忘王座的赞歌
    act1:    'Beneath_the_Ruined_Spire.mp3',     // 第一层：残塔之下
    act2:    'A_Crown_of_Rime.mp3',              // 第二层：霜之冠
    act3:    'The_Final_Ascent.mp3',             // 第三层：最终登临
    boss:    'Thunder_at_the_Altar.mp3',         // 首领：祭坛惊雷
    shop:    'The_Brass_Lantern_Stall.mp3',      // 商店：黄铜灯摊
    rest:    'Rest_Beneath_The_Pines.mp3',       // 休息：松下小憩
    event:   'Before_the_Crossing.mp3',          // 事件：抉择之前
    victory: 'A_Cold_Throne_Remains.mp3',        // 通关：唯余冷座
  };

  let a = null, b = null, active = null;   // 双音频元素交替，做交叉淡变
  let cur = null;                          // 当前场景 key
  let started = false;                     // 是否已获得用户手势
  let muted = false;
  try { muted = localStorage.getItem('cg_muted') === '1'; } catch (e) {}

  function mk() { const el = new Audio(); el.loop = true; el.preload = 'auto'; el.volume = 0; return el; }
  function ensureEls() { if (!a) { a = mk(); b = mk(); active = a; } }

  // requestAnimationFrame 音量渐变；目标为 0 时淡出后暂停
  function fade(el, to) {
    if (!el) return;
    if (el._fadeRaf) cancelAnimationFrame(el._fadeRaf);
    const from = el.volume, t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / FADE);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) el._fadeRaf = requestAnimationFrame(step);
      else { el._fadeRaf = null; if (to === 0) el.pause(); }
    })(t0);
  }

  function playActive() {
    if (!active || !active.src || muted || !started) return;
    const p = active.play();
    if (p && p.catch) p.catch(() => {});   // 手势前被拦截则静默忽略
    fade(active, VOL);
  }

  // 切到某场景的 BGM；同场景不重启，未知场景淡出静音
  function playScene(scene) {
    ensureEls();
    if (scene === cur) return;
    cur = scene;
    const file = TRACKS[scene];
    if (!file) { fade(active, 0); return; }
    const next = (active === a) ? b : a;
    if (active && active !== next) fade(active, 0);
    if (next.getAttribute('data-file') !== file) {
      next.src = BASE + file + '?' + V;
      next.setAttribute('data-file', file);
    }
    try { next.currentTime = 0; } catch (e) {}
    next.volume = 0;
    active = next;
    playActive();
  }

  function start() { if (!started) { started = true; playActive(); } }

  function setMuted(m) {
    muted = !!m;
    if (muted) { if (a) fade(a, 0); if (b) fade(b, 0); }
    else playActive();
  }

  function init() {
    ensureEls();
    const kick = () => start();
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, kick, { once: true, passive: true }));
  }

  CG.Music = { init, playScene, start, setMuted };
})(window.CG);
